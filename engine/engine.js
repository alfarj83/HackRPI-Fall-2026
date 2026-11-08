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
import { exportSamples, sanitizeCalibration } from "./calibration.js";
import { GUIDED_STEPS, SAMPLES_PER_STEP, SETTLE_MS, SAMPLE_INTERVAL_MS } from "./guided-steps.js";

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
  onCalibrated = () => {}, // called with the samples when both calibration steps finish
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
  // pauseUntil: after step 1 an automatic run waits here, so you can look away before
  // step 2 starts collecting. auto: step 1 was started as the automatic two-step run.
  const CALIBRATION_PAUSE_MS = 3000;
  const calibration = { active: null, hasScreen: false, hasAway: false, progress: 0, pauseUntil: null, auto: false };
  const resetCalibration = () =>
    Object.assign(calibration, { active: null, hasScreen: false, hasAway: false, progress: 0, pauseUntil: null, auto: false });

  // Guided nine-target calibration lives in the offscreen engine. The popup is
  // only a view; dismissing it does not prematurely commit partial training.
  const guided = {
    active: false, stepIndex: 0, collected: 0, startedAt: 0,
    lastSampleAt: -Infinity, rejectionReason: '', completedSteps: 0,
    previousSamples: null
  };
  function resetGuided() {
    Object.assign(guided, {
      active: false, stepIndex: 0, collected: 0, startedAt: 0,
      lastSampleAt: -Infinity, rejectionReason: '', completedSteps: 0,
      previousSamples: null
    });
  }
  function guidedState() {
    return {
      active: guided.active,
      stepIndex: guided.stepIndex,
      totalSteps: GUIDED_STEPS.length,
      collected: guided.collected,
      samplesRequired: SAMPLES_PER_STEP,
      completedSteps: guided.completedSteps,
      settleRemainingMs: guided.active ? Math.max(0, SETTLE_MS - (performance.now() - guided.startedAt)) : 0,
      rejectionReason: guided.rejectionReason,
      completed: !guided.active && guided.completedSteps === GUIDED_STEPS.length
    };
  }
  function beginGuided() {
    if (!running || guided.active || calibration.active || calibration.pauseUntil) return getState();
    // Retain the previous trained classifier until this run finishes successfully.
    guided.previousSamples = exportSamples(attention.classifier);
    attention.classifier.clear();
    resetCalibration();
    guided.active = true;
    guided.stepIndex = 0;
    guided.completedSteps = 0;
    guided.collected = 0;
    guided.startedAt = performance.now();
    guided.lastSampleAt = -Infinity;
    guided.rejectionReason = '';
    // Pause timers while guided calibration is running.
    timers.setPrediction('calibrating', performance.now());
    emit(true);
    return getState();
  }
  function cancelGuided() {
    if (!guided.active) return getState();
    const restored = guided.previousSamples || [];
    attention.classifier.samples = restored.map(s => ({label:s.label, values:[...s.values]}));
    resetCalibration();
    const saved = sanitizeCalibration(restored);
    if (saved) { calibration.hasScreen = true; calibration.hasAway = true; }
    resetGuided();
    timers.setPrediction('unknown', performance.now());
    emit(true);
    return getState();
  }
  function collectGuided(prediction, result, now) {
    if (!guided.active) return;
    // The popup requests preview frames only while its calibration page is visible.
    // Don't silently advance to a new dot after the popup closes or loses focus.
    if (now >= previewUntil) {
      guided.startedAt = now; // require a fresh settle interval after returning
      guided.rejectionReason = 'Open the calibration page to continue';
      return;
    }
    if (now - guided.startedAt < SETTLE_MS) return;
    const features = prediction.features;
    const blinkCategories = result.faceBlendshapes?.[0]?.categories || [];
    const blink = Math.max(...['eyeBlinkLeft','eyeBlinkRight'].map(name =>
      blinkCategories.find(c => c.categoryName === name)?.score ?? 0));
    if (blink > 0.5) {
      guided.rejectionReason = 'Blink / eye reopening';
      return;
    }
    if (!features || !['headX','headY','gazeX','gazeY'].every(k => Number.isFinite(features[k]))) {
      guided.rejectionReason = prediction.reason || 'Iris landmarks unavailable';
      return;
    }
    if (now - guided.lastSampleAt < SAMPLE_INTERVAL_MS) return;
    const step = GUIDED_STEPS[guided.stepIndex];
    if (!attention.classifier.addSample(features, step.label)) {
      guided.rejectionReason = 'Classifier rejected the sample';
      return;
    }
    guided.rejectionReason = '';
    guided.collected++;
    guided.lastSampleAt = now;
    if (guided.collected >= SAMPLES_PER_STEP) {
      guided.completedSteps++;
      guided.stepIndex++;
      guided.collected = 0;
      guided.startedAt = now;
      guided.lastSampleAt = -Infinity;
      if (guided.stepIndex >= GUIDED_STEPS.length) {
        const saved = sanitizeCalibration(exportSamples(attention.classifier));
        if (saved) {
          // Preserve the successfully collected classifier samples even if
          // AttentionDetector.reset() changes its implementation in another branch.
          attention.reset();
          attention.classifier.samples = saved.map(sample => ({
            label: sample.label,
            values: [...sample.values]
          }));
          calibration.hasScreen = attention.classifier.count('screen') >= 20;
          calibration.hasAway = attention.classifier.count('away') >= 20;
          guided.active = false;
          guided.previousSamples = null;
          timers.setPrediction('unknown', now);
          onCalibrated(saved);
        } else {
          guided.rejectionReason = 'Insufficient valid samples to save calibration';
          cancelGuided();
        }
      }
    }
    emit(true);
  }

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
      calibration: {
        active: calibration.active,
        // Report actual classifier readiness, not only historical completion flags.
        hasScreen: calibration.hasScreen && attention.classifier.count('screen') >= 20,
        hasAway: calibration.hasAway && attention.classifier.count('away') >= 20,
        sampleCounts: {
          screen: attention.classifier.count('screen'),
          away: attention.classifier.count('away')
        },
        progress: calibration.progress,
        pauseLeftMs: calibration.pauseUntil ? Math.max(0, calibration.pauseUntil - performance.now()) : 0,
        guided: guidedState()
      },
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
      emit(true); // one update per sample (about 10 per second), so the bar can move evenly
      if (calibration.progress >= 30) {
        if (calibration.active === "screen") calibration.hasScreen = true;
        if (calibration.active === "away") calibration.hasAway = true;
        // Automatic run: give the user a moment to look away before step 2 begins.
        if (calibration.active === "screen" && calibration.auto) {
          calibration.auto = false;
          calibration.pauseUntil = performance.now() + CALIBRATION_PAUSE_MS;
        }
        calibration.active = null;
        calibration.progress = 0;
        if (calibration.hasScreen && calibration.hasAway) onCalibrated(exportSamples(attention.classifier));
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

    // End of the pause between the two automatic calibration steps: start step 2.
    if (calibration.pauseUntil && now >= calibration.pauseUntil) {
      calibration.pauseUntil = null;
      calibration.active = "away";
      calibration.progress = 0;
      attention.beginCalibration("away");
      emit(true);
    }

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
        if (guided.active) collectGuided(prediction, result, now);
        timers.setPrediction(guided.active ? "calibrating" : prediction.state, now);

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

  // saved: calibration from an earlier setup. When valid, the engine starts already calibrated.
  async function start(saved = null) {
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
      resetCalibration();
      resetGuided();
      const samples = sanitizeCalibration(saved);
      if (samples) {
        attention.classifier.samples = samples;
        calibration.hasScreen = true;
        calibration.hasAway = true;
      }
      darkness.reset();
      darkness.setTrack(stream.getVideoTracks()[0]);
      timers.reset();
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
    resetGuided();
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
  // With auto, finishing step 1 pauses briefly and then starts step 2 by itself.
  function calibrate(kind, { auto = false } = {}) {
    if (kind === "guided") return beginGuided();
    if (!running || guided.active || !["screen", "away"].includes(kind)) return getState();
    if (calibration.active || calibration.pauseUntil) return getState();
    if (kind === "away" && !calibration.hasScreen) return getState();
    if (kind === "screen") {
      calibration.hasScreen = false;
      calibration.hasAway = false;
    } else {
      calibration.hasAway = false;
    }
    calibration.auto = kind === "screen" && auto;
    calibration.active = kind;
    calibration.progress = 0;
    attention.beginCalibration(kind);
    emit(true);
    return getState();
  }

  // "Redo setup": forget the calibration but keep the camera running.
  function clearCalibration() {
    // A full reset must remove saved training samples, not just timing state.
    attention.clearCalibration();
    resetCalibration();
    resetGuided();
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

  return { start, stop, calibrate, cancelGuided, clearCalibration, requestPreview, getState, applySettings, dispose };
}
