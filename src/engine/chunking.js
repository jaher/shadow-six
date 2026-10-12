/**
 * Spatial chunking of big static meshes (render efficiency): three.js culls whole objects against each camera's frustum,
 * so a 630k-triangle map-wide terrain mesh is drawn in full by every pass (world, AO prepass, water mirror) although the
 * view shows a tenth of it. `chunkMesh` splits such a mesh into square cells of `cell` metres (world XZ) that are culled
 * one by one, by every camera (main, sun shadow, water mirror, scope lens).
 *
 * The pixels do not change: every chunk draws the same vertices with the same material, and the triangles inside a chunk
 * keep their original order. How:
 *  - the geometry's index is reordered in place, triangles grouped by (geometry group, cell row, cell column), stable
 *    within a cell; its bounds are those of its triangles, padded by `pad` m for vertex-shader displacement (trail ruts);
 *  - one child Mesh per ROW of cells (a strip along world X) whose own BufferGeometry SHARES the parent's attributes and
 *    index (one GPU copy). It is culled by its box; just before it draws (onBeforeRender / onBeforeShadow, for whichever
 *    camera draws it: frame, sun shadow, water mirror, scope lens) its draw range is cut to the span from the first to
 *    the last of its cells inside that camera's frustum — the view is convex, so the cells in between are in view too.
 *    One draw per visible row instead of one per cell;
 *  - the original mesh stays where it was (same object, name, handle references) but is no longer drawn itself
 *    (`isMesh = false`): three renders its children. Its material / castShadow / receiveShadow / renderOrder setters
 *    forward to the rows, `visible` and transforms are inherited; a geometry swap unchunks it.
 * Rows never answer a raycast themselves: the proxy's raycast tests the cells the ray crosses (bounds first, then their
 * triangles) and reports the hits as its own, so recursive raycasts see each triangle once, and quickly.
 *
 * `unchunkMesh(proxy)` restores the original object.
 * @module engine/chunking
 */
import * as THREE from 'three';
import { extraCull } from './cull-hooks.js';

const FORWARD = ['geometry', 'material', 'castShadow', 'receiveShadow', 'renderOrder', 'customDepthMaterial', 'customDistanceMaterial'];
const noRaycast = () => {};
/** Chunk culling by its world box (static chunk: the box is cached against its world matrix). */
function boxInFrustum(frustum) {
  const e = this.matrixWorld.elements, c = (this._wb ||= { box: new THREE.Box3(), key: NaN });
  const key = e[0] + e[5] * 3 + e[10] * 7 + e[12] * 11 + e[13] * 13 + e[14] * 17 + e[1] + e[2] + e[4];
  if (key !== c.key) { c.box.copy(this.geometry.boundingBox).applyMatrix4(this.matrixWorld); c.key = key; }
  return frustum.intersectsBox(c.box) && extraCull(this);
}

const _F = new THREE.Frustum(), _M = new THREE.Matrix4();
/** Cut a row's draw range (or its one group) to the span of its cells inside `camera`'s frustum (0 when none). */
function cutRow(m, camera, geometry, group) {
  const row = m.__row;
  if (!row || !camera?.projectionMatrix) return;
  _M.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _F.setFromProjectionMatrix(_M, camera.coordinateSystem, camera.reversedDepth);
  const e = m.matrixWorld.elements, key = e[0] + e[5] * 3 + e[10] * 7 + e[12] * 11 + e[13] * 13 + e[14] * 17 + e[1] + e[2] + e[4];
  let a = -1, b = -1;
  for (let i = 0; i < row.cells.length; i++) {
    const c = row.cells[i];
    if (c.wkey !== key) { (c.wbox ||= new THREE.Box3()).copy(c.box).applyMatrix4(m.matrixWorld); c.wkey = key; }
    if (_F.intersectsBox(c.wbox)) { if (a < 0) a = i; b = i; }
  }
  const start = a < 0 ? row.start : row.cells[a].start, count = a < 0 ? 0 : row.cells[b].start + row.cells[b].count - start;
  if (group) { group.start = start; group.count = count; } else { geometry.drawRange.start = start; geometry.drawRange.count = count; }
}

/** Triangles a mesh draws (index or position count / 3, all groups). */
export function meshTriangles(mesh) {
  const g = mesh.geometry;
  if (!g?.attributes?.position) return 0;
  return Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
}

/**
 * Can this mesh be chunked without any visible change? Static, opaque, frustum-culled, triangle mesh.
 * @param {THREE.Object3D} m
 */
export function chunkable(m) {
  if (!m?.isMesh || m.isSkinnedMesh || m.isInstancedMesh || m.isBatchedMesh || m.userData?.chunks || m.userData?.noChunk) return false;
  if (m.frustumCulled === false) return false; // its owner knows its bounds lie (shader-displaced, …)
  const g = m.geometry;
  if (!g?.attributes?.position || g.isInstancedBufferGeometry) return false;
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return false;
  if (g.drawRange.start !== 0 || (g.drawRange.count !== Infinity && g.drawRange.count < (g.index ? g.index.count : g.attributes.position.count))) return false;
  // transparent objects are depth-sorted per object: splitting one would change the blend order
  for (const mat of [].concat(m.material)) if (!mat || mat.transparent || mat.wireframe) return false;
  return true;
}

/**
 * Split a static mesh into culled spatial chunks (see module doc). No-op (returns null) for a mesh that is not chunkable
 * or would make fewer than two chunks.
 * @param {THREE.Mesh} mesh (in its final place: its world matrix is used for the cell grid)
 * @param {{cell?: number, pad?: number}} [o]
 * @returns {THREE.Mesh[]|null} the chunk meshes
 */
export function chunkMesh(mesh, { cell = 24, pad = 1 } = {}) {
  if (!chunkable(mesh)) return null;
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  mesh.updateWorldMatrix(true, false);
  const mw = mesh.matrixWorld.elements;
  let index = geo.index;
  const nIdx = index ? index.count : pos.count;
  const nTri = Math.floor(nIdx / 3);
  if (nTri < 2) return null;
  const idx = index ? index.array : null;
  const vi = (k) => (idx ? idx[k] : k);
  // groups: a triangle outside every group is not drawn by three (material array) → kept out of the chunks
  const multi = Array.isArray(mesh.material);
  const groups = multi && geo.groups.length ? geo.groups : [{ start: 0, count: nIdx, materialIndex: 0 }];
  const triGroup = new Int32Array(nTri).fill(-1);
  groups.forEach((gr, gi) => {
    const a = Math.floor(gr.start / 3), b = Math.min(nTri, Math.floor((gr.start + Math.min(gr.count, nIdx - gr.start)) / 3));
    for (let t = a; t < b; t++) triGroup[t] = gi;
  });
  // cell of each triangle (world XZ of its centroid)
  const keyOf = new Map(); // `${gi}:${cx}:${cz}` → chunk number
  const chunks = [];
  const triChunk = new Int32Array(nTri);
  const P = pos.array, st = pos.isInterleavedBufferAttribute ? pos.data.stride : pos.itemSize, off = pos.isInterleavedBufferAttribute ? pos.offset : 0;
  const Parr = pos.isInterleavedBufferAttribute ? pos.data.array : P;
  for (let t = 0; t < nTri; t++) {
    const gi = triGroup[t];
    if (gi < 0) { triChunk[t] = -1; continue; }
    let x = 0, y = 0, z = 0;
    for (let c = 0; c < 3; c++) {
      const v = vi(t * 3 + c) * st + off;
      x += Parr[v]; y += Parr[v + 1]; z += Parr[v + 2];
    }
    x /= 3; y /= 3; z /= 3;
    const wx = mw[0] * x + mw[4] * y + mw[8] * z + mw[12], wz = mw[2] * x + mw[6] * y + mw[10] * z + mw[14];
    const cx = Math.floor(wx / cell), cz = Math.floor(wz / cell), key = `${gi}:${cx}:${cz}`;
    let ci = keyOf.get(key);
    if (ci === undefined) { ci = chunks.length; keyOf.set(key, ci); chunks.push({ gi, cx, cz, n: 0, start: 0, box: new THREE.Box3() }); }
    chunks[ci].n++;
    triChunk[t] = ci;
  }
  if (chunks.length < 2) return null;
  // chunk order: by group, then row (z), then column (x): a row's cells are contiguous, west to east
  const order = chunks.map((_, i) => i).sort((a, b) => chunks[a].gi - chunks[b].gi || chunks[a].cz - chunks[b].cz || chunks[a].cx - chunks[b].cx);
  let at = 0;
  for (const ci of order) { chunks[ci].start = at; at += chunks[ci].n * 3; }
  const IA = nIdx > 65535 || (idx && idx instanceof Uint32Array) || pos.count > 65535 ? Uint32Array : Uint16Array;
  const out = new IA(at);
  const fill = chunks.map((c) => c.start);
  const mn = new Float64Array(chunks.length * 3).fill(Infinity), mx = new Float64Array(chunks.length * 3).fill(-Infinity);
  for (let t = 0; t < nTri; t++) {
    const ci = triChunk[t];
    if (ci < 0) continue;
    const b = ci * 3;
    for (let c = 0; c < 3; c++) {
      const v = vi(t * 3 + c);
      out[fill[ci]++] = v;
      const o = v * st + off;
      for (let a = 0; a < 3; a++) {
        const q = Parr[o + a];
        if (q < mn[b + a]) mn[b + a] = q;
        if (q > mx[b + a]) mx[b + a] = q;
      }
    }
  }
  chunks.forEach((c, i) => c.box.set(new THREE.Vector3(mn[i * 3], mn[i * 3 + 1], mn[i * 3 + 2]), new THREE.Vector3(mx[i * 3], mx[i * 3 + 1], mx[i * 3 + 2])));
  // the shared index (the proxy's geometry keeps raycasting / measuring the same triangles)
  const newIndex = new THREE.BufferAttribute(out, 1);
  geo.setIndex(newIndex);
  if (multi && geo.groups.length) {
    geo.clearGroups();
    let gStart = -1, gi = -1;
    for (const ci of order) {
      const c = chunks[ci];
      if (c.gi !== gi) {
        if (gi >= 0) geo.addGroup(gStart, c.start - gStart, groups[gi].materialIndex);
        gi = c.gi; gStart = c.start;
      }
    }
    if (gi >= 0) geo.addGroup(gStart, at - gStart, groups[gi].materialIndex);
  }
  geo.setDrawRange(0, Infinity);
  // rows: consecutive cells of one (group, z) strip
  const rows = [];
  for (const ci of order) {
    const c = chunks[ci], last = rows[rows.length - 1];
    c.count = c.n * 3;
    c.box.expandByScalar(pad);
    if (last && last.gi === c.gi && last.cz === c.cz) { last.cells.push(c); last.box.union(c.box); } else rows.push({ gi: c.gi, cz: c.cz, cells: [c], box: c.box.clone() });
  }
  if (rows.length < 2 && rows[0]?.cells.length < 2) return null;
  const meshes = [];
  const sphere = new THREE.Sphere();
  for (const row of rows) {
    const g = new THREE.BufferGeometry();
    for (const name in geo.attributes) g.setAttribute(name, geo.attributes[name]);
    g.setIndex(newIndex);
    const a = row.cells[0].start, n = row.cells[row.cells.length - 1].start + row.cells[row.cells.length - 1].count - a;
    if (multi && geo.groups.length) g.addGroup(a, n, groups[row.gi].materialIndex);
    else g.setDrawRange(a, n);
    row.start = a; row.count = n;
    g.boundingBox = row.box;
    g.boundingSphere = g.boundingBox.getBoundingSphere(sphere.clone());
    g.name = (geo.name || mesh.name || 'mesh') + ':row';
    g.userData.chunkOf = geo;
    const m = new THREE.Mesh(g, mesh.material);
    m.name = (mesh.name || 'mesh') + ':chunk';
    m.castShadow = mesh.castShadow; m.receiveShadow = mesh.receiveShadow; m.renderOrder = mesh.renderOrder;
    m.layers.mask = mesh.layers.mask;
    m.customDepthMaterial = mesh.customDepthMaterial; m.customDistanceMaterial = mesh.customDistanceMaterial;
    m.userData = mesh.userData; // aoExclude / aoMaterial / reflectCull … (shared object: later flags apply too)
    m.__row = row;
    const before = mesh.onBeforeRender, beforeShadow = mesh.onBeforeShadow;
    m.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
      cutRow(this, camera, geometry, group);
      before.call(this, renderer, scene, camera, geometry, material, group);
    };
    m.onBeforeShadow = function (renderer, object, camera, shadowCamera, geometry, depthMaterial, group) {
      cutRow(this, shadowCamera, geometry, group);
      beforeShadow.call(this, renderer, object, camera, shadowCamera, geometry, depthMaterial, group);
    };
    m.onAfterRender = mesh.onAfterRender;
    m.matrixAutoUpdate = false; // identity under the proxy
    m.raycast = noRaycast;
    m.intersectsFrustum = boxInFrustum; // the box, not its (much looser) bounding sphere
    meshes.push(m);
  }
  // proxy: the original object, not drawn itself; property writes reach the chunks
  const saved = {};
  for (const k of FORWARD) {
    saved[k] = mesh[k];
    let v = mesh[k];
    Object.defineProperty(mesh, k, {
      configurable: true, enumerable: true,
      get: () => v,
      set: (nv) => {
        v = nv;
        if (k === 'geometry') { if (nv !== geo) unchunkMesh(mesh); return; } // a geometry swap (wreck, LOD): draw it whole
        for (const m of meshes) m[k] = nv;
      },
    });
  }
  mesh.isMesh = false;
  // raycasts go through the cells: only those whose box the ray crosses test their triangles (a ray against the whole
  // 630k-triangle terrain took ~0.5 s); hits report the proxy, face indices are the shared index's
  const rayGeo = new THREE.BufferGeometry();
  for (const name in geo.attributes) rayGeo.setAttribute(name, geo.attributes[name]);
  rayGeo.setIndex(newIndex);
  const rayMesh = new THREE.Mesh(rayGeo);
  mesh.raycast = function chunkedRaycast(raycaster, intersects) {
    rayMesh.material = mesh.material;
    rayMesh.matrixWorld.copy(mesh.matrixWorld);
    for (const row of rows) for (const c of row.cells) {
      rayGeo.boundingBox = c.box;
      rayGeo.boundingSphere = c.sphere ||= c.box.getBoundingSphere(new THREE.Sphere());
      rayGeo.clearGroups();
      if (multi && geo.groups.length) { rayGeo.addGroup(c.start, c.count, groups[c.gi].materialIndex); rayGeo.setDrawRange(0, Infinity); } else rayGeo.setDrawRange(c.start, c.count);
      const k = intersects.length;
      THREE.Mesh.prototype.raycast.call(rayMesh, raycaster, intersects);
      for (let i = k; i < intersects.length; i++) intersects[i].object = mesh;
    }
  };
  mesh.__chunks = { meshes, saved, cell, rows };
  for (const m of meshes) { mesh.add(m); m.matrixWorld.copy(mesh.matrixWorld); }
  return meshes;
}

/** Undo chunkMesh: the original mesh draws itself again (its index stays reordered: same triangles). */
export function unchunkMesh(mesh) {
  const c = mesh?.__chunks;
  if (!c) return false;
  for (const m of c.meshes) mesh.remove(m);
  delete mesh.raycast; // Mesh.prototype.raycast again
  for (const k of FORWARD) { const v = mesh[k]; delete mesh[k]; mesh[k] = v; }
  mesh.isMesh = true;
  delete mesh.__chunks;
  return true;
}

/** Is this object a chunk proxy (a chunked mesh drawn through its children)? */
export const isChunked = (o) => !!o?.__chunks;

/**
 * Chunk every big static mesh under `root` (load time, once the map is built): at least `minTris` triangles and a
 * world XZ footprint of at least two cells. The cell size follows the mesh's triangle density — about `cellTris`
 * triangles a cell, between `cell` and `maxCell` m — so a coarse mesh (the scenery apron ring) gets few, large rows.
 * @returns {{meshes: number, chunks: number, tris: number, cells: number[]}}
 */
export function chunkLargeMeshes(root, { cell = 24, maxCell = 96, cellTris = 20000, minTris = 20000, pad = 1 } = {}) {
  const found = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!chunkable(o) || meshTriangles(o) < minTris) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
    const w = b.max.x - b.min.x, d = b.max.z - b.min.z;
    if (Math.max(w, d) < 2 * cell) return;
    found.push([o, Math.min(maxCell, Math.max(cell, Math.sqrt((cellTris * w * d) / meshTriangles(o))))]);
  });
  const st = { meshes: 0, chunks: 0, tris: 0, cells: [] };
  for (const [o, c] of found) {
    const ch = chunkMesh(o, { cell: c, pad });
    if (!ch) continue;
    st.meshes++; st.chunks += ch.length; st.tris += meshTriangles(o); st.cells.push(Math.round(c));
  }
  return st;
}
