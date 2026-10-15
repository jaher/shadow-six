/**
 * Conductor fixing points of cable-carrying models (power pylons, telegraph poles, rope portals).
 *
 * Each model marks the exact point a wire is fixed to (the clamp under a suspension insulator string, the groove of a
 * pin insulator, a rope saddle) with an empty child node named `cable:<k>`, in its own local frame. Wires are drawn
 * between those nodes' WORLD positions, read once the model is placed, turned and seated; never from layout numbers
 * or a copy of the model's dimensions. A swapped or rescaled model, a lift or a re-seat keeps its wires on its
 * insulators, and a model with n insulators carries n conductors.
 * Pure three.js (runs in Node for the unit tests).
 * @module art/cable-attach
 */
import * as THREE from 'three';

/** Name of a fixing node: `cable:<k>` (k = 0, 1, …). */
export const CABLE_NODE = /^cable:(\d+)$/;

/**
 * Mark a conductor fixing point on `parent` (its local frame).
 * @param {THREE.Object3D} parent @param {number} k index @param {number} x @param {number} y @param {number} z
 * @param {{r?: number}} [o] r: radius of the conductor that hangs there (m; the wire builder's default otherwise)
 * @returns {THREE.Object3D}
 */
export function addCableNode(parent, k, x, y, z, o = {}) {
  const n = new THREE.Object3D();
  n.name = `cable:${k}`;
  n.position.set(x, y, z);
  if (o.r) n.userData.cableR = o.r;
  parent.add(n);
  return n;
}

/** The `cable:<k>` nodes under `obj` (itself included), in k order. */
export function cableNodes(obj) {
  const out = [];
  obj?.traverse?.((o) => { const m = CABLE_NODE.exec(o.name || ''); if (m) out.push([+m[1], o]); });
  return out.sort((a, b) => a[0] - b[0]).map((e) => e[1]);
}

const _v = new THREE.Vector3();
/**
 * World fixing points of a placed model (its world matrices brought up to date first).
 * @returns {{node: THREE.Object3D, p: number[], r?: number}[]} in k order; [] for a model without fixing nodes
 */
export function cablePoints(obj) {
  if (!obj?.updateWorldMatrix) return [];
  obj.updateWorldMatrix(true, true);
  return cableNodes(obj).map((node) => { node.getWorldPosition(_v); return { node, p: [_v.x, _v.y, _v.z], r: node.userData.cableR }; });
}

/**
 * Which fixing point of B each fixing point of A is wired to. Points are compared in the span's own frame, by their
 * offset across the span (A→B, measured from their tower's mean fixing point) and their height above that mean, and
 * paired by the least total squared mismatch: exhaustive up to 7 conductors, greedy above. The upper-left conductor
 * stays upper-left on the next tower whatever either tower's yaw (a tower turned 180° does not cross its wires).
 * @param {number[][]} A world points [x, y, z] @param {number[][]} B
 * @returns {[number, number][]} min(|A|, |B|) index pairs [i in A, j in B]
 */
export function pairConductors(A, B) {
  const n = Math.min(A.length, B.length);
  if (!n) return [];
  const mean = (P) => P.reduce((s, q) => [s[0] + q[0] / P.length, s[1] + q[1] / P.length, s[2] + q[2] / P.length], [0, 0, 0]);
  const ca = mean(A), cb = mean(B);
  let ux = cb[0] - ca[0], uz = cb[2] - ca[2];
  const L = Math.hypot(ux, uz) || 1; ux /= L; uz /= L;
  const feat = (q, c) => [(q[0] - c[0]) * -uz + (q[2] - c[2]) * ux, q[1] - c[1]];
  const fa = A.map((q) => feat(q, ca)), fb = B.map((q) => feat(q, cb));
  const cost = (i, j) => (fa[i][0] - fb[j][0]) ** 2 + (fa[i][1] - fb[j][1]) ** 2;
  // rows = the smaller set, every row takes a distinct column
  const swap = A.length > B.length, R = swap ? B.length : A.length, C = swap ? A.length : B.length;
  const c = (r, k) => (swap ? cost(k, r) : cost(r, k));
  let best = null;
  if (C <= 7) {
    let bestCost = Infinity;
    const used = new Array(C).fill(false), pick = [];
    const walk = (r, acc) => {
      if (acc >= bestCost) return;
      if (r === R) { bestCost = acc; best = pick.slice(); return; }
      for (let k = 0; k < C; k++) if (!used[k]) { used[k] = true; pick.push(k); walk(r + 1, acc + c(r, k)); pick.pop(); used[k] = false; }
    };
    walk(0, 0);
  } else {
    const used = new Array(C).fill(false);
    best = [];
    for (let r = 0; r < R; r++) { let bk = -1; for (let k = 0; k < C; k++) if (!used[k] && (bk < 0 || c(r, k) < c(r, bk))) bk = k; used[bk] = true; best.push(bk); }
  }
  return best.map((k, r) => (swap ? [k, r] : [r, k]));
}

/**
 * The conductors of one span between two placed models' fixing points (cablePoints()).
 * @param {{node, p: number[], r?: number}[]} A @param {{node, p: number[], r?: number}[]} B
 * @returns {{a: number[], b: number[], an: THREE.Object3D, bn: THREE.Object3D, r?: number}[]}
 */
export function conductorSpans(A, B) {
  return pairConductors(A.map((q) => q.p), B.map((q) => q.p)).map(([i, j]) => {
    const r = Math.max(A[i].r || 0, B[j].r || 0) || undefined;
    return { a: A[i].p, b: B[j].p, an: A[i].node, bn: B[j].node, r };
  });
}

const _c = new THREE.Vector3(), _q = new THREE.Vector3();
/**
 * Measured fit of every conductor drawn under `root`: each mesh that carries `userData.cableSpans` ({a, b} fixing
 * nodes a span) and `geometry.userData.spans` ({ends: [[first vertex of the a-end ring, … of the b-end ring]], ring})
 * as wireGeometry() writes them. For each span end: the distance from the drawn ring's centre (world) to its fixing
 * node's CURRENT world position — a model moved, turned or re-seated after its wires were built shows up here.
 * @returns {{mesh: string, span: number, end: 'a'|'b', gap: number, at: number[], node: string}[]}
 */
export function measureCableEnds(root) {
  const out = [];
  root.updateWorldMatrix?.(true, true);
  root.traverse((m) => {
    const S = m.userData?.cableSpans, G = m.geometry?.userData?.spans;
    if (!m.isMesh || !S || !G) return;
    const P = m.geometry.attributes.position;
    S.forEach((s, k) => {
      for (const [end, i0, node] of [['a', G.ends[k][0], s.a], ['b', G.ends[k][1], s.b]]) {
        _c.set(0, 0, 0);
        for (let j = 0; j < G.ring; j++) _c.add(_q.fromBufferAttribute(P, i0 + j));
        _c.multiplyScalar(1 / G.ring).applyMatrix4(m.matrixWorld);
        node.getWorldPosition(_q);
        out.push({ mesh: m.name, span: k, end, gap: _c.distanceTo(_q), at: [_q.x, _q.y, _q.z], node: node.name });
      }
    });
  });
  return out;
}
