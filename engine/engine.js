// Background engine: camera, face tracking, room lighting and timers with no page UI.
// It runs inside the offscreen document (see offscreen.js). It never touches the DOM
// beyond a hidden <video> and canvases, and it never calls chrome.action or
// chrome.notifications, because offscreen documents only get chrome.runtime. It reports
// plain-data snapshots through onState and the service worker does the badge and
// notification.
import { FaceLandmarker, FilesetResolver, DrawingUtils } from "../vendor/vision_bundle.mjs";
import { AttentionDetector } from "../attention.js";
import { BackgroundDarknessDetector } from "../webcam-darkness/detector.js";
import { reminderStatus } from "../webcam-darkness/lighting-ui.js";
import { AttentionTimers } from "./timers.js";

const TICK_MS = 50;
const ATTENTION_INTERVAL_MS = 100;
const DARKNESS_INTERVAL_MS = 200;
const EMIT_INTERVAL_MS = 200;

const LABELS = {
  "likely-screen": "Likely facing screen",
  "likely-away": "Likely looking away",
  calibrating: "Calibrating…",
  unknown: "Unknown",
  uncertain: "Checking sustained movement…",
  uncalibrated: "Calibration required"
};

export function createEngine({
  onState = () => {},
  onBreak = () => {},   // called with "start" or "end" when an eye break begins or ends
  onPreview = () => {}, // called with a small JPEG data URL while a preview is requested
  wasmUrl,
  modelUrl,
  getUserMedia = constraints => navigator.mediaDevices.getUserMedia(constraints)
} = {}) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  const frame = document.createElement("canvas");
  const frameCtx = frame.getContext("2d", { willReadFrequently: true });

  const attention = new AttentionDetector();
  const timers = new AttentionTimers();

  let landmarker = null;
  let stream = null;
  let running = false;
  let starting = false;
  let tickTimer = null;
  let lastVideoTime = -1;
  let lastAttentionRun = -Infinity;
  let lastDarknessRun = -Infinity;
  let lastEmit = -Infinity;
  let ticks = 0;
  let startedAt = null;

  // Calibration runs here so it survives the popup closing.
  const calibration = { active: null, hasScreen: false, hasAway: false, progress: 0 };
  const resetCalibration = () => Object.assign(calibration, { active: null, hasScreen: false, hasAway: false, progress: 0 });

  // Live preview for the calibration page. Only produced while the popup asks for it.
  const PREVIEW_WIDTH = 320;
  const PREVIEW_INTERVAL_MS = 150;
  const PREVIEW_TTL_MS = 3000;
  const preview = document.createElement("canvas");
  const previewCtx = preview.getContext("2d");
  let previewUntil = 0;
  let lastPreview = -Infinity;

  const snapshotState = {
    running: false,
    status: "Camera off",
    attention: { state: "unknown", label: LABELS.unknown, reason: "", faces: 0, landmarks: 0, features: null, screenCount: 0, awayCount: 0, progress: null },
    lighting: { state: null, reading: null, status: "Waiting for camera", error: null }
  };

  const darkness = new BackgroundDarknessDetector({
    onResult: ({ reading, state }) => {
      snapshotState.lighting = {
        state,
        reading: { bgLuma: reading.bgLuma, darkPct: reading.darkPct, bgCount: reading.bgCount },
        status: reminderStatus(state),
        error: null
      };
      emit();
    },
    onError: error => {
      console.error("Background darkness failed:", error);
      snapshotState.lighting.status = `Lighting detection error: ${error.message}`;
      snapshotState.lighting.error = error.message;
      emit(true);
    }
  });

  function emit(force = false) {
    const now = performance.now();
    if (!force && now - lastEmit < EMIT_INTERVAL_MS) return;
    lastEmit = now;
    onState(getState());
  }

  function getState() {
    return {
      ...snapshotState,
      running,
      ticks,
      startedAt,
      timers: timers.snapshot(),
      calibration: { ...calibration },
      lighting: { ...snapshotState.lighting },
      attention: { ...snapshotState.attention }
    };
  }

  function setStatus(text) {
    snapshotState.status = text;
    emit(true);
  }

  async function loadModels() {
    if (landmarker) return;
    setStatus("Loading MediaPipe model and WASM…");
    const vision = await FilesetResolver.forVisionTasks(wasmUrl);
    // Lighting model failures must never block eye tracking.
    snapshotState.lighting.status = "Loading lighting model…";
    darkness
      .init(vision)
      .then(() => {
        snapshotState.lighting.status = "Waiting for first frame…";
      })
      .catch(error => {
        console.error("Lighting model failed to load:", error);
        snapshotState.lighting.status = `Lighting detection unavailable: ${error.message}`;
        snapshotState.lighting.error = error.message;
      });
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: modelUrl, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
  }

  function summarize(result, prediction) {
    const f = prediction.features;
    snapshotState.attention = {
      state: prediction.state,
      label: LABELS[prediction.state] || prediction.state,
      reason: prediction.reason,
      faces: result.faceLandmarks?.length || 0,
      landmarks: result.faceLandmarks?.[0]?.length || 0,
      features: f ? { headX: f.headX, headY: f.headY, gazeX: f.gazeX, gazeY: f.gazeY } : null,
      screenCount: attention.classifier.count("screen"),
      awayCount: attention.classifier.count("away"),
      progress: prediction.state === "calibrating" ? prediction.progress : null
    };

    if (calibration.active && prediction.state === "calibrating") {
      calibration.progress = Math.min(30, prediction.progress || 0);
      if (calibration.progress >= 30) {
        if (calibration.active === "screen") calibration.hasScreen = true;
        if (calibration.active === "away") calibration.hasAway = true;
        calibration.active = null;
        calibration.progress = 0;
      }
    }
  }

  function drawPreview(result, width, height) {
    const w = PREVIEW_WIDTH;
    const h = Math.round((w * height) / width);
    if (preview.width !== w) preview.width = w;
    if (preview.height !== h) preview.height = h;
    previewCtx.setTransform(1, 0, 0, 1, 0, 0);
    previewCtx.drawImage(frame, 0, 0, w, h);
    const utils = new DrawingUtils(previewCtx);
    for (const points of result.faceLandmarks || []) {
      utils.drawConnectors(points, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, { color: "#70e9ba", lineWidth: 1 });
      utils.drawConnectors(points, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: "#66d9ff", lineWidth: 1 });
      utils.drawConnectors(points, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: "#66d9ff", lineWidth: 1 });
      if (points.length >= 478) {
        utils.drawConnectors(points, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, { color: "#ffd966", lineWidth: 1 });
        utils.drawConnectors(points, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, { color: "#ffd966", lineWidth: 1 });
      }
    }
    onPreview(preview.toDataURL("image/jpeg", 0.6));
  }

  function tick() {
    if (!running) return;
    const now = performance.now();
    ticks++;

    if (
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.videoWidth > 0 &&
      video.videoHeight > 0 &&
      video.currentTime !== lastVideoTime &&
      now - lastAttentionRun >= ATTENTION_INTERVAL_MS
    ) {
      lastVideoTime = video.currentTime;
      lastAttentionRun = now;
      try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (frame.width !== width) frame.width = width;
        if (frame.height !== height) frame.height = height;
        frameCtx.drawImage(video, 0, 0, width, height);

        const result = landmarker.detectForVideo(frame, now);
        const prediction = attention.update(result, now, width, height);
        summarize(result, prediction);
        timers.setPrediction(prediction.state, now);

        if (now < previewUntil && now - lastPreview >= PREVIEW_INTERVAL_MS) {
          lastPreview = now;
          drawPreview(result, width, height);
        }
      } catch (error) {
        console.error("Face Landmarker inference failed:", error);
        stop(`Inference failed: ${error.message}`);
        return;
      }
    }

    // Lighting reuses the frame already captured. It runs on its own interval, not only
    // on ticks where attention was skipped: with a timer loop (no animation frames),
    // attention can run on every tick and would otherwise starve the lighting check.
    if (darkness.ready && frame.width > 0 && now - lastDarknessRun >= DARKNESS_INTERVAL_MS) {
      lastDarknessRun = now;
      darkness.process(frame, now);
    }

    const event = timers.tick(now);
    if (event === "break-start") onBreak("start");
    if (event === "break-end") onBreak("end");
    emit(Boolean(event));
    tickTimer = setTimeout(tick, TICK_MS);
  }

  async function start() {
    if (starting || running) return getState();
    starting = true;
    try {
      setStatus("Requesting camera permission…");
      const acquired = await getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      stream = acquired;
      video.srcObject = stream;
      await video.play();
      await loadModels();

      attention.reset();
      darkness.reset();
      darkness.setTrack(stream.getVideoTracks()[0]);
      timers.reset();
      resetCalibration();
      lastVideoTime = -1;
      lastAttentionRun = -Infinity;
      lastDarknessRun = -Infinity;
      running = true;
      ticks = 0;
      startedAt = Date.now();
      snapshotState.status = "Camera enabled.";
      emit(true);
      tickTimer = setTimeout(tick, TICK_MS);
    } catch (error) {
      console.error("Engine startup error:", error);
      stop(`${error.name || "Error"}: ${error.message}`);
    } finally {
      starting = false;
    }
    return getState();
  }

  function stop(message = "Camera off") {
    running = false;
    startedAt = null;
    clearTimeout(tickTimer);
    tickTimer = null;
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;
    if (timers.stop()) onBreak("end");
    resetCalibration();
    previewUntil = 0;
    darkness.reset();
    darkness.setTrack(null);
    snapshotState.status = message;
    snapshotState.attention = { ...snapshotState.attention, state: "unknown", label: LABELS.unknown };
    snapshotState.lighting = { state: null, reading: null, status: message === "Camera off" ? "Camera off" : "Waiting for camera", error: null };
    emit(true);
    return getState();
  }

  // Same rules as the original page: screen first (restarts both steps), then away.
  function calibrate(kind) {
    if (!running || !["screen", "away"].includes(kind)) return getState();
    if (calibration.active) return getState();
    if (kind === "away" && !calibration.hasScreen) return getState();
    if (kind === "screen") {
      calibration.hasScreen = false;
      calibration.hasAway = false;
    } else {
      calibration.hasAway = false;
    }
    calibration.active = kind;
    calibration.progress = 0;
    attention.beginCalibration(kind);
    emit(true);
    return getState();
  }

  // The popup calls this about once a second while the calibration page is showing.
  function requestPreview() {
    previewUntil = performance.now() + PREVIEW_TTL_MS;
  }

  function dispose() {
    stop();
    landmarker?.close();
    landmarker = null;
    darkness.close();
  }

  function applySettings(limits) {
    timers.setLimits(limits || {});
    emit(true);
    return getState();
  }

  return { start, stop, calibrate, requestPreview, getState, applySettings, dispose };
}
