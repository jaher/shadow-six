/**
 * Boats at rest on the ground (visual only — the sim never reads any of it).
 *
 * A boat used to float flat at the water level as soon as its centre was over a wet cell, and to stand its waterline
 * on the ground otherwise. A hull half on the bank (the M1 raft on the peninsula's west shore, a raft paddled onto a
 * beach, one inflated by the Marine at the water's edge) therefore had the snow, sand or mud come up through it, and a
 * hull on dry land sank by its draft. Now every boat is posed as a rigid body resting on its supports:
 *
 *  - its UNDERSIDE is sampled once per model (and again for the wreck: the deflated raft) from the drawn mesh: the
 *    lowest vertex in each cell of a grid over its plan (`hullUnderside`): the raft's tube undersides at the bow, the
 *    stern and both sides and the floor between them, a rowboat's keel and bilges, a deflated raft's sheet;
 *  - each sample is supported by the drawn GROUND under it (the terrain mesh's own triangle, art/terrain surfaceAt:
 *    the bank, the beach, the shallow bed) and, where there is water, by the WATER: the height that point has when
 *    the hull floats freely (water level + the gentle bob, pitch and roll of a boat at rest);
 *  - the pose (height, pitch, roll) minimises the height of the hull's centre over those supports: the hull settles
 *    onto the highest supports round its centre, like a table on uneven ground (`restPose`), never through them, and
 *    pitches / rolls to the slope instead of hovering on one point. Afloat it is exactly the old floating pose; half
 *    beached, the land end rests on the shore and the water end floats, with the tilt between.
 *
 * Contacts are stiff springs (gravity sags the hull less than a millimetre into its supports), plus `squash` for the
 * raft's soft tubes, which flatten a few millimetres where they touch. Deep-keeled craft (the patrol / fishing boat,
 * the mini-sub) only rest on ground that stands above the water surface: their keels at a mooring are under water.
 * @module art/boat-rest
 */

import { T } from '../world/grid.js';

/** Light craft that run up a beach and ground on the bed (draft of a few cm): the raft and the rowboat. */
export const BEACHED = new Set(['raft', 'rowboat']);

/** Solver constants: contact stiffness (per unit weight per m), tilt tie-break spring, steepest rest (slope), squash. */
export const REST = Object.freeze({ k: 4000, rho: 0.05, maxTilt: 0.6, iters: 60, squash: { raft: 0.006 } });

/**
 * Underside samples of a hull: the lowest vertex in each cell of a grid over its plan (model space: +x the boat's
 * left, y up from the design waterline, +z the bow) — the hull's lower envelope column by column, so on a steep bank
 * the flank of a round tube is sampled where it meets the ground, not only its bottom. Empty cells give none.
 * @param {Iterable<number[]>} verts model-space [x, y, z] points
 * @param {{cell?: number, max?: number, nx?: number, nz?: number}} [o] cell size (m, default 0.1), grown until at most
 *   `max` cells (default 400) cover the plan; or an explicit nx × nz grid
 * @returns {{x:number, y:number, z:number}[]}
 */
export function hullUnderside(verts, o = {}) {
  const pts = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of verts) { pts.push(p); if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[2] < z0) z0 = p[2]; if (p[2] > z1) z1 = p[2]; }
  if (!pts.length) return [];
  const cell = Math.max(o.cell ?? 0.1, Math.sqrt(((x1 - x0) * (z1 - z0)) / (o.max ?? 400)));
  const nx = o.nx ?? Math.max(1, Math.ceil((x1 - x0) / cell - 1e-9)), nz = o.nz ?? Math.max(1, Math.ceil((z1 - z0) / cell - 1e-9));
  const cx = Math.max(1e-6, (x1 - x0) / nx), cz = Math.max(1e-6, (z1 - z0) / nz), low = new Map();
  for (const p of pts) {
    const i = Math.min(nx - 1, Math.floor((p[0] - x0) / cx)), j = Math.min(nz - 1, Math.floor((p[2] - z0) / cz)), k = j * nx + i;
    const q = low.get(k);
    if (!q || p[1] < q[1]) low.set(k, p);
  }
  return [...low.keys()].sort((a, b) => a - b).map((k) => { const p = low.get(k); return { x: p[0], y: p[1], z: p[2] }; });
}

/**
 * Underside samples from a hull's TRIANGLES (model space, 9 numbers each: a, b, c): like hullUnderside, with every
 * face rasterised at ≤ 0.8 cell so a big flat face (the raft's floor: vertices only round its edge) is sampled across.
 * @param {ArrayLike<number>[]} tris @param {{cell?: number, max?: number}} [o]
 * @returns {{x:number, y:number, z:number}[]}
 */
export function hullUndersideTris(tris, o = {}) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const t of tris) for (let k = 0; k < 9; k += 3) { const x = t[k], z = t[k + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  if (!tris.length) return [];
  const cell = Math.max(o.cell ?? 0.1, Math.sqrt(((x1 - x0) * (z1 - z0)) / (o.max ?? 400))), step = cell * 0.8;
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell - 1e-9)), nz = Math.max(1, Math.ceil((z1 - z0) / cell - 1e-9)), low = new Map();
  const put = (x, y, z) => {
    const i = Math.min(nx - 1, Math.floor((x - x0) / cell)), j = Math.min(nz - 1, Math.floor((z - z0) / cell)), k = j * nx + i, q = low.get(k);
    if (!q) low.set(k, [x, y, z]); else if (y < q[1]) { q[0] = x; q[1] = y; q[2] = z; }
  };
  for (const t of tris) {
    const e = Math.max(Math.hypot(t[3] - t[0], t[4] - t[1], t[5] - t[2]), Math.hypot(t[6] - t[3], t[7] - t[4], t[8] - t[5]), Math.hypot(t[0] - t[6], t[1] - t[7], t[2] - t[8]));
    const n = Math.min(64, Math.max(1, Math.ceil(e / step)));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, w = j / n, v = 1 - u - w;
      put(t[0] * v + t[3] * u + t[6] * w, t[1] * v + t[4] * u + t[7] * w, t[2] * v + t[5] * u + t[8] * w);
    }
  }
  return [...low.keys()].sort((a, b) => a - b).map((k) => { const p = low.get(k); return { x: p[0], y: p[1], z: p[2] }; });
}

/**
 * World (x, z) of a model-space sample for a hull at (vx, vz) heading `h` (entity convention: forward (cos h, sin h),
 * the model's +x = the boat's left (sin h, −cos h)), shifted `dx` m along its own x (the berth offset).
 */
export function sampleXZ(p, vx, vz, h, dx = 0, out = { x: 0, z: 0 }) {
  const c = Math.cos(h), s = Math.sin(h), x = p.x + dx;
  out.x = vx + c * p.z + s * x; out.z = vz + s * p.z - c * x;
  return out;
}

/**
 * Rest pose of a rigid hull on its supports. Heights are linear in the pose (small angles): a sample (x, y, z) sits at
 * h + y + A·z + B·x, A = −sin pitch (bow up > 0), B = sin roll (the left side up > 0). The pose minimises
 *   E = h + A·zc + B·xc + k/2 Σ max(0, sᵢ − h − A zᵢ − B xᵢ)² + ρ/2 ((A − A0)² + (B − B0)²),   sᵢ = supportᵢ − yᵢ
 * (the weight at its centre of mass (xc, zc) against stiff contacts; ρ only picks the tilt nearest the floating one
 * where several rest equally low, e.g. a keel on flat ground) by damped Newton steps (E is convex): the hull ends on the
 * supports round its centre of mass, at most a few tenths of a millimetre into them. A centre of mass a little aft of
 * the origin (`com`) tips a hull perched on a single hump under its middle onto its stern, as its weight would.
 * @param {{x:number, y:number, z:number}[]} pts underside samples
 * @param {ArrayLike<number>} sup support height per sample (world m; −Infinity = nothing under it)
 * @param {{A0?: number, B0?: number, com?: number[], k?: number, rho?: number, maxTilt?: number, iters?: number}} [o]
 *   com = [xc, zc] model-space centre of mass (default the origin)
 * @returns {{h:number, A:number, B:number, iters:number, contacts:number}|null} null when nothing supports it
 */
export function restPose(pts, sup, o = {}) {
  const k = o.k ?? REST.k, rho = o.rho ?? REST.rho, M = o.maxTilt ?? REST.maxTilt, A0 = o.A0 ?? 0, B0 = o.B0 ?? 0;
  const xc = o.com?.[0] ?? 0, zc = o.com?.[1] ?? 0;
  const n = pts.length, s = new Float64Array(n), live = [];
  for (let i = 0; i < n; i++) { s[i] = sup[i] - pts[i].y; if (s[i] > -1e6) live.push(i); }
  if (!live.length) return null;
  const clampT = (v) => Math.max(-M, Math.min(M, v));
  let A = clampT(A0), B = clampT(B0), h = -Infinity;
  for (const i of live) h = Math.max(h, s[i] - A * pts[i].z - B * pts[i].x); // touching at the highest support
  const energy = (h, A, B) => {
    let e = h + A * zc + B * xc + 0.5 * rho * ((A - A0) ** 2 + (B - B0) ** 2);
    for (const i of live) { const d = s[i] - h - A * pts[i].z - B * pts[i].x; if (d > 0) e += 0.5 * k * d * d; }
    return e;
  };
  let E = energy(h, A, B), it = 0;
  for (; it < (o.iters ?? REST.iters); it++) {
    // gradient + Hessian over the touching samples (d ≥ 0: the first contact counts, so the Hessian is never singular)
    let gh = 1, gA = zc + rho * (A - A0), gB = xc + rho * (B - B0);
    let Hhh = 0, HhA = 0, HhB = 0, HAA = rho, HAB = 0, HBB = rho;
    for (const i of live) {
      const z = pts[i].z, x = pts[i].x, d = s[i] - h - A * z - B * x;
      if (d < -1e-9) continue;
      gh -= k * d; gA -= k * d * z; gB -= k * d * x;
      Hhh += k; HhA += k * z; HhB += k * x; HAA += k * z * z; HAB += k * z * x; HBB += k * x * x;
    }
    // a tilt held at its limit with the slope pushing it further stays there (projected Newton: dropped from the step)
    if ((A >= M && gA < 0) || (A <= -M && gA > 0)) { gA = 0; HhA = 0; HAA = 1; HAB = 0; }
    if ((B >= M && gB < 0) || (B <= -M && gB > 0)) { gB = 0; HhB = 0; HBB = 1; HAB = 0; }
    // solve H·δ = g (3×3, Cramer)
    const c00 = HAA * HBB - HAB * HAB, c01 = HhB * HAB - HhA * HBB, c02 = HhA * HAB - HhB * HAA;
    const det = Hhh * c00 + HhA * c01 + HhB * c02;
    if (!(Math.abs(det) > 1e-18)) break;
    const c11 = Hhh * HBB - HhB * HhB, c12 = HhB * HhA - Hhh * HAB, c22 = Hhh * HAA - HhA * HhA;
    const dh = (c00 * gh + c01 * gA + c02 * gB) / det, dA = (c01 * gh + c11 * gA + c12 * gB) / det, dB = (c02 * gh + c12 * gA + c22 * gB) / det;
    // backtracking line search on E (convex: the Newton direction always descends)
    let t = 1, nh = h, nA = A, nB = B, nE = E;
    for (let q = 0; q < 60; q++, t *= 0.5) {
      nh = h - t * dh; nA = clampT(A - t * dA); nB = clampT(B - t * dB);
      nE = energy(nh, nA, nB);
      if (nE <= E - 1e-12 * t) break;
    }
    if (!(nE < E)) break;
    const moved = Math.abs(nh - h) + Math.abs(nA - A) + Math.abs(nB - B);
    h = nh; A = nA; B = nB; E = nE;
    if (moved < 1e-7) { it++; break; }
  }
  let contacts = 0;
  for (const i of live) if (s[i] - h - A * pts[i].z - B * pts[i].x > -0.002) contacts++;
  return { h, A, B, iters: it, contacts };
}

/**
 * Pose of a boat from its floating pose and the ground under it.
 * @param {{x:number, y:number, z:number}[]} pts underside samples (model space)
 * @param {{h:number, pitch:number, roll:number}} float the floating pose (origin height = waterline, bob, tilts)
 * @param {ArrayLike<number>} ground ground height under each sample (−Infinity: none it can rest on)
 * @param {ArrayLike<number|null>} water water level over each sample (null: no water there)
 * @param {{squash?: number, com?: number[]}} [o] squash: how far soft tubes flatten into the ground (m); com: restPose
 * @returns {{h:number, pitch:number, roll:number, grounded:number, afloat:boolean}} grounded = share of the samples the
 *   ground holds above their floating height (0 afloat … 1 on dry land)
 */
export function boatRest(pts, float, ground, water, o = {}) {
  const n = pts.length, A0 = -Math.sin(float.pitch), B0 = Math.sin(float.roll) * Math.cos(float.pitch);
  const sup = new Float64Array(n), sq = o.squash ?? 0;
  let lifted = 0, any = false;
  for (let i = 0; i < n; i++) {
    const p = pts[i], wf = water[i] != null ? float.h + p.y + A0 * p.z + B0 * p.x : -Infinity; // floating height there
    const g = ground[i] - sq;
    if (g > wf + 1e-4) lifted++;
    sup[i] = Math.max(wf, g);
    if (sup[i] > -1e6) any = true;
  }
  if (!lifted || !any) return { h: float.h, pitch: float.pitch, roll: float.roll, grounded: 0, afloat: true };
  const r = restPose(pts, sup, { A0, B0, com: o.com });
  if (!r) return { h: float.h, pitch: float.pitch, roll: float.roll, grounded: 0, afloat: true };
  const pitch = -Math.asin(Math.max(-1, Math.min(1, r.A)));
  const roll = Math.asin(Math.max(-1, Math.min(1, r.B / Math.cos(pitch))));
  return { h: r.h, pitch, roll, grounded: lifted / n, afloat: false, contacts: r.contacts };
}

/** Is the world's drawn terrain built (art/terrain.js handle with its mesh ready)? Until then surfaceAt reads 0. */
export const terrainReady = (w) => !!(w?.terrain?.real && w.terrain.terrain && typeof w.terrain.surfaceAt === 'function');

/**
 * The ground a hull can rest on at (x, z), world m: the drawn terrain surface (the bank, the beach, the bed under the
 * water) once it is built; before that, or with the placeholder ground, the walking ground on dry cells and nothing
 * (−Infinity) on wet ones (their bed is not known).
 * @returns {(x:number, z:number) => number}
 */
export function groundOf(w) {
  if (terrainReady(w)) return (x, z) => w.terrain.surfaceAt(x, z);
  const g = w?.grid;
  return (x, z) => {
    const t = g?.terrainAt?.(x, z);
    if (t === T.WATER || t === T.SHALLOW) return -Infinity;
    return typeof w?.groundY === 'function' ? w.groundY(x, z) || 0 : 0;
  };
}

/**
 * The water surface over (x, z), world m, or null where there is none: the water system's body there (its own level:
 * the M3 reservoir stands above the river), else the grid's wet cells at the world water level.
 * @returns {(x:number, z:number) => number|null}
 */
export function waterOf(w, fallback = -0.1) {
  const W = w?.water, g = w?.grid, lv = Number.isFinite(W?.level) ? W.level : fallback;
  if (typeof W?.sample === 'function') return (x, z) => { const s = W.sample(x, z); return s ? (Number.isFinite(s.level) ? s.level : lv) : null; };
  return (x, z) => { const t = g?.terrainAt?.(x, z); return t === T.WATER || t === T.SHALLOW ? lv : null; };
}
