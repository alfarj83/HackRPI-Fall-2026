
import { useEffect, useRef, useState } from "react";

import {
  FaceLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

import FaceLandmarkerControls from "./FaceLandmarkerControls";
import { drawFaceLandmarks } from "./drawFaceLandmarks";

const DEFAULT_SETTINGS = {
  numFaces: 1,
  minFaceDetectionConfidence: 0.5,
  minFacePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

export default function FaceLandmarkerDemo() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Loading MediaPipe...");

  const landmarkerRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const runningRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);

  // Initialize MediaPipe.
  useEffect(() => {
    let cancelled = false;
    let instance = null;

    async function initialize() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "/wasm"
        );

        instance = await FaceLandmarker.createFromOptions(
          vision,
          {
            baseOptions: {
              modelAssetPath:
                "/models/face_landmarker.task",
              delegate: "CPU",
            },
            runningMode: "VIDEO",
            ...DEFAULT_SETTINGS,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
          }
        );

        if (cancelled) {
          instance.close();
          return;
        }

        landmarkerRef.current = instance;
        setReady(true);
        setStatus("MediaPipe ready");
      } catch (error) {
        if (!cancelled) {
          setStatus(`Initialization error: ${error.message}`);
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
      runningRef.current = false;

      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }

      streamRef.current?.getTracks().forEach(
        (track) => track.stop()
      );

      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  // Apply confidence slider changes.
  useEffect(() => {
    if (!ready || !landmarkerRef.current) return;

    landmarkerRef.current.setOptions(settings).catch(
      (error) => {
        setStatus(`Settings error: ${error.message}`);
      }
    );
  }, [settings, ready]);

  function detectFrame() {
    if (!runningRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;

    if (
      video &&
      canvas &&
      landmarker &&
      video.readyState >= 2 &&
      video.currentTime !== lastVideoTimeRef.current
    ) {
      lastVideoTimeRef.current = video.currentTime;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const result = landmarker.detectForVideo(
        video,
        performance.now()
      );

      const ctx = canvas.getContext("2d");
      drawFaceLandmarks(ctx, result);

      // Add EyeEase blink tracking here.
      if (result.faceBlendshapes.length > 0) {
        const categories =
          result.faceBlendshapes[0].categories;

        const leftBlink = categories.find(
          (category) =>
            category.categoryName === "eyeBlinkLeft"
        );

        if (leftBlink) {
          console.log("Eye closure:", leftBlink.score);
        }
      }
    }

    frameRef.current = requestAnimationFrame(detectFrame);
  }

  async function startCamera() {
    if (!ready || runningRef.current) return;

    try {
      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });

      streamRef.current = stream;
      videoRef.current.srcObject = stream;

      await videoRef.current.play();

      runningRef.current = true;
      setRunning(true);
      setStatus("Tracking active");

      detectFrame();
    } catch (error) {
      setStatus(`Camera error: ${error.message}`);
    }
  }

  function stopCamera() {
    runningRef.current = false;

    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    streamRef.current?.getTracks().forEach(
      (track) => track.stop()
    );

    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    const canvas = canvasRef.current;

    canvas?.getContext("2d")?.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    setRunning(false);
    setStatus("Tracking stopped");
  }

  return (
    <div className="face-landmarker">
      <h2>EyeEase Face Tracking</h2>

      <p>{status}</p>

      <FaceLandmarkerControls
        settings={settings}
        onChange={setSettings}
      />

      <button
        onClick={startCamera}
        disabled={!ready || running}
      >
        Start Tracking
      </button>

      <button
        onClick={stopCamera}
        disabled={!running}
      >
        Stop Tracking
      </button>

      <div className="preview">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
        />

        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}