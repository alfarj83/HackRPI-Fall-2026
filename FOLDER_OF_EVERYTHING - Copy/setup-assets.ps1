# Run in PowerShell in the extension directory.
npm install --no-save @mediapipe/tasks-vision
New-Item -ItemType Directory -Force vendor, wasm, models | Out-Null
Copy-Item node_modules\@mediapipe\tasks-vision\vision_bundle.mjs vendor\vision_bundle.mjs
Copy-Item node_modules\@mediapipe\tasks-vision\wasm\* wasm\ -Force
Invoke-WebRequest 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' -OutFile models\face_landmarker.task
Write-Host 'Assets downloaded. Load this folder via chrome://extensions > Load unpacked.'
