import { updateBadge, clearBadge } from "./webcam-darkness/badge.js";
import { maybeNotify, resetNotifier } from "./webcam-darkness/notifier.js";
import { loadSettings, toLimits, STORAGE_KEY } from "./settings.js";

async function notifyTabs(type) {
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (!tab.id) continue;

    try {
      await chrome.tabs.sendMessage(tab.id, { type });
    } catch (error) {
      // Restricted Chrome pages cannot receive messages.
    }
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TRACKER_BREAK_START") {
    void notifyTabs("SHOW_CLOUDS");
  }

  if (message.type === "TRACKER_BREAK_END") {
    void notifyTabs("HIDE_CLOUDS");
  }
});

// ---- Background engine (offscreen document) ----
// The engine runs the camera and detection in a hidden page. Offscreen pages only get
// chrome.runtime, so this service worker applies the badge and notification.
const OFFSCREEN_URL = "offscreen.html";
let creatingOffscreen = null;

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ["USER_MEDIA"],
        justification: "Keep the webcam eye tracker and room-lighting check running when no extension page is open."
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

async function closeOffscreen() {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
}

// Tell the engine the user's timer limits. Offscreen pages cannot read storage.
async function pushSettings() {
  try {
    const limits = toLimits(await loadSettings());
    await chrome.runtime.sendMessage({ type: "ENGINE_SETTINGS", limits });
  } catch (error) {
    // Engine not ready yet; it gets the settings again on the next command.
  }
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && changes[STORAGE_KEY] && (await hasOffscreen())) pushSettings();
});

// Latest snapshot, so a page that opens later can show it immediately.
let lastEngineState = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    // Snapshot from the offscreen engine.
    case "ENGINE_STATE": {
      lastEngineState = message.state;
      const lighting = message.state?.lighting?.state;
      if (message.state?.running && lighting) {
        updateBadge(lighting);
        maybeNotify(lighting);
      }
      return false;
    }

    // A page asks the engine to do something. The worker makes sure the hidden page
    // exists, then forwards the command to it.
    case "ENGINE_REQUEST": {
      (async () => {
        try {
          if (message.command === "ENGINE_STOP") {
            const stopped = (await hasOffscreen())
              ? await chrome.runtime.sendMessage({ type: "ENGINE_STOP" })
              : lastEngineState;
            await closeOffscreen();
            clearBadge();
            resetNotifier();
            lastEngineState = null;
            sendResponse(stopped);
            return;
          }
          if (message.command === "ENGINE_GET_STATE" && !(await hasOffscreen())) {
            sendResponse(null);
            return;
          }
          await ensureOffscreen();
          await pushSettings();
          sendResponse(
            await chrome.runtime.sendMessage({ type: message.command, kind: message.kind })
          );
        } catch (error) {
          sendResponse({ error: error.message });
        }
      })();
      return true;
    }
    default:
      return false;
  }
});
