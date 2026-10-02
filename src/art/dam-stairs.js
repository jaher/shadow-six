/**
 * Concrete stairs up to a raised dam crest (M3, structure `ramps`, design-spec §7.6): per ramp polyline (bottom → top)
 * a solid stepped concrete wedge (one tread per RISE m) with a cast-iron railing on both sides. Visual only: the ramp
 * cells written by map-builder's applyElevation carry the gameplay (units climb them at the same heights).
 * @module art/dam-stairs
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dressingMaterial, boxUV } from './dressing.js';

/** Step height (m). */
export const STAIR_RISE = 0.25;
/**
 * Treads of a stair of length L climbing y0 → y1: N treads of `run` m, the last one a landing of `landing` m at y1
 * (default: one tread long; longer where the stair's top runs under the deck it serves, so its cells stand at the
 * deck). @returns {{N:number, run:number, landing:number}}
 */
export function stairTreads(L, y0, y1, landing) {
  const N = Math.max(2, Math.ceil((y1 - y0) / STAIR_RISE) + 1), land = Math.min(L * 0.5, landing ?? L / N);
  return { N, run: (L - land) / (N - 1), landing: land };
}

/**
 * Tread top at arc length `s` of that stair. The grid (map-builder raiseRamp) uses the same heights, so units walk
 * on the treads, not through them.
 */
export function stairTopAt(s, L, y0, y1, landing) {
  const { N, run, landing: land } = stairTreads(L, y0, y1, landing);
  const k = s >= L - land ? N - 1 : Math.max(0, Math.min(N - 1, Math.floor(s / run)));
  return y0 + ((y1 - y0) * k) / (N - 1);
}
const RAIL_H = 1.0, POST_EVERY = 1.6, BAR = 0.05;

let ironMat = null;
// painted wrought iron with the cast-iron texture set (placeholder-art pass: was a flat colour)
const iron = () => ironMat || (ironMat = Object.assign(dressingMaterial('castIron').clone(), { name: 'dam_stair_iron' }));

/** Box (sx × sy × sz) whose local +X runs along (dx, dz), centred at (x, y, z). */
function orientedBox(sx, sy, sz, x, y, z, dx, dz) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.rotateY(-Math.atan2(dz, dx));
  g.translate(x, y, z);
  return g;
}

/**
 * Heights along one ramp, as the grid has them: y0 at the first point, y1 at the last, linear in arc length.
 * @returns {{at:(s:number)=>{x:number,z:number,dx:number,dz:number}, L:number}}
 */
function polyline(points) {
  const P = points.map((q) => (Array.isArray(q) ? q : [q.x, q.z]));
  const segs = [];
  let L = 0;
  for (let i = 0; i + 1 < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1], l = Math.hypot(bx - ax, bz - az);
    if (l > 1e-6) { segs.push({ ax, az, dx: (bx - ax) / l, dz: (bz - az) / l, s0: L, l }); L += l; }
  }
  const at = (s) => {
    const g = segs.find((q) => s <= q.s0 + q.l) || segs[segs.length - 1];
    const t = Math.max(0, Math.min(g.l, s - g.s0));
    return { x: g.ax + g.dx * t, z: g.az + g.dz * t, dx: g.dx, dz: g.dz };
  };
  return { at, L };
}

/**
 * Stairs for every `ramps` entry of a structure def.
 * @param {{points:number[][], width?:number, y0?:number, y1:number, landing?:number}[]} ramps
 * @returns {THREE.Group} world-space group (name 'dam-stairs')
 */
export function buildDamStairs(ramps) {
  const group = new THREE.Group();
  group.name = 'dam-stairs';
  for (const r of ramps || []) {
    const { at, L } = polyline(r.points);
    if (!(L > 0) || !(r.y1 > 0)) continue;
    const w = r.width ?? 1.6, y0 = r.y0 ?? 0, y1 = r.y1;
    const { N, run, landing } = stairTreads(L, y0, y1, r.landing);
    const steps = [], rails = [];
    const topAt = (k) => y0 + ((y1 - y0) * k) / (N - 1);
    for (let k = 0; k < N; k++) {
      const len = k < N - 1 ? run : landing, p = at(k < N - 1 ? (k + 0.5) * run : L - landing / 2), top = topAt(k), bottom = -0.4;
      steps.push(orientedBox(len + 0.02, top - bottom, w, p.x, (top + bottom) / 2, p.z, p.dx, p.dz));
    }
    // railings: posts every POST_EVERY m on both sides, a sloped top rail and a mid rail between consecutive posts
    const nPost = Math.max(2, Math.round(L / POST_EVERY) + 1);
    for (const side of [-1, 1]) {
      let prev = null;
      for (let i = 0; i < nPost; i++) {
        const s = Math.min(L - 0.15, Math.max(0.15, (L * i) / (nPost - 1)));
        const p = at(s), base = stairTopAt(s, L, y0, y1, r.landing);
        const nx = -p.dz * side * (w / 2 - 0.08), nz = p.dx * side * (w / 2 - 0.08);
        const post = { x: p.x + nx, z: p.z + nz, y: base, dx: p.dx, dz: p.dz };
        rails.push(orientedBox(BAR, RAIL_H, BAR, post.x, base + RAIL_H / 2, post.z, p.dx, p.dz));
        if (prev) {
          for (const hgt of [RAIL_H, RAIL_H * 0.5]) {
            const ax = prev.x, az = prev.z, ay = prev.y + hgt, bx = post.x, bz = post.z, by = post.y + hgt;
            const len = Math.hypot(bx - ax, by - ay, bz - az), g = new THREE.BoxGeometry(len, BAR, BAR);
            const horiz = Math.hypot(bx - ax, bz - az);
            g.rotateZ(Math.atan2(by - ay, horiz));
            g.rotateY(-Math.atan2(bz - az, bx - ax));
            g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
            rails.push(g);
          }
        }
        prev = post;
      }
    }
    const stairs = new THREE.Mesh(boxUV(mergeGeometries(steps.map((g) => g.toNonIndexed())), 1.5), dressingMaterial('concrete')); // textured (placeholder-art pass)
    stairs.name = `dam-stair:${r.id ?? group.children.length}`;
    const rail = new THREE.Mesh(boxUV(mergeGeometries(rails.map((g) => g.toNonIndexed())), 0.5), iron());
    rail.name = `dam-stair-rail:${r.id ?? group.children.length}`;
    for (const m of [stairs, rail]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
  }
  return group;
}
