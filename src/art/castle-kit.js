/**
 * Procedural castle kit (M20 Gundelfingen art pass): limestone curtain walls with a battered talus, string course,
 * corbelled crenellated parapets and wall-walk flags; masonry terraces with coping; round and square towers with
 * slate cones; twin-tower gatehouses with a pointed arch and a raised portcullis; timber moat bridges; castle ranges.
 * Everything is sized from the mission's gameplay data (wall polylines, level polygons, footprints), so the art
 * never moves a cell. Geometry is accumulated per material into one merged mesh per structure (few draw calls),
 * textured from the shared library (box-projected world UVs) and shaded by a COLOR_0 grime/tone field.
 * Node (unit tests): plain colours, no textures.
 * @module art/castle-kit
 */
import * as THREE from 'three';
import { libTextureURL } from './building-library.js';
import { rng, seedOf, fbm } from './dressing.js';
import { scopedMemo, pendingTextureBytes } from '../engine/scoped-assets.js';
import { antiTile } from './anti-tiling.js';

const HAS_DOM = typeof document !== 'undefined';

/** material key → [library set, tint, flat colour, metres per tile, normal strength, roughness override]. */
export const CASTLE_SETS = {
  ashlar: ['ashlar_limestone', 0xb9b2a3, 0x8f8a7a, 2.2, 1.3],
  rubble: ['rubble_stone', 0xc9c3b4, 0x7c776a, 2.0, 1.3],
  field: ['fieldstone_grey', 0xd0cbc0, 0x7f7a70, 1.7, 1.2],
  dressed: ['limestone_smooth', 0xcdc6b6, 0x9a9484, 2.0, 0.8],
  flags: ['ashlar', 0xcfcbc2, 0x77746b, 2.6, 1.0],
  paving: ['patio_flags', 0xa9a59a, 0x77746b, 3.0, 1.0],
  setts: ['setts_granite', 0xd6d2c8, 0x6e6b64, 2.4, 1.0],
  slate: ['roof_slate', 0xa9b0bd, 0x3d4552, 3.0, 1.0],
  plaster: ['plaster_rough', 0xe6dfcf, 0xb0a891, 2.0, 0.8],
  timber: ['timber_beam', 0x9a8670, 0x4f4034, 1.5, 1.0],
  planks: ['deck_planks', 0xb0a089, 0x5c4c3a, 2.0, 1.0],
  boards: ['boards_weathered', 0xb5a58e, 0x5d4c3b, 2.4, 1.0],
  iron: ['cast_iron', 0x6a6a68, 0x333333, 1.0, 0.6],
  lead: ['bitumen_felt', 0x9a9a98, 0x4a4b4c, 2.0, 0.6],
  moss: ['turf_grass', 0x8e9a74, 0x4f5a3a, 2.0, 0.8],
  canvas: ['tent_canvas', 0xa8a58a, 0x77745d, 4.0, 0.8],
  paint: ['steel_painted', 0x8a8f7e, 0x5d6253, 1.5, 0.7],     // Wehrmacht field grey (dunkelgrau RAL 7021 weathered)
  rubber: ['cast_iron', 0x3a3a3a, 0x222222, 1.0, 0.5],
  signal: ['steel_painted', 0xc8382a, 0x9a2a1e, 1.5, 0.6],   // signal red (lever handles, warning bands)
};

const TEX = new Map(), MATS = new Map();
let FROST = 0;
/** Hoar frost on up-facing surfaces of everything built from now on (0 = none; M20's frost theater ~0.3). */
export function setCastleFrost(v) { FROST = Math.max(0, Math.min(1, v || 0)); }
function tex(file, srgb) {
  const { url } = libTextureURL(file);
  // mission-scoped (engine/scoped-assets.js): freed once no kept mission uses it
  return scopedMemo('castle:tex', TEX, url + (srgb ? '|s' : ''), () => {
    const t = new THREE.TextureLoader().load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, { bytes: pendingTextureBytes, free: (t) => t.dispose() });
}

/** Shared castle material (vertex colours on: the grime field multiplies the albedo). */
export function castleMaterial(name) {
  const set = CASTLE_SETS[name] || CASTLE_SETS.ashlar;
  const key = `${name}|${HAS_DOM ? libTextureURL(`${set[0]}_diff.jpg`).url : 'node'}`;
  return scopedMemo('castle:mat', MATS, key, () => makeCastleMaterial(name, set), { free: (m) => m.dispose() });
}

function makeCastleMaterial(name, set) {
  const [file, tint, flat, , nrm] = set;
  let m;
  if (!HAS_DOM) m = new THREE.MeshStandardMaterial({ color: flat, roughness: 0.9, vertexColors: true });
  else {
    const arm = tex(`${file}_arm.jpg`, false);
    m = new THREE.MeshStandardMaterial({
      color: tint, map: tex(`${file}_diff.jpg`, true), normalMap: tex(`${file}_nor.jpg`, false),
      normalScale: new THREE.Vector2(nrm, nrm), roughnessMap: arm, metalnessMap: arm, aoMap: null,
      roughness: 1, metalness: name === 'iron' || name === 'paint' || name === 'signal' ? 0.6 : 0.0, vertexColors: true,
    });
    antiTile(m, { lib: file, grime: 0.35 });   // the castle's own grime field is in the vertex colours
  }
  m.name = `castle:${name}`;
  return m;
}

/** Signed area of an (x, z) polygon (> 0: counter-clockwise with x right, z up). */
export const area2 = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
/** The polygon in counter-clockwise order (math sense in x/z; the outward side of edge a→b is its right). */
export const ccw = (p) => (area2(p) < 0 ? p.slice().reverse() : p);

/**
 * Triangle accumulator: primitives in world (or any common) coordinates, grouped by material key. `build()` returns
 * one Group with one mesh per material: box-projected UVs (metres / tile), flat normals, COLOR_0 tone + grime.
 */
export class Geo {
  constructor(seed = 1) { this.parts = new Map(); this.R = rng(seedOf(seed)); this.seed = seedOf(seed) % 997; }
  _arr(mat) { if (!this.parts.has(mat)) this.parts.set(mat, { pos: [], tone: [] }); return this.parts.get(mat); }
  /** One triangle; `tone` multiplies its vertex colour (per-block variation). */
  tri(mat, a, b, c, tone = 1) {
    const A = this._arr(mat);
    A.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    A.tone.push(tone, tone, tone);
  }
  /** Quad a-b-c-d (counter-clockwise seen from outside). */
  quad(mat, a, b, c, d, tone = 1) { this.tri(mat, a, b, c, tone); this.tri(mat, a, c, d, tone); }
  /** Hexahedron from 8 corners: bottom ring p0..p3 (CCW from above), top ring p4..p7. */
  hexa(mat, p, tone = 1, { bottom = false } = {}) {
    const [a, b, c, d, e, f, g, h] = p;
    if (bottom) this.quad(mat, a, d, c, b, tone);
    this.quad(mat, e, f, g, h, tone);
    this.quad(mat, a, b, f, e, tone); this.quad(mat, b, c, g, f, tone);
    this.quad(mat, c, d, h, g, tone); this.quad(mat, d, a, e, h, tone);
  }
  /** Oriented box: centre, size (sx along heading `rot`, sy up, sz across), rot = heading in the x/z plane. */
  box(mat, cx, cy, cz, sx, sy, sz, rot = 0, tone = 1, taper = 0) {
    const c = Math.cos(rot), s = Math.sin(rot), hx = sx / 2, hz = sz / 2;
    const P = (lx, ly, lz, k) => { const t = ly > 0 ? 1 - taper * k : 1; return [cx + lx * t * c - lz * t * s, cy + ly, cz + lx * t * s + lz * t * c]; };
    const y0 = -sy / 2, y1 = sy / 2;
    this.hexa(mat, [P(-hx, y0, -hz), P(-hx, y0, hz), P(hx, y0, hz), P(hx, y0, -hz),
      P(-hx, y1, -hz, 1), P(-hx, y1, hz, 1), P(hx, y1, hz, 1), P(hx, y1, -hz, 1)], tone);
  }
  /** Vertical prism over a CCW (x, z) polygon from y0 to y1 (top cap; sides; optional bottom). */
  prism(mat, poly, y0, y1, tone = 1, { top = true, sides = true, sideMat = null } = {}) {
    poly = ccw(poly);
    const n = poly.length;
    if (top) for (let i = 1; i + 1 < n; i++) this.tri(mat, [poly[0][0], y1, poly[0][1]], [poly[i + 1][0], y1, poly[i + 1][1]], [poly[i][0], y1, poly[i][1]], tone);
    if (sides) for (let i = 0; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n];
      this.quad(sideMat || mat, [p[0], y0, p[1]], [p[0], y1, p[1]], [q[0], y1, q[1]], [q[0], y0, q[1]], tone);
    }
  }
  /** Frustum / cylinder / cone along +y: centre (x, y, z), radii r0 (bottom) r1 (top), height h, `seg` sides. */
  cyl(mat, x, y, z, r0, r1, h, seg = 12, tone = 1, { caps = true, a0 = 0, arc = Math.PI * 2 } = {}) {
    const full = arc >= Math.PI * 2 - 1e-6;
    const ring = (r, yy) => Array.from({ length: seg + (full ? 0 : 1) }, (_, k) => {
      const a = a0 + (arc * k) / seg; return [x + Math.cos(a) * r, yy, z + Math.sin(a) * r];
    });
    const A = ring(r0, y), B = ring(r1, y + h), m = A.length;
    for (let k = 0; k < (full ? m : m - 1); k++) {
      const k1 = (k + 1) % m;
      if (r1 > 1e-4) this.quad(mat, A[k], B[k], B[k1], A[k1], tone);
      else this.tri(mat, A[k], B[k], A[k1], tone);
    }
    if (caps && full && r1 > 1e-4) for (let k = 1; k + 1 < m; k++) this.tri(mat, B[0], B[k + 1], B[k], tone);
  }
  /**
   * Solid annular band (a parapet ring, a coping ring, a merlon on a round tower): outer face, inner face facing the
   * centre, top, bottom and — for a partial arc — end faces; centre (x, y, z), radii r0 (inner) < r1 (outer), height h.
   */
  ring(mat, x, y, z, r0, r1, h, seg = 16, tone = 1, { a0 = 0, arc = Math.PI * 2 } = {}) {
    const full = arc >= Math.PI * 2 - 1e-6, m = seg + (full ? 0 : 1);
    const P = (r, yy, k) => { const a = a0 + (arc * k) / seg; return [x + Math.cos(a) * r, yy, z + Math.sin(a) * r]; };
    for (let k = 0; k < seg; k++) {
      const k1 = full ? (k + 1) % m : k + 1;
      const o0 = P(r1, y, k), o1 = P(r1, y, k1), O0 = P(r1, y + h, k), O1 = P(r1, y + h, k1);
      const i0 = P(r0, y, k), i1 = P(r0, y, k1), I0 = P(r0, y + h, k), I1 = P(r0, y + h, k1);
      this.quad(mat, o0, O0, O1, o1, tone);            // outer (same winding as cyl)
      this.quad(mat, i0, i1, I1, I0, tone * 0.92);     // inner, facing the centre
      this.quad(mat, O0, I0, I1, O1, tone);            // top
      this.quad(mat, o0, o1, i1, i0, tone * 0.8);      // underside
    }
    if (!full) {
      const s0 = [P(r0, y, 0), P(r1, y, 0), P(r1, y + h, 0), P(r0, y + h, 0)], s1 = [P(r0, y, seg), P(r1, y, seg), P(r1, y + h, seg), P(r0, y + h, seg)];
      this.quad(mat, s0[0], s0[3], s0[2], s0[1], tone * 0.95);
      this.quad(mat, s1[0], s1[1], s1[2], s1[3], tone * 0.95);
    }
  }
  /**
   * Merge into meshes. opts.ground: y of the local ground (rising-damp band); opts.damp: band height (m);
   * opts.streaks: rain-streak strength on walls; opts.moss: green tint on up-facing stone.
   * @returns {THREE.Group}
   */
  build(name = 'castle', { ground = 0, damp = 1.1, streaks = 0.22, moss = 0.35, shadow = true } = {}) {
    const g = new THREE.Group(); g.name = name;
    const s = this.seed;
    for (const [mat, A] of this.parts) {
      if (!A.pos.length) continue;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(A.pos);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const N = geo.attributes.normal, n = pos.length / 3, tile = (CASTLE_SETS[mat] || CASTLE_SETS.ashlar)[3];
      const uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
      const stone = /ashlar|rubble|field|dressed|flags|setts|plaster/.test(mat), amp = /flags|setts/.test(mat) ? 0.22 : 0.1; // walk tops: worn / damp patches
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i), ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
        const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z * Math.sign(nx || 1), y] : [-x * Math.sign(nz || 1), y];
        uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
        let k = A.tone[i] * (1 + amp * fbm(x * 0.08, y * 0.08, z * 0.08, s, 3));
        if (stone && ay < 0.6) {
          const h = y - ground;
          if (h < damp) k *= 0.72 + 0.28 * Math.max(0, h / damp);                     // rising damp / splash band
          k *= 1 - streaks * Math.max(0, fbm(x * 0.9 + z * 0.9, y * 0.06, 0.5, s + 7, 3));  // vertical rain streaks
        }
        let r = k, gg = k, b = k;
        if (stone && ny > 0.6) {                                                          // lichen / moss on tops
          const m = Math.max(0, fbm(x * 0.35, 0, z * 0.35, s + 13, 3) + 0.1) * moss;
          r *= 1 - m * 0.35; gg *= 1 - m * 0.12; b *= 1 - m * 0.5;
        }
        if (FROST > 0 && ny > 0.55) {                                                   // hoar frost on tops (frost theater)
          const f = FROST * Math.min(1, (ny - 0.55) / 0.3) * (0.6 + 0.4 * Math.max(0, fbm(x * 0.6, 0, z * 0.6, s + 29, 2) + 0.5));
          r += f * (1.08 - r * 0.5); gg += f * (1.12 - gg * 0.5); b += f * (1.2 - b * 0.5);
        }
        col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, castleMaterial(mat));
      m.name = `${name}:${mat}`;
      m.castShadow = shadow; m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }
}

// ---------------------------------------------------------------- curtain walls
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
/** Frame of segment a→b with the outward normal pointing away from `inside`: {t, n, L, at(u, w) → [x, z]}. */
export function segFrame(a, b, inside) {
  const d = sub(b, a), L = Math.hypot(d[0], d[1]) || 1e-6, t = [d[0] / L, d[1] / L];
  let n = [t[1], -t[0]];
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (inside && (m[0] - inside[0]) * n[0] + (m[1] - inside[1]) * n[1] < 0) n = [-n[0], -n[1]];
  return { t, n, L, rot: Math.atan2(t[1], t[0]), at: (u, w) => [a[0] + t[0] * u + n[0] * w, a[1] + t[1] * u + n[1] * w] };
}

/** Box aligned to a segment frame: along u0..u1, across w0..w1 (outward +), y0..y1. */
export function segBox(G, mat, F, u0, u1, w0, w1, y0, y1, tone = 1, { taperOut = 0 } = {}) {
  const P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
  const wt = w1 + taperOut;
  // ring CCW from above in three.js terms (see Geo.hexa): u0w0, u0w1, u1w1, u1w0 when n = right of t
  const r0 = [P(u0, w0, y0), P(u0, wt, y0), P(u1, wt, y0), P(u1, w0, y0)];
  const r1 = [P(u0, w0, y1), P(u0, w1, y1), P(u1, w1, y1), P(u1, w0, y1)];
  const cross = (F.t[0] * F.n[1] - F.t[1] * F.n[0]);
  if (cross > 0) G.hexa(mat, [...r0, ...r1], tone); else G.hexa(mat, [r0[3], r0[2], r0[1], r0[0], r1[3], r1[2], r1[1], r1[0]], tone);
}

/**
 * Crenellated curtain wall along a polyline. o: {width=5, h=7, inside=[x,z] (castle centre), base=-1.5, talus=1.0,
 * parapet=true, merlon=[1.4, 0.8], gaps=[[x, z, r]] (no merlons there), bartizans=true, seed}.
 * The walk is the whole top (gameplay walkway y = h); the parapet sits on corbels at the outer edge.
 */
export function buildCurtain(points, o = {}) {
  const G = o.G || new Geo(o.seed ?? points.flat().join(','));
  const W = o.width ?? 5, h = o.h ?? 7, base = o.base ?? -1.5, tal = o.talus ?? 1.0, R = G.R;
  const half = W / 2, pTop = h + 1.1, mTop = h + 1.95, [mL, mG] = o.merlon || [1.45, 0.75];
  for (let k = 0; k + 1 < points.length; k++) {
    const F = segFrame(points[k], points[k + 1], o.inside);
    const e0 = k > 0 ? -half * 0.6 : 0, e1 = F.L + (k + 2 < points.length ? half * 0.6 : 0); // overlap at joints
    // core + battered talus (outer face) + cordon roll at the talus top
    segBox(G, 'ashlar', F, e0, e1, -half, half, base, h, 1);
    segBox(G, 'rubble', F, e0, e1, half - 0.02, half + 0.02, base, 2.4, 0.95, { taperOut: tal });
    segBox(G, 'dressed', F, e0, e1, half - 0.05, half + 0.18, 2.35, 2.6, 1.02);
    // string course under the corbels, then the corbel table and the projecting parapet
    segBox(G, 'dressed', F, e0, e1, half - 0.05, half + 0.12, h - 1.45, h - 1.25, 1.0);
    if (o.parapet !== false) {
      for (let u = e0 + 0.45; u < e1 - 0.2; u += 1.1) segBox(G, 'dressed', F, u - 0.17, u + 0.17, half - 0.1, half + 0.32, h - 0.75, h - 0.05, 0.96, { taperOut: -0.25 });
      segBox(G, 'ashlar', F, e0, e1, half - 0.35, half + 0.32, h - 0.08, pTop, 0.98);
      segBox(G, 'dressed', F, e0, e1, half - 0.42, half + 0.38, pTop, pTop + 0.1, 1.05);
      // merlons with a coping stone; crenels left open (gaps: no merlons, e.g. over a climb spot)
      for (let u = e0 + 0.6; u + mL < e1 - 0.3; u += mL + mG) {
        const [cx, cz] = F.at(u + mL / 2, half);
        if ((o.gaps || []).some(([gx, gz, gr]) => Math.hypot(cx - gx, cz - gz) < gr)) continue;
        const tn = 0.94 + R() * 0.1;
        segBox(G, 'ashlar', F, u, u + mL, half - 0.33, half + 0.3, pTop + 0.1, mTop, tn);
        segBox(G, 'dressed', F, u - 0.04, u + mL + 0.04, half - 0.37, half + 0.34, mTop, mTop + 0.1, 1.04);
        if (R() < 0.45) segBox(G, 'iron', F, u + mL / 2 - 0.05, u + mL / 2 + 0.05, half + 0.3, half + 0.32, pTop + 0.2, mTop - 0.2, 0.12);
      }
    }
    // inner coping kerb, arrow slits and drain spouts on the outer face
    segBox(G, 'dressed', F, e0, e1, -half - 0.05, -half + 0.3, h, h + 0.12, 1.0);
    for (let u = 3 + R() * 2; u < F.L - 2; u += 6 + R() * 2) {
      segBox(G, 'iron', F, u - 0.09, u + 0.09, half + 0.0, half + 0.02, 3.2, 4.6, 0.1);
      segBox(G, 'dressed', F, u - 0.3, u + 0.3, half - 0.02, half + 0.05, 3.05, 3.2, 1.0);
      segBox(G, 'dressed', F, u - 0.3, u + 0.3, half - 0.02, half + 0.05, 4.6, 4.78, 1.0);
    }
    for (let u = 4 + R() * 3; u < F.L - 2; u += 9 + R() * 3) segBox(G, 'dressed', F, u - 0.12, u + 0.12, half + 0.3, half + 0.85, h - 0.35, h - 0.15, 0.9);
    // corbelled round bartizan hung on each interior angle (outside the walk)
    if (o.bartizans !== false && k + 2 < points.length) {
      const F2 = segFrame(points[k + 1], points[k + 2], o.inside);
      const nx = F.n[0] + F2.n[0], nz = F.n[1] + F2.n[1], nl = Math.hypot(nx, nz) || 1;
      const turn = Math.abs(F.t[0] * F2.t[1] - F.t[1] * F2.t[0]);
      if (turn > 0.2) bartizan(G, points[k + 1][0] + (nx / nl) * (half + 0.6), points[k + 1][1] + (nz / nl) * (half + 0.6), h, 1.45);
    }
  }
  return o.G ? G : G.build(o.name || 'curtain', { ground: 0 });
}

/** Corbelled round bartizan: a stone cone under the floor at y, a shaft to the eaves, a slate cone and a finial. */
export function bartizan(G, x, z, y, r = 1.4, seg = 14) {
  G.cyl('dressed', x, y - 2.4, z, 0.25, r, 2.4, seg, 0.95);
  G.cyl('dressed', x, y - 0.05, z, r + 0.08, r + 0.08, 0.18, seg, 1.05);
  G.cyl('ashlar', x, y + 0.1, z, r, r, 2.6, seg, 1.0, { caps: false });
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.4; G.box('iron', x + Math.cos(a) * (r + 0.01), y + 1.4, z + Math.sin(a) * (r + 0.01), 0.04, 0.9, 0.16, a + Math.PI / 2, 0.1); }
  G.cyl('slate', x, y + 2.65, z, r + 0.35, 0.02, r * 2.6, seg, 1.0);
  G.cyl('iron', x, y + 2.6 + r * 2.6 - 0.1, z, 0.05, 0.02, 1.1, 6, 0.6);
}

// ---------------------------------------------------------------- terraces, parapets
/** Offset a CCW (x, z) polygon by d (outward +), mitred. */
export function offsetPoly(poly, d) {
  const p = ccw(poly), n = p.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
    const n1 = norm2([b[1] - a[1], a[0] - b[0]]), n2 = norm2([c[1] - b[1], b[0] - c[0]]);
    const m = norm2([n1[0] + n2[0], n1[1] + n2[1]]), cs = m[0] * n1[0] + m[1] * n1[1] || 1;
    out.push([b[0] + (m[0] * d) / cs, b[1] + (m[1] * d) / cs]);
  }
  return out;
}
const norm2 = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

/**
 * Masonry terrace / bastion raised to y over polygon `poly`: battered ashlar retaining walls on a rubble plinth,
 * a dressed coping band, a flagged top (the walk surface stays exactly at y), drain spouts.
 * o: {top='flags', side='ashlar', batter=0.25, spouts=true, seed, G}
 */
export function buildTerrace(poly, y, o = {}) {
  const G = o.G || new Geo(o.seed ?? poly.flat().join(','));
  const p = ccw(poly), bat = Math.min(o.batter ?? 0.25, y * 0.04);
  const foot = offsetPoly(p, bat), cop = offsetPoly(p, 0.08), R = G.R;
  // edges standing against another body (o.skip: [[x0, z0, x1, z1]] rects, e.g. a building face) get no face,
  // coping, plinth or spouts: that body's own wall is the face (no doubled, interpenetrating masonry)
  const skipped = (a, b) => (o.skip || []).some(([x0, z0, x1, z1]) => {
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    return mx > x0 - 0.6 && mx < x1 + 0.6 && mz > z0 - 0.6 && mz < z1 + 0.6;
  });
  const flagged = (o.top || 'flags') === 'flags' && o.jointed !== false;
  G.prism(o.top || 'flags', p, y - 0.3, y, flagged ? 0.5 : 1.0, { sides: false }); // flagged: the base shows as the joints
  if (flagged) flagTop(G, p, y, o);
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], a0 = foot[i], b0 = foot[(i + 1) % p.length], a1 = cop[i], b1 = cop[(i + 1) % p.length];
    if (skipped(a, b)) continue;
    G.quad(o.side || 'ashlar', [a0[0], -0.4, a0[1]], [a[0], y - 0.3, a[1]], [b[0], y - 0.3, b[1]], [b0[0], -0.4, b0[1]], 0.97 + R() * 0.06);
    G.quad('dressed', [a1[0], y - 0.32, a1[1]], [a1[0], y + 0.02, a1[1]], [b1[0], y + 0.02, b1[1]], [b1[0], y - 0.32, b1[1]], 1.04);
    G.quad('dressed', [a1[0], y + 0.02, a1[1]], [a[0], y + 0.02, a[1]], [b[0], y + 0.02, b[1]], [b1[0], y + 0.02, b1[1]], 1.04);
    G.quad('dressed', [a1[0], y - 0.32, a1[1]], [b1[0], y - 0.32, b1[1]], [b[0], y - 0.32, b[1]], [a[0], y - 0.32, a[1]], 0.8);
    const F = segFrame(a, b, null), L = Math.hypot(b[0] - a[0], b[1] - a[1]);   // n = right of a→b = outward (CCW)
    if (y > 1.5) segBox(G, 'rubble', F, 0, L, -0.2, bat + 0.14, -0.4, Math.min(0.55, y * 0.2), 0.92);
    if (o.spouts !== false && y > 3 && L >= 6) for (let u = 3 + R() * 3; u < L - 2; u += 8 + R() * 4) segBox(G, 'dressed', F, u - 0.12, u + 0.12, 0, 0.55, y - 0.55, y - 0.35, 0.85);
  }
  return o.G ? G : G.build(o.name || 'terrace', { ground: 0 });
}

// ---------------------------------------------------------------- flagged walk tops
const inPoly2 = (q, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > q[1]) !== (zj > q[1]) && q[0] < ((xj - xi) * (q[1] - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
/** Sutherland-Hodgman: (possibly concave) polygon `subj` clipped by the convex CCW polygon `clip`. */
export function clipConvex(subj, clip) {
  let out = subj;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], inp = out; out = [];
    const side = (q) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
    for (let k = 0; k < inp.length; k++) {
      const P = inp[k], Q = inp[(k + 1) % inp.length], sp = side(P), sq = side(Q);
      if (sp >= 0) out.push(P);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
    }
  }
  return out;
}
/** Up-facing flat polygon (any CCW (x, z) outline, triangulated) at height y. */
export function flatPoly(G, mat, poly, y, tone) {
  const p = ccw(poly);
  if (p.length < 3 || Math.abs(area2(p)) < 1e-3) return;
  const tris = THREE.ShapeUtils.triangulateShape(p.map((q) => new THREE.Vector2(q[0], q[1])), []);
  for (const [a, b, c] of tris) G.tri(mat, [p[a][0], y, p[a][1]], [p[c][0], y, p[c][1]], [p[b][0], y, p[b][1]], tone);
}

/**
 * Flagged walk top over a CCW polygon at y (the base prism top shows as the dark joints): limestone flags in staggered
 * courses along the longest edge (each its own tone, worn / damp / replaced ones), a dressed gutter channel inside the
 * coping with cast-iron drain grates by the spouts, moss in the corners and along the channel. Visual only: the slabs
 * stand 1.5 cm proud of y (the walk height the units use).
 */
export function flagTop(G, poly, y, o = {}) {
  const p = ccw(poly), R = G.R, s = G.seed, ch = o.channel ?? 0.38;
  let best = 0, ang = 0;
  for (let i = 0; i < p.length; i++) { const b = p[(i + 1) % p.length], L = Math.hypot(b[0] - p[i][0], b[1] - p[i][1]); if (L > best) { best = L; ang = Math.atan2(b[1] - p[i][1], b[0] - p[i][0]); } }
  const c = Math.cos(ang), sn = Math.sin(ang), toW = (u, v) => [u * c - v * sn, u * sn + v * c];
  const inner = offsetPoly(p, -ch), loc = inner.map(([x, z]) => [x * c + z * sn, -x * sn + z * c]);
  const us = loc.map((q) => q[0]), vs = loc.map((q) => q[1]);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs), J = 0.035;
  // gutter channel: the band between the coping and the flags, a shade darker and damp
  flatPoly(G, 'dressed', p, y + 0.006, 0.66);
  for (let v = v0, row = 0; v < v1; row++) {
    const rh = o.course ?? (0.75 + ((row * 7) % 3) * 0.12);
    for (let u = u0 - R() * 0.9; u < u1;) {
      const len = 0.8 + R() * 0.8, a = [u + J, v + J], b = [u + len - J, v + rh - J];
      const rect = [toW(a[0], a[1]), toW(b[0], a[1]), toW(b[0], b[1]), toW(a[0], b[1])];
      const all = rect.every((q) => inPoly2(q, inner));
      const piece = all ? rect : clipConvex(inner, rect);
      if (piece.length >= 3) {
        const [cx, cz] = toW(u + len / 2, v + rh / 2);
        const wet = fbm(cx * 0.09, 0, cz * 0.09, s + 41, 3), worn = fbm(cx * 0.5, 1, cz * 0.5, s + 3, 2);
        let tone = 0.78 + R() * 0.3 + worn * 0.16;
        tone *= 1 - 0.32 * Math.min(1, Math.max(0, (wet + 0.05) / 0.35));   // damp / dirty patches where water stands
        if (R() < 0.04) tone *= 1.2;                                       // a replaced, cleaner flag
        const q = R();                                                     // mixed stone: warmer patio flags, grey fieldstone
        flatPoly(G, q < 0.12 ? 'paving' : q < 0.2 ? 'field' : 'flags', piece, y + 0.015 + R() * 0.006, tone);
      }
      u += len;
    }
    v += rh;
  }
  // drain grates in the channel at intervals, moss in the channel and the corners
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 3) continue;
    const t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-t[1], t[0]];          // n: inward (left of a→b, CCW)
    const at = (u, w) => [a[0] + t[0] * u + n[0] * w, a[1] + t[1] * u + n[1] * w];
    if (L >= 6) for (let u = 3 + R() * 3; u < L - 2; u += 8 + R() * 4) { const [x, z] = at(u, ch / 2); G.box('iron', x, y + 0.012, z, 0.34, 0.025, 0.26, Math.atan2(t[1], t[0]), 0.7); }
    for (let u = R() * 2; u < L; u += 1.5 + R() * 4) {
      const [x, z] = at(u, ch * (0.3 + R() * 0.7)), r = 0.1 + R() * 0.22, k = 5 + ((R() * 3) | 0), ring = [];
      for (let j = 0; j < k; j++) { const q = (j / k) * Math.PI * 2, rr = r * (0.6 + R() * 0.5); ring.push([x + Math.cos(q) * rr * 1.4, z + Math.sin(q) * rr * 0.8]); }
      flatPoly(G, 'moss', ring, y + 0.024, 1.0 + R() * 0.25);
    }
  }
  return G;
}

/**
 * Low parapet strip over polygon `poly` (a thin rectangle along a terrace edge) from y to yTop: a stone balustrade
 * (dressed rail on squat balusters between piers) or a solid crenellated wall.
 */
export function buildParapet(poly, y, yTop, o = {}) {
  const G = o.G || new Geo(o.seed ?? poly.flat().join(','));
  const p = ccw(poly);
  // long axis of the strip
  let best = 0, ia = 0;
  for (let i = 0; i < p.length; i++) { const b = p[(i + 1) % p.length], L = Math.hypot(b[0] - p[i][0], b[1] - p[i][1]); if (L > best) { best = L; ia = i; } }
  const a = p[ia], b = p[(ia + 1) % p.length], F = segFrame(a, b, null);
  const cx = p.reduce((s, q) => s + q[0], 0) / p.length, cz = p.reduce((s, q) => s + q[1], 0) / p.length;
  const off = (cx - a[0]) * F.n[0] + (cz - a[1]) * F.n[1], th = 0.45, H = yTop - y;
  const w0 = off - th / 2, w1 = off + th / 2;
  if (o.style === 'balustrade') {
    segBox(G, 'dressed', F, 0, F.L, w0 - 0.05, w1 + 0.05, y, y + 0.22, 1.0);
    segBox(G, 'dressed', F, 0, F.L, w0 - 0.07, w1 + 0.07, y + H - 0.2, y + H, 1.05);
    for (let u = 0.25; u < F.L - 0.1; u += 0.32) G.cyl('dressed', ...(() => { const [x, z] = F.at(u, off); return [x, y + 0.22, z]; })(), 0.1, 0.07, H - 0.42, 6, 0.98, { caps: false });
    for (let u = 0; u <= F.L + 0.01; u += Math.max(2.5, F.L / Math.max(1, Math.round(F.L / 3)))) segBox(G, 'ashlar', F, Math.max(0, u - 0.25), Math.min(F.L, u + 0.25), w0 - 0.08, w1 + 0.08, y, y + H + 0.08, 1.0);
  } else {
    segBox(G, 'ashlar', F, 0, F.L, w0, w1, y - 0.1, y + H * 0.7, 1.0);
    for (let u = 0.1; u < F.L - 0.6; u += 1.9) segBox(G, 'ashlar', F, u, Math.min(F.L, u + 1.2), w0, w1, y + H * 0.7, y + H + 0.45, 0.97);
    segBox(G, 'dressed', F, 0, F.L, w0 - 0.05, w1 + 0.05, y + H * 0.7, y + H * 0.7 + 0.08, 1.05);
  }
  return o.G ? G : G.build(o.name || 'parapet', { ground: y });
}

// ---------------------------------------------------------------- gates
/** A local frame placed at (x, z) with heading rot: at(lx, lz) → world [x, z] (lx along rot, lz = its right). */
export function localFrame(x, z, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { t: [c, s], n: [-s, c], L: 0, rot, at: (u, w) => [x + c * u - s * w, z + s * u + c * w] };
}

/**
 * Intrados height of an arch at offset u from its axis: half-span a, spring y0, rise r. r >= a: two-centred pointed
 * arch (centres on the springing line at ∓c); r < a: segmental arch.
 */
export const archY = (u, a, y0, r) => {
  const x = Math.min(Math.abs(u), a);
  if (r >= a) { const c = (r * r - a * a) / (2 * a), R = a + c; return y0 + Math.sqrt(Math.max(0, R * R - (x + c) ** 2)); }
  const R = (a * a + r * r) / (2 * r);
  return y0 + Math.sqrt(Math.max(0, R * R - x * x)) - (R - r);
};

/**
 * Arch head over a passage: masonry slices from the intrados to yTop through w0..w1 (depth), a dressed voussoir ring
 * on both faces, and the soffit. u0..u1 = the passage (centre uc).
 */
export function archHead(G, F, uc, half, w0, w1, spring, rise, yTop, mat = 'ashlar') {
  const n = Math.max(8, Math.round((half * 2) / 0.22)), du = (half * 2) / n;
  for (let i = 0; i < n; i++) {
    const u = -half + (i + 0.5) * du, y = Math.max(archY(u - du / 2, half, spring, rise), archY(u + du / 2, half, spring, rise));
    segBox(G, mat, F, uc + u - du / 2, uc + u + du / 2, w0, w1, y, yTop, 1);
  }
  // smooth soffit (covers the slices' stepped undersides) and a voussoir ring on both faces, following the curve
  const N = 24, P = (u, w, y) => { const [x, z] = F.at(uc + u, w); return [x, y, z]; };
  const flip = (F.t[0] * F.n[1] - F.t[1] * F.n[0]) < 0;
  const q = (mat2, a, b, c, d, tone) => (flip ? G.quad(mat2, d, c, b, a, tone) : G.quad(mat2, a, b, c, d, tone));
  for (let k = 0; k < N; k++) {
    const ua = -half + (2 * half * k) / N, ub = -half + (2 * half * (k + 1)) / N;
    const ya = archY(ua, half, spring, rise) - 0.02, yb = archY(ub, half, spring, rise) - 0.02;
    q('dressed', P(ua, w1, ya), P(ub, w1, yb), P(ub, w0, yb), P(ua, w0, ya), 0.85);       // soffit (faces down)
    const tone = k % 2 ? 1.06 : 0.96;
    for (const [w, s] of [[w1 + 0.06, 1], [w0 - 0.06, -1]]) {
      const A = P(ua, w, ya + 0.02), B = P(ub, w, yb + 0.02), C = P(ub, w, yb + 0.58), D = P(ua, w, ya + 0.58);
      if (s > 0) q('dressed', A, D, C, B, tone); else q('dressed', A, B, C, D, tone);
      const A0 = P(ua, w - s * 0.06, ya + 0.58), B0 = P(ub, w - s * 0.06, yb + 0.58);
      if (s > 0) q('dressed', D, A0, B0, C, tone); else q('dressed', D, C, B0, A0, tone);   // the ring's top edge
    }
  }
  segBox(G, 'dressed', F, uc - half - 0.35, uc - half, w0 - 0.08, w1 + 0.08, spring - 0.25, spring, 1.05); // imposts
  segBox(G, 'dressed', F, uc + half, uc + half + 0.35, w0 - 0.08, w1 + 0.08, spring - 0.25, spring, 1.05);
}

/** Raised portcullis in the arch (oak grid shod with iron), bottom at yb, inside the passage at depth w. */
export function portcullis(G, F, uc, half, w, yb, yTop) {
  const ybf = typeof yb === 'function' ? yb : () => yb;
  let lo = Infinity;
  for (let u = -half + 0.2; u <= half - 0.15; u += 0.32) {
    const b = ybf(u); lo = Math.min(lo, b);
    segBox(G, 'timber', F, uc + u - 0.06, uc + u + 0.06, w - 0.06, w + 0.06, b, yTop, 0.75);
    segBox(G, 'iron', F, uc + u - 0.05, uc + u + 0.05, w - 0.05, w + 0.05, b - 0.25, b, 0.4);
  }
  for (let y = lo + 0.3; y < yTop; y += 0.42) {
    let a = -half + 0.1, b = half - 0.1;
    while (a < b && ybf(a) > y) a += 0.05;
    while (b > a && ybf(b) > y) b -= 0.05;
    if (b - a > 0.2) segBox(G, 'timber', F, uc + a, uc + b, w - 0.09, w - 0.03, y, y + 0.09, 0.7);
  }
}

/** Iron bracket lantern on a wall face (local u, w = face, y). */
export function wallLantern(G, F, u, w, y) {
  segBox(G, 'iron', F, u - 0.03, u + 0.03, w, w + 0.45, y + 0.35, y + 0.4, 0.5);
  const [x, z] = F.at(u, w + 0.42);
  G.cyl('iron', x, y - 0.1, z, 0.12, 0.16, 0.42, 6, 0.5);
  G.cyl('dressed', x, y - 0.06, z, 0.11, 0.11, 0.32, 6, 1.6, { caps: false });
  G.cyl('iron', x, y + 0.32, z, 0.2, 0.02, 0.18, 6, 0.5);
}

/** Crenellated parapet on corbels along local u0..u1 at the face w (outward sign `dir`), walk level y. */
export function corbelParapet(G, F, u0, u1, w, dir, y, R = Math.random) {
  const wi = w - dir * 0.4, wo = w + dir * 0.32, lo = Math.min(wi, wo), hi = Math.max(wi, wo);
  for (let u = u0 + 0.4; u < u1 - 0.2; u += 1.0) segBox(G, 'dressed', F, u - 0.15, u + 0.15, Math.min(w, w + dir * 0.32), Math.max(w, w + dir * 0.32), y - 0.7, y - 0.05, 0.95);
  segBox(G, 'ashlar', F, u0, u1, lo, hi, y - 0.08, y + 1.0, 0.98);
  segBox(G, 'dressed', F, u0, u1, lo - 0.05, hi + 0.05, y + 1.0, y + 1.1, 1.05);
  for (let u = u0 + 0.15; u + 1.2 < u1 + 0.01; u += 1.95) {
    segBox(G, 'ashlar', F, u, u + 1.2, lo, hi, y + 1.1, y + 1.9, 0.94 + R() * 0.1);
    segBox(G, 'dressed', F, u - 0.03, u + 1.23, lo - 0.04, hi + 0.04, y + 1.9, y + 2.0, 1.04);
  }
}

/**
 * Twin-tower gatehouse (SW / SE gates): two square towers with battered bases, walkable crenellated tops at walkY,
 * corbelled slate-coned tourelles on the outer corners, a pointed arch with a raised portcullis and open oak leaves,
 * an escutcheon panel, lanterns. Local frame: u along `rot` (the wall), w outward (+, the bridge side).
 * o: {x, z, rot, w=12, d=8, walkY=7, passage=4.5, seed}
 */
export function buildTwinGatehouse(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), F = localFrame(o.x, o.z, o.rot ?? 0), R = G.R;
  const W2 = (o.w ?? 12) / 2, D2 = (o.d ?? 8) / 2, Y = o.walkY ?? 7, P2 = (o.passage ?? 4.5) / 2;
  const spring = 3.4, rise = 2.4;
  for (const s of [-1, 1]) {
    const ua = s < 0 ? -W2 : P2, ub = s < 0 ? -P2 : W2, uo = s * W2;
    segBox(G, 'ashlar', F, ua, ub, -D2, D2, -1.6, Y - 0.02, 1);
    segBox(G, 'flags', F, ua, ub, -D2, D2, Y - 0.02, Y, 1);
    segBox(G, 'rubble', F, ua, ub, D2 - 0.02, D2 + 0.02, -1.6, 2.2, 0.95, { taperOut: 0.9 });
    segBox(G, 'dressed', F, ua, ub, D2 - 0.04, D2 + 0.16, 2.15, 2.4, 1.02);
    segBox(G, 'dressed', F, ua, ub, -D2 - 0.12, D2 + 0.12, Y - 1.5, Y - 1.3, 1.02);       // string course (both faces)
    corbelParapet(G, F, ua, ub, D2, 1, Y, R);                                            // outer face
    // the outer side face (perpendicular): a local frame turned 90°
    const Fs = { ...F, t: F.n.map((v) => v), n: F.t.map((v) => v * s), at: (u, w) => F.at(uo + s * w, u) };
    corbelParapet(G, Fs, -D2, D2, 0, 1, Y, R);
    bartizan(G, ...F.at(uo + s * 0.15, D2 + 0.15), Y, 1.25);
    // cross loops on the outer face, a mullioned window on the inner face
    const um = (ua + ub) / 2;
    segBox(G, 'iron', F, um - 0.08, um + 0.08, D2, D2 + 0.02, 3.4, 5.0, 0.1);
    segBox(G, 'iron', F, um - 0.4, um + 0.4, D2, D2 + 0.02, 4.1, 4.25, 0.1);
    segBox(G, 'iron', F, um - 0.45, um + 0.45, -D2 - 0.02, -D2, 3.2, 4.4, 0.15);
    segBox(G, 'dressed', F, um - 0.06, um + 0.06, -D2 - 0.06, -D2, 3.2, 4.4, 1.05);
    segBox(G, 'dressed', F, um - 0.6, um + 0.6, -D2 - 0.1, -D2, 3.05, 3.2, 1.05);
    segBox(G, 'dressed', F, um - 0.6, um + 0.6, -D2 - 0.1, -D2, 4.4, 4.6, 1.05);
    // the open oak leaves, swung back against the passage walls
    segBox(G, 'planks', F, s * (P2 - 0.16), s * (P2 - 0.04), -2.6, -0.3, 0.05, spring + 0.6, 0.85);
    wallLantern(G, F, s * (P2 + 0.75), D2, 3.6);
  }
  archHead(G, F, 0, P2, -D2, D2, spring, rise, Y - 0.02);
  segBox(G, 'flags', F, -P2, P2, -D2, D2, Y - 0.02, Y, 1);
  corbelParapet(G, F, -P2, P2, D2, 1, Y, R);
  portcullis(G, F, 0, P2, D2 - 1.1, (u) => archY(u, P2, spring, rise) - 0.35, Y - 1.2);
  segBox(G, 'dressed', F, -0.7, 0.7, D2 + 0.02, D2 + 0.14, Y - 1.25, Y - 0.35, 1.08);                     // escutcheon panel
  segBox(G, 'setts', F, -P2, P2, -D2 - 0.3, D2 + 0.3, -0.04, 0.03, 1);
  return G.build(o.name || 'gatehouse', { ground: 0 });
}

// ---------------------------------------------------------------- towers, ranges, small buildings
/**
 * Round tower from y0 to a crenellated deck at deckY (walkable top), string courses, cross loops, a door at the
 * base, a machicolated ring under the parapet. o: {x, z, r, y0, deckY, door: heading|null, roof: false|'cone', seed}
 */
export function buildRoundTower(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), R = G.R, r = o.r ?? 2.5, y0 = o.y0 ?? 0, Y = o.deckY, seg = 22;
  const x = o.x, z = o.z;
  G.cyl('rubble', x, y0 - 0.5, z, r + 0.35, r, 1.4, seg, 0.95, { caps: false });                  // battered foot
  G.cyl('ashlar', x, y0 - 0.5, z, r, r, Y - y0 - 0.6, seg, 1, { caps: false });
  for (const yy of [y0 + (Y - y0) * 0.38, y0 + (Y - y0) * 0.72]) G.cyl('dressed', x, yy, z, r + 0.1, r + 0.1, 0.2, seg, 1.04);
  // machicolation ring: corbels, then the projecting parapet drum with merlons
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    G.box('dressed', x + Math.cos(a) * (r + 0.15), Y - 0.75, z + Math.sin(a) * (r + 0.15), 0.32, 0.65, 0.3, a + Math.PI / 2, 0.95, 0.25);
  }
  G.cyl('ashlar', x, Y - 1.1, z, r + 0.35, r + 0.35, 1.1, seg, 1, { caps: false });
  G.cyl('flags', x, Y - 0.05, z, r + 0.35, r + 0.35, 0.05, seg, 1);
  // parapet: a solid ring (the deck stays open to the sky — a full coping disc used to roof the sentry), coping, merlons
  G.ring('ashlar', x, Y, z, r - 0.05, r + 0.35, 1.0, seg, 1);
  G.ring('dressed', x, Y + 1.0, z, r - 0.1, r + 0.42, 0.1, seg, 1.05);
  for (let k = 0; k < 10; k++) {
    const a0 = (k / 10) * Math.PI * 2;
    G.ring('ashlar', x, Y + 1.1, z, r - 0.05, r + 0.35, 0.8, 4, 0.95 + R() * 0.08, { a0, arc: (Math.PI * 2) / 10 * 0.55 });
  }
  // cross loops round the shaft, a door at the base
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3, yy = y0 + 2.5 + (k % 3) * (Y - y0 - 4) / 3;
    G.box('iron', x + Math.cos(a) * (r + 0.01), yy + 0.7, z + Math.sin(a) * (r + 0.01), 0.04, 1.4, 0.16, a + Math.PI / 2, 0.1);
  }
  if (o.door != null) {
    const a = o.door, F = localFrame(x + Math.cos(a) * r, z + Math.sin(a) * r, a + Math.PI / 2);
    segBox(G, 'planks', F, -0.5, 0.5, -0.05, 0.06, y0, y0 + 2.0, 0.7);
    archHead(G, F, 0, 0.55, -0.12, 0.08, y0 + 2.0, 0.3, y0 + 2.6);
  }
  if (o.roof === 'cone') G.cyl('slate', x, Y + 1.0, z, r + 0.6, 0.02, r * 2.2, seg, 1);
  return G.build(o.name || 'tower', { ground: y0 });
}

/**
 * Castle range: a long ashlar block (flat walkable roof at h, parapet on the open side) with two storeys of
 * stone-mullioned windows, doors with segmental heads, buttresses. Local frame u along rot, w outward (+ = facade).
 * o: {x, z, rot, w, d, h, y0, facade: 'S'|..., seed}
 */
export function buildRange(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), F = localFrame(o.x, o.z, o.rot ?? 0), R = G.R;
  const W2 = o.w / 2, D2 = o.d / 2, H = o.h, y0 = o.y0 ?? 0;
  const top = H - 0.04;                                    // roofed: false → the level drawn over it is its roof
  segBox(G, 'ashlar', F, -W2, W2, -D2, D2, y0 - 0.3, top, 1);
  // plinth and string course run only along the open facade (outside the buried spans)
  const open = [[-W2, W2]];
  for (const [a, b] of (o.hidden || []).map(([a, b]) => [a - 0.2, b + 0.2])) {
    for (let k = open.length - 1; k >= 0; k--) {
      const [c, d] = open[k];
      if (b <= c || a >= d) continue;
      open.splice(k, 1, ...[[c, a], [b, d]].filter(([x0, x1]) => x1 - x0 > 0.3));
    }
  }
  for (const [a, b] of open) {
    segBox(G, 'rubble', F, a, b, D2 - 0.02, D2 + 0.25, y0 - 0.3, y0 + 0.8, 0.92);
    segBox(G, 'dressed', F, a, b, D2 - 0.02, D2 + 0.12, y0 + (H - y0) * 0.45, y0 + (H - y0) * 0.45 + 0.18, 1.03);
  }
  segBox(G, 'dressed', F, -W2 - 0.05, W2 + 0.05, -D2 - 0.05, D2 + 0.12, top - 0.33, top, 1.05);           // cornice
  if (o.roofed !== false) segBox(G, 'flags', F, -W2, W2, -D2, D2, H - 0.02, H, 1);
  const bay = 4.2, nb = Math.max(1, Math.floor((2 * W2 - 1) / bay)), u0 = -(nb * bay) / 2;
  // facade spans buried by an abutting terrace (o.hidden: [[u0, u1, yTop]]): no openings / buttresses below its top
  const buried = (u, y) => (o.hidden || []).some(([a, b, t]) => u > a - 0.8 && u < b + 0.8 && y < t + 0.3);
  for (let i = 0; i < nb; i++) {
    const uc = u0 + (i + 0.5) * bay;
    if (i > 0 && !buried(u0 + i * bay, y0)) segBox(G, 'ashlar', F, u0 + i * bay - 0.35, u0 + i * bay + 0.35, D2, D2 + 0.45, y0 - 0.3, y0 + (H - y0) * 0.8, 0.96, { taperOut: 0.15 });
    for (const [yb, hh] of [[y0 + 1.1, 1.5], [y0 + (H - y0) * 0.45 + 0.9, 1.6]]) {
      if (yb + hh > H - 0.6 || buried(uc, yb + hh)) continue;
      const door = i % 4 === 1 && yb < y0 + 2;
      const ww = door ? 1.3 : 1.1, b0 = door ? y0 : yb, b1 = door ? y0 + 2.4 : yb + hh;
      segBox(G, door ? 'planks' : 'iron', F, uc - ww / 2, uc + ww / 2, D2 - 0.02, D2 + 0.0, b0, b1, door ? 0.75 : 0.12);
      segBox(G, 'dressed', F, uc - ww / 2 - 0.16, uc - ww / 2, D2, D2 + 0.08, b0, b1, 1.05);
      segBox(G, 'dressed', F, uc + ww / 2, uc + ww / 2 + 0.16, D2, D2 + 0.08, b0, b1, 1.05);
      segBox(G, 'dressed', F, uc - ww / 2 - 0.2, uc + ww / 2 + 0.2, D2, D2 + 0.1, b1, b1 + 0.28, 1.07);
      if (!door) {
        segBox(G, 'dressed', F, uc - 0.05, uc + 0.05, D2, D2 + 0.06, b0, b1, 1.05);                      // mullion
        segBox(G, 'dressed', F, uc - ww / 2, uc + ww / 2, D2, D2 + 0.06, b0 + hh * 0.62, b0 + hh * 0.62 + 0.08, 1.05);
        segBox(G, 'dressed', F, uc - ww / 2 - 0.25, uc + ww / 2 + 0.25, D2, D2 + 0.16, b0 - 0.15, b0, 1.0);  // sill
        if (R() < 0.4) segBox(G, 'iron', F, uc - ww / 2, uc + ww / 2, D2 + 0.02, D2 + 0.05, b0 + 0.1, b0 + hh * 0.6, 0.35); // grille
      }
    }
  }
  return G.build(o.name || 'range', { ground: y0 });
}

/** Hipped roof over local rect u0..u1 × w0..w1 from eave y to ridge y + rh (ridge along u; pyramid when square). */
export function hipRoof(G, F, u0, u1, w0, w1, y, rh, mat = 'slate', oh = 0.35) {
  u0 -= oh; u1 += oh; w0 -= oh; w1 += oh;
  const hw = (w1 - w0) / 2, hu = (u1 - u0) / 2, inset = Math.min(hw, hu), wm = (w0 + w1) / 2;
  const P = (u, w, yy) => { const [x, z] = F.at(u, w); return [x, yy, z]; };
  const r0 = P(u0 + inset, wm, y + rh), r1 = P(u1 - inset, wm, y + rh);
  const A = P(u0, w0, y), B = P(u1, w0, y), C = P(u1, w1, y), D = P(u0, w1, y);
  const flip = (F.t[0] * F.n[1] - F.t[1] * F.n[0]) < 0;
  const q = (a, b, c, d) => (flip ? G.quad(mat, a, b, c, d) : G.quad(mat, d, c, b, a));
  const t = (a, b, c) => (flip ? G.tri(mat, a, b, c) : G.tri(mat, c, b, a));
  q(A, B, r1, r0); q(C, D, r0, r1); t(B, C, r1); t(D, A, r0);
  // eave fascia
  segBox(G, 'timber', F, u0, u1, w0, w0 + 0.12, y - 0.22, y, 0.7); segBox(G, 'timber', F, u0, u1, w1 - 0.12, w1, y - 0.22, y, 0.7);
}

/** Stone stair tower / stair block: ashlar body, hipped slate roof, an arched door, stepped stair lights. */
export function buildStairTower(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), F = localFrame(o.x, o.z, o.rot ?? 0);
  const W2 = o.w / 2, D2 = o.d / 2, y0 = o.y0 ?? 0, H = y0 + o.h, doorW = o.doorSide ?? D2;
  segBox(G, 'ashlar', F, -W2, W2, -D2, D2, y0 - 0.3, H, 1);
  segBox(G, 'rubble', F, -W2 - 0.12, W2 + 0.12, -D2 - 0.12, D2 + 0.12, y0 - 0.3, y0 + 0.5, 0.92);
  segBox(G, 'dressed', F, -W2 - 0.08, W2 + 0.08, -D2 - 0.08, D2 + 0.08, H - 0.3, H, 1.05);
  hipRoof(G, F, -W2, W2, -D2, D2, H, Math.min(o.w, o.d) * 0.55, 'slate', 0.3);
  const s = Math.sign(doorW) || 1, wf = s * D2;
  segBox(G, 'planks', F, (o.doorU ?? 0) - 0.55, (o.doorU ?? 0) + 0.55, wf - 0.02 * s, wf + 0.01 * s, y0, y0 + 2.1, 0.7);
  archHead(G, { ...F, at: (u, w) => F.at(u, w * s), n: F.n.map((v) => v * s) }, o.doorU ?? 0, 0.6, D2 - 0.1, D2 + 0.08, y0 + 2.1, 0.35, y0 + 2.75);
  for (let k = 0; k < Math.floor((H - y0 - 2) / 2.6); k++) {
    const u = -W2 + 1.2 + k * ((2 * W2 - 2.4) / Math.max(1, Math.floor((H - y0 - 2) / 2.6) - 1 || 1)), yy = y0 + 3.2 + k * 2.6;
    segBox(G, 'iron', F, u - 0.12, u + 0.12, wf - 0.01 * s, wf + 0.01 * s, yy, yy + 0.9, 0.12);
    segBox(G, 'dressed', F, u - 0.25, u + 0.25, Math.min(wf, wf + 0.08 * s), Math.max(wf, wf + 0.08 * s), yy - 0.12, yy, 1.05);
  }
  return G.build(o.name || 'stairtower', { ground: y0 });
}

/**
 * Inner gatehouse: a vaulted tunnel (u = 0 axis along w) with arched portals on both faces and a raised portcullis
 * on the outer (+w) face, a gate hall over it under a hipped slate roof, and a square tower on one side with a
 * pyramid roof. o: {x, z, rot, tunnel: [u0, u1], hallTop, tower: [u0, u1], towerTop, d, seed}
 */
export function buildInnerGate(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), F = localFrame(o.x, o.z, o.rot ?? 0), R = G.R;
  const [t0, t1] = o.tunnel, D2 = o.d / 2, uc = (t0 + t1) / 2, half = (t1 - t0) / 2 - 0.05;
  const spring = 2.9, rise = Math.min(half, 1.6), hall = o.hallTop ?? 7.2;
  segBox(G, 'ashlar', F, t0 - 0.6, t0, -D2, D2, -0.2, hall, 1);                    // tunnel side walls
  segBox(G, 'ashlar', F, t1, t1 + 0.4, -D2, D2, -0.2, hall, 1);
  archHead(G, F, uc, half, -D2, D2, spring, rise, hall);
  segBox(G, 'dressed', F, t0 - 0.7, t1 + 0.5, -D2 - 0.1, D2 + 0.1, hall - 0.25, hall, 1.05);
  hipRoof(G, F, t0 - 0.6, t1 + 0.4, -D2, D2, hall, 2.6, 'slate', 0.35);
  portcullis(G, F, uc, half, D2 - 0.6, (u) => archY(u, half, spring, rise) - 0.3, hall - 1.2);
  segBox(G, 'dressed', F, uc - 0.6, uc + 0.6, D2, D2 + 0.12, spring + rise + 0.5, spring + rise + 1.3, 1.08);
  for (const s of [-1, 1]) {                                                      // hall windows on both faces
    for (const du of [-1.4, 1.4]) segBox(G, 'iron', F, uc + du - 0.3, uc + du + 0.3, s * D2 - 0.01, s * D2 + 0.01, hall - 2.0, hall - 0.9, 0.12);
    wallLantern(G, { ...F, at: (u, w) => F.at(u, w * s), n: F.n.map((v) => v * s) }, t0 - 0.3, D2, 2.6);
  }
  if (o.tower) {
    const [a, b] = o.tower, top = o.towerTop ?? hall + 1.8;
    segBox(G, 'ashlar', F, a, b, -D2 - 0.3, D2 + 0.3, -0.2, top, 1);
    segBox(G, 'rubble', F, a - 0.15, b + 0.15, -D2 - 0.45, D2 + 0.45, -0.2, 0.7, 0.92);
    segBox(G, 'dressed', F, a - 0.1, b + 0.1, -D2 - 0.4, D2 + 0.4, top - 0.3, top, 1.05);
    hipRoof(G, F, a, b, -D2 - 0.3, D2 + 0.3, top, (b - a) * 0.9, 'slate', 0.35);
    for (const s of [-1, 1]) for (let yy = 2.6; yy < top - 2; yy += 2.8) segBox(G, 'iron', F, (a + b) / 2 - 0.1, (a + b) / 2 + 0.1, s * (D2 + 0.3) - 0.01, s * (D2 + 0.3) + 0.01, yy, yy + 1.2, 0.1 + R() * 0.05);
  }
  segBox(G, 'setts', F, t0, t1, -D2 - 0.2, D2 + 0.2, -0.04, 0.03, 1);
  return G.build(o.name || 'innergate', { ground: 0 });
}

// ---------------------------------------------------------------- bridges, water gate, small structures
/**
 * Timber moat bridge: a plank deck on stringers over two braced trestle bents, rubble abutments, railings with
 * braces, optional stone lantern pillars at the outer (+u) end. o: {x, z, rot, w (length), d (width), deckY=0,
 * water=-1.5, lanterns=false, seed}
 */
export function buildMoatBridge(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), F = localFrame(o.x, o.z, o.rot ?? 0), R = G.R;
  const L2 = o.w / 2, D2 = o.d / 2, y = o.deckY ?? 0, wy = o.water ?? -1.5;
  for (let u = -L2 - 0.6; u < L2 + 0.6; u += 0.3) segBox(G, 'planks', F, u, u + 0.28, -D2, D2, y - 0.1, y + 0.04, 0.85 + R() * 0.25);
  for (const w of [-D2 + 0.3, -0.6, 0.6, D2 - 0.3]) segBox(G, 'timber', F, -L2 - 0.6, L2 + 0.6, w - 0.15, w + 0.15, y - 0.5, y - 0.1, 0.8);
  for (const ub of [-L2 / 3, L2 / 3]) {
    for (const w of [-D2 + 0.35, -0.8, 0.8, D2 - 0.35]) segBox(G, 'timber', F, ub - 0.15, ub + 0.15, w - 0.15, w + 0.15, wy - 1.5, y - 0.5, 0.75);
    segBox(G, 'timber', F, ub - 0.18, ub + 0.18, -D2, D2, y - 0.75, y - 0.5, 0.75);
    segBox(G, 'timber', F, ub - 0.1, ub + 0.1, -D2 + 0.3, D2 - 0.3, wy + 0.3, wy + 0.55, 0.7);
  }
  for (const s of [-1, 1]) segBox(G, 'rubble', F, s > 0 ? L2 - 0.4 : -L2 - 1.4, s > 0 ? L2 + 1.4 : -L2 + 0.4, -D2 - 0.4, D2 + 0.4, wy - 1.2, y - 0.12, 0.9);
  for (const s of [-1, 1]) {
    const w = s * (D2 - 0.08);
    for (let u = -L2; u <= L2 + 0.01; u += L2 / 3) segBox(G, 'timber', F, u - 0.09, u + 0.09, w - 0.09, w + 0.09, y, y + 1.15, 0.8);
    segBox(G, 'timber', F, -L2, L2, w - 0.07, w + 0.07, y + 1.05, y + 1.2, 0.85);
    segBox(G, 'timber', F, -L2, L2, w - 0.05, w + 0.05, y + 0.55, y + 0.65, 0.8);
    if (o.lanterns) {
      const [px, pz] = F.at(L2 + 0.8, s * (D2 + 0.95)); // clear of a tank's turret overhang on the deck
      G.box('ashlar', px, y + 1.0, pz, 0.8, 2.4, 0.8, F.rot, 1);
      G.box('dressed', px, y + 2.25, pz, 0.95, 0.15, 0.95, F.rot, 1.05);
      G.cyl('iron', px, y + 2.33, pz, 0.08, 0.06, 0.25, 6, 0.5);
      G.cyl('iron', px, y + 2.55, pz, 0.16, 0.2, 0.45, 6, 0.5);
      G.cyl('dressed', px, y + 2.6, pz, 0.15, 0.15, 0.35, 6, 1.7, { caps: false });
      G.cyl('iron', px, y + 3.0, pz, 0.26, 0.02, 0.22, 6, 0.5);
    }
  }
  return G.build(o.name || 'bridge', { ground: y });
}

/**
 * Grated water gate: a masonry block over a channel (full wall depth, up to `top`, closing the curtain gap) pierced
 * by a low arch, an iron grating in it at depth `grateW`, a flagged walk on top. Local u across the channel.
 * o: {x, z, rot, w (channel), d (wall depth), top=7, water=-1.5, grateW=0, seed}
 */
export function buildWaterGate(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), F = localFrame(o.x, o.z, o.rot ?? 0);
  const H2 = o.w / 2, wy = o.water ?? -1.5, D2 = (o.d ?? 0.6) / 2, top = o.top ?? 2.4, gw = o.grateW ?? 0, rise = Math.min(H2, 1.0);
  archHead(G, F, 0, H2, -D2, D2, 0.3, rise, top - 0.02);
  segBox(G, 'flags', F, -H2, H2, -D2, D2, top - 0.02, top, 1);
  const Gg = new Geo(`${o.seed}:grate`);  // the grating: its own mesh group 'grate' (raised when the lever opens it)
  for (let u = -H2 + 0.15; u < H2; u += 0.22) segBox(Gg, 'iron', F, u - 0.03, u + 0.03, gw - 0.05, gw + 0.05, wy - 1, archY(u, H2, 0.3, rise) + 2.2, 0.45);
  for (let y = wy - 0.6; y < 1.0; y += 0.35) segBox(Gg, 'iron', F, -H2, H2, gw - 0.07, gw + 0.07, y, y + 0.06, 0.45);
  segBox(Gg, 'iron', F, -H2 - 0.1, H2 + 0.1, gw - 0.12, gw + 0.12, 1.0, 1.25, 0.4);
  const g = G.build(o.name || 'watergate', { ground: wy }), grate = Gg.build('grate', { ground: wy });
  g.add(grate);
  return g;
}

/**
 * Stone stair flight from a = {x, y, z} (bottom) to b (top): solid stepped masonry (dressed treads, ashlar body),
 * a low cheek wall with a stepped coping on the open sides. o: {width=1.8, cheeks=[-1, 1], seed}
 */
export function buildStairFlight(a, b, o = {}) {
  const G = o.G || new Geo(o.seed ?? `${a.x},${a.z}`), W = o.width ?? 1.8;
  const run = Math.hypot(b.x - a.x, b.z - a.z), rise = b.y - a.y, n = Math.max(2, Math.ceil(Math.abs(rise) / 0.2));
  const F = segFrame([a.x, a.z], [b.x, b.z], null), tr = run / n, y0 = Math.min(a.y, b.y) - 0.15;
  for (let i = 0; i < n; i++) {
    const top = a.y + (rise * (i + 1)) / n, u0 = i * tr, u1 = run + 0.02;
    segBox(G, 'ashlar', F, u0, Math.min(u1, u0 + tr + 0.02), -W / 2, W / 2, y0, top - 0.06, 1);
    segBox(G, 'dressed', F, u0 - 0.04, u0 + tr + 0.02, -W / 2, W / 2, top - 0.06, top, 0.95 + ((i * 7) % 5) * 0.03);
    for (const s of o.cheeks ?? [-1, 1]) {
      const w0 = s < 0 ? -W / 2 - 0.3 : W / 2, w1 = s < 0 ? -W / 2 : W / 2 + 0.3;
      segBox(G, 'ashlar', F, u0, u0 + tr + 0.02, w0, w1, y0, top + 0.55, 0.97);
      segBox(G, 'dressed', F, u0 - 0.02, u0 + tr + 0.04, w0 - 0.04, w1 + 0.04, top + 0.55, top + 0.65, 1.05);
    }
  }
  return o.G ? G : G.build(o.name || 'stairs', { ground: y0 });
}

/** Timber ladder from a to b (stiles + rungs every 0.3 m). */
export function buildLadder(a, b, o = {}) {
  const G = o.G || new Geo(o.seed ?? `${a.x},${a.z}`);
  const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), n = Math.floor(L / 0.3);
  const h = o.heading ?? Math.atan2(b.z - a.z, b.x - a.x), px = -Math.sin(h), pz = Math.cos(h);
  for (const s of [-0.23, 0.23]) {
    const A = [a.x + px * s, a.y, a.z + pz * s], B = [b.x + px * s, b.y + 0.9, b.z + pz * s];
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], len = Math.hypot(dx, dy, dz);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...A), new THREE.Vector3(...B), new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m), v = new THREE.Vector3();
    const corner = (x, y, z) => { v.set(x, y, -z).applyQuaternion(q); return [A[0] + v.x, A[1] + v.y, A[2] + v.z]; };
    const c = 0.035;
    G.hexa('timber', [corner(-c, -c, 0), corner(-c, c, 0), corner(c, c, 0), corner(c, -c, 0), corner(-c, -c, len), corner(-c, c, len), corner(c, c, len), corner(c, -c, len)], 0.8);
  }
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1), x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
    G.box('timber', x, y, z, 0.05, 0.05, 0.46, h, 0.75);
  }
  return o.G ? G : G.build(o.name || 'ladder', { ground: a.y });
}

/**
 * Frame on a face of a local box (half sizes W2 along u, D2 along w): at(u, w) = along the face, w out of it.
 * face: 'S' (+w side), 'N', 'E' (+u side), 'W'.
 */
export function faceFrame(F, face, W2, D2) {
  const neg = (v) => v.map((x) => -x);
  if (face === 'S') return { t: F.t, n: F.n, at: (u, w) => F.at(u, D2 + w) };
  if (face === 'N') return { t: neg(F.t), n: neg(F.n), at: (u, w) => F.at(-u, -(D2 + w)) };
  if (face === 'E') return { t: F.n, n: F.t, at: (u, w) => F.at(W2 + w, u) };
  return { t: F.n, n: neg(F.t), at: (u, w) => F.at(-(W2 + w), u) };
}

/**
 * Plain stone wing / house block: ashlar walls on a rubble plinth, string course, cornice, hipped slate roof,
 * rows of stone-framed windows on the faces listed in `faces` ('S','N','E','W' in the local frame: S = +w).
 * o: {x, z, rot, w, d, h, y0, faces=['S'], floors=2, seed}
 */
export function buildWing(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), F = localFrame(o.x, o.z, o.rot ?? 0);
  const W2 = o.w / 2, D2 = o.d / 2, y0 = o.y0 ?? 0, H = y0 + o.h, fl = o.floors ?? 2, fh = (o.h - 0.6) / fl;
  segBox(G, 'ashlar', F, -W2, W2, -D2, D2, y0 - 0.3, H, 1);
  segBox(G, 'rubble', F, -W2 - 0.1, W2 + 0.1, -D2 - 0.1, D2 + 0.1, y0 - 0.3, y0 + 0.6, 0.92);
  segBox(G, 'dressed', F, -W2 - 0.1, W2 + 0.1, -D2 - 0.1, D2 + 0.1, H - 0.35, H, 1.05);
  for (let k = 1; k < fl; k++) segBox(G, 'dressed', F, -W2 - 0.06, W2 + 0.06, -D2 - 0.06, D2 + 0.06, y0 + 0.6 + k * fh - 0.1, y0 + 0.6 + k * fh + 0.08, 1.03);
  hipRoof(G, F, -W2, W2, -D2, D2, H, Math.min(o.w, o.d) * 0.5, 'slate', 0.4);
  for (const f of o.faces || ['S']) {
    const Ff = faceFrame(F, f, W2, D2), len = /[SN]/.test(f) ? 2 * W2 : 2 * D2, n = Math.max(1, Math.floor((len - 1) / 3));
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (i + 0.5) * (len / n);
      for (let k = 0; k < fl; k++) {
        const b0 = y0 + 0.6 + k * fh + 0.8, b1 = b0 + Math.min(1.7, fh - 1.2);
        segBox(G, 'iron', Ff, u - 0.5, u + 0.5, -0.01, 0.01, b0, b1, 0.14);
        segBox(G, 'dressed', Ff, u - 0.66, u - 0.5, 0, 0.08, b0, b1, 1.05);
        segBox(G, 'dressed', Ff, u + 0.5, u + 0.66, 0, 0.08, b0, b1, 1.05);
        segBox(G, 'dressed', Ff, u - 0.7, u + 0.7, 0, 0.12, b0 - 0.14, b0, 1.0);
        segBox(G, 'dressed', Ff, u - 0.7, u + 0.7, 0, 0.1, b1, b1 + 0.22, 1.06);
        segBox(G, 'dressed', Ff, u - 0.04, u + 0.04, 0, 0.05, b0, b1, 1.05);
      }
    }
  }
  return G.build(o.name || 'wing', { ground: y0 });
}

/** Plank privy: board walls, a mono-pitch shingle roof, a door with a cut-out heart, a stone step. */
export function buildOuthouse(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), F = localFrame(o.x, o.z, o.rot ?? 0), W2 = (o.w ?? 1.4) / 2, D2 = (o.d ?? 1.4) / 2;
  for (const f of ['S', 'N', 'E', 'W']) {
    const Ff = faceFrame(F, f, W2, D2), len = /[SN]/.test(f) ? 2 * W2 : 2 * D2;
    for (let u = -len / 2; u < len / 2 - 0.01; u += 0.2) segBox(G, 'boards', Ff, u, u + 0.19, -0.06, 0, 0, f === 'N' ? 2.05 : 2.35, 0.8 + ((u * 13) % 1) * 0.15);
  }
  segBox(G, 'planks', F, -W2 + 0.15, W2 - 0.15, D2, D2 + 0.04, 0.05, 2.0, 0.65);               // door leaf
  segBox(G, 'iron', F, -0.08, 0.08, D2 + 0.04, D2 + 0.05, 1.6, 1.75, 0.08);                     // the heart
  segBox(G, 'rubble', F, -0.45, 0.45, D2, D2 + 0.45, -0.05, 0.15, 0.9);
  const P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
  G.hexa('boards', [P(-W2 - 0.2, -D2 - 0.25, 2.05), P(-W2 - 0.2, D2 + 0.3, 2.4), P(W2 + 0.2, D2 + 0.3, 2.4), P(W2 + 0.2, -D2 - 0.25, 2.05),
    P(-W2 - 0.2, -D2 - 0.25, 2.12), P(-W2 - 0.2, D2 + 0.3, 2.47), P(W2 + 0.2, D2 + 0.3, 2.47), P(W2 + 0.2, -D2 - 0.25, 2.12)], 0.6, { bottom: true });
  return G.build(o.name || 'outhouse', { ground: 0 });
}

/** Open shed on posts (the range's covered firing bench): shingle roof, a plank bench and a shooting table. */
export function buildOpenShed(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), F = localFrame(o.x, o.z, o.rot ?? 0), W2 = o.w / 2, D2 = o.d / 2, H = o.h ?? 3;
  for (const u of [-W2 + 0.15, W2 - 0.15]) for (const w of [-D2 + 0.15, 0, D2 - 0.15]) segBox(G, 'timber', F, u - 0.1, u + 0.1, w - 0.1, w + 0.1, 0, H - 0.2, 0.8);
  for (const u of [-W2 + 0.15, W2 - 0.15]) segBox(G, 'timber', F, u - 0.1, u + 0.1, -D2, D2, H - 0.4, H - 0.15, 0.75);
  const P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
  G.hexa('boards', [P(-W2 - 0.4, -D2 - 0.3, H - 0.15), P(-W2 - 0.4, D2 + 0.3, H - 0.15), P(W2 + 0.4, D2 + 0.3, H + 0.45), P(W2 + 0.4, -D2 - 0.3, H + 0.45),
    P(-W2 - 0.4, -D2 - 0.3, H - 0.05), P(-W2 - 0.4, D2 + 0.3, H - 0.05), P(W2 + 0.4, D2 + 0.3, H + 0.55), P(W2 + 0.4, -D2 - 0.3, H + 0.55)], 0.62, { bottom: true });
  segBox(G, 'planks', F, -W2 + 0.4, -W2 + 1.2, -D2 + 0.4, D2 - 0.4, 0.75, 0.85, 0.8);         // shooting table
  for (const w of [-D2 + 0.6, D2 - 0.6]) segBox(G, 'timber', F, -W2 + 0.5, -W2 + 1.1, w - 0.05, w + 0.05, 0, 0.75, 0.75);
  segBox(G, 'planks', F, W2 - 1.0, W2 - 0.6, -D2 + 0.4, D2 - 0.4, 0.42, 0.5, 0.8);            // bench
  return G.build(o.name || 'shed', { ground: 0 });
}

/** Spoked wooden wheel (rim, felloes, 12 spokes, iron tyre, hub) at centre c, axis along `axis` (unit [x, z]). */
function spokedWheel(G, c, axis, R = 0.55, seg = 16) {
  const [ax, az] = axis, px = -az, pz = ax; // wheel plane spanned by (px, 0, pz) and y
  const P = (a, r, o) => [c[0] + px * Math.cos(a) * r + ax * o, c[1] + Math.sin(a) * r, c[2] + pz * Math.cos(a) * r + az * o];
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    for (const [r0, r1, mat] of [[R - 0.07, R, 'iron'], [R - 0.13, R - 0.07, 'timber']]) {
      G.quad(mat, P(a0, r1, -0.05), P(a1, r1, -0.05), P(a1, r1, 0.05), P(a0, r1, 0.05), 0.6);
      G.quad(mat, P(a0, r0, 0.05), P(a1, r0, 0.05), P(a1, r0, -0.05), P(a0, r0, -0.05), 0.6);
      G.quad(mat, P(a0, r0, 0.05), P(a0, r1, 0.05), P(a1, r1, 0.05), P(a1, r0, 0.05), 0.7);
      G.quad(mat, P(a1, r0, -0.05), P(a1, r1, -0.05), P(a0, r1, -0.05), P(a0, r0, -0.05), 0.7);
    }
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, m = P(a, (R - 0.13) / 2, 0);
    G.box('timber', m[0], m[1], m[2], 0.05, R - 0.15, 0.05, Math.atan2(pz, px), 0.7);
  }
  G.cyl('iron', c[0] - ax * 0.12, c[1] - 0.09, c[2] - az * 0.12, 0.09, 0.09, 0.18, 8, 0.5);
}

/**
 * Army horse-drawn field wagon (Hf.1-style): plank bed with side boards on two axles with spoked wheels, a canvas
 * hood on bows (covered_*), a drawbar with a swingletree. Local u along rot (the drawbar end +u). o: {x, z, rot, w, d,
 * h, covered, shells, seed}
 */
export function buildFieldWagon(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), F = localFrame(o.x, o.z, o.rot ?? 0);
  const L2 = (o.w ?? 5) / 2 * 0.86, W2 = (o.d ?? 2.5) / 2 * 0.72, bed = 1.05;
  segBox(G, 'planks', F, -L2, L2, -W2, W2, bed - 0.08, bed + 0.04, 0.8);
  for (const s of [-1, 1]) {
    segBox(G, 'planks', F, -L2, L2, s * W2 - 0.04, s * W2 + 0.04, bed, bed + 0.55, 0.75);
    for (let u = -L2 + 0.3; u < L2; u += 0.9) segBox(G, 'iron', F, u - 0.03, u + 0.03, s * W2 - 0.05, s * W2 + 0.05, bed, bed + 0.55, 0.45);
  }
  for (const s of [-1, 1]) segBox(G, 'planks', F, s * L2 - 0.04, s * L2 + 0.04, -W2, W2, bed, bed + 0.5, 0.75);
  for (const u of [-L2 * 0.62, L2 * 0.55]) {
    segBox(G, 'timber', F, u - 0.06, u + 0.06, -W2 - 0.2, W2 + 0.2, 0.52, 0.62, 0.6);
    for (const s of [-1, 1]) { const [x, z] = F.at(u, s * (W2 + 0.18)); spokedWheel(G, [x, 0.55, z], s > 0 ? F.n : F.n.map((v) => -v), 0.55); }
  }
  segBox(G, 'timber', F, L2, L2 + 2.2, -0.05, 0.05, 0.62, 0.72, 0.65);                         // drawbar
  segBox(G, 'timber', F, L2 + 1.9, L2 + 2.0, -0.6, 0.6, 0.6, 0.68, 0.65);
  if (o.covered) {
    const hoodTop = Math.max(bed + 0.9, (o.h ?? 2.5)), seg = 9;
    for (let k = 0; k < seg; k++) {
      const a0 = Math.PI * (k / seg), a1 = Math.PI * ((k + 1) / seg);
      const p = (a, u) => { const [x, z] = F.at(u, Math.cos(a) * W2 * 1.04); return [x, bed + 0.5 + Math.sin(a) * (hoodTop - bed - 0.5), z]; };
      G.quad('canvas', p(a0, -L2 * 0.92), p(a0, L2 * 0.92), p(a1, L2 * 0.92), p(a1, -L2 * 0.92), o.shells ? 0.78 : 0.95);
      G.quad('canvas', p(a1, -L2 * 0.92), p(a1, L2 * 0.92), p(a0, L2 * 0.92), p(a0, -L2 * 0.92), 0.5);
    }
  }
  return G.build(o.name || 'wagon', { ground: 0 });
}

/** Draw well: a rubble-stone curb with a dressed coping, a timber gallows with a winch roller, rope and bucket, a
 * little shingled roof. o: {x, z, r=0.9, rot, seed} */
export function buildWell(o) {
  const G = new Geo(o.seed ?? `${o.x},${o.z}`), r = o.r ?? 0.9, x = o.x, z = o.z, F = localFrame(x, z, o.rot ?? 0);
  G.cyl('rubble', x, -0.1, z, r, r, 0.95, 16, 0.95, { caps: false });
  G.cyl('rubble', x, -0.1, z, r - 0.25, r - 0.25, 0.95, 16, 0.6, { caps: false });
  G.cyl('dressed', x, 0.85, z, r + 0.05, r + 0.05, 0.12, 16, 1.05);
  G.cyl('iron', x, 0.6, z, r - 0.26, r - 0.26, 0.05, 16, 0.12);                                // dark water far below
  for (const s of [-1, 1]) segBox(G, 'timber', F, s * (r - 0.05) - 0.07, s * (r - 0.05) + 0.07, -0.07, 0.07, 0.8, 2.6, 0.75);
  segBox(G, 'timber', F, -r - 0.1, r + 0.1, -0.05, 0.05, 1.55, 1.65, 0.7);
  const [cx, cz] = F.at(0, 0);
  G.box('timber', cx, 1.6, cz, 2 * r - 0.2, 0.22, 0.22, F.rot, 0.8);                           // roller
  G.box('iron', ...F.at(r + 0.15, 0).flatMap((v, i) => (i ? [1.6, v] : [v])), 0.05, 0.35, 0.05, F.rot, 0.4); // crank
  G.cyl('iron', cx, 0.95, cz, 0.012, 0.012, 0.6, 4, 0.4);
  G.cyl('planks', cx, 0.7, cz, 0.15, 0.18, 0.28, 8, 0.7);                                       // bucket
  const P = (u, w, y) => { const [px, pz] = F.at(u, w); return [px, y, pz]; };
  for (const s of [-1, 1]) G.quad('boards', P(-r - 0.3, 0, 2.95), P(r + 0.3, 0, 2.95), P(r + 0.3, s * 0.85, 2.45), P(-r - 0.3, s * 0.85, 2.45), 0.7);
  for (const s of [-1, 1]) G.quad('boards', P(-r - 0.3, s * 0.85, 2.45), P(r + 0.3, s * 0.85, 2.45), P(r + 0.3, 0, 2.95), P(-r - 0.3, 0, 2.95), 0.5);
  return G.build(o.name || 'well', { ground: 0 });
}

/**
 * A masonry fire-water basin (Löschwasserbecken) over the axis-aligned rect {x, z (NW corner), w, d}: dark ashlar
 * inner walls from the coping down past the carved terrain, a dressed coping band, a flagged apron that covers the
 * terrain's carve slope, a dark silted floor (the water reads deep), an iron ladder and a marker board. `gaps`:
 * [[side, a, b]] spans left open (side 'N'|'S'|'E'|'W', a..b along it, e.g. the channel to the water gate).
 */
export function buildBasin(r, o = {}) {
  const G = new Geo(o.seed ?? 'basin'), apron = o.apron ?? 1.1, cop = 0.42, yb = -1.38, R = G.R;
  const x0 = r.x, z0 = r.z, x1 = r.x + r.w, z1 = r.z + r.d;
  // sides as CCW-outward segments (n = right of a→b points out of the basin)
  const sides = { N: [[x1, z0], [x0, z0]], W: [[x0, z0], [x0, z1]], S: [[x0, z1], [x1, z1]], E: [[x1, z1], [x1, z0]] };
  for (const [k, [a, b]] of Object.entries(sides)) {
    const F = segFrame(a, b, null), along = (q) => (q[0] - a[0]) * F.t[0] + (q[1] - a[1]) * F.t[1];
    let spans = [[0, F.L]];
    for (const [side, g0, g1] of o.gaps || []) {
      if (side !== k) continue;
      const u0 = Math.min(along(k === 'N' || k === 'S' ? [g0, a[1]] : [a[0], g0]), along(k === 'N' || k === 'S' ? [g1, a[1]] : [a[0], g1]));
      const u1 = Math.max(along(k === 'N' || k === 'S' ? [g0, a[1]] : [a[0], g0]), along(k === 'N' || k === 'S' ? [g1, a[1]] : [a[0], g1]));
      spans = spans.flatMap(([s0, s1]) => [[s0, Math.min(s1, u0)], [Math.max(s0, u1), s1]]).filter(([s0, s1]) => s1 - s0 > 0.05);
    }
    for (const [s0, s1] of spans) {
      segBox(G, 'ashlar', F, s0, s1, -0.02, cop, yb, 0.02, 0.58);                       // inner wall (wet, dark)
      segBox(G, 'moss', F, s0, s1, -0.035, -0.02, -0.32, -0.02, 0.45);                    // algae band at the waterline
      segBox(G, 'dressed', F, s0, s1, -0.06, cop, 0.02, 0.2, 1.0);                        // coping
      segBox(G, 'paving', F, s0, s1, cop, apron, yb, 0.07, 0.9 + R() * 0.08);             // apron over the carve slope
    }
  }
  for (const [cx, cz, sx, sz] of [[x0, z0, -1, -1], [x1, z0, 1, -1], [x1, z1, 1, 1], [x0, z1, -1, 1]]) {
    if ((o.noCorner || []).some(([qx, qz]) => Math.abs(qx - cx) < 0.01 && Math.abs(qz - cz) < 0.01)) continue;
    G.box('dressed', cx + sx * cop / 2, 0.11, cz + sz * cop / 2, cop + 0.06, 0.18, cop + 0.06, 0, 1.0);
    G.box('paving', cx + sx * apron / 2, (yb + 0.07) / 2, cz + sz * apron / 2, apron, 0.07 - yb, apron, 0, 0.92);
  }
  // iron ladder on the W wall, its stiles hooked over the coping
  const lz = z0 + r.d * 0.62;
  for (const dz of [-0.22, 0.22]) { G.box('iron', x0 + 0.06, -0.55, lz + dz, 0.05, 1.5, 0.05, 0, 0.5); G.box('iron', x0 + 0.03, 0.26, lz + dz, 0.14, 0.05, 0.05, 0, 0.5); }
  for (let y = -1.0; y < 0.1; y += 0.28) G.box('iron', x0 + 0.06, y, lz, 0.03, 0.03, 0.44, 0, 0.5);
  // marker board (white, red band) on a post at the NW corner of the apron
  if (o.board !== false) {
    const bx = x0 - apron + 0.25, bz = z0 - 0.2;
    G.box('timber', bx, 0.75, bz, 0.08, 1.5, 0.08, 0, 0.7);
    G.box('plaster', bx, 1.35, bz + 0.05, 0.7, 0.45, 0.03, 0, 1.3);
    G.box('signal', bx, 1.35, bz + 0.067, 0.7, 0.08, 0.005, 0, 1.0);
  }
  const g = G.build(o.name || 'basin', { ground: 0 });
  // the silted floor (green-brown, no frost: it is under water) — what the water shader refracts, so the basin reads deep
  const frost = FROST; FROST = 0;
  const Fl = new Geo(`${o.seed ?? 'basin'}:floor`);
  flatPoly(Fl, 'rubble', [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], -1.12, 0.3);
  for (let k = 0; k < Math.round(r.w * r.d / 6); k++) {
    const cx = x0 + 0.4 + Fl.R() * (r.w - 0.8), cz = z0 + 0.4 + Fl.R() * (r.d - 0.8), rr = 0.3 + Fl.R() * 0.5, ring = [];
    for (let j = 0; j < 7; j++) { const q = (j / 7) * Math.PI * 2; ring.push([cx + Math.cos(q) * rr * (0.7 + Fl.R() * 0.5), cz + Math.sin(q) * rr * (0.7 + Fl.R() * 0.5)]); }
    flatPoly(Fl, 'moss', ring, -1.11, 0.4 + Fl.R() * 0.2);
  }
  g.add(Fl.build('basin_floor', { ground: -1.2, moss: 0, shadow: false }));
  FROST = frost;
  return g;
}
