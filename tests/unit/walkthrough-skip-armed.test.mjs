/**
 * Video mode at a fixed speed, skip waits (src/debug/walkthrough.js _pace): while nobody acts the pace rises to
 * SKIP_BOOST, except while a charge that can go off by itself lies armed — a time bomb's fuse, or a remote charge once
 * its detonator is pressed (a finite fuse: the 0.2 s radio delay) — so its blast is watched at the chosen pace. A remote
 * charge lying armed (an infinite fuse) waits for its detonator, an order, and does not hold the boost (M20's lay armed
 * through stages K..M: 1 300 s of game played at plain 4×). The boost ramps up whatever the frame rate (at 60 frames a
 * second its steps are under 2 %: the settle on the chosen pace snapped them back). Presentation only: the run's ticks
 * and orders are the same.
 *   node tests/unit/run.mjs skip-armed
 */
import { test, assert } from './lib.mjs';
import { Walkthrough, SKIP_BOOST } from '../../src/debug/walkthrough.js';
import { Bomb } from '../../src/abilities/charges.js';

/** _pace run for `secs` of game at `fps` frames a second with nobody acting; the boost it ends on. */
function paceWith(bombs, { secs = 6, skipWaits = true, fps = 60 } = {}) {
  const self = {
    auto: false, paused: false, skipWaits,
    world: { time: 100, commandos: [], enemies: [], interactables: [] },
    pacer: { turbo: false, boost: 1 },
    _motion: { t: -Infinity, pos: new Map(), moving: false },
    _bombs: bombs, _calmUntil: 0, _idleSince: null,
    _held: () => false,
  };
  const dt = 1 / fps;
  for (let i = 0; i < secs * fps; i++) { self.world.time += dt; Walkthrough.prototype._pace.call(self, dt); }
  return self.pacer.boost;
}

test('skip armed: nobody acting and no charge: the pace rises to the skip boost (control)', () => {
  // (at 60 frames a second too: a ramp step there is under 2 %, which the settle on the chosen pace used to snap back)
  for (const fps of [60, 30, 20]) assert.equal(paceWith([], { fps }), SKIP_BOOST, `${fps} fps`);
  assert.equal(paceWith([], { skipWaits: false }), 1, 'skip waits off: never boosted');
});

test('skip armed: a remote charge lying armed (infinite fuse, detonator not pressed) does not hold the boost', () => {
  const remote = new Bomb({ x: 1, z: 1, bombKind: 'remote' });
  assert.equal(remote.fuse, Infinity);
  assert.equal(remote.detonating, false);
  assert.equal(paceWith([remote]), SKIP_BOOST);
});

test('skip armed: a time bomb (finite fuse) holds the chosen pace', () => {
  const tb = new Bomb({ x: 1, z: 1, bombKind: 'time', fuse: 30 });
  assert.ok(Number.isFinite(tb.fuse));
  assert.equal(paceWith([tb]), 1);
  assert.equal(paceWith([new Bomb({ x: 2, z: 2, bombKind: 'remote' }), tb]), 1, 'beside a remote one lying armed');
});

test('skip armed: a remote charge after its detonator press (finite fuse) holds the chosen pace', () => {
  const remote = new Bomb({ x: 1, z: 1, bombKind: 'remote' });
  assert.equal(remote.detonate(), true);
  assert.ok(Number.isFinite(remote.fuse) && remote.detonating, 'pressed: the radio delay runs');
  assert.equal(paceWith([remote]), 1);
});

test('skip armed: a charge gone off or taken off the map holds nothing (negative control of the hold)', () => {
  const gone = new Bomb({ x: 1, z: 1, bombKind: 'time', fuse: 30 });
  gone.exploded = true;
  const removed = new Bomb({ x: 1, z: 1, bombKind: 'remote' });
  removed.detonate(); removed.removed = true;
  assert.equal(paceWith([gone, removed]), SKIP_BOOST);
});
