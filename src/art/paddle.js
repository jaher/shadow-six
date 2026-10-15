/**
 * The raft's paddles (user 2026-10-15: "The oars of the raft are rectangular, make them nicer"). The library raft
 * (tools/blender/vehicles/naval/scripts/raft.py) shipped a 6-sided pole with a flat board for a blade, the paddle the
 * Marine strokes with (art/boat-crew.js makePaddle) three loose pieces; both are now this one paddle, the short wooden
 * single-bladed paddle of the period's assault boats and dinghies:
 *
 *  - a T-grip (crutch) across the top: a rounded bar, thickest in the middle, flattened a little under the palm;
 *  - a round shaft tapering from 31 mm under the grip to 38 mm at the throat;
 *  - the throat flaring into an oval blade (17 cm across, 44 cm long, the widest just past half way, a rounded tip),
 *    lens-shaped in section — a ridge down the middle (18 mm thick at the throat, 12 mm at the tip) thinning to a 3 mm
 *    edge — its power face (+Z) dished like a spoon and the tip turned a little toward it;
 *  - grain along its length (the kit's timber texture, uv in metres down the shaft), the colour per vertex: varnished
 *    wood, polished lighter where the hands hold it (the grip and the shaft's upper half), darker and wetter from the
 *    waterline down over the blade, the blade's rim scuffed pale.
 *
 * One loft of rings round its axis (shaft → throat → blade, every ring the same number of points) plus the grip bar:
 * LOD0 ~290 triangles, LOD2 ~60, indexed, one draw each. The canonical frame (makePaddle's): origin at the T-grip, the
 * shaft down −Y, the blade's face +Z, its width (and the grip bar) along X, the tip at y = −PADDLE.length.
 *
 * The raft's own paddles (both LODs of raft_deployed, the loose ones of the wreck) are swapped for it as the GLBs load
 * (art/vehicle-library.js SCENE_FIXES → raftPaddleFix): each in its own node (rig: rowlock pivot, posed by the crew
 * and the raft's actions), its grip where the old pole's inboard end was, its blade toward the old board, with the
 * GLB's own attribute set (position, normal, uv, uv1 for the baked AO, RGBA colour) so it draws with the raft's own
 * timber material and shader program — no draw and no shader added. The held paddle takes the raft's material too.
 * @module art/paddle
 */
import * as THREE from 'three';

/** Dimensions (m): grip to tip, blade length / width, the grip bar's length, shaft radius under the grip / at the throat. */
export const PADDLE_SHAPE = Object.freeze({ length: 1.45, blade: 0.44, width: 0.17, grip: 0.115, r0: 0.0155, r1: 0.019 });
/** Texture metres → uv (along the grain = v). */
const UVS = 2.2;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const lerp = (a, b, k) => a + (b - a) * k;

/**
 * Blade stations (t = 0 at the throat … 1 at the tip): half-width, centre half-thickness, lens blend (0 round … 1 lens).
 * The outline: narrow throat flaring fast, widest at 0.45–0.6, an elliptical tip.
 */
const BLADE = [
  [0.00, 0.022, 0.0090, 0.25], [0.05, 0.036, 0.0088, 0.6], [0.12, 0.058, 0.0080, 0.9], [0.22, 0.074, 0.0072, 1],
  [0.36, 0.083, 0.0066, 1], [0.52, 0.085, 0.0062, 1], [0.68, 0.081, 0.0060, 1], [0.80, 0.071, 0.0058, 1],
  [0.89, 0.056, 0.0056, 1], [0.95, 0.038, 0.0055, 1], [0.985, 0.020, 0.0050, 1],
];
const BLADE_LOD2 = [[0.0, 0.024, 0.009, 0.4], [0.3, 0.08, 0.0068, 1], [0.7, 0.08, 0.006, 1], [0.95, 0.04, 0.0055, 1]];
/** Shaft stations: how far down from the grip's centre to the throat (fraction), radius. */
const SHAFT = [[0.012, 0.0155], [0.06, 0.016], [0.38, 0.0168], [0.77, 0.018], [0.95, 0.0188]];
const SHAFT_LOD2 = [[0.012, 0.0158], [0.95, 0.0188]];
/** The shorter paddle of the men paddling from the side tubes (grip to tip, m). */
export const SIDE_PADDLE = 1.25;
/** The grip bar: stations along x (fraction of the half-length), radius. */
const GRIP = [[1, 0], [0.92, 0.0125], [0.6, 0.0155], [0, 0.0172]];
const GRIP_LOD2 = [[1, 0], [0.8, 0.0145], [0, 0.017]];
const EDGE = 0.0016;          // the blade's half-thickness at its rim

/** Vertex colour (linear-ish multipliers of the timber material) at height y (canonical) and blade rim fraction e. */
function tint(y, e, grip, L = PADDLE_SHAPE.length) {
  const base = [0.86, 0.69, 0.5];
  // polished where the hands go: the grip bar and the upper half of the shaft
  const pol = grip ? 1 : smooth((-y - (L - PADDLE_SHAPE.blade) * 0.75) / -0.5) * 0.8;
  const c = base.map((v, i) => lerp(v, [0.98, 0.82, 0.62][i], pol));
  // wet and darker from the waterline down (the throat), the most at the tip
  const wl = L - PADDLE_SHAPE.blade - 0.15;           // the waterline mark: just above the throat
  const wet = smooth((-y - wl) / 0.2) * (0.75 + 0.25 * smooth((-y - (L - 0.2)) / 0.2));
  for (let i = 0; i < 3; i++) c[i] = lerp(c[i], [0.5, 0.39, 0.29][i], wet * 0.85);
  // the blade's rim scuffed pale
  const sc = smooth((e - 0.72) / 0.28) * (wet > 0 ? 0.45 : 0.3);
  for (let i = 0; i < 3; i++) c[i] = lerp(c[i], [0.9, 0.8, 0.66][i], sc);
  return c;
}

/**
 * Build the paddle geometry (canonical frame) for a LOD (0 or 2): non-indexed attributes collected first, then one
 * indexed BufferGeometry with position, normal, uv, uv1 (filled with `ao` [u, v]: one bright texel of the raft's
 * baked AO, or 0), colour RGBA.
 */
function build(lod, ao = [0, 0], L = PADDLE_SHAPE.length) {
  const M = lod ? 4 : 8;                                        // points per ring
  const P = [], UV = [], C = [], I = [];
  const Bl = PADDLE_SHAPE.blade, y0b = -(L - Bl);
  // ---- the loft: shaft rings then blade rings, M + 1 points each (a seam for the uv wrap)
  const rings = [];
  for (const [f, r] of lod ? SHAFT_LOD2 : SHAFT) rings.push({ y: f * y0b, hw: r, hc: r, lens: 0, t: -1 });
  for (const [t, hw, hc, lens] of lod ? BLADE_LOD2 : BLADE) rings.push({ y: y0b - t * Bl, hw, hc, lens, t });
  const ringStart = [];
  for (const R of rings) {
    ringStart.push(P.length / 3);
    const spoon = R.t >= 0 ? 0.004 * smooth(R.t / 0.3) : 0, bend = R.t >= 0 ? 0.012 * R.t * R.t : 0;
    for (let j = 0; j <= M; j++) {
      const th = (j / M) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
      // round (shaft) → lens (blade): x across, z through the blade
      const xr = R.hw * cs, zr = R.hc * sn;
      const ax = Math.abs(cs);
      const thick = EDGE + (R.hc - EDGE) * Math.pow(1 - ax, 0.85);      // the ridge down the middle, thin at the rim
      const xl = R.hw * cs, zl = Math.sign(sn) * thick * Math.min(1, Math.abs(sn) * 3);
      let x = lerp(xr, xl, R.lens), z = lerp(zr, zl, R.lens);
      z += spoon * (x / Math.max(1e-6, R.hw)) ** 2 + bend;               // dished power face (+Z), the tip turned to it
      P.push(x, R.y, z);
      UV.push((j / M) * Math.max(0.05, R.hw * 4) * UVS, -R.y * UVS);
      C.push(...tint(R.y, R.t >= 0 ? ax : 0, false, L), 1);
    }
  }
  for (let k = 0; k + 1 < rings.length; k++) {
    const a = ringStart[k], b = ringStart[k + 1];
    for (let j = 0; j < M; j++) I.push(a + j, a + j + 1, b + j, a + j + 1, b + j + 1, b + j);
  }
  // the tip: a fan to its point (rounded)
  const tipI = P.length / 3, last = ringStart[rings.length - 1];
  P.push(0, -L, 0.012); UV.push(0.1, L * UVS); C.push(...tint(-L, 1, false, L), 1);
  for (let j = 0; j < M; j++) I.push(last + j, last + j + 1, tipI);
  // ---- the grip bar along x (round, a little flattened on top), capped
  const Mg = lod ? 4 : 6, hl = PADDLE_SHAPE.grip / 2, gs = [];
  const G = lod ? GRIP_LOD2 : GRIP;
  const stations = [...G.map(([f, r]) => [-f * hl, r]), ...G.slice(0, -1).reverse().map(([f, r]) => [f * hl, r])];
  for (const [x, r] of stations) {
    gs.push(P.length / 3);
    for (let j = 0; j <= Mg; j++) {
      const th = (j / Mg) * Math.PI * 2;
      P.push(x, r * Math.cos(th) * (Math.cos(th) > 0 ? 0.88 : 1), r * Math.sin(th));
      UV.push(x * UVS, (j / Mg) * 0.1 * UVS);
      C.push(...tint(0, 0, true, L), 1);
    }
  }
  for (let k = 0; k + 1 < stations.length; k++) {
    const a = gs[k], b = gs[k + 1];
    for (let j = 0; j < Mg; j++) I.push(a + j, a + j + 1, b + j, a + j + 1, b + j + 1, b + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  const uv1 = new Float32Array((P.length / 3) * 2);
  for (let i = 0; i < uv1.length; i += 2) { uv1[i] = ao[0]; uv1[i + 1] = ao[1]; }
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 4));
  g.setIndex(I);
  g.computeVertexNormals();
  weldSeams(g, M, ringStart, Mg, gs);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/** The loft's uv seams (point 0 and point M of each ring) share one normal: no shading seam down the paddle. */
function weldSeams(g, M, rs, Mg, gs) {
  const n = g.attributes.normal;
  const pair = (a, b) => {
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  };
  for (const a of rs) pair(a, a + M);
  for (const a of gs) pair(a, a + Mg);
}

const CANON = new Map();
/** The canonical paddle geometry (shared; never disposed by an entity) for a LOD, its uv1 at `ao`. */
export function paddleGeometry(lod = 0, ao = null, length = PADDLE_SHAPE.length) {
  const key = `${lod}|${ao ? ao.map((v) => v.toFixed(4)).join(',') : ''}|${length}`;
  let g = CANON.get(key);
  if (!g) { g = build(lod ? 2 : 0, ao || [0, 0], length); g.userData.shared = true; g.name = `paddle_lod${lod}`; CANON.set(key, g); }
  return g;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/**
 * The frame of an old paddle in its node (node-local): `grip` the inboard end of its shaft, `axis` grip → blade,
 * `face` the blade's face normal (the thinnest direction across the blade, toward the node's up), its length — from
 * the drawn vertices (the axis of greatest spread; the blade the wider end), whatever the paddle's pose in the GLB.
 */
export function paddleFrame(pts, up = new THREE.Vector3(0, 1, 0)) {
  const n = pts.length;
  if (n < 4) return null;
  const c = new THREE.Vector3();
  for (const p of pts) c.add(p);
  c.multiplyScalar(1 / n);
  // the principal axis: power iteration on the covariance
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = _a.subVectors(p, c);
    const v = [d.x, d.y, d.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += v[i] * v[j];
  }
  const mul = (v) => new THREE.Vector3(C[0] * v.x + C[1] * v.y + C[2] * v.z, C[3] * v.x + C[4] * v.y + C[5] * v.z, C[6] * v.x + C[7] * v.y + C[8] * v.z);
  let axis = new THREE.Vector3(1, 0.3, 0.2).normalize();
  for (let k = 0; k < 40; k++) axis = mul(axis).normalize();
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { const s = _a.subVectors(p, c).dot(axis); lo = Math.min(lo, s); hi = Math.max(hi, s); }
  // the spread across the axis at either end: the blade is the wide end
  const spread = (from, to) => {
    let m = 0;
    for (const p of pts) { const s = _a.subVectors(p, c).dot(axis); if (s >= from && s <= to) m = Math.max(m, _b.copy(_a).addScaledVector(axis, -s).length()); }
    return m;
  };
  const len = hi - lo;
  if (spread(hi - len * 0.15, hi) < spread(lo, lo + len * 0.15)) { axis.negate(); [lo, hi] = [-hi, -lo]; }
  // the blade's width direction (greatest spread across the axis near the blade), the face normal across it
  const blade = pts.filter((p) => _a.subVectors(p, c).dot(axis) > hi - len * 0.25);
  let wdir = new THREE.Vector3(), best = -1;
  for (const p of blade) for (const q of blade) {
    _b.subVectors(p, q); _b.addScaledVector(axis, -_b.dot(axis));
    const l = _b.lengthSq();
    if (l > best) { best = l; wdir.copy(_b); }
  }
  wdir.normalize();
  const face = new THREE.Vector3().crossVectors(axis, wdir).normalize();
  if (face.dot(up) < 0) face.negate();
  // the grip end: the shaft's centre at the inboard extreme
  const end = pts.filter((p) => _a.subVectors(p, c).dot(axis) < lo + 0.04);
  const grip = new THREE.Vector3();
  for (const p of end) grip.add(p);
  grip.multiplyScalar(1 / Math.max(1, end.length));
  grip.addScaledVector(axis, lo - _c.subVectors(grip, c).dot(axis));
  return { grip, axis, face, length: len };
}

/** Matrix taking the canonical paddle (origin at the grip, −Y along the shaft, +Z the face) into a frame. */
export function paddleMatrix(F, out = new THREE.Matrix4()) {
  const y = F.axis.clone().negate(), z = F.face.clone().addScaledVector(F.axis, -F.face.dot(F.axis)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return out.makeBasis(x, y, z).setPosition(F.grip);
}

/**
 * Swap the paddles of a loaded raft LOD scene (raft_deployed: both in their rowlocks; raft_deflated: the loose ones)
 * for the shaped paddle: each paddle node keeps its frame (its rowlock pivot, posed by the crew rig and the raft's
 * actions) and its one mesh and material; the mesh gets the paddle geometry laid along the old pole (grip at its
 * inboard end, blade toward the old board) in the GLB's attribute set, its uv1 on the brightest AO the old paddle had.
 * @returns {number} paddles swapped
 */
export function raftPaddleFix(scene) {
  scene.updateMatrixWorld(true);
  let n = 0;
  const lods = [];
  scene.traverse((o) => { if (/_lod(\d+)$/.test(o.name)) lods.push(o); });
  for (const lodNode of lods.length ? lods : [scene]) {
    const lod = +(/_lod(\d+)$/.exec(lodNode.name)?.[1] ?? 0);
    const nodes = [];
    lodNode.traverse((o) => { if (/^paddle_[lr]$/.test(o.name)) nodes.push(o); });
    for (const node of nodes) {
      const meshes = [];
      node.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o); });
      const mesh = meshes[0];
      if (!mesh || mesh.geometry.userData.paddle) continue;
      // the old pole's vertices (node-local) and its brightest-AO uv1
      const inv = new THREE.Matrix4().copy(node.matrixWorld).invert(), pts = [];
      let ao = null, aoY = -Infinity;
      for (const m of meshes) {
        const M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld), pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal, uv1 = m.geometry.attributes.uv1;
        for (let i = 0; i < pos.count; i++) {
          pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(M));
          // (an up-facing vertex: its AO texel is unoccluded sky)
          if (uv1 && nor) { const ny = _a.fromBufferAttribute(nor, i).transformDirection(m.matrixWorld).y; if (ny > aoY) { aoY = ny; ao = [uv1.getX(i), uv1.getY(i)]; } }
        }
      }
      const up = new THREE.Vector3(0, 1, 0).transformDirection(inv);
      const F = paddleFrame(pts, up);
      if (!F) continue;
      const src = paddleGeometry(lod >= 2 ? 2 : 0, ao);
      const g = src.clone();
      g.applyMatrix4(paddleMatrix(F));
      g.userData = { paddle: true };
      // the mesh sits in the node with no transform of its own (the GLB's dequantisation scale is not needed)
      mesh.geometry = g;
      mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);
      mesh.updateMatrix(); mesh.updateMatrixWorld(true);
      for (const m of meshes.slice(1)) m.visible = false;
      n++;
    }
  }
  return n;
}

let HELD_MAT = null;
/**
 * The paddle the Marine strokes with (art/boat-crew.js applyPaddlePose: origin at the T-grip, −Y the shaft, +Z the
 * blade face): one mesh, the raft's own paddle material when given (its program already drawn) with `ao` the uv1 its
 * paddles use, else a plain wood; `length` grip to tip (the side paddlers' shorter one: SIDE_PADDLE).
 */
export function makePaddleMesh(material = null, ao = null, length = PADDLE_SHAPE.length) {
  const mat = material || (HELD_MAT ||= Object.assign(new THREE.MeshStandardMaterial({ color: 0xd8ccbc, roughness: 0.85, vertexColors: true }), { name: 'paddle_wood' }));
  const m = new THREE.Mesh(paddleGeometry(0, material ? ao : null, length), mat);
  m.name = 'prop_paddle'; m.castShadow = true; m.receiveShadow = true;
  return m;
}
