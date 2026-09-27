/**
 * Pavement geometry (step 3p): carriageway / sidewalk ribbons that follow the centre-line spline and hug the
 * terrain, gridded area meshes clipped per pixel by their signed edge distance, kerbs, quay walls + coping.
 * Every surface vertex carries road-space coordinates for the pavement shader (see pavement-glsl.js).
 * @module art/pavement/road-mesh
 */
import * as THREE from 'three';
import { polygonEdgeDistance, pointInPolygon } from '../../world/roads.js';

export const LIFT = 0.035;         // pavement above the (flattened) terrain
const CHUNK = 48;                  // m of road per mesh chunk (frustum culling)

/** Robust ground height: max over a small cross so the terrain never pokes through between vertices. */
export function groundFn(heightAt) {
  if (!heightAt) return () => 0;
  return (x, z) => Math.max(heightAt(x, z), heightAt(x + 0.3, z), heightAt(x - 0.3, z), heightAt(x, z + 0.3), heightAt(x, z - 0.3));
}

/** Crater damage 0..1 at (x, z) for a road's crater list [[x, z, r], …]. */
export function craterDamage(craters, x, z) {
  let d = 0;
  for (const [cx, cz, r] of craters) { const q = 1 - Math.hypot(x - cx, z - cz) / (r * 1.35); if (q > d) d = q; }
  return Math.max(0, Math.min(1, d * 1.35));
}

function finish(pos, pave, misc, dir, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPave', new THREE.Float32BufferAttribute(pave, 4));
  g.setAttribute('aPvMisc', new THREE.Float32BufferAttribute(misc, 4));
  g.setAttribute('aPvDir', new THREE.Float32BufferAttribute(dir, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Ribbon between lateral offsets t0 < t1 along a sampled centre line (roads.sampleCenterline), chunked.
 * @param {object[]} line samples {x, z, s, tx, tz} @param {object} o {t0, t1, hw, y(x,z), raise, edge(t)→m,
 *   gutter (m), marking code, craters, road (1/0), dt (lateral spacing)}
 * @returns {THREE.BufferGeometry[]}
 */
export function ribbonGeometries(line, o) {
  const ts = [], dt = o.dt ?? 0.5;
  const n = Math.max(1, Math.ceil((o.t1 - o.t0) / dt));
  for (let k = 0; k <= n; k++) ts.push(o.t0 + (o.t1 - o.t0) * k / n);
  if (o.gutter) for (const g of [-(o.hw - o.gutter), o.hw - o.gutter]) if (g > o.t0 && g < o.t1 && !ts.some((t) => Math.abs(t - g) < 0.05)) ts.push(g);
  ts.sort((a, b) => a - b);
  const out = [];
  let start = 0;
  while (start < line.length - 1) {
    let end = start;
    while (end < line.length - 1 && line[end].s - line[start].s < CHUNK) end++;
    const pos = [], pave = [], misc = [], dir = [], idx = [];
    for (let i = start; i <= end; i++) {
      const p = line[i], nx = -p.tz, nz = p.tx;
      for (const t of ts) {
        const x = p.x + nx * t, z = p.z + nz * t;
        const dmg = o.craters?.length ? craterDamage(o.craters, x, z) : 0;
        const gut = o.gutter && Math.abs(t) > o.hw - o.gutter ? -0.03 * Math.min(1, (Math.abs(t) - (o.hw - o.gutter)) / o.gutter + 0.3) : 0;
        pos.push(x, o.y(x, z) + LIFT + (o.raise || 0) + gut - Math.min(dmg, 0.8) * 0.03, z);
        pave.push(p.s, t, o.edge ? o.edge(t) : o.hw - Math.abs(t), o.hw);
        misc.push(dmg, o.gutter || 0, o.marking || 0, o.road ?? 1);
        dir.push(p.tx, p.tz);
      }
    }
    const W = ts.length;
    for (let i = 0; i < end - start; i++) for (let k = 0; k < W - 1; k++) {
      const a = i * W + k, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    out.push(finish(pos, pave, misc, dir, idx));
    start = end;
  }
  return out;
}

/**
 * Gridded area mesh over a polygon (0.5 m nodes), per-vertex signed edge distance (the shader clips at 0).
 * @param {object} a normalized area @param {(x:number,z:number)=>number} y ground height
 */
export function areaGeometry(a, y, step = 0.5) {
  const P = a.points, xs = P.map((p) => p[0]), zs = P.map((p) => p[1]);
  const x0 = Math.min(...xs) - step, z0 = Math.min(...zs) - step, nx = Math.ceil((Math.max(...xs) - x0) / step) + 2, nz = Math.ceil((Math.max(...zs) - z0) / step) + 2;
  const ca = Math.cos(a.angle || 0), sa = Math.sin(a.angle || 0), raise = a.raise + (a.kerb ? a.kerb.h : 0);
  const pos = [], pave = [], misc = [], dir = [], idx = [], sd = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, z = z0 + j * step, e = polygonEdgeDistance(x, z, P).d, inside = pointInPolygon(x, z, P);
    sd[j * nx + i] = inside ? e : -e;
    const dmg = a.craters?.length ? craterDamage(a.craters, x, z) : 0;
    pos.push(x, y(x, z) + LIFT + raise - Math.min(dmg, 0.8) * 0.03, z);
    pave.push(x * ca + z * sa, -x * sa + z * ca, sd[j * nx + i], 99);   // s = v along the pattern direction, t = u across
    misc.push(dmg, 0, 0, 0);
    dir.push(ca, sa);
  }
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a0 = j * nx + i, b = a0 + 1, c = a0 + nx, d = c + 1;
    if (Math.max(sd[a0], sd[b], sd[c], sd[d]) < -0.05) continue;
    idx.push(a0, c, b, b, c, d);
  }
  return finish(pos, pave, misc, dir, idx);
}

/**
 * Extrude a cross-section profile along a path. Profile points are [out, up] (m) relative to the path point
 * offset `t` across the path; `side` (+1 / -1) flips "out". Each profile segment is its own strip (crisp edges).
 * Optional `group(sMid)` → 0/1 splits the result into two geometries (e.g. blackout-painted kerb bands).
 * @returns {THREE.BufferGeometry[]} [group 0, group 1]
 */
export function extrudeProfile(line, profile, o) {
  const G = [{ pos: [], uv: [], idx: [] }, { pos: [], uv: [], idx: [] }];
  const uvS = o.uvScale ?? 1;
  const plen = [0];
  for (let k = 1; k < profile.length; k++) plen.push(plen[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
  const at = (p, q) => {
    const nx = -p.tz * o.side, nz = p.tx * o.side, bx = p.x - p.tz * (o.t ?? 0), bz = p.z + p.tx * (o.t ?? 0);
    const base = o.y(bx, bz);
    return [bx + nx * q[0], base + q[1], bz + nz * q[0]];
  };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], g = G[o.group ? o.group((a.s + b.s) / 2) : 0];
    for (let k = 0; k < profile.length - 1; k++) {
      const v = g.pos.length / 3;
      for (const [p, q, uu, vv] of [[a, profile[k], a.s, plen[k]], [b, profile[k], b.s, plen[k]], [a, profile[k + 1], a.s, plen[k + 1]], [b, profile[k + 1], b.s, plen[k + 1]]]) {
        g.pos.push(...at(p, q)); g.uv.push(uu / uvS, vv / uvS);
      }
      if (o.side > 0) g.idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); else g.idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  return G.map((g) => {
    if (!g.idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setIndex(g.idx);
    geo.computeVertexNormals();
    return geo;
  });
}

/** Kerbstone cross-section (road face, arris, top) for a kerb `h` high and `w` wide. */
export const kerbProfile = (h, w) => [[0, -0.08], [0, h - 0.018], [0.018, h], [w, h], [w, h - 0.03]];
/** Outer skirt of a raised sidewalk / area (drops to below the verge). */
export const skirtProfile = (h) => [[0, h], [0.02, h - 0.02], [0.02, -0.12]];
/** Quay edge: granite coping proud of the slabs, overhanging the wall face, wall down below the water line. */
export const copingProfile = (top) => [[-0.5, top + 0.005], [-0.5, top + 0.07], [0.08, top + 0.07], [0.12, top + 0.03], [0.12, top - 0.28], [0.04, top - 0.3]];
export const quayWallProfile = (top, bottom = -2.2) => [[0.04, top - 0.3], [0.04, bottom]];

/**
 * Polygon edge `i` of an area as a path (samples every ~0.5 m) with the outward side sign for extrudeProfile.
 * @returns {{line: object[], side: number}}
 */
export function polygonEdgePath(P, i, step = 0.5) {
  const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length], L = Math.hypot(bx - ax, bz - az) || 1;
  const tx = (bx - ax) / L, tz = (bz - az) / L, n = Math.max(1, Math.ceil(L / step)), line = [];
  for (let k = 0; k <= n; k++) line.push({ x: ax + (bx - ax) * k / n, z: az + (bz - az) * k / n, s: L * k / n, tx, tz });
  const mx = (ax + bx) / 2 - tz * 0.05, mz = (az + bz) / 2 + tx * 0.05;          // a point on the +n side
  return { line, side: pointInPolygon(mx, mz, P) ? -1 : 1, length: L };
}
