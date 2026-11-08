
/* Head in the Clouds — layered PNG cloud timer.
   Uses the original 360x240 artwork.
   Includes timer progress and blinking eyes only.
*/

(() => {
  const mount = document.getElementById("cloud-timer-mount");

  if (!mount || mount.dataset.ready === "true") return;

  mount.dataset.ready = "true";

  // CREATE CLOUD
  const wrapper = document.createElement("div");
  wrapper.className = "cloud-timer-widget";

  wrapper.innerHTML = `
    <div
      class="cloud-timer-art"
      role="img"
      aria-label="Cloud timer with animated eyes"
    >
      <!-- Purple progress -->
      <img
        class="cloud-timer-layer cloud-timer-progress"
        src="Images/ProgressColor.png"
        alt=""
        draggable="false"
      >

      <!-- Main cloud -->
      <img
        class="cloud-timer-layer cloud-timer-body"
        src="Images/CloudBase.png"
        alt=""
        draggable="false"
      >

      <!-- Face -->
      <div class="cloud-timer-face">

        <!-- Eyes -->
        <img
          class="cloud-timer-layer cloud-timer-eyes"
          src="Images/Eyes.png"
          alt=""
          draggable="false"
        >

        <!-- Mouth -->
        <img
          class="cloud-timer-layer cloud-timer-mouth"
          src="Images/Mouth.png"
          alt=""
          draggable="false"
        >

      </div>
    </div>
  `;

  mount.appendChild(wrapper);

  // SELECT ELEMENTS
  const progressLayer = wrapper.querySelector(
    ".cloud-timer-progress"
  );

  const eyes = wrapper.querySelector(
    ".cloud-timer-eyes"
  );

  
  // SELECT FACE (eyes and mouth together)
  const face = wrapper.querySelector(".cloud-timer-face");

  // Maximum face movement in pixels
  const MAX_MOVE = 8;

  // Move the entire face toward the cursor
  function followCursor(event) {
    if (reduceMotion.matches) return;

    const cloud = wrapper.querySelector(".cloud-timer-art");
    const rect = cloud.getBoundingClientRect();

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = (event.clientX - centerX) / (rect.width / 2);
    const dy = (event.clientY - centerY) / (rect.height / 2);

    const x = Math.max(-1, Math.min(1, dx)) * MAX_MOVE;
    const y = Math.max(-1, Math.min(1, dy)) * MAX_MOVE;

    face.style.transform = `translate(${x}px, ${y}px)`;
  }

  // Return the face to the center
  function resetFace() {
    face.style.transform = "translate(0px, 0px)";
  }

  // Follow cursor anywhere inside the popup
  document.addEventListener("pointermove", followCursor);
  document.addEventListener("pointerleave", resetFace);


  let alive = true;
  let blinkTimer = null;
  let blinkDoneTimer = null;

  // TIMER PROGRESS
  // Accepts a number from 0 to 1
  window.updateCloudTimer = (ratio) => {
    const value = Math.max(
      0,
      Math.min(1, Number(ratio) || 0)
    );

    // Reveal the purple border from left to right
    progressLayer.style.clipPath =
      `inset(0 ${(100 - value * 100).toFixed(3)}% 0 0)`;

    const label = document.getElementById(
      "cloud-timer-percent"
    );

    if (label) {
      label.textContent =
        `${Math.round(value * 100)}% complete`;
    }
  };

  window.updateCloudTimer(0);

  // CHECK ACCESSIBILITY SETTINGS
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  // MAKE EYES BLINK
  function blink() {
    if (!alive || reduceMotion.matches) return;

    // Remove previous blink class
    eyes.classList.remove("is-blinking");

    // Force browser to restart animation
    void eyes.offsetWidth;

    // Start blink
    eyes.classList.add("is-blinking");

    // Return to normal after 500ms
    blinkDoneTimer = setTimeout(() => {
      eyes.classList.remove("is-blinking");
    }, 500);
  }

  // RANDOM BLINK EVERY 3–5 SECONDS
  function scheduleBlink() {
    if (!alive || reduceMotion.matches) return;

    const delay = 3000 + Math.random() * 2000;

    blinkTimer = setTimeout(() => {
      blink();
      scheduleBlink();
    }, delay);
  }

  // START BLINKING
  scheduleBlink();

  // Debug helper: manually trigger a blink in DevTools
  window.testCloudBlink = blink;

  // CLEANUP
  window.destroyCloudTimer = () => {
    alive = false;

    
    document.removeEventListener("pointermove", followCursor);
    document.removeEventListener("pointerleave", resetFace);


    clearTimeout(blinkTimer);
    clearTimeout(blinkDoneTimer);

    delete window.updateCloudTimer;
    delete window.testCloudBlink;
    delete window.destroyCloudTimer;

    mount.dataset.ready = "false";
    wrapper.remove();
  };
})();
