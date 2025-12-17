/**
 * Storage bucket key for persisting assistant preferences via Chrome sync storage.
 */
const STORAGE_KEY = "cqa_settings_v1";

/**
 * Normalized configuration required to communicate with the GPT backend.
 */
export type AssistantSettings = {
  /**
   * The API key for the OpenAI API.
   */
  apiKey: string;
  /**
   * The model to use for the OpenAI API.
   */
  model: string;
  /**
   * The temperature for the OpenAI API.
   */
  temperature: number;
  /**
   * The timeout in seconds for the OpenAI API.
   */
  timeoutSeconds: number;
};

/**
 * Default settings applied when no persisted configuration exists.
 */
export const DEFAULT_SETTINGS: AssistantSettings = {
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.2,
  timeoutSeconds: 45,
};

/**
 * Stored settings type.
 */
type StoredSettings = Partial<AssistantSettings>;

/**
 * Load the persisted assistant configuration, falling back to defaults where necessary.
 */
export async function loadSettings(): Promise<AssistantSettings> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const stored = (result?.[STORAGE_KEY] ?? {}) as StoredSettings;
  return { ...DEFAULT_SETTINGS, ...stored };
}

/**
 * Persist updated assistant settings to Chrome sync storage.
 * @param settings - The settings to persist.
 */
export async function saveSettings(settings: StoredSettings): Promise<void> {
  const next = { ...DEFAULT_SETTINGS, ...settings };
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
}

/**
 * Remove any stored assistant preferences, restoring defaults on the next load.
 * @returns A promise that resolves when the settings are reset.
 */
export async function resetSettings(): Promise<void> {
  await chrome.storage.sync.remove(STORAGE_KEY);
}
