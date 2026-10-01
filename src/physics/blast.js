/**
 * Blast impulse model (bodies-design §A.3): falloff J(r) = J0·Q·A / (1 + (r/r0)²), wall occlusion from three rays
 * against the STATIC colliders (floor occMin: a wall still passes some diffracted pressure), a lift component and a
 * Δv clamp. Pure functions of the explosion event + the static world: deterministic.
 * @module physics/blast
 */

import { CONFIG } from '../config.js';
import { GROUPS, groundAt } from './statics.js';

/** Deterministic hash → [0, 1) (entity-id keyed randomness; never world.rng / Math.random, §0.2). */
export function hash01(a, b = 0, c = 0) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Normalised blast parameters from an `explosion` event {x, z, radius, kind}.
 * @returns {{x:number, z:number, y:number, cls:string, Q:number, Rk:number, Rb:number, r0:number}}
 */
export function blastParams(world, ev) {
  const B = CONFIG.physics.blast;
  const cls = ev.kind || 'grenade';
  const Rk = Math.max(0.5, ev.radius || 4.5);
  return { x: ev.x, z: ev.z, y: groundAt(world, ev.x, ev.z) + B.rayFrom, cls, Q: B.Q[cls] ?? 1, Rk, Rb: B.reachMul * Rk, r0: B.r0Mul * Rk, t: world.time };
}

/**
 * Fraction of the three rays (target heights rays[]) that reach the target unobstructed by STATIC colliders,
 * floored at occMin. `rw` null (no Rapier) → grid line of sight only.
 */
export function occlusion(rw, R, world, bp, tx, tz, baseY = null) {
  const B = CONFIG.physics.blast;
  const gy = baseY ?? groundAt(world, tx, tz);
  let open = 0;
  for (const h of B.rays) {
    const ty = gy + h;
    const dx = tx - bp.x, dy = ty - bp.y, dz = tz - bp.z, L = Math.hypot(dx, dy, dz);
    if (L < 0.3) { open++; continue; }
    let blocked = false;
    if (rw) {
      const ray = new R.Ray({ x: bp.x, y: bp.y, z: bp.z }, { x: dx / L, y: dy / L, z: dz / L });
      const hit = rw.castRay(ray, L - 0.25, false, undefined, GROUPS.RAY_STATIC);
      blocked = !!hit;
    }
    if (!blocked && h <= 1.0 && world.grid && !world.grid.lineOfSight(bp.x, bp.z, tx, tz, { dynamic: false })) blocked = true;
    if (!blocked) open++;
  }
  return Math.max(open / B.rays.length, B.occMin);
}

/**
 * Impulse on a target of effective area `area` (m²) and `mass` (kg) whose centre is at (tx, ty, tz).
 * @returns {{dir:{x,y,z}, J:number, dv:number, r:number}} dv already clamped to maxDv; J = dv·mass
 */
export function blastImpulse(bp, tx, ty, tz, area, mass, maxDv, occ = 1, id = 0) {
  const B = CONFIG.physics.blast;
  let dx = tx - bp.x, dz = tz - bp.z;
  const r = Math.hypot(dx, dz);
  if (r < 1e-3) { const a = hash01(id, 7) * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); } else { dx /= r; dz /= r; }
  const lift = B.lift * Math.max(0, 1 - r / bp.Rb);
  const n = Math.hypot(dx, lift, dz);
  const dir = { x: dx / n, y: lift / n, z: dz / n };
  if (r > bp.Rb) return { dir, J: 0, dv: 0, r };
  const J = (B.J0 * bp.Q * area / (1 + (r / bp.r0) ** 2)) * occ;
  const dv = Math.min(J / mass, maxDv);
  return { dir, J: dv * mass, dv, r };
}
