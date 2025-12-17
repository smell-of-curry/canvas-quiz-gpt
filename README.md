# Canvas Quiz Assistant

Canvas Quiz Assistant is a Chrome extension written in TypeScript that augments Canvas LMS quizzes. It injects a helper button for each question, captures the question context (including a screenshot), sends it to OpenAI for analysis, and applies the suggested answer in the quiz UI.

![Canvas Quiz Assistant injected UI](static/assets/in-quiz-example.png)

## Runtime Behavior

- Detects Canvas quiz pages by URL and quiz DOM structure.
- Injects a floating button onto each question container.
- On click:
  - Captures the question DOM and a PNG screenshot with `html2canvas`.
  - Sends contextual text and the image to the background service.
  - The background worker calls OpenAI and expects strict JSON with selected choice IDs (and optional free-form text answers).
  - The content script applies the suggestion to the quiz UI, toggling the button state to success, error, or timeout.
  - NOTE: The selected answer could have been misapplied by the interpreter, it is always best that you hover over the checkmark and read what it outputs to ensure it is correct.

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
- **Request Timeout** – limits how long the background worker waits for OpenAI in seconds.
- **Temperature** – controls response creativity (defaults to `0.2`).

![Canvas Quiz Assistant options page](static/assets/options-page.png)

## TODO's

- [ ] Add auto testing and some way to fake canvas quizzes.
- [ ] ...
