/**
 * CSS selectors matching Canvas quiz question containers.
 */
const QUESTION_SELECTORS = [
  // "div.display_question",
  "div.question_holder",
  "li.quiz_question",
  //"div.question"
].join(",");

/**
 * Determine whether the current page appears to be a Canvas quiz view.
 * @returns
 */
export function isCanvasQuizPage(): boolean {
  const path = window.location.pathname ?? "";
  const matchesQuizPath = /quizzes/i.test(path);
  if (!matchesQuizPath) return false;

  return document.querySelector(QUESTION_SELECTORS) !== null;
}

/**
 * Callback invoked for each discovered question container.
 */
export type QuestionCallback = (element: HTMLElement, index: number) => void;

/**
 * Observe the DOM for quiz questions and execute the callback on new elements.
 * @param callback - The callback to execute on each discovered question container.
 * @returns A function to stop observing the DOM for quiz questions.
 */
export function observeQuestions(callback: QuestionCallback): () => void {
  const processed = new WeakSet<HTMLElement>();

  const collect = () => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(QUESTION_SELECTORS)
    ).filter((element) => element.matches("div, li"));
    if (candidates.length === 0) return;

    candidates.forEach((element, index) => {
      if (!isValidQuestionContainer(element)) return;
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
 * Determine whether a given element is a valid Canvas quiz question container.
 * @param element - The element to check.
 * @returns Whether the element is a valid Canvas quiz question container.
 */
function isValidQuestionContainer(element: HTMLElement): boolean {
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
