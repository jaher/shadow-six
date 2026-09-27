/**
 * design-spec §10.5 "a quickload replays identically given the same inputs": an enemy saved mid-reaction
 * (INVESTIGATE / chase / reinforce …) must carry on exactly as the original run did after a restore.
 * The restore mirrors src/save.js: rebuild the mission, restore time/tick/rng, deserialize each entity.
 */
import { test, assert } from './lib.mjs';
import { makeWorld as mk, run } from './ai-harness.mjs';
import { Entity } from '../../src/entities/entity.js';

/** Deterministic entity ids per mission build, as game.loadMission does. */
const makeWorld = (m) => { Entity.nextId = 1; return mk(m); };

const MISSION = {
  enemies: [
    { id: 's', soldierType: 'soldier', x: 20, z: 20, heading: Math.PI },
    { id: 'p', soldierType: 'soldier', x: 40, z: 50, heading: 0, route: { type: 'PINGPONG', vel: 1, points: [{ x: 40, z: 50 }, { x: 60, z: 50, wait: 2 }] } },
  ],
};

/** Clone `w` through its JSON snapshot into a freshly built world (as save.js restore does). */
function reload(w) {
  const S = JSON.parse(JSON.stringify(w.serialize()));
  const w2 = makeWorld(MISSION);
  w2.time = S.time; w2.tick = S.tick;
  if (S.rng !== undefined) w2.rng.snapshot = S.rng;
  for (const d of S.entities) w2.byId(d.id)?.deserialize(d);
  w2.alarm.deserialize?.(JSON.parse(JSON.stringify(w.alarm.serialize?.() ?? null)));
  return w2;
}

function snap(w) {
  return w.enemies.map((e) => `${e.id}:${e.brainState}@${e.x.toFixed(4)},${e.z.toFixed(4)} h${e.heading.toFixed(4)}`);
}

test('§10.5 quickload mid-INVESTIGATE replays identically (walk speed 1.8 m/s is restored, not route VEL)', () => {
  const w = makeWorld(MISSION);
  const e = w.byId('s');
  run(w, 0.2);
  w.emitNoise(35, 20, 18, 'pistol', null);
  run(w, 1.0);
  assert.equal(e.brainState, 'INVESTIGATE');
  const w2 = reload(w);
  const e2 = w2.byId('s');
  assert.equal(e2.brainState, 'INVESTIGATE');
  assert.equal(e2.speed, e.speed, 'restored walk speed');
  for (let i = 0; i < 12; i++) {
    run(w, 0.5); run(w2, 0.5);
    assert.deepEqual(snap(w2), snap(w), `diverged after ${(i + 1) * 0.5} s`);
  }
});

test('§10.5 quickload restores the head sweep/offset and panic-unstick state of an enemy', () => {
  const w = makeWorld(MISSION);
  const e = w.byId('s');
  run(w, 0.2);
  w.emitNoise(35, 20, 18, 'pistol', null);
  run(w, 0.3);
  e.headOffset = 0.4; e.sweepActive = true; e.sweepAmp = 0.3; e.sweepPeriod = 5; e.idleAnim = 'crouchIdle';
  e.lastSeen = { target: w.byId('p'), x: 1, z: 2, t: 0.1 };
  e.brain.wanderT = 0.7;
  const e2 = reload(w).byId('s');
  for (const k of ['vel', 'headOffset', 'sweepActive', 'sweepAmp', 'sweepPeriod', 'idleAnim', 'routeMode']) assert.equal(e2[k], e[k], k);
  assert.equal(e2.lastSeen?.target?.tag, 'p');
  assert.equal(e2.lastSeen?.x, 1);
  assert.equal(e2.brain.wanderT, 0.7);
});
