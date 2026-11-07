const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const statusElement = document.getElementById("gaze-status");
const coordinates = document.getElementById("coordinates");
const gazeDot = document.getElementById("gaze-dot");
const calibration = document.getElementById("calibration");

let tracking = false;
let lastOutsideTime = null;
const CALIBRATION_CLICKS = 5;

// Generate nine calibration points.
for (let i = 0; i < 9; i++) {
  const button = document.createElement("button");
  button.className = "point";
  button.textContent = "0";

  let clicks = 0;

  button.addEventListener("click", () => {
    if (!tracking || clicks >= CALIBRATION_CLICKS) {
      return;
    }

    clicks++;
    button.textContent = clicks;

    // WebGazer can learn from click locations.
    // With mouse-click calibration enabled, the
    // click supplies its screen position.

    if (clicks === CALIBRATION_CLICKS) {
      button.style.background = "green";
    }
  });

  calibration.appendChild(button);
}

async function startTracking() {
  if (tracking) return;

  startButton.disabled = true;
  statusElement.textContent = "Starting WebGazer...";

  try {
    webgazer
      .saveDataAcrossSessions(false)
      .showVideoPreview(true)
      .showPredictionPoints(false)
      .setGazeListener((data, elapsedTime) => {
        if (!data) {
          statusElement.textContent =
            "Waiting for gaze prediction...";
          gazeDot.style.display = "none";
          lastOutsideTime = null;
          return;
        }

        const x = data.x;
        const y = data.y;

        coordinates.textContent =
          `X: ${Math.round(x)} | Y: ${Math.round(y)}`;

        gazeDot.style.left = `${x}px`;
        gazeDot.style.top = `${y}px`;

        const inside =
          x >= 0 &&
          x <= window.innerWidth &&
          y >= 0 &&
          y <= window.innerHeight;

        if (inside) {
          lastOutsideTime = null;
          statusElement.textContent =
            "Gaze predicted inside page";
          gazeDot.style.display = "block";
        } else {
          gazeDot.style.display = "none";

          if (lastOutsideTime === null) {
            lastOutsideTime = performance.now();
          }

          const duration =
            performance.now() - lastOutsideTime;

          statusElement.textContent =
            duration > 1500
              ? "Sustained out-of-bounds gaze prediction"
              : "Gaze near/outside page boundary";
        }
      });

    await webgazer.begin();

    tracking = true;
    stopButton.disabled = false;
    statusElement.textContent = "Tracking active";

  } catch (error) {
    console.error(error);
    statusElement.textContent =
      `Error: ${error.message}`;
    startButton.disabled = false;
  }
}

async function stopTracking() {
  tracking = false;

  await webgazer.end();

  gazeDot.style.display = "none";
  startButton.disabled = false;
  stopButton.disabled = true;
  statusElement.textContent = "Tracking stopped";
}

startButton.addEventListener("click", startTracking);
stopButton.addEventListener("click", stopTracking);

window.addEventListener("pagehide", () => {
  if (tracking) webgazer.end();
});
