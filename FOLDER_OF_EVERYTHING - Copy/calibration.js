// Guided, labeled calibration. On-screen targets are shown on this browser window.
// Away targets are physical locations BEYOND the monitor, not points on it.
export const STEPS = [
  { label: 'screen', direction: 'center', x: 50, y: 50 },
  { label: 'screen', direction: 'left', x: 12, y: 50 },
  { label: 'screen', direction: 'right', x: 88, y: 50 },
  { label: 'screen', direction: 'up', x: 50, y: 5 },
  { label: 'screen', direction: 'down', x: 50, y: 87 },
  { label: 'away', direction: 'left' },
  { label: 'away', direction: 'right' },
  { label: 'away', direction: 'up' },
  { label: 'away', direction: 'down' }
];
const SAMPLES_PER_STEP = 22;
const SETTLE_MS = 1800;
const ARROWS = { left: '←', right: '→', up: '↑', down: '↓', center: '●' };


let audioContext = null;

export async function enableCalibrationAudio() {
    if (!audioContext) {
        audioContext = new AudioContext();
    }

    if (audioContext.state === "suspended") {
        await audioContext.resume();
    }
}

function playCalibrationDing() {
    try {
        if (!audioContext) {
            audioContext = new AudioContext();
        }

        // Resume the audio context if it was suspended.
        if (audioContext.state === "suspended") {
            void audioContext.resume();
        }

        const now = audioContext.currentTime;

        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(880, now);

        // Soft bell-like volume envelope.
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(
            0.12,
            now + 0.015
        );

        gain.gain.exponentialRampToValueAtTime(
            0.0001,
            now + 0.3
        );

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        oscillator.start(now);
        oscillator.stop(now + 0.31);

    } catch (error) {
        console.warn("Calibration sound unavailable:", error);
    }
}

export class GuidedCalibration {
  constructor(detector, ui, onComplete) {
    this.detector = detector;
    this.ui = ui;
    this.onComplete = onComplete;
    this.active = false;
    this.stepIndex = 0;
    this.collected = 0;
    this.startsAt = 0;
    this.lastSampleTime = -Infinity;
    this.lastRejectionReason = "";
  }
  start(now = performance.now()) {
    if (this.active) return;
    this.detector.clearCalibration();
    this.detector.setCalibrationMode(true);
    this.active = true;
    this.stepIndex = 0;
    this.startStep(now);
  }
  startStep(now) {
    this.collected = 0;
    this.startsAt = now;
    this.lastSampleTime = -Infinity;
    this.render(now);
    this.lastRejectionReason = "";
  }
  cancel() {
    this.active = false;
    this.detector.setCalibrationMode(false);
    this.detector.classifier.clear(); // avoid partially trained model
    this.ui.overlay.hidden = true;
    this.ui.panel.hidden = true;
  }
  render(now) {
    if (!this.active) return;
    const step = STEPS[this.stepIndex];
    const remaining = Math.max(0, Math.ceil((SETTLE_MS - (now - this.startsAt)) / 1000));
    this.ui.overlay.hidden = false;
    
    this.ui.panel.hidden = false;
    
    this.ui.step.textContent = `Target ${this.stepIndex + 1} of ${STEPS.length}`;
    
    this.ui.mode.textContent = step.label === 'screen'
      ? `LOOK AT THE ${step.direction.toUpperCase()} DOT ON YOUR SCREEN`
      : `LOOK ${step.direction.toUpperCase()} BEYOND THE EDGE OF YOUR MONITOR`;
    
      this.ui.help.textContent = step.label === 'screen'
      ? 'Follow the dot with your eyes. Keep your head comfortable; avoid exaggerated turns.'
      : 'Look just beyond the monitor edge using your eyes first. ' +
      'Keep your face visible and avoid turning so far that the camera loses your eyes.';
    
      this.ui.progress.textContent = remaining > 0
      ? `Get ready: ${remaining}s` : this.lastRejectionReason
            ? `Paused at ${this.collected}/${SAMPLES_PER_STEP}: ${this.lastRejectionReason}`
            : `Recording ${this.collected}/${SAMPLES_PER_STEP} valid frames`;
    
    const dot = this.ui.target;
    dot.textContent = step.label === 'screen' ? '●' : ARROWS[step.direction];
    dot.classList.toggle('away-target', step.label === 'away');
    dot.style.left = `${step.x ?? 50}%`;
    dot.style.top = `${step.y ?? 50}%`;
  }
  tick(prediction, now = performance.now()) {
    if (!this.active) return;
    if (now - this.startsAt < SETTLE_MS) {
      this.render(now);
      return;
    }
    if (!prediction.validForCalibration) {
    this.lastRejectionReason =
        prediction.reason || "Invalid gaze measurement";

    this.render(now);
    return;
    }

    if (now - this.lastSampleTime < 85) {
        return;
    }

    this.lastRejectionReason = "";
    const step = STEPS[this.stepIndex];
    if (this.detector.classifier.addSample(prediction.features, step.label)) {
      this.collected++;
      this.lastSampleTime = now;
    }
    if (this.collected >= SAMPLES_PER_STEP) {
      playCalibrationDing();
      this.stepIndex++;
      if (this.stepIndex >= STEPS.length) {
        this.active = false;
        this.detector.setCalibrationMode(false);
        this.detector.reset();
        this.ui.overlay.hidden = true;
        this.ui.panel.hidden = true;
        this.onComplete();
        return;
      }
      this.startStep(now);
      return;
    }
    this.render(now);
  }
}
