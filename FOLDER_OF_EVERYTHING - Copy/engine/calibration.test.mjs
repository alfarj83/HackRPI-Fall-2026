// Run with: node --test webcam-darkness/*.test.mjs engine/*.test.mjs settings.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { exportSamples, sanitizeCalibration } from "./calibration.js";

const make = (label, n) => Array.from({ length: n }, (_, i) => ({ label, values: [i, 0.1, 0.2, 0.3] }));

test("exportSamples copies the classifier samples as plain data", () => {
  const classifier = { samples: [{ label: "screen", values: [1, 2, 3, 4] }] };
  const out = exportSamples(classifier);
  assert.deepEqual(out, [{ label: "screen", values: [1, 2, 3, 4] }]);
  out[0].values[0] = 99;
  assert.equal(classifier.samples[0].values[0], 1);
});

test("a full setup round-trips", () => {
  const samples = [...make("screen", 30), ...make("away", 30)];
  assert.equal(sanitizeCalibration(samples).length, 60);
  assert.equal(sanitizeCalibration({ samples }).length, 60);
});

test("missing or non-array data is rejected", () => {
  for (const bad of [undefined, null, {}, "x", 5, { samples: "x" }]) assert.equal(sanitizeCalibration(bad), null);
});

test("a setup missing one label is rejected", () => {
  assert.equal(sanitizeCalibration(make("screen", 30)), null);
  assert.equal(sanitizeCalibration([...make("screen", 30), ...make("away", 3)]), null);
});

test("bad entries are dropped, not trusted", () => {
  const samples = [
    ...make("screen", 12),
    ...make("away", 12),
    { label: "other", values: [1, 2, 3, 4] },
    { label: "screen", values: [1, 2, 3] },
    { label: "screen", values: [1, 2, NaN, 4] },
    null
  ];
  assert.equal(sanitizeCalibration(samples).length, 24);
});
