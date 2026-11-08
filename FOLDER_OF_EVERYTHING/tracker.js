import { FaceLandmarker, FilesetResolver, DrawingUtils } from './vendor/vision_bundle.mjs';
import { AttentionDetector } from './attention.js';
import { HeadCloudStats } from './statistics.js';
import { GuidedCalibration, enableCalibrationAudio } from './calibration.js';

// This version matches tracker.html's four-page wizard. It uses the same
// statistics module, MediaPipe model, classifier and calibration module as
// your uploaded tracker.js. Do not run two tracker instances simultaneously.
const SCREEN_LIMIT = 20 * 60 * 1000;
const AWAY_LIMIT = 20 * 1000;
const $ = id => document.getElementById(id);

const REQUIRED_IDS = [
  'start', 'stop', 'guided-calibrate', 'cancel-calibration',
  'webcam', 'overlay', 'status', 'attention', 'detail',
  'faces', 'landmarks', 'head-x', 'head-y', 'gaze-x', 'gaze-y',
  'progress', 'delta', 'screen-timer', 'away-timer',
  'screen-progress', 'away-progress', 'calibration-panel',
  'calibration-overlay', 'calibration-target', 'calibration-step',
  'calibration-mode', 'calibration-help', 'calibration-progress'
];
const missing = REQUIRED_IDS.filter(id => !$(id));
if (missing.length) {
  throw new Error(`Tracker HTML is missing required IDs: ${missing.join(', ')}`);
}

const video = $('webcam');
const canvas = $('overlay');
const ctx = canvas.getContext('2d');
const inputCanvas = document.createElement('canvas');
const inputCtx = inputCanvas.getContext('2d', { willReadFrequently: true });
const detector = new AttentionDetector();
const stats = new HeadCloudStats();
let statsLoaded = false;
const statsReady = stats.load().then(() => {
  statsLoaded = true;
}).catch(error => {
  console.error('Could not load daily statistics:', error);
  throw error;
});

let landmarker = null;
let stream = null;
let running = false;
let starting = false;
let disposed = false;
let raf = null;
let lastVideoTime = -1;
let lastRun = -Infinity;
let screenTime = 0;
let awayTime = 0;
let currentAttentionState = 'unknown';
let lastTimerUpdate = null;
let lastPredictionTime = null;
let lastDisplayedStableState = null;
let lastDisplayedStableTime = 0;

const labels = {
  'likely-screen': 'Likely looking at screen',
  'likely-away': 'Likely looking away',
  'calibrating': 'Calibrating…',
  'unknown': 'Unknown',
  'uncertain': 'Checking gaze direction…',
  'uncalibrated': 'Calibration required'
};

function setDisabled(id, disabled) {
  const element = $(id);
  if (element) element.disabled = disabled;
}

function showPage(page) {
  for (const section of document.querySelectorAll('.app-page')) {
    section.hidden = section.dataset.page !== page;
  }
  for (const button of document.querySelectorAll('[data-go]')) {
    const active = button.dataset.go === page;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  }
}

document.querySelectorAll('[data-go]').forEach(button => {
  button.addEventListener('click', () => showPage(button.dataset.go));
});

function setRunningButtons(isRunning) {
  setDisabled('start', isRunning || starting);
  setDisabled('stop', !isRunning);
  setDisabled('guided-calibrate', !isRunning || guided.active);
  setDisabled('recalibrate', !isRunning || guided.active);
}

const guided = new GuidedCalibration(detector, {
  overlay: $('calibration-overlay'),
  panel: $('calibration-panel'),
  step: $('calibration-step'),
  mode: $('calibration-mode'),
  help: $('calibration-help'),
  progress: $('calibration-progress'),
  target: $('calibration-target')
}, () => {
  $('calibration-overlay').hidden = true;
  $('calibration-panel').hidden = true;
  $('status').textContent = 'Guided calibration complete. Tracking is ready.';
  $('calibration-message').textContent = 'Calibration complete.';
  setRunningButtons(running);
  showPage('timer');
});

function cancelCalibration() {
  if (!guided.active) return;
  guided.cancel();
  $('calibration-overlay').hidden = true;
  $('calibration-panel').hidden = true;
  currentAttentionState = 'unknown';
  stats.pause();
  $('calibration-message').textContent = 'Calibration cancelled. Please restart calibration.';
  $('status').textContent = 'Calibration cancelled.';
  setRunningButtons(running);
}

const fmt = value => Number.isFinite(value) ? value.toFixed(3) : '—';

function renderDiagnostics(result, prediction) {
  const features = prediction.features;
  const reason = prediction.reason || '';
  const blinkNoise = prediction.state === 'unknown' &&
    (reason.includes('Blink') || reason.includes('Iris'));

  if (prediction.state === 'likely-screen' || prediction.state === 'likely-away') {
    lastDisplayedStableState = prediction.state;
    lastDisplayedStableTime = performance.now();
  }
  const displayed = blinkNoise && lastDisplayedStableState &&
    performance.now() - lastDisplayedStableTime < 650
      ? lastDisplayedStableState : prediction.state;

  $('attention').textContent = labels[displayed] || displayed;
  $('detail').textContent = reason;
  $('faces').textContent = String(result.faceLandmarks?.length || 0);
  $('landmarks').textContent = String(result.faceLandmarks?.[0]?.length || 0);
  $('head-x').textContent = fmt(features?.headX);
  $('head-y').textContent = fmt(features?.headY);
  $('gaze-x').textContent = fmt(features?.gazeX);
  $('gaze-y').textContent = fmt(features?.gazeY);
  $('progress').textContent = guided.active
    ? `Target ${guided.stepIndex + 1}/9`
    : `S:${detector.classifier.count('screen')} A:${detector.classifier.count('away')}`;
  $('delta').textContent =
    `S:${detector.classifier.count('screen')} A:${detector.classifier.count('away')}`;
}

function draw(result) {
  const width = inputCanvas.width;
  const height = inputCanvas.height;
  if (!width || !height) return;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(inputCanvas, 0, 0);

  const drawingUtils = new DrawingUtils(ctx);
  for (const points of result.faceLandmarks || []) {
    drawingUtils.drawConnectors(points, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
      { color: '#70e9ba', lineWidth: 2 });
    drawingUtils.drawConnectors(points, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
      { color: '#66d9ff', lineWidth: 2 });
    drawingUtils.drawConnectors(points, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
      { color: '#66d9ff', lineWidth: 2 });
    if (points.length >= 478) {
      drawingUtils.drawConnectors(points, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
        { color: '#ffd966', lineWidth: 2 });
      drawingUtils.drawConnectors(points, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
        { color: '#ffd966', lineWidth: 2 });
    }
    const nose = points[1];
    if (nose) {
      ctx.beginPath();
      ctx.arc(nose.x * width, nose.y * height, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'red';
      ctx.fill();
    }
  }
}

async function loadModel() {
  if (landmarker) return;
  $('status').textContent = 'Loading MediaPipe model and WASM…';
  const vision = await FilesetResolver.forVisionTasks(chrome.runtime.getURL('wasm'));
  landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: chrome.runtime.getURL('models/face_landmarker.task'),
      delegate: 'CPU'
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
}

function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:` +
    `${String(seconds % 60).padStart(2, '0')}`;
}

function updateTimerDisplay() {
  $('screen-timer').textContent = formatTime(screenTime);
  $('away-timer').textContent = formatTime(awayTime);
  $('screen-progress').style.width = `${100 * screenTime / SCREEN_LIMIT}%`;
  $('away-progress').style.width = `${100 * awayTime / AWAY_LIMIT}%`;
}

function resetTimers() {
  screenTime = 0;
  awayTime = 0;
  currentAttentionState = 'unknown';
  lastTimerUpdate = null;
  lastPredictionTime = null;
  updateTimerDisplay();
}

function updateTimers(now) {
  if (lastTimerUpdate === null) {
    lastTimerUpdate = now;
    updateTimerDisplay();
    return;
  }
  const delta = Math.max(0, now - lastTimerUpdate);
  lastTimerUpdate = now;
  const predictionIsFresh = lastPredictionTime !== null &&
    now - lastPredictionTime < 500;

  // Unknown frames and calibration must not count as confirmed time.
  if (document.hidden || !predictionIsFresh || guided.active) {
    stats.pause();
    updateTimerDisplay();
    return;
  }
  if (statsLoaded) stats.tick(currentAttentionState, now);
  if (currentAttentionState === 'likely-screen') {
    screenTime = (screenTime + delta) % SCREEN_LIMIT;
  } else if (currentAttentionState === 'likely-away') {
    awayTime = (awayTime + delta) % AWAY_LIMIT;
  }
  updateTimerDisplay();
}

function loop(now) {
  if (!running) return;
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.videoWidth > 0 && video.videoHeight > 0 &&
      video.currentTime !== lastVideoTime && now - lastRun >= 100) {
    lastVideoTime = video.currentTime;
    lastRun = now;
    try {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (inputCanvas.width !== width) inputCanvas.width = width;
      if (inputCanvas.height !== height) inputCanvas.height = height;
      inputCtx.drawImage(video, 0, 0, width, height);
      const result = landmarker.detectForVideo(inputCanvas, now);
      draw(result);
      const prediction = detector.update(result, now, width, height);
      guided.tick(prediction, now);
      renderDiagnostics(result, prediction);
      currentAttentionState = prediction.state;
      lastPredictionTime = now;
    } catch (error) {
      console.error('Face Landmarker inference failed:', error);
      $('status').textContent = `Inference failed: ${error.message}`;
      stop(false);
      return;
    }
  }
  updateTimers(now);
  raf = requestAnimationFrame(loop);
}

async function start() {
  if (starting || running || disposed) return;
  starting = true;
  setDisabled('start', true);
  try {
    $('status').textContent = 'Requesting camera permission…';
    console.log('1. Requesting webcam permission');
    const acquired = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 }, audio: false
    });
    console.log('2. Webcam stream acquired');
    if (disposed) {
      acquired.getTracks().forEach(track => track.stop());
      return;
    }
    stream = acquired;
    video.srcObject = stream;
    await video.play();
    await loadModel();
    await statsReady;
    if (disposed) return;
    detector.reset();
    resetTimers();
    lastVideoTime = -1;
    lastRun = -Infinity;
    running = true;
    setRunningButtons(true);
    $('status').textContent = 'Camera running. Complete guided calibration.';
    $('calibration-message').textContent = 'Camera ready. Choose Start guided calibration.';
    showPage('calibration');
    raf = requestAnimationFrame(loop);
  } catch (error) {
    console.error('Head in the Clouds startup error:', error);
    $('status').textContent = `${error.name || 'Error'}: ${error.message}`;
    stop(false);
  } finally {
    starting = false;
    if (!running) setDisabled('start', false);
  }
}

function stop(showMessage = true) {
  cancelCalibration();
  running = false;
  if (raf !== null) cancelAnimationFrame(raf);
  raf = null;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  setRunningButtons(false);
  $('attention').textContent = 'Unknown';
  if (showMessage) $('status').textContent = 'Camera off';
  currentAttentionState = 'unknown';
  lastTimerUpdate = null;
  lastPredictionTime = null;
  stats.pause();
  if (statsLoaded) void stats.save().catch(console.error);
}

function beginCalibration() {
  if (!running || guided.active) return;
  stats.pause();
  currentAttentionState = 'unknown';
  lastDisplayedStableState = null;
  showPage('calibration');
  // Called directly from the user click to unlock browser audio.
  void enableCalibrationAudio().catch(error =>
    console.warn('Could not enable calibration audio:', error));
  guided.start(performance.now());
  setRunningButtons(true);
  $('status').textContent = 'Guided calibration in progress.';
}

// Only one statistics interval, outside requestAnimationFrame().
const statsSaveInterval = setInterval(() => {
  if (statsLoaded && running && !disposed) {
    void stats.save().catch(error => console.error('Stats save failed:', error));
  }
}, 2000);

$('start').addEventListener('click', start);
$('stop').addEventListener('click', () => stop());
$('guided-calibrate').addEventListener('click', beginCalibration);
$('recalibrate').addEventListener('click', beginCalibration);
$('cancel-calibration').addEventListener('click', cancelCalibration);

$('open-dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});
$('open-tracker-window').addEventListener('click', () => {
  chrome.windows.create({
    url: chrome.runtime.getURL('tracker.html'),
    type: 'popup', width: 500, height: 700
  });
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stats.pause();
    lastTimerUpdate = null;
  }
});
window.addEventListener('pagehide', () => {
  clearInterval(statsSaveInterval);
  disposed = true;
  stop(false);
  landmarker?.close();
  landmarker = null;
});

updateTimerDisplay();
showPage('welcome');
