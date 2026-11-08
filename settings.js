// User settings for the two timers. Shared by the settings page, the service worker
// and the popup. The defaults are also the minimums, so time can only be added.
export const DEFAULTS = { screenMinutes: 20, breakSeconds: 20 };
export const MIN = { screenMinutes: 0.1, breakSeconds: 20 };
export const MAX = { screenMinutes: 240, breakSeconds: 600 };
export const STORAGE_KEY = "timerSettings";

// Always returns whole numbers inside [MIN, MAX]. Bad input falls back to the default.
export function clampSettings(input = {}) {
  const pick = key => {
    const n = Math.round(Number(input?.[key]));
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
