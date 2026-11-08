// Run with: node --test webcam-darkness/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const calls = [];
const record = name => args => {
  calls.push([name, args]);
  return Promise.resolve();
};
globalThis.chrome = {
  action: {
    setBadgeText: record("text"),
    setBadgeBackgroundColor: record("bg"),
    setBadgeTextColor: record("textColor"),
    setTitle: record("title")
  }
};

const { updateBadge, clearBadge } = await import("./badge.js");
const text = () => calls.filter(c => c[0] === "text").map(c => c[1].text);

test("dark shows a red ! badge with the message as tooltip", () => {
  calls.length = 0;
  updateBadge({ label: "dark" });
  assert.deepEqual(text(), ["!"]);
  assert.deepEqual(calls.find(c => c[0] === "bg")[1], { color: "#d93025" });
  assert.match(calls.find(c => c[0] === "title")[1].title, /room is dark/i);
});

test("same state again does not call Chrome", () => {
  calls.length = 0;
  updateBadge({ label: "dark" });
  assert.equal(calls.length, 0);
});

test("bright removes the badge", () => {
  calls.length = 0;
  updateBadge({ label: "bright" });
  assert.deepEqual(text(), [""]);
  assert.equal(calls.some(c => c[0] === "bg"), false);
});

test("clearBadge resets text and tooltip, and the next update goes through", () => {
  calls.length = 0;
  updateBadge({ label: "dark" });
  clearBadge();
  assert.deepEqual(text(), ["!", ""]);
  assert.equal(calls.at(-1)[1].title, "Open Head in the Clouds");
  calls.length = 0;
  updateBadge({ label: "dark" });
  assert.deepEqual(text(), ["!"]);
});

test("does nothing (and does not throw) when chrome.action is unavailable", async () => {
  const saved = globalThis.chrome;
  globalThis.chrome = undefined;
  assert.doesNotThrow(() => {
    updateBadge({ label: "dark" });
    clearBadge();
  });
  globalThis.chrome = saved;
});
