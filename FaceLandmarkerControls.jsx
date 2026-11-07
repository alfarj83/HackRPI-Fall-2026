
export default function FaceLandmarkerControls({
  settings,
  onChange,
}) {
  const sliders = [
    {
      key: "minFaceDetectionConfidence",
      label: "Face Detection Confidence",
    },
    {
      key: "minFacePresenceConfidence",
      label: "Face Presence Confidence",
    },
    {
      key: "minTrackingConfidence",
      label: "Tracking Confidence",
    },
    {
      key: "numFaces",
      label: "Number of Faces",
    },
  ];

  return (
    <div className="controls">
      {sliders.map(({ key, label }) => {
        const isFaceCount = key === "numFaces";

        return (
          <label key={key}>
            <span>
              {label}: {settings[key]}
            </span>

            <input
              type="range"
              min={isFaceCount ? 1 : 0}
              max={isFaceCount ? 5 : 1}
              step={isFaceCount ? 1 : 0.05}
              value={settings[key]}
              onChange={(event) => {
                onChange({
                  ...settings,
                  [key]: Number(event.target.value),
                });
              }}
            />
          </label>
        );
      })}
    </div>
  );
}