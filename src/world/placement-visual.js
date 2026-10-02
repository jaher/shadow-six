/**
 * Visual plan shapes for the placement rules (world/placement.js, browser path): the convex hull, in world XZ, of a
 * built structure's render vertices within a height band. Library buildings use their finest loaded LOD, so snow
 * skirts, porches, stairs, woodpiles, splayed tower legs and eaves all count (the gameplay footprint alone does not
 * cover them). Shadow/proxy/decal meshes and `userData.clip === false` subtrees are skipped.
 * @module world/placement-visual
 */
import * as THREE from 'three';
import { convexHull } from './placement-geom.js';
import { sessionCache, hasher, dataKey } from '../engine/asset-cache.js';

export { dataKey };

const SKIP = /shadow|proxy|collider|collision|occluder|decal|selection|marker|halo|glow|blob|impostor/i;
/** World matrices of a mesh: its own, or one per instance of an InstancedMesh (sandbag courses, stake rows…). */
export function meshMatrices(nd) {
  if (!nd.isInstancedMesh) return [nd.matrixWorld];
  const out = [], im = new THREE.Matrix4();
  for (let k = 0; k < nd.count; k++) { nd.getMatrixAt(k, im); out.push(new THREE.Matrix4().multiplyMatrices(nd.matrixWorld, im)); }
  return out;
}
const _v = new THREE.Vector3();

/**
 * @param {THREE.Object3D} root built structure
 * @param {{minY?: number, maxY?: number, groundY?: number, maxVerts?: number}} [o] band relative to `groundY`
 * @returns {number[][]|null} hull polygon [[x, z], …] or null (no vertices in the band)
 */
function planHullRaw(root, o = {}) {
  const minY = o.minY ?? -Infinity, maxY = o.maxY ?? Infinity, gy = o.groundY ?? 0, maxVerts = o.maxVerts ?? 60000;
  root.updateMatrixWorld(true);
  const pts = [];
  const visit = (n) => {
    if (n.userData?.clip === false || (!n.visible && !/^lod\d$/.test(n.name))) return;
    if (/^lod[12]$/.test(n.name)) { // finest loaded LOD only
      const sib = n.parent?.children || [];
      const finest = ['lod0', 'lod1', 'lod2'].find((nm) => sib.some((c) => c.name === nm));
      if (n.name !== finest) return;
    }
    if (n.isMesh && !SKIP.test(n.name || '') && n.geometry?.attributes?.position) {
      const pos = n.geometry.attributes.position, stride = Math.max(1, Math.ceil(pos.count / maxVerts));
      const inst = n.isInstancedMesh ? n.count : 0, im = new THREE.Matrix4(), m = new THREE.Matrix4();
      for (let q = 0; q < Math.max(1, inst); q++) {
        if (inst) { n.getMatrixAt(q, im); m.multiplyMatrices(n.matrixWorld, im); } else m.copy(n.matrixWorld);
        for (let i = 0; i < pos.count; i += stride) {
          _v.fromBufferAttribute(pos, i).applyMatrix4(m);
          const y = _v.y - gy;
          if (y >= minY && y <= maxY) pts.push([_v.x, _v.z]);
        }
      }
    }
    for (const c of n.children) visit(c);
  };
  visit(root);
  if (pts.length < 3) return null;
  const h = convexHull(pts);
  return h.length >= 3 ? h : null;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/**
 * Occupancy of a structure's render triangles within a height band, rasterized at `cell` m and merged into row
 * rectangles (non-convex: a barn's ramp, an L-shaped house, stairs and snow skirts keep their real outline).
 * `fit: true` rasterizes in the structure's own frame (its world position and yaw) and trims each row's end
 * rectangles to the real geometry, so a rotated gate or wall-side hut is not padded by up to a diagonal cell at each
 * end (the shape that cuts fence runs: an inflated one left see-through slots beside M2's camp gate).
 * @param {THREE.Object3D} root @param {{minY?: number, maxY?: number, groundY?: number, cell?: number, close?: number, fit?: boolean}} [o]
 * @returns {number[][][]|null} rectangles [[x, z] × 4][] or null when empty
 */
function planCellsRaw(root, o = {}) {
  const minY = o.minY ?? -Infinity, maxY = o.maxY ?? Infinity, gy = o.groundY ?? 0, cell = o.cell ?? 0.25;
  root.updateMatrixWorld(true);
  const cells = new Set(), rowLo = new Map(), rowHi = new Map();
  // frame: world (x, z) → local (lx, lz) about the root's origin and yaw (identity unless `fit`)
  let ox = 0, oz = 0, c = 1, s = 0;
  if (o.fit) {
    const q = new THREE.Quaternion(), p = new THREE.Vector3();
    root.matrixWorld.decompose(p, q, new THREE.Vector3());
    const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    ox = p.x; oz = p.z; c = Math.cos(yaw); s = Math.sin(yaw);
  }
  const toWorld = ([lx, lz]) => [ox + lx * c + lz * s, oz - lx * s + lz * c];
  const mark = (x, z) => {
    const dx = x - ox, dz = z - oz, lx = dx * c - dz * s, lz = dx * s + dz * c, j = Math.floor(lz / cell);
    cells.add(`${Math.floor(lx / cell)},${j}`);
    if (o.fit) { rowLo.set(j, Math.min(rowLo.get(j) ?? Infinity, lx)); rowHi.set(j, Math.max(rowHi.get(j) ?? -Infinity, lx)); }
  };
  const tri = (a, b, c) => {
    const ya = a.y - gy, yb = b.y - gy, yc = c.y - gy;
    if (Math.min(ya, yb, yc) > maxY || Math.max(ya, yb, yc) < minY) return;
    const L = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
    const n = Math.min(400, Math.max(1, Math.ceil(L / (cell * 0.5))));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n, w = 1 - u - v;
      const y = a.y * u + b.y * v + c.y * w - gy;
      if (y < minY - 0.05 || y > maxY + 0.05) continue;
      mark(a.x * u + b.x * v + c.x * w, a.z * u + b.z * v + c.z * w);
    }
  };
  const visit = (nd) => {
    if (nd.userData?.clip === false || (!nd.visible && !/^lod\d$/.test(nd.name))) return;
    if (/^lod[12]$/.test(nd.name)) {
      const sib = nd.parent?.children || [];
      if (nd.name !== ['lod0', 'lod1', 'lod2'].find((nm) => sib.some((c) => c.name === nm))) return;
    }
    if (nd.isMesh && !SKIP.test(nd.name || '') && nd.geometry?.attributes?.position) for (const m of meshMatrices(nd)) {
      const pos = nd.geometry.attributes.position, idx = nd.geometry.index;
      const count = idx ? idx.count : pos.count;
      for (let t = 0; t + 2 < count; t += 3) {
        const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
        _a.fromBufferAttribute(pos, i0).applyMatrix4(m); _b.fromBufferAttribute(pos, i1).applyMatrix4(m); _c.fromBufferAttribute(pos, i2).applyMatrix4(m);
        tri(_a, _b, _c);
      }
    }
    for (const c of nd.children) visit(c);
  };
  visit(root);
  if (!cells.size) return null;
  const filled = o.close === 0 ? cells : closeCells(cells, o.close ?? 3);
  // merge each row's runs of cells into rectangles
  const rows = new Map();
  for (const key of filled) { const [i, j] = key.split(',').map(Number); if (!rows.has(j)) rows.set(j, []); rows.get(j).push(i); }
  const out = [];
  for (const [j, list] of rows) {
    list.sort((p, q) => p - q);
    const lo = rowLo.get(j) ?? -Infinity, hi = rowHi.get(j) ?? Infinity;
    const push = () => {
      // trim only an end cell that holds the row's extreme sample (cells added by closing stay whole)
      const x0 = lo > s0 * cell && lo < (s0 + 1) * cell ? lo : s0 * cell, x1 = hi > prev * cell && hi < (prev + 1) * cell ? hi : (prev + 1) * cell;
      const z0 = j * cell, z1 = (j + 1) * cell;
      out.push([[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map((pt) => (o.fit ? toWorld(pt) : pt)));
    };
    let s0 = list[0], prev = list[0];
    for (let k = 1; k < list.length; k++) { if (list[k] === prev + 1) { prev = list[k]; continue; } push(); s0 = prev = list[k]; }
    push();
  }
  return out;
}

/**
 * Overhead parts of a visual (placement rules d/e): per `cell` square the lowest and highest point of the geometry
 * standing at or above `minY` m (eaves, porch roofs, balconies, a tower's cabin, a crane jib). Walkers pass under
 * them; a vehicle taller than the lowest point, or a gun barrel at that height, does not.
 * @param {THREE.Object3D} root @param {{minY?: number, maxY?: number, cell?: number, groundY?: number}} [o]
 * @returns {Map<string, [number, number]>} "i,j" (cell indices) → [lo, hi] (world y)
 */
function overheadCellsRaw(root, o = {}, into = new Map()) {
  const minY = o.minY ?? 1.8, maxY = o.maxY ?? 12, gy = o.groundY ?? 0, cell = o.cell ?? 0.5;
  root.updateMatrixWorld(true);
  const put = (x, z, y) => {
    const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`, p = into.get(k);
    if (!p) into.set(k, [y, y]); else { if (y < p[0]) p[0] = y; if (y > p[1]) p[1] = y; }
  };
  const visit = (nd) => {
    if (nd.userData?.clip === false || (!nd.visible && !/^lod\d$/.test(nd.name))) return;
    if (/^lod[12]$/.test(nd.name)) {
      const sib = nd.parent?.children || [];
      if (nd.name !== ['lod0', 'lod1', 'lod2'].find((nm) => sib.some((c) => c.name === nm))) return;
    }
    if (nd.isMesh && !SKIP.test(nd.name || '') && nd.geometry?.attributes?.position) for (const m of meshMatrices(nd)) {
      const pos = nd.geometry.attributes.position, idx = nd.geometry.index;
      const count = idx ? idx.count : pos.count;
      for (let t = 0; t + 2 < count; t += 3) {
        const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
        _a.fromBufferAttribute(pos, i0).applyMatrix4(m); _b.fromBufferAttribute(pos, i1).applyMatrix4(m); _c.fromBufferAttribute(pos, i2).applyMatrix4(m);
        if (Math.max(_a.y, _b.y, _c.y) - gy < minY || Math.min(_a.y, _b.y, _c.y) - gy > maxY) continue;
        const L = Math.max(_a.distanceTo(_b), _b.distanceTo(_c), _c.distanceTo(_a));
        const n = Math.min(400, Math.max(1, Math.ceil(L / (cell * 0.4))));
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
          const u = i / n, v = j / n, w = 1 - u - v, y = _a.y * u + _b.y * v + _c.y * w;
          if (y - gy < minY || y - gy > maxY) continue;
          put(_a.x * u + _b.x * v + _c.x * w, _a.z * u + _b.z * v + _c.z * w, y);
        }
      }
    }
    for (const c of nd.children) visit(c);
  };
  visit(root);
  return into;
}

/**
 * Solid parts of a visual standing on the local walking surface (placement rule e, bodies): the `cell` squares
 * where the geometry rises between `lo` and `hi` m above `surf(x, z)` (the ground, a deck or a wall walk), e.g.
 * palisade stakes along a wall walk, a railing on a bridge, a crate beside a wall. Deck boards (≈ 0) and what
 * hangs below a deck (< 0) do not count.
 * @param {THREE.Object3D} root @param {(x:number, z:number) => number} surf
 * @param {{lo?: number, hi?: number, cell?: number, maxY?: number}} [o] maxY: skip triangles wholly above it
 * @param {Set<string>} [into] "i,j" at `cell`
 */
function standingCellsRaw(root, surf, o = {}, into = new Set()) {
  const lo = o.lo ?? 0.15, hi = o.hi ?? 1.2, cell = o.cell ?? 0.25;
  root.updateMatrixWorld(true);
  const visit = (nd) => {
    if (nd.userData?.clip === false || (!nd.visible && !/^lod\d$/.test(nd.name))) return;
    if (/^lod[12]$/.test(nd.name)) {
      const sib = nd.parent?.children || [];
      if (nd.name !== ['lod0', 'lod1', 'lod2'].find((nm) => sib.some((c) => c.name === nm))) return;
    }
    if (nd.isMesh && !SKIP.test(nd.name || '') && nd.geometry?.attributes?.position) for (const m of meshMatrices(nd)) {
      const pos = nd.geometry.attributes.position, idx = nd.geometry.index;
      const count = idx ? idx.count : pos.count;
      for (let t = 0; t + 2 < count; t += 3) {
        const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
        _a.fromBufferAttribute(pos, i0).applyMatrix4(m); _b.fromBufferAttribute(pos, i1).applyMatrix4(m); _c.fromBufferAttribute(pos, i2).applyMatrix4(m);
        if (o.maxY != null && Math.min(_a.y, _b.y, _c.y) > o.maxY) continue; // above any surface + hi (roofs)
        const L = Math.max(_a.distanceTo(_b), _b.distanceTo(_c), _c.distanceTo(_a));
        const n = Math.min(400, Math.max(1, Math.ceil(L / (cell * 0.5))));
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
          const u = i / n, v = j / n, w = 1 - u - v;
          const x = _a.x * u + _b.x * v + _c.x * w, z = _a.z * u + _b.z * v + _c.z * w, y = _a.y * u + _b.y * v + _c.y * w;
          const r = y - surf(x, z);
          if (r >= lo && r <= hi) into.add(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
        }
      }
    }
    for (const c of nd.children) visit(c);
  };
  visit(root);
  return into;
}

const _ray = new THREE.Raycaster(), _o = new THREE.Vector3(), _d = new THREE.Vector3(0, -1, 0);
/** Finest-LOD meshes of a structure (raycast targets). */
export function finestMeshes(root) {
  const out = [];
  const visit = (n) => {
    if (n.userData?.clip === false || (!n.visible && !/^lod\d$/.test(n.name))) return;
    if (/^lod[12]$/.test(n.name)) {
      const sib = n.parent?.children || [];
      if (n.name !== ['lod0', 'lod1', 'lod2'].find((nm) => sib.some((c) => c.name === nm))) return;
    }
    if (n.isMesh && !n.isInstancedMesh && !SKIP.test(n.name || '')) out.push(n);
    for (const c of n.children) visit(c);
  };
  root.updateMatrixWorld(true);
  visit(root);
  return out;
}

/**
 * Top surface height (world y) of a structure at (x, z) between `lo` and `hi` (raycast straight down from `hi`):
 * the highest upward-facing hit in the band, or null. `meshes` = finestMeshes(root) (pass it when sampling a lot).
 */
export function measureTop(root, x, z, lo, hi, meshes = null) {
  const list = meshes || finestMeshes(root);
  _o.set(x, hi, z);
  _ray.set(_o, _d); _ray.far = hi - lo;
  for (const h of _ray.intersectObjects(list, false)) {
    if (h.point.y < lo || h.point.y > hi) continue;
    const n = h.face?.normal;
    if (n) { const wn = n.clone().transformDirection(h.object.matrixWorld); if (wn.y < 0.3) continue; } // walls / undersides
    return h.point.y;
  }
  return null;
}

/**
 * Enclosed interiors count as occupied: morphological closing (radius `R` cells: doorways up to 2R cells wide are
 * bridged), flood-fill from outside, erode back. A hollow cabin without a floor mesh is solid; a tower's open
 * leg frame (legs further apart than 2R) stays open. Returns the set of occupied cell keys "i,j".
 */
export function closeCells(cells, R = 3) {
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
  const pts = [...cells].map((k) => k.split(',').map(Number));
  for (const [i, j] of pts) { i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j); }
  const pad = R + 1, W = i1 - i0 + 1 + 2 * pad, H = j1 - j0 + 1 + 2 * pad;
  const occ = new Uint8Array(W * H);
  for (const [i, j] of pts) occ[(j - j0 + pad) * W + (i - i0 + pad)] = 1;
  const grow = (src, r, val) => { // dilate cells equal to `val` by a (2r+1)² square
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (src[y * W + x] !== val) continue;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) out[yy * W + xx] = 1;
      }
    }
    return out;
  };
  const dil = grow(occ, R, 1);
  const outside = new Uint8Array(W * H), stack = [0];
  outside[0] = 1;
  while (stack.length) {
    const k = stack.pop(), x = k % W, y = (k - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy, kk = yy * W + xx;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || outside[kk] || dil[kk]) continue;
      outside[kk] = 1; stack.push(kk);
    }
  }
  const near = grow(outside, R, 1); // cells within R of the outside = the dilation ring, eroded back
  const out = new Set(cells);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x;
    if (!outside[k] && !near[k]) out.add(`${x - pad + i0},${y - pad + j0}`);
  }
  return out;
}

/**
 * Measured walking surface of a deck (bridge, dam crest, pier) over its plan polygon, in the structure's frame
 * (u along `rot`, v across), sampled every `step` m by raycasts on the finest LOD: per sample the highest
 * upward-facing surface under `hi`. The walking deck is the set of samples connected, in steps ≤ 2/3 `rail`, to the
 * deck's median level (a curved crest works); what is not connected (railings, parapets, lamp posts, end blocks) is
 * reported by `parapet`.
 * @returns {{heightAt: (x:number, z:number) => (number|null), parapet: (x:number, z:number) => boolean, samples: number}|null}
 */
function deckFieldRaw(root, poly, rot, hi, o = {}) {
  const step = o.step ?? 0.35, rail = o.rail ?? 0.45, lo = o.lo ?? -3;
  const c = Math.cos(rot), s = Math.sin(rot);
  const cx = poly.reduce((t, p) => t + p[0], 0) / poly.length, cz = poly.reduce((t, p) => t + p[1], 0) / poly.length;
  const uv = poly.map(([x, z]) => [(x - cx) * c + (z - cz) * s, -(x - cx) * s + (z - cz) * c]);
  const pad = o.pad ?? 0;
  const u0 = Math.min(...uv.map((p) => p[0])) - pad, u1 = Math.max(...uv.map((p) => p[0])) + pad, v0 = Math.min(...uv.map((p) => p[1])) - pad, v1 = Math.max(...uv.map((p) => p[1])) + pad;
  const nu = Math.max(2, Math.ceil((u1 - u0) / step) + 1), nv = Math.max(2, Math.ceil((v1 - v0) / step) + 1);
  const H = new Float32Array(nu * nv).fill(NaN), meshes = finestMeshes(root);
  let n = 0;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u = u0 + ((u1 - u0) * i) / (nu - 1), v = v0 + ((v1 - v0) * j) / (nv - 1);
    const y = measureTop(root, cx + u * c - v * s, cz + u * s + v * c, lo, hi, meshes);
    if (y != null) { H[i * nv + j] = y; n++; }
  }
  if (!n) return null;
  // single-sample pits: a ray down a triangle seam of the top boards falls through to the planks beneath (M1 pier_n:
  // 9 cm under the snow cap at the pier's centre). A sample well below most of its 8 neighbours takes their median.
  const H0 = H.slice();
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const y = H0[i * nv + j], nb = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const ii = i + di, jj = j + dj, q = (di || dj) && ii >= 0 && jj >= 0 && ii < nu && jj < nv ? H0[ii * nv + jj] : NaN;
      if (q === q) nb.push(q);
    }
    if (nb.length < 6) continue;
    nb.sort((p, q) => p - q);
    const m = nb[nb.length >> 1];
    if (y !== y ? nb.length === 8 : y < m - 0.04 && nb.filter((q) => q > y + 0.04).length >= 6) { if (y !== y) n++; H[i * nv + j] = m; }
  }
  // walkable deck = the samples connected (4-neighbour steps ≤ `step`·… `rail`/1.5) to the deck's median level:
  // parapets, lamp posts, end blocks and drops off a curved crest are not reached (they become nav blocks)
  const all = [...H].filter((y) => y === y).sort((p, q) => p - q), med = all[(all.length - 1) >> 1];
  let seed = -1, best = Infinity;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const y = H[i * nv + j];
    if (y !== y) continue;
    const sc = Math.abs(y - med) + (Math.abs(i - nu / 2) / nu + Math.abs(j - nv / 2) / nv) * 0.05;
    if (sc < best) { best = sc; seed = i * nv + j; }
  }
  const ok = new Uint8Array(nu * nv), stack = [seed], maxStep = rail * 0.66;
  ok[seed] = 1;
  while (stack.length) {
    const k = stack.pop(), i = (k / nv) | 0, j = k % nv;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nu || jj >= nv) continue;
      const kk = ii * nv + jj, y = H[kk];
      if (ok[kk] || y !== y || Math.abs(y - H[k]) > maxStep) continue;
      ok[kk] = 1; stack.push(kk);
    }
  }
  const at = (x, z) => {
    const dx = x - cx, dz = z - cz, u = dx * c + dz * s, v = -dx * s + dz * c;
    if (u < u0 - 1e-6 || u > u1 + 1e-6 || v < v0 - 1e-6 || v > v1 + 1e-6) return null;
    const i = Math.round(((u - u0) / (u1 - u0 || 1)) * (nu - 1)), j = Math.round(((v - v0) / (v1 - v0 || 1)) * (nv - 1));
    return { y: H[i * nv + j], ok: ok[i * nv + j], i, j };
  };
  return {
    samples: n,
    /** Walking height on the deck (null off the visual: the ground's own height applies). */
    heightAt(x, z) {
      const r = at(x, z);
      if (!r || r.y !== r.y) return null;
      if (r.ok) return r.y;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { // beside a post: the deck
        const ii = r.i + di, jj = r.j + dj;
        if (ii >= 0 && jj >= 0 && ii < nu && jj < nv && ok[ii * nv + jj]) return H[ii * nv + jj];
      }
      return r.y;
    },
    /** Is (x, z) on the connected walking deck? */
    walkable(x, z) { const r = at(x, z); return !!r && !!r.ok; },
    /** Railings, parapets, lamp posts, end blocks: measured but not connected to the walking level. */
    parapet(x, z) { const r = at(x, z); return !!r && r.y === r.y && !r.ok; },
  };
}

const _n = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
/**
 * Low walkable surfaces of a structure's visual (steps, ramps, porch boards, snow skirts, berms): the highest
 * upward-facing triangle point per `cell` (m) square, for triangles lying entirely below `maxY` m. Feeds the
 * visual ground height (units' feet stand on these instead of sinking through them).
 * @param {THREE.Object3D} root @param {Map<string, number>} [into] accumulates across structures
 * @returns {Map<string, number>} "i,j" → world y
 */
function lowSurfacesRaw(root, o = {}, into = new Map()) {
  const maxY = o.maxY ?? 0.6, cell = o.cell ?? 0.2, gy = o.groundY ?? 0;
  root.updateMatrixWorld(true);
  const put = (x, z, y) => { const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`; const p = into.get(k); if (p === undefined || y > p) into.set(k, y); };
  const visit = (nd) => {
    if (nd.userData?.clip === false || (!nd.visible && !/^lod\d$/.test(nd.name))) return;
    if (/^lod[12]$/.test(nd.name)) {
      const sib = nd.parent?.children || [];
      if (nd.name !== ['lod0', 'lod1', 'lod2'].find((nm) => sib.some((c) => c.name === nm))) return;
    }
    if (nd.isMesh && !SKIP.test(nd.name || '') && nd.geometry?.attributes?.position) for (const m of meshMatrices(nd)) {
      const pos = nd.geometry.attributes.position, idx = nd.geometry.index;
      const count = idx ? idx.count : pos.count;
      for (let t = 0; t + 2 < count; t += 3) {
        const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
        _a.fromBufferAttribute(pos, i0).applyMatrix4(m); _b.fromBufferAttribute(pos, i1).applyMatrix4(m); _c.fromBufferAttribute(pos, i2).applyMatrix4(m);
        if (Math.max(_a.y, _b.y, _c.y) - gy > maxY || Math.max(_a.y, _b.y, _c.y) - gy < 0.02) continue;
        _n.crossVectors(_e1.subVectors(_b, _a), _e2.subVectors(_c, _a));
        const L = _n.length();
        if (L < 1e-9 || Math.abs(_n.y / L) < (o.flat ?? 0.5)) continue; // walls / risers: not a surface to stand on
        const len = Math.max(_a.distanceTo(_b), _b.distanceTo(_c), _c.distanceTo(_a)), n = Math.min(200, Math.max(1, Math.ceil(len / (cell * 0.5))));
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
          const u = i / n, v = j / n, w = 1 - u - v;
          put(_a.x * u + _b.x * v + _c.x * w, _a.z * u + _b.z * v + _c.z * w, _a.y * u + _b.y * v + _c.y * w);
        }
      }
    }
    for (const ch of nd.children) visit(ch);
  };
  visit(root);
  return into;
}

// ---- session memo (engine/asset-cache.js) ---------------------------------------------------------------------
// The analyses above are pure functions of a structure's render geometry and world placement. A restart / reload of
// the same mission builds the same structures from the same cached templates (shared geometry), so each result is
// keyed by a signature of the subtree — node names, visibility, clip flags, geometry identity + version, world
// matrices, instance matrices — plus the call's options. Results are copied out, so callers may mutate them.

/** Bits of an attribute's array (interleaved: the whole buffer) as 32-bit words when aligned, else bytes. */
function attrWords(a) {
  const arr = a.isInterleavedBufferAttribute ? a.data.array : a.array;
  if (!arr?.buffer) return null;
  return arr.byteLength % 4 === 0 && arr.byteOffset % 4 === 0 ? new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength >> 2) : new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
const _geoHash = new WeakMap(); // geometry → {pv, iv, hash}
/** Content hash of a geometry's positions + index (memoised per geometry object and attribute version). */
export function geometryHash(g) {
  const pos = g?.attributes?.position, idx = g?.index;
  if (!pos) return null;
  const pv = pos.isInterleavedBufferAttribute ? pos.data.version : pos.version, iv = idx ? idx.version : -1;
  const c = _geoHash.get(g);
  if (c && c.pv === pv && c.iv === iv && c.pos === pos && c.idx === idx) return c.hash;
  const h = hasher();
  const words = attrWords(pos);
  if (!words) return null;
  h.num(pos.count); h.num(pos.itemSize); h.num(pos.offset ?? 0); h.num(pos.data?.stride ?? 0); h.num(pos.normalized ? 1 : 0); h.str(pos.array?.constructor?.name || pos.data?.array?.constructor?.name);
  h.words(words);
  if (idx) { const iw = attrWords(idx); if (!iw) return null; h.num(idx.count); h.words(iw); }
  const hash = h.hex();
  _geoHash.set(g, { pv, iv, pos, idx, hash });
  return hash;
}

/** Signature of everything the analyses read from a structure's subtree (null: not cacheable). */
export function visualSignature(root) {
  if (!root?.isObject3D) return null;
  root.updateMatrixWorld(true);
  const h = hasher();
  let ok = true;
  const visit = (n) => {
    h.str(n.name); h.num(n.visible ? 1 : 0); h.num(n.userData?.clip === false ? 1 : 0); h.num(n.children.length);
    if (n.isMesh) {
      const g = n.geometry, pos = g?.attributes?.position;
      const gh = pos ? geometryHash(g) : null;
      if (!gh) ok = false; else h.str(gh);
      h.num(n.isInstancedMesh ? n.count : -1);
      if (n.isInstancedMesh) h.floats(n.instanceMatrix.array.subarray(0, n.count * 16));
      h.floats(n.matrixWorld.elements);
    }
    for (const c of n.children) visit(c);
  };
  visit(root);
  return ok ? h.hex() : null;
}

/**
 * Signature of what a camera would draw of `root`: every visible mesh / line / point set (subtrees in `skip` or
 * invisible are left out) by content-hashed geometry, world matrix and instance matrices. Null when something drawn
 * is not a pure function of its geometry (skinned or morphed meshes): such a scene is not cacheable.
 */
export function sceneSignature(root, skip = null) {
  if (!root?.isObject3D) return null;
  root.updateMatrixWorld(true);
  const h = hasher();
  let ok = true;
  const visit = (n) => {
    if (!ok) return;
    if (!n.visible || skip?.has(n)) { h.num(-7); return; }
    if (n.isMesh || n.isLine || n.isPoints) {
      if (n.isSkinnedMesh || n.morphTargetInfluences?.length) { ok = false; return; }
      const gh = geometryHash(n.geometry);
      if (!gh) { ok = false; return; }
      h.str(gh); h.floats(n.matrixWorld.elements);
      if (n.isInstancedMesh) { h.num(n.count); h.floats(n.instanceMatrix.array.subarray(0, n.count * 16)); }
    }
    h.num(n.children.length);
    for (const c of n.children) visit(c);
  };
  visit(root);
  return ok ? h.hex() : null;
}

const optKey = (o) => JSON.stringify(o, (k, v) => (typeof v === 'function' ? undefined : v));
function memoVisual(kind, root, args, compute, bytes) {
  const sig = visualSignature(root);
  if (!sig) return compute();
  return sessionCache.memo(`visual:${kind}:${sig}:${optKey(args)}`, compute, { bytes });
}
const arrBytes = (v) => (v ? JSON.stringify(v).length * 2 : 0);
const mapBytes = (m) => m.size * 64;

export function planHull(root, o = {}) {
  const v = memoVisual('hull', root, o, () => planHullRaw(root, o), arrBytes);
  return v && v.map((p) => p.slice());
}

export function planCells(root, o = {}) {
  const v = memoVisual('cells', root, o, () => planCellsRaw(root, o), arrBytes);
  return v && v.map((r) => r.map((p) => p.slice()));
}

export function overheadCells(root, o = {}, into = new Map()) {
  const v = memoVisual('overhead', root, o, () => overheadCellsRaw(root, o, new Map()), mapBytes);
  for (const [k, [lo, hi]] of v) {
    const p = into.get(k);
    if (!p) into.set(k, [lo, hi]); else { if (lo < p[0]) p[0] = lo; if (hi > p[1]) p[1] = hi; }
  }
  return into;
}

/** `o.surfKey`: identity of `surf` (the walking surface it samples); without one the result is not cached. */
export function standingCells(root, surf, o = {}, into = new Set()) {
  if (o.surfKey == null) return standingCellsRaw(root, surf, o, into);
  const v = memoVisual('standing', root, o, () => standingCellsRaw(root, surf, o, new Set()), (s) => s.size * 48);
  for (const k of v) into.add(k);
  return into;
}

export function deckField(root, poly, rot, hi, o = {}) {
  // the field only closes over its own sample arrays: shared as is
  return memoVisual('deck', root, { poly, rot, hi, o }, () => deckFieldRaw(root, poly, rot, hi, o), (d) => (d ? d.samples * 8 + 256 : 0));
}

export function lowSurfaces(root, o = {}, into = new Map()) {
  const v = memoVisual('low', root, o, () => lowSurfacesRaw(root, o, new Map()), mapBytes);
  for (const [k, y] of v) { const p = into.get(k); if (p === undefined || y > p) into.set(k, y); }
  return into;
}
