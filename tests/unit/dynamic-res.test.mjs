/**
 * Dynamic resolution controller (engine/dynamic-res.js): steps the pixel ratio down only for GPU-bound frames that miss
 * the target, back up when there is headroom (GPU timer) or by probing (without one), with back-off on failed probes.
 */
import { test, assert } from './lib.mjs';
import { DynamicResolution } from '../../src/engine/dynamic-res.js';

const feed = (d, n, interval, cpu, gpu = null) => { let last = null; for (let i = 0; i < n; i++) { const s = d.sample(interval, cpu, gpu); if (s != null) last = s; } return last; };

test('dynamic resolution: GPU-bound frames step down to the floor, never further', () => {
  const d = new DynamicResolution({ target: 60, steps: [1, 0.85, 0.7], windowFrames: 10 });
  assert.equal(d.scale, 1);
  assert.equal(feed(d, 10, 33.3, 8), 0.85, 'first window missing the target, main thread idle → down');
  feed(d, 10, 33.3, 8); // skipped window after the change
  assert.equal(feed(d, 10, 33.3, 8), 0.7);
  feed(d, 30, 33.3, 8);
  assert.equal(d.scale, 0.7, 'floor');
});

test('dynamic resolution: CPU-bound frames keep full resolution', () => {
  const d = new DynamicResolution({ windowFrames: 10 });
  feed(d, 100, 33.3, 30);
  assert.equal(d.scale, 1);
  feed(d, 100, 16.7, 15);
  assert.equal(d.scale, 1);
});

test('dynamic resolution: without a GPU timer it probes up after good windows and backs off on failure', () => {
  const d = new DynamicResolution({ steps: [1, 0.85], windowFrames: 10, probeAfter: 2 });
  feed(d, 10, 33.3, 8);
  assert.equal(d.scale, 0.85);
  feed(d, 10, 16.7, 8); // skipped
  assert.equal(feed(d, 20, 16.7, 8), 1, 'two good windows → probe up');
  feed(d, 10, 33.3, 8); // skipped after the change
  assert.equal(feed(d, 10, 33.3, 8), 0.85, 'probe missed → back down');
  feed(d, 10, 16.7, 8); // skipped
  feed(d, 30, 16.7, 8);
  assert.equal(d.scale, 0.85, 'waits twice as long before the next probe');
  feed(d, 10, 16.7, 8);
  assert.equal(d.scale, 1);
});

test('dynamic resolution: with a GPU timer it steps up only when the next step fits', () => {
  const d = new DynamicResolution({ steps: [1, 0.85, 0.7], windowFrames: 10 });
  feed(d, 10, 33.3, 8, 25);
  assert.equal(d.scale, 0.85);
  feed(d, 10, 16.7, 8, 12); // skipped
  feed(d, 30, 16.7, 8, 12); // 12 × (1/0.85)² = 16.6 ms > 75 % of 16.7: stay
  assert.equal(d.scale, 0.85);
  assert.equal(feed(d, 10, 16.7, 8, 8), 1, '8 ms × 1.38 = 11 ms fits');
  d.reset();
  assert.equal(d.scale, 1);
});
