import { requestOpenAiSolution } from "./openaiClient.js";
import {
  AssistantMessage,
  CaptureTabResponse,
  SolveQuestionResponse
} from "../shared/messages.js";
import { loadSettings } from "../shared/settings.js";

/**
 * Handle solve requests from content scripts by delegating to OpenAI and returning the result.
 */
chrome.runtime.onMessage.addListener((message: AssistantMessage, _sender, sendResponse) => {
  if (message?.type === "cqa:capture-tab") {
    (async () => {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        chrome.tabs.captureVisibleTab({ format: "png" }, (url) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(url);
        });
      });
      const response: CaptureTabResponse = { type: "cqa:capture-tab:response", dataUrl };
      sendResponse(response);
    })().catch((error: unknown) => {
      sendResponse({ type: "cqa:capture-tab:response", dataUrl: "" } satisfies CaptureTabResponse);
      console.warn("[CQA] captureVisibleTab failed.", error);
    });
    return true;
  }
  if (message?.type !== "cqa:solve-question") return;

  const { payload } = message;
  console.log("[CQA] Received solve-question message:", payload.questionId);
  (async () => {
    console.log("[CQA] Starting solve-question async handler");
    const settings = await loadSettings();
    console.log("[CQA] Settings loaded, requesting OpenAI solution");
    const result = await requestOpenAiSolution(payload, settings);
    const response: SolveQuestionResponse = {
      ...result,
      questionId: payload.questionId
    };
    console.log("[CQA] SolveQuestionResponse:", response);
    sendResponse(response);
  })().catch((error: unknown) => {
    console.error("[CQA] Error in solve-question handler:", error);
    const response: SolveQuestionResponse = {
      status: "error",
      questionId: payload.questionId,
      error: error instanceof Error ? error.message : "Unknown background error."
    };
    sendResponse(response);
  });

  return true;
});

