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
//  - the SMOKE: one continuous plume as the chimneys' (plume(): soft unspun wisps in the shader's coherent curl field,
//    smooth shading), dark (oil, rubber) or brown-grey (timber), widening, thinning and greying as it rises and bends.
//  - EMBERS drifting up, a LIGHT that breathes with the flames and wanders a little, HEAT SHIMMER above.
// Lifecycle: it catches over `ramp` s; with a known burn time it holds, then dies down (lower, redder, relatively
// sootier) to a smoulder. Counts are per second through the emitters (quality density × budget pressure); the volume's
// march steps follow the quality tier (uVolSteps).
import * as THREE from 'three';
import { MODE, HOT } from './pool.js';
import { blazeLevel } from '../../world/fires.js';

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

/**
 * A continuous smoke plume, as the chimneys' wisps (chimney_smoke) scaled to a fire: many soft wisps with no spin, in
 * the main pool at full strength (not the capped ambient layer), aux 2 giving them the shader's smooth shading (soft
 * dome normal, density self-shadow, forward scatter; the underside takes the darker ground light) and soft bodies.
 * They FLOW (the user: "Can we make the smoke flow in a smoother trajectory rather than multiple patches circling
 * around"): each wisp flies one smooth path — launched up fast, slowing as it climbs, taken downwind by the wind and
 * the gust fronts — and the way it leaves turns slowly with the time it is born (incommensurate sways of 7–33 s per
 * axis), so wisps born together fly neighbouring paths and the plume is ONE column that bends with the wind and
 * meanders as a whole, its bends and puffs (the fire's breathing pulses the rate) travelling up it with the smoke.
 * No per-wisp offsets in the shader: a curl field there made patches orbit. Born dense and dark, drawn out along their
 * rise near the source, widening, thinning and greying with height. opts {at, y(age)?, sampler(rng)?, spread, rate (n/s
 * or fn(age)), pulse(t)?, level(age)?, dur, w0, w1 (m), life (s), col, light (share of lighter grey wisps), edge (share
 * of thin lighter wisps leaving the column's edge), op, vy, buoy, meander (sway, m/s), stretch}.
 * Returns the emitter.
 */
export function plume(vfx, rng, o) {
  const at = o.at, sp = o.spread ?? 0.5, col = o.col ?? [0.035, 0.031, 0.028], w0 = o.w0 ?? 1, w1 = o.w1 ?? 6, life = o.life ?? 11;
  const sw = o.meander ?? 1, p0 = rng() * 6.283, p1 = rng() * 6.283, p2 = rng() * 6.283, p3 = rng() * 6.283;
  const rate = o.rate ?? 8, rateFn = typeof rate === 'function' ? rate : () => rate;
  return vfx.addEmitter({ dur: o.dur ?? 1e6, rate: (a) => rateFn(a) * (o.pulse ? 1 + 0.3 * o.pulse(vfx.time) : 1), fn: (a) => {
    const k = o.level ? o.level(a) : 1, [dx, dz] = o.sampler ? o.sampler(rng) : [rr(rng, -sp, sp), rr(rng, -sp, sp)];
    const w = vfx.u?.uWind?.value, wx = w ? w.x : 0, wz = w ? w.z : 0, calm = 1 / (1 + 0.15 * Math.hypot(wx, wz)), t = vfx.time;
    const swx = sw * (0.5 * Math.sin(0.41 * t + p0) + 0.3 * Math.sin(0.23 * t + p1) + 0.2 * Math.sin(0.93 * t + 1.7 * p2));
    const swz = sw * (0.5 * Math.sin(0.33 * t + p2) + 0.3 * Math.sin(0.19 * t + p3) + 0.2 * Math.sin(0.87 * t + 1.3 * p0));
    // (not one flat colour: each wisp its own value ±18 % and a slight hue; on the fire's breathing denser, darker knots
    // alternate with thinner, lighter stretches; now and then a lighter grey wisp — steam off a wreck, a cleaner gust —
    // and some thin, lighter wisps that leave the column's edge, so it frays instead of reading as a clean tube)
    const p = o.pulse ? o.pulse(t) : 0, v = rr(rng, 0.82, 1.18) * (1 - 0.2 * p), lite = o.light && rng() < o.light, c = lite ? rr(rng, 0.2, 0.38) : 0;
    const edge = !lite && o.edge && rng() < o.edge, ev = edge ? rr(rng, 1.6, 2.4) : 1, ej = edge ? 0.5 : 0.08;
    const rgb = lite ? { r: c * rr(rng, 0.97, 1.03), g: c * rr(rng, 0.98, 1.02), b: c * rr(rng, 1.0, 1.06) }
      : { r: col[0] * v * ev * rr(rng, 0.94, 1.06), g: col[1] * v * ev * rr(rng, 0.96, 1.04), b: col[2] * v * ev * rr(rng, 0.94, 1.06) };
    vfx.emit({ x: at.x + dx, y: (o.y ? o.y(a) : at.y) + rr(rng, -0.15, 0.25) * w0, z: at.z + dz,
      vx: swx + rr(rng, -ej, ej) + wx * 0.25, vy: rr(rng, 0.95, 1.05) * (o.vy ?? 2.6) * (0.7 + 0.3 * k), vz: swz + rr(rng, -ej, ej) + wz * 0.25,
      life: rr(rng, 0.85, 1.15) * life * (0.55 + 0.45 * calm), s0: rr(rng, 0.8, 1.15) * w0, s1: rr(rng, 0.85, 1.15) * w1 * (edge ? 0.8 : 1),
      drag: 0.55, buoy: rr(rng, 0.95, 1.05) * (o.buoy ?? 1.9), ...rgb,
      // (≤ 1: a knot's extra density must not push a wisp past opaque — it would blend negatively, a near-black hole)
      op: Math.min(1, rr(rng, 0.75, 1) * (o.op ?? 0.55) * (o.level ? 0.4 + 0.6 * k : 1) * (lite ? 0.75 : edge ? 0.5 : 1) * (1 + 0.35 * p)),
      noise: 0, rot: 0, mode: MODE.SMOKE, wind: rr(rng, 0.97, 1.03), seed: rng(), shape: 1,
      erode: 0.1, stretch: (o.stretch ?? 0.2) * (1 + 0.8 * Math.max(0, p)), fin: 0.2, aux: 2 }); // (knots drawn out along the flow)
  } });
}

/** Burn level 0..1 over the fire's age (catch, hold, die down to a smoulder): the sim's own curve (world/fires.js), so the
 *  fires the enemies keep out of burn exactly as long as these flames. */
export { blazeLevel };

/** Fuel looks: flame core temperature (K, fireEmit ramp), soot over the flames, smoke albedo / opacity, embers. */
export const FUEL = {
  oil: { core: 2650, soot: 1, smoke: [0.038, 0.031, 0.026], smokeOp: 0.78, embers: 0.5 }, // near-black brown
  wood: { core: 2550, soot: 0.5, smoke: [0.1, 0.088, 0.064], smokeOp: 0.78, embers: 1.6 }, // brown-grey, a yellow tinge
};

/**
 * A sustained fire. Returns a handle {stop(), level(age)}.
 * @param {object} vfx the library
 * @param {() => number} rng the fire's own random stream
 * @param {object} o {at: Vector3 (fuel surface centre), sampler(rng) -> [dx, dz] (footprint), D: fire diameter (m),
 *   L: flame height (m), W: sheet width (m), dur, burn (s; dies down towards it), hold, ramp, level (age -> 0..1, instead),
 *   fuel: 'oil'|'wood', smokeCol ([r, g, b]: instead of the fuel's), steam (share of lighter grey wisps),
 *   f / ph (share the breathing between beds), y0, lean, density, smoke (false: none), smokeK, light (false: none),
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
  if (o.smoke !== false) {
    // the smoke: one continuous plume, as the chimneys' (the user: "Make the smoke smoother in the fire after explosions,
    // not just textures circling around (similar to how it was done for chimneys)") — many soft, unspun wisps born in the
    // flames' sooty top (the volume dissolves into them), dense and dark near the fire, stretched along their rise,
    // widening, thinning and greying as they climb and bend with the wind. As the fire dies (and for a lighter `smokeK`)
    // the plume grows fainter, not sparser — the wisps keep overlapping, so it never breaks into separate dark dots
    const sk = o.smokeK ?? 1, rate = (a) => (5 + 1.6 * D) * Math.max(0.85, sk) * (0.8 + 0.2 * level(a));
    // fires close together share one plume (a rack and the drums burning round it, two wrecks side by side): a fire
    // whose smoke would rise within reach of a plume that outlasts it feeds that plume (0.3 of its own rate, while it
    // burns) instead of drawing its own, so a cluster puts up one column, not a bundle of thin ones
    const hosts = vfx._plumeHosts || (vfx._plumeHosts = []), t0 = vfx.time, end = t0 + dur;
    const host = hosts.find((h) => h.alive() && h.end >= t0 + 0.8 * Math.min(dur, 1e5) && Math.hypot(h.x - at.x, h.z - at.z) < h.r + 0.25 * D);
    if (host) {
      const fd = { t0, end, rate: (t) => 0.3 * rate(t - t0) };
      host.feed.push(fd); parts.push({ stop() { fd.end = -1; } });
    } else {
      const feed = [], fed = () => { let n = 0; const t = vfx.time; for (const q of feed) if (t >= q.t0 && t < q.end) n += q.rate(t); return n; };
      const em = plume(vfx, rng, { dur, sampler: (r) => sampler(r).map((v) => v * 0.6), y: (a) => at.y + y0 + L * (0.55 + 0.3 * level(a)),
        at, rate: (a) => rate(a) + fed(), pulse: (t) => blazePuff(t, f, ph), level, w0: Math.max(0.8 * W, 0.9), w1: Math.min(8.5, 1.25 * D + 2.4), life: 11,
        col: o.smokeCol ?? F.smoke, light: o.steam ?? 0, edge: 0.2, op: F.smokeOp / 0.78 * Math.min(1, 0.45 + 0.55 * sk), vy: 5.0, buoy: 0.9, meander: 1.1 * Math.sqrt(D / 2.5), stretch: 0.12 });
      hosts.push({ x: at.x, z: at.z, r: 0.5 * D + 1.5, end, feed, alive: () => !em.stopped && vfx.time < end });
      for (let i = hosts.length - 1; i >= 0; i--) if (!hosts[i].alive()) hosts.splice(i, 1);
      parts.push(em);
    }
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
