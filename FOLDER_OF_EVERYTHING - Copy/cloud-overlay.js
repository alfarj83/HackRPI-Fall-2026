
(() => {
  if (window.__cloudOverlayLoaded) return;
  window.__cloudOverlayLoaded = true;

  const cloudImages = [
    "cloud1.png",
    "cloud2.png",
    "cloud3.png",
    "cloud4.png"
  ];

  let leaveTimeout = null;
  let removeTimeout = null;

  // Make clouds leave the screen
  function hideClouds() {
    const host = document.getElementById("eye-break-clouds");

    if (!host) return;

    clearTimeout(leaveTimeout);
    clearTimeout(removeTimeout);

    const shadow = host.shadowRoot;

    shadow.querySelectorAll(".cloud").forEach(cloud => {
      cloud.classList.add("leaving");
    });

    shadow.querySelector(".background")?.classList.add("leaving");

    removeTimeout = setTimeout(() => {
      host.remove();
    }, 6000);
  }

  // Create and show the cloud animation
  function showClouds() {
    clearTimeout(leaveTimeout);
    clearTimeout(removeTimeout);

    // Remove any previous cloud overlay
    document.getElementById("eye-break-clouds")?.remove();

    const host = document.createElement("div");
    host.id = "eye-break-clouds";

    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "none"
    });

    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");

    style.textContent = `
      * {
        box-sizing: border-box;
      }

      .overlay {
        position: fixed;
        inset: 0;
        overflow: hidden;
        isolation: isolate;
        font-family: Arial, sans-serif;
      }

      .background {
        position: absolute;
        inset: 0;
        z-index: 0;
        background: #d9edf9;
        opacity: 0;
        animation: revealBackground 3s ease-in 3s forwards;
      }

      .background.leaving {
        animation: clearBackground 5s ease-in-out forwards;
      }

      .cloud {
        position: absolute;
        z-index: 1;
        display: block;

        width: var(--width);
        height: auto;

        left: var(--left);
        top: var(--top);

        opacity: 0;
        transform: translateX(-120vw);

        animation:
          floatIn var(--duration) ease-out
          var(--delay) forwards;

        user-select: none;
        pointer-events: none;
      }

      @keyframes floatIn {
        0% {
          opacity: 0;
          transform: translateX(-120vw);
        }

        25% {
          opacity: var(--opacity);
        }

        100% {
          opacity: var(--opacity);
          transform: translateX(0);
        }
      }

      @keyframes floatAway {
        0% {
          transform: translateX(0);
          opacity: var(--opacity);
        }

        70% {
          opacity: var(--opacity);
        }

        100% {
          transform: translateX(120vw);
          opacity: 0;
        }
      }

      .cloud.leaving {
        animation:
          floatAway var(--exit-duration) ease-in
          var(--exit-delay) forwards;
      }

      @keyframes revealBackground {
        to {
          opacity: 0.96;
        }
      }

      @keyframes clearBackground {
        from {
          opacity: 0.96;
        }

        to {
          opacity: 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .cloud {
          animation-duration: 0.01ms;
        }

        .background {
          animation-delay: 0s;
          animation-duration: 0.01ms;
        }
      }
    `;

    const overlay = document.createElement("div");
    overlay.className = "overlay";

    const background = document.createElement("div");
    background.className = "background";

    overlay.appendChild(background);

    // Different cloud widths in pixels
    const sizes = [100, 180, 300, 450, 650];

    // Generate 72 clouds in staggered rows
    const totalClouds = 72;
    const columns = 12;
    const rows = 6;

    for (let i = 0; i < totalClouds; i++) {
      const cloud = document.createElement("img");

      // Choose a random cloud image
      const imageName =
        cloudImages[Math.floor(Math.random() * cloudImages.length)];

      cloud.src = chrome.runtime.getURL("Images/" + imageName);
      cloud.className = "cloud";
      cloud.alt = "";

      // Determine position in grid
      const col = i % columns;
      const row = Math.floor(i / columns);

      // Choose random size
      const size =
        sizes[Math.floor(Math.random() * sizes.length)];

      const left =
        (col / (columns - 1)) * 110 - 10;

      const top =
        (row / (rows - 1)) * 110 - 10;

      cloud.style.setProperty(
        "--width",
        size + "px"
      );

      cloud.style.setProperty(
        "--left",
        `calc(${left}% + ${(Math.random() - 0.5) * 90}px)`
      );

      cloud.style.setProperty(
        "--top",
        `calc(${top}% + ${(Math.random() - 0.5) * 70}px)`
      );

      // Vary transparency
      cloud.style.setProperty(
        "--opacity",
        (0.5 + Math.random() * 0.5).toFixed(2)
      );

      // Vary arrival speed
      cloud.style.setProperty(
        "--duration",
        (3 + Math.random() * 2) + "s"
      );

      // Stagger clouds entering from the left
      cloud.style.setProperty(
        "--delay",
        (col * 0.12 + Math.random() * 1.2) + "s"
      );

      // Random exit speeds
      cloud.style.setProperty(
        "--exit-duration",
        (3 + Math.random() * 2) + "s"
      );

      // Random exit delays
      cloud.style.setProperty(
        "--exit-delay",
        (Math.random() * 0.7) + "s"
      );

      overlay.appendChild(cloud);
    }

    shadow.appendChild(style);
    shadow.appendChild(overlay);

    // Safety fallback:
    // If the eye tracker stops responding,
    // eventually remove the clouds.
    leaveTimeout = setTimeout(hideClouds, 120000);
  }

  // Receive messages from background.js
  chrome.runtime.onMessage.addListener((message) => {

    if (message.type === "SHOW_CLOUDS") {
      showClouds();
    }

    if (message.type === "HIDE_CLOUDS") {
      hideClouds();
    }

  });

})();
