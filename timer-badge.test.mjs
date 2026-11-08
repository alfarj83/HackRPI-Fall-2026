// Run with: node --test webcam-darkness/*.test.mjs engine/*.test.mjs *.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const calls = [];
const record = name => args => { calls.push([name, args]); return Promise.resolve(); };
globalThis.chrome = {
  action: {
    setIcon: record("icon"),
    setBadgeText: record("text"),
    setBadgeBackgroundColor: record("bg"),
    setBadgeTextColor: record("textColor"),
    setTitle: record("title")
  }
};

const { clockText, badgeFor, renderTimerBadge, clearTimerBadge } = await import("./timer-badge.js");

const running = (timers, lighting) => ({ running: true, timers, lighting: { state: lighting } });
const counting = { screenTime: 0, screenLimit: 20 * 60000, awayTime: 0, awayLimit: 20000, onBreak: false };
const names = () => calls.map(c => c[0]);

test("clockText formats mm:ss and rounds up so it never shows 0 early", () => {
  assert.equal(clockText(20 * 60000), "20:00");
  assert.equal(clockText(4 * 60000 + 36000), "04:36");
  assert.equal(clockText(1), "00:01");
  assert.equal(clockText(0), "00:00");
  assert.equal(clockText(-500), "00:00");
});

test("long times switch to hours so they fit under the icon", () => {
  assert.equal(clockText(99 * 60000 + 59000), "99:59");
  assert.equal(clockText(100 * 60000), "1h40");
  assert.equal(clockText(240 * 60000), "4h00");
});

test("the cloud alone shows when the camera is off", () => {
  for (const state of [null, { running: false, timers: counting }, { running: true }]) {
    const b = badgeFor(state);
    assert.equal(b.time, null);
    assert.equal(b.mode, "off");
  }
});

test("counting down shows the time until the next break", () => {
  const b = badgeFor(running({ ...counting, screenTime: 15 * 60000 + 24000 }));
  assert.equal(b.time, "04:36");
  assert.equal(b.mode, "counting");
  assert.match(b.title, /04:36 until your next eye break/);
});

test("a break shows the time left in the break", () => {
  const b = badgeFor(running({ ...counting, onBreak: true, awayTime: 8000 }));
  assert.equal(b.time, "00:12");
  assert.equal(b.mode, "break");
  assert.match(b.title, /look away/i);
});

test("a dark room adds the alert but keeps the time, unless dark alerts are off", () => {
  const dark = running(counting, { label: "dark" });
  assert.equal(badgeFor(dark).dark, true);
  assert.equal(badgeFor(dark).time, "20:00");
  assert.equal(badgeFor(dark, { showDark: false }).dark, false);
});

test("only calls Chrome when what the icon shows changes", () => {
  calls.length = 0;
  const state = running(counting);
  renderTimerBadge(state);
  const first = calls.length;
  assert.ok(first > 0);
  renderTimerBadge(state);
  assert.equal(calls.length, first);
  renderTimerBadge(running({ ...counting, screenTime: 1000 }));
  assert.ok(calls.length > first);
});

test("the dark alert is a dot painted into the icon, not a badge with an exclamation mark", () => {
  calls.length = 0;
  renderTimerBadge(running({ ...counting, screenTime: 2000 }, { label: "dark" }));
  const badgeTexts = calls.filter(c => c[0] === "text").map(c => c[1].text);
  assert.deepEqual(badgeTexts, [""]); // never "!"
  assert.equal(calls.some(c => c[0] === "bg"), false);
  assert.match(calls.find(c => c[0] === "title")[1].title, /room is dark/i);
});

test("clearing goes back to the plain tooltip once", () => {
  renderTimerBadge(running({ ...counting, screenTime: 3000 }));
  calls.length = 0;
  clearTimerBadge();
  assert.equal(calls.find(c => c[0] === "title")[1].title, "Open Head in the Clouds");
  const afterClear = calls.length;
  clearTimerBadge();
  assert.equal(calls.length, afterClear);
});

test("does not throw without chrome.action", () => {
  const saved = globalThis.chrome;
  globalThis.chrome = undefined;
  assert.doesNotThrow(() => { renderTimerBadge(running(counting)); clearTimerBadge(); });
  globalThis.chrome = saved;
});

test("the cloud outline fills with the screen time used, and is full on a break", () => {
  assert.equal(badgeFor(running(counting)).ratio, 0);
  assert.equal(badgeFor(running({ ...counting, screenTime: 10 * 60000 })).ratio, 0.5);
  assert.equal(badgeFor(running({ ...counting, screenTime: 30 * 60000 })).ratio, 1); // never over 1
  assert.equal(badgeFor(running({ ...counting, onBreak: true })).ratio, 1);
  assert.equal(badgeFor(null).ratio, 0);
});

test("a changing outline repaints the icon even if the time text stayed the same", () => {
  renderTimerBadge(running({ ...counting, screenTime: 120000, screenLimit: 20 * 60000 }));
  calls.length = 0;
  renderTimerBadge(running({ ...counting, screenTime: 120400, screenLimit: 20 * 60000 }));
  assert.equal(calls.length, 0); // same second, same percent: no repaint
});
