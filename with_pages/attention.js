import { GazeClassifier } from './gaze_classifier.js';

// Heuristic screen-direction detector. No external dependencies.
// This is NOT calibrated physical eye-gaze tracking or an attention diagnosis.
const at = (points, i) => points?.[i];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const average = (values) => values.reduce((s, x) => s + x, 0) / values.length;

function eyeRatios(points, cornerA, cornerB, top, bottom, irisIndex) {
  const p = [cornerA, cornerB, top, bottom, irisIndex].map(i => at(points, i));
  if (p.some(v => !v)) return null;
  const [a, b, t, d, iris] = p;
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
  const minY = Math.min(t.y, d.y), maxY = Math.max(t.y, d.y);
  if (maxX - minX < 0.008 || maxY - minY < 0.003) return null;
  return { x: (iris.x - minX) / (maxX - minX), y: (iris.y - minY) / (maxY - minY) };
}

export function extractFeatures(result, videoWidth, videoHeight) {
    const points = result.faceLandmarks?.[0];

    if (!points || points.length < 264) {
        console.warn("No usable face landmarks detected");
        return null;
    }

    const a = points[33];
    const b = points[263];
    const nose = points[1];

    if (!a || !b || !nose) {
        console.warn("Missing eye or nose landmarks");
        return null;
    }

    // Use actual video dimensions to account for
    // differently normalized X and Y coordinates.
    const aspectRatio = videoWidth / videoHeight;

    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
        console.warn("Invalid video dimensions");
        return null;
    }

    const center = midpoint(a, b);

    // Calculate the eye separation in aspect-corrected units.
    const eyeWidth = Math.hypot(
        (a.x - b.x) * aspectRatio,
        a.y - b.y
    );

    if (eyeWidth < 0.025) {
        console.warn("Eye separation too small");
        return null;
    }

    const features = {
        headX: (
            (nose.x - center.x) * aspectRatio
        ) / eyeWidth,

        headY: (
            nose.y - center.y
        ) / eyeWidth,

        gazeX: null,
        gazeY: null,

        count: points.length
    };

    // Calculate iris position if landmarks are available.
    if (points.length >= 478) {
        const rightEye = eyeRatios(
            points, 33, 133, 159, 145, 468
        );

        const leftEye = eyeRatios(
            points, 362, 263, 386, 374, 473
        );

        if (rightEye && leftEye) {
            features.gazeX = (
                rightEye.x + leftEye.x
            ) / 2;

            features.gazeY = (
                rightEye.y + leftEye.y
            ) / 2;
        } else {
            console.debug("Iris ratios unavailable");
        }
    }

    return features;
}


export class AttentionDetector {
    constructor() {
        this.classifier = new GazeClassifier();
        this.reset();
    }

    reset() {
        this.classifier.clear();
        this.calibration = null;
        this.awaySince = null;
        this.baseline = null;
    }

    beginCalibration(label) {
        if (!["screen", "away"].includes(label)) {
            return;
        }

        this.calibration = {
            label,
            progress: 0,
            target: 30
        };

        this.awaySince = null;
    }

    update(
        result,
        now = performance.now(),
        videoWidth,
        videoHeight
    ) {
        const features = extractFeatures(
            result,
            videoWidth,
            videoHeight
        );

        if (!features) {
            this.awaySince = null;

            return {
                state: "unknown",
                reason: "No usable face landmarks",
                features
            };
        }

        const blendshapes =
            result.faceBlendshapes?.[0]?.categories || [];

        const blink = name =>
            blendshapes.find(
                c => c.categoryName === name
            )?.score;

        const eyesClosed =
            (blink("eyeBlinkLeft") ?? 0) > 0.65 ||
            (blink("eyeBlinkRight") ?? 0) > 0.65;

        if (eyesClosed) {
            this.awaySince = null;

            return {
                state: "unknown",
                reason: "Eyes closed or blinking",
                features
            };
        }

        // Collect labeled calibration examples.
        if (this.calibration) {
            const { label, target } = this.calibration;

            if (this.classifier.addSample(features, label)) {
                this.calibration.progress++;
            }

            const progress = this.calibration.progress;

            if (progress >= target) {
                this.calibration = null;
            }

            return {
                state: "calibrating",
                progress,
                features,
                reason: `Recorded ${progress}/${target} ${label} samples`
            };
        }

        const prediction = this.classifier.predict(features);

        if (prediction === "uncalibrated") {
            this.awaySince = null;

            return {
                state: "uncalibrated",
                reason: "Collect screen and away examples",
                features
            };
        }

        if (prediction !== "likely-away") {
            this.awaySince = null;

            return {
                state: prediction,
                reason: "Prediction based on calibration examples",
                features
            };
        }

        // Require sustained looking-away evidence.
        if (this.awaySince === null) {
            this.awaySince = now;
        }

        const elapsed = now - this.awaySince;

        return {
            state: elapsed >= 1200
                ? "likely-away"
                : "uncertain",
            features,
            reason: `Looking-away prediction for ${(elapsed / 1000).toFixed(1)}s`
        };
    }
}

// export class AttentionDetector {
//   constructor() { this.reset(); }
//   reset() {
//     this.baseline = null;
//     this.samples = [];
//     this.calibrating = false;
//     this.awaySince = null;
//   }
//   beginCalibration() {
//     this.reset();
//     this.calibrating = true;
//   }
//   update(result, now = performance.now(), videoWidth, videoHeight) {
//     const features = extractFeatures(
//         result,
//         videoWidth,
//         videoHeight
//     );

//     if (!features) {
//       this.awaySince = null;
//       return { state: 'unknown', reason: 'No usable face landmarks', features };
//     }
//     const blendshapes = result.faceBlendshapes?.[0]?.categories || [];
//     const blink = (name) => blendshapes.find(c => c.categoryName === name)?.score;
//     const leftBlink = blink('eyeBlinkLeft'), rightBlink = blink('eyeBlinkRight');
//     const eyesClosed = (leftBlink != null && leftBlink > 0.65) ||
//                        (rightBlink != null && rightBlink > 0.65);
//     if (eyesClosed) {
//       this.awaySince = null;
//       return { state:'unknown', reason:'Eyes closed / blinking', features };
//     }

//     if (this.calibrating) {
//       this.samples.push(features);
//       const progress = Math.min(this.samples.length, 30);
//       if (progress < 30) {
//         return { state:'calibrating', progress, features, reason:'Look at your normal screen position' };
//       }
//       const mean = key => {
//         const nums = this.samples.map(s => s[key]).filter(Number.isFinite);
//         return nums.length >= 20 ? average(nums) : null;
//       };
//       this.baseline = {
//         headX: mean('headX'), headY: mean('headY'),
//         gazeX: mean('gazeX'), gazeY: mean('gazeY')
//       };
//       this.samples = [];
//       this.calibrating = false;
//       if (!Number.isFinite(this.baseline.headX)) {
//         this.baseline = null;
//         return { state:'unknown', features, reason:'Calibration failed' };
//       }
//     }
//     if (!this.baseline) {
//       return { state:'uncalibrated', features, reason:'Click Calibrate while looking at the screen' };
//     }

//     const dx = Math.abs(features.headX - this.baseline.headX);
//     const dy = Math.abs(features.headY - this.baseline.headY);
//     const gx = Number.isFinite(features.gazeX) && Number.isFinite(this.baseline.gazeX)
//       ? Math.abs(features.gazeX - this.baseline.gazeX) : null;
//     const gy = Number.isFinite(features.gazeY) && Number.isFinite(this.baseline.gazeY)
//       ? Math.abs(features.gazeY - this.baseline.gazeY) : null;

//     // Thresholds are empirical starting points, not physical gaze angles.
//     const deviated = dx > 0.20 || dy > 0.25 ||
//       (gx !== null && gx > 0.16) || (gy !== null && gy > 0.08);
//     const deltas = { headX: dx, headY: dy, gazeX: gx, gazeY: gy };
//     if (!deviated) {
//       this.awaySince = null;
//       return { state:'likely-screen', features, deltas, reason:'Near calibrated viewing position' };
//     }
//     if (this.awaySince === null) this.awaySince = now;
//     const elapsed = now - this.awaySince;
//     return {
//       state: elapsed >= 1200 ? 'likely-away' : 'uncertain',
//       features, deltas, reason:`Deviation for ${(elapsed/1000).toFixed(1)}s`
//     };
//   }
// }
