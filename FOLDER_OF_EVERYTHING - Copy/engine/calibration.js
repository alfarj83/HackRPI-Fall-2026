// Saving and loading the calibration so setup only has to be done once.
// The calibration is just the classifier's labeled samples: [headX, headY, gazeX, gazeY]
// plus "screen" or "away". Pure functions, so they can be tested in Node.
const MIN_PER_LABEL = 10;
const MAX_SAMPLES = 500;

// Turn the classifier's samples into plain data that can go into chrome.storage.
export function exportSamples(classifier) {
  return classifier.samples.map(s => ({ label: s.label, values: [...s.values] }));
}

// Returns a clean samples array, or null if the data is missing or unusable.
// Needs enough examples of both labels, otherwise the old setup is not trusted.
export function sanitizeCalibration(data) {
  const raw = Array.isArray(data) ? data : data?.samples;
  if (!Array.isArray(raw)) return null;

  const clean = [];
  for (const s of raw.slice(0, MAX_SAMPLES)) {
    const ok =
      s &&
      (s.label === "screen" || s.label === "away") &&
      Array.isArray(s.values) &&
      s.values.length === 4 &&
      s.values.every(Number.isFinite);
    if (ok) clean.push({ label: s.label, values: s.values.slice() });
  }

  const count = label => clean.filter(s => s.label === label).length;
  return count("screen") >= MIN_PER_LABEL && count("away") >= MIN_PER_LABEL ? clean : null;
}
