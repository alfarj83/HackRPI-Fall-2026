// Run with: node --test webcam-darkness/*.test.mjs engine/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { AttentionTimers } from "./timers.js";

test("counts screen time only while predictions are fresh", () => {
  const t = new AttentionTimers();
  t.tick(0);
  t.setPrediction("likely-screen", 100);
  t.tick(200);
  assert.equal(t.screenTime, 200);
  t.tick(900); // last prediction at 100 is now 800 ms old: stale
  assert.equal(t.screenTime, 200);
});

test("counts away time and wraps at the away limit", () => {
  const t = new AttentionTimers({ awayLimit: 1000 });
  t.tick(0);
  for (let now = 100; now <= 1200; now += 100) {
    t.setPrediction("likely-away", now);
    t.tick(now);
  }
  assert.equal(t.awayTime, 200);
  assert.equal(t.screenTime, 0);
});

test("unknown and calibrating states do not count", () => {
  const t = new AttentionTimers();
  t.tick(0);
  t.setPrediction("calibrating", 50);
  t.tick(100);
  assert.equal(t.screenTime + t.awayTime, 0);
});

test("reset clears totals", () => {
  const t = new AttentionTimers();
  t.tick(0);
  t.setPrediction("likely-screen", 10);
  t.tick(100);
  t.reset();
  assert.deepEqual([t.screenTime, t.awayTime, t.state], [0, 0, "unknown"]);
});

test("setLimits changes the wrap point and keeps the totals", () => {
  const t = new AttentionTimers({ screenLimit: 1000 });
  t.screenTime = 900;
  t.setLimits({ screenLimit: 5000, awayLimit: 40000 });
  assert.equal(t.screenTime, 900);
  assert.equal(t.snapshot().awayLimit, 40000);
});
