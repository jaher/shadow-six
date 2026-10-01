// Effect recipes. Every recipe is a pure function of (vfx, pos, opts, rng) -> deterministic
// (seeded RNG per spawn, fixed-step scheduler). Counts go through vfx.n() (quality tier + budget).
import * as THREE from 'three';
import { MODE, HOT } from './pool.js';
import { tornShellGeometry } from './debris.js';

export const SOOT = [0.05, 0.044, 0.039], GREY = [0.32, 0.31, 0.3], DUST = [0.36, 0.3, 0.22], DIRT = [0.2, 0.15, 0.1];
export const WOOD = [0.42, 0.42, 0.44];
export const SURFACE = { // ground-impact colours (dust, clods)
  sand: { dust: [0.5, 0.41, 0.3], clod: [0.15, 0.11, 0.07] }, dirt: { dust: [0.36, 0.3, 0.23], clod: [0.12, 0.09, 0.06] },
  grass: { dust: [0.34, 0.31, 0.24], clod: [0.16, 0.13, 0.08] }, mud: { dust: [0.26, 0.22, 0.17], clod: [0.1, 0.08, 0.055] },
  snow: { dust: [0.85, 0.87, 0.9], clod: [0.72, 0.74, 0.78] }, stone: { dust: [0.5, 0.48, 0.45], clod: [0.35, 0.33, 0.3] },
};
const rr = (rng, a, b) => a + (b - a) * rng();
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
function sph(rng, out = new THREE.Vector3()) { const u = rng() * 2 - 1, a = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u); return out.set(s * Math.cos(a), u, s * Math.sin(a)); }
function mixCol(c, rng, j = 0.15) { const k = 1 + (rng() - 0.5) * j; return { r: c[0] * k, g: c[1] * k, b: c[2] * k }; }
const flick = (age, seed, amt = 0.35) => 1 - amt * (0.5 + 0.5 * Math.sin(age * 23 + seed) * Math.sin(age * 7.3 + seed * 3) * Math.sin(age * 41 + seed * 7));
const surf = (o) => SURFACE[o.surface] || SURFACE.dirt;

export function flash(vfx, pos, size, hdr, life = 0.18, minPx = 0) {
  vfx.emit({ hot: true, x: pos.x, y: pos.y, z: pos.z, life, s0: size, s1: size * 1.3, drag: 1, mode: HOT.FLASH, r: hdr[0], g: hdr[1], b: hdr[2], op: 1, seed: 0.5, shape: minPx });
}
export function light(vfx, pos, color, radius, dur, fn, delay = 0) {
  return vfx.light({ pos: pos.clone(), color: new THREE.Color(...color), radius, dur, fn, delay });
}
export function sparks(vfx, pos, rng, n, o = {}) {
  n = vfx.n(n);
  for (let i = 0; i < n; i++) {
    const d = o.dir ? o.dir.clone().add(sph(rng).multiplyScalar(o.cone ?? 0.6)).normalize() : sph(rng);
    if (!o.dir) { d.y = Math.abs(d.y) * (o.up ?? 1) + (o.upBias ?? 0.3); d.normalize(); }
    const sp = rr(rng, o.vmin ?? 8, o.vmax ?? 28);
    vfx.emit({ hot: true, x: pos.x + d.x * 0.2, y: pos.y + d.y * 0.2, z: pos.z + d.z * 0.2, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp,
      life: rr(rng, o.lmin ?? 0.6, o.lmax ?? 2.0), s0: o.size ?? 0.05, s1: (o.size ?? 0.05) * 0.6, drag: o.drag ?? 0.35, buoy: o.buoy ?? -9.8,
      temp: rr(rng, o.tmin ?? 2000, o.tmax ?? 2800), cool: rr(rng, 0.5, 1.4) * (o.cool ?? 1), mode: HOT.SPARK, stretch: o.stretch ?? 0.035, wind: o.wind ?? 0.1, seed: rng(), shape: 1.2 });
  }
}
export function embers(vfx, pos, rng, n, spread = 1.5, o = {}) {
  n = vfx.n(n);
  for (let i = 0; i < n; i++) {
    const d = sph(rng);
    vfx.emit({ hot: true, x: pos.x + d.x * spread, y: pos.y + Math.abs(d.y) * spread, z: pos.z + d.z * spread,
      vx: d.x * rr(rng, 1, 4), vy: rr(rng, 2, 6) * (o.up ?? 1), vz: d.z * rr(rng, 1, 4),
      life: rr(rng, o.lmin ?? 2, o.lmax ?? 5), s0: o.size ?? 0.04, s1: 0.025, drag: 1.2, buoy: o.buoy ?? 0.5,
      temp: rr(rng, 1500, 2000), cool: rr(rng, 1.5, 3.5), noise: 1.6, mode: HOT.SPARK, stretch: 0.02, wind: 0.8, seed: rng(), shape: 1 });
  }
}
/** Ground-hugging shock dust skirt (radial, high drag, torn wisps). */
export function dustRing(vfx, pos, rng, n, o = {}) {
  n = vfx.n(n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rr(rng, -0.15, 0.15), sp = rr(rng, o.vmin ?? 14, o.vmax ?? 24), r0 = o.r0 ?? 1.2, c = mixCol(o.col ?? DUST, rng, 0.2);
    vfx.emit({ x: pos.x + Math.cos(a) * r0, y: pos.y + 0.3, z: pos.z + Math.sin(a) * r0, vx: Math.cos(a) * sp, vy: rr(rng, 0.2, 1.5), vz: Math.sin(a) * sp,
      life: rr(rng, o.lmin ?? 3, o.lmax ?? 6), s0: (o.s0 ?? 1.2) * rr(rng, 0.6, 1.3), s1: rr(rng, (o.s1 ?? 5) * 0.6, (o.s1 ?? 5) * 1.4), drag: (o.drag ?? 2.4) * rr(rng, 0.7, 1.4), buoy: o.buoy ?? 0.3,
      ...c, op: o.op ?? 0.4, noise: 0.6, rot: rr(rng, -0.4, 0.4), mode: MODE.SMOKE, wind: 1, seed: rng(), shape: 1, erode: 0.12, stretch: 0.04 });
  }
}
/** Shockwave: refraction ring + dust skirt + shake. */
export function shockwave(vfx, pos, rng, radius, dust, strength = 1, col = DUST) {
  vfx.heatSource({ pos: V3(pos.x, pos.y + 0.2, pos.z), radius, dur: 0.45 * Math.sqrt(radius / 15), ring: true, strength: 1.2 * Math.min(strength, 1.5), fn: (a) => 1 - a / 0.5 });
  if (dust) dustRing(vfx, pos, rng, dust, { vmin: radius * 0.8, vmax: radius * 1.4, s1: 3 + radius * 0.2, lmin: 2.5, lmax: 5.5, col });
  vfx.addShake(0.35 * strength);
}
/** Instanced chunk debris; `trail` chunks smoke/burn while flying. */
export function chunks(vfx, pos, rng, n, o = {}) {
  n = vfx.n(n);
  for (let i = 0; i < n; i++) {
    const d = sph(rng); d.y = Math.abs(d.y) * 1.2 + (o.upBias ?? 0.5); d.normalize();
    const sp = rr(rng, o.vmin ?? 6, o.vmax ?? 20), c = o.colors ? o.colors[(rng() * o.colors.length) | 0] : [0.12, 0.11, 0.1];
    const k = rr(rng, 0.7, 1.2);
    vfx.debris.add({ pos: V3(pos.x + d.x * 0.5, pos.y + 0.3 + d.y * 0.5, pos.z + d.z * 0.5), vel: d.multiplyScalar(sp),
      spin: V3(rr(rng, -12, 12), rr(rng, -12, 12), rr(rng, -12, 12)), size: rr(rng, o.smin ?? 0.12, o.smax ?? 0.45),
      color: new THREE.Color(c[0] * k, c[1] * k, c[2] * k), trail: rng() < (o.trail ?? 0) ? 1 : 0, burnTime: rng() < (o.burn ?? 0) ? rr(rng, 3, 8) : 0, rot: rng() * 6 });
  }
}

/** Fireball: hot puffs expand radially (high drag -> ~0.3 s expansion), buoyancy rolls them upward;
 *  each puff cools along a blackbody curve and becomes lit soot smoke (no hand-off pop). */
export function fireball(vfx, pos, rng, o = {}) {
  const s = o.scale ?? 1, n = vfx.n(Math.round((o.n ?? 70) * Math.sqrt(s)));
  for (let i = 0; i < n; i++) {
    const d = sph(rng); d.y = d.y * 0.7 + (o.upBias ?? 0.35); d.normalize();
    const sp = rr(rng, 0.4, 1) * (o.speed ?? 14) * Math.sqrt(s), r0 = rng() * 0.8 * s;
    const soot = mixCol(o.soot ?? SOOT, rng, 0.3);
    vfx.emit({ x: pos.x + d.x * r0, y: pos.y + 0.6 * s + d.y * r0, z: pos.z + d.z * r0, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp,
      life: rr(rng, o.lmin ?? 1.8, o.lmax ?? 3.4) * (o.lifeK ?? 1), s0: rr(rng, 1.8, 3.0) * s * (o.size ?? 1), s1: rr(rng, 3.4, 5.4) * s * (o.size ?? 1),
      drag: rr(rng, 2.2, 3.5) * (o.dragK ?? 1), buoy: rr(rng, 4, 8) * (o.buoyK ?? 1), ...soot, op: rr(rng, 0.85, 1),
      temp: rr(rng, o.tmin ?? 2000, o.tmax ?? 2700), cool: rr(rng, 0.7, 1.4) * (o.coolK ?? 1), noise: 0.9 * s, rot: rr(rng, -0.8, 0.8),
      mode: MODE.FIRE, wind: 0.6, seed: rng(), dtOff: -rng() * 0.02, shape: 0, erode: 0.05, fin: 0.03 });
  }
}
/** Lit smoke puffs (column body, aftermath). */
export function smokePuffs(vfx, pos, rng, n, o = {}) {
  for (let i = 0; i < n; i++) {
    const d = sph(rng), c = mixCol(o.col ?? SOOT, rng, 0.35), sp = rr(rng, o.vmin ?? 0.5, o.vmax ?? 3), sp0 = o.spread ?? 1;
    vfx.emit({ x: pos.x + d.x * sp0, y: pos.y + Math.abs(d.y) * sp0 * (o.ySpread ?? 1), z: pos.z + d.z * sp0, vx: d.x * sp * (o.lat ?? 1), vy: Math.abs(d.y) * sp + (o.vy ?? 2), vz: d.z * sp * (o.lat ?? 1),
      life: rr(rng, o.lmin ?? 8, o.lmax ?? 16), s0: rr(rng, 0.8, 1.2) * (o.s0 ?? 2), s1: rr(rng, 0.8, 1.3) * (o.s1 ?? 10), drag: o.drag ?? 0.6, buoy: rr(rng, 0.7, 1.2) * (o.buoy ?? 2.2),
      ...c, op: rr(rng, 0.75, 1) * (o.op ?? 0.85), temp: o.temp ?? 0, cool: o.cool ?? 1, noise: o.noise ?? 1.6, rot: rr(rng, -0.25, 0.25),
      mode: o.temp ? MODE.FIRE : MODE.SMOKE, wind: o.wind ?? 1, seed: rng(), shape: rng() < (o.wisp ?? 0.3) ? 1 : 0, erode: o.erode ?? 0.08,
      stretch: o.stretch ?? 0.03, fin: o.fin ?? 0.25, ambient: !!o.ambient, aux: o.ambient ? 1 : 0 });
  }
}
/** Continuous buoyant smoke column: tight base, rises fast, widens and thins with height, bends
 *  with the wind. Seen from the 55-degree game camera it reads as a column displaced upward on
 *  screen, not a ground carpet. Returns the emitter (stop() via handle). */
export function smokeColumn(vfx, pos, rng, o = {}) {
  const base = pos.clone();
  return vfx.addEmitter({ ambient: !!o.ambient, dur: o.dur ?? 22, rate: (a) => ((o.rate ?? 8) * Math.exp(-a / (o.decay ?? 12)) + (o.minRate ?? 0)) * (o.fade ? o.fade(a) : 1),
    fn: () => smokePuffs(vfx, base, rng, 1, { spread: o.spread ?? 0.8, ySpread: 0.4, lat: 0.25, vmin: 0.2, vmax: 1.2, vy: o.vy ?? 4, s0: o.s0 ?? 1.6, s1: o.s1 ?? 9,
      lmin: o.lmin ?? 9, lmax: o.lmax ?? 15, buoy: o.buoy ?? 2.6, drag: o.drag ?? 0.45, col: o.col, op: o.op ?? 0.8, temp: o.temp, cool: o.cool,
      wisp: o.wisp ?? 0.35, erode: o.erode ?? 0.1, noise: o.noise ?? 1.4, stretch: 0.02, ambient: o.ambient }) });
}
/** Flame tongues licking from an area: tall procedural FLAME sprites anchored on the fuel surface
 *  (leaning with the wind) + a few hot puffs that detach and cool into smoke.
 *  shape: {rx, rz} ellipse or custom sampler(rng)->[dx,dz]. */
export function flames(vfx, pos, rng, o = {}) {
  const lobe = o.sampler ? o.sampler(rng) : (() => { const a = rng() * Math.PI * 2, q = Math.sqrt(rng()); return [Math.cos(a) * q * (o.rx ?? 1), Math.sin(a) * q * (o.rz ?? 1)]; })();
  const s = o.size ?? 1;
  if (rng() < (o.puffFrac ?? 0.22)) {
    vfx.emit({ x: pos.x + lobe[0], y: pos.y + (o.y0 ?? 0.1) + s * 0.8, z: pos.z + lobe[1], vx: rr(rng, -0.3, 0.3), vy: rr(rng, 1.5, 3) * s, vz: rr(rng, -0.3, 0.3),
      life: rr(rng, 0.7, 1.3) * (o.lifeK ?? 1) * Math.sqrt(s), s0: rr(rng, 0.4, 0.7) * s, s1: rr(rng, 1.2, 1.9) * s, drag: 1.5, buoy: rr(rng, 5, 8),
      ...mixCol(SOOT, rng), op: 0.6, temp: rr(rng, o.tmin ?? 1600, o.tmax ?? 2000), cool: rr(rng, 0.3, 0.55) * (o.coolK ?? 1),
      noise: 0.35, rot: rr(rng, -1.5, 1.5), mode: MODE.FIRE, wind: 0.5, seed: rng(), erode: 0.15, fin: 0.1 });
    return;
  }
  const hs = rr(rng, 0.5, 1.4) * s;
  vfx.emit({ x: pos.x + lobe[0], y: pos.y + (o.y0 ?? 0.02), z: pos.z + lobe[1], vx: 0, vy: rr(rng, 0.2, 0.8) * s, vz: 0,
    life: rr(rng, 0.45, 0.9) * (o.lifeK ?? 1), s0: hs * 0.55, s1: hs * (o.w1 ?? 0.85), drag: 2.5, buoy: rr(rng, 1, 2.5) * s,
    r: 0, g: 0, b: 0, op: rr(rng, 0.8, 1) * (o.op ?? 1), temp: rr(rng, o.tmin ?? 1750, o.tmax ?? 2150), cool: 1e3,
    mode: MODE.FLAME, wind: rr(rng, 0.4, 1.6) * (o.lean ?? 1), seed: rng(), aux: rr(rng, 2.0, 5.0) * (o.tall ?? 1), fin: 0.12 });
}
/** Flickering fire light + heat haze bundle for a persistent fire. */
export function fireLightAndHaze(vfx, pos, rng, o = {}) {
  const seed = rng() * 100, I = o.intensity ?? 60, dur = o.dur ?? 10, fade = o.fade ?? (() => 1);
  const L = light(vfx, pos.clone().add(V3(0, o.h ?? 1.2, 0)), o.color ?? [1, 0.4, 0.1], o.radius ?? 9, dur, (a) => I * flick(a, seed) * fade(a));
  const H = vfx.heatSource({ pos: pos.clone().add(V3(0, (o.h ?? 1.2) + 1, 0)), radius: o.hazeR ?? 2.5, dur, strength: o.haze ?? 1.0, fn: fade });
  return { stop() { L.stopped = true; H.stopped = true; } };
}
/** Dirt fountain (grenade / shell in soil): vertical jets of stretched dirt + falling clods. */
export function dirtFountain(vfx, pos, rng, o = {}) {
  const s = o.scale ?? 1, col = o.clod ?? DIRT, jets = vfx.n(o.jets ?? 11);
  for (let j = 0; j < jets; j++) {
    const a = rng() * Math.PI * 2, tilt = rr(rng, 0.05, o.cone ?? 0.45), vmax = rr(rng, 10, 18) * Math.sqrt(s);
    const dx = Math.cos(a) * Math.sin(tilt), dz = Math.sin(a) * Math.sin(tilt), dy = Math.cos(tilt);
    const per = Math.max(3, Math.round(9 * Math.sqrt(s) * vfx.quality.density));
    for (let k = 0; k < per; k++) {
      const f = k / per, sp = vmax * (0.35 + 0.65 * (1 - f * f)), c = mixCol(col, rng, 0.3);
      vfx.emit({ x: pos.x + dx * 0.3, y: pos.y + 0.15, z: pos.z + dz * 0.3, vx: dx * sp + rr(rng, -0.4, 0.4), vy: dy * sp, vz: dz * sp + rr(rng, -0.4, 0.4),
        life: rr(rng, 1.0, 1.9), s0: rr(rng, 0.3, 0.55) * s, s1: rr(rng, 0.9, 1.7) * s, drag: rr(rng, 0.5, 0.9), buoy: -8.5,
        ...c, op: rr(rng, 0.85, 1), noise: 0.2, rot: rr(rng, -1, 1), mode: MODE.SMOKE, wind: 0.15, seed: rng(), shape: 0, erode: 0.06, stretch: 0.15, fin: 0.02, dtOff: -f * 0.05 });
    }
  }
  chunks(vfx, pos, rng, Math.round(22 * s), { vmin: 5, vmax: 14 * Math.sqrt(s), upBias: 1.4, smin: 0.05 * s, smax: 0.16 * s, colors: [col, col.map((c) => c * 1.3)] });
}

const handle = (...parts) => ({ stop() { for (const p of parts) if (p) { if (p.stop) p.stop(); else p.stopped = true; } } });

export const RECIPES = {
  /** Blown-out window panes (bodies-design §A.8): pale glass chips thrown out of the frame (debris: 2 s, no CCD). */
  glass_shards(vfx, pos, o, rng) {
    const s = o.scale ?? 1;
    chunks(vfx, pos, rng, Math.round(28 * s), { vmin: 2, vmax: 6.5, upBias: 0.3, smin: 0.015, smax: 0.06, colors: [[0.72, 0.8, 0.84], [0.5, 0.58, 0.62], [0.86, 0.9, 0.92]] });
  },

  /** E1 large explosion (fuel tank / ammo dump / demolition charge). opts.scale */
  explosion_large(vfx, pos, o, rng) {
    const s = o.scale ?? 1, up = (h) => pos.clone().add(V3(0, h, 0));
    flash(vfx, up(2 * s), 11 * s, [16, 9, 3.5], 0.14);
    light(vfx, up(3 * s), [1, 0.5, 0.16], 30 * s, 6, (a) => 420 * s * Math.exp(-a * 7) + 160 * s * Math.exp(-a * 0.9) * flick(a, 3));
    fireball(vfx, pos, rng, { scale: s, n: 80, speed: 16 });
    fireball(vfx, pos, rng, { scale: s * 0.8, n: 26, speed: 7, upBias: 1.2, buoyK: 1.6, tmax: 2900 }); // rolling cap
    vfx.at(0.7, () => smokePuffs(vfx, up(7 * s), rng, vfx.n(22), { spread: 2.5 * s, lat: 0.4, vmin: 1, vmax: 3, vy: 3.5, s0: 3.5 * s, s1: 11 * s, lmin: 8, lmax: 15, buoy: 2.8, temp: 1200, cool: 0.4, wisp: 0.2 }));
    for (const [dt, k] of [[0.22, 0.55], [0.45, 0.45], [0.8, 0.4]]) vfx.at(dt, () => {
      const p = pos.clone().add(V3(rr(rng, -3, 3) * s, 0, rr(rng, -3, 3) * s));
      fireball(vfx, p, rng, { scale: s * k, n: 22, speed: 10 }); sparks(vfx, p.clone().setY(p.y + 1), rng, 30, { vmax: 20 });
      light(vfx, p.clone().setY(p.y + 2), [1, 0.46, 0.14], 14 * s, 1.2, (a) => 220 * s * k * Math.exp(-a * 4));
      vfx.addShake(0.2);
    });
    // aftermath column (handed over from the fireball puffs; narrow and vertical)
    smokeColumn(vfx, up(3 * s), rng, { dur: o.dur ?? 26, rate: 9 * s, decay: 10, minRate: 1.5 * s, spread: 1.2 * s, s0: 2.6 * s, s1: 11 * s, lmin: 11, lmax: 18, buoy: 2.8, vy: 4.5 });
    // thrown debris: on snow mostly packed snow and ice lumps with some frozen soil, elsewhere earth and charred bits
    chunks(vfx, pos, rng, Math.round(45 * s), { vmin: 8, vmax: 26, trail: 0.35, burn: 0.3, colors: o.surface === 'snow'
      ? [[0.78, 0.8, 0.84], [0.64, 0.66, 0.7], [0.3, 0.26, 0.22]] : [[0.1, 0.09, 0.08], [0.25, 0.22, 0.18], [0.18, 0.2, 0.14]] });
    if (o.surface === 'snow') dirtFountain(vfx, pos, rng, { scale: 1.6 * s, jets: 12, cone: 0.6, clod: SURFACE.snow.clod }); // white powder column
    sparks(vfx, up(1), rng, Math.round(200 * s), { vmin: 10, vmax: 38 });
    embers(vfx, up(3 * s), rng, Math.round(100 * s), 3 * s, { lmin: 3, lmax: 8 });
    shockwave(vfx, pos, rng, 22 * s, Math.round(60 * s), 1.6 * s, surf(o).dust);
    vfx.decal(pos, 13 * s, 'scorch', { rot: rng() * 6 });
    vfx.heatSource({ pos: up(4 * s), radius: 7 * s, dur: 16, strength: 1.3, fn: (a) => Math.exp(-a / 6) });
    const burn = pos.clone(); // residual burning debris field
    vfx.addEmitter({ dur: 18, rate: (a) => 30 * s * Math.exp(-a / 7), fn: () => flames(vfx, burn, rng, { rx: 2.5 * s, rz: 2.5 * s, size: 0.8 }) });
    fireLightAndHaze(vfx, burn, rng, { intensity: 90 * s, dur: 18, fade: (a) => Math.exp(-a / 7), radius: 10 });
    vfx.addShake(1.1 * s);
    vfx.blast(pos, 14 * s, rng);
  },

  /** Artillery shell / mortar / demolition in soil: dirt fountain + short fireball + smoke. */
  explosion_small(vfx, pos, o, rng) {
    const s = o.scale ?? 1, up = (h) => pos.clone().add(V3(0, h, 0)), S = surf(o);
    flash(vfx, up(0.8 * s), 5 * s, [22, 13, 6], 0.08, 30);
    light(vfx, up(1.5), [1, 0.66, 0.35], 14 * s, 0.5, (a) => 380 * s * Math.exp(-a * 14));
    fireball(vfx, pos, rng, { scale: 0.55 * s, n: 26, speed: 11, lmin: 0.6, lmax: 1.4, coolK: 0.35, tmax: 2900, dragK: 1.3 });
    dirtFountain(vfx, pos, rng, { scale: 1.3 * s, jets: 14, clod: S.clod });
    smokePuffs(vfx, up(0.6), rng, vfx.n(16), { col: S.dust.map((c) => c * 0.62), spread: 1.2 * s, lat: 0.5, vmin: 1, vmax: 4, vy: 2.5, s0: 1.6 * s, s1: 6.5 * s, lmin: 5, lmax: 9, buoy: 1.1, drag: 1.4, op: 0.75, wisp: 0.5 });
    smokePuffs(vfx, up(1.5), rng, vfx.n(8), { col: [0.12, 0.11, 0.1], spread: 0.8 * s, lat: 0.3, vmin: 0.5, vmax: 2, vy: 3, s0: 1.4 * s, s1: 5 * s, lmin: 5, lmax: 8, buoy: 1.6, op: 0.7 });
    sparks(vfx, up(0.5), rng, 40, { vmin: 8, vmax: 26, lmin: 0.25, lmax: 0.8, size: 0.04 });
    shockwave(vfx, pos, rng, 11 * s, Math.round(26 * s), 0.8 * s, S.dust);
    vfx.decal(pos, 4.5 * s, 'scorch', { rot: rng() * 6 });
    vfx.blast(pos, 6 * s, rng);
  },

  /** E2 hand grenade (Stielhandgranate / Mills): short flash, brown-tan dirt fountain with jets
   *  and clods, grey-brown dust skirt. NO fireball. */
  grenade(vfx, pos, o, rng) {
    const up = (h) => pos.clone().add(V3(0, h, 0)), S = surf(o), s = o.scale ?? 1;
    flash(vfx, up(0.5), 3.2 * s, [26, 17, 8], 0.05, 26);
    light(vfx, up(1.0), [1, 0.72, 0.45], 9, 0.18, (a) => 300 * Math.exp(-a * 28));
    const snow = o.surface === 'snow';
    dirtFountain(vfx, pos, rng, { scale: 1.15 * s, jets: 16, cone: 0.5, clod: S.clod });
    // in snow the column is mostly white powder; a few jets of frozen soil from under the cover (grey-brown, lighter
    // than bare earth: soil mixed with snow) and a thin TNT smoke core keep it readable at the game camera
    if (snow) dirtFountain(vfx, pos, rng, { scale: 0.55 * s, jets: 5, cone: 0.3, clod: SURFACE.dirt.clod.map((c, i) => c * 1.4 + SURFACE.snow.clod[i] * 0.35) });
    // dust body rising from the crater + low skirt (white snow powder on snow, brown-grey elsewhere)
    vfx.at(0.06, () => smokePuffs(vfx, up(0.4), rng, vfx.n(14), { col: S.dust.map((c) => c * (snow ? 0.95 : 0.62)), spread: 0.8 * s, lat: 0.6, vmin: 1.5, vmax: 5, vy: 2.2, s0: 0.6 * s, s1: 5.5 * s, lmin: 4, lmax: 7, buoy: 0.8, drag: 1.8, op: 0.72, wisp: 0.55, erode: 0.12 }));
    smokePuffs(vfx, up(1.2), rng, vfx.n(6), { col: snow ? [0.24, 0.23, 0.22] : [0.2, 0.18, 0.16], spread: 0.5 * s, lat: 0.3, vmin: 0.5, vmax: 1.5, vy: 2.4, s0: 1.0 * s, s1: 4 * s, lmin: 4, lmax: 7, buoy: 1.2, op: snow ? 0.55 : 0.6, wisp: 0.5 });
    sparks(vfx, up(0.3), rng, 26, { vmin: 8, vmax: 22, lmin: 0.15, lmax: 0.45, size: 0.035 });
    shockwave(vfx, pos, rng, 7 * s, Math.round(20 * s), 0.5, S.dust);
    // the bowl itself is carved by render/blast-marks (dirty-snow ejecta on snow): only a faint powder-burn here
    vfx.decal(pos, 3 * s, 'crater', { rot: rng() * 6, opacity: snow ? 0.35 : 1 });
    vfx.blast(pos, 4 * s, rng);
  },

  /** E3 persistent burning wreck. opts: {size:[x,z] (m), h: height of the burning top (m), dur, yaw} */
  burning_wreck(vfx, pos, o, rng) {
    const [sx, sz] = o.size ?? [2.2, 5.5], dur = o.dur ?? 1e6, top = pos.clone().setY(pos.y + (o.h ?? 1.6));
    const yaw = o.yaw ?? 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const sampler = (r) => { const a = r() * 6.283, q = Math.sqrt(r()); const lx = Math.cos(a) * q * sx * 0.42, lz = Math.sin(a) * q * sz * 0.38; return [lx * cy + lz * sy, -lx * sy + lz * cy]; };
    const e1 = vfx.addEmitter({ dur, rate: 34, fn: () => flames(vfx, top, rng, { sampler, size: 1.25, tall: 1.15 }) });
    const e2 = vfx.addEmitter({ dur, rate: 9, fn: () => flames(vfx, top, rng, { sampler: (r) => sampler(r).map((v) => v * 0.6), size: 1.8, tall: 1.2, tmax: 2250, puffFrac: 0.35 }) });
    const e3 = smokeColumn(vfx, top.clone().setY(top.y + 1.8), rng, { dur, rate: 4.5, decay: 1e9, spread: 0.7, s0: 1.8, s1: 10, lmin: 13, lmax: 19, buoy: 2.6, vy: 3.5, op: 0.9, temp: 950, cool: 0.5, wisp: 0.25 });
    const e4 = vfx.addEmitter({ dur, rate: 4, fn: () => embers(vfx, top, rng, 1, 1.0, { lmin: 2, lmax: 5 }) });
    const fl = fireLightAndHaze(vfx, top, rng, { intensity: 110, dur, radius: 11, hazeR: 3, h: 1.4 });
    return handle(e1, e2, e3, e4, fl);
  },

  /** Campfire / small fire (wood): short tongues, embers, thin grey-white wood smoke plume. */
  fire_small(vfx, pos, o, rng) {
    const s = o.scale ?? 1, dur = o.dur ?? 1e6;
    const e1 = vfx.addEmitter({ dur, rate: 18 * s, fn: () => flames(vfx, pos, rng, { rx: 0.25 * s, rz: 0.25 * s, size: 0.62 * s, tall: 1.0, puffFrac: 0.12, tmin: 1500, tmax: 1950 }) });
    const e2 = RECIPES.chimney_smoke(vfx, pos.clone().setY(pos.y + 0.9 * s), { dur, rate: 8, col: [0.55, 0.55, 0.57], op: 0.24, s1: 2.6, vary: false, ambient: false }, rng);
    const e3 = vfx.addEmitter({ dur, rate: 2, fn: () => embers(vfx, pos, rng, 1, 0.15, { lmin: 1, lmax: 3, size: 0.03 }) });
    const fl = fireLightAndHaze(vfx, pos, rng, { intensity: 14 * s, dur, radius: 6, hazeR: 0.8, h: 0.7, haze: 0.7, color: [1, 0.5, 0.18] });
    vfx.decal(pos, 1.3 * s, 'scorch', { rot: rng() * 6, fade: 1 });
    return handle(e1, e2, e3, fl);
  },

  /** Burning fuel spill: irregular lobed pool of tall tongues under a black column. opts {radius, dur} */
  fuel_pool_fire(vfx, pos, o, rng) {
    const R = o.radius ?? 2, dur = o.dur ?? 20, fadeT = Math.min(3, dur * 0.3);
    const lobes = Array.from({ length: 5 }, () => [rr(rng, -0.8, 0.8) * R, rr(rng, -0.8, 0.8) * R, rr(rng, 0.3, 0.65) * R]);
    const sampler = (r) => { const L = lobes[(r() * lobes.length) | 0], a = r() * 6.283, q = Math.sqrt(r()) * L[2]; return [L[0] * 0.8 + Math.cos(a) * q, L[1] * 0.8 + Math.sin(a) * q]; };
    const fade = (a) => Math.min(1, a / 0.3) * (a < dur - fadeT ? 1 : Math.max(0, (dur - a) / fadeT));
    const k = Math.sqrt(R / 2);
    const e1 = vfx.addEmitter({ dur, rate: (a) => 40 * R * fade(a), fn: () => flames(vfx, pos, rng, { sampler, size: 1.0 * k, tall: 1.2, tmin: 1650, tmax: 2100 }) });
    const e2 = vfx.addEmitter({ dur, rate: (a) => 7 * R * fade(a), fn: () => flames(vfx, pos, rng, { sampler, size: 1.7 * k, tall: 1.25, tmin: 1700, tmax: 2050, puffFrac: 0.4, lifeK: 1.2 }) });
    const e3 = smokeColumn(vfx, pos.clone().setY(pos.y + 2.2 * k), rng, { dur, rate: 2.2 * R * (o.smokeK ?? 1), decay: 1e9, fade, spread: 0.4 * R, s0: 1.5 * k, s1: 7.5 * k, lmin: 10, lmax: 16, buoy: 2.8, vy: 3.5, temp: 1000, cool: 0.5 });
    const e4 = vfx.addEmitter({ dur, rate: (a) => 3 * R * fade(a), fn: () => embers(vfx, pos, rng, 1, 0.7 * R) });
    const fl = fireLightAndHaze(vfx, pos, rng, { intensity: 60 * R, dur, radius: 5 * R, fade, hazeR: 1.5 * R, haze: 1.3 });
    for (const L of lobes) vfx.decal(V3(pos.x + L[0] * 0.8, 0, pos.z + L[1] * 0.8), L[2] * 2.6, 'fuel', { rot: rng() * 6, fade: 2 });
    return handle(e1, e2, e3, e4, fl);
  },

  /** Generic persistent smoke column. opts {color:'black'|'grey'|'white'|[r,g,b], rate, dur, scale} */
  smoke_column(vfx, pos, o, rng) {
    const s = o.scale ?? 1, col = Array.isArray(o.color) ? o.color : ({ black: SOOT, grey: GREY, white: WOOD }[o.color || 'black']);
    return handle(smokeColumn(vfx, pos, rng, { dur: o.dur ?? 1e6, rate: (o.rate ?? 4) * s, decay: 1e9, spread: 0.6 * s, s0: 1.6 * s, s1: 9 * s, col, op: o.op ?? 0.85, buoy: 2.4, vy: 3.2, ambient: !!o.ambient }));
  },

  /** E4 chimney / wood smoke — AMBIENT by default (own pool; the FxPass composite caps its perceived change and keeps
   *  it faint over units and shown cones). A thin, continuous plume anchored on the stack: many small light bluish-grey
   *  wisps leave the stack at 1–2 m/s, rise on their buoyancy, then bend over with the world wind (mean uWind + the
   *  WindField gust fronts in the shader). They overlap densely near the stack (the plume is densest just above it),
   *  stretch along their motion, meander together in one coherent curl field and tear (wisp atlas cells, erosion
   *  growing with age), then dilute (expand + fade) within ~6–10 m. In wind the plume lies flatter, stays narrower and
   *  dissipates sooner, as real wood smoke mixes faster.
   *  opts {rate, activity (0 off .. ~1.6 busy), vary (slow draught/stoking modulation, default on), op, col, s1, scale,
   *  dur, ambient (default true)} */
  chimney_smoke(vfx, pos, o, rng) {
    const col = o.col ?? WOOD, s = o.scale ?? 1, act = o.activity ?? 1, ph = rng() * 400, amb = o.ambient !== false;
    if (!(act > 0)) return null;
    // activity mostly scales the density (a faint stove still makes a continuous thread, not separate puffs)
    const base = (o.rate ?? 32) * Math.min(1.25, 0.55 + 0.45 * act), s1 = o.s1 ?? 0.85, op = (o.op ?? 0.5) * Math.min(1.2, act ** 0.6);
    // slow variation (stove draught, periods ~60–140 s) + an occasional short burst when fuel is added
    const rate = o.vary === false ? base : (a) => { const t = a + ph;
      return base * Math.max(0.55, 0.82 + 0.12 * Math.sin(t * 0.045) + 0.08 * Math.sin(t * 0.107 + 1.3) + 0.45 * Math.max(0, Math.sin(t * 0.019)) ** 16); };
    return vfx.addEmitter({ ambient: amb, dur: o.dur ?? 1e6, rate, fn: () => {
      const w = vfx.u.uWind.value, ws = Math.hypot(w.x, w.z), calm = 1 / (1 + 0.22 * ws);
      const c = mixCol(col, rng, 0.08);
      vfx.emit({ ambient: amb, aux: 1, x: pos.x + rr(rng, -0.05, 0.05) * s, y: pos.y + 0.04 + rr(rng, 0, 0.12) * s, z: pos.z + rr(rng, -0.05, 0.05) * s,
        vx: rr(rng, -0.05, 0.05) + w.x * 0.3, vy: rr(rng, 1.3, 1.6) * s, vz: rr(rng, -0.05, 0.05) + w.z * 0.3,
        life: rr(rng, 5, 7) * (0.45 + 0.55 * calm), s0: rr(rng, 0.3, 0.38) * s, s1: rr(rng, 0.8, 1.15) * s1 * s * (1.2 - 0.2 * calm),
        drag: 0.85, buoy: rr(rng, 0.92, 1.08), ...c, op: Math.min(0.9, rr(rng, 0.75, 1) * op * Math.min(1.45, 1 + 0.07 * ws)), noise: rr(rng, 0.25, 0.4), rot: rr(rng, -0.3, 0.3),
        mode: MODE.SMOKE, wind: rr(rng, 0.95, 1.02), seed: rng(), shape: 1, erode: 0.16, stretch: 0.6, fin: 0.12 });
    } });
  },

  /** Small single smoke puff (rifle smoke, impact smoke). opts {dir, size, col} */
  smoke_puff(vfx, pos, o, rng) {
    const dir = (o.dir ?? V3(0, 0.3, 0)).clone(), s = o.size ?? 1;
    for (let i = 0; i < vfx.n(5); i++) {
      const sp = rr(rng, 0.5, 3.5) * s, c = mixCol(o.col ?? [0.6, 0.6, 0.6], rng, 0.1);
      vfx.emit({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * sp + rr(rng, -0.3, 0.3), vy: dir.y * sp + rr(rng, 0, 0.5), vz: dir.z * sp + rr(rng, -0.3, 0.3),
        life: rr(rng, 1.5, 3), s0: 0.15 * s, s1: rr(rng, 0.6, 1.1) * s, drag: 3, buoy: 0.35, ...c, op: 0.3, noise: 0.3, rot: rr(rng, -1, 1),
        mode: MODE.SMOKE, wind: 1, seed: rng(), shape: 1, erode: 0.25, stretch: 0.15, fin: 0.03 });
    }
  },

  /** Step 4w: powder snow shaken off a conifer branch by a gust — a loose white cloud that drifts downwind and
   *  settles. opts {y (release height), wind {x, z} m/s, size} */
  snow_puff(vfx, pos, o, rng) {
    const s = o.size ?? 1, wx = o.wind?.x ?? 0, wz = o.wind?.z ?? 0;
    for (let i = 0; i < vfx.n(7); i++) {
      const c = mixCol([0.9, 0.93, 0.97], rng, 0.06);
      vfx.emit({ x: pos.x + rr(rng, -0.6, 0.6) * s, y: pos.y + rr(rng, -0.4, 0.4) * s, z: pos.z + rr(rng, -0.6, 0.6) * s,
        vx: wx * 0.35 + rr(rng, -0.5, 0.5), vy: rr(rng, -1.2, 0.2), vz: wz * 0.35 + rr(rng, -0.5, 0.5),
        life: rr(rng, 1.8, 3.4), s0: 0.25 * s, s1: rr(rng, 1.0, 1.8) * s, drag: 1.4, buoy: -0.45, ...c, op: 0.34, noise: 0.5, rot: rr(rng, -1, 1),
        mode: MODE.SMOKE, wind: 1, seed: rng(), shape: 1, erode: 0.3, stretch: 0.1, fin: 0.05 });
    }
  },

  /** Step 4w: one slice of a desert dust devil — sand dust whirled round the vortex and lifted (call ~10×/s).
   *  opts {strength 0..1, radius m, surface} */
  dust_devil(vfx, pos, o, rng) {
    const S = surf(o), k = o.strength ?? 1, R = o.radius ?? 3;
    for (let i = 0; i < vfx.n(5); i++) {
      const a = rng() * 6.2832, r = R * rr(rng, 0.2, 0.9), sp = (5 + 7 * k) * rr(rng, 0.7, 1.1), c = mixCol(S.dust, rng, 0.15);
      vfx.emit({ x: pos.x + Math.cos(a) * r, y: pos.y + rr(rng, 0.1, 1.2) + rng() * rng() * 5 * k, z: pos.z + Math.sin(a) * r,
        vx: -Math.sin(a) * sp, vy: rr(rng, 1.5, 4.5) * k, vz: Math.cos(a) * sp,
        life: rr(rng, 1.6, 3.2), s0: 0.5, s1: rr(rng, 1.6, 3.0) * (0.6 + 0.4 * k), drag: 0.9, buoy: 0.6, ...c, op: 0.38 * (0.4 + 0.6 * k), noise: 0.9,
        rot: rr(rng, -2, 2), mode: MODE.SMOKE, wind: 1, seed: rng(), shape: 1, erode: 0.2, stretch: 0.25, fin: 0.1 });
    }
  },

  /** E5 muzzle flash: 2-3 frame HDR star (forward petal 0.6-1 m + 3 side petals) aligned to the
   *  barrel, 1-frame light pool, small smoke puff, 260 m/s tracer. opts {dir, to, weapon, tracer} */
  muzzle_flash(vfx, pos, o, rng) {
    const dir = (o.dir ?? (o.to ? V3(o.to.x - pos.x, (o.to.y ?? pos.y) - pos.y, o.to.z - pos.z) : V3(1, 0, 0))).clone().normalize();
    const W = { pistol: 0.65, rifle: 1, smg: 0.75, mg: 1.1, sniper: 1.05, cannon: 3 }[o.weapon || 'rifle'] ?? 1;
    const side1 = V3(0, 1, 0).cross(dir); if (side1.lengthSq() < 1e-4) side1.set(1, 0, 0); side1.normalize();
    const side2 = dir.clone().cross(side1).normalize();
    const life = 0.045, rot = rng() * 6.283;
    const petal = (d, w, len, minW, minL, op) => vfx.emit({ hot: true, x: pos.x, y: pos.y, z: pos.z, vx: d.x, vy: d.y, vz: d.z, drag: 400, life,
      s0: w, s1: w * 0.9, stretch: len / w, mode: HOT.MUZZLE, op, seed: rng(), shape: minW, erode: minL });
    petal(dir, 0.26 * W, rr(rng, 0.65, 0.95) * W, 7, 28, 1);
    for (let i = 0; i < 3; i++) {
      const a = rot + i * 2.094 + rr(rng, -0.3, 0.3);
      const d = side1.clone().multiplyScalar(Math.cos(a)).addScaledVector(side2, Math.sin(a)).addScaledVector(dir, 0.35).normalize();
      petal(d, 0.13 * W, rr(rng, 0.26, 0.38) * W, 4, 12, 0.85);
    }
    flash(vfx, pos.clone().addScaledVector(dir, 0.12), 0.5 * W, [7, 4.6, 2], 0.045, 14);
    light(vfx, pos.clone().addScaledVector(dir, 0.4).setY(pos.y + 0.4), [1, 0.72, 0.42], 7 * W, 0.02, () => 45 * W);
    RECIPES.smoke_puff(vfx, pos.clone().addScaledVector(dir, 0.3), { dir: dir.clone().multiplyScalar(0.8).setY(0.25), size: 0.8 * W, col: [0.62, 0.62, 0.62] }, rng);
    if (o.tracer !== false && o.weapon !== 'pistol') RECIPES.tracer(vfx, pos.clone().addScaledVector(dir, 0.5), { dir, to: o.to, range: o.range }, rng);
  },

  /** Tracer round at 260 m/s from pos towards opts.to (or dir*range). */
  tracer(vfx, pos, o, rng) {
    const to = o.to ? V3(o.to.x, o.to.y ?? pos.y, o.to.z) : pos.clone().addScaledVector((o.dir ?? V3(1, 0, 0)).clone().normalize(), o.range ?? 60);
    const d = to.clone().sub(pos), dist = d.length(); if (dist < 0.5) return;
    d.divideScalar(dist); const sp = o.speed ?? 260;
    vfx.emit({ hot: true, x: pos.x, y: pos.y, z: pos.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, drag: 0.001, buoy: 0, life: dist / sp,
      s0: 0.06, s1: 0.06, temp: o.temp ?? 2300, cool: 1e3, mode: HOT.TRACER, stretch: o.length ?? 6, wind: 0, seed: rng(), op: 1.6, shape: 2.5 });
  },

  /** Bullet impact on the ground: small dirt spurt + dust wisp. opts {surface, dir} */
  dust_kick(vfx, pos, o, rng) {
    const S = surf(o), n = vfx.n(6);
    for (let i = 0; i < n; i++) {
      const d = sph(rng); d.y = Math.abs(d.y) * 2.5 + 1; d.normalize(); const sp = rr(rng, 3, 7), c = mixCol(S.clod, rng, 0.25);
      vfx.emit({ x: pos.x, y: pos.y + 0.05, z: pos.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, life: rr(rng, 0.4, 0.8), s0: 0.12, s1: 0.35,
        drag: 0.8, buoy: -9, ...c, op: 0.9, mode: MODE.SMOKE, wind: 0.1, seed: rng(), shape: 1, erode: 0.15, stretch: 0.12, fin: 0.01 });
    }
    smokePuffs(vfx, pos, rng, vfx.n(3), { col: S.dust, spread: 0.1, lat: 0.6, vmin: 0.5, vmax: 1.5, vy: 0.8, s0: 0.35, s1: 1.8, lmin: 1.2, lmax: 2.4, buoy: 0.3, drag: 2.5, op: 0.7, wisp: 1, erode: 0.2, fin: 0.03 });
  },

  /** Persistent dust trail behind a moving vehicle. opts {target:Object3D, surface, width}. rate scales with speed. */
  vehicle_dust_trail(vfx, pos, o, rng) {
    const S = surf(o), tgt = o.target, last = (tgt ? tgt.position : pos).clone(), w = o.width ?? 1.8;
    return handle(vfx.addEmitter({ dur: o.dur ?? 1e6, rate: 0, fn: () => {}, tick: (a, dt, e) => {
      const p = tgt ? tgt.position : pos, v = p.distanceTo(last) / dt; last.copy(p);
      e.acc2 = (e.acc2 || 0) + dt * Math.min(v, 20) * 1.1 * vfx.quality.density;
      while (e.acc2 >= 1) { e.acc2 -= 1; const side = rng() < 0.5 ? -1 : 1, c = mixCol(S.dust, rng, 0.15);
        vfx.emit({ x: p.x + rr(rng, -0.5, 0.5) * w + side * 0.2, y: vfx.groundHeight(p.x, p.z) + 0.3, z: p.z + rr(rng, -0.5, 0.5) * w, vx: rr(rng, -0.6, 0.6), vy: rr(rng, 0.4, 1.2), vz: rr(rng, -0.6, 0.6),
          life: rr(rng, 3, 5.5), s0: 0.8, s1: rr(rng, 3, 5), drag: 1.2, buoy: 0.25, ...c, op: 0.32, noise: 0.8, rot: rr(rng, -0.3, 0.3), mode: MODE.SMOKE, wind: 1, seed: rng(), shape: 1, erode: 0.18, fin: 0.3 }); }
    } }));
  },

  /** Wet mud clumps (vehicle wheels in mud, shell in mud). opts {dir, scale} */
  mud_spray(vfx, pos, o, rng) {
    const s = o.scale ?? 1, dir = o.dir ? o.dir.clone().normalize() : null, n = vfx.n(Math.round(22 * s));
    for (let i = 0; i < n; i++) {
      const d = dir ? dir.clone().add(sph(rng).multiplyScalar(0.5)).normalize() : sph(rng); d.y = Math.abs(d.y) + 0.8; d.normalize();
      const sp = rr(rng, 3, 9) * Math.sqrt(s), c = mixCol(SURFACE.mud.clod, rng, 0.3);
      vfx.emit({ x: pos.x, y: pos.y + 0.1, z: pos.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, life: rr(rng, 0.7, 1.3), s0: rr(rng, 0.1, 0.2) * s, s1: rr(rng, 0.25, 0.45) * s,
        drag: 0.4, buoy: -9.8, ...c, op: 1, mode: MODE.SMOKE, wind: 0, seed: rng(), shape: 0, erode: 0.25, stretch: 0.06, fin: 0.01 });
    }
    chunks(vfx, pos, rng, Math.round(8 * s), { vmin: 3, vmax: 8, smin: 0.05, smax: 0.12, colors: [SURFACE.mud.clod] });
  },

  /** Water splash: white spray column + falling droplets + foam ring. opts {scale} (1 = grenade/shell, 0.2 = bullet) */
  water_splash(vfx, pos, o, rng) {
    const s = o.scale ?? 1, n = vfx.n(Math.round(60 * s + 6));
    for (let i = 0; i < n; i++) {
      const a = rng() * 6.283, tilt = rr(rng, 0, 0.35), sp = rr(rng, 5, 14) * Math.sqrt(s) * (1 - 0.5 * rng());
      const c = mixCol([0.82, 0.86, 0.88], rng, 0.08);
      vfx.emit({ x: pos.x, y: pos.y + 0.05, z: pos.z, vx: Math.cos(a) * Math.sin(tilt) * sp, vy: Math.cos(tilt) * sp, vz: Math.sin(a) * Math.sin(tilt) * sp,
        life: rr(rng, 0.9, 1.8) * Math.sqrt(s + 0.1), s0: rr(rng, 0.12, 0.25) * s + 0.04, s1: rr(rng, 0.35, 0.8) * s + 0.08, drag: 0.7, buoy: -9.8, ...c, op: 0.85,
        mode: MODE.SMOKE, wind: 0.3, seed: rng(), shape: 1, erode: 0.1, stretch: 0.22, fin: 0.01 });
    }
    smokePuffs(vfx, pos, rng, vfx.n(Math.round(7 * s + 2)), { col: [0.8, 0.84, 0.86], spread: 0.5 * s, lat: 1, vmin: 1, vmax: 3 * s, vy: 0.2, s0: 0.4 * s, s1: 2.0 * s, lmin: 1.2, lmax: 2.4, buoy: 0.1, drag: 2.2, op: 0.32, wisp: 1, erode: 0.25 });
    if (s >= 0.5) flash(vfx, pos.clone().setY(pos.y + 0.5), 2.5 * s, [8, 5.5, 3], 0.05, 16);
  },

  /** Blood puff on a hit: small dark-red mist + droplets + decal (muted, as in the 1998 original). */
  blood_puff(vfx, pos, o, rng) {
    const dir = (o.dir ?? V3(0, 0, 0)).clone();
    for (let i = 0; i < vfx.n(8); i++) {
      const d = sph(rng).multiplyScalar(0.8).add(dir).normalize(); const sp = rr(rng, 1.5, 4);
      vfx.emit({ x: pos.x, y: pos.y, z: pos.z, vx: d.x * sp, vy: d.y * sp + 1, vz: d.z * sp, life: rr(rng, 0.35, 0.7), s0: 0.07, s1: 0.14, drag: 0.5, buoy: -9.8,
        r: 0.16, g: 0.012, b: 0.01, op: 1, mode: MODE.SMOKE, wind: 0, seed: rng(), shape: 0, erode: 0.2, stretch: 0.08, fin: 0.01 });
    }
    smokePuffs(vfx, pos, rng, vfx.n(3), { col: [0.22, 0.03, 0.025], spread: 0.08, vmin: 0.3, vmax: 1.2, vy: 0.2, s0: 0.25, s1: 0.95, lmin: 0.4, lmax: 0.8, buoy: -0.5, drag: 3, op: 0.7, wisp: 1, erode: 0.25, fin: 0.02 });
    if (o.decal !== false) vfx.at(0.4, () => vfx.decal(pos, rr(rng, 0.5, 0.9), 'blood', { rot: rng() * 6, fade: 0.6, opacity: 0.8 }));
  },

  /** Blood in water (bodies-design §B.3): a faint dark-red cloud dispersing at the surface, drifting (~12 s). opts {scale, dur} */
  blood_cloud(vfx, pos, o, rng) {
    const s = o.scale ?? 1, L = o.dur ?? 12;
    smokePuffs(vfx, pos, rng, vfx.n(Math.round(5 * s + 3)), { col: [0.26, 0.03, 0.028], spread: 0.25 * s, ySpread: 0.02, lat: 1, vmin: 0.04, vmax: 0.22, vy: 0,
      s0: 0.35 * s, s1: 1.8 * s, lmin: L * 0.6, lmax: L, buoy: 0, drag: 1.2, op: 0.3, wisp: 1, erode: 0.35, wind: 0.15, fin: 0.1 });
  },

  /** Metal impact / ricochet sparks. opts {dir} */
  sparks(vfx, pos, o, rng) {
    sparks(vfx, pos, rng, o.count ?? 18, { dir: o.dir, cone: 0.9, vmin: 4, vmax: 14, lmin: 0.15, lmax: 0.5, size: 0.03, tmin: 2200, tmax: 3000 });
    flash(vfx, pos, 0.35, [10, 8, 5], 0.04, 10);
    RECIPES.smoke_puff(vfx, pos, { size: 0.4, col: [0.4, 0.4, 0.4] }, rng);
  },

  /** E6 HERO: 200-L fuel drum rupture (chain reactions via vfx.addExplosive). opts {scale, color, poolDur, chainRadius} */
  barrel_explosion(vfx, pos, o, rng) {
    const s = o.scale ?? 1, up = (h) => pos.clone().add(V3(0, h, 0));
    const chain = !!o.chainFrom, ck = chain ? 0.6 : 1;
    flash(vfx, up(0.8 * s), 4.5 * s, [7, 3.6, 1.3], 0.09);
    light(vfx, up(2 * s), [1, 0.45, 0.12], 22 * s, 12, (a) => 260 * s * Math.exp(-a * 8) + 110 * s * Math.exp(-a * 0.7) * flick(a, 1.7));
    // fuel fireball: cooler (sootier, deeper orange) than HE, strong buoyancy -> rolling mushroom
    fireball(vfx, pos, rng, { scale: s * 1.3, n: 56 * ck, speed: 12, upBias: 0.9, tmin: 1700, tmax: 2300, buoyK: 2.0, dragK: 0.95, coolK: 1.5, lmin: 1.8, lmax: 3.2 });
    vfx.at(0.12, () => fireball(vfx, up(2 * s), rng, { scale: s * 1.0, n: 34, speed: 5, upBias: 2, tmin: 1800, tmax: 2200, buoyK: 2.3, coolK: 1.4, lifeK: 1.2 }));
    vfx.at(0.3, () => fireball(vfx, up(4 * s), rng, { scale: s * 0.8, n: 24, speed: 3.5, upBias: 3, tmin: 1600, tmax: 2000, buoyK: 2.8, coolK: 1.2, lifeK: 1.3 }));
    // black smoke rolling off the top: narrow, buoyant, then the pool-fed column
    if (!chain) vfx.at(0.45, () => smokePuffs(vfx, up(6.5 * s), rng, vfx.n(10), { spread: 1.1 * s, lat: 0.3, vmin: 0.5, vmax: 2, vy: 4.5, s0: 2.4 * s, s1: 7 * s, lmin: 7, lmax: 12, buoy: 3.2, temp: 1100, cool: 0.5, wisp: 0.25 }));
    // torn shell + lid launched, tumbling, landing and smouldering
    const paint = new THREE.Color(o.color ?? 0x3f4a2a);
    const mkMat = () => new THREE.MeshStandardMaterial({ color: paint, roughness: 0.55, metalness: 0.6, side: THREE.DoubleSide, emissive: new THREE.Color(1, 0.3, 0.05), emissiveIntensity: 0 });
    const shellMat = mkMat(), lidMat = mkMat();
    const shell = new THREE.Mesh(tornShellGeometry(rng, 0.29 * s, 0.88 * s), shellMat);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.29 * s, 0.29 * s, 0.03 * s, 22), lidMat);
    const hd = V3(rr(rng, -1, 1), 0, rr(rng, -1, 1)).normalize();
    vfx.debris.addHero(lid, { pos: up(0.9 * s), vel: V3(hd.x * rr(rng, 1, 4), rr(rng, 16, 24) * Math.sqrt(s), hd.z * rr(rng, 1, 4)),
      spin: V3(rr(rng, 6, 14), rr(rng, -3, 3), rr(rng, 4, 10)), radius: 0.03 * s, burnTime: 4, trail: 1 });
    vfx.debris.addHero(shell, { pos: up(0.45 * s), vel: V3(-hd.x * rr(rng, 3, 7), rr(rng, 7, 12) * Math.sqrt(s), -hd.z * rr(rng, 3, 7)),
      spin: V3(rr(rng, -8, 8), rr(rng, -4, 4), rr(rng, 3, 9)), radius: 0.3 * s, burnTime: rr(rng, 7, 11), trail: 1 });
    vfx.addEmitter({ dur: 14, rate: 0, noScale: true, fn: () => {}, tick: (a) => { const g = 1.4 * Math.exp(-a / 1.6); shellMat.emissiveIntensity = a > 13.9 ? 0 : g; lidMat.emissiveIntensity = a > 13.9 ? 0 : g * 0.6; } });
    chunks(vfx, pos, rng, Math.round(14 * s), { vmin: 5, vmax: 16, smin: 0.06, smax: 0.18, trail: 0.4, burn: 0.3, colors: [[0.24, 0.28, 0.16], [0.12, 0.1, 0.08]] });
    // burning fuel spill
    const poolDur = o.poolDur ?? 10;
    vfx.at(0.15, () => RECIPES.fuel_pool_fire(vfx, pos, { radius: (chain ? 1.1 : 1.5) * s, dur: poolDur, smokeK: ck }, rng));
    vfx.decal(pos, 5 * s, 'scorch', { rot: rng() * 6 });
    sparks(vfx, up(0.6 * s), rng, Math.round(110 * s * ck), { vmin: 8, vmax: 26, tmin: 1800, tmax: 2500 });
    embers(vfx, up(2 * s), rng, Math.round(50 * s), 1.5 * s, { lmin: 3, lmax: 7 });
    shockwave(vfx, pos, rng, 11 * s, Math.round(26 * s), 0.8 * s, surf(o).dust);
    vfx.heatSource({ pos: up(3 * s), radius: 4 * s, dur: 4, strength: 1.5, fn: (a) => Math.exp(-a) });
    vfx.addShake(0.6 * s);
    vfx.blast(pos, (o.chainRadius ?? 7) * s, rng);
  },

  /** E6b: Opel Blitz fuel tanker (~3,000 L). Sequential ruptures along the tank + big spill + burning wreck. opts {yaw, dur} */
  tanker_explosion(vfx, pos, o, rng) {
    const yaw = o.yaw ?? 0, ax = V3(Math.sin(yaw), 0, Math.cos(yaw));
    RECIPES.explosion_large(vfx, pos.clone().setY(pos.y + 1.5), { scale: 1.2, dur: 20, surface: o.surface }, rng);
    [-1.6, 0, 1.6].forEach((k, i) => vfx.at(0.18 + i * 0.22, () => RECIPES.barrel_explosion(vfx, pos.clone().addScaledVector(ax, k), { scale: 1.7, poolDur: 16, color: 0x39402a, chainRadius: 10 }, rng)));
    vfx.at(1.5, () => RECIPES.burning_wreck(vfx, pos, { size: [2.3, 6], dur: o.dur ?? 60, h: 1.4, yaw }, rng));
  },

  /** Debris smoke trails in flight; smouldering fire+smoke once resting. */
  _trail(vfx, it, dt, resting) {
    it.acc = (it.acc || 0) + dt * (resting ? 4 : 30) * vfx.quality.density;
    const rng = vfx._trailRng || (vfx._trailRng = vfx.rand(424242));
    while (it.acc >= 1) {
      it.acc -= 1;
      const p = it.p, burning = it.burn > it.age;
      if (resting) {
        if (rng() < 0.7) vfx.emit({ x: p.x + rr(rng, -0.15, 0.15), y: p.y, z: p.z + rr(rng, -0.15, 0.15), vy: rr(rng, 0.2, 0.5), life: rr(rng, 0.4, 0.8), s0: 0.18, s1: 0.32,
          drag: 2, buoy: 1.5, r: 0, g: 0, b: 0, op: 0.9, temp: rr(rng, 1600, 1950), cool: 1e3, mode: MODE.FLAME, wind: 0.8, seed: rng(), aux: 2.2, fin: 0.1 });
        else vfx.emit({ x: p.x, y: p.y + 0.4, z: p.z, vy: 1, life: rr(rng, 4, 7), s0: 0.4, s1: 2.6, drag: 0.6, buoy: 1.4, ...mixCol(SOOT, rng), op: 0.5, noise: 1, mode: MODE.SMOKE, wind: 1, seed: rng(), shape: 1, erode: 0.15 });
      } else {
        const hot = burning && it.age < 1.5;
        vfx.emit({ x: p.x, y: p.y, z: p.z, vx: it.v.x * 0.05, vy: it.v.y * 0.05, vz: it.v.z * 0.05, life: rr(rng, 1.5, 3), s0: 0.3, s1: rr(rng, 1.4, 2.4), drag: 1.2, buoy: 0.8,
          ...mixCol(hot ? SOOT : GREY.map((c) => c * 0.5), rng), op: 0.35, temp: hot ? rr(rng, 1500, 2000) : 0, cool: 0.2, noise: 0.4, mode: hot ? MODE.FIRE : MODE.SMOKE, wind: 1, seed: rng(), shape: 1, erode: 0.12, stretch: 0.05 });
      }
    }
  },
};

/** Legacy / prototype names -> canonical kinds. */
export const ALIASES = {
  large: 'explosion_large', E1: 'explosion_large', bigExplosion: 'explosion_large', bomb: 'explosion_large', explosion: 'explosion_large',
  shell: 'explosion_small', mortar: 'explosion_small', E2: 'grenade', barrel: 'barrel_explosion', E6: 'barrel_explosion', tanker: 'tanker_explosion',
  wreck: 'burning_wreck', E3: 'burning_wreck', campfire: 'fire_small', fire: 'fire_small', pool: 'fuel_pool_fire', chimney: 'chimney_smoke', E4: 'chimney_smoke',
  smoke: 'smoke_column', rifleSmoke: 'smoke_puff', muzzle: 'muzzle_flash', E5: 'muzzle_flash', dust: 'dust_kick', mud: 'mud_spray', splash: 'water_splash', blood: 'blood_puff',
};
