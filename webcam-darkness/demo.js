import { BackgroundDarknessDetector } from "./detector.js";
import { messageFor } from "./darkness.js";

const $ = id => document.getElementById(id);
const overlay = $("overlay");
const octx = overlay.getContext("2d");

const fmt = (n, d = 1) => (n === null || n === undefined ? "n/a" : Number(n).toFixed(d));

function drawDarkMask(reading) {
  overlay.width = reading.width;
  overlay.height = reading.height;
  const img = octx.createImageData(reading.width, reading.height);
  for (let i = 0; i < reading.darkMask.length; i++) {
    if (reading.darkMask[i]) {
      img.data.set([255, 0, 0, 120], i * 4); // red = dark background pixel
    }
  }
  octx.putImageData(img, 0, 0);
}

const detector = new BackgroundDarknessDetector({
  video: $("webcam"),
  onError: error => {
    console.error(error);
    $("status").textContent = `Error: ${error.name}: ${error.message}`;
  },
  onResult: ({ reading, state, exposure, maskValues }) => {
    drawDarkMask(reading);
    $("status").textContent = `Running. ${reading.bgCount} background pixels found.`;

    $("label").textContent = state.label.toUpperCase();
    const advice = $("advice");
    advice.textContent = messageFor(state);
    advice.dataset.level = state.label;

    $("stats").textContent = [
      `background luma (median, now): ${fmt(reading.bgLuma, 0)}`,
      `background luma (10s avg):     ${fmt(state.bgLuma)}`,
      `dark background pixels:        ${fmt(reading.darkPct)}%  (10s avg ${fmt(state.darkPct)}%)`,
      `person luma / background luma: ${fmt(reading.faceToBg, 2)}`,
      `background px / person px:     ${reading.bgCount} / ${reading.fgCount}`,
      `mask values seen: ${maskValues.join(", ")}  (person = 0)`,
      `exposure: ${JSON.stringify(exposure)}`
    ].join("\n");
  }
});

$("invert").addEventListener("change", e => {
  // Invert: treat value 0 as the background and everything else as the person.
  detector.personIndex = e.target.checked ? null : 0;
});

$("start").addEventListener("click", async () => {
  $("start").disabled = true;
  $("status").textContent = "Loading model and starting camera...";
  try {
    await detector.start();
    $("status").textContent = "Running.";
    $("stop").disabled = false;
    $("lock").disabled = false;
  } catch (error) {
    console.error(error);
    $("status").textContent = `${error.name}: ${error.message}`;
    $("start").disabled = false;
  }
});

$("stop").addEventListener("click", () => {
  detector.stop();
  octx.clearRect(0, 0, overlay.width, overlay.height);
  $("start").disabled = false;
  $("stop").disabled = true;
  $("lock").disabled = true;
  $("status").textContent = "Stopped.";
});

$("lock").addEventListener("click", async () => {
  const ok = await detector.lockExposure().catch(() => false);
  $("status").textContent = ok
    ? "Exposure locked to manual."
    : "This camera does not support manual exposure; readings are relative.";
});
