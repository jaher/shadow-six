/**
 * Coplanar-face separation for library assets (user 2026-11-18: "Make sure there is no z-fighting in the geometry").
 *
 * Some kit GLBs carry faces that share a plane and overlap: a sill's top flush with the window recess floor, an
 * ashlar plinth top under a timber sole plate's top, a lintel's underside in a brick soffit, a painted board doubled
 * on itself (two copies with different UVs). The depth buffer cannot order them, so they flicker (stripes, speckles)
 * under the game camera. Found by tools/art/zfight.mjs (kinds a / b).
 *
 * separateCoplanar(root) finds every pair of same-facing triangles of the scene (any meshes, any materials) that lie
 * in one plane (within `gap`) and overlap by more than `minOverlap` m², groups the triangles into PATCHES (one mesh,
 * one material, one plane: they move together, so a patch never tears), splits a patch that overlaps itself (doubled
 * faces: the later copy becomes its own patch), and gives each patch a LAYER: the largest patch of a contact group
 * stays (layer 0), each smaller one takes the lowest layer none of its overlapping neighbours has. A patch on layer k
 * moves k × `lift` along its own normal (outwards, towards the viewer of that face): the smaller detail sits proud of
 * the larger surface, as a sill on its ledge. Moved triangles get their own vertices (copies with every attribute), so
 * nothing else shifts. Render only: the asset's nav sidecars, footprints and gameplay twins are untouched; the lift
 * (6 mm) is far below anything the eye reads at the game camera and far above its depth noise (≈ 0.05-0.3 mm).
 * @module art/coplanar-split
 */

import * as THREE from 'three';

const TOUCH = 0.0005; // m: a crossing face reaching less than this past the moved one only touches it
const PAD = 0.2; // m: how far past its faces a plane of the larger surface still counts (crossing pass)
const CAM_PITCH = (40 * Math.PI) / 180; // engine/camera.js: the game camera's fixed pitch
const NQ = 50;        // normal quantization (1/50 per component ≈ 1.1°)
const DQ = 0.004;     // plane offset bucket (m)

/** 2D area of the overlap of two coplanar triangles (Sutherland-Hodgman), in the plane with normal n. */
export function triOverlap(a, b, n) {
  return clipOverlap(a, b, n).area;
}

/** The overlap of triangles a and b seen along n: its area, its outline (2D, in the e1/e2 basis) and that basis. */
function clipOverlap(a, b, n) {
  const u = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const e1 = u.cross(n).normalize(), e2 = n.clone().cross(e1);
  const pj = (v) => [v.dot(e1), v.dot(e2)];
  const area = (p) => { let s = 0; for (let k = 0; k < p.length; k++) { const q = p[k], r = p[(k + 1) % p.length]; s += q[0] * r[1] - r[0] * q[1]; } return s / 2; };
  let poly = a.map(pj); const clip = b.map(pj);
  if (area(clip) < 0) clip.reverse();
  if (area(poly) < 0) poly.reverse();
  for (let k = 0; k < 3 && poly.length; k++) {
    const A = clip[k], B = clip[(k + 1) % 3];
    const side = (p) => (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]);
    const out = [];
    for (let m = 0; m < poly.length; m++) {
      const P1 = poly[m], P2 = poly[(m + 1) % poly.length];
      const s1 = side(P1), s2 = side(P2);
      const cut = () => { const t = s1 / (s1 - s2); return [P1[0] + t * (P2[0] - P1[0]), P1[1] + t * (P2[1] - P1[1])]; };
      if (s1 >= 0 && s2 >= 0) out.push(P2);
      else if (s1 >= 0) out.push(cut());
      else if (s2 >= 0) { out.push(cut()); out.push(P2); }
    }
    poly = out;
  }
  return { area: poly.length >= 3 ? Math.abs(area(poly)) : 0, poly, e1, e2 };
}

/** Over the overlap of a (plane n, d) and b (plane bn, bd) seen along n: the overlap area and the least / greatest
 *  height of b over a's plane, along n — where the two faces actually lie over each other, not over their planes. */
export function overlapGap(a, n, d, b, bn, bd) {
  const { area, poly, e1, e2 } = clipOverlap(a, b, n);
  let lo = Infinity, hi = -Infinity;
  const c = bn.dot(n);
  if (area > 0 && Math.abs(c) > 1e-6) for (const [x, y] of poly) {
    const t = (bd - bn.x * (e1.x * x + e2.x * y) - bn.y * (e1.y * x + e2.y * y) - bn.z * (e1.z * x + e2.z * y)) / c;
    const h = t - d; if (h < lo) lo = h; if (h > hi) hi = h;
  }
  return { area, lo, hi };
}

/** Triangles of every plain mesh under root, in root space. */
function gather(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const T = [];
  const meshes = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry?.getAttribute('position')) return;
    const g = o.geometry, P = g.getAttribute('position'), I = g.index, n = I ? I.count : P.count;
    const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const mi = meshes.length;
    meshes.push({ o, M });
    const groups = g.groups.length && Array.isArray(o.material) ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    for (const gr of groups) {
      for (let t = gr.start; t + 2 < Math.min(n, gr.start + gr.count); t += 3) {
        const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(P, I ? I.getX(t + k) : t + k).applyMatrix4(M));
        const nr = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
        const a2 = nr.length();
        if (a2 < 2e-6) continue;
        nr.divideScalar(a2);
        const lo = [0, 1, 2].map((c) => Math.min(v[0].getComponent(c), v[1].getComponent(c), v[2].getComponent(c)));
        const hi = [0, 1, 2].map((c) => Math.max(v[0].getComponent(c), v[1].getComponent(c), v[2].getComponent(c)));
        const mat = gr.materialIndex ?? 0, mname = (Array.isArray(o.material) ? o.material[mat] : o.material)?.name || '';
        T.push({ mi, mat, mname, t, v, n: nr, d: nr.dot(v[0]), area: a2 / 2, lo, hi });
      }
    }
  });
  return { T, meshes };
}

/**
 * Overlapping coplanar same-facing triangle pairs [{i, j, ov}] of gather()'s list.
 * @param {{cos?:number, gap?:number, minOverlap?:number}} [o]
 */
export function coplanarPairs(T, o = {}) {
  const cos = o.cos ?? 0.9995, gap = o.gap ?? 0.002, minOv = o.minOverlap ?? 1e-4;
  const qn = (x) => Math.round(x * NQ), qd = (d) => Math.round(d / DQ);
  // numeric cell key: 3 × 7 bits of normal + 21 bits of plane offset (±4 km at 4 mm)
  const key = (x, y, z, d) => (((x + 64) * 128 + (y + 64)) * 128 + (z + 64)) * 2097152 + (d + 1048576);
  const B = new Map();
  T.forEach((tr, i) => { const k = key(qn(tr.n.x), qn(tr.n.y), qn(tr.n.z), qd(tr.d)); let l = B.get(k); if (!l) B.set(k, l = []); l.push(i); });
  const pairs = [];
  const cand = new Set();
  for (let i = 0; i < T.length; i++) {
    const a = T[i], nx = qn(a.n.x), ny = qn(a.n.y), nz = qn(a.n.z), dd = qd(a.d);
    cand.clear();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let k = -1; k <= 1; k++) {
      const l = B.get(key(nx + dx, ny + dy, nz + dz, dd + k));
      if (l) for (const j of l) if (j > i) cand.add(j);
    }
    for (const j of cand) {
      if (j <= i) continue;
      const b = T[j];
      if (a.lo[0] > b.hi[0] + gap || b.lo[0] > a.hi[0] + gap || a.lo[1] > b.hi[1] + gap || b.lo[1] > a.hi[1] + gap
        || a.lo[2] > b.hi[2] + gap || b.lo[2] > a.hi[2] + gap) continue; // boxes apart: no overlap
      if (a.n.dot(b.n) < cos) continue;
      let lo = Infinity, hi = -Infinity;
      for (const v of b.v) { const h = a.n.dot(v) - a.d; if (h < lo) lo = h; if (h > hi) hi = h; }
      // within `gap` of a's plane everywhere: coplanar (a face reaching further across it at a shallow angle is a
      // crossing: crossingPairs)
      if (lo < -gap || hi > gap) continue;
      const ov = triOverlap(a.v, b.v, a.n);
      if (ov > minOv) pairs.push({ i, j, ov });
    }
  }
  return pairs;
}

/** A 1 m spatial hash of triangle boxes (grown by `pad`): near(lo, hi) → candidate indices. */
function boxGrid(T, pad, keep = () => true) {
  const C = 1, G = new Map();
  const cells = (lo, hi, f) => {
    const x0 = Math.floor((lo[0] - pad) / C), x1 = Math.floor((hi[0] + pad) / C), y0 = Math.floor((lo[1] - pad) / C), y1 = Math.floor((hi[1] + pad) / C);
    const z0 = Math.floor((lo[2] - pad) / C), z1 = Math.floor((hi[2] + pad) / C);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) f(((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512));
  };
  T.forEach((t, i) => { if (keep(t)) cells(t.lo, t.hi, (k) => { let l = G.get(k); if (!l) G.set(k, l = []); l.push(i); }); });
  return (lo, hi) => { const out = new Set(); cells(lo, hi, (k) => { const l = G.get(k); if (l) for (const j of l) out.add(j); }); return out; };
}

/**
 * Near-coplanar crossings [{i, j, ov}]: same-facing triangles within `maxDeg` of each other (but not coplanar) that
 * overlap and cross each other within `reach` m (one's vertices on both sides of the other's plane): a pier top through
 * a pitched roof sheet at 7°, which fights in a band along the crossing line.
 */
export function crossingPairs(T, o = {}) {
  const cosLo = Math.cos(((o.maxDeg ?? 8) * Math.PI) / 180), gap = o.gap ?? 0.002, reach = o.reach ?? 0.03, minOv = o.minOverlap ?? 1e-4;
  const out = [];
  // only faces the game camera can see (pitch 40°, any yaw): a soffit, an arch's intrados, an underside never shows
  const seen = (n) => Math.hypot(n.x, n.z) * Math.cos(CAM_PITCH) + n.y * Math.sin(CAM_PITCH) > 0.05;
  const near = boxGrid(T, reach, (t) => seen(t.n));
  for (let i = 0; i < T.length; i++) {
    const a = T[i];
    if (!seen(a.n)) continue;
    for (const j of near(a.lo, a.hi)) {
      if (j <= i) continue;
      const b = T[j];
      if (a.lo[0] > b.hi[0] + reach || b.lo[0] > a.hi[0] + reach || a.lo[1] > b.hi[1] + reach || b.lo[1] > a.hi[1] + reach
        || a.lo[2] > b.hi[2] + reach || b.lo[2] > a.hi[2] + reach) continue;
      const c = a.n.dot(b.n);
      if (c < cosLo) continue;
      let lo = Infinity, hi = -Infinity;
      for (const v of b.v) { const h = a.n.dot(v) - a.d; if (h < lo) lo = h; if (h > hi) hi = h; }
      if (lo > 0 || hi < 0 || lo < -reach || hi > reach) continue; // not crossing a's plane, or too far through it
      if (lo >= -gap && hi <= gap) continue; // coplanar (coplanarPairs)
      const ov = triOverlap(a.v, b.v, a.n);
      if (ov > minOv) out.push({ i, j, ov });
    }
  }
  return out;
}

/** Move a set of triangles of one mesh by root-space offsets, one per triangle or [3] per vertex (copies of their vertices). */
function liftTriangles(o, M, moves) {
  const g = o.geometry; // (a geometry shared by several meshes was cloned by the caller)
  const Minv = new THREE.Matrix4().copy(M).invert();
  const P = g.getAttribute('position');
  if (!g.index) {
    for (const [t, off] of moves) {
      for (let k = 0; k < 3; k++) {
        const v = new THREE.Vector3().fromBufferAttribute(P, t + k).applyMatrix4(M).add(Array.isArray(off) ? off[k] : off).applyMatrix4(Minv);
        P.setXYZ(t + k, v.x, v.y, v.z);
      }
    }
    P.needsUpdate = true;
    return;
  }
  const I = g.index;
  const extra = moves.size * 3;
  const base = P.count;
  const names = Object.keys(g.attributes);
  const grown = {};
  for (const nm of names) {
    const A = g.attributes[nm], n = A.itemSize;
    // same component type (quantized / normalized GLB attributes keep their encoding: setXYZ / fromBufferAttribute
    // (de)normalize), raw components copied
    const src = A.isInterleavedBufferAttribute ? A.data.array : A.array;
    const arr = new src.constructor((base + extra) * n);
    if (A.isInterleavedBufferAttribute) {
      const st = A.data.stride, of = A.offset;
      for (let i = 0; i < base; i++) for (let c = 0; c < n; c++) arr[i * n + c] = src[i * st + of + c];
    } else arr.set(src.subarray(0, base * n));
    grown[nm] = new THREE.BufferAttribute(arr, n, A.normalized);
  }
  const idx = Array.from(I.array);
  let nv = base;
  for (const [t, off] of moves) {
    for (let k = 0; k < 3; k++) {
      const src = I.getX(t + k);
      for (const nm of names) {
        const A = grown[nm];
        for (let c = 0; c < A.itemSize; c++) A.array[nv * A.itemSize + c] = A.array[src * A.itemSize + c];
      }
      const v = new THREE.Vector3().fromBufferAttribute(grown.position, src).applyMatrix4(M).add(Array.isArray(off) ? off[k] : off).applyMatrix4(Minv);
      grown.position.setXYZ(nv, v.x, v.y, v.z);
      idx[t + k] = nv++;
    }
  }
  for (const nm of names) g.setAttribute(nm, grown[nm]);
  g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
}

/**
 * Separate the coplanar overlapping faces under `root` (see module doc).
 * @param {THREE.Object3D} root a freshly loaded asset scene (before it is cloned)
 * @param {{lift?:number, cos?:number, gap?:number, minOverlap?:number}} [o]
 * @returns {{pairs:number, patches:number, moved:number}} counts (moved = triangles lifted)
 */
export function separateCoplanar(root, o = {}) {
  // coplanar pairs pass after pass (a lift can bring a face within `gap` of a third surface that was 6-8 mm away),
  // then a pass of near-coplanar crossings (each crossing patch moved only where the move makes no new fight), then
  // the coplanar passes again
  const out = { pairs: 0, patches: 0, moved: 0, passes: 0 };
  const run = (mode, max) => {
    for (let pass = 0; pass < max; pass++) {
      const r = separatePass(root, o, mode);
      if (!r.pairs) break;
      out.pairs += r.pairs; out.patches += r.patches; out.moved += r.moved; out.passes++;
    }
  };
  run('coplanar', o.passes ?? 4);
  // (three rounds: a moved patch can meet the next plane of a bent sheet, or uncover a wall top under it)
  if (o.crossings !== false) for (let r = 0; r < 3; r++) { run('crossing', 1); run('coplanar', o.passes ?? 4); }
  return out;
}

function separatePass(root, o, mode = 'coplanar') {
  const lift = o.lift ?? 0.006;
  const { T, meshes } = gather(root);
  const pkOf = (tr) => `${tr.mi}|${tr.mat}|${Math.round(tr.n.x * NQ)},${Math.round(tr.n.y * NQ)},${Math.round(tr.n.z * NQ)},${Math.round(tr.d / DQ)}`;
  const per = new Map();
  let moved = 0, patches = 0;
  const pairs = mode === 'coplanar' ? coplanarPairs(T, o) : [];
  if (mode === 'coplanar') {
    if (!pairs.length) return { pairs: 0, patches: 0, moved: 0 };
    // patches: mesh + material + plane; a patch that overlaps itself splits (the later triangle gets a new key)
    const pk = T.map(pkOf);
    for (let round = 0; round < 8; round++) {
      let split = false;
      for (const p of pairs) if (pk[p.i] === pk[p.j]) { pk[p.j] += '+'; split = true; }
      if (!split) break;
    }
    const area = new Map(), adj = new Map();
    T.forEach((tr, i) => area.set(pk[i], (area.get(pk[i]) || 0) + tr.area));
    for (const p of pairs) {
      const a = pk[p.i], b = pk[p.j];
      if (a === b) continue;
      (adj.get(a) || adj.set(a, new Set()).get(a)).add(b);
      (adj.get(b) || adj.set(b, new Set()).get(b)).add(a);
    }
    const level = new Map();
    // a fixed material (o.fixed: a sheet roof) stays put and what lies flush on it goes under it (a wall top flush
    // with the sheet was hidden by it, and stays so); otherwise the largest patch stays and the others come out
    const fixedK = new Set();
    T.forEach((tr, i) => { if (o.fixed?.test(tr.mname)) fixedK.add(pk[i]); });
    const order = [...adj.keys()].sort((x, y) => (fixedK.has(y) - fixedK.has(x)) || area.get(y) - area.get(x) || (x < y ? -1 : 1));
    for (const k of order) {
      const used = new Set();
      let under = false;
      for (const nb of adj.get(k)) { if (level.has(nb)) used.add(level.get(nb)); if (fixedK.has(nb)) under = true; }
      let l = 0;
      if (fixedK.has(k)) l = 0;
      else if (under) { l = -1; while (used.has(l)) l--; }
      else while (used.has(l)) l++;
      level.set(k, l);
    }
    patches = level.size;
    // moves per mesh: triangle index start → root-space offset
    T.forEach((tr, i) => {
      const l = level.get(pk[i]);
      if (!l) return;
      let m = per.get(tr.mi); if (!m) per.set(tr.mi, m = new Map());
      m.set(tr.t, tr.n.clone().multiplyScalar(l * lift));
      moved++;
    });
  } else {
    // no coplanar pair left: near-coplanar crossings. The smaller patch of each crossing goes wholly to the side of the
    // larger face most of it already showed on: its vertices on the other side move along the larger face's normal to
    // one lift past it (a wall cap mostly proud of a pitched sheet roof rises where it dipped under; one mostly under
    // the sheet sinks where it poked out) — further, or to the other side, when that would meet a third surface — and
    // its upright sides follow its edges
    const cross = crossingPairs(T, o);
    if (!cross.length) return { pairs: 0, patches: 0, moved: 0 };
    const pk = T.map(pkOf), area = new Map(), big = new Map();
    T.forEach((tr, i) => area.set(pk[i], (area.get(pk[i]) || 0) + tr.area));
    /** A plane of the larger surface, with the box of its faces (a vertex only answers to the planes it is over). */
    const addPlane = (q, b) => {
      const x = q.find((x) => x.n.dot(b.n) > 0.99999 && Math.abs(x.d - b.d) < 1e-4);
      if (!x) q.push({ n: b.n, d: b.d, lo: [...b.lo], hi: [...b.hi] });
      else for (let c = 0; c < 3; c++) { x.lo[c] = Math.min(x.lo[c], b.lo[c]); x.hi[c] = Math.max(x.hi[c], b.hi[c]); }
    };
    const vis = new Map();
    for (const p of cross) {
      // the reference surface: a material named in o.fixed (a sheet roof) never moves; else the larger patch stays
      const fi = o.fixed?.test(T[p.i].mname), fj = o.fixed?.test(T[p.j].mname);
      if (fi && fj) continue;
      const [b, small] = fi || (!fj && area.get(pk[p.i]) >= area.get(pk[p.j])) ? [T[p.i], p.j] : [T[p.j], p.i];
      const k = pk[small];
      // how much of it shows over the face it crosses, where they overlap (+), or lies under it (-)
      const g = overlapGap(T[small].v, T[small].n, T[small].d, b.v, b.n, b.d);
      if (g.area > 0) vis.set(k, (vis.get(k) || 0) + ((g.lo + g.hi) / 2 < 0 ? g.area : -g.area));
      let q = big.get(k); if (!q) big.set(k, q = []);
      q.sheets = q.sheets || new Set(); q.sheets.add(`${b.mi}|${b.mat}`);
      addPlane(q, b); // every plane it crosses
    }
    const need = big;
    const members = new Map();
    T.forEach((tr, i) => { if (big.has(pk[i])) (members.get(pk[i]) || members.set(pk[i], []).get(pk[i])).push(i); });
    const cosLo = Math.cos(((o.maxDeg ?? 8) * Math.PI) / 180), gap = o.gap ?? 0.002, reach = o.reach ?? 0.03;
    const nearT = boxGrid(T, reach + 0.05);
    // ... and every other plane of the same sheet (mesh + material) over it: a bent sheet has several, and a patch
    // laid on one would cross the next
    for (const [k, idx] of members) {
      const q = big.get(k);
      for (const i of idx) {
        const a = T[i];
        for (const j of nearT(a.lo.map((x) => x - reach), a.hi.map((x) => x + reach))) {
          const b = T[j];
          if (!q.sheets.has(`${b.mi}|${b.mat}`) || b.n.dot(a.n) < cosLo) continue;
          let l = Infinity, h = -Infinity;
          for (const v of a.v) { const e = b.n.dot(v) - b.d; if (e < l) l = e; if (e > h) h = e; }
          if (l < -reach || h > reach || triOverlap(a.v, b.v, b.n) <= (o.minOverlap ?? 1e-4)) continue;
          addPlane(q, b);
        }
      }
    }
    /** Per-vertex offsets putting triangle i at least `at` off the planes it crosses: behind all of them (at < 0, the
     *  deepest one wins) or in front of all of them (at > 0); vertices already past that are not moved. */
    const offsOf = (i, Bs, at) => T[i].v.map((v) => {
      let best = null, bd = 0;
      const over = Bs.filter((B) => [0, 1, 2].every((c) => v.getComponent(c) >= B.lo[c] - PAD && v.getComponent(c) <= B.hi[c] + PAD));
      for (const B of over.length ? over : Bs) { const dd = B.d + at - B.n.dot(v); if (!best || (at < 0 ? dd < bd : dd > bd)) { best = B; bd = dd; } }
      // a vertex already that far out on its side stays put (a cap that stood proud of the roof keeps its height there)
      return best.n.clone().multiplyScalar(at > 0 ? Math.max(bd, 0) : Math.min(bd, 0));
    });
    // patches still to be placed are not obstacles (they move too); placed ones are checked where they now are
    const pending = new Set(), placed = new Map();
    for (const idx of members.values()) for (const i of idx) pending.add(i);
    const clashes = (idx, B, at) => {
      const own = new Set(idx);
      for (const i of idx) {
        const offs = offsOf(i, B, at), v = T[i].v.map((q, k) => q.clone().add(offs[k]));
        const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
        if (n.lengthSq() < 1e-12) continue;
        n.normalize();
        if (n.dot(T[i].n) < 0) n.negate();
        const d = n.dot(v[0]);
        const lo = [0, 1, 2].map((c) => Math.min(v[0].getComponent(c), v[1].getComponent(c), v[2].getComponent(c)) - reach);
        const hi = [0, 1, 2].map((c) => Math.max(v[0].getComponent(c), v[1].getComponent(c), v[2].getComponent(c)) + reach);
        for (const j of nearT(lo, hi)) {
          if (own.has(j) || (pending.has(j) && !placed.has(j))) continue;
          const b = T[j], bv = placed.get(j) || b.v;
          if (!placed.has(j) && (b.hi[0] < lo[0] || b.lo[0] > hi[0] || b.hi[1] < lo[1] || b.lo[1] > hi[1] || b.hi[2] < lo[2] || b.lo[2] > hi[2])) continue;
          if (n.dot(b.n) < cosLo) continue;
          // b's height over the moved face where the two overlap: coplanar, or crossing (a face that only touches the
          // moved one along an edge, within half a mm, does not count)
          const bn = placed.has(j) ? new THREE.Vector3().subVectors(bv[1], bv[0]).cross(new THREE.Vector3().subVectors(bv[2], bv[0])).normalize() : b.n;
          const { area: ov, lo: l, hi: h } = overlapGap(v, n, d, bv, bn, bn.dot(bv[0]));
          if (!(ov > (o.minOverlap ?? 1e-4))) continue;
          const near = (l >= -gap && h <= gap) || (l < -TOUCH && h > TOUCH && l >= -reach && h <= reach);
          if (near) return true;
        }
      }
      return false;
    };
    const follow = [];
    // the largest patch first, nearest the face; each next one a lift deeper where it would meet one placed before
    const order = [...members].sort((x, y) => area.get(y[0]) - area.get(x[0]) || (x[0] < y[0] ? -1 : 1));
    for (const [k, idx] of order) {
      const B = big.get(k);
      let at = null;
      // the side most of it already shows on wins: a cap mostly out of the sheet comes wholly out, one mostly under it
      // goes wholly under (what was seen stays seen, what was hidden stays hidden, as near as one plane allows)
      const sides = (vis.get(k) || 0) >= 0 ? [1, 2, 3, 4, -1, -2, -3, -4] : [-1, -2, -3, -4, 1, 2, 3, 4];
      for (const cand of sides.map((m) => m * lift)) if (!clashes(idx, B, cand)) { at = cand; break; }
      if (at == null) { for (const i of idx) placed.set(i, T[i].v); continue; } // every placement makes a new fight: left
      for (const i of idx) {
        const tr = T[i], offs = offsOf(i, B, at);
        let m = per.get(tr.mi); if (!m) per.set(tr.mi, m = new Map());
        m.set(tr.t, offs);
        placed.set(i, tr.v.map((q, c) => q.clone().add(offs[c])));
        moved++;
        if (tr.n.y > 0.7) tr.v.forEach((q, c) => follow.push({ mi: tr.mi, p: q, off: offs[c] })); // a top: its sides follow
      }
    }
    // the patch's own sides follow its edges (a cap's side faces stay closed under its re-planed top: no trough, no
    // gap) — a side vertex within two lifts of a moved corner (the coplanar pass may have lifted the side) moves with it
    const FOLLOW = 2 * lift + 0.001;
    for (const tr of T) {
      const m = per.get(tr.mi);
      if (m?.has(tr.t) || !follow.length || Math.abs(tr.n.y) > 0.3) continue; // only upright sides follow a top
      const offs = tr.v.map((q) => {
        let best = null, bd = FOLLOW;
        for (const f of follow) if (f.mi === tr.mi) { const d = f.p.distanceTo(q); if (d < bd) { bd = d; best = f.off; } }
        return best;
      });
      if (!offs.some(Boolean)) continue;
      let mm = m; if (!mm) per.set(tr.mi, mm = new Map());
      mm.set(tr.t, offs.map((x) => x || new THREE.Vector3()));
    }
    patches = need.size;
    if (!moved) return { pairs: 0, patches: 0, moved: 0 };
    pairs.push(...cross);
  }
  // geometries shared by several meshes of the scene: each moved mesh gets its own copy
  const users = new Map();
  for (const { o: m } of meshes) users.set(m.geometry, (users.get(m.geometry) || 0) + 1);
  for (const [mi, moves] of per) {
    const { o: m, M } = meshes[mi];
    if (users.get(m.geometry) > 1) { users.set(m.geometry, users.get(m.geometry) - 1); m.geometry = m.geometry.clone(); }
    liftTriangles(m, M, moves);
    m.geometry.computeBoundingBox();
    m.geometry.computeBoundingSphere();
  }
  return { pairs: pairs.length, patches, moved };
}
