// Popup UI. The camera, face tracking, lighting check and timers run in the background
// engine (offscreen.html), so closing this popup does not stop anything. This page only
// shows the engine's latest state and sends it commands.
import { renderLighting, resetLighting, setLightingStatus } from './webcam-darkness/lighting-ui.js';
import { loadSettings, toLimits } from './settings.js';
import { initNotificationPrompt } from './webcam-darkness/notification-prompt.js';

const $ = id => document.getElementById(id);
const fmt = n => Number.isFinite(n) ? n.toFixed(3) : '—';

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

// Send a command to the engine through the service worker.
const ask = (command, extra = {}) =>
  chrome.runtime.sendMessage({ type: 'ENGINE_REQUEST', command, ...extra });

let savedLimits = { screenLimit: 20 * 60 * 1000, awayLimit: 20 * 1000 };
loadSettings().then(s => {
  savedLimits = toLimits(s);
  // Only the idle labels change; a running engine sends its own limits.
  $('screen-note').textContent = `Resets every ${Math.round(savedLimits.screenLimit / 60000)} minutes`;
  $('away-note').textContent = `Resets every ${Math.round(savedLimits.awayLimit / 1000)} seconds`;
});

function renderTimers(timers) {
  const t = timers || { ...savedLimits, screenTime: 0, awayTime: 0 };
  $('screen-timer').textContent = formatTime(t.screenTime);
  $('away-timer').textContent = formatTime(t.awayTime);
  $('screen-progress').style.width = `${(t.screenTime / t.screenLimit) * 100}%`;
  $('away-progress').style.width = `${(t.awayTime / t.awayLimit) * 100}%`;
  $('screen-note').textContent = `Resets every ${Math.round(t.screenLimit / 60000)} minutes`;
  $('away-note').textContent = `Resets every ${Math.round(t.awayLimit / 1000)} seconds`;
}

function renderAttention(a) {
  const f = a.features;
  $('attention').textContent = a.label;
  $('detail').textContent = a.reason || 'No gaze estimate yet.';
  $('faces').textContent = a.faces;
  $('landmarks').textContent = a.landmarks;
  $('head-x').textContent = fmt(f?.headX);
  $('head-y').textContent = fmt(f?.headY);
  $('gaze-x').textContent = fmt(f?.gazeX);
  $('gaze-y').textContent = fmt(f?.gazeY);
  const counts = `S:${a.screenCount} A:${a.awayCount}`;
  $('progress').textContent = a.progress != null ? `${a.progress}/30` : counts;
  $('delta').textContent = counts;
}

function renderControls(running, busy) {
  $('start').disabled = running || busy;
  $('stop').disabled = !running;
  $('calibrate-screen').disabled = !running;
  $('calibrate-away').disabled = !running;
}

let busy = false;

// state is null when the engine is not running.
function render(state) {
  if (!state || state.error) {
    renderControls(false, busy);
    renderTimers(null);
    $('attention').textContent = 'Unknown';
    $('status').textContent = state?.error ? `Error: ${state.error}` : 'Camera off';
    resetLighting('Camera off');
    return;
  }

  renderControls(state.running, busy);
  renderTimers(state.timers);
  renderAttention(state.attention);
  $('status').textContent = state.status;

  const lighting = state.lighting;
  if (state.running && lighting.state && lighting.state.label) {
    renderLighting({ reading: lighting.reading, state: lighting.state });
    setLightingStatus(lighting.status);
  } else {
    resetLighting(lighting.error || lighting.status || 'Waiting for camera');
  }
}

$('start').addEventListener('click', async () => {
  busy = true;
  renderControls(false, true);
  $('status').textContent = 'Requesting camera permission…';
  try {
    // The hidden engine page cannot show Chrome's permission prompt, so ask here.
    // Chrome remembers the answer for the extension.
    const grant = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    grant.getTracks().forEach(t => t.stop());
  } catch (error) {
    busy = false;
    $('status').textContent = `${error.name || 'Error'}: ${error.message}`;
    renderControls(false, false);
    return;
  }
  const state = await ask('ENGINE_START');
  busy = false;
  render(state);
});

$('stop').addEventListener('click', async () => {
  render(await ask('ENGINE_STOP'));
  render(null);
});

$('calibrate-screen').addEventListener('click', async () => render(await ask('ENGINE_CALIBRATE', { kind: 'screen' })));
$('calibrate-away').addEventListener('click', async () => render(await ask('ENGINE_CALIBRATE', { kind: 'away' })));

// Live updates from the engine while the popup is open.
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'ENGINE_STATE') render(message.state);
});

$('settings-open').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
});

initNotificationPrompt();
render(null);
// Closing the popup must not stop the engine, so there is no pagehide handler. When the
// popup opens it asks for the current state and picks up where the engine is.
ask('ENGINE_GET_STATE').then(render);
