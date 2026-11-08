// Run with: node --test webcam-darkness/*.test.mjs engine/*.test.mjs *.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { clampSettings, toLimits, DEFAULTS, applyDevOverride } from "./settings.js";

test("defaults are 20 minutes and 20 seconds", () => {
  assert.deepEqual(clampSettings(), DEFAULTS);
  assert.deepEqual(toLimits(), { screenLimit: 20 * 60 * 1000, awayLimit: 20 * 1000 });
});

test("short values are allowed, down to a tiny floor", () => {
  assert.deepEqual(clampSettings({ screenMinutes: 5, breakSeconds: 3 }), { screenMinutes: 5, breakSeconds: 3 });
  assert.deepEqual(clampSettings({ screenMinutes: 0.1, breakSeconds: 1 }), { screenMinutes: 0.1, breakSeconds: 1 });
});

test("zero and negative values are raised to the floor", () => {
  assert.deepEqual(clampSettings({ screenMinutes: 0, breakSeconds: 0 }), { screenMinutes: 0.1, breakSeconds: 1 });
  assert.deepEqual(clampSettings({ screenMinutes: -5, breakSeconds: -5 }), { screenMinutes: 0.1, breakSeconds: 1 });
});

test("larger values are kept and rounded", () => {
  assert.deepEqual(clampSettings({ screenMinutes: 45.46, breakSeconds: "60.4" }), { screenMinutes: 45.5, breakSeconds: 60 });
});

test("garbage falls back to defaults and huge values are capped", () => {
  assert.deepEqual(clampSettings({ screenMinutes: "abc", breakSeconds: null }), DEFAULTS);
  assert.deepEqual(clampSettings({ screenMinutes: 99999, breakSeconds: 99999 }), { screenMinutes: 240, breakSeconds: 600 });
});

test("empty text falls back to the 20 and 20 defaults", () => {
  assert.deepEqual(clampSettings({ screenMinutes: "", breakSeconds: "" }), DEFAULTS);
});

test("a dev override replaces only the limits it gives", () => {
  const base = toLimits();
  assert.deepEqual(applyDevOverride(base, { screenMs: 100 }), { screenLimit: 100, awayLimit: 20000 });
  assert.deepEqual(applyDevOverride(base, { screenMs: 100, awayMs: 3000 }), { screenLimit: 100, awayLimit: 3000 });
});

test("a missing or bad dev override changes nothing", () => {
  const base = toLimits();
  for (const bad of [undefined, null, {}, { screenMs: 0 }, { screenMs: -5 }, { screenMs: "x" }]) {
    assert.deepEqual(applyDevOverride(base, bad), base);
  }
});
