// Pure darkness math. No DOM, no MediaPipe, so it can be unit tested in Node.

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
  const fgHist = new Uint32Array(256);
  const darkMask = new Uint8Array(width * height);
  let bgCount = 0;
  let fgCount = 0;
  let bgSum = 0;
  let darkCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const p = i * 4;
      const l = Math.round(luma(rgba[p], rgba[p + 1], rgba[p + 2]));

      if (!isBg[i]) {
        fgHist[l]++;
        fgCount++;
        continue;
      }

      // Skip background pixels that touch the person (or the frame edge is fine).
      if (erode) {
        const touchesPerson =
          (x > 0 && !isBg[i - 1]) ||
          (x < width - 1 && !isBg[i + 1]) ||
          (y > 0 && !isBg[i - width]) ||
          (y < height - 1 && !isBg[i + width]);
        if (touchesPerson) continue;
      }

      bgHist[l]++;
      bgCount++;
      bgSum += l;
      if (l < darkThreshold) {
        darkMask[i] = 1;
        darkCount++;
      }
    }
  }

  const bgLuma = median(bgHist, bgCount);
  const fgLuma = median(fgHist, fgCount);

  return {
    bgLuma,
    bgMean: bgCount ? bgSum / bgCount : null,
    darkPct: bgCount ? (100 * darkCount) / bgCount : null,
    fgLuma,
    faceToBg: bgLuma !== null && fgLuma !== null ? fgLuma / Math.max(bgLuma, 1) : null,
    bgCount,
    fgCount,
    darkMask,
    width,
    height
  };
}

/**
 * Turns noisy per-frame readings into a stable label.
 * - averages bgLuma over a time window
 * - hysteresis so it doesn't flicker at a threshold
 * - needsLight only after the room has been dark/dim for a sustained time
 */
export class DarknessClassifier {
  constructor({
    windowMs = 10000,
    sustainMs = 30000,
    minBgPixels = 300,
    // [enter, exit] luma thresholds
    dark = [55, 70],
    dim = [100, 115],
    screenOnlyRatio = 2.5,
    // Backlit: you are in shadow while the background is bright.
    // ratio = your luma / background luma; [enter, exit] hysteresis.
    backlitRatio = [0.7, 0.85],
    // Your own face/body luma [enter, exit] below which you count as in shadow.
    shadowLuma = [70, 85],
    // You are lit (e.g. a lamp in front of you) even if the room behind is dark.
    // [enter, exit] luma of you; ratio must stay under screenOnlyRatio so a lone
    // screen glow in a dark room does not count.
    faceLitLuma = [110, 95],
    minFgPixels = 300
  } = {}) {
    this.windowMs = windowMs;
    this.sustainMs = sustainMs;
    this.minBgPixels = minBgPixels;
    this.dark = dark;
    this.dim = dim;
    this.screenOnlyRatio = screenOnlyRatio;
    this.backlitRatio = backlitRatio;
    this.shadowLuma = shadowLuma;
    this.minFgPixels = minFgPixels;
    this.faceLitLuma = faceLitLuma;
    this.reset();
  }

  reset() {
    this.samples = [];
    this.label = "unknown";
    this.backlit = false;
    this.faceLit = false;
    this.darkBehind = false;
    this.dimSince = null;
  }

  update(measurement, now = performance.now()) {
    const usable =
      measurement &&
      measurement.bgLuma !== null &&
      measurement.bgCount >= this.minBgPixels;

    if (usable) {
      this.samples.push({
        t: now,
        luma: measurement.bgLuma,
        darkPct: measurement.darkPct,
        ratio: measurement.faceToBg,
        fg: measurement.fgCount >= this.minFgPixels ? measurement.fgLuma : null
      });
    }
    this.samples = this.samples.filter(s => now - s.t <= this.windowMs);

    if (this.samples.length === 0) {
      this.dimSince = null;
      return this.snapshot(null, null, null, now);
    }

    const avg = key => {
      const vals = this.samples.map(s => s[key]).filter(v => v !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const luma = avg("luma");
    const darkPct = avg("darkPct");
    const ratio = avg("ratio");
    const fg = avg("fg");

    this.label = this.nextLabel(luma);

    // A bright background doesn't mean a lit room if you are in shadow in front of it.
    this.backlit = this.nextBacklit(luma, ratio, fg);
    if (this.label === "bright" && this.backlit) this.label = "dim";

    // The reverse: a dark background, but you are well lit from the front.
    this.faceLit = this.nextFaceLit(fg, ratio);
    this.darkBehind = false;
    if ((this.label === "dim" || this.label === "dark") && !this.backlit && this.faceLit) {
      this.label = "bright";
      this.darkBehind = true;
    }

    const low = this.label === "dark" || this.label === "dim";
    if (low) {
      if (this.dimSince === null) this.dimSince = now;
    } else {
      this.dimSince = null;
    }

    return this.snapshot(luma, darkPct, ratio, now);
  }

  nextFaceLit(fg, ratio) {
    if (fg === null) return false;
    const limit = this.faceLit ? this.faceLitLuma[1] : this.faceLitLuma[0];
    const notScreenOnly = ratio === null || ratio < this.screenOnlyRatio;
    return fg >= limit && notScreenOnly;
  }

  nextBacklit(bgLuma, ratio, fg) {
    // Only meaningful when the background is not already dim/dark.
    if (bgLuma < this.dim[0]) return false;
    const [ratioIn, ratioOut] = this.backlitRatio;
    const [shadowIn, shadowOut] = this.shadowLuma;
    const ratioLow = ratio !== null && ratio < (this.backlit ? ratioOut : ratioIn);
    const fgLow = fg !== null && fg < (this.backlit ? shadowOut : shadowIn);
    return ratioLow || fgLow;
  }

  nextLabel(luma) {
    const prev = this.label;
    // Leaving a state needs the higher "exit" value; entering uses the lower one.
    if (prev === "dark") {
      if (luma < this.dark[1]) return "dark";
    } else if (luma < this.dark[0]) {
      return "dark";
    }

    if (prev === "dim" || prev === "dark") {
      if (luma < this.dim[1]) return "dim";
    } else if (luma < this.dim[0]) {
      return "dim";
    }
    return "bright";
  }

  snapshot(luma, darkPct, ratio, now) {
    const low = this.label === "dark" || this.label === "dim";
    return {
      label: this.label,
      bgLuma: luma,
      darkPct,
      faceToBg: ratio,
      backlit: this.backlit,
      darkBehind: this.darkBehind,
      // Face much brighter than a dark background: the screen is the main light.
      screenOnlyLit: low && ratio !== null && ratio >= this.screenOnlyRatio,
      needsLight: low && this.dimSince !== null && now - this.dimSince >= this.sustainMs
    };
  }
}

// User-facing message for a classifier snapshot.
export function messageFor(state) {
  switch (state?.label) {
    case "dark":
      return state.screenOnlyLit
        ? "Your room is dark and your screen is the only light. Turn on a light or move to a brighter room."
        : "Your room is dark. Turn on a light or move to a brighter room.";
    case "dim":
      if (state.backlit) {
        return "Light is behind you and your face is in shadow. Turn on a light in front of you or move away from the window.";
      }
      return "The room is a little dim. Try turning on a lamp or sitting closer to a window.";
    case "bright":
      return state.darkBehind
        ? "You are well lit. The room behind you is dark, which is fine."
        : "You are in a well lit room.";
    default:
      return "Checking your room's lighting...";
  }
}
