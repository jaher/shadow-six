/**
 * BEL M20 "Operation Valhalla" (docs/missions/m20.md): schema + §10.5 test #14 (every start reaches the HQ door, both
 * V2s and the tank with the intended abilities; no start in a cone; every route walkable; the tank's way out), the
 * castle's sealing (the single GB climb spot, the water gate for the Marine only), the exact §3.8 loadout, the
 * Prima census (74 men), the zone and garrisons, the Sniper's line on the AT gunner, the roof rule off, the range
 * rule, the S-corner pair, the objectives (HQ bomb-only, V2s), the tank-lost and no-charges fails and the escape.
 * Run with the unit suite: node tests/unit/run.mjs m20
 */
import { test, assert } from '../unit/lib.mjs';
import { checkMission, loadGrid, applyIntendedAbilities } from '../unit/mission-check.mjs';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { findPath } from '../../src/world/pathfinding.js';
import { B } from '../../src/world/grid.js';
import { belLoadout, spawnInventory } from '../../src/items.js';
import { makeSim } from '../unit/abilsim.mjs';
import { Alarm } from '../../src/ai/alarm.js';
import { canSee } from '../../src/ai/perception.js';
import { applyExplosion } from '../../src/abilities/explosions.js';
import { meleeReachable } from '../../src/abilities/knife.js';
import { createObjectives, checkObjectives, updateExtractionVehicle } from '../../src/core/objectives.js';
import { Y, ATGUN, SNIPER_POST, EXIT, V2S, WATER_GATE, CLIMB_W, checkCharges, PARAPETS, sweepPeriod } from '../../src/missions/m20_operation_valhalla.js';
import { tryDress } from '../../src/abilities/spy.js';
import { wagonMesh } from '../../src/missions/scripts/m20.js';

const M = () => getMission('m20');
const reach = (g, a, b, role, o = {}) => !!findPath(g, a.x, a.z, b.x, b.z, { role, maxNodes: 600000, ...o });
const HQ_DOOR = { x: 12, z: 64 }; // on T_hq (y 13), in front of the château's door
const V2_SPOTS = { v2a: { x: 90, z: 53 }, v2b: { x: 90, z: 70 } };
const TANK = { x: 82, z: 42 };
/** Shut both gate passages (the check that walls, levels and the moat seal the castle). */
const shutGates = (g) => {
  g.fillOrientedRect(57, 114, 4.2, 8.5, (15 * Math.PI) / 180, 'block', B.HIGH);
  g.fillOrientedRect(116, 114, 4.2, 8.5, (-45 * Math.PI) / 180, 'block', B.HIGH);
};

test('m20: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  assert.deepEqual(m.size, [157, 162]);
  assert.equal(m.par.time, 1080);
  assert.equal(m.theater, 'temperate');
  assert.equal(m.variant, 'frost');
  assert.equal(m.coneColors, 'green');
  assert.equal(m.lighting.sunElevDeg, 15);
  assert.equal(m.lighting.kelvin, 6800);
  assert.ok(m.briefing.text && m.briefing.historical && m.briefing.hints.length >= 6);
  assert.ok(!m.alarmFail, 'the alarm is not a loss (§9)');
  assert.deepEqual(m.startDisguised, [], 'the Spy starts without a uniform');
  assert.equal(m.rules.roofRule, false);
});

test('m20: §10.5 #14 — loads; no start in a cone; routes walkable; every start reaches the HQ door, the V2s and the tank', () => {
  // the HQ stands on its terrace (y 13): the generic checker only looks for ground-level approaches, checked below
  assert.deepEqual(checkMission(M()).filter((p) => p !== 'objective target hq has no walkable approach'), []);
  const ctx = loadGrid(M()), g = ctx.grid;
  applyIntendedAbilities(ctx);
  assert.equal(g.elevAt(HQ_DOOR.x, HQ_DOOR.z), Y.HQ, 'the HQ door is on the HQ terrace');
  for (const c of M().commandos) {
    assert.ok(reach(g, c, HQ_DOOR, c.role), `${c.role} reaches the HQ door`);
    for (const [id, p] of Object.entries(V2_SPOTS)) assert.ok(reach(g, c, p, c.role), `${c.role} reaches ${id}`);
    assert.ok(reach(g, c, TANK, c.role), `${c.role} reaches the tank`);
  }
  assert.ok(reach(g, { x: 82, z: 38 }, EXIT, undefined), 'the tank\'s way out: N court → SW gate → the SW road\'s edge');
  // the Sapper's own route to the HQ: along the battlements, up the SW bastion stairs and the inner ladder [P]
  assert.ok(reach(g, { x: 139, z: 71 }, HQ_DOOR, 'sapper'), 'from the top of the range ladder to the HQ door');
});

test('m20: the castle is sealed — one GB climb spot on the W wall; the water gate lets only the Marine in, once opened', () => {
  const ctx = loadGrid(M()), g = ctx.grid;
  applyIntendedAbilities(ctx);
  shutGates(g);
  const C = Object.fromEntries(M().commandos.map((c) => [c.role, c]));
  const court = { x: 82, z: 45 }, pool = { x: 133.5, z: 83 };
  assert.ok(reach(g, C.greenberet, court, 'greenberet'), 'the GB climbs in (cl_w)');
  for (const r of ['spy', 'sniper', 'sapper', 'driver']) assert.ok(!reach(g, C[r], court, r), `${r} cannot get in with the gates shut`);
  assert.ok(!reach(g, C.diver, court, 'diver', { swim: true }), 'the water gate is shut at the start');
  assert.ok(g.block[g.idx(Math.floor(139 / g.cell), Math.floor(82.25 / g.cell))] === B.HIGH, 'the grate blocks the channel');
  // pull the lever: the channel opens for good
  g.fillRect(WATER_GATE.x, WATER_GATE.z, WATER_GATE.w, WATER_GATE.d, 'block', B.NONE);
  assert.ok(reach(g, C.diver, court, 'diver', { swim: true }), 'the Marine swims moat → channel → pool → the range');
  assert.ok(g.isWater(Math.floor(pool.x / g.cell), Math.floor(pool.z / g.cell)), 'the pool is deep water ("the spring")');
  for (const r of ['sapper', 'driver']) assert.ok(!reach(g, C[r], court, r), `${r} cannot use the channel`);
  // the climb spot is the W wall below the HQ, from the grass N of the W group's rock
  assert.deepEqual(CLIMB_W.roles, ['greenberet']);
  assert.equal(g.elevAt(CLIMB_W.a[0], CLIMB_W.a[1]), Y.HQ);
  assert.equal(g.elevAt(CLIMB_W.b[0], CLIMB_W.b[1]), 0);
  assert.equal(M().climbLinks.length, 2, 'cl_w and the drainpipe cl_in, nothing else');
});

test('m20: levels — terraces, wall walk, turret and HQ ledge at their heights; stairs link them', () => {
  const { grid: g } = loadGrid(M());
  const at = (x, z) => g.elevAt(x, z);
  assert.equal(at(20, 70), Y.HQ, 'T_hq');
  assert.equal(at(29, 57), Y.TUR, 'the turret deck');
  assert.equal(at(22, 60), Y.ROOF, 'the HQ roof ledge');
  assert.equal(at(30, 85), Y.SW, 'the SW bastion');
  assert.equal(at(47, 50), Y.NW, 'T_nw');
  assert.equal(at(70, 22), Y.N, 'the N rampart');
  assert.equal(at(60, 50), Y.WB, 'T_wb');
  assert.equal(at(110, 45), Y.NE, 'T_ne');
  for (const [x, z] of [[45, 103], [80, 123.5], [129, 104], [139, 90], [139, 62], [122, 36]]) assert.equal(at(x, z), Y.BAT, `wall walk at (${x}, ${z})`);
  assert.equal(at(57, 114), 0, 'the SW gate passage is at ground level');
  assert.equal(at(116, 114), 0, 'the SE gate passage');
  assert.equal(at(72, 66), 0, 'the inner gate tunnel');
  // a walk round the battlements: over both gate arches and the water gate (plank links)
  assert.ok(reach(g, { x: 40, z: 99 }, { x: 139, z: 62 }, 'sapper'), 'the whole ring from the SW to the E wall');
  assert.ok(reach(g, { x: 139, z: 62 }, { x: 122, z: 36 }, 'sapper'), 'on to the NE wall');
});

test('m20: §3.8 row 20 loadout exactly (all six; Sniper 5 rounds; Sapper trap + 2 grenades + 2 remotes; Driver medic; no uniform)', () => {
  const L = belLoadout(20);
  assert.deepEqual(M().commandos.map((c) => c.role).sort(), [...L.team].sort());
  const sort = (o) => Object.fromEntries(Object.entries(o).filter(([, n]) => n).sort());
  for (const c of M().commandos) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  const inv = (r) => spawnInventory(r, M().commandos.find((c) => c.role === r).inventory);
  assert.equal(inv('sniper').sniperRifle, 5);
  assert.equal(inv('sapper').remoteBomb, 2);
  assert.equal(inv('sapper').grenade, 2);
  assert.equal(inv('sapper').bearTrap, 1);
  assert.ok(!inv('sapper').timeBomb, 'no time bombs');
  assert.equal(inv('driver').firstAid, 6, 'the Driver is the medic');
  assert.ok(!inv('driver').smg, 'no SMG');
  assert.ok(!inv('greenberet').shovel, 'no shovel from M12 on');
  assert.ok(!inv('spy').uniform, 'the uniform is on the clothesline');
  assert.ok(M().interactables.some((i) => i.interactKind === 'clothesline'), 'the clothesline in the W quarter');
  const V = Object.fromEntries(M().vehicles.map((v) => [v.id, v]));
  assert.equal(V.pz3.vehicleType, 'panzer3');
  assert.deepEqual(V.pz3.operators, ['driver']);
  assert.equal(V.pz3.seats, 6, 'all six ride');
  assert.equal(V.atgun.vehicleType, 'atgunM20');
});

test('m20: census = Prima 1–57 (no 41) + ours: 74 men, 4 at each gate, P26 of 4, P57 of 3, the AT gunner, 2 garrisons of 6', () => {
  const es = M().enemies;
  assert.equal(es.length, 74);
  const nums = new Set(es.filter((e) => e.prima).map((e) => e.prima));
  for (let n = 1; n <= 57; n++) if (n !== 41) assert.ok(nums.has(n), `Prima's ${n} is on the map`);
  assert.ok(!nums.has(41));
  const squads = {};
  for (const e of es.filter((q) => q.squad)) squads[e.squad.id] = (squads[e.squad.id] || 0) + 1;
  assert.deepEqual(squads, { p26: 4, p57: 3 });
  assert.equal(es.filter((e) => e.prima === 25).length, 4, 'Sentry 25: the four SW-gate guards');
  assert.equal(['e58', 'e59', 'e60', 'e61'].filter((id) => es.some((e) => e.id === id)).length, 4, 'four at the SE gate');
  const g = es.find((e) => e.id === 'e55');
  assert.equal(g.soldierType, 'gunner');
  assert.equal(g.emplacement, 'atgun');
  assert.equal(M().vehicles.find((v) => v.id === 'atgun').gunner, 'e55');
  assert.deepEqual(Object.keys(M().barracks).sort(), ['bk_e', 'bk_s']);
  for (const [id, b] of Object.entries(M().barracks)) {
    assert.equal(b.pool, 6, `${id} pool`);
    assert.equal(b.squads[0].event, 'RINT');
    assert.ok(M().structures.find((s) => s.id === id).flag, `${id} flies a flag`);
  }
  assert.ok(es.every((e) => e.jail === false), 'no arrests in the castle');
  // P26 goes through both gates and round the outside
  const r = es.find((e) => e.id === 'p26').route.points;
  assert.ok(r.some((p) => Math.hypot(p.x - 57, p.z - 114) < 1) && r.some((p) => Math.hypot(p.x - 116, p.z - 114) < 1), 'both gates');
  assert.ok(r.some((p) => p.z > 135), 'the S field outside');
});

test('m20: one zone for the whole castle (seen or heard → siren); the Sniper\'s 41 m line from e44\'s post to the AT gunner is clear', () => {
  const z = M().zones;
  assert.equal(z.length, 1);
  assert.equal(z[0].onSeen, 'RINT');
  assert.equal(z[0].onHeard, 'RINT');
  const { grid: g } = loadGrid(M());
  const d = Math.hypot(SNIPER_POST.x - ATGUN.x, SNIPER_POST.z - ATGUN.z);
  assert.ok(d > 40 && d < 45, `inside the rifle's 45 m (${d.toFixed(1)} m)`);
  assert.equal(g.elevAt(SNIPER_POST.x, SNIPER_POST.z), Y.BAT, 'e44\'s post is on the NE wall walk');
  assert.ok(g.lineOfSight(SNIPER_POST.x, SNIPER_POST.z, ATGUN.x, ATGUN.z, { viewerElevated: true, viewerY: Y.BAT, targetY: 0 }), 'clear past blk_n [P][NL][fd]');
});

/** Full M20 sim: the alarm, the director (set-pieces, triggers, script) and the objectives. */
function m20Sim({ brains = false } = {}) {
  const s = makeSim(M(), { brains });
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.flags = {};
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); checkObjectives(w); updateExtractionVehicle(w, s.flags); };
  w.objectives = createObjectives(s.mission.objectives);
  s.msgs = [];
  w.events.on('message', (p) => s.msgs.push(p.text));
  s.run(0.1);
  return s;
}
const o = (w, id) => w.objectives.find((q) => q.id === id);
const fired = (w, ev) => w.alarm.zonesFired.filter((f) => f.event === ev).length;
const place = (u, x, z, y = 0) => { u.x = x; u.z = z; u.y = y; u.stop?.(); };

test('m20 hook: the team starts prone; the roof rule is off — a standing man on the wall walk is seen from the range, prone he is not', () => {
  const s = m20Sim(), w = s.world;
  for (const c of w.commandos) assert.equal(c.stance, 'crawl', `${c.role} prone`);
  const gb = s.cmd('greenberet'), e16 = s.get('e16');
  place(gb, 129, 104, Y.BAT);
  e16.heading = Math.atan2(104 - e16.z, 129 - e16.x);
  e16.sweepActive = false;
  gb.setStance('stand');
  assert.notEqual(canSee(e16, gb, w), 'none', 'the range sees a man standing on the SE battlements [P "Soldier 9 is in view"]');
  const saved = w.mission;
  w.mission = { ...saved, rules: { roofRule: true } };
  assert.equal(canSee(e16, gb, w), 'none', 'with the §4.2 roof rule on he would be invisible');
  w.mission = saved;
  gb.setStance('crawl');
  assert.equal(canSee(e16, gb, w), 'none', 'prone on the walk: the deck edge hides him ("keep to the centre of the path")');
});

test('m20 hook: a pistol shot on the range raises no alarm; the same shot in the W quarter does; the S-corner pair sound the siren', () => {
  const s = m20Sim(), w = s.world, ma = s.cmd('diver');
  place(ma, 128, 85);
  w.emitNoise(128, 85, 18, 'pistol', ma);
  s.run(0.3);
  assert.equal(fired(w, 'RINT'), 0, 'range practice [P][§7.1]');
  const s2 = m20Sim(), w2 = s2.world, gb2 = s2.cmd('greenberet');
  place(gb2, 50, 88);
  w2.emitNoise(50, 88, 18, 'pistol', gb2);
  s2.run(0.3);
  assert.equal(fired(w2, 'RINT'), 1, 'outside the range a shot is a shot');
  const s3 = m20Sim(), w3 = s3.world;
  s3.get('e64').die('knife', s3.cmd('greenberet'));
  s3.run(0.3);
  assert.ok(fired(w3, 'RINT') >= 1 && w3.alarm.active, 'killing either S-corner guard sounds the siren (T3)');
  assert.ok(w3.alarm.barracks.bk_e.squads[0].released && w3.alarm.barracks.bk_s.squads[0].released, 'both garrisons turn out');
});

test('m20 hook: the lever (flashing red lamp) opens the water gate for good; the uniform line dresses the Spy', () => {
  const s = m20Sim(), w = s.world, g = w.grid, gb = s.cmd('greenberet');
  const k = g.idx(Math.floor(139 / g.cell), Math.floor(82.25 / g.cell));
  assert.equal(g.block[k], B.HIGH, 'shut at the start');
  const lever = w.interactables.find((i) => (i.tag ?? i.id) === 'lever_wg');
  assert.ok(lever && lever.blink, 'the lever and its flashing lamp');
  place(gb, 135.3, 75.5);
  assert.equal(lever.interact(gb), true);
  s.run(0.3);
  assert.equal(g.block[k], B.NONE, 'the grate is up');
  assert.ok(s.msgs.some((m) => /water gate is open/.test(m)), 'T1');
  assert.notEqual(lever.canUse?.(gb) ?? true, true, 'once open it stays open');
  const line = w.interactables.find((i) => (i.tag ?? i.id) === 'uniform_line');
  assert.ok(line && Math.hypot(line.x - 42.5, line.z - 87.5) < 0.1, 'the clothesline in the W quarter');
});

test('m20 hook: the AT gunner cannot be knifed or poisoned (shoot him); the HQ falls only to a charge; shells and grenades take the V2s', () => {
  const s = m20Sim(), w = s.world, gb = s.cmd('greenberet'), e55 = s.get('e55');
  place(gb, ATGUN.x, ATGUN.z + 1.2);
  assert.equal(typeof meleeReachable(gb, e55), 'string', 'knife and syringe refused [NL "cannot be knifed"]');
  assert.ok(!e55.covered, 'a rifle can still hit him');
  const hq = w.byId('hq');
  applyExplosion(w, 12, 64, 'grenade', null);
  applyExplosion(w, 12, 64.5, 'shell', null);
  s.run(0.2);
  assert.ok(!hq.destroyed, 'grenades and tank shells do not bring the HQ down');
  applyExplosion(w, 15.5, 72.5, 'bomb', null); // 22 m from its centre, 10 m off the wall
  s.run(0.2);
  assert.ok(!hq.destroyed, 'a charge must lie against the walls');
  applyExplosion(w, 12, 63.5, 'bomb', null); // by the door [P]
  s.run(0.3);
  assert.ok(hq.destroyed && o(w, 'o1').done, 'o1: a remote bomb by the door');
  assert.ok(s.msgs.some((m) => /headquarters is gone/.test(m)));
  applyExplosion(w, 94, 48.5, 'shell', null);
  s.run(0.2);
  assert.ok(w.byId('v2a').destroyed && !o(w, 'o2').done, 'a tank shell on the first rocket');
  applyExplosion(w, 94, 65, 'grenade', null);
  s.run(0.3);
  assert.ok(w.byId('v2b').destroyed && o(w, 'o2').done, 'o2: a grenade on the second');
  assert.ok(s.msgs.some((m) => /Everyone into the tank/.test(m)));
});

test('m20 hook: losing the tank fails; both charges spent with the HQ standing fails; one left or the HQ down does not', () => {
  const s = m20Sim(), w = s.world;
  s.get('pz3').destroy(null, 'test');
  s.run(0.5);
  assert.match(String(w.scriptFail), /TANK HAS BEEN DESTROYED/);
  const s2 = m20Sim(), w2 = s2.world, sa = s2.cmd('sapper');
  sa.inventory.set('remoteBomb', 1);
  assert.equal(checkCharges(w2, w2.setpieces), false, 'one charge left');
  sa.inventory.set('remoteBomb', 0);
  assert.equal(checkCharges(w2, w2.setpieces), true, 'none left');
  assert.match(String(w2.scriptFail), /WITHOUT EXPLOSIVES/);
  const s3 = m20Sim(), w3 = s3.world;
  s3.cmd('sapper').inventory.set('remoteBomb', 0);
  applyExplosion(w3, 12, 63.5, 'bomb', null);
  s3.run(0.3);
  assert.equal(checkCharges(w3, w3.setpieces), false, 'the HQ is down: nothing to guard');
  assert.ok(!w3.scriptFail);
});

test('m20 hook: the AT gun kills the manned tank on its first move while its gunner lives; shot first, the tank drives out', () => {
  const s = m20Sim({ brains: true }), w = s.world, tk = s.get('pz3'), dr = s.cmd('driver');
  for (const e of w.enemies) if (e.tag !== 'e55') e.die('test', null);
  place(dr, tk.x + 2, tk.z + 2);
  assert.equal(tk.enter(dr), true, 'the Driver boards');
  assert.equal(s.run(5, () => tk.destroyed), false, 'boarding in his sight draws no fire: he waits for the tank to move [P]');
  assert.equal(tk.handleOrder(dr, { type: 'move', x: tk.x, z: tk.z + 10 }), true, 'the Driver moves off');
  const lost = s.run(20, () => tk.destroyed);
  assert.ok(lost, 'one shell from the anti-tank gun on the first move');
  const s2 = m20Sim({ brains: true }), w2 = s2.world, tk2 = s2.get('pz3');
  for (const e of w2.enemies) e.die('test', null); // e55 shot by the Sniper from e44's post
  place(s2.cmd('driver'), tk2.x + 2, tk2.z + 2);
  assert.equal(tk2.enter(s2.cmd('driver')), true);
  assert.equal(s2.run(8, () => tk2.destroyed), false, 'nothing fires on it with e55 dead');
});

test('m20 hook: HQ + both V2s + all six in the tank at the SW road\'s edge → win; the exit before the objectives does not count', () => {
  const s = m20Sim(), w = s.world, tk = s.get('pz3');
  for (const e of w.enemies) e.die('test', null);
  const dr = s.cmd('driver');
  place(dr, tk.x + 2, tk.z + 2);
  assert.equal(tk.enter(dr), true);
  for (const c of w.commandos) if (c !== dr) { place(c, tk.x + 2, tk.z + 2); assert.equal(tk.enter(c), true, `${c.role} aboard`); }
  tk.x = EXIT.x; tk.z = EXIT.z;
  s.run(1);
  assert.ok(!o(w, 'o3').done, 'not before the HQ and the rockets');
  tk.x = 60; tk.z = 135; tk.passedExit = false;
  applyExplosion(w, 12, 63.5, 'bomb', null);
  for (const id of V2S) { const v = w.byId(id); applyExplosion(w, v.x, v.z, 'shell', null); }
  s.run(0.5);
  assert.ok(o(w, 'o1').done && o(w, 'o2').done);
  tk.x = EXIT.x; tk.z = EXIT.z;
  const won = s.run(2, () => o(w, 'o3').done);
  assert.ok(won, 'o3: out through the SW gate and off the map');
  assert.ok(!w.scriptFail);
});

/** Sight from a spawn's post to a standing man at (x, z) on his level (grid LOS only: the 2.5D test perception uses). */
const sees = (g, from, x, z) => g.lineOfSight(from.x, from.z, x, z, { viewerY: from.y || 0, targetY: g.elevAt(x, z) });
const spawnOf = (id) => M().enemies.find((e) => e.id === id);

test('m20 fix: parapets — the W quarter, T_nw and the SW battlements do not see the HQ terrace\'s S strip or the SW bastion; the turret is still seen', () => {
  const g = loadGrid(M()).grid;
  for (const [id, poly, y] of PARAPETS) {
    const cx = (poly[0][0] + poly[2][0]) / 2, cz = (poly[0][1] + poly[2][1]) / 2;
    assert.ok(Math.abs(g.elevAt(cx, cz) - (y + 1.4)) < 0.01, `${id} stands 1.4 m above its level`);
  }
  // the playtest's watchers: e29 on his walk (53, 75.8), e32 at the foot of S_gw, e30/e31 by the clothesline, e7, e33/e34
  const watchers = [{ x: 53, z: 75.8 }, { x: 58, z: 76.5 }, spawnOf('e32'), spawnOf('e30'), spawnOf('e31'), spawnOf('e28'),
    { x: 40, z: 98, y: Y.BAT }];
  const strip = [[30, 73], [35.5, 75.5], [32, 74], [25, 76], [15, 76.5], [20, 72]]; // (its NE corner by e38 stays in view)
  const bastion = [[24, 84], [30, 85], [36, 86], [27, 89.5], [31, 89.5], [35, 89.2]];
  for (const v of watchers) {
    for (const [x, z] of strip) assert.ok(!sees(g, v, x, z), `(${v.x},${v.z}) does not see the HQ strip at (${x},${z})`);
    for (const [x, z] of bastion) assert.ok(!sees(g, v, x, z), `(${v.x},${v.z}) does not see the SW bastion at (${x},${z})`);
  }
  // T_nw (y 7) looks over the E edge's open N part: its two sentries face away from the strip at every sweep
  for (const id of ['e33', 'e34']) {
    const e = spawnOf(id), reachDeg = 35 + e.post.sweep; // half the 70° cone + the sweep amplitude
    for (const [x, z] of strip) {
      const b = (Math.atan2(z - e.z, x - e.x) * 180) / Math.PI, h = (e.heading * 180) / Math.PI;
      assert.ok(Math.abs(((b - h + 540) % 360) - 180) > reachDeg, `${id} never turns to (${x},${z})`);
    }
  }
  assert.ok(sees(g, { x: 53, z: 75.8 }, 29.5, 56.5), 'the turret deck (y 26) is seen over the parapets [P "make sure they\'re looking away"]');
  for (const id of ['e35', 'e36', 'e39']) assert.ok(sees(g, { x: 44, z: 73.6 }, spawnOf(id).x, spawnOf(id).z), `a tank by T_nw's corner can still shell ${id}`);
});

test('m20 fix: the balustrade — the door guards and e40 do not see e1\'s walk W of the turret or his body there; T_n hides e49 from the N court', () => {
  const g = loadGrid(M()).grid;
  const hq = ['e35', 'e36', 'e39'].map(spawnOf);
  for (const v of hq) for (const [x, z] of [[8, 73], [13, 73], [18, 73], [15, 76.5], [10, 76], [22, 75]]) {
    assert.ok(!sees(g, v, x, z), `${v.id} does not see (${x},${z}) on the S strip`);
  }
  const e40 = spawnOf('e40');
  for (const [x, z] of [[7, 73], [12, 73], [15, 76.5], [8, 77]]) assert.ok(!sees(g, e40, x, z), `e40 does not see (${x},${z})`);
  assert.ok(sees(g, spawnOf('e36'), 10, 64.5), 'the forecourt is still one space (e36 sees e35\'s post)');
  // e2's post: hidden from e37's walk S by the balustrade's E piece, and beyond e40's sweep
  for (const z of [59, 61, 63, 65]) assert.ok(!sees(g, { x: 35.5, z }, 35.5, 75.5), `e37 at (35.5,${z}) does not see e2's post`);
  const b = (Math.atan2(75.5 - e40.z, 35.5 - e40.x) * 180) / Math.PI;
  assert.ok(Math.abs(b - 180) > 35 + e40.post.sweep, 'e2\'s post lies outside e40\'s sweep');
  const e50 = spawnOf('e50');
  for (const [x, z] of [[102, 28.5], [103, 29], [100, 29]]) assert.ok(!sees(g, e50, x, z), `e50 does not see (${x},${z}) on T_n`);
});

test('m20 fix: sentry sweeps are out of step (periods 9–12 s per post); the playtest pair e9/e20 differ', () => {
  const posts = M().enemies.filter((e) => e.post && e.soldierType === 'sentry');
  const periods = new Set(posts.map((e) => e.post.period));
  assert.ok(periods.size >= 5, `${periods.size} distinct periods`);
  for (const e of posts) assert.ok(e.post.period >= 8 && e.post.period <= 12, `${e.id} period ${e.post.period}`);
  assert.notEqual(spawnOf('e9').post.period, spawnOf('e20').post.period);
  assert.equal(sweepPeriod('e9'), sweepPeriod('e9'), 'deterministic');
});

test('m20 fix: T2 — the clothesline puts a uniform in the Spy\'s kit (no message); putting it on announces it', () => {
  const s = m20Sim(), w = s.world, sp = s.cmd('spy');
  for (const e of w.enemies) e.die('test', null);
  const line = w.interactables.find((i) => (i.tag ?? i.id) === 'uniform_line');
  place(sp, line.x + 0.8, line.z);
  assert.equal(line.interact(sp), true);
  s.run(0.5);
  assert.ok(sp.has('uniform') && !sp.disguised, 'in his kit, not on');
  assert.ok(!s.msgs.some((m) => /German uniform/.test(m)), 'no T2 yet');
  assert.equal(tryDress(w, sp), true);
  s.run(0.5);
  assert.ok(sp.disguised && s.msgs.some((m) => /in German uniform/.test(m)), 'T2 once dressed');
});

test('m20 fix: the tank\'s way out — a straight-leg lane from the W quarter through the SW gate; the exit road is clear to the exit centre', () => {
  const s = m20Sim(), w = s.world, tk = s.get('pz3');
  for (const e of w.enemies) e.die('test', null);
  // full-hull-width nose probe (placement fix, vehicle.js _nosePoints): the lane threads h_w1/h_w2 at (55, 90)
  const lane = [[44.5, 74.6], [41, 76], [42, 86], [55, 90], [67, 94.5], [66, 102], [58.55, 108.2], [55.06, 121.25], [53.9, 125.6], [48, 130], [32, 141], [EXIT.x, EXIT.z]];
  for (let k = 1; k < lane.length; k++) {
    const [ax, az] = lane[k - 1], [bx, bz] = lane[k];
    tk.x = ax; tk.z = az; tk.heading = Math.atan2(bz - az, bx - ax);
    const d = Math.hypot(bx - ax, bz - az);
    assert.ok(tk.straightReach(bx, bz) >= d - 0.3, `leg (${ax},${az}) → (${bx},${bz}) is clear`);
  }
  tk.x = 12.1; tk.z = 151; tk.heading = Math.atan2(EXIT.z - 151, EXIT.x - 12.1);
  assert.ok(tk.canDriveTo(EXIT.x, EXIT.z), 'an order to the exit centre is accepted (playtest: dropped at (3,156))');
  const road = [[32, 141], [0, 157]];
  for (const st of M().structures.filter((q) => (q.type === 'telegraph_pole' || q.type === 'rocks' || q.type === 'pine') && q.x != null)) {
    const [a, b] = road, dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((st.x - a[0]) * dx + (st.z - a[1]) * dz) / L2));
    const dist = Math.hypot(st.x - a[0] - t * dx, st.z - a[1] - t * dz) - (st.r ?? (st.w ?? 0) / 2);
    assert.ok(dist >= 3.5, `${st.id} is ${dist.toFixed(1)} m off the SW exit road`);
  }
});

test('m20 fix: the N court\'s army wagons get a wagon mesh (wheels, hood), not the prop builder\'s hut', () => {
  const defs = M().structures.filter((q) => q.type === 'train_car');
  assert.equal(defs.length, 2);
  for (const d of defs) {
    const m = wagonMesh(d);
    const meshes = []; m.traverse((o) => o.isMesh && meshes.push(o));
    assert.ok(meshes.length >= 7, `${d.id}: bed, 4 wheels, drawbar, hood`);
    assert.ok(Math.hypot(m.position.x - d.x, m.position.z - d.z) < 1e-6);
  }
});
