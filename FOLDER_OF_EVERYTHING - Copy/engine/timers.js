// Screen-time countdown and eye-break timer. Same rules as the original tracker page,
// moved here so they run in the background engine. No DOM, so it can be unit tested.
//
//  - While not on a break, "likely-screen" adds to screenTime. Reaching screenLimit
//    starts a break.
//  - On a break, "likely-away" adds to awayTime. Reaching awayLimit ends the break and
//    resets both clocks.
//  - Only fresh predictions count (a stale classifier never advances a clock).
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
    this.onBreak = false;
    this.state = "unknown";
    this.lastUpdate = null;
    this.lastPrediction = null;
  }

  // Change the limits while running. Totals are kept but capped to the new limits.
  setLimits({ screenLimit, awayLimit }) {
    if (Number.isFinite(screenLimit) && screenLimit > 0) this.screenLimit = screenLimit;
    if (Number.isFinite(awayLimit) && awayLimit > 0) this.awayLimit = awayLimit;
    this.screenTime = Math.min(this.screenTime, this.screenLimit);
    this.awayTime = Math.min(this.awayTime, this.awayLimit);
  }

  // Call whenever the attention classifier produces a prediction.
  setPrediction(state, now) {
    this.state = state;
    this.lastPrediction = now;
  }

  // Call on every engine tick. Returns "break-start", "break-end" or null.
  tick(now) {
    if (this.lastUpdate === null) {
      this.lastUpdate = now;
      return null;
    }
    const delta = Math.max(0, now - this.lastUpdate);
    this.lastUpdate = now;

    const fresh = this.lastPrediction !== null && now - this.lastPrediction < this.freshMs;
    if (!fresh) return null;

    if (this.onBreak) {
      if (this.state === "likely-away") {
        this.awayTime = Math.min(this.awayLimit, this.awayTime + delta);
        if (this.awayTime >= this.awayLimit) {
          this.onBreak = false;
          this.screenTime = 0;
          this.awayTime = 0;
          return "break-end";
        }
      }
    } else if (this.state === "likely-screen") {
      this.screenTime = Math.min(this.screenLimit, this.screenTime + delta);
      this.awayTime = 0;
      if (this.screenTime >= this.screenLimit) {
        this.onBreak = true;
        this.awayTime = 0;
        return "break-start";
      }
    }
    return null;
  }

  // Camera stopped. Returns true if a break was in progress (so it can be ended).
  stop() {
    const wasOnBreak = this.onBreak;
    this.onBreak = false;
    this.state = "unknown";
    this.lastUpdate = null;
    this.lastPrediction = null;
    return wasOnBreak;
  }

  snapshot() {
    return {
      screenTime: this.screenTime,
      awayTime: this.awayTime,
      screenLimit: this.screenLimit,
      awayLimit: this.awayLimit,
      onBreak: this.onBreak
    };
  }
}
