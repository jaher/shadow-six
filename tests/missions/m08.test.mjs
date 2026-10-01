/**
 * BEL M8 "Pyrotechnics" (docs/missions/m08.md): schema + §10.5 test #14, the plateau and its ramps / climb
 * spots, the tank decks, the whole-map zone, objective and extraction wiring, and the dossier's acceptance
 * checks (§14.1): the store alone does not reach the tanks, the reservoir or the barracks; the §11 barrel
 * layout takes everything with one blast; the jeep comes 6 s after o1–o3 and is shelled while the gun is crewed.
 * Run with the unit suite: node tests/unit/run.mjs m08
 */
import { test, assert } from '../unit/lib.mjs';
import { checkMission, loadGrid } from '../unit/mission-check.mjs';
import { makeSim } from '../unit/abilsim.mjs';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { findPath } from '../../src/world/pathfinding.js';
import { belLoadout, spawnInventory } from '../../src/items.js';
import { Alarm } from '../../src/ai/alarm.js';
import { applyExplosion } from '../../src/abilities/explosions.js';
import { createObjectives, checkObjectives, updateExtractionVehicle } from '../../src/core/objectives.js';
import { installSetpieces } from '../../src/missions/setpieces.js';
import { canSee } from '../../src/ai/perception.js';
import { ABILITIES } from '../../src/abilities/registry.js';

const M = () => getMission('m08');
const path = (g, a, b, role) => findPath(g, a.x, a.z, b.x, b.z, { role, maxNodes: 400000 });
const START = { x: 3.5, z: 11.5 };
const DEPOT = { x: 40, z: 70 };

test('m08: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  assert.equal(m.campaign, 'BEL');
  assert.equal(m.theater, 'desert');
  assert.equal(m.coneColors, 'desert');
  assert.deepEqual(m.size, [112, 105]);
  assert.equal(m.par.time, 600);
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
});

test('m08: §3.8 row 8 loadout exactly (GB knife/pistol/decoy/shovel; Sniper 6 rounds + the 6-dose kit); 10 barrels on site', () => {
  const L = belLoadout(8);
  assert.deepEqual(M().commandos.map((c) => c.role), L.team);
  const sort = (o) => Object.fromEntries(Object.entries(o).sort());
  for (const c of M().commandos) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  assert.equal(spawnInventory('sniper', M().commandos[1].inventory).sniperRifle, 6);
  const loose = M().structures.filter((s) => s.type === 'barrels' && s.explosive === 'barrel' && s.carriable);
  assert.equal(loose.length, L.site.barrels, 'ten loose explosive barrels');
});

test('m08: §10.5 #14 — loads; starts reach every objective and the jeep; no start in a cone; routes walkable', () => {
  assert.deepEqual(checkMission(M()), []);
});

test('m08: enemy census matches Kildread/Prima (17 walkers, 13 sentries, the 210 mm gunner, the Gatling operator)', () => {
  const m = M();
  const foot = m.enemies.filter((e) => !['gunner', 'mg'].includes(e.soldierType));
  assert.equal(foot.filter((e) => e.route).length, 17, 'walkers');
  assert.equal(foot.filter((e) => !e.route).length, 13, 'sentries');
  assert.equal(m.enemies.find((e) => e.soldierType === 'gunner')?.emplacement, 'gun210');
  assert.equal(m.enemies.find((e) => e.soldierType === 'mg')?.emplacement, 'gatling');
  assert.equal(m.enemies.filter((e) => (e.y ?? 0) >= 4 && !e.elevated).length, 14, '13 plateau men + the gunner');
  assert.deepEqual(Object.keys(m.barracks).sort(), ['barracks', 'bunker_sw']);
  assert.deepEqual(m.barracks.barracks.squads.map((s) => s.event), ['RINT', 'RINT']);
});

test('m08: the plateau stands at 4 m; the Sniper walks down the W road cut; the GB also by his four climb spots', () => {
  const ctx = loadGrid(M());
  const g = ctx.grid;
  for (const [x, z] of [[3.5, 11.5], [30, 12], [62, 19], [14, 29]]) assert.ok(Math.abs(g.elevAt(x, z) - 4) < 0.01, `plateau at (${x},${z})`);
  for (const [x, z] of [[30, 34], [40, 70], [98.5, 31]]) assert.equal(g.elevAt(x, z), 0, `floor at (${x},${z})`);
  assert.ok(g.elevAt(14.5, 37) > 0.5 && g.elevAt(14.5, 37) < 3.5, 'W ramp half-way down');
  assert.ok(g.elevAt(69, 23) > 0.5 && g.elevAt(69, 23) < 3.5, 'NE supply track half-way up');
  const links = g.links;
  const only = (keep) => links.forEach((l) => g.setLinkEnabled(l.id, keep.includes(l)));
  const byEnd = (x, z) => links.find((l) => Math.hypot(l.a.x - x, l.a.z - z) < 1.5 || Math.hypot(l.b.x - x, l.b.z - z) < 1.5);
  only([]);
  const walk = path(g, START, DEPOT, 'sniper');
  assert.ok(walk, 'the Sniper reaches the depot by the ramps');
  assert.ok(walk.some((p) => Math.hypot(p.x - 14.5, p.z - 37) < 4) || walk.some((p) => Math.hypot(p.x - 69, p.z - 23) < 4), 'by a ramp');
  // no way off the rim except the ramps: straight below cl_mid the walk goes round by the W cut (> 25 m)
  const round = path(g, { x: 30, z: 24.5 }, { x: 30, z: 31.5 }, 'sniper');
  assert.ok(round && round.length * g.cell > 20, 'the escarpment is a wall');
  for (const [x, z] of [[63, 24.8], [6.5, 43.5], [30, 30.5], [48, 26.5]]) {
    const l = byEnd(x, z);
    assert.ok(l, `climb link at (${x},${z})`);
    assert.deepEqual(M().climbLinks.find((c) => c.b[0] === x).roles, ['greenberet']);
  }
  links.forEach((l) => g.setLinkEnabled(l.id, true));
});

test('m08: tank walkways (y 4.5) by their ladders only; the barracks terrace is out of reach (rifle only)', () => {
  const ctx = loadGrid(M());
  const g = ctx.grid;
  for (const [x, z] of [[58.5, 72.5], [67.7, 65.5]]) assert.ok(Math.abs(g.elevAt(x, z) - 4.5) < 0.01, `tank deck (${x},${z})`);
  assert.ok(Math.abs(g.elevAt(30.2, 59.5) - 4.5) < 0.01, 'barracks terrace');
  const links = g.links;
  links.forEach((l) => g.setLinkEnabled(l.id, false));
  assert.equal(path(g, DEPOT, { x: 58.5, z: 72.5 }, 'greenberet'), null, 'no ground route onto tank_b');
  assert.equal(path(g, DEPOT, { x: 30.2, z: 59.5 }, 'greenberet'), null, 'no route onto the terrace');
  links.forEach((l) => g.setLinkEnabled(l.id, true));
  for (const [x, z] of [[58.5, 72.5], [67.7, 65.5]]) assert.ok(path(g, DEPOT, { x, z }, 'sniper'), `ladder up to (${x},${z})`);
  assert.equal(path(g, DEPOT, { x: 30.2, z: 59.5 }, 'greenberet'), null, 'still none onto the terrace');
});

test('m08: one alarm zone over the whole map, seen or heard → RINT; no safe start', () => {
  const s = makeSim(M(), { brains: false });
  const a = new Alarm(s.world);
  for (const [x, z] of [[3.5, 11.5], [2.5, 13.5], [60, 60], [111, 104], [98.5, 31]]) assert.equal(a.zoneAt(x, z)?.id, 'z_all', `(${x},${z})`);
  assert.equal(M().zones.length, 1);
  assert.equal(M().zones[0].onSeen, 'RINT');
  assert.equal(M().zones[0].onHeard, 'RINT');
  assert.equal(M().alarmFail ?? null, null);
});

/** Full M8 sim with the alarm and the objectives, stepped like Game.step. */
function m08Sim(brains = false) {
  const s = makeSim(M(), { brains });
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  w.objectives = createObjectives(s.mission.objectives);
  return s;
}
const ent = (w, id) => w.byId(id);
const gone = (e) => !e || e.removed || e.destroyed || e.exploded || e.alive === false;
const objDone = (w, id) => w.objectives.find((o) => o.id === id).done;
/** Move a loose drum (by id) to (x, z), as the Green Beret would carry it. */
function lay(w, id, x, z) { const b = ent(w, id); b.x = x; b.z = z; w.rebuildSpatial(); return b; }

test('m08 hook: the store goes up as one chain (o1) but reaches neither tank, the reservoir nor the barracks', () => {
  const s = m08Sim(), w = s.world;
  ent(w, 'rack_1').ignite(0, s.cmd('greenberet'));
  s.run(4);
  for (let k = 1; k <= 6; k++) assert.ok(gone(ent(w, `rack_${k}`)), `rack_${k}`);
  for (const id of ['b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10']) assert.ok(gone(ent(w, id)), `${id} in the chain`);
  for (const id of ['tank_a', 'tank_b', 'reservoir', 'barracks']) assert.ok(!gone(ent(w, id)), `${id} still standing`);
  for (const id of ['b1', 'b2', 'b3']) assert.ok(!gone(ent(w, id)), `plateau drum ${id} untouched`);
  checkObjectives(w);
  assert.ok(objDone(w, 'o1'));
  assert.ok(!objDone(w, 'o2') && !objDone(w, 'o3'));
});

test('m08 hook: the §11 barrel layout — one blast at X1 takes the reservoir, the store, both tanks and the barracks', () => {
  const s = m08Sim(), w = s.world;
  lay(w, 'b4', 66, 42.5); // X1 by the reservoir (shot from the road N of the wire)
  lay(w, 'b5', 61.5, 44.5); // X2 → B10 and the store
  lay(w, 'b8', 56, 63); // X3 store → tank_b
  lay(w, 'b9', 61, 66.5); // X4 between the tanks
  lay(w, 'b1', 37, 56); // X5 against the barracks
  lay(w, 'b3', 40.5, 57); // X6 links X5 to rack_1
  const x1 = ent(w, 'b4');
  assert.ok(Math.hypot(65 - x1.x, 34 - x1.z) > 6.75, 'the shooter on the road stands outside the blast');
  x1.ignite(0, s.cmd('sniper'));
  s.run(6);
  for (const id of ['reservoir', 'tank_a', 'tank_b', 'barracks', 'rack_1', 'rack_6']) assert.ok(gone(ent(w, id)), `${id} destroyed`);
  checkObjectives(w);
  for (const id of ['o1', 'o2', 'o3']) assert.ok(objDone(w, id), id);
  assert.ok(!objDone(w, 'o4'), 'the escape is still open');
});

test('m08 hook: a drum at the N side of the gun pit wrecks the 210 mm gun and kills its gunner', () => {
  const s = m08Sim(), w = s.world;
  const gun = ent(w, 'gun210'), e29 = ent(w, 'e29');
  assert.ok(gun && gun.crewed, 'the gun is crewed by e29');
  lay(w, 'b2', 62.7, 9.5).ignite(0, s.cmd('greenberet'));
  s.run(2);
  assert.ok(gun.destroyed, 'gun wrecked');
  assert.equal(e29.alive, false, 'gunner dead');
});

/** o1–o3 burning; the set-piece director (triggers) installed. */
function burningSim() {
  const s = m08Sim(), w = s.world;
  installSetpieces(w, s.mission, { meshes: false });
  for (const id of ['o1', 'o2', 'o3']) Object.assign(w.objectives.find((o) => o.id === id), { done: true });
  s.flags = {};
  s.evac = () => updateExtractionVehicle(w, s.flags);
  return s;
}

test('m08 hook: the jeep is called 6 s after o1–o3 (not before), comes down the E track and stops at the E bridgehead', () => {
  const s = burningSim(), w = s.world;
  s.run(5.5, () => !!s.evac());
  assert.equal(w.byId('jeep'), null, 'no jeep before 6 s');
  assert.equal(w.objectives.find((o) => o.id === 'o4').hidden, true);
  // silence both guns first so the arrival itself can be checked
  for (const id of ['e29', 'e32']) ent(w, id).die('test', null);
  s.run(20, () => { s.evac(); return s.flags.evacPhase === 'wait'; });
  const jeep = w.byId('jeep');
  assert.ok(jeep && !jeep.destroyed && jeep.friendly !== false, 'friendly jeep');
  assert.ok(objDone(w, 'o_burn'));
  assert.equal(w.objectives.find((o) => o.id === 'o4').hidden, false, 'o4 shown');
  assert.ok(Math.hypot(jeep.x - 98.5, jeep.z - 31) < 3, `waits at the E bridgehead: (${jeep.x.toFixed(1)},${jeep.z.toFixed(1)})`);
  // both men aboard → it drives back N off the map and o4 completes
  for (const c of w.commandos) { c.x = jeep.x - 2; c.z = jeep.z; assert.ok(jeep.enter(c), `${c.role} boards`); }
  s.run(30, () => { s.evac(); checkObjectives(w); return objDone(w, 'o4'); });
  assert.ok(objDone(w, 'o4'), 'escaped');
  assert.ok(checkObjectives(w).won || w.objectives.filter((o) => o.required).every((o) => o.done), 'mission won');
});

test('m08 hook: while its gunner lives the 210 mm gun shells the jeep (the mission is lost); the Gatling too', () => {
  const s = burningSim(), w = s.world;
  s.run(40, () => { s.evac(); const j = w.byId('jeep'); return !!j && j.destroyed; });
  assert.ok(w.byId('jeep')?.destroyed, 'the gun destroys the jeep');
  s.run(0.5);
  assert.equal(w.scriptFail, 'YOU DESTROYED THE JEEP, BUT YOU NEEDED IT TO ESCAPE.', 'the loss names the jeep (dossier §10.3)');
  const s2 = burningSim(), w2 = s2.world;
  ent(w2, 'e29').die('test', null);
  s2.run(60, () => { s2.evac(); const j = w2.byId('jeep'); return !!j && j.destroyed; });
  assert.ok(w2.byId('jeep')?.destroyed, 'the Gatling alone also destroys it');
});

const enterableDoors = (ctx) => [...(ctx.world.entities?.values?.() ?? ctx.world.entities)].filter((i) => i.interactKind === 'door' && i.params?.enterable);

test('m08 regression: every enterable door (the five houses) stands at its own house, not at the map origin', () => {
  const ctx = loadGrid(M());
  const doors = enterableDoors(ctx);
  for (const id of ['house_1', 'house_2', 'house_3', 'house_4', 'house_5']) {
    const d = doors.find((i) => i.params.structure?.id === id), s = d?.params.structure;
    assert.ok(d && Number.isFinite(d.x) && Number.isFinite(d.z), `${id}: door placed`);
    const dx = Math.max(Math.abs(d.x - s.x) - s.w / 2, 0), dz = Math.max(Math.abs(d.z - s.z) - s.d / 2, 0);
    assert.ok(Math.hypot(dx, dz) <= 1.0, `${id}: door (${d.x.toFixed(1)},${d.z.toFixed(1)}) within 1 m of the house`);
  }
  // houses 1–3 open N (-z), houses 4–5 open W (-x)
  const at = (id) => doors.find((i) => i.params.structure?.id === id);
  assert.ok(at('house_1').z < 86 - 2.5 && Math.abs(at('house_1').x - 25) < 0.1, 'house_1 door on the N face');
  assert.ok(at('house_4').x < 42.7 - 3 && Math.abs(at('house_4').z - 78) < 0.1, 'house_4 door on the W face');
});

test('m08 regression (shared): in every mission each enterable structure door lies within ~1 m of its footprint', () => {
  const bad = [];
  for (const m of MISSIONS) {
    let ctx;
    try { ctx = loadGrid(m); } catch { continue; }
    const doors = enterableDoors(ctx);
    if (m.id === 'm08') assert.equal(doors.length, 5, 'm08 has five enterable houses');
    for (const d of doors) {
      const s = d.params.structure;
      if (!s || !Number.isFinite(s.x)) continue;
      const hw = (s.w ?? (s.r ?? 3) * 2) / 2, hd = (s.d ?? (s.r ?? 3) * 2) / 2, r = s.rot ?? 0;
      const lx = (d.x - s.x) * Math.cos(r) + (d.z - s.z) * Math.sin(r), lz = -(d.x - s.x) * Math.sin(r) + (d.z - s.z) * Math.cos(r);
      const off = Math.hypot(Math.max(Math.abs(lx) - hw, 0), Math.max(Math.abs(lz) - hd, 0));
      if (!Number.isFinite(off) || off > 1.2) bad.push(`${m.id}:${s.id} (${d.x?.toFixed?.(1)},${d.z?.toFixed?.(1)}) off ${off.toFixed?.(1)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('m08 regression: the camp yard is sand — the Green Beret can burrow by the houses and N of the barracks', () => {
  const s = m08Sim(), w = s.world, gb = s.cmd('greenberet');
  const shovel = ABILITIES.get ? ABILITIES.get('shovel') : ABILITIES.shovel;
  for (const [x, z] of [[40, 78], [30, 74], [22, 50], [40, 31]]) {
    gb.x = x; gb.z = z; gb.y = 0;
    assert.equal(shovel.canUse(gb, null, w), true, `burrow at (${x},${z})`);
  }
});

test('m08 regression: the plateau, the tank decks and the barracks terrace are not roofs — cross-level sight works', () => {
  const s = m08Sim(), w = s.world;
  const see = (id, x, z, y) => canSee(w.byId(id), { x, z, y, isLow: false, isVisibleToEnemies: true }, w);
  const aim = (id, x, z) => { const e = w.byId(id); e.heading = Math.atan2(z - e.z, x - e.x); if (e.post) e.post.heading = e.heading; };
  // deck / terrace guards see the depot yard below; the plateau guards see the road and depot below the rim
  for (const [id, x, z] of [['e19', 50, 55], ['e27', 55, 60], ['e26', 55, 62], ['e5', 40, 36], ['e8', 50, 40]]) {
    aim(id, x, z);
    assert.notEqual(see(id, x, z, 0), 'none', `${id} sees the ground at (${x},${z})`);
  }
  // ground guards see a man standing on the rim (the Sniper sniping from the plateau is exposed)
  aim('e24', 46, 22.8);
  assert.notEqual(see('e24', 46, 22.8, 4), 'none', 'e24 sees the rim');
  // …but not a man lying prone behind the rim edge (deck-edge rule)
  assert.equal(canSee(w.byId('e24'), { x: 46, z: 22.8, y: 4, isLow: true, isVisibleToEnemies: true }, w), 'none', 'prone on the rim: hidden');
});

test('m08 regression: the gun guard e10 faces S over the depot; sentries sweep on the dossier periods (8/10 s)', () => {
  const byId = Object.fromEntries(M().enemies.map((e) => [e.id, e]));
  assert.ok(Math.abs(byId.e10.post.heading - Math.PI / 2) < 1e-6, 'e10 heading S (towards the depot)');
  for (const e of M().enemies.filter((q) => q.soldierType === 'sentry')) {
    assert.equal(e.post.period, ['e1', 'e2', 'e7', 'e20'].includes(e.id) ? 8 : 10, `${e.id} period`);
  }
  const s = m08Sim();
  assert.equal(s.world.byId('e27').vision.period, 10, 'the post period reaches the vision profile');
});

test('m08 regression: the Sniper rifle sets off an explosive barrel in reach and in sight (K\'s finale shot)', () => {
  const s = m08Sim(), w = s.world, sn = s.cmd('sniper');
  const rifle = ABILITIES.sniper;
  const b = lay(w, 'b9', 61, 66.5);
  sn.x = 61; sn.z = 40; sn.y = 0; sn.stance = 'stand'; w.rebuildSpatial();
  assert.equal(rifle.canUse(sn, b, w), true, 'a barrel is a valid rifle target');
  const far = lay(w, 'b8', 61, 95);
  assert.notEqual(rifle.canUse(sn, far, w), true, 'beyond 45 m: refused');
  const before = sn.inventory.get('sniperRifle');
  assert.ok(sn.issue({ type: 'ability', id: 'sniper', target: b }), 'order accepted');
  s.run(3, () => b.exploded);
  assert.ok(b.exploded, 'the barrel went up');
  assert.equal(sn.inventory.get('sniperRifle'), before - 1, 'one round spent');
});

test('m08 regression: the tank walkway frame covers the whole top — deck guards can be shot from the yard and see it', () => {
  const s = m08Sim(), w = s.world, sn = s.cmd('sniper');
  sn.x = 55; sn.z = 37; sn.y = 0; sn.stance = 'stand'; w.rebuildSpatial();
  for (const id of ['e26', 'e27']) assert.equal(ABILITIES.sniper.canUse(sn, w.byId(id), w), true, `${id} on his tank is in the rifle's line from the road`);
  for (const [x, z] of [[58.5, 72.5], [54.6, 72.5], [67.7, 62.8], [71.2, 65.5]]) assert.ok(Math.abs(w.grid.elevAt(x, z) - 4.5) < 0.01, `deck at (${x},${z})`);
  assert.equal(M().rules.decoyMaxDwell, 75, 'one lure holds a guard 75 s at most');
});
