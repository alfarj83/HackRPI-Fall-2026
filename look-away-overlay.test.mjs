import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('./look-away-overlay.js', import.meta.url), 'utf8');

test('warns only for sustained screen gaze during a break, hides for unknown and after break', async () => {
  let now = 1000;
  let state = { running: true, timers: { onBreak: true }, attention: { state: 'likely-away' } };
  let poll;
  const hosts = [];
  const fakeElement = () => ({
    style: { display: '', setProperty(name, value) { if (name === 'display') this.display = value; } },
    appendChild() {},
    attachShadow() { return { append() {} }; },
    setAttribute() {},
    innerHTML: '', className: '', id: ''
  });
  const document = {
    visibilityState: 'visible',
    documentElement: { appendChild(el) { hosts.push(el); } },
    createElement: fakeElement,
    addEventListener() {}
  };
  const window = {
    addEventListener() {},
    setInterval(fn) { poll = fn; }
  };
  const chrome = { runtime: { async sendMessage() { return state; } } };
  const context = vm.createContext({ document, window, chrome, Date: { now: () => now }, globalThis: {} });
  vm.runInContext(script, context);
  const advance = async (ms, attentionState, onBreak = true) => {
    now += ms;
    state = { running: true, timers: { onBreak }, attention: { state: attentionState } };
    await poll();
    await new Promise(resolve => setImmediate(resolve));
  };
  // Yield for initial asynchronous polling.
  await new Promise(resolve => setImmediate(resolve));
  await advance(350, 'likely-screen');
  assert.equal(hosts.length, 0, 'first screen-gaze observation does not flash warning');
  await advance(350, 'likely-screen');
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].style.display, 'block');
  await advance(350, 'unknown');
  assert.equal(hosts[0].style.display, 'none');
  await advance(350, 'likely-screen', false);
  assert.equal(hosts[0].style.display, 'none');
});
