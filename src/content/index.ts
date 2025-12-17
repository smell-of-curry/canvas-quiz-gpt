import { applyAnswer } from "./applyAnswer.js";
import { captureQuestionImage } from "./capture.js";
import { isCanvasQuizPage, observeQuestions } from "./canvasDetector.js";
import { QuestionAssistant } from "./questionAssistant.js";
import { parseQuestion } from "./questionParser.js";
import {
  QuestionChoice,
  SolveQuestionPayload,
  SolveQuestionResponse
} from "../shared/messages.js";

/**
 * Tracks registered question elements and their assistant instances.
 */
type QuestionEntry = {
  /**
   * The question element.
   */
  element: HTMLElement;
  /**
   * The fallback index of the question.
   */
  fallbackIndex: number;
  /**
   * The assistant instance for the question.
   */
  assistant: QuestionAssistant;
};

/**
 * A registry of question entries.
 */
const registry = new Map<string, QuestionEntry>();

initialize();

/**
 * Bootstraps the content script once a Canvas quiz is detected in the DOM.
 */
function initialize(): void {
  if (isCanvasQuizPage()) {
    observeQuestions((element, index) => attachAssistant(element, index));
    return;
  }

  const watcher = new MutationObserver(() => {
    if (!isCanvasQuizPage()) return;
    observeQuestions((element, index) => attachAssistant(element, index));
    watcher.disconnect();
  });

  watcher.observe(document.documentElement, { childList: true, subtree: true });
}

/**
 * Bind an assistant button to a discovered question element.
 * @param element - The question element.
 * @param index - The fallback index of the question.
 */
function attachAssistant(element: HTMLElement, index: number): void {
  if (element.querySelector<HTMLButtonElement>(".cqa-button")) return;
  const parsed = parseQuestion(element, index);
  const uniqueId = ensureUniqueId(parsed.id);

  const assistant = new QuestionAssistant(element, (instance) =>
    handleSolveRequest(uniqueId, instance, index)
  );
  registry.set(uniqueId, { element, fallbackIndex: index, assistant });
}

/**
 * Ensure generated question identifiers remain unique within the page.
 * @param baseId - The base identifier.
 * @returns A unique identifier.
 */
function ensureUniqueId(baseId: string): string {
  if (!registry.has(baseId)) {
    return baseId;
  }

  let suffix = 1;
  let candidate = `${baseId}-${suffix}`;
  while (registry.has(candidate)) {
    suffix += 1;
    candidate = `${baseId}-${suffix}`;
  }

  return candidate;
}

/**
 * Request a GPT solution and apply the result to the quiz UI.
 * @param questionId - The ID of the question.
 * @param assistant - The assistant instance.
 * @param fallbackIndex - The fallback index of the question.
 */
async function handleSolveRequest(
  questionId: string,
  assistant: QuestionAssistant,
  fallbackIndex: number
): Promise<void> {
  const entry = registry.get(questionId);
  if (!entry) {
    assistant.reset();
    return;
  }

  assistant.setLoading();

  try {
    const parsed = parseQuestion(entry.element, fallbackIndex);
    const screenshotDataUrl = await captureQuestionImage(entry.element);
    const payload = buildSolvePayload(questionId, parsed, screenshotDataUrl);
    const response = await sendSolveRequest(payload);

    if (response.status !== "success") {
      assistant.updateFromResponse(response);
      return;
    }

    const applyResult = applyAnswer(parsed, response.answerChoiceIds, response.answerText);
    if (!applyResult.success) {
      assistant.updateFromResponse({
        status: "error",
        questionId,
        error: applyResult.error
      });
      return;
    }

    assistant.updateFromResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    assistant.updateFromResponse({
      status: "error",
      questionId,
      error: message
    });
  }
}

/**
 * Create the payload expected by the background worker for GPT solving.
 * @param questionId - The ID of the question.
 * @param parsed - The parsed question.
 * @param screenshotDataUrl - The screenshot data URL.
 * @returns The payload expected by the background worker for GPT solving.
 */
function buildSolvePayload(
  questionId: string,
  parsed: ReturnType<typeof parseQuestion>,
  screenshotDataUrl: string
): SolveQuestionPayload {
  const choices: QuestionChoice[] = parsed.choices.map((choice, index) => {
    const value = getChoiceValue(choice);
    const letter =
      choice.kind === "single" || choice.kind === "multi" ? deriveChoiceLetter(index) : undefined;

    return {
      id: choice.id,
      label: choice.label,
      kind: choice.kind,
      value,
      index: index + 1,
      letter
    };
  });

  return {
    questionId,
    questionType: parsed.type,
    questionText: parsed.text,
    questionHtml: parsed.html,
    screenshotDataUrl,
    choices,
    context: {
      quizTitle: getQuizTitle(),
      questionNumber: parsed.number
    }
  };
}

function getChoiceValue(choice: ReturnType<typeof parseQuestion>["choices"][number]): string | undefined {
  if (typeof choice.value === "string" && choice.value.trim()) {
    return choice.value.trim();
  }

  const element = choice.element;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const value = element.value.trim();
    if (value) return value;
  }

  return undefined;
}

function deriveChoiceLetter(index: number): string | undefined {
  if (index < 0) return undefined;

  let current = index;
  let result = "";
  while (current >= 0) {
    const remainder = current % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor(current / 26) - 1;
  }

  return result || undefined;
}

/**
 * Send a message to the background worker and await the GPT response.
 * @param payload - The payload to send.
 * @returns A promise that resolves to the GPT response.
 */
function sendSolveRequest(payload: SolveQuestionPayload): Promise<SolveQuestionResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "cqa:solve-question", payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response) {
        reject(new Error("No response from background script."));
        return;
      }

      resolve(response as SolveQuestionResponse);
    });
  });
}

/**
 * Attempt to extract the quiz title for additional prompt context.
 * @returns The quiz title.
 */
function getQuizTitle(): string | undefined {
  const candidates = [
    document.querySelector<HTMLElement>("#quiz_title"),
    document.querySelector<HTMLElement>(".quiz-header h1"),
    document.querySelector<HTMLElement>("h1")
  ];

  for (const element of candidates) {
    const text = element?.textContent?.trim();
    if (text) return text;
  }

  return undefined;
}

