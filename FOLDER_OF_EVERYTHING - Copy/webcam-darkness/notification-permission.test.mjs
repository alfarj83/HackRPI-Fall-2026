// Run with: node --test webcam-darkness/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

function setChrome({ level = "granted", createError = null } = {}) {
  const created = [];
  globalThis.chrome = {
    runtime: { getURL: p => `chrome-extension://test/${p}`, lastError: null },
    notifications: {
      getPermissionLevel: cb => cb(level),
      getAll: cb => cb(Object.fromEntries(created.map(c => [c.id, true]))),
      create: (id, options, cb) => {
        created.push({ id, options });
        globalThis.chrome.runtime.lastError = createError ? { message: createError } : null;
        cb(id);
      }
    }
  };
  return created;
}

const mod = await import("./notification-permission.js");

test("granted: sends a test notification", async () => {
  const created = setChrome({ level: "granted" });
  const r = await mod.requestNotifications();
  assert.deepEqual(r, { level: "granted", sent: true, shown: true, error: null });
  assert.equal(created[0].options.requireInteraction, true);
  assert.equal(created.length, 1);
  assert.equal(created[0].options.title, "Notifications are on");
  assert.equal(created[0].options.iconUrl, "chrome-extension://test/Images/cloud1.png");
});

test("denied: does not send, and says it is blocked", async () => {
  const created = setChrome({ level: "denied" });
  const r = await mod.requestNotifications();
  assert.equal(r.sent, false);
  assert.equal(r.error, "denied");
  assert.equal(created.length, 0);
  assert.match(mod.resultMessage(r), /blocked/i);
});

test("create error is reported, not thrown", async () => {
  setChrome({ createError: "Unable to download all specified images." });
  const r = await mod.requestNotifications();
  assert.equal(r.sent, false);
  assert.match(mod.resultMessage(r), /unable to download/i);
});

test("unavailable when chrome.notifications is missing", async () => {
  globalThis.chrome = undefined;
  const r = await mod.requestNotifications();
  assert.equal(r.error, "unavailable");
  assert.match(mod.resultMessage(r), /aren't available/i);
});

test("success message says Chrome made it and points to OS settings", () => {
  const msg = mod.resultMessage({ sent: true, shown: true });
  assert.match(msg, /Chrome created the notification/);
  assert.match(msg, /System Settings/);
  assert.match(msg, /Focus/);
});

test("created but not listed means the computer blocked it", () => {
  assert.match(mod.resultMessage({ sent: true, shown: false }), /closed right away/);
});

test("prompt is skipped once enabled, and once dismissed this session", () => {
  const makeStore = () => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  };
  globalThis.localStorage = makeStore();
  globalThis.sessionStorage = makeStore();
  assert.equal(mod.shouldPrompt(), true);
  mod.markDismissed();
  assert.equal(mod.shouldPrompt(), false);

  globalThis.sessionStorage = makeStore();
  assert.equal(mod.shouldPrompt(), true);
  mod.markEnabled();
  assert.equal(mod.shouldPrompt(), false);
});

test("storage failures do not throw", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  globalThis.localStorage = broken;
  globalThis.sessionStorage = broken;
  assert.doesNotThrow(() => {
    mod.markEnabled();
    mod.markDismissed();
    mod.shouldPrompt();
  });
});
