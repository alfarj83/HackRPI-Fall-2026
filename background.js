import { renderTimerBadge, clearTimerBadge } from "./timer-badge.js";
import { maybeNotify, resetNotifier } from "./webcam-darkness/notifier.js";
import { loadSettings, toLimits, STORAGE_KEY, DEV_OVERRIDE_KEY, applyDevOverride } from "./settings.js";
import { sanitizeCalibration } from "./engine/calibration.js";
import { loadPrefs, normalizePrefs, PREFS_KEY } from "./notification-prefs.js";

const CALIBRATION_KEY = "calibrationData";


async function notifyTabs(type) {
  const tabs = await chrome.tabs.query({});

  console.log("Cloud event:", type);

  for (const tab of tabs) {
    if (!tab.id) continue;

    // Only try to display clouds on normal websites.
    if (!/^https?:\/\//.test(tab.url || "")) continue;

    try {
      // First, try the existing cloud script.
      await chrome.tabs.sendMessage(tab.id, { type });

      console.log("Cloud message delivered:", tab.url);

    } catch (error) {

      // If the script isn't available, try injecting it.
      console.log("Injecting clouds into:", tab.url);

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["cloud-overlay.js"]
        });

        // Try again after injecting the script.
        await chrome.tabs.sendMessage(tab.id, { type });

        console.log("Cloud message delivered:", tab.url);

      } catch (injectionError) {
        console.warn(
          "Cloud injection failed:",
          tab.url,
          injectionError.message
        );
      }
    }
  }
}

// Draw the plain cloud icon (no time) when the extension is installed or Chrome starts, until
// the camera is running and the countdown takes over. Not done on every worker wake-up, so
// it never wipes the countdown while the engine is running.
chrome.runtime.onInstalled.addListener(() => clearTimerBadge());
chrome.runtime.onStartup.addListener(() => clearTimerBadge());

// Alert switches from Settings. Cached so the 5-per-second engine updates do not each
// read storage. The service worker can restart, so the cache reloads from storage.
let prefs = normalizePrefs(null);
const prefsLoaded = loadPrefs().then(p => { prefs = p; });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[PREFS_KEY]) return;
  const before = prefs;
  prefs = normalizePrefs(changes[PREFS_KEY].newValue);
  // Switching an alert off also takes down what is already showing.
  if (before.lighting && !prefs.lighting) {
    clearTimerBadge(); // the next engine update redraws it without the dark alert
    resetNotifier();
  }
  if (before.breaks && !prefs.breaks) void notifyTabs("HIDE_CLOUDS");
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TRACKER_BREAK_START") {
    // Break reminders can be switched off; the break itself still counts down.
    prefsLoaded.then(() => {
      if (prefs.breaks) void notifyTabs("SHOW_CLOUDS");
    });
  }

  // Always hide, so an overlay is never left stuck on screen.
  if (message.type === "TRACKER_BREAK_END") {
    void notifyTabs("HIDE_CLOUDS");
  }
});

// The content-script overlay is anchored to one user-selected page.
let calibrationTabId = null;
async function cancelPageCalibration() {
  const id = calibrationTabId;
  calibrationTabId = null;
  if (id === null || !(await hasOffscreen())) return;
  try { await chrome.runtime.sendMessage({ type: 'ENGINE_CALIBRATE_CANCEL' }); }
  catch (error) { console.warn('Could not cancel abandoned calibration:', error); }
}
chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === calibrationTabId) void cancelPageCalibration();
});
chrome.tabs.onUpdated.addListener((tabId, changes) => {
  if (tabId === calibrationTabId && changes.status === 'loading') void cancelPageCalibration();
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
    const stored = await chrome.storage.local.get(DEV_OVERRIDE_KEY);
    // The override is for testing only; it is empty for normal users.
    const limits = applyDevOverride(toLimits(await loadSettings()), stored[DEV_OVERRIDE_KEY]);
    await chrome.runtime.sendMessage({ type: "ENGINE_SETTINGS", limits });
  } catch (error) {
    // Engine not ready yet; it gets the settings again on the next command.
  }
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && (changes[STORAGE_KEY] || changes[DEV_OVERRIDE_KEY]) && (await hasOffscreen())) pushSettings();
});

// Latest snapshot, so a page that opens later can show it immediately.
let lastEngineState = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case 'HEADCLOUD_CALIBRATION_REGISTER': {
      // Only a content script in the explicitly injected top frame can register.
      if (!sender.tab?.id || sender.frameId !== 0) {
        sendResponse({ error: 'Calibration must run in a regular tab.' });
        return false;
      }
      if (calibrationTabId !== null && calibrationTabId !== sender.tab.id) {
        sendResponse({ error: 'Calibration is already open in another tab.' });
        return false;
      }
      calibrationTabId = sender.tab.id;
      sendResponse({ ok: true });
      return false;
    }
    case 'HEADCLOUD_CALIBRATION_UNREGISTER': {
      if (sender.tab?.id === calibrationTabId) calibrationTabId = null;
      sendResponse({ ok: true });
      return false;
    }
    // Snapshot from the offscreen engine.
    case "ENGINE_STATE": {
      lastEngineState = message.state;
      if (calibrationTabId !== null) {
        const targetTab = calibrationTabId;
        chrome.tabs.sendMessage(targetTab, { type: 'HEADCLOUD_ENGINE_STATE', state: message.state })
          .catch(() => {});
      }
      prefsLoaded.then(() => {
        // The toolbar icon shows the timer (or a red "!" when the room is dark).
        renderTimerBadge(message.state, { showDark: prefs.lighting });
        const lighting = message.state?.lighting?.state;
        if (message.state?.running && lighting && prefs.lighting) maybeNotify(lighting);
      });
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
            clearTimerBadge();
            resetNotifier();
            lastEngineState = null;
            sendResponse(stopped);
            return;
          }
          if (message.command === "ENGINE_CLEAR_CALIBRATION") {
            await chrome.storage.local.remove(CALIBRATION_KEY);
            sendResponse(
              (await hasOffscreen())
                ? await chrome.runtime.sendMessage({ type: "ENGINE_CLEAR_CALIBRATION" })
                : null
            );
            return;
          }
          if ((message.command === "ENGINE_GET_STATE" ||
               message.command === "ENGINE_CALIBRATE_CANCEL") && !(await hasOffscreen())) {
            sendResponse(null);
            return;
          }
          await ensureOffscreen();
          if (message.command !== 'ENGINE_GET_STATE') await pushSettings();
          // Forward guided calibration and cancel just like the existing engine commands.
          // Never put camera frames or landmark data into extension storage.
          const payload = { type: message.command, kind: message.kind, auto: message.auto };
          if (message.command === "ENGINE_START") {
            const stored = await chrome.storage.local.get(CALIBRATION_KEY);
            payload.calibration = stored[CALIBRATION_KEY] || null;
          }
          sendResponse(await chrome.runtime.sendMessage(payload));
        } catch (error) {
          sendResponse({ error: error.message });
        }
      })();
      return true;
    }
    // The engine finished calibration: keep it so setup is a one-time step.
    case "CALIBRATION_SAVE": {
      const samples = sanitizeCalibration(message.samples);
      if (samples) chrome.storage.local.set({ [CALIBRATION_KEY]: { samples, savedAt: Date.now() } });
      return false;
    }
    default:
      return false;
  }
});
