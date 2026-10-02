/**
 * Geometry of the dam water FX (render/dam-water.js): the face sampler (raycasts on the dam's finest LOD in the
 * dam's own frame), ribbons that follow the face down to the water, and flat strips on the water (the burst's surge).
 * @module render/dam-water-geom
 */
import * as THREE from 'three';

/**
 * Raycast sampler of a dam's downstream face. Dam frame: u along the crest (local +X), v downstream (local +Z), y up
 * (world). `v(u, y)` = how far downstream the face is at that point (null where no concrete is hit).
 * @param {THREE.Object3D} root the structure's object3d
 * @param {{x:number, z:number, rot:number}} def
 */
export function faceSampler(root, def) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let p = o, lod = '';
    while (p) { if (/^lod\d$/.test(p.name)) { lod = p.name; break; } p = p.parent; }
    if (lod && lod !== 'lod0') return;
    if ([].concat(o.material).some((m) => /snow|decal|glass|rock|scree/.test(m?.name || ''))) return;
    meshes.push(o);
  });
  const c = Math.cos(def.rot ?? 0), s = Math.sin(def.rot ?? 0), X = def.x ?? 0, Z = def.z ?? 0;
  const world = (u, v) => [X + u * c - v * s, Z + u * s + v * c];
  const rc = new THREE.Raycaster(), o = new THREE.Vector3(), d = new THREE.Vector3(s, 0, -c); // towards upstream (−v)
  const cache = new Map();
  const v = (u, y) => {
    const key = `${u.toFixed(2)}|${y.toFixed(2)}`;
    if (cache.has(key)) return cache.get(key);
    const [x0, z0] = world(u, 40);
    o.set(x0, y, z0); rc.set(o, d); rc.far = 80;
    const h = rc.intersectObjects(meshes, false)[0];
    const r = h ? -(h.point.x - X) * s + (h.point.z - Z) * c : null;
    cache.set(key, r);
    return r;
  };
  return { v, world, meshes: meshes.length };
}

/**
 * Ribbon down the face: columns across [u0 − w/2, u0 + w/2], rows every `step` m from yTop to yBot, `off` m in front
 * of the face, with an optional sideways meander. Rows where the face is not found end the ribbon.
 * @returns {THREE.BufferGeometry|null} with `flow` (across 0..1, metres along) and userData.len
 */
export function faceRibbon(F, { u0, w, yTop, yBot, off = 0.05, step = 0.2, cols = 3, wobble = 0, seed = 0 }) {
  const pos = [], flow = [], rows = [];
  let along = 0, prev = null;
  for (let y = yTop; y >= yBot - 1e-6; y -= step) {
    const sway = wobble * Math.sin(y * 2.1 + seed) + wobble * 0.5 * Math.sin(y * 5.3 + seed * 1.7);
    const row = [];
    for (let k = 0; k < cols; k++) {
      const t = k / (cols - 1), u = u0 - w / 2 + w * t + sway, vf = F.v(u, y);
      if (vf == null) return finish();
      const [x, z] = F.world(u, vf + off);
      row.push([x, y, z, t]);
    }
    const mid = row[(cols - 1) >> 1];
    if (prev) along += Math.hypot(mid[0] - prev[0], mid[1] - prev[1], mid[2] - prev[2]);
    prev = mid;
    for (const [x, yy, z, t] of row) { pos.push(x, yy, z); flow.push(t, along); }
    rows.push(row);
  }
  return finish();
  function finish() {
    if (rows.length < 2) return null;
    const idx = [];
    for (let r = 0; r + 1 < rows.length; r++) for (let k = 0; k + 1 < cols; k++) {
      const a = r * cols + k, b = a + 1, c2 = a + cols, d2 = c2 + 1;
      idx.push(a, c2, b, b, c2, d2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
    g.setIndex(idx);
    g.userData.len = along;
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Flat strip on the water along a centreline (world x/z, at height y): width w0 at the start → w1 at the end.
 * `flow` x = metres across (centred), y = metres along.
 */
export function waterStrip(points, { y, w0, w1, step = 1, cols = 9 }) {
  const P = points.map((q) => (Array.isArray(q) ? q : [q.x, q.z]));
  let L = 0;
  const seg = [];
  for (let i = 0; i + 1 < P.length; i++) { const l = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); seg.push({ a: P[i], b: P[i + 1], l, s0: L }); L += l; }
  const pos = [], flow = [], n = Math.max(2, Math.ceil(L / step) + 1);
  for (let r = 0; r < n; r++) {
    const s = (L * r) / (n - 1), g = seg.find((q) => s <= q.s0 + q.l + 1e-6) || seg[seg.length - 1];
    const t = g.l ? (s - g.s0) / g.l : 0, x = g.a[0] + (g.b[0] - g.a[0]) * t, z = g.a[1] + (g.b[1] - g.a[1]) * t;
    const dx = (g.b[0] - g.a[0]) / (g.l || 1), dz = (g.b[1] - g.a[1]) / (g.l || 1), w = w0 + (w1 - w0) * (s / L);
    for (let k = 0; k < cols; k++) { const a = (k / (cols - 1) - 0.5) * w; pos.push(x - dz * a, y, z + dx * a); flow.push(a, s); }
  }
  const idx = [];
  for (let r = 0; r + 1 < n; r++) for (let k = 0; k + 1 < cols; k++) { const a = r * cols + k; idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
  g.setIndex(idx);
  g.userData.len = L;
  g.computeBoundingSphere();
  return g;
}
