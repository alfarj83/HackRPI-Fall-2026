document.getElementById("open-tracker").addEventListener("click", () => {

  // Size of our mini tracker window
  const popupWidth = 440;
  const popupHeight = 640;

  // Position near the upper-right corner
  const left = Math.max(
    0,
    (window.screen.availLeft || 0) +
    window.screen.availWidth - popupWidth - 20
  );

  const top = (window.screen.availTop || 0) + 20;

  // Open the tracker as a small separate window
  chrome.windows.create({
    url: chrome.runtime.getURL("tracker.html"),
    type: "popup",
    width: popupWidth,
    height: popupHeight,
    left: Math.round(left),
    top: Math.round(top),
    focused: true
  });
});
// const openTrackerButton =
//     document.getElementById("open-tracker");

// const openDashboardButton =
//     document.getElementById("open-dashboard");

// // Open the eye tracker in a separate browser tab.
// openTrackerButton.addEventListener("click", () => {
//     chrome.tabs.create({
//         url: chrome.runtime.getURL("tracker.html")
//     });
// });

// // Open the analytics dashboard in a separate browser tab.
// openDashboardButton.addEventListener("click", () => {
//     chrome.tabs.create({
//         url: chrome.runtime.getURL("dashboard.html")
//     });
// });
