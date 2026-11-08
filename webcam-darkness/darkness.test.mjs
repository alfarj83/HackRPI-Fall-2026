// Run with: node --test webcam-darkness/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFrame, DarknessClassifier, messageFor } from "./darkness.js";

// Left half is background, right half is "person".
function makeFrame(bgValue, fgValue, w = 20, h = 10) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const person = x >= w / 2;
      const v = person ? fgValue : bgValue;
      rgba.set([v, v, v, 255], i * 4);
      mask[i] = person ? 1 : 0;
    }
  }
  return { rgba, mask, width: w, height: h, maskWidth: w, maskHeight: h };
}

test("measures only background pixels", () => {
  const r = analyzeFrame({ ...makeFrame(20, 200), erode: false });
  assert.equal(r.bgLuma, 20);
  assert.equal(r.darkPct, 100);
  assert.equal(r.bgCount, 100);
  assert.equal(r.fgCount, 100);
});

test("bright background is not dark", () => {
  const r = analyzeFrame({ ...makeFrame(180, 180), erode: false });
  assert.equal(r.darkPct, 0);
});

test("mask at a different resolution is sampled", () => {
  const f = makeFrame(30, 200);
  const small = new Uint8Array(4 * 2);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) small[y * 4 + x] = x >= 2 ? 1 : 0;
  const r = analyzeFrame({ ...f, mask: small, maskWidth: 4, maskHeight: 2, erode: false });
  assert.equal(r.bgLuma, 30);
});

test("erode drops the strip next to the person", () => {
  const r = analyzeFrame(makeFrame(20, 200));
  assert.equal(r.bgCount, 9 * 10); // 10 bg columns minus the one touching the person
});

test("personIndex treats any non-person value as background (0/255 masks)", () => {
  const f = makeFrame(20, 200);
  const mask255 = f.mask.map(v => (v === 0 ? 255 : 0)); // background 255, person 0
  const r = analyzeFrame({ ...f, mask: mask255, personIndex: 0, erode: false });
  assert.equal(r.bgLuma, 20);
});

test("only two labels: dark and bright, with hysteresis", () => {
  const c = new DarknessClassifier({ windowMs: 5000, minBgPixels: 1 });
  const m = luma => ({ bgLuma: luma, darkPct: 50, bgCount: 100 });
  const step = (luma, t) => {
    c.samples = [];
    return c.update(m(luma), t).label;
  };

  assert.equal(step(200, 0), "bright");
  assert.equal(step(30, 1000), "dark");
  // 60 is above dark-enter (55) but below dark-exit (70): stays dark.
  assert.equal(step(60, 2000), "dark");
  assert.equal(step(75, 3000), "bright");
  // Values that used to be "dim" now simply count as bright.
  assert.equal(step(90, 4000), "bright");
  assert.equal(step(60, 5000), "bright"); // entering dark needs < 55
});

test("needsLight only after a sustained dark period", () => {
  const c = new DarknessClassifier({ windowMs: 60000, sustainMs: 3000, minBgPixels: 1 });
  const m = { bgLuma: 20, darkPct: 100, bgCount: 100 };
  assert.equal(c.update(m, 0).needsLight, false);
  assert.equal(c.update(m, 2000).needsLight, false);
  const fired = c.update(m, 3500);
  assert.equal(fired.needsLight, true);
  assert.equal(fired.darkForMs, 3500);
  assert.equal(fired.sustainMs, 3000);
  // Back to bright resets it.
  const bright = { bgLuma: 200, darkPct: 0, bgCount: 100 };
  c.samples = [];
  assert.equal(c.update(bright, 4000).needsLight, false);
});

test("too few background pixels yields no reading", () => {
  const c = new DarknessClassifier();
  const r = c.update({ bgLuma: 10, darkPct: 100, bgCount: 5 }, 0);
  assert.equal(r.bgLuma, null);
  assert.equal(r.label, "unknown");
});

test("messages for each label", () => {
  assert.match(messageFor({ label: "dark" }), /turn on a light or move to a brighter room/i);
  assert.equal(messageFor({ label: "bright" }), "You are in a well lit room.");
  assert.match(messageFor({ label: "unknown" }), /checking/i);
});
