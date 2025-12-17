import { SolveQuestionPayload } from "../shared/messages.js";
import { AssistantSettings } from "../shared/settings.js";

/**
 * Expected JSON payload from the assistant completion response.
 * @property answerIds - The IDs of the answer choices.
 * @property reasoning - The reasoning for the answer.
 * @property status - The status of the answer.
 * @property answerText - The text of the answer.
 */
type ParsedAssistantResponse = {
  answerIds?: string[];
  reasoning?: string;
  status?: "unknown" | "confident";
  answerText?: string | string[];
};

/**
 * Successful OpenAI invocation outcome.
 * @property status - The status of the OpenAI API call.
 * @property answerChoiceIds - The IDs of the answer choices.
 * @property reasoning - The reasoning for the answer.
 * @property answerText - The text of the answer.
 */
export type OpenAiSuccess = {
  status: "success";
  answerChoiceIds: string[];
  reasoning?: string;
  answerText?: string | string[];
};

/**
 * Failure outcome when communicating with OpenAI.
 * @property status - The status of the OpenAI API call.
 * @property error - The error message if the OpenAI API call failed.
 */
export type OpenAiFailure =
  | { status: "error"; error: string }
  | { status: "timeout"; error?: string };

export type OpenAiResult = OpenAiSuccess | OpenAiFailure;

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Construct textual context describing the quiz question for the GPT prompt.
 * @property type - The type of content part.
 * @property text - The text content.
 * @property image_url - The image URL content.
 */
type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/**
 * Build the question summary for the OpenAI API request.
 * @param payload - The payload containing the question and context.
 * @returns A string containing the question summary.
 */
function buildQuestionSummary(payload: SolveQuestionPayload): string {
  const lines: string[] = [];
  lines.push(
    `Question type: ${payload.questionType}`,
    payload.context?.quizTitle ? `Quiz: ${payload.context.quizTitle}` : "",
    typeof payload.context?.questionNumber === "number"
      ? `Question number: ${payload.context.questionNumber}`
      : "",
    `Question text: ${payload.questionText.trim()}`
  );

  const choiceLines = payload.choices.map((choice) => {
    const position = typeof choice.index === "number" ? `#${choice.index}` : "";
    const letter = choice.letter ? ` (${choice.letter})` : "";
    const value = choice.value ? ` [value=${choice.value}]` : "";
    const prefix = [position, letter].filter(Boolean).join("");
    return `${prefix ? `${prefix} ` : ""}[${choice.id}] ${choice.label}${value}`;
  });

  if (choiceLines.length > 0) lines.push("Choices:\n" + choiceLines.join("\n"));
  lines.push(
    "Return a JSON object with fields: answerIds (array of choice ids), reasoning (string), answerText (string or array of strings for text responses)."
  );
  lines.push(
    "Important: Populate answerIds with the exact id strings shown in brackets. If you select options by letter or number, convert them back to the matching id.",
    "For single- or multi-select questions, set answerText to the chosen label(s) (string for one choice, array for multiple). For text-entry questions, answerText must contain the text to insert."
  );
  return lines.filter(Boolean).join("\n");
}

/**
 * Build the user content for the OpenAI API request.
 * @param payload - The payload containing the question and context.
 * @returns An array of user content parts to be included in the OpenAI API request.
 */
function buildUserContent(payload: SolveQuestionPayload): UserContentPart[] {
  const content: UserContentPart[] = [
    {
      type: "text",
      text: buildQuestionSummary(payload)
    }
  ];

  if (payload.screenshotDataUrl && payload.screenshotDataUrl.trim().length > 0) {
    content.push({
      type: "image_url",
      image_url: {
        url: payload.screenshotDataUrl
      }
    });
  }

  return content;
}

/**
 * Call the OpenAI Chat Completions API to request an answer suggestion for a question.
 * @param payload - The payload containing the question and context.
 * @param settings - The settings for the OpenAI API.
 * @returns A result indicating whether the OpenAI API call was successful and the answer suggestion.
 */
export async function requestOpenAiSolution(
  payload: SolveQuestionPayload,
  settings: AssistantSettings
): Promise<OpenAiResult> {
  if (!settings.apiKey) return {
    status: "error",
    error: "Missing OpenAI API key. Please add it in the extension options."
  };

  const controller = new AbortController();
  const timeoutMs = Math.max(5, settings.timeoutSeconds) * 1000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: settings.temperature,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a Canvas LMS quiz assistant. Analyze the provided question and choices, then respond with strict JSON: {\"answerIds\": string[], \"reasoning\": string, \"answerText\": string | string[]}. Always fill answerIds with the exact id values supplied in the prompt. For single- or multi-select questions, mirror the selected choice labels in answerText (string for one selection, array for multiple). If unsure, leave answerIds empty, set answerText to an explanatory string, and explain why."
          },
          {
            role: "user",
            content: buildUserContent(payload)
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      return {
        status: "error",
        error:
          errorBody ||
          `OpenAI API returned status ${response.status}. Check your key and model configuration.`
      };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content) return { status: "error", error: "OpenAI response was empty." };

    let parsed: ParsedAssistantResponse;
    try {
      parsed = JSON.parse(content) as ParsedAssistantResponse;
    } catch (error) {
      return {
        status: "error",
        error: `Failed to parse assistant response as JSON: ${(error as Error).message}`
      };
    }

    const answerChoiceIds = Array.isArray(parsed.answerIds) ? parsed.answerIds : [];
    return {
      status: "success",
      answerChoiceIds,
      reasoning: parsed.reasoning,
      answerText: parsed.answerText
    };
  } catch (error) {
    if ((error as Error).name === "AbortError") return { status: "timeout", error: "Request timed out." };

    return {
      status: "error",
      error: (error as Error).message || "Unexpected error while contacting OpenAI."
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

