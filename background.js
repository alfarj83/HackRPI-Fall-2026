
async function notifyTabs(type) {
  const tabs = await chrome.tabs.query({});

  console.log("Cloud event:", type);

  for (const tab of tabs) {
    if (!tab.id) continue;

    // Only ordinary websites support the overlay.
    if (!/^https?:\/\//.test(tab.url || "")) continue;

    try {
      // Try sending the message normally.
      await chrome.tabs.sendMessage(tab.id, { type });

      console.log("Cloud message delivered:", tab.url);

    } catch (error) {

      // If the cloud script isn't loaded, inject it.
      console.log("Injecting cloud overlay into:", tab.url);

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["cloud-overlay.js"]
        });

        // Now send the cloud message again.
        await chrome.tabs.sendMessage(tab.id, { type });

        console.log("Cloud overlay started:", tab.url);

      } catch (injectionError) {
        console.warn(
          "Could not show clouds on:",
          tab.url,
          injectionError.message
        );
      }
    }
  }
}

chrome.runtime.onMessage.addListener((message) => {

  if (message.type === "TRACKER_BREAK_START") {
    console.log("Break started!");
    void notifyTabs("SHOW_CLOUDS");
  }

  if (message.type === "TRACKER_BREAK_END") {
    console.log("Break finished!");
    void notifyTabs("HIDE_CLOUDS");
  }

});
