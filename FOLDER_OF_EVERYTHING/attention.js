import { GazeClassifier } from './gaze_classifier.js';

const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const valid = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);

function eyeFeatures(points, aId, bId, topId, bottomId, irisId, aspect) {
  const [a, b, t, d, iris] = [aId, bId, topId, bottomId, irisId].map(i => points[i]);
  if (![a,b,t,d,iris].every(valid)) return null;
  const width = Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const open = Math.hypot((t.x - d.x) * aspect, t.y - d.y) / width;

  // experimental values (can change for looking upward or downward)
  if (width < 0.015 || open < 0.055) return null; // near-closed or poorly tracked eye
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
  if (maxX - minX < 0.008) return null;
  const cornerY = (a.y + b.y) / 2;
  // Vertical displacement normalized by eye WIDTH, not moving eyelid height.
  return { x: (iris.x - minX) / (maxX - minX), y: (iris.y - cornerY) / width };
}

export function extractFeatures(result, videoWidth = 640, videoHeight = 480) {
  const p = result.faceLandmarks?.[0];
  if (!p || p.length < 478) return null; // this classifier needs irises
  const aspect = videoWidth / videoHeight;
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  const a = p[33], b = p[263], nose = p[1];
  if (![a, b, nose].every(valid)) return null;
  const center = midpoint(a, b);
  const eyeWidth = Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  if (eyeWidth < 0.025) return null;
  const right = eyeFeatures(p, 33, 133, 159, 145, 468, aspect);
  const left = eyeFeatures(p, 362, 263, 386, 374, 473, aspect);
  // One clear eye can be enough for a provisional measurement.
  // This reduces unnecessary 'unknown' states caused by glare on one lens.
  if (!right && !left) return null;
  const eyes = [right, left].filter(Boolean);
  const f = {
    headX: ((nose.x - center.x) * aspect) / eyeWidth,
    headY: (nose.y - center.y) / eyeWidth,
    gazeX: eyes.reduce((s, e) => s + e.x, 0) / eyes.length,
    gazeY: eyes.reduce((s, e) => s + e.y, 0) / eyes.length,
    count: p.length
  };
  return Object.values(f).every(Number.isFinite) ? f : null;
}

export class AttentionDetector {
  constructor() {
    this.classifier = new GazeClassifier();
    this.reset();
  }
  // Reset temporal state, retaining the samples already collected.
  reset() {
    this.awaySince = null;
    this.blinkUntil = 0;
    this.calibrationMode = false;
  }
  clearCalibration() { this.classifier.clear(); this.reset(); }
  setCalibrationMode(enabled) {
    this.calibrationMode = Boolean(enabled);
    this.awaySince = null;
  }
  update(result, now = performance.now(), videoWidth = 640, videoHeight = 480) {
    const features = extractFeatures(result, videoWidth, videoHeight);
    const categories = result.faceBlendshapes?.[0]?.categories || [];
    const blinkScore = name => categories.find(c => c.categoryName === name)?.score ?? 0;

    // const blinking = Math.max(blinkScore('eyeBlinkLeft'), blinkScore('eyeBlinkRight')) > 0.50;
    // if (blinking) this.blinkUntil = now + 400;
    const BLINK_THRESHOLD = 0.65;
    const BLINK_RECOVERY_MS = 200;

    const leftBlink = blinkScore("eyeBlinkLeft");
    const rightBlink = blinkScore("eyeBlinkRight");

    const blinking =
        Math.max(leftBlink, rightBlink) > BLINK_THRESHOLD;

    if (blinking) {
        this.blinkUntil = now + BLINK_RECOVERY_MS;
    }

    if (now < this.blinkUntil) {
      this.awaySince = null;
      return { state: 'unknown', features, validForCalibration: false,
        reason: 'Blink / eye reopening' };
    }
    if (!features) {
      this.awaySince = null;
      return { state: 'unknown', features, validForCalibration: false,
        reason: 'Iris landmarks unavailable (occlusion, glare, or face lost)' };
    }
    if (this.calibrationMode) {
      return { state: 'calibrating', features, validForCalibration: true,
        reason: 'Recording guided calibration target' };
    }
    const pred = this.classifier.predict(features);
    if (pred.state !== 'likely-away') {
      this.awaySince = null;
      return { ...pred, features };
    }
    if (this.awaySince === null) this.awaySince = now;
    const elapsed = now - this.awaySince;
    if (elapsed < 900) return { state: 'uncertain', features,
      reason: `Verifying away direction (${(elapsed / 1000).toFixed(1)}s)` };
    return { state: 'likely-away', features, reason: pred.reason };
  }
}