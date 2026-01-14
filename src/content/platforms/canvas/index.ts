import type {
  ChoiceKind,
  ParsedChoice,
  ParsedQuestion,
  PlatformAdapter,
  QuestionCallback,
} from "../types.js";

/**
 * CSS selectors matching Canvas quiz question containers.
 */
const QUESTION_SELECTORS = [
  "div.question_holder",
  "li.quiz_question",
].join(",");

/**
 * Canvas LMS platform adapter.
 * Handles quiz detection and parsing for Canvas/Instructure LMS.
 */
export class CanvasPlatformAdapter implements PlatformAdapter {
  readonly id = "canvas";
  readonly name = "Canvas LMS";

  /**
   * Determine whether the current page appears to be a Canvas quiz view.
   */
  isQuizPage(): boolean {
    const path = window.location.pathname ?? "";
    const matchesQuizPath = /quizzes/i.test(path);
    if (!matchesQuizPath) return false;

    return document.querySelector(QUESTION_SELECTORS) !== null;
  }

  /**
   * Observe the DOM for quiz questions and execute the callback on new elements.
   */
  observeQuestions(callback: QuestionCallback): () => void {
    const processed = new WeakSet<HTMLElement>();

    const collect = () => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(QUESTION_SELECTORS)
      ).filter((element) => element.matches("div, li"));
      if (candidates.length === 0) return;

      candidates.forEach((element, index) => {
        if (!this.isValidQuestionContainer(element)) return;
        if (processed.has(element)) return;

        processed.add(element);
        callback(element, index);
      });
    };

    collect();

    const observer = new MutationObserver(() => collect());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }

  /**
   * Parse a Canvas quiz question element into a structured format.
   */
  parseQuestion(element: HTMLElement, fallbackIndex: number): ParsedQuestion {
    const id = this.deriveQuestionId(element, fallbackIndex);
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
    const text = this.sanitizeLabel(
      selectInputs.length > 0
        ? this.extractTextWithSelectPlaceholders(textElement)
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
          label: this.deriveChoiceLabel(element, input, input.value),
          element: input,
          kind: "single" as ChoiceKind,
          value: this.normalizeValue(input.value),
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
          label: this.deriveChoiceLabel(element, input, input.value),
          element: input,
          kind: "multi" as ChoiceKind,
          value: this.normalizeValue(input.value),
        })),
      };
    }

    const selectChoices = this.buildSelectChoices(selectInputs);
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
          kind: "text" as ChoiceKind,
          value: this.normalizeValue(field.value),
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
   * Attempt to extract the quiz title for additional prompt context.
   */
  getQuizTitle(): string | undefined {
    const candidates = [
      document.querySelector<HTMLElement>("#quiz_title"),
      document.querySelector<HTMLElement>(".quiz-header h1"),
      document.querySelector<HTMLElement>("h1"),
    ];

    for (const element of candidates) {
      const text = element?.textContent?.trim();
      if (text) return text;
    }

    return undefined;
  }

  /**
   * Get Canvas-specific context for the GPT prompt.
   */
  getPlatformContext(): string | undefined {
    return "Canvas LMS";
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private helper methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Determine whether a given element is a valid Canvas quiz question container.
   */
  private isValidQuestionContainer(element: HTMLElement): boolean {
    const hasDataId =
      element.hasAttribute("data-question-id") ||
      element.dataset?.["questionId"] !== undefined;
    if (hasDataId) return true;

    const id = element.getAttribute("id") ?? "";
    if (/^question_\d+/.test(id)) return true;

    return element.matches(
      ".display_question, .question_holder, li.quiz_question"
    );
  }

  /**
   * Attempt to resolve a stable identifier for a question, falling back to its index.
   */
  private deriveQuestionId(element: HTMLElement, fallbackIndex: number): string {
    const datasetId =
      element.getAttribute("data-question-id") ??
      element.getAttribute("id") ??
      element.dataset?.["id"];
    if (datasetId) return datasetId;

    return `question-${fallbackIndex}`;
  }

  /**
   * Collapse whitespace and sanitize question copy.
   */
  private sanitizeLabel(raw: string | null | undefined): string {
    if (!raw) return "";
    return raw.replace(/\s+/g, " ").trim();
  }

  /**
   * Normalize an input value to a trimmed string or undefined when empty.
   */
  private normalizeValue(raw: string | undefined): string | undefined {
    if (typeof raw !== "string") return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    return trimmed;
  }

  /**
   * Derive a label for a choice.
   */
  private deriveChoiceLabel(
    questionRoot: HTMLElement,
    input: HTMLInputElement,
    fallbackValue: string
  ): string {
    const direct =
      input.getAttribute("data-label") ??
      input.getAttribute("aria-label") ??
      this.resolveAriaLabelledByText(questionRoot, input) ??
      this.resolveLabelForAttribute(questionRoot, input) ??
      this.resolveClosestLabel(input) ??
      this.resolveNearbyAnswerText(input);

    const label = this.sanitizeLabel(direct ?? "");
    if (label) return label;

    return this.sanitizeLabel(fallbackValue);
  }

  /**
   * Resolve a label for an input element by its attribute.
   */
  private resolveLabelForAttribute(
    questionRoot: HTMLElement,
    input: HTMLInputElement
  ): string | undefined {
    if (!input.id) return undefined;
    const selector = `label[for="${this.cssEscape(input.id)}"]`;
    const label =
      questionRoot.querySelector<HTMLElement>(selector) ??
      document.querySelector<HTMLElement>(selector);
    return this.extractHumanText(label ?? undefined);
  }

  /**
   * Resolve a label for an input element by its closest label.
   */
  private resolveClosestLabel(input: HTMLInputElement): string | undefined {
    const label = input.closest("label");
    return this.extractHumanText(label ?? undefined);
  }

  /**
   * Resolve a nearby answer text for an input element.
   */
  private resolveNearbyAnswerText(input: HTMLInputElement): string | undefined {
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
    const text = this.extractHumanText(candidate);
    if (text) return text;

    // Fallback: try sibling nodes
    const sibling = input.nextElementSibling as HTMLElement | null;
    const siblingText = this.extractHumanText(sibling ?? undefined);
    if (siblingText) return siblingText;

    const parentSibling = input.parentElement
      ?.nextElementSibling as HTMLElement | null;
    return this.extractHumanText(parentSibling ?? undefined);
  }

  /**
   * Resolve a label for an input element by its aria-labelledby attribute.
   */
  private resolveAriaLabelledByText(
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
        questionRoot.querySelector<HTMLElement>(`#${this.cssEscape(id)}`) ??
        document.getElementById(id);
      const text = this.extractHumanText(el ?? undefined);
      if (text) parts.push(text);
    });

    if (parts.length === 0) return undefined;
    return parts.join(" ");
  }

  /**
   * Extract human-readable text from an element.
   */
  private extractHumanText(element: HTMLElement | undefined): string | undefined {
    if (!element) return undefined;

    const inner = this.sanitizeLabel(element.innerText);
    if (inner) return inner;

    const text = this.sanitizeLabel(element.textContent);
    if (text) return text;

    const alts = Array.from(element.querySelectorAll("img"))
      .map((img) => this.sanitizeLabel(img.getAttribute("alt")))
      .filter(Boolean);
    if (alts.length > 0) return alts.join(" ");

    return undefined;
  }

  /**
   * Escape a value for use in a CSS selector.
   */
  private cssEscape(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  /**
   * Extract text from an element, replacing select placeholders with text.
   */
  private extractTextWithSelectPlaceholders(root: HTMLElement): string {
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
   */
  private buildSelectChoices(selects: HTMLSelectElement[]): ParsedChoice[] {
    if (selects.length === 0) return [];

    const result: ParsedChoice[] = [];

    selects.forEach((select, selectIndex) => {
      const stableId = this.deriveSelectStableId(select, selectIndex);
      const selectLabel = this.deriveSelectLabel(select, selectIndex);
      const options = Array.from(select.options);

      options.forEach((option, optionIndex) => {
        const value = this.normalizeValue(option.value);
        if (!value) return;

        const optionLabel =
          this.sanitizeLabel(option.textContent) ||
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
   */
  private deriveSelectStableId(select: HTMLSelectElement, index: number): string {
    const raw =
      this.normalizeValue(select.id) ??
      this.normalizeValue(select.name) ??
      this.normalizeValue(select.getAttribute("data-select-id") ?? undefined) ??
      `select-${index + 1}`;

    return raw.replaceAll("::", "--");
  }

  /**
   * Derive a label for a select element.
   */
  private deriveSelectLabel(select: HTMLSelectElement, index: number): string {
    const label =
      this.sanitizeLabel(select.getAttribute("aria-label")) ||
      this.sanitizeLabel(select.getAttribute("title")) ||
      this.sanitizeLabel(select.name) ||
      this.sanitizeLabel(select.id);

    if (label) return label;
    return `Dropdown ${index + 1}`;
  }
}
