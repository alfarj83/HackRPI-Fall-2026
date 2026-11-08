// Popup UI. The camera, face tracking, calibration, lighting check and timers all run in
// the background engine (offscreen.html), so closing this popup does not stop anything.
// This page shows the engine's latest state and sends it commands.
import { renderLighting, resetLighting, setLightingStatus } from './webcam-darkness/lighting-ui.js';
import { messageFor } from './webcam-darkness/darkness.js';
import { initNotificationPrompt } from './webcam-darkness/notification-prompt.js';
import { loadSettings, saveSettings, clampSettings, toLimits, DEFAULTS } from './settings.js';

const pages = ["permission", "calibration", "timer", "settings"];
const $ = id => document.getElementById(id);
const fmt = n => Number.isFinite(n) ? n.toFixed(3) : '—';

let state = null;            // latest engine snapshot, or null when the engine is off
let busy = false;            // true while the camera is starting
let currentPage = "permission";
let savedLimits = toLimits(DEFAULTS);

// ---- engine commands ----
const ask = (command, extra = {}) =>
  chrome.runtime.sendMessage({ type: 'ENGINE_REQUEST', command, ...extra });

const running = () => Boolean(state?.running);
const calibration = () => state?.calibration || { active: null, hasScreen: false, hasAway: false, progress: 0 };
const isCalibrated = () => running() && calibration().hasScreen && calibration().hasAway;

// ---- pages ----
function showPage(page) {
  if (!pages.includes(page)) return;
  currentPage = page;
  for (const name of pages) $("page-" + name).hidden = name !== page;
  document.querySelectorAll("[data-nav]").forEach(button => {
    button.classList.toggle("active", button.dataset.nav === page);
  });
  updatePreviewRequests();
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
function drawPreview(dataUrl) {
  const image = new Image();
  image.onload = () => {
    if (previewCanvas.width !== image.width) previewCanvas.width = image.width;
    if (previewCanvas.height !== image.height) previewCanvas.height = image.height;
    previewCtx.drawImage(image, 0, 0);
  };
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
  const minutes = Math.round(t.screenLimit / 60000);
  const seconds = Math.round(t.awayLimit / 1000);

  $("screen-timer").textContent = formatTime(Math.ceil(Math.max(0, t.screenLimit - t.screenTime) / 1000) * 1000);
  $("away-timer").textContent = formatTime(onBreak
    ? Math.ceil(Math.max(0, t.awayLimit - t.awayTime) / 1000) * 1000
    : t.awayTime);
  $("screen-progress").style.width = `${Math.min(100, t.screenTime / t.screenLimit * 100)}%`;
  $("away-progress").style.width = `${Math.min(100, t.awayTime / t.awayLimit * 100)}%`;
  $("timer-heading").textContent = onBreak ? "Time to look away!" : "Time to focus.";
  $("timer-description").textContent = onBreak
    ? `Look away until your ${seconds}-second break finishes.`
    : `Your next break starts after ${minutes} minutes of detected screen viewing.`;
}

function renderAttention() {
  const a = state?.attention;
  $('attention').textContent = a ? a.label : 'Unknown';
  $('tracking-indicator').textContent = running() ? a.label : 'Camera not started';
  $('detail').textContent = a?.reason || 'No gaze estimate yet.';
  const f = a?.features;
  $('faces').textContent = a?.faces ?? 0;
  $('landmarks').textContent = a?.landmarks ?? 0;
  $('head-x').textContent = fmt(f?.headX);
  $('head-y').textContent = fmt(f?.headY);
  $('gaze-x').textContent = fmt(f?.gazeX);
  $('gaze-y').textContent = fmt(f?.gazeY);
  const counts = `S:${a?.screenCount ?? 0} A:${a?.awayCount ?? 0}`;
  $('progress').textContent = a?.progress != null ? `${a.progress}/30` : counts;
  $('delta').textContent = counts;
}

function renderCalibration() {
  const c = calibration();
  const completed = Number(c.hasScreen) + Number(c.hasAway);
  $("calibrate-screen").disabled = !running() || c.active !== null;
  $("calibrate-away").disabled = !running() || !c.hasScreen || c.active !== null;
  $("go-timer").disabled = !(c.hasScreen && c.hasAway);
  if (c.active) {
    $("calibration-message").textContent = `Recording ${c.active}: ${c.progress}/30 samples`;
    $("calibration-bar").style.width = `${(completed * 30 + c.progress) / 60 * 100}%`;
  } else {
    $("calibration-message").textContent = `${completed} of 2 steps complete`;
    $("calibration-bar").style.width = `${completed * 50}%`;
    if (c.hasScreen && c.hasAway) $("calibration-hint").textContent = "Calibration complete!";
    else if (c.hasScreen) $("calibration-hint").textContent = "Great! Now look away and record that position.";
  }
}

function renderLightingSection() {
  const lighting = state?.lighting;
  if (running() && lighting?.state?.label) {
    renderLighting({ reading: lighting.reading, state: lighting.state });
    setLightingStatus(lighting.status);
    $('light-chip').textContent = messageFor(lighting.state);
    $('light-chip').dataset.level = lighting.state.label;
  } else {
    resetLighting(lighting?.error || (running() ? lighting?.status : 'Camera off') || 'Camera off');
    $('light-chip').textContent = '';
    $('light-chip').dataset.level = 'unknown';
  }
  $('light-chip').hidden = !running() || !lighting?.state?.label;
}

function renderControls() {
  $('start').disabled = running() || busy;
  $('stop').disabled = !running();
  $('status').textContent = busy ? 'Requesting camera permission…' : (state?.status || 'Camera off');
}

function render(next, { fromEngine = true } = {}) {
  const wasCalibrated = isCalibrated();
  const wasRunning = running();
  state = next && !next.error ? next : null;
  if (next?.error) $('status').textContent = `Error: ${next.error}`;

  renderControls();
  renderTimers();
  renderAttention();
  renderCalibration();
  renderLightingSection();

  // Follow the engine: finishing calibration opens the timer, a stopped camera goes back.
  if (fromEngine) {
    if (running() && !wasCalibrated && isCalibrated() && currentPage === "calibration") showPage("timer");
    if (wasRunning && !running() && currentPage !== "settings") showPage("permission");
  }
  updatePreviewRequests();
}

// ---- buttons ----
$('start').addEventListener('click', async () => {
  busy = true;
  renderControls();
  try {
    // The hidden engine page cannot show Chrome's permission prompt, so ask here.
    // Chrome remembers the answer for the extension.
    const grant = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    grant.getTracks().forEach(t => t.stop());
  } catch (error) {
    busy = false;
    renderControls();
    $('status').textContent = `${error.name || 'Error'}: ${error.message}`;
    return;
  }
  const next = await ask('ENGINE_START');
  busy = false;
  render(next, { fromEngine: false });
  if (running()) showPage("calibration");
});

$('stop').addEventListener('click', async () => {
  await ask('ENGINE_STOP');
  render(null, { fromEngine: false });
});

$('calibrate-screen').addEventListener('click', async () => {
  $('calibration-hint').textContent = "Keep looking at your normal screen-reading area.";
  render(await ask('ENGINE_CALIBRATE', { kind: 'screen' }), { fromEngine: false });
});

$('calibrate-away').addEventListener('click', async () => {
  $('calibration-hint').textContent = "Look away from the screen and hold that position.";
  render(await ask('ENGINE_CALIBRATE', { kind: 'away' }), { fromEngine: false });
});

$('go-timer').addEventListener('click', () => { if (isCalibrated()) showPage("timer"); });
$('recalibrate').addEventListener('click', () => showPage("calibration"));
$('settings-nav').addEventListener('click', () => showPage("settings"));
$('back-to-timer').addEventListener('click', () => showPage(isCalibrated() ? "timer" : "permission"));
$('restart-camera').addEventListener('click', async () => {
  await ask('ENGINE_STOP');
  render(null, { fromEngine: false });
  showPage("permission");
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

// ---- live updates from the engine ----
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'ENGINE_STATE') render(message.state);
  if (message?.type === 'ENGINE_PREVIEW' && currentPage === "calibration") drawPreview(message.image);
});

initNotificationPrompt();
showPage("permission");
render(null, { fromEngine: false });

// Closing the popup must not stop the engine, so there is no pagehide handler. On open,
// ask for the current state and land on the page that matches it.
ask('ENGINE_GET_STATE').then(next => {
  render(next, { fromEngine: false });
  if (running()) showPage(isCalibrated() ? "timer" : "calibration");
});
