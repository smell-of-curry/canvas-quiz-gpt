/**
 * Supported Canvas question choice types derived from DOM analysis.
 */
type ChoiceKind = "single" | "multi" | "text";

/**
 * Normalized representation of a question choice element.
 */
export type ParsedChoice = {
  /**
   * The unique identifier for the choice.
   */
  id: string;
  /**
   * The label for the choice.
   */
  label: string;
  /**
   * The element for the choice.
   */
  element: HTMLElement;
  /**
   * The kind of choice.
   */
  kind: ChoiceKind;
  /**
   * The value attribute associated with the choice, when present.
   */
  value?: string;
};

/**
 * Parsed question metadata consumed by the assistant workflow.
 */
export type ParsedQuestion = {
  /**
   * The unique identifier for the question.
   */
  id: string;
  /**
   * The element for the question.
   */
  element: HTMLElement;
  /**
   * The type of question.
   */
  type: ChoiceKind | "unknown";
  /**
   * The text of the question.
   */
  text: string;
  /**
   * The HTML of the question.
   */
  html: string;
  /**
   * The number of the question.
   */
  number?: number;
  /**
   * The choices for the question.
   */
  choices: ParsedChoice[];
};

/**
 * Attempt to resolve a stable identifier for a question, falling back to its index.
 * @param element - The element to derive the identifier from.
 * @param fallbackIndex - The fallback index to use if the identifier cannot be derived.
 * @returns The derived identifier.
 */
function deriveQuestionId(element: HTMLElement, fallbackIndex: number): string {
  const datasetId =
    element.getAttribute("data-question-id") ??
    element.getAttribute("id") ??
    element.dataset?.["id"];
  if (datasetId) return datasetId;

  return `canvas-question-${fallbackIndex}`;
}

/**
 * Collapse whitespace and sanitize question copy.
 * @param raw - The raw label to sanitize.
 * @returns The sanitized label.
 */
function sanitizeLabel(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Parse a Canvas quiz question element into a structured format.
 * @param element - The element to parse.
 * @param fallbackIndex - The fallback index to use if the identifier cannot be derived.
 * @returns The parsed question.
 */
export function parseQuestion(element: HTMLElement, fallbackIndex: number): ParsedQuestion {
  const id = deriveQuestionId(element, fallbackIndex);
  const numberText =
    element.querySelector<HTMLElement>(".question_number")?.textContent ??
    element.getAttribute("data-question-number");

  const number = Number.parseInt(numberText ?? "", 10);

  const textElement =
    element.querySelector<HTMLElement>(".question_text") ??
    element.querySelector<HTMLElement>(".question_text span") ??
    element;

  const text = sanitizeLabel(textElement.textContent);
  const html = element.innerHTML;

  const radioInputs = Array.from(
    element.querySelectorAll<HTMLInputElement>('input[type="radio"]')
  );
  const checkboxInputs = Array.from(
    element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  );
  const textInputs = Array.from(
    element.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="number"]')
  );
  const textAreas = Array.from(element.querySelectorAll<HTMLTextAreaElement>("textarea"));

  if (radioInputs.length > 0) {
    return {
      id,
      element,
      type: "single",
      text,
      html,
      number: Number.isNaN(number) ? undefined : number,
      choices: radioInputs.map((input) => ({
        id: input.id || `${id}-choice-${input.value}`,
        label: sanitizeLabel(
          input.getAttribute("data-label") ??
            element.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)?.textContent ??
            input.parentElement?.textContent ??
            input.value
        ),
        element: input,
        kind: "single",
        value: normalizeValue(input.value)
      }))
    };
  }

  if (checkboxInputs.length > 0) {
    return {
      id,
      element,
      type: "multi",
      text,
      html,
      number: Number.isNaN(number) ? undefined : number,
      choices: checkboxInputs.map((input) => ({
        id: input.id || `${id}-choice-${input.value}`,
        label: sanitizeLabel(
          input.getAttribute("data-label") ??
            element.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)?.textContent ??
            input.parentElement?.textContent ??
            input.value
        ),
        element: input,
        kind: "multi",
        value: normalizeValue(input.value)
      }))
    };
  }

  const textField = [...textInputs, ...textAreas];
  if (textField.length > 0) {
    return {
      id,
      element,
      type: "text",
      text,
      html,
      number: Number.isNaN(number) ? undefined : number,
      choices: textField.map((field, index) => ({
        id: field.id || `${id}-text-${index + 1}`,
        label: field.getAttribute("placeholder") ?? "Free response",
        element: field,
        kind: "text",
        value: normalizeValue(field.value)
      }))
    };
  }

  return {
    id,
    element,
    type: "unknown",
    text,
    html,
    number: Number.isNaN(number) ? undefined : number,
    choices: []
  };
}

/**
 * Normalize an input value to a trimmed string or undefined when empty.
 * @param raw - The raw value to normalize.
 * @returns The normalized value or undefined.
 */
function normalizeValue(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

