// Screen-time and looking-away timers, moved out of tracker.js so they run in the
// background engine. No DOM, so it can be unit tested in Node.
export const SCREEN_LIMIT = 20 * 60 * 1000;
export const AWAY_LIMIT = 20 * 1000;

export class AttentionTimers {
  constructor({ screenLimit = SCREEN_LIMIT, awayLimit = AWAY_LIMIT, freshMs = 500 } = {}) {
    this.screenLimit = screenLimit;
    this.awayLimit = awayLimit;
    this.freshMs = freshMs;
    this.reset();
  }

  reset() {
    this.screenTime = 0;
    this.awayTime = 0;
    this.state = "unknown";
    this.lastUpdate = null;
    this.lastPrediction = null;
  }

  // Change the limits while running. Totals are kept but wrapped into the new range.
  setLimits({ screenLimit, awayLimit }) {
    if (Number.isFinite(screenLimit) && screenLimit > 0) this.screenLimit = screenLimit;
    if (Number.isFinite(awayLimit) && awayLimit > 0) this.awayLimit = awayLimit;
    this.screenTime %= this.screenLimit;
    this.awayTime %= this.awayLimit;
  }

  // Call whenever the attention classifier produces a prediction.
  setPrediction(state, now) {
    this.state = state;
    this.lastPrediction = now;
  }

  // Call on every engine tick. Time only counts while the latest prediction is fresh.
  tick(now) {
    if (this.lastUpdate === null) {
      this.lastUpdate = now;
      return;
    }
    const delta = Math.max(0, now - this.lastUpdate);
    this.lastUpdate = now;

    const fresh = this.lastPrediction !== null && now - this.lastPrediction < this.freshMs;
    if (!fresh) return;

    if (this.state === "likely-screen") {
      this.screenTime = (this.screenTime + delta) % this.screenLimit;
    } else if (this.state === "likely-away") {
      this.awayTime = (this.awayTime + delta) % this.awayLimit;
    }
  }

  // Camera stopped: keep the totals out of the next session.
  stop() {
    this.state = "unknown";
    this.lastUpdate = null;
    this.lastPrediction = null;
  }

  snapshot() {
    return {
      screenTime: this.screenTime,
      awayTime: this.awayTime,
      screenLimit: this.screenLimit,
      awayLimit: this.awayLimit
    };
  }
}
