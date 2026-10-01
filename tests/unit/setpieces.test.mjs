/**
 * MISSIONS set-piece mechanics for BEL M4-M20 (src/missions/setpieces*.js, art/props-extra.js):
 * design-spec §7.1 key features, §7.7 types, §8.1 alarm-fail scripts.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { validateMission, normalizeMission } from '../../src/missions/schema.js';
import { cableCar } from '../../src/missions/setpieces.js';
import { explode } from '../../src/entities/projectile.js';
import { B, T } from '../../src/world/grid.js';
import { CONFIG } from '../../src/config.js';
import { Alarm } from '../../src/ai/alarm.js';
import { createObjectives } from '../../src/core/objectives.js';
import '../../src/abilities/index.js';

const cellOf = (g, x, z) => { const { i, j } = g.worldToCell(x, z); return g.idx(i, j); };
const water = (x, z, w, d) => ({ type: 'rect', terrain: 'water', x, z, w, d });

test('schema: setpieces/triggers normalised; unknown action and missing type rejected', () => {
  const base = { id: 't', size: [40, 40] };
  const ok = validateMission({ ...base, setpieces: [{ type: 'phones', id: 'ph' }], triggers: [{ on: 'start', do: [{ message: 'hi' }] }] });
  assert.deepEqual(ok.errors, []);
  const bad = validateMission({ ...base, setpieces: [{ id: 'x' }], triggers: [{ on: 'start', do: [{ explode: 1 }] }] });
  assert.equal(bad.errors.length, 2, bad.errors.join('; '));
  const n = normalizeMission(base, { quiet: true });
  assert.deepEqual(n.setpieces, []);
  assert.deepEqual(n.triggers, []);
});

test('rail: a vehicle on the crossing stops the train (M4); a grenade on the rails stops later trains (M18)', () => {
  const track = [{ x: 2, z: 30 }, { x: 118, z: 30 }];
  const mk = (extra = {}) => makeSim({ size: [120, 60], commandos: [{ role: 'sapper', x: 5, z: 5 }],
    vehicles: [{ vehicleType: 'train', id: 'train', x: 2, z: 30, track, schedule: { period: 30, speed: 12, delay: 0 } }, ...(extra.vehicles || [])],
    setpieces: [{ type: 'rail_line', id: 'line', track: [[2, 30], [118, 30]] }] }, { brains: false });
  let s = mk({ vehicles: [{ vehicleType: 'motorcycle', id: 'moto', x: 60, z: 30 }] });
  s.run(8);
  const tr = s.get('train');
  assert.ok(tr.x < 60 && tr.speed === 0, `train stopped short of the motorcycle (x ${tr.x.toFixed(1)})`);
  s = mk();
  s.run(0.2);
  explode(s.world, 80, 30.5, 'grenade', null);
  s.run(10);
  assert.equal(s.world.railBlocks.length, 1, 'track damaged');
  assert.ok(s.get('train').x < 80 && s.get('train').speed === 0, `train held before the damage (x ${s.get('train').x.toFixed(1)})`);
});

test('cable car (M5): the Spy boards at the lower station and steps out at the summit, at its height', () => {
  const cc = cableCar({ id: 'cab', a: { x: 10, z: 50, y: 0, exit: [10, 54] }, b: { x: 40, z: 15, y: 12, exit: [40, 11] }, speed: 6, dwell: 4 });
  const s = makeSim({ size: [60, 60], commandos: [{ role: 'spy', x: 12, z: 52 }], vehicles: [cc.vehicle], setpieces: [cc.setpiece] }, { brains: false });
  s.world.grid.fillRect(33, 5, 14, 10, 'elev', 12);
  const spy = s.cmd('spy'), cab = s.get('cab');
  s.run(0.5);
  assert.equal(cab.speed, 0, 'docked at the start');
  assert.ok(cab.enter(spy), 'spy boards');
  s.run(20, () => spy.state !== 'inVehicle');
  assert.notEqual(spy.state, 'inVehicle', 'out at the top station');
  assert.ok(spy.z < 20, `spy at the summit (z ${spy.z.toFixed(1)})`);
  assert.equal(spy.y, 12, 'standing at the summit height');
  // the cabin never kills anyone standing under the cable
  assert.equal(spy.alive, true);
});

test('phones (M5): using the S phone rings the N phone — noise pulses come from the N phone', () => {
  const s = makeSim({ size: [60, 60], commandos: [{ role: 'spy', x: 30, z: 50 }],
    setpieces: [{ type: 'phones', id: 'tel', phones: [{ id: 'ph_s', at: [30, 50] }, { id: 'ph_n', at: [30, 10] }], links: { ph_s: 'ph_n' } }] }, { brains: false });
  const spy = s.cmd('spy');
  assert.ok(spy.issue({ type: 'ability', id: 'use', target: s.get('ph_s') }), 'use accepted on the device');
  s.run(4);
  const n = s.events.filter((e) => e.name === 'noise' && e.p.kind === 'phone');
  assert.ok(n.length >= 1, 'phone noise');
  assert.ok(n.every((e) => e.p.z === 10), 'all from the northern phone');
});

test('minefield (M5): a commando stepping on a hidden mine dies; the garrison walks through safely', () => {
  const s = makeSim({ size: [60, 60], commandos: [{ role: 'greenberet', x: 10, z: 30 }, { role: 'spy', x: 50, z: 50 }],
    enemies: [{ id: 'g', soldierType: 'soldier', x: 30, z: 20 }],
    setpieces: [{ type: 'minefield', id: 'mf', mines: [[20, 30], [30, 20.3]] }] }, { brains: false });
  const e = s.get('g');
  e.setPosition(30, 20);
  s.run(0.5);
  assert.equal(e.alive, true, 'enemies never set mines off');
  const gb = s.cmd('greenberet');
  gb.moveTo(28, 30);
  s.run(8, () => !gb.alive);
  assert.equal(gb.alive, false, 'GB killed by the mine');
  assert.ok(s.count('explosion') >= 1);
});

test('conveyor (M19): carries a crawling man along; the switch reverses it; walkers are not carried', () => {
  const s = makeSim({ size: [60, 60], commandos: [{ role: 'greenberet', x: 12, z: 30 }, { role: 'sapper', x: 14, z: 30 }],
    setpieces: [{ type: 'conveyor', id: 'belt', points: [[10, 30], [40, 30]], speed: 2, switch: { at: [8, 26], id: 'belt_sw' }, exit: [44, 34] }] }, { brains: false });
  const gb = s.cmd('greenberet'), sa = s.cmd('sapper');
  gb.setStance('crawl');
  s.run(3);
  assert.ok(gb.x > 16, `crawling GB carried (x ${gb.x.toFixed(1)})`);
  assert.ok(Math.abs(sa.x - 14) < 0.01, 'standing Sapper stays');
  const x0 = gb.x;
  s.get('belt_sw').interact(gb);
  s.run(1);
  assert.ok(gb.x < x0, 'reversed');
  s.get('belt_sw').interact(gb);
  s.run(20);
  assert.ok(Math.hypot(gb.x - 44, gb.z - 34) < 0.01, 'set down at the exit at the far end');
});

test('current (M19): no rowing upstream; idle boats drift downstream', () => {
  const s = makeSim({ size: [80, 40], terrain: [water(0, 10, 80, 20)], commandos: [{ role: 'diver', x: 40, z: 5 }],
    vehicles: [{ vehicleType: 'rowboat', id: 'boat', x: 40, z: 20 }],
    setpieces: [{ type: 'current', id: 'river', area: { rect: { x: 0, z: 10, w: 80, d: 20 } }, velocity: 2, angleDeg: 0 }] }, { brains: false });
  const boat = s.get('boat');
  assert.equal(boat.canDriveTo(10, 20), false, 'upstream refused');
  assert.equal(boat.canDriveTo(70, 20), true, 'downstream ok');
  s.run(2);
  assert.ok(boat.x > 43, `drifted (x ${boat.x.toFixed(2)})`);
});

test('lock gate (M13): closed gate blocks; the supply boat horns, the operator opens, it shuts again; the shack latches it open', () => {
  const gate = { rect: { x: 28, z: 10, w: 4, d: 20 } };
  const mk = () => makeSim({ size: [60, 40], terrain: [water(0, 10, 60, 20)], commandos: [{ role: 'diver', x: 5, z: 5 }],
    enemies: [{ id: 'op', soldierType: 'soldier', x: 30, z: 5 }],
    vehicles: [{ vehicleType: 'rowboat', id: 'supply', x: 15, z: 20 }],
    setpieces: [{ type: 'lock_gate', id: 'lock', gate, shack: { at: [33, 6], id: 'shack' }, operator: 'op', boat: 'supply', sides: [[15, 20], [45, 20]], period: 2, hornDelay: 1, openTime: 3 }] }, { brains: false });
  let s = mk();
  const g = s.world.grid, k = cellOf(g, 30, 20);
  assert.equal(g.block[k], B.HIGH, 'closed');
  s.run(4);
  assert.ok(s.events.some((e) => e.name === 'noise' && e.p.kind === 'horn'), 'horn');
  assert.equal(g.block[k], B.NONE, 'opened for the boat');
  s.run(15);
  assert.ok(s.get('supply').x > 40, 'boat crossed');
  assert.equal(g.block[k], B.HIGH, 'shut after it');
  s = mk();
  s.get('op').die('script');
  s.run(6);
  assert.equal(s.world.grid.block[k], B.HIGH, 'no operator: stays shut');
  s.get('shack').interact(s.cmd('diver'));
  s.run(20);
  assert.equal(s.world.grid.block[k], B.NONE, 'latched open by the commando for good');
});

test('mobile bridge (M17): the lever slides it; a man on the deck when it retracts falls; crushArea on extend', () => {
  const s = makeSim({ size: [60, 40], commandos: [{ role: 'spy', x: 30, z: 5 }], enemies: [{ id: 'g', soldierType: 'soldier', x: 30, z: 20 }, { id: 'h', soldierType: 'soldier', x: 50, z: 20 }],
    structures: [{ type: 'ravine', x: 30, z: 20, w: 6, d: 30 }],
    setpieces: [{ type: 'mobile_bridge', id: 'mb', deck: { rect: { x: 27, z: 18, w: 6, d: 4 } }, lever: { at: [30, 8], id: 'mb_lever' }, moveTime: 2, crushArea: { x: 50, z: 20, r: 2 } }] }, { brains: false });
  const g = s.world.grid, k = cellOf(g, 30, 20);
  assert.equal(g.block[k], B.NONE, 'extended: deck walkable');
  assert.equal(g.block[cellOf(g, 30, 30)], B.HIGH, 'the ravine blocks elsewhere');
  const spy = s.cmd('spy');
  s.get('mb_lever').interact(spy);
  assert.notEqual(s.get('mb_lever').canUse(spy), true, 'busy while moving');
  s.run(2.5);
  assert.equal(g.block[k], B.HIGH, 'retracted: gap');
  assert.equal(s.get('g').alive, false, 'guard on the deck fell');
  s.get('mb_lever').interact(spy);
  s.run(2.5);
  assert.equal(g.block[k], B.NONE);
  assert.equal(s.get('h').alive, false, 'crushed');
});

test('collapse: a charge in the tunnel mouth blocks it (M11); a bomb at a tower base kills its gunner (M19)', () => {
  const s = makeSim({ size: [60, 40], commandos: [{ role: 'sapper', x: 5, z: 5 }], enemies: [{ id: 'gun', soldierType: 'mg', x: 40, z: 20, elevated: true, y: 5 }],
    setpieces: [{ type: 'collapse', id: 'tunnel', at: [15, 20], r: 3, block: { rect: { x: 12, z: 16, w: 6, d: 8 } }, event: 'TUNNEL_DOWN' },
      { type: 'collapse', id: 'tower', at: [40, 22], r: 2.5, kill: { x: 40, z: 20, r: 2 } }] }, { brains: false });
  const g = s.world.grid;
  explode(s.world, 30, 5, 'grenade', null);
  s.run(0.2);
  assert.equal(g.block[cellOf(g, 15, 20)], B.NONE, 'far blast: nothing');
  explode(s.world, 15.5, 20, 'bomb', null);
  s.run(0.2);
  assert.equal(g.block[cellOf(g, 15, 20)], B.HIGH, 'tunnel blocked');
  assert.ok(s.events.some((e) => e.name === 'structure:destroyed' && e.p.id === 'tunnel'), 'collapse reported');
  // the gunner stands outside the bomb's lethal radius: only the collapse can kill him
  s.get('gun').setPosition(40, 12);
  s.world.setpieces.get('tower').spec.kill = { x: 40, z: 12, r: 2 };
  explode(s.world, 40, 22.5, 'bomb', null);
  s.run(0.1);
  assert.equal(s.get('gun').alive, false, 'gunner killed');
});

test('multi-charge (M18): the bridge falls only to charges on A, B and C together', () => {
  const s = makeSim({ size: [80, 40], commandos: [{ role: 'sapper', x: 5, z: 5 }],
    structures: [{ type: 'truss_bridge', id: 'bridge', x: 40, z: 20, w: 40, d: 8, destructible: true, indestructible: true }],
    markers: [{ id: 'A', x: 25, z: 20, r: 3 }, { id: 'B', x: 40, z: 20, r: 3 }, { id: 'C', x: 55, z: 20, r: 3 }],
    objectives: [{ id: 'o1', type: 'destroy', targets: ['bridge'] }],
    setpieces: [{ type: 'multi_charge', id: 'abc', target: 'bridge', markers: ['A', 'B', 'C'], window: 1 }] }, { brains: false });
  const br = s.get('bridge');
  explode(s.world, 40, 20, 'bomb', null);
  s.run(3);
  assert.equal(br.destroyed, false, 'one charge is not enough (indestructible otherwise)');
  explode(s.world, 25, 20, 'bomb', null);
  explode(s.world, 40, 20, 'bomb', null);
  explode(s.world, 55, 21, 'bomb', null);
  s.run(0.2);
  assert.equal(br.destroyed, true, 'all three together');
});

test('fuel valve (M17): three turns spill the oil; a blast in the puddle lights it; men inside burn', () => {
  const s = makeSim({ size: [60, 40], commandos: [{ role: 'spy', x: 10, z: 10 }], enemies: [{ id: 'g', soldierType: 'soldier', x: 32, z: 22 }],
    setpieces: [{ type: 'fuel_valve', id: 'fv', valve: { at: [10, 12], id: 'valve' }, clicks: 3, spill: { x: 30, z: 20, r: 5 }, growTime: 2, burnTime: 5 }] }, { brains: false });
  const spy = s.cmd('spy'), v = s.get('valve'), fv = s.world.setpieces.get('fv');
  v.interact(spy); v.interact(spy);
  s.run(1);
  assert.equal(fv.puddle, 0, 'two turns: nothing yet');
  v.interact(spy);
  s.run(3);
  assert.equal(fv.puddle, 5, 'spread to its radius');
  s.world.events.emit('shot', { from: spy, to: { x: 29, z: 19 }, shooter: spy, hit: false, weapon: 'pistol' });
  s.run(0.2);
  assert.ok(fv.burnT > 0, 'a shot into the puddle ignites it');
  assert.equal(s.get('g').alive, false, 'burned');
  s.run(6);
  assert.equal(fv.puddle, 0, 'burnt out');
});

test('firing range (M20): pistol shots inside are routine noise (below the zone heard level)', () => {
  const s = makeSim({ size: [60, 40], commandos: [{ role: 'sniper', x: 10, z: 10 }],
    setpieces: [{ type: 'firing_range', id: 'range', area: { rect: { x: 0, z: 0, w: 20, d: 20 } } }] }, { brains: false });
  s.world.emitNoise(10, 10, 18, 'pistol', null);
  s.world.emitNoise(40, 30, 18, 'pistol', null);
  const n = s.events.filter((e) => e.name === 'noise');
  assert.ok(n[0].p.level < CONFIG.stealth.zoneHeardLevel, 'inside: capped');
  assert.equal(n[1].p.level, CONFIG.stealth.noise.pistol.level, 'outside: unchanged');
});

test('gate control (M20 lever with flashing light, M17 back gate): opens water-gate cells and gate doors', () => {
  const s = makeSim({ size: [60, 40], terrain: [water(20, 0, 4, 40)], commandos: [{ role: 'diver', x: 10, z: 10 }],
    structures: [{ type: 'gate', id: 'backgate', x: 40, z: 20, w: 4, rot: Math.PI / 2 }],
    setpieces: [{ type: 'gate_control', id: 'wg', control: { at: [12, 10], id: 'range_lever', blink: true, label: 'Lever' }, area: { rect: { x: 20, z: 18, w: 4, d: 2 } }, doors: ['backgate'], once: true }] }, { brains: false });
  const g = s.world.grid, lever = s.get('range_lever');
  assert.equal(g.block[cellOf(g, 21, 19)], B.HIGH, 'water gate shut');
  assert.equal(lever.blink, true);
  assert.ok(s.cmd('diver').issue({ type: 'ability', id: 'use', target: lever }), 'use accepted');
  s.run(3);
  assert.equal(g.block[cellOf(g, 21, 19)], B.NONE, 'water gate open');
  assert.equal(s.get('backgate').open, true, 'gate door opened');
  assert.notEqual(lever.canUse(s.cmd('diver')), true, 'once: stays open');
});

test('triggers: boarding the Panzer IV sounds the alarm (M10); delayed actions; objective + fail actions', () => {
  const s = makeSim({ size: [60, 40], commandos: [{ role: 'driver', x: 10, z: 10 }], zones: [{ id: 'camp', poly: [[0, 0], [60, 0], [60, 40], [0, 40]], onSeen: 'RINT' }],
    vehicles: [{ vehicleType: 'panzer4', id: 'pz4', x: 12, z: 12 }],
    objectives: [{ id: 'o1', type: 'survive', duration: 999 }],
    triggers: [
      { on: 'vehicle:enter', match: { vehicle: 'pz4' }, when: (p) => p.unit.faction === 'player', do: [{ alarm: 'camp' }, { message: 'They saw the tank move!' }] },
      { on: 'start', delay: 1, do: [{ objective: 'o1', set: 'done' }] },
      { on: 'objective', match: { id: 'o1', status: 'done' }, do: [{ fail: 'TEST FAIL' }] },
    ] }, { brains: false });
  s.world.alarm = new Alarm(s.world);
  s.world.objectives = createObjectives(s.mission.objectives);
  s.run(0.2);
  assert.ok(s.get('pz4').enter(s.cmd('driver')));
  s.run(0.2);
  assert.ok(s.world.alarm.zonesFired.some((z) => z.event === 'RINT'), 'alarm sounded');
  assert.equal(s.world.objectives[0].done, false);
  s.run(1.2);
  assert.equal(s.world.objectives[0].done, true, 'delayed objective action');
  assert.equal(s.world.scriptFail, 'TEST FAIL');
});

const withAlarm = (s) => { s.world.alarm = new Alarm(s.world); return s; };

test('alarm-fail (M16): a startled sapper runs to his detonator → the bridge blows → mission lost', () => {
  const s = withAlarm(makeSim({ size: [60, 40], commandos: [{ role: 'sniper', x: 5, z: 5 }],
    enemies: [{ id: 'sap', soldierType: 'engineer', x: 30, z: 20, detonator: { x: 36, z: 20 } }],
    alarmFail: { events: ['DETONATE'], message: 'THE SAPPERS BLEW THE BRIDGE.' } }));
  s.run(0.2);
  s.world.emitNoise(28, 20, 20, 'pistol', s.cmd('sniper'));
  s.run(15, () => !!s.world.scriptFail);
  assert.equal(s.world.scriptFail, 'THE SAPPERS BLEW THE BRIDGE.');
});

test('alarm-fail (M15): the general runs for a Citroën on any alarm → fail when he reaches it', () => {
  const s = withAlarm(makeSim({ size: [60, 40], commandos: [{ role: 'sniper', x: 5, z: 5 }],
    enemies: [{ id: 'gen', soldierType: 'general', x: 20, z: 20 }],
    vehicles: [{ vehicleType: 'citroen15', id: 'car1', x: 36, z: 20 }],
    alarmFail: { event: 'GENERAL_ESCAPED', message: 'SCHLEPER GOT AWAY.' } }));
  s.run(0.2);
  s.world.alarm.raise('global', 'seen', 5, 5);
  s.run(20, () => !!s.world.scriptFail);
  assert.equal(s.world.scriptFail, 'SCHLEPER GOT AWAY.');
});

test('tram (M15): hide inside while it stops; running into a tanker is an accident (no alarm noise)', () => {
  const s = makeSim({ size: [80, 40], commandos: [{ role: 'spy', x: 10, z: 22 }],
    vehicles: [{ vehicleType: 'tram', id: 'tram', x: 5, z: 20, track: [{ x: 5, z: 20 }, { x: 75, z: 20 }], schedule: { mode: 'pingpong', speed: 6, delay: 3, endWait: 5, accident: true } },
      { vehicleType: 'opel_blitz_tanker', id: 'tanker', x: 50, z: 20 }] }, { brains: false });
  const tram = s.get('tram'), spy = s.cmd('spy');
  s.run(0.5);
  assert.ok(tram.enter(spy), 'boards while stopped');
  assert.equal(spy.state, 'inVehicle');
  s.run(12, () => s.get('tanker').destroyed);
  assert.equal(s.get('tanker').destroyed, true, 'tanker blown');
  const ex = s.events.filter((e) => e.name === 'explosion');
  assert.ok(ex.length && ex.every((e) => e.p.accident), 'accident blast');
  assert.ok(!s.events.some((e) => e.name === 'noise' && e.p.kind === 'explosion'), 'no explosion noise');
  assert.equal(spy.alive, true, 'safe inside the tram');
});

test('set-piece state survives quick save / load (world.serialize → restoreWorld)', async () => {
  const { Entity } = await import('../../src/entities/entity.js');
  const { restoreWorld } = await import('../../src/save.js');
  const def = { size: [60, 40], commandos: [{ role: 'spy', x: 10, z: 10 }],
    setpieces: [{ type: 'conveyor', id: 'belt', points: [[10, 30], [40, 30]], switch: { at: [8, 26], id: 'belt_sw' } },
      { type: 'mobile_bridge', id: 'mb', deck: { rect: { x: 27, z: 18, w: 6, d: 4 } }, lever: { at: [30, 8], id: 'mb_lever' }, moveTime: 1 },
      { type: 'fuel_valve', id: 'fv', valve: { at: [10, 12], id: 'valve' }, spill: { x: 30, z: 20, r: 5 } }],
    triggers: [{ on: 'start', do: [{ message: 'go' }] }] };
  const id0 = Entity.nextId;
  const a = makeSim(def, { brains: false });
  a.get('belt_sw').interact(a.cmd('spy'));
  a.get('mb_lever').interact(a.cmd('spy'));
  a.get('valve').interact(a.cmd('spy'));
  a.run(2);
  const snap = JSON.parse(JSON.stringify(a.world.serialize()));
  Entity.nextId = id0;
  const b = makeSim(def, { brains: false });
  restoreWorld(b.world, snap);
  const msgs = [];
  b.world.events.on('message', (m) => msgs.push(m.text));
  b.run(0.2);
  const sp = (id) => b.world.setpieces.get(id);
  assert.equal(sp('belt').dir, -1, 'conveyor direction');
  assert.equal(sp('mb').extended, false, 'bridge retracted');
  assert.equal(b.world.grid.block[cellOf(b.world.grid, 30, 20)], B.HIGH, 'grid restored');
  assert.equal(sp('fv').opened, 1, 'valve turns');
  assert.ok(!msgs.includes('go'), 'start trigger not re-fired after the load');
  assert.equal(b.world.setpieces.tstate.fired[0], 1);
});

test('props-extra (§7.7): catalogue registration, walkable flat roofs, pens, decks, anchored demolition targets', async () => {
  const { PROP_TYPES, buildProp } = await import('../../src/art/props.js');
  const { EXTRA_PROP_TYPES } = await import('../../src/art/props-extra.js');
  for (const t of EXTRA_PROP_TYPES) assert.ok(PROP_TYPES.includes(t), `${t} registered`);
  assert.ok(buildProp('villa', { x: 5, z: 5 }).object3d, 'props.js fallback builds registered extras');
  const s = makeSim({ size: [200, 80], terrain: [water(60, 0, 140, 80)], commandos: [{ role: 'greenberet', x: 5, z: 5 }],
    structures: [
      { type: 'flat_roof_house', id: 'house', x: 20, z: 20, w: 8, d: 8, h: 4 },
      { type: 'villa', id: 'villa', x: 40, z: 20, destructible: true, targetAt: 'steps' },
      { type: 'prison_pen', id: 'pen', x: 20, z: 50, w: 10, d: 8 },
      { type: 'castle_gate', id: 'cg', x: 45, z: 55 },
      { type: 'uboat_pen', id: 'ubp', x: 80, z: 20, w: 30, d: 22, open: 'S' },
      { type: 'battleship', id: 'bs', x: 140, z: 50, destructible: true, bombOnly: true },
      { type: 'rail_bridge', id: 'rb', x: 80, z: 60, w: 40, d: 4 },
    ] }, { brains: false });
  const g = s.world.grid;
  assert.equal(g.elev[cellOf(g, 20, 20)], 4, 'flat roof is a raised walkable surface');
  assert.equal(g.block[cellOf(g, 20, 20)], B.NONE);
  const villa = s.world.interactables.find((i) => i.interactKind === 'explosiveTarget' && i.tag === 'villa');
  assert.ok(villa && villa.z > 25, `villa charge point on its steps (z ${villa?.z})`);
  assert.equal(g.block[cellOf(g, 20, 54)], B.NONE, 'pen gate gap (S side) open');
  assert.equal(g.block[cellOf(g, 17, 54)], B.FENCE, 'pen wire either side');
  assert.equal(g.block[cellOf(g, 45, 55)], B.NONE, 'castle gate passage');
  assert.equal(g.block[cellOf(g, 42, 55)], B.HIGH, 'gate towers');
  assert.equal(g.terrain[cellOf(g, 80, 20)], T.WATER, 'water in the pen');
  assert.equal(g.block[cellOf(g, 80, 30.8)], B.NONE, 'pen open to the south');
  const bs = s.world.interactables.find((i) => i.tag === 'bs');
  assert.ok(bs.x > 190, `battleship target at the bow (x ${bs.x})`);
  assert.equal(bs.bombOnly, true);
  assert.equal(g.bridge[cellOf(g, 80, 60)], 1, 'rail bridge deck walkable over water');
});

test('M13 torpedo: a straight run into the battleship bow sinks it; a hit amidships does not', () => {
  const mk = () => makeSim({ size: [200, 80], terrain: [water(0, 0, 200, 80)], commandos: [{ role: 'diver', x: 5, z: 5 }],
    structures: [{ type: 'battleship', id: 'bs', x: 120, z: 40, w: 120, d: 18, destructible: true, bombOnly: true }],
    vehicles: [{ vehicleType: 'minisub', id: 'sub', x: 150, z: 5, heading: Math.PI / 2 }] }, { brains: false });
  let s = mk();
  const diver = s.cmd('diver');
  diver.setPosition(150, 5);
  assert.ok(s.get('sub').enter(diver), 'marine in the sub');
  s.get('sub').heading = Math.PI / 2;
  assert.ok(s.get('sub').fireAt({ x: 150, z: 60 }), 'torpedo away (amidships)');
  s.run(8);
  assert.equal(s.get('bs').destroyed, false, 'amidships: no effect');
  s = mk();
  s.get('sub').setPosition(172, 5, Math.PI / 2);
  diver.setPosition?.(172, 5);
  assert.ok(s.get('sub').enter(s.cmd('diver')));
  assert.ok(s.get('sub').fireAt({ x: 172, z: 60 }), 'torpedo away (bow)');
  s.run(8);
  assert.equal(s.get('bs').destroyed, true, 'bow hit sinks it');
});
