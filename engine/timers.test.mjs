// Run with: node --test webcam-darkness/*.test.mjs engine/*.test.mjs settings.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { AttentionTimers } from "./timers.js";

// Feed one fresh prediction and one tick.
function step(t, state, now) {
  t.setPrediction(state, now);
  return t.tick(now);
}

test("screen time counts only while predictions are fresh", () => {
  const t = new AttentionTimers();
  t.tick(0);
  step(t, "likely-screen", 100);
  assert.equal(t.screenTime, 100);
  t.tick(900); // last prediction was 800 ms ago: stale
  assert.equal(t.screenTime, 100);
});

test("reaching the screen limit starts a break once", () => {
  const t = new AttentionTimers({ screenLimit: 300 });
  t.tick(0);
  assert.equal(step(t, "likely-screen", 100), null);
  assert.equal(step(t, "likely-screen", 200), null);
  assert.equal(step(t, "likely-screen", 300), "break-start");
  assert.equal(t.onBreak, true);
  assert.equal(step(t, "likely-screen", 400), null); // screen time does not count on a break
  assert.equal(t.screenTime, 300);
});

test("on a break only looking away counts, and finishing it resets everything", () => {
  const t = new AttentionTimers({ screenLimit: 100, awayLimit: 300 });
  t.tick(0);
  assert.equal(step(t, "likely-screen", 100), "break-start");
  step(t, "likely-screen", 200);
  assert.equal(t.awayTime, 0);
  step(t, "likely-away", 300);
  assert.equal(t.awayTime, 100);
  step(t, "likely-away", 400);
  assert.equal(step(t, "likely-away", 500), "break-end");
  assert.deepEqual([t.onBreak, t.screenTime, t.awayTime], [false, 0, 0]);
});

test("looking away outside a break does nothing", () => {
  const t = new AttentionTimers();
  t.tick(0);
  step(t, "likely-away", 100);
  assert.equal(t.screenTime + t.awayTime, 0);
});

test("unknown and calibrating states do not count", () => {
  const t = new AttentionTimers();
  t.tick(0);
  step(t, "calibrating", 100);
  step(t, "unknown", 200);
  assert.equal(t.screenTime + t.awayTime, 0);
});

test("setLimits keeps totals and caps them to the new limits", () => {
  const t = new AttentionTimers({ screenLimit: 1000 });
  t.screenTime = 900;
  t.setLimits({ screenLimit: 5000, awayLimit: 40000 });
  assert.equal(t.screenTime, 900);
  assert.equal(t.snapshot().awayLimit, 40000);
  t.setLimits({ screenLimit: 500 });
  assert.equal(t.screenTime, 500);
});

test("stop reports whether a break was running", () => {
  const t = new AttentionTimers({ screenLimit: 100 });
  t.tick(0);
  step(t, "likely-screen", 100);
  assert.equal(t.stop(), true);
  assert.equal(t.onBreak, false);
  assert.equal(t.stop(), false);
});


test("fresh unknown counts toward a break (blink or lost face/iris)", () => {
  const t = new AttentionTimers({ screenLimit: 100, awayLimit: 400 });
  t.tick(0);
  assert.equal(step(t, "likely-screen", 100), "break-start");
  assert.equal(step(t, "unknown", 200), null); // blinking
  assert.equal(t.awayTime, 100);
  assert.equal(step(t, "unknown", 300), null); // lost face mesh
  assert.equal(t.awayTime, 200);
  assert.equal(step(t, "likely-away", 400), null);
  assert.equal(step(t, "unknown", 500), "break-end");
  assert.deepEqual([t.onBreak, t.screenTime, t.awayTime], [false, 0, 0]);
});

test("unknown does not count as screen time outside a break", () => {
  const t = new AttentionTimers({ screenLimit: 100 });
  t.tick(0);
  step(t, "unknown", 100);
  assert.equal(t.screenTime, 0);
  step(t, "likely-screen", 200);
  assert.equal(t.onBreak, true);
  step(t, "unknown", 300);
  assert.equal(t.awayTime, 100);
});

test("uncertain and calibrating do not advance breaks", () => {
  const t = new AttentionTimers({ screenLimit: 100, awayLimit: 300 });
  t.tick(0);
  step(t, "likely-screen", 100);
  step(t, "uncertain", 200);
  step(t, "calibrating", 300);
  assert.equal(t.awayTime, 0);
});

test("stale unknown prediction cannot advance break", () => {
  const t = new AttentionTimers({ screenLimit: 100, awayLimit: 300, freshMs: 500 });
  t.tick(0);
  step(t, "likely-screen", 100);
  t.setPrediction("unknown", 150);
  t.tick(800);
  assert.equal(t.awayTime, 0);
});
