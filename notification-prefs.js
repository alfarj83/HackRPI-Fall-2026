// On/off switches for the two kinds of alerts. Shared by the popup (which edits them) and
// the service worker (which obeys them). Both default to on.
//   lighting: dark-room notification and the red toolbar badge
//   breaks:   the cloud overlay shown on your tabs when an eye break starts
export const PREFS_KEY = "notificationPrefs";
export const PREF_DEFAULTS = { lighting: true, breaks: true };

// Anything that is not an explicit false counts as on, so missing or broken data never
// silently turns alerts off.
export function normalizePrefs(input) {
  return {
    lighting: input?.lighting !== false,
    breaks: input?.breaks !== false
  };
}

export async function loadPrefs() {
  const stored = await chrome.storage.local.get(PREFS_KEY);
  return normalizePrefs(stored[PREFS_KEY]);
}

export async function savePrefs(prefs) {
  const clean = normalizePrefs(prefs);
  await chrome.storage.local.set({ [PREFS_KEY]: clean });
  return clean;
}
