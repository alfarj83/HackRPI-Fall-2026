// Entry point of the offscreen document. Receives commands from the service worker and
// reports state back. Only chrome.runtime exists here.
import { createEngine } from "./engine/engine.js";

const engine = createEngine({
  wasmUrl: chrome.runtime.getURL("wasm"),
  modelUrl: chrome.runtime.getURL("models/face_landmarker.task"),
  onState: state => {
    chrome.runtime.sendMessage({ type: "ENGINE_STATE", state }).catch(() => {
      // Nobody is listening right now; the next snapshot will arrive soon.
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case "ENGINE_START":
      engine.start().then(sendResponse);
      return true;
    case "ENGINE_STOP":
      sendResponse(engine.stop());
      return false;
    case "ENGINE_CALIBRATE":
      sendResponse(engine.calibrate(message.kind));
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
