/**
 * Realistic sustained fire (art/realistic-flames; the user, 2026-11-08: "Don't touch the explosions but when things
 * are in flames, flames should look more realistic"). Headless: the explosions' own output is byte-identical to before
 * the change, and the fires they leave (and every other sustained fire) are BLAZE fires that scale with their fuel,
 * breathe, die down towards a known burn time and stay out of the ambient (capped) smoke layer.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { RECIPES } from '../../src/render/vfx/effects.js';
import { MODE } from '../../src/render/vfx/pool.js';
import { blazeLevel, blazePuff } from '../../src/render/vfx/blaze.js';
import { FX } from '../../src/render/fx.js';
import { makeMock, STREAM_CASES, caseKey } from './vfx-stream.mjs';

/** Stream hashes measured on master 9bae3a038 (before the change) with tests/unit/vfx-stream.mjs: `blast` = everything a
 *  blast draws except its residual ground fire, over 26 s; `flame` = that residual ground fire (explosion_large's 18 s
 *  tongues), over its first RESIDUAL_CUT = 2.5 s (after which the ground keeps burning as a sustained fire). */
const BEFORE = {
  explosion_large: ['e32126b9', 'cc980279'], 'explosion_large {"scale":1.3}': ['daaf05bf', '09233072'], explosion_small: ['8e2615df', '811c9dc5'],
  grenade: ['90ed1b8f', '811c9dc5'], barrel_explosion: ['f1146b00', '811c9dc5'], 'barrel_explosion {"chainFrom":{"x":13,"y":0,"z":23}}': ['1cd1623a', '811c9dc5'],
  'tanker_explosion {"yaw":0.4,"dur":1000000}': ['69c299a5', 'da67d615'],
  'fuel_tank_blast {"yaw":0.3,"dur":90,"scale":1.1,"size":[5,7],"h":2.7,"poolR":3.5,"smokeK":1.2}': ['cd0da390', '4171baa0'],
};

test('flames: every explosion is byte-identical to before (particles, lights, haze, decals, debris, shake: 26 s; its ground fire: 2.5 s)', () => {
  for (const [k, o] of STREAM_CASES) {
    const key = caseKey(k, o), [blast, flame] = BEFORE[key];
    assert.equal(makeMock(RECIPES).run(k, o, 26).blast, blast, `${key}: blast stream changed`);
    assert.equal(makeMock(RECIPES).run(k, o, 2.5).flame, flame, `${key}: residual tongues changed in the blast's first 2.5 s`);
  }
});

const volOf = (r) => r.emitted.filter((p) => p.mode === MODE.VOLUME);
const boxH = (p) => p.s0 * p.aux; // the volume box height (1.6 × the flame height)
/** The burn level the VOLUME shader computes (shaders.js, mode 4) from the particle's curve (vx ramp, vy hold, vz burn). */
function glslLevel(fa, ramp, hold, bn) {
  let lv = Math.min(1, 0.25 + 0.75 * fa / Math.max(ramp, 1e-3));
  if (bn > 0) { const e1 = bn * 0.86, e0 = Math.min(hold, e1 - 1e-3);
    if (fa >= e1) lv *= Math.max(0.08, 0.12 - 0.04 * (fa - e1) / Math.max(bn - e1, 1e-3)); else if (fa > e0) lv *= 1 - 0.88 * ((fa - e0) / Math.max(e1 - e0, 1e-3)) ** 0.85; }
  return lv;
}

test('flames: a burning wreck is a raymarched VOLUME over its top, sized to the fuel, plus soot, embers, light and haze', () => {
  const truck = makeMock(RECIPES), r = truck.run('burning_wreck', { size: [2.2, 5.5], h: 1.9, dur: 1e6, yaw: 0.6 }, 9, []);
  const vols = volOf(r);
  assert.ok(vols.length >= 3 && vols.length <= 4, `one volume at a time, re-emitted every 4 s (${vols.length} in 9 s)`);
  for (const p of vols) {
    assert.ok(p.y <= 1.9 && p.y > 1.6 && Math.hypot(p.x - 10, p.z - 20) < 1e-6, 'on the wreck top (its foot a little into it)');
    assert.ok(!p.buoy && !p.wind && !p.noise, 'anchored: no drift, no curl');
    assert.ok(Math.abs(p.s0 - 2.2 * 0.42 * 1.2) < 1e-6 && Math.abs(p.stretch - (5.5 * 0.38) / (2.2 * 0.42)) < 1e-6 && p.rot === 0.6, 'the footprint box, turned with the wreck');
    assert.ok(!p.ambient, 'not ambient (fire smoke keeps its strength)');
  }
  const hTruck = boxH(vols[0]) / 1.6;
  assert.ok(hTruck > 2 && hTruck < 4.5, `truck flames ${hTruck.toFixed(2)} m`);
  assert.ok(r.emitted.some((p) => p.mode === MODE.FIRE && p.temp >= 1000), 'hot tip puffs that cool into soot');
  assert.ok(r.emitted.some((p) => p.mode === MODE.FIRE && p.temp < 1000 && p.r < 0.06), 'dark soot column');
  assert.ok(r.emitted.some((p) => p.hot), 'embers');
  assert.equal(truck.lights.length, 1, 'one fire light'); assert.equal(truck.haze.length, 1, 'one heat source');
  const house = volOf(makeMock(RECIPES).run('burning_wreck', { size: [7.2, 7.2], h: 1.4, dur: 60, fuel: 'wood' }, 2, []));
  assert.ok(boxH(house[0]) / 1.6 > hTruck * 1.25, 'a building burns taller');
  assert.ok(house[0].s0 > vols[0].s0 * 2, 'and wider');
});

test('flames: the volume is handed over every 4 s in the same sim step (never a frame without, never two) and carries the fire age', () => {
  const r = makeMock(RECIPES).run('burning_wreck', { size: [2.2, 5.5], h: 1.9, dur: 1e6, burn: 20 }, 13, []);
  // (a particle exists from the sim step that emits it, p.t; the pool frees it at the first frame with t >= death)
  const vols = volOf(r).map((p) => ({ emitted: p.t, born: p.t + (p.dtOff ?? 0), death: p.t + (p.dtOff ?? 0) + p.life, age0: p.cool }));
  for (let t = 0.05; t < 13; t += 1 / 60) {
    const live = vols.filter((v) => v.emitted <= t + 1e-9 && t < v.death - 1e-9).length;
    assert.ok(live === 1, `${live} volumes live at ${t.toFixed(3)} s`);
  }
  for (const v of vols) assert.ok(Math.abs(v.age0 - v.emitted) < 1e-6, 'its fire age at emission');
});

test('flames: the fire breathes — its light pulses with the shader curve and follows the burn level the shader computes', () => {
  const m = makeMock(RECIPES), r = m.run('burning_wreck', { size: [2.2, 5.5], h: 1.9, dur: 1e6, burn: 20 }, 1, []);
  const q = m.lights[0], I = [];
  for (let a = 2; a < 6; a += 0.05) I.push(q.fn(a));
  const lo = Math.min(...I), hi = Math.max(...I);
  assert.ok(hi / lo > 1.4 && hi / lo < 2.6, `flicker ${lo.toFixed(1)}..${hi.toFixed(1)} cd`);
  assert.ok(q.fn(19.5) < 0.25 * q.fn(5), 'dimmer as it dies down');
  for (const t of [0, 1.3, 7.7]) assert.ok(Math.abs(blazePuff(t, 1, 2)) <= 1.0001, 'puff in [-1, 1]');
  const v = volOf(r)[0], lv = blazeLevel(1.5, 20, 0.65);
  for (let a = 0; a < 26; a += 0.25) assert.ok(Math.abs(glslLevel(a, v.vx, v.vy, v.vz) - lv(a)) < 1e-6, `shader level = CPU level at ${a} s`);
});

test('flames: with a known burn time the fire dies down — lower, redder, sootier — then smoulders', () => {
  const lv = blazeLevel(1.5, 20);
  assert.ok(lv(0) < 0.3 && lv(2) === 1 && lv(10) === 1, 'catches, then burns');
  assert.ok(lv(15) < 0.8 && lv(17.5) <= 0.125 && lv(20) <= 0.081 && lv(25) >= 0.079, 'dies down to a smoulder, smoulders on');
  const r = makeMock(RECIPES).run('burning_wreck', { size: [2.2, 5.5], h: 1.9, dur: 1e6, burn: 20 }, 20, []);
  const fire = r.emitted.filter((p) => p.mode === MODE.FIRE && p.temp >= 1000);
  const rate = (a, b) => fire.filter((p) => p.t > a && p.t <= b).length / (b - a);
  assert.ok(rate(17, 20) < 0.7 * rate(3, 9), 'fewer hot tips as it dies down');
  const col = (a, b) => r.emitted.filter((p) => p.mode === MODE.FIRE && p.temp < 1000 && p.t > a && p.t <= b).length / (b - a);
  assert.ok(col(17, 20) > 0.6 * col(3, 9), 'the soot column thins less than the flames');
});

test('flames: every sustained fire has its volume, none of it ambient; a blast\'s tanker wreck can be stopped', () => {
  for (const [k, o, n] of [['fuel_pool_fire', { radius: 1.5, dur: 10 }, 1], ['fuel_tank_fire', { size: [5, 7], h: 2.7, dur: 90 }, 2], ['fire_small', { dur: 30 }, 1]]) {
    const r = makeMock(RECIPES).run(k, o, 3, []);
    assert.equal(volOf(r).length, n, `${k}: ${n} volume(s)`);
    assert.ok(!r.emitted.some((p) => p.ambient), `${k}: not ambient`);
  }
  const m = makeMock(RECIPES), r = m.run('tanker_explosion', { yaw: 0.4, dur: 1e6, burn: 20 }, 3, ['fuel_pool_fire', 'burning_wreck']);
  assert.ok(m.handle?.stop, 'tanker returns a handle');
  const wreck = () => volOf(r).filter((p) => p.tag === 'fire' && p.y > 1).length; // (the drums' spills burn on the ground)
  assert.equal(wreck(), 1, 'the wreck burns from 1.5 s');
  m.handle.stop();
  for (let s = 0; s < 600; s++) m.step();
  assert.equal(wreck(), 1, 'its wreck stops (no new volume)');
});

test('flames: the ground under a bomb keeps burning — its own tongues for 2.5 s, then a volume dying away', () => {
  const r = makeMock(RECIPES).run('explosion_large', {}, 12, ['_residual_fire']);
  const v = volOf(r);
  assert.ok(v.length >= 3 && v[0].t >= 2.5 - 1e-6, 'from 2.5 s, re-emitted');
  assert.ok(v.every((p) => p.tag === 'fire'), 'its own recipe (_residual_fire)');
  assert.ok(glslLevel(10, v[0].vx, v[0].vy, v[0].vz) < 0.6 && glslLevel(14, v[0].vx, v[0].vy, v[0].vz) < 0.15, 'dying away');
});

test('flames: game wiring — wreck burn time, bounded legacy fires, spills as pool fires', () => {
  const subs = new Map(), world = { mission: { theater: 'snow' }, game: { options: {} }, listen(ev, fn) { if (!subs.has(ev)) subs.set(ev, []); subs.get(ev).push(fn); return () => {}; } };
  const fx = new FX(world, null);
  fx.spawn('fire', 1, 2, { life: 4 }); fx.spawn('smoke', 1, 2, { life: 7 });
  assert.equal(fx.items[0].kind, 'fire_small'); assert.equal(fx.items[0].opts.dur, 4, 'M15 ruin: a 4 s tongue, not a fire for the rest of the mission');
  assert.equal(fx.items[1].opts.dur, 7, 'and a 7 s plume');
  fx.spawn('fire', 3, 4, { r: 4.5, duration: 120 });
  assert.equal(fx.items[2].kind, 'fuel_pool_fire', 'M17 spill: a pool fire');
  assert.ok(fx.items[2].opts.radius === 4.5 && fx.items[2].opts.dur === 120, 'its size and burn');
  const v = { def: { size: [6, 2.4] }, x: 5, z: 5, heading: 0, model: null };
  fx.onVehicleDestroyed({ vehicle: v });
  const w = fx.items.find((i) => i.kind === 'burning_wreck');
  assert.ok(w && w.opts.burn === 20, `vehicle wreck dies down with the game burn (${w?.opts.burn})`);
  assert.ok(new THREE.Vector3().isVector3);
});
