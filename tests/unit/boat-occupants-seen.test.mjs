/**
 * Men in an OPEN boat are seen (user, M3 video 2026-10-07: "when marines go on the boat in front of thr guards vision
 * they dont get seen while on the water?"; 2026-10-08: "Even the raft boat in the light shaded field of view of a soldier
 * makes the soldier see it"). §4.2 band table: only a building or a CLOSED vehicle hides a commando, and a boat on open
 * water is seen anywhere in the cone, the light far band included; the men sitting in a raft / rowboat are still low
 * behind cover on the bank. A guard notices a boat in view within about half a second, rowing or lying still (§4.5
 * boat rule). The mini-sub (pilot under the hatch) and land vehicles (truck cab, tank) still hide their occupants.
 * Before the fix every boat occupant was 'inVehicle' = hidden; after the first fix a raft in the far band still was.
 */
import { test, assert } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { canSee, perceive } from '../../src/ai/perception.js';
import { B } from '../../src/world/grid.js';

// river: deep 37.5–42.5, shallow banks 36.5–37.5 and 42.5–43.5 (as abilities-spy-marine)
const RIVER = {
  shoreShallowWidth: 0,
  terrain: [{ type: 'path', terrain: 'shallow', points: [[40, 0], [40, 60]], width: 7 }],
  structures: [{ type: 'river', points: [[40, 0], [40, 60]], width: 5 }],
};
const RAFT = { id: 'raft', vehicleType: 'raft', x: 40, z: 15, heading: 0, inflated: true, suspicious: false, operators: ['diver'] };
// the guard on the west bank, 14.1 m from the raft (near band: near 18, far 36), looking straight at it
const G = { x: 30, z: 5, h: Math.atan2(10, 10) };
const look = (g, x, z) => { g.heading = Math.atan2(z - g.z, x - g.x); };

const sim = (extra = {}, opts = { brains: false }) => makeSim({
  ...RIVER,
  commandos: [{ role: 'diver', x: 36.9, z: 15 }, { role: 'sapper', x: 30, z: 40 }],
  enemies: [guard('g', G.x, G.z, G.h)],
  vehicles: [RAFT],
  ...extra,
}, opts);

test('open boat: the Marine sitting in the raft is seen in the guard\'s near band (was hidden: inVehicle)', () => {
  const s = sim();
  const w = s.world, g = s.get('g'), d = s.cmd('diver'), raft = s.get('raft');
  g.sweepActive = false;
  assert.ok(raft.enter(d), 'boards');
  assert.equal(d.state, 'inVehicle');
  assert.ok(raft.isOpenBoat, 'the raft is an open boat');
  assert.equal(d.isVisibleToEnemies, true, 'a man in the raft is in plain view');
  s.step();
  assert.ok(Math.hypot(d.x - G.x, d.z - G.z) < 18, 'he sits in the near band');
  assert.equal(canSee(g, d, w), 'near', 'seen at 14 m');
  assert.ok(perceive(g, w).commandos.some((r) => r.unit === d), 'on the guard\'s seen list');
  // out of the cone (behind him): not seen
  g.heading = G.h + Math.PI; s.step();
  assert.equal(canSee(g, d, w), 'none', 'not seen behind the guard');
});

test('open boat: the raft is seen in the light far band too (27 m) — not the crawler\'s / swimmer\'s rule', () => {
  const s = sim();
  const w = s.world, g = s.get('g'), d = s.cmd('diver'), raft = s.get('raft');
  g.sweepActive = false;
  assert.ok(raft.enter(d));
  raft.z = 30; s.step();
  look(g, raft.x, raft.z);
  assert.ok(Math.hypot(d.x - G.x, d.z - G.z) > 18, 'far band');
  assert.equal(canSee(g, d, w), 'far', 'seen at 27 m, in the light band');
  // a swimmer at the same spot is not (low: near band only)
  const swimmer = { x: raft.x, z: raft.z, y: 0, isLow: true, isVisibleToEnemies: true, kind: 'commando', alive: true };
  assert.equal(canSee(g, swimmer, w), 'none', 'a swimmer there is not');
});

test('a raft lying still in a guard\'s light band is noticed within a second (full brain): enemy:spotted', () => {
  const s = sim({}, {});
  const w = s.world, g = s.get('g'), d = s.cmd('diver'), raft = s.get('raft');
  const spotted = [];
  w.events.on('enemy:spotted', (p) => spotted.push(p));
  // boarded out of sight upstream, then lying still 27 m off the guard, in his far band (no oar stroke at all)
  raft.x = 37; raft.z = 55; d.setPosition(36.9, 55);
  assert.ok(raft.enter(d));
  s.run(1);
  assert.equal(spotted.length, 0, 'boarding unseen');
  raft.x = 40; raft.z = 30;
  const away = Math.atan2(raft.z - G.z, raft.x - G.x) + Math.PI;
  g.heading = away; g.sweepActive = false; // he looks the other way while the raft settles (no displacement left)
  s.run(1);
  assert.equal(spotted.length, 0, 'not seen while he looks away');
  assert.ok(Math.abs(raft.speed || 0) < 0.01, 'the raft lies still');
  g.heading = away - Math.PI; // he turns round: the raft lies in his light band
  const t0 = w.time;
  s.run(3, () => spotted.length > 0);
  assert.ok(spotted.some((p) => p.enemy === g), 'spotted');
  assert.ok(w.time - t0 < 1.2, `within a second (${(w.time - t0).toFixed(2)} s)`);
});

test('open boat: a passenger who swam aboard is seen too (aboard, not in the water)', () => {
  const s = sim();
  const w = s.world, g = s.get('g'), d = s.cmd('diver'), sa = s.cmd('sapper'), raft = s.get('raft');
  g.sweepActive = false;
  raft.x = 37; // in the shallows: the passenger may board
  assert.ok(raft.enter(d));
  sa.setPosition(37, 16); sa.stance = 'swim';
  assert.ok(raft.enter(sa), 'sapper boards from the water');
  assert.equal(sa.vehicle, raft, 'sapper aboard');
  raft.x = 40; // back out in the channel
  s.step();
  assert.equal(sa.isVisibleToEnemies, true);
  assert.equal(canSee(g, sa, w), 'near', 'the passenger is seen at 14 m');
});

test('closed craft keep hiding their men: the mini-sub pilot and a truck\'s occupants are not seen', () => {
  const s = sim({
    vehicles: [{ ...RAFT, id: 'sub', vehicleType: 'minisub', seats: 1, driveable: true },
      { id: 'truck', vehicleType: 'truck', x: 30, z: 18, heading: 0 }],
  });
  const w = s.world, g = s.get('g'), d = s.cmd('diver'), sa = s.cmd('sapper'), sub = s.get('sub'), truck = s.get('truck');
  g.sweepActive = false;
  assert.ok(sub.enter(d), 'pilot in the sub');
  assert.equal(sub.isOpenBoat, false, 'the mini-sub is enclosed');
  sa.setPosition(29, 16);
  assert.ok(truck.enter(sa), 'sapper in the truck');
  s.step();
  assert.equal(d.isVisibleToEnemies, false);
  assert.equal(canSee(g, d, w), 'none', 'mini-sub pilot hidden');
  assert.equal(sa.isVisibleToEnemies, false);
  assert.equal(canSee(g, sa, w), 'none', 'truck occupant hidden');
});

test('a man sitting low in the raft is hidden by low cover on the bank (a low target); a standing man is not', () => {
  const s = sim();
  const w = s.world, g = s.get('g'), d = s.cmd('diver'), raft = s.get('raft');
  g.sweepActive = false;
  assert.ok(raft.enter(d));
  s.step();
  // low cover (B.LOW, a hedge / sandbag line) across the sight line on the west bank, 4 m in front of the guard
  const gr = w.grid;
  for (let t = -1; t <= 1; t += 0.25) {
    const { i, j } = gr.worldToCell(G.x + 2.8 + t * 0.7, G.z + 2.8 - t * 0.7);
    gr.block[gr.idx(i, j)] = B.LOW;
  }
  assert.equal(gr.lineOfSight(G.x, G.z, raft.x, raft.z, { targetLow: true }), false, 'the cover is on the line');
  assert.equal(canSee(g, d, w), 'none', 'the low cover hides the seated man');
  const standing = { x: raft.x, z: raft.z, y: 0, isLow: false, isVisibleToEnemies: true, kind: 'commando', alive: true };
  assert.notEqual(canSee(g, standing, w), 'none', 'a standing man there is seen over it');
});

test('crossing in front of a guard in the raft gets you spotted (full brain): enemy:spotted on the Marine', () => {
  const s = sim({}, {});
  const w = s.world, g = s.get('g'), d = s.cmd('diver'), raft = s.get('raft');
  const spotted = [];
  w.events.on('enemy:spotted', (p) => spotted.push(p));
  // he boards upstream, 50 m off (nobody sees him get in), then rows down past the guard (14 m off)
  raft.x = 37; raft.z = 55; d.setPosition(36.9, 55);
  assert.ok(raft.enter(d));
  s.run(1);
  assert.equal(spotted.length, 0, 'boarding unseen');
  raft.x = 40; raft.z = 20;
  assert.ok(d.issue({ type: 'move', x: 40, z: 8 }), 'rows on downstream');
  s.run(6, () => spotted.length > 0);
  assert.ok(spotted.some((p) => p.enemy === g && (p.target === d || p.target === raft)), `spotted (${spotted.length} events)`);
});

test('patrol / escape boat deck: a man aboard is seen although the hull stamps the occluder layer (targetHull)', () => {
  const s = sim({
    vehicles: [{ id: 'esc', vehicleType: 'patrolboat', x: 40, z: 30, heading: Math.PI / 2, driveable: false, boardAny: true, seats: 6 }],
  });
  const w = s.world, g = s.get('g'), d = s.cmd('diver'), esc = s.get('esc');
  g.sweepActive = false; g.heading = Math.atan2(25, 10);
  d.setPosition(37, 30);
  assert.ok(esc.enter(d), 'aboard the escape boat');
  s.step();
  assert.ok(esc.isOpenBoat);
  assert.equal(canSee(g, d, w), 'far', 'the man on the deck is seen');
});

test('M2 patrol boat: its gunner spots the Marine rowing the raft across in his near band (crews see open boats too)', async () => {
  const { getMission } = await import('../../src/missions/index.js');
  const { viewerFor } = await import('../../src/ai/vehicle-ai.js');
  const s = makeSim(getMission('m02'));
  const w = s.world, boat = s.get('pboat'), ma = s.cmd('diver');
  for (const id of ['e1', 'e2', 'e3', 'e4', 'e5']) w.remove(s.get(id));
  w.flushRemovals();
  // a raft out in the river, 10 m ahead of the boat on its heading; the boat holds still, eyes front
  const h = Math.atan2(14, 18);
  Object.assign(boat, { x: 24, z: 54.67, heading: h, sweepActive: false, headOffset: 0, speed: 0, goal: null });
  boat.brain.state = 'standby';
  const { Vehicle } = await import('../../src/entities/vehicle.js');
  const raft = w.spawnVehicle('raft', { id: 'raft2', vehicleType: 'raft', x: 24 + Math.cos(h) * 10, z: 54.67 + Math.sin(h) * 10, heading: 0, inflated: true });
  assert.ok(raft instanceof Vehicle, 'raft spawned');
  ma.setPosition(raft.x, raft.z);
  ma.stance = 'swim';
  assert.ok(raft.enter(ma), 'Marine aboard');
  const eye = viewerFor(boat);
  assert.equal(canSee(eye, ma, w), 'near', 'the boat\'s eye sees him in its near band');
  let attacked = false;
  for (let i = 0; i < 60 && !attacked; i++) { s.step(); attacked = boat.brain.state === 'attack' && boat.brain.target === ma; }
  assert.ok(attacked, 'the patrol boat turns on the raft');
});
