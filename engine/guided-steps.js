// Shared calibration geometry and sampling constants.
export const GUIDED_STEPS = [
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
export const SAMPLES_PER_STEP = 22;
export const SETTLE_MS = 1800;
export const SAMPLE_INTERVAL_MS = 85;
export const ARROWS = { left: '←', right: '→', up: '↑', down: '↓', center: '●' };
