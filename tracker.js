import { FaceLandmarker, FilesetResolver, DrawingUtils } from './vendor/vision_bundle.mjs';
import { AttentionDetector } from './attention.js';

const $ = id => document.getElementById(id);
const video = $('webcam'), canvas = $('overlay'), ctx = canvas.getContext('2d');
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
  $('progress').textContent = prediction.state === 'calibrating'
    ? `${prediction.progress}/30` : detector.baseline ? 'Done' : 'Needed';
  $('delta').textContent = prediction.deltas
    ? `H:${fmt(prediction.deltas.headX)} I:${fmt(prediction.deltas.gazeX)}` : '—';
}
function draw(result) {

    const points = result.faceLandmarks?.[0];

  if (points) {
    const nose = points[1];

    ctx.beginPath();
    ctx.arc(
      nose.x * canvas.width,
      nose.y * canvas.height,
      8,
      0,
      2 * Math.PI
    );

    ctx.fillStyle = "red";
    ctx.fill();
  }
  
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const drawUtils = new DrawingUtils(ctx);
  for (const points of result.faceLandmarks || []) {
    drawUtils.drawConnectors(points, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {color:'#70e9ba',lineWidth:2});
    drawUtils.drawConnectors(points, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, {color:'#66d9ff',lineWidth:2});
    drawUtils.drawConnectors(points, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, {color:'#66d9ff',lineWidth:2});
    if (points.length >= 478) {
      drawUtils.drawConnectors(points, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, {color:'#ffd966',lineWidth:2});
      drawUtils.drawConnectors(points, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, {color:'#ffd966',lineWidth:2});
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
function loop(now) {
  if (!running) return;
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.currentTime !== lastVideoTime && now - lastRun >= 100) {
    lastVideoTime = video.currentTime;
    lastRun = now;
    try {
      const result = landmarker.detectForVideo(video, now);
      draw(result);
      renderDiagnostics(result, detector.update(result, now));
    } catch(error) {
      console.error('Face Landmarker inference failed:', error);
      $('status').textContent = `Inference failed: ${error.message}`;
      stop();
      return;
    }
  }
  raf = requestAnimationFrame(loop);
}
async function start() {
  if (starting || running) return;
  starting = true;
  $('start').disabled = true;
  try {
    // Camera first, to distinguish permission errors from model-load errors.
    $('status').textContent = 'Requesting camera permission…';
    const acquired = await navigator.mediaDevices.getUserMedia({video:{width:640,height:480},audio:false});
    if (disposed) { acquired.getTracks().forEach(t=>t.stop()); return; }
    stream = acquired;
    video.srcObject = stream;
    await video.play();
    await loadModel();
    if (disposed) return;
    detector.reset();
    lastVideoTime = -1; lastRun = -Infinity;
    running = true;
    $('stop').disabled = false;
    $('calibrate').disabled = false;
    $('status').textContent = 'Camera running. Look at your screen, then click Calibrate.';
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
  $('calibrate').disabled = true;
  $('attention').textContent = 'Unknown';
  if (showMessage) $('status').textContent = 'Camera off';
}
$('start').addEventListener('click', start);
$('stop').addEventListener('click', () => stop());
$('calibrate').addEventListener('click', () => {
  detector.beginCalibration();
  $('status').textContent = 'Calibrating: look naturally at your normal screen-viewing position.';
});
window.addEventListener('pagehide', () => {
  disposed = true;
  stop(false);
  landmarker?.close(); landmarker = null;
});
