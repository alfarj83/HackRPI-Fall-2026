// Run with: node --test webcam-darkness/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const created = [];
globalThis.chrome = {
  runtime: { getURL: path => `chrome-extension://test/${path}` },
  notifications: {
    create: (id, options) => {
      created.push({ id, options });
      return Promise.resolve(id);
    }
  }
};

const { maybeNotify, resetNotifier, titleFor } = await import("./notifier.js");

const dark = needsLight => ({ label: "dark", needsLight });

test("does not fire while needsLight is false", () => {
  created.length = 0;
  resetNotifier();
  assert.equal(maybeNotify(dark(false)), false);
  assert.equal(created.length, 0);
});

test("fires once when needsLight turns true, with the dark text", () => {
  created.length = 0;
  resetNotifier();
  maybeNotify(dark(false));
  assert.equal(maybeNotify(dark(true)), true);
  assert.equal(created.length, 1);
  const { id, options } = created[0];
  assert.equal(id, "lighting-reminder");
  assert.equal(options.type, "basic");
  assert.equal(options.title, "Your room is dark");
  assert.match(options.message, /turn on a light or move to a brighter room/i);
  assert.equal(options.iconUrl, "chrome-extension://test/Images/cloud1.png");
});

test("does not repeat while the room stays dark", () => {
  created.length = 0;
  resetNotifier();
  maybeNotify(dark(true));
  maybeNotify(dark(true));
  maybeNotify(dark(true));
  assert.equal(created.length, 1);
});

test("fires again after the room was bright and then dark for long enough", () => {
  created.length = 0;
  resetNotifier();
  maybeNotify(dark(true));
  maybeNotify({ label: "bright", needsLight: false });
  maybeNotify(dark(true));
  assert.equal(created.length, 2);
});

test("resetNotifier lets the next dark spell notify (e.g. after Stop)", () => {
  created.length = 0;
  resetNotifier();
  maybeNotify(dark(true));
  resetNotifier();
  maybeNotify(dark(true));
  assert.equal(created.length, 2);
});

test("unknown reasons get a generic title", () => {
  assert.equal(titleFor({ label: "unknown" }), "Check your lighting");
});

test("does nothing (and does not throw) without chrome.notifications", () => {
  const saved = globalThis.chrome;
  globalThis.chrome = undefined;
  resetNotifier();
  assert.doesNotThrow(() => maybeNotify(dark(true)));
  globalThis.chrome = saved;
});

test("a rejected notification is reported through onError, not swallowed", async () => {
  const saved = globalThis.chrome;
  globalThis.chrome = {
    runtime: { getURL: p => p },
    notifications: { create: () => Promise.reject(new Error("Unable to download all specified images.")) }
  };
  resetNotifier();
  let reported = null;
  maybeNotify({ label: "dark", needsLight: true }, e => { reported = e; });
  await new Promise(r => setTimeout(r, 0));
  assert.match(reported.message, /unable to download/i);
  globalThis.chrome = saved;
});
