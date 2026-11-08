// Native OS notification when the room has been dark long enough (the classifier's
// needsLight flag). Fires once each time needsLight turns true, not on every frame.
import { messageFor } from "./darkness.js";

const NOTIFICATION_ID = "lighting-reminder";
const ICON = "Images/cloud1.png";

let wasNeeded = false;

function api() {
  return typeof chrome !== "undefined" && chrome.notifications ? chrome.notifications : null;
}

// The reason decides the headline. Only "dark" exists today; add cases here if the
// classifier gains more reasons (e.g. backlit).
export function titleFor(state) {
  switch (state?.label) {
    case "dark":
      return "Your room is dark";
    default:
      return "Check your lighting";
  }
}

// Call with each classifier snapshot. Returns true when it fired a notification.
// onError is called if Chrome rejects the notification (so failures are not silent).
export function maybeNotify(state, onError = console.error) {
  const needed = Boolean(state?.needsLight);
  const rising = needed && !wasNeeded;
  wasNeeded = needed;

  const notifications = api();
  if (!rising || !notifications) return false;

  try {
    Promise.resolve(
      notifications.create(NOTIFICATION_ID, {
        type: "basic",
        iconUrl: chrome.runtime.getURL(ICON),
        title: titleFor(state),
        message: messageFor(state),
        priority: 1,
        requireInteraction: true // stays up until dismissed, so it can't be missed
      })
    ).catch(onError);
  } catch (error) {
    onError(error); // a notification failure must never break the page
  }
  return true;
}

// Call when the camera stops so the next dark spell can notify again.
export function resetNotifier() {
  wasNeeded = false;
}
