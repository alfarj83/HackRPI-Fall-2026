const grantButton = document.getElementById("grant");
const statusElement = document.getElementById("status");

grantButton.addEventListener("click", async () => {
  grantButton.disabled = true;

  try {
    statusElement.textContent =
      "Requesting camera permission...";

    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });

    // Permission granted. Stop the temporary camera stream.
    stream.getTracks().forEach(track => track.stop());

    statusElement.textContent =
      "Camera permission granted! You can return to Head in the Clouds.";

  } catch (error) {
    console.error("Camera permission error:", error);

    statusElement.textContent =
      `Permission failed: ${error.name} - ${error.message}`;

  } finally {
    grantButton.disabled = false;
  }
});
