# Head in the Clouds

Made by Jamie Alfaro, Jay Zhao, Minna Huang, and Isabella Siu for HackRPI Fall 2026.

Head in the Clouds is a Chrome extension that helps with eye strain. It uses your webcam to tell whether you are looking at your screen, and after you have been staring for 20 minutes it floats clouds across your open tabs as a reminder to look away. The clouds stay until you have looked away from the screen for 20 seconds. Both times can be changed in Settings.

It also checks the room behind you. If the room has stayed dark for 30 seconds, the toolbar icon gets a red badge and Chrome sends a notification telling you to turn on a light.

## Privacy

Nothing leaves your computer. The camera feed is read on your device to estimate where you are looking and how bright the room is, and it is never recorded, saved, or sent anywhere. The only thing stored is a short list of numbers from your calibration (head and eye position), which stays in Chrome's local storage on your machine.

## Setting it up

The face model and the MediaPipe files are too big to keep in the repo, so a script downloads them first. You need Node.js installed. On macOS or Linux, run this from the repo folder:

```
bash setup-assets.sh
```

On Windows, run this in PowerShell instead:

```
powershell -ExecutionPolicy Bypass -File .\setup-assets.ps1
```

Then open chrome://extensions, turn on Developer mode, click Load unpacked, and choose the repo folder (the one with manifest.json in it). Click the cloud icon in the toolbar to open the popup.

The first time, the popup walks you through setup. Press Enable Camera and allow access, then do the two calibration steps. For the first step you look at your screen the way you normally read it, and for the second you look away. The second step starts on its own a few seconds after the first one finishes. When both are done, press Start Timer.

After that the popup opens straight to the cloud timer, and your calibration is saved so you do not have to repeat it. If you restart Chrome, the camera stays off until you press Start camera on the timer page.

## Using it

The camera and the detection run in a hidden page that Chrome keeps alive, so closing the popup does not stop anything. The only way to turn the camera off is the Stop camera button in Settings. Chrome will show its camera-in-use indicator the whole time it runs, and that is expected.

The gear in the top right opens Settings. There you can change how many minutes of screen time come before a break and how many seconds a break lasts, switch dark room alerts and break reminders on or off, and switch between light and dark mode. The info icon in the top right of the Settings page shows the privacy note.

## How it works

Eye tracking uses MediaPipe's Face Landmarker. For each frame it measures head position and where the iris sits in the eye, then compares that to the examples you recorded during calibration to decide whether you are looking at the screen or away. The timers only count while that guess is fresh.

Room lighting uses MediaPipe's selfie segmenter to separate you from the background, then measures the brightness of the background only, so a bright face in a dark room still counts as dark. The result is dark or bright with some smoothing so it does not flicker. The code for this is in the webcam-darkness folder.

The service worker in background.js handles the toolbar badge, the notifications, and sending the cloud messages to your tabs. The cloud animation itself is drawn by cloud-overlay.js, which runs on normal web pages. The popup in tracker.html and tracker.js only shows what the hidden engine reports and sends it commands.

## Things that do not work well yet

The tracking is a rough estimate, not a real gaze tracker. Glasses, a different seat position, and odd camera angles can throw it off, and if your face is not visible it counts as unknown, not as looking away.

Webcams adjust their own exposure, so the brightness reading is relative to the camera and does not measure real light in the room.

The clouds only show on normal http and https pages, not on chrome:// pages or the new tab page. Tabs that were open before the extension was loaded may need a refresh first.

There is no button to redo calibration right now. To calibrate again, remove the extension and load it again.

## Tests

The tests run with Node's built-in test runner:

```
node --test webcam-darkness/*.test.mjs engine/*.test.mjs settings.test.mjs notification-prefs.test.mjs
```

They cover the timers, the saved calibration, the settings limits, the notification switches, and the darkness and badge logic. They do not cover the popup or the camera, so those need to be checked by hand in Chrome.
