// User settings for the two timers. Shared by the settings page, the service worker
// and the popup. The defaults are 20 minutes and 20 seconds, but any value from the
// small floor below up to the cap is allowed, shorter or longer.
export const DEFAULTS = { screenMinutes: 20, breakSeconds: 20 };
// Floors only stop zero and negative values. Screen time can be as short as 0.1 minutes
// (6 seconds), which makes the cloud break easy to trigger.
export const MIN = { screenMinutes: 0.1, breakSeconds: 1 };
export const MAX = { screenMinutes: 240, breakSeconds: 600 };
export const STORAGE_KEY = "timerSettings";

// Always returns numbers inside [MIN, MAX]: minutes to one decimal, seconds whole.
// Bad input (empty, text) falls back to the default.
export function clampSettings(input = {}) {
  const round = { screenMinutes: v => Math.round(v * 10) / 10, breakSeconds: Math.round };
  const pick = key => {
    const raw = input?.[key];
    const n = raw === "" || raw === null || raw === undefined ? NaN : round[key](Number(raw));
    if (!Number.isFinite(n)) return DEFAULTS[key];
    return Math.min(MAX[key], Math.max(MIN[key], n));
  };
  return { screenMinutes: pick("screenMinutes"), breakSeconds: pick("breakSeconds") };
}

// Timer limits in milliseconds, as the engine uses them.
export function toLimits(settings) {
  const s = clampSettings(settings);
  return { screenLimit: s.screenMinutes * 60 * 1000, awayLimit: s.breakSeconds * 1000 };
}

export async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return clampSettings(stored[STORAGE_KEY]);
}

export async function saveSettings(settings) {
  const clean = clampSettings(settings);
  await chrome.storage.local.set({ [STORAGE_KEY]: clean });
  return clean;
}

// ---- Developer test override (not shown anywhere in the UI) ----
// For trying the break and cloud flow quickly without lowering the real 20 minute
// minimum. Set it from a DevTools console, then clear it when done:
//   chrome.storage.local.set({ devTimerOverride: { screenMs: 100, awayMs: 3000 } })
//   chrome.storage.local.remove("devTimerOverride")
export const DEV_OVERRIDE_KEY = "devTimerOverride";

// Replaces a limit only when the override gives a positive number for it.
export function applyDevOverride(limits, override) {
  const out = { ...limits };
  if (Number.isFinite(override?.screenMs) && override.screenMs > 0) out.screenLimit = override.screenMs;
  if (Number.isFinite(override?.awayMs) && override.awayMs > 0) out.awayLimit = override.awayMs;
  return out;
}
