import { FaceLandmarker, FilesetResolver, DrawingUtils } from './vendor/vision_bundle.mjs';
import { AttentionDetector } from './attention.js';
import { HeadCloudStats } from './statistics.js';
import { GuidedCalibration, enableCalibrationAudio } from './calibration.js';

// there are 60 seconds in a minute, 1000 milliseconds in a second
const SCREEN_LIMIT = 20 * 60 * 1000;
const AWAY_LIMIT = 20 * 1000;

let screenTime = 0;
let awayTime = 0;
let currentAttentionState = "unknown";
let lastTimerUpdate = null;
let lastPredictionTime = null;



const $ = id => document.getElementById(id);
const video = $('webcam'), canvas = $('overlay'), ctx = canvas.getContext('2d');
const inputCanvas = document.createElement('canvas');
const inputCtx = inputCanvas.getContext('2d', {
    willReadFrequently: true
});

const detector = new AttentionDetector();
const stats = new HeadCloudStats();
const statsReady = stats.load();

let statsLoaded = false;

statsReady.then(() => {
    statsLoaded = true;
}).catch(error => {
    console.error("Could not load statistics:", error);
});

// Persist cumulative analytics periodically, independently of the
// two short, resetting timers that are shown in the tracker UI.
const statsSaveInterval = setInterval(() => {
    if (running && !disposed) {
        void stats.save().catch(error =>
            console.error('Could not save Head in the Clouds statistics:', error)
        );
    }
}, 2000);

let landmarker = null, stream = null, running = false, raf = null;
let lastVideoTime = -1, lastRun = -Infinity, starting = false, disposed = false;

const labels = {
  'likely-screen':'Likely looking at screen', 'likely-away':'Likely looking away',
  'calibrating':'Calibrating…', 'unknown':'Unknown',
  'uncertain':'Checking gaze direction…', 'uncalibrated':'Calibration required'
};

// Guided sequence replaces separate screen/away sample buttons.
const guided = new GuidedCalibration(detector, {
    overlay: $('calibration-overlay'),
    panel: $('calibration-panel'),
    step: $('calibration-step'),
    mode: $('calibration-mode'),
    help: $('calibration-help'),
    progress: $('calibration-progress'),
    target: $('calibration-target')
}, () => {
    $('status').textContent = 'Guided calibration complete. Test new head and eye positions.';
    $('guided-calibrate').disabled = false;
});

// Suppress brief status-label flashes after blinks, but never count
// unknown measurements as confirmed viewing time.
let lastDisplayedStableState = null;
let lastDisplayedStableTime = 0;

const fmt = n => Number.isFinite(n) ? n.toFixed(3) : '—';

function renderDiagnostics(result, prediction) {

  const f = prediction.features;

  const blinkNoise = prediction.state === 'unknown' &&
      (prediction.reason.includes('Blink') || prediction.reason.includes('Iris'));
  if (prediction.state === 'likely-screen' || prediction.state === 'likely-away') {
      lastDisplayedStableState = prediction.state;
      lastDisplayedStableTime = performance.now();
  }
  const displayed = blinkNoise && lastDisplayedStableState &&
      performance.now() - lastDisplayedStableTime < 650
      ? lastDisplayedStableState : prediction.state;
  $('attention').textContent = labels[displayed] || displayed;

  $('detail').textContent = prediction.reason;

  $('faces').textContent = result.faceLandmarks?.length || 0;

  $('landmarks').textContent = result.faceLandmarks?.[0]?.length || 0;

  $('head-x').textContent = fmt(f?.headX);

  $('head-y').textContent = fmt(f?.headY);

  $('gaze-x').textContent = fmt(f?.gazeX);

  $('gaze-y').textContent = fmt(f?.gazeY);

  $('progress').textContent =

    guided.active

        ?  `Target ${guided.stepIndex + 1}/9`

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

    $("screen-timer").textContent = formatTime(screenTime);

    $("away-timer").textContent = formatTime(awayTime);



    $("screen-progress").style.width =

        `${(screenTime / SCREEN_LIMIT) * 100}%`;



    $("away-progress").style.width =

        `${(awayTime / AWAY_LIMIT) * 100}%`;

}



function updateTimers(now) {

    if (lastTimerUpdate === null) {
        lastTimerUpdate = now;
        updateTimerDisplay();
        return;
    }

    const delta = Math.max(0, now - lastTimerUpdate);
    lastTimerUpdate = now;

    // Do not count time if the browser tab is hidden

    // or the latest classification is stale.

    const predictionIsFresh =
        lastPredictionTime !== null &&
        now - lastPredictionTime < 500;

    if (document.hidden || !predictionIsFresh) {
        stats.pause();
        updateTimerDisplay();
        return;
    }

    if (statsLoaded) {
        stats.tick(currentAttentionState, now);
    }

    if (currentAttentionState === "likely-screen") {
        screenTime = (screenTime + delta) % SCREEN_LIMIT;
    } else if (currentAttentionState === "likely-away") {
        awayTime = (awayTime + delta) % AWAY_LIMIT;
    }

    updateTimerDisplay();
}



function resetTimers() {
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

          guided.tick(prediction, now);
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

const statsSaveInterval = setInterval(() => {
    if (statsLoaded && running) {
        stats.save().catch(console.error);
    }
}, 2000);

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

    await statsReady;
    detector.reset();



    resetTimers();



    lastVideoTime = -1; lastRun = -Infinity;

    running = true;



    $('stop').disabled = false;

    $('guided-calibrate').disabled = false;

    

    $('status').textContent = 'Camera running. Look at your screen, then click Calibrate.';



    raf = requestAnimationFrame(loop);

  } catch(error) {

    console.error('Head in the Clouds startup error:', error);

    $('status').textContent = `${error.name || 'Error'}: ${error.message}`;

    stop(false);

  } finally {

    starting = false;

    if (!running) $('start').disabled = false;

  }

}

function stop(showMessage = true) {
  if (guided.active) guided.cancel();

  running = false;

  if (raf !== null) cancelAnimationFrame(raf);

  raf = null;

  stream?.getTracks().forEach(t=>t.stop());

  stream = null;

  video.srcObject = null;

  ctx.clearRect(0,0,canvas.width,canvas.height);

  $('start').disabled = false;

  $('stop').disabled = true;

  $('guided-calibrate').disabled = true;

  

  $('attention').textContent = 'Unknown';

  if (showMessage) $('status').textContent = 'Camera off';



  currentAttentionState = "unknown";

  lastTimerUpdate = null;

  lastPredictionTime = null;
  stats.pause();
  void stats.save().catch(error =>
      console.error('Could not save Head in the Clouds statistics:', error)
  );

}

$('start').addEventListener('click', start);



$('stop').addEventListener('click', () => stop());



$('guided-calibrate').addEventListener('click', () => {
    if (!running) return;
    stats.pause();
    currentAttentionState = 'unknown';
    lastDisplayedStableState = null;

    void enableCalibrationAudio().catch(error =>
        console.warn('Could not enable calibration audio:', error)
    );

    guided.start(performance.now());
    $('guided-calibrate').disabled = true;
    $('status').textContent = 'Guided calibration in progress: follow the displayed prompts.';
});
$('cancel-calibration').addEventListener('click', () => {
    guided.cancel();
    $('guided-calibrate').disabled = !running;
    $('status').textContent = 'Calibration cancelled. Start again to collect a complete set.';
});

window.addEventListener('pagehide', () => {
    clearInterval(statsSaveInterval);

  disposed = true;

  stop(false);

  landmarker?.close(); landmarker = null;

});
