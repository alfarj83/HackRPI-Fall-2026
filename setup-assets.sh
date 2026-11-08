#!/usr/bin/env bash
set -euo pipefail
npm install --no-save @mediapipe/tasks-vision
mkdir -p vendor wasm models
cp node_modules/@mediapipe/tasks-vision/vision_bundle.mjs vendor/
cp node_modules/@mediapipe/tasks-vision/wasm/* wasm/
curl -fL 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' -o models/face_landmarker.task
echo 'Assets downloaded. Load this folder via chrome://extensions > Load unpacked.'
