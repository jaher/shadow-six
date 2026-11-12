/**
 * Instanced 3D forests (user 2026-11-10: "No trees are a single billboard. All trees are detailed"). The trees past
 * the unique budget (vegetation.js heroSplit: the scenery apron's whole forest, dense stands on the lower presets) are
 * copies of a few real generated prototypes per species and look (bare, burnt) — the same trunk, limbs and crown of
 * leaf / needle sprays on the same envelope as the unique trees, reduced (treegen TREE_LOD), nothing baked flat. Every
 * copy has its own seeded yaw, size, crown width (±8 %), lean, sway phase and colour (the tints its seed would have
 * grown as a unique tree: treegen.js treeLook), and draws with the unique trees' own bark / leaf / needle shaders
 * (wind, snow, seasons, translucency, alpha-tested shadow casters: vegetation.js).
 *
 * Two levels: LOD1 for the copies in view (their own shadows too: a crown shadows itself right), LOD2 for the copies
 * out of view whose shadow reaches into it (with a low sun ten times as many as stand in it: their silhouettes, cheap).
 * A handful of draws for a whole forest: one per level, material (bark, leaves, needles) and size class. The
 * prototypes' vertices live in float textures and every copy's vertex shader pulls its own prototype's triangles
 * (gl_VertexID → corner → vertex; the class's draw gives every copy the corner count of its largest prototype, the rest
 * pad with zero-area triangles). Each draw takes only the copies its view can show: the draws' own frustum tests cull
 * the forest for the view being drawn (once, cached) — bounding sphere in the view frustum; for the sun's shadow map,
 * the sphere swept along the sun down to the ground — and the survivors go front to back into an instance texture
 * that three uploads at the draw itself; a draw with no copy there is not issued at all.
 * @module terrain/tree-lod
 */
import * as THREE from 'three';

/** Texels a row in the vertex / corner textures (a power of two: shifts in the shader). */
export const LOD_TEX_W = 1024;
/** Instances a row of the instance texture (2 texels each). */
export const LOD_INST_ROW = 512;
/** Corner value of a padding triangle (every corner at the root: zero area). */
export const LOD_DEAD = 0xffffffff;
/** Views whose culled instances a forest keeps at once (the main view, the water mirrors', a lens). */
const LOD_VIEWS = 4;
/**
 * Metres outside the view over which an off-screen copy's shadow turns from LOD1 into LOD2: both cast there, through
 * complementary dither masks in proportion (tree-lod LOD_DITHER_GLSL), so a shadow reaching into the view morphs while
 * the view pans instead of switching when its tree crosses the edge.
 */
export const LOD_SHADOW_BAND = 12;
/** A size class keeps prototypes down to this share of its largest one (the rest of the draw is padding: zero-area
 * triangles, nearly free to draw but counted by three's frame stats). Coarser classes would save a few draws (consecutive
 * draws share their material: cheap) for more padded triangles in the tight frames (M2's default view: a low sun, 22
 * copies' shadows). */
export const LOD_BUCKET_FILL = [0.68, 0.68];
const MATS = ['bark', 'leaf', 'needle'];

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Unit normal → 24-bit octahedral code (2 × 12 bits). */
export function oct24(x, y, z) {
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / s, v = y / s;
  if (z < 0) { const u0 = u; u = (1 - Math.abs(v)) * (u0 >= 0 ? 1 : -1); v = (1 - Math.abs(u0)) * (v >= 0 ? 1 : -1); }
  return Math.round((u * 0.5 + 0.5) * 4095) + 4096 * Math.round((v * 0.5 + 0.5) * 4095);
}
/** RGB multiplier 0..2 → 24 bits (8 a channel). */
export const rgb24 = (r, g, b) => clamp(Math.round(r * 127.5), 0, 255) + 256 * clamp(Math.round(g * 127.5), 0, 255) + 65536 * clamp(Math.round(b * 127.5), 0, 255);
/** Crown AO 0..1 and signed snow catch −1..1 → 24 bits. */
const ext24 = (ao, sn) => clamp(Math.round(ao * 4095), 0, 4095) + 4096 * clamp(Math.round((sn * 0.5 + 0.5) * 4095), 0, 4095);

/**
 * Prototype arrays for the GPU (pure; the session cache keeps them): per material, every prototype's vertices
 * (3 RGBA32F texels each: position + atlas layer; octahedral normal, sway, flex, phase; uv, tint, crown AO + snow catch)
 * and its corners (vertex indices) padded to its size class, with each prototype's first corner.
 * @param {{H:number, kind:number, bark:object|null, leaf:object|null, needle:object|null}[]} protos GeoAcc-like
 *   accumulators (p, n, uv, info, tint, ext, idx; tree-local, root at the origin)
 * @returns {{protos: {H:number, kind:number, cy:number, r:number}[], mats: object, bytes: number}}
 */
export function packLodBank(protos, fill = LOD_BUCKET_FILL[0]) {
  const mats = {};
  let bytes = 0;
  for (const m of MATS) {
    const have = protos.map((P, i) => [i, P[m]]).filter(([, a]) => a && a.idx.length);
    if (!have.length) { mats[m] = null; continue; }
    const nV = have.reduce((s, [, a]) => s + a.p.length / 3, 0);
    const vRows = Math.ceil((nV * 3) / LOD_TEX_W);
    const vData = new Float32Array(LOD_TEX_W * vRows * 4);
    const vBase = new Int32Array(protos.length).fill(-1);
    let v = 0;
    for (const [i, a] of have) {
      vBase[i] = v;
      const n = a.p.length / 3;
      for (let k = 0; k < n; k++, v++) {
        const o = v * 12;
        vData[o] = a.p[k * 3]; vData[o + 1] = a.p[k * 3 + 1]; vData[o + 2] = a.p[k * 3 + 2]; vData[o + 3] = a.info[k * 4];
        vData[o + 4] = oct24(a.n[k * 3], a.n[k * 3 + 1], a.n[k * 3 + 2]); vData[o + 5] = a.info[k * 4 + 1]; vData[o + 6] = a.info[k * 4 + 2]; vData[o + 7] = a.info[k * 4 + 3];
        vData[o + 8] = a.uv[k * 2]; vData[o + 9] = a.uv[k * 2 + 1];
        vData[o + 10] = rgb24(a.tint[k * 3], a.tint[k * 3 + 1], a.tint[k * 3 + 2]);
        vData[o + 11] = ext24(a.ext ? a.ext[k * 2] : 1, a.ext ? a.ext[k * 2 + 1] : 0);
      }
    }
    // size classes: largest first; a prototype joins the open class while it has `fill` of its corners
    const order = have.map(([i, a]) => [i, a.idx.length]).sort((p, q) => q[1] - p[1] || p[0] - q[0]);
    const buckets = [], bucket = new Int8Array(protos.length).fill(-1);
    for (const [i, c] of order) {
      let b = buckets[buckets.length - 1];
      if (!b || c < b.corners * fill) { b = { corners: c, protos: [] }; buckets.push(b); }
      b.protos.push(i); bucket[i] = buckets.length - 1;
    }
    const nC = buckets.reduce((s, b) => s + b.corners * b.protos.length, 0);
    const cRows = Math.ceil(nC / LOD_TEX_W);
    const cData = new Uint32Array(LOD_TEX_W * cRows).fill(LOD_DEAD);
    const base = new Int32Array(protos.length).fill(-1);
    let c = 0;
    for (const b of buckets) for (const i of b.protos) {
      const a = protos[i][m];
      base[i] = c;
      for (let k = 0; k < a.idx.length; k++) cData[c + k] = vBase[i] + a.idx[k];
      c += b.corners;
    }
    mats[m] = { vData, vRows, cData, cRows, base, bucket, buckets: buckets.map((b) => ({ corners: b.corners, protos: b.protos })), verts: nV, corners: nC };
    bytes += vData.byteLength + cData.byteLength;
  }
  // bounds: the crown's vertical centre and the radius round it (any yaw: about the trunk axis)
  const meta = protos.map((P) => {
    let y0 = Infinity, y1 = -Infinity;
    for (const m of MATS) { const a = P[m]; if (!a) continue; for (let k = 1; k < a.p.length; k += 3) { y0 = Math.min(y0, a.p[k]); y1 = Math.max(y1, a.p[k]); } }
    if (!(y1 >= y0)) { y0 = 0; y1 = P.H || 1; }
    const cy = (y0 + y1) / 2;
    let r2 = 0;
    for (const m of MATS) { const a = P[m]; if (!a) continue; for (let k = 0; k < a.p.length; k += 3) { const dx = a.p[k], dy = a.p[k + 1] - cy, dz = a.p[k + 2]; r2 = Math.max(r2, dx * dx + dy * dy + dz * dz); } }
    return { H: P.H, kind: P.kind, cy, r: Math.sqrt(r2) };
  });
  return { protos: meta, mats, bytes };
}

/** GPU textures of a packed bank (per material: vertices RGBA32F, corners R32UI). Dispose with disposeLodTextures. */
export function lodTextures(bank) {
  const out = {};
  for (const m of MATS) {
    const M = bank.mats[m];
    if (!M) { out[m] = null; continue; }
    const v = new THREE.DataTexture(M.vData, LOD_TEX_W, M.vRows, THREE.RGBAFormat, THREE.FloatType);
    const c = new THREE.DataTexture(M.cData, LOD_TEX_W, M.cRows, THREE.RedIntegerFormat, THREE.UnsignedIntType);
    c.internalFormat = 'R32UI';
    for (const t of [v, c]) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.flipY = false; t.needsUpdate = true; }
    v.name = `treeLod:${m}:verts`; c.name = `treeLod:${m}:corners`;
    out[m] = { v, c };
  }
  return out;
}
export function disposeLodTextures(t) { for (const m of MATS) { t?.[m]?.v.dispose(); t?.[m]?.c.dispose(); } }

/**
 * Vertex shader part of the instanced (pulled) trees: declares the globals the vegetation shader reads from attributes
 * on the unique trees (aInfo, aTint, aExt, aRoot) plus lPos / lNrm / lUv, and lodFetch() — called first in main() —
 * fills them for this gl_VertexID of this instance: the prototype vertex, scaled (crown width), turned, leant and
 * placed; its tint times the instance's own; its phase shifted by the instance's.
 */
export const LOD_VERT_GLSL = /* glsl */ `
uniform highp sampler2D uLodV;    // prototype vertices: 3 RGBA32F texels each (tree-local, root at the origin)
uniform highp usampler2D uLodC;   // prototype corners → vertex (R32UI; ${LOD_DEAD >>> 0}u = padding)
uniform highp sampler2D uLodI;    // this draw's instances: 2 texels each, ${LOD_INST_ROW} a row
// this draw's first instance slot in the view / the shadow pass: a constant of the draw's geometry (one value for every
// instance), so every draw of a material and level shares one material (three re-uploads uniforms on a switch)
attribute float iLodView;
attribute float iLodShadow;
flat varying float vLodFade;      // LOD1's share of this copy's shadow (LOD_DITHER_GLSL)
vec3 lPos;
vec3 lNrm;
vec2 lUv;
ivec2 lodTx(int i) { return ivec2(i & ${LOD_TEX_W - 1}, i >> ${Math.log2(LOD_TEX_W)}); }
float lodHash(float x) { return fract(sin(x * 12.9898 + 0.731) * 43758.5453); }
vec3 lodRGB(float p) { uint u = uint(p); return vec3(float(u & 255u), float((u >> 8u) & 255u), float(u >> 16u)) * (2.0 / 255.0); }
void lodFetch() {
#ifdef LOD_SHADOW
  int s = int(iLodShadow) + gl_InstanceID;
#else
  int s = int(iLodView) + gl_InstanceID;
#endif
  ivec2 si = ivec2((s & ${LOD_INST_ROW - 1}) << 1, s >> ${Math.log2(LOD_INST_ROW)});
  vec4 A = texelFetch(uLodI, si, 0);           // x, y, z, yaw (mrad) + 8192 · scale (1/500)
  vec4 B = texelFetch(uLodI, si + ivec2(1, 0), 0); // first corner, H + 100 · kind, phase + 8 · LOD1 shadow share, tint
  float fq = floor(B.z / 8.0);
  B.z -= 8.0 * fq;
  vLodFade = fq / 255.0;
  aRoot = vec4(A.xyz, B.y);
  uint v = texelFetch(uLodC, lodTx(int(B.x) + gl_VertexID), 0).r;
  if (v == ${LOD_DEAD >>> 0}u) {
    // padding: every corner of the triangle on the root, same inputs → zero area after the wind too
    lPos = A.xyz; lNrm = vec3(0.0, 1.0, 0.0); lUv = vec2(0.0); aInfo = vec4(0.0); aTint = vec3(0.0);
#ifdef VEG_LEAF
    aExt = vec2(0.0);
#endif
    return;
  }
  int k = int(v) * 3;
  vec4 t0 = texelFetch(uLodV, lodTx(k), 0), t1 = texelFetch(uLodV, lodTx(k + 1), 0), t2 = texelFetch(uLodV, lodTx(k + 2), 0);
  float yaw = mod(A.w, 8192.0) * 0.001, sc = floor(A.w / 8192.0) * 0.002;
  float sxz = sc * (0.92 + 0.16 * lodHash(B.z));          // crown width ±8 %
  uint on = uint(t1.x);
  vec2 e = vec2(float(on & 4095u), float(on >> 12u)) * (2.0 / 4095.0) - 1.0;
  vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  float tf = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -tf : tf; n.y += n.y >= 0.0 ? -tf : tf;
  vec3 p = t0.xyz * vec3(sxz, sc, sxz);
  n = n * vec3(sc, sxz, sc);                             // (inverse transpose of the scale)
  float cy = cos(yaw), sy = sin(yaw);
  p = vec3(cy * p.x + sy * p.z, p.y, cy * p.z - sy * p.x);
  n = vec3(cy * n.x + sy * n.z, n.y, cy * n.z - sy * n.x);
  p.xz += (vec2(lodHash(B.z + 1.7), lodHash(B.z + 3.1)) - 0.5) * 0.06 * p.y;   // lean ±1.7°
  lPos = p + A.xyz;
  lNrm = normalize(n);
  lUv = t2.xy;
  aInfo = vec4(t0.w, t1.yz, t1.w + B.z);
  aTint = lodRGB(t2.z) * lodRGB(B.w);
#ifdef VEG_LEAF
  uint ex = uint(t2.w);
  aExt = vec2(float(ex & 4095u) / 4095.0, float(ex >> 12u) / 2047.5 - 1.0);
#endif
}
`;

/**
 * Fragment part of the instanced forest's shadow casters: a copy's LOD1 and LOD2 shadows cross-fade through
 * complementary masks of the shadow map's texels (`uLodFar` 0: LOD1 keeps the share vLodFade, 1: LOD2 the rest), so
 * a copy entering the view brings its detailed shadow in by degrees. lodDither() first in main().
 */
export const LOD_DITHER_GLSL = /* glsl */ `
flat varying float vLodFade;
uniform float uLodFar;
void lodDither() {
  float h = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  if (uLodFar < 0.5 ? h >= vLodFade : h < vLodFade) discard;
}
`;

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

/** The scene's sun: the first directional light that casts shadows under the root of `o` (null: none). */
function sunOf(o) {
  let root = o;
  while (root.parent) root = root.parent;
  let sun = null;
  root.traverse((x) => { if (!sun && x.isDirectionalLight && x.castShadow) sun = x; });
  return sun;
}

/**
 * One instanced forest: per instance its texels, its lists (level × material × size class) and its bounds; the
 * instance texture; the per-view cull. Two levels of the same prototypes (tree-lod LOD1 / LOD2, treegen TREE_LOD):
 * a tree in the view draws LOD1 — and casts LOD1's shadow, so its crown shadows itself right — and a tree out of the
 * view whose shadow reaches into it casts LOD2's (its silhouette, a fraction of the triangles: with a low sun, ten
 * times as many trees cast into a view as stand in it).
 * `inst`: {x, y, z, yaw, scale, proto, phase, bark: [r, g, b], leaf: [r, g, b], bare}.
 */
export class LodForest {
  /** @param {ReturnType<typeof packLodBank>[]} banks [LOD1, LOD2] (same prototypes) @param {object[]} inst */
  constructor(banks, inst) {
    const n = inst.length, nL = banks.length;
    this.n = n;
    this.banks = banks;
    this.lists = [];
    const listOf = banks.map((bank, lv) => Object.fromEntries(MATS.map((m) => [m, bank.mats[m] ? bank.mats[m].buckets.map((b, bi) => {
      const l = { level: lv, mat: m, bucket: bi, corners: b.corners, members: 0, view: 0, shadow: 0, nView: 0, nShadow: 0 };
      this.lists.push(l);
      return l;
    }) : []])));
    // static per instance: bounding sphere, texel A, list memberships (≤ one a material and level) with their texel B
    this.S = new Float32Array(n * 4);
    this.A = new Float32Array(n * 4);
    this.memb = new Int16Array(n * 3 * nL).fill(-1);
    this.B = new Float32Array(n * 3 * nL * 4);
    let maxR = 0;
    const box = new THREE.Box3(), v = new THREE.Vector3();
    inst.forEach((t, i) => {
      const P = banks[0].protos[t.proto], sc = clamp(t.scale, 0.05, 4.09);
      const H = Math.min(99, P.H * sc);
      this.A.set([t.x, t.y, t.z, (Math.round((((t.yaw % 6.2832) + 6.2832) % 6.2832) * 1000) % 6284) + 8192 * Math.round(sc * 500)], i * 4);
      // conservative: crown width (+8 %), lean, wind sway (trunk bend ∝ H)
      const r = P.r * sc * 1.12 + 0.12 * H + 0.5;
      this.S.set([t.x, t.y + P.cy * sc, t.z, r], i * 4);
      maxR = Math.max(maxR, r);
      box.expandByPoint(v.set(t.x, t.y + P.cy * sc, t.z));
      banks.forEach((bank, lv) => MATS.forEach((m, j) => {
        const M = bank.mats[m];
        if (!M || M.base[t.proto] < 0) return;
        const l = listOf[lv][m][M.bucket[t.proto]], k = (i * nL + lv) * 3 + j;
        this.memb[k] = this.lists.indexOf(l);
        l.members++;
        const tint = m === 'bark' || t.bare ? t.bark : t.leaf;
        // (the phase kept under 2π: the shadow share rides on it, phase + 8 · share)
        this.B.set([M.base[t.proto], H + 100 * P.kind, ((t.phase % 6.2832) + 6.2832) % 6.2832, rgb24(tint[0], tint[1], tint[2])], k * 4);
      }));
    });
    this.box = box.isEmpty() ? box.set(new THREE.Vector3(), new THREE.Vector3()) : box.expandByScalar(maxR);
    // regions, each from a row start: LOD1 lists a view and a shadow region, LOD2 lists (shadows only) one
    let row = 0;
    for (const l of this.lists) {
      const rows = Math.max(1, Math.ceil(l.members / LOD_INST_ROW));
      if (l.level === 0) { l.view = row * LOD_INST_ROW; row += rows; }
      l.shadow = row * LOD_INST_ROW; row += rows;
    }
    this.rows = Math.max(1, row);
    // one instance texture a view kept (LRU): a frame draws the main view and each water mirror's — while they stand
    // still, a draw only switches textures (no cull, no upload)
    this.slots = Array.from({ length: LOD_VIEWS }, (_, i) => {
      const data = new Float32Array(LOD_INST_ROW * 2 * this.rows * 4);
      const texture = new THREE.DataTexture(data, LOD_INST_ROW * 2, this.rows, THREE.RGBAFormat, THREE.FloatType);
      texture.minFilter = texture.magFilter = THREE.NearestFilter;
      texture.generateMipmaps = false; texture.flipY = false;
      texture.name = `treeLod:instances:${i}`;
      texture.needsUpdate = true;
      return { data, texture, key: new Float64Array(28).fill(NaN), counts: new Int32Array(this.lists.length * 2), used: 0, visible: 0, shadow: 0 };
    });
    this.cur = this.slots[0];
    /** The instance texture of the view being drawn (one uniform object for every draw of the forest). */
    this.uLodI = { value: this.cur.texture };
    this._tick = 0;
    // cull scratch
    this.vis = new Int32Array(n);
    this.depth = new Float32Array(n);
    this.inView = new Uint8Array(n);
    this.fade = new Uint8Array(n);
    this._planes = new Float64Array(24);
    this._kk = new Float64Array(28);
    this.sun = new THREE.Vector3(0, 1, 0);
    /** Level of the off-screen shadow casters (LOD2; tools set 0 to compare) and the cross-fade band (m). */
    this.farLevel = nL - 1;
    this.band = LOD_SHADOW_BAND;
    this.light = null;
    this._lightScan = 0;
    this.stats = { culls: 0, visible: 0, shadow: 0 };
    this._sort = (a, b) => this.depth[a] - this.depth[b];
  }

  /** The sun's shadow frustum (three culls the shadow map's casters with it), or null. */
  shadowFrustum(o) {
    // (found once; while there is none, looked for again every 120 asks: a scene walk)
    if (!this.light?.parent && this._lightScan++ % 120 === 0) this.light = sunOf(o);
    return this.light?.shadow?.getFrustum?.() ?? null;
  }

  /**
   * Cull for a view frustum (world space; `object`: one of the forest's meshes, for its world matrix) and write the
   * survivors front to back: LOD1 lists, the trees in view (their view and shadow regions); LOD2 lists, the trees out
   * of view whose shadow (the bounding sphere swept along the sun to the ground) reaches into it. Cached: redone only
   * when the view, the mesh or the sun moved. @returns {boolean} culled anew
   */
  cull(frustum, object) {
    const L = this.light, sunOn = !!(L && L.castShadow && L.visible !== false);
    if (sunOn) {
      _a.setFromMatrixPosition(L.matrixWorld); _b.setFromMatrixPosition(L.target.matrixWorld);
      this.sun.subVectors(_a, _b).normalize();
    }
    // the planes in the mesh's frame (its world matrix: a translation for the vegetation groups — rotation handled too)
    const ow = object.matrixWorld.elements, Q = this._planes, k = this._kk;
    for (let p = 0; p < 6; p++) {
      const pl = frustum.planes[p], nx = pl.normal.x, ny = pl.normal.y, nz = pl.normal.z;
      let lx = ow[0] * nx + ow[1] * ny + ow[2] * nz, ly = ow[4] * nx + ow[5] * ny + ow[6] * nz, lz = ow[8] * nx + ow[9] * ny + ow[10] * nz;
      let w = pl.constant + nx * ow[12] + ny * ow[13] + nz * ow[14];
      const s = Math.hypot(lx, ly, lz) || 1;
      lx /= s; ly /= s; lz /= s; w /= s;
      Q[p * 4] = lx; Q[p * 4 + 1] = ly; Q[p * 4 + 2] = lz; Q[p * 4 + 3] = w;
    }
    for (let i = 0; i < 24; i++) k[i] = Q[i];
    k[24] = sunOn ? this.sun.x : 0; k[25] = sunOn ? this.sun.y : 0; k[26] = sunOn ? this.sun.z : 0; k[27] = this.n;
    // a view culled before: its texture and counts again
    let slot = null, lru = this.slots[0];
    for (const sl of this.slots) {
      let same = true;
      for (let i = 0; i < 28; i++) if (k[i] !== sl.key[i]) { same = false; break; }
      if (same) { slot = sl; break; }
      if (sl.used < lru.used) lru = sl;
    }
    if (slot) { this._use(slot); return false; }
    slot = lru;
    slot.key.set(k);
    this.cur = slot;
    this.stats.culls++;
    const S = this.S, n = this.n, nL = this.banks.length;
    const sun = sunOn && this.sun.y > 0.05 ? this.sun : null;
    const sx = sun ? sun.x : 0, sy = sun ? sun.y : 1, sz = sun ? sun.z : 0;
    let nv = 0, nIn = 0;
    for (let i = 0; i < n; i++) {
      const cx = S[i * 4], cy = S[i * 4 + 1], cz = S[i * 4 + 2], r = S[i * 4 + 3];
      // how far the sphere lies outside the view (0: it touches it)
      let out = 0;
      for (let p = 0; p < 24; p += 4) { const d = -(Q[p] * cx + Q[p + 1] * cy + Q[p + 2] * cz + Q[p + 3]) - r; if (d > out) out = d; }
      const inV = out > 0 ? 0 : 1;
      if (!inV) {
        if (!sun) continue;
        // its shadow: the sphere swept along the sun down to 3 m under its foot (slopes); the PCF filter's reach
        const t = (2 * r + 3) / sy, dx = cx - sx * t, dy = cy - sy * t, dz = cz - sz * t, rr = -r - 1.5;
        let hit = 1;
        for (let p = 0; p < 24; p += 4) {
          if (Q[p] * cx + Q[p + 1] * cy + Q[p + 2] * cz + Q[p + 3] < rr && Q[p] * dx + Q[p + 1] * dy + Q[p + 2] * dz + Q[p + 3] < rr) { hit = 0; break; }
        }
        if (!hit) continue;
      }
      this.vis[nv++] = i;
      this.inView[i] = inV;
      // LOD1's share of an off-screen copy's shadow (1 in view, 0 past the band)
      this.fade[i] = inV || this.farLevel === 0 ? 255 : Math.max(0, Math.round(255 * (1 - out / this.band)));
      nIn += inV;
      this.depth[i] = Q[20] * cx + Q[21] * cy + Q[22] * cz; // (near plane: its normal looks into the view)
    }
    const vis = this.vis.subarray(0, nv);
    vis.sort(this._sort); // front to back: early depth rejection under the nearer crowns
    const lists = this.lists, memb = this.memb;
    for (let li = 0; li < lists.length; li++) { lists[li].nView = 0; lists[li].nShadow = 0; }
    for (let q = 0; q < nv; q++) {
      const i = vis[q], inV = this.inView[i], f = this.fade[i];
      if (!inV && !sun) continue;
      // levels: in view LOD1 (view + its own shadow); off screen LOD1 in the band, LOD2 past its start (both in between)
      for (let lv = 0; lv < nL; lv++) {
        const near = lv === 0, far = lv === this.farLevel;
        if (!(near && (inV || f > 0)) && !(far && !inV && f < 255)) continue;
        for (let j = 0; j < 3; j++) {
          const kk = (i * nL + lv) * 3 + j, li = memb[kk];
          if (li < 0) continue;
          const l = lists[li];
          if (sun) this._put(l.shadow + l.nShadow++, i, kk, f);
          if (inV && near) this._put(l.view + l.nView++, i, kk, 255);
        }
      }
    }
    // upload only the rows written (each region starts on a row)
    const T = slot.texture;
    T.clearUpdateRanges();
    for (let li = 0; li < lists.length; li++) {
      const l = lists[li];
      if (l.level === 0) this._range(l.view, l.nView);
      this._range(l.shadow, l.nShadow);
      slot.counts[li * 2] = l.nView; slot.counts[li * 2 + 1] = l.nShadow;
    }
    if (T.updateRanges.length) T.needsUpdate = true;
    slot.visible = nIn; slot.shadow = nv;
    this._use(slot);
    return true;
  }

  /** Draw from a slot: its texture, its lists' counts. */
  _use(slot) {
    slot.used = ++this._tick;
    this.stats.visible = slot.visible; this.stats.shadow = slot.shadow;
    if (this.cur === slot && this.uLodI.value === slot.texture) return;
    this.cur = slot;
    this.uLodI.value = slot.texture;
    const L = this.lists;
    for (let li = 0; li < L.length; li++) { L[li].nView = slot.counts[li * 2]; L[li].nShadow = slot.counts[li * 2 + 1]; }
  }

  /** Instance i's texels (A, and B of its membership k) into instance slot s of the current view; `f` LOD1's shadow
   * share 0..255, carried over the phase (phase + 8 · f: the phase stays under 2π). */
  _put(s, i, k, f) {
    const D = this.cur.data, A = this.A, B = this.B;
    const o = ((s >> 9) * LOD_INST_ROW * 2 + (s & (LOD_INST_ROW - 1)) * 2) * 4, a = i * 4, b = k * 4;
    D[o] = A[a]; D[o + 1] = A[a + 1]; D[o + 2] = A[a + 2]; D[o + 3] = A[a + 3];
    D[o + 4] = B[b]; D[o + 5] = B[b + 1]; D[o + 6] = B[b + 2] + 8 * f; D[o + 7] = B[b + 3];
  }

  /** Upload ranges (one a row) for `cnt` slots from the row-aligned slot `base`. */
  _range(base, cnt) {
    const W = LOD_INST_ROW * 2 * 4;
    for (let s = 0; s < cnt; s += LOD_INST_ROW) this.cur.texture.addUpdateRange(((base + s) / LOD_INST_ROW) * W, Math.min(LOD_INST_ROW, cnt - s) * 8);
  }

  /**
   * The forest's meshes: one a list, drawing the list's instances with `make(level, mat, {uLodV, uLodC, uLodI},
   * {…, uLodFar})` → {mat, depth} (vegetation.js: the trees' own shaders, pulled; made once a level and material — the
   * list's slots are its geometry's iLodView / iLodShadow, so consecutive draws keep the material). Their frustum test is
   * the forest's cull: a view's projection culls the forest for that view (once — every list asks) and a list draws
   * only when it has instances there; the sun's shadow map draws the lists with shadow casters (LOD2 lists only
   * there). A list is drawn once whatever its count, so the load's warm-up frame compiles every program.
   * @param {object[]} texs per level, lodTextures(bank) @returns {THREE.Mesh[]}
   */
  meshes(texs, make) {
    const out = [], forest = this, made = new Map();
    // a constant of a draw (every instance reads element 0: a divisor past any instance count)
    const constant = (v) => new THREE.InstancedBufferAttribute(new Float32Array([v]), 1, false, 1 << 30);
    for (const l of this.lists) {
      const T = texs[l.level][l.mat];
      const g = new THREE.InstancedBufferGeometry();
      // (three counts a non-indexed draw by its position attribute, and shades flat without a normal attribute: the
      // shaders read neither, so neither is ever bound)
      const pad = new THREE.BufferAttribute(new Int8Array(l.corners), 1);
      g.setAttribute('position', pad);
      g.setAttribute('normal', pad);
      g.setAttribute('iLodView', constant(l.view));
      g.setAttribute('iLodShadow', constant(l.shadow));
      g.instanceCount = 0;
      g.boundingBox = this.box.clone();
      g.boundingSphere = this.box.getBoundingSphere(new THREE.Sphere());
      const key = l.level + l.mat;
      if (!made.has(key)) {
        const u = { uLodV: { value: T.v }, uLodC: { value: T.c }, uLodI: this.uLodI };
        made.set(key, make(l.level, l.mat, u, { ...u, uLodFar: { value: l.level } }));
      }
      const { mat, depth } = made.get(key);
      const mesh = new THREE.Mesh(g, mat);
      mesh.customDepthMaterial = depth;
      mesh.name = (l.level ? 'vegLod2' : 'vegLod') + (l.mat === 'bark' ? 'Bark' : l.mat === 'needle' ? 'Needles' : 'Leaves');
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      // no GTAO prepass (the crowns carry their AO per vertex, like the needles) and no ray hits (no real positions)
      mesh.userData.aoExclude = true;
      mesh.userData.treeLod = l;
      mesh.raycast = () => {};
      let drawn = false, drawnShadow = false;
      const test = mesh.intersectsFrustum;
      mesh.intersectsFrustum = function (frustum) {
        // (three's own test last: the forest's bounds, and a render's extra cull — engine/cull-hooks.js)
        if (frustum === forest.shadowFrustum(this)) return (l.nShadow > 0 || !drawnShadow) && test.call(this, frustum);
        if (l.level > 0) return false;   // LOD2: shadows only
        forest.cull(frustum, this);
        return (l.nView > 0 || !drawn) && test.call(this, frustum);
      };
      mesh.onBeforeRender = function (renderer, scene, camera, geometry) { geometry.instanceCount = l.level > 0 ? 0 : l.nView; };
      mesh.onAfterRender = () => { drawn = true; };
      mesh.onBeforeShadow = function (renderer, object, camera, shadowCamera, geometry) { geometry.instanceCount = l.nShadow; };
      mesh.onAfterShadow = () => { drawnShadow = true; };
      out.push(mesh);
    }
    return out;
  }

  dispose() { for (const s of this.slots) s.texture.dispose(); }
}
