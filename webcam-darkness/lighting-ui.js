// Renders darkness results into the "Room lighting" section of tracker.html.
import { messageFor } from "./darkness.js";

const $ = id => document.getElementById(id);
const fmt = (n, d = 0) => (n === null || n === undefined ? "—" : Number(n).toFixed(d));

// Latest dark-background mask, painted by the host page's own draw loop so it stays
// in sync with whatever else that page draws on the same canvas.
let latestReading = null;
let maskCanvas = null;
let maskCtx = null;

export function paintDarkMask(ctx, width, height) {
  if (!latestReading) return;
  const { width: w, height: h, darkMask } = latestReading;
  if (!maskCanvas) {
    maskCanvas = document.createElement("canvas");
    maskCtx = maskCanvas.getContext("2d");
  }
  if (maskCanvas.width !== w || maskCanvas.height !== h) {
    maskCanvas.width = w;
    maskCanvas.height = h;
  }
  const img = maskCtx.createImageData(w, h);
  for (let i = 0; i < darkMask.length; i++) {
    if (darkMask[i]) img.data.set([255, 0, 0, 130], i * 4); // red = dark background pixel
  }
  maskCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(maskCanvas, 0, 0, width, height);
}

export function renderLighting({ reading, state }) {
  latestReading = reading ?? null;
  $("light-label").textContent = state.label.toUpperCase();

  const message = $("light-message");
  message.textContent = messageFor(state);
  message.dataset.level = state.label;

  $("light-bg").textContent = fmt(state.bgLuma ?? reading?.bgLuma);
  $("light-dark").textContent = reading?.darkPct == null ? "—" : `${fmt(reading.darkPct)}%`;
  $("light-px").textContent = reading ? `${reading.bgCount}` : "—";
}

// Status text that shows how close the dark-room reminder is.
export function reminderStatus(state) {
  if (state.label !== "dark") return "Running.";
  if (state.needsLight) return "Room has been dark long enough. Reminder sent.";
  const seconds = Math.floor((state.darkForMs ?? 0) / 1000);
  const needed = Math.round((state.sustainMs ?? 30000) / 1000);
  return `Dark for ${seconds}s. A reminder is sent after ${needed}s of continuous darkness.`;
}

export function setLightingStatus(text) {
  $("light-status").textContent = text;
}

export function resetLighting(text = "Waiting for camera") {
  latestReading = null;
  $("light-label").textContent = "UNKNOWN";
  const message = $("light-message");
  message.textContent = "Checking your room's lighting...";
  message.dataset.level = "unknown";
  for (const id of ["light-bg", "light-dark", "light-px"]) {
    $(id).textContent = "—";
  }
  setLightingStatus(text);
}
