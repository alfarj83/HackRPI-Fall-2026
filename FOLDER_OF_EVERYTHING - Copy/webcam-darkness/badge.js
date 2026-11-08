// Toolbar icon badge for the lighting result. Uses chrome.action, which needs no
// extra permission. Dark = red "!", anything else = no badge.
import { messageFor } from "./darkness.js";

const DEFAULT_TITLE = "Open Head in the Clouds";
const STYLES = {
  dark: { text: "!", background: "#d93025", textColor: "#ffffff" }
};

let lastKey = null;

function action() {
  return typeof chrome !== "undefined" && chrome.action ? chrome.action : null;
}

// Extension APIs return promises in MV3; a failure here must never break the page.
const safe = result => Promise.resolve(result).catch(() => {});

// Call with each classifier snapshot. Only talks to Chrome when something changed.
export function updateBadge(state) {
  const api = action();
  if (!api || !state) return;

  const key = state.label;
  if (key === lastKey) return;
  lastKey = key;

  const style = STYLES[state.label];
  safe(api.setBadgeText({ text: style ? style.text : "" }));
  if (style) {
    safe(api.setBadgeBackgroundColor({ color: style.background }));
    if (api.setBadgeTextColor) safe(api.setBadgeTextColor({ color: style.textColor }));
  }

  safe(
    api.setTitle({
      title:
        state.label === "unknown"
          ? DEFAULT_TITLE
          : `Head in the Clouds: ${messageFor(state)}`
    })
  );
}

export function clearBadge() {
  const api = action();
  lastKey = null;
  if (!api) return;
  safe(api.setBadgeText({ text: "" }));
  safe(api.setTitle({ title: DEFAULT_TITLE }));
}
