import html2canvas from "html2canvas";

const CAPTURE_MARKER_ATTRIBUTE = "data-cqa-capture-root";
const CAPTURE_MARKER_VALUE = "true";
const DEFAULT_PLACEHOLDER_SIZE = 48;

/**
 * Capture a PNG data URL representation of a Canvas quiz question element.
 * Falls back to an empty string if the canvas becomes tainted by cross-origin
 * resources that cannot be serialized.
 * @param element - The element to capture.
 * @returns A promise that resolves to a PNG data URL representation of the element.
 */
export async function captureQuestionImage(element: HTMLElement): Promise<string> {
  const previousMarker = element.getAttribute(CAPTURE_MARKER_ATTRIBUTE);
  element.setAttribute(CAPTURE_MARKER_ATTRIBUTE, CAPTURE_MARKER_VALUE);

  try {
    const canvas = await html2canvas(element, {
      scale: Math.min(window.devicePixelRatio || 2, 3),
      logging: false,
      useCORS: true,
      backgroundColor: "#ffffff",
      onclone: (clonedDocument: Document) => {
        const cloneRoot = clonedDocument.querySelector<HTMLElement>(
          `[${CAPTURE_MARKER_ATTRIBUTE}="${CAPTURE_MARKER_VALUE}"]`
        );
        if (!cloneRoot) {
          return;
        }

        scrubCrossOriginImages(cloneRoot);
      }
    });

    const dataUrl = tryGetCanvasDataUrl(canvas);
    if (dataUrl) return dataUrl;

    console.warn(
      "[CQA] Canvas serialization blocked by cross-origin content. Falling back to tab capture."
    );
    // Fallback: capture the visible tab and crop to the element bounds
    const fallback = await captureByTabScreenshot(element);
    return fallback ?? "";
  } catch (error) {
    console.warn("[CQA] Failed to capture question image.", error);
    return "";
  } finally {
    if (previousMarker === null) {
      element.removeAttribute(CAPTURE_MARKER_ATTRIBUTE);
    } else {
      element.setAttribute(CAPTURE_MARKER_ATTRIBUTE, previousMarker);
    }
  }
}

/**
 * Try to get a PNG data URL representation of a canvas element.
 * @param canvas - The canvas element to get the data URL for.
 * @returns A PNG data URL representation of the canvas element.
 */
function tryGetCanvasDataUrl(canvas: HTMLCanvasElement): string | undefined {
  try {
    return canvas.toDataURL("image/png");
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") {
      return undefined;
    }

    console.warn("[CQA] Unexpected error while serializing question canvas.", error);
    return undefined;
  }
}

/**
 * Capture a screenshot of a tab and return a PNG data URL representation of the element.
 * @param element - The element to capture.
 * @returns A promise that resolves to a PNG data URL representation of the element.
 */
async function captureByTabScreenshot(element: HTMLElement): Promise<string | undefined> {
  try {
    element.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "center", inline: "center" });
  } catch {
    // ignore
  }

  await wait(150);

  const rect = element.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) {
    return undefined;
  }

  const dpr = window.devicePixelRatio || 1;
  const response = (await chrome.runtime.sendMessage({ type: "cqa:capture-tab" })) as
    | { type: "cqa:capture-tab:response"; dataUrl: string }
    | undefined;

  const tabPng = response?.dataUrl ?? "";
  if (!tabPng) {
    return undefined;
  }

  const image = await loadImage(tabPng);

  const sx = Math.max(0, Math.floor(rect.left * dpr));
  const sy = Math.max(0, Math.floor(rect.top * dpr));
  const sw = Math.min(Math.floor(rect.width * dpr), image.width - sx);
  const sh = Math.min(Math.floor(rect.height * dpr), image.height - sy);

  if (sw <= 0 || sh <= 0) {
    return undefined;
  }

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return undefined;
  }

  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL("image/png");
}

/**
 * Wait for a given number of milliseconds.
 * @param ms - The number of milliseconds to wait.
 * @returns A promise that resolves when the wait is complete.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load an image from a given source.
 * @param src - The source of the image to load.
 * @returns A promise that resolves to the loaded image.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load screenshot image."));
    img.src = src;
  });
}

/**
 * Scrub cross-origin images from a given root element.
 * @param root - The root element to scrub.
 */
function scrubCrossOriginImages(root: HTMLElement): void {
  const doc = root.ownerDocument;
  if (!doc) {
    return;
  }

  const images = Array.from(root.querySelectorAll("img"));
  images.forEach((image) => {
    const source = image.getAttribute("src") ?? "";
    if (!source || !isCrossOriginSource(source)) {
      return;
    }

    const placeholder = doc.createElement("div");
    placeholder.textContent = buildPlaceholderText(image);
    applyPlaceholderStyles(placeholder, image);
    image.replaceWith(placeholder);
  });
}

/**
 * Build a placeholder text for a given image.
 * @param image - The image to build the placeholder text for.
 * @returns A string containing the placeholder text.
 */
function buildPlaceholderText(image: HTMLImageElement): string {
  const altText = image.getAttribute("alt")?.trim();
  if (altText) {
    return `[image: ${altText}]`;
  }

  return "[image unavailable]";
}

/**
 * Apply styles to a placeholder element.
 * @param placeholder - The placeholder element to apply styles to.
 * @param source - The source image element.
 */
function applyPlaceholderStyles(placeholder: HTMLElement, source: HTMLImageElement): void {
  const width = resolveDimension(source.width) ?? resolveDimension(source.naturalWidth);
  const height = resolveDimension(source.height) ?? resolveDimension(source.naturalHeight);

  placeholder.style.display = "inline-flex";
  placeholder.style.alignItems = "center";
  placeholder.style.justifyContent = "center";
  placeholder.style.textAlign = "center";
  placeholder.style.backgroundColor = "#f5f5f5";
  placeholder.style.border = "1px dashed #bdbdbd";
  placeholder.style.color = "#555555";
  placeholder.style.fontSize = "12px";
  placeholder.style.boxSizing = "border-box";
  placeholder.style.padding = "4px";
  placeholder.style.whiteSpace = "normal";
  placeholder.style.width = `${Math.max(width ?? DEFAULT_PLACEHOLDER_SIZE, 24)}px`;
  placeholder.style.height = `${Math.max(height ?? DEFAULT_PLACEHOLDER_SIZE, 24)}px`;
}

/**
 * Resolve a dimension value.
 * @param value - The value to resolve.
 * @returns The resolved dimension value.
 */
function resolveDimension(value: number | undefined): number | undefined {
  if (typeof value !== "number") {
    return undefined;
  }

  if (!Number.isFinite(value)) {
    return undefined;
  }

  if (value <= 0) {
    return undefined;
  }

  return value;
}

/**
 * Determine whether a given source is a cross-origin source.
 * @param src - The source to check.
 * @returns Whether the source is a cross-origin source.
 */
function isCrossOriginSource(src: string): boolean {
  if (src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("about:")) {
    return false;
  }

  try {
    const url = new URL(src, window.location.href);
    return url.origin !== window.location.origin;
  } catch {
    return false;
  }
}

