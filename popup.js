
// import {
//   FaceLandmarker,
//   FilesetResolver,
//   DrawingUtils
// } from "./vendor/vision_bundle.mjs";

// import { AttentionDetector } from "./attention.js";

// const video = document.getElementById("webcam");
// const canvas = document.getElementById("overlay");
// const ctx = canvas.getContext("2d");

// const startButton = document.getElementById("start");
// const stopButton = document.getElementById("stop");
// const calibrateButton =
//   document.getElementById("calibrate");

// const statusElement = document.getElementById("status");
// const attentionLabel =
//   document.getElementById("attention");

// const detector = new AttentionDetector();

// let landmarker = null;
// let stream = null;
// let running = false;
// let starting = false;
// let animationId = null;
// let lastVideoTime = -1;
// let lastInferenceTime = 0;

// async function initializeMediaPipe() {
//   if (landmarker) return;

//   statusElement.textContent = "Loading MediaPipe...";

//   const vision = await FilesetResolver.forVisionTasks(
//     chrome.runtime.getURL("wasm")
//   );

//   landmarker = await FaceLandmarker.createFromOptions(
//     vision,
//     {
//       baseOptions: {
//         modelAssetPath: chrome.runtime.getURL(
//           "models/face_landmarker.task"
//         ),
//         delegate: "CPU"
//       },
//       runningMode: "VIDEO",
//       numFaces: 1,
//       outputFaceBlendshapes: true,
//       minFaceDetectionConfidence: 0.5,
//       minTrackingConfidence: 0.5
//     }
//   );
// }

// function drawResults(result) {
//   ctx.clearRect(0, 0, canvas.width, canvas.height);

//   const drawingUtils = new DrawingUtils(ctx);

//   for (const landmarks of result.faceLandmarks) {
//     drawingUtils.drawConnectors(
//       landmarks,
//       FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
//       { color: "#00FF88", lineWidth: 2 }
//     );

//     drawingUtils.drawConnectors(
//       landmarks,
//       FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
//       { color: "#00FFFF", lineWidth: 2 }
//     );

//     drawingUtils.drawConnectors(
//       landmarks,
//       FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
//       { color: "#00FFFF", lineWidth: 2 }
//     );

//     drawingUtils.drawConnectors(
//       landmarks,
//       FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
//       { color: "#FFFF00", lineWidth: 2 }
//     );

//     drawingUtils.drawConnectors(
//       landmarks,
//       FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
//       { color: "#FFFF00", lineWidth: 2 }
//     );
//   }
// }

// function updateAttention(state) {
//   const labels = {
//     "looking-at-screen": "Likely looking at screen",
//     "looking-away": "Likely looking away",
//     "uncertain": "Checking attention...",
//     "calibrating": "Calibrating...",
//     "unknown": "Unknown"
//   };

//   attentionLabel.textContent =
//     `Attention: ${labels[state] ?? "Unknown"}`;
// }

// function detectLoop() {
//   if (!running) return;

//   const now = performance.now();

//   // Limit inference to approximately 15 FPS.
//   if (
//     video.readyState >= 2 &&
//     video.currentTime !== lastVideoTime &&
//     now - lastInferenceTime >= 66
//   ) {
//     lastVideoTime = video.currentTime;
//     lastInferenceTime = now;

//     canvas.width = video.videoWidth;
//     canvas.height = video.videoHeight;

//     const result = landmarker.detectForVideo(
//       video,
//       now
//     );

//     drawResults(result);

//     const attentionState = detector.analyze(result, now);
//     updateAttention(attentionState);
//   }

//   animationId = requestAnimationFrame(detectLoop);
// }

// async function startTracking() {
//   if (starting || running) return;

//   starting = true;
//   startButton.disabled = true;

//   try {
//     await initializeMediaPipe();

//     stream = await navigator.mediaDevices.getUserMedia({
//       video: {
//         width: 640,
//         height: 480,
//         facingMode: "user"
//       },
//       audio: false
//     });

//     video.srcObject = stream;
//     await video.play();

//     detector.calibrate();

//     lastVideoTime = -1;
//     lastInferenceTime = 0;
//     running = true;

//     stopButton.disabled = false;
//     calibrateButton.disabled = false;
//     status.textContent = "Tracking active";

//     detectLoop();
//   } catch (error) {
//     status.textContent = `Error: ${error.message}`;
//     stopTracking(false);
//   } finally {
//     starting = false;
//     if (!running) startButton.disabled = false;
//   }
// }

// function stopTracking(updateStatus = true) {
//   running = false;

//   if (animationId !== null) {
//     cancelAnimationFrame(animationId);
//     animationId = null;
//   }

//   if (stream) {
//     stream.getTracks().forEach(track => track.stop());
//     stream = null;
//   }

//   video.srcObject = null;
//   ctx.clearRect(0, 0, canvas.width, canvas.height);

//   startButton.disabled = false;
//   stopButton.disabled = true;
//   calibrateButton.disabled = true;

//   if (updateStatus) {
//     status.textContent = "Tracking stopped";
//   }

//   updateAttention("unknown");
// }

// startButton.addEventListener("click", startTracking);

// stopButton.addEventListener("click", () => {
//   stopTracking();
// });

// calibrateButton.addEventListener("click", () => {
//   detector.calibrate();
//   updateAttention("calibrating");
// });

// window.addEventListener("pagehide", () => {
//   stopTracking();
//   landmarker?.close();
//   landmarker = null;
// });


const video = document.getElementById("webcam");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const statusElement = document.getElementById("status");

let stream = null;

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

