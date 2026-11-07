// Run with: node --test webcam-darkness/darkness.test.mjs
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
  assert.equal(r.fgLuma, 200);
  assert.equal(r.darkPct, 100);
  assert.ok(r.faceToBg > 5);
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

test("classifier labels, hysteresis and sustained needsLight", () => {
  const c = new DarknessClassifier({ windowMs: 5000, sustainMs: 3000, minBgPixels: 1 });
  const m = luma => ({ bgLuma: luma, darkPct: 90, faceToBg: 3, bgCount: 100 });

  assert.equal(c.update(m(200), 0).label, "bright");
  c.samples = [];
  assert.equal(c.update(m(40), 1000).label, "dark");
  // 60 is above the dark-enter (55) but below dark-exit (70): stays dark.
  c.samples = [];
  assert.equal(c.update(m(60), 2000).label, "dark");
  c.samples = [];
  assert.equal(c.update(m(90), 3000).label, "dim");

  const r = c.update(m(90), 4500);
  assert.equal(r.needsLight, true);
  assert.equal(r.screenOnlyLit, true);
});

test("too few background pixels yields no reading", () => {
  const c = new DarknessClassifier();
  const r = c.update({ bgLuma: 10, darkPct: 100, faceToBg: 1, bgCount: 5 }, 0);
  assert.equal(r.bgLuma, null);
});

test("messages for each label", () => {
  assert.match(messageFor({ label: "dark" }), /turn on a light or move to a brighter room/i);
  assert.match(messageFor({ label: "dark", screenOnlyLit: true }), /screen is the only light/i);
  assert.match(messageFor({ label: "dim" }), /a little dim/i);
  assert.equal(messageFor({ label: "bright" }), "You are in a well lit room.");
  assert.match(messageFor({ label: "unknown" }), /checking/i);
});

test("personIndex treats any non-person value as background (0/255 masks)", () => {
  const f = makeFrame(20, 200);
  const mask255 = f.mask.map(v => (v === 0 ? 255 : 0)); // background 255, person 0
  const r = analyzeFrame({ ...f, mask: mask255, personIndex: 0, erode: false });
  assert.equal(r.bgLuma, 20);
  assert.equal(r.fgLuma, 200);
});

test("bright background but person in shadow is dim and backlit", () => {
  const c = new DarknessClassifier({ windowMs: 5000, minBgPixels: 1, minFgPixels: 1 });
  const r = c.update({ bgLuma: 170, darkPct: 0, faceToBg: 0.3, fgLuma: 50, bgCount: 100, fgCount: 100 }, 0);
  assert.equal(r.label, "dim");
  assert.equal(r.backlit, true);
  assert.match(messageFor(r), /light is behind you/i);
});

test("bright background and well lit person stays bright", () => {
  const c = new DarknessClassifier({ windowMs: 5000, minBgPixels: 1, minFgPixels: 1 });
  const r = c.update({ bgLuma: 170, darkPct: 0, faceToBg: 0.95, fgLuma: 160, bgCount: 100, fgCount: 100 }, 0);
  assert.equal(r.label, "bright");
  assert.equal(r.backlit, false);
});

test("dark background but person well lit from the front is bright", () => {
  const c = new DarknessClassifier({ windowMs: 5000, minBgPixels: 1, minFgPixels: 1 });
  const r = c.update({ bgLuma: 70, darkPct: 50, faceToBg: 1.9, fgLuma: 133, bgCount: 100, fgCount: 100 }, 0);
  assert.equal(r.label, "bright");
  assert.equal(r.darkBehind, true);
  assert.equal(r.needsLight, false);
  assert.match(messageFor(r), /well lit/i);
});

test("screen glow in a dark room is not treated as well lit", () => {
  const c = new DarknessClassifier({ windowMs: 5000, minBgPixels: 1, minFgPixels: 1 });
  const r = c.update({ bgLuma: 30, darkPct: 95, faceToBg: 4, fgLuma: 120, bgCount: 100, fgCount: 100 }, 0);
  assert.equal(r.label, "dark");
  assert.equal(r.screenOnlyLit, true);
});

test("dark background and dark person stays dim or dark", () => {
  const c = new DarknessClassifier({ windowMs: 5000, minBgPixels: 1, minFgPixels: 1 });
  const r = c.update({ bgLuma: 60, darkPct: 60, faceToBg: 1.1, fgLuma: 66, bgCount: 100, fgCount: 100 }, 0);
  assert.equal(r.label, "dim");
});
