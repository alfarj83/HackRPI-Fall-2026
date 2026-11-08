import { generateWeeklyInsights } from "./gemini.js";
import { getWeeklyStatistics } from "./weekly-stats.js";
import { renderWeeklyScreenChart } from "./weekly-charts.js";
import { GUIDED_STEPS, ARROWS, SAMPLES_PER_STEP } from './engine/guided-steps.js';
// MERGED UI + CALIBRATION ERGONOMICS. The camera and training still run in
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

// Audio feedback after each *engine-confirmed* calibration stage.
// Requires no external audio file and uses a user click to unlock Web Audio.
let calibrationAudio = null;
let observedCalibration = null;
let calibrationSoundArmed = false;
let startingCamera = false;
let cameraErrorMessage = null;

function enableCalibrationAudio() {
  try {
    if (!calibrationAudio) calibrationAudio = new AudioContext();
    if (calibrationAudio.state === 'suspended') {
      void calibrationAudio.resume().catch(console.warn);
    }
  } catch (error) {
    console.warn('Calibration audio unavailable:', error);
  }
}

function playCalibrationDing(final = false) {
  if (!calibrationAudio || calibrationAudio.state !== 'running') return;
  const now = calibrationAudio.currentTime;
  const oscillator = calibrationAudio.createOscillator();
  const gain = calibrationAudio.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(final ? 1175 : 880, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.10, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  oscillator.connect(gain);
  gain.connect(calibrationAudio.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.25);
}

function watchCalibrationCompletion(c) {
  const g = c?.guided;
  if (!g) return;
  const completed = g.completedSteps || 0;
  if (observedCalibration !== null && calibrationSoundArmed && completed > observedCalibration) {
    playCalibrationDing(completed >= GUIDED_STEPS.length);
  }
  observedCalibration = completed;
  if (completed >= GUIDED_STEPS.length) calibrationSoundArmed = false;
}

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
  if (calibration()?.guided?.active) return "calibration";
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
  // The target must stay visible while the engine is collecting samples.
  if (calibration()?.guided?.active && page !== 'calibration') return;
  currentPage = page;
  for (const name of pages) $("page-" + name).hidden = name !== page;
  document.querySelectorAll("[data-nav]").forEach(button => {
    button.classList.toggle("active", button.dataset.nav === page);
  });
  updateSetupClass();
  updateHomeArrow();
  updatePreviewRequests();
  if (state) renderCalibration();
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
  const wanted = currentPage === "calibration" && running() && !calibration()?.guided?.active;
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
  const cameraStatus = $("timer-camera-status");
  if (cameraStatus) {
    setText(cameraStatus, running()
      ? `Camera is on · ${state?.status || 'Tracking active'}${isCalibrated() ? ' · Calibration saved' : ' · Calibration needed'}`
      : `Camera is off${cameraErrorMessage ? ': ' + cameraErrorMessage : '. Click Start camera below to enable it.'}`);
  }
  // Distinguish a stalled timer from a classifier that has not identified screen gaze.
  // Do not count uncertain/no-face periods as screen time.
  const attention = state?.attention || {};
  const gazeState = attention.state || 'unknown';
  // const gazeLabels = {
  //   'likely-screen': 'Looking at screen — countdown running',
  //   'likely-away': onBreak ? 'Looking away — break countdown running' : 'Looking away — screen countdown paused',
  //   'calibrating': 'Calibration in progress — countdown paused',
  //   'uncalibrated': 'Calibration needed — countdown paused',
  //   'uncertain': 'Gaze uncertain — countdown paused',
  //   'unknown': 'Gaze not detected — countdown paused'
  // };
  //const gazeStatus = $('timer-attention-status');
  // if (gazeStatus) setText(gazeStatus, off
  //   ? 'Camera off — countdown paused'
  //   : (gazeLabels[gazeState] || `Tracking: ${gazeState}`));
  const gazeDetail = $('timer-attention-detail');
  if (gazeDetail) {
    const reason = typeof attention.reason === 'string' ? attention.reason.trim() : '';
    setText(gazeDetail, off
      ? 'Start the camera to resume screen-viewing detection.'
      : gazeState === 'likely-screen'
        ? 'Only confirmed screen-viewing time is counted. The display updates once per second.'
        : reason || 'Face the camera and look normally at your screen. If this persists, recalibrate.');
  }

  const calibrateButton = $("timer-calibrate");
  if (calibrateButton) {
    calibrateButton.disabled = busy;
    setText(calibrateButton, isCalibrated() ? 'Recalibrate on current webpage' : 'Calibrate on current webpage');
  }
}

function renderCalibration() {
  const c = calibration();
  const g = c.guided || { active:false, stepIndex:0, collected:0, completedSteps:0, samplesRequired:SAMPLES_PER_STEP };
  // Sound and guided-target visuals are owned by calibration.html.
  // The popup only offers a launch button and displays progress.
  const busyNow = Boolean(g.active || c.active !== null || c.pauseLeftMs > 0);
  setDisabled($('guided-calibrate'), !running() || busyNow);
  setDisabled($('go-timer'), !(c.hasScreen && c.hasAway));
  setHidden($('calibration-panel'), true);
  setHidden($('calibration-overlay'), true);
  const count = g.completedSteps || 0;
  const step = GUIDED_STEPS[Math.min(g.stepIndex || 0, GUIDED_STEPS.length-1)];
  if (g.active) {
    setText($('calibration-step'), `Target ${(g.stepIndex || 0) + 1} of ${GUIDED_STEPS.length}`);
    setText($('calibration-mode'), step.label === 'screen'
      ? `LOOK AT THE ${step.direction.toUpperCase()} DOT`
      : `LOOK ${step.direction.toUpperCase()} BEYOND THE MONITOR`);
    setText($('calibration-help'), step.label === 'screen'
      ? 'Follow the dot with your eyes; keep your face comfortable.'
      : 'Look just beyond the screen, keeping your eyes visible to the webcam.');
    setText($('calibration-progress'), g.settleRemainingMs > 0
      ? `Get ready: ${Math.ceil(g.settleRemainingMs / 1000)}s`
      : g.rejectionReason
        ? `Paused at ${g.collected}/${SAMPLES_PER_STEP}: ${g.rejectionReason}`
        : `Recording ${g.collected}/${SAMPLES_PER_STEP} valid frames`);
    const target = $('calibration-target');
    target.textContent = step.label === 'screen' ? '●' : ARROWS[step.direction];
    target.classList.toggle('away-target', step.label === 'away');
    target.style.left = `${step.x ?? 50}%`;
    target.style.top = `${step.y ?? 50}%`;
    setText($('calibration-message'), `Target ${(g.stepIndex || 0) + 1} of ${GUIDED_STEPS.length}`);
    setText($('calibration-hint'), 'Calibration is running over your active webpage.');
  } else {
    setText($('calibration-message'), c.hasScreen && c.hasAway
      ? 'Nine targets complete. Press Start Timer.'
      : `${count} of ${GUIDED_STEPS.length} targets complete`);
    setText($('calibration-hint'), c.hasScreen && c.hasAway
      ? 'Calibration is saved locally.'
      : 'Open the overlay on an ordinary webpage to follow the dots and arrows.');
  }
  setBar(g.active ? (count + g.collected / SAMPLES_PER_STEP) / GUIDED_STEPS.length
    : c.hasScreen && c.hasAway ? 1 : 0);
}

function renderControls() {
  setDisabled($('start'), running() || busy);
  setDisabled($('stop'), !running());
  setText($('status'), busy ? 'Requesting camera permission…' : (cameraErrorMessage || state?.status || 'Camera off'));
}

function render(next, { fromEngine = true } = {}) {
  const wasRunning = running();
  state = next && !next.error ? next : null;
  renderControls();
  renderTimers();
  renderCalibration();
  updateSetupClass();
  updateHomeArrow();
  if (next?.error) setText($('status'), `Error: ${next.error}`);

  // Follow the engine: a stopped camera goes home.
  if (fromEngine) {
    // Finishing calibration does NOT leave the page. The user presses "Start Timer".
    if (wasRunning && !running() && currentPage !== "settings") showPage(homePage());
  }
  updatePreviewRequests();
}

// ---- starting the camera (used by the welcome page and the timer page) ----
async function startCamera() {
  if (startingCamera || running()) return;
  startingCamera = true;
  cameraErrorMessage = null;
  busy = true;
  renderControls();
  renderTimers();
  let grant = null;
  try {
    // The offscreen engine cannot display the camera permission dialog.
    // Ask from this visible user-initiated popup, then immediately release it.
    grant = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    grant.getTracks().forEach(track => track.stop());
    grant = null;

    // The service worker transfers the saved calibration to the engine.
    const next = await ask('ENGINE_START');
    if (next?.error) throw new Error(next.error);
    render(next, { fromEngine: false });
    if (running()) showPage(homePage());
    else {
      cameraErrorMessage = next?.status || 'Camera did not start. Check the background engine.';
      setText($('status'), cameraErrorMessage);
      renderTimers();
    }
  } catch (error) {
    const message = error?.name === 'NotAllowedError'
      ? 'Camera permission denied or dismissed. Allow access, then retry.'
      : error?.name === 'NotFoundError'
      ? 'No camera was found.'
      : error?.name === 'NotReadableError'
      ? 'The camera is unavailable or in use by another application.'
      : `${error?.name || 'Error'}: ${error?.message || 'Camera failed'}`;
    cameraErrorMessage = message;
    setText($('status'), message);
    setText($('timer-off-note'), message);
    console.error('Camera startup failed:', error);
  } finally {
    grant?.getTracks().forEach(track => track.stop());
    busy = false;
    startingCamera = false;
    renderControls();
    renderTimers();
  }
}

$('start').addEventListener('click', startCamera);
$('timer-start').addEventListener('click', startCamera);
$('timer-calibrate').addEventListener('click', () => {
  // Users with old saved calibration normally land directly on the timer.
  // Keep a visible route back to guided calibration and allow camera restart.
  if (!running()) {
    showPage('permission');
    setText($('status'), cameraErrorMessage || 'Enable Camera to begin calibration.');
    return;
  }
  showPage('calibration');
});

$('stop').addEventListener('click', async () => {
  try {
    const result = await ask('ENGINE_STOP');
    if (result?.error) throw new Error(result.error);
    calibrationSoundArmed = false;
    cameraErrorMessage = null;
    render(null, { fromEngine: false });
  } catch (error) {
    setText($('status'), `Could not stop tracking: ${error.message}`);
  }
});

$('guided-calibrate').addEventListener('click', async () => {
  const button = $('guided-calibrate');
  button.disabled = true;
  try {
    if (!running()) throw new Error('Enable the camera before calibration.');
    // This is called directly from a toolbar button click, which grants activeTab.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) {
      throw new Error('Open an ordinary https:// webpage and try again. Chrome pages, the Web Store, and new-tab pages do not support injection.');
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      files: ['calibration-overlay.js']
    });
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'HEADCLOUD_CALIBRATION_START' });
    if (!reply?.ok) throw new Error(reply?.error || 'The calibration overlay did not start.');
    window.close();
  } catch (error) {
    console.error('Could not open calibration overlay:', error);
    setText($('calibration-message'), `Could not open calibration: ${error.message}`);
    button.disabled = false;
  }
});
$('cancel-calibration').addEventListener('click', async () => {
  try {
    // Requires ENGINE_CALIBRATE_CANCEL in your service worker, forwarding
    // to engine.cancelGuided() in the offscreen document.
    const next = await ask('ENGINE_CALIBRATE_CANCEL');
    if (next?.error) throw new Error(next.error);
    calibrationSoundArmed = false;
    render(next, { fromEngine: false });
  } catch (error) {
    setText($('calibration-message'), `Could not cancel: ${error.message}`);
  }
});

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
  $('settings-message').textContent = raised ? 'Saved. Values below the smallest allowed (0.1 minutes, 1 second) were raised to it.' : 'Saved.';
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


// ---- weekly AI report (only aggregate statistics are sent) ----
const weeklyButton = $('generate-weekly-summary');
const weeklyStatus = $('weekly-ai-status');
const weeklyResult = $('weekly-ai-result');
const weeklyTotals = $('weekly-ai-totals');

function formatHours(ms) {
  const totalMinutes = Math.round(ms / 60000);
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

async function refreshWeeklySummaryPreview() {
  const week = await getWeeklyStatistics();
  if (!weeklyTotals) return;
  const hasRecords = week.daily.some(day => day.recorded);
  weeklyTotals.textContent = hasRecords
    ? `Past 7 days: ${formatHours(week.totals.screenMs)} of screen viewing · ${week.totals.breaks} completed breaks.`
    : 'No saved daily statistics yet. The background timer alone does not create weekly records.';

  // After loading the weekly statistics:
  renderWeeklyScreenChart(week.daily);
}

weeklyButton?.addEventListener('click', async () => {
  weeklyButton.disabled = true;
  weeklyResult.textContent = '';
  weeklyStatus.textContent = 'Reading your weekly activity…';
  try {
    const week = await getWeeklyStatistics();
    if (!week.daily.some(day => day.recorded)) {
      weeklyStatus.textContent = 'No daily tracking records are available yet. Enable daily statistics collection before generating reports.';
      return;
    }
    if (!week.daily.some(day => day.screenMs > 0 || day.awayMs > 0 || day.breaks > 0)) {
      weeklyStatus.textContent = 'Saved records contain no tracked activity yet.';
      return;
    }
    weeklyStatus.textContent = 'Generating your report…';
    weeklyResult.textContent = await generateWeeklyInsights(week);
    weeklyStatus.textContent = 'Weekly summary generated.';
    await refreshWeeklySummaryPreview();
  } catch (error) {
    console.error('Weekly AI summary failed:', error);
    weeklyStatus.textContent = 'Could not generate the weekly summary.';
    weeklyResult.textContent = error.message || String(error);
  } finally {
    weeklyButton.disabled = false;
  }
});

void refreshWeeklySummaryPreview().catch(error => {
  console.error('Unable to load weekly statistics:', error);
  if (weeklyTotals) weeklyTotals.textContent = 'Unable to load weekly statistics.';
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some(key => key.startsWith('eyeease-stats-'))) {
    void refreshWeeklySummaryPreview().catch(console.error);
  }
});

// ---- full reset: return to first-time setup ----
$('reset-everything').addEventListener('click', async () => {
  const confirmed = window.confirm(
    'Reset Head in the Clouds?\n\n' +
    'This will stop tracking, delete your saved calibration ' +
    'and settings, and return you to the beginning.'
  );

  if (!confirmed) return;

  const button = $('reset-everything');
  const message = $('reset-everything-message');

  button.disabled = true;
  message.textContent = 'Resetting everything...';

  try {
    // Stop the camera and background engine first.
    const result = await ask('ENGINE_STOP');

    if (result?.error) {
      throw new Error(result.error);
    }

    // Forget all extension data saved in chrome.storage.local.
    await chrome.storage.local.clear();

    // Forget the saved appearance setting.
    localStorage.removeItem('headInTheClouds.theme');

    // Restart the popup. Without a saved calibration,
    // the existing startup code opens the Welcome screen.
    window.location.reload();

  } catch (error) {
    console.error('Full reset failed:', error);
    message.textContent =
      `Could not finish resetting: ${error.message}`;
    button.disabled = false;
  }
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
