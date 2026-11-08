// Run with: node --test webcam-darkness/*.test.mjs engine/*.test.mjs *.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { clampSettings, toLimits, DEFAULTS } from "./settings.js";

test("defaults are 20 minutes and 20 seconds", () => {
  assert.deepEqual(clampSettings(), DEFAULTS);
  assert.deepEqual(toLimits(), { screenLimit: 20 * 60 * 1000, awayLimit: 20 * 1000 });
});

test("values below the minimum are raised, so time can only be added", () => {
  assert.deepEqual(clampSettings({ screenMinutes: 5, breakSeconds: 3 }), { screenMinutes: 20, breakSeconds: 20 });
});

test("larger values are kept and rounded", () => {
  assert.deepEqual(clampSettings({ screenMinutes: 45.4, breakSeconds: "60" }), { screenMinutes: 45, breakSeconds: 60 });
});

test("garbage falls back to defaults and huge values are capped", () => {
  assert.deepEqual(clampSettings({ screenMinutes: "abc", breakSeconds: null }), DEFAULTS);
  assert.deepEqual(clampSettings({ screenMinutes: 99999, breakSeconds: 99999 }), { screenMinutes: 240, breakSeconds: 600 });
});
