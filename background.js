const ALARM_NAME = "eye-break-timer";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_EYE_TIMER") {
    const minutes = Number(message.minutes) || 20;
    const endTime = Date.now() + minutes * 60 * 1000;

    chrome.alarms.create(ALARM_NAME, { when: endTime });

    chrome.storage.local.set({ eyeTimerEnd: endTime });

    sendResponse({ success: true, endTime });
  }

  if (message.type === "GET_EYE_TIMER") {
    chrome.storage.local.get("eyeTimerEnd").then((result) => {
      sendResponse({ endTime: result.eyeTimerEnd || null });
    });

    return true;
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  await chrome.storage.local.remove("eyeTimerEnd");

  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (!tab.id) continue;

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "SHOW_CLOUDS"
      });
    } catch (error) {
      // Some pages do not permit extension content scripts.
    }
  }
});