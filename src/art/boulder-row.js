/**
 * A row of snow-capped granite boulders (rocks variant `boulder_row`): part of M3's start cover, along the foot of its
 * ruined wall (user 2026-10-17: "Mission 3 starts with a wall of bricks that is too low. Can you replace it with a row
 * of boulders with some snow tall enough such thst commandos dont have to crawl right away to not be seen"; 10-21: "a
 * tower on the right side in ruins with a small wall with boulders" — art/ruin-tower.js).
 *
 * The def lists its boulders in its own frame (before `rot`, local +X → (cos rot, sin rot) as every prop):
 * `boulders: [[x, z, w, d, h, yawDeg, seed], …]` — the plan size w × d at its widest, the top h over the ground — and
 * `stones` (small rocks round their feet, [[x, z, size, seed], …]) and `drifts` (snow drifts, [[x, z, length, width,
 * height, yawDeg], …]). One seeded shape per boulder (boulderShape: a glacial erratic — a rounded block cut by joint
 * faces and a sheeting crack, a third of it in the ground) serves both builds:
 *  - the art (buildBoulderRow): granite with lichen, weathering and a wet foot in its vertex colours, a pillow of snow
 *    on its top and in its cracks, small stones round its foot and drifts against its lee side;
 *  - the gameplay (boulderRowNavParts → the structure's navParts, world/map-builder.js): per boulder its plan outline
 *    at body height (BODY_BAND: where a walker's body meets it) as B.LOW — it stops a walker and hides a crawler behind
 *    it — and, over it, its section at a guard's eye height (SIGHT_Y) as B.HIGH: wherever the rock stands that high it
 *    hides a standing man from a guard on the ground (§4.2 height sight; the def's h, the structure's sight height, is
 *    the lowest boulder's top). What you see is what blocks, in the browser and in the grid-only builds alike.
 * @module art/boulder-row
 */
import * as THREE from 'three';
import { dressingMaterial, fbm, rng } from './dressing.js';
import { convexHull } from '../world/placement-geom.js';
import { CONFIG } from '../config.js';
import { B } from '../world/grid.js';
import { addSnowCover } from './terrain/snowfx.js';
import { propSnowAmount } from './terrain.js';

/** Icosphere subdivision of a big boulder (≈ 11 cm facets on a 2.5 m rock), of a small one and of a stone. */
const DETAIL = 9, DETAIL_SMALL = 6, DETAIL_STONE = 3;
/** Height band (m over the ground) of a walker's body: the outline that stops him (placement rule e's band). */
export const BODY_BAND = [0.3, 1.8];
/** The rock hides a standing man where it rises to a guard's eye (CONFIG.stealth.eyeHeight: every ground sight line). */
export const SIGHT_Y = CONFIG.stealth.eyeHeight;

// ---------------------------------------------------------------- the shape (pure: node and browser)

const SPHERES = new Map();
/** Welded unit icosphere: positions + triangle indices. */
function unitSphere(detail) {
  if (SPHERES.has(detail)) return SPHERES.get(detail);
  const g = new THREE.IcosahedronGeometry(1, detail), P = g.attributes.position, map = new Map(), pos = [], idx = [];
  for (let i = 0; i < P.count; i++) {
    const k = `${Math.round(P.getX(i) * 1e5)},${Math.round(P.getY(i) * 1e5)},${Math.round(P.getZ(i) * 1e5)}`;
    let j = map.get(k);
    if (j === undefined) { j = pos.length / 3; map.set(k, j); pos.push(P.getX(i), P.getY(i), P.getZ(i)); }
    idx.push(j);
  }
  g.dispose();
  const s = { pos: new Float32Array(pos), index: new Uint32Array(idx) };
  SPHERES.set(detail, s);
  return s;
}

const SHAPES = new Map();
/**
 * One boulder in its own frame (centre of its plan at the origin, the ground at y = 0, its top at h): positions,
 * triangle indices (welded), per vertex its crack depth 0..1 (the sheeting / frost cracks, where snow lodges).
 * @param {number} w @param {number} d plan size at its widest (x, z) @param {number} h top over the ground
 * @param {number} seed @param {number} [detail]
 * @returns {{pos: Float32Array, index: Uint32Array, crack: Float32Array}}
 */
export function boulderShape(w, d, h, seed, detail = DETAIL) {
  const key = `${w}|${d}|${h}|${seed}|${detail}`;
  if (SHAPES.has(key)) return SHAPES.get(key);
  const S = unitSphere(detail), R = rng(seed), n = S.pos.length / 3, s = seed & 0xffff;
  const pos = new Float32Array(S.pos), crack = new Float32Array(n);
  // the block: a rounded, lumpy mass (a little of a box in it), tipped a few degrees off level, cut by two to four
  // joint faces (sub-vertical, one maybe across its top) and, on some, a frost crack down one side
  const box = 0.12 + R() * 0.2, ex = 2.4 + R() * 0.6;
  const tilt = new THREE.Euler((R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.3);
  const planes = [];
  for (let k = 0, m = 2 + Math.floor(R() * 3); k < m; k++) {
    const a = R() * Math.PI * 2, ny = -0.1 + R() * 0.4;
    const nn = new THREE.Vector3(Math.cos(a), ny, Math.sin(a)).normalize();
    planes.push([nn, 0.74 + R() * 0.16]);
  }
  if (R() < 0.35) planes.push([new THREE.Vector3((R() - 0.5) * 0.6, 1, (R() - 0.5) * 0.6).normalize(), 0.78 + R() * 0.1]); // a flattish top facet
  const cracks = [];
  if (R() < 0.5) cracks.push({ n: new THREE.Vector3(Math.cos(R() * 6.3), 0.15, Math.sin(R() * 6.3)).normalize(), c: (R() - 0.5) * 0.6, w: 0.07, dep: 0.05, from: -0.2 + R() * 0.3 });
  if (R() < 0.3) cracks.push({ n: new THREE.Vector3((R() - 0.5) * 0.5, 1, (R() - 0.5) * 0.5).normalize(), c: 0.3 + R() * 0.25, w: 0.07, dep: 0.045 });
  const v = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromArray(S.pos, i * 3);
    const se = Math.pow(Math.pow(Math.abs(v.x), ex) + Math.pow(Math.abs(v.y), ex) + Math.pow(Math.abs(v.z), ex), 1 / ex);
    q.copy(v).multiplyScalar(1 / se);
    v.lerp(q, box);
    const r = 1 + 0.2 * fbm(v.x * 0.9 + 3, v.y * 0.9, v.z * 0.9, s, 3) + 0.07 * fbm(v.x * 2.4, v.y * 2.4, v.z * 2.4, s + 17, 2)
      + 0.022 * fbm(v.x * 7, v.y * 7, v.z * 7, s + 29, 2);
    v.multiplyScalar(r);
    for (const [nn, off] of planes) {
      const dd = v.dot(nn);
      if (dd > off) v.addScaledVector(nn, -(dd - off) * (0.85 + 0.1 * fbm(v.x * 5, v.y * 5, v.z * 5, s + 41, 2)));
    }
    let c = 0;
    for (const cr of cracks) {
      if (cr.from != null && v.y < cr.from) continue;
      const t = Math.abs(v.dot(cr.n) - cr.c - 0.03 * fbm(v.x * 4, v.y * 4, v.z * 4, s + 53, 2)) / cr.w;
      if (t >= 1) continue;
      const k = 1 - t * t;
      v.multiplyScalar(1 - cr.dep * k);
      c = Math.max(c, k);
    }
    crack[i] = c;
    v.applyEuler(tilt);
    v.toArray(pos, i * 3);
  }
  // ~a third of it in the ground: the ground line g in its own units; under it a flat buried underside
  const g = -0.36 - R() * 0.14;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (y < g) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); y1 = Math.max(y1, y);
  }
  const sx = w / (x1 - x0), sz = d / (z1 - z0), sy = h / (y1 - g), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (let i = 0; i < n; i++) {
    const y = Math.max(pos[i * 3 + 1], g - 0.12);
    pos[i * 3] = (pos[i * 3] - cx) * sx;
    pos[i * 3 + 1] = (y - g) * sy;
    pos[i * 3 + 2] = (pos[i * 3 + 2] - cz) * sz;
  }
  const out = { pos, index: S.index, crack };
  SHAPES.set(key, out);
  return out;
}

/** A boulder entry [x, z, w, d, h, yawDeg, seed] → its shape and the map from its frame to the row's. */
function placedShape(b) {
  const [bx, bz, w, d, h, yaw = 0, seed = 1] = b, big = Math.min(w, d) > 1.2, tiny = Math.max(w, d) < 0.6;
  const sh = boulderShape(w, d, h, seed, tiny ? DETAIL_STONE : big ? DETAIL : DETAIL_SMALL), a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { sh, at: (u, v) => [bx + u * c - v * s, bz + u * s + v * c] };
}

/** Points where the boulder's surface crosses the height y (its triangles' edges), in the row's frame. */
function sectionPoints({ sh, at }, y, out) {
  const P = sh.pos, I = sh.index;
  for (let t = 0; t < I.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = I[t + e] * 3, b = I[t + ((e + 1) % 3)] * 3, ya = P[a + 1], yb = P[b + 1];
      if ((ya < y) === (yb < y)) continue;
      const f = (y - ya) / (yb - ya);
      out.push(at(P[a] + (P[b] - P[a]) * f, P[a + 2] + (P[b + 2] - P[a + 2]) * f));
    }
  }
  return out;
}

const r3 = (v) => Math.round(v * 1000) / 1000;
/** Convex hull (row frame), rounded to mm; null when empty. */
const hullOf = (pts) => { const h = pts.length >= 3 ? convexHull(pts) : null; return h && h.length >= 3 ? h.map(([x, z]) => [r3(x), r3(z)]) : null; };

/**
 * A boulder's plan outline within a height band [y0, y1] (m over the ground; its vertices in it and its sections at
 * both ends), in the row's frame. @returns {number[][]|null}
 */
export function boulderBandHull(b, y0, y1) {
  const ps = placedShape(b), P = ps.sh.pos, pts = [];
  for (let i = 0; i < P.length; i += 3) if (P[i + 1] >= y0 && P[i + 1] <= y1) pts.push(ps.at(P[i], P[i + 2]));
  sectionPoints(ps, y0, pts); sectionPoints(ps, y1, pts);
  return hullOf(pts);
}
/** A boulder's section at height y (m over the ground), in the row's frame. @returns {number[][]|null} */
export function boulderSection(b, y) { return hullOf(sectionPoints(placedShape(b), y, [])); }

/**
 * Gameplay parts of a boulder row def (map-builder `navParts`, row frame): every boulder's body-height outline as
 * B.LOW, then every section at a guard's eye height as B.HIGH (written after: the high rock wins where they overlap).
 * @param {{boulders: number[][]}} def @returns {{points: number[][], block: number}[]}
 */
export function boulderRowNavParts(def) {
  const low = [], high = [];
  for (const b of def.boulders || []) {
    const body = boulderBandHull(b, BODY_BAND[0], BODY_BAND[1]);
    if (body) low.push({ points: body, block: B.LOW });
    if ((b[4] ?? 0) > SIGHT_Y) { const top = boulderSection(b, SIGHT_Y); if (top) high.push({ points: top, block: B.HIGH }); }
  }
  return [...low, ...high];
}

/** Each boulder's rock at body height (0.15–1.2 m, as map-builder stampStanding measures drawn visuals), world. */
export function boulderRowSolidPolys(def) {
  const c = Math.cos(def.rot ?? 0), s = Math.sin(def.rot ?? 0), x0 = def.x ?? 0, z0 = def.z ?? 0;
  return (def.boulders || []).map((b) => boulderBandHull(b, 0.15, 1.2)?.map(([u, v]) => [x0 + u * c - v * s, z0 + u * s + v * c])).filter(Boolean);
}

/**
 * The quarter cells (grid.solidStamp keys "i,j" at `cell` m, world) whose centres lie in any of `polys` (world): a
 * grid-only build's stand-in for the standing visuals measured on the drawn meshes, so a lying body keeps off the
 * solid itself there too (placement proneClear: grid.solidAt). @returns {Set<string>}
 */
export function polySolidCells(polys, cell) {
  const out = new Set();
  for (const P of polys) {
    const xs = P.map((p) => p[0]), zs = P.map((p) => p[1]);
    for (let j = Math.floor(Math.min(...zs) / cell); j <= Math.floor(Math.max(...zs) / cell); j++) {
      for (let i = Math.floor(Math.min(...xs) / cell); i <= Math.floor(Math.max(...xs) / cell); i++) {
        const px = (i + 0.5) * cell, pz = (j + 0.5) * cell;
        let inside = false;
        for (let a = 0, q = P.length - 1; a < P.length; q = a++) {
          const [xa, za] = P[a], [xq, zq] = P[q];
          if ((za > pz) !== (zq > pz) && px < ((xq - xa) * (pz - za)) / (zq - za) + xa) inside = !inside;
        }
        if (inside) out.add(`${i},${j}`);
      }
    }
  }
  return out;
}
export const boulderRowSolidCells = (def, cell) => polySolidCells(boulderRowSolidPolys(def), cell);

/**
 * Body-clearance solids (world/body-clearance.js static solids) from polygons: their quarter cells merged into row
 * rectangles, as map-builder stampBodySolids keeps a solid's real outline (row rects of its drawn shape) in the browser.
 * @returns {{x: number, z: number, h: number, hl: number, hw: number, top: number, y0: number}[]}
 */
export function polySolidRects(polys, top, cell = 0.25) {
  const rows = new Map(), out = [];
  for (const k of polySolidCells(polys, cell)) { const [i, j] = k.split(',').map(Number); if (!rows.has(j)) rows.set(j, []); rows.get(j).push(i); }
  for (const [j, is] of rows) {
    is.sort((a, b) => a - b);
    for (let a = 0; a < is.length;) {
      let b = a;
      while (b + 1 < is.length && is[b + 1] === is[b] + 1) b++;
      out.push({ x: ((is[a] + is[b] + 1) / 2) * cell, z: (j + 0.5) * cell, h: 0, hl: ((is[b] - is[a] + 1) * cell) / 2, hw: cell / 2, top, y0: 0 });
      a = b + 1;
    }
  }
  return out;
}
export const boulderRowSolidRects = (def, cell = 0.25) => polySolidRects(boulderRowSolidPolys(def), Math.max(...(def.boulders || []).map((b) => b[4] ?? 0)), cell);

/** The top (m) of a boulder's rock over (x, z) in the row's frame (its triangles' highest crossing), or null. */
export function boulderTopAt(b, x, z) {
  const { sh, at } = placedShape(b), P = sh.pos, I = sh.index;
  let best = null;
  for (let t = 0; t < I.length; t += 3) {
    const [ax, az] = at(P[I[t] * 3], P[I[t] * 3 + 2]), [bx, bz] = at(P[I[t + 1] * 3], P[I[t + 1] * 3 + 2]), [cx, cz] = at(P[I[t + 2] * 3], P[I[t + 2] * 3 + 2]);
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-12) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den, l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const y = l1 * P[I[t] * 3 + 1] + l2 * P[I[t + 1] * 3 + 1] + l3 * P[I[t + 2] * 3 + 1];
    if (best == null || y > best) best = y;
  }
  return best;
}

// ---------------------------------------------------------------- the art

const HAS_DOM = typeof document !== 'undefined';
let MATS = null;
/**
 * The granite: the shared rock set with vertex colours (tone, lichen, weathering, a wet foot) and its own snow — the
 * prop snow on its up-facing crown (a little less than on built props: bare rock shows on its shoulders) plus the
 * snow its `aSnow` attribute lays in the hollows and round the cap (shader: smooth, noisy edges). Its snow cap and the
 * drifts are the dressing snow.
 */
function materials() {
  const rock = dressingMaterial('rock'), snow = dressingMaterial('snow');
  if (MATS && MATS.base === rock && MATS.snowBase === snow) return MATS;
  const granite = rock.clone(); // (anti-tiling patch carried over: art/anti-tiling.js antiTile's clone)
  granite.vertexColors = true;
  granite.color.setHex(HAS_DOM ? 0xd2cfc8 : 0x8a8781);
  granite.name = 'dressing:granite_boulder';
  if (HAS_DOM) {
    addSnowCover(granite, { uniforms: { uSnowAmt: propSnowAmount(), uSnowBias: { value: -0.22 } } });
    granite.userData.snowCover = true; // (the scene's prop snow pass leaves it as it is)
    const prev = granite.onBeforeCompile, prevKey = granite.customProgramCacheKey.bind(granite);
    granite.onBeforeCompile = function (sh, r) {
      prev.call(this, sh, r);
      sh.vertexShader = 'attribute float aSnow;\nvarying float vBrSnow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBrSnow = aSnow;');
      sh.fragmentShader = 'varying float vBrSnow;\n' + sh.fragmentShader.replace('float scCov = snowCoverage(normalize(vScWN), vScWP, uSnowAmt);',
        `float scCov = snowCoverage(normalize(vScWN), vScWP, uSnowAmt);
        scCov = max(scCov, smoothstep(0.38, 0.62, vBrSnow + (scNoise(vScWP * 9.0) - 0.5) * 0.45 + (scNoise(vScWP * 31.0) - 0.5) * 0.2) * step(0.001, uSnowAmt));`);
    };
    granite.customProgramCacheKey = () => `${prevKey()}|boulderSnow`;
  }
  const cap = snow.clone();
  cap.name = 'dressing:snow~boulder'; // (still a snow material: world/placement-visual.js isSnowMaterial)
  cap.polygonOffset = true; cap.polygonOffsetFactor = -1; cap.polygonOffsetUnits = -2;
  return (MATS = { base: rock, snowBase: snow, granite, cap, drift: snow });
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Vertex normals of an indexed position array (area weighted). */
function normalsOf(pos, index) {
  const N = new Float32Array(pos.length), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < index.length; t += 3) {
    const i = index[t] * 3, j = index[t + 1] * 3, k = index[t + 2] * 3;
    a.set(pos[j] - pos[i], pos[j + 1] - pos[i + 1], pos[j + 2] - pos[i + 2]);
    b.set(pos[k] - pos[i], pos[k + 1] - pos[i + 1], pos[k + 2] - pos[i + 2]);
    c.crossVectors(a, b);
    for (const q of [i, j, k]) { N[q] += c.x; N[q + 1] += c.y; N[q + 2] += c.z; }
  }
  for (let i = 0; i < N.length; i += 3) { const L = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= L; N[i + 1] /= L; N[i + 2] /= L; }
  return N;
}

/** Per-vertex concavity (the neighbours' mean, how far it lies outside the vertex along its normal; m). */
function concavity(pos, index, N) {
  const n = pos.length / 3, sum = new Float32Array(n * 3), cnt = new Uint16Array(n), out = new Float32Array(n);
  for (let t = 0; t < index.length; t += 3) for (let e = 0; e < 3; e++) {
    const i = index[t + e], j = index[t + ((e + 1) % 3)];
    sum[i * 3] += pos[j * 3]; sum[i * 3 + 1] += pos[j * 3 + 1]; sum[i * 3 + 2] += pos[j * 3 + 2]; cnt[i]++;
    sum[j * 3] += pos[i * 3]; sum[j * 3 + 1] += pos[i * 3 + 1]; sum[j * 3 + 2] += pos[i * 3 + 2]; cnt[j]++;
  }
  for (let i = 0; i < n; i++) {
    if (!cnt[i]) continue;
    const dx = sum[i * 3] / cnt[i] - pos[i * 3], dy = sum[i * 3 + 1] / cnt[i] - pos[i * 3 + 1], dz = sum[i * 3 + 2] / cnt[i] - pos[i * 3 + 2];
    out[i] = dx * N[i * 3] + dy * N[i * 3 + 1] + dz * N[i * 3 + 2];
  }
  return out;
}

/** Tri-planar-ish UVs per vertex: the dominant axis of its normal, metres / tile. */
function uvsOf(pos, N, tile = 2.2) {
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0, k = 0; i < pos.length; i += 3, k += 2) {
    const ax = Math.abs(N[i]), ay = Math.abs(N[i + 1]), az = Math.abs(N[i + 2]);
    const [u, v] = ay >= ax && ay >= az ? [pos[i], pos[i + 2]] : ax >= az ? [pos[i + 2], pos[i + 1]] : [pos[i], pos[i + 1]];
    uv[k] = u / tile; uv[k + 1] = v / tile;
  }
  return uv;
}

/** Merge {pos, index, N, uv, col?, snow?} parts into one indexed geometry. */
function mergeParts(parts, extra) {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.pos.length / 3; ni += p.index.length; }
  const pos = new Float32Array(nv * 3), N = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  const col = extra ? new Float32Array(nv * 3) : null, sn = extra ? new Float32Array(nv) : null;
  let ov = 0, oi = 0;
  for (const p of parts) {
    pos.set(p.pos, ov * 3); N.set(p.N, ov * 3); uv.set(p.uv, ov * 2);
    if (extra) { col.set(p.col, ov * 3); sn.set(p.snow, ov); }
    for (let i = 0; i < p.index.length; i++) idx[oi + i] = p.index[i] + ov;
    ov += p.pos.length / 3; oi += p.index.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (extra) { g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSnow', new THREE.BufferAttribute(sn, 1)); }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

/**
 * One placed boulder's art parts: the rock (granite: vertex colours, its `aSnow` mask) and its snow cap — the crown's
 * own triangles lifted off it, thickest on top; the cap's thickness runs below zero past its edge, so it meets the
 * rock along a smooth line (no stepped triangle edge) and the shader's snow mask feathers on from there.
 */
function boulderArt(b, R) {
  const [, , w, d, h, , seed] = b, { sh, at } = placedShape(b), n = sh.pos.length / 3, s = (seed * 7 + 3) & 0xffff;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const [x, z] = at(sh.pos[i * 3], sh.pos[i * 3 + 2]); pos[i * 3] = x; pos[i * 3 + 1] = sh.pos[i * 3 + 1]; pos[i * 3 + 2] = z; }
  const N = normalsOf(pos, sh.index), cav = concavity(pos, sh.index, N), uv = uvsOf(pos, N);
  // the granite's tone: grey with a pink (feldspar), blue-grey or brown (weathered) cast, mottled; lichen patches
  // (yellow-green map lichen, pale grey-green crusts, dark specks) on its sides and shoulders; a wet, darker foot
  const tone = [[1.0, 0.96, 0.93], [0.95, 0.97, 1.0], [0.99, 0.96, 0.9]][Math.floor(R() * 3)], val = 0.95 + R() * 0.17;
  const col = new Float32Array(n * 3), snow = new Float32Array(n), capT = new Float32Array(n);
  // (how much snow this one holds: the wind scours some crowns more than others)
  const T = Math.min(0.15, 0.05 + 0.035 * Math.min(w, d)) * (0.7 + R() * 0.5), small = Math.min(w, d) < 1, edge = 0.6 + R() * 0.08;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], ny = N[i * 3 + 1];
    const m1 = fbm(x * 0.9, y * 0.9, z * 0.9, s, 3), m2 = fbm(x * 3.1, y * 3.1, z * 3.1, s + 5, 2);
    const k = val * (1 + 0.12 * m1 + 0.07 * m2);
    let r = k * tone[0], g = k * tone[1], bl = k * tone[2];
    const crk = sh.crack[i], ao = Math.max(0, Math.min(1, cav[i] / 0.03));
    const dark = 1 - 0.32 * Math.max(ao, crk * 0.9) - 0.12 * smooth(0.1, -0.6, ny); // hollows, cracks, the underside
    r *= dark; g *= dark; bl *= dark;
    const foot = 1 - 0.3 * (1 - smooth(0.0, 0.3, y)); // wet, dirty foot
    r *= foot; g *= foot; bl *= foot;
    // lichen (on its sides and shoulders, not under overhangs): two species in patches, dark specks
    const side = smooth(-0.4, -0.1, ny) * smooth(0.15, 0.4, y);
    const l1 = side * smooth(0.2, 0.36, fbm(x * 1.7 + 11, y * 1.7, z * 1.7, s + 61, 3)); // map lichen: yellow-green
    const l2 = side * smooth(0.18, 0.34, fbm(x * 2.4 - 7, y * 2.4, z * 2.4, s + 67, 3)); // crustose: pale grey-green
    const l3 = smooth(0.4, 0.55, fbm(x * 9, y * 9, z * 9, s + 71, 2)); // dark specks
    r += l1 * (r * 1.05 - r); g += l1 * (g * 1.12 - g); bl += l1 * (bl * 0.62 - bl);
    r += l2 * (k * 1.08 - r); g += l2 * (k * 1.14 - g); bl += l2 * (k * 1.02 - bl);
    r *= 1 - 0.3 * l3; g *= 1 - 0.3 * l3; bl *= 1 - 0.26 * l3;
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = bl;
    // the snow cap: on the up-facing crown, thick on top (its thickness < 0 where there is none)
    // (a ragged edge: two scales of noise; wind-scoured patches where the rock shows through on the crown; the pillow
    // thicker in drifts across it)
    const crown = ny + 0.3 * fbm(x * 1.2 + 5, y * 1.2, z * 1.2, s + 83, 3) + 0.12 * fbm(x * 4.5, y * 4.5, z * 4.5, s + 89, 2) + 0.25 * (y / h - 0.75)
      - 0.35 * smooth(0.25, 0.45, fbm(x * 0.8 - 3, y * 0.8, z * 0.8, s + 97, 2));
    capT[i] = small ? -1 : T * (0.75 + 0.5 * fbm(x * 0.7, 0, z * 0.7, s + 101, 2) + 0.25) * (crown - edge) / (1 - edge);
    // the shader's snow: round the cap, in sky-facing hollows and cracks on the upper half, and a dusting on top
    snow[i] = Math.max(smooth(0.4, 0.68, crown) * 0.72, smooth(0.004, 0.025, cav[i]) * smooth(0.0, 0.5, ny) * smooth(h * 0.3, h * 0.6, y),
      crk * smooth(0.1, 0.6, ny) * 0.8);
  }
  // the cap shell: every triangle with a corner over 2 cm under its line (the rest of the shell lies inside the rock)
  const I = sh.index, keep = [];
  for (let t = 0; t < I.length; t += 3) if (Math.max(capT[I[t]], capT[I[t + 1]], capT[I[t + 2]]) > -0.02) keep.push(I[t], I[t + 1], I[t + 2]);
  let cap = null;
  if (keep.length) {
    const remap = new Map(), sp = [], sidx = [];
    for (const v of keep) {
      let j = remap.get(v);
      if (j === undefined) {
        j = sp.length / 3; remap.set(v, j);
        const t = capT[v];
        sp.push(pos[v * 3] + N[v * 3] * t, pos[v * 3 + 1] + N[v * 3 + 1] * t, pos[v * 3 + 2] + N[v * 3 + 2] * t);
      }
      sidx.push(j);
    }
    const spos = new Float32Array(sp), sindex = new Uint32Array(sidx), sN = normalsOf(spos, sindex);
    cap = { pos: spos, index: sindex, N: sN, uv: uvsOf(spos, sN, 3) };
  }
  return { rock: { pos, index: new Uint32Array(I), N, uv, col, snow }, cap };
}

/**
 * A snow drift: a smooth mound (length along its yaw), its back sloping gently, its lee front steeper, feathered into
 * the ground at its rim (heightfield over a small grid). Low (under SNOW_WADE): a man wades through it.
 */
function driftArt([x, z, L, W, H, yaw = 0], seed) {
  const nu = 16, nv = 10, a = (yaw * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), pos = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = (i / nu) * 2 - 1, v = (j / nv) * 2 - 1;
    const r2 = u * u + v * v;
    const prof = Math.pow(Math.max(0, 1 - r2), 1.4) * (v > 0 ? 1 - 0.3 * v : 1) * (1 - 0.25 * Math.max(0, u)); // tail thins downwind (+u)
    const y = H * prof * (1 + 0.15 * fbm(u * 2 + seed, 0, v * 2, seed, 2)) - 0.04 * (1 - prof);
    const px = u * L * 0.5, pz = v * W * 0.5 * (1 - 0.25 * u) + 0.06 * W * fbm(u * 1.5, 0, seed, seed + 3, 2);
    pos.push(x + px * c - pz * sn, y, z + px * sn + pz * c);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a0 = j * (nu + 1) + i, a1 = a0 + 1, b0 = a0 + nu + 1, b1 = b0 + 1;
    idx.push(a0, b0, a1, a1, b0, b1);
  }
  const P = new Float32Array(pos), I = new Uint32Array(idx);
  let N = normalsOf(P, I);
  if (N[((nv >> 1) * (nu + 1) + (nu >> 1)) * 3 + 1] < 0) { for (let t = 0; t < I.length; t += 3) { const q = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = q; } N = normalsOf(P, I); }
  return { pos: P, index: I, N, uv: uvsOf(P, N, 3) };
}

/**
 * Build the row (the def's own frame: the caller places and turns it). One mesh per material: the granite (all the
 * boulders and stones), their snow caps and the drifts.
 * @param {{boulders: number[][], stones?: number[][], drifts?: number[][]}} p
 * @returns {THREE.Group}
 */
export function buildBoulderRow(p) {
  const M = materials(), R = rng(0x5eed ^ (p.boulders?.length ?? 0));
  const rocks = [], caps = [], drifts = [];
  for (const b of [...(p.boulders || []), ...(p.stones || []).map(stoneBoulder)]) {
    const A = boulderArt(b, R);
    rocks.push(A.rock);
    if (A.cap) caps.push(A.cap);
  }
  for (const [k, dr] of (p.drifts || []).entries()) drifts.push(driftArt(dr, 17 + k * 13));
  const g = new THREE.Group(); g.name = 'dressing:boulder_row';
  const add = (parts, mat, name, cast, extra) => {
    if (!parts.length) return;
    const m = new THREE.Mesh(mergeParts(parts, extra), mat);
    m.name = name; m.castShadow = cast; m.receiveShadow = true;
    g.add(m);
  };
  add(rocks, M.granite, 'boulder_row:granite', true, true);
  add(caps, M.cap, 'boulder_row:snow', true, false);
  add(drifts, M.drift, 'boulder_row:drifts', true, false);
  return g;
}

/** A stone entry [x, z, size, seed, yaw°] as a boulder entry (a low, flat-ish stone). */
export const stoneBoulder = ([x, z, size, seed = 1, yaw = 0]) => [x, z, +(size * (1.1 + (seed % 3) * 0.12)).toFixed(3), +(size * 0.9).toFixed(3), +(size * 0.6).toFixed(3), yaw, seed];
