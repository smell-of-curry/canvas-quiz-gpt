import {
  DEFAULT_SETTINGS,
  loadSettings,
  resetSettings,
  saveSettings,
} from "../shared/settings.js";

const MODEL_CUSTOM_VALUE = "__custom__";
const BUILTIN_MODELS: Array<{ value: string; label: string }> = [
  { value: "gpt-4o-mini", label: "gpt-4o-mini (recommended)" },
  { value: "gpt-4o", label: "gpt-4o" },
  { value: "gpt-4.1", label: "gpt-4.1" },
  { value: "gpt-4.1-mini", label: "gpt-4.1-mini" },
  { value: "gpt-4.1-nano", label: "gpt-4.1-nano" },
  { value: "gpt-5", label: "gpt-5" },
  { value: "gpt-5-mini", label: "gpt-5-mini" },
  { value: "gpt-5-nano", label: "gpt-5-nano" },
  { value: "gpt-5.1", label: "gpt-5.1" },
  { value: "gpt-5.2", label: "gpt-5.2" },
  { value: "gpt-5-pro", label: "gpt-5-pro" },
  { value: "gpt-5.2-pro", label: "gpt-5.2-pro" },
  { value: "gpt-5-chat-latest", label: "gpt-5-chat-latest (alias)" },
  { value: "gpt-5.1-chat-latest", label: "gpt-5.1-chat-latest (alias)" },
  { value: "gpt-5.2-chat-latest", label: "gpt-5.2-chat-latest (alias)" },
  { value: "chatgpt-4o-latest", label: "chatgpt-4o-latest (alias)" },
  { value: "gpt-4.5-preview", label: "gpt-4.5-preview" },
  { value: "gpt-4-turbo", label: "gpt-4-turbo" },
  { value: "gpt-4-turbo-preview", label: "gpt-4-turbo-preview" },
  { value: "gpt-4", label: "gpt-4" },
  { value: "gpt-3.5-turbo", label: "gpt-3.5-turbo" },
  { value: "o4-mini", label: "o4-mini (reasoning)" },
  { value: "o3", label: "o3 (reasoning)" },
  { value: "o3-mini", label: "o3-mini (reasoning)" },
  { value: "o3-pro", label: "o3-pro (reasoning)" },
  { value: "o1", label: "o1 (reasoning)" },
  { value: "o1-pro", label: "o1-pro (reasoning)" },
  { value: "o1-mini", label: "o1-mini (deprecated)" },
  { value: "o1-preview", label: "o1-preview (deprecated)" },
];
const BUILTIN_MODEL_VALUES = new Set(
  BUILTIN_MODELS.map((model) => model.value)
);

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const MODEL_VALIDATE_TIMEOUT_MS = 10_000;

const form = document.getElementById("settings-form") as HTMLFormElement | null;
const apiKeyInput = document.getElementById(
  "apiKey"
) as HTMLInputElement | null;
const modelSelect = document.getElementById(
  "modelSelect"
) as HTMLSelectElement | null;
const customModelRow = document.getElementById(
  "customModelRow"
) as HTMLDivElement | null;
const customModelInput = document.getElementById(
  "customModel"
) as HTMLInputElement | null;
const timeoutInput = document.getElementById(
  "timeout"
) as HTMLInputElement | null;
const temperatureInput = document.getElementById(
  "temperature"
) as HTMLInputElement | null;
const resetButton = document.getElementById(
  "resetBtn"
) as HTMLButtonElement | null;
const statusField = document.getElementById(
  "status"
) as HTMLParagraphElement | null;

void initialize();

/**
 * Initialize the options form by wiring up events and populating stored settings.
 */
async function initialize(): Promise<void> {
  if (
    !form ||
    !apiKeyInput ||
    !modelSelect ||
    !customModelRow ||
    !customModelInput ||
    !timeoutInput ||
    !temperatureInput ||
    !resetButton
  ) {
    setStatus("Unable to initialize settings form.", true);
    return;
  }

  populateModelSelect();
  const settings = await loadSettings();
  applySettingsToForm(settings);

  modelSelect.addEventListener("change", () => {
    syncCustomModelVisibility(true);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await persistSettings();
  });

  resetButton.addEventListener("click", async () => {
    await resetSettings();
    applySettingsToForm(DEFAULT_SETTINGS);
    setStatus("Settings reset to defaults.", false);
  });
}

/**
 * Populate the model select with the available models.
 */
function populateModelSelect(): void {
  if (!modelSelect) return;

  modelSelect.replaceChildren();
  for (const model of BUILTIN_MODELS) {
    const option = document.createElement("option");
    option.value = model.value;
    option.textContent = model.label;
    modelSelect.append(option);
  }

  const customOption = document.createElement("option");
  customOption.value = MODEL_CUSTOM_VALUE;
  customOption.textContent = "Custom…";
  modelSelect.append(customOption);
}

/**
 * Hydrate the options UI with a provided settings object.
 * @param settings - The settings to apply to the form.
 */
function applySettingsToForm(settings: typeof DEFAULT_SETTINGS): void {
  if (
    !apiKeyInput ||
    !modelSelect ||
    !customModelInput ||
    !timeoutInput ||
    !temperatureInput
  )
    return;
  apiKeyInput.value = settings.apiKey ?? "";
  setModelInForm(settings.model ?? DEFAULT_SETTINGS.model);
  timeoutInput.value = String(
    settings.timeoutSeconds ?? DEFAULT_SETTINGS.timeoutSeconds
  );
  temperatureInput.value = String(
    settings.temperature ?? DEFAULT_SETTINGS.temperature
  );
}

/**
 * Set the model in the form.
 * @param model - The model to set in the form.
 */
function setModelInForm(model: string): void {
  if (!modelSelect || !customModelInput) return;

  const normalized = model.trim();
  if (BUILTIN_MODEL_VALUES.has(normalized)) {
    modelSelect.value = normalized;
    customModelInput.value = "";
    syncCustomModelVisibility(false);
    return;
  }

  modelSelect.value = MODEL_CUSTOM_VALUE;
  customModelInput.value = normalized || DEFAULT_SETTINGS.model;
  syncCustomModelVisibility(false);
}

/**
 * Sync the custom model visibility.
 * @param shouldFocus - Whether to focus the custom model input.
 */
function syncCustomModelVisibility(shouldFocus: boolean): void {
  if (!modelSelect || !customModelRow || !customModelInput) return;

  const isCustom = modelSelect.value === MODEL_CUSTOM_VALUE;
  customModelRow.hidden = !isCustom;
  customModelInput.disabled = !isCustom;

  if (isCustom && shouldFocus) customModelInput.focus();
}

/**
 * Read the model from the form.
 * @returns The model from the form.
 */
function readModelFromForm(): string | null {
  if (!modelSelect || !customModelInput) return null;

  if (modelSelect.value === MODEL_CUSTOM_VALUE) {
    const custom = customModelInput.value.trim();
    return custom.length > 0 ? custom : null;
  }

  const selected = modelSelect.value.trim();
  return selected.length > 0 ? selected : null;
}

/**
 * Persist the current form values to Chrome storage with validation.
 */
async function persistSettings(): Promise<void> {
  if (
    !form ||
    !apiKeyInput ||
    !modelSelect ||
    !customModelInput ||
    !timeoutInput ||
    !temperatureInput
  ) {
    setStatus("Form fields missing.", true);
    return;
  }

  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    setStatus("Please enter an OpenAI API key before saving.", true);
    return;
  }

  const model = readModelFromForm();
  if (!model) {
    setStatus("Please select a model or enter a custom model name.", true);
    return;
  }

  disableForm(true);

  try {
    setStatus("Validating model…", false);
    await validateModelExists(apiKey, model);

    const timeoutSeconds =
      timeoutInput.value.trim().length > 0
        ? Number(timeoutInput.value)
        : DEFAULT_SETTINGS.timeoutSeconds;
    const temperature =
      temperatureInput.value.trim().length > 0
        ? Number(temperatureInput.value)
        : DEFAULT_SETTINGS.temperature;

    await saveSettings({
      apiKey,
      model,
      timeoutSeconds: clamp(timeoutSeconds, 5, 120),
      temperature: clamp(temperature, 0, 2),
    });

    setStatus("Settings saved.", false);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save settings.";
    setStatus(message, true);
  } finally {
    disableForm(false);
  }
}

/**
 * Validate that a model exists.
 * @param apiKey - The API key to use to validate the model.
 * @param model - The model to validate.
 */
async function validateModelExists(
  apiKey: string,
  model: string
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    MODEL_VALIDATE_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      `${OPENAI_MODELS_URL}/${encodeURIComponent(model)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      }
    );

    if (response.ok) return;

    const bodyText = await response.text().catch(() => "");
    const errorMessage = extractOpenAiErrorMessage(bodyText);

    if (response.status === 401)
      throw new Error("OpenAI API key was rejected. Double-check your key.");
    if (response.status === 403)
      throw new Error(`Your API key does not have access to model "${model}".`);
    if (response.status === 404)
      throw new Error(
        `Model "${model}" was not found (or your key lacks access to it).`
      );
    if (response.status === 429)
      throw new Error(
        errorMessage ||
          "OpenAI rate limit reached or quota exceeded while validating model."
      );

    throw new Error(
      errorMessage ||
        `OpenAI returned status ${response.status} while validating model "${model}".`
    );
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error("Model validation timed out. Try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Extract an error message from an OpenAI API response.
 * @param bodyText - The body text of the OpenAI API response.
 * @returns The extracted error message.
 */
function extractOpenAiErrorMessage(bodyText: string): string | null {
  if (!bodyText) return null;

  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
    const message = parsed?.error?.message?.trim();
    return message?.length ? message : null;
  } catch {
    return bodyText.trim().length ? bodyText.trim() : null;
  }
}

/**
 * Enable or disable the entire form to avoid duplicate submissions.
 * @param disabled - Whether the form should be disabled.
 */
function disableForm(disabled: boolean): void {
  if (!form) return;
  const elements = Array.from(form.elements) as Array<
    HTMLInputElement | HTMLButtonElement | HTMLSelectElement
  >;
  elements.forEach((element) => (element.disabled = disabled));
}

/**
 * Display feedback text in the status area with contextual color.
 * @param message - The message to display in the status area.
 * @param isError - Whether the message is an error.
 */
function setStatus(message: string, isError: boolean): void {
  if (!statusField) return;
  statusField.textContent = message;
  statusField.style.color = isError ? "#d64545" : "#1f9d55";
}

/**
 * Clamp a numeric value between inclusive bounds.
 * @param value - The value to clamp.
 * @param min - The minimum value.
 * @param max - The maximum value.
 * @returns The clamped value.
 */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
