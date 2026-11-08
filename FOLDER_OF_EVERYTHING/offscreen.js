// Entry point of the offscreen document. Receives commands from the service worker and
// reports state back. Only chrome.runtime exists here.
import { createEngine } from "./engine/engine.js";

const engine = createEngine({
  wasmUrl: chrome.runtime.getURL("wasm"),
  modelUrl: chrome.runtime.getURL("models/face_landmarker.task"),
  onBreak: kind => {
    // The service worker turns these into the cloud overlay on every tab.
    chrome.runtime
      .sendMessage({ type: kind === "start" ? "TRACKER_BREAK_START" : "TRACKER_BREAK_END" })
      .catch(() => {});
  },
  onCalibrated: samples => {
    // The service worker stores it, so setup only has to be done once.
    chrome.runtime.sendMessage({ type: "CALIBRATION_SAVE", samples }).catch(() => {});
  },
  onPreview: image => {
    chrome.runtime.sendMessage({ type: "ENGINE_PREVIEW", image }).catch(() => {});
  },
  onState: state => {
    chrome.runtime.sendMessage({ type: "ENGINE_STATE", state }).catch(() => {
      // Nobody is listening right now; the next snapshot will arrive soon.
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case "ENGINE_START":
      engine.start(message.calibration).then(sendResponse);
      return true;
    case "ENGINE_CLEAR_CALIBRATION":
      sendResponse(engine.clearCalibration());
      return false;
    case "ENGINE_STOP":
      sendResponse(engine.stop());
      return false;
    case "ENGINE_CALIBRATE":
      sendResponse(engine.calibrate(message.kind, { auto: Boolean(message.auto) }));
      return false;
    case "ENGINE_PREVIEW_REQUEST":
      engine.requestPreview();
      sendResponse({ ok: true });
      return false;
    case "ENGINE_SETTINGS":
      sendResponse(engine.applySettings(message.limits));
      return false;
    case "ENGINE_GET_STATE":
      sendResponse(engine.getState());
      return false;
    default:
      return false;
  }
});

window.addEventListener("pagehide", () => engine.dispose());
