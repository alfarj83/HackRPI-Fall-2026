const openTrackerButton =
    document.getElementById("open-tracker");

const openDashboardButton =
    document.getElementById("open-dashboard");

// Open the eye tracker in a separate browser tab.
openTrackerButton.addEventListener("click", () => {
    chrome.tabs.create({
        url: chrome.runtime.getURL("tracker.html")
    });
});

// Open the analytics dashboard in a separate browser tab.
openDashboardButton.addEventListener("click", () => {
    chrome.tabs.create({
        url: chrome.runtime.getURL("dashboard.html")
    });
});
