/**
 * D.parallel under the live replay (tools/solutions/driver.mjs runGenAsync, src/debug/solution-replay.js _pause): a
 * sliced plan hands the frame back between slices, and the replay keeps ONE waiter per frame. Two flows of a parallel
 * that both start by planning (LIGHTS OUT e01's stage B: the Green Beret and the Driver set off together) used to hand
 * the frame back at once — the second waiter replaced the first, that flow never woke, and the run froze. Plans now go
 * one at a time, first come first served; a plan with no other in progress starts at once, and a logic-only run (no
 * `pause`) never slices.
 */
import { test, assert } from './lib.mjs';
import { makeDriver } from '../../tools/solutions/driver.mjs';

/** A generator that needs `n` slices: each step spins past the driver's slice budget. */
function* slow(n, tag, log) {
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    while (performance.now() - t < 25) { /* busy */ }
    log.push(`${tag}${i}`);
    yield;
  }
  return tag;
}

/** The replay's pause: one waiter, woken by the next "frame" (a timer here). */
function rig({ live }) {
  const w = { time: 0, tick: 0, events: { on: () => () => {} }, commandos: [], enemies: [], vehicles: [], objectives: [], interactables: [] };
  let waiter = null;
  const frames = live ? setInterval(() => { const r = waiter; waiter = null; r?.(); }, 5) : null;
  const pause = live ? () => new Promise((res) => { waiter = res; }) : null;
  const D = makeDriver(w, { step: () => { w.time += 1 / 60; w.tick++; }, dt: 1 / 60, quiet: true, watch: false, log: () => {}, pause });
  return { w, D, stop: () => clearInterval(frames) };
}

const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`froze (no end after ${ms} ms)`)), ms))]);

test('live replay: two parallel flows that start by planning both finish (one plan at a time, in the order asked)', async () => {
  const { D, stop } = rig({ live: true });
  const log = [];
  try {
    const out = await within(D.parallel(
      async () => { const r = await D.runSliced(slow(3, 'a', log)); await D.wait(0.1); return r; },
      async () => { const r = await D.runSliced(slow(3, 'b', log)); await D.wait(0.1); return r; },
    ), 5000);
    assert.deepEqual(out, ['a', 'b']);
    assert.deepEqual(log, ['a0', 'a1', 'a2', 'b0', 'b1', 'b2'], 'the first plan runs to its end before the second starts');
  } finally { stop(); }
});

test('logic-only run (no pause): plans run straight through, unchanged', async () => {
  const { D, stop } = rig({ live: false });
  const log = [];
  const out = await D.parallel(
    async () => D.runSliced(slow(2, 'a', log)),
    async () => D.runSliced(slow(2, 'b', log)),
  );
  stop();
  assert.deepEqual(out, ['a', 'b']);
  assert.deepEqual(log, ['a0', 'a1', 'b0', 'b1']);
});
