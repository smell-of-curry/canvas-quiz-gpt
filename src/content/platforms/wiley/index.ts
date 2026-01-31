import type {
  ChoiceKind,
  ParsedChoice,
  ParsedQuestion,
  PlatformAdapter,
  QuestionCallback,
} from "../types.js";

/**
 * Wiley Education / WileyPLUS platform adapter.
 * Handles quiz detection and parsing for Wiley assessment player.
 */
export class WileyPlatformAdapter implements PlatformAdapter {
  readonly id = "wiley";
  readonly name = "WileyPLUS";

  /**
   * Determine whether the current page appears to be a Wiley assessment view.
   */
  isQuizPage(): boolean {
    const url = window.location.href;
    
    // Check URL patterns for Wiley assessment player
    const isWileyAssessment = 
      /education\.wiley\.com/i.test(url) ||
      /wileyplus\.com/i.test(url);
    
    console.log("[QuizGPT] Wiley isQuizPage check:", { url, isWileyAssessment });
    
    if (!isWileyAssessment) return false;

    // Check if we have quiz-like content
    const hasQuizContent = this.findQuestionContainers().length > 0;
    console.log("[QuizGPT] Wiley hasQuizContent:", hasQuizContent);
    
    return hasQuizContent;
  }

  /**
   * Find question containers on the page.
   * Wiley has different formats: "Part X" style or single questions with a), b), c) sub-parts.
   */
  private findQuestionContainers(): HTMLElement[] {
    const containers: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();
    
    // Strategy 1: Look for "Part X" headers (multi-part questions)
    const allElements = document.querySelectorAll<HTMLElement>('*');
    
    for (const el of allElements) {
      const directText = this.getDirectTextContent(el);
      if (!/^Part\s+\d+$/i.test(directText)) continue;
      
      let container = el.parentElement;
      while (container) {
        const hasInputs = container.querySelector('input[type="radio"], input[type="checkbox"], input[type="text"], textarea, select');
        
        if (hasInputs && container.offsetHeight > 100) {
          let dominated = false;
          for (const existing of containers) {
            if (existing === container || existing.contains(container) || container.contains(existing)) {
              dominated = true;
              break;
            }
          }
          
          if (!dominated && !seen.has(container)) {
            seen.add(container);
            containers.push(container);
          }
          break;
        }
        
        container = container.parentElement;
      }
    }

    // Strategy 2: If no "Part X" containers found, look for the main question container
    // This handles questions with a), b), c) format or single-input questions
    if (containers.length === 0) {
      // Find all inputs on the page
      const inputs = document.querySelectorAll<HTMLElement>(
        'input[type="radio"], input[type="checkbox"], input[type="text"], input[type="number"], textarea, select'
      );
      
      if (inputs.length > 0) {
        // Find the common ancestor that contains all/most inputs
        // Start with the first input and go up to find a good container
        const firstInput = inputs[0];
        let candidate = firstInput.parentElement;
        
        while (candidate && candidate !== document.body) {
          const inputCount = candidate.querySelectorAll(
            'input[type="radio"], input[type="checkbox"], input[type="text"], input[type="number"], textarea, select'
          ).length;
          
          // Good candidate: contains multiple inputs, has reasonable size, has question-like content
          const hasQuestionText = candidate.textContent?.length ?? 0 > 50;
          const isReasonableSize = candidate.offsetHeight > 150 && candidate.offsetWidth > 300;
          
          if (inputCount >= inputs.length && isReasonableSize && hasQuestionText) {
            // Check it's not the entire page
            if (candidate.id !== "root" && !candidate.matches("body, html")) {
              // Found a good container
              if (!seen.has(candidate)) {
                seen.add(candidate);
                containers.push(candidate);
                console.log("[QuizGPT] Wiley found main question container with", inputCount, "inputs");
              }
              break;
            }
          }
          
          candidate = candidate.parentElement;
        }
      }
    }

    console.log("[QuizGPT] Wiley found containers:", containers.length);
    return containers;
  }

  /**
   * Get only the direct text content of an element (not from children).
   */
  private getDirectTextContent(el: HTMLElement): string {
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return text.trim();
  }

  /**
   * Observe the DOM for quiz questions and execute the callback on new elements.
   */
  observeQuestions(callback: QuestionCallback): () => void {
    const processed = new WeakSet<HTMLElement>();

    const collect = () => {
      const containers = this.findQuestionContainers();
      console.log("[QuizGPT] Wiley collect running, containers:", containers.length, 
                  containers.map(c => ({ 
                    hasButton: !!c.querySelector('.qa-button'),
                    inDOM: document.body.contains(c),
                    id: c.id || c.className?.slice(0, 50)
                  })));
      
      containers.forEach((container, index) => {
        // Check for existing button
        const existingButton = container.querySelector('.qa-button') as HTMLElement | null;
        if (existingButton) {
          // Generate a simple hash of the current question content to detect changes
          const currentContentHash = this.hashQuestionContent(container);
          const storedHash = existingButton.dataset.questionHash;
          
          // If the question content changed, the button is stale - remove it
          if (storedHash && storedHash !== currentContentHash) {
            console.log("[QuizGPT] Wiley question content changed, removing stale button:", index, {
              oldHash: storedHash,
              newHash: currentContentHash
            });
            existingButton.remove();
            // Also remove from processed so we fully re-process
            // (WeakSet doesn't have delete, but the button removal means we'll re-add)
          } else {
            // Button exists for the same question - verify it's visible
            const rect = existingButton.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0 && 
                             document.body.contains(existingButton);
            
            if (isVisible) {
              console.log("[QuizGPT] Wiley container already has visible button for same question, skipping:", index);
              return;
            }
            
            // Button exists but is not visible/usable - remove it so we can re-add
            console.log("[QuizGPT] Wiley found hidden/detached button, removing and re-processing:", index);
            existingButton.remove();
          }
        }
        
        // If previously processed but button is gone/removed, allow re-processing
        if (processed.has(container)) {
          console.log("[QuizGPT] Wiley container was processed but needs new button:", index);
        }
        
        // Skip locked/disabled parts - check for the specific "locked" message
        const containerText = container.textContent ?? "";
        const isLocked = containerText.includes("must be completed in order") &&
                        !container.querySelector('input[type="radio"], input[type="checkbox"]');
        if (isLocked) {
          console.log("[QuizGPT] Wiley skipping locked part:", index);
          return;
        }

        // Make sure this container actually has interactable inputs
        const hasActiveInputs = container.querySelector(
          'input[type="radio"]:not(:disabled), input[type="checkbox"]:not(:disabled), ' +
          'input[type="text"]:not(:disabled), textarea:not(:disabled), select:not(:disabled)'
        );
        if (!hasActiveInputs) {
          console.log("[QuizGPT] Wiley skipping part with no active inputs:", index);
          return;
        }

        console.log("[QuizGPT] Wiley processing container:", index, {
          hasButton: !!container.querySelector('.qa-button'),
          inDOM: document.body.contains(container),
          visible: container.offsetHeight > 0
        });
        processed.add(container);
        callback(container, index);
      });
    };

    // Initial collection with delay for SPA render
    setTimeout(collect, 800);

    // Watch for DOM changes (debounced) - longer delay to let Wiley finish rendering
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(collect, 500);
    });

    const root = document.getElementById("root") ?? document.body;
    observer.observe(root, { 
      childList: true, 
      subtree: true,
    });

    // Watch for URL changes (SPA navigation)
    let lastUrl = window.location.href;
    const urlWatcher = setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log("[QuizGPT] Wiley URL changed, re-collecting");
        setTimeout(collect, 800);
      }
    }, 500);

    return () => {
      observer.disconnect();
      clearInterval(urlWatcher);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }

  /**
   * Parse a Wiley quiz question element into a structured format.
   */
  parseQuestion(element: HTMLElement, fallbackIndex: number): ParsedQuestion {
    const id = this.deriveQuestionId(element, fallbackIndex);
    const number = this.extractQuestionNumber();
    const text = this.extractQuestionText(element);
    const html = element.innerHTML;
    const choices = this.extractChoices(element);

    console.log("[QuizGPT] Wiley parsed question:", { id, choicesCount: choices.length });

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
    // Try the back button area which often has the title
    const backArea = document.querySelector<HTMLElement>('[class*="back"], [class*="Back"], header');
    if (backArea) {
      const text = backArea.textContent?.trim();
      if (text && text.length > 3 && text.length < 100) {
        return text;
      }
    }

    // Try page title
    const pageTitle = document.title;
    if (pageTitle && !pageTitle.toLowerCase().includes("assessment")) {
      return pageTitle;
    }

    // Look for section headers like "Section 2.1 - 2.4 Homework"
    const headers = document.querySelectorAll<HTMLElement>('h1, h2, [class*="title"], [class*="Title"]');
    for (const header of headers) {
      const text = header.textContent?.trim();
      if (text && /section|homework|quiz|exam|test/i.test(text)) {
        return text;
      }
    }

    return undefined;
  }

  /**
   * Get Wiley-specific context for the GPT prompt.
   */
  getPlatformContext(): string | undefined {
    return "WileyPLUS Assessment";
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private helper methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Generate a simple hash of question content to detect when the question changes.
   * Uses the first ~200 chars of text content (excluding button text) as a fingerprint.
   */
  private hashQuestionContent(container: HTMLElement): string {
    // Clone to avoid modifying original
    const clone = container.cloneNode(true) as HTMLElement;
    
    // Remove our button from the clone so it doesn't affect the hash
    clone.querySelectorAll('.qa-button').forEach(el => el.remove());
    
    // Get text content, normalize whitespace, and take first portion
    const text = (clone.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return hash.toString(36);
  }

  /**
   * Check if an element is actually visible on the page.
   * Filters out elements that are hidden, have zero dimensions, or are off-screen.
   */
  private isElementVisible(element: HTMLElement): boolean {
    // Check if element is connected to DOM
    if (!document.body.contains(element)) return false;
    
    // Check computed style for visibility
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    
    // Check bounding rect for actual dimensions
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    
    // Check if element is within reasonable viewport bounds
    // Allow some buffer for elements just outside viewport
    const buffer = 100;
    const inViewport = (
      rect.top < window.innerHeight + buffer &&
      rect.bottom > -buffer &&
      rect.left < window.innerWidth + buffer &&
      rect.right > -buffer
    );
    
    return inViewport;
  }

  /**
   * Generate a question ID.
   */
  private deriveQuestionId(element: HTMLElement, fallbackIndex: number): string {
    // Check for part number in the element
    const partMatch = element.textContent?.match(/Part\s+(\d+)/i);
    if (partMatch) {
      const questionNum = this.extractQuestionNumber() ?? fallbackIndex;
      return `wiley-q${questionNum}-part${partMatch[1]}`;
    }

    // Try to get question number from URL hash
    const hashMatch = window.location.hash.match(/question\/(\d+)/i);
    if (hashMatch) {
      return `wiley-question-${hashMatch[1]}-${fallbackIndex}`;
    }
    
    return `wiley-question-${fallbackIndex}`;
  }

  /**
   * Extract question number from the page.
   */
  private extractQuestionNumber(): number | undefined {
    // Look for "Question X of Y" pattern
    const pageText = document.body.textContent ?? "";
    const match = pageText.match(/Question\s+(\d+)\s+of\s+\d+/i);
    if (match) {
      return parseInt(match[1], 10);
    }

    // Try URL hash
    const hashMatch = window.location.hash.match(/question\/(\d+)/i);
    if (hashMatch) {
      return parseInt(hashMatch[1], 10);
    }

    return undefined;
  }

  /**
   * Extract the question text from the element.
   */
  private extractQuestionText(element: HTMLElement): string {
    // Clone to avoid modifying the original
    const clone = element.cloneNode(true) as HTMLElement;
    
    // Remove input fields and buttons from the clone
    const toRemove = clone.querySelectorAll("input, button, textarea, select");
    toRemove.forEach(el => el.remove());

    // Get text content
    let text = clone.textContent ?? "";
    
    // Clean up whitespace
    text = text.replace(/\s+/g, " ").trim();

    return text.slice(0, 2000); // Limit length
  }

  /**
   * Extract answer choices/inputs from the element.
   */
  private extractChoices(element: HTMLElement): ParsedChoice[] {
    const choices: ParsedChoice[] = [];

    // Find all radio buttons (only visible ones)
    const radios = Array.from(element.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .filter(el => this.isElementVisible(el));
    console.log("[QuizGPT] Wiley found radios:", radios.length);
    
    radios.forEach((radio, index) => {
      const label = this.findLabelForRadioOrCheckbox(radio, index);
      choices.push({
        id: radio.id || radio.value || `radio-${index + 1}`,
        label: label || radio.value || `Option ${index + 1}`,
        element: radio,
        kind: "single",
        value: radio.value || undefined,
      });
    });

    // Find all checkboxes (only visible ones)
    const checkboxes = Array.from(element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .filter(el => this.isElementVisible(el));
    checkboxes.forEach((checkbox, index) => {
      const label = this.findLabelForRadioOrCheckbox(checkbox, index);
      choices.push({
        id: checkbox.id || checkbox.value || `checkbox-${index + 1}`,
        label: label || checkbox.value || `Option ${index + 1}`,
        element: checkbox,
        kind: "multi",
        value: checkbox.value || undefined,
      });
    });

    // Find all text inputs (Wiley often wraps these in special containers) - only visible ones
    const textInputs = Array.from(element.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="number"], input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([type="submit"]):not([type="button"])'
    )).filter(el => this.isElementVisible(el));
    console.log("[QuizGPT] Wiley found text inputs:", textInputs.length);
    
    let visibleTextIndex = 0;
    textInputs.forEach((input) => {
      // Skip if it's a radio or checkbox
      if (input.type === "radio" || input.type === "checkbox" || input.type === "hidden") return;
      
      const { label, partLetter } = this.findLabelAndPartForTextInput(input, element, visibleTextIndex);
      
      // Create a meaningful ID: prefer actual id/name, then part-based, then index-based
      const partId = partLetter ? `part-${partLetter}` : `part-${String.fromCharCode(97 + visibleTextIndex)}`;
      const inputId = input.id || input.name || partId;
      
      choices.push({
        id: inputId,
        label: label || `Answer ${visibleTextIndex + 1}`,
        element: input,
        kind: "text",
        value: input.value || undefined,
      });
      visibleTextIndex++;
    });

    // Find all textareas (only visible ones)
    const textareas = Array.from(element.querySelectorAll<HTMLTextAreaElement>("textarea"))
      .filter(el => this.isElementVisible(el));
    textareas.forEach((textarea, index) => {
      const { label, partLetter } = this.findLabelAndPartForTextInput(textarea, element, index);
      const partId = partLetter ? `part-${partLetter}` : `part-${String.fromCharCode(97 + index)}`;
      choices.push({
        id: textarea.id || textarea.name || partId,
        label: label || `Text area ${index + 1}`,
        element: textarea,
        kind: "text",
        value: textarea.value || undefined,
      });
    });

    // Find all select/dropdown elements (only visible ones)
    const selects = Array.from(element.querySelectorAll<HTMLSelectElement>("select"))
      .filter(el => this.isElementVisible(el));
    console.log("[QuizGPT] Wiley found selects:", selects.length);
    
    selects.forEach((select, selectIndex) => {
      const { label: selectLabel } = this.findLabelAndPartForTextInput(select, element, selectIndex);
      const options = Array.from(select.options);
      
      options.forEach((option) => {
        const val = option.value?.trim();
        const text = option.textContent?.trim();
        // Skip empty/placeholder options
        if (!val || val === "" || text === "" || text?.toLowerCase() === "select" || text?.includes("--")) return;
        
        choices.push({
          id: `${select.id || select.name || `select-${selectIndex + 1}`}::${val}`,
          label: `${selectLabel || `Question ${String.fromCharCode(97 + selectIndex)})`}: ${text || val}`,
          element: select,
          kind: "select",
          value: val,
        });
      });
    });

    console.log("[QuizGPT] Wiley total choices:", choices.length);
    return choices;
  }

  /**
   * Find label and part letter for a text input by looking at surrounding context.
   * Wiley uses patterns like "a) question text... [input]"
   */
  private findLabelAndPartForTextInput(
    input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    container: HTMLElement,
    index: number
  ): { label: string; partLetter: string | undefined } {
    const fallbackLetter = String.fromCharCode(97 + index); // a, b, c, ...
    
    // Strategy 1: Look for text immediately before the input in the DOM tree
    // Walk backwards through siblings and parent's content to find the question text
    let textBefore = this.getTextBeforeElement(input, container);
    
    // Look for part patterns like "a)", "b)", "(a)", "1)", etc.
    const partMatch = textBefore.match(/[(\s]?([a-z])\s*\)|^\s*([a-z])\s*\)/im);
    const partLetter = partMatch ? (partMatch[1] || partMatch[2])?.toLowerCase() : undefined;
    
    // Try to extract a meaningful question segment
    // Look for the last sentence or phrase that contains the part letter
    if (partLetter) {
      // Find text starting from the part marker
      const partPattern = new RegExp(`[(\s]?${partLetter}\\s*\\)(.{10,500}?)(?:\\?|$)`, 'i');
      const questionMatch = textBefore.match(partPattern);
      if (questionMatch) {
        const questionText = `${partLetter}) ${questionMatch[1].trim()}`.slice(0, 300);
        return { label: questionText, partLetter };
      }
    }
    
    // Strategy 2: Check parent containers for question text
    let searchContainer = input.parentElement;
    let attempts = 0;
    
    while (searchContainer && searchContainer !== container && attempts < 5) {
      const text = (searchContainer.textContent ?? "").replace(/\s+/g, " ").trim();
      
      // Look for patterns like "a) ...", "b) ...", "1) ...", "(a) ..."
      const match = text.match(/[(\s]?([a-z])\s*\)\s*(.{10,400}?)(?:\?|:|$)/i);
      if (match) {
        const letter = match[1].toLowerCase();
        const questionText = `${letter}) ${match[2].trim()}`.slice(0, 300);
        return { label: questionText, partLetter: letter };
      }
      
      searchContainer = searchContainer.parentElement;
      attempts++;
    }
    
    // Strategy 3: Previous sibling text
    const prevSibling = input.parentElement?.previousElementSibling;
    if (prevSibling instanceof HTMLElement) {
      const sibText = (prevSibling.textContent ?? "").replace(/\s+/g, " ").trim();
      const match = sibText.match(/[(\s]?([a-z])\s*\)\s*(.{10,400}?)(?:\?|:|$)/i);
      if (match) {
        const letter = match[1].toLowerCase();
        const questionText = `${letter}) ${match[2].trim()}`.slice(0, 300);
        return { label: questionText, partLetter: letter };
      }
      if (sibText.length > 10 && sibText.length < 300) {
        return { label: sibText, partLetter: undefined };
      }
    }
    
    // Fallback: use generic label with letter
    return { 
      label: `Answer for part ${fallbackLetter})`, 
      partLetter: fallbackLetter 
    };
  }

  /**
   * Get text content that appears before a given element within a container.
   */
  private getTextBeforeElement(element: HTMLElement, container: HTMLElement): string {
    const texts: string[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    
    let node: Node | null;
    while ((node = walker.nextNode())) {
      // Stop when we reach or pass the target element
      if (element.contains(node) || 
          (node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING)) {
        break;
      }
      const text = node.textContent?.trim();
      if (text) texts.push(text);
    }
    
    // Return the last ~1000 chars of accumulated text
    return texts.join(" ").slice(-1000);
  }

  /**
   * Find label for a radio button or checkbox.
   */
  private findLabelForRadioOrCheckbox(
    input: HTMLInputElement,
    index: number
  ): string | undefined {
    // Check for wrapping label
    const parentLabel = input.closest("label");
    if (parentLabel) {
      // Get text content excluding the input itself
      const clone = parentLabel.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("input").forEach(el => el.remove());
      const text = clone.textContent?.trim();
      if (text) return text;
    }

    // Check for label with for attribute
    if (input.id) {
      const label = document.querySelector<HTMLElement>(`label[for="${input.id}"]`);
      if (label?.textContent?.trim()) {
        return label.textContent.trim();
      }
    }

    // Check sibling elements (common pattern: radio followed by text)
    let sibling = input.nextElementSibling;
    while (sibling) {
      if (sibling instanceof HTMLElement && sibling.tagName !== "INPUT") {
        const text = sibling.textContent?.trim();
        if (text && text.length < 200) return text;
      }
      sibling = sibling.nextElementSibling;
    }

    // Check parent's text content after the input
    const parent = input.parentElement;
    if (parent) {
      const nodes = Array.from(parent.childNodes);
      const inputIndex = nodes.indexOf(input);
      for (let i = inputIndex + 1; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent?.trim();
          if (text) return text;
        }
        if (node instanceof HTMLElement && node.tagName !== "INPUT") {
          const text = node.textContent?.trim();
          if (text && text.length < 200) return text;
        }
      }
    }

    // Use the value as fallback
    if (input.value) return input.value;

    return undefined;
  }


  /**
   * Determine the question type based on available choices.
   */
  private determineQuestionType(choices: ParsedChoice[]): ParsedQuestion["type"] {
    if (choices.length === 0) return "unknown";

    const kinds = new Set(choices.map(c => c.kind));
    
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
