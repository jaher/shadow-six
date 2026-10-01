/**
 * BEL M12 "Up on the Roof" (docs/missions/m12.md): schema + §10.5 test #14, the §3.8 loadout and the Informer,
 * the census, the four levels and the roof rule, the two zones, and the dossier's checklist (§15): the GB and the
 * Sniper start hidden, the courtyard is a dead end at street level, the platform is visible from the quay, a
 * courtyard siren only releases the palace squad, any south alert fails the mission, freeing the Informer is o1,
 * the car refuses to leave without him and leaves E once all four are aboard.
 * Run with the unit suite: node tests/unit/run.mjs m12
 */
import { test, assert } from '../unit/lib.mjs';
import { checkMission, loadGrid } from '../unit/mission-check.mjs';
import { makeSim } from '../unit/abilsim.mjs';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { findPath } from '../../src/world/pathfinding.js';
import { belLoadout, spawnInventory } from '../../src/items.js';
import { Alarm } from '../../src/ai/alarm.js';
import { CONFIG } from '../../src/config.js';
import { canSee } from '../../src/ai/perception.js';
import { B } from '../../src/world/grid.js';
import { createObjectives, checkObjectives, updateExtractionVehicle } from '../../src/core/objectives.js';
import { installSetpieces } from '../../src/missions/setpieces.js';
import { LEVEL, START_HIDDEN } from '../../src/missions/m12_up_on_the_roof.js';

const M = () => getMission('m12');
const path = (g, a, b, o = {}) => findPath(g, a.x, a.z, b.x, b.z, { maxNodes: 400000, ...o });
const CAR = { x: 69, z: 111.5 };
const COURT = { x: 36, z: 41 };

test('m12: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  assert.equal(m.campaign, 'BEL');
  assert.equal(m.title, 'Up on the Roof');
  assert.equal(m.coneColors, 'green');
  assert.deepEqual(m.size, [76, 120]);
  assert.equal(m.par.time, 600);
  assert.deepEqual(m.startDisguised, ['spy']);
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
});

test('m12: §3.8 row 12 loadout exactly (GB no shovel, Sniper 7 rounds, Spy medic in uniform) + the jailed Informer', () => {
  const L = belLoadout(12);
  const team = M().commandos.filter((c) => c.role !== 'guest');
  assert.deepEqual(team.map((c) => c.role), L.team);
  const sort = (o) => Object.fromEntries(Object.entries(o).sort());
  for (const c of team) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  const inv = (r) => spawnInventory(r, team.find((c) => c.role === r).inventory);
  assert.deepEqual(sort(inv('greenberet')), sort({ knife: 1, pistol: 1, decoy: 1 }), 'knife, pistol, decoy; no shovel');
  assert.equal(inv('sniper').sniperRifle, 7);
  assert.equal(inv('spy').firstAid, 6);
  assert.equal(L.medic, 'spy');
  assert.ok(L.startDisguised);
  const guests = M().commandos.filter((c) => c.role === 'guest');
  assert.deepEqual(guests.map((g) => g.guestId), L.guests);
  assert.equal(guests[0].jailed, true);
  assert.equal(guests[0].jailId, 'jail_block');
  assert.deepEqual(M().jails, ['jail_block']);
  assert.deepEqual(START_HIDDEN.map(([r, h]) => [r, h]), [['greenberet', 'w_block_front'], ['sniper', 'sn_hut']]);
  const kubel = M().vehicles.find((v) => v.id === 'kubel');
  assert.equal(kubel.vehicleType, 'kubelwagen');
  assert.equal(kubel.seats, 4);
});

test('m12: §10.5 #14 — loads; every start reaches the car; routes walkable; cones only on hidden/disguised/jailed starts', () => {
  const probs = checkMission(M());
  // the GB and the Sniper are inside their hideouts from the first tick, the Spy wears the uniform and the
  // Informer is behind bars: none of them can be seen at the start (the cone check knows none of that)
  const exempt = /^commando (greenberet|sniper|spy|guest) starts inside e\d+'s cone$/;
  assert.deepEqual(probs.filter((p) => !exempt.test(p)), []);
});

test('m12: census (Kildread/Prima): 19 walkers, 16 sentries, two 3-man patrols, 2 garrisons; nobody arrests', () => {
  const m = M();
  const singles = m.enemies.filter((e) => !e.squad);
  assert.equal(singles.filter((e) => e.route).length, 19, 'walkers');
  assert.equal(singles.filter((e) => !e.route).length, 16, 'sentries');
  assert.deepEqual(singles.map((e) => e.prima), Array.from({ length: 35 }, (_, k) => k + 1), 'Prima soldiers 1–35 in order');
  const squads = {};
  for (const e of m.enemies.filter((x) => x.squad)) squads[e.squad.id] = (squads[e.squad.id] || 0) + 1;
  assert.deepEqual(squads, { pt_court: 3, pt_quay: 3 });
  assert.equal(m.enemies.length, 41);
  assert.ok(m.enemies.every((e) => e.jail === false), 'jail:false on every enemy');
  assert.deepEqual(Object.keys(m.barracks).sort(), ['hq_se', 'palace']);
  assert.deepEqual(m.barracks.palace.squads.map((s) => [s.event, s.size]), [['RINT', 3]]);
  assert.deepEqual(m.barracks.hq_se.squads.map((s) => [s.event, s.size]), [['RSEHQ', 4]]);
  assert.deepEqual(m.climbLinks, []);
});

test('m12: four levels (ledge 4, roofs 8, raised roof 10, platform 2.2); the courtyard is a dead end at street level', () => {
  const { grid: g } = loadGrid(M());
  const at = (x, z) => +g.elevAt(x, z).toFixed(2);
  for (const [x, z] of [[5, 41], [15, 40], [25, 34]]) assert.equal(at(x, z), LEVEL.A, `ledge at (${x},${z})`);
  for (const [x, z] of [[15, 30], [23, 20], [33, 24], [53, 10], [57, 36], [70, 35], [70, 57]]) assert.equal(at(x, z), LEVEL.B, `roof at (${x},${z})`);
  assert.equal(at(39.6, 21.5), LEVEL.C, 'the palace raised roof');
  for (const [x, z] of [[40, 90], [47, 97], [31, 92]]) assert.equal(at(x, z), LEVEL.P, `platform at (${x},${z})`);
  assert.ok(LEVEL.P < CONFIG.stealth.roofY && LEVEL.B - LEVEL.A > CONFIG.stealth.rooftopDelta && LEVEL.C - LEVEL.B <= CONFIG.stealth.rooftopDelta,
    'P is not a roof; A/B are mutually blind; B/C see each other');
  for (const [x, z] of [[36, 41], [14, 45], [69, 111.5], [54, 96]]) assert.equal(at(x, z), 0, `street at (${x},${z})`);
  // with every ladder and stair switched off the courtyard reaches neither the quay nor the lane E of it
  const { grid: g2 } = loadGrid(M());
  for (const l of g2.links) g2.setLinkEnabled(l.id, false);
  assert.equal(path(g2, COURT, CAR), null, 'no street route from the courtyard to the car');
  assert.equal(path(g2, COURT, { x: 54, z: 58 }), null, 'the lane is walled off');
  assert.equal(path(g2, COURT, { x: 60, z: 10 }), null, 'the streets behind the palace are backdrop');
  // over the roofs it works, and the route goes up L2, across the souk and down onto the platform
  const r = path(g, COURT, CAR, { role: 'spy' });
  assert.ok(r, 'the roof route to the car');
  assert.ok(r.some((p) => Math.abs(g.elevAt(p.x, p.z) - LEVEL.B) < 0.1), 'over the upper roofs');
  assert.ok(r.some((p) => Math.abs(g.elevAt(p.x, p.z) - LEVEL.P) < 0.1), 'across the mosque platform');
});

/** Full M12 sim: alarm, objectives, triggers (the director runs the start trigger and the script on its first tick). */
function m12Sim() {
  const s = makeSim(M(), { brains: false });
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  w.objectives = createObjectives(s.mission.objectives);
  installSetpieces(w, s.mission, { meshes: false });
  s.run(0.1);
  return s;
}
const objDone = (w, id) => w.objectives.find((o) => o.id === id).done;
const events = (w) => w.alarm.zonesFired.map((f) => f.event);
const place = (u, x, z, y = 0) => { u.setPosition?.(x, z); u.x = x; u.z = z; u.y = y; };

test('m12 hook: the GB and the Sniper start hidden in their hideouts and step out beside the doors; the Spy is in uniform', () => {
  const s = m12Sim(), w = s.world;
  const gb = s.cmd('greenberet'), sn = s.cmd('sniper'), sp = s.cmd('spy');
  assert.ok(gb.hidden && gb.state === 'hidden', 'GB hidden');
  assert.ok(sn.hidden && sn.state === 'hidden', 'Sniper hidden');
  assert.equal(gb.hideout.tag, 'w_block_front:door');
  assert.equal(sn.hideout.tag, 'sn_hut:door');
  assert.ok(sp.disguised, 'the Spy wears the uniform');
  assert.ok(gb.hideout.release(gb) && sn.hideout.release(sn));
  assert.ok(Math.hypot(gb.x - 16.5, gb.z - 43.6) < 2 && w.grid.elevAt(gb.x, gb.z) === 0, 'GB out in the courtyard');
  assert.ok(Math.hypot(sn.x - 50.2, sn.z - 15.5) < 2 && w.grid.elevAt(sn.x, sn.z) === LEVEL.B, 'Sniper out on the terrace');
  // the script re-blocks the shack and the kiosk on their roofs
  assert.ok(!w.grid.walkableAt(53, 15.5) && !w.grid.walkableAt(64.5, 51.5));
});

test('m12 hook: the roof rule and the low platform — the quay sees the platform, not the roofs', () => {
  const s = m12Sim(), w = s.world;
  const v = w.byId('e34'), sp = s.cmd('spy');
  sp.disguised = false;
  place(v, 38, 112); v.heading = -Math.PI / 2; // facing N up the SW stairs
  place(sp, 37, 101, LEVEL.P);
  assert.ok(Math.abs(w.grid.elevAt(37, 101) - LEVEL.P) < 0.01);
  assert.notEqual(canSee(v, sp, w), 'none', 'a man on the platform is in plain view of the quay');
  place(v, 60, 101); v.heading = -Math.PI / 2;
  place(sp, 59.5, 94, LEVEL.ARC);
  assert.equal(canSee(v, sp, w), 'none', 'the arcade roof (y 6) is out of sight from the quay');
});

test('m12 hook: a courtyard siren releases the palace squad and the mission goes on; a south alert fails it', () => {
  const s = m12Sim(), w = s.world;
  const before = w.enemies.length;
  w.alarm.raise('z_court', 'heard', 36, 41);
  s.run(0.5);
  assert.deepEqual(events(w), ['RINT']);
  assert.ok(w.alarm.siren.active, 'the siren sounds');
  assert.equal(w.enemies.length, before + 3, 'three men out of the palace');
  assert.ok(!w.scriptFail, 'RINT is not a failure');
  w.alarm.raise('z_sehq', 'seen', 40, 90);
  s.run(0.5);
  assert.ok(events(w).includes('RSEHQ'));
  assert.equal(w.scriptFail, 'THE HARBOUR HEADQUARTERS HAS BEEN ALERTED.');
  assert.equal(w.enemies.length, before + 7, 'the HQ squad of four pours out onto the quay');
  assert.equal(w.alarm.zoneAt(64, 55)?.id, 'z_court', 'the kiosk roof is on the forgiving side');
  assert.equal(w.alarm.zoneAt(57.5, 69.5)?.id, 'z_sehq', 'house_e3 is on the fatal side');
});

test('m12 hook: free the Informer (o1) → the car waits for all four → it drives E off the map and the mission is won', () => {
  const s = m12Sim(), w = s.world;
  const inf = w.commandos.find((c) => c.guestId === 'informer');
  assert.equal(inf.state, 'jailed');
  const car = w.byId('kubel'), flags = {};
  const gb = s.cmd('greenberet'); gb.hideout.release(gb);
  place(gb, car.x - 3, car.z);
  assert.ok(car.enter(gb), 'the GB boards early');
  s.run(0.2);
  assert.ok(w.events && !objDone(w, 'o1'));
  const door = w.interactables.find((i) => i.interactKind === 'jail');
  assert.equal(door.jailed().length, 1);
  door.interact(s.cmd('spy'));
  s.run(0.2);
  assert.notEqual(inf.state, 'jailed', 'the Informer is out');
  assert.ok(objDone(w, 'o1'), 'o1 done');
  assert.equal(w.grid.elevAt(inf.x, inf.z), 0, 'let out into the courtyard');
  assert.ok(findPath(w.grid, inf.x, inf.z, car.x - 3, car.z, { maxNodes: 400000 }), 'he can follow the roofs to the car');
  const sn = s.cmd('sniper'); sn.hideout.release(sn);
  for (const c of [sn, s.cmd('spy')]) { place(c, car.x - 3, car.z); assert.ok(car.enter(c), `${c.role} boards`); }
  s.run(1, () => { updateExtractionVehicle(w, flags); return false; });
  assert.ok(Math.hypot(car.x - 69, car.z - 111.5) < 0.5, 'waits for the Informer');
  place(inf, car.x - 3, car.z);
  assert.ok(car.enter(inf), 'the Informer boards');
  s.run(20, () => { updateExtractionVehicle(w, flags); checkObjectives(w); return objDone(w, 'o2'); });
  assert.ok(objDone(w, 'o2'), `escaped (car at ${car.x.toFixed(1)},${car.z.toFixed(1)})`);
  assert.ok(car.x > 70, 'drove east');
  assert.ok(!w.scriptFail);
});

test('m12 hook: losing the car before the escape fails the mission', () => {
  const s = m12Sim(), w = s.world;
  const car = w.byId('kubel');
  car.destroy?.(null, 'test');
  s.run(0.2);
  assert.ok(car.destroyed);
  assert.equal(w.scriptFail, 'YOU DESTROYED THE CAR, BUT YOU NEEDED IT TO ESCAPE.');
});

// ---------------------------------------------------------------- fix round (mis_play_12 findings)
const cell = (g, x, z) => g.idx(Math.floor(x / g.cell), Math.floor(z / g.cell));

test('m12 fix #1: the mosque arcades and court walls block sight across the platform; the big box hides a man', () => {
  const s = m12Sim(), w = s.world, g = w.grid;
  for (const [x, z] of [[34.2, 88.4], [43.7, 84.8], [47, 82.4], [45.5, 95]]) {
    assert.equal(g.block[cell(g, x, z)], B.HIGH, `wall cell (${x},${z})`);
    assert.ok(Math.abs(g.elevAt(x, z) - LEVEL.P) < 0.01, 'on the platform');
  }
  const sp = s.cmd('spy');
  sp.disguised = false;
  const v = w.byId('e26'); // the hall-court sentry looks E at arcade A2
  place(v, 38, 86.5, LEVEL.P); v.heading = 0; v.sweepActive = false;
  place(sp, 50, 86, LEVEL.P);
  assert.equal(canSee(v, sp, w), 'none', 'A2 hides the E walk from the hall court');
  place(sp, 43, 86.5, LEVEL.P);
  assert.notEqual(canSee(v, sp, w), 'none', 'control: a man in the hall court is seen');
  const e27 = w.byId('e27');
  place(e27, 52, 86, LEVEL.P); e27.heading = Math.PI / 2; e27.sweepActive = false; // facing S at the big box
  place(sp, 51.5, 90, LEVEL.P);
  assert.equal(canSee(e27, sp, w), 'none', 'behind the big box');
  // the E walk still links the pavilion ladder with the SE stairs
  assert.ok(findPath(g, 45.4, 75.8, 51.5, 95, { maxNodes: 400000 }), 'L5 foot → S7 top');
});

test('m12 fix #5: parapets and terrace walls hide bodies across roofs; roof guards are not elevated', () => {
  const s = m12Sim(), w = s.world, g = w.grid;
  assert.ok(w.enemies.filter((e) => (e.y || 0) >= CONFIG.stealth.roofY).every((e) => !e.elevated), 'no roof guard is elevated');
  assert.equal(g.block[cell(g, 65.25, 30)], B.LOW, 'terrace wall souk | house_e1');
  assert.ok(g.walkableAt(65, 36), 'with a doorway');
  assert.equal(g.block[cell(g, 50, 29.8)], B.HIGH, 'the stair-head hut over L2');
  const e11 = w.byId('e11'), e9 = w.byId('e9');
  place(e11, 67, 33, LEVEL.B); e11.heading = Math.PI; e11.sweepActive = false;
  e9.alive = false; e9.state = 'dead'; place(e9, 59.5, 35.5, LEVEL.B);
  assert.equal(canSee(e11, e9, w), 'none', "e11 on house_e1 cannot see e9's body on the souk");
  const e12 = w.byId('e12');
  place(e12, 51, 25.5, LEVEL.B); e12.heading = Math.atan2(10, 8.5); e12.sweepActive = false;
  assert.notEqual(canSee(e12, e9, w), 'none', 'control: on the same roof the body is seen');
});

test('m12 fix #2: a north shout never reaches the harbour HQ; gunfire near it still does, "Halt!" does not', () => {
  const s = m12Sim(), w = s.world;
  const e20 = w.byId('e20');
  assert.ok(Math.hypot(e20.x - 60, e20.z - 53) < 36, 'e20 is within an "Alarm!" of (60,53)');
  const north = w.byId('e17');
  w.emitNoise(60, 53, 36, 'alarmShout', north);
  w.emitNoise(60, 53, 18, 'mandown', north);
  s.run(0.3);
  assert.ok(!events(w).includes('RSEHQ') && !w.scriptFail, 'a z_court alarmShout does not fire RSEHQ');
  w.emitNoise(50, 88, 18, 'halt', w.byId('e26'));
  s.run(0.3);
  assert.ok(!events(w).includes('RSEHQ'), 'a challenge is not an alarm');
  w.emitNoise(64, 55, 18, 'pistol', s.cmd('greenberet'));
  s.run(0.3);
  assert.ok(events(w).includes('RSEHQ'), 'a pistol shot S of the kiosk reaches e20/e23 (dossier §9)');
  assert.equal(w.scriptFail, 'THE HARBOUR HEADQUARTERS HAS BEEN ALERTED.');
});

test('m12 fix #2b: a shout inside the south zone still alerts the HQ', () => {
  const s = m12Sim(), w = s.world;
  w.emitNoise(47, 90, 36, 'alarmShout', w.byId('e27'));
  s.run(0.3);
  assert.ok(events(w).includes('RSEHQ'));
});

test('m12 fix #3: load → save before the first tick → load never re-runs the start trigger (GB stays out)', async () => {
  const { Entity } = await import('../../src/entities/entity.js');
  const { restoreWorld } = await import('../../src/save.js');
  const { startHidden } = await import('../../src/missions/scripts/m12.js');
  const id0 = Entity.nextId;
  const a = m12Sim();
  const gb = a.cmd('greenberet');
  gb.hideout.release(gb);
  place(gb, 43.5, 31.5);
  a.run(1.5);
  const snap1 = JSON.parse(JSON.stringify(a.world.serialize()));
  const reload = (snap) => {
    Entity.nextId = id0;
    const b = makeSim(M(), { brains: false });
    const w = b.world;
    w.alarm = new Alarm(w);
    const step = b.step;
    b.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
    w.objectives = createObjectives(b.mission.objectives);
    installSetpieces(w, b.mission, { meshes: false });
    restoreWorld(w, snap);
    return b;
  };
  const b = reload(snap1);
  const snap2 = JSON.parse(JSON.stringify(b.world.serialize())); // saved before the director's first tick
  const c = reload(snap2);
  c.run(0.2);
  const gb2 = c.cmd('greenberet');
  assert.ok(!gb2.hidden, 'the GB is not pulled back into his hideout');
  assert.ok(Math.hypot(gb2.x - 43.5, gb2.z - 31.5) < 1, `GB still at the L2 foot (${gb2.x.toFixed(1)},${gb2.z.toFixed(1)})`);
  // the mission-side guard on its own: too late, or not at the spawn → nobody is admitted
  const d = m12Sim();
  const g3 = d.cmd('greenberet');
  g3.hideout.release(g3);
  assert.equal(startHidden({ ...d.world, time: 5, commandos: d.world.commandos, interactables: d.world.interactables }, START_HIDDEN), 0, 't ≥ 1 s');
  d.world.time = 0;
  place(g3, 30, 45);
  assert.equal(startHidden(d.world, START_HIDDEN.filter(([r]) => r === 'greenberet')), 0, 'away from his spawn');
});

test('m12 fix #4: [8] and [18] leave their posts to look at a body (Prima); still posted men for the census', () => {
  const m = M();
  for (const id of ['e8', 'e18']) {
    const e = m.enemies.find((x) => x.id === id);
    assert.equal(e.soldierType, 'sentry');
    assert.equal(e.flags.holdsPost, false, `${id} does not hold his post`);
    assert.equal(e.flags.investigates, true, `${id} investigates`);
  }
  const s = makeSim(M(), {});
  const e18 = s.world.byId('e18');
  e18.brain._startBody({ x: 66, z: 60.5, y: LEVEL.B, kind: 'body' });
  assert.equal(e18.brain.phase, 'go', 'e18 walks over instead of kneeling at his post');
});

test('m12 fix #7: the Informer carries nothing (guests have only the hand)', () => {
  const s = m12Sim();
  const inf = s.world.commandos.find((c) => c.guestId === 'informer');
  assert.deepEqual({ ...(inf.inventory?.items || inf.inventory || {}) }, {});
  assert.deepEqual(spawnInventory('guest', {}), {});
});

// ---------------------------------------------------------------- fix round 2 (mis_play_12 r2)
/** Point the viewer straight at the target (no sweep): the cone itself never hides it, only the world does. */
const aim = (v, t) => { v.heading = Math.atan2(t.z - v.z, t.x - v.x); v.sweepActive = false; };

test('m12 fix2 #1: [29] on the arcade roof can never see plank P2, the S edge of house_e2 or the pavilion roof', () => {
  const s = m12Sim(), w = s.world;
  const e29 = w.byId('e29'), sp = s.cmd('spy');
  sp.disguised = false;
  const route = e29.spawn?.route?.points || [{ x: 56.5, z: 95.3 }, { x: 62.5, z: 95.3 }];
  const targets = [[57, 62, 7.5], [57.7, 63.8, 7.5], [50, 69, 7], [50.2, 69.1, 7], [55.4, 65.1, 7.5], [59.4, 61.2, 8], [45.7, 74.7, 7], [62, 64, 8]];
  const [a, b] = [route[0], route[route.length - 1]];
  for (let k = 0; k <= 12; k++) {
    const x = a.x + ((b.x - a.x) * k) / 12, z = a.z + ((b.z - a.z) * k) / 12;
    place(e29, x, z, LEVEL.ARC);
    for (const [tx, tz, ty] of targets) {
      place(sp, tx, tz, ty); aim(e29, sp);
      assert.equal(canSee(e29, sp, w), 'none', `e29 at (${x.toFixed(1)},${z.toFixed(1)}) sees (${tx},${tz},${ty})`);
    }
  }
  // control: he still watches his own roof
  place(e29, 59.5, 95.3, LEVEL.ARC); place(sp, 61, 92, LEVEL.ARC); aim(e29, sp);
  assert.notEqual(canSee(e29, sp, w), 'none', 'control: a man on the arcade roof is seen');
});

test('m12 fix2 #2: the palace squad leaves the door away from the foot of L2; the dossier\'s waiting spots survive a courtyard siren', () => {
  const sq = M().barracks.palace.squads[0];
  const L2 = { x: 45.3, z: 29.2 };
  for (const p of sq.exitRoute) assert.ok(Math.hypot(p.x - L2.x, p.z - L2.z) >= 6, `exit waypoint (${p.x},${p.z}) is ≥ 6 m from the L2 foot`);
  // §11 step 4: the GB back in his hideout, the Informer still in his cell, the Spy (in uniform) on the souk roof
  const s = makeSim(M(), { brains: true }), w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  w.objectives = createObjectives(s.mission.objectives);
  installSetpieces(w, s.mission, { meshes: false });
  s.run(0.1);
  for (const id of ['e1', 'e36', 'e37', 'e38']) { const e = w.byId(id); e.alive = false; e.state = 'dead'; e.removed = true; }
  const gb = s.cmd('greenberet'), inf = w.commandos.find((c) => c.role === 'guest'), sp = s.cmd('spy');
  assert.ok(gb.hidden && inf.state === 'jailed', 'GB hidden, Informer jailed');
  place(sp, 47.2, 27.3, LEVEL.B);
  w.alarm.raise('z_court', 'heard', 30, 45);
  s.run(60);
  assert.deepEqual(events(w), ['RINT']);
  assert.ok(w.enemies.length >= 41 + 3, 'the palace squad is out');
  for (const c of w.commandos) assert.ok(c.alive !== false && c.hp > 0, `${c.role} survives the siren`);
});

test('m12 fix2 #3: the ledge sentries overlook the courtyard (Prima/ooc/NL); men on the ground still cannot see the ledge', () => {
  const s = m12Sim(), w = s.world;
  const gb = s.cmd('spy'); // the GB starts hidden: test with the Spy out of uniform
  gb.disguised = false;
  for (const id of ['e2', 'e5', 'e14', 'e15', 'e16']) assert.ok(w.byId(id).vision.overlooks, `${id} overlooks`);
  for (const id of ['e3', 'e4', 'e6', 'e8', 'e29']) assert.ok(!w.byId(id).vision.overlooks, `${id} keeps the roof rule`);
  const e16 = w.byId('e16');
  place(e16, 26, 36.5, LEVEL.A);
  place(gb, 27.2, 40.2, 0); aim(e16, gb);
  assert.notEqual(canSee(e16, gb, w), 'none', 'e16 sees a man at the cell door');
  const e1 = w.byId('e1');
  place(e1, 27, 44); place(gb, 26, 36, LEVEL.A); aim(e1, gb);
  assert.equal(canSee(e1, gb, w), 'none', 'the courtyard cannot see the ledge');
  const e8 = w.byId('e8');
  place(e8, 37, 28.8, LEVEL.B); place(gb, 36, 38); aim(e8, gb);
  assert.equal(canSee(e8, gb, w), 'none', 'a palace-roof man keeps the roof rule');
});
