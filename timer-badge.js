// Toolbar icon banner: the extension icon is drawn as the cloud with the countdown written
// under it (like "04:36"), so the timer is visible without opening the popup. Used by the
// service worker (background.js).
//
// What the icon shows:
//   counting     cloud + the time left until the next break, in dark text
//   on a break   cloud + the time left in the break, in orange
//   camera off   the cloud alone
//   dark room    also puts a small red "!" badge on top (only if dark room alerts are on)
// The icon is painted with an OffscreenCanvas, which the service worker has. The full
// countdown is also in the tooltip when you hover the icon.
const COLORS = { counting: "#1b2733", breakTime: "#e8710a", dark: "#d93025" };
const DEFAULT_TITLE = "Open Head in the Clouds";
const CLOUD_IMAGE = "Images/cloud.png";
const SIZES = [16, 32, 48]; // 1x, 2x and 3x screens

// Pure: "04:36". Anything over 99 minutes becomes hours and minutes ("1h40") so it fits.
export function clockText(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  if (minutes >= 100) return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// Pure: turns an engine snapshot into what the icon should show.
// time is null when there is nothing to write under the cloud.
export function badgeFor(state, { showDark = true } = {}) {
  if (!state?.running || !state.timers) {
    return { time: null, mode: "off", dark: false, title: DEFAULT_TITLE };
  }

  const t = state.timers;
  const dark = showDark && state.lighting?.state?.label === "dark";
  const darkNote = dark ? " Your room is dark, turn on a light." : "";

  if (t.onBreak) {
    const time = clockText(t.awayLimit - t.awayTime);
    return { time, mode: "break", dark, title: `Head in the Clouds: look away, ${time} left in your break.${darkNote}` };
  }

  const time = clockText(t.screenLimit - t.screenTime);
  return { time, mode: "counting", dark, title: `Head in the Clouds: ${time} until your next eye break.${darkNote}` };
}

// ---- drawing ----
let cloudPromise = null;
function loadCloud() {
  if (!cloudPromise) {
    cloudPromise = fetch(chrome.runtime.getURL(CLOUD_IMAGE))
      .then(response => response.blob())
      .then(blob => createImageBitmap(blob))
      .catch(() => null); // no image: the icon is just the time
  }
  return cloudPromise;
}

function drawIcon(size, cloud, time, mode) {
  const canvas = new OffscreenCanvas(size, size);
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, size, size);

  // The cloud takes the top part, or the whole icon when there is no time to show.
  if (cloud) {
    const areaH = time ? size * 0.55 : size * 0.92;
    const scale = Math.min((size * 0.96) / cloud.width, areaH / cloud.height);
    const w = cloud.width * scale;
    const h = cloud.height * scale;
    const y = time ? size * 0.02 : (size - h) / 2;
    g.drawImage(cloud, (size - w) / 2, y, w, h);
  }

  if (time) {
    g.font = `bold ${Math.round(size * 0.36)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    const x = size / 2;
    const y = size * 0.97;
    const maxWidth = size * 0.98;
    // A light outline keeps the digits readable on both light and dark toolbars.
    g.lineJoin = "round";
    g.lineWidth = Math.max(2, size * 0.1);
    g.strokeStyle = "rgba(255, 255, 255, 0.95)";
    g.strokeText(time, x, y, maxWidth);
    g.fillStyle = mode === "break" ? COLORS.breakTime : COLORS.counting;
    g.fillText(time, x, y, maxWidth);
  }
  return g.getImageData(0, 0, size, size);
}

// ---- Chrome side ----
const action = () => (typeof chrome !== "undefined" && chrome.action ? chrome.action : null);
const safe = result => Promise.resolve(result).catch(() => {});

let lastKey = null;
let drawing = Promise.resolve();

// Call with each engine snapshot (about 5 per second). The icon is only repainted when the
// time shown, the mode or the dark alert actually changes, which is about once a second.
export function renderTimerBadge(state, options) {
  const api = action();
  if (!api) return;

  const badge = badgeFor(state, options);
  const key = `${badge.time}|${badge.mode}|${badge.dark}`;
  if (key === lastKey) return;
  lastKey = key;

  // Paint one at a time, so a slow paint can never overwrite a newer one.
  drawing = drawing.then(async () => {
    if (key !== lastKey || typeof OffscreenCanvas === "undefined") return;
    const cloud = await loadCloud();
    const imageData = {};
    for (const size of SIZES) imageData[size] = drawIcon(size, cloud, badge.time, badge.mode);
    await safe(api.setIcon({ imageData }));
  });

  safe(api.setBadgeText({ text: badge.dark ? "!" : "" }));
  if (badge.dark) {
    safe(api.setBadgeBackgroundColor({ color: COLORS.dark }));
    if (api.setBadgeTextColor) safe(api.setBadgeTextColor({ color: "#ffffff" }));
  }
  safe(api.setTitle({ title: badge.title }));
}

// Back to the plain cloud with no time.
export function clearTimerBadge() {
  renderTimerBadge(null);
}
