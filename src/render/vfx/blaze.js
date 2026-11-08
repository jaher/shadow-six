// Sustained fire (art/realistic-flames; the user, 2026-11-08: "Don't touch the explosions but when things are in
// flames, flames should look more realistic", then "Fire looks like billboards, more volumetric please"): burning
// wrecks and buildings, fuel spills, tanks and campfires. Explosions keep their own recipes (effects.js); this is what
// stays alight after them.
//
// A fire is built like a real fuel / timber fire seen from 40 m:
//  - the FLAMES are a raymarched VOLUME (MODE.VOLUME, shaders.js) over the fuel footprint: a flame column that narrows
//    and thins as it rises, carved by 3D turbulence (a tileable noise volume baked at load) advected upward with buoyant
//    acceleration — solid over the fuel, licks higher up that climb, detach and burn out; yellow-white where the flame
//    is thick, orange, deep red at thin tips; the gas above the flames is soot, lit orange from below. It has depth from
//    every yaw, is cut exactly (and softly) by the geometry it burns in, breathes (puffing ~1.5/√D Hz) and leans with
//    the wind. One particle per bed at a time, re-emitted every VPER s with the fire's age (its level computed in the
//    shader).
//  - TIP PUFFS (MODE.FIRE): hot pockets in the upper flames that cool into soot, feeding the column.
//  - the SOOT COLUMN: dark (oil, rubber) or brown-grey (timber), rising, rolling and widening, lit by the fire light.
//  - EMBERS drifting up, a LIGHT that breathes with the flames and wanders a little, HEAT SHIMMER above.
// Lifecycle: it catches over `ramp` s; with a known burn time it holds, then dies down (lower, redder, relatively
// sootier) to a smoulder. Counts are per second through the emitters (quality density × budget pressure); the volume's
// march steps follow the quality tier (uVolSteps).
import * as THREE from 'three';
import { MODE, HOT } from './pool.js';

const rr = (r, a, b) => a + (b - a) * r();
/** A fire volume particle's life (s): re-emitted this often (exact hand-over in the sim step). */
const VPER = 4;
const mix3 = (c, r, j) => { const k = 1 + (r() - 0.5) * j; return { r: c[0] * k, g: c[1] * k, b: c[2] * k }; };

/** mulberry32 */
export function prng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A fire's own random stream, from where and when it starts: draws nothing from the caller's rng. */
export function forkRng(pos, t, salt = 0) {
  let h = Math.imul(Math.round(pos.x * 97) ^ 0x2545F491, 0x9E3779B1) ^ Math.imul(Math.round(pos.z * 89) + 0x68E31DA4, 0x85EBCA77);
  h = Math.imul(h ^ Math.round(t * 600) ^ Math.imul(salt + 1, 0xC2B2AE3D), 0x27D4EB2F);
  return prng(h ^ (h >>> 15));
}
/** Fire-level breathing (puffing): the curve the VOLUME shader applies to the flame height (shaders.js), so the light
 *  pulses with the flames. t: library time (s), f: Hz, ph: phase. */
export const blazePuff = (t, f, ph) => 0.5 * Math.sin(6.2832 * f * t + ph) + 0.3 * Math.sin(10.9 * f * t + 2.3 * ph) + 0.2 * Math.sin(3.1 * f * t + 0.6 * ph);

/** Burn level 0..1 over the fire's age: catches over `ramp` s; with a known burn time it holds to hold·burn, dies down
 *  to a smoulder (0.12) by 0.86·burn, then smoulders out (→ 0.08 at `burn`, and on until stopped). */
export function blazeLevel(ramp, burn = 0, hold = 0.55) {
  return (a) => {
    let k = Math.min(1, 0.25 + 0.75 * a / Math.max(ramp, 1e-3));
    if (burn > 0) {
      const d0 = burn * Math.min(hold, 0.8), d1 = burn * 0.86;
      if (a >= d1) k *= Math.max(0.08, 0.12 - 0.04 * (a - d1) / Math.max(burn - d1, 1e-3));
      else if (a > d0) k *= 1 - 0.88 * ((a - d0) / Math.max(d1 - d0, 1e-3)) ** 0.85;
    }
    return k;
  };
}

/** Fuel looks: flame core temperature (K, fireEmit ramp), soot over the flames, smoke albedo / opacity, embers. */
export const FUEL = {
  oil: { core: 2650, soot: 1, smoke: [0.034, 0.03, 0.027], smokeOp: 0.78, embers: 0.5, tip: 0.95, tipCol: [0.05, 0.044, 0.039] },
  wood: { core: 2550, soot: 0.5, smoke: [0.085, 0.076, 0.068], smokeOp: 0.78, embers: 1.6, tip: 0.8, tipCol: [0.11, 0.1, 0.09] },
};

/**
 * A sustained fire. Returns a handle {stop(), level(age)}.
 * @param {object} vfx the library
 * @param {() => number} rng the fire's own random stream
 * @param {object} o {at: Vector3 (fuel surface centre), sampler(rng) -> [dx, dz] (footprint), D: fire diameter (m),
 *   L: flame height (m), W: sheet width (m), dur, burn (s; dies down towards it), hold, ramp, level (age -> 0..1, instead),
 *   fuel: 'oil'|'wood',
 *   f / ph (share the breathing between beds), y0, lean, density, tips, smoke (false: none), smokeK, light (false: none),
 *   intensity (cd), radius, hazeR, haze, embers}
 */
export function blaze(vfx, rng, o) {
  const F = FUEL[o.fuel] || FUEL.oil, at = o.at, D = Math.max(0.3, o.D ?? 2), dur = o.dur ?? 1e6, y0 = o.y0 ?? -0.15;
  const L = o.L ?? 1.15 * D ** 0.72, W = o.W ?? Math.min(2.6, Math.max(0.3, 0.5 * D));
  const f = o.f ?? Math.min(2.4, Math.max(0.6, 1.5 / Math.sqrt(D))), ph = o.ph ?? rng() * 6.283;
  const sampler = o.sampler ?? ((r) => { const a = r() * 6.283, q = Math.sqrt(r()) * D * 0.4; return [Math.cos(a) * q, Math.sin(a) * q]; });
  const level = o.level ?? blazeLevel(o.ramp ?? 1.2, o.burn ?? 0, o.hold ?? 0.55);
  const lean = o.lean ?? 1;
  const kz = Math.min(1.3, Math.max(0.42, Math.sqrt(2.6 / D))); // eddy scale (shader): bigger fires, bigger tongues (∝ D^½)
  const parts = [];
  // the flames: a raymarched volume over the fuel (MODE.VOLUME, shaders.js): flame column, licks and the soot they feed.
  // One particle per bed at a time, re-emitted every VPER s carrying the fire's age (its burn level is computed in the
  // shader from ramp / hold / burn), handed over in the same sim step (the old one dies as the new one is born), so it
  // also comes back after a budget recycle. `box` = the footprint ellipse {rx, rz, yaw, x?, z?} (m).
  const bx = o.box ?? { rx: 0.42 * D, rz: 0.42 * D, yaw: 0 }, burn = o.burn ?? 0, ramp = o.ramp ?? 1.2;
  const holdT = burn * Math.min(o.hold ?? 0.55, 0.8), t0 = vfx.time, rb = bx.rx * 1.2;
  let vstop = false;
  const volume = (first) => {
    const age = vfx.time - t0;
    if (vstop || age >= dur) return;
    // (it dies 1 µs before the next one is born in the same step, so no frame shows two or none; only the fire's last
    // volume fades out — seed 1 — the others hand over at full strength)
    const last = dur - age <= VPER;
    vfx.emit({ x: at.x + (bx.x ?? 0), y: at.y + y0, z: at.z + (bx.z ?? 0), vx: ramp, vy: holdT, vz: burn, life: Math.min(VPER, dur - age) + (first ? 0 : 0.02) - 1e-6,
      s0: rb, s1: rb, drag: 1, buoy: 0, r: f, g: ph, b: F.soot, op: o.op ?? 1, temp: F.core, cool: age, noise: 0, rot: bx.yaw ?? 0,
      mode: MODE.VOLUME, wind: 0, seed: last ? 1 : 0.5, stretch: bx.rz / bx.rx, shape: kz, erode: lean, fin: first ? 0.4 : 0.001, aux: L * 1.6 / rb, dtOff: first ? 0 : -0.02 });
    vfx.at(VPER, () => volume(false));
  };
  volume(true);
  parts.push({ stop() { vstop = true; } });
  // tip puffs: hot in the upper flames, cooling through orange and red into soot (the tips turning into smoke)
  parts.push(vfx.addEmitter({ dur, rate: (a) => 0.6 * D * F.tip * (o.tips ?? 1) * (0.45 + 0.55 * level(a)), fn: (a) => {
    const lv = level(a), [dx, dz] = sampler(rng), hk = L * (0.35 + 0.65 * lv);
    vfx.emit({ x: at.x + dx * 0.7, y: at.y + y0 + hk * rr(rng, 0.55, 0.95), z: at.z + dz * 0.7, vx: rr(rng, -0.2, 0.2), vy: rr(rng, 0.6, 1.2) * Math.sqrt(hk / 2.5), vz: rr(rng, -0.2, 0.2),
      life: rr(rng, 2.0, 3.0), s0: rr(rng, 0.5, 0.75) * W, s1: rr(rng, 1.3, 1.9) * W, drag: 1.4, buoy: rr(rng, 1.6, 2.6),
      ...mix3(F.tipCol, rng, 0.3), op: rr(rng, 0.85, 1), temp: rr(rng, 1150, 1450) * (0.88 + 0.12 * lv), cool: rr(rng, 0.45, 0.75), noise: 0.35,
      rot: rr(rng, -1, 1), mode: MODE.FIRE, wind: 0.6, seed: rng(), erode: 0.12, fin: 0.12 });
  } }));
  if (o.smoke !== false) {
    // the soot column: born just above the flame tips, rising, rolling, widening; it stays thick as the flames die
    const sk = o.smokeK ?? 1, s1 = Math.min(10, 1.7 * D + 2.2);
    parts.push(vfx.addEmitter({ dur, rate: (a) => (2.2 + 0.4 * D) * sk * (0.7 + 0.3 * level(a)), fn: (a) => {
      const lv = level(a), [dx, dz] = sampler(rng);
      vfx.emit({ x: at.x + dx * 0.5, y: at.y + y0 + L * (0.55 + 0.3 * lv), z: at.z + dz * 0.5, vx: rr(rng, -0.3, 0.3), vy: rr(rng, 2.0, 3.0), vz: rr(rng, -0.3, 0.3),
        life: rr(rng, 10, 16), s0: rr(rng, 0.7, 1.0) * W, s1: rr(rng, 0.8, 1.25) * s1, drag: 0.45, buoy: rr(rng, 2.2, 3.0),
        // billows of varied soot (some browner, lighter, catching the sun) so the column rolls instead of reading as a wall
        ...mix3(rng() < 0.3 ? F.smoke.map((c) => c * 2.2) : F.smoke, rng, 0.5), op: rr(rng, 0.75, 1) * F.smokeOp, temp: 950, cool: 0.5, noise: 1.4, rot: rr(rng, -0.25, 0.25),
        mode: MODE.FIRE, wind: 1, seed: rng(), shape: rng() < 0.15 ? 1 : 0, erode: 0.1, stretch: 0.02, fin: 0.25 });
    } }));
  }
  // embers: now and then a spark lifts out of the fire and drifts up
  parts.push(vfx.addEmitter({ dur, rate: (a) => (o.embers ?? 1) * F.embers * 1.1 * D * (0.4 + 0.6 * level(a)), fn: (a) => {
    const [dx, dz] = sampler(rng), hk = L * (0.35 + 0.65 * level(a));
    vfx.emit({ hot: true, x: at.x + dx, y: at.y + y0 + rr(rng, 0.1, 0.6) * hk, z: at.z + dz, vx: rr(rng, -1, 1), vy: rr(rng, 2.5, 6), vz: rr(rng, -1, 1),
      life: rr(rng, 1.6, 4.5), s0: rr(rng, 0.03, 0.05), s1: 0.02, drag: 1.2, buoy: rr(rng, 0.4, 1.0), temp: rr(rng, 1500, 2050), cool: rr(rng, 1.5, 3.5),
      noise: 1.6, mode: HOT.SPARK, stretch: 0.02, wind: 0.8, seed: rng(), shape: 1 });
  } }));
  if (o.light !== false) {
    // the fire light breathes with the flames (same curve as the shader) and its pool wanders a little
    // (a point light stands for a flame L tall: high in the flames and never closer than 2.6 m over the ground, or a fire
    // on bright ground — snow, sand — burns a white hot-spot under itself)
    const gy = vfx.groundHeight ? vfx.groundHeight(at.x, at.z) : at.y;
    // (above the flames, never within ~1.5 m of the burning object: a point light that close burns a white spot into it)
    // (a deep orange, so a sunlit ground it reaches turns warm rather than white; never within ~2 m of the burning top)
    const t0 = vfx.time, I = o.intensity ?? Math.min(230, 42 * D ** 0.9), lp = at.clone().setY(Math.max(at.y + y0 + Math.max(0.6 * L, 2.0), gy + 2.2)), pos = lp.clone();
    parts.push(vfx.light({ pos, color: new THREE.Color(1, 0.3, 0.06), radius: o.radius ?? 5 + 2.5 * D, dur, fn: (a) => {
      const t = t0 + a, p = blazePuff(t, f, ph), lv = level(a);
      pos.set(lp.x + 0.12 * W * Math.sin(t * 1.9 + ph), lp.y + 0.1 * L * p * lv, lp.z + 0.12 * W * Math.cos(t * 1.4 + 2 * ph));
      return I * lv ** 1.2 * (0.72 + 0.28 * p) * (1 - 0.12 * Math.sin(t * 21 + ph) * Math.sin(t * 34.5 + 2.1 * ph));
    } }));
    parts.push(vfx.heatSource({ pos: at.clone().setY(at.y + y0 + L * 1.05), radius: o.hazeR ?? 0.6 * D + 0.6, dur, strength: o.haze ?? 1.1, fn: level, fire: true }));
  }
  return { level, stop() { for (const p of parts) { if (p.stop) p.stop(); else p.stopped = true; } } };
}
