/**
 * Regression tests for playtest replay findings, round 3 (m01–m03 scripted playthroughs).
 */
import { test, assert } from './lib.mjs';
import { makeWorld as mk, run } from './ai-harness.mjs';
import { Entity } from '../../src/entities/entity.js';
import { VisionCones } from '../../src/render/vision-cone.js';

const makeWorld = (m = {}) => { Entity.nextId = 1; return mk(m); };

async function missionSim(id) {
  const { makeSim } = await import('./abilsim.mjs');
  const { getMission } = await import('../../src/missions/index.js');
  const { Alarm } = await import('../../src/ai/alarm.js');
  const s = makeSim(getMission(id));
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  return s;
}

test('m02 pboat: enemy:spotted from a fire-on-sight vehicle carries the vehicle as `enemy` (x/z/tag/vehicleType), like infantry', async () => {
  const s = await missionSim('m02'), w = s.world, boat = s.get('pboat'), sn = s.cmd('sniper');
  for (const c of w.commandos) if (c !== sn) Object.assign(c, { x: 5, z: 115, path: null });
  s.run(0.5);
  const bh = boat.heading;
  Object.assign(sn, { x: boat.x + Math.cos(bh) * 18, z: boat.z + Math.sin(bh) * 18, y: 0, path: null });
  let p = null;
  w.events.on('enemy:spotted', (q) => { if (q.vehicle === boat && !p) p = q; });
  s.run(3, () => !!p);
  assert.ok(p, 'boat flags the sniper');
  assert.equal(p.enemy, boat, 'enemy is the sighting vehicle');
  assert.ok(Number.isFinite(p.enemy.x) && Number.isFinite(p.enemy.z), 'with a position');
  assert.ok(Math.hypot(p.enemy.x - sn.x, p.enemy.z - sn.z) < 25, `at the boat, not parked off-map (${p.enemy.x.toFixed(1)},${p.enemy.z.toFixed(1)})`);
  assert.equal(p.enemy.tag, 'pboat');
  assert.equal(p.vehicleType, boat.vehicleType);
  assert.equal(p.target, sn);
});

test('VisionCones: a vehicle sighting does not steal the shown foot cone', async () => {
  const w = makeWorld({ enemies: [{ id: 'g1', soldierType: 'soldier', x: 20, z: 20, heading: 0 }] });
  const g1 = w.enemies[0];
  const vc = new VisionCones(w, { add() {} });
  g1.coneVisible = true; vc.update();
  const vehicle = { x: 40, z: 40, vision: g1.vision, tag: 'pboat' };
  w.events.emit('enemy:spotted', { enemy: vehicle, target: null, vehicle });
  vc.update();
  assert.equal(g1.coneVisible, true, 'the shown cone stays');
  assert.ok(!vehicle.coneVisible, 'the vehicle is not promoted into the foot-cone list');
  vc.dispose();
});

test('§3.3 ranged refusals: out of range is reported before line of sight (m02 SMG)', async () => {
  const { inReach } = await import('../../src/abilities/common.js');
  const w = makeWorld();
  w.grid.lineOfSight = () => false;
  assert.equal(inReach(w, { x: 0, z: 0 }, { x: 30, z: 0 }, 18, true), 'Out of range.', 'both fail → range first');
  assert.equal(inReach(w, { x: 0, z: 0 }, { x: 10, z: 0 }, 18, true), 'No line of sight.');
  const s = await missionSim('m02'), d = s.cmd('driver');
  const { ABILITIES } = await import('../../src/abilities/index.js');
  const e6 = s.get('e6');
  assert.equal(ABILITIES.smg.canUse(d, e6, s.world), 'Out of range.', 'far target: "Out of range."');
  assert.equal(d.issue({ type: 'ability', id: 'smg', target: e6 }), false);
  assert.equal(d.lastRefusal?.text, 'Out of range.');
});

test('M3 readability: a lure that swings a post-holder round emits enemy:noise-turn (once per turn) and shows his cone', async () => {
  const w = makeWorld({ enemies: [
    { id: 'gun', soldierType: 'soldier', x: 20, z: 20, heading: 0, flags: { holdsPost: true }, post: { heading: 0, sweep: 0 } },
    { id: 'other', soldierType: 'soldier', x: 60, z: 60, heading: 0 },
  ] });
  const [gun, other] = w.enemies;
  run(w, 0.2);
  const vc = new VisionCones(w, { add() {} });
  other.coneVisible = true; vc.update();
  const turns = [];
  w.events.on('enemy:noise-turn', (p) => turns.push(p));
  w.emitNoise(20, 28, 13.5, 'decoy', null);
  assert.equal(turns.length, 1, 'decoy turn flagged');
  assert.equal(turns[0].enemy, gun);
  assert.ok(Math.abs(gun.heading) < 1e-9 && gun.brain.turn, 'he starts turning round on the spot (SHADOW SIX smooth turn)');
  run(w, 0.9); // 90°: ≈ 0.65 s
  assert.ok(Math.abs(gun.heading - Math.PI / 2) < 0.05, `faces the decoy (${gun.heading.toFixed(2)})`);
  vc.update();
  assert.equal(gun.coneVisible, true, 'his cone becomes the shown one');
  assert.equal(vc.cones.get(gun)?.highlight, true, 'highlighted');
  w.emitNoise(20, 28, 13.5, 'decoy', null); // the next pulse: same heading, no re-flag
  assert.equal(turns.length, 1, 'pulses at the same heading are not re-flagged');
  w.emitNoise(12, 20, 18, 'pistol', null); // a gunshot turn is not a lure
  assert.equal(turns.length, 1, 'combat noises do not flag');
  vc.dispose();
});
