
import {
  DrawingUtils,
  FaceLandmarker,
} from "@mediapipe/tasks-vision";

export function drawFaceLandmarks(ctx, result) {
  ctx.clearRect(
    0,
    0,
    ctx.canvas.width,
    ctx.canvas.height
  );

  const drawingUtils = new DrawingUtils(ctx);

  for (const landmarks of result.faceLandmarks) {
    const connectors = [
      [FaceLandmarker.FACE_LANDMARKS_TESSELATION, "#C0C0C070"],
      [FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, "#FF3030"],
      [FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, "#30FF30"],
      [FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, "#FF3030"],
      [FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, "#30FF30"],
      [FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, "#E0E0E0"],
      [FaceLandmarker.FACE_LANDMARKS_LIPS, "#E0E0E0"],
      [FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, "#FF3030"],
      [FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, "#30FF30"],
    ];

    for (const [connections, color] of connectors) {
      drawingUtils.drawConnectors(
        landmarks,
        connections,
        { color, lineWidth: 1 }
      );
    }
  }
}
