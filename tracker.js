import { FaceLandmarker, FilesetResolver, DrawingUtils } from './vendor/vision_bundle.mjs';
import { AttentionDetector } from './attention.js';

const SCREEN_LIMIT = 0.2 * 60 * 1000;
const AWAY_LIMIT = 20 * 1000;

let screenTime = 0;
let awayTime = 0;
let onBreak = false;
let hasScreenCalibration = false;
let hasAwayCalibration = false;
let activeCalibration = null;
const pages = ["permission", "calibration", "timer", "settings"];

let currentAttentionState = "unknown";
let lastTimerUpdate = null;
let lastPredictionTime = null;

const $ = id => document.getElementById(id);

function showPage(page) {
  if (!pages.includes(page)) return;
  for (const name of pages) {
    $("page-" + name).hidden = name !== page;
  }
  document.querySelectorAll("[data-nav]").forEach(button => {
    button.classList.toggle("active", button.dataset.nav === page);
  });
}

function setCalibrationControls() {
  $("calibrate-screen").disabled = !running || activeCalibration !== null;
  $("calibrate-away").disabled = !running || !hasScreenCalibration || activeCalibration !== null;
  $("go-timer").disabled = !hasScreenCalibration || !hasAwayCalibration;
  const completed = Number(hasScreenCalibration) + Number(hasAwayCalibration);
  $("calibration-message").textContent = `${completed} of 2 steps complete`;
  $("calibration-bar").style.width = `${completed * 50}%`;
}

function sendBreak(type) {
  chrome.runtime.sendMessage({ type }).catch(error => {
    console.warn("Cloud message failed:", error);
  });
}

const video = $('webcam'), canvas = $('overlay'), ctx = canvas.getContext('2d');
const inputCanvas = document.createElement('canvas');
const inputCtx = inputCanvas.getContext('2d', {
    willReadFrequently: true
});
const detector = new AttentionDetector();
let landmarker = null, stream = null, running = false, raf = null;
let lastVideoTime = -1, lastRun = -Infinity, starting = false, disposed = false;
const labels = {
  'likely-screen':'Likely facing screen', 'likely-away':'Likely looking away',
  'calibrating':'Calibrating…', 'unknown':'Unknown',
  'uncertain':'Checking sustained movement…', 'uncalibrated':'Calibration required'
};
const fmt = n => Number.isFinite(n) ? n.toFixed(3) : '—';
function renderDiagnostics(result, prediction) {
  const f = prediction.features;
  $('attention').textContent = labels[prediction.state] || prediction.state;
  $('detail').textContent = prediction.reason;
  $('faces').textContent = result.faceLandmarks?.length || 0;
  $('landmarks').textContent = result.faceLandmarks?.[0]?.length || 0;
  $('head-x').textContent = fmt(f?.headX);
  $('head-y').textContent = fmt(f?.headY);
  $('gaze-x').textContent = fmt(f?.gazeX);
  $('gaze-y').textContent = fmt(f?.gazeY);
  $("tracking-indicator").textContent = labels[prediction.state] || prediction.state;
  if (activeCalibration && prediction.state === "calibrating") {
    const sampleCount = Math.min(30, prediction.progress || 0);
    const completed = Number(hasScreenCalibration) + Number(hasAwayCalibration);
    $("calibration-message").textContent = `Recording ${activeCalibration}: ${sampleCount}/30 samples`;
    $("calibration-bar").style.width = `${(completed * 30 + sampleCount) / 60 * 100}%`;

    if (sampleCount >= 30) {
      if (activeCalibration === "screen") hasScreenCalibration = true;
      if (activeCalibration === "away") hasAwayCalibration = true;
      activeCalibration = null;
      setCalibrationControls();
      if (hasScreenCalibration && hasAwayCalibration) {
        $("calibration-hint").textContent = "Calibration complete!";
        showPage("timer");
      } else {
        $("calibration-hint").textContent = "Great! Now look away and record that position.";
      }
    }
  }
  $('progress').textContent =
    prediction.state === "calibrating"
        ? `${prediction.progress}/30`
        : `S:${detector.classifier.count("screen")} ` +
          `A:${detector.classifier.count("away")}`;
  $('delta').textContent =
      `S:${detector.classifier.count("screen")} ` +
      `A:${detector.classifier.count("away")}`;
}
function draw(result) {
    const width = inputCanvas.width;
    const height = inputCanvas.height;

    if (!width || !height) return;

    if (canvas.width !== width) {
        canvas.width = width;
    }

    if (canvas.height !== height) {
        canvas.height = height;
    }

    // Ensure there are no previous transformations.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Draw exactly the frame MediaPipe processed.
    ctx.drawImage(inputCanvas, 0, 0);

    const drawUtils = new DrawingUtils(ctx);

    for (const points of result.faceLandmarks || []) {
        drawUtils.drawConnectors(
            points,
            FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
            { color: '#70e9ba', lineWidth: 2 }
        );

        drawUtils.drawConnectors(
            points,
            FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
            { color: '#66d9ff', lineWidth: 2 }
        );

        drawUtils.drawConnectors(
            points,
            FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
            { color: '#66d9ff', lineWidth: 2 }
        );

        if (points.length >= 478) {
            drawUtils.drawConnectors(
                points,
                FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
                { color: '#ffd966', lineWidth: 2 }
            );

            drawUtils.drawConnectors(
                points,
                FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
                { color: '#ffd966', lineWidth: 2 }
            );
        }

        // Nose marker for debugging.
        const nose = points[1];

        if (nose) {
            ctx.beginPath();
            ctx.arc(
                nose.x * width,
                nose.y * height,
                7,
                0,
                Math.PI * 2
            );

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
    baseOptions: {modelAssetPath: chrome.runtime.getURL('models/face_landmarker.task'), delegate:'CPU'},
    runningMode:'VIDEO', numFaces:1, outputFaceBlendshapes:true,
    minFaceDetectionConfidence:0.5, minFacePresenceConfidence:0.5, minTrackingConfidence:0.5
  });
}


function formatTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return (
        String(minutes).padStart(2, "0") + ":" +
        String(seconds).padStart(2, "0")
    );
}

function updateTimerDisplay() {
    // The tracker owns both clocks; timer.js is no longer needed.
    $("screen-timer").textContent = formatTime(Math.ceil(Math.max(0, SCREEN_LIMIT - screenTime) / 1000) * 1000);
    $("away-timer").textContent = formatTime(onBreak
        ? Math.ceil(Math.max(0, AWAY_LIMIT - awayTime) / 1000) * 1000
        : awayTime);

    $("screen-progress").style.width = `${Math.min(100, screenTime / SCREEN_LIMIT * 100)}%`;
    $("away-progress").style.width = `${Math.min(100, awayTime / AWAY_LIMIT * 100)}%`;
    $("timer-heading").textContent = onBreak ? "Time to look away!" : "Time to focus.";
    $("timer-description").textContent = onBreak
        ? "Look away until your 20-second break finishes."
        : "Your next break starts after 20 minutes of detected screen viewing.";
}

function updateTimers(now) {
    if (lastTimerUpdate === null) {
        lastTimerUpdate = now;
        updateTimerDisplay();
        return;
    }
    const delta = Math.max(0, now - lastTimerUpdate);
    lastTimerUpdate = now;
    const predictionIsFresh = lastPredictionTime !== null && now - lastPredictionTime < 500;
    // Preserve existing policy: don't count while tracker page is hidden or inference is stale.
    if (document.hidden || !predictionIsFresh || !running) {
        updateTimerDisplay();
        return;
    }
    if (onBreak) {
        if (currentAttentionState === "likely-away") {
            awayTime = Math.min(AWAY_LIMIT, awayTime + delta);
            if (awayTime >= AWAY_LIMIT) {
                onBreak = false;
                screenTime = 0;
                awayTime = 0;
                sendBreak("TRACKER_BREAK_END");
            }
        }
    } else if (currentAttentionState === "likely-screen") {
        screenTime = Math.min(SCREEN_LIMIT, screenTime + delta);
        awayTime = 0;
        if (screenTime >= SCREEN_LIMIT) {
            onBreak = true;
            awayTime = 0;
            sendBreak("TRACKER_BREAK_START");
        }
    }
    updateTimerDisplay();
}

function resetTimers() {
    if (onBreak) sendBreak("TRACKER_BREAK_END");
    onBreak = false;
    screenTime = 0;
    awayTime = 0;
    currentAttentionState = "unknown";
    lastTimerUpdate = null;
    lastPredictionTime = null;
    updateTimerDisplay();
}

function loop(now) {
  if (!running) return;

  if (
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.videoWidth > 0 &&
      video.videoHeight > 0 &&
      video.currentTime !== lastVideoTime &&
      now - lastRun >= 100
  ) {
      lastVideoTime = video.currentTime;
      lastRun = now;

      try {
          const width = video.videoWidth;
          const height = video.videoHeight;

          if (inputCanvas.width !== width) {
              inputCanvas.width = width;
          }

          if (inputCanvas.height !== height) {
              inputCanvas.height = height;
          }

          // Capture the webcam frame.
          inputCtx.drawImage(video, 0, 0, width, height);

          // Run MediaPipe on that exact captured frame.
          const result = landmarker.detectForVideo(
              inputCanvas,
              now
          );

          // Display the captured frame and its landmarks.
          draw(result);

          // Continue with your existing attention calculations.
          const prediction = detector.update(
              result,
              now,
              width,
              height
          );

          renderDiagnostics(result, prediction);
          currentAttentionState = prediction.state;
          lastPredictionTime = now;

      } catch (error) {
          console.error(
              'Face Landmarker inference failed:',
              error
          );

          $('status').textContent =
              `Inference failed: ${error.message}`;

          stop();
          return;
      }
  }

  // Update timers on every animation frame,
  // even though MediaPipe inference runs less frequently.
  updateTimers(now);
  raf = requestAnimationFrame(loop);
}
async function start() {
  if (starting || running) return;

  starting = true;
  $('start').disabled = true;
  
  try {
    // Camera first, to distinguish permission errors from model-load errors.
    console.log("1. Requesting webcam permission");
    $('status').textContent = 'Requesting camera permission…';

    const acquired = await navigator.mediaDevices.getUserMedia({video:{width:640,height:480},audio:false});
    console.log("2. Webcam stream acquired");

    if (disposed) { acquired.getTracks().forEach(t=>t.stop()); return; }
    
    stream = acquired;
    video.srcObject = stream;
    await video.play();
    await loadModel();
    
    if (disposed) return;
    detector.reset();

    resetTimers();

    lastVideoTime = -1; lastRun = -Infinity;
    running = true;

    $('stop').disabled = false;
    $('status').textContent = 'Camera enabled.';
    hasScreenCalibration = false;
    hasAwayCalibration = false;
    activeCalibration = null;
    setCalibrationControls();
    showPage("calibration");
    
    raf = requestAnimationFrame(loop);
  } catch(error) {
    console.error('EyeEase startup error:', error);
    $('status').textContent = `${error.name || 'Error'}: ${error.message}`;
    stop(false);
  } finally {
    starting = false;
    if (!running) $('start').disabled = false;
  }
}
function stop(showMessage = true) {
  running = false;
  if (raf !== null) cancelAnimationFrame(raf);
  raf = null;
  stream?.getTracks().forEach(t=>t.stop());
  stream = null;
  video.srcObject = null;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  $('start').disabled = false;
  $('stop').disabled = true;
  $('calibrate-screen').disabled = true;
  $('calibrate-away').disabled = true;
  $('attention').textContent = 'Unknown';
  if (onBreak) {
    onBreak = false;
    sendBreak("TRACKER_BREAK_END");
  }
  if (showMessage) $('status').textContent = 'Camera off';

  currentAttentionState = "unknown";
  lastTimerUpdate = null;
  lastPredictionTime = null;
  setCalibrationControls();
}
$('start').addEventListener('click', start);

$('stop').addEventListener('click', () => stop());

$('calibrate-screen').addEventListener('click', () => {
  if (!running) return;
  activeCalibration = "screen";
  hasScreenCalibration = false;
  hasAwayCalibration = false;
  detector.beginCalibration("screen");
  setCalibrationControls();
  $('calibration-hint').textContent = "Keep looking at your normal screen-reading area.";
});

$('calibrate-away').addEventListener('click', () => {
  if (!running || !hasScreenCalibration) return;
  activeCalibration = "away";
  hasAwayCalibration = false;
  detector.beginCalibration("away");
  setCalibrationControls();
  $('calibration-hint').textContent = "Look away from the screen and hold that position.";
});

$('go-timer').addEventListener('click', () => {
  if (hasScreenCalibration && hasAwayCalibration) showPage("timer");
});
$('recalibrate').addEventListener('click', () => showPage("calibration"));
$('settings-nav').addEventListener('click', () => showPage("settings"));
$('back-to-timer').addEventListener('click', () => {
  showPage(running && hasScreenCalibration && hasAwayCalibration ? "timer" : "permission");
});
$('restart-camera').addEventListener('click', () => {
  stop();
  showPage("permission");
});
document.querySelectorAll('[data-nav]').forEach(button => {
  button.addEventListener('click', () => {
    const page = button.dataset.nav;
    if (page === "timer" && !(running && hasScreenCalibration && hasAwayCalibration)) return;
    if (page === "calibration" && !running) return;
    showPage(page);
  });
});

showPage("permission");
updateTimerDisplay();

window.addEventListener('pagehide', () => {
  disposed = true;
  stop(false);
  landmarker?.close(); landmarker = null;
});
