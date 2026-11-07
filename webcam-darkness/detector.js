// Wires the webcam + MediaPipe ImageSegmenter to the darkness math.
import { FilesetResolver, ImageSegmenter } from "../vendor/vision_bundle.mjs";
import { analyzeFrame, DarknessClassifier } from "./darkness.js";

const WASM_DIR = "../wasm";
const MODEL_PATH = "./selfie_segmenter.tflite";

export class BackgroundDarknessDetector {
  constructor({
    video,
    intervalMs = 200,        // ~5 readings per second is plenty
    sampleWidth = 160,       // frame is downscaled before pixel math
    darkThreshold = 60,
    personIndex = 0,         // selfie_segmenter mask: person = 0, background = any other value
    onResult = () => {},
    onError = console.error,
    classifier = new DarknessClassifier()
  }) {
    this.video = video;
    this.intervalMs = intervalMs;
    this.sampleWidth = sampleWidth;
    this.darkThreshold = darkThreshold;
    this.personIndex = personIndex;   // set to null to use backgroundIndex instead
    this.backgroundIndex = 0;
    this.maskValues = [];
    this.onResult = onResult;
    this.onError = onError;
    this.classifier = classifier;

    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.segmenter = null;
    this.stream = null;
    this.timer = null;
    this.lastTimestamp = 0;
  }

  async start() {
    if (!this.segmenter) {
      const vision = await FilesetResolver.forVisionTasks(WASM_DIR);
      this.segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_PATH },
        runningMode: "VIDEO",
        outputCategoryMask: true,
        outputConfidenceMasks: false
      });
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    this.classifier.reset();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  // Best effort: stops the camera from brightening a dark room on its own.
  // Many built-in laptop cameras don't support this; returns false then.
  async lockExposure() {
    const track = this.stream?.getVideoTracks()[0];
    const caps = track?.getCapabilities?.();
    if (!caps?.exposureMode?.includes("manual")) return false;
    await track.applyConstraints({ advanced: [{ exposureMode: "manual" }] });
    return true;
  }

  exposureInfo() {
    const s = this.stream?.getVideoTracks()[0]?.getSettings?.() ?? {};
    const exposureTime = s.exposureTime ?? null;
    const iso = s.iso ?? null;
    return {
      exposureMode: s.exposureMode ?? null,
      exposureTime,
      iso,
      exposureCompensation: s.exposureCompensation ?? null
    };
  }

  tick() {
    try {
      this.tickInner();
    } catch (error) {
      this.onError(error);
    }
  }

  tickInner() {
    const v = this.video;
    if (!this.segmenter || v.readyState < 2 || !v.videoWidth) return;

    // Timestamps must strictly increase for VIDEO mode.
    const ts = Math.max(Math.round(performance.now()), this.lastTimestamp + 1);
    this.lastTimestamp = ts;

    const w = this.sampleWidth;
    const h = Math.round((w * v.videoHeight) / v.videoWidth);
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.drawImage(v, 0, 0, w, h);
    const rgba = this.ctx.getImageData(0, 0, w, h).data;

    this.segmenter.segmentForVideo(v, ts, result => {
      const maskImage = result.categoryMask;
      if (!maskImage) return;

      const maskData = maskImage.getAsUint8Array();
      this.maskValues = [...new Set(maskData.filter((_, i) => i % 97 === 0))].sort((a, b) => a - b).slice(0, 8);

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

      const state = this.classifier.update(reading);
      this.onResult({ reading, state, exposure: this.exposureInfo(), maskValues: this.maskValues });
    });
  }
}
