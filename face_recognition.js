
export class AttentionDetector {
  constructor() {
    this.baseline = null;
    this.samples = [];
    this.awaySince = null;
  }

  calibrate() {
    this.baseline = null;
    this.samples = [];
    this.awaySince = null;
  }

  getFeatures(landmarks) {
    if (!landmarks || landmarks.length < 478) {
      return null;
    }

    const distance = (a, b) =>
      Math.hypot(a.x - b.x, a.y - b.y);

    // Eye corners and iris centers
    const rightCorner1 = landmarks[33];
    const rightCorner2 = landmarks[133];
    const leftCorner1 = landmarks[362];
    const leftCorner2 = landmarks[263];

    const rightIris = landmarks[468];
    const leftIris = landmarks[473];

    function relativeIrisPosition(iris, a, b) {
    console.log(iris, a, b);
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);

      return (iris.x - minX) /
        Math.max(maxX - minX, 0.001);
    }

    const rightGaze = relativeIrisPosition(
      rightIris, rightCorner1, rightCorner2
    );

    const leftGaze = relativeIrisPosition(
      leftIris, leftCorner1, leftCorner2
    );

    const eyeA = landmarks[33];
    const eyeB = landmarks[263];
    const nose = landmarks[1];

    const eyeCenterX = (eyeA.x + eyeB.x) / 2;
    const eyeWidth = distance(eyeA, eyeB);

    if (eyeWidth < 0.001) return null;

    return {
      gaze: (leftGaze + rightGaze) / 2,
      head: (nose.x - eyeCenterX) / eyeWidth
    };
  }

  analyze(result, now = performance.now()) {
    const landmarks = result.faceLandmarks?.[0];
    const features = this.getFeatures(landmarks);

    if (!features) {
      this.awaySince = null;
      return "unknown";
    }

    // Exclude frames with substantially closed eyes
    const categories =
      result.faceBlendshapes?.[0]?.categories ?? [];

    const blinkScore = (name) =>
      categories.find(
        item => item.categoryName === name
      )?.score ?? 0;

    if (
      blinkScore("eyeBlinkLeft") > 0.65 ||
      blinkScore("eyeBlinkRight") > 0.65
    ) {
      this.awaySince = null;
      return "unknown";
    }

    // Collect 30 valid frames for calibration.
    if (!this.baseline) {
      this.samples.push(features);

      if (this.samples.length < 30) {
        return "calibrating";
      }

      const average = (key) =>
        this.samples.reduce(
          (sum, sample) => sum + sample[key], 0
        ) / this.samples.length;

      this.baseline = {
        gaze: average("gaze"),
        head: average("head")
      };

      return "looking-at-screen";
    }

    const gazeDifference = Math.abs(
      features.gaze - this.baseline.gaze
    );

    const headDifference = Math.abs(
      features.head - this.baseline.head
    );

    // Initial experimental thresholds
    const lookingAway =
      gazeDifference > 0.12 ||
      headDifference > 0.22;

    if (!lookingAway) {
      this.awaySince = null;
      return "looking-at-screen";
    }

    if (this.awaySince === null) {
      this.awaySince = now;
    }

    // Require 1.2 seconds of sustained deviation.
    if (now - this.awaySince >= 1200) {
      return "looking-away";
    }

    return "uncertain";
  }
}
