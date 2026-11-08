
const TIMER_MINUTES = 0.5; // Change to 20 for a 20-minute timer
const TIMER_SECONDS = TIMER_MINUTES * 60;

const timerDisplay = document.getElementById("timer-display");
const startButton = document.getElementById("start-timer");

// Display the original duration when no timer is running
timerDisplay.textContent = formatTime(TIMER_SECONDS);

startButton.addEventListener("click", () => {
  startTimer(TIMER_MINUTES);
  updateTimerDisplay();
});

function updateTimerDisplay() {
  getRemainingTime((remaining) => {
    if (remaining <= 0) {
      // Reset to original duration when finished
      timerDisplay.textContent = formatTime(TIMER_SECONDS);
    } else {
      timerDisplay.textContent = formatTime(remaining);
    }
  });
}

setInterval(updateTimerDisplay, 1000);
updateTimerDisplay();