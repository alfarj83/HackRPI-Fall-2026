function startTimer(minutes) {
  chrome.runtime.sendMessage({
    type: "START_EYE_TIMER",
    minutes: minutes
  });
}

function getRemainingTime(callback) {
  chrome.runtime.sendMessage({
    type: "GET_EYE_TIMER"
  }, (response) => {
    if (!response || !response.endTime) {
      callback(0);
      return;
    }

    const remaining = Math.max(
      0,
      Math.ceil((response.endTime - Date.now()) / 1000)
    );

    callback(remaining);
  });
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
