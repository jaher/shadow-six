/**
 * Open chimney flues (user 2026-10-15, M3: "the chimneys are covered by snow. They should have kind of a hole for smoke
 * to flow out"). The kit's chimneys had no opening: tools/blender kit_roof.chimney() builds a solid stack under a closed
 * cap slab with CAPPED clay pots, the stovepipes are capped cylinders (a rain hat sitting right on some), and on the snow
 * variants kit_weather.snow_pass() laid a snow slab over every top face, the caps included → solid white caps.
 *
 * `openChimneyFlues(root, anchors)` runs once per loaded GLB template (art/building-fixups.js, before the depth merge;
 * clones and instanced repeats share it). For every smoke-like anchor (chimney / smoke / stove) it finds the chimney in
 * the geometry around the anchor and opens it:
 *  - a stack without pots: a rectangular flue through the cap, inset from the cap edge (the rim / coping stays);
 *  - a stack with pots: every pot open (the cap between them stays closed, as real flaunching);
 *  - a stovepipe: the pipe top open; a rain hat sitting on the pipe is lifted so the gap under it shows, and keeps no
 *    snow (a warm flue).
 * Opening = every surface in the flue's column (cap, pot top, snow, decals) cut by the hole (triangle minus convex
 * polygon, all attributes interpolated: the rim keeps its own snow up to the edge), plus a sooty liner — inner walls from
 * the rim down and a floor — merged into the chimney's own mesh and darkened by its vertex colours: no new mesh,
 * material, program or draw. The mouths are kept per asset (`flueMouths`, model space) so the chimney smoke rises out
 * of the hole (render/fx.js FX.chimneyPoints). `fluedStackGeometry` builds the same open stack for procedural chimneys
 * (render/fx.js placeholder stacks, art/kit-buildings.js).
 * @module art/chimney-flues
 */
import * as THREE from 'three';
import { addSnowCover } from './terrain/snowfx.js';

/** Anchors that mark a chimney / stovepipe top (manifest anchors: name 'smoke', kind chimney | smoke | stove | –). */
export const isFlueAnchor = (an) => !!an && /smoke|chim|stove|flue/i.test(`${an.name || ''}/${an.kind || ''}`);
/** Anchors whose chimney smokes (render/fx.js). */
export const isSmokeAnchor = (an) => !!an && (an.kind === 'chimney' || an.kind === 'smoke');

/** Look of the liner: vertex colour at the mouth, at the bottom of the walls, and of the floor (× the material's albedo). */
export const SOOT = { top: 0.075, bottom: 0.02, floor: 0.012 };
/** A stovepipe's rain hat: its vertex colours × this (sooted). */
export const HAT_SOOT = 0.45;

const UP_NY = 0.85;      // an up-facing plate (cap, pot top, pipe top)
const EPS_AREA = 1e-8;

/** Per-asset flues of the finest LOD opened so far: name → { lod, flues } (model space). */
const FLUES = new Map();

/** Measured flues of a library asset (model space) or null: [{ anchors: [j…], kind, mouth: [x, y, z], hole, top, floor }]. */
export function flueMouths(name) { return FLUES.get(name)?.flues ?? null; }
/** (tests) forget the measured flues. */
export function resetFlues() { FLUES.clear(); }

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };

/**
 * Smoke emission points of a library asset in model space: one per smoking anchor (kind chimney | smoke), at its flue's
 * mouth when the flue was measured (`mouth: true`: already on the opening, no seating needed) — a stack with pots smokes
 * from one of them (seeded) — else the raw anchor. Two anchors on the same stack smoke once.
 * @returns {{pos: number[], mouth: boolean}[]}
 */
export function smokePoints(name, anchors = []) {
  const flues = flueMouths(name), out = [], used = new Set();
  anchors.forEach((an, j) => {
    if (!isSmokeAnchor(an)) return;
    const mine = flues ? flues.filter((f) => f.anchors.includes(j)) : [];
    if (!mine.length) { out.push({ pos: an.pos, mouth: false }); return; }
    if (mine.some((f) => used.has(f))) return;
    const f = mine.length > 1 ? mine[Math.min(mine.length - 1, Math.floor(hash(`${name}#${j}`) * mine.length))] : mine[0];
    for (const q of mine) used.add(q);
    out.push({ pos: f.mouth, mouth: true });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------- scene access

const isDecalMesh = (o) => { for (let p = o; p; p = p.parent) if (p.name === 'decals') return true; return /decal/i.test(o.material?.name || ''); };

/** Meshes of a template with their world (= model) positions; flags for what they are. */
function sceneMeshes(root) {
  root.updateMatrixWorld(true);
  const out = [];
  root.traverse((o) => {
    const g = o.geometry, P = g?.attributes?.position;
    if (!o.isMesh || !P || Array.isArray(o.material) || o.isInstancedMesh || o.isSkinnedMesh) return;
    if (g.morphAttributes && Object.keys(g.morphAttributes).length) return;
    const name = o.material?.name || '';
    const glass = /glass/i.test(name), decal = isDecalMesh(o), snow = /(^|:)snow/i.test(name) && !decal;
    const n = P.count, W = new Float32Array(n * 3), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); W[i * 3] = v.x; W[i * 3 + 1] = v.y; W[i * 3 + 2] = v.z; }
    const I = g.index;
    out.push({ o, W, n, I, tris: I ? I.count / 3 : n / 3, glass, decal, snow, groups: g.groups?.length > 0,
      solid: !glass && !decal && !snow && !o.material.transparent, ed: null });
  });
  return out;
}

const triIdx = (m, t, k) => (m.I ? m.I.getX(t * 3 + k) : t * 3 + k);

/**
 * Keep, per mesh, only the triangles whose box meets a box round one of the anchors (x, z ± 1.25 m, from 1.9 m below
 * to 0.9 m above): every later search and cut runs on those (a building is 10–40 k triangles, a chimney top a few).
 */
function nearAnchors(meshes, anchors) {
  const B = anchors.map((an) => [an.pos[0] - 1.25, an.pos[0] + 1.25, an.pos[1] - 1.9, an.pos[1] + 0.9, an.pos[2] - 1.25, an.pos[2] + 1.25]);
  const X0 = Math.min(...B.map((b) => b[0])), X1 = Math.max(...B.map((b) => b[1])), Y0 = Math.min(...B.map((b) => b[2])), Y1 = Math.max(...B.map((b) => b[3]));
  const Z0 = Math.min(...B.map((b) => b[4])), Z1 = Math.max(...B.map((b) => b[5]));
  for (const m of meshes) {
    const W = m.W, out = [], I = m.I?.array;
    for (let t = 0; t < m.tris; t++) {
      const a = I ? I[t * 3] : t * 3, b = I ? I[t * 3 + 1] : t * 3 + 1, c = I ? I[t * 3 + 2] : t * 3 + 2;
      const x0 = Math.min(W[a * 3], W[b * 3], W[c * 3]), x1 = Math.max(W[a * 3], W[b * 3], W[c * 3]);
      if (x1 < X0 || x0 > X1) continue;
      const z0 = Math.min(W[a * 3 + 2], W[b * 3 + 2], W[c * 3 + 2]), z1 = Math.max(W[a * 3 + 2], W[b * 3 + 2], W[c * 3 + 2]);
      if (z1 < Z0 || z0 > Z1) continue;
      const y0 = Math.min(W[a * 3 + 1], W[b * 3 + 1], W[c * 3 + 1]), y1 = Math.max(W[a * 3 + 1], W[b * 3 + 1], W[c * 3 + 1]);
      if (y1 < Y0 || y0 > Y1) continue;
      if (B.some((q) => x1 >= q[0] && x0 <= q[1] && y1 >= q[2] && y0 <= q[3] && z1 >= q[4] && z0 <= q[5])) out.push(t);
    }
    m.cand = out;
    // …and the vertices round the anchors (a stovepipe's walls reach far down: 8.5 m)
    const vs = [];
    for (let i = 0; i < m.n; i++) {
      const x = W[i * 3], y = W[i * 3 + 1], z = W[i * 3 + 2];
      if (x < X0 || x > X1 || z < Z0 || z > Z1) continue;
      if (B.some((q) => x >= q[0] && x <= q[1] && z >= q[4] && z <= q[5] && y >= q[2] - 6.6 && y <= q[3] + 0.6)) vs.push(i);
    }
    m.vcand = vs;
  }
}
/** Vertex indices of a mesh worth looking at (round the anchors once nearAnchors ran, else all). */
const vertsOf = (m) => m.vcand ?? Array.from({ length: m.n }, (_, i) => i);

// ---------------------------------------------------------------------------------------------- plan geometry (x, z)

const cross = (ax, az, bx, bz) => ax * bz - az * bx;
function polyArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += cross(p[j].x, p[j].z, p[i].x, p[i].z); return a / 2; }
function ccw(p) { return polyArea(p) < 0 ? p.slice().reverse() : p; }

/** Convex hull (x, z) of points, CCW. */
function hull(pts) {
  const p = pts.map((q) => ({ x: q.x, z: q.z })).sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-1).x - lo.at(-2).x, lo.at(-1).z - lo.at(-2).z, q.x - lo.at(-2).x, q.z - lo.at(-2).z) <= 1e-12) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up.at(-1).x - up.at(-2).x, up.at(-1).z - up.at(-2).z, q.x - up.at(-2).x, q.z - up.at(-2).z) <= 1e-12) up.pop(); up.push(q); }
  return ccw(lo.slice(0, -1).concat(up.slice(0, -1)));
}

/** Minimum-area rectangle around a CCW hull: centre, unit axis u, half sizes a (along u) and b. */
function minRect(h) {
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const j = (i + 1) % h.length; let ux = h[j].x - h[i].x, uz = h[j].z - h[i].z; const L = Math.hypot(ux, uz);
    if (L < 1e-6) continue; ux /= L; uz /= L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const q of h) { const s = q.x * ux + q.z * uz, t = -q.x * uz + q.z * ux; a0 = Math.min(a0, s); a1 = Math.max(a1, s); b0 = Math.min(b0, t); b1 = Math.max(b1, t); }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area - 1e-9) {
      const sc = (a0 + a1) / 2, tc = (b0 + b1) / 2;
      best = { area, cx: sc * ux - tc * uz, cz: sc * uz + tc * ux, ux, uz, a: (a1 - a0) / 2, b: (b1 - b0) / 2 };
    }
  }
  return best;
}

const rectPoly = (r, a, b) => ccw([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => ({ x: r.cx + s * a * r.ux - t * b * r.uz, z: r.cz + s * a * r.uz + t * b * r.ux })));
const scalePoly = (p, k) => { const c = centroid(p); return p.map((q) => ({ x: c.x + (q.x - c.x) * k, z: c.z + (q.z - c.z) * k })); };
function centroid(p) { let x = 0, z = 0; for (const q of p) { x += q.x; z += q.z; } return { x: x / p.length, z: z / p.length }; }
function inConvex(p, x, z, eps = 0) { for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (cross(p[i].x - p[j].x, p[i].z - p[j].z, x - p[j].x, z - p[j].z) / Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z) < eps) return false; return true; }

/** Barycentric (x, z) of point in a plan triangle; null when degenerate. */
function bary(ax, az, bx, bz, cx, cz, x, z) {
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-12) return null;
  const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
  return [u, v, 1 - u - v];
}

/** Area (m²) of a polygon of corner mixes {w: [3]} of triangle P (3D, any orientation). */
function area3(P, poly) {
  const at = (q) => [0, 1, 2].map((c) => q.w[0] * P[0][c] + q.w[1] * P[1][c] + q.w[2] * P[2][c]);
  const o = at(poly[0]); let sx = 0, sy = 0, sz = 0;
  for (let k = 1; k + 1 < poly.length; k++) {
    const a = at(poly[k]), b = at(poly[k + 1]);
    const ux = a[0] - o[0], uy = a[1] - o[1], uz = a[2] - o[2], vx = b[0] - o[0], vy = b[1] - o[1], vz = b[2] - o[2];
    sx += uy * vz - uz * vy; sy += uz * vx - ux * vz; sz += ux * vy - uy * vx;
  }
  return Math.hypot(sx, sy, sz) / 2;
}

/** Clip a plan polygon (vertices {x, z, w:[3]}) to the inside (keep > 0) or outside (keep < 0) of the line a→b. */
function clipHalf(poly, a, b, keep) {
  const out = [], ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez);
  const side = (q) => keep * cross(ex, ez, q.x - a.x, q.z - a.z) / L;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, w: p.w.map((wv, k) => wv + (q.w[k] - wv) * t) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- geometry editing

const GET = ['getX', 'getY', 'getZ', 'getW'], SET = ['setX', 'setY', 'setZ', 'setW'];
const intArray = (A) => A instanceof Uint8Array || A instanceof Uint16Array || A instanceof Uint32Array || A instanceof Int8Array || A instanceof Int16Array || A instanceof Int32Array;
const arrOf = (a) => (a.isInterleavedBufferAttribute ? a.data.array : a.array);

/** Pending edit of one mesh's geometry: appended vertices, dropped and added triangles (same attribute layouts). */
class GeoEdit {
  constructor(m) {
    this.m = m; this.g = m.o.geometry; this.n0 = this.g.attributes.position.count;
    this.verts = []; this.drop = new Set(); this.add = []; this.moved = new Map(); this.tint = new Map(); this.renorm = new Map();
    this.inv = new THREE.Matrix4().copy(m.o.matrixWorld).invert();
    this.toLocalN = new THREE.Matrix3().setFromMatrix4(m.o.matrixWorld).transpose(); // world normal → local (∝)
    this.toLocalD = new THREE.Matrix3().setFromMatrix4(this.inv);                     // world direction → local
  }
  /** New vertex: barycentric mix of original vertices [[i, w]…]; `over`: attribute overrides (local space). */
  vert(mix, over = null) { this.verts.push({ mix, over }); return this.n0 + this.verts.length - 1; }
  /** Can model-space point p be stored in this mesh's position attribute (quantised range)? */
  fits(p) {
    const P = this.g.attributes.position, A = arrOf(P), q = p.clone().applyMatrix4(this.inv);
    if (!intArray(A) || P.normalized) return P.normalized ? Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 && Math.abs(q.z) <= 1 : true;
    const lo = A instanceof Uint8Array || A instanceof Uint16Array || A instanceof Uint32Array ? 0 : A instanceof Int8Array ? -128 : A instanceof Int16Array ? -32768 : -2147483648;
    const hi = A instanceof Uint8Array ? 255 : A instanceof Uint16Array ? 65535 : A instanceof Int8Array ? 127 : A instanceof Int16Array ? 32767 : 4294967295;
    return [q.x, q.y, q.z].every((c) => c >= lo && c <= hi);
  }
  commit() {
    const g = this.g, n0 = this.n0, n = n0 + this.verts.length, ng = new THREE.BufferGeometry();
    const ibs = new Map();
    for (const [name, a] of Object.entries(g.attributes)) {
      let na;
      if (a.isInterleavedBufferAttribute) {
        let ib = ibs.get(a.data);
        if (!ib) {
          const old = a.data, st = old.stride, arr = new old.array.constructor(n * st);
          if (old.count >= n0) arr.set(old.array.subarray(0, n0 * st));
          ib = new THREE.InterleavedBuffer(arr, st); ibs.set(a.data, ib);
          if (old.count < n0) ib.__copy = true;
        }
        na = new THREE.InterleavedBufferAttribute(ib, a.itemSize, a.offset, a.normalized);
        if (ib.__copy) for (let i = 0; i < n0; i++) for (let c = 0; c < a.itemSize; c++) na[SET[c]](i, a[GET[c]](i));
      } else {
        const arr = new a.array.constructor(n * a.itemSize); arr.set(a.array.subarray(0, n0 * a.itemSize));
        na = new THREE.BufferAttribute(arr, a.itemSize, a.normalized);
      }
      na.name = a.name;
      ng.setAttribute(name, na);
    }
    // moved / sooted original vertices (a lifted rain hat)
    for (const [i, p] of this.moved) setPos(ng.attributes.position, i, p);
    const C = ng.attributes.color, N = ng.attributes.normal, nv = new THREE.Vector3();
    if (C) for (const [i, k] of this.tint) for (let c = 0; c < Math.min(3, C.itemSize); c++) C[SET[c]](i, C[GET[c]](i) * k);
    if (N) for (const [i, w] of this.renorm) { nv.set(w[0], w[1], w[2]).applyMatrix3(this.toLocalN).normalize(); N.setXYZ(i, nv.x, nv.y, nv.z); }
    // appended vertices
    this.verts.forEach((v, k) => {
      const i = n0 + k;
      for (const [name, a] of Object.entries(g.attributes)) {
        const na = ng.attributes[name], o = v.over?.[name];
        if (o) { if (name === 'position') setPos(na, i, o); else for (let c = 0; c < a.itemSize; c++) na[SET[c]](i, o[c] ?? (c === 3 ? 1 : 0)); continue; }
        const val = [0, 0, 0, 0];
        for (const [j, w] of v.mix) for (let c = 0; c < a.itemSize; c++) val[c] += w * a[GET[c]](j);
        if (name === 'normal' || name === 'tangent') { const L = Math.hypot(val[0], val[1], val[2]) || 1; val[0] /= L; val[1] /= L; val[2] /= L; }
        if (name === 'tangent' && a.itemSize === 4) val[3] = a.getW(v.mix[0][0]);
        if (name === 'position') setPos(na, i, val); else for (let c = 0; c < a.itemSize; c++) na[SET[c]](i, val[c]);
      }
    });
    const idx = [], I = g.index, T = I ? I.count / 3 : n0 / 3;
    for (let t = 0; t < T; t++) if (!this.drop.has(t)) idx.push(I ? I.getX(t * 3) : t * 3, I ? I.getX(t * 3 + 1) : t * 3 + 1, I ? I.getX(t * 3 + 2) : t * 3 + 2);
    for (const k of this.add) idx.push(k);
    ng.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    ng.name = g.name; ng.userData = { ...g.userData, flues: true };
    ng.computeBoundingBox(); ng.computeBoundingSphere();
    this.m.o.geometry = ng;
  }
}

function setPos(attr, i, p) {
  const A = arrOf(attr), r = intArray(A) && !attr.normalized ? Math.round : (x) => x;
  attr.setXYZ(i, r(p[0] ?? p.x), r(p[1] ?? p.y), r(p[2] ?? p.z));
}
const edOf = (m) => (m.ed ||= new GeoEdit(m));

// ---------------------------------------------------------------------------------------------- detection

/** Up-facing plates (connected flat triangles of solid meshes) in a box round the anchor. */
function platesNear(meshes, ax, ay, az, R = 1.05, below = 1.45, above = 0.75) {
  const tris = [], keyOf = (x, y, z) => `${Math.round(x * 500)},${Math.round(y * 500)},${Math.round(z * 500)}`;
  for (const m of meshes) {
    if (!m.solid) continue;
    const W = m.W;
    for (const t of m.cand ?? []) {
      const i0 = triIdx(m, t, 0), i1 = triIdx(m, t, 1), i2 = triIdx(m, t, 2);
      const x0 = W[i0 * 3], y0 = W[i0 * 3 + 1], z0 = W[i0 * 3 + 2], x1 = W[i1 * 3], y1 = W[i1 * 3 + 1], z1 = W[i1 * 3 + 2], x2 = W[i2 * 3], y2 = W[i2 * 3 + 1], z2 = W[i2 * 3 + 2];
      const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3, cz = (z0 + z1 + z2) / 3;
      if (Math.abs(cx - ax) > R || Math.abs(cz - az) > R || cy < ay - below || cy > ay + above) continue;
      const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0, vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz);
      if (L < 1e-9 || ny / L < UP_NY) continue;
      tris.push({ m, t, p: [[x0, y0, z0], [x1, y1, z1], [x2, y2, z2]], area: L / 2, keys: [keyOf(x0, y0, z0), keyOf(x1, y1, z1), keyOf(x2, y2, z2)] });
    }
  }
  const par = tris.map((_, i) => i), f = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const first = new Map();
  tris.forEach((tr, i) => { for (const k of tr.keys) { const j = first.get(k); if (j === undefined) first.set(k, i); else par[f(i)] = f(j); } });
  const groups = new Map();
  tris.forEach((tr, i) => { const r = f(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(tr); });
  const plates = [];
  for (const list of groups.values()) {
    const pts = new Map(); let area = 0, y0 = Infinity, y1 = -Infinity, sx = 0, sz = 0;
    for (const tr of list) {
      area += tr.area;
      for (let k = 0; k < 3; k++) { pts.set(tr.keys[k], tr.p[k]); y0 = Math.min(y0, tr.p[k][1]); y1 = Math.max(y1, tr.p[k][1]); }
      sx += tr.area * (tr.p[0][0] + tr.p[1][0] + tr.p[2][0]) / 3; sz += tr.area * (tr.p[0][2] + tr.p[1][2] + tr.p[2][2]) / 3;
    }
    const P = [...pts.values()].map((q) => ({ x: q[0], z: q[2] })), h = hull(P);
    const c = { x: sx / area, z: sz / area };
    const ds = h.map((q) => Math.hypot(q.x - c.x, q.z - c.z)), rmax = Math.max(...ds), rim = ds.filter((d) => d > 0.35 * rmax);
    const round = h.length >= 6 && Math.min(...rim) / rmax > 0.82;
    plates.push({ tris: list, area, y0, y1, c, hull: h, round, r: rim.reduce((a, b) => a + b, 0) / rim.length, mesh: list[0].m });
  }
  return plates;
}

const plateHas = (pl, x, z) => pl.tris.some((tr) => { const b = bary(tr.p[0][0], tr.p[0][2], tr.p[1][0], tr.p[1][2], tr.p[2][0], tr.p[2][2], x, z); return b && b.every((w) => w > -1e-4); });

/** Does a round plate continue downward as a pipe (a ring of vertices on its radius, at one height, below it)? */
function pipeBelow(meshes, pl) {
  const rings = new Map();
  for (const m of meshes) {
    if (!m.solid) continue;
    const W = m.W;
    for (const i of vertsOf(m)) {
      const y = W[i * 3 + 1]; if (y > pl.y0 - 0.05 || y < pl.y0 - 8) continue;
      const dx = W[i * 3] - pl.c.x, dz = W[i * 3 + 2] - pl.c.z, d = Math.hypot(dx, dz);
      if (d < pl.r * 0.85 || d > pl.r * 1.15) continue;
      const k = Math.round(y * 200);
      if (!rings.has(k)) rings.set(k, new Set());
      rings.get(k).add(Math.round(Math.atan2(dz, dx) * 8)); // distinct directions round the axis
    }
  }
  for (const a of rings.values()) if (a.size >= 5) return true;
  return false;
}

/**
 * The flues of one anchor: [{ kind, hole (CCW plan polygon), top (plate y), depth, mesh (the chimney's own mesh),
 * pipe? }] or [] when no chimney top is found there.
 */
function detect(meshes, an) {
  const [ax, ay, az] = an.pos;
  const plates = platesNear(meshes, ax, ay, az);
  // the stack's cap: the highest flat non-round plate (chimney-sized) under the anchor
  const caps = plates.filter((p) => !p.round && p.hull.length >= 4 && p.area >= 0.05 && p.y1 - p.y0 <= 0.08 && p.y1 > ay - 1.3 && p.y1 < ay + 0.3 && plateHas(p, ax, az));
  const caps2 = caps.map((p) => ({ p, R: minRect(p.hull) })).filter((q) => q.R && Math.max(q.R.a, q.R.b) <= 1.1 && q.R.area <= 2.5);
  caps2.sort((a, b) => b.p.y1 - a.p.y1);
  if (caps2.length) {
    const { p: cap, R } = caps2[0];
    const pots = plates.filter((p) => p !== cap && p.area <= 0.2 && p.y0 >= cap.y1 + 0.06 && p.y1 <= cap.y1 + 1.0
      && inConvex(rectPoly(R, R.a + 0.06, R.b + 0.06), p.c.x, p.c.z));
    if (pots.length) {
      return pots.map((pt) => ({ kind: 'pot', hole: scalePoly(pt.hull, pt.round ? 0.66 : 0.6), top: pt.y1, mesh: pt.mesh,
        depth: Math.max(0.12, Math.min(0.32, pt.y0 - cap.y1 - 0.04)) }));
    }
    // something unrecognised stands on the cap (a coarse LOD's pots decimated into lumps): leave this LOD's stack closed
    const capIn = rectPoly(R, R.a - 0.02, R.b - 0.02);
    for (const m of meshes) {
      if (!m.solid) continue;
      for (const i of vertsOf(m)) {
        const y = m.W[i * 3 + 1];
        if (y > cap.y1 + 0.06 && y < cap.y1 + 1.2 && inConvex(capIn, m.W[i * 3], m.W[i * 3 + 2])) return [];
      }
    }
    const b = Math.min(R.a, R.b), rim = Math.min(0.2, Math.max(0.06, 0.05 + 0.18 * 2 * b));
    // the coping must stay all round: every corner of the flue, 4 cm out, still on the cap (a decimated LOD's cap is
    // no rectangle: shrink the flue, else leave that LOD's stack closed)
    for (let k = 1; k >= 0.55; k -= 0.15) {
      const ha = (R.a - rim) * k, hb = (R.b - rim) * k;
      if (ha < 0.03 || hb < 0.03) return [];
      const hole = rectPoly(R, ha, hb), out = rectPoly(R, ha + 0.04, hb + 0.04);
      if (out.every((q) => plateHas(cap, q.x, q.z))) return [{ kind: 'stack', hole, top: cap.y1, mesh: cap.mesh, depth: 0.36 }];
    }
    return [];
  }
  // a stovepipe: the highest round plate on the anchor's axis that is a pipe's top (walls below it)
  const pipes = plates.filter((p) => p.round && p.r >= 0.03 && p.r <= 0.3 && p.y1 > ay - 1.3 && p.y1 < ay + 0.3
    && Math.hypot(p.c.x - ax, p.c.z - az) < Math.max(p.r, 0.15)).sort((a, b) => b.y1 - a.y1);
  const pipe = pipes.find((p) => pipeBelow(meshes, p));
  if (!pipe) return [];
  return [{ kind: 'pipe', hole: scalePoly(pipe.hull, 0.7), top: pipe.y1, mesh: pipe.mesh, depth: 0.25, pipe }];
}

// ---------------------------------------------------------------------------------------------- opening

/** Cut the hole through every surface in the flue's column (y in [y0, y1]); returns the cut triangles' pre-cut copies. */
function cutColumn(meshes, hole, y0, y1, strict = false) {
  const hb = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const q of hole) { hb.x0 = Math.min(hb.x0, q.x); hb.x1 = Math.max(hb.x1, q.x); hb.z0 = Math.min(hb.z0, q.z); hb.z1 = Math.max(hb.z1, q.z); }
  const cut = [];
  for (const m of meshes) {
    if (m.glass || m.groups) continue;
    const W = m.W;
    for (const t of m.cand ?? []) {
      const i0 = triIdx(m, t, 0), i1 = triIdx(m, t, 1), i2 = triIdx(m, t, 2);
      const lo = Math.min(W[i0 * 3 + 1], W[i1 * 3 + 1], W[i2 * 3 + 1]), hi = Math.max(W[i0 * 3 + 1], W[i1 * 3 + 1], W[i2 * 3 + 1]);
      // in the column: overlapping its height (a roof face poking up into the flue goes too); `strict`: wholly inside
      if (hi < y0 || lo > y1 || (strict && (lo < y0 || hi > y1))) continue;
      if (Math.max(W[i0 * 3], W[i1 * 3], W[i2 * 3]) < hb.x0 || Math.min(W[i0 * 3], W[i1 * 3], W[i2 * 3]) > hb.x1
        || Math.max(W[i0 * 3 + 2], W[i1 * 3 + 2], W[i2 * 3 + 2]) < hb.z0 || Math.min(W[i0 * 3 + 2], W[i1 * 3 + 2], W[i2 * 3 + 2]) > hb.z1) continue;
      const ii = [i0, i1, i2], P = ii.map((i) => [W[i * 3], W[i * 3 + 1], W[i * 3 + 2]]);
      if (area3(P, [{ w: [1, 0, 0] }, { w: [0, 1, 0] }, { w: [0, 0, 1] }]) < 1e-9) continue;
      // T minus the hole's prism (vertical planes through its edges): the side tests use x, z only, the cut points are
      // mixes of the triangle's corners → exact in 3D for any slope, walls included
      let rest = [0, 1, 2].map((k) => ({ x: P[k][0], z: P[k][2], w: [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0] }));
      const pieces = [];
      for (let k = 0; k < hole.length && rest.length >= 3; k++) {
        const a = hole[k], b = hole[(k + 1) % hole.length];
        const out = clipHalf(rest, a, b, -1);
        if (out.length >= 3 && area3(P, out) > EPS_AREA) pieces.push(out);
        rest = clipHalf(rest, a, b, 1);
      }
      if (rest.length < 3 || area3(P, rest) <= EPS_AREA) continue; // no overlap with the hole
      const ed = edOf(m);
      ed.drop.add(t); cut.push({ m, P, ii });
      const made = new Map();
      const vid = (q) => {
        for (let k = 0; k < 3; k++) if (q.w[k] > 1 - 1e-7) return ii[k];
        const key = q.w.map((w) => w.toFixed(6)).join(',');
        if (!made.has(key)) made.set(key, ed.vert(q.w.map((w, k) => [ii[k], w]).filter(([, w]) => Math.abs(w) > 1e-9)));
        return made.get(key);
      };
      for (const pc of pieces) {
        const ids = pc.map(vid);
        for (let k = 1; k + 1 < ids.length; k++) if (ids[0] !== ids[k] && ids[k] !== ids[k + 1] && ids[0] !== ids[k + 1]) ed.add.push(ids[0], ids[k], ids[k + 1]);
      }
    }
  }
  return cut;
}

/** Height of the topmost cut surface at plan point (x, z) (the rim the liner meets), or null. */
function surfaceAt(cut, x, z) {
  let y = null;
  for (const c of cut) {
    const P = c.P, b = bary(P[0][0], P[0][2], P[1][0], P[1][2], P[2][0], P[2][2], x, z);
    if (!b || b.some((w) => w < -1e-3)) continue;
    const h = b[0] * P[0][1] + b[1] * P[1][1] + b[2] * P[2][1];
    if (y === null || h > y) y = h;
  }
  return y;
}

/** The mesh that takes the liner: the chimney's own (vertex-coloured, opaque, position in range), else a neighbour. */
function linerMesh(meshes, f, probe) {
  const ok = (m) => m.o.geometry.attributes.color && m.o.material?.vertexColors && !m.o.material.transparent && !m.glass && !m.decal && !m.groups && edOf(m).fits(probe);
  if (ok(f.mesh)) return f.mesh;
  let best = null, bd = Infinity;
  for (const m of meshes) {
    if (m === f.mesh || !ok(m)) continue;
    const W = m.W; let d = Infinity;
    for (const i of vertsOf(m)) d = Math.min(d, Math.hypot(W[i * 3] - probe.x, W[i * 3 + 1] - probe.y, W[i * 3 + 2] - probe.z));
    const pen = m.snow ? 50 : 0; // rather stone / brick than snow (the snow mesh only when nothing else can take it)
    if (d + pen < bd) { bd = d + pen; best = m; }
  }
  return best;
}

/** Inner walls (rim → floor) and floor of the flue, appended to mesh `m`; tops: plan point → rim height. */
function addLiner(m, hole, tops, floorY) {
  const ed = edOf(m), g = m.o.geometry, A = g.attributes;
  const c = centroid(hole), n0 = 0;
  const base = (name) => { const a = A[name]; if (!a) return null; const v = []; for (let k = 0; k < a.itemSize; k++) v.push(a[GET[k]](n0)); return v; };
  const uv0 = base('uv'), uv10 = base('uv1');
  const col = (s) => { const a = A.color; return a.itemSize === 4 ? [s, s, s, 1] : [s, s, s]; };
  const local = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(ed.inv);
  const dirN = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix3(ed.toLocalN).normalize();
  const dirT = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix3(ed.toLocalD).normalize();
  const V = (p, nrm, tan, s, u, v) => {
    const over = { position: local(p.x, p.y, p.z), normal: nrm.toArray(), color: col(s) };
    if (A.tangent) over.tangent = [...tan.toArray(), 1];
    if (uv0) over.uv = [uv0[0] + u, uv0[1] + v];
    if (uv10) over.uv1 = uv10;
    return ed.vert([[0, 1]], Object.fromEntries(Object.entries(over).map(([k, val]) => [k, k === 'position' ? [val.x, val.y, val.z] : val])));
  };
  let along = 0;
  for (let i = 0; i < tops.length; i++) {
    const a = tops[i], b = tops[(i + 1) % tops.length];
    const ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez);
    if (L < 1e-5) continue;
    let nx = -ez / L, nz = ex / L; // left normal of a CCW boundary = inward
    if ((c.x - a.x) * nx + (c.z - a.z) * nz < 0) { nx = -nx; nz = -nz; }
    const N = dirN(nx, 0, nz), T = dirT(ex / L, 0, ez / L);
    const s = 0.6; // liner UV scale (dark: barely seen)
    const t0 = V({ x: a.x, y: a.y, z: a.z }, N, T, SOOT.top, along * s, 0), t1 = V({ x: b.x, y: b.y, z: b.z }, N, T, SOOT.top, (along + L) * s, 0);
    const b0 = V({ x: a.x, y: floorY, z: a.z }, N, T, SOOT.bottom, along * s, (a.y - floorY) * s), b1 = V({ x: b.x, y: floorY, z: b.z }, N, T, SOOT.bottom, (along + L) * s, (b.y - floorY) * s);
    along += L;
    // facing inward (towards the flue's axis): counter-clockwise seen from the axis
    const P0 = new THREE.Vector3(a.x, a.y, a.z), P1 = new THREE.Vector3(b.x, b.y, b.z), P2 = new THREE.Vector3(b.x, floorY, b.z);
    const fn = new THREE.Vector3().subVectors(P1, P0).cross(new THREE.Vector3().subVectors(P2, P0));
    if (fn.x * nx + fn.z * nz > 0) ed.add.push(t0, t1, b1, t0, b1, b0); else ed.add.push(t0, b1, t1, t0, b0, b1);
  }
  // floor: a fan from the centroid, facing up — shaded with a DOWNWARD normal: the scene's top-facing prop snow
  // (art/terrain.js coverPropsWithSnow, by normal) skips it and no sky lights it: a dark pit, no extra program
  const Nf = dirN(0, -1, 0), Tf = dirT(1, 0, 0);
  const ctr = V({ x: c.x, y: floorY, z: c.z }, Nf, Tf, SOOT.floor, 0, 0);
  const ring = hole.map((q) => V({ x: q.x, y: floorY, z: q.z }, Nf, Tf, SOOT.floor, (q.x - c.x) * 0.6, (q.z - c.z) * 0.6));
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    // up-facing: CCW in (x, z) is clockwise seen from above (+y) → (ctr, j, i)
    ed.add.push(ctr, ring[j], ring[i]);
  }
}

/** Rim samples along the hole boundary (finer on long edges), each with the cut surface's height there (the surfaces
 * near the flue's top only: a roof face the column also cut lies far below). */
function rimTops(hole, cut, fallback, maxY = Infinity) {
  const near = cut.filter((q) => { const hi = Math.max(q.P[0][1], q.P[1][1], q.P[2][1]); return hi <= maxY && hi >= fallback - 0.1; });
  const c = centroid(hole), out = [];
  for (let i = 0; i < hole.length; i++) {
    const a = hole[i], b = hole[(i + 1) % hole.length], L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(L / 0.12));
    for (let s = 0; s < n; s++) {
      const t = s / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const ox = x - c.x, oz = z - c.z, ol = Math.hypot(ox, oz) || 1;
      const y = surfaceAt(near, x + (ox / ol) * 1e-3, z + (oz / ol) * 1e-3);
      out.push({ x, z, y: (y !== null && y >= fallback - 0.1 ? y : fallback) + 0.002 });
    }
  }
  return out;
}

/**
 * Lift a rain hat that sits on the pipe (gap < 7 cm) so the open flue shows under it, and take the snow off it.
 * Hat = whatever stands over the pipe top within its reach, the pipe's own top ring excepted.
 */
function freeHat(meshes, pipe) {
  const reach = Math.max(0.35, pipe.r * 3), y = pipe.y1;
  const hat = [], snow = [];
  for (const m of meshes) {
    if (m.glass) continue;
    const W = m.W;
    for (const i of vertsOf(m)) {
      const vy = W[i * 3 + 1], d = Math.hypot(W[i * 3] - pipe.c.x, W[i * 3 + 2] - pipe.c.z);
      if (d > reach || vy < y - 0.002 || vy > y + 1.2) continue;
      if (!m.snow && Math.abs(vy - y) <= 0.002 && d <= pipe.r * 1.12) continue; // the pipe's own top ring / cap
      (m.snow ? snow : hat).push([m, i, vy]);
    }
  }
  // snow on the hat: every snow triangle standing above the pipe top within the reach
  for (const m of new Set(snow.map((s) => s[0]))) {
    const inHat = new Set(snow.filter((s) => s[0] === m).map((s) => s[1])), ed = edOf(m);
    for (const t of m.cand ?? []) if (inHat.has(triIdx(m, t, 0)) && inHat.has(triIdx(m, t, 1)) && inHat.has(triIdx(m, t, 2))) ed.drop.add(t);
  }
  // the pipe's top ring (smooth-shaded: normals half up): shaded as the pipe's side, no prop snow on the lip
  const out = (m, i) => { const dx = m.W[i * 3] - pipe.c.x, dz = m.W[i * 3 + 2] - pipe.c.z, d = Math.hypot(dx, dz); return d > 1e-3 ? [dx / d, 0, dz / d] : [1, 0, 0]; };
  for (const m of meshes) {
    if (!m.solid || !m.o.geometry.attributes.normal) continue;
    for (const i of vertsOf(m)) {
      const vy = m.W[i * 3 + 1], d = Math.hypot(m.W[i * 3] - pipe.c.x, m.W[i * 3 + 2] - pipe.c.z);
      if (Math.abs(vy - y) <= 0.002 && d > pipe.r * 0.88 && d <= pipe.r * 1.12) edOf(m).renorm.set(i, out(m, i));
    }
  }
  if (!hat.length) return 0;
  // the hat sooted by the smoke under it and shaded by side normals: the scene's top-facing prop snow (by normal) never
  // whitens it into a snow cap (a light galvanised hat read as one from above)
  for (const [m, i] of hat) {
    if (m.o.geometry.attributes.color) edOf(m).tint.set(i, HAT_SOOT);
    if (m.o.geometry.attributes.normal) edOf(m).renorm.set(i, out(m, i));
  }
  const gap = Math.min(...hat.map((h) => h[2])) - y;
  if (gap >= 0.07) return 0;
  const lift = 0.08 - gap, v = new THREE.Vector3();
  for (const [m, i] of hat) {
    const ed = edOf(m), W = m.W;
    v.set(W[i * 3], W[i * 3 + 1] + lift, W[i * 3 + 2]).applyMatrix4(ed.inv);
    ed.moved.set(i, [v.x, v.y, v.z]);
  }
  return lift;
}

/**
 * Open every chimney of a loaded template (model space = the scene root's space).
 * @param {THREE.Object3D} root the GLB scene
 * @param {{name?: string, pos: number[], kind?: string}[]} anchors the asset's manifest anchors
 * @param {{name?: string, lod?: number}} [opts] asset name + LOD: the finest LOD's flues are kept for flueMouths(name)
 * @returns {object[]} the flues opened
 */
export function openChimneyFlues(root, anchors = [], { name = null, lod = 0 } = {}) {
  const list = anchors.map((an, j) => [an, j]).filter(([an]) => isFlueAnchor(an) && Array.isArray(an.pos));
  if (!list.length) return [];
  const meshes = sceneMeshes(root), flues = [];
  nearAnchors(meshes, list.map(([an]) => an));
  for (const [an, j] of list) {
    for (const f of detect(meshes, an)) {
      const c = centroid(f.hole), same = flues.find((q) => q.kind === f.kind && Math.hypot(q.c.x - c.x, q.c.z - c.z) < 0.03 && Math.abs(q.top - f.top) < 0.03);
      if (same) { same.anchors.push(j); continue; }
      flues.push({ ...f, c, anchors: [j] });
    }
  }
  const out = [];
  for (const f of flues) {
    const floorY = f.top - f.depth;
    // the column: from below the floor to above the snow on the cap (a pipe: only its own top — the hat stays)
    const y1 = f.kind === 'pipe' ? f.top + 0.03 : f.top + 0.35;
    const cut = cutColumn(meshes, f.hole, floorY - 0.06, y1, f.kind === 'pipe');
    const tops = rimTops(f.hole, cut, f.top, y1);
    const probe = new THREE.Vector3(f.c.x, floorY, f.c.z);
    const m = linerMesh(meshes, f, probe);
    if (m) addLiner(m, f.hole, tops, floorY);
    const lift = f.kind === 'pipe' ? freeHat(meshes, f.pipe) : 0;
    const rim = Math.min(...tops.map((q) => q.y));
    out.push({ anchors: f.anchors, kind: f.kind, lined: !!m, lift,
      hole: f.hole.map((q) => [+q.x.toFixed(4), +q.z.toFixed(4)]), top: rim, floor: floorY,
      // smoke leaves just inside the opening (under a pipe's hat)
      mouth: [f.c.x, (f.kind === 'pipe' ? f.top : rim) - 0.04, f.c.z] });
  }
  for (const m of meshes) if (m.ed) m.ed.commit();
  if (name != null) { const cur = FLUES.get(name); if (!cur || lod <= cur.lod) FLUES.set(name, { lod, flues: out }); }
  return out;
}

// ---------------------------------------------------------------------------------------------- procedural stacks

/**
 * An open chimney stack for procedural chimneys (render/fx.js placeholder stacks, art/kit-buildings.js): a w × d stack
 * from y0 to y1 (centred on x, z; box UVs at `uvScale` m per repeat) with a coping course (cap overhang `cap`, height
 * `capH`) and a flue `t` m in from the stack faces, `depth` deep. Returns { outer, liner } geometries: the stack and
 * coping (outer faces + the rim) in the stack's own material, and the flue liner (inner walls + floor) for a dark one.
 */
export function fluedStackGeometry({ w = 0.6, d = 0.6, y0 = 0, y1 = 1, cap = 0.08, capH = 0.1, t = 0.13, depth = 0.45, uvScale = 1.2 } = {}) {
  const pos = [], nrm = [], uv = [], lp = [], ln = [], luv = [];
  const quad = (P, N, A, a, b, c, d2, U) => { // a b c d CCW seen from the normal side
    const base = P.length / 3;
    for (const q of [a, b, c, d2]) P.push(...q);
    for (let k = 0; k < 4; k++) N.push(...A);
    U.push(...[0, 0, 1, 0, 1, 1, 0, 1].map((v2, k) => v2 * (k % 2 ? Math.hypot(...[0, 1, 2].map((i) => d2[i] - a[i])) : Math.hypot(...[0, 1, 2].map((i) => b[i] - a[i]))) / uvScale));
    return base;
  };
  const idx = [], lidx = [];
  const Q = (P, N, U, I, a, b, c, d2, n) => { const s = quad(P, N, n, a, b, c, d2, U); I.push(s, s + 1, s + 2, s, s + 2, s + 3); };
  const box = (hw, hd, ya, yb, top) => { // 4 sides (+ optional top frame done separately)
    Q(pos, nrm, uv, idx, [-hw, ya, hd], [hw, ya, hd], [hw, yb, hd], [-hw, yb, hd], [0, 0, 1]);
    Q(pos, nrm, uv, idx, [hw, ya, -hd], [-hw, ya, -hd], [-hw, yb, -hd], [hw, yb, -hd], [0, 0, -1]);
    Q(pos, nrm, uv, idx, [hw, ya, hd], [hw, ya, -hd], [hw, yb, -hd], [hw, yb, hd], [1, 0, 0]);
    Q(pos, nrm, uv, idx, [-hw, ya, -hd], [-hw, ya, hd], [-hw, yb, hd], [-hw, yb, -hd], [-1, 0, 0]);
    if (top === 'bottom') Q(pos, nrm, uv, idx, [-hw, ya, -hd], [hw, ya, -hd], [hw, ya, hd], [-hw, ya, hd], [0, -1, 0]);
  };
  const hw = w / 2, hd = d / 2, cw = hw + cap, cd = hd + cap, ct = y1 - capH;
  box(hw, hd, y0, ct);                         // the stack
  box(cw, cd, ct, y1, 'bottom');               // the coping course (its underside)
  // the coping's top: a frame round the flue
  const iw = Math.max(0.03, hw - t), id = Math.max(0.03, hd - t);
  const fr = (ax, az, bx, bz) => Q(pos, nrm, uv, idx, [ax, y1, bz], [bx, y1, bz], [bx, y1, az], [ax, y1, az], [0, 1, 0]);
  fr(-cw, id, cw, cd); fr(-cw, -cd, cw, -id); fr(iw, -id, cw, id); fr(-cw, -id, -iw, id);
  // the flue: inner walls facing in, and the floor
  const fy = y1 - depth;
  Q(lp, ln, luv, lidx, [iw, fy, id], [-iw, fy, id], [-iw, y1, id], [iw, y1, id], [0, 0, -1]);
  Q(lp, ln, luv, lidx, [-iw, fy, -id], [iw, fy, -id], [iw, y1, -id], [-iw, y1, -id], [0, 0, 1]);
  Q(lp, ln, luv, lidx, [iw, fy, -id], [iw, fy, id], [iw, y1, id], [iw, y1, -id], [-1, 0, 0]);
  Q(lp, ln, luv, lidx, [-iw, fy, id], [-iw, fy, -id], [-iw, y1, -id], [-iw, y1, id], [1, 0, 0]);
  Q(lp, ln, luv, lidx, [-iw, fy, id], [iw, fy, id], [iw, fy, -id], [-iw, fy, -id], [0, -1, 0]); // (faces up, shaded as a pit: no prop snow)
  const mk = (P, N, U, I) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  };
  return { outer: mk(pos, nrm, uv, idx), liner: mk(lp, ln, luv, lidx), mouth: { y: y1, hw: iw, hd: id, floor: fy } };
}

/**
 * A dark copy of a material for flue liners: the same program (only its colour differs), cached per source. A source
 * already carrying the scene's prop snow (art/terrain.js coverPropsWithSnow: clone() drops that patch) gets it again,
 * at amount 0, so the copy's program is the source's (built after the load's warm-up: no compile in play).
 */
const DARK = new WeakMap();
export function sootMaterial(src) {
  if (!src) return null;
  let m = DARK.get(src);
  if (!m) {
    m = src.clone();
    m.name = `${src.name || 'mat'}#soot`;
    m.color = new THREE.Color(0x0b0a09);
    if (m.emissive) m.emissive.setRGB(0, 0, 0);
    if (src.userData?.snowCover) addSnowCover(m, { uniforms: { uSnowAmt: { value: 0 }, uSnowBias: { value: 0 } } });
    DARK.set(src, m);
  }
  return m;
}

/** (tests / tools) internals. */
export const __test = { sceneMeshes, platesNear, plateHas, detect, minRect, hull, clipHalf, area3 };
