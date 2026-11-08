const timerDisplay = document.getElementById("timer-display");
const startButton = document.getElementById("start-timer");

startButton.addEventListener("click", () => {
  startTimer(0.5);
  updateTimerDisplay();
});

function updateTimerDisplay() {
  getRemainingTime((remaining) => {
    timerDisplay.textContent = formatTime(remaining);
  });
}

setInterval(updateTimerDisplay, 1000);
updateTimerDisplay();
