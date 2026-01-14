import type { ParsedQuestion } from "./platforms/types.js";

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
    const targetChoice = resolveSingleChoice(
      question,
      answerChoiceIds,
      answerText
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
    const resolved = resolveMultiChoices(question, answerChoiceIds, answerText);
    if (resolved.size === 0)
      return {
        success: false,
        error: "GPT selections did not match any available choices.",
      };

    let appliedAny = false;
    for (const choice of question.choices) {
      if (!(choice.element instanceof HTMLInputElement)) continue;
      const shouldSelect = resolved.has(choice);
      if (choice.element.checked === shouldSelect) continue;

      choice.element.checked = shouldSelect;
      triggerInputEvent(choice.element);
      appliedAny = true;
    }

    if (!appliedAny) return { success: true };
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

  if (question.type === "select") {
    const selectChoices = question.choices.filter(
      (choice) =>
        choice.kind === "select" &&
        typeof choice.value === "string" &&
        choice.value.trim()
    );
    if (selectChoices.length === 0)
      return {
        success: false,
        error: "Unable to locate dropdown options for this question.",
      };

    const uniqueSelectsInQuestion = getUniqueSelectElements(selectChoices);
    if (uniqueSelectsInQuestion.length === 0)
      return {
        success: false,
        error: "Unable to locate dropdown inputs for this question.",
      };

    const byId = new Map(selectChoices.map((choice) => [choice.id, choice]));
    const requested = answerChoiceIds
      .map((id) => byId.get(id))
      .filter(Boolean) as typeof selectChoices;

    const chosenBySelect = new Map<HTMLSelectElement, string>();
    requested.forEach((choice) => {
      const element = choice.element;
      if (!(element instanceof HTMLSelectElement)) return;
      if (chosenBySelect.has(element)) return;
      chosenBySelect.set(element, choice.value as string);
    });

    const appliedFromIds = applySelectValues(
      uniqueSelectsInQuestion,
      chosenBySelect
    );
    if (appliedFromIds.success) return appliedFromIds;

    // Fallback: attempt to apply answerText by matching visible option labels / values.
    const parts = normalizeAnswerParts(answerText);
    if (parts.length === 0) return appliedFromIds;

    const mapping = new Map<HTMLSelectElement, string>();
    const orderedSelects = getSelectsInDomOrder(
      question,
      uniqueSelectsInQuestion
    );
    orderedSelects.forEach((select, index) => {
      const part = parts[index];
      if (!part) return;
      const match = matchSelectOption(select, part);
      if (!match) return;
      mapping.set(select, match);
    });

    const appliedFromText = applySelectValues(uniqueSelectsInQuestion, mapping);
    if (appliedFromText.success) return appliedFromText;

    return appliedFromText;
  }

  return { success: false, error: "Unsupported question type." };
}

/**
 * Resolve the single choice from the question and answer choices.
 * @param question - The parsed question to resolve the choice from.
 * @param answerChoiceIds - The IDs of the answer choices to resolve.
 * @param answerText - The text to resolve the choice from.
 * @returns The resolved choice or undefined if no choice was found.
 */
function resolveSingleChoice(
  question: ParsedQuestion,
  answerChoiceIds: string[],
  answerText?: string | string[]
): ParsedQuestion["choices"][number] | undefined {
  const direct = resolveChoicesByIds(question, answerChoiceIds);
  if (direct.length > 0) return direct[0];

  const fromText = resolveChoicesByText(question, answerText);
  if (fromText.length > 0) return fromText[0];

  // Some models put the visible label into answerIds instead of answerText.
  const fromIdsAsText = resolveChoicesByText(question, answerChoiceIds);
  if (fromIdsAsText.length > 0) return fromIdsAsText[0];

  return undefined;
}

/**
 * Resolve the multiple choices from the question and answer choices.
 * @param question - The parsed question to resolve the choices from.
 * @param answerChoiceIds - The IDs of the answer choices to resolve.
 * @param answerText - The text to resolve the choices from.
 * @returns The resolved choices.
 */
function resolveMultiChoices(
  question: ParsedQuestion,
  answerChoiceIds: string[],
  answerText?: string | string[]
): Set<ParsedQuestion["choices"][number]> {
  const resolved = new Set<ParsedQuestion["choices"][number]>();
  resolveChoicesByIds(question, answerChoiceIds).forEach((choice) =>
    resolved.add(choice)
  );
  resolveChoicesByText(question, answerText).forEach((choice) =>
    resolved.add(choice)
  );
  resolveChoicesByText(question, answerChoiceIds).forEach((choice) =>
    resolved.add(choice)
  );
  return resolved;
}

/**
 * Resolve the choices by their IDs.
 * @param question - The parsed question to resolve the choices from.
 * @param answerChoiceIds - The IDs of the answer choices to resolve.
 * @returns The resolved choices.
 */
function resolveChoicesByIds(
  question: ParsedQuestion,
  answerChoiceIds: string[]
): Array<ParsedQuestion["choices"][number]> {
  if (answerChoiceIds.length === 0) return [];

  const needles = answerChoiceIds
    .map((id) => normalizeNeedle(id))
    .filter(Boolean);
  if (needles.length === 0) return [];

  const matches: Array<ParsedQuestion["choices"][number]> = [];
  question.choices.forEach((choice, index) => {
    const candidates = [
      choice.id,
      typeof choice.value === "string" ? choice.value : "",
      deriveChoiceLetter(index),
      String(index + 1),
    ]
      .map((value) => normalizeNeedle(value))
      .filter(Boolean);

    const isMatch = candidates.some((candidate) => needles.includes(candidate));
    if (!isMatch) return;
    matches.push(choice);
  });

  return matches;
}

/**
 * Resolve the choices by their text.
 * @param question - The parsed question to resolve the choices from.
 * @param answerText - The text to resolve the choices from.
 * @returns The resolved choices.
 */
function resolveChoicesByText(
  question: ParsedQuestion,
  answerText?: string | string[]
): Array<ParsedQuestion["choices"][number]> {
  const parts = normalizeAnswerParts(answerText);
  if (parts.length === 0) return [];

  const normalizedParts = parts
    .map((part) => normalizeComparableText(part))
    .filter(Boolean);
  if (normalizedParts.length === 0) return [];

  const matches: Array<ParsedQuestion["choices"][number]> = [];
  question.choices.forEach((choice, index) => {
    const label = normalizeComparableText(choice.label);
    if (!label) return;

    // Prefer exact-ish match (after normalization), then contains.
    for (const part of normalizedParts) {
      if (!part) continue;
      if (label === part || label.includes(part) || part.includes(label)) {
        matches.push(choice);
        break;
      }
    }

    // Also allow picking by letter/position in answerText.
    for (const part of parts) {
      const needle = normalizeNeedle(part);
      if (!needle) continue;
      const letter = normalizeNeedle(deriveChoiceLetter(index));
      const position = normalizeNeedle(String(index + 1));
      if (needle === letter || needle === position) {
        matches.push(choice);
        break;
      }
    }
  });

  return matches;
}

/**
 * Normalize the needle for the text.
 * @param raw - The raw text to normalize.
 * @returns The normalized text.
 */
function normalizeNeedle(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/^[\[\(#\s]+/g, "")
    .replace(/[\]\)\s]+$/g, "")
    .trim()
    .toLowerCase();
  if (!cleaned) return undefined;
  return cleaned;
}

/**
 * Normalize the comparable text for the text.
 * @param raw - The raw text to normalize.
 * @returns The normalized text.
 */
function normalizeComparableText(raw: string | undefined): string {
  if (!raw) return "";
  // Aggressive normalization so math/log expressions compare reliably.
  return raw
    .replace(/\u2212/g, "-") // unicode minus
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ""); // drop punctuation/spaces
}

/**
 * Derive the choice letter for the index.
 * @param index - The index to derive the letter from.
 * @returns The derived letter.
 */
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
 * Get the unique select elements from the choices.
 * @param choices - The choices to get the unique select elements from.
 * @returns The unique select elements.
 */
function getUniqueSelectElements(
  choices: Array<{ element: HTMLElement }>
): HTMLSelectElement[] {
  const unique: HTMLSelectElement[] = [];
  const seen = new Set<HTMLSelectElement>();
  for (const choice of choices) {
    const element = choice.element;
    if (!(element instanceof HTMLSelectElement)) continue;
    if (seen.has(element)) continue;
    seen.add(element);
    unique.push(element);
  }
  return unique;
}

/**
 * Normalize the answer parts for the text.
 * @param answerText - The text to normalize the parts from.
 * @returns The normalized parts.
 */
function normalizeAnswerParts(
  answerText: string | string[] | undefined
): string[] {
  if (Array.isArray(answerText)) {
    return answerText.map((part) => part.trim()).filter(Boolean);
  }
  if (typeof answerText !== "string") return [];

  const trimmed = answerText.trim();
  if (!trimmed) return [];

  if (trimmed.includes("\n"))
    return trimmed
      .split("\n")
      .map((part) => part.trim())
      .filter(Boolean);
  if (trimmed.includes(","))
    return trimmed
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

  return [trimmed];
}

/**
 * Get the select elements in the DOM order.
 * @param question - The parsed question to get the select elements from.
 * @param selects - The select elements to get in the DOM order.
 * @returns The select elements in the DOM order.
 */
function getSelectsInDomOrder(
  question: ParsedQuestion,
  selects: HTMLSelectElement[]
): HTMLSelectElement[] {
  const set = new Set(selects);
  const ordered = Array.from(
    question.element.querySelectorAll("select")
  ).filter(
    (el): el is HTMLSelectElement =>
      el instanceof HTMLSelectElement && set.has(el)
  );
  return ordered.length > 0 ? ordered : selects;
}

/**
 * Match the select option for the requested text.
 * @param select - The select element to match the option for.
 * @param requested - The requested text to match the option for.
 * @returns The matched option or undefined if no option was found.
 */
function matchSelectOption(
  select: HTMLSelectElement,
  requested: string
): string | undefined {
  const needle = requested.trim().toLowerCase();
  if (!needle) return undefined;

  // Prefer an exact value match.
  for (const option of Array.from(select.options)) {
    if (option.value.trim() !== requested.trim()) continue;
    return option.value;
  }

  // Then exact label match (case-insensitive).
  for (const option of Array.from(select.options)) {
    const label = (option.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (label && label === needle) return option.value;
  }

  // Finally, a contains match for robustness.
  for (const option of Array.from(select.options)) {
    const label = (option.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (label && label.includes(needle)) return option.value;
  }

  return undefined;
}

/**
 * Apply the select values to the select elements.
 * @param selects - The select elements to apply the values to.
 * @param valuesBySelect - The values by select element.
 * @returns The result of applying the select values.
 */
function applySelectValues(
  selects: HTMLSelectElement[],
  valuesBySelect: Map<HTMLSelectElement, string>
): ApplyResult {
  let appliedAny = false;
  let matchedCount = 0;

  for (const select of selects) {
    const value = valuesBySelect.get(select);
    if (!value) continue;
    matchedCount += 1;

    if (select.value === value) {
      appliedAny = true;
      continue;
    }

    select.value = value;
    if (select.value !== value)
      return {
        success: false,
        error: `Canvas rejected dropdown value "${value}". This usually means the option value was not found.`,
      };

    triggerInputEvent(select);
    appliedAny = true;
  }

  if (!appliedAny && matchedCount === 0)
    return {
      success: false,
      error: "GPT selections did not match any available dropdown options.",
    };

  if (matchedCount < selects.length)
    return {
      success: false,
      error:
        "GPT did not provide selections for all dropdowns in this question.",
    };

  return { success: true };
}
