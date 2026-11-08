document.getElementById('open-tracker').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('tracker.html') });
});
