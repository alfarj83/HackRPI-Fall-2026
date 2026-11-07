(() => {
  if (document.getElementById("cloud-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "cloud-overlay";

  const shadow = overlay.attachShadow({ mode: "open" });

  const style = document.createElement("style");

  style.textContent = `
    * {
      box-sizing: border-box;
    }

    .screen {
      position: fixed;
      inset: 0;
      overflow: hidden;
      background: transparent;
      font-family: Arial, sans-serif;
    }

    .cloud {
      position: absolute;
      display: block;
      height: auto;
      pointer-events: none;
      will-change: transform;
      animation: floatIn 5s ease-out forwards;
    }

    @keyframes floatIn {
      from {
        transform: translateX(0);
      }

      to {
        transform: translateX(var(--distance));
      }
    }

    .message {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      text-align: center;
      opacity: 0;
      color: #465a80;
      z-index: 3;
      pointer-events: none;
      transition: opacity 1s ease;
    }

    .message.show {
      opacity: 1;
      pointer-events: auto;
    }

    .message h1 {
      font-size: 42px;
      margin-bottom: 10px;
    }

    .message p {
      font-size: 18px;
    }

    .message button {
      padding: 14px 30px;
      background: #8190ff;
      color: white;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      margin-top: 20px;
    }

    @media (prefers-reduced-motion: reduce) {
      .cloud {
        animation: none;
        transform: translateX(var(--distance));
      }
    }
  `;

  const screen = document.createElement("div");
  screen.className = "screen";

  const message = document.createElement("div");
  message.className = "message";

  const title = document.createElement("h1");
  title.textContent = "Head in the Clouds ☁️";

  const subtitle = document.createElement("p");
  subtitle.textContent = "Time to rest your eyes.";

  const close = document.createElement("button");
  close.textContent = "Back to Work";
  close.onclick = () => overlay.remove();

  message.append(title, subtitle, close);

  shadow.append(style, screen);
  screen.appendChild(message);

  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    zIndex: "2147483647",
    pointerEvents: "auto"
  });

  document.documentElement.appendChild(overlay);

  // Use YOUR uploaded cloud.png from the extension
  const cloudImage = chrome.runtime.getURL("cloud.png");

  const totalClouds = 220;

  for (let i = 0; i < totalClouds; i++) {
    const cloud = document.createElement("img");

    cloud.className = "cloud";
    cloud.src = cloudImage;
    cloud.alt = "";

    // Random cloud sizes
    const size = 45 + Math.random() * 160;

    // Random locations across the entire screen
    const targetX = Math.random() * window.innerWidth;
    const targetY = Math.random() * window.innerHeight;

    // Random opacity
    const opacity = 0.3 + Math.random() * 0.7;

    // Random animation duration and delay
    const duration = 2.5 + Math.random() * 3;
    const delay = Math.random() * 3;

    cloud.style.width = `${size}px`;
    cloud.style.left = `${-size - 30}px`;
    cloud.style.top = `${targetY}px`;
    cloud.style.opacity = opacity;

    cloud.style.setProperty(
      "--distance",
      `${targetX + size + 30}px`
    );

    cloud.style.animationDuration = `${duration}s`;
    cloud.style.animationDelay = `${delay}s`;

    // Random depth
    cloud.style.zIndex = Math.floor(size);

    screen.appendChild(cloud);
  }

  // Make sure the page becomes completely covered
  setTimeout(() => {
    const background = document.createElement("div");

    Object.assign(background.style, {
      position: "absolute",
      inset: "0",
      background: "#eaf5ff",
      opacity: "0",
      transition: "opacity 1.5s ease",
      zIndex: "0"
    });

    screen.prepend(background);

    requestAnimationFrame(() => {
      background.style.opacity = "1";
    });
  }, 4500);

  setTimeout(() => {
    message.classList.add("show");
  }, 6500);
})();
