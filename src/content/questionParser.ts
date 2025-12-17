/**
 * Supported Canvas question choice types derived from DOM analysis.
 */
type ChoiceKind = "single" | "multi" | "text" | "select";

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
export function parseQuestion(
  element: HTMLElement,
  fallbackIndex: number
): ParsedQuestion {
  const id = deriveQuestionId(element, fallbackIndex);
  const numberText =
    element.querySelector<HTMLElement>(".question_number")?.textContent ??
    element.getAttribute("data-question-number");

  const number = Number.parseInt(numberText ?? "", 10);

  const textElement =
    element.querySelector<HTMLElement>(".question_text") ??
    element.querySelector<HTMLElement>(".question_text span") ??
    element;

  const selectInputs = Array.from(
    element.querySelectorAll<HTMLSelectElement>("select")
  );
  const text = sanitizeLabel(
    selectInputs.length > 0
      ? extractTextWithSelectPlaceholders(textElement)
      : textElement.textContent
  );
  const html = element.innerHTML;

  const radioInputs = Array.from(
    element.querySelectorAll<HTMLInputElement>('input[type="radio"]')
  );
  const checkboxInputs = Array.from(
    element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  );
  const textInputs = Array.from(
    element.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="number"]'
    )
  );
  const textAreas = Array.from(
    element.querySelectorAll<HTMLTextAreaElement>("textarea")
  );

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
        label: deriveChoiceLabel(element, input, input.value),
        element: input,
        kind: "single",
        value: normalizeValue(input.value),
      })),
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
        label: deriveChoiceLabel(element, input, input.value),
        element: input,
        kind: "multi",
        value: normalizeValue(input.value),
      })),
    };
  }

  const selectChoices = buildSelectChoices(selectInputs);
  if (selectChoices.length > 0) {
    return {
      id,
      element,
      type: "select",
      text,
      html,
      number: Number.isNaN(number) ? undefined : number,
      choices: selectChoices,
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
        value: normalizeValue(field.value),
      })),
    };
  }

  return {
    id,
    element,
    type: "unknown",
    text,
    html,
    number: Number.isNaN(number) ? undefined : number,
    choices: [],
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

/**
 * Derive a label for a choice.
 * @param questionRoot - The root element of the question.
 * @param input - The input element to derive a label for.
 * @param fallbackValue - The fallback value to use if the label cannot be derived.
 * @returns The derived label.
 */
function deriveChoiceLabel(
  questionRoot: HTMLElement,
  input: HTMLInputElement,
  fallbackValue: string
): string {
  const direct =
    input.getAttribute("data-label") ??
    input.getAttribute("aria-label") ??
    resolveAriaLabelledByText(questionRoot, input) ??
    resolveLabelForAttribute(questionRoot, input) ??
    resolveClosestLabel(input) ??
    resolveNearbyAnswerText(input);

  const label = sanitizeLabel(direct ?? "");
  if (label) return label;

  return sanitizeLabel(fallbackValue);
}

/**
 * Resolve a label for an input element by its attribute.
 * @param questionRoot - The root element of the question.
 * @param input - The input element to resolve a label for.
 * @returns The resolved label.
 */
function resolveLabelForAttribute(
  questionRoot: HTMLElement,
  input: HTMLInputElement
): string | undefined {
  if (!input.id) return undefined;
  const selector = `label[for="${cssEscape(input.id)}"]`;
  const label =
    questionRoot.querySelector<HTMLElement>(selector) ??
    document.querySelector<HTMLElement>(selector);
  return extractHumanText(label ?? undefined);
}

/**
 * Resolve a label for an input element by its closest label.
 * @param input - The input element to resolve a label for.
 * @returns The resolved label.
 */
function resolveClosestLabel(input: HTMLInputElement): string | undefined {
  const label = input.closest("label");
  return extractHumanText(label ?? undefined);
}

/**
 * Resolve a nearby answer text for an input element.
 * @param input - The input element to resolve a nearby answer text for.
 * @returns The resolved nearby answer text.
 */
function resolveNearbyAnswerText(input: HTMLInputElement): string | undefined {
  const answerRoot =
    input.closest<HTMLElement>(
      ".answer, .answer_row, .answer_label, .answer_text, li, div"
    ) ??
    input.parentElement ??
    undefined;
  if (!answerRoot) return undefined;

  const preferred =
    answerRoot.querySelector<HTMLElement>(".answer_text") ??
    answerRoot.querySelector<HTMLElement>(".answer_label") ??
    answerRoot.querySelector<HTMLElement>(".answer_text span") ??
    undefined;

  const candidate = preferred ?? answerRoot;
  const text = extractHumanText(candidate);
  if (text) return text;

  // Fallback: try sibling nodes (common structure: input + span/div with content)
  const sibling = input.nextElementSibling as HTMLElement | null;
  const siblingText = extractHumanText(sibling ?? undefined);
  if (siblingText) return siblingText;

  const parentSibling = input.parentElement
    ?.nextElementSibling as HTMLElement | null;
  return extractHumanText(parentSibling ?? undefined);
}

/**
 * Resolve a label for an input element by its aria-labelledby attribute.
 * @param questionRoot - The root element of the question.
 * @param input - The input element to resolve a label for.
 * @returns The resolved label.
 */
function resolveAriaLabelledByText(
  questionRoot: HTMLElement,
  input: HTMLInputElement
): string | undefined {
  const labelledBy = input.getAttribute("aria-labelledby");
  if (!labelledBy) return undefined;

  const ids = labelledBy
    .split(/\s+/)
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) return undefined;

  const parts: string[] = [];
  ids.forEach((id) => {
    const el =
      questionRoot.querySelector<HTMLElement>(`#${cssEscape(id)}`) ??
      document.getElementById(id);
    const text = extractHumanText(el ?? undefined);
    if (text) parts.push(text);
  });

  if (parts.length === 0) return undefined;
  return parts.join(" ");
}

/**
 * Extract human-readable text from an element.
 * @param element - The element to extract text from.
 * @returns The extracted text.
 */
function extractHumanText(
  element: HTMLElement | undefined
): string | undefined {
  if (!element) return undefined;

  const inner = sanitizeLabel(element.innerText);
  if (inner) return inner;

  const text = sanitizeLabel(element.textContent);
  if (text) return text;

  const alts = Array.from(element.querySelectorAll("img"))
    .map((img) => sanitizeLabel(img.getAttribute("alt")))
    .filter(Boolean);
  if (alts.length > 0) return alts.join(" ");

  return undefined;
}

/**
 * Escape a value for use in a CSS selector.
 * @param value - The value to escape.
 * @returns The escaped value.
 */
function cssEscape(value: string): string {
  // Minimal escape fallback; CSS.escape is not available in all contexts.
  // Escape quotes and backslashes to safely embed in attribute selectors.
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Extract text from an element, replacing select placeholders with text.
 * @param root - The element to extract text from.
 * @returns The extracted text.
 */
function extractTextWithSelectPlaceholders(root: HTMLElement): string {
  const doc = root.ownerDocument;
  if (!doc) return root.textContent ?? "";

  const clone = root.cloneNode(true) as HTMLElement;
  const selects = Array.from(clone.querySelectorAll("select"));
  selects.forEach((select, index) => {
    const placeholder = doc.createElement("span");
    placeholder.textContent = ` [Dropdown ${index + 1}] `;
    select.replaceWith(placeholder);
  });

  return clone.textContent ?? "";
}

/**
 * Build choices from select elements.
 * @param selects - The select elements to build choices from.
 * @returns The built choices.
 */
function buildSelectChoices(selects: HTMLSelectElement[]): ParsedChoice[] {
  if (selects.length === 0) return [];

  const result: ParsedChoice[] = [];

  selects.forEach((select, selectIndex) => {
    const stableId = deriveSelectStableId(select, selectIndex);
    const selectLabel = deriveSelectLabel(select, selectIndex);
    const options = Array.from(select.options);

    options.forEach((option, optionIndex) => {
      const value = normalizeValue(option.value);
      if (!value) return;

      const optionLabel =
        sanitizeLabel(option.textContent) ||
        value ||
        `Option ${optionIndex + 1}`;
      result.push({
        id: `${stableId}::${value}`,
        label: `${selectLabel}: ${optionLabel}`,
        element: select,
        kind: "select",
        value,
      });
    });
  });

  return result;
}

/**
 * Derive a stable ID for a select element.
 * @param select - The select element to derive an ID for.
 * @param index - The index of the select element.
 * @returns The derived stable ID.
 */
function deriveSelectStableId(
  select: HTMLSelectElement,
  index: number
): string {
  const raw =
    normalizeValue(select.id) ??
    normalizeValue(select.name) ??
    normalizeValue(select.getAttribute("data-select-id") ?? undefined) ??
    `select-${index + 1}`;

  // Avoid collisions with our delimiter.
  return raw.replaceAll("::", "--");
}

/**
 * Derive a label for a select element.
 * @param select - The select element to derive a label for.
 * @param index - The index of the select element.
 * @returns The derived label.
 */
function deriveSelectLabel(select: HTMLSelectElement, index: number): string {
  const label =
    sanitizeLabel(select.getAttribute("aria-label")) ||
    sanitizeLabel(select.getAttribute("title")) ||
    sanitizeLabel(select.name) ||
    sanitizeLabel(select.id);

  if (label) return label;
  return `Dropdown ${index + 1}`;
}
