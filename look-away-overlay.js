/* Head in the Clouds: warn when screen gaze interrupts an active eye break.
 * Content script: no camera access, and no calibration or timing changes.
 */
(() => {
  'use strict';
  if (globalThis.__headcloudLookAwayOverlayInstalled) return;
  globalThis.__headcloudLookAwayOverlayInstalled = true;

  const SHOW_AFTER_MS = 250;
  const POLL_MS = 1000; // backup: supports tab reloads and missed push messages
  const STALE_MS = 1800;
  const ID = 'headcloud-look-away-overlay';
  let host;
  let screenSince = null;
  let lastStateAt = 0;
  let inFlight = false;
  let latestState = null;

  function createOverlay() {
    if (host?.isConnected) return;
    host = document.getElementById(ID) || document.createElement('div');
    if (!host.id) host.id = ID;
    host.style.cssText =
      'position:fixed!important;inset:0!important;z-index:2147483647!important;' +
      'pointer-events:none!important;display:none!important;';
    if (!host.shadowRoot && !host.dataset.headcloudReady) {
      const root = host.attachShadow({ mode: 'closed' });
      const css = document.createElement('style');
      css.textContent = `
        :host { all: initial; }
        .mask { position:fixed;inset:0;background:rgba(74,12,18,.48);
          display:grid;place-items:center;pointer-events:none;
          font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif; }
        .alert { width:min(88vw,620px);box-sizing:border-box;border-radius:24px;
          padding:32px 44px;text-align:center;color:#fff;background:rgba(154,22,37,.97);
          border:2px solid rgba(255,255,255,.85);box-shadow:0 16px 58px rgba(0,0,0,.4); }
        .headline { font-size:clamp(36px,7vw,78px);font-weight:900;letter-spacing:.015em;line-height:1.1; }
        .detail { font-size:clamp(15px,2.2vw,23px);font-weight:600;margin-top:14px; }
      `;
      const warning = document.createElement('div');
      warning.className = 'mask';
      warning.setAttribute('role', 'alert');
      warning.innerHTML = '<div class="alert"><div class="headline">LOOK AWAY!!</div>' +
        '<div class="detail">Your eye break is still in progress.</div></div>';
      root.append(css, warning);
      host.dataset.headcloudReady = 'true';
    }
    document.documentElement.appendChild(host);
  }

  function hide() {
    screenSince = null;
    if (host) host.style.setProperty('display', 'none', 'important');
  }

  function shouldWarn(state) {
    return document.visibilityState === 'visible' &&
      state?.running === true && state?.timers?.onBreak === true &&
      state?.attention?.state === 'likely-screen';
  }

  function refresh(now = Date.now()) {
    if (!shouldWarn(latestState) || now - lastStateAt > STALE_MS) {
      hide();
      return;
    }
    if (screenSince === null) screenSince = now;
    if (now - screenSince < SHOW_AFTER_MS) return;
    createOverlay();
    // Bring to the end of the same stacking context as the cloud overlay.
    // This resolves equal-z-index ordering for ordinary DOM-based overlays.
    document.documentElement.appendChild(host);
    host.style.setProperty('display', 'block', 'important');
  }

  function receive(state) {
    latestState = state;
    lastStateAt = Date.now();
    refresh(lastStateAt);
  }

  // The background worker broadcasts only on changes to the break/gaze state.
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'HEADCLOUD_LOOK_AWAY_STATE') receive(message.state);
  });

  // Initialize immediately. A null DOM lookup now means the content script did not run.
  createOverlay();
  console.info('[HeadCloud] Look-away overlay loaded');

  async function poll() {
    if (document.visibilityState !== 'visible') { hide(); return; }
    if (inFlight) return;
    inFlight = true;
    try {
      const state = await chrome.runtime.sendMessage({ type: 'ENGINE_REQUEST', command: 'ENGINE_GET_STATE' });
      // Skip an older poll response if a new broadcast arrived during its request.
      if (Date.now() - lastStateAt > 120) receive(state);
    } catch (error) {
      if (Date.now() - lastStateAt > STALE_MS) hide();
      console.debug('[HeadCloud] Engine snapshot temporarily unavailable:', error?.message);
    } finally {
      inFlight = false;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void poll();
    else hide();
  });
  window.addEventListener('pagehide', hide);
  window.setInterval(() => { refresh(); void poll(); }, POLL_MS);
  // Refresh quickly while a positive screen detection is being debounced.
  window.setInterval(() => {
    if (screenSince !== null) refresh();
  }, 80);
  void poll();
})();
