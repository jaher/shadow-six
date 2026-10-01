/**
 * Gate smash VFX recipes (design-spec §3.7 ramming addendum), spawned with `spawnGateFx(world.fx, kind, x, z, opts)`
 * like the library's own effects (deterministic seeded RNG per spawn, counts through the quality budget).
 *   gate_splinters   wood splinters (stretched streaks) + chips thrown along the travel direction, a surface puff
 *                    (snow powder / dust / sand by the ground under the gate) and a low skirt at the base
 *   gate_snow_clumps snow lumps sliding off the top rail and bursting into powder on the ground
 *   gate_thud        a small puff where a heavy piece lands
 * @module render/gate-smash-fx
 */

import { SURFACE, chunks, smokePuffs, dustRing } from './vfx/effects.js';
import { MODE } from './vfx/pool.js';

const rr = (rng, a, b) => a + (b - a) * rng();
const WOODS = [[0.46, 0.36, 0.25], [0.38, 0.29, 0.2], [0.55, 0.45, 0.32], [0.3, 0.24, 0.17]];
const surf = (o) => SURFACE[o.surface] || SURFACE.dirt;

export const GATE_RECIPES = {
  /** opts {dir:{x,z}, speed, scale, y, metal} */
  gate_splinters(vfx, pos, o, rng) {
    const s = o.scale ?? 1, dir = o.dir || { x: 1, z: 0 }, sp0 = Math.max(3, o.speed ?? 8), S = surf(o);
    const side = { x: -dir.z, z: dir.x }, y = pos.y + (o.y ?? 0.8);
    const n = vfx.n(Math.round(46 * s));
    for (let i = 0; i < n; i++) {
      const f = rr(rng, 0.35, 1.5), lat = rr(rng, -1, 1) * 4.5, up = rr(rng, 0.5, 5.5), c = o.metal ? [0.3, 0.31, 0.3] : WOODS[(rng() * WOODS.length) | 0];
      const k = rr(rng, 0.8, 1.15);
      vfx.emit({ x: pos.x + side.x * rr(rng, -1.2, 1.2), y: y + rr(rng, -0.35, 0.6), z: pos.z + side.z * rr(rng, -1.2, 1.2),
        vx: dir.x * sp0 * f + side.x * lat, vy: up, vz: dir.z * sp0 * f + side.z * lat,
        life: rr(rng, 0.7, 1.6), s0: rr(rng, 0.035, 0.08), s1: rr(rng, 0.03, 0.06), drag: 0.25, buoy: -9.8,
        r: c[0] * k, g: c[1] * k, b: c[2] * k, op: 1, mode: MODE.SMOKE, wind: 0, seed: rng(), shape: 0, erode: 0.05, stretch: rr(rng, 0.06, 0.14), fin: 0.02 });
    }
    chunks(vfx, { x: pos.x, y: y - 0.6, z: pos.z }, rng, Math.round(12 * s), { vmin: 2.5, vmax: 7, upBias: 0.7, smin: 0.04, smax: 0.11, colors: o.metal ? [[0.25, 0.25, 0.24]] : WOODS });
    // the ground at the base: snow powder / dust thrown up by the leaves and the bumper
    const base = { x: pos.x + dir.x * 0.6, y: pos.y, z: pos.z + dir.z * 0.6 };
    smokePuffs(vfx, base, rng, vfx.n(Math.round(9 * s)), { col: S.dust, spread: 1.1, lat: 1.4, vmin: 1.5, vmax: 4, vy: 1.2, s0: 0.6, s1: 3.2, lmin: 1.6, lmax: 3.2, buoy: 0.25, drag: 1.8, op: 0.75, wisp: 0.6, erode: 0.18, fin: 0.1 });
    dustRing(vfx, base, rng, Math.round(12 * s), { vmin: 2.5, vmax: 6, r0: 0.6, s0: 0.5, s1: 2.4, lmin: 1.4, lmax: 2.8, col: S.dust, op: 0.45, drag: 2.2 });
  },

  /** opts {tx, tz, w (m, along the gate), top (m)} */
  gate_snow_clumps(vfx, pos, o, rng) {
    const n = vfx.n(Math.round((o.w ?? 4) * 7)), top = o.top ?? 2.1, S = SURFACE.snow;
    for (let i = 0; i < n; i++) {
      const u = rr(rng, -0.5, 0.5) * (o.w ?? 4), sz = rr(rng, 0.13, 0.3), c = S.clod;
      vfx.emit({ x: pos.x + (o.tx ?? 1) * u, y: pos.y + top + rr(rng, 0, 0.15), z: pos.z + (o.tz ?? 0) * u,
        vx: rr(rng, -0.8, 0.8) + (o.dx ?? 0) * rr(rng, 0.5, 2.5), vy: rr(rng, 0, 1.6), vz: rr(rng, -0.8, 0.8) + (o.dz ?? 0) * rr(rng, 0.5, 2.5),
        life: rr(rng, 0.9, 1.5), s0: sz, s1: sz * 1.8, drag: 0.5, buoy: -9.8, r: c[0], g: c[1], b: c[2], op: 1, mode: MODE.SMOKE, wind: 0.1,
        seed: rng(), shape: 0, erode: 0.3, stretch: 0.02, fin: 0.05 });
    }
    // a few solid lumps that tumble down and burst on the ground
    for (const f of [-0.3, 0, 0.3]) {
      const u = f * (o.w ?? 4);
      chunks(vfx, { x: pos.x + (o.tx ?? 1) * u, y: pos.y + top - 0.5, z: pos.z + (o.tz ?? 0) * u }, rng, Math.round((o.w ?? 4) * 0.8), { vmin: 0.5, vmax: 2.2, upBias: 0.4, smin: 0.06, smax: 0.13, colors: [S.clod] });
    }
    // powder veil as they fall
    smokePuffs(vfx, { x: pos.x, y: pos.y + top * 0.6, z: pos.z }, rng, vfx.n(6), { col: S.dust, spread: (o.w ?? 4) * 0.35, lat: 0.8, vmin: 0.2, vmax: 1, vy: -0.4, s0: 0.5, s1: 2.2, lmin: 1.2, lmax: 2.4, buoy: -0.3, drag: 2, op: 0.5, wisp: 1, erode: 0.2, fin: 0.1 });
  },

  /** opts {v (landing speed), heavy} */
  gate_thud(vfx, pos, o, rng) {
    const s = Math.min(1.4, 0.35 + (o.v ?? 3) * 0.12) * (o.heavy ? 1.3 : 1), S = surf(o);
    smokePuffs(vfx, pos, rng, vfx.n(Math.round(4 * s)), { col: S.dust, spread: 0.3, lat: 1.2, vmin: 0.6, vmax: 2, vy: 0.5, s0: 0.3 * s, s1: 1.4 * s, lmin: 0.9, lmax: 1.8, buoy: 0.2, drag: 2.5, op: 0.6, wisp: 1, erode: 0.2, fin: 0.05 });
    if (o.surface === 'snow') chunks(vfx, pos, rng, Math.round(4 * s), { vmin: 1, vmax: 3, upBias: 1, smin: 0.03, smax: 0.07, colors: [S.clod] });
  },
};

/**
 * Spawn a gate recipe through the game FX (render/fx.js): ground height + surface under (x, z), the VFX library's
 * seeded RNG. Kept out of the library's RECIPES table (its shipped kinds are fixed). No-op headless.
 */
export function spawnGateFx(fx, kind, x, z, o = {}) {
  const vfx = fx?.vfx, r = GATE_RECIPES[kind];
  if (!vfx || !r) return null;
  const opts = { surface: fx._surfAt?.(x, z), ...o };
  try { return r(vfx, { x, y: fx._y?.(x, z) ?? 0, z }, opts, vfx.rand(o.seed)) || null; } catch (err) { console.error('[fx] gate', kind, err); return null; }
}
