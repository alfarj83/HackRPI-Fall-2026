// Popup UI. The camera, face tracking, calibration, lighting check and timers all run in
// the background engine (offscreen.html), so closing this popup does not stop anything.
// This page shows the engine's latest state and sends it commands.
//
// Setup (enable camera + calibrate) happens once. The calibration is saved by the service
// worker, and after that the popup opens straight on the cloud timer. "Redo setup" in
// Settings clears it.
import { initNotificationPrompt } from './webcam-darkness/notification-prompt.js';
import { loadSettings, saveSettings, clampSettings, toLimits, DEFAULTS } from './settings.js';
import { sanitizeCalibration } from './engine/calibration.js';
import { loadPrefs, savePrefs } from './notification-prefs.js';

const CALIBRATION_KEY = 'calibrationData';
const pages = ["permission", "calibration", "timer", "settings"];
const $ = id => document.getElementById(id);

let state = null;            // latest engine snapshot, or null when the engine is off
let busy = false;            // true while the camera is starting
let setupDone = false;       // a saved calibration exists
let currentPage = "permission";
let savedLimits = toLimits(DEFAULTS);

// ---- cheap DOM updates: only touch the page when a value actually changed ----
function setText(el, text) {
  // Compare with what is really on the page, so text set elsewhere never goes stale.
  if (el.textContent !== text) el.textContent = text;
}
function setDisabled(el, value) {
  if (el.disabled !== value) el.disabled = value;
}
function setHidden(el, value) {
  if (el.hidden !== value) el.hidden = value;
}

// ---- smooth progress line ----
// The engine reports progress about 10 times a second. Instead of jumping to each value,
// the line eases toward it once per animation frame, so it glides without stalls.
const calibrationBar = $('calibration-bar');
let barTarget = 0;
let barShown = 0;
let barFrame = null;

function drawBar() {
  calibrationBar.style.transform = `scaleX(${barShown})`;
}
function stepBar() {
  const gap = barTarget - barShown;
  if (Math.abs(gap) < 0.0005) {
    barShown = barTarget;
    barFrame = null;
  } else {
    barShown += gap * 0.2;
    barFrame = requestAnimationFrame(stepBar);
  }
  drawBar();
}
function setBar(fraction) {
  const next = Math.min(1, Math.max(0, fraction));
  // Going backwards (a new run) resets at once instead of sliding back.
  if (next < barShown - 0.02) {
    barShown = next;
    drawBar();
  }
  barTarget = next;
  if (barFrame === null) barFrame = requestAnimationFrame(stepBar);
}

// ---- engine commands ----
const ask = (command, extra = {}) =>
  chrome.runtime.sendMessage({ type: 'ENGINE_REQUEST', command, ...extra });

const running = () => Boolean(state?.running);
const calibration = () => state?.calibration || { active: null, hasScreen: false, hasAway: false, progress: 0 };
const isCalibrated = () => running() && calibration().hasScreen && calibration().hasAway;

// Setup counts as finished once a calibration is saved (or has just been completed).
const setupComplete = () => setupDone || isCalibrated();

// The page to land on: the timer once set up, otherwise wherever setup left off.
function homePage() {
  if (setupComplete()) return "timer";
  return running() ? "calibration" : "permission";
}

// ---- pages ----
// The step navigation only goes away once setup is done AND the user has left the setup
// pages, so it never disappears from under them right after calibration finishes.
function updateSetupClass() {
  const onSetupPage = currentPage === "permission" || currentPage === "calibration";
  document.body.classList.toggle("setup-done", setupComplete() && !onSetupPage);
}

function showPage(page) {
  if (!pages.includes(page)) return;
  currentPage = page;
  for (const name of pages) $("page-" + name).hidden = name !== page;
  document.querySelectorAll("[data-nav]").forEach(button => {
    button.classList.toggle("active", button.dataset.nav === page);
  });
  updateSetupClass();
  updateHomeArrow();
  updatePreviewRequests();
}

// The back arrow is only useful away from the home page, so it hides there (keeping its
// space, so the gear stays on the right).
function updateHomeArrow() {
  $("home-nav").style.visibility = currentPage === homePage() ? "hidden" : "visible";
  // In Settings the gear is replaced by the privacy info icon (same spot, top right).
  const inSettings = currentPage === "settings";
  $("settings-nav").hidden = inSettings;
  $("info-nav").hidden = !inSettings;
  if (!inSettings) setPrivacyOpen(false);
}

function setPrivacyOpen(open) {
  $("privacy-panel").hidden = !open;
  $("info-nav").setAttribute("aria-expanded", String(open));
}

// Only ask the engine for preview frames while the calibration page is visible.
let previewTimer = null;
function updatePreviewRequests() {
  const wanted = currentPage === "calibration" && running();
  if (wanted && !previewTimer) {
    const request = () => chrome.runtime.sendMessage({ type: 'ENGINE_PREVIEW_REQUEST' }).catch(() => {});
    request();
    previewTimer = setInterval(request, 1000);
  } else if (!wanted && previewTimer) {
    clearInterval(previewTimer);
    previewTimer = null;
  }
}

const previewCanvas = $('overlay');
const previewCtx = previewCanvas.getContext('2d');
let previewBusy = false;
let previewPending = null;
// Frames arrive faster than they can be decoded when the popup is busy. Keep only the
// newest one, so the picture never lags behind or flickers through old frames.
function drawPreview(dataUrl) {
  if (previewBusy) {
    previewPending = dataUrl;
    return;
  }
  previewBusy = true;
  const image = new Image();
  image.onload = () => {
    if (previewCanvas.width !== image.width) previewCanvas.width = image.width;
    if (previewCanvas.height !== image.height) previewCanvas.height = image.height;
    previewCtx.drawImage(image, 0, 0);
    previewBusy = false;
    if (previewPending) {
      const next = previewPending;
      previewPending = null;
      drawPreview(next);
    }
  };
  image.onerror = () => { previewBusy = false; };
  image.src = dataUrl;
}

// ---- rendering ----
function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}

function renderTimers() {
  const t = state?.timers || { ...savedLimits, screenTime: 0, awayTime: 0, onBreak: false };
  const onBreak = Boolean(t.onBreak);

  // The layered cloud shares this background engine timer; it does not create a second clock.
  const cloudRatio = t.screenLimit > 0
    ? (onBreak ? 1 : Math.max(0, Math.min(1, t.screenTime / t.screenLimit)))
    : 0;
  window.updateCloudTimer?.(cloudRatio);

  setText($("screen-timer"), formatTime(Math.ceil(Math.max(0, t.screenLimit - t.screenTime) / 1000) * 1000));
  setText($("timer-caption"), onBreak ? "Look away from your screen" : "Until your next eye break");

  // The looking-away line only exists during a break.
  setHidden($("away-line"), !onBreak);
  setText($("away-timer"), formatTime(Math.ceil(Math.max(0, t.awayLimit - t.awayTime) / 1000) * 1000));

  // Camera off after a restart or Stop: one button brings the saved setup back.
  const off = !running();
  setHidden($("timer-off"), !off);
  setDisabled($("timer-start"), busy);
  setHidden($("timer-caption"), off);
}

function renderCalibration() {
  const c = calibration();
  const completed = Number(c.hasScreen) + Number(c.hasAway);
  const pausing = c.pauseLeftMs > 0;           // between the two automatic steps
  const busyNow = c.active !== null || pausing;

  // Plain buttons, as originally. Progress is shown on the line below them.
  setDisabled($("calibrate-screen"), !running() || busyNow);
  setDisabled($("calibrate-away"), !running() || !c.hasScreen || busyNow);
  setDisabled($("go-timer"), !(c.hasScreen && c.hasAway));

  // The overall bar: step 1 is the first half, step 2 the second half.
  let message;
  let hint;
  if (c.active === 'screen') {
    message = `Step 1 of 2: recording ${c.progress}/30 samples`;
    hint = "Keep looking at your normal screen-reading area.";
  } else if (pausing) {
    message = `Step 1 done. Step 2 starts in ${Math.ceil(c.pauseLeftMs / 1000)}…`;
    hint = "Now look away from the screen and hold that position.";
  } else if (c.active === 'away') {
    message = `Step 2 of 2: recording ${c.progress}/30 samples`;
    hint = "Look away from the screen and hold that position.";
  } else if (c.hasScreen && c.hasAway) {
    message = "2 of 2 steps complete";
    hint = "Calibration complete! Press Start Timer when you are ready.";
  } else if (c.hasScreen) {
    message = "1 of 2 steps complete";
    hint = "Press step 2 to record looking away.";
  } else {
    message = "0 of 2 steps complete";
    hint = "Look directly at your screen, then press step 1. Step 2 runs by itself.";
  }
  setText($("calibration-message"), message);
  setText($("calibration-hint"), hint);
  setBar(c.active ? (completed * 30 + c.progress) / 60 : completed / 2);
}

function renderControls() {
  setDisabled($('start'), running() || busy);
  setDisabled($('stop'), !running());
  setText($('status'), busy ? 'Requesting camera permission…' : (state?.status || 'Camera off'));
}

function render(next, { fromEngine = true } = {}) {
  const wasRunning = running();
  state = next && !next.error ? next : null;
  if (next?.error) $('status').textContent = `Error: ${next.error}`;

  renderControls();
  renderTimers();
  renderCalibration();
  updateSetupClass();
  updateHomeArrow();

  // Follow the engine: a stopped camera goes home.
  if (fromEngine) {
    // Finishing calibration does NOT leave the page. The user presses "Start Timer".
    if (wasRunning && !running() && currentPage !== "settings") showPage(homePage());
  }
  updatePreviewRequests();
}

// ---- starting the camera (used by the welcome page and the timer page) ----
async function startCamera() {
  busy = true;
  renderControls();
  renderTimers();
  try {
    // The hidden engine page cannot show Chrome's permission prompt, so ask here.
    // Chrome remembers the answer for the extension.
    const grant = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    grant.getTracks().forEach(t => t.stop());
  } catch (error) {
    busy = false;
    renderControls();
    renderTimers();
    $('status').textContent = `${error.name || 'Error'}: ${error.message}`;
    $('timer-off-note').textContent = `${error.name || 'Error'}: ${error.message}`;
    return;
  }
  // The service worker hands the saved calibration to the engine, so a finished setup
  // starts already calibrated.
  const next = await ask('ENGINE_START');
  busy = false;
  render(next, { fromEngine: false });
  if (running()) showPage(homePage());
}

$('start').addEventListener('click', startCamera);
$('timer-start').addEventListener('click', startCamera);

$('stop').addEventListener('click', async () => {
  await ask('ENGINE_STOP');
  render(null, { fromEngine: false });
});

// Step 1 starts the automatic run: it fills, pauses a moment, then step 2 fills by itself.
$('calibrate-screen').addEventListener('click', async () => {
  render(await ask('ENGINE_CALIBRATE', { kind: 'screen', auto: true }), { fromEngine: false });
});

// Step 2 on its own (redo just the looking-away part).
$('calibrate-away').addEventListener('click', async () => {
  render(await ask('ENGINE_CALIBRATE', { kind: 'away' }), { fromEngine: false });
});

$('go-timer').addEventListener('click', () => { if (isCalibrated()) showPage("timer"); });
$('settings-nav').addEventListener('click', () => showPage("settings"));
$('home-nav').addEventListener('click', () => showPage(homePage()));
$('info-nav').addEventListener('click', event => {
  event.stopPropagation();
  setPrivacyOpen($('privacy-panel').hidden);
});
// Clicking anywhere else, or pressing Escape, closes the popover.
document.addEventListener('click', event => {
  if (!$('privacy-panel').hidden && !$('privacy-panel').contains(event.target)) setPrivacyOpen(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') setPrivacyOpen(false);
});
document.querySelectorAll('[data-nav]').forEach(button => {
  button.addEventListener('click', () => {
    const page = button.dataset.nav;
    if (page === "timer" && !isCalibrated()) return;
    if (page === "calibration" && !running()) return;
    showPage(page);
  });
});

// ---- timer length settings (saved in chrome.storage; the service worker tells the engine) ----
function fillSettings(s) {
  $('screen-minutes').value = s.screenMinutes;
  $('break-seconds').value = s.breakSeconds;
}
$('save-settings').addEventListener('click', async () => {
  const asked = { screenMinutes: $('screen-minutes').value, breakSeconds: $('break-seconds').value };
  const clean = clampSettings(asked);
  const raised = Number(asked.screenMinutes) < clean.screenMinutes || Number(asked.breakSeconds) < clean.breakSeconds;
  await saveSettings(clean);
  fillSettings(clean);
  savedLimits = toLimits(clean);
  $('settings-message').textContent = raised ? 'Saved. Values below the minimum were raised to 20.' : 'Saved.';
  if (!running()) renderTimers();
});
$('reset-settings').addEventListener('click', async () => {
  await saveSettings(DEFAULTS);
  fillSettings(DEFAULTS);
  savedLimits = toLimits(DEFAULTS);
  $('settings-message').textContent = 'Reset to the default (20 minutes, 20 seconds).';
  if (!running()) renderTimers();
});
loadSettings().then(s => { fillSettings(s); savedLimits = toLimits(s); if (!running()) renderTimers(); });

// ---- alert switches (the service worker reads them from storage) ----
const lightingToggle = $('notify-lighting-toggle');
const breaksToggle = $('notify-breaks-toggle');
loadPrefs().then(p => {
  lightingToggle.checked = p.lighting;
  breaksToggle.checked = p.breaks;
});
const saveAlertSwitches = () => savePrefs({ lighting: lightingToggle.checked, breaks: breaksToggle.checked });
lightingToggle.addEventListener('change', saveAlertSwitches);
breaksToggle.addEventListener('change', saveAlertSwitches);

// ---- light / dark mode (theme.js applies the saved choice before the page paints) ----
const THEME_KEY = 'headInTheClouds.theme';
const toggle = $('theme-toggle');
toggle.checked = document.documentElement.dataset.theme === 'dark';
toggle.addEventListener('change', () => {
  const theme = toggle.checked ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch (error) { /* storage blocked: applies this session only */ }
});

// ---- saved setup ----
function readSavedSetup(stored) {
  return Boolean(sanitizeCalibration(stored?.[CALIBRATION_KEY]));
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[CALIBRATION_KEY]) return;
  setupDone = Boolean(sanitizeCalibration(changes[CALIBRATION_KEY].newValue));
  updateSetupClass();
  updateHomeArrow();
});

// ---- live updates from the engine ----
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'ENGINE_STATE') render(message.state);
  if (message?.type === 'ENGINE_PREVIEW' && currentPage === "calibration") drawPreview(message.image);
});

initNotificationPrompt();
render(null, { fromEngine: false });

// Closing the popup must not stop the engine, so there is no pagehide handler. On open,
// read the saved setup and the engine's state together, then land on the right page.
Promise.all([
  chrome.storage.local.get(CALIBRATION_KEY),
  ask('ENGINE_GET_STATE')
]).then(([stored, engineState]) => {
  setupDone = readSavedSetup(stored);
  render(engineState, { fromEngine: false });
  showPage(homePage());
});
