const video = document.getElementById("webcam");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const statusElement = document.getElementById("status");
document.getElementById("request-permission")
  .addEventListener("click", () => {

    chrome.tabs.create({
      url: chrome.runtime.getURL("permission.html")
    });

  });

let stream = null;

async function checkCameraPermission() {
  try {
    const result = await navigator.permissions.query({
      name: "camera"
    });

    console.log("Camera permission:", result.state);

    return result.state;
  } catch (error) {
    console.warn("Permission query unavailable:", error);
    return "unknown";
  }
}

startButton.addEventListener("click", async () => {
  try {
    statusElement.textContent = "Requesting camera access...";

    stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });

    video.srcObject = stream;
    await video.play();

    statusElement.textContent = "Camera working!";
    startButton.disabled = true;
    stopButton.disabled = false;

    console.log("Camera started successfully");
  } catch (error) {
    console.error("Camera error:", error);

    statusElement.textContent =
      `${error.name}: ${error.message}`;
  }
});

stopButton.addEventListener("click", () => {
  stream?.getTracks().forEach(track => track.stop());
  stream = null;

  video.srcObject = null;

  startButton.disabled = false;
  stopButton.disabled = true;
  statusElement.textContent = "Camera stopped";
});

