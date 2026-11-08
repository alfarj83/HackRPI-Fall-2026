
async function notifyTabs(type) {
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (!tab.id) continue;

    try {
      await chrome.tabs.sendMessage(tab.id, { type });
    } catch (error) {
      // Restricted Chrome pages cannot receive messages.
    }
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TRACKER_BREAK_START") {
    void notifyTabs("SHOW_CLOUDS");
  }

  if (message.type === "TRACKER_BREAK_END") {
    void notifyTabs("HIDE_CLOUDS");
  }
});
