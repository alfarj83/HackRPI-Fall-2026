// Background darkness detector. It does NOT own the camera: the host page passes in
// a frame (a <video> or <canvas>) and calls process(). This lets it run in parallel
// with other analyzers (the attention tracker) on one shared camera stream.
import { FilesetResolver, ImageSegmenter } from "../vendor/vision_bundle.mjs";
import { analyzeFrame, DarknessClassifier } from "./darkness.js";

// import.meta.url makes these correct from any page (tracker.html, demo page, ...).
const WASM_DIR = new URL("../wasm", import.meta.url).href;
const MODEL_PATH = new URL("./selfie_segmenter.tflite", import.meta.url).href;

export class BackgroundDarknessDetector {
  constructor({
    sampleWidth = 320,       // frame is downscaled before pixel math (bigger = finer mask)
    darkThreshold = 60,
    personIndex = 0,         // selfie_segmenter mask: person = 0, background = any other value
    onResult = () => {},
    onError = console.error,
    classifier = new DarknessClassifier()
  } = {}) {
    this.sampleWidth = sampleWidth;
    this.darkThreshold = darkThreshold;
    this.personIndex = personIndex;   // set to null to use backgroundIndex instead
    this.backgroundIndex = 0;
    this.onResult = onResult;
    this.onError = onError;
    this.classifier = classifier;

    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.segmenter = null;
    this.lastTimestamp = 0;
    this.maskValues = [];
    this.track = null;
  }

  get ready() {
    return this.segmenter !== null;
  }

  // Pass an existing `vision` (FilesetResolver result) to share the WASM load with
  // other MediaPipe tasks.
  async init(vision = null) {
    if (this.segmenter) return;
    vision ??= await FilesetResolver.forVisionTasks(WASM_DIR);
    this.segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
      runningMode: "VIDEO",
      outputCategoryMask: true,
      outputConfidenceMasks: false
    });
  }

  reset() {
    this.classifier.reset();
    this.maskValues = [];
  }

  close() {
    this.segmenter?.close();
    this.segmenter = null;
  }

  // Optional: lets exposure settings be reported / locked for a camera track.
  setTrack(track) {
    this.track = track ?? null;
  }

  // Best effort: stops the camera from brightening a dark room on its own.
  // Many built-in laptop cameras don't support this; returns false then.
  async lockExposure() {
    const caps = this.track?.getCapabilities?.();
    if (!caps?.exposureMode?.includes("manual")) return false;
    await this.track.applyConstraints({ advanced: [{ exposureMode: "manual" }] });
    return true;
  }

  exposureInfo() {
    const s = this.track?.getSettings?.() ?? {};
    return {
      exposureMode: s.exposureMode ?? null,
      exposureTime: s.exposureTime ?? null,
      iso: s.iso ?? null,
      exposureCompensation: s.exposureCompensation ?? null
    };
  }

  // source: a <video> or <canvas>; now: a timestamp in ms (e.g. from requestAnimationFrame).
  process(source, now = performance.now()) {
    try {
      this.processInner(source, now);
    } catch (error) {
      this.onError(error);
    }
  }

  processInner(source, now) {
    if (!this.segmenter) return;
    const srcW = source.videoWidth ?? source.width;
    const srcH = source.videoHeight ?? source.height;
    if (!srcW || !srcH) return;

    // Timestamps must strictly increase for VIDEO mode.
    const ts = Math.max(Math.round(now), this.lastTimestamp + 1);
    this.lastTimestamp = ts;

    const w = this.sampleWidth;
    const h = Math.round((w * srcH) / srcW);
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.drawImage(source, 0, 0, w, h);
    const rgba = this.ctx.getImageData(0, 0, w, h).data;

    this.segmenter.segmentForVideo(source, ts, result => {
      const maskImage = result.categoryMask;
      if (!maskImage) return;

      const maskData = maskImage.getAsUint8Array();
      this.maskValues = [...new Set(maskData.filter((_, i) => i % 97 === 0))]
        .sort((a, b) => a - b)
        .slice(0, 8);

      const reading = analyzeFrame({
        rgba,
        width: w,
        height: h,
        mask: maskData,
        maskWidth: maskImage.width,
        maskHeight: maskImage.height,
        backgroundIndex: this.backgroundIndex,
        personIndex: this.personIndex,
        darkThreshold: this.darkThreshold
      });

      const state = this.classifier.update(reading, now);
      this.onResult({
        reading,
        state,
        exposure: this.exposureInfo(),
        maskValues: this.maskValues
      });
    });
  }
}
