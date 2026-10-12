/**
 * Switch stations (world/switch-station.js; user 2026-10-12: "in mission 3 there should be small station with a lever
 * to deactivate the electricity from the fence. Right now the spy pulls a lever in the void"): a structure switch gets
 * a kiosk at its point (its back to the host, its cells blocked), the use ability walks the operator onto the spot in
 * front of its lever and faces him to it, and the lever's timeline ends at the other stop as the switch flips.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';
import { B } from '../../src/world/grid.js';
import { STATION, PULL, stationLayout, leverAt, leverRest, swingK, hasStation } from '../../src/world/switch-station.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);
const m03 = () => makeSim(getMission('m03'), { brains: false });

test('switch station layout: M3 fence switch faces away from the admin house (+x), stand spot in front of the lever', () => {
  const def = getMission('m03').structures.find((s) => s.id === 'st_admin');
  const sw = def.switches[0];
  const L = stationLayout(sw, def);
  near(L.rot, 0, 1e-9, 'front faces +x (east), away from the house centre (14, 68)');
  assert.deepEqual([L.x, L.z], [19.5, 68], 'the kiosk stands at the switch point');
  near(L.stand.x, 19.5 + STATION.stand.u, 1e-9, 'stand x'); near(L.stand.z, 68 + STATION.stand.v, 1e-9, 'stand z');
  near(L.stand.h, Math.PI, 1e-9, 'facing the kiosk (west)');
  // the back clears the house wall (x 19.0–19.07): the plinth starts at 19.5 − d/2 − plinth
  assert.ok(19.5 - STATION.d / 2 - STATION.plinth > 19.07, 'back of the plinth off the wall');
  // the lever plane beside the operator's left shoulder (facing −x his left is +z)
  assert.ok(STATION.pivot.v - STATION.stand.v > 0.2 && STATION.pivot.v - STATION.stand.v < 0.35, 'lever ~0.25–0.35 m to his left');
  // other host sides: a switch north of a host faces north, etc.
  near(stationLayout({ x: 0, z: -5 }, { x: 0, z: 0, rot: 0 }).rot, -Math.PI / 2, 1e-9, 'north');
  near(stationLayout({ x: 0, z: 5 }, { x: 0, z: 0, rot: 0 }).rot, Math.PI / 2, 1e-9, 'south');
  near(Math.abs(stationLayout({ x: -5, z: 0.3 }, { x: 0, z: 0, rot: 0 }).rot), Math.PI, 1e-9, 'west');
  near(stationLayout({ x: 0, z: 0, face: 1 }, { x: 5, z: 5 }).rot, 1, 1e-9, '`face` overrides');
  assert.equal(hasStation({ station: false }), false, '`station: false` opts out');
});

test('switch station lever timeline: on stop up, off stop down and out, the throw done by the end of the action', () => {
  assert.ok(STATION.on < 0.5 && STATION.off > 2, 'on ≈ up, off ≈ down');
  near(leverAt(true, 0), leverRest(true), 1e-12, 'starts at the on stop');
  near(leverAt(true, PULL.swing[0] - 0.01), leverRest(true), 1e-12, 'still while the hand reaches and grips');
  near(leverAt(true, 1.0), leverRest(false), 1e-12, 'at the off stop when the switch flips (1 s)');
  near(leverAt(false, 1.0), leverRest(true), 1e-12, 'and back the other way');
  near(leverAt(true, 2.0, 2.0), leverRest(false), 1e-12, 'scaled with a longer activation');
  let prev = -1;
  for (let t = 0; t <= 1.0001; t += 0.01) { const k = swingK(t); assert.ok(k >= prev - 1e-12 && k >= 0 && k <= 1, `monotonic at ${t}`); prev = k; }
});

test('M3: the station blocks its cells; the stand spot in front of it is walkable; the switch carries it', () => {
  const s = m03(), w = s.world, g = w.grid;
  const sw = w.interactables.find((i) => i.tag === 'fence_switch');
  assert.ok(sw?.params.stand, 'switch has a stand spot');
  assert.equal(w.switchStations.length, 1);
  assert.equal(w.switchStations[0].sw, sw);
  assert.equal(w.switchStations[0].vis, null, 'no meshes in node');
  for (const [x, z] of [[19.25, 67.25], [19.75, 67.75], [19.75, 68.25], [19.25, 68.75]]) {
    const c = g.worldToCell(x, z);
    assert.equal(g.block[g.idx(c.i, c.j)], B.HIGH, `kiosk cell (${x}, ${z}) blocked`);
  }
  assert.ok(g.walkableAt(sw.params.stand.x, sw.params.stand.z), 'stand spot walkable');
  assert.ok(g.walkableAt(20.75, 66.75) && g.walkableAt(20.75, 69.25), 'the way past its front stays open');
});

test('M3: the Spy ordered to the fence switch walks onto the stand spot, faces the kiosk and cuts the power', () => {
  const s = m03(), w = s.world;
  const spy = s.cmd('spy'), sw = w.interactables.find((i) => i.tag === 'fence_switch');
  spy.setPosition(26, 56.5, 0); // where the M3 solution sends her from (the N gap of the fence)
  assert.equal(w.fencePower.get('st_fence'), true);
  assert.ok(spy.issue({ type: 'ability', id: 'use', target: sw }), 'order accepted');
  let started = null;
  s.run(30, () => { if (!started && spy.currentActionId === 'use') started = { x: spy.x, z: spy.z, h: spy.heading, t: w.time }; return w.fencePower.get('st_fence') === false; });
  assert.ok(started, 'the use started');
  assert.ok(Math.hypot(started.x - sw.params.stand.x, started.z - sw.params.stand.z) < 0.06, `on the stand spot (${started.x.toFixed(3)}, ${started.z.toFixed(3)})`);
  near(Math.atan2(Math.sin(started.h - Math.PI), Math.cos(started.h - Math.PI)), 0, 1e-6, 'facing the kiosk');
  assert.equal(w.fencePower.get('st_fence'), false, 'fence dead');
  assert.equal(sw.on, false, 'switch off');
  assert.ok(s.count('device', (p) => p.sfx === 'switch_throw') === 1, 'the switch clack');
  assert.ok(s.count('device', (p) => p.sfx === 'power_down') === 1, 'the fence hum dies');
  // the lever's state is the switch's: it rests at the off stop, and a save restores it
  near(leverRest(sw.on), STATION.off, 1e-12, 'lever at the off stop');
  const d = JSON.parse(JSON.stringify(sw.serialize()));
  const s2 = m03(), sw2 = s2.world.interactables.find((i) => i.tag === 'fence_switch');
  assert.equal(sw2.on, true);
  sw2.deserialize(d);
  assert.equal(sw2.on, false, 'restored off');
});

test('M3: a crawler at the switch stands up to work the lever (the throw starts once he is up)', () => {
  const s = m03(), w = s.world;
  const sp = s.cmd('sapper'), sw = w.interactables.find((i) => i.tag === 'fence_switch');
  sp.setPosition(22, 66, 0);
  sp.setStance('crawl');
  s.run(1);
  assert.equal(sp.stance, 'crawl');
  assert.ok(sp.issue({ type: 'ability', id: 'use', target: sw }));
  let task = null;
  const done = s.run(30, () => { if (!task && sp.currentActionId === 'use') task = sp.currentAction; return sw.on === false; });
  assert.ok(done, 'switched off');
  assert.equal(sp.stance, 'stand', 'on his feet');
  assert.ok(task && task.leverDelay > 0, 'the lever clock waits for him to stand');
});
