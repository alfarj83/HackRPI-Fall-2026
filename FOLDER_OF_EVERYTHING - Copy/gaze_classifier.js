// Personalized KNN. The labels are screen/away, NOT absolute gaze coordinates.
const KEYS = ['headX', 'headY', 'gazeX', 'gazeY'];
const SCALES = [0.20, 0.25, 0.12, 0.08]; // empirical; tune on held-out sessions

export class GazeClassifier {
  constructor() { this.samples = []; }
  clear() { this.samples = []; }
  count(label) { return this.samples.filter(s => s.label === label).length; }
  toArray(f) {
    if (!f) return null;
    const values = KEYS.map(k => f[k]);
    return values.every(Number.isFinite) ? values : null;
  }
  addSample(features, label) {
    const values = this.toArray(features);
    if (!values || !['screen', 'away'].includes(label)) return false;
    this.samples.push({ values, label });
    return true;
  }
  distance(a, b) {
    return Math.hypot(...a.map((v, i) => (v - b[i]) / SCALES[i]));
  }
  predict(features) {
    const values = this.toArray(features);
    if (!values) return { state: 'unknown', reason: 'Iris or head landmarks unavailable' };
    if (this.count('screen') < 20 || this.count('away') < 20) {
      return { state: 'uncalibrated', reason: 'Complete guided calibration' };
    }
    const neighbors = this.samples.map(s => ({
      label: s.label, distance: this.distance(values, s.values)
    })).sort((a, b) => a.distance - b.distance).slice(0, 7);

    // A much less aggressive rejection policy than a hard nearest-distance >2.
    // Novel postures remain uncertain; they are not automatically 'away'.
    if (neighbors[0].distance > 4.0) {
      return { state: 'uncertain', reason: 'Head/eye pose not covered by calibration' };
    }
    const screenVotes = neighbors.filter(n => n.label === 'screen').length;
    if (screenVotes >= 5) return { state: 'likely-screen', reason: `Screen examples ${screenVotes}/7` };
    if (screenVotes <= 2) return { state: 'likely-away', reason: `Away examples ${7 - screenVotes}/7` };
    return { state: 'uncertain', reason: `Mixed calibration examples (${screenVotes}/7 screen)` };
  }
}

// export class GazeClassifier {
//     constructor() {
//         this.samples = [];
//         this.scales = [0.20, 0.25, 0.12, 0.08];
//     }

//     clear() {
//         this.samples = [];
//     }

//     count(label) {
//         return this.samples.filter(
//             sample => sample.label === label
//         ).length;
//     }

//     // features contains headX, headY, gazeX, gazeY.
//     addSample(features, label) {
//         const values = this.toArray(features);

//         if (!values) return false;

//         this.samples.push({
//             values,
//             label
//         });

//         return true;
//     }

//     toArray(features) {
//         if (!features) return null;

//         const values = [
//             features.headX,
//             features.headY,
//             features.gazeX,
//             features.gazeY
//         ];

//         return values.every(Number.isFinite)
//             ? values
//             : null;
//     }

//     distance(a, b) {
//         return Math.sqrt(
//             a.reduce((sum, value, index) => {
//                 const delta =
//                     (value - b[index]) / this.scales[index];

//                 return sum + delta * delta;
//             }, 0)
//         );
//     }

//     predict(features) {
//         const values = this.toArray(features);

//         if (!values) return "unknown";

//         // Require examples of both classes.
//         const labels = new Set(
//             this.samples.map(sample => sample.label)
//         );

//         if (!labels.has("screen") ||
//             !labels.has("away")) {
//             return "uncalibrated";
//         }

//         const neighbors = this.samples
//             .map(sample => ({
//                 label: sample.label,
//                 distance: this.distance(
//                     values,
//                     sample.values
//                 )
//             }))
//             .sort((a, b) => a.distance - b.distance)
//             .slice(0, 5);

//         // Abstain if the input is unlike the calibration data.
//         if (neighbors[0].distance > 2) {
//             return "unknown";
//         }

//         const screenVotes = neighbors.filter(
//             neighbor => neighbor.label === "screen"
//         ).length;

//         if (screenVotes >= 4) return "likely-screen";
//         if (screenVotes <= 1) return "likely-away";

//         return "uncertain";
//     }
// }