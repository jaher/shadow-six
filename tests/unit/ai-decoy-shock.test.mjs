/**
 * Regression (M8 fix round, finding "one decoy parks the whole camp"): a level-3 shock (explosion, alarm shout)
 * breaks a guard off a pulsing decoy and leaves him deaf to lures for CONFIG.ai.decoy.shockIgnore s; the siren
 * starting breaks the lure off too; a mission's rules.decoyMaxDwell caps how long one lure holds him.
 */
import { test, assert } from './lib.mjs';
import { makeWorld, run } from './ai-harness.mjs';
import { CONFIG } from '../../src/config.js';

const SOLDIER = { id: 's', soldierType: 'soldier', x: 20, z: 20, heading: Math.PI };

/** Pulse a decoy at (30, 26) every 1.5 s for `secs`; `at(t)` hooks run each frame. */
function pulse(w, decoy, secs, at = () => {}) {
  let next = w.time;
  for (let i = 0; i < 60 * secs; i++) {
    if (w.time >= next) { w.emitNoise(30, 26, 13.5, 'decoy', decoy); next += 1.5; }
    at(w.time);
    run(w, 1 / 60);
  }
}

test('decoy shock: an explosion breaks a guard off a pulsing decoy; lures are ignored for shockIgnore s', () => {
  const w = makeWorld({ enemies: [SOLDIER] });
  const e = w.enemies[0], decoy = { id: 'decoy', on: true };
  pulse(w, decoy, 10);
  assert.equal(e.brainState, 'DECOY');
  w.emitNoise(60, 60, 999, 'explosion', null, 3);
  const states = new Set();
  pulse(w, decoy, CONFIG.ai.decoy.shockIgnore - 2, () => states.add(e.brainState));
  assert.ok(!states.has('DECOY') || e.brainState !== 'DECOY', 'left the decoy');
  assert.notEqual(e.brainState, 'DECOY', `not re-lured within ${CONFIG.ai.decoy.shockIgnore} s (${[...states]})`);
  pulse(w, decoy, 20);
  assert.equal(e.brainState, 'DECOY', 'the lure works again once the shock has passed');
});

test('decoy shock: the siren starting (RINT) breaks the lure off', () => {
  const w = makeWorld({ enemies: [SOLDIER] });
  const e = w.enemies[0], decoy = { id: 'decoy', on: true };
  pulse(w, decoy, 10);
  assert.equal(e.brainState, 'DECOY');
  w.alarm.fireEvent('RINT', { cause: 'test' });
  pulse(w, decoy, 3);
  assert.notEqual(e.brainState, 'DECOY');
});

test('decoy dwell: rules.decoyMaxDwell caps one lure; without it the guard stays (default unchanged)', () => {
  const w = makeWorld({ enemies: [SOLDIER], rules: { decoyMaxDwell: 30 } });
  const e = w.enemies[0], decoy = { id: 'decoy', on: true };
  pulse(w, decoy, 25);
  assert.equal(e.brainState, 'DECOY');
  pulse(w, decoy, 10);
  assert.notEqual(e.brainState, 'DECOY', 'back to his post after 30 s');
  const w2 = makeWorld({ enemies: [SOLDIER] });
  pulse(w2, decoy, 60);
  assert.equal(w2.enemies[0].brainState, 'DECOY', 'no cap by default');
});

test('decoy shock: a guard who was not lured when the blast came can still be lured afterwards', () => {
  const w = makeWorld({ enemies: [SOLDIER] });
  const e = w.enemies[0], decoy = { id: 'decoy', on: true };
  w.emitNoise(60, 60, 999, 'explosion', null, 3);
  run(w, 0.2);
  pulse(w, decoy, 12);
  assert.equal(e.brainState, 'DECOY', 'the lure still works on a man the blast did not catch at a decoy');
});
