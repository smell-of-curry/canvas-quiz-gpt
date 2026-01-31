import {
  SolveQuestionResponse,
  SolveResultStatus,
} from "../shared/messages.js";

/**
 * Internal state machine for each question assistant button.
 */
type AssistantState = SolveResultStatus | "idle" | "loading";

/**
 * Mapping of assistant states to icon asset filenames.
 */
const STATE_ICON_FILES: Record<Exclude<AssistantState, "idle">, string> = {
  loading: "assets/question-loading.svg",
  success: "assets/question-success.svg",
  error: "assets/question-error.svg",
  timeout: "assets/question-timeout.svg",
};

const IDLE_ICON_FILE = "assets/question-idle.svg";
const STYLE_ID = "qa-style";

/**
 * Callback executed when the assistant button requests a GPT solution.
 */
type SolveRequestHandler = (assistant: QuestionAssistant) => void;

/**
 * Manages lifecycle and UI for an individual quiz question assistant button.
 */
export class QuestionAssistant {
  private readonly question: HTMLElement;
  private readonly button: HTMLButtonElement;
  private state: AssistantState = "idle";
  private readonly onRequestSolve: SolveRequestHandler;

  /**
   * Create an assistant instance bound to a question element.
   * @param question - The question element.
   * @param onRequestSolve - The callback to execute when the assistant button is clicked.
   */
  constructor(question: HTMLElement, onRequestSolve: SolveRequestHandler) {
    this.question = question;
    this.onRequestSolve = onRequestSolve;
    this.button = this.createButton();
    this.attach();
  }

  /**
   * Expose the bound question element.
   * @returns The question element.
   */
  get element(): HTMLElement {
    return this.question;
  }

  /**
   * Current visual state of the assistant button.
   * @returns The current state of the assistant button.
   */
  get currentState(): AssistantState {
    return this.state;
  }

  /**
   * Transition the button into the loading state.
   * @returns The current state of the assistant button.
   */
  setLoading(): void {
    this.updateState("loading");
  }

  /**
   * Update UI state and tooltip content based on a solve response.
   * @param response - The response from the GPT API.
   */
  updateFromResponse(response: SolveQuestionResponse): void {
    this.updateState(response.status);
    if (response.status === "error" && response.error) {
      this.button.title = response.error;
      return;
    }

    if (response.status === "success") {
      const answerText =
        typeof response.answerText === "string"
          ? response.answerText
          : Array.isArray(response.answerText)
          ? response.answerText.join(", ")
          : "";
      const combined = [response.reasoning, answerText]
        .filter(Boolean)
        .join(" • ");
      const reasoning = (combined || "Answer applied.").slice(0, 500);
      this.button.title = reasoning;
    }
  }

  /**
   * Reset the assistant to its idle state.
   * @returns The current state of the assistant button.
   */
  reset(): void {
    this.updateState("idle");
  }

  /**
   * Attach the assistant button to the question element.
   */
  private attach(): void {
    ensureStyles();
    this.question.classList.add("qa-question");
    this.question.prepend(this.button);
  }

  /**
   * Create the assistant button element.
   * @returns The assistant button element.
   */
  private createButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "qa-button qa-state-idle";
    button.title = "Ask GPT to suggest an answer";
    button.setAttribute("aria-label", "Ask GPT to suggest an answer");
    button.style.backgroundImage = `url(${getIconForState("idle")})`;
    button.addEventListener("click", () => {
      if (this.state === "loading") return;
      if (this.state !== "success") {
        this.onRequestSolve(this);
        return;
      }

      const confirmed = window.confirm(
        "This question already has a GPT-applied answer. Send for another attempt?"
      );
      if (!confirmed) return;

      this.onRequestSolve(this);
    });

    return button;
  }

  /**
   * Update the state of the assistant button.
   * @param next - The next state of the assistant button.
   */
  private updateState(next: AssistantState): void {
    if (this.state === next) return;
    this.state = next;
    this.button.classList.remove(
      "qa-state-idle",
      "qa-state-loading",
      "qa-state-success",
      "qa-state-error",
      "qa-state-timeout"
    );
    this.button.classList.add(`qa-state-${next}`);
    this.button.title = getTitleForState(next);
    this.button.style.backgroundImage = `url(${getIconForState(next)})`;
    this.button.disabled = next === "loading";
  }
}

/**
 * Inject shared styles once per document to support assistant UI.
 */
function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .qa-question {
      position: relative;
    }

    .qa-button {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: center center / contain no-repeat rgba(0, 0, 0, 0.08);
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      z-index: 10;
    }

    .qa-button:hover:not(:disabled) {
      transform: scale(1.08);
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    }

    .qa-button:disabled {
      cursor: progress;
      opacity: 0.85;
    }

    .qa-state-loading {
      animation: qa-spin 1s linear infinite;
    }

    @keyframes qa-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Resolve the icon URL for a given assistant state.
 * @param state - The state of the assistant button.
 * @returns The icon URL for the assistant state.
 */
function getIconForState(state: AssistantState): string {
  if (state === "idle") return chrome.runtime.getURL(IDLE_ICON_FILE);

  const asset = STATE_ICON_FILES[state];
  if (asset) return chrome.runtime.getURL(asset);

  console.warn(
    `Failed to resolve icon for unknown assistant state: ${state}, using idle icon.`
  );
  return chrome.runtime.getURL(IDLE_ICON_FILE);
}

/**
 * Generate an accessible tooltip for the assistant state.
 * @param state - The state of the assistant button.
 * @returns The tooltip text for the assistant state.
 */
function getTitleForState(state: AssistantState): string {
  switch (state) {
    case "idle":
      return "Ask GPT to suggest an answer";
    case "loading":
      return "Processing question with GPT...";
    case "success":
      return "GPT suggestion applied successfully.";
    case "timeout":
      return "GPT request timed out.";
    default:
      console.warn(
        `Failed to resolve tooltip for unknown assistant state: ${state}, using default tooltip.`
      );
      return `GPT was unable to answer this question (${state}).`;
  }
}
