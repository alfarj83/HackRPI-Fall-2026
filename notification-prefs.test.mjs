// Run with: node --test webcam-darkness/*.test.mjs engine/*.test.mjs *.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { normalizePrefs, PREF_DEFAULTS } from "./notification-prefs.js";

test("missing data means everything is on", () => {
  assert.deepEqual(normalizePrefs(undefined), PREF_DEFAULTS);
  assert.deepEqual(normalizePrefs(null), PREF_DEFAULTS);
  assert.deepEqual(normalizePrefs({}), PREF_DEFAULTS);
});

test("only an explicit false turns an alert off", () => {
  assert.deepEqual(normalizePrefs({ lighting: false }), { lighting: false, breaks: true });
  assert.deepEqual(normalizePrefs({ breaks: false }), { lighting: true, breaks: false });
  assert.deepEqual(normalizePrefs({ lighting: false, breaks: false }), { lighting: false, breaks: false });
});

test("odd values do not switch alerts off", () => {
  assert.deepEqual(normalizePrefs({ lighting: 0, breaks: "no" }), PREF_DEFAULTS);
});
