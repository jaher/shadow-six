/**
 * Round roofs and caps that read as polygons from the game camera (user 2026-11-09: "Do we need to average normals? Some
 * round roofs look polygonal when seen from above").
 *
 * Two separate defects make a cone or dome look faceted:
 *   1. FLAT NORMALS: the Blender kit exports its cones with one normal per face (24 facets lit as 24 flat wedges), the
 *      castle kit builds triangle soups lit by computeVertexNormals() (flat again), and a lathe's apex vertices each carry
 *      the normal of their own column (a lopsided wedge at the tip);
 *   2. TOO FEW SEGMENTS: a 24-gon eave of radius 3 m is 26 mm off a circle (2+ px at zoom 2) and reads as a polygon, and so
 *      does the rolled bead a dome stands on.
 * Smoothing the normals alone leaves the polygonal outline; more segments alone leave the wedges. Both come from one rule,
 * `ringSegments(R)`: enough segments that the chord sagitta of the ring stays under about a pixel at the zoom the level of
 * detail is shown at (zoom 2 = 80 px/m: 12 mm for LOD 0; zoom 0.5 = 20 px/m: 40 mm for LOD 1). 8, 9 and 10 sided shapes are
 * deliberate polygons (octagonal spires and drums, a decagonal lantern) and stay as they are.
 *
 *  - smoothLathe(): procedural lathes (art/kit-buildings.js, kit-props): the analytic normal round the circle, hard edges
 *    (eaves, rims, caps) kept by a crease angle, one apex normal per facet, the UVs of the old tlathe.
 *  - creaseNormals(): triangle soups (art/castle-kit.js): normals by crease angle, so a 12+ sided tower or cone shades round
 *    and 90° corners, ridges and an octagon's facets stay hard.
 * Gameplay measures the vertices of every structure (world/placement-visual.js: nav stamps, overheads, hulls, tops), so
 * what is drawn finer than authored registers the authored geometry (engine/gameplay-geometry.js) and the measuring code
 * keeps reading that one: the GLB library's roofs are re-tessellated, the procedural lathes and castle cylinders (which
 * have no authored twin) keep their positions and only their normals change. The gameplay fingerprint of all 21 missions
 * is identical to master's.
 *  - refineRoundRoofs(): a GLB primitive (the building library: towers, domes, bunker and pillbox roofs, tank tops): finds
 *    every sloped surface of revolution about a vertical axis (its rings are regular N-gons on a common axis) with the whole
 *    rings of wall that continue it (a dome's vertical bead), re-tessellates it on the true circle with k times the segments
 *    (new vertices: the facet's own point pushed radially out, UVs barycentric: the texture keeps the artist's density) and
 *    shades it: a FLAT-shaded surface gets the analytic normal (hard eaves and rims kept), a SMOOTH one keeps the artist's
 *    normals turned to the new vertices. Walls with openings, caps, pitched roofs and 8-sided spires are not touched. A
 *    decimated LOD's cone (an uneven strip: the simplifier collapsed its rings) cannot be re-tessellated but its flat wedges
 *    are smoothed by a fitted axis and profile. Attribute layouts (meshopt int16 positions, int8 normals …) are kept, so
 *    depth-merge groups and shader programs do not change.
 *  - roundRoofs(): the building-fixups hook for a loaded GLB scene.
 * @module art/round-roofs
 */
import * as THREE from 'three';
import { setGameplayGeometry, gameplayGeometry } from '../engine/gameplay-geometry.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DEG = Math.PI / 180;
/** A vertex normal within 2° of its face's normal is a flat-shaded corner (meshopt int8 normals are good to ~0.5°). */
const COS_FLAT = Math.cos(2 * DEG);

/** Largest chord sagitta (m) a round silhouette may have at LOD 0 / 1 / 2 (≈ 1 px at the zoom each LOD is shown at). */
export const SAG_TOL = [0.012, 0.04, 0.1];

/**
 * Segments for a circle of radius R (m): the sagitta R(1 − cos(π/N)) stays under `tol`. Rounded up to a multiple of
 * `step` (rings of 8 and 12 facets stay in phase), at least `min`, at most `max`.
 */
export function ringSegments(R, tol = SAG_TOL[0], { min = 8, max = 64, step = 4 } = {}) {
  if (!(R > 0) || !(tol > 0)) return min;
  const n = Math.PI / Math.acos(Math.max(-1, Math.min(1, 1 - tol / R)));
  return Math.max(min, Math.min(max, Math.ceil(n / step) * step));
}

// ------------------------------------------------------------------------------------------------ procedural lathes

/**
 * A lathe (surface of revolution about +Y) with the analytic normal at every vertex, in place of THREE.LatheGeometry:
 *   - normals come from the profile, not from the facets: smooth round the circle for any `segments`;
 *   - at a profile corner sharper than `crease` degrees the vertex is split (one normal per side): eaves, rims and
 *     flat caps stay hard instead of blending into a soft blob; gentler corners are averaged (a dome stays round);
 *   - a profile point on the axis (a cone apex, a dome pole) gets one vertex per facet, normal at the facet's mid
 *     azimuth: no lopsided wedge at the tip (LatheGeometry gives each column's apex vertex that column's azimuth);
 *   - UVs as art/kit-buildings.js tlathe: u = arc length (m) / tile, v = height / tile (`tile` null: u = i/segments,
 *     v = profile index / (n − 1), as LatheGeometry);
 *   - `faceted` (default: 10 segments or fewer): a deliberate polygon (an octagonal drum, a decagonal cap) keeps one flat
 *     normal per facet instead of being shaded round.
 * The profile runs bottom → top with the outside on the right, as LatheGeometry takes it; triangle winding is the same.
 * @param {Array<[number, number]>} pts profile [radius, y]
 * @param {number} segments around the circle
 * @param {{crease?: number, tile?: number|null, phiStart?: number, phiLength?: number, faceted?: boolean}} [o]
 * @returns {THREE.BufferGeometry} indexed, with position / normal / uv
 */
export function smoothLathe(pts, segments, { crease = 40, tile = null, phiStart = 0, phiLength = TAU, faceted = segments <= 10 } = {}) {
  const n = pts.length, seg = Math.max(3, Math.floor(segments));
  if (n < 2) return new THREE.BufferGeometry();
  const rmax = Math.max(...pts.map((q) => q[0]));
  const EPS = 1e-6;
  // meridian normal of each band (r, y): (dy, -dr) / len, as LatheGeometry
  const bn = [];
  for (let j = 0; j < n - 1; j++) {
    const dr = pts[j + 1][0] - pts[j][0], dy = pts[j + 1][1] - pts[j][1], l = Math.hypot(dr, dy) || 1;
    bn.push([dy / l, -dr / l]);
  }
  // profile vertices: one per point, or two (lower band / upper band) at a hard corner
  const cosCrease = Math.cos(crease * DEG);
  const lo = [], hi = []; // vertex entry used by the band below / above point j
  const ent = []; // {j, nr, ny}
  for (let j = 0; j < n; j++) {
    const a = j > 0 ? bn[j - 1] : null, b = j < n - 1 ? bn[j] : null;
    if (a && b) {
      const d = a[0] * b[0] + a[1] * b[1];
      if (d >= cosCrease) {
        let nr = a[0] + b[0], ny = a[1] + b[1]; const l = Math.hypot(nr, ny) || 1; nr /= l; ny /= l;
        ent.push({ j, nr, ny }); lo[j] = hi[j] = ent.length - 1;
      } else {
        ent.push({ j, nr: a[0], ny: a[1] }); lo[j] = ent.length - 1;
        ent.push({ j, nr: b[0], ny: b[1] }); hi[j] = ent.length - 1;
      }
    } else {
      const c = a || b;
      ent.push({ j, nr: c[0], ny: c[1] }); lo[j] = hi[j] = ent.length - 1;
    }
  }
  const pos = [], nor = [], uv = [], idx = [];
  const vert = (r, y, phi, nr, ny, u, v, nphi = phi) => {
    const s = Math.sin(phi), c = Math.cos(phi), ns = Math.sin(nphi), nc = Math.cos(nphi);
    pos.push(r * s, y, r * c); nor.push(nr * ns, ny, nr * nc); uv.push(u, v);
    return pos.length / 3 - 1;
  };
  const uOf = (i) => (tile ? (i / seg) * (TAU * rmax) / tile : i / seg);
  const vOf = (j, y) => (tile ? y / tile : j / (n - 1));
  const colOf = (e, i, face = false) => { // the vertex of entry e at column i (faceted: one set per facet, normal at its mid azimuth)
    const { j } = ent[e], phi = phiStart + (i / seg) * phiLength;
    return vert(pts[j][0], pts[j][1], phi, ent[e].nr, ent[e].ny, uOf(i), vOf(j, pts[j][1]), face ? phiStart + ((face === 1 ? i + 0.5 : i - 0.5) / seg) * phiLength : phi);
  };
  const cols = ent.map(() => null);
  if (!faceted) {
    for (let e = 0; e < ent.length; e++) {
      if (pts[ent[e].j][0] <= EPS) continue;
      cols[e] = [];
      for (let i = 0; i <= seg; i++) cols[e].push(colOf(e, i));
    }
  }
  for (let i = 0; i < seg; i++) {
    const pm = phiStart + ((i + 0.5) / seg) * phiLength;
    for (let j = 0; j < n - 1; j++) {
      const eA = hi[j], eB = lo[j + 1]; // lower end, upper end of the band
      const ra = pts[j][0], rb = pts[j + 1][0], b = bn[j];
      if (ra > EPS && rb > EPS) {
        let a0, a1, b0, b1;
        if (faceted) { a0 = colOf(eA, i, 1); a1 = colOf(eA, i + 1, 2); b0 = colOf(eB, i, 1); b1 = colOf(eB, i + 1, 2); } // a facet: its own four vertices
        else { a0 = cols[eA][i]; a1 = cols[eA][i + 1]; b0 = cols[eB][i]; b1 = cols[eB][i + 1]; }
        idx.push(a0, a1, b0, b1, b0, a1); // LatheGeometry: (a, b, d) (c, d, b)
      } else if (ra > EPS) { // apex above: one vertex per facet at the mid azimuth
        const t = vert(0, pts[j + 1][1], pm, b[0], b[1], uOf(i + 0.5), vOf(j + 1, pts[j + 1][1]));
        if (faceted) idx.push(colOf(eA, i, 1), colOf(eA, i + 1, 2), t); else idx.push(cols[eA][i], cols[eA][i + 1], t);
      } else if (rb > EPS) { // pole below
        const t = vert(0, pts[j][1], pm, b[0], b[1], uOf(i + 0.5), vOf(j, pts[j][1]));
        if (faceted) idx.push(t, colOf(eB, i + 1, 2), colOf(eB, i, 1)); else idx.push(t, cols[eB][i + 1], cols[eB][i]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}


// ------------------------------------------------------------------------------------------------ triangle soups

/**
 * Normals for a triangle soup by crease angle: each corner gets the angle-weighted average of the faces that meet at its
 * position and lie within `crease` degrees of its own face, so a cylinder / cone / dome built from flat quads shades
 * round while 90° corners, ridges, eaves and an octagon's 45° edges stay hard (the default 32° smooths rings of 12+
 * facets). Replaces `computeVertexNormals()` on a non-indexed geometry, which lights every facet flat.
 * @param {THREE.BufferGeometry} geo non-indexed (an indexed one is expanded; the result is returned)
 * @param {number} [crease] degrees
 * @returns {THREE.BufferGeometry}
 */
export function creaseNormals(geo, crease = 32) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const P = g.attributes.position, n = P.count, F = Math.floor(n / 3);
  const fn = new Float32Array(F * 3), ang = new Float32Array(F * 3), groups = new Map();
  const q = 1e4;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let f = 0; f < F; f++) {
    a.fromBufferAttribute(P, f * 3); b.fromBufferAttribute(P, f * 3 + 1); c.fromBufferAttribute(P, f * 3 + 2);
    nn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const l = nn.length();
    if (l > 1e-12) { nn.divideScalar(l); fn[f * 3] = nn.x; fn[f * 3 + 1] = nn.y; fn[f * 3 + 2] = nn.z; }
    const v = [a, b, c];
    for (let k = 0; k < 3; k++) {
      const p = v[k], u = v[(k + 1) % 3], w = v[(k + 2) % 3];
      e1.subVectors(u, p).normalize(); e2.subVectors(w, p).normalize();
      ang[f * 3 + k] = l > 1e-12 ? Math.acos(clamp(e1.dot(e2), -1, 1)) : 0;
      const key = `${Math.round(p.x * q)},${Math.round(p.y * q)},${Math.round(p.z * q)}`;
      const list = groups.get(key);
      if (list) list.push(f * 3 + k); else groups.set(key, [f * 3 + k]);
    }
  }
  const out = new Float32Array(n * 3), cosC = Math.cos(crease * DEG);
  for (const list of groups.values()) {
    for (const i of list) {
      const fi = (i / 3) | 0;
      let x = 0, y = 0, z = 0;
      for (const j of list) {
        const fj = (j / 3) | 0;
        if (fn[fi * 3] * fn[fj * 3] + fn[fi * 3 + 1] * fn[fj * 3 + 1] + fn[fi * 3 + 2] * fn[fj * 3 + 2] < cosC) continue;
        const w = ang[j];
        x += fn[fj * 3] * w; y += fn[fj * 3 + 1] * w; z += fn[fj * 3 + 2] * w;
      }
      const l = Math.hypot(x, y, z) || 1;
      out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
    }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return g;
}

// ------------------------------------------------------------------------------------------------ GLB primitives

/** A copy of attribute `a` with room for `extra` more vertices, in the same typed layout; `set(i, k, v)` stores a float. */
function growable(a, extra) {
  const inter = !!a.isInterleavedBufferAttribute;
  const src = inter ? a.data.array : a.array, stride = inter ? a.data.stride : a.itemSize, off = inter ? a.offset : 0;
  const have = Math.floor(src.length / stride), Arr = src.constructor;
  const arr = new Arr((have + extra) * stride);
  arr.set(src);
  let lo = -Infinity, hi = Infinity, scale = 1, round = false;
  if (a.normalized) {
    if (Arr === Int8Array) { lo = -1; hi = 1; scale = 127; } else if (Arr === Int16Array) { lo = -1; hi = 1; scale = 32767; }
    else if (Arr === Uint8Array) { lo = 0; hi = 1; scale = 255; } else if (Arr === Uint16Array) { lo = 0; hi = 1; scale = 65535; }
    round = true;
  } else if (Arr !== Float32Array && Arr !== Float64Array) {
    round = true;
    if (Arr === Uint16Array) { lo = 0; hi = 65535; } else if (Arr === Int16Array) { lo = -32768; hi = 32767; }
    else if (Arr === Uint8Array) { lo = 0; hi = 255; } else if (Arr === Int8Array) { lo = -128; hi = 127; }
    else if (Arr === Uint32Array) { lo = 0; hi = 4294967295; }
  }
  const attr = inter ? new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(arr, stride), a.itemSize, off, a.normalized)
    : new THREE.BufferAttribute(arr, a.itemSize, a.normalized);
  const set = (i, k, v) => { v = clamp(v, lo, hi) * scale; arr[(have + i) * stride + off + k] = round ? Math.round(v) : v; };
  return { attr, set, have };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/**
 * Re-tessellate and smooth every sloped surface of revolution (cone, dome) of a geometry, in place, together with the
 * complete rings of wall and ledge that continue it (a dome's rolled base bead: a vertical 18-gon band under it).
 * @param {THREE.BufferGeometry} geo indexed or not; needs position and normal (uv, uv1, color, tangent are carried)
 * @param {object} [opts]
 * @param {number} [opts.unit] metres per local unit (a quantised GLB mesh sits under a scale node)
 * @param {number} [opts.tol] sagitta tolerance, m (SAG_TOL[lod])
 * @param {number} [opts.crease] degrees: meridian corners sharper than this stay hard
 * @param {number} [opts.minR] ignore rings under this radius, m (finials, lids, bolt heads)
 * @param {number} [opts.minN] ignore rings with fewer segments: an 8-sided spire or a decagonal pavilion roof is drawn that way
 * @param {number} [opts.maxK] most segment multiples (triangles grow k²)
 * @param {number} [opts.maxSegments] segment cap per ring
 * @param {number} [opts.minNirr] the same for a decimated surface (an LOD's cone keeps 9-14 of its 24 sides)
 * @param {boolean} [opts.irregular] also smooth the normals of surfaces that are no longer an even strip of rings (decimated LODs)
 * @param {boolean} [opts.dry] only report
 * @param {string[]} [opts.why] collects why a candidate component was not taken (tools, tests)
 * @returns {{surfaces: object[], tris: number}|null} the surfaces found ({N, k, R, tris, y, flat, skip}) and the triangle count after
 */
export function refineRoundRoofs(geo, opts = {}) {
  const o = { unit: 1, tol: SAG_TOL[0], crease: 40, minR: 1, minN: 12, minNirr: 9, irregular: true, maxK: 3, maxSegments: 64, minTris: 8, maxTris: 6000, dry: false, ...opts };
  const P = geo.attributes.position, NR = geo.attributes.normal;
  if (!P || !NR || P.count < 12 || geo.groups?.length) return null;
  const nv = P.count, ix = geo.index ? geo.index.array : null, T = (ix ? ix.length : nv) / 3;
  const vi = (t, k) => (ix ? ix[t * 3 + k] : t * 3 + k);
  const px = new Float64Array(nv), py = new Float64Array(nv), pz = new Float64Array(nv);
  for (let i = 0; i < nv; i++) { px[i] = P.getX(i); py[i] = P.getY(i); pz[i] = P.getZ(i); }
  const eps = 0.0008 / o.unit, q = 0.1e-3 / o.unit; // 0.8 mm: position noise; 0.1 mm: weld grid (local units)
  // 1. face normals; the seeds are the sloped, up-facing triangles (cone / dome surfaces): horizontal caps and vertical
  //    walls only join a surface through its rings (below), never on their own
  const fnx = new Float32Array(T), fny = new Float32Array(T), fnz = new Float32Array(T), seeds = [];
  for (let t = 0; t < T; t++) {
    const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
    _a.set(px[b] - px[a], py[b] - py[a], pz[b] - pz[a]); _b.set(px[c] - px[a], py[c] - py[a], pz[c] - pz[a]);
    _c.crossVectors(_a, _b);
    const l = _c.length();
    if (l < 1e-12) { fny[t] = -2; continue; } // degenerate
    fnx[t] = _c.x / l; fny[t] = _c.y / l; fnz[t] = _c.z / l;
    if (fny[t] > 0.08 && fny[t] < 0.9995) seeds.push(t);
  }
  if (seeds.length < o.minTris) return { surfaces: [], tris: T };
  // 2. weld by position; connected components of the seeds
  const wid = new Map(), wof = new Int32Array(nv);
  for (let i = 0; i < nv; i++) {
    const k = `${Math.round(px[i] / q)},${Math.round(py[i] / q)},${Math.round(pz[i] / q)}`;
    let w = wid.get(k);
    if (w === undefined) { w = wid.size; wid.set(k, w); }
    wof[i] = w;
  }
  const par = new Int32Array(wid.size).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (const t of seeds) { const a = wof[vi(t, 0)]; par[find(wof[vi(t, 1)])] = find(a); par[find(wof[vi(t, 2)])] = find(a); }
  const comps = new Map();
  for (const t of seeds) { const r = find(wof[vi(t, 0)]); let e = comps.get(r); if (!e) comps.set(r, e = []); e.push(t); }
  const ctx = { vi, px, py, pz, fnx, fny, fnz, wof, NR, o, eps, claimed: new Uint8Array(T), why: o.why };
  const plans = [], irregulars = [];
  for (const members of comps.values()) {
    if (members.length < o.minTris) continue;
    const plan = analyseSurface(ctx, members);
    if (plan) { plans.push(plan); for (const t of members) ctx.claimed[t] = 1; }
    else if (o.irregular) irregulars.push(members);
  }
  if (plans.length) {
    const vertTris = new Map();
    for (let t = 0; t < T; t++) for (let k = 0; k < 3; k++) { const w = wof[vi(t, k)]; const l = vertTris.get(w); if (l) l.push(t); else vertTris.set(w, [t]); }
    for (const plan of plans) extendPlan(ctx, plan, vertTris);
    for (const plan of plans) finishPlan(ctx, plan);
  }
  const smoothed = [];
  if (irregulars.length) {
    const vertTris = new Map();
    for (let t = 0; t < T; t++) for (let k = 0; k < 3; k++) { const i = vi(t, k), l = vertTris.get(i); if (l) l.push(t); else vertTris.set(i, [t]); }
    for (const members of irregulars) { const r = smoothIrregular(ctx, members, vertTris); if (r) smoothed.push(r); }
  }
  const live = plans.filter((p) => p.members.length);
  const info = { surfaces: live.map((p) => ({ N: p.N, k: p.k, R: +(p.Rmax * o.unit).toFixed(3), tris: p.members.length, bands: p.rings.length - 1, y: [+(p.Y[0] * o.unit).toFixed(3), +(p.Y[p.Y.length - 1] * o.unit).toFixed(3)], worst: +p.worst.toFixed(1), flat: p.flat, skip: p.skip })), tris: T };
  for (const r of smoothed) info.surfaces.push({ N: r.N, k: 1, R: +(r.Rmax * o.unit).toFixed(3), tris: r.members.length, bands: 0, y: [+(r.ymin * o.unit).toFixed(3), +(r.ymax * o.unit).toFixed(3)], worst: +r.worst.toFixed(1), flat: true, skip: false, irregular: true });
  if (!o.dry) for (const r of smoothed) r.apply();
  const todo = live.filter((p) => !p.skip);
  if (o.dry || !todo.length) return info;
  if (!rebuild(geo, todo, ctx, T)) { info.surfaces.forEach((x) => { x.skip = true; }); return info; }
  info.tris = geo.index.count / 3;
  return info;
}

/** Is this seed component a closed surface of revolution about a vertical axis? Its rings and bands, or null. */
function analyseSurface(ctx, members) {
  const { vi, px, py, pz, wof, o, eps } = ctx;
  const { unit } = o, no = (r) => { ctx.why?.push(`${r} (${members.length} tris)`); return null; };
  const rep = new Map(); // welded vertex -> one original vertex index
  for (const t of members) for (let k = 0; k < 3; k++) { const w = wof[vi(t, k)]; if (!rep.has(w)) rep.set(w, vi(t, k)); }
  const V = [...rep.entries()];
  if (V.length < 8) return no('few vertices');
  // levels: vertices clustered by height
  const order = V.slice().sort((a, b) => py[a[1]] - py[b[1]]);
  const levels = [];
  for (const [w, i] of order) {
    const L = levels[levels.length - 1];
    if (L && py[i] - L.y1 <= eps) { L.v.push(i); L.w.push(w); L.y1 = py[i]; } else levels.push({ v: [i], w: [w], y1: py[i] });
  }
  if (levels.length < 2) return no('one level');
  // the axis: circle fit of the level with the most vertices
  let big = levels[0];
  for (const L of levels) if (L.v.length > big.v.length) big = L;
  if (big.v.length < 6) return no('no ring of 6');
  const fit = circleFit(big.v.map((i) => [px[i], pz[i]]));
  if (!fit) return no('no circle');
  const { cx, cz } = fit, N = big.v.length;
  // every level a regular N-gon on that axis (an apex: one vertex on it)
  const rings = [];
  for (const L of levels) {
    const rad = L.v.map((i) => Math.hypot(px[i] - cx, pz[i] - cz));
    const r = rad.reduce((s, x) => s + x, 0) / rad.length;
    if (L.v.length === 1) { if (rad[0] > 0.03 * fit.r + 3 * eps) return no('off-axis apex'); rings.push({ y: py[L.v[0]], r: rad[0], w: L.w, apex: true }); continue; }
    if (L.v.length !== N) return no(`level of ${L.v.length} vs ${N}`);
    if (Math.max(...rad) - Math.min(...rad) > 0.012 * r + 2 * eps) return no('ring not round');
    if (!regularRing(L.v, px, pz, cx, cz, N)) return no('ring not regular');
    rings.push({ y: L.v.reduce((s, i) => s + py[i], 0) / L.v.length, r, w: L.w, apex: false });
  }
  const Rmax = Math.max(...rings.map((r) => r.r));
  if (Rmax * unit < o.minR || N < o.minN) return no(`small or coarse polygon (R ${(Rmax * unit).toFixed(2)}, N ${N})`);
  const plan = { members: members.slice(), cx, cz, N, rings };
  // every triangle inside one band between adjacent levels: a plain strip of a lathe
  if (!bandsOf(ctx, plan)) return no('triangle across levels');
  return plan;
}

/**
 * A decimated (LOD 1 / 2) cone or dome: the triangles are no longer an even strip of rings (the simplifier collapsed
 * vertices unevenly), but the vertices still lie on the surface of revolution. Fit the axis and the radius profile
 * ρ(y) to them and give every vertex the analytic normal: the flat wedges of the decimated cone shade round again (its
 * outline stays the decimated polygon: its triangles are all it has). Only for flat-shaded surfaces whose vertices are
 * used by no triangle outside the component. Returns { apply, … } or null.
 */
function smoothIrregular(ctx, members, vertTris) {
  const { vi, px, py, pz, fnx, fny, fnz, NR, o, eps } = ctx;
  if (members.length < 6) return null;
  const idx = [...new Set(members.flatMap((t) => [vi(t, 0), vi(t, 1), vi(t, 2)]))];
  const mset = new Set(members);
  for (const i of idx) for (const t of vertTris.get(i)) if (!mset.has(t)) return null; // a vertex shared with other geometry
  let ymin = Infinity, ymax = -Infinity;
  for (const i of idx) { ymin = Math.min(ymin, py[i]); ymax = Math.max(ymax, py[i]); }
  const H = ymax - ymin;
  if (!(H > 0)) return null;
  // axis: the top vertices (an apex, or a small cap ring), refined by Gauss-Newton on the profile's residuals
  const top = idx.filter((i) => py[i] >= ymax - 0.04 * H);
  let cx = top.reduce((s, i) => s + px[i], 0) / top.length, cz = top.reduce((s, i) => s + pz[i], 0) / top.length;
  // the profile: bin means (height, radius) over the vertices, interpolated between the filled bins (a decimated cone may
  // have only its eave ring and its apex)
  const B = clamp(Math.floor(idx.length / 3), 3, 10);
  let pts = [];
  const fAt = (y) => {
    if (y <= pts[0][0]) return pts[0][1];
    for (let k = 1; k < pts.length; k++) if (y <= pts[k][0]) { const f = (y - pts[k - 1][0]) / (pts[k][0] - pts[k - 1][0] || 1); return pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f; }
    return pts[pts.length - 1][1];
  };
  const fit = () => {
    const sy = new Float64Array(B), sr = new Float64Array(B), cnt = new Float64Array(B);
    for (const i of idx) { const b = clamp(Math.floor(((py[i] - ymin) / H) * B), 0, B - 1); sy[b] += py[i]; sr[b] += Math.hypot(px[i] - cx, pz[i] - cz); cnt[b]++; }
    pts = [];
    for (let b = 0; b < B; b++) if (cnt[b]) pts.push([sy[b] / cnt[b], sr[b] / cnt[b]]);
  };
  for (let it = 0; it < 4; it++) {
    fit();
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    for (const i of idx) {
      const dx = px[i] - cx, dz = pz[i] - cz, r = Math.hypot(dx, dz);
      if (r < 1e-9) continue;
      const res = r - fAt(py[i]), jx = -dx / r, jz = -dz / r;
      a11 += jx * jx; a12 += jx * jz; a22 += jz * jz; b1 += jx * res; b2 += jz * res;
    }
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 1e-12) break;
    cx -= (a22 * b1 - a12 * b2) / det * 0.8; cz -= (a11 * b2 - a12 * b1) / det * 0.8;
  }
  fit();
  let Rmax = 0, worst = 0;
  for (const i of idx) Rmax = Math.max(Rmax, Math.hypot(px[i] - cx, pz[i] - cz));
  for (const i of idx) worst = Math.max(worst, Math.abs(Math.hypot(px[i] - cx, pz[i] - cz) - fAt(py[i])));
  if (Rmax * o.unit < o.minR || worst > 0.07 * Rmax + 3 * eps) return null; // not a surface of revolution
  // a roof closes at the top (an apex or a small cap): not a sloped ring (a chamfer, a mound round a well, a dam's arch)
  const rTop = Math.max(...top.map((i) => Math.hypot(px[i] - cx, pz[i] - cz)));
  if (rTop > 0.25 * Rmax) return null;
  // how many sides: the distinct vertices of the lowest ring (an octagonal spire keeps its facets)
  const low = idx.filter((i) => py[i] <= ymin + 0.04 * H), keys = new Set(low.map((i) => `${Math.round(Math.atan2(px[i] - cx, pz[i] - cz) * 20)}`));
  if (keys.size < o.minNirr) return null;
  // flat-shaded as exported?
  let flatC = 0, corners = 0;
  for (const t of members) for (let k = 0; k < 3; k++) {
    const i = vi(t, k), vx = NR.getX(i), vy = NR.getY(i), vz = NR.getZ(i), vl = Math.hypot(vx, vy, vz) || 1;
    corners++; if ((vx * fnx[t] + vy * fny[t] + vz * fnz[t]) / vl > COS_FLAT) flatC++;
  }
  if (flatC < 0.9 * corners) return null;
  // meridian normal (radial, up) from the profile slope; oriented like the faces
  const slope = (y) => { // dρ/dy of the profile segment holding y (the nearer one at a bin centre)
    const k = clamp(pts.findIndex((q) => y <= q[0]), 1, pts.length - 1);
    return (pts[k][1] - pts[k - 1][1]) / (pts[k][0] - pts[k - 1][0] || 1);
  }, merid = (y) => { const s = slope(y), l = Math.hypot(1, s); return [1 / l, -s / l]; };
  let side = 0;
  for (const t of members) {
    let mx = 0, mz = 0, my = 0;
    for (let k = 0; k < 3; k++) { mx += px[vi(t, k)] - cx; mz += pz[vi(t, k)] - cz; my += py[vi(t, k)] / 3; }
    const l = Math.hypot(mx, mz) || 1, m = merid(my);
    side += ((fnx[t] * mx + fnz[t] * mz) / l) * m[0] + fny[t] * m[1];
  }
  const sign = side < 0 ? -1 : 1;
  const apply = () => {
    const A = NR, inter = !!A.isInterleavedBufferAttribute, arr = inter ? A.data.array : A.array, stride = inter ? A.data.stride : A.itemSize, off = inter ? A.offset : 0;
    const flt = arr instanceof Float32Array || arr instanceof Float64Array, scale = A.normalized ? (arr instanceof Int8Array ? 127 : arr instanceof Int16Array ? 32767 : 1) : 1;
    for (const t of members) {
      const fa = Math.hypot(fnx[t], fnz[t]) > 1e-6 ? Math.atan2(fnx[t], fnz[t]) : 0;
      for (let k = 0; k < 3; k++) {
        const i = vi(t, k), dx = px[i] - cx, dz = pz[i] - cz, r = Math.hypot(dx, dz), th = r > 4 * eps ? Math.atan2(dx, dz) : fa, m = merid(py[i]);
        const nx = sign * m[0] * Math.sin(th), ny = sign * m[1], nz = sign * m[0] * Math.cos(th), b = i * stride + off;
        arr[b] = flt ? nx : Math.round(nx * scale); arr[b + 1] = flt ? ny : Math.round(ny * scale); arr[b + 2] = flt ? nz : Math.round(nz * scale);
      }
    }
  };
  return { apply, members, N: keys.size, Rmax, ymin, ymax, worst };
}

/** The N vertices `v` form a regular polygon about (cx, cz): neighbouring angles within 30 % of 2π / N. */
function regularRing(v, px, pz, cx, cz, N) {
  const ang = v.map((i) => Math.atan2(px[i] - cx, pz[i] - cz)).sort((a, b) => a - b), step = TAU / N;
  for (let k = 0; k < N; k++) { const g = k + 1 < N ? ang[k + 1] - ang[k] : ang[0] + TAU - ang[k]; if (Math.abs(g - step) > 0.3 * step) return false; }
  return true;
}

/** (Re)index the plan's rings and give each member its band (the lower ring's index); false when one spans two bands. */
function bandsOf(ctx, plan) {
  const { vi, wof } = ctx;
  plan.ringIdx = new Map();
  plan.rings.forEach((r, i) => { for (const w of r.w) plan.ringIdx.set(w, i); });
  plan.band = new Int32Array(plan.members.length);
  for (let m = 0; m < plan.members.length; m++) {
    const t = plan.members[m], l0 = plan.ringIdx.get(wof[vi(t, 0)]), l1 = plan.ringIdx.get(wof[vi(t, 1)]), l2 = plan.ringIdx.get(wof[vi(t, 2)]);
    if (l0 === undefined || l1 === undefined || l2 === undefined) return false;
    const lo = Math.min(l0, l1, l2);
    if (Math.max(l0, l1, l2) - lo !== 1) return false;
    plan.band[m] = lo;
  }
  return true;
}

/**
 * Attach the complete wall / ledge rings that continue the surface at its lower and upper end (a dome sits on a rolled
 * bead: a vertical band of the same N on the same axis). A band is taken only when it is a whole strip (2N triangles)
 * between this ring and one other regular ring on the axis; a drum with a door cut in it, a cap fan, or a soffit
 * (facing down) is not, and stays as it is.
 */
function extendPlan(ctx, plan, vertTris) {
  const { vi, px, py, pz, fny, wof, eps } = ctx;
  const { N, cx, cz } = plan;
  for (let iter = 0; iter < 4; iter++) {
    let grew = false;
    for (const end of ['low', 'high']) {
      const ring = end === 'low' ? plan.rings[0] : plan.rings[plan.rings.length - 1];
      if (ring.apex) continue;
      const wset = new Set(ring.w), groups = new Map();
      for (const w of ring.w) for (const t of vertTris.get(w) || []) {
        if (ctx.claimed[t] || !(Math.abs(fny[t]) <= 0.08 || fny[t] > 0.9995)) continue; // vertical walls and up-facing flats
        let key = null, bad = false;
        for (let k = 0; k < 3 && !bad; k++) {
          const i = vi(t, k);
          if (wset.has(wof[i])) continue;
          const kk = `${Math.round(py[i] / (2 * eps))}`; // the other ring's height (its radius is checked as a whole below)
          if (key === null) key = kk; else if (key !== kk) bad = true;
        }
        if (key === null || bad) continue;
        (groups.get(key) || groups.set(key, new Set()).get(key)).add(t);
      }
      let best = null;
      const skipGroup = (why) => ctx.why?.push(`${end} ring: band not taken (${why})`);
      for (const tris of groups.values()) {
        if (tris.size !== 2 * N) { skipGroup(`${tris.size} triangles, a whole strip is ${2 * N}`); continue; }
        const nw = new Map();
        for (const t of tris) for (let k = 0; k < 3; k++) { const i = vi(t, k), w = wof[i]; if (!wset.has(w) && !nw.has(w)) nw.set(w, i); }
        if (nw.size !== N) { skipGroup(`${nw.size} vertices on its other ring, ${N} wanted`); continue; }
        const vs = [...nw.values()], rad = vs.map((i) => Math.hypot(px[i] - cx, pz[i] - cz)), r2 = rad.reduce((s, x) => s + x, 0) / N, y2 = vs.reduce((s, i) => s + py[i], 0) / N;
        if (Math.max(...rad) - Math.min(...rad) > 0.012 * r2 + 2 * eps || !regularRing(vs, px, pz, cx, cz, N)) { skipGroup('other ring not a regular circle'); continue; }
        const dy = Math.abs(y2 - ring.y), dr = Math.abs(r2 - ring.r);
        if (dy <= eps && dr <= 2 * eps) continue; // the same ring
        const vertical = dr <= 2 * eps + 0.012 * r2;
        if (!best || (vertical && !best.vertical)) best = { tris, ring: { y: y2, r: r2, w: [...nw.keys()], apex: false }, vertical };
      }
      if (!best) continue;
      if (end === 'low') plan.rings.unshift(best.ring); else plan.rings.push(best.ring);
      for (const t of best.tris) { plan.members.push(t); ctx.claimed[t] = 1; }
      grew = true;
    }
    if (!grew) break;
  }
}

/** The rings' profile, band normals (hard corners kept), the tessellation factor and whether the file is flat-shaded. */
function finishPlan(ctx, plan) {
  const { vi, px, pz, fnx, fny, fnz, wof, NR, o } = ctx;
  const { N, cx, cz, rings, members } = plan, { unit } = o;
  if (!bandsOf(ctx, plan)) { plan.members = []; return; }
  const Y = rings.map((r) => r.y), Rr = rings.map((r) => r.r), Rmax = Math.max(...Rr), nb = rings.length - 1;
  // meridian normal (radial, up) of each band, oriented like its faces (the outside of a cone, the inside of a dish)
  const bn = [], side = new Array(nb).fill(0);
  for (let b = 0; b < nb; b++) { const dr = Rr[b + 1] - Rr[b], dy = Y[b + 1] - Y[b], l = Math.hypot(dr, dy) || 1; bn.push([dy / l, -dr / l]); }
  for (let m = 0; m < members.length; m++) {
    const t = members[m], b = plan.band[m];
    let mx = 0, mz = 0;
    for (let k = 0; k < 3; k++) { mx += px[vi(t, k)] - cx; mz += pz[vi(t, k)] - cz; }
    const l = Math.hypot(mx, mz) || 1;
    side[b] += ((fnx[t] * mx + fnz[t] * mz) / l) * bn[b][0] + fny[t] * bn[b][1];
  }
  for (let b = 0; b < nb; b++) if (side[b] < 0) bn[b] = [-bn[b][0], -bn[b][1]];
  // across a ring: average a gentle corner, split a sharp one
  const cosCrease = Math.cos(o.crease * DEG), up = [], dn = []; // normal of the band above / below ring L
  for (let L = 0; L < rings.length; L++) {
    const a = L > 0 ? bn[L - 1] : null, b = L < nb ? bn[L] : null;
    if (a && b && a[0] * b[0] + a[1] * b[1] >= cosCrease) {
      let nr = a[0] + b[0], ny = a[1] + b[1]; const l = Math.hypot(nr, ny) || 1; nr /= l; ny /= l;
      up[L] = dn[L] = [nr, ny];
    } else { up[L] = b || a; dn[L] = a || b; }
  }
  // flat-shaded? (the file's corner normals against the face's own: 24 flat wedges) and how far they are from the analytic ones
  let worst = 0, flatC = 0, corners = 0;
  for (let m = 0; m < members.length; m++) {
    const t = members[m], b = plan.band[m];
    for (let c = 0; c < 3; c++) {
      const i = vi(t, c), lv = plan.ringIdx.get(wof[i]), ax = px[i] - cx, az = pz[i] - cz, l = Math.hypot(ax, az);
      const vx = NR.getX(i), vy = NR.getY(i), vz = NR.getZ(i), vl = Math.hypot(vx, vy, vz) || 1;
      corners++;
      if ((vx * fnx[t] + vy * fny[t] + vz * fnz[t]) / vl > COS_FLAT) flatC++;
      if (l < 0.05 * Rmax) continue; // the apex: no azimuth
      const nm = lv === b ? up[lv] : dn[lv], dx = ax / l, dz = az / l;
      worst = Math.max(worst, Math.acos(clamp((vx * nm[0] * dx + vy * nm[1] + vz * nm[0] * dz) / vl, -1, 1)) / DEG);
    }
  }
  // flat shading only shows when neighbouring facets turn: ≈ (360° / N) × the horizontal part of the surface normal
  let facet = 0;
  for (let b = 0; b < nb; b++) facet = Math.max(facet, (360 / N) * Math.max(Math.abs(up[b][0]), Math.abs(dn[b + 1][0]), Math.abs(bn[b][0])));
  const flat = flatC > 0.9 * corners && facet >= 5; // (a smooth surface turns facet / 2 between a vertex and its face: > 2° from here up)
  let k = clamp(Math.ceil(ringSegments(Rmax * unit, o.tol, { min: N, max: o.maxSegments, step: 1 }) / N), 1, o.maxK);
  while (k > 1 && members.length * k * k > o.maxTris) k--;
  Object.assign(plan, { Y, Rr, Rmax, up, dn, worst, flat, k, skip: k === 1 && !flat });
}

/** Kåsa least-squares circle through points [x, z]; null when degenerate. */
function circleFit(pts) {
  let sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0, sxr = 0, szr = 0, sr = 0;
  const n = pts.length;
  for (const [x, z] of pts) { sx += x; sz += z; sxx += x * x; szz += z * z; sxz += x * z; const r2 = x * x + z * z; sxr += x * r2; szr += z * r2; sr += r2; }
  const M = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]], b = [-sxr, -szr, -sr];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(M);
  if (!(Math.abs(d) > 0)) return null;
  const rep = (c) => M.map((row, i) => row.map((v, j) => (j === c ? b[i] : v)));
  const D = det(rep(0)) / d, E = det(rep(1)) / d, F = det(rep(2)) / d;
  const cx = -D / 2, cz = -E / 2, r2 = cx * cx + cz * cz - F;
  return r2 > 0 ? { cx, cz, r: Math.sqrt(r2) } : null;
}

/** Replace the plans' triangles by their refined, analytically shaded versions (new vertices appended). */
function rebuild(geo, plans, ctx, T) {
  const { vi, px, py, pz, fnx, fnz, wof, NR, o } = ctx;
  const A = geo.attributes, TG = A.tangent || null;
  const others = Object.keys(A).filter((n) => n !== 'position' && n !== 'normal' && n !== 'tangent');
  const q = 0.1e-3 / o.unit, qn = 200;
  const V = [], weld = new Map(), out = [], drop = new Uint8Array(T);
  const azim = (dx, dz) => Math.atan2(dx, dz);
  for (const plan of plans) {
    const { members, band, cx, cz, k, Y, Rr, up, dn, ringIdx } = plan;
    for (let m = 0; m < members.length; m++) {
      const t = members[m], b = band[m], s = [vi(t, 0), vi(t, 1), vi(t, 2)];
      drop[t] = 1;
      // A new vertex is the facet's own (planar, barycentric) point pushed radially out onto the true surface: same height,
      // same azimuth, only the radius changes (by at most the facet's sagitta). The UV stays the facet's barycentric one, so
      // the texture keeps the density the artist gave it (a cone's facets taper: UV that follows the azimuth instead would
      // pinch the tiles towards the apex and sample a coarser mip).
      const mx = (px[s[0]] + px[s[1]] + px[s[2]]) / 3 - cx, mz = (pz[s[0]] + pz[s[1]] + pz[s[2]]) / 3 - cz;
      const thC = Math.hypot(mx, mz) > 4 * ctx.eps ? azim(mx, mz) : 0; // the facet's mid azimuth (an apex takes it)
      const thF = Math.hypot(fnx[t], fnz[t]) > 1e-6 ? azim(fnx[t], fnz[t]) : thC; // azimuth of the face normal: the facet's orientation
      const defined = s.map((i) => Math.hypot(px[i] - cx, pz[i] - cz) > 4 * ctx.eps);
      const thS = s.map((i, j) => (defined[j] ? azim(px[i] - cx, pz[i] - cz) : thC)); // each corner's own azimuth
      const srcN = s.map((i) => [NR.getX(i), NR.getY(i), NR.getZ(i)]);
      const upper = s.map((i) => (ringIdx.get(wof[i]) === b + 1 ? 1 : 0)); // which of the band's two rings each corner is on
      const src = others.map((name) => s.map((i) => { const a = A[name], r = []; for (let c = 0; c < a.itemSize; c++) r.push(c === 0 ? a.getX(i) : c === 1 ? a.getY(i) : c === 2 ? a.getZ(i) : a.getW(i)); return r; }));
      const stan = TG ? s.map((i) => [TG.getX(i), TG.getY(i), TG.getZ(i), TG.getW(i)]) : null;
      const ids = [];
      for (let a = 0; a <= k; a++) {
        ids.push([]);
        for (let c = 0; a + c <= k; c++) {
          const w1 = a / k, w2 = c / k, w0 = 1 - w1 - w2, w = [w0, w1, w2];
          const corner = a === 0 && c === 0 ? 0 : a === k ? 1 : c === k ? 2 : -1;
          const tt = w0 * upper[0] + w1 * upper[1] + w2 * upper[2]; // 0 on the band's lower ring, 1 on its upper
          let x, y, z, th;
          if (corner >= 0) { x = px[s[corner]]; y = py[s[corner]]; z = pz[s[corner]]; th = defined[corner] ? azim(x - cx, z - cz) : thC; }
          else {
            x = w0 * px[s[0]] + w1 * px[s[1]] + w2 * px[s[2]]; z = w0 * pz[s[0]] + w1 * pz[s[1]] + w2 * pz[s[2]];
            y = Y[b] + (Y[b + 1] - Y[b]) * tt;
            const ax = x - cx, az = z - cz, rp = Math.hypot(ax, az), rt = Rr[b] + (Rr[b + 1] - Rr[b]) * tt;
            if (rp > 4 * ctx.eps) { th = azim(ax, az); x = cx + (ax * rt) / rp; z = cz + (az * rt) / rp; } else th = thC;
          }
          // the normal. A flat-shaded surface (one normal per facet) gets the analytic one: the meridian normal (radial, up) at
          // this height, turned to this vertex's azimuth, with the crease logic (hard eaves and rims). A surface the artist
          // shaded smooth keeps his normals (a tank top's bent rim, a dome's soft base): the corners' own, each turned
          // about the axis to this vertex's azimuth and blended; only the tessellation is finer.
          let nx, ny, nz;
          if (plan.flat) {
            let nr = up[b][0] * (1 - tt) + dn[b + 1][0] * tt, nyy = up[b][1] * (1 - tt) + dn[b + 1][1] * tt;
            const nl = Math.hypot(nr, nyy) || 1; nr /= nl; ny = nyy / nl;
            nx = nr * Math.sin(th); nz = nr * Math.cos(th);
          } else {
            nx = 0; ny = 0; nz = 0;
            for (let j = 0; j < 3; j++) {
              if (w[j] <= 0) continue;
              const d = th - thS[j], cs = Math.cos(d), sn = Math.sin(d), n = srcN[j];
              nx += w[j] * (n[0] * cs + n[2] * sn); ny += w[j] * n[1]; nz += w[j] * (n[2] * cs - n[0] * sn);
            }
            const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
          }
          let tan = null;
          if (stan) { // the file's tangent of each corner, turned about the axis to this azimuth, blended, made square to n
            let tx = 0, ty = 0, tz = 0, wmax = -1, tw4 = 1;
            for (let j = 0; j < 3; j++) {
              if (w[j] <= 0) continue;
              const d = th - (plan.flat ? thF : thS[j]), cs = Math.cos(d), sn = Math.sin(d), st = stan[j]; // (a facet's tangent is the facet's, a smooth vertex's is its own)
              tx += w[j] * (st[0] * cs + st[2] * sn); ty += w[j] * st[1]; tz += w[j] * (st[2] * cs - st[0] * sn);
              if (w[j] > wmax) { wmax = w[j]; tw4 = st[3]; }
            }
            const dot = tx * nx + ty * ny + tz * nz; tx -= dot * nx; ty -= dot * ny; tz -= dot * nz;
            const tl = Math.hypot(tx, ty, tz) || 1;
            tan = [tx / tl, ty / tl, tz / tl, tw4];
          }
          const vals = src.map((per) => per[0].map((_, cc) => w0 * per[0][cc] + w1 * per[1][cc] + w2 * per[2][cc]));
          let key = `${Math.round(x / q)},${Math.round(y / q)},${Math.round(z / q)}|${Math.round(nx * qn)},${Math.round(ny * qn)},${Math.round(nz * qn)}`;
          for (const v of vals) for (const e of v) key += `|${Math.round(e * 1e4)}`;
          let id = weld.get(key);
          if (id === undefined) { id = V.length; weld.set(key, id); V.push({ x, y, z, nx, ny, nz, tan, vals }); }
          ids[a].push(id);
        }
      }
      for (let a = 0; a < k; a++) for (let c = 0; a + c < k; c++) {
        out.push(ids[a][c], ids[a + 1][c], ids[a][c + 1]);
        if (a + c < k - 1) out.push(ids[a + 1][c], ids[a + 1][c + 1], ids[a][c + 1]);
      }
    }
  }
  const extra = V.length, grown = {};
  for (const name of Object.keys(A)) grown[name] = growable(A[name], extra);
  const nv = grown.position.have;
  if (Object.values(grown).some((g) => g.have !== nv)) return false; // attributes of different lengths: not a plain primitive, leave it
  V.forEach((v, i) => {
    const gp = grown.position, gn = grown.normal;
    gp.set(i, 0, v.x); gp.set(i, 1, v.y); gp.set(i, 2, v.z);
    gn.set(i, 0, v.nx); gn.set(i, 1, v.ny); gn.set(i, 2, v.nz);
    if (v.tan) for (let c = 0; c < 4; c++) grown.tangent.set(i, c, v.tan[c]);
    others.forEach((name, j) => { const a = grown[name]; for (let c = 0; c < A[name].itemSize; c++) a.set(i, c, v.vals[j][c]); });
  });
  const list = [];
  const ix = geo.index ? geo.index.array : null;
  for (let t = 0; t < T; t++) if (!drop[t]) list.push(ix ? ix[t * 3] : t * 3, ix ? ix[t * 3 + 1] : t * 3 + 1, ix ? ix[t * 3 + 2] : t * 3 + 2);
  for (const id of out) list.push(nv + id);
  // gameplay keeps measuring the authored geometry (engine/gameplay-geometry.js: a visual refinement must not flip a nav
  // cell): it shares the original position attribute and index, which this function never writes to
  if (gameplayGeometry(geo) === geo) {
    const g0 = new THREE.BufferGeometry();
    g0.setAttribute('position', A.position);
    if (geo.index) g0.setIndex(geo.index);
    setGameplayGeometry(geo, g0);
  }
  for (const name of Object.keys(A)) geo.setAttribute(name, grown[name].attr);
  geo.setIndex(new THREE.BufferAttribute(nv + extra > 65535 ? new Uint32Array(list) : new Uint16Array(list), 1));
  geo.boundingBox = null; geo.boundingSphere = null;
  return true;
}

/**
 * Building-fixups hook: smooth and re-tessellate the round roofs of a freshly loaded GLB scene.
 * @param {THREE.Object3D} root the scene (its meshes sit under the quantisation scale nodes)
 * @param {number} lod 0 | 1 | 2 (the sagitta tolerance follows the zoom the LOD is shown at)
 * @param {object} [opts] refineRoundRoofs options
 * @returns {number} surfaces refined
 */
export function roundRoofs(root, lod = 0, opts = {}) {
  root.updateMatrixWorld?.(true);
  let n = 0;
  const done = new WeakSet();
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || done.has(o.geometry)) return;
    done.add(o.geometry);
    const unit = o.matrixWorld.getMaxScaleOnAxis() || 1;
    try { // a visual refinement must never stop an asset from loading
      const r = refineRoundRoofs(o.geometry, { unit, tol: SAG_TOL[Math.min(2, lod)], ...opts });
      if (r) n += r.surfaces.filter((s) => !s.skip).length;
    } catch (e) { console.warn('[round-roofs] skipped a mesh:', e?.message || e); }
  });
  return n;
}
