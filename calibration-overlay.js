// Content script: all webcam inference and classifier training remain in offscreen.html.
// This file runs ONLY when injected into the current ordinary website from the popup.
(() => {
  if (window.__headcloudCalibrationOverlayLoaded) return;
  window.__headcloudCalibrationOverlayLoaded = true;

  const STEPS = [
    { label: 'screen', direction: 'center', x: 50, y: 50 },
    { label: 'screen', direction: 'left', x: 12, y: 50 },
    { label: 'screen', direction: 'right', x: 88, y: 50 },
    { label: 'screen', direction: 'up', x: 50, y: 5 },
    { label: 'screen', direction: 'down', x: 50, y: 87 },
    { label: 'away', direction: 'left' },
    { label: 'away', direction: 'right' },
    { label: 'away', direction: 'up' },
    { label: 'away', direction: 'down' }
  ];
  const ARROWS = { left: '←', right: '→', up: '↑', down: '↓' };
  const SAMPLES_PER_STEP = 22;
  const ask = (command, extra = {}) => chrome.runtime.sendMessage({ type: 'ENGINE_REQUEST', command, ...extra });

  let host = null;
  let ui = null;
  let clock = null;
  let audio = null;
  let active = false;
  let registered = false;
  let completedSteps = null;
  let finishing = false;
  let busy = false;
  let stopped = false;
  let onMessage = null;
  let onPageHide = null;
  let onKeys = null;

  function sound(final = false) {
    if (audio?.state !== 'running') return;
    const now = audio.currentTime;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(final ? 1175 : 880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.1, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.27);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.28);
  }

  async function unlockSound() {
    try {
      audio ??= new AudioContext();
      if (audio.state === 'suspended') await audio.resume();
      ui?.sound && (ui.sound.textContent = audio.state === 'running' ? 'Sound on' : 'Enable sound');
    } catch (error) {
      if (ui?.sound) ui.sound.textContent = 'Sound unavailable';
      console.warn('HeadCloud sound not enabled:', error);
    }
  }

  function createOverlay() {
    host = document.createElement('div');
    host.id = 'headcloud-calibration-host';
    // Parent page CSS is prevented from changing internal controls by Shadow DOM.
    Object.assign(host.style, {
      position: 'fixed', inset: '0', width: '100vw', height: '100dvh',
      zIndex: '2147483647', pointerEvents: 'none', margin: '0', padding: '0'
    });
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .scrim { position: absolute; inset: 0; background: rgba(7,19,32,.40); pointer-events: none; }
      .target { position: absolute; transform: translate(-50%,-50%); color: #59f2c5; font: 700 clamp(42px,6vw,74px)/1 system-ui;
                text-shadow: 0 0 14px #043c32, 0 0 25px #043c32; pointer-events: none; user-select:none; }
      .target.away { color: #ffd18d; font-size: clamp(64px,9vw,105px); }
      .panel { position: absolute; bottom: 18px; right: 18px; width: min(370px, calc(100vw - 36px));
               color: #eef8ff; background: #142638f5; box-shadow: 0 10px 34px #0007;
               border: 1px solid #426278; border-radius: 15px; padding: 16px;
               font: 14px/1.5 system-ui, sans-serif; pointer-events: auto; }
      .panel strong { display: block; font-size: 13px; color: #83d8f1; }
      .panel h2 { font: 700 18px/1.3 system-ui; margin: 5px 0 8px; color: white; }
      .panel p { margin: 7px 0; }
      .progress-track { height: 8px; border-radius: 9px; overflow: hidden; background: #455c6c; margin: 12px 0; }
      .progress-fill { width: 0%; height:100%; background: #59f2c5; transition: width .15s linear; }
      .actions { display:flex; gap: 8px; flex-wrap:wrap; margin-top: 10px; }
      button { font: 600 12px/1.2 system-ui; border: 0; padding: 9px 12px; border-radius: 8px;
               color: #143348; background: #bceaff; cursor:pointer; }
      button.secondary { color: #e4eff6; background: #3b5266; }
      button:focus-visible { outline: 3px solid #ffcc80; }
      .warning { color: #ffd18d; }
      @media(max-width: 500px) { .panel { right:8px; bottom:8px; width:calc(100vw - 16px); padding:12px; } }
    `;
    shadow.append(style);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="scrim"></div>
      <div class="target" id="target" aria-hidden="true">●</div>
      <aside class="panel" role="region" aria-label="Head in the Clouds eye calibration">
        <strong id="step">Preparing calibration</strong>
        <h2 id="mode">Starting…</h2>
        <p id="help">Please keep your face visible to the webcam.</p>
        <div class="progress-track"><div class="progress-fill" id="bar"></div></div>
        <p id="progress" role="status" aria-live="polite">Connecting to tracker…</p>
        <div class="actions">
          <button id="sound" type="button">Enable sound</button>
          <button id="cancel" type="button" class="secondary">Cancel calibration</button>
        </div>
      </aside>`;
    while (wrapper.firstChild) shadow.append(wrapper.firstChild);
    ui = Object.fromEntries(['step','mode','help','progress','target','bar','sound','cancel']
      .map(id => [id, shadow.getElementById(id)]));
    ui.cancel.addEventListener('click', () => void cancel());
    ui.sound.addEventListener('click', () => void unlockSound());
    void unlockSound(); // May be blocked until user clicks Enable sound.
  }

  function render(state) {
    if (stopped || !ui) return;
    const g = state?.calibration?.guided;
    if (!state?.running) {
      ui.progress.textContent = 'Camera is off. Return to the extension to enable it.';
      return;
    }
    if (!g) {
      ui.progress.textContent = 'The installed background engine does not support guided calibration.';
      return;
    }
    const count = Number(g.completedSteps) || 0;
    if (completedSteps !== null && count > completedSteps) {
      sound(count >= STEPS.length);
    }
    completedSteps = count;
    active = Boolean(g.active);
    if (!active) {
      if (count === STEPS.length && !finishing) {
        finishing = true;
        ui.step.textContent = '9 of 9 targets completed';
        ui.mode.textContent = 'Calibration complete!';
        ui.help.textContent = 'Your calibration is saved. Returning to the webpage.';
        ui.progress.textContent = 'All targets recorded successfully.';
        ui.target.style.display = 'none';
        ui.bar.style.width = '100%';
        window.setTimeout(() => void cleanup(false), 1800);
      } else if (!finishing) {
        ui.progress.textContent = g.rejectionReason || 'Calibration stopped.';
      }
      return;
    }
    const index = Math.min(STEPS.length - 1, Math.max(0, Number(g.stepIndex) || 0));
    const step = STEPS[index];
    ui.step.textContent = `Target ${index + 1} of ${STEPS.length}`;
    ui.mode.textContent = step.label === 'screen'
      ? `Look at the ${step.direction} dot on the screen`
      : `Look ${step.direction} beyond the monitor`;
    ui.help.textContent = step.label === 'screen'
      ? 'Follow the visible dot with your eyes. Avoid exaggerated head movements.'
      : 'The arrow only indicates direction. Look at an object beyond your screen, with your face still visible.';
    const collected = Math.max(0, Number(g.collected) || 0);
    ui.progress.textContent = (g.settleRemainingMs > 0)
      ? `Get ready: ${Math.ceil(g.settleRemainingMs / 1000)} seconds`
      : g.rejectionReason
        ? `Paused at ${collected}/${SAMPLES_PER_STEP}: ${g.rejectionReason}`
        : `Recording ${collected}/${SAMPLES_PER_STEP} valid frames`;
    ui.progress.classList.toggle('warning', Boolean(g.rejectionReason));
    ui.target.style.display = 'block';
    ui.target.textContent = step.label === 'screen' ? '●' : ARROWS[step.direction];
    ui.target.classList.toggle('away', step.label === 'away');
    ui.target.style.left = `${step.x ?? 50}%`;
    ui.target.style.top = `${step.y ?? 50}%`;
    ui.bar.style.width = `${100 * (count + collected / SAMPLES_PER_STEP) / STEPS.length}%`;
  }

  async function cleanup(cancelEngine) {
    if (stopped) return;
    stopped = true;
    clearInterval(clock);
    if (onMessage) chrome.runtime.onMessage.removeListener(onMessage);
    if (onPageHide) window.removeEventListener('pagehide', onPageHide);
    if (onKeys) document.removeEventListener('keydown', onKeys, true);
    if (cancelEngine && registered) {
      try { await ask('ENGINE_CALIBRATE_CANCEL'); } catch (_) { /* engine might have stopped */ }
    }
    if (registered) {
      try { await chrome.runtime.sendMessage({ type: 'HEADCLOUD_CALIBRATION_UNREGISTER' }); }
      catch (_) { /* service worker may have restarted */ }
    }
    registered = false;
    host?.remove();
    host = null;
    ui = null;
    // Keep the message listener installed for repeat runs in the same page.
    if (audio) { try { await audio.close(); } catch (_) {} audio = null; }
  }

  async function cancel() { await cleanup(true); }

  async function tick() {
    if (stopped || busy || document.hidden) return;
    busy = true;
    try {
      // This heartbeat is needed: engine/engine.js pauses training without it.
      await chrome.runtime.sendMessage({ type: 'ENGINE_PREVIEW_REQUEST' });
      // Fallback in case an ENGINE_STATE broadcast is missed.
      const state = await ask('ENGINE_GET_STATE');
      if (state?.error) throw new Error(state.error);
      render(state);
    } catch (error) {
      if (ui) ui.progress.textContent = `Tracking connection failed: ${error.message}`;
    } finally { busy = false; }
  }

  async function start() {
    if (host) return { ok: true };
    createOverlay();
    onMessage = message => {
      if (message?.type === 'HEADCLOUD_ENGINE_STATE' && !document.hidden) render(message.state);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    onKeys = event => {
      if (event.key === 'Escape') { event.preventDefault(); void cancel(); }
    };
    document.addEventListener('keydown', onKeys, true);
    onPageHide = () => {
      // Fire and forget: the background worker also cancels on tab navigation/removal.
      if (!stopped) void ask('ENGINE_CALIBRATE_CANCEL');
    };
    window.addEventListener('pagehide', onPageHide);
    try {
      const registration = await chrome.runtime.sendMessage({ type: 'HEADCLOUD_CALIBRATION_REGISTER' });
      if (!registration?.ok) throw new Error(registration?.error || 'Registration failed');
      registered = true;
      await chrome.runtime.sendMessage({ type: 'ENGINE_PREVIEW_REQUEST' });
      const state = await ask('ENGINE_GET_STATE');
      if (!state?.running) throw new Error('Start the camera from the extension popup first.');
      const next = state?.calibration?.guided?.active ? state :
        await ask('ENGINE_CALIBRATE', { kind: 'guided' });
      if (next?.error) throw new Error(next.error);
      if (!next?.calibration?.guided?.active) throw new Error('Guided calibration could not start. Check offscreen.js and engine/engine.js.');
      completedSteps = Number(next.calibration.guided.completedSteps) || 0;
      active = true;
      render(next);
      clock = setInterval(() => void tick(), 650);
      return { ok: true };
    } catch (error) {
      await cleanup(true);
      return { ok: false, error: error.message };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'HEADCLOUD_CALIBRATION_START') return false;
    void start().then(sendResponse);
    return true;
  });
})();
