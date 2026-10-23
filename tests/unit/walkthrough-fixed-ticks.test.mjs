/**
 * Video mode at a fixed speed (4×): each frame's ticks get what the draw leaves of one 60 Hz vsync — of two once the
 * run lags a frame's worth of ticks behind its speed (a slow draw's own vsyncs first) — never more than WALK_TICK_MS, never under MIN_TICK_MS (a frame
 * that missed a vsync no longer owes twice the ticks to the next and misses again: M11 at 4× sat at ~30 fps). Skipping
 * waits past SKIP_ALTERNATE, the frames alternate between a draw and a frame of ticks only (the whole cap).
 *   node tests/unit/run.mjs fixed-ticks
 */
import { test, assert } from './lib.mjs';
import { fixedTickMs, skipTickOnly, SKIP_ALTERNATE, WALK_TICK_MS, MIN_TICK_MS } from '../../src/debug/walkthrough.js';

const V = 1000 / 60;
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('fixed ticks: the draw takes its share of the vsync first; a lagging run takes one vsync more', () => {
  assert.equal(fixedTickMs(WALK_TICK_MS, 0, 0, 4), WALK_TICK_MS, 'no draw measured yet: the cap');
  assert.ok(near(fixedTickMs(WALK_TICK_MS, 12, 0, 4), V - 12 - 1.5), 'in step: what the draw leaves of one vsync');
  assert.ok(12 + fixedTickMs(WALK_TICK_MS, 12, 0, 4) + 1.5 <= V + 1e-9, 'draw + ticks fit the vsync');
  assert.ok(near(fixedTickMs(WALK_TICK_MS, 12, 4, 4), WALK_TICK_MS), 'a frame\'s worth behind: one vsync more (capped)');
  assert.ok(near(fixedTickMs(WALK_TICK_MS, 25, 0, 4), 2 * V - 25 - 1.5), 'a draw past one vsync (a loaded host): the ticks fill its second');
  assert.ok(near(fixedTickMs(WALK_TICK_MS, 40, 0, 4), 3 * V - 40 - 1.5), '... or its third');
  assert.ok(fixedTickMs(WALK_TICK_MS, 14, 0, 4) >= MIN_TICK_MS, 'never stalls the run: at least MIN_TICK_MS');
  assert.equal(fixedTickMs(WALK_TICK_MS, 13, 0, 16, true), WALK_TICK_MS, 'a frame of ticks only: the whole cap');
});

test('fixed ticks: skipping waits past SKIP_ALTERNATE the frames alternate draw / ticks only', () => {
  assert.equal(skipTickOnly(4, false, 14, true), true, 'after a drawn frame: ticks only');
  assert.equal(skipTickOnly(4, false, 14, false), false, 'after a frame of ticks: a draw');
  assert.equal(skipTickOnly(SKIP_ALTERNATE - 0.1, false, 14, true), false, 'a small boost: every frame draws');
  assert.equal(skipTickOnly(4, true, 14, true), false, 'fast-forward (turbo) has its own view rate');
  assert.equal(skipTickOnly(4, false, 0, true), false, 'no draw measured yet');
  let drew = true; const seq = [];
  for (let i = 0; i < 6; i++) { const only = skipTickOnly(4, false, 13, drew); drew = !only; seq.push(only ? 't' : 'd'); }
  assert.equal(seq.join(''), 'tdtdtd');
});
