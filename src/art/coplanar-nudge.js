/**
 * Coplanar parts of a library GLB nudged apart (user 2026-11-18 "Make sure there is no z-fighting in the geometry";
 * tools/art/zfight.mjs). The kit exporters left parts of one asset with faces in a shared plane: a window sill's top
 * flush with its recess floor, a plinth band's face flush with the brick, a corner board crossing a band trim, a ridge
 * cap on the roof slope, a lorry's grille in its bumper's face. The depth buffer cannot order two faces in one plane:
 * they flicker under the game camera (stripes and speckles that crawl as it moves).
 *
 * nudgeCoplanar(root) finds every pair of same-facing faces of two different PARTS (a part: the triangles of one mesh
 * primitive joined across shared edges — a sill, a board, a band, a box) that lie in one plane and overlap, and SHIFTS
 * the smaller part rigidly a step (4 mm; 2.4 mm where a face lies just in front) proud of the larger one along their
 * normal (several contact planes: the least-squares shift meeting them all, else as many as it can by area) — so the
 * smaller detail sits proud of the larger surface, as a sill on its ledge; a part that cannot move stands first in the
 * next pass and its neighbour moves instead. Faces of ONE part overlapping in a plane (two boxes of a part, a doubled
 * stair-rail top, an L-shaped quoin) are set apart by EXTRUDING the smaller patch a step (its own vertices and, at its
 * corners, the part's side faces there, which stretch: no edge opens); a copy or a doubled triangulation lying wholly
 * under the rest of its patch is dropped (degenerate triangles). Building faces up flush with the asset's base (a door
 * step on the terrain) count as flush with a fixed ground (`ground`). Nothing moves through a face lying within reach in
 * front of it (a face 1–12 mm behind another stays behind it by 1.5 mm); snow never moves, a part flush with snow only
 * slides within the snow's plane (that fight stays as it is: the snow look is frozen, the allow list carries it);
 * downward faces (never seen from the 25–60° camera), glass, decals and blended materials never move. Up to 3 rounds
 * (a stretched side face can come to overlap a face beside it: the next round, on the changed triangles only).
 *
 * Render only: the drawn geometry gets a new position attribute; the authored one stays what gameplay measures
 * (engine/gameplay-geometry.js: the visual nav stamps, overheads, hulls and roof tops of world/placement-visual.js read
 * the geometry the artist made, as for the round roofs), the asset's nav sidecars and footprints are untouched.
 * 4 mm is ~0.16 px at the default zoom (40 px/m) and > 5 × the depth noise at the farthest zoom (orthographic d24 depth:
 * 0.04 mm steps, ≤ 0.8 mm with the slope at 16 px/m; tools/art/zfight.mjs calibration: 0.1 mm already never flips).
 * @module art/coplanar-nudge
 */
import * as THREE from 'three';
import { gameplayGeometry, setGameplayGeometry } from '../engine/gameplay-geometry.js';

export const NUDGE = {
  step: 0.004,        // m: the shift / extrusion
  coplanar: 0.001,    // |gap| ≤ this: one plane (fights)
  reach: 0.012,       // a same-facing face this close in front of a part keeps it from growing through it
  margin: 0.0015,     // what a nudged part keeps clear of a face in front of it
  minOverlap: 5e-5,   // m² (0.5 cm²) of shared face
  cos: 0.9995,        // same facing (≈ 1.8°)
  downY: -0.9,        // normals below this never face the camera (pitch 25-60°)
  maxLayer: 3,         // a part's shift stays under maxLayer × 1.8 steps
};

const SNOW = /^kit:snow(~|$)/;
/** Materials left out: blended / cut-out-less overlays (decals already draw with a polygon offset), glass panes. */
const skipMat = (m) => !m || m.transparent || m.depthWrite === false || m.polygonOffset || /glass|decal/i.test(m.name || '');

/** 2D overlap area of two coplanar triangles (Sutherland-Hodgman) in the plane of normal n. */
export function triOverlap(a, b, n) {
  const u = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const e1 = u.cross(n).normalize(), e2 = n.clone().cross(e1);
  const pj = (v) => [v.dot(e1), v.dot(e2)];
  const area = (p) => { let s = 0; for (let k = 0; k < p.length; k++) { const q = p[k], r = p[(k + 1) % p.length]; s += q[0] * r[1] - r[0] * q[1]; } return s / 2; };
  let poly = a.map(pj);
  const clip = b.map(pj);
  if (area(clip) < 0) clip.reverse();
  if (area(poly) < 0) poly.reverse();
  for (let k = 0; k < 3 && poly.length; k++) {
    const A = clip[k], B = clip[(k + 1) % 3], side = (p) => (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]);
    const out = [];
    for (let m = 0; m < poly.length; m++) {
      const P1 = poly[m], P2 = poly[(m + 1) % poly.length], s1 = side(P1), s2 = side(P2);
      const cut = () => { const t = s1 / (s1 - s2); return [P1[0] + t * (P2[0] - P1[0]), P1[1] + t * (P2[1] - P1[1])]; };
      if (s1 >= 0 && s2 >= 0) out.push(P2);
      else if (s1 >= 0) out.push(cut());
      else if (s2 >= 0) { out.push(cut()); out.push(P2); }
    }
    poly = out;
  }
  return poly.length >= 3 ? Math.abs(area(poly)) : 0;
}

/**
 * The parts and triangles of `root` in root space. A part = one mesh's triangles of one material group welded by
 * position (0.1 mm). Triangles of left-out materials are kept (as `skip`) only to block growth through them.
 */
export function gather(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const meshes = [], parts = [], T = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry?.getAttribute('position')) return;
    const g = o.geometry, P = g.getAttribute('position'), I = g.index, cnt = I ? I.count : P.count;
    const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), mi = meshes.length;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    // welded positions (root space, 0.1 mm)
    const wp = new Float64Array(P.count * 3), wid = new Int32Array(P.count), keys = new Map(), v = new THREE.Vector3();
    let nw = 0;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(M);
      wp[i * 3] = v.x; wp[i * 3 + 1] = v.y; wp[i * 3 + 2] = v.z;
      const kx = Math.round(v.x * 1e4) * 8388608 + Math.round(v.y * 1e4), kz = Math.round(v.z * 1e4);
      let m = keys.get(kx); if (!m) keys.set(kx, m = new Map());
      let id = m.get(kz); if (id === undefined) m.set(kz, id = nw++);
      wid[i] = id;
    }
    meshes.push({ o, M, wp, wid, nw });
    const groups = g.groups.length && Array.isArray(o.material) ? g.groups : [{ start: 0, count: cnt, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0], skip = skipMat(mat), snow = SNOW.test(mat?.name || '');
      const offset = !!(mat && (mat.polygonOffset || mat.depthWrite === false));
      const tris = [];
      for (let t = gr.start; t + 2 < Math.min(cnt, gr.start + gr.count); t += 3) {
        const i0 = I ? I.getX(t) : t, i1 = I ? I.getX(t + 1) : t + 1, i2 = I ? I.getX(t + 2) : t + 2;
        const p = [i0, i1, i2].map((i) => new THREE.Vector3(wp[i * 3], wp[i * 3 + 1], wp[i * 3 + 2]));
        const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
        const a2 = n.length();
        if (a2 < 2e-8) continue;
        n.divideScalar(a2);
        tris.push({ ix: [i0, i1, i2], t, p, n, d: n.dot(p[0]), area: a2 / 2 });
      }
      // parts: triangles joined across shared EDGES (two welded corners) — a box is one part, two boxes that only touch
      // at a corner (a tower against a block, a sill under a jamb) are two
      const tp = new Int32Array(tris.length).map((_, k) => k), tf = (a) => { while (tp[a] !== a) { tp[a] = tp[tp[a]]; a = tp[a]; } return a; };
      const edges = new Map();
      tris.forEach((tr, k) => {
        const w = tr.ix.map((i) => wid[i]);
        for (const [x, y] of [[w[0], w[1]], [w[1], w[2]], [w[2], w[0]]]) {
          const e = x < y ? x * 4194304 + y : y * 4194304 + x;
          const j = edges.get(e);
          if (j === undefined) edges.set(e, k); else tp[tf(k)] = tf(j);
        }
      });
      const byRoot = new Map();
      for (const [k, tr] of tris.entries()) {
        const r = tf(k);
        let pi = byRoot.get(r);
        if (pi === undefined) { byRoot.set(r, pi = parts.length); parts.push({ mi, mat: mat?.name || '?', skip, snow, offset, area: 0, tris: [] }); }
        const part = parts[pi], [p0, p1, p2] = tr.p;
        tr.part = pi; part.area += tr.area; part.tris.push(T.length);
        tr.lo = [Math.min(p0.x, p1.x, p2.x), Math.min(p0.y, p1.y, p2.y), Math.min(p0.z, p1.z, p2.z)];
        tr.hi = [Math.max(p0.x, p1.x, p2.x), Math.max(p0.y, p1.y, p2.y), Math.max(p0.z, p1.z, p2.z)];
        T.push(tr);
      }
    }
  });
  return { meshes, parts, T };
}

/**
 * Same-facing overlapping face pairs of two different parts within `reach` of one plane: [{a, b, gap, ov}] with
 * gap = how far b's face lies in front of a's along their normal (m; |gap| ≤ coplanar: one plane).
 */
export function facePairs({ parts, T }, o = NUDGE, focus = null) {
  // buckets: normal on a 0.1 grid (a same-facing partner within acos(cos) ≈ 1.8° is at most 0.32 cells off: the next
  // cell is looked at only when the normal lies that close to a cell edge), plane offset in cells of 2 × reach
  const NQ = 10, NT = 0.5 - 0.32, DQ = o.reach * 2;
  const nk = (x, y, z) => ((x + 12) * 25 + (y + 12)) * 25 + (z + 12);
  const B = new Map(), at = (k) => B.get(k);
  for (let i = 0; i < T.length; i++) {
    const tr = T[i];
    if (tr.n.y < o.downY) continue;
    const k = nk(Math.round(tr.n.x * NQ), Math.round(tr.n.y * NQ), Math.round(tr.n.z * NQ)) * 4194304 + Math.round(tr.d / DQ) + 2097152;
    let l = B.get(k); if (!l) B.set(k, l = []); l.push(i);
  }
  const pairs = new Map(), seen = new Int32Array(T.length).fill(-1), axes = [[], [], []];
  // (focus: the triangles of the parts that moved: only their pairs are looked at again)
  const inF = focus ? new Uint8Array(T.length) : null;
  if (focus) for (const i of focus) inF[i] = 1;
  for (const i of focus || T.keys()) {
    const a = T[i];
    if (a.n.y < o.downY) continue;
    const pa = parts[a.part], nn = [a.n.x * NQ, a.n.y * NQ, a.n.z * NQ];
    for (let c = 0; c < 3; c++) {
      const r = Math.round(nn[c]), res = nn[c] - r;
      axes[c].length = 0; axes[c].push(r);
      if (Math.abs(res) > NT) axes[c].push(r + Math.sign(res));
    }
    const dq = Math.round(a.d / DQ) + 2097152;
    for (const x of axes[0]) for (const y of axes[1]) for (const z of axes[2]) for (let k = -1; k <= 1; k++) {
      const l = at(nk(x, y, z) * 4194304 + dq + k);
      if (!l) continue;
      for (const j of l) {
        if (seen[j] === i || j === i || (j < i && (!focus || inF[j]))) continue;
        seen[j] = i;
        const b = T[j];
        if (b.part === a.part || (pa.skip && parts[b.part].skip)) continue;
        if (a.lo[0] > b.hi[0] + o.reach || b.lo[0] > a.hi[0] + o.reach || a.lo[1] > b.hi[1] + o.reach || b.lo[1] > a.hi[1] + o.reach
          || a.lo[2] > b.hi[2] + o.reach || b.lo[2] > a.hi[2] + o.reach) continue;
        if (a.n.dot(b.n) < o.cos) continue;
        const h0 = a.n.dot(b.p[0]) - a.d, h1 = a.n.dot(b.p[1]) - a.d, h2 = a.n.dot(b.p[2]) - a.d;
        if (Math.min(h0, h1, h2) > o.reach || Math.max(h0, h1, h2) < -o.reach) continue;
        const ov = triOverlap(a.p, b.p, a.n);
        if (ov < o.minOverlap * 0.05) continue;
        const gap = (h0 + h1 + h2) / 3;
        const [p, q, g] = a.part < b.part ? [a.part, b.part, gap] : [b.part, a.part, -gap];
        const key = `${p}|${q}|${Math.abs(g) <= o.coplanar ? 0 : Math.sign(g)}`;
        let e = pairs.get(key);
        if (!e) pairs.set(key, e = { a: p, b: q, gap: g, ov: 0, n: a.n.clone() });
        e.ov += ov;
        if (Math.abs(g) < Math.abs(e.gap)) e.gap = g;
      }
    }
  }
  return [...pairs.values()].filter((e) => e.ov >= o.minOverlap);
}

/** Least-squares vector t with t · n_i = c_i for the unit normals n_i (+ a small ridge: the shortest such t). */
function solveShift(ns, cs) {
  const A = [[1e-4, 0, 0], [0, 1e-4, 0], [0, 0, 1e-4]], b = [0, 0, 0];
  ns.forEach((n, i) => {
    const c = [n.x, n.y, n.z];
    for (let r = 0; r < 3; r++) { b[r] += c[r] * cs[i]; for (let q = 0; q < 3; q++) A[r][q] += c[r] * c[q]; }
  });
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  return new THREE.Vector3(...[0, 1, 2].map((k) => det(A.map((row, r) => row.map((v, q) => (q === k ? b[r] : v)))) / D));
}

/**
 * Nudge the coplanar parts of a freshly loaded scene apart (see the module doc). Returns what it did:
 * {pairs: coplanar pairs found, moved: parts grown, left: [{a, b, why}] pairs it could not separate (snow, blocked),
 * passes}. `dry`: only count.
 * @param {THREE.Object3D} root @param {Partial<typeof NUDGE>} [opts]
 */
export function nudgeCoplanar(root, opts = {}) {
  // (rounds: a patch moved off its twin stretches its side faces, which can come to overlap a face beside them: the
  // next round, on the written geometry, sets those apart too)
  // (a later round looks only at the triangles whose vertices the round before moved, and their parts)
  const res = { pairs: 0, moved: 0, doubled: 0, left: [], passes: 0, rounds: 0 };
  let changed = null;
  for (let k = 0; k < (opts.rounds ?? 3); k++) {
    const r = nudgeRound(root, opts, changed);
    if (!k) res.pairs = r.pairs;
    res.moved += r.moved; res.doubled += r.doubled; res.passes += r.passes; res.left = k ? [...res.left, ...r.left] : r.left; res.rounds++;
    if (opts.dry || !r.changed) break;
    changed = r.changedIx;
  }
  return res;
}

function nudgeRound(root, opts = {}, changed = null) {
  // a moved part can come to overlap a face it only bordered before (a step in front of it): the next pass looks again
  // at the moved parts' faces; a part that could not move in a pass takes its stand first in the next one, so its
  // neighbour moves instead
  const o = { ...NUDGE, ...opts };
  const G = gather(root);
  const out = { pairs: 0, moved: 0, left: [], passes: 0 };
  const prefer = new Set(), total = new Map();
  let focus = null, partsIn = null;
  if (changed) {
    focus = [];
    G.T.forEach((tr, i) => { const set = changed.get(G.meshes[G.parts[tr.part].mi].o); if (set && tr.ix.some((x) => set.has(x))) focus.push(i); });
    partsIn = new Set(focus.map((ti) => G.T[ti].part));
    if (!focus.length) return { ...out, doubled: 0, changed: false };
  }
  for (let k = 0; k < (o.passes ?? 4); k++) {
    const r = nudgePass(G, o, prefer, focus);
    if (!k) out.pairs = r.pairs;
    // (the pairs looked at again replace their earlier verdicts)
    const again = new Set(focus ? focus.map((ti) => G.T[ti].part) : []);
    out.left = k ? [...out.left.filter((x) => !again.has(x.pa) && !again.has(x.pb)), ...r.left] : r.left;
    out.passes++;
    if (o.dry) break;
    const fresh = r.stuck.filter((p) => !prefer.has(p));
    for (const p of fresh) prefer.add(p);
    if (!r.shift.size && !fresh.length) break;
    // move the parts' triangles (root space) for the next look; the drawn geometry is written once, at the end
    const f = new Set();
    for (const [p, t] of r.shift) {
      const acc = total.get(p) || new THREE.Vector3();
      total.set(p, acc.add(t));
      for (const ti of G.parts[p].tris) {
        const tr = G.T[ti];
        for (const v of tr.p) v.add(t);
        tr.d = tr.n.dot(tr.p[0]);
        for (let c = 0; c < 3; c++) { const dc = t.getComponent(c); tr.lo[c] += dc; tr.hi[c] += dc; }
        f.add(ti);
      }
    }
    for (const p of fresh) for (const ti of G.parts[p].tris) f.add(ti);
    focus = [...f].sort((x, y) => x - y);
  }
  out.moved = total.size;
  // faces of one part overlapping in one plane — no shift separates a part from itself: the patch to move is EXTRUDED a
  // step off the plane along its normal (its own vertices and, at its corners, the vertices of the part's side faces
  // there, which stretch: no edge opens), or the short step, if no face just in front is in the way — else the other
  // patch; else (a copy wholly over the other) dropped: degenerate triangles, drawn only
  const lifts = new Map(), drop = new Map(), moved = new Set();
  out.doubled = 0;
  const so = selfOverlaps(G, o, partsIn);
  // (faces by normal on a 0.2 grid: a moved patch is checked against the same-facing ones near it only)
  const byN = new Map(), nkey = (n) => `${Math.round(n.x * 5)},${Math.round(n.y * 5)},${Math.round(n.z * 5)}`;
  if (so.length) G.T.forEach((tr, j) => { const k = nkey(tr.n); (byN.get(k) || byN.set(k, []).get(k)).push(j); });
  const liftFor = (tris) => {
    const n = G.T[tris[0]].n, mine = new Set(tris), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const ti of tris) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], G.T[ti].lo[c]); hi[c] = Math.max(hi[c], G.T[ti].hi[c]); }
    const near = [];
    for (const j of byN.get(nkey(n)) || []) {
      const tr = G.T[j];
      if (!mine.has(j) && tr.n.dot(n) >= o.cos && ![0, 1, 2].some((c) => lo[c] > tr.hi[c] + o.reach || tr.lo[c] > hi[c] + o.reach)) near.push(tr);
    }
    // out of its plane (proud), or else sunk into its part (where proud would leave the mesh's quantised extent: a face
    // on the asset's outside), a step or the short step
    for (const step of [o.step, o.step * 0.6, -o.step, -o.step * 0.6]) {
      const blocked = near.some((tr) => tris.some((ti) => {
        // (a decal or glass on the patch, flush or just in front, blocks it too: it must stay on top — and snow: its look
        // is frozen, nothing comes through it nor out of its plane)
        // (sunk, a patch leaves its decal a step in front of it — as most decals stand — but never its snow)
        const a = G.T[ti], h = (tr.d - a.d) * Math.sign(step), pt = G.parts[tr.part];
        if (step < 0 && pt.skip) return false;
        const dec = pt.skip || pt.snow;
        if (step < 0 && pt.snow && Math.abs(h) <= o.coplanar) return true;
        if ((dec ? h < -o.coplanar : h <= o.coplanar) || h > Math.abs(step) + o.margin) return false;
        if ([0, 1, 2].some((c) => a.lo[c] > tr.hi[c] + o.reach || tr.lo[c] > a.hi[c] + o.reach)) return false;
        return triOverlap(a.p, tr.p, a.n) > 1e-6;
      }));
      if (!blocked && fits(G, G.parts[G.T[tris[0]].part].mi, tris.flatMap((ti) => G.T[ti].p.map((q) => q.clone().addScaledVector(n, step))))) return n.clone().multiplyScalar(step);
    }
    return null;
  };
  // per mesh: vertex indices by welded corner, triangles by vertex index (for the side faces' corners)
  const meshIx = new Map();
  const ixOf = (mi) => {
    let m = meshIx.get(mi);
    if (m) return m;
    const byW = new Map(), triOf = new Map();
    G.T.forEach((tr) => { if (G.parts[tr.part].mi !== mi) return; for (const i of tr.ix) { (triOf.get(i) || triOf.set(i, []).get(i)).push(tr); (byW.get(G.meshes[mi].wid[i]) || byW.set(G.meshes[mi].wid[i], new Set()).get(G.meshes[mi].wid[i])).add(i); } });
    meshIx.set(mi, m = { byW, triOf });
    return m;
  };
  for (const d of so) {
    if (d.dup) { // (a doubled triangulation of one patch: dropped)
      let set = drop.get(d.mi); if (!set) drop.set(d.mi, set = new Set());
      for (const ti of d.tris) set.add(G.T[ti].t);
      out.doubled += d.tris.length;
      continue;
    }
    const key = (t) => t.join(',');
    if (moved.has(key(d.tris)) || moved.has(key(d.alt))) continue; // (this pair is already apart)
    let tris = d.tris, lift = liftFor(tris);
    if (!lift) { tris = d.alt; lift = liftFor(tris); }
    out.doubled += tris.length;
    moved.add(key(tris));
    const part = G.parts[G.T[tris[0]].part];
    if (lift) {
      const { byW, triOf } = ixOf(part.mi), n = lift.clone().normalize(), mine = new Set(tris.map((ti) => G.T[ti]));
      let m = lifts.get(part.mi); if (!m) lifts.set(part.mi, m = new Map());
      for (const ti of tris) for (const i of G.T[ti].ix) {
        m.set(i, lift);
        // the side faces at this corner follow (a vertex also used by a face in this plane outside the patch stays)
        for (const j of byW.get(G.meshes[part.mi].wid[i]) || []) {
          if (j === i || m.has(j)) continue;
          const users = triOf.get(j) || [];
          if (users.every((t) => !mine.has(t) && Math.abs(t.n.dot(n)) < 0.999 && G.parts[t.part] === part)) m.set(j, lift);
        }
      }
    } else if (d.ov >= d.tris.reduce((a, ti) => a + G.T[ti].area, 0) * 0.98) {
      let set = drop.get(part.mi); if (!set) drop.set(part.mi, set = new Set());
      for (const ti of d.tris) set.add(G.T[ti].t);
    } else out.left.push({ a: part.mat, b: part.mat, ov: +d.ov.toFixed(4), n: G.T[d.tris[0]].n.toArray().map((x) => +x.toFixed(3)), why: 'blocked' });
  }
  out.changed = total.size + lifts.size + drop.size > 0;
  if (!o.dry && out.changed) out.changedIx = writeDrawn(G, total, drop, lifts);
  for (const x of out.left) { delete x.pa; delete x.pb; }
  return out;
}

/**
 * Do these root-space points still fit the quantised position range of mesh `mi` (KHR_mesh_quantization: a moved
 * vertex past the authored extent would not; the drawn copy keeps the authored storage, engine/depth-merge.js)?
 */
function fits(G, mi, pts) {
  const m = G.meshes[mi];
  if (m.range === undefined) {
    const P = m.o.geometry.getAttribute('position'), src = P.isInterleavedBufferAttribute ? P.data.array : P.array, R = QRANGE.get(src.constructor);
    m.range = R ? (P.normalized ? [Math.max(-1, R[0] / R[1]), 1] : R) : null;
    m.inv = new THREE.Matrix4().copy(m.M).invert();
  }
  if (!m.range) return true;
  const v = new THREE.Vector3();
  for (const p of pts) {
    v.copy(p).applyMatrix4(m.inv);
    if (v.x < m.range[0] || v.y < m.range[0] || v.z < m.range[0] || v.x > m.range[1] || v.y > m.range[1] || v.z > m.range[1]) return false;
  }
  return true;
}

function nudgePass(G, o, prefer, focus) {
  const { parts } = G;
  const pairs = facePairs(G, o, focus);
  // a decal / glass part never gets a shift of its own: nothing moves over it (coplanar or in front within reach)
  const cop = pairs.filter((e) => Math.abs(e.gap) <= o.coplanar && !parts[e.a].skip && !parts[e.b].skip);
  const fset = focus ? new Set(focus.map((ti) => G.T[ti].part)) : null, inFocus = (p) => fset.has(p);
  const groundy = o.ground && G.T.some((tr) => tr.n.y > 0.999 && Math.abs(tr.d) <= o.coplanar && (!fset || fset.has(tr.part)));
  const out = { pairs: cop.length, left: [], stuck: [], shift: new Map() };
  if (!cop.length && !groundy) return out;
  // per part: coplanar contacts (one of the two must end a step proud), faces within reach in front of / behind it
  // (their order must hold: behind stays behind by the margin — snow, which never moves, among them), and the planes it
  // shares with snow (it may only slide within them: that fight stays exactly as it is, the snow look is frozen)
  const nb = parts.map(() => ({ cop: [], near: [], snow: [] }));
  for (const e of pairs) {
    const flat = Math.abs(e.gap) <= o.coplanar;
    if (flat && (parts[e.a].snow || parts[e.b].snow)) { nb[e.a].snow.push(e.n); nb[e.b].snow.push(e.n); continue; }
    if (flat && !parts[e.a].skip && !parts[e.b].skip) { nb[e.a].cop.push({ q: e.b, n: e.n, ov: e.ov }); nb[e.b].cop.push({ q: e.a, n: e.n, ov: e.ov }); continue; }
    // back part, front part, how far behind (0: flush with a decal / glass, which must stay on top)
    const [back, front, g] = flat ? [e.a, e.b, 0] : e.gap > 0 ? [e.a, e.b, e.gap] : [e.b, e.a, -e.gap];
    const rel = { back, front, n: e.n, lim: g ? g - o.margin : 0 };
    nb[back].near.push(rel); nb[front].near.push(rel);
    if (flat) nb[front].near.push({ back: front, front: back, n: e.n, lim: 0 });
  }
  // (`ground`: a building's faces up flush with its base, y 0 — a door step, a threshold slab — lie in the plane of the
  // terrain it stands on: they count as coplanar with a fixed ground part)
  const GROUND = parts.length, UP = new THREE.Vector3(0, 1, 0);
  if (o.ground) {
    const area = new Map();
    for (const tr of G.T) if (tr.n.y > 0.999 && Math.abs(tr.d) <= o.coplanar && !parts[tr.part].skip && !parts[tr.part].snow) area.set(tr.part, (area.get(tr.part) || 0) + tr.area);
    for (const [p, a] of area) if (a >= o.minOverlap && (!focus || inFocus(p))) { nb[p].cop.push({ q: GROUND, n: UP, ov: a }); cop.push({ a: p, b: GROUND, n: UP, ov: a, gap: 0, ground: true }); }
  }
  const fixed = (p) => p === GROUND || parts[p].skip || parts[p].snow;
  const shift = new Map([[GROUND, null]]), ZERO = new THREE.Vector3();
  shift.set(GROUND, ZERO);
  const sh = (p) => shift.get(p) || ZERO;
  const first = (p) => fixed(p) || prefer.has(p);
  const area = (p) => parts[p]?.area ?? Infinity;
  const order = [...new Set(cop.flatMap((e) => [e.a, e.b]))].sort((x, y) => (first(y) - first(x)) || (area(y) - area(x)) || (x - y));
  const ok = (p, t) => nb[p].near.every((r) => (r.back === p ? t : sh(r.back)).clone().sub(r.front === p ? t : sh(r.front)).dot(r.n) <= r.lim + 1e-6)
    && fits(G, parts[p].mi, parts[p].tris.flatMap((ti) => G.T[ti].p.map((q) => q.clone().add(t))));
  for (const p of order) {
    if (fixed(p)) { shift.set(p, ZERO); continue; }
    // proud of every larger coplanar neighbour by a step: t · n ≥ (its shift) · n + step, per contact plane
    // (failing that — a face of it would come through one just in front — a step back from them instead, if nothing
    // behind it is in the way)
    // (and a shorter step, 0.6 ×, where a face lies just in front: still > 2 × the farthest zoom's depth noise)
    let pick = ZERO;
    // held in the planes it shares with snow: the shift lies in their orthogonal complement (contact normals projected)
    const basis = [];
    for (const n of nb[p].snow) {
      const u = n.clone();
      for (const v of basis) u.addScaledVector(v, -u.dot(v));
      if (u.length() > 0.1) basis.push(u.normalize());
    }
    const proj = (n) => { const u = n.clone(); for (const v of basis) u.addScaledVector(v, -u.dot(v)); return u; };
    // contact planes (one per normal) with the larger neighbours set so far, the largest shared area first; where they
    // cannot all be met (opposite planes, a face in the way), as many of them as can, by area
    let best = null, whole = 0;
    for (const [dir, step] of [[1, o.step], [-1, o.step], [1, o.step * 0.6], [-1, o.step * 0.6]]) {
      const planes = [];
      for (const { q, n, ov } of nb[p].cop) {
        if (!shift.has(q)) continue;
        const c = sh(q).dot(n) + dir * step, k = planes.findIndex((m) => m.n.dot(n) > 0.999);
        if (k < 0) planes.push({ n, c, ov });
        else { planes[k].c = dir > 0 ? Math.max(planes[k].c, c) : Math.min(planes[k].c, c); planes[k].ov += ov; }
      }
      if (!planes.length) break;
      planes.sort((x, y) => y.ov - x.ov);
      const all = planes.reduce((t, x) => t + x.ov, 0);
      whole = all;
      const fits = (set) => {
        if (set.some((x) => proj(x.n).length() < 0.3)) return null;
        const t = solveShift(set.map((x) => proj(x.n)), set.map((x) => x.c));
        const meets = set.every((x) => (t.dot(x.n) - x.c) * dir >= -2e-4) && t.length() <= o.step * o.maxLayer * 1.8;
        return meets && ok(p, t) ? t : null;
      };
      let t = fits(planes), got = all;
      if (!t) {
        const set = [];
        got = 0;
        for (const x of planes) { const u = fits([...set, x]); if (u) { set.push(x); t = u; got += x.ov; } }
      }
      if (t && (!best || got > best.got + 1e-9)) best = { t, got };
      if (best && best.got >= all - 1e-9) break;
    }
    if (best) pick = best.t;
    if (best && best.got < whole - 1e-9) out.stuck.push(p); // (part of it fought on: its neighbour moves next pass)
    if (pick === ZERO && nb[p].cop.some(({ q }) => shift.has(q))) out.stuck.push(p);
    shift.set(p, pick);
  }
  for (const e of cop) {
    if (Math.abs(sh(e.a).clone().sub(sh(e.b)).dot(e.n)) >= o.step * 0.5) continue;
    const pb = parts[e.b] || { mat: 'ground', snow: false };
    out.left.push({ a: parts[e.a].mat, b: pb.mat, pa: e.a, pb: e.b, ov: +e.ov.toFixed(4), n: e.n.toArray().map((x) => +x.toFixed(3)),
      why: parts[e.a].snow || pb.snow || nb[e.a].snow.length || nb[e.b]?.snow.length ? 'snow' : 'blocked' });
  }
  for (const [p, t] of shift) if (t !== ZERO && t.lengthSq() > 0) out.shift.set(p, t);
  return out;
}

/** Every sample point of triangle `a` (in its plane) inside one of the triangles `others` (same plane). */
function coveredBy(a, others) {
  const n = a.n, u = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const e1 = u.cross(n).normalize(), e2 = n.clone().cross(e1), pj = (v) => [v.dot(e1), v.dot(e2)];
  const [A, B, C] = a.p.map(pj), O = others.map((t) => t.p.map(pj));
  const inside = (q, [p0, p1, p2]) => {
    const s = (x, y, z) => (y[0] - x[0]) * (z[1] - x[1]) - (y[1] - x[1]) * (z[0] - x[0]);
    const d1 = s(p0, p1, q), d2 = s(p1, p2, q), d3 = s(p2, p0, q), e = 1e-9;
    return (d1 >= -e && d2 >= -e && d3 >= -e) || (d1 <= e && d2 <= e && d3 <= e);
  };
  const W = [[0.96, 0.02, 0.02], [0.02, 0.96, 0.02], [0.02, 0.02, 0.96], [0.49, 0.49, 0.02], [0.02, 0.49, 0.49], [0.49, 0.02, 0.49],
    [1 / 3, 1 / 3, 1 / 3], [0.7, 0.15, 0.15], [0.15, 0.7, 0.15], [0.15, 0.15, 0.7], [0.4, 0.4, 0.2], [0.2, 0.4, 0.4], [0.4, 0.2, 0.4]];
  return W.every(([x, y, z]) => { const q = [A[0] * x + B[0] * y + C[0] * z, A[1] * x + B[1] * y + C[1] * z]; return O.some((t) => inside(q, t)); });
}

/**
 * Faces of one part overlapping in one plane (a block's back wall and a stair tower's, a doubled stair-rail top, two
 * planks' faces of one door): the part's triangles grouped into PATCHES (sharing vertex indices, in one plane, facing
 * one way); per overlapping pair of patches, the one to move — the later-exported one where it lies wholly over the
 * other (a copy, an overlay), else the smaller. @returns {{mi: number, part: number, tris: number[], alt: number[]}[]}
 * (alt: the other patch, moved instead when this one is blocked)
 */
export function selfOverlaps(G, o = NUDGE, only = null) {
  const out = [];
  for (const [pi, part] of G.parts.entries()) {
    if (only && !only.has(pi)) continue;
    if (part.skip || part.snow || part.tris.length < 2) continue;
    const tris = part.tris.filter((ti) => G.T[ti].n.y >= o.downY);
    // patches: triangles sharing a vertex index, same facing, in one plane
    const par = new Map(), fd = (a) => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
    for (const ti of tris) par.set(ti, ti);
    const byIx = new Map();
    for (const ti of tris) for (const i of G.T[ti].ix) (byIx.get(i) || byIx.set(i, []).get(i)).push(ti);
    for (const list of byIx.values()) for (let k = 1; k < list.length; k++) {
      const a = G.T[list[0]], b = G.T[list[k]];
      if (a.n.dot(b.n) >= o.cos && Math.abs(a.d - b.d) <= o.coplanar) par.set(fd(list[k]), fd(list[0]));
    }
    const pid = new Map(), parea = new Map(), pfirst = new Map(), pt = new Map();
    for (const ti of tris) {
      const r = fd(ti), tr = G.T[ti];
      pid.set(ti, r); parea.set(r, (parea.get(r) || 0) + tr.area); pfirst.set(r, Math.min(pfirst.get(r) ?? Infinity, tr.t));
      (pt.get(r) || pt.set(r, []).get(r)).push(ti);
    }
    // a patch whose triangles overlap each other (a quad triangulated twice on the same corners, two boxes of an L
    // sharing a face's corners): a triangle lying ≥ 98 % under the patch's other remaining ones is dropped, smallest
    // first (nothing moves, the patch stays covered once)
    for (const list of pt.values()) {
      if (list.length < 2) continue;
      const gone = new Set();
      for (const ti of [...list].sort((x, y) => G.T[x].area - G.T[y].area || G.T[x].t - G.T[y].t)) {
        const a = G.T[ti], others = [];
        for (const tj of list) {
          if (tj === ti || gone.has(tj)) continue;
          const b = G.T[tj];
          if ([0, 1, 2].some((c) => a.lo[c] > b.hi[c] + 1e-4 || b.lo[c] > a.hi[c] + 1e-4)) continue;
          // (two triangles on a shared edge meet, they do not overlap: a plain triangulation costs nothing here)
          let shared = 0; for (const i of a.ix) if (b.ix.includes(i)) shared++;
          if (shared >= 2) continue;
          if (triOverlap(a.p, b.p, a.n) > 1e-7) others.push(b);
        }
        // covered where it lies: points over the triangle (corners pulled 2 % in, edge midpoints, inner points), each
        // inside one of the others (a union test: overlaps summed would count the others' own overlap twice)
        if (others.length && coveredBy(a, others)) gone.add(ti);
      }
      if (gone.size) out.push({ mi: part.mi, part: G.T[[...gone][0]].part, tris: [...gone], alt: [], ov: 0, dup: true });
    }
    if (parea.size < 2) continue;
    // overlaps of same-facing triangles of two patches in one plane (buckets as facePairs)
    const NQ = 10, NT = 0.18, DQ = o.reach * 2, B = new Map(), nk = (x, y, z) => ((x + 12) * 25 + (y + 12)) * 25 + (z + 12);
    for (const ti of tris) { const t = G.T[ti], k = nk(Math.round(t.n.x * NQ), Math.round(t.n.y * NQ), Math.round(t.n.z * NQ)) * 4194304 + Math.round(t.d / DQ) + 2097152; (B.get(k) || B.set(k, []).get(k)).push(ti); }
    const ov = new Map();
    for (const ti of tris) {
      const a = G.T[ti], nn = [a.n.x * NQ, a.n.y * NQ, a.n.z * NQ], ax = nn.map((v) => { const r = Math.round(v); return Math.abs(v - r) > NT ? [r, r + Math.sign(v - r)] : [r]; });
      for (const x of ax[0]) for (const y of ax[1]) for (const z of ax[2]) for (let k = -1; k <= 1; k++) {
        for (const tj of B.get(nk(x, y, z) * 4194304 + Math.round(a.d / DQ) + 2097152 + k) || []) {
          if (tj <= ti || pid.get(tj) === pid.get(ti)) continue;
          const b = G.T[tj];
          if ([0, 1, 2].some((c) => a.lo[c] > b.hi[c] + 1e-4 || b.lo[c] > a.hi[c] + 1e-4) || a.n.dot(b.n) < o.cos) continue;
          if (Math.max(...b.p.map((q) => Math.abs(a.n.dot(q) - a.d))) > o.coplanar) continue;
          const v = triOverlap(a.p, b.p, a.n);
          if (v <= 0) continue;
          const g1 = pid.get(ti), g2 = pid.get(tj), key = g1 < g2 ? `${g1}|${g2}` : `${g2}|${g1}`;
          ov.set(key, (ov.get(key) || 0) + v);
        }
      }
    }
    for (const [key, v] of [...ov.entries()].sort((x, y) => y[1] - x[1])) {
      if (v < o.minOverlap * 0.2) continue;
      const [g1, g2] = key.split('|').map(Number);
      // the copy (the later one, wholly over the other) moves, else the smaller patch
      const later = pfirst.get(g1) > pfirst.get(g2) ? g1 : g2, other = later === g1 ? g2 : g1;
      const [mv, keep] = v >= parea.get(later) * 0.98 ? [later, other] : parea.get(g1) <= parea.get(g2) ? [g1, g2] : [g2, g1];
      out.push({ mi: part.mi, part: G.T[pt.get(mv)[0]].part, tris: pt.get(mv), alt: pt.get(keep), ov: v });
    }
  }
  return out;
}

/** Integer ranges of the quantised position types (KHR_mesh_quantization), raw and normalised. */
const QRANGE = new Map([[Int8Array, [-128, 127]], [Uint8Array, [0, 255]], [Int16Array, [-32768, 32767]], [Uint16Array, [0, 65535]]]);
/**
 * The new positions (local, metres-free floats as read) stored like the authored attribute — a quantised mesh stays
 * quantised (the depth-pass merge, engine/depth-merge.js, joins only siblings of one layout: a float copy of one part
 * would draw apart, an extra call per pass) — unless a value leaves the type's range (then Float32).
 */
function sameStorage(P, arr) {
  const src = P.isInterleavedBufferAttribute ? P.data.array : P.array, R = QRANGE.get(src.constructor);
  if (R && P.itemSize === 3) {
    const k = P.normalized ? R[1] : 1, lo = P.normalized ? Math.max(-1, R[0] / R[1]) : R[0], hi = P.normalized ? 1 : R[1];
    if (arr.every((x) => x >= lo - 1e-9 && x <= hi + 1e-9)) {
      const q = (x) => Math.min(R[1], Math.max(R[0], Math.round(x * k)));
      if (P.isInterleavedBufferAttribute) {
        // (meshopt pads xyz to a 4-element stride: the copy keeps the stride, the offset and the padding)
        const st = P.data.stride, data = new THREE.InterleavedBuffer(src.slice(), st);
        for (let i = 0; i < P.count; i++) for (let c = 0; c < 3; c++) data.array[i * st + P.offset + c] = q(arr[i * 3 + c]);
        return new THREE.InterleavedBufferAttribute(data, 3, P.offset, P.normalized);
      }
      const out = new src.constructor(arr.length);
      for (let i = 0; i < arr.length; i++) out[i] = q(arr[i]);
      return new THREE.BufferAttribute(out, 3, P.normalized);
    }
  }
  return new THREE.BufferAttribute(arr, 3);
}

/**
 * Write the parts' accumulated root-space shifts and the dropped doubled triangles into the drawn geometry (gameplay
 * keeps the authored positions and index).
 */
function writeDrawn(G, total, drop = new Map(), lifts = new Map()) {
  const { parts, meshes } = G;
  const byMesh = new Map();
  for (const [p, t] of total) {
    const part = parts[p];
    let moves = byMesh.get(part.mi); if (!moves) byMesh.set(part.mi, moves = new Map());
    for (const ti of part.tris) for (const i of G.T[ti].ix) moves.set(i, t);
  }
  // (a lifted copy's vertices are its own: none is shared with the other copy or the rest of the part's faces)
  for (const [mi, m] of lifts) {
    let moves = byMesh.get(mi); if (!moves) byMesh.set(mi, moves = new Map());
    for (const [i, t] of m) moves.set(i, moves.has(i) ? moves.get(i).clone().add(t) : t);
  }
  for (const mi of drop.keys()) if (!byMesh.has(mi)) byMesh.set(mi, new Map());
  const changed = new Map();
  for (const [mi, moves] of byMesh) {
    const set = new Set(moves.keys());
    const I = meshes[mi].o.geometry.index;
    for (const t of drop.get(mi) || []) for (let k = 0; k < 3; k++) set.add(I ? I.getX(t + k) : t + k);
    changed.set(meshes[mi].o, set);
  }
  // geometries used by several meshes of the scene: each moved mesh draws its own copy
  const users = new Map();
  for (const m of meshes) users.set(m.o.geometry, (users.get(m.o.geometry) || 0) + 1);
  for (const [mi, moves] of byMesh) {
    const { o: mesh, M } = meshes[mi], src = mesh.geometry, P = src.getAttribute('position');
    // what gameplay measures: the authored positions and index (a refinement's registered original if there is one),
    // never written to — the drawn geometry gets a new position array
    let game = gameplayGeometry(src);
    if (game === src) {
      game = new THREE.BufferGeometry();
      game.setAttribute('position', P);
      if (src.index) game.setIndex(src.index);
    }
    let geo = src;
    if (users.get(src) > 1) { users.set(src, users.get(src) - 1); geo = mesh.geometry = src.clone(); }
    setGameplayGeometry(geo, game);
    const lin = new THREE.Matrix3().setFromMatrix4(M).invert(), v = new THREE.Vector3(), dv = new THREE.Vector3();
    if (moves.size) {
      const arr = new Float32Array(P.count * 3);
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i);
        const mv = moves.get(i);
        if (mv) v.add(dv.copy(mv).applyMatrix3(lin));
        arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
      }
      geo.setAttribute('position', sameStorage(P, arr));
    }
    // dropped copies: degenerate triangles (a new index; the groups' ranges stay as they are)
    const dr = drop.get(mi);
    if (dr?.size) {
      const I = src.index;
      if (I) {
        const ix = new (I.count > 65535 || I.array instanceof Uint32Array ? Uint32Array : Uint16Array)(I.array);
        for (const t of dr) { ix[t + 1] = ix[t]; ix[t + 2] = ix[t]; }
        geo.setIndex(new THREE.BufferAttribute(ix, 1));
      } else {
        const Pd = geo.getAttribute('position'), arr = Pd === P ? Float32Array.from({ length: P.count * 3 }, (_, k) => P.getComponent(Math.floor(k / 3), k % 3)) : Pd.array;
        for (const t of dr) for (let c = 0; c < 3; c++) { arr[(t + 1) * 3 + c] = arr[t * 3 + c]; arr[(t + 2) * 3 + c] = arr[t * 3 + c]; }
        if (Pd === P) geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      }
    }
    geo.boundingBox = null; geo.boundingSphere = null;
  }
  return changed;
}
