// Pure darkness math. No DOM, no MediaPipe, so it can be unit tested in Node.
// Two outcomes only: the room behind you is "dark" or "bright".

// Rec. 709 luma on gamma-encoded RGB, range 0-255.
export function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function median(histogram, total) {
  if (total === 0) return null;
  const half = total / 2;
  let seen = 0;
  for (let i = 0; i < 256; i++) {
    seen += histogram[i];
    if (seen >= half) return i;
  }
  return 255;
}

/**
 * Measure brightness of the background only.
 *
 * rgba            RGBA pixels of the downscaled frame (Uint8ClampedArray)
 * width, height   size of that frame
 * mask            category mask from the segmenter (Uint8Array)
 * maskWidth/Height  mask size (may differ from the frame; sampled nearest-neighbor)
 * backgroundIndex category value that means "background"
 * personIndex     if set, background is any value that is NOT this (robust to 0/1 vs 0/255)
 * darkThreshold   luma below this counts as a dark pixel
 * erode           shrink the background by 1px so hair/shoulder edges are ignored
 */
export function analyzeFrame({
  rgba,
  width,
  height,
  mask,
  maskWidth,
  maskHeight,
  backgroundIndex = 0,
  personIndex = null,
  darkThreshold = 60,
  erode = true
}) {
  const isBg = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const my = Math.min(maskHeight - 1, Math.floor((y * maskHeight) / height));
    for (let x = 0; x < width; x++) {
      const mx = Math.min(maskWidth - 1, Math.floor((x * maskWidth) / width));
      const v = mask[my * maskWidth + mx];
      isBg[y * width + x] = (personIndex !== null ? v !== personIndex : v === backgroundIndex) ? 1 : 0;
    }
  }

  const bgHist = new Uint32Array(256);
  const darkMask = new Uint8Array(width * height);
  let bgCount = 0;
  let fgCount = 0;
  let bgSum = 0;
  let darkCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!isBg[i]) {
        fgCount++;
        continue;
      }

      // Skip background pixels that touch the person.
      if (erode) {
        const touchesPerson =
          (x > 0 && !isBg[i - 1]) ||
          (x < width - 1 && !isBg[i + 1]) ||
          (y > 0 && !isBg[i - width]) ||
          (y < height - 1 && !isBg[i + width]);
        if (touchesPerson) continue;
      }

      const p = i * 4;
      const l = Math.round(luma(rgba[p], rgba[p + 1], rgba[p + 2]));
      bgHist[l]++;
      bgCount++;
      bgSum += l;
      if (l < darkThreshold) {
        darkMask[i] = 1;
        darkCount++;
      }
    }
  }

  return {
    bgLuma: median(bgHist, bgCount),
    bgMean: bgCount ? bgSum / bgCount : null,
    darkPct: bgCount ? (100 * darkCount) / bgCount : null,
    bgCount,
    fgCount,
    darkMask,
    width,
    height
  };
}

/**
 * Turns noisy per-frame readings into a stable "dark" / "bright" label.
 * - averages bgLuma over a time window
 * - hysteresis so it doesn't flicker at the threshold
 * - needsLight only after the room has been dark for a sustained time
 * There is no "dim" state: anything not dark counts as bright.
 */
export class DarknessClassifier {
  constructor({
    windowMs = 10000,
    sustainMs = 30000,
    minBgPixels = 300,
    // [enter, exit] background luma: enter "dark" below the first, leave above the second.
    dark = [55, 70]
  } = {}) {
    this.windowMs = windowMs;
    this.sustainMs = sustainMs;
    this.minBgPixels = minBgPixels;
    this.dark = dark;
    this.reset();
  }

  reset() {
    this.samples = [];
    this.label = "unknown";
    this.darkSince = null;
  }

  update(measurement, now = performance.now()) {
    const usable =
      measurement &&
      measurement.bgLuma !== null &&
      measurement.bgCount >= this.minBgPixels;

    if (usable) {
      this.samples.push({ t: now, luma: measurement.bgLuma, darkPct: measurement.darkPct });
    }
    this.samples = this.samples.filter(s => now - s.t <= this.windowMs);

    if (this.samples.length === 0) {
      this.darkSince = null;
      return this.snapshot(null, null, now);
    }

    const avg = key => this.samples.reduce((sum, s) => sum + s[key], 0) / this.samples.length;
    const luma = avg("luma");
    const darkPct = avg("darkPct");

    this.label = this.nextLabel(luma);

    if (this.label === "dark") {
      if (this.darkSince === null) this.darkSince = now;
    } else {
      this.darkSince = null;
    }

    return this.snapshot(luma, darkPct, now);
  }

  nextLabel(luma) {
    // Leaving "dark" needs the higher exit value; entering uses the lower one.
    if (this.label === "dark") return luma < this.dark[1] ? "dark" : "bright";
    return luma < this.dark[0] ? "dark" : "bright";
  }

  snapshot(luma, darkPct, now) {
    return {
      label: this.label,
      bgLuma: luma,
      darkPct,
      sustainMs: this.sustainMs,
      darkForMs: this.label === "dark" && this.darkSince !== null ? now - this.darkSince : 0,
      needsLight:
        this.label === "dark" && this.darkSince !== null && now - this.darkSince >= this.sustainMs
    };
  }
}

// User-facing message for a classifier snapshot.
export function messageFor(state) {
  switch (state?.label) {
    case "dark":
      return "Your room is dark. Turn on a light or move to a brighter room.";
    case "bright":
      return "You are in a well lit room.";
    default:
      return "Checking your room's lighting...";
  }
}
