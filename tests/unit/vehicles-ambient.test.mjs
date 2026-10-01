/** Vehicle ambient step: aircraft flyovers (config / seeded schedule / poses), crews at seats, scripted door exits, night beams, pennants. */
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { World } from '../../src/world/world.js';
import { Vehicle, createVehicle } from '../../src/entities/vehicle.js';
import { Enemy } from '../../src/entities/enemy.js';
import { MISSIONS } from '../../src/missions/index.js';
import { flyoverConfig, flyoverAssets, flyoverSchedule, aircraftPose, activePasses, trimPitch, FLYOVER_TYPES, FLYOVER_DEFAULTS,
  createFlyovers } from '../../src/render/flyovers.js';
import { CREW_SOCKETS, LAMP_LIGHTS, createVehicleLamps, seatSide } from '../../src/art/vehicle-model.js';
import { createCrewFigures } from '../../src/art/vehicle-crew.js';

const ROOT = new URL('../../assets/models/vehicles/', import.meta.url);
const MAN = JSON.parse(readFileSync(new URL('manifest.json', ROOT), 'utf8'));
const meta = (model) => JSON.parse(readFileSync(new URL(MAN.models[model].meta, ROOT), 'utf8'));
const M = (id) => MISSIONS.find((m) => m.id === id);

test('flyovers: per-mission data — M1 on (Sola: Ju 52 / Bf 109 / Ju 87), Claymore / dam / sandbox / night off, def overrides', () => {
  const c1 = flyoverConfig(M('m01'));
  assert.ok(c1?.enabled, 'M1 has flyovers');
  assert.deepEqual(c1.types, ['ju52', 'bf109', 'ju87']);
  assert.equal(flyoverConfig(M('m02')), null, 'M2 (Operation Claymore: no air opposition) off');
  assert.equal(flyoverConfig(M('m03')), null, 'M3 (Eidfjord dam) off');
  assert.equal(flyoverConfig({ id: 'm00' }), null, 'unlisted mission off by default');
  assert.equal(flyoverConfig({ id: 'm01', theater: 'night' }), null, 'night: off unless the mission enables it');
  assert.equal(flyoverConfig({ id: 'm01', ambient: { flyovers: false } }), null, 'mission data can switch it off');
  const own = flyoverConfig({ id: 'm00', ambient: { flyovers: { types: ['storch', 'nope'], interval: [300, 200], altitude: [45, 50] } } });
  assert.deepEqual(own.types, ['storch'], 'unknown types dropped');
  assert.deepEqual(own.interval, [200, 300], 'bands normalized');
  assert.deepEqual(flyoverAssets(M('m01')), ['bf109_e', 'ju52_3m', 'ju87_b']);
  for (const [id, d] of Object.entries(FLYOVER_DEFAULTS)) for (const t of d.types) assert.ok(FLYOVER_TYPES[t], `${id}: ${t}`);
  for (const t of Object.values(FLYOVER_TYPES)) assert.ok(MAN.types[t.lib] || MAN.assets[t.lib], `${t.lib} is in the vehicle library`);
});

test('flyovers: schedule is a pure function of seed + mission (replays), intervals / formations / altitude in their bands', () => {
  const cfg = flyoverConfig(M('m01')), sun = { x: -0.683, y: 0.259, z: -0.683 };
  const o = { seed: 1234, id: 'm01', size: [65, 171], sun, floor: 2, viewK: 1.19 };
  const a = flyoverSchedule(cfg, o, 12), b = flyoverSchedule(cfg, o, 12);
  assert.deepEqual(a, b, 'same seed → same schedule');
  assert.notDeepEqual(flyoverSchedule(cfg, { ...o, seed: 99 }, 12).map((p) => p.t0), a.map((p) => p.t0), 'other seed → other schedule');
  assert.deepEqual(flyoverSchedule(cfg, o, 4), a.slice(0, 4), 'extending the schedule never changes earlier passes');
  assert.ok(a[0].t0 >= cfg.first[0] && a[0].t0 <= cfg.first[1], `first pass ${a[0].t0.toFixed(1)} s in the 'first' band`);
  for (let k = 1; k < a.length; k++) {
    const gap = a[k].t0 - a[k - 1].t0;
    assert.ok(gap >= cfg.interval[0] - 1e-6 && gap <= cfg.interval[1] + 1e-6, `gap ${gap.toFixed(1)} s`);
  }
  for (const p of a) {
    assert.ok(p.n >= 1 && p.n <= 3 && p.wing.length === p.n, `${p.type} element of ${p.n}`);
    const T = FLYOVER_TYPES[p.type];
    assert.ok(p.alt >= T.alt[0] + 2 - 1e-6 && p.alt <= T.alt[1] + 2 + 1e-6, `${p.type} altitude ${p.alt.toFixed(0)} m (+2 m floor)`);
    // out of sight at both ends; the ground shadow crosses the map's central band mid-pass
    const s0 = aircraftPose(p, 0, p.t0), s1 = aircraftPose(p, 0, p.t0 + p.dur);
    for (const q of [s0, s1]) assert.ok(q.x < -100 || q.x > 165 || q.z < -100 || q.z > 271, 'starts / ends off the map');
    const mid = aircraftPose(p, 0, p.t0 + p.dur / 2), k = (mid.y - 2) / sun.y;
    const sx = mid.x - sun.x * k, sz = mid.z - sun.z * k;
    assert.ok(sx > 0 && sx < 65 && sz > 0 && sz < 171, `shadow over the map mid-pass (${sx.toFixed(0)}, ${sz.toFixed(0)})`);
  }
  assert.deepEqual(activePasses(a, a[1].t0 + 1).map((p) => p.k), [1]);
  assert.deepEqual(activePasses(a, a[0].t0 - 1), [], 'nothing before the first pass (briefing / start of play)');
  const lone = flyoverSchedule(flyoverConfig({ id: 'x', ambient: { flyovers: { types: ['bf109'], count: [3, 3] } } }), o, 5);
  assert.ok(lone.every((p) => p.n === 3), 'count clamps the formation');
});

test('flyovers: poses — wingmen keep station behind the leader; aircraft trimmed level from their three-point attitude', () => {
  const p = flyoverSchedule(flyoverConfig({ id: 'x', ambient: { flyovers: { types: ['ju52'], count: [3, 3] } } }), { seed: 5, id: 'x', size: [100, 100] }, 1)[0];
  const t = p.t0 + p.dur / 2, L = aircraftPose(p, 0, t);
  for (const i of [1, 2]) {
    const W = aircraftPose(p, i, t), along = (W.x - L.x) * p.dx + (W.z - L.z) * p.dz, side = -(W.x - L.x) * p.dz + (W.z - L.z) * p.dx;
    assert.ok(along < -20 && Math.abs(side) > 20, `wingman ${i} behind (${along.toFixed(0)}) and abeam (${side.toFixed(0)})`);
  }
  assert.ok(Math.abs(L.bank) < 0.08 && Math.abs(L.pitch) < 0.03, 'gentle turbulence only');
  const deg = (a) => a * 180 / Math.PI;
  for (const m of ['bf109_e_grey', 'ju52_3m_grey', 'fi156_storch_grey', 'ju87_b_grey']) {
    const a = deg(trimPitch(meta(m)));
    assert.ok(a > 5 && a < 14, `${m}: three-point attitude trimmed out (${a.toFixed(1)}°)`);
  }
  assert.equal(trimPitch({ parts: [{ node: 'prop', kind: 'prop', pivot: [0, 1, 1], axis: [1, 0, -0] }] }), 0, 'no tailplane → no trim (never a flip)');
  assert.equal(createFlyovers(new World({ size: [60, 60] }), M('m01')), null, 'no vehicle library (node) → nothing');
});

test('crews: car / lorry / 251 driver sockets exist in the library models; seats measured (dy null)', () => {
  const socks = (m) => meta(m).sockets.map((s) => s.name);
  for (const [key, model] of [['car', 'kubelwagen_grey'], ['car', 'citroen11_grey'], ['car', 'horch901_grey'], ['truck', 'opel_blitz_cargo_grey'], ['fuel_truck', 'opel_blitz_tanker_grey']]) {
    const names = socks(model);
    for (const c of CREW_SOCKETS[key].slice(0, 2)) assert.ok(names.some((n) => c.s.test(n)), `${model}: ${c.s}`);
    assert.equal(CREW_SOCKETS[key][0].anim, 'drive');
    assert.equal(CREW_SOCKETS[key][0].dy, null, 'seated → measured from the figure');
  }
  assert.ok(socks('sdkfz251_c').some((n) => CREW_SOCKETS.armoredcar[1].s.test(n)), '251 driver');
  assert.equal(createCrewFigures(new Vehicle({ vehicleType: 'truck', x: 5, z: 5, crew: ['truckDriver'] })), null, 'no character library (node) → no figures');
});

test('crews: a scripted exit of an enemy rider steps out at his door (LHD driver: left), then walks to the point', () => {
  const w = new World({ size: [80, 60] });
  w.vehicleFactory = createVehicle;
  const v = w.spawnVehicle('truck', { vehicleType: 'truck', x: 40, z: 30, heading: 0, id: 'tr' });
  const e = w.add(new Enemy({ soldierType: 'truckDriver', x: 36, z: 28, heading: 0 }));
  assert.ok(v.enter(e), 'the driver gets in');
  const goal = { x: 40, z: 45 }; // 15 m to the vehicle's RIGHT (+z at heading 0)
  assert.ok(v.exit(e, goal.x, goal.z, { force: true }));
  const side = (e.x - v.x) * -Math.sin(v.heading) + (e.z - v.z) * Math.cos(v.heading); // + = right
  assert.ok(side < -1, `stepped out on the driver's (left) side (${side.toFixed(2)})`);
  assert.ok(Math.abs(e.x - v.x) < 3.5, `beside the cab, not at the point (${(e.x - v.x).toFixed(2)})`);
  const tgt = e.path?.at?.(-1) || e.goal || e.moveTarget || e.target;
  assert.ok(tgt && Math.hypot(tgt.x - goal.x, tgt.z - goal.z) < 1.5, 'then walks to the scripted point');
  assert.equal(seatSide('truck', 'land', 0).side, -1);
  // a commando clicking a point still gets out where he asked (player choice)
});

test('night: headlamp light pool is a fixed per-preset count (none by day / on low)', () => {
  assert.deepEqual(LAMP_LIGHTS, { low: 0, medium: 2, high: 3, ultra: 4 });
  assert.equal(createVehicleLamps({ add() {} }, { preset: 'high' }), null, 'day (vehicle art not at night) → no lights');
});
