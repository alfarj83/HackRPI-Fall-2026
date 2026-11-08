// Binds the "Allow notifications" popup (<dialog id="notify-dialog">) in tracker.html.
import {
  requestNotifications,
  resultMessage,
  shouldPrompt,
  markEnabled,
  markDismissed
} from "./notification-permission.js";

const $ = id => document.getElementById(id);

export function initNotificationPrompt() {
  const dialog = $("notify-dialog");
  if (!dialog) return;

  const open = () => {
    $("notify-result").textContent = "";
    $("notify-allow").disabled = false;
    if (!dialog.open) dialog.showModal();
  };

  $("notify-allow").addEventListener("click", async () => {
    $("notify-allow").disabled = true;
    $("notify-result").textContent = "Sending a test notification…";
    const outcome = await requestNotifications();
    $("notify-result").textContent = resultMessage(outcome);
    if (outcome.sent) {
      markEnabled();
      $("notify-later").textContent = "Done";
    } else {
      $("notify-allow").disabled = false;
    }
  });

  $("notify-later").addEventListener("click", () => {
    markDismissed();
    dialog.close();
  });

  // Reopen later from the Room lighting section.
  $("notify-open")?.addEventListener("click", () => {
    $("notify-later").textContent = "Not now";
    open();
  });

  if (shouldPrompt()) open();
}
