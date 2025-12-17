# Canvas Quiz Assistant

Canvas Quiz Assistant is a Chrome extension written in TypeScript that augments Canvas LMS quizzes. It injects a helper button for each question, captures the question context (including a screenshot), sends it to OpenAI for analysis, and applies the suggested answer in the quiz UI.

## Project Structure

- `src/background`: Background service worker that proxies requests to OpenAI.
- `src/content`: Content scripts for Canvas detection, UI injection, and DOM manipulation.
- `src/options`: Options page logic for configuring API credentials and model settings.
- `src/shared`: Shared types and storage helpers.
- `static`: Manifest, options markup/styles, and icon assets copied into the build output.

## Getting Started

```bash
npm install
npm run build
```

The build command bundles the TypeScript sources with `tsup` and copies static assets into `dist/`.

### Load the Extension in Chrome

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the `dist/` directory created by `npm run build`.

### Configure OpenAI Settings

Open the extension's options page (Chrome menu → Extensions → Canvas Quiz Assistant → Details → Extension options) and provide:

- **OpenAI API Key** – required; stored using `chrome.storage.sync`.
- **Model** – defaults to `gpt-4o-mini`. Any compatible OpenAI Chat Completions model can be used.
- **Request Timeout** – limits how long the background worker waits for OpenAI.
- **Temperature** – controls response creativity (defaults to `0.2`).

## Runtime Behavior

- Detects Canvas quiz pages by URL and quiz DOM structure.
- Injects a floating button onto each question container.
- On click:
  - Captures the question DOM and a PNG screenshot with `html2canvas`.
  - Sends contextual text and the image to the background service.
  - The background worker calls OpenAI and expects strict JSON with selected choice IDs (and optional free-form text answers).
  - The content script applies the suggestion to the quiz UI, toggling the button state to success, error, or timeout.

## Manual Testing Checklist

- **Initial Load**: Build the project, load the unpacked extension, and confirm the options page loads and persists settings.
- **Quiz Detection**: Navigate to a Canvas quiz (`https://*.instructure.com/.../quizzes/...`) and verify the assistant buttons appear once questions render.
- **Single Choice Question**: Trigger GPT on a multiple-choice question and ensure the selected radio button changes and the icon shows success or failure accordingly.
- **Multiple Choice Question**: Confirm checkboxes are toggled to match GPT selections, including cases where answers were already selected.
- **Text Response**: For short-answer fields, verify GPT-populated text appears when the response includes `answerText`.
- **Failure States**: Turn off networking or use an invalid API key to observe red error and yellow timeout indicators.
- **Navigation Regression**: Move between quiz pages; ensure buttons re-inject appropriately and no duplicates remain.

## Development Scripts

- `npm run dev` – watch mode build with automatic static asset copying.
- `npm run build` – one-off production build.
- `npm run clean` – remove the `dist/` output directory.

## Notes

- The extension stores configuration in Chrome sync storage; no credentials are bundled in source.
- OpenAI requests include both textual context and a screenshot to improve reliability when questions contain images or complex formatting.

