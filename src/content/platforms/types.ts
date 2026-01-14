/**
 * Supported quiz question choice types derived from DOM analysis.
 */
export type ChoiceKind = "single" | "multi" | "text" | "select";

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
 * Callback invoked for each discovered question container.
 */
export type QuestionCallback = (element: HTMLElement, index: number) => void;

/**
 * Platform adapter interface that each quiz platform must implement.
 * This enables the extension to support multiple quiz platforms (Canvas, Wiley, ExpertTA, etc.)
 */
export interface PlatformAdapter {
  /**
   * Unique identifier for this platform.
   */
  readonly id: string;

  /**
   * Human-readable name of the platform.
   */
  readonly name: string;

  /**
   * Check if the current page belongs to this quiz platform.
   * @returns true if this adapter should handle the current page.
   */
  isQuizPage(): boolean;

  /**
   * Observe the DOM for quiz questions and execute the callback on new elements.
   * @param callback - The callback to execute on each discovered question container.
   * @returns A function to stop observing the DOM for quiz questions.
   */
  observeQuestions(callback: QuestionCallback): () => void;

  /**
   * Parse a quiz question element into a structured format.
   * @param element - The question element to parse.
   * @param fallbackIndex - The fallback index to use if the identifier cannot be derived.
   * @returns The parsed question.
   */
  parseQuestion(element: HTMLElement, fallbackIndex: number): ParsedQuestion;

  /**
   * Attempt to extract the quiz title for additional prompt context.
   * @returns The quiz title if found, undefined otherwise.
   */
  getQuizTitle(): string | undefined;

  /**
   * Optional: Get additional context specific to this platform.
   * @returns Platform-specific context for the GPT prompt.
   */
  getPlatformContext?(): string | undefined;
}

/**
 * Registry entry for a detected platform.
 */
export interface PlatformRegistryEntry {
  /**
   * The adapter instance.
   */
  adapter: PlatformAdapter;
  /**
   * URL patterns this adapter matches against.
   */
  urlPatterns: RegExp[];
  /**
   * Host patterns (for manifest.json configuration).
   */
  hostPatterns: string[];
}
