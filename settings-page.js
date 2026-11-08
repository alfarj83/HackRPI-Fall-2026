import { loadSettings, saveSettings, clampSettings, DEFAULTS } from "./settings.js";

const $ = id => document.getElementById(id);

function fill(s) {
  $("screen-minutes").value = s.screenMinutes;
  $("break-seconds").value = s.breakSeconds;
}

async function save(values) {
  const asked = clampSettings(values);
  const raised =
    Number(values.screenMinutes) < asked.screenMinutes || Number(values.breakSeconds) < asked.breakSeconds;
  const clean = await saveSettings(values);
  fill(clean);
  $("msg").textContent = raised ? "Saved. Values below the minimum were raised to 20." : "Saved.";
}

$("save").addEventListener("click", () =>
  save({ screenMinutes: $("screen-minutes").value, breakSeconds: $("break-seconds").value })
);
$("reset").addEventListener("click", () => save(DEFAULTS));

loadSettings().then(fill);
