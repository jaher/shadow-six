/**
 * Exact "does this ray hit anything?" against static meshes, fast: the video-mode director's yaw check
 * (debug/walkthrough-director.js) casts its rays from the men towards the camera through the buildings round them —
 * three's Raycaster tests every triangle of every mesh whose box the ray crosses (a barracks, a hangar, a wall of 15–30
 * thousand triangles: ~1 ms a ray, 3–4 ms of a frame in M3's stage G, and a blasted bunker's ruin ~80 000).
 *
 * Each mesh geometry gets a uniform grid of its triangles in its own space (built once, in slices: buildGridG), and a
 * ray walks only the cells it passes through (3D DDA), testing their triangles with three's own Ray.intersectTriangle
 * on three's own vertex values, the same material side rule (FrontSide / BackSide / DoubleSide, groups and their
 * materials, the draw range) and the same world-space near / far test as Mesh.raycast: anyHit() answers exactly
 * `raycaster.intersectObjects(meshes, false).length > 0`, only it stops at the first hit. Meshes it cannot speak for
 * (skinned, morphed, batched, a custom raycast, a geometry changed since its grid was built) are asked
 * through three as before; an instanced mesh is asked instance by instance against its geometry's grid, as three does.
 * Debug / video mode only: nothing here touches the game.
 * @module debug/ray-grid
 */

import * as THREE from 'three';

/** Grid cells per triangle aimed at (a few triangles a cell). */
const CELLS_PER_TRI = 0.5;
/** Most cells along one axis. */
const MAX_DIM = 96;
/** A triangle over more cells than this goes to the grid's "big" list, tested by every ray that meets the grid. */
const BIG_CELLS = 48;
/** Triangles a build slice handles between yields. */
const BUILD_SLICE = 600;

const GRIDS = new WeakMap(); // BufferGeometry → TriGrid
const STAMP = { a: new Uint32Array(1024), q: 0 };
const _inv = new THREE.Matrix4(), _ray = new THREE.Ray(), _sphere = new THREE.Sphere(), _hitAt = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3(), _w = new THREE.Vector3();

/** The triangles three's Mesh.raycast walks: [first index slot, end) per group (indexed or not), with its group. */
function triRanges(geometry, material) {
  const index = geometry.index, position = geometry.attributes.position, dr = geometry.drawRange;
  const count = index ? index.count : position ? position.count : 0;
  if (Array.isArray(material)) {
    return geometry.groups.map((g, gi) => ({ start: Math.max(g.start, dr.start), end: Math.min(count, Math.min(g.start + g.count, dr.start + dr.count)), group: gi }));
  }
  return [{ start: Math.max(0, dr.start), end: Math.min(count, dr.start + dr.count), group: -1 }];
}

/** What a grid was built from: rebuilt (meanwhile, three answers) when any of it changes. */
function signature(geometry, material) {
  const index = geometry.index, position = geometry.attributes.position, dr = geometry.drawRange;
  let s = `${position?.version ?? -1}|${position?.count ?? 0}|${index ? `${index.version}|${index.count}` : '-'}|${dr.start}|${dr.count}|${Array.isArray(material) ? 'A' : 'S'}`;
  if (Array.isArray(material)) for (const g of geometry.groups) s += `|${g.start},${g.count},${g.materialIndex}`;
  return s;
}

/** Can a grid answer for this object exactly as its own raycast would? (a mesh, or each instance of an instanced one) */
export function gridable(o) {
  if (!o.isMesh || o.isSkinnedMesh || o.isBatchedMesh) return false;
  if (o.raycast !== (o.isInstancedMesh ? THREE.InstancedMesh.prototype.raycast : THREE.Mesh.prototype.raycast)) return false;
  const g = o.geometry;
  if (!g?.attributes?.position || g.morphAttributes?.position?.length) return false;
  return o.material !== undefined;
}

class TriGrid {
  constructor(sig) {
    this.sig = sig;
    this.ready = false;
  }
}

/**
 * Build `geometry`'s triangle grid (for `material`'s groups) in slices: a generator yielding every BUILD_SLICE
 * triangles; the grid is registered when done. Returns the grid.
 */
export function* buildGridG(geometry, material) {
  const sig = signature(geometry, material);
  const have = GRIDS.get(geometry);
  if (have && have.sig === sig && have.ready) return have;
  const G = new TriGrid(sig);
  const pos = geometry.attributes.position, index = geometry.index;
  const ranges = triRanges(geometry, material);
  let T = 0;
  for (const r of ranges) if (r.end > r.start) T += Math.floor((r.end - r.start + 2) / 3);
  if (!T) { Object.assign(G, { T: 0, ready: true }); GRIDS.set(geometry, G); return G; }
  // triangle k: its first index slot and its group (one range — a single material: slot = base + 3k, no tables)
  const one = ranges.length === 1, base = one ? ranges[0].start : 0;
  const slot = one ? null : new Uint32Array(T), grp = one ? null : new Int32Array(T);
  if (!one) { let k = 0; for (const r of ranges) for (let j = r.start; j < r.end; j += 3) { slot[k] = j; grp[k] = r.group; k++; } }
  const slotOf = one ? (k) => base + 3 * k : (k) => slot[k];
  const vi = (j) => (index ? index.getX(j) : j);
  // bounds of every vertex the triangles use
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let k = 0; k < T; k++) {
    for (let q = 0; q < 3; q++) {
      const v = vi(slotOf(k) + q);
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      if (x < min.x) min.x = x; if (x > max.x) max.x = x;
      if (y < min.y) min.y = y; if (y > max.y) max.y = y;
      if (z < min.z) min.z = z; if (z > max.z) max.z = z;
    }
    if (k % BUILD_SLICE === BUILD_SLICE - 1) yield;
  }
  const ext = new THREE.Vector3().subVectors(max, min);
  const pad = Math.max(ext.x, ext.y, ext.z, 1e-3) * 1e-6 + 1e-6;
  min.subScalar(pad); max.addScalar(pad); ext.subVectors(max, min);
  // cells: about CELLS_PER_TRI a triangle, as cubic as the extents allow
  const want = Math.max(1, T * CELLS_PER_TRI), vol = Math.max(ext.x, 1e-3) * Math.max(ext.y, 1e-3) * Math.max(ext.z, 1e-3);
  const s0 = Math.cbrt(vol / want);
  const dim = (e) => Math.max(1, Math.min(MAX_DIM, Math.ceil(e / s0)));
  const nx = T ? dim(ext.x) : 1, ny = T ? dim(ext.y) : 1, nz = T ? dim(ext.z) : 1;
  const sx = ext.x / nx || 1, sy = ext.y / ny || 1, sz = ext.z / nz || 1;
  const cx = (x) => Math.min(nx - 1, Math.max(0, Math.floor((x - min.x) / sx)));
  const cy = (y) => Math.min(ny - 1, Math.max(0, Math.floor((y - min.y) / sy)));
  const cz = (z) => Math.min(nz - 1, Math.max(0, Math.floor((z - min.z) / sz)));
  // each triangle's cell box (its own bounds, padded)
  const box = new Int32Array(T * 6);
  const count = new Uint32Array(nx * ny * nz + 1);
  const big = [];
  for (let k = 0; k < T; k++) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let q = 0; q < 3; q++) {
      const v = vi(slotOf(k) + q), x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const i0 = cx(x0 - pad), i1 = cx(x1 + pad), j0 = cy(y0 - pad), j1 = cy(y1 + pad), l0 = cz(z0 - pad), l1 = cz(z1 + pad);
    const o = k * 6;
    if ((i1 - i0 + 1) * (j1 - j0 + 1) * (l1 - l0 + 1) > BIG_CELLS) { big.push(k); box[o] = -1; }
    else {
      box[o] = i0; box[o + 1] = i1; box[o + 2] = j0; box[o + 3] = j1; box[o + 4] = l0; box[o + 5] = l1;
      for (let l = l0; l <= l1; l++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) count[(l * ny + j) * nx + i + 1]++;
    }
    if (k % BUILD_SLICE === BUILD_SLICE - 1) yield;
  }
  for (let c = 1; c < count.length; c++) count[c] += count[c - 1];
  const tris = new Uint32Array(count[count.length - 1]), fill = count.slice(0, count.length - 1);
  for (let k = 0; k < T; k++) {
    const o = k * 6;
    if (box[o] < 0) continue;
    for (let l = box[o + 4]; l <= box[o + 5]; l++) for (let j = box[o + 2]; j <= box[o + 3]; j++) for (let i = box[o]; i <= box[o + 1]; i++) tris[fill[(l * ny + j) * nx + i]++] = k;
    if (k % BUILD_SLICE === BUILD_SLICE - 1) yield;
  }
  Object.assign(G, { T, base, slot, grp, min, max, nx, ny, nz, sx, sy, sz, start: count, tris, big: Uint32Array.from(big), ready: true });
  // (a build that finished after another — the geometry changed meanwhile — keeps the newer)
  if (signature(geometry, material) === sig) GRIDS.set(geometry, G);
  return G;
}

/** The mesh's grid when it is built and still matches its geometry; else null. */
export function gridOf(mesh) {
  const G = GRIDS.get(mesh.geometry);
  return G && G.ready && G.sig === signature(mesh.geometry, mesh.material) ? G : null;
}

/**
 * Does the world ray (`raycaster.ray`, near / far) hit `mesh` (its grid `G`) — exactly as mesh.raycast would find
 * at least one intersection?
 */
function meshHit(mesh, G, raycaster) {
  const geometry = mesh.geometry, material = mesh.material, mw = mesh.matrixWorld;
  // (Mesh.raycast's own culls: the bounding sphere in world space, the box in local space)
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  _sphere.copy(geometry.boundingSphere).applyMatrix4(mw);
  _ray.copy(raycaster.ray).recast(raycaster.near);
  if (_sphere.containsPoint(_ray.origin) === false) {
    if (_ray.intersectSphere(_sphere, _hitAt) === null) return false;
    if (_ray.origin.distanceToSquared(_hitAt) > (raycaster.far - raycaster.near) ** 2) return false;
  }
  _inv.copy(mw).invert();
  _ray.copy(raycaster.ray).applyMatrix4(_inv);
  if (geometry.boundingBox !== null && _ray.intersectsBox(geometry.boundingBox) === false) return false;
  if (!G.T) return false;
  const pos = geometry.attributes.position, index = geometry.index;
  // (a triangle in several cells is tested once a ray: one shared stamp array, a fresh stamp a ray)
  if (STAMP.a.length < G.T) STAMP.a = new Uint32Array(Math.max(G.T, STAMP.a.length * 2));
  if (++STAMP.q >= 0xfffffff0) { STAMP.a.fill(0); STAMP.q = 1; }
  const q = STAMP.q, stamp = STAMP.a, slot = G.slot, grp = G.grp, base = G.base;
  const test = (k) => {
    if (stamp[k] === q) return false;
    stamp[k] = q;
    const j = slot ? slot[k] : base + 3 * k, gi = grp ? grp[k] : -1;
    const m = gi < 0 ? material : material[geometry.groups[gi].materialIndex];
    if (m === undefined) return false;
    const ia = index ? index.getX(j) : j, ib = index ? index.getX(j + 1) : j + 1, ic = index ? index.getX(j + 2) : j + 2;
    _a.fromBufferAttribute(pos, ia); _b.fromBufferAttribute(pos, ib); _c.fromBufferAttribute(pos, ic);
    const hit = m.side === THREE.BackSide ? _ray.intersectTriangle(_c, _b, _a, true, _p) : _ray.intersectTriangle(_a, _b, _c, m.side === THREE.FrontSide, _p);
    if (hit === null) return false;
    _w.copy(_p).applyMatrix4(mw);
    const d = raycaster.ray.origin.distanceTo(_w);
    return !(d < raycaster.near || d > raycaster.far);
  };
  for (let n = 0; n < G.big.length; n++) if (test(G.big[n])) return true;
  // the cells along the ray inside the grid (Amanatides–Woo)
  const o = _ray.origin, dv = _ray.direction, min = G.min, max = G.max;
  let t0 = 0, t1 = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    const d = dv[ax];
    if (d === 0) { if (o[ax] < min[ax] || o[ax] > max[ax]) return false; continue; }
    let ta = (min[ax] - o[ax]) / d, tb = (max[ax] - o[ax]) / d;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  const { nx, ny, nz, sx, sy, sz } = G;
  const px = o.x + dv.x * t0, py = o.y + dv.y * t0, pz = o.z + dv.z * t0;
  let i = Math.min(nx - 1, Math.max(0, Math.floor((px - min.x) / sx)));
  let j = Math.min(ny - 1, Math.max(0, Math.floor((py - min.y) / sy)));
  let l = Math.min(nz - 1, Math.max(0, Math.floor((pz - min.z) / sz)));
  const stx = dv.x > 0 ? 1 : dv.x < 0 ? -1 : 0, sty = dv.y > 0 ? 1 : dv.y < 0 ? -1 : 0, stz = dv.z > 0 ? 1 : dv.z < 0 ? -1 : 0;
  const next = (c, st, mn, s, oo, d) => (st === 0 ? Infinity : ((mn + (c + (st > 0 ? 1 : 0)) * s) - oo) / d);
  let tx = next(i, stx, min.x, sx, o.x, dv.x), ty = next(j, sty, min.y, sy, o.y, dv.y), tz = next(l, stz, min.z, sz, o.z, dv.z);
  const dx = stx === 0 ? Infinity : sx / Math.abs(dv.x), dy = sty === 0 ? Infinity : sy / Math.abs(dv.y), dz = stz === 0 ? Infinity : sz / Math.abs(dv.z);
  const start = G.start, tris = G.tris;
  for (;;) {
    const c = (l * ny + j) * nx + i;
    for (let n = start[c], e = start[c + 1]; n < e; n++) if (test(tris[n])) return true;
    if (tx <= ty && tx <= tz) { if (tx > t1) break; i += stx; if (i < 0 || i >= nx) break; tx += dx; }
    else if (ty <= tz) { if (ty > t1) break; j += sty; if (j < 0 || j >= ny) break; ty += dy; }
    else { if (tz > t1) break; l += stz; if (l < 0 || l >= nz) break; tz += dz; }
  }
  return false;
}

const _instL = new THREE.Matrix4(), _instW = new THREE.Matrix4(), _proxy = { geometry: null, material: null, matrixWorld: null };
/** InstancedMesh.raycast's answer (≥ 1 hit?): its bounding sphere, then each instance as a mesh at its own matrix. */
function instancedHit(o, G, raycaster) {
  if (o.material === undefined) return false;
  if (o.boundingSphere === null) o.computeBoundingSphere();
  _sphere.copy(o.boundingSphere).applyMatrix4(o.matrixWorld);
  if (raycaster.ray.intersectsSphere(_sphere) === false) return false;
  _proxy.geometry = o.geometry; _proxy.material = o.material;
  for (let i = 0; i < o.count; i++) {
    o.getMatrixAt(i, _instL);
    _proxy.matrixWorld = _instW.multiplyMatrices(o.matrixWorld, _instL);
    if (meshHit(_proxy, G, raycaster)) return true;
  }
  return false;
}

const _hits = [];
/**
 * `raycaster.intersectObjects(objects, false).length > 0`, exactly, stopping at the first hit: a gridded mesh through its
 * grid, any other object through its own raycast. `need`: called with each gridable mesh whose grid is missing (the
 * caller builds it later); that mesh is asked through three meanwhile.
 */
export function anyHit(raycaster, objects, need = null) {
  for (const o of objects) {
    if (o.layers.test(raycaster.layers) === false) continue;
    const G = gridable(o) ? gridOf(o) : null;
    if (G) { if (o.isInstancedMesh ? instancedHit(o, G, raycaster) : meshHit(o, G, raycaster)) return true; continue; }
    if (need && gridable(o)) need(o);
    _hits.length = 0;
    o.raycast(raycaster, _hits);
    if (_hits.length) { _hits.length = 0; return true; }
  }
  return false;
}
