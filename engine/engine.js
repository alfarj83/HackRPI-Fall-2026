// Background engine: camera, face tracking, room lighting and timers with no page UI.
// It runs inside the offscreen document (see offscreen.js). It never touches the DOM
// beyond a hidden <video> and canvases, and it never calls chrome.action or
// chrome.notifications, because offscreen documents only get chrome.runtime. It reports
// plain-data snapshots through onState and the service worker does the badge and
// notification.
import { FaceLandmarker, FilesetResolver } from "../vendor/vision_bundle.mjs";
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

    timers.tick(now);
    emit();
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
      lastVideoTime = -1;
      lastAttentionRun = -Infinity;
      lastDarknessRun = -Infinity;
      running = true;
      ticks = 0;
      startedAt = Date.now();
      snapshotState.status = "Camera running. Look at your screen, then click Calibrate.";
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
    timers.stop();
    darkness.reset();
    darkness.setTrack(null);
    snapshotState.status = message;
    snapshotState.attention = { ...snapshotState.attention, state: "unknown", label: LABELS.unknown };
    snapshotState.lighting = { state: null, reading: null, status: message === "Camera off" ? "Camera off" : "Waiting for camera", error: null };
    emit(true);
    return getState();
  }

  function calibrate(kind) {
    if (!running || !["screen", "away"].includes(kind)) return getState();
    attention.beginCalibration(kind);
    setStatus(
      kind === "screen"
        ? "Recording screen-viewing examples. Keep your eyes on the screen."
        : "Recording looking-away examples. Look beyond the monitor."
    );
    return getState();
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

  return { start, stop, calibrate, getState, applySettings, dispose };
}
