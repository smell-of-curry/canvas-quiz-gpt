import type {
  ChoiceKind,
  ParsedChoice,
  ParsedQuestion,
  PlatformAdapter,
  QuestionCallback,
} from "../types.js";

/**
 * McGraw Hill Education / Connect platform adapter.
 * Handles quiz detection and parsing for McGraw Hill learning platform.
 */
export class McGrawHillPlatformAdapter implements PlatformAdapter {
  readonly id = "mcgrawhill";
  readonly name = "McGraw Hill Connect";

  /**
   * Determine whether the current page appears to be a McGraw Hill assessment view.
   */
  isQuizPage(): boolean {
    const url = window.location.href;

    // Check URL patterns for McGraw Hill assessment player
    const isMcGrawHill = /learning\.mheducation\.com/i.test(url);

    console.log("[QuizGPT] McGrawHill isQuizPage check:", { url, isMcGrawHill });

    if (!isMcGrawHill) return false;

    // Check if we have quiz-like content
    const hasQuizContent = this.findQuestionContainers().length > 0;
    console.log("[QuizGPT] McGrawHill hasQuizContent:", hasQuizContent);

    return hasQuizContent;
  }

  /**
   * Find question containers on the page.
   * McGraw Hill uses Angular components like avalon-probe-renderer and aa-air-item.
   * We prefer aa-air-item as it's the innermost question container.
   */
  private findQuestionContainers(): HTMLElement[] {
    const containers: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();

    // Strategy 1: Look for aa-air-item first (the innermost question container)
    const airItems = document.querySelectorAll<HTMLElement>("aa-air-item");

    for (const item of airItems) {
      if (seen.has(item) || !this.isElementVisible(item)) continue;

      // Check for standard inputs OR sortable/ordering questions
      const hasInputs = item.querySelector(
        'input[type="radio"], input[type="checkbox"], input[type="text"], textarea, select'
      );
      const hasSortable = item.querySelector('.sortable-component, [data-react-beautiful-dnd-draggable]');

      if (!hasInputs && !hasSortable) continue;

      seen.add(item);
      containers.push(item);
    }

    // Strategy 2: If no aa-air-item found, look for avalon-probe-renderer
    if (containers.length === 0) {
      const probeRenderers = document.querySelectorAll<HTMLElement>(
        "avalon-probe-renderer"
      );

      for (const renderer of probeRenderers) {
        if (seen.has(renderer) || !this.isElementVisible(renderer)) continue;

        const hasInputs = renderer.querySelector(
          'input[type="radio"], input[type="checkbox"], input[type="text"], textarea, select'
        );
        const hasSortable = renderer.querySelector('.sortable-component, [data-react-beautiful-dnd-draggable]');

        if (!hasInputs && !hasSortable) continue;

        seen.add(renderer);
        containers.push(renderer);
      }
    }

    // Strategy 3: Fallback - look for .multiple-choice-component, .sortable-component, or .dlc_question containers
    if (containers.length === 0) {
      const questionContainers = document.querySelectorAll<HTMLElement>(
        ".multiple-choice-component, .sortable-component, .dlc_question, .air-item"
      );

      for (const container of questionContainers) {
        if (seen.has(container) || !this.isElementVisible(container)) continue;

        const hasInputs = container.querySelector(
          'input[type="radio"], input[type="checkbox"], input[type="text"], textarea, select'
        );
        const hasSortable = container.querySelector('.sortable-component, [data-react-beautiful-dnd-draggable]');

        if (!hasInputs && !hasSortable) continue;

        // Avoid nested containers
        let dominated = false;
        for (const existing of containers) {
          if (existing.contains(container) || container.contains(existing)) {
            dominated = true;
            break;
          }
        }

        if (!dominated) {
          seen.add(container);
          containers.push(container);
        }
      }
    }

    console.log("[QuizGPT] McGrawHill found containers:", containers.length);
    return containers;
  }

  /**
   * Observe the DOM for quiz questions and execute the callback on new elements.
   */
  observeQuestions(callback: QuestionCallback): () => void {
    const processed = new WeakSet<HTMLElement>();

    const collect = () => {
      const containers = this.findQuestionContainers();
      console.log(
        "[QuizGPT] McGrawHill collect running, containers:",
        containers.length,
        containers.map((c) => ({
          hasButton: !!c.querySelector(".qa-button"),
          inDOM: document.body.contains(c),
          tagName: c.tagName,
        }))
      );

      containers.forEach((container, index) => {
        // Check for existing button
        const existingButton = container.querySelector(
          ".qa-button"
        ) as HTMLElement | null;
        if (existingButton) {
          // Generate a simple hash of the current question content to detect changes
          const currentContentHash = this.hashQuestionContent(container);
          const storedHash = existingButton.dataset.questionHash;

          // If the question content changed, the button is stale - remove it
          if (storedHash && storedHash !== currentContentHash) {
            console.log(
              "[QuizGPT] McGrawHill question content changed, removing stale button:",
              index,
              { oldHash: storedHash, newHash: currentContentHash }
            );
            existingButton.remove();
          } else {
            // Button exists for the same question - verify it's visible
            const rect = existingButton.getBoundingClientRect();
            const isVisible =
              rect.width > 0 &&
              rect.height > 0 &&
              document.body.contains(existingButton);

            if (isVisible) {
              console.log(
                "[QuizGPT] McGrawHill container already has visible button for same question, skipping:",
                index
              );
              return;
            }

            // Button exists but is not visible/usable - remove it so we can re-add
            console.log(
              "[QuizGPT] McGrawHill found hidden/detached button, removing and re-processing:",
              index
            );
            existingButton.remove();
          }
        }

        // If previously processed but button is gone/removed, allow re-processing
        if (processed.has(container)) {
          console.log(
            "[QuizGPT] McGrawHill container was processed but needs new button:",
            index
          );
        }

        // Make sure this container actually has interactable elements (inputs or sortable items)
        const hasActiveInputs = container.querySelector(
          'input[type="radio"]:not(:disabled), input[type="checkbox"]:not(:disabled), ' +
          'input[type="text"]:not(:disabled), textarea:not(:disabled), select:not(:disabled)'
        );
        const hasSortableItems = container.querySelector(
          '.sortable-component .choice-item, [data-react-beautiful-dnd-draggable]'
        );
        if (!hasActiveInputs && !hasSortableItems) {
          console.log(
            "[QuizGPT] McGrawHill skipping container with no active inputs or sortable items:",
            index
          );
          return;
        }

        console.log("[QuizGPT] McGrawHill processing container:", index, {
          hasButton: !!container.querySelector(".qa-button"),
          inDOM: document.body.contains(container),
          visible: container.offsetHeight > 0,
        });
        processed.add(container);
        callback(container, index);
      });
    };

    // Initial collection with delay for SPA render
    setTimeout(collect, 800);

    // Watch for DOM changes (debounced) - longer delay to let Angular finish rendering
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver((mutations) => {
      // Check if any mutation is relevant to question content
      const isRelevant = mutations.some((mutation) => {
        // Check for added/removed nodes that might be question containers
        if (mutation.type === "childList") {
          const hasRelevantNodes = [...mutation.addedNodes, ...mutation.removedNodes].some(
            (node) =>
              node instanceof HTMLElement &&
              (node.tagName === "AA-AIR-ITEM" ||
                node.tagName === "AVALON-PROBE-RENDERER" ||
                node.querySelector?.("aa-air-item, avalon-probe-renderer, .choice-row"))
          );
          if (hasRelevantNodes) return true;
        }
        // Check for attribute changes on probe elements (Angular uses these)
        if (mutation.type === "attributes") {
          const target = mutation.target as HTMLElement;
          if (
            target.tagName === "AA-AIR-ITEM" ||
            target.tagName === "AVALON-PROBE-RENDERER" ||
            target.closest?.("aa-air-item, avalon-probe-renderer")
          ) {
            return true;
          }
        }
        return false;
      });

      if (isRelevant || mutations.length > 5) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(collect, 300);
      }
    });

    // Watch multiple potential root elements for Angular changes
    const roots = [
      document.querySelector(".main__probe"),
      document.querySelector("awd-probe-navigation"),
      document.querySelector(".content__main"),
      document.querySelector(".root__content"),
      document.getElementById("root"),
      document.body,
    ].filter(Boolean) as HTMLElement[];

    const root = roots[0] ?? document.body;
    console.log("[QuizGPT] McGrawHill observing root:", root.tagName, root.className);

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-probe-id"],
    });

    // Watch for URL changes (SPA navigation)
    let lastUrl = window.location.href;
    const urlWatcher = setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log("[QuizGPT] McGrawHill URL changed, re-collecting");
        setTimeout(collect, 800);
      }
    }, 500);

    // Periodic check as fallback - Angular sometimes doesn't trigger mutations we catch
    // Check every 2 seconds if there's no button but there should be
    const periodicChecker = setInterval(() => {
      const containers = this.findQuestionContainers();
      const needsButton = containers.some(
        (c) => !c.querySelector(".qa-button") && (
          c.querySelector('input[type="radio"], input[type="checkbox"]') ||
          c.querySelector('.sortable-component .choice-item, [data-react-beautiful-dnd-draggable]')
        )
      );
      if (needsButton) {
        console.log("[QuizGPT] McGrawHill periodic check found container without button");
        collect();
      }
    }, 2000);

    return () => {
      observer.disconnect();
      clearInterval(urlWatcher);
      clearInterval(periodicChecker);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }

  /**
   * Parse a McGraw Hill quiz question element into a structured format.
   */
  parseQuestion(element: HTMLElement, fallbackIndex: number): ParsedQuestion {
    const id = this.deriveQuestionId(element, fallbackIndex);
    const number = this.extractQuestionNumber();
    const text = this.extractQuestionText(element);
    const html = element.innerHTML;
    const choices = this.extractChoices(element);

    console.log("[QuizGPT] McGrawHill parsed question:", {
      id,
      choicesCount: choices.length,
    });

    // Determine question type based on what we find
    const type = this.determineQuestionType(choices);

    return {
      id,
      element,
      type,
      text,
      html,
      number,
      choices,
    };
  }

  /**
   * Attempt to extract the quiz/assignment title for additional prompt context.
   */
  getQuizTitle(): string | undefined {
    // Try the progress widget area
    const progressWidget = document.querySelector<HTMLElement>(
      "awd-progress-widget"
    );
    if (progressWidget) {
      const conceptsText = progressWidget.querySelector(".pw__concepts-count");
      if (conceptsText?.textContent) {
        return `Assignment Progress: ${conceptsText.textContent}`;
      }
    }

    // Try page title
    const pageTitle = document.title;
    if (pageTitle && pageTitle.length > 3) {
      return pageTitle;
    }

    // Look for headers
    const headers = document.querySelectorAll<HTMLElement>(
      ".probe-header, h1, h2"
    );
    for (const header of headers) {
      const text = header.textContent?.trim();
      if (text && text.length > 3 && text.length < 100) {
        return text;
      }
    }

    return undefined;
  }

  /**
   * Get McGraw Hill-specific context for the GPT prompt.
   */
  getPlatformContext(): string | undefined {
    // Try to get the question type from the header
    const header = document.querySelector<HTMLElement>(".probe-header");
    const questionType = header?.textContent?.trim();

    if (questionType) {
      return `McGraw Hill Connect - ${questionType}`;
    }

    return "McGraw Hill Connect Assessment";
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private helper methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Generate a simple hash of question content to detect when the question changes.
   */
  private hashQuestionContent(container: HTMLElement): string {
    // Clone to avoid modifying original
    const clone = container.cloneNode(true) as HTMLElement;

    // Remove our button from the clone so it doesn't affect the hash
    clone.querySelectorAll(".qa-button").forEach((el) => el.remove());

    // Get text content, normalize whitespace, and take first portion
    const text = (clone.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }

    return hash.toString(36);
  }

  /**
   * Check if an element is actually visible on the page.
   */
  private isElementVisible(element: HTMLElement): boolean {
    // Check if element is connected to DOM
    if (!document.body.contains(element)) return false;

    // Check computed style for visibility
    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }

    // Check bounding rect for actual dimensions
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    // Check if element is within reasonable viewport bounds
    const buffer = 100;
    const inViewport =
      rect.top < window.innerHeight + buffer &&
      rect.bottom > -buffer &&
      rect.left < window.innerWidth + buffer &&
      rect.right > -buffer;

    return inViewport;
  }

  /**
   * Generate a question ID.
   */
  private deriveQuestionId(
    element: HTMLElement,
    fallbackIndex: number
  ): string {
    // Try to get probe ID from the element
    const probeId = element.closest("[data-probe-id]")?.getAttribute("data-probe-id");
    if (probeId) {
      return `mcgrawhill-${probeId}`;
    }

    // Try to get from prompt ID
    const promptEl = element.querySelector<HTMLElement>(".prompt[id]");
    if (promptEl?.id) {
      return `mcgrawhill-${promptEl.id}`;
    }

    // Try URL hash
    const hashMatch = window.location.hash.match(/_t=(\d+)/i);
    if (hashMatch) {
      return `mcgrawhill-${hashMatch[1]}-${fallbackIndex}`;
    }

    return `mcgrawhill-question-${fallbackIndex}`;
  }

  /**
   * Extract question number from the page.
   */
  private extractQuestionNumber(): number | undefined {
    // Look for "X of Y Concepts completed" pattern
    const conceptsText = document.querySelector(".pw__concepts-count");
    if (conceptsText?.textContent) {
      const match = conceptsText.textContent.match(/(\d+)\s+of\s+\d+/i);
      if (match) {
        // This is completed concepts, so current question is completed + 1
        return parseInt(match[1], 10) + 1;
      }
    }

    return undefined;
  }

  /**
   * Extract the question text from the element.
   */
  private extractQuestionText(element: HTMLElement): string {
    // Try to get from the prompt div first
    const promptEl = element.querySelector<HTMLElement>(".prompt");
    if (promptEl) {
      return this.cleanTextContent(promptEl);
    }

    // Try dlc_question
    const dlcQuestion = element.querySelector<HTMLElement>(".dlc_question");
    if (dlcQuestion) {
      return this.cleanTextContent(dlcQuestion);
    }

    // Fallback: clone and extract
    const clone = element.cloneNode(true) as HTMLElement;

    // Remove input fields, buttons, and response containers from the clone
    const toRemove = clone.querySelectorAll(
      "input, button, textarea, select, .responses-container"
    );
    toRemove.forEach((el) => el.remove());

    return this.cleanTextContent(clone);
  }

  /**
   * Clean text content by normalizing whitespace and removing excess.
   */
  private cleanTextContent(element: HTMLElement): string {
    let text = element.textContent ?? "";
    text = text.replace(/\s+/g, " ").trim();
    return text.slice(0, 2000);
  }

  /**
   * Extract answer choices/inputs from the element.
   */
  private extractChoices(element: HTMLElement): ParsedChoice[] {
    const choices: ParsedChoice[] = [];

    // Strategy 0: Check for sortable/ordering questions first
    const sortableItems = element.querySelectorAll<HTMLElement>(
      '.sortable-component .choice-item, [data-react-beautiful-dnd-draggable].choice-item'
    );
    if (sortableItems.length > 0) {
      console.log("[QuizGPT] McGrawHill found sortable items:", sortableItems.length);
      sortableItems.forEach((item, index) => {
        const contentEl = item.querySelector<HTMLElement>(".content");
        const label = contentEl?.textContent?.trim() ?? `Item ${index + 1}`;
        const itemId = item.id || item.getAttribute("data-index") || `sortable-${index + 1}`;

        choices.push({
          id: itemId,
          label,
          element: item,
          kind: "text", // Using "text" kind - will display order to user
          value: String(index + 1),
        });
      });

      if (choices.length > 0) {
        console.log("[QuizGPT] McGrawHill total sortable choices:", choices.length);
        return choices;
      }
    }

    // Strategy 1: Look for multiple choice options (most common)
    const choiceRows = element.querySelectorAll<HTMLElement>(".choice-row");
    console.log("[QuizGPT] McGrawHill found choice rows:", choiceRows.length);

    choiceRows.forEach((row, index) => {
      const radio = row.querySelector<HTMLInputElement>(
        'input[type="radio"]'
      );
      const checkbox = row.querySelector<HTMLInputElement>(
        'input[type="checkbox"]'
      );
      const input = radio ?? checkbox;

      if (!input || !this.isElementVisible(input)) return;

      // Get the choice label from .choiceText
      const choiceTextEl = row.querySelector<HTMLElement>(".choiceText");
      const label = choiceTextEl?.textContent?.trim() ?? `Option ${index + 1}`;

      // Get ID from aria-labelledby or generate one
      const labelledBy = input.getAttribute("aria-labelledby");
      const choiceId = input.id || labelledBy || `choice-${index + 1}`;

      choices.push({
        id: choiceId,
        label,
        element: input,
        kind: radio ? "single" : "multi",
        value: input.value || undefined,
      });
    });

    // If we found choices via choice-row, return early
    if (choices.length > 0) {
      console.log("[QuizGPT] McGrawHill total choices:", choices.length);
      return choices;
    }

    // Strategy 2: Fallback - look for raw radio/checkbox inputs
    const radios = Array.from(
      element.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    ).filter((el) => this.isElementVisible(el));

    radios.forEach((radio, index) => {
      const label = this.findLabelForInput(radio, index);
      choices.push({
        id: radio.id || radio.value || `radio-${index + 1}`,
        label: label || radio.value || `Option ${index + 1}`,
        element: radio,
        kind: "single",
        value: radio.value || undefined,
      });
    });

    const checkboxes = Array.from(
      element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    ).filter((el) => this.isElementVisible(el));

    checkboxes.forEach((checkbox, index) => {
      const label = this.findLabelForInput(checkbox, index);
      choices.push({
        id: checkbox.id || checkbox.value || `checkbox-${index + 1}`,
        label: label || checkbox.value || `Option ${index + 1}`,
        element: checkbox,
        kind: "multi",
        value: checkbox.value || undefined,
      });
    });

    // Strategy 3: Text inputs
    const textInputs = Array.from(
      element.querySelectorAll<HTMLInputElement>(
        'input[type="text"], input[type="number"], input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([type="submit"]):not([type="button"])'
      )
    ).filter((el) => this.isElementVisible(el));

    textInputs.forEach((input, index) => {
      if (
        input.type === "radio" ||
        input.type === "checkbox" ||
        input.type === "hidden"
      )
        return;

      const label = this.findLabelForInput(input, index);
      choices.push({
        id: input.id || input.name || `text-${index + 1}`,
        label: label || `Answer ${index + 1}`,
        element: input,
        kind: "text",
        value: input.value || undefined,
      });
    });

    // Strategy 4: Textareas
    const textareas = Array.from(
      element.querySelectorAll<HTMLTextAreaElement>("textarea")
    ).filter((el) => this.isElementVisible(el));

    textareas.forEach((textarea, index) => {
      const label = this.findLabelForInput(textarea, index);
      choices.push({
        id: textarea.id || textarea.name || `textarea-${index + 1}`,
        label: label || `Text area ${index + 1}`,
        element: textarea,
        kind: "text",
        value: textarea.value || undefined,
      });
    });

    // Strategy 5: Select dropdowns
    const selects = Array.from(
      element.querySelectorAll<HTMLSelectElement>("select")
    ).filter((el) => this.isElementVisible(el));

    selects.forEach((select, selectIndex) => {
      const selectLabel = this.findLabelForInput(select, selectIndex);
      const options = Array.from(select.options);

      options.forEach((option) => {
        const val = option.value?.trim();
        const text = option.textContent?.trim();
        // Skip empty/placeholder options
        if (
          !val ||
          val === "" ||
          text === "" ||
          text?.toLowerCase() === "select" ||
          text?.includes("--")
        )
          return;

        choices.push({
          id: `${select.id || select.name || `select-${selectIndex + 1}`}::${val}`,
          label: `${selectLabel || `Dropdown ${selectIndex + 1}`}: ${text || val}`,
          element: select,
          kind: "select",
          value: val,
        });
      });
    });

    console.log("[QuizGPT] McGrawHill total choices:", choices.length);
    return choices;
  }

  /**
   * Find label for an input element.
   */
  private findLabelForInput(
    input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    index: number
  ): string | undefined {
    // Check for wrapping label
    const parentLabel = input.closest("label");
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("input, select, textarea").forEach((el) => el.remove());
      const text = clone.textContent?.trim();
      if (text) return text;
    }

    // Check for label with for attribute
    if (input.id) {
      const label = document.querySelector<HTMLElement>(
        `label[for="${input.id}"]`
      );
      if (label?.textContent?.trim()) {
        return label.textContent.trim();
      }
    }

    // Check aria-labelledby
    const labelledBy = input.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl?.textContent?.trim()) {
        return labelEl.textContent.trim();
      }
    }

    // Check .choiceText sibling/ancestor
    const choiceContainer = input.closest(".choice, .choice-row, .form-check");
    if (choiceContainer) {
      const choiceText = choiceContainer.querySelector<HTMLElement>(".choiceText");
      if (choiceText?.textContent?.trim()) {
        return choiceText.textContent.trim();
      }
    }

    // Check sibling elements
    let sibling = input.nextElementSibling;
    while (sibling) {
      if (sibling instanceof HTMLElement && sibling.tagName !== "INPUT") {
        const text = sibling.textContent?.trim();
        if (text && text.length < 200) return text;
      }
      sibling = sibling.nextElementSibling;
    }

    // Use the value as fallback
    if ("value" in input && input.value) return input.value;

    return undefined;
  }

  /**
   * Determine the question type based on available choices.
   */
  private determineQuestionType(choices: ParsedChoice[]): ParsedQuestion["type"] {
    if (choices.length === 0) return "unknown";

    const kinds = new Set(choices.map((c) => c.kind));

    if (kinds.has("single") && !kinds.has("multi") && !kinds.has("text")) {
      return "single";
    }
    if (kinds.has("multi") && !kinds.has("single") && !kinds.has("text")) {
      return "multi";
    }
    if (kinds.has("select") && !kinds.has("single") && !kinds.has("multi")) {
      return "select";
    }
    if (kinds.has("text")) {
      return "text";
    }

    return "unknown";
  }
}
