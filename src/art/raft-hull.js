/**
 * The Marine's raft as a deformable hull (art/raft-actions.js; user 2026-10-14: "when the raft is inflated it should be
 * very clear it gets inflated"). Procedural vertex deformation of the library raft's own meshes (both LODs), in model
 * space (+x the boat's left, y up from the design waterline, +z the bow), parameterised once on the buoyancy tube's
 * centreline (tools/blender/vehicles/naval/scripts/raft.py loop_path: the stadium of the 0.19 m tube, the bow raised):
 *
 *  - INFLATION: every vertex near the tube is placed on its cross-section (angle θ round the tube, distance ρ from the
 *    centreline); a chamber filled to q draws that section as an ellipse growing from a flat double layer lying on the
 *    water (half-width 1.45 R, half-height 1.2 cm: the deflated fabric spread flat) to the round tube (R), its bottom
 *    rising from the sheet to the tube's own, the raised bow coming up with it. Each chamber fills from its inlet
 *    (abilities/raft-actions.js CHAMBERS: the valve, then the baffles in turn), so a half-full chamber is round at
 *    one end and flat at the other; the baffle between a full and an empty chamber is pinched. The floor's rim is part
 *    of the tube's section (it stays on the water), the thwart (interior) rises from the floor last. A full hull
 *    overshoots a little and settles (the bounce).
 *  - WRINKLES: a flat chamber is crumpled — vertical and sideways creases along and round the tube — fading as it fills
 *    (gone when taut), and the materials (own clones while deforming) carry a matching crease normal pattern whose
 *    strength (uWrinkle) fades the same way: the floor's single flat face reads crumpled too.
 *  - FOLD and GATHER (packing, reversed when unpacking): the flat sheet's sides fold in over the middle along two
 *    hinge lines (|x| = 0.27 m), then the strip is gathered from its near end into a stack of 0.36 m pleats, pressed
 *    into a pack (art/raft-actions.js swaps in the strapped pack prop there).
 *  - The paddles (rigid) lie flat on the floor while it is flat and go to their rowlocks as it fills.
 * Normals are recomputed from the deformed positions (welded across the GLB's split vertices, hard edges kept). The
 * shared library geometry is never written: the hull gets its own position / normal buffers while deforming, and the
 * library's geometry back on restore(); nothing is allocated per frame.
 * @module art/raft-hull
 */
import * as THREE from 'three';

/** raft.py: length, beam, tube radius, tube centre height (draft 8 cm), floor height. */
export const HULL = Object.freeze({ L: 2.7, B: 1.3, R: 0.19, ZC: 0.11, ZF: 0.02 });
/** Flat sheet: its top (model y), the deflated section's half-width / half-height (× R / m), the fold hinges, the pleats. */
export const SHEET = Object.freeze({ y: 0.022, wide: 1.45, thin: 0.012, hinge: 0.27, flap: 0.022, pleat: 0.36, layer: 0.03, near: 1.42 });
/** Interior parts (thwart) start farther than this from the tube's centreline (× R). */
const TUBE_REACH = 1.45;
const N_LOOP = 480;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

let LOOP = null;
/** The tube's centreline samples (s = i / N from the stern's centre toward the boat's right, -x), model space. */
export function tubeLoop() {
  if (LOOP) return LOOP;
  const a = HULL.L / 2 - HULL.R, b = HULL.B / 2 - HULL.R;
  const P = new Float64Array(N_LOOP * 3), T = new Float64Array(N_LOOP * 3), Nn = new Float64Array(N_LOOP * 2);
  for (let i = 0; i < N_LOOP; i++) {
    const th = Math.PI / 2 + (i / N_LOOP) * TAU, ct = Math.cos(th), sn = Math.sin(th);
    const yb = a * Math.sign(sn) * Math.abs(sn) ** 0.35;
    let xb = b * Math.sign(ct) * Math.abs(ct) ** 0.8;
    if (yb < 0) xb *= 1 - 0.18 * (-yb / a) ** 3;
    const zb = HULL.ZC + (yb < 0 ? 0.14 * Math.max(0, (-yb - a * 0.4) / (a * 0.6)) ** 2 : 0);
    P[i * 3] = xb; P[i * 3 + 1] = zb; P[i * 3 + 2] = -yb;   // Blender (x, y, z) → glTF (x, z, -y)
  }
  for (let i = 0; i < N_LOOP; i++) {
    const p = ((i + 1) % N_LOOP) * 3, q = ((i + N_LOOP - 1) % N_LOOP) * 3;
    let tx = P[p] - P[q], ty = P[p + 1] - P[q + 1], tz = P[p + 2] - P[q + 2];
    const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
    T[i * 3] = tx; T[i * 3 + 1] = ty; T[i * 3 + 2] = tz;
    let nx = tz, nz = -tx;
    const lp = Math.hypot(nx, nz) || 1; nx /= lp; nz /= lp;
    if (nx * P[i * 3] + nz * P[i * 3 + 2] < 0) { nx = -nx; nz = -nz; }   // outward
    Nn[i * 2] = nx; Nn[i * 2 + 1] = nz;
  }
  return (LOOP = { P, T, N: Nn, n: N_LOOP });
}

/** Chamber index of loop parameter s (abilities/raft-actions.js CHAMBERS order) and the distance from its inlet (0..1). */
function chamberOf(s) {
  const w = s > 0.5 + 0.33 ? s - 1 : s;   // (-0.17 .. 0.83)
  if (w < 0.17) return [0, clamp(Math.abs(w - -0.08) / 0.25, 0, 1)];
  if (w < 0.5) return [1, clamp((w - 0.17) / 0.33, 0, 1)];
  return [2, clamp((0.83 - w) / 0.33, 0, 1)];
}

/**
 * Parameterise a model-space point on the tube: {tube, s, c:[x,y,z], t:[x,y,z], n:[x,z], ca, sa, along, k, dIn, ph}
 * (ca / sa: ρ/R · cos θ / sin θ in the section; k: chamber; dIn: from its inlet; ph: crease phase) or {tube:false} for
 * the interior (the thwart).
 */
export function paramPoint(x, y, z) {
  const L = tubeLoop(), P = L.P;
  let best = 0, bd = Infinity;
  for (let i = 0; i < L.n; i++) {
    const d = (P[i * 3] - x) ** 2 + (P[i * 3 + 1] - y) ** 2 + (P[i * 3 + 2] - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  // refine on the two segments either side (continuous s, c)
  let s = best / L.n, cx = P[best * 3], cy = P[best * 3 + 1], cz = P[best * 3 + 2], dmin = bd;
  for (const j of [(best + L.n - 1) % L.n, (best + 1) % L.n]) {
    const ax = P[best * 3], ay = P[best * 3 + 1], az = P[best * 3 + 2], bx = P[j * 3], by = P[j * 3 + 1], bz = P[j * 3 + 2];
    const ex = bx - ax, ey = by - ay, ez = bz - az, ll = ex * ex + ey * ey + ez * ez || 1;
    const u = clamp(((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / ll, 0, 1);
    const qx = ax + ex * u, qy = ay + ey * u, qz = az + ez * u, d = (qx - x) ** 2 + (qy - y) ** 2 + (qz - z) ** 2;
    if (d < dmin) {
      dmin = d; cx = qx; cy = qy; cz = qz;
      const sj = j / L.n, sb = best / L.n;
      let ds = sj - sb; if (ds > 0.5) ds -= 1; if (ds < -0.5) ds += 1;
      s = sb + ds * u;
    }
  }
  s = ((s % 1) + 1) % 1;
  const i0 = Math.floor(s * L.n) % L.n, i1 = (i0 + 1) % L.n, f = s * L.n - Math.floor(s * L.n);
  const lerp = (A, k, m) => A[i0 * m + k] * (1 - f) + A[i1 * m + k] * f;
  let tx = lerp(L.T, 0, 3), ty = lerp(L.T, 1, 3), tz = lerp(L.T, 2, 3);
  const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
  let nx = lerp(L.N, 0, 2), nz = lerp(L.N, 1, 2);
  const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
  const r = (x - cx) * nx + (z - cz) * nz, u = y - cy, rho = Math.hypot(r, u);
  const inside = r < 0;
  if (inside && rho > TUBE_REACH * HULL.R) return { tube: false };
  const th = Math.atan2(u, r), rn = rho / HULL.R;
  const along = (x - cx) * tx + (y - cy) * ty + (z - cz) * tz;
  const [k, dIn] = chamberOf(s);
  return { tube: true, s, c: [cx, cy, cz], t: [tx, ty, tz], n: [nx, nz], ca: rn * Math.cos(th), sa: rn * Math.sin(th), th, rn, along, k, dIn,
    ph: Math.sin(x * 12.9898 + z * 78.233) * 43758.5453 % 1 };
}

/**
 * Hull state (all fills 0..1, from abilities/raft-actions.js chamberLevel): fill[4] (stern, right, left, thwart),
 * bounce (± fraction of R), front (+1 filling from the inlets, -1 emptying: the middle of a chamber sags first),
 * foldL / foldR (0 flat … 1 folded in), gather (0 … 1 of the strip stacked), press (0 … 1 the stack pressed),
 * near (-1 the stern end is the near end, +1 the bow), paddle (0 flat on the floor … 1 in the rowlocks), paddleShow.
 */
export function hullState() {
  return { fill: new Float32Array([1, 1, 1, 1]), bounce: 0, front: 1, foldL: 0, foldR: 0, gather: 0, press: 0, near: -1, paddle: 1, paddleShow: 1 };
}

const _p = { x: 0, y: 0, z: 0 };

/**
 * Deform one parameterised point (written to _p): the inflation section, the creases, then fold and gather.
 * `P` = per-point arrays, `i` its index (TubePts / InteriorPts layouts below).
 */
function deformTube(A, i, S) {
  const R = HULL.R, k = A.k[i];
  const K = S.fill[k];
  let q;
  if (S.front > 0) q = clamp(K * 1.7 - A.dIn[i] * 0.7, 0, 1);
  else q = K <= 0 ? 0 : K >= 1 ? 1 : Math.pow(K, 1 + 0.6 * Math.sin(Math.PI * A.dIn[i]));
  const e = q * q * (3 - 2 * q) * 0.35 + q * 0.65;   // the section rounds out quickly, the last of it slowly
  const bn = q >= 0.999 ? S.bounce : 0;
  const ha = R * (SHEET.wide + (1 - SHEET.wide) * e) * (1 + 0.5 * bn), hb = Math.max(SHEET.thin, R * e) * (1 + bn);
  const cy0 = A.c[i * 3 + 1];
  const yb = (SHEET.y - SHEET.thin) + ((cy0 - R) - (SHEET.y - SHEET.thin)) * e;
  const ycen = yb + hb;
  // (bits standing off the tube — the bow line — lie down on the fabric with it: drawn in toward its surface when flat)
  const rn = A.rn[i], pull = rn > 1.15 ? 1 / rn + (1 - 1 / rn) * e : 1;
  const ca = A.ca[i] * pull, sa = A.sa[i] * pull;
  let r = ha * ca, u = hb * sa;
  // creases: the flat fabric bunched along and round the tube, fading as it goes taut
  const wr = Math.pow(1 - e, 1.3);
  let al = A.along[i];
  if (wr > 1e-3) {
    const s = A.s[i] * TAU, th = A.th[i], ph = A.ph[i];
    u += 0.009 * wr * (1 + Math.sin(s * 29 + 2.3 * Math.cos(th) + ph * 3) * Math.cos(s * 13 - 2 * th + 0.7 * Math.sin(s * 7)));   // (bunched up, never under the sheet)
    r += 0.012 * wr * Math.sin(s * 19 + th * 3 + 1.3 + Math.sin(s * 5) * 1.5);
    al += 0.01 * wr * Math.sin(s * 37 + th * 2);
  }
  const nx = A.n[i * 2], nz = A.n[i * 2 + 1];
  _p.x = A.c[i * 3] + nx * r + A.t[i * 3] * al;
  _p.y = ycen + u + A.t[i * 3 + 1] * al;
  _p.z = A.c[i * 3 + 2] + nz * r + A.t[i * 3 + 2] * al;
}

function deformInterior(A, i, S) {
  const e3 = S.fill[3], wr = Math.pow(1 - e3, 1.3);
  const y0 = A.y0[i];
  _p.x = A.x0[i] * (1 + 0.08 * (1 - e3));
  _p.z = A.z0[i];
  _p.y = SHEET.y + 0.004 + (y0 - SHEET.y - 0.004) * e3 + 0.006 * wr * (1 + Math.sin(A.x0[i] * 21 + A.z0[i] * 9));
}

/** Fold the flat sheet's sides in over the middle (hinges at |x| = SHEET.hinge), then gather the strip into pleats. */
function foldGather(S) {
  const hx = SHEET.hinge, ys = SHEET.y;
  if (S.foldL > 0 && _p.x > hx) {
    const a = Math.PI * S.foldL, dx = _p.x - hx, dy = _p.y - ys;
    _p.x = hx + dx * Math.cos(a) - dy * Math.sin(a);
    _p.y = ys + dx * Math.sin(a) + dy * Math.cos(a) + SHEET.flap * (1 - Math.cos(a)) / 2;
  } else if (S.foldR > 0 && _p.x < -hx) {
    const a = Math.PI * S.foldR, dx = _p.x + hx, dy = _p.y - ys;
    _p.x = -hx + dx * Math.cos(a) + dy * Math.sin(a);
    _p.y = ys - dx * Math.sin(a) + dy * Math.cos(a) + SHEET.flap * 2 * (1 - Math.cos(a)) / 2;
  }
  if (S.gather > 0) {
    const sg = -S.near, zn = S.near * SHEET.near, w = SHEET.pleat, Lt = 2 * SHEET.near, G = S.gather * Lt;
    const d = (_p.z - zn) * sg;   // along the strip from its near end
    const lift = _p.y - ys;
    if (d < G) {
      const n = Math.floor(d / w), e = d - n * w, edge = smooth((e - (w - 0.05)) / 0.05);
      let zz = n % 2 === 0 ? e : w - e;
      zz += (n % 2 === 0 ? 1 : -1) * 0.015 * Math.sin(Math.PI * edge);
      _p.z = zn + sg * zz;
      _p.y = ys + (n + edge) * SHEET.layer + lift * (n % 2 === 0 ? 1 : -1) * 0.5 + 0.004;
    } else {
      const nG = Math.floor(G / w), rest = d - G;
      _p.z = zn + sg * (Math.min(G, w) + rest);
      const top = (nG + smooth((G - nG * w - (w - 0.05)) / 0.05)) * SHEET.layer;
      _p.y += top * (1 - smooth(rest / 0.18));
    }
    if (S.press > 0) _p.y = ys + (_p.y - ys) * (1 - 0.4 * S.press);
  }
}

const PARAMS = new WeakMap();
/** Per-vertex parameterisation of a library hull mesh (geometry `g0`, mesh-local → model matrix M). */
function paramMesh(g0, M) {
  {
    const pos = g0.attributes.position, n = pos.count;
    const inv = new THREE.Matrix4().copy(M).invert().elements;
    const Mel = Float32Array.from(M.elements);
    const v = new THREE.Vector3();
    // classify every vertex
    const tubeIdx = [], intIdx = [];
    const tp = { s: [], c: [], t: [], n: [], ca: [], sa: [], th: [], rn: [], along: [], k: [], dIn: [], ph: [] }, ip = { x0: [], y0: [], z0: [] };
    const cache = new Map();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(M);
      const key = `${Math.round(v.x * 2000)},${Math.round(v.y * 2000)},${Math.round(v.z * 2000)}`;
      let p = cache.get(key);
      if (!p) { p = paramPoint(v.x, v.y, v.z); cache.set(key, p); }
      if (p.tube) {
        tubeIdx.push(i);
        tp.s.push(p.s); tp.c.push(...p.c); tp.t.push(...p.t); tp.n.push(...p.n); tp.ca.push(p.ca); tp.sa.push(p.sa); tp.th.push(p.th); tp.rn.push(p.rn);
        tp.along.push(p.along); tp.k.push(p.k); tp.dIn.push(p.dIn); tp.ph.push(p.ph);
      } else { intIdx.push(i); ip.x0.push(v.x); ip.y0.push(v.y); ip.z0.push(v.z); }
    }
    const F = (a) => Float32Array.from(a);
    const T = { idx: Int32Array.from(tubeIdx), s: F(tp.s), c: F(tp.c), t: F(tp.t), n: F(tp.n), ca: F(tp.ca), sa: F(tp.sa), th: F(tp.th), rn: F(tp.rn),
      along: F(tp.along), k: Uint8Array.from(tp.k), dIn: F(tp.dIn), ph: F(tp.ph) };
    const I = { idx: Int32Array.from(intIdx), x0: F(ip.x0), y0: F(ip.y0), z0: F(ip.z0) };
    const uvA = new Float32Array(n * 2);   // the crease pattern's frame: the fabric's own (inflated) x, z in metres
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(M); uvA[i * 2] = v.x; uvA[i * 2 + 1] = v.z; }
    const uv = new THREE.BufferAttribute(uvA, 2);
    // normal welding: vertices at one position whose authored normals agree share a normal (hard edges kept)
    const n0 = g0.attributes.normal, grp = new Int32Array(n), seen = new Map();
    const nv = new THREE.Vector3(), mv = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const key = `${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`;
      const list = seen.get(key);
      grp[i] = i;
      if (n0) nv.fromBufferAttribute(n0, i).normalize();
      if (list) {
        for (const j of list) { if (!n0 || mv.fromBufferAttribute(n0, j).normalize().dot(nv) > 0.5) { grp[i] = grp[j]; break; } }
        list.push(i);
      } else seen.set(key, [i]);
    }
    return { inv, M: Mel, T, I, grp, uv };
  }
}

/** Per-mesh deformation record. */
class MeshDeform {
  constructor(mesh, space) {
    this.mesh = mesh; this.geo0 = mesh.geometry;
    const g0 = this.geo0, pos = g0.attributes.position, n = pos.count;
    space.updateWorldMatrix(true, false); mesh.updateWorldMatrix(true, false);
    const M = new THREE.Matrix4().copy(space.matrixWorld).invert().multiply(mesh.matrixWorld);   // mesh local → model
    // (the parameterisation of a library mesh is the same for every instance of it: made once)
    const key = M.elements.map((x) => x.toFixed(6)).join(',');
    let C = PARAMS.get(g0);
    if (!C || C.key !== key) PARAMS.set(g0, (C = { key, ...paramMesh(g0, M) }));
    this.inv = C.inv; this.M = C.M; this.T = C.T; this.I = C.I; this.grp = C.grp;
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(g0.attributes)) if (name !== 'position' && name !== 'normal') g.setAttribute(name, a);
    g.setIndex(g0.index);
    this.P = new Float32Array(n * 3); this.Nr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { this.P[i * 3] = pos.getX(i); this.P[i * 3 + 1] = pos.getY(i); this.P[i * 3 + 2] = pos.getZ(i); }
    g.setAttribute('raftUV', C.uv);
    g.setAttribute('position', new THREE.BufferAttribute(this.P, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.Nr, 3).setUsage(THREE.DynamicDrawUsage));
    g.groups = g0.groups;
    if (!g0.boundingSphere) g0.computeBoundingSphere();
    // (a generous sphere: the hull may lie flat, folded or stacked anywhere within its own length)
    g.boundingSphere = g0.boundingSphere.clone(); g.boundingSphere.radius *= 1.6;
    g.boundingBox = null;
    g.userData.shared = true;   // (an entity's dispose() leaves it alone: art/raft-actions.js disposes it)
    this.geo = g;
    this.acc = new Float32Array(n * 3);
    this.on = false;
  }

  attach() { if (!this.on) { this.mesh.geometry = this.geo; this.on = true; } }
  detach() { if (this.on) { this.mesh.geometry = this.geo0; this.on = false; } }

  /** Write the deformed positions (mesh local) and normals for state S. */
  apply(S) {
    const T = this.T, I = this.I, fg = S.foldL > 0 || S.foldR > 0 || S.gather > 0;
    for (let j = 0; j < T.idx.length; j++) { deformTube(T, j, S); if (fg) foldGather(S); this.put(T.idx[j]); }
    for (let j = 0; j < I.idx.length; j++) { deformInterior(I, j, S); if (fg) foldGather(S); this.put(I.idx[j]); }
    this.normals();
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
  }

  /** _p (model space) → vertex i (mesh local). */
  put(i) {
    const P = this.P, e = this.inv, x = _p.x, y = _p.y, z = _p.z;
    P[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
    P[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    P[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }

  normals() {
    const P = this.P, A = this.acc, N = this.Nr, g = this.grp, idx = this.geo.index;
    A.fill(0);
    const n = idx ? idx.count : P.length / 3;
    const ix = idx ? idx.array : null;
    for (let f = 0; f + 2 < n; f += 3) {
      const a = ix ? ix[f] : f, b = ix ? ix[f + 1] : f + 1, c = ix ? ix[f + 2] : f + 2;
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const e1x = P[b * 3] - ax, e1y = P[b * 3 + 1] - ay, e1z = P[b * 3 + 2] - az;
      const e2x = P[c * 3] - ax, e2y = P[c * 3 + 1] - ay, e2z = P[c * 3 + 2] - az;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      let G = g[a] * 3; A[G] += nx; A[G + 1] += ny; A[G + 2] += nz;
      G = g[b] * 3; A[G] += nx; A[G + 1] += ny; A[G + 2] += nz;
      G = g[c] * 3; A[G] += nx; A[G + 1] += ny; A[G + 2] += nz;
    }
    for (let i = 0; i < g.length; i++) {
      const G = g[i] * 3, x = A[G], y = A[G + 1], z = A[G + 2], l = Math.hypot(x, y, z) || 1;
      N[i * 3] = x / l; N[i * 3 + 1] = y / l; N[i * 3 + 2] = z / l;
    }
  }

  dispose() { this.detach(); this.geo.dispose(); }

  /** Mean model-space height of the drawn vertices (tests: how far the hull is inflated as drawn). */
  meanY() {
    const P = this.P, e = this.M, n = P.length / 3;
    let s = 0;
    for (let i = 0; i < n; i++) s += e[1] * P[i * 3] + e[5] * P[i * 3 + 1] + e[9] * P[i * 3 + 2] + e[13];
    return n ? s / n : 0;
  }
}

/**
 * The creasing clones of the library's hull materials, made once per material and kept (their shader programs stay
 * compiled: art/raft-actions.js warmRaftArt builds them behind the loading screen), sharing one uWrinkle uniform — set
 * by the hull drawn deforming (one at a time in practice).
 */
const WRINKLE = new Map();
const WRINKLE_U = { value: 0 };
function wrinkleOf(src) {
  let m = WRINKLE.get(src);
  if (!m) WRINKLE.set(src, (m = wrinkleMaterial(src, WRINKLE_U)));
  return m;
}

/** Crease normal pattern added to a material while it deforms (uWrinkle 0 … 1). */
function wrinkleMaterial(src, U) {
  const m = src.clone();
  m.name = `${src.name}~raft`;
  // (kept for good: `shared` keeps an entity's dispose() — the raft leaving the world mid-pack — off it, or its
  // programs would be released and compiled again on the next frame)
  m.userData = { ...src.userData, shared: true, raftWrinkle: true };
  m.onBeforeCompile = (sh, r) => {
    src.onBeforeCompile?.(sh, r);
    sh.uniforms.uWrinkle = U;
    // the creases in the fabric's own frame (raftUV: its inflated x, z in metres), tilted in view space along the
    // model's x and z axes (stable as the camera turns)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 raftUV;\nvarying vec2 vRaftUV;\nvarying vec3 vRaftX;\nvarying vec3 vRaftZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRaftUV = raftUV;\nvRaftX = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));\nvRaftZ = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWrinkle;\nvarying vec2 vRaftUV;\nvarying vec3 vRaftX;\nvarying vec3 vRaftZ;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (uWrinkle > 0.001) {
        vec2 q = vRaftUV;
        // creases running every which way (a warped field: no stripes), finer crinkles over them
        vec2 w2 = q + 0.35 * vec2(sin(q.y * 5.3 + 1.7), sin(q.x * 6.1 + 0.4));
        float a = sin(w2.x * 13.0 + w2.y * 7.0) * sin(w2.y * 11.0 - w2.x * 5.0);
        float b = sin(w2.x * 9.0 - w2.y * 14.0 + 2.0) * cos(w2.y * 6.0 + w2.x * 12.0);
        vec2 g = vec2(a, b) + 0.3 * vec2(sin(q.x * 41.0 + q.y * 23.0), cos(q.y * 37.0 - q.x * 19.0));
        normal = normalize(normal + uWrinkle * 0.16 * (g.x * vRaftX + g.y * vRaftZ));
      }`);
  };
  m.customProgramCacheKey = () => `${src.customProgramCacheKey?.() ?? ''}|raftWrinkle`;
  return m;
}

/**
 * The deformable hull of one library raft visual (vehicle-library createVehicleVisual handle, ready): both LODs'
 * hull meshes (not the paddles). attach() swaps in its own geometry and wrinkle-material clones, apply(S) poses it,
 * restore() puts the library's geometry and materials back (exactly the inflated raft again).
 */
export class RaftHull {
  constructor(vis) {
    this.vis = vis;
    const space = vis.object3d;
    const inst = [...space.children].find((c) => c.visible && c.children.some((q) => /_lod\d+$/.test(q.name))) || space.children[0];
    this.inst = inst;
    this.meshes = [];
    this.U = WRINKLE_U;
    const loose = (q) => { for (let a = q; a && a !== inst; a = a.parent) if (/paddle|oar/i.test(a.name)) return true; return false; };
    inst?.traverse((q) => { if (q.isMesh && q.geometry?.attributes?.position && !loose(q)) this.meshes.push(new MeshDeform(q, space)); });
    // the paddles: rest pose (model space) and the flat pose on the floor
    this.paddles = [];
    for (const name of ['paddle_l', 'paddle_r']) {
      const node = inst?.getObjectByName(name);
      if (!node) continue;
      const side = name === 'paddle_l' ? 1 : -1;
      const box = new THREE.Box3().setFromObject(node), size = box.getSize(new THREE.Vector3());
      // the shaft: from the pivot toward the blade (raft.py: out, down, aft)
      const d = new THREE.Vector3(side * 0.85, -0.42, -0.3).normalize();
      const flat = new THREE.Vector3(0, 0, 1);   // lying straight along the floor (inside the middle band: folded in with it)
      const qw = new THREE.Quaternion().setFromUnitVectors(d, flat);
      const restQ = node.quaternion.clone();
      const qLocal = restQ.clone().invert().multiply(qw).multiply(restQ);
      const rest = node.position.clone();
      const flatPos = new THREE.Vector3(side * 0.13, SHEET.y + 0.02 + (side > 0 ? 0 : 0.03), -0.25);
      this.paddles.push({ name, side, qLocal, rest, flatPos, size, q: new THREE.Quaternion(), off: new THREE.Vector3() });
    }
    this.on = false;
  }

  attach() {
    if (this.on) return;
    for (const md of this.meshes) {
      md.attach();
      const m = md.mesh;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      md.mat0 = m.material;
      const own = mats.map((x) => wrinkleOf(x));
      m.material = Array.isArray(m.material) ? own : own[0];
    }
    this.on = true;
  }

  /** Pose the hull for state S (attach() first). */
  apply(S) {
    if (!this.on) this.attach();
    let wr = 0;
    for (let k = 0; k < 4; k++) wr = Math.max(wr, 1 - S.fill[k]);
    this.U.value = Math.pow(clamp(wr, 0, 1), 0.8);
    for (const md of this.meshes) md.apply(S);
    // the paddles: flat on the floor (folded in with the sides), in their rowlocks once the tubes are up
    for (const pd of this.paddles) {
      const k = clamp(S.paddle, 0, 1);
      pd.q.identity().slerp(pd.qLocal, 1 - k);
      pd.off.copy(pd.flatPos).sub(pd.rest).multiplyScalar(1 - k);
      this.vis.posePart(pd.name, pd.q, pd.off);
      this.vis.showPart(pd.name, S.paddleShow > 0.5);
    }
  }

  /** The library raft again: its own geometry, materials and paddles. */
  restore() {
    if (!this.on) return;
    for (const md of this.meshes) { md.detach(); if (md.mat0) md.mesh.material = md.mat0; }
    for (const pd of this.paddles) { this.vis.posePart(pd.name, null, null); this.vis.showPart(pd.name, true); }
    this.U.value = 0;
    this.on = false;
  }

  /** Mean height of the largest hull mesh as drawn (model space, m; null when not deforming). */
  meanY() {
    if (!this.on || !this.meshes.length) return null;
    let big = this.meshes[0];
    for (const md of this.meshes) if (md.P.length > big.P.length) big = md;
    return big.meanY();
  }

  dispose() {
    this.restore();
    for (const md of this.meshes) md.dispose();
  }

  /**
   * A handle on the hull (hand targets): a model-space point of the inflated hull, parameterised once.
   * @returns {object} pass to handleAt()
   */
  static handle(x, y, z) {
    const p = paramPoint(x, y, z);
    if (!p.tube) return { tube: false, x0: Float32Array.of(x), y0: Float32Array.of(y), z0: Float32Array.of(z) };
    const F = (v) => Float32Array.of(v);
    return { tube: true, k: Uint8Array.of(p.k), dIn: F(p.dIn), c: Float32Array.from(p.c), ca: F(p.ca), sa: F(p.sa), rn: F(p.rn), along: F(p.along), s: F(p.s),
      th: F(p.th), ph: F(p.ph), n: Float32Array.from(p.n), t: Float32Array.from(p.t) };
  }

  /** Where a handle (RaftHull.handle) is under state S, model space, into `out` (a Vector3). */
  static handleAt(h, S, out) {
    if (h.tube) deformTube(h, 0, S); else deformInterior(h, 0, S);
    if (S.foldL > 0 || S.foldR > 0 || S.gather > 0) foldGather(S);
    return out.set(_p.x, _p.y, _p.z);
  }
}
