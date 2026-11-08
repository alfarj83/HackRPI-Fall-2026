// Logic for the "Allow notifications" popup. chrome.notifications has no built-in
// permission prompt for extensions, so we check the permission level and send a test
// notification (which also triggers the operating system's own request the first time).

const ENABLED_KEY = "headInTheClouds.notificationsEnabled";
const DISMISSED_KEY = "headInTheClouds.notificationPromptDismissed";
const TEST_ID = "lighting-test";
const ICON = "Images/cloud1.png";

function api() {
  return typeof chrome !== "undefined" && chrome.notifications ? chrome.notifications : null;
}

// "granted", "denied", or "unavailable" when the API isn't there.
export function getPermissionLevel() {
  const notifications = api();
  if (!notifications?.getPermissionLevel) return Promise.resolve("unavailable");
  return new Promise(resolve => {
    try {
      notifications.getPermissionLevel(level => resolve(level ?? "unavailable"));
    } catch {
      resolve("unavailable");
    }
  });
}

function isShown(id) {
  const notifications = api();
  if (!notifications?.getAll) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      notifications.getAll(all => resolve(Boolean(all && id in all)));
    } catch {
      resolve(null);
    }
  });
}

// Sends a test notification. Returns { level, sent, shown, error }.
// shown: whether Chrome still lists it right after creating it (null if it can't tell).
export async function requestNotifications() {
  const notifications = api();
  const level = await getPermissionLevel();
  if (!notifications || level === "unavailable") {
    return { level, sent: false, error: "unavailable" };
  }
  if (level === "denied") return { level, sent: false, error: "denied" };

  try {
    await new Promise((resolve, reject) => {
      notifications.create(
        TEST_ID,
        {
          type: "basic",
          iconUrl: chrome.runtime.getURL(ICON),
          title: "Notifications are on",
          message: "We'll remind you to turn on a light when your room gets dark.",
          priority: 1,
          requireInteraction: true // stays up until dismissed, so it can't be missed
        },
        () => {
          const problem = chrome.runtime?.lastError;
          problem ? reject(new Error(problem.message)) : resolve();
        }
      );
    });
    return { level, sent: true, shown: await isShown(TEST_ID), error: null };
  } catch (error) {
    return { level, sent: false, shown: null, error: error.message };
  }
}

function read(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    // storage unavailable: the popup may just show again next time
  }
}

// Ask unless the user already enabled notifications, or said "Not now" this session.
export function shouldPrompt() {
  const local = typeof localStorage !== "undefined" ? localStorage : null;
  const session = typeof sessionStorage !== "undefined" ? sessionStorage : null;
  if (local && read(local, ENABLED_KEY) === "yes") return false;
  if (session && read(session, DISMISSED_KEY) === "yes") return false;
  return true;
}

export function markEnabled() {
  if (typeof localStorage !== "undefined") write(localStorage, ENABLED_KEY, "yes");
}

export function markDismissed() {
  if (typeof sessionStorage !== "undefined") write(sessionStorage, DISMISSED_KEY, "yes");
}

// Text shown in the popup for each outcome.
const OS_HELP =
  "Check your computer's notification settings for Google Chrome (Mac: System Settings > Notifications > Google Chrome, set to Allow and Banners or Alerts; Windows: Settings > System > Notifications), and turn off Focus / Do Not Disturb.";

export function resultMessage({ sent, shown, error }) {
  if (sent && shown === false) {
    return `Chrome created the notification but it closed right away, which usually means your computer blocked it. ${OS_HELP}`;
  }
  if (sent) {
    return `Chrome created the notification. If you can't see it on screen, your computer is hiding it, not Chrome. ${OS_HELP}`;
  }
  if (error === "denied") {
    return "Notifications are blocked for this extension. Turn them on in Chrome (Settings > Privacy and security > Site settings > Notifications) and in your computer's notification settings, then try again.";
  }
  if (error === "unavailable") {
    return "Notifications aren't available here. Open this page from the extension and reload the extension.";
  }
  return `Couldn't send a test notification: ${error}`;
}
