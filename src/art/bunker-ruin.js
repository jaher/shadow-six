/**
 * Demolished bunker / casemate look (M3 review: "the bunker should be destroyed but not completely charred and
 * black"). Applied over a structure's visual once it is blown up — the library's modelled ruin when the asset has one
 * (bunker_destroyed, casemate_destroyed …), else the intact model:
 *  - the roof caves in round the blast: the model's own vertices above mid-height sag towards the charge (a jagged,
 *    position-hashed drop, so split hard-edge vertices move together and no seam opens), walls tilt in at their tops;
 *  - broken roof slabs lean into the cave, bent reinforcing bars stick out of the slab edges and the cave rim;
 *  - concrete rubble on the cave floor and thrown round the walls, most of it on the side of the blast;
 *  - soot only round the blast and the openings (door, firing slit): a world-space shader darkening with a ragged
 *    edge, the concrete elsewhere keeps its colour — never the old uniformly black, squashed model.
 * Pure three.js; deterministic (seeded by the structure id). Geometries / materials touched are cloned (library
 * assets share theirs between instances).
 * @module art/bunker-ruin
 */

import * as THREE from 'three';

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1e6) / 1e6;
}
function rngOf(seed) {
  let s = Math.floor(seed * 2147483646) + 1;
  return () => ((s = (s * 48271) % 2147483647) / 2147483647);
}
/** Position hash (1 cm grid): the same corner of two split faces gets the same jag. */
function posHash(x, y, z) {
  const k = `${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)}`;
  return hash01(k);
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * 1 → 4 midpoint subdivision of the triangles of non-indexed geometry `g` that `near(a, b, c)` (world corners)
 * selects, until their longest edge is under `maxEdge` m (world) or `levels` run out: a big flat roof is two
 * triangles, and a cave needs corners to move. Neighbours split alike share their midpoints (no seams); every
 * attribute is interpolated; material groups are kept. @returns {THREE.BufferGeometry} a new geometry
 */
function tessellate(g, mw, near, maxEdge, levels, budget = 120000) {
  const names = Object.keys(g.attributes), attrs = names.map((n) => g.attributes[n]);
  const pos = g.attributes.position;
  const groups = g.groups.length ? g.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
  const out = attrs.map(() => []);
  const newGroups = [];
  let n = 0;
  const read = (i) => attrs.map((a) => { const v = []; for (let c = 0; c < a.itemSize; c++) v.push(a.getComponent(i, c)); return v; });
  const mid = (A, B) => A.map((va, k) => va.map((x, c) => (x + B[k][c]) / 2));
  const W = (A) => new THREE.Vector3(A[0][0], A[0][1], A[0][2]).applyMatrix4(mw);
  const push = (A) => { A.forEach((v, k) => out[k].push(...v)); n++; };
  const split = (A, B, C, lv) => {
    if (lv < levels && n < budget) {
      const a = W(A), b = W(B), c = W(C);
      const e = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
      if (e > maxEdge && near(a, b, c, e)) {
        const ab = mid(A, B), bc = mid(B, C), ca = mid(C, A);
        split(A, ab, ca, lv + 1); split(ab, B, bc, lv + 1); split(ca, bc, C, lv + 1); split(ab, bc, ca, lv + 1);
        return;
      }
    }
    push(A); push(B); push(C);
  };
  for (const gr of groups) {
    const start = n;
    const end = Math.min(pos.count, gr.start + gr.count);
    for (let t = gr.start; t + 2 < end; t += 3) split(read(t), read(t + 1), read(t + 2), 0);
    newGroups.push({ start, count: n - start, materialIndex: gr.materialIndex ?? 0 });
  }
  const r = new THREE.BufferGeometry();
  names.forEach((nm, k) => r.setAttribute(nm, new THREE.Float32BufferAttribute(out[k], attrs[k].itemSize)));
  if (g.groups.length) for (const gr of newGroups) r.addGroup(gr.start, gr.count, gr.materialIndex);
  return r;
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  // a jagged concrete chunk (rubble) and a fractured slab: noisy low-poly solids
  const chunk = new THREE.IcosahedronGeometry(1, 0);
  const p = chunk.attributes.position, r = rngOf(0.37);
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, [0.65 + r() * 0.55, 0.55 + r() * 0.5, 0.7 + r() * 0.5]);
    const [a, b, c] = seen.get(key);
    p.setXYZ(i, p.getX(i) * a, p.getY(i) * b * 0.7, p.getZ(i) * c);
  }
  chunk.computeVertexNormals();
  const slab = new THREE.BoxGeometry(1, 1, 1, 3, 1, 3);
  const q = slab.attributes.position, seen2 = new Map(), r2 = rngOf(0.71);
  for (let i = 0; i < q.count; i++) {
    const x = q.getX(i), y = q.getY(i), z = q.getZ(i);
    const key = `${x.toFixed(3)},${z.toFixed(3)}`;
    const edge = Math.abs(x) > 0.49 || Math.abs(z) > 0.49;
    if (!seen2.has(key)) seen2.set(key, edge ? [(r2() - 0.5) * 0.28, (r2() - 0.5) * 0.28] : [0, 0]);
    const [dx, dz] = seen2.get(key);
    q.setXYZ(i, x + dx, y, z + dz);
  }
  slab.computeVertexNormals();
  SHARED = {
    chunk, slab,
    concrete: new THREE.MeshStandardMaterial({ color: 0x86837c, roughness: 0.95, metalness: 0 }),
    concreteDark: new THREE.MeshStandardMaterial({ color: 0x67635d, roughness: 0.97, metalness: 0 }),
    hole: new THREE.MeshStandardMaterial({ color: 0x1b1916, roughness: 1, metalness: 0 }),
    rebar: new THREE.MeshStandardMaterial({ color: 0x7d4b2b, roughness: 0.8, metalness: 0.1 }),
  };
  for (const m of [SHARED.concrete, SHARED.concreteDark, SHARED.rebar]) m.userData.shared = true;
  for (const g of [chunk, slab]) g.userData.shared = true;
  return SHARED;
}

/** Soot patch: world-space darkening round up to 4 points (xyz, radius), ragged by value noise. */
function sootMaterial(m, pts) {
  const t = m.clone();
  t.name = `${m.name}#soot`;
  t.userData.shared = false;
  const arr = [0, 1, 2, 3].map((k) => (pts[k] ? new THREE.Vector4(pts[k][0], pts[k][1], pts[k][2], pts[k][3]) : new THREE.Vector4(0, -999, 0, 0.001)));
  const prev = m.onBeforeCompile;
  t.onBeforeCompile = (sh, r) => {
    prev?.call(t, sh, r);
    sh.uniforms.uSoot = { value: arr };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSootW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSootW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vSootW; uniform vec4 uSoot[4];
float sootH(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float sootN(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(sootH(i),sootH(i+vec3(1,0,0)),f.x),mix(sootH(i+vec3(0,1,0)),sootH(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(sootH(i+vec3(0,0,1)),sootH(i+vec3(1,0,1)),f.x),mix(sootH(i+vec3(0,1,1)),sootH(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{ float s = 0.0; float n = sootN(vSootW * 2.3) * 0.6 + sootN(vSootW * 6.1) * 0.4;
  for (int k = 0; k < 4; k++) { float d = length(vSootW - uSoot[k].xyz) / uSoot[k].w; s = max(s, 1.0 - smoothstep(0.35, 1.0, d + (n - 0.5) * 0.55)); }
  diffuseColor.rgb *= mix(1.0, 0.16, s * 0.92); }`);
  };
  const key = prev && m.customProgramCacheKey ? m.customProgramCacheKey() : '';
  t.customProgramCacheKey = () => `${key}|soot4`;
  return t;
}

/**
 * Wreck `root` (a building / prop Object3D in the scene graph, matrices current) in place.
 * @param {THREE.Object3D} root the visual to deform and soot (all its meshes, incl. LODs attached later via `watch`)
 * @param {THREE.Object3D} host where the dressing group goes (the structure's outer group)
 * @param {{id?: string, centre: number[], x0: number, z0: number, w: number, d: number, rot?: number,
 *   openings?: number[][], theater?: string, height?: number, reskin?: (m: THREE.Material) => THREE.Material,
 *   groundY?: (x: number, z: number) => number}} o centre [x, z] (the charge; world), footprint centre x0, z0 and
 *   w × d (m), openings [[x, y, z], …] (world: door, firing slit), height of the model (m), material swap
 * @returns {{group: THREE.Group, deform: (o3: THREE.Object3D) => void}} `deform` re-applies to late LODs
 */
export function wreckBunker(root, host, o) {
  const S = shared();
  const seed = hash01(String(o.id ?? `${o.centre}`));
  const rnd = rngOf(seed);
  root.updateMatrixWorld(true);
  // (the modelled ruin may still be loading: its height comes from the sidecar, its foot is the root's origin)
  const base = root.getWorldPosition(new THREE.Vector3()).y;
  const box = new THREE.Box3().setFromObject(root);
  const top = o.height != null ? base + o.height : Math.max(base + 1.2, box.max.y);
  // the roof caves in over the room, between the charge and the middle of the footprint
  const cx = (o.centre[0] + (o.x0 ?? o.centre[0])) / 2, cz = (o.centre[1] + (o.z0 ?? o.centre[1])) / 2;
  const R = Math.max(1.6, 0.56 * Math.min(o.w, o.d)); // cave radius (plan)
  const depth = Math.min(1.8, 0.55 * (top - base)); // how far its middle drops
  const y0 = base + 0.35 * (top - base); // nothing below a third of the height moves
  const soot = [[o.centre[0], base + 1.0, o.centre[1], 2.4], [cx, top - depth * 0.55, cz, R * 1.15], ...(o.openings || []).slice(0, 2).map((q) => [q[0], q[1], q[2], 1.35])];
  const mats = new Map();
  const v = new THREE.Vector3(), inv = new THREE.Matrix4();
  const deform = (o3) => {
    o3.updateMatrixWorld(true);
    o3.traverse((m) => {
      if (!m.isMesh || m.userData.ruined || !m.geometry?.attributes?.position) return;
      m.userData.ruined = true;
      // soot on its own material copies (shared library materials stay clean for intact instances)
      const swap = (mt0) => {
        const mt = o.reskin ? o.reskin(mt0) : mt0;
        if (!mt || !mt.isMeshStandardMaterial) return mt;
        if (!mats.has(mt)) mats.set(mt, sootMaterial(mt, soot));
        return mats.get(mt);
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
      if (m.isInstancedMesh || m.isSkinnedMesh) return;
      // per corner (non-indexed copy: a corner shared by the roof and a wall gets its own normal per face)
      const src = m.geometry;
      const flat = src.index ? src.toNonIndexed() : src;
      // fine enough triangles over the cave (its rim and a margin) for the corners to drop
      const g = tessellate(flat, m.matrixWorld, (a, b, c, e) => Math.max(a.y, b.y, c.y) > y0
        && Math.min(Math.hypot(a.x - cx, a.z - cz), Math.hypot(b.x - cx, b.z - cz), Math.hypot(c.x - cx, c.z - cz)) < R + e, 0.32, 6);
      if (flat !== src) flat.dispose();
      g.userData.shared = false;
      const p = g.attributes.position, nrm = g.attributes.normal;
      inv.copy(m.matrixWorld).invert();
      const movedV = new Uint8Array(p.count);
      let moved = false;
      for (let i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m.matrixWorld);
        if (v.y <= y0) continue;
        const dPlan = Math.hypot(v.x - cx, v.z - cz);
        const f = 1 - smooth(R * 0.25, R, dPlan);
        if (f <= 0) continue;
        const h = posHash(v.x, v.y, v.z);
        const up = Math.min(1, (v.y - y0) / Math.max(0.3, top - y0));
        v.y -= depth * f * up * (0.7 + 0.6 * h);
        // tops lean in towards the blast a little (the cave pulls its rim)
        const pull = 0.22 * f * up * (0.5 + h);
        if (dPlan > 1e-3) { v.x += ((cx - v.x) / dPlan) * pull; v.z += ((cz - v.z) / dPlan) * pull; }
        v.applyMatrix4(inv);
        p.setXYZ(i, v.x, v.y, v.z);
        movedV[i] = 1; moved = true;
      }
      if (!moved) { g.dispose(); return; }
      // a moved face takes its new plane's normal, turned to the side its old normal faced (the exported winding is
      // not always consistent: the model's normals are the truth); untouched faces keep theirs
      if (nrm) {
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), n0 = new THREE.Vector3();
        for (let t = 0; t + 2 < p.count; t += 3) {
          if (!movedV[t] && !movedV[t + 1] && !movedV[t + 2]) continue;
          a.fromBufferAttribute(p, t); b.fromBufferAttribute(p, t + 1); c.fromBufferAttribute(p, t + 2);
          n.subVectors(c, b).cross(a.sub(b));
          if (n.lengthSq() < 1e-12) continue;
          n.normalize();
          n0.fromBufferAttribute(nrm, t).add(b.fromBufferAttribute(nrm, t + 1)).add(c.fromBufferAttribute(nrm, t + 2));
          if (n.dot(n0) < 0) n.negate();
          for (let k = 0; k < 3; k++) nrm.setXYZ(t + k, n.x, n.y, n.z);
        }
        nrm.needsUpdate = true;
      } else g.computeVertexNormals();
      g.computeBoundingSphere(); g.computeBoundingBox();
      m.geometry = g;
    });
  };
  deform(root);

  // --- dressing (world positions → host-local)
  const group = new THREE.Group();
  group.name = 'bunker_ruin';
  host.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(host.matrixWorld).invert();
  const hostQ = new THREE.Quaternion(); host.getWorldQuaternion(hostQ); hostQ.invert();
  const hostS = new THREE.Vector3(); host.getWorldScale(hostS);
  const place = (obj, x, y, z, q, sc = 1) => {
    obj.position.set(x, y, z).applyMatrix4(toLocal);
    obj.quaternion.copy(hostQ).multiply(q);
    obj.scale.multiplyScalar(sc).divide(hostS);
    group.add(obj);
  };
  const caveY = top - depth * 0.85;
  const rot = o.rot ?? 0;
  const snowy = o.theater === 'snow';
  // broken roof slabs leaning into the cave (their outer edge up on the rim, the inner end down in the hole)
  const nSlab = 4 + Math.floor(rnd() * 2);
  const edges = [];
  for (let k = 0; k < nSlab; k++) {
    const a = rot + (k / nSlab) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
    const rr = R * (0.45 + rnd() * 0.25);
    const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
    const L = 0.9 + rnd() * 0.7, W = 0.7 + rnd() * 0.5, T = 0.2 + rnd() * 0.08;
    const m = new THREE.Mesh(S.slab, k % 2 ? S.concreteDark : S.concrete);
    m.scale.set(L, T, W);
    const tilt = 0.35 + rnd() * 0.4; // its inner end drops
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0, 'YXZ'))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt));
    m.castShadow = true; m.receiveShadow = true;
    place(m, x, caveY + 0.35 + rnd() * 0.15, z, q);
    edges.push({ x: x + Math.cos(a) * L * 0.45, z: z + Math.sin(a) * L * 0.45, y: caveY + 0.35 + Math.sin(tilt) * L * 0.45, a });
  }
  // the hole in the middle of the cave: the dark room under the broken slabs
  {
    const n = 11, pts = [];
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, r0 = R * (0.3 + rnd() * 0.16); pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0)); }
    const hg = new THREE.ShapeGeometry(new THREE.Shape(pts));
    hg.rotateX(-Math.PI / 2); hg.userData.shared = false;
    const hm = new THREE.Mesh(hg, S.hole);
    hm.receiveShadow = true;
    place(hm, cx, top - depth * 0.92, cz, new THREE.Quaternion());
  }
  // reinforcing bars: bent rods out of the slab ends and the cave rim
  const nBar = 22 + Math.floor(rnd() * 8);
  for (let k = 0; k < nBar; k++) {
    const e = k < edges.length * 3 ? edges[k % edges.length] : null;
    const a = e ? e.a + (rnd() - 0.5) * 0.9 : rot + rnd() * Math.PI * 2;
    const rr = e ? 0 : R * (0.75 + rnd() * 0.3);
    const bx = e ? e.x + (rnd() - 0.5) * 0.5 : cx + Math.cos(a) * rr, bz = e ? e.z + (rnd() - 0.5) * 0.5 : cz + Math.sin(a) * rr;
    const by = e ? e.y : top - depth * 0.3 * rnd();
    const len = 0.35 + rnd() * 0.6, bend = (rnd() - 0.3) * 0.9;
    const dir = new THREE.Vector3(Math.cos(a) * 0.6, 0.6 + rnd() * 0.5, Math.sin(a) * 0.6).normalize();
    const p0 = new THREE.Vector3(0, 0, 0), p1 = dir.clone().multiplyScalar(len * 0.5);
    const p2 = p1.clone().add(new THREE.Vector3(dir.x * len * 0.5, -bend * len * 0.6, dir.z * len * 0.5));
    const tube = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, p1, p2), 6, 0.018 + rnd() * 0.008, 5, false);
    tube.userData.shared = false;
    const m = new THREE.Mesh(tube, S.rebar);
    place(m, bx, by, bz, new THREE.Quaternion());
  }
  // rubble: on the cave floor and thrown round the walls (two thirds towards the blast side of the footprint)
  const nRub = 70;
  const inst = new THREE.InstancedMesh(S.chunk, S.concrete, nRub);
  inst.castShadow = true; inst.receiveShadow = true;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), Sc = new THREE.Vector3(), E = new THREE.Euler();
  const ca = Math.cos(rot), sa = Math.sin(rot), hw = o.w / 2, hd = o.d / 2;
  const col = new THREE.Color();
  for (let k = 0; k < nRub; k++) {
    let x, y, z;
    if (k < 22) { // in the cave
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * R * 0.8;
      x = cx + Math.cos(a) * rr; z = cz + Math.sin(a) * rr; y = caveY + 0.1 + rnd() * 0.25;
    } else { // round the walls: a point on the footprint's edge, pushed out
      const side = Math.floor(rnd() * 4), u = rnd() * 2 - 1, out = 0.2 + Math.pow(rnd(), 1.6) * 2.6;
      let lx = side < 2 ? (side ? hw + out : -hw - out) : u * (hw + 0.4), lz = side < 2 ? u * (hd + 0.4) : (side === 2 ? hd + out : -hd - out);
      x = o.x0 + lx * ca - lz * sa; z = o.z0 + lx * sa + lz * ca;
      // most of it lands on the blast side
      if (rnd() < 0.55) { x = x * 0.5 + (cx + (x - cx) * 1.15) * 0.5; z = z * 0.5 + (cz + (z - cz) * 1.15) * 0.5; }
      y = (o.groundY?.(x, z) ?? 0) + 0.04;
    }
    const s = 0.1 + Math.pow(rnd(), 2) * 0.38;
    E.set(rnd() * 3, rnd() * 6.28, rnd() * 3);
    Q.setFromEuler(E);
    P.set(x, y + s * 0.3, z).applyMatrix4(toLocal);
    Sc.set(s, s, s).divide(hostS);
    M.compose(P, hostQ.clone().multiply(Q), Sc);
    inst.setMatrixAt(k, M);
    const g = 0.78 + rnd() * 0.3;
    inst.setColorAt(k, col.setRGB(g, g * 0.985, g * 0.96).multiplyScalar(snowy && k >= 22 && rnd() < 0.3 ? 1.15 : 1));
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  group.add(inst);
  host.add(group);
  return { group, deform };
}
