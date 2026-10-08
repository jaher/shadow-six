/**
 * Realistic procedural dressing for catalogue props the building library does not model (art integration 2 review):
 * the placeholder boxes read as grey/maroon blocks next to the real buildings and characters.
 *   - rocks      seeded, noise-displaced boulder clusters (rock_cliff PBR set)
 *   - cliff      rock massif extruded from the mission polygon: fractured, battered walls + a broken top
 *   - wall       log palisade (variants palisade*, stockade*; wire strands for *_wire), dry-stone wall with a plank
 *                cap (stone*), textured brick / concrete otherwise
 *   - tent       canvas ridge tent (walls, sagging roof, gable ends, guy ropes)
 * Textures come from the shared library (lib/1k, 512 on low, 2k albedo on ultra; ARM = AO/rough/metal). In node (unit tests) the
 * materials are plain colours. Top-facing snow comes from the scene's prop snow cover (terrain.coverPropsWithSnow).
 * Every builder only returns an Object3D in the prop's local frame; footprints stay the caller's (gameplay) ones.
 * @module art/dressing
 */
import * as THREE from 'three';
import { antiTile } from './anti-tiling.js';
import { applyFlap, applySway, swayWeights, canvasAttributes, transformCanvasAttrs } from './cloth-wind.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { libTextureURL } from './building-library.js';
import { extendPolygonPastEdges } from '../world/edge-extend.js';
import { MEDINA_GOODS_RX, buildMedinaGoods } from './medina-kit.js';

const HAS_DOM = typeof document !== 'undefined';

const TEX = new Map(), MATS = new Map();
function tex(file, srgb) {
  const { url } = libTextureURL(file);
  const key = url + (srgb ? '|s' : '');
  if (!TEX.has(key)) {
    const t = new THREE.TextureLoader().load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    TEX.set(key, t);
  }
  return TEX.get(key);
}

/** PBR set name → [colour tint, fallback colour, normal strength]. */
const SETS = {
  rock: ['rock_cliff', 0xb8b4ac, 0x77746d, 1.2],
  rockDark: ['rock_cliff', 0x8c8984, 0x5f5c57, 1.3],   // (lib 'granite' is a log-wall texture)
  logs: ['timber_grey', 0xc9c2b4, 0x6b6153, 1.0],
  logsTarred: ['timber_tarred', 0xffffff, 0x3c342c, 1.0],
  stone: ['fieldstone_grey', 0xffffff, 0x807b72, 1.2],
  planks: ['boards_weathered', 0xd8d0c0, 0x6d5d4a, 1.0],
  brick: ['brick_red', 0xffffff, 0x7a4336, 1.0],
  concrete: ['concrete_board', 0xffffff, 0x8b8a86, 1.0],
  canvas: ['tent_canvas', 0xb7b39a, 0x77745d, 0.8],
  burlap: ['burlap_bag', 0xc4b69a, 0x8a7a5c, 1.0],
  steel: ['paint_metal', 0x8d9278, 0x5d6250, 0.8],
  plinth: ['concrete_slab', 0xffffff, 0x8b8a86, 1.0],
  galv: ['steel_galv', 0xb0b3b5, 0x8a8d90, 0.6],
  creosote: ['timber_creosote', 0xffffff, 0x3f3226, 1.0],
  // placeholder-art pass (art/kit-*.js): walls, roofs, ground and metal finishes of the procedural kit pieces
  plaster: ['plaster_limewash', 0xffffff, 0xc9c1b0, 0.8],
  plasterWhite: ['plaster_white', 0xffffff, 0xe0dccf, 0.7],
  plasterRough: ['plaster_rough', 0xffffff, 0xb3a994, 0.9],
  limewash: ['limewash_worn', 0xffffff, 0xd8d2c2, 0.8],
  adobe: ['adobe_ochre', 0xffffff, 0xb08a5c, 1.0],
  mudbrick: ['mudbrick', 0xffffff, 0x9c7b56, 1.0],
  mudRender: ['mud_render2', 0xffffff, 0xa58866, 0.9],
  sandstone: ['sandstone_ochre', 0xffffff, 0xb59468, 1.1],
  ashlar: ['ashlar_limestone', 0xffffff, 0xb7ae9c, 1.0],
  rubble: ['rubble_stone', 0xffffff, 0x8a8174, 1.2],
  fieldstone: ['fieldstone', 0xffffff, 0x7e776c, 1.2],
  logHewn: ['log_hewn', 0xffffff, 0x6e5a43, 1.0],
  beam: ['timber_beam', 0xffffff, 0x5c4a36, 1.0],
  door: ['door_planks', 0xffffff, 0x5b4632, 1.0],
  roofTerracotta: ['roof_terracotta', 0xffffff, 0x8c4a32, 1.0],
  roofShingle: ['roof_shingle', 0xffffff, 0x4d463f, 1.0],
  roofSlate: ['roof_slate', 0xffffff, 0x4a4e52, 1.0],
  tarPaper: ['tar_paper', 0xffffff, 0x353331, 0.8],
  screed: ['screed_lime', 0xffffff, 0xb9b1a0, 0.8],
  corrRust: ['corrugated_rust', 0xffffff, 0x6e4a33, 1.0],
  corrGalv: ['corrugated_galv', 0xffffff, 0x8c9094, 1.0],
  castIron: ['cast_iron', 0xffffff, 0x2a2c2a, 0.8],
  ballast: ['gravel_grey', 0xffffff, 0x77736c, 1.2],
  gravel: ['gravel', 0xffffff, 0x8a7f6d, 1.2],
  mud: ['mud', 0xffffff, 0x4a3d2c, 1.0],
  sand: ['sand', 0xffffff, 0xc2a77a, 0.8],
  cobble: ['cobblestone', 0xffffff, 0x77736b, 1.1],
  glassDirty: ['glass_dirty', 0xffffff, 0x2a3236, 0.5],
  weatherboard: ['weatherboard_paint', 0xffffff, 0x8a8170, 0.9],
  brickDark: ['brick_dark', 0xffffff, 0x5a3a30, 1.0],
  granite: ['granite_polished', 0xffffff, 0x77777a, 0.6],
  sod: ['turf_grass', 0xffffff, 0x4f5a34, 1.0],
  concreteBunker: ['concrete_bunker', 0xffffff, 0x8b8a86, 1.0],
  snow: ['snow_soft', 0xffffff, 0xdfdfde, 0.5],
};

/**
 * Shared material for a dressing set (textured in the browser, flat colour in node).
 * @param {keyof SETS} name
 */
export function dressingMaterial(name) {
  const key = `${name}|${HAS_DOM ? libTextureURL(`${(SETS[name] || SETS.concrete)[0]}_diff.jpg`).url : 'node'}`;   // per preset tier
  if (MATS.has(key)) return MATS.get(key);
  const [file, tint, flat, nrm] = SETS[name] || SETS.concrete;
  let m;
  if (!HAS_DOM) m = new THREE.MeshStandardMaterial({ color: flat, roughness: 0.9 });
  else {
    const arm = tex(`${file}_arm.jpg`, false);
    m = new THREE.MeshStandardMaterial({
      color: tint, map: tex(`${file}_diff.jpg`, true), normalMap: tex(`${file}_nor.jpg`, false),
      normalScale: new THREE.Vector2(nrm, nrm), roughnessMap: arm, metalnessMap: arm, aoMap: arm, aoMapIntensity: 0.8,
      roughness: 1, metalness: 1,
    });
    antiTile(m, { lib: file });   // hex tiling / per-object offset + macro variation (art/anti-tiling.js)
  }
  m.name = `dressing:${name}`;
  MATS.set(key, m);
  return m;
}

// ---------------------------------------------------------------- seeded noise

/** 32-bit string/number hash → uint32. */
export function seedOf(v) {
  let h = 2166136261 >>> 0;
  const s = String(v);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
/** Mulberry32 PRNG in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash3 = (x, y, z, s) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ s; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash3(xi + i, yi + j, zi + k, s);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}
/** Fractal value noise in [-1, 1]. */
export function fbm(x, y, z, s, oct = 4) {
  let a = 0, amp = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { a += vnoise(x * f, y * f, z * f, s + o * 101) * amp; n += amp; amp *= 0.5; f *= 2.03; }
  return a / n;
}

/** Tri-planar box UVs in metres / `tile` (dominant normal axis), for procedural meshes. Non-indexed geometry. */
export function boxUV(geo, tile = 3) {
  const P = geo.attributes.position, N = geo.attributes.normal, uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i)), nz = Math.abs(N.getZ(i));
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const [u, v] = ny >= nx && ny >= nz ? [x, z] : nx >= nz ? [z, y] : [x, y];
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/**
 * Draw-call hygiene: bake every plain child mesh of `g` (any depth, not instanced) into one mesh per material and
 * shadow flag. The review measured +45 draw calls (×2 with shadows) from per-part meshes (fins, ropes, stones).
 */
/** Step 4w per-vertex wind weights that survive consolidation (canvas flap, rope/wire sway). */
const WIND_ATTRS = { aFlap: 1, aSway: 1, aFlapDir: 3, aFlapP: 4, aFlapG: 3 };

export function consolidate(g) {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), groups = new Map(), drop = [];
  g.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o === g) return;
    const k = `${o.material.uuid}|${o.castShadow}`;
    if (!groups.has(k)) groups.set(k, { mat: o.material, cast: o.castShadow, geos: [] });
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const geo = transformCanvasAttrs((o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(m), m);
    for (const a of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', ...Object.keys(WIND_ATTRS)].includes(a)) geo.deleteAttribute(a);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    groups.get(k).geos.push(geo);
    drop.push(o);
  });
  if (drop.length < 2) return g;
  for (const o of drop) o.removeFromParent();
  for (const { mat, cast, geos } of groups.values()) {
    for (const [a, k] of Object.entries(WIND_ATTRS)) if (geos.some((q) => q.attributes[a])) for (const q of geos) if (!q.attributes[a]) q.setAttribute(a, new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * k), k));
    const m = mesh(mergeGeometries(geos, false), mat, cast);
    m.name = g.name;
    g.add(m);
  }
  return g;
}

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

/** Weld a non-indexed geometry by position (own mergeVertices: no addon import, works in node). */
function weld(geo) {
  const P = geo.attributes.position, map = new Map(), pos = [], idx = [];
  for (let i = 0; i < P.count; i++) {
    const k = `${Math.round(P.getX(i) * 1e4)},${Math.round(P.getY(i) * 1e4)},${Math.round(P.getZ(i) * 1e4)}`;
    let j = map.get(k);
    if (j === undefined) { j = pos.length / 3; map.set(k, j); pos.push(P.getX(i), P.getY(i), P.getZ(i)); }
    idx.push(j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const _n = new THREE.Vector3(), _v = new THREE.Vector3();
/**
 * One boulder: a welded icosphere, fbm-displaced, chiselled by a few random fracture planes, ~40 % buried.
 * @param {number} rx half width (x) @param {number} ry height above ground @param {number} rz half depth (z)
 * @param {number} seed
 */
export function boulderGeometry(rx, ry, rz, seed, detail = 7) {
  const g = weld(new THREE.IcosahedronGeometry(1, detail));
  const R = rng(seed), P = g.attributes.position;
  const planes = [];
  for (let k = 0, n = 4 + Math.floor(R() * 4); k < n; k++) {
    _n.set(R() * 2 - 1, R() * 1.4 - 0.2, R() * 2 - 1).normalize();
    planes.push([_n.clone(), 0.62 + R() * 0.25]);
  }
  for (let i = 0; i < P.count; i++) {
    _v.fromBufferAttribute(P, i);
    const s = seed & 0xffff;
    const r = 1 + 0.28 * fbm(_v.x * 1.1 + 7, _v.y * 1.1, _v.z * 1.1, s, 3) + 0.07 * fbm(_v.x * 4.3, _v.y * 4.3, _v.z * 4.3, s + 17, 2);
    _v.multiplyScalar(r);
    for (const [n, off] of planes) { const d = _v.dot(n); if (d > off) _v.addScaledVector(n, -(d - off)); }
    _v.multiplyScalar(1 + 0.035 * fbm(_v.x * 7, _v.y * 7, _v.z * 7, s + 29, 2));   // fine grain over the fracture faces
    P.setXYZ(i, _v.x * rx, Math.max(_v.y * ry * 1.25 + ry * 0.45, -0.25), _v.z * rz);
  }
  g.computeVertexNormals();
  boxUV(g, 2.2);
  return g;
}

/** A boulder cluster filling a w × d footprint (height h), seeded by the prop id. */
export function buildRocks(p) {
  const w = p.w ?? (p.r ?? 1.5) * 2, d = p.d ?? (p.r ?? 1.5) * 2, h = p.h ?? 1.8;
  const R = rng(seedOf(p.id ?? `${p.x},${p.z}`));
  const g = new THREE.Group();
  const mat = dressingMaterial(R() < 0.5 ? 'rock' : 'rockDark');
  const main = mesh(boulderGeometry(w * 0.42, h * 0.8, d * 0.42, Math.floor(R() * 1e9)), mat);
  main.rotation.y = R() * Math.PI * 2;
  g.add(main);
  const n = w * d > 10 ? 3 : w * d > 4 ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const a = R() * Math.PI * 2, s = 0.3 + R() * 0.25;
    const b = mesh(boulderGeometry(w * s * 0.5, h * s * 0.9, d * s * 0.5, Math.floor(R() * 1e9), 5), mat);
    b.position.set(Math.cos(a) * w * 0.33, 0, Math.sin(a) * d * 0.33);
    b.rotation.y = R() * Math.PI * 2;
    g.add(b);
  }
  g.name = 'dressing:rocks';
  return consolidate(g);
}

/** Polygon (CCW in x-z) offset inwards by `dist` with mitred corners (miter length capped at 3 × dist). */
function offsetPoly(poly, dist) {
  const n = poly.length, en = [];
  for (let i = 0; i < n; i++) { const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % n], l = Math.hypot(bx - ax, bz - az) || 1; en.push([(bz - az) / l, -(bx - ax) / l]); }
  return poly.map(([x, z], i) => {
    const [px, pz] = en[(i - 1 + n) % n], [qx, qz] = en[i];
    let mx = px + qx, mz = pz + qz; const k = 1 + px * qx + pz * qz;
    mx = k > 1e-3 ? mx / k : px; mz = k > 1e-3 ? mz / k : pz;
    const L = Math.hypot(mx, mz); if (L > 3) { mx *= 3 / L; mz *= 3 / L; }
    return [x - mx * dist, z - mz * dist];
  });
}

/**
 * Rock massif from a mission polygon: walls resampled every ~1.6 m, stacked rings up to `h` (plus 1.5 m buried),
 * displaced along the outward normal by vertically-stretched fbm (fractured faces, ledges), battered inwards with
 * height; a separate broken top cap (own UVs → sharp rim, snow collects on it).
 * @param {object} p prop params: points (world [x,z] or {x,z}), x, z (group origin), rot, h, id
 */
export function buildCliff(p) {
  const h = p.h ?? 6, ox = p.x ?? 0, oz = p.z ?? 0, rot = p.rot ?? 0, c = Math.cos(rot), s = Math.sin(rot);
  const own = (p.points || []).map((q) => (Array.isArray(q) ? q : [q.x, q.z]));
  // p.edge = {W, D, out}: a massif on a map edge carries on over the apron (world/edge-extend.js) instead of ending
  // in a straight wall along the map boundary; the batter / top inset keep the mission outline's proportions
  const raw = p.edge && own.length >= 3 ? extendPolygonPastEdges(own, p.edge.W, p.edge.D, p.edge.out) : own;
  const ownBox = own.length >= 3 ? [Math.max(...own.map((q) => q[0])) - Math.min(...own.map((q) => q[0])), Math.max(...own.map((q) => q[1])) - Math.min(...own.map((q) => q[1]))] : null;
  let poly = raw.length >= 3 ? raw.map(([x, z]) => { const dx = x - ox, dz = z - oz; return [dx * c + dz * s, -dx * s + dz * c]; })
    : [[-(p.w ?? 10) / 2, -(p.d ?? 4) / 2], [(p.w ?? 10) / 2, -(p.d ?? 4) / 2], [(p.w ?? 10) / 2, (p.d ?? 4) / 2], [-(p.w ?? 10) / 2, (p.d ?? 4) / 2]];
  let area = 0;
  for (let i = 0; i < poly.length; i++) { const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length]; area += ax * bz - bx * az; }
  if (area < 0) poly = poly.reverse();   // CCW in (x, z) → outward normal = (dz, -dx)
  // resample the perimeter (edgeOf: source edge + fraction, for mitred inward offsets of the top rings)
  const ring = [], edgeOf = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 1.6));
    for (let k = 0; k < n; k++) { ring.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); edgeOf.push([i, k / n]); }
  }
  const N = ring.length, seed = seedOf(p.id ?? 'cliff') & 0xffff;
  const nrm = ring.map((_, i) => {
    const [ax, az] = ring[(i - 1 + N) % N], [bx, bz] = ring[(i + 1) % N], l = Math.hypot(bx - ax, bz - az) || 1;
    return [(bz - az) / l, -(bx - ax) / l];
  });
  const levels = Math.max(5, Math.ceil((h + 1.5) / 1.4)), y0 = -1.5;
  const pos = [], uv = [], idx = [];
  let arc = 0;
  const arcs = ring.map((q, i) => { const a = arc; const nq = ring[(i + 1) % N]; arc += Math.hypot(nq[0] - q[0], nq[1] - q[1]); return a; });
  const pw = ownBox && raw !== own ? ownBox[0] : Math.max(...poly.map((q) => q[0])) - Math.min(...poly.map((q) => q[0]));
  const pd = ownBox && raw !== own ? ownBox[1] : Math.max(...poly.map((q) => q[1])) - Math.min(...poly.map((q) => q[1]));
  // a walkable massif (mission `walkways` on its top, e.g. the M14 ridge, or `flatTop`) keeps a near-flat top just under
  // the walking height h and steep faces, so units on it stand on rock, never in it or in the air
  const flat = !!(p.flatTop || p.walkways?.length);
  const batK = flat ? Math.min(0.3, 0.08 * h) : Math.min(0.3 * h, 0.2 * Math.min(pw, pd));   // top inset: 30 % of h, less on narrow outcrops
  const top = [], offs = [];
  for (let l = 0; l <= levels; l++) {
    const t = l / levels, y = y0 + (h - y0) * t;
    for (let i = 0; i <= N; i++) {   // i = N duplicates i = 0 (UV seam)
      const k = i % N, [x, z] = ring[k], [nx, nz] = nrm[k];
      const col = fbm(x * 0.2 + z * 0.07, y * 0.07, z * 0.2 - x * 0.05, seed, 4);          // vertical fracture columns
      const fine = fbm(x * 1.1, y * 0.9, z * 1.1, seed + 9, 2);
      const ledge = Math.round(y / 2.3) * 2.3 - y;                                             // horizontal ledges
      const tt = Math.max(0, (y - 0) / h);
      const bat = batK * Math.pow(tt, 1.15);                                                     // battered walls
      // the rim never bulges inwards (the top rings start from the clean inset contour: no folds / holes)
      const d = (l === levels ? Math.max(-0.2, 2.1 * col + 0.35 * fine) : 2.1 * col + 0.35 * fine + 0.3 * ledge) - bat;
      const yy = l === levels ? (flat ? h - 0.1 - 0.3 * Math.abs(fbm(x * 0.2, 3.1, z * 0.2, seed + 3, 3)) : h + 0.9 * fbm(x * 0.2, 3.1, z * 0.2, seed + 3, 3))
        : Math.min(y + (l > 0 ? 0.35 * fine : 0), flat ? h - 0.1 : Infinity);
      // batter through a mitred inset of the polygon (per-vertex normals pushed the corners past their neighbours);
      // the noise alone goes along the vertex normal
      const O = offs[l] || (offs[l] = offsetPoly(poly, bat)), [e, t] = edgeOf[k], A = O[e], B = O[(e + 1) % O.length];
      const px = A[0] + (B[0] - A[0]) * t + nx * (d + bat), pz = A[1] + (B[1] - A[1]) * t + nz * (d + bat);
      pos.push(px, yy, pz);
      uv.push((i === N ? arc : arcs[k]) / 5, yy / 5);
      if (l === levels && i < N) top.push([px, yy, pz]);
    }
  }
  const W = N + 1;
  for (let l = 0; l < levels; l++) for (let i = 0; i < N; i++) {
    const a = l * W + i, b = a + 1, c2 = a + W, d2 = c2 + 1;
    idx.push(a, d2, b, a, c2, d2);   // outward-facing (T × up points inwards)
  }
  // broken top (own vertices → sharp rim): rings shrinking towards the centroid with rolling height, then a cap
  const base = pos.length / 3;
  let cx = 0, cz = 0;
  for (const [x, , z] of top) { cx += x / N; cz += z / N; }
  const RINGS = 4, bat0 = batK;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, , z] of top) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  let inStep = Math.max(0.2, Math.min(1.3, Math.min(maxX - minX, maxZ - minZ) * 0.35 / RINGS));
  // the innermost inset must not invert any edge (short edges collapse first)
  const keeps = (dist) => { const o = offsetPoly(poly, dist); return o.every(([ax, az], i) => { const [bx, bz] = o[(i + 1) % o.length], [px, pz] = poly[i], [qx, qz] = poly[(i + 1) % poly.length]; return (bx - ax) * (qx - px) + (bz - az) * (qz - pz) > 0.25 * ((qx - px) ** 2 + (qz - pz) ** 2); }); };
  while (inStep > 0.05 && !keeps(bat0 + 0.3 + RINGS * inStep)) inStep *= 0.7;
  for (let r = 0; r <= RINGS; r++) {
    const off = offsetPoly(poly, bat0 + 0.3 + r * inStep);   // mitred inset polygon (per-vertex normals folded at corners)
    for (let i = 0; i < N; i++) {
      const [rx, y, rz] = top[i], [e, t] = edgeOf[i], A = off[e], B = off[(e + 1) % off.length];
      const X = r === 0 ? rx : A[0] + (B[0] - A[0]) * t, Z = r === 0 ? rz : A[1] + (B[1] - A[1]) * t;
      const k = Math.pow(r / RINGS, 0.8);   // blend from the rim height into the rolling top (no step at the rim)
      const Y = flat ? (y + 0.05) * (1 - k) + (h - 0.06 - 0.14 * Math.abs(fbm(X * 0.3, 7.7, Z * 0.3, seed + 5, 3))) * k
        : (y + 0.05) * (1 - k) + (h + 0.6 + 1.6 * fbm(X * 0.09, 7.7, Z * 0.09, seed + 5, 3) + 0.4 * fbm(X * 0.5, 1.3, Z * 0.5, seed + 6, 2)) * k;
      pos.push(X, Y, Z); uv.push(X / 9 + 0.37, Z / 9 + 0.61);   // wider tiling seen from above
    }
  }
  for (let r = 0; r < RINGS; r++) for (let i = 0; i < N; i++) {
    const a = base + r * N + i, b = base + r * N + (i + 1) % N, c3 = a + N, d3 = b + N;
    idx.push(a, d3, b, a, c3, d3);   // up-facing (T × inward points down)
  }
  const inner = base + RINGS * N;
  const tris = THREE.ShapeUtils.triangulateShape(top.map((_, i) => new THREE.Vector2(pos[(inner + i) * 3], pos[(inner + i) * 3 + 2])), []);
  const PY = (k) => [pos[k * 3], pos[k * 3 + 2]];
  for (const [a, b, c3] of tris) {   // wind every cap triangle up
    const [ax, az] = PY(inner + a), [bx, bz] = PY(inner + b), [qx, qz] = PY(inner + c3);
    const up = (bz - az) * (qx - ax) - (bx - ax) * (qz - az) > 0;   // y of (b - a) × (c - a)
    idx.push(inner + a, up ? inner + b : inner + c3, up ? inner + c3 : inner + b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = mesh(g, dressingMaterial('rock'));
  m.userData.capStart = base;
  m.name = 'dressing:cliff';
  const grp = new THREE.Group(); grp.add(m); grp.name = 'dressing:cliff';
  return grp;
}

let LOG_GEO = null;
/** Unit palisade stake: radius 1, height 1, sharpened top (lathe, 7 sides). */
function logGeometry() {
  if (LOG_GEO) return LOG_GEO;
  const prof = [[0.001, -0.02], [1, -0.02], [1, 0.86], [0.55, 0.94], [0.08, 1.0]].map(([x, y]) => new THREE.Vector2(x, y));
  LOG_GEO = new THREE.LatheGeometry(prof, 7);
  const uv = LOG_GEO.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 1.6);   // grain runs along the log
  return LOG_GEO;
}

const WALL_KIND = (variant = '', mat = '') => {
  const v = String(variant);
  if (/palisade|stockade|log/.test(v)) return 'palisade';
  if (/medina|mosque/.test(v)) return 'limewash'; // M12 art pass: Tunis lime-washed rubble walls (sandstone coping), not brick
  if (/stone|dry|field/.test(v) || mat === 'stone') return 'stone';
  if (mat === 'concrete' || /concrete/.test(v)) return 'concrete';
  return 'brick';
};

/**
 * Linear wall visual in world coordinates (same frame as props.js buildLinear).
 * @param {number[][]} points polyline [[x, z], …]
 * @param {{variant?: string, mat?: string, h: number, width: number, id?: string}} o
 */
/** How far a palisade's stakes step away from a wall walk's deck (m). */
export const WALK_SHIFT = 0.2;
/**
 * Signed across-shift (along the left normal nx, nz) for a stake at (x, z): −WALK_SHIFT·side when a walkway
 * ({points, width}) covers the spot, side = the walk's side of the line; 0 elsewhere.
 */
export function walkShiftAt(x, z, nx, nz, walkways) {
  for (const w of walkways || []) {
    const p = w.points.map((q) => (Array.isArray(q) ? q : [q.x, q.z]));
    for (let k = 0; k + 1 < p.length; k++) {
      const [cx, cz] = p[k], [dx, dz] = p[k + 1], l2 = (dx - cx) ** 2 + (dz - cz) ** 2 || 1;
      // the raised walk (nav line fill) runs half its width past each end: so do the stepped-off stakes
      const L = Math.sqrt(l2), ext = (w.width ?? 1.2) / 2 / L;
      let t = ((x - cx) * (dx - cx) + (z - cz) * (dz - cz)) / l2;
      if (t < -ext || t > 1 + ext) continue;
      t = Math.max(0, Math.min(1, t));
      const fx = cx + (dx - cx) * t, fz = cz + (dz - cz) * t;
      if (Math.hypot(fx - x, fz - z) > (w.width ?? 1.2) / 2 + 0.05) continue;
      const side = Math.sign((fx - x) * nx + (fz - z) * nz) || 1;
      return -side * WALK_SHIFT;
    }
  }
  return 0;
}

export function buildWall(points, o) {
  const kind = WALL_KIND(o.variant, o.mat), h = o.h ?? 2, width = o.width ?? 0.4;
  const root = new THREE.Group(); root.name = `dressing:wall:${kind}`;
  const R = rng(seedOf(o.id ?? points.flat().join(',')));
  if (kind === 'palisade') {
    const mats = [], M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    const rails = new THREE.Group(), stakes = [];
    for (let k = 0; k + 1 < points.length; k++) {
      const [ax, az] = points[k], [bx, bz] = points[k + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-3) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      const chunks = []; // runs of stakes with the same walk shift → their own rails
      // the run's free ends are flush (first stake starts AT the start, last one ends AT the end): a run cut at a
      // gate / building meets it `linearGap` short (placement rule a); inner corners keep the 0.14 m step-in
      const first = k === 0, isLast = k + 2 === points.length;
      for (let dd = first ? 0 : 0.14; dd < L; ) {
        const r = 0.11 + R() * 0.045, H = h * (0.93 + R() * 0.12);
        if (isLast && dd + 2 * r > L) dd = Math.max(0, L - 2 * r);
        let x = ax + tx * (dd + r), z = az + tz * (dd + r);
        // a wall walk runs along here: the stakes stand in front of its deck (never through a sentry's legs)
        const sh = walkShiftAt(x, z, -tz, tx, o.walkways);
        x -= tz * sh; z += tx * sh;
        e.set((R() - 0.5) * 0.05, R() * Math.PI * 2, (R() - 0.5) * 0.05);
        M4.compose(ps.set(x, -0.3, z), q.setFromEuler(e), sc.set(r, H + 0.3, r));
        mats.push(M4.clone()); stakes.push({ x, z, top: H, r });
        const last = chunks[chunks.length - 1];
        if (last && last.sh === sh) last.d1 = dd + 2 * r; else chunks.push({ sh, d0: dd, d1: dd + 2 * r });
        dd += 2 * r + 0.015;
      }
      // two split-log rails on the inside face
      for (const c of chunks) for (const y of [h * 0.28, h * 0.72]) {
        const len = c.d1 - c.d0, mid = (c.d0 + c.d1) / 2, off = 0.2 + c.sh;
        const rail = mesh(new THREE.BoxGeometry(len, 0.16, 0.1), dressingMaterial('logsTarred'));
        rail.position.set(ax + tx * mid - tz * off, y, az + tz * mid + tx * off);
        rail.rotation.y = -Math.atan2(bz - az, bx - ax);
        rails.add(rail);
      }
    }
    const inst = new THREE.InstancedMesh(logGeometry(), dressingMaterial('logs'), Math.max(1, mats.length));
    mats.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.count = mats.length;
    inst.castShadow = inst.receiveShadow = true;
    inst.computeBoundingSphere();
    inst.name = 'palisade';
    root.add(inst, consolidate(rails));
    // barbed-wire coping (art/wire-obstacles.js coping_bracket): brackets on the tallest stakes, strands clear of every top
    if (/wire/.test(String(o.variant))) root.userData.wireRun = { type: 'coping_bracket', def: { id: o.id, variant: o.variant, type: 'wall', h }, points, coping: { stakes } };
    return root;
  }
  const mat = dressingMaterial(kind);
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const geo = boxUV(new THREE.BoxGeometry(L + width, h, width), kind === 'stone' ? 1.6 : 2.4);
    const seg = mesh(geo, mat);
    seg.position.set((ax + bx) / 2, h / 2, (az + bz) / 2);
    seg.rotation.y = -Math.atan2(bz - az, bx - ax);
    root.add(seg);
    if (kind === 'limewash') { // a crowned sandstone coping with a drip lip and a darker damp plinth
      const cap = mesh(boxUV(new THREE.BoxGeometry(L + width + 0.08, 0.14, width + 0.12), 1.2), dressingMaterial('sandstone'));
      cap.position.set(seg.position.x, h + 0.07, seg.position.z); cap.rotation.y = seg.rotation.y;
      const plinth = mesh(boxUV(new THREE.BoxGeometry(L + width + 0.04, Math.min(0.5, h * 0.2), width + 0.06), 1.4), dressingMaterial('mudRender'));
      plinth.position.set(seg.position.x, Math.min(0.5, h * 0.2) / 2, seg.position.z); plinth.rotation.y = seg.rotation.y;
      root.add(cap, plinth);
    }
    if (/plank|roof|cap/.test(String(o.variant))) {
      const cap = mesh(boxUV(new THREE.BoxGeometry(L + width + 0.2, 0.1, width + 0.3), 2), dressingMaterial('planks'));
      cap.position.set(seg.position.x, h + 0.05, seg.position.z); cap.rotation.y = seg.rotation.y;
      root.add(cap);
    }
  }
  return consolidate(root);
}

/** Canvas ridge tent (w along local X, d across, h ridge height): low walls, sagging roof, guy ropes. */
export function buildTent(p) {
  const w = p.w ?? 4, d = p.d ?? 4, h = p.h ?? 2.2, hw = h * 0.36;
  const shape = new THREE.Shape([[-d / 2, 0], [d / 2, 0], [d / 2, hw], [0, h], [-d / 2, hw]].map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, steps: 8, bevelEnabled: false });
  geo.translate(0, 0, -w / 2);
  geo.rotateY(Math.PI / 2);   // extrusion along X
  const P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), u = 1 - Math.pow((2 * x) / w, 2);
    if (y > hw * 0.5 && Math.abs(Math.abs(x) - w / 2) > 1e-3) P.setY(i, y - 0.09 * u * (y / h));   // canvas sags between the poles
    if (y > hw - 1e-3 && y < h - 1e-3 && Math.abs(z) > 1e-3) P.setZ(i, z * (1 + 0.04 * u));
  }
  geo.computeVertexNormals();
  boxUV(geo, 2.5);
  // step 4w: canvas panels billow between the poles (0 at the pole ends, ground seam and ridge; 1 mid-panel). A pure
  // function of position + welded directions: the wall/roof crease never opens.
  canvasAttributes(geo, (x, y) => Math.max(0, 1 - Math.pow((2 * x) / w, 2)) * Math.sin(Math.PI * Math.min(1, Math.max(0, y / h))));
  const g = new THREE.Group(); g.name = 'dressing:tent';
  const mat = applyFlap(dressingMaterial('canvas').clone()); // own instance per tent: per-object wind uniforms
  mat.side = THREE.DoubleSide;
  g.add(mesh(geo, mat));
  const rope = dressingMaterial('logsTarred');
  for (const sx of [-0.42, 0, 0.42]) for (const sz of [-1, 1]) {
    const a = new THREE.Vector3(sx * w, hw + 0.05, sz * d / 2), b = new THREE.Vector3(sx * w, 0, sz * (d / 2 + 1.1));
    const L = a.distanceTo(b), r = mesh(swayWeights(new THREE.CylinderGeometry(0.008, 0.008, L, 3), 0.3), applySway(rope), false);
    r.position.copy(a).add(b).multiplyScalar(0.5);
    r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(r);
  }
  return consolidate(g);
}

/**
 * Ruins: 'wall_ruin' → a dry-stone wall stub with a broken, stepped top; anything else (rubble) → a low pile of
 * masonry blocks and stones.
 */
export function buildRuins(p) {
  const w = p.w ?? 4, d = p.d ?? 3, h = p.h ?? 1.2, R = rng(seedOf(p.id ?? `${p.x},${p.z}`));
  const g = new THREE.Group(); g.name = 'dressing:ruins';
  if (/wall/.test(String(p.variant ?? ''))) {
    const segs = Math.max(4, Math.round(w / 0.7));
    const geo = new THREE.BoxGeometry(w, h, Math.min(d, 0.7), segs, 1, 1);
    const P = geo.attributes.position, drop = Array.from({ length: segs + 1 }, () => (R() < 0.35 ? R() * 0.65 : R() * 0.2));
    for (let i = 0; i < P.count; i++) if (P.getY(i) > 0) { const k = Math.round((P.getX(i) / w + 0.5) * segs); P.setY(i, h / 2 - h * drop[k]); }
    geo.computeVertexNormals();
    const wall = mesh(boxUV(geo, 1.6), dressingMaterial('stone'));
    wall.position.y = h / 2;
    g.add(wall);
  }
  const n = /wall/.test(String(p.variant ?? '')) ? Math.round(w / 2) : Math.max(4, Math.round(w * d * 0.8));
  for (let k = 0; k < n; k++) {
    const s = 0.18 + R() * 0.3;
    const b = mesh(boulderGeometry(s, s * (0.5 + R() * 0.4), s * (0.7 + R() * 0.5), Math.floor(R() * 1e9), 2), dressingMaterial(R() < 0.6 ? 'stone' : 'rockDark'));
    b.position.set((R() - 0.5) * w * 0.9, 0, (R() - 0.5) * d * (/wall/.test(String(p.variant ?? '')) ? 1.6 : 0.9));
    b.rotation.y = R() * 6.3;
    g.add(b);
  }
  return consolidate(g);
}

let BAG_GEO = null;
/** One filled sandbag (0.58 × 0.15 × 0.34 m pillow). */
function bagGeometry() {
  if (BAG_GEO) return BAG_GEO;
  const g = new THREE.SphereGeometry(0.5, 12, 8);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) P.setXYZ(i, P.getX(i) * 0.58 * (1 + 0.12 * (1 - Math.abs(P.getY(i)) * 2)), Math.max(-0.075, Math.min(0.075, P.getY(i) * 0.2)), P.getZ(i) * 0.34);
  g.computeVertexNormals();
  return (BAG_GEO = g);
}

/** Sandbag wall: stacked, staggered courses along a straight run (w) or an MG ring (p.ring: r, arc°, centred on +X). */
export function buildSandbags(p) {
  const h = p.h ?? 1, courses = Math.max(2, Math.round(h / 0.15)), R = rng(seedOf(p.id ?? `${p.x},${p.z}`));
  const place = [];   // [x, z, yaw] per bag slot along the path, per course
  const ring = p.ring, arc = ((ring?.arc ?? 270) * Math.PI) / 180;
  const len = ring ? ring.r * arc : (p.w ?? 3);
  const n = Math.max(2, Math.round(len / 0.56));
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), ps = new THREE.Vector3();
  const mats = [];
  for (let c = 0; c < courses; c++) {
    const inset = c * 0.035;   // courses step back a little
    for (let k = 0; k < n; k++) {
      const t = (k + (c % 2 ? 0.5 : 0) + 0.5) / n;
      if (t > 1) continue;
      let x, z, yaw;
      if (ring) { const a = -arc / 2 + arc * t, r = ring.r - inset * 0.5; x = Math.cos(a) * r; z = Math.sin(a) * r; yaw = -(a + Math.PI / 2); }
      else { x = -len / 2 + len * t; z = 0; yaw = 0; }
      e.set((R() - 0.5) * 0.08, yaw + (R() - 0.5) * 0.12, (R() - 0.5) * 0.08);
      mats.push(M.compose(ps.set(x, 0.075 + c * 0.145, z), q.setFromEuler(e), sc.set(0.95 + R() * 0.1, 1, 0.95 + R() * 0.1)).clone());
    }
  }
  const inst = new THREE.InstancedMesh(bagGeometry(), dressingMaterial('burlap'), mats.length);
  mats.forEach((m, i) => inst.setMatrixAt(i, m));
  inst.castShadow = inst.receiveShadow = true;
  inst.computeBoundingSphere();
  const g = new THREE.Group(); g.name = 'dressing:sandbags'; g.add(inst);
  return g;
}

/** Crates: stacked wooden crates; 'cable_drum' → wooden cable drum; 'timber_debris' → loose planks and beams. */
export function buildCrates(p) {
  const w = p.w ?? 2, d = p.d ?? 2, h = p.h ?? 1.1, R = rng(seedOf(p.id ?? `${p.x},${p.z}`)), v = String(p.variant ?? '');
  if (MEDINA_GOODS_RX.test(v)) return consolidate(buildMedinaGoods(p)); // M12 art pass: carts, sacks, baskets (art/medina-kit.js)
  const g = new THREE.Group(); g.name = 'dressing:crates';
  const wood = dressingMaterial('planks');
  if (/drum/.test(v)) {
    const r = Math.min(w, d, h) / 2;
    for (const s of [-1, 1]) {
      const disc = mesh(boxUV(new THREE.CylinderGeometry(r, r, 0.07, 20), 1.2), wood);
      disc.rotation.x = Math.PI / 2; disc.position.set(0, r, s * (r * 0.55)); g.add(disc);
    }
    const coil = mesh(new THREE.CylinderGeometry(r * 0.78, r * 0.78, r * 1.05, 20), dressingMaterial('logsTarred'));
    coil.rotation.x = Math.PI / 2; coil.position.y = r; g.add(coil);
    return consolidate(g);
  }
  if (/debris|timber|plank/.test(v)) {
    for (let k = 0; k < 9; k++) {
      const L = 1.2 + R() * (w - 0.4), t = 0.05 + R() * 0.1;
      const b = mesh(boxUV(new THREE.BoxGeometry(L, t, 0.2 + R() * 0.1), 1.5), wood);
      b.position.set((R() - 0.5) * w * 0.4, t / 2 + (k % 3) * 0.12, (R() - 0.5) * d * 0.6);
      b.rotation.set((R() - 0.5) * 0.3, R() * Math.PI, (R() - 0.5) * 0.2);
      g.add(b);
    }
    return consolidate(g);
  }
  // a stack: two or three crates on the ground, maybe one on top
  const n = w * d > 3 ? 3 : 2, cs = Math.min(w, d) * 0.55;
  for (let k = 0; k < n; k++) {
    const s = cs * (0.8 + R() * 0.25), top = k === 2 && h > cs * 1.3;
    const b = mesh(boxUV(new THREE.BoxGeometry(s, s * 0.8, s), 0.9), wood);
    b.position.set(top ? 0 : (k ? 1 : -1) * cs * 0.52, top ? cs * 0.8 + s * 0.4 : s * 0.4, top ? 0 : (R() - 0.5) * 0.3);
    b.rotation.y = (R() - 0.5) * 0.35;
    g.add(b);
  }
  return consolidate(g);
}

let PORCELAIN = null;
/** Electrical transformer on a concrete plinth: finned tank, three porcelain bushings. Other generators: a genset. */
export function buildGenerator(p) {
  const w = p.w ?? 2, d = p.d ?? 1.4, h = p.h ?? 1.2;
  const g = new THREE.Group(); g.name = 'dressing:generator';
  const plinth = mesh(boxUV(new THREE.BoxGeometry(w, 0.25, d), 1.5), dressingMaterial('plinth'));
  plinth.position.y = 0.125; g.add(plinth);
  const steel = dressingMaterial('steel');
  const tw = w * 0.62, td = d * 0.55, th = (h - 0.25) * (/transformer/.test(String(p.variant ?? '')) ? 0.72 : 0.85);
  const tank = mesh(boxUV(new THREE.BoxGeometry(tw, th, td), 1.2), steel);
  tank.position.y = 0.25 + th / 2; g.add(tank);
  if (/transformer/.test(String(p.variant ?? ''))) {
    for (const s of [-1, 1]) for (let k = 0; k < 7; k++) {   // radiator fins
      const fin = mesh(new THREE.BoxGeometry(0.03, th * 0.85, 0.22), steel);
      fin.position.set(-tw / 2 + 0.1 + k * (tw - 0.2) / 6, 0.25 + th / 2, s * (td / 2 + 0.11)); g.add(fin);
    }
    const porcelain = PORCELAIN ||= new THREE.MeshStandardMaterial({ color: 0x5a3b2a, roughness: 0.35, name: 'dressing:porcelain' });
    for (let k = -1; k <= 1; k++) {
      const bush = mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.45, 8), porcelain);
      bush.position.set(k * tw * 0.3, 0.25 + th + 0.22, 0); g.add(bush);
    }
  }
  return consolidate(g);
}

const _up = new THREE.Vector3(0, 1, 0);
/** Box beam from a to b (square section t), as a standalone geometry (for merging). */
function beam(a, b, t) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const g = new THREE.BoxGeometry(t, L, t);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Steel lattice tower (power pylon / radio mast): four tapering legs, X-bracing every ~2.2 m, cross-arms with
 * insulator strings (pylons). One merged mesh.
 */
export function buildLattice(p, { base = 3, top = 0.7, arms = true } = {}) {
  const H = p.h ?? 18, body = arms ? H * 0.82 : H;
  const half = (y) => (base + (top - base) * Math.min(1, y / body)) / 2;
  const parts = [], corner = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [cx, cz] of corner) parts.push(beam(V3(cx * half(0), 0, cz * half(0)), V3(cx * half(body), body, cz * half(body)), 0.1));
  const lv = Math.max(3, Math.round(body / 2.2));
  for (let k = 0; k < lv; k++) {
    const y0 = (body * k) / lv, y1 = (body * (k + 1)) / lv, a = half(y0), b = half(y1);
    for (let f = 0; f < 4; f++) {
      const [ax, az] = corner[f], [bx, bz] = corner[(f + 1) % 4];
      parts.push(beam(V3(ax * a, y0, az * a), V3(bx * b, y1, bz * b), 0.05), beam(V3(bx * a, y0, bz * a), V3(ax * b, y1, az * b), 0.05));
      parts.push(beam(V3(ax * b, y1, az * b), V3(bx * b, y1, bz * b), 0.06));
    }
  }
  if (arms) {
    const t = half(body);
    parts.push(beam(V3(-t, body, -t), V3(0, H, 0), 0.08), beam(V3(t, body, t), V3(0, H, 0), 0.08), beam(V3(t, body, -t), V3(0, H, 0), 0.08), beam(V3(-t, body, t), V3(0, H, 0), 0.08));
    for (const [y, L] of [[H * 0.72, 3.4], [body, 2.6]]) {
      const hw = half(y);
      for (const sz of [-1, 1]) parts.push(beam(V3(-L, y, sz * hw), V3(L, y, sz * hw), 0.09), beam(V3(-L, y, 0), V3(-hw, y - 0.9, sz * hw), 0.05), beam(V3(L, y, 0), V3(hw, y - 0.9, sz * hw), 0.05));
      for (const x of [-L + 0.15, L - 0.15]) { const ins = new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6); ins.translate(x, y - 0.6, 0); parts.push(ins); }
    }
  }
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
  geo.computeVertexNormals();
  boxUV(geo, 1.5);
  const g = new THREE.Group(); g.name = 'dressing:lattice';
  g.add(mesh(geo, dressingMaterial('galv')));
  return g;
}

/** Creosoted telegraph pole: pole, cross-arm, braces and four glass insulators (one merged mesh + insulators). */
export function buildPole(p) {
  const H = p.h ?? 7;
  const pole = new THREE.CylinderGeometry(0.1, 0.13, H + 0.4, 9); pole.translate(0, (H + 0.4) / 2 - 0.4, 0);
  const parts = [pole, beam(V3(-0.75, H - 0.45, 0.13), V3(0.75, H - 0.45, 0.13), 0.09), beam(V3(-0.4, H - 0.45, 0.13), V3(0, H - 0.95, 0.13), 0.04), beam(V3(0.4, H - 0.45, 0.13), V3(0, H - 0.95, 0.13), 0.04)];
  const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
  geo.computeVertexNormals();
  boxUV(geo, 1.2);
  const g = new THREE.Group(); g.name = 'dressing:pole';
  g.add(mesh(geo, dressingMaterial('creosote')));
  const glass = GLASS ||= new THREE.MeshStandardMaterial({ color: 0x6f8f86, roughness: 0.2, name: 'dressing:insulator' });
  const ins = mergeGeometries([-0.62, -0.25, 0.25, 0.62].map((x) => new THREE.CylinderGeometry(0.035, 0.05, 0.12, 6).translate(x, H - 0.34, 0.13)), false);
  g.add(mesh(ins, glass, false));
  return g;
}
let GLASS = null;

/**
 * Timber wall-walk deck (mission `walkways` on a wall): plank deck strips [{ax, az, bx, bz, off, width, y}] (off =
 * across offset of the strip centre from the a→b line, left normal positive) on posts every ~2 m at the inner edge.
 * The strips are computed by the map builder so the deck stops at the wall's inner face (never through it).
 */
export function buildWalkDeck(strips) {
  const root = new THREE.Group(); root.name = 'dressing:walkway';
  const planks = dressingMaterial('planks'), posts = dressingMaterial('logsTarred');
  for (const s of strips) {
    const L = Math.hypot(s.bx - s.ax, s.bz - s.az);
    if (L < 0.2 || s.width < 0.2) continue;
    const tx = (s.bx - s.ax) / L, tz = (s.bz - s.az) / L, nx = -tz, nz = tx;
    const cx = (s.ax + s.bx) / 2 + nx * s.off, cz = (s.az + s.bz) / 2 + nz * s.off, rot = -Math.atan2(tz, tx);
    const deck = mesh(new THREE.BoxGeometry(L, 0.08, s.width), planks);
    deck.position.set(cx, s.y - 0.04, cz); deck.rotation.y = rot;
    root.add(deck);
    const n = Math.max(1, Math.round(L / 2));
    for (let k = 0; k <= n; k++) {
      const u = -L / 2 + 0.15 + ((L - 0.3) * k) / n, e = s.off + s.width / 2 - 0.1;
      const post = mesh(new THREE.BoxGeometry(0.14, s.y - 0.08, 0.14), posts);
      post.position.set((s.ax + s.bx) / 2 + tx * u + nx * e, (s.y - 0.08) / 2, (s.az + s.bz) / 2 + tz * u + nz * e);
      post.rotation.y = rot;
      root.add(post);
    }
  }
  return consolidate(root);
}
