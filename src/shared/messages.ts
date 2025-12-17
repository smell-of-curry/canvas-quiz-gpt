/**
 * Represents a single answer choice extracted from a Canvas quiz prompt.
 */
export type QuestionChoice = {
  /**
   * The unique identifier for the choice.
   */
  id: string;
  /**
   * The label for the choice.
   */
  label: string;
  /**
   * The kind of choice.
   */
  kind: "single" | "multi" | "text";
  /**
   * Value attribute captured from the original input, when available.
   */
  value?: string;
  /**
   * One-based position of the choice within the question.
   */
  index: number;
  /**
   * Letter designation for the choice (A, B, ...), when applicable.
   */
  letter?: string;
};

/**
 * Payload sent from the content script to request a GPT-powered solution for a question.
 */
export type SolveQuestionPayload = {
  /**
   * The unique identifier for the question.
   */
  questionId: string;
  /**
   * The type of question.
   */
  questionType: "single" | "multi" | "text" | "unknown";
  /**
   * The text of the question.
   */
  questionText: string;
  /**
   * The HTML of the question.
   */
  questionHtml: string;
  /**
   * The screenshot data URL.
   */
  screenshotDataUrl: string;
  /**
   * The choices for the question.
   */
  choices: QuestionChoice[];
  /**
   * The context for the question.
   */
  context?: {
    /**
     * The title of the quiz.
     */
    quizTitle?: string;
    /**
     * The number of the question.
     */
    questionNumber?: number;
  };
};

/**
 * Request envelope emitted from content scripts to the background worker.
 */
export type SolveQuestionRequest = {
  /**
   * The type of request.
   */
  type: "cqa:solve-question";
  /**
   * The payload for the request.
   */
  payload: SolveQuestionPayload;
};

/**
 * Enumeration of possible resolution outcomes for a GPT solve request.
 */
export type SolveResultStatus = "success" | "error" | "timeout";

/**
 * Successful GPT resolution including selected answer choice identifiers.
 */
export type SolveQuestionSuccess = {
  /**
   * The status of the request.
   */
  status: "success";
  /**
   * The unique identifier for the question.
   */
  questionId: string;
  /**
   * The IDs of the answer choices.
   */
  answerChoiceIds: string[];
  /**
   * The reasoning for the answer.
   */
  reasoning?: string;
  /**
   * The text of the answer.
   */
  answerText?: string | string[];
};

/**
 * Error response when the GPT call fails or cannot determine an answer.
 */
export type SolveQuestionError = {
  /**
   * The status of the request.
   */
  status: "error";
  /**
   * The unique identifier for the question.
   */
  questionId: string;
  /**
   * The error message.
   */
  error: string;
};

/**
 * Response emitted when a GPT solve request times out.
 */
export type SolveQuestionTimeout = {
  /**
   * The status of the request.
   */
  status: "timeout";
  /**
   * The unique identifier for the question.
   */
  questionId: string;
  /**
   * The error message.
   */
  error?: string;
};

/**
 * Union of all possible GPT solve responses returned from the background worker.
 */
export type SolveQuestionResponse =
  | SolveQuestionSuccess
  | SolveQuestionError
  | SolveQuestionTimeout;

/**
 * Request to capture a screenshot of the visible tab.
 */
export type CaptureTabRequest = {
  type: "cqa:capture-tab";
};

/**
 * Response containing a PNG data URL for the visible tab.
 */
export type CaptureTabResponse = {
  type: "cqa:capture-tab:response";
  dataUrl: string;
};

/**
 * High-level message contract handled by the background service worker.
 */
export type AssistantMessage = SolveQuestionRequest | CaptureTabRequest;

