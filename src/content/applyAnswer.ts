import { ParsedQuestion } from "./questionParser.js";

/**
 * Result of attempting to apply a GPT suggestion to the DOM.
 * @property success - Whether the answer was applied successfully.
 * @property error - The error message if the answer was not applied successfully.
 */
export type ApplyResult = { success: true } | { success: false; error: string };

/**
 * Emit synthetic events to ensure Canvas detects programmatic answer changes.
 * @param element - The HTML input element to trigger events on.
 */
function triggerInputEvent(element: HTMLElement): void {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Apply GPT-selected answers to a parsed question, handling each supported type.
 * @param question - The parsed question to apply the answer to.
 * @param answerChoiceIds - The IDs of the answer choices to apply.
 * @param answerText - The text to apply to the question.
 * @returns A result indicating whether the answer was applied successfully.
 */
export function applyAnswer(
  question: ParsedQuestion,
  answerChoiceIds: string[],
  answerText?: string | string[]
): ApplyResult {
  if (question.type === "single") {
    const targetChoice = question.choices.find((choice) =>
      answerChoiceIds.includes(choice.id)
    );
    if (!targetChoice)
      return {
        success: false,
        error: "No matching answer choice returned by GPT.",
      };

    const input = targetChoice.element as HTMLInputElement;
    if (input.checked) return { success: true };

    input.checked = true;
    triggerInputEvent(input);
    return { success: true };
  }

  if (question.type === "multi") {
    if (answerChoiceIds.length === 0) {
      return {
        success: false,
        error: "GPT did not return selections for a multi-choice question.",
      };
    }

    const availableChoices = new Map(
      question.choices.map((choice) => [choice.id, choice])
    );
    let appliedAny = false;
    let matchedCount = 0;

    availableChoices.forEach((choice) => {
      const shouldSelect = answerChoiceIds.includes(choice.id);
      if (shouldSelect) matchedCount += 1;
      const checkbox = choice.element as HTMLInputElement;
      if (checkbox.checked === shouldSelect) return;

      checkbox.checked = shouldSelect;
      triggerInputEvent(checkbox);
      appliedAny = true;
    });

    if (!appliedAny && matchedCount === 0)
      return {
        success: false,
        error: "GPT selections did not match any available choices.",
      };

    return { success: true };
  }

  if (question.type === "text") {
    const value =
      typeof answerText === "string"
        ? answerText
        : Array.isArray(answerText)
        ? answerText.join("\n")
        : "";
    if (!value)
      return {
        success: false,
        error: "GPT did not provide text to populate this response.",
      };

    const field = question.choices[0]?.element as
      | HTMLInputElement
      | HTMLTextAreaElement
      | undefined;
    if (!field)
      return {
        success: false,
        error: "Unable to locate the text input for this question.",
      };

    field.value = value;
    triggerInputEvent(field);
    return { success: true };
  }

  return { success: false, error: "Unsupported question type." };
}
