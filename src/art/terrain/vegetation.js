/**
 * createVegetation — every placed tree/bush is generated from its own seed (treegen.js), so no two are alike.
 * Geometry is merged per 20 m chunk into 2 draw calls (bark + foliage cards; conifer needle sprays use their own
 * needle material, so only a chunk mixing broadleaves and conifers has a third) with frustum culling. Past the unique
 * budget (MAX_UNIQUE: the scenery apron's whole forest, dense stands on the lower presets) trees are instanced copies
 * of real 3D prototypes with the same shaders (tree-lod.js): no tree is ever a flat card.
 * Textures: CC0 bark scans, ambientCG leaf-scan cluster cards and the baked needle-spray atlas in sampler2DArrays.
 * Shader: wind sway (trunk) + flutter (cards), bent crown normals, leaf translucency, snow cover, alpha-tested shadows.
 * @module terrain-b/vegetation
 */
import * as THREE from 'three';
import { generateTree, GeoAcc, TREE_QUALITY, TREE_LOD, lodQuality, SPECIES, LEAF_LAYERS, useThree, vertexRoot, treeLook, WIND_KIND } from './treegen.js';
import { packLodBank, lodTextures, disposeLodTextures, LodForest, LOD_VERT_GLSL, LOD_DITHER_GLSL, LOD_BUCKET_FILL } from './tree-lod.js';
import { WIND_GLSL, WIND_UNIFORMS } from '../../world/wind.js';
useThree(THREE);

/** Unique (fully generated) trees per preset; the rest of a forest is drawn as instanced copies of real 3D prototypes
 * (tree-lod.js — user 2026-11-10: "No trees are a single billboard. All trees are detailed"). */
export const MAX_UNIQUE = { low: 150, medium: 300, high: 400, ultra: 500 };
/**
 * The tree set gameplay measures (gameplayBranches): what this quality draws, at every preset — the gun-arc branch cells
 * are part of the gameplay world, which never changes with the graphics preset ('high': the set every run was made on).
 */
export const GAMEPLAY_TREES = 'high';
/**
 * Prototypes a look (species + bare / burnt) of the instanced forest, by how many copies it has: a lone tree one, a
 * common look up to four (the commonest plants of a hedged apron — hedge, hazel — repeat least). Each copy also turns,
 * scales, widens, leans and takes its own colour.
 */
const lodProtos = (n) => (n < 4 ? 1 : n < 120 ? 2 : n < 400 ? 3 : 4);

let _pool = null;
function workerPool(n) {
  if (_pool) return _pool;
  const threeUrl = import.meta.resolve ? import.meta.resolve('three') : null;
  if (!threeUrl || typeof Worker === 'undefined') return null;
  const init = { threeUrl, treegenUrl: new URL('./treegen.js', import.meta.url).href };
  _pool = Array.from({ length: n }, () => {
    const w = new Worker(new URL('./treegen.worker.js', import.meta.url), { type: 'module' });
    // jobs by id: the map's trees and the apron's prototypes may grow at the same time on the same workers
    const jobs = new Map();
    const ready = new Promise((res, rej) => {
      w.onmessage = (e) => {
        if (e.data.ready) return res();
        const ok = jobs.get(e.data.job);
        if (ok) { jobs.delete(e.data.job); ok(e.data.chunks); }
      };
      w.onerror = rej;
    });
    w.postMessage({ init });
    return { w, ready, jobs };
  });
  return _pool;
}
let _job = 0;
async function genInWorkers(chunkList, q, nW) {
  const pool = workerPool(nW);
  if (!pool) return null;
  await Promise.all(pool.map((p) => p.ready));
  const parts = pool.map(() => []);
  chunkList.forEach((c, i) => parts[i % pool.length].push(c));
  const res = await Promise.all(pool.map((p, i) => new Promise((ok) => {
    if (!parts[i].length) return ok([]);
    const job = ++_job;
    p.jobs.set(job, ok);
    p.w.postMessage({ job, q, chunks: parts[i] });
  })));
  return res.flat();
}

/** A worker's packed tree arrays (GeoAcc.toArrays) back to plain per-vertex values (tree-lod.js packLodBank input). */
function unpackArrays(a) {
  if (!a) return null;
  const n = a.p.length / 3, nrm = new Float32Array(n * 3), tint = new Float32Array(n * 3), ext = new Float32Array(n * 2);
  const nS = a.n.length / n, packedN = a.n instanceof Int16Array, tS = a.tint.length / n, packedE = a.ext instanceof Int16Array;
  for (let k = 0; k < n; k++) {
    for (let c = 0; c < 3; c++) {
      nrm[k * 3 + c] = packedN ? Math.max(-1, a.n[k * nS + c] / 32767) : a.n[k * nS + c];
      tint[k * 3 + c] = a.tint instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat(a.tint[k * tS + c]) : a.tint[k * tS + c];
    }
    for (let c = 0; c < 2; c++) ext[k * 2 + c] = packedE ? Math.max(-1, a.ext[k * 2 + c] / 32767) : a.ext[k * 2 + c];
  }
  return { p: a.p, n: nrm, uv: a.uv, info: a.info, tint, ext, idx: a.idx };
}

import { SNOW_COVER_GLSL } from './snowfx.js';
import { hash2 } from './noise.js';
import { loadLayerArray } from './layer-image.js';
import { sessionCache as cache, dataKey } from '../../engine/asset-cache.js';
import { due, runSliced } from '../../engine/slice.js';
import { textureBytes } from '../../engine/scoped-assets.js';
import { HD_TEXTURES, registerHdJob, uploadNow, hdPause } from '../../engine/hd-textures.js';
import { takeReload } from '../../engine/texture-memory.js';

/** GPU compression per strip (engine/gpu-compress.js): the *_n maps carry the alpha-tested coverage in blue (weighted
 * up); foliage_n's alpha holds per-leaf ids read as exact values (autumn turning, twig = 255) → stays uncompressed. */
const STRIP_COMPRESS = { 'foliage_n.webp': { compress: false }, 'needles_n.webp': { weights: [1, 1, 3, 1] } };
const stripOpts = (url, srgb, alpha, tile) => ({ srgb, anisotropy: 4, wrap: alpha ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping, tile,
  ...(STRIP_COMPRESS[url.split('/').pop().replace('.half.', '.')] || {}) });
function loadStrip(url, srgb, alpha, tile) {
  // session cache (engine/asset-cache.js): decoded + uploaded once per page, freed on eviction
  return cache.memoAsync(`strip:${url}|${srgb ? 1 : 0}|${alpha ? 1 : 0}|${tile || '-'}`, () => loadLayerArray(url, stripOpts(url, srgb, alpha, tile)).then((t) => cache.retain(t)), {
    bytes: textureBytes, dispose: (t) => t.dispose(),
  });
}

/**
 * The tree strips [name, sRGB, alpha (clamped), tile px] in createVegetation's order (leaf, bark, bark normal, leaf
 * normal, needle, needle normal). perf/download-speed-2: a load takes their half-size copies (`<name>.half.webp`,
 * tools/perf/strip_tiers.py: the GPU's mip 1 of the original — every game zoom samples that level or smaller) and the
 * originals replace them in place after the loading screen (engine/hd-textures.js registerHdJob).
 */
const STRIP_SPECS = [['foliage', true, true, 512], ['bark_albedo', true, false], ['bark_normal', false, false], ['foliage_n', false, true, 256], ['needles', true, true], ['needles_n', false, true]];
const HALF_STRIPS = HD_TEXTURES;
/** Strips that always load at full size: the alpha-tested coverage (b) of the leaf / needle sprays — a half copy moved
 * the snow-clump and needle edges at zoom 1 (thresholds flip on small value changes), unlike the colour and bark maps. */
const FULL_ONLY = new Set(['foliage_n', 'needles_n']);
const halved = (name, half) => half && !FULL_ONLY.has(name);
const stripFile = (name, half) => `${name}${halved(name, half) ? '.half' : ''}.webp`;

/** A full-size strip array takes the half-size one's place in place (same texture object: every material keeps it). */
function swapStrip(dst, src) {
  if (!!dst.isCompressedTexture !== !!src.isCompressedTexture) { src.dispose(); return false; }
  dst.dispose(); // (its GPU copy goes; three makes a new one at the new size on the upload below)
  dst.source = src.source;
  if (dst.isCompressedTexture) { dst.mipmaps = src.mipmaps; dst.format = src.format; }
  takeReload(dst, src);
  dst.userData.url = src.userData.url;
  dst.userData.hdUpgraded = src.userData.url;
  dst.needsUpdate = true;
  uploadNow(dst);
  return true;
}

/** Bytes of a worker chunk result (typed arrays). */
const chunkBytes = (out) => out.reduce((n, r) => n + [r.bark, r.leaf].reduce((m, a) => m + (a ? Object.values(a).reduce((k, v) => k + (v?.byteLength || 0), 0) : 0), 0), 0);

/** Hierarchical (SpeedTree-style) wind, step 4w: trunk bend from the root + branch sway + leaf flutter + palm whip,
 * all from the shared WindField sampled at the tree root (gust fronts roll through canopies tree by tree).
 * `lod`: the instanced forest's pulled vertices (tree-lod.js) — aExt / aInfo / aTint / aRoot are globals lodFetch()
 * fills, not attributes. */
const vpars = (leaf, needle = false, lod = false) => {
  const att = lod ? '' : 'attribute ';
  return WIND_GLSL + (leaf ? '#define VEG_LEAF\n' : '') + (needle ? '#define VEG_NEEDLE\n' : '') + /* glsl */ `
#ifdef VEG_LEAF
${att}vec2 aExt;  // crown AO, signed snow catch (broadleaf.js / shrubs.js; conifers.js on the needle material)
varying vec2 vExt;
#ifndef VEG_NEEDLE
varying vec2 vLeaf;   // per-card random, species kind (0 broad, 1 conifer, 2 palm, 3 bush)
#endif
#endif
${att}vec4 aInfo;   // layer, sway weight (height), flex (0 trunk .. 1 leaf), phase
${att}vec3 aTint;
vec4 aRoot;
` + (lod ? LOD_VERT_GLSL : /* glsl */ `
// the vertex's tree root x, y, z, H + 100·kind (0 broad, 1 conifer, 2 palm, 3 bush): one entry a tree in uRoots (RGBA32F,
// 1024 a row), its row in the 4th component of the packed normal (aNrm4: the normal's own buffer); geometries with
// per-vertex roots (GeoAcc.toGeometry: test cards) have no aNrm4 (w reads 1) and use aRootV
attribute vec4 aRootV;
attribute vec4 aNrm4;
uniform highp sampler2D uRoots;
vec4 vegRoot() {
  float w = aNrm4.w;
  if (w > 0.99997) return aRootV;
  int id = int(w * 32767.0 + 0.5);
  return texelFetch(uRoots, ivec2(id & 1023, id >> 10), 0);
}
`) + /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform float uWindStr; // 0..1 multiplier
uniform vec4 uAgit[8];  // movers brushing through bushes / low boughs: x, z, strength, radius (createVegetation.agitate)
varying vec3 vVUv;
varying vec3 vTint;
varying vec3 vScWP;
varying vec3 vScWN;
varying float vFlex;
vec3 vegWind(vec3 p) {
  float kind = floor(aRoot.w / 100.0), H = max(aRoot.w - kind * 100.0, 0.5);
  vec3 rel = p - aRoot.xyz;
  vec4 w = windSample(aRoot.xz);
  float ws = windStr(w) * uWindStr, gp = w.z * uWindStr, t = uWindA.w;
  vec2 wd = length(w.xy) > 1e-3 ? normalize(w.xy) : uWindA.xy, wn = vec2(-wd.y, wd.x);
  float stiff = kind < 0.5 ? 1.0 : kind < 1.5 ? 0.65 : kind < 2.5 ? 1.35 : 1.25;
  // 1. trunk: static lean (drag ∝ v²) + sway at the tree's natural frequency (≈ 3.5/H Hz), cantilever h² profile
  float f0 = clamp(3.5 / H, 0.18, 1.3);
  float lean = (ws * ws * 0.1 + gp * 0.04 * (0.3 + ws)) * stiff;
  float osc = sin(6.2831 * f0 * t + aInfo.w) * (0.01 * uWindStr + 0.045 * ws + 0.05 * gp) * stiff;
  float oscL = sin(6.2831 * f0 * 1.37 * t + aInfo.w * 1.7) * (0.005 * uWindStr + 0.02 * ws + 0.02 * gp) * stiff;
  float h = clamp(rel.y / H, 0.0, 1.2);
  vec2 trunk = (wd * (lean + osc) + wn * oscL) * H * h * h;
  // 2. branches: flex × distance from the trunk, own frequency and phase from the branch position
  float bf = 1.0 + 0.7 * fract(aInfo.w * 0.159), bph = aInfo.w * 3.1 + dot(rel, vec3(0.7, 0.4, 0.6));
  float bamp = aInfo.z * (0.012 * uWindStr + 0.05 * ws + 0.08 * gp) * (0.3 + length(rel.xz) * 0.3) * stiff;
  vec3 off = vec3(wd.x, 0.0, wd.y) * (sin(6.2831 * bf * t + bph) * 0.6 + 0.6 * ws) * bamp
    + vec3(wn.x, 0.0, wn.y) * sin(6.2831 * bf * 0.83 * t + bph * 0.7) * bamp * 0.35
    + vec3(0.0, sin(6.2831 * bf * 1.3 * t + bph * 1.3), 0.0) * bamp * 0.45;
  // 3. palm fronds whip: streamed downwind, lifted and snapped by the gusts
  if (kind > 1.5 && kind < 2.5 && aInfo.z > 0.25) {
    float fz = (aInfo.z - 0.3) / 0.7; fz *= fz;
    off += vec3(wd.x, 0.0, wd.y) * fz * (0.6 * ws + 0.8 * gp + 0.3 * sin(t * 11.0 + aInfo.w * 2.0) * (0.15 + ws + gp));
    off.y += fz * sin(t * 8.5 + aInfo.w * 4.0) * (0.06 * uWindStr + 0.25 * ws + 0.2 * gp);
  }
  // 5. brushing: a man or a vehicle pushing past a bush parts its sprays (away from him) and shakes them; low boughs only
  float low = 1.0 - smoothstep(1.4, 3.6, rel.y);
  if (low > 0.0) for (int i = 0; i < 8; i++) {
    vec4 a = uAgit[i];
    if (a.z <= 0.0) continue;
    vec2 dv = p.xz - a.xy;
    float d = length(dv), f = clamp(1.0 - d / a.w, 0.0, 1.0);
    f = f * f * a.z * low;
    if (f <= 0.0) continue;
    vec2 dir = d > 1e-3 ? dv / d : vec2(1.0, 0.0);
    off.xz += dir * f * 0.32 * (0.15 + aInfo.z);
    off += vec3(sin(t * 23.0 + aInfo.w * 5.0 + p.x * 3.0), 0.5 * sin(t * 19.0 + aInfo.w * 3.0), cos(t * 21.0 + aInfo.w * 4.0 + p.z * 3.0)) * f * 0.05 * (0.2 + aInfo.z);
  }
#ifdef VEG_LEAF
  // 4. leaf / needle flutter (high frequency, per card phase; needles are stiffer)
  float fr = 5.0 + 5.0 * fract(aInfo.w * 7.3), fa = aInfo.z * (0.003 * uWindStr + 0.018 * ws + 0.03 * gp) * (kind > 0.5 && kind < 1.5 ? 0.4 : 1.0);
  off += vec3(sin(t * fr * 3.1 + aInfo.w * 7.0 + p.y * 2.0), sin(t * fr * 3.9 + aInfo.w * 3.0) * 0.7, cos(t * fr * 3.4 + aInfo.w * 5.0 + p.x * 2.0)) * fa;
#endif
  p.xz += trunk;
  p.y -= dot(trunk, trunk) / (2.0 * max(rel.y, 0.5)); // keep the trunk length (arc, not shear)
  return p + off;
}
`;
};
/** begin_vertex of the vegetation programs (`lod`: the pulled vertex lodFetch() made at the start of main()). */
const vbegin = (lod = false) => /* glsl */ `
${lod ? '' : 'aRoot = vegRoot();'}
vec3 transformed = vegWind(${lod ? 'lPos' : 'position'});
vVUv = vec3(${lod ? 'lUv' : 'uv'}, aInfo.x);
vTint = aTint;
vFlex = aInfo.z;
vScWP = transformed;
vScWN = normalize(objectNormal);
#ifdef VEG_LEAF
vExt = aExt;
#ifndef VEG_NEEDLE
vLeaf = vec2(fract(aInfo.w * 4.1231 + aInfo.y * 17.0), floor(aRoot.w / 100.0));
#endif
#endif
`;

/** First of the two bare-twig spray layers in the leaf atlas. */
const TWIG_LAYER = LEAF_LAYERS.indexOf('twig') * 2;

/** Broadleaf spray atlas (tools/render/build_leaves.py): coverage-preserving alpha test. Under minification the mip
 * average thins the leaves, so coverage is scaled up with the mip level (no MSAA: alpha-to-coverage would collapse to a
 * plain threshold). foliage_n.webp is 256 px: rg normal, b coverage. */
const LEAF_ALPHA_GLSL = /* glsl */ `
float leafAlpha(float a) {
  vec2 dx = dFdx(vVUv.xy * 256.0), dy = dFdy(vVUv.xy * 256.0);
  float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
  return a * (1.0 + lod * 0.3);
}
`;
/**
 * Autumn colour per foliage species (index = LEAF_LAYERS entry): [target hue (rad, YIQ atan(Q, I): yellow ≈ -0.75,
 * orange ≈ -0.2, red ≈ +0.3), chroma scale, brightness scale]. 0 = never turns (evergreens, conifers, palms, the
 * already-brown marcescent tile).
 * Birch / poplar / hazel / willow: clear yellow; beech: copper; oak: russet; hawthorn: red-orange; ash: pale yellow.
 */
const AUTUMN = { oak: [-0.3, 1.2, 1.05], beech: [-0.28, 1.7, 1.35], birch: [-0.74, 2.0, 1.9], poplar: [-0.7, 1.9, 1.8], plane: [-0.55, 1.35, 1.4],
  hedge: [-0.1, 1.45, 1.1], scrub: [-0.4, 1.25, 1.2], willow: [-0.8, 1.5, 1.6], ash: [-0.9, 1.3, 1.6], apple: [-0.5, 1.4, 1.4], hazel: [-0.68, 1.8, 1.8] };
export function autumnTints() {
  return Array.from({ length: 24 }, (_, i) => new THREE.Vector3(...(AUTUMN[LEAF_LAYERS[i]] || [0, 1, 1])));
}
const LEAF_MAP_FRAG = /* glsl */ `
  vec4 tN = texture(tArrN, vVUv);
  float lMass = clamp(textureLod(tArrN, vVUv, 2.0).b * 1.6, 0.0, 1.0);   // local leaf density (spray core vs blade)
  if (leafAlpha(tN.b) < 0.5) discard;
  vec3 lAlb = texture(tArr, vVUv).rgb * vTint;
  // seasons, broadleaves and shrubs only (vLeaf.y kind 0 / 3): y dulls late-summer leaves, x = share of cards turned
  if (vLeaf.y < 0.5 || vLeaf.y > 2.5) {
    float lum = dot(lAlb, vec3(0.3, 0.59, 0.11));
    lAlb = mix(lAlb, mix(lAlb, vec3(lum) * vec3(1.15, 1.05, 0.62), 0.45), uSeason.y);
    // autumn turns leaf by leaf (docs/vegetation.md §2.4): the atlas carries a per-leaf id (foliage_n alpha
    // 160..249 → 0..1; 255 = twig / fruit / no leaf). A leaf turns once the season passes its id; leaves near the front
    // are half-turned (yellow-green). The colour is a hue shift of the leaf's own albedo (YIQ), so the veins, the
    // midrib fold and the shading stay; the species sets the target hue / chroma / brightness (uAut, evergreens: none).
    float idA = tN.a * 255.0, lid = clamp((idA - 160.0) / 90.0, 0.0, 1.0);
    vec3 aS = uAut[int(vVUv.z * 0.5 + 0.01)];
    float prog = uSeason.x * (0.35 + 1.3 * vLeaf.x);
    float turn = step(idA, 252.0) * step(0.01, abs(aS.x)) * clamp((prog - fract(lid + vLeaf.x * 0.37)) * 5.0, 0.0, 1.0);
    if (turn > 0.0) {
      float pick = fract(lid * 7.31 + vLeaf.x * 3.1);
      vec3 sR = pow(max(lAlb, vec3(0.0)), vec3(1.0 / 2.2)); // perceptual (gamma) space for the rotation
      float Y = dot(sR, vec3(0.299, 0.587, 0.114)), I = dot(sR, vec3(0.596, -0.274, -0.322)), Q = dot(sR, vec3(0.211, -0.523, 0.312));
      // a few leaves go straight to dead brown in late autumn
      float dead = step(0.86, pick) * step(0.75, uSeason.x);
      float h0 = atan(Q, I), hT = aS.x + (pick - 0.5) * 0.4 + dead * 0.25 + (h0 + 1.6) * 0.25; // keeps a little texel hue
      float ch = length(vec2(I, Q)) * mix(1.0, aS.y * mix(1.0, 0.55, dead), turn), hA = mix(h0, hT, turn);
      Y *= mix(1.0, aS.z * (0.88 + 0.24 * pick) * mix(1.0, 0.7, dead), turn);
      I = ch * cos(hA); Q = ch * sin(hA);
      vec3 o = vec3(Y + 0.956 * I + 0.621 * Q, Y - 0.272 * I - 0.647 * Q, Y - 1.106 * I + 1.703 * Q);
      lAlb = pow(clamp(o, 0.0, 1.0), vec3(2.2));
    }
  }
  diffuseColor.rgb *= lAlb * mix(1.0, vExt.x, 0.75);
`;
const LEAF_NORMAL_FRAG = /* glsl */ `
  vec3 mN = vec3((tN.rg * 2.0 - 1.0) * 0.85, 0.0);
  mN.z = sqrt(max(0.0, 1.0 - dot(mN.xy, mN.xy)));
  vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
  vec2 st0 = dFdx(vVUv.xy), st1 = dFdy(vVUv.xy);
  vec3 q1p = cross(q1, normal), q0p = cross(normal, q0);
  vec3 tT = q1p * st0.x + q0p * st1.x, tB = q1p * st0.y + q0p * st1.y;
  float tdet = max(dot(tT, tT), dot(tB, tB)), tsc = tdet == 0.0 ? 0.0 : inversesqrt(tdet);
  normal = normalize(tT * (mN.x * tsc) + tB * (mN.y * tsc) + normal * mN.z);
`;
/** Alpha test shared by the leaf depth and GTAO-normal programs. */
const LEAF_DISCARD = 'void main() {\n  if (leafAlpha(texture(tArrN, vVUv).b) < 0.5) discard;';

/** The trees' root table as a texture: RGBA32F, 1024 entries a row (read with texelFetch in the vertex shaders). */
function rootTable(roots) {
  const n = roots.length / 4, w = Math.min(1024, Math.max(1, n)), h = Math.ceil(n / 1024), data = new Float32Array(w * h * 4);
  data.set(roots);
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/**
 * The instanced forest's variant of a vegetation vertex shader (tree-lod.js): its vertex pulled first thing in main(),
 * then read where the unique trees read their attributes (the normal, the normal map's uv).
 */
const pulled = (vs) => vs.replace('void main() {', 'void main() {\n  lodFetch();')
  .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = lNrm;')
  .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_NORMALMAP\n  vNormalMapUv = lUv;\n#endif');
/** The instanced forest's shadow casters: LOD1 / LOD2 cross-fade masks first in main() (tree-lod.js LOD_DITHER_GLSL). */
const dithered = (fs) => LOD_DITHER_GLSL + fs.replace('void main() {', 'void main() {\n  lodDither();');
/** A vertex shader with the vegetation chunks: unique trees (attributes) or, with `lod`, the instanced forest's. */
const vegVertex = (vs, leaf, needle, lod, depthNormal = false) => {
  // (`depthNormal`: a shadow depth program — the instanced forest's reads its draw's shadow slots: LOD_SHADOW)
  const v = (lod && depthNormal ? '#define LOD_SHADOW\n' : '') + vpars(leaf, needle, !!lod) + vs.replace('#include <begin_vertex>', (depthNormal ? `vec3 objectNormal = ${lod ? 'lNrm' : 'normal'};\n` : '') + vbegin(!!lod));
  return lod ? pulled(v) : v;
};

/**
 * Bark or leaf-card materials (colour + shadow depth). `lod` ({u, us}: the instanced forest's textures and the draw's
 * first instance slot for the colour and the shadow pass, tree-lod.js LodForest.meshes): the same shaders on pulled
 * vertices, one program shared by every such draw.
 */
function makeMaterials(tex, U, kind, lod = null) {
  const leaf = kind === 'leaf';
  const mat = new THREE.MeshStandardMaterial({ roughness: leaf ? 0.7 : 0.92, metalness: 0, side: leaf ? THREE.DoubleSide : THREE.FrontSide, alphaTest: leaf ? 0.45 : 0 });
  mat.normalMap = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); // enables perturbNormal2Arb
  mat.normalMap.needsUpdate = true;
  mat.userData.U = U; // shared vegetation uniforms (season, wind, snow): tests / tools
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { tArr: { value: tex.alb }, tArrN: { value: tex.nor || tex.alb } }, lod?.u);
    sh.vertexShader = vegVertex(sh.vertexShader, leaf, false, lod);
    let f = sh.fragmentShader;
    f = f.replace('#include <map_fragment>', leaf ? LEAF_MAP_FRAG : `
      vec4 tA = texture(tArr, vVUv);
      diffuseColor.rgb *= tA.rgb * vTint;`);
    if (leaf) {
      // no back-face flip: bent crown normals give the volumetric look
      // no back-face flip: bent crown normals give the volumetric look; the spray atlas adds per-leaf normals on top
      f = f.replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
        .replace('#include <normal_fragment_maps>', LEAF_NORMAL_FRAG)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          // must-fix 6/7: translucent, back-lit cards. Light transmitted through the thin leaf blades (not the dense
          // spray cores, not twigs) facing away from the sun, forward-scatter lobe, and canopy multiple scattering on
          // the ambient (shade stays green, the crown core darker by the crown AO).
          vec3 Ls = normalize(uSunV);
          float trl = pow(max(dot(-Ls, normalize(vViewPosition)), 0.0), 3.0);
          float back = max(-dot(normal, Ls), 0.0);
          float thin = 0.25 + 0.75 * (1.0 - lMass);
          vec3 trans = diffuseColor.rgb * vec3(1.0, 1.1, 0.55) * uSunI * (0.06 + 0.2 * back + 0.4 * trl) * thin * (1.0 - scCov);
          reflectedLight.directDiffuse += trans * mix(0.6, 1.0, vExt.x);
          reflectedLight.indirectDiffuse *= 1.45 * mix(1.0, vExt.x, 0.5);`);
    } else {
      f = f.replace('#include <normal_fragment_maps>', `
        vec3 mapN = texture(tArrN, vVUv).xyz * 2.0 - 1.0;
        mapN.xy *= 1.4;
        normal = normalize(tbn * mapN);`);
    }
    // bark: thin limbs and twigs (flex) hold little snow — snow-capped twigs drew a white skeleton through pine crowns
    f = f.replace('#include <color_fragment>', `#include <color_fragment>
      float scCov = snowCoverage(normalize(vScWN), vScWP, uSnowAmt ${leaf ? '* 1.15' : ''})${leaf ? '' : ' * (1.0 - 0.8 * smoothstep(0.25, 0.6, vFlex))'};${leaf ? `
      // art review: snow lies in clumps on the needle sprays — broken by gaps where the dark green shows
      // (a fully white-frosted crown read as cotton wool at close zoom)
      scCov *= smoothstep(0.26, 0.62, scNoise(vScWP * 1.9) * 0.6 + scNoise(vScWP * 8.5) * 0.4);
      // bare twig sprays hold almost no snow (it lies on the upper faces of the limbs): a white twig haze read as a
      // snow-laden leafy crown
      if (abs(vVUv.z - ${TWIG_LAYER + 0.5}) < 0.75) scCov *= 0.12;` : ''}
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.84, 0.9), scCov);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.6, scCov);');
    sh.fragmentShader = 'uniform highp sampler2DArray tArr;\nuniform highp sampler2DArray tArrN;\n' + (leaf ? 'uniform vec3 uAut[24];\n' : '') + 'uniform vec3 uSunV;\nuniform float uSunI;\nuniform vec4 uSeason;\nvarying vec3 vVUv;\nvarying vec3 vTint;\nvarying float vFlex;\n'
      + (leaf ? 'varying vec2 vExt;\nvarying vec2 vLeaf;\n' + LEAF_ALPHA_GLSL : '') + SNOW_COVER_GLSL + f;
  };
  const L = lod ? '-lod' : '';
  mat.customProgramCacheKey = () => 'vegB-' + kind + L;
  let depth = null;
  if (leaf) {
    depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    depth.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, { tArrN: { value: tex.nor } }, lod?.us);
      sh.vertexShader = vegVertex(sh.vertexShader, true, false, lod, true);
      sh.fragmentShader = 'uniform highp sampler2DArray tArrN;\nvarying vec3 vVUv;\n' + LEAF_ALPHA_GLSL + sh.fragmentShader.replace('void main() {', LEAF_DISCARD);
      if (lod) sh.fragmentShader = dithered(sh.fragmentShader);
    };
    depth.customProgramCacheKey = () => 'vegB-leafdepth' + L;
  } else {
    depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, lod?.us);
      sh.vertexShader = vegVertex(sh.vertexShader, false, false, lod, true);
      if (lod) sh.fragmentShader = dithered(sh.fragmentShader);
    };
    depth.customProgramCacheKey = () => 'vegB-barkdepth' + L;
  }
  return { mat, depth };
}

/** Needle-atlas sampling shared by the needle colour, depth and GTAO-normal programs. */
const NEEDLE_FRAG_PARS = /* glsl */ `
uniform highp sampler2DArray tNA;   // needle albedo (opaque, bled)
uniform highp sampler2DArray tNN;   // rg normal, b coverage
varying vec3 vVUv;
// coverage-preserving alpha test: under minification the mip average thins the needles, so alpha is scaled up with
// the mip level (no MSAA in the pipeline: alpha-to-coverage would collapse to a plain threshold)
float needleAlpha(float a) {
  vec2 dx = dFdx(vVUv.xy * 512.0), dy = dFdy(vVUv.xy * 512.0);
  float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
  // pine tufts (layers 4–7) keep more of their gaps: a filled-in brush silhouette reads as a broad leaf
  return a * (1.0 + lod * (vVUv.z > 3.5 && vVUv.z < 7.5 ? 0.14 : 0.3));
}
`;

/**
 * Conifer needle sprays: needle atlas albedo + tangent normals (cylindrical needles), coverage-preserving alpha,
 * per-vertex crown AO, translucency through thin edges when back-lit, and snow loads on the top faces of tiers
 * (aExt.y sign × gl_FrontFacing) that fill the spray as soft clumps while the needles show at their edges.
 */
function makeNeedleMaterials(tex, U, lod = null) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.66, metalness: 0, side: THREE.DoubleSide });
  const L = lod ? '-lod' : '';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { tNA: { value: tex.alb }, tNN: { value: tex.nor } }, lod?.u);
    // shadow lookup taken 12 cm toward the sun: an alpha-tested card shadowing itself (and the snow body filling
    // its needle gaps) at shadow-map resolution sprinkled black specks through the snow clumps
    sh.vertexShader = 'uniform vec3 uSunV;\n' + vegVertex(sh.vertexShader, true, true, lod)
      .replace('#include <shadowmap_vertex>', `#ifdef USE_SHADOWMAP
        vec4 wpKeep = worldPosition; worldPosition.xyz += normalize((vec4(uSunV, 0.0) * viewMatrix).xyz) * 0.12;
        #endif
        #include <shadowmap_vertex>
        #ifdef USE_SHADOWMAP
        worldPosition = wpKeep;
        #endif`);
    let f = sh.fragmentShader;
    f = f.replace('#include <map_fragment>', `
      vec4 tN = texture(tNN, vVUv);
      float mass = clamp(textureLod(tNN, vVUv, 2.5).b * 1.8, 0.0, 1.0);   // local needle density
      float face = gl_FrontFacing ? 1.0 : -1.0;
      float catchW = max(face * vExt.y, 0.0);
      float sn = scNoise(vScWP * 2.1) * 0.6 + scNoise(vScWP * 8.0) * 0.4;
      float sl = scNoise(vScWP * 21.0) * 0.65 + scNoise(vScWP * 47.0) * 0.35;   // lumps: clump edges, crevices
      // snow load: exposed top faces of the tiers, thicker where the spray is dense, broken into clumps by noise.
      // It sits on the dense core of each spray (coarse mip = spray-scale density, so the gaps between side shoots
      // do not punch holes through it: those read as black ink dashes on white paper); fringes stay green
      float core = textureLod(tNN, vVUv, 4.5).b;
      float scRaw = smoothstep(0.46, 0.66, catchW * uSnowAmt * 0.92 + core * 0.5 + (sn - 0.5) * 0.75 + (sl - 0.5) * 0.16 - 0.3)
        * smoothstep(0.3, 0.6, core + (sn - 0.5) * 0.25 + (sl - 0.5) * 0.22) * step(0.001, uSnowAmt);
      // clumps of 10–20 cm with green between them (heavier loads merge them): a load covering the whole spray
      // outline read as a flat paper sheet
      float cl = scNoise(vScWP * 6.5) * 0.6 + scNoise(vScWP * 14.0) * 0.4;
      scRaw *= smoothstep(0.34, 0.5, cl + 0.12 * catchW * uSnowAmt);
      // the clump is opaque (a soft lumpy body, not a needle stencil) but stays inside the spray's envelope
      float env = textureLod(tNN, vVUv, 4.0).b;
      float snowA = smoothstep(0.12, 0.4, scRaw) * smoothstep(0.34, 0.56, env + (sl - 0.5) * 0.3);   // solid body: no pinholes
      float nAl = needleAlpha(tN.b);
      // green needle tips poke out at the clump edges and through thin snow; the body stays white
      float scCov = scRaw * (1.0 - clamp(nAl, 0.0, 1.0) * (1.0 - smoothstep(0.3, 0.62, scRaw + (sl - 0.5) * 0.6)));
      float nA = max(nAl, snowA);
      if (nA < 0.5) discard;
      // a fragment kept only by the snow body (needle gap) is snow: the dark gap-bleed albedo drew ink rims round clumps
      scCov = max(scCov, clamp(1.0 - nAl * 2.0, 0.0, 1.0));
      float ao = vExt.x * mix(1.0, 0.85, mass);
      diffuseColor.rgb *= texture(tNA, vVUv).rgb * vTint * mix(1.0, ao * ao, 0.7);
      // snow: crevices between lumps and the thin clump edges are greyer (needles show through)
      vec3 snowC = vec3(0.82, 0.86, 0.92) * mix(0.8, 1.0, vExt.x) * (0.86 + 0.14 * sl) * mix(0.78, 1.0, smoothstep(0.3, 0.85, scRaw))
        * (0.84 + 0.24 * smoothstep(0.3, 0.8, cl));   // rounded clumps: lit crowns, greyer hollows (also in shade)
      float sH = scRaw * (cl * 0.025 + sl * 0.005);          // lump height (m) for the snow bump normal: from the smooth load,
      // not scCov (its per-needle stencil steps gave the bump one-pixel cliffs: black dashes inside the clumps)
      diffuseColor.rgb = mix(diffuseColor.rgb, snowC, scCov);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.6, scCov);')
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
      .replace('#include <normal_fragment_maps>', `
        vec3 mN = vec3((tN.rg * 2.0 - 1.0) * (1.0 - smoothstep(0.1, 0.45, scCov)), 0.0);   // snow: no needle-edge normals
        mN.z = sqrt(max(0.0, 1.0 - dot(mN.xy, mN.xy)));
        vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
        vec2 st0 = dFdx(vVUv.xy), st1 = dFdy(vVUv.xy);
        vec3 q1p = cross(q1, normal), q0p = cross(normal, q0);
        vec3 tT = q1p * st0.x + q0p * st1.x, tB = q1p * st0.y + q0p * st1.y;
        float tdet = max(dot(tT, tT), dot(tB, tB)), tsc = tdet == 0.0 ? 0.0 : inversesqrt(tdet);
        normal = normalize(tT * (mN.x * tsc) + tB * (mN.y * tsc) + normal * mN.z);
        // lumpy snow: bump from the clump height (surface-gradient method, world-unit height → zoom independent)
        vec2 dSH = vec2(dFdx(sH), dFdy(sH));   // derivatives outside the branch (undefined in non-uniform flow)
        if (scCov > 0.01) {
          float fDet = dot(q0, q1p);
          vec3 sG = sign(fDet) * (dSH.x * q1p + dSH.y * q0p);
          normal = normalize(abs(fDet) * normal - sG);
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // back-lit needles: light through the thin needle edges (not the dense twig cores). The forward-scatter lobe
        // is wide: from the fixed 40° orthographic view a sun behind the trees is only ~70° off the view axis, where
        // a tight pow() lobe gave nothing (critic: invisible translucency, black shade-side crowns)
        vec3 Ls = normalize(uSunV);
        vec3 Vd = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
        float fs = clamp(dot(-Ls, Vd) * 0.5 + 0.5, 0.0, 1.0);
        float trl = fs * fs;
        float back = max(-dot(normal, Ls), 0.0);
        float thin = 0.2 + 0.8 * (1.0 - mass);
        vec3 nCol = diffuseColor.rgb * vec3(0.95, 1.1, 0.6);   // light through needles picks up their green twice
        reflectedLight.directDiffuse += nCol * uSunI * (0.02 + 0.1 * back + 0.32 * trl * (0.1 + 0.9 * thin)) * (1.0 - scCov);
        // snow bounce + canopy multiple scattering: shaded skirts over bright snow stay dark GREEN, not black/blue
        float gB = uSnowAmt > 0.001 ? 1.0 : 0.4;
        reflectedLight.indirectDiffuse = reflectedLight.indirectDiffuse * 1.45 * mix(1.0, ao, 0.4)
          + nCol * uSunI * 0.05 * gB * ao * (1.0 - scCov);`);
    sh.fragmentShader = 'uniform vec3 uSunV;\nuniform float uSunI;\nvarying vec3 vTint;\nvarying vec2 vExt;\nvarying float vFlex;\n' + NEEDLE_FRAG_PARS + SNOW_COVER_GLSL + f;
  };
  mat.customProgramCacheKey = () => 'vegB-needle' + L;
  const alphaOnly = (base, key, u) => {
    base.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, { tNA: { value: tex.alb }, tNN: { value: tex.nor } }, u);
      sh.vertexShader = vegVertex(sh.vertexShader, true, true, lod, key === 'depth');
      sh.fragmentShader = NEEDLE_FRAG_PARS + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (needleAlpha(texture(tNN, vVUv).b) < 0.5) discard;');
      if (lod && key === 'depth') sh.fragmentShader = dithered(sh.fragmentShader);
    };
    base.customProgramCacheKey = () => 'vegB-needle' + key + L;
    return base;
  };
  const depth = alphaOnly(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }), 'depth', lod?.us);
  // (the instanced forest skips the GTAO prepass: no AO variant)
  const aoMat = lod ? null : alphaOnly(new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }), 'ao');
  return { mat, depth, aoMat };
}

const CHUNK = 20;

/** Alpha-tested normal material for the GTAO normal/depth prepass (the stock override ignores card alpha). */
function aoNormalMaterial(tex, U) {
  const m = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { tArrN: { value: tex } });
    sh.vertexShader = vegVertex(sh.vertexShader, true, false, null);
    sh.fragmentShader = 'uniform highp sampler2DArray tArrN;\nvarying vec3 vVUv;\n' + LEAF_ALPHA_GLSL + sh.fragmentShader.replace('void main() {', LEAF_DISCARD);
  };
  m.customProgramCacheKey = () => 'vegB-aonormal';
  return m;
}

/**
 * @param {THREE.Scene} scene
 * @param {{species:string, x:number, z:number, y?:number, seed?:number, scale?:number, snow?:number, burnt?:boolean}[]} placements
 * @param {'desert'|'temperate'|'snow'|'coast'|'night'} theater
 * @param {{quality?:string, assetBase?:string, terrain?:{heightAt:Function}, snow?:number, wind?:{x:number,z:number}, windStrength?:number}} [opts]
 * @returns {Promise<{group:THREE.Group, trees:object[], update:(dt:number)=>void, setQuality:(q:string)=>void,
 *   setSnow:(a:number)=>void, dispose:()=>void, stats:{trees:number, tris:number, drawCalls:number, genMs:number}}>}
 */
/** The strips createVegetation loads (leaf / bark / needle atlases), for a load's early downloads (engine/early-fetch.js). */
export const VEGETATION_STRIPS = Object.freeze(STRIP_SPECS.map(([n]) => stripFile(n, HALF_STRIPS)));
export const vegetationStripUrls = (base = new URL('../../../assets/terrain/', import.meta.url).href) => VEGETATION_STRIPS.map((f) => base + f)
  .filter((u) => !cache.hasPrefix(`strip:${u}|`)); // decoded already: no fetch will come

export async function createVegetation(scene, placements, theater = 'temperate', opts = {}) {
  const base = opts.assetBase || new URL('../../../assets/terrain/', import.meta.url).href;
  // (foliage: grid of 512 px tiles; foliage_n — rg normal, b coverage, a per-leaf ids — of 256 px tiles; the half copies
  // halve the tiles)
  const strips = await Promise.all(STRIP_SPECS.map(([n, srgb, alpha, tile]) => loadStrip(base + stripFile(n, HALF_STRIPS), srgb, alpha, tile && halved(n, HALF_STRIPS) ? tile / 2 : tile)));
  const [lAlb, bAlb, bNor, lNor, nAlb, nNor] = strips;
  let gone = false;
  const small = (i) => halved(STRIP_SPECS[i][0], HALF_STRIPS) && !strips[i].userData.hdUpgraded;
  if (strips.some((t, i) => small(i))) {
    // the originals after the loading screen, in the HD queue, one strip at a time, swapped in place
    const full = STRIP_SPECS.map(([n]) => base + stripFile(n, false));
    registerHdJob(`vegetation:${base}foliage_albedo.strips`, {
      urls: full.filter((u, i) => small(i)),
      run: async () => {
        let n = 0;
        for (const [i, [, srgb, alpha, tile]] of STRIP_SPECS.entries()) {
          if (gone || !small(i)) continue;
          if (n++) await hdPause(); // (a strip at a time, the game's frames between them)
          try { swapStrip(strips[i], await loadLayerArray(full[i], stripOpts(full[i], srgb, alpha, tile))); } catch (e) { console.warn('[vegetation] full strip', full[i], e?.message || e); }
        }
      },
    });
  }
  const wind = new THREE.Vector2(opts.wind?.x ?? 1, opts.wind?.z ?? 0.25).normalize();
  const snowDefault = opts.snow ?? (theater === 'snow' ? 1 : 0);
  const U = {
    ...WIND_UNIFORMS, // step 4w shared wind
    uTime: { value: 0 }, uWind: { value: wind }, uWindStr: { value: opts.windStrength ?? 1 },
    uSnowAmt: { value: snowDefault }, uSnowBias: { value: 0 },
    uSunV: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: 3 },
    uAgit: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 1)) },
    uSeason: { value: new THREE.Vector4(opts.season?.autumn ?? 0, opts.season?.dull ?? 0, 0, 0) }, // leaf colour by date (treeSeason)
    uAut: { value: autumnTints() },
    uRoots: { value: rootTable(new Float32Array([0, 0, 0, 1])) }, // the trees' roots (built with the meshes)
  };
  const barkM = makeMaterials({ alb: bAlb, nor: bNor }, U, 'bark');
  const leafM = makeMaterials({ alb: lAlb, nor: lNor }, U, 'leaf');
  const aoMat = aoNormalMaterial(lNor, U);
  const needleM = makeNeedleMaterials({ alb: nAlb, nor: nNor }, U);
  let leafMeshes = [];
  const group = new THREE.Group();
  group.name = 'vegetationB';
  scene.add(group);
  let quality = TREE_QUALITY[opts.quality] ? opts.quality : 'high';
  const stats = { trees: 0, tris: 0, drawCalls: 0, genMs: 0 };
  let trees = [];

  const gl = opts.renderer?.isWebGLRenderer ? opts.renderer : opts.renderer?.renderer;
  /** The instanced forest of the current build (tree-lod.js): its textures, culled instances and materials. */
  let lodParts = null;
  let building = null;
  const disposeLod = () => {
    if (!lodParts) return;
    for (const t of lodParts.tex) disposeLodTextures(t);
    lodParts.forest.dispose();
    for (const m of lodParts.mats) { m.normalMap?.dispose(); m.dispose(); }
    lodParts = null;
  };
  /**
   * The instanced forest's prototypes at one level (treegen TREE_LOD) grown and packed for the GPU (session cache: a
   * restart neither regrows nor repacks them): in the tree workers when there are several, else here a slice at a
   * time — the same trees. @param {object[]} plan [{key, species, seed, …placement flags, tint0}] @param {number} level
   */
  async function growLodBank(plan, level) {
    // (bare, dead and burnt crowns keep more limbs and twigs: lodQuality's sparse)
    const lplan = plan.map((p) => ({ ...p, q: lodQuality(level, p.sparse) }));
    const key = `treeLod:${level}:${dataKey((h) => { h.str(JSON.stringify(lplan)); })}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const kindOf = (p) => WIND_KIND[SPECIES[p.species]?.kind] ?? 0;
    let protos = null;
    if (opts.workers !== 0 && plan.length >= 4) {
      try {
        const nW = opts.workers ?? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
        const out = await genInWorkers(lplan.map((p) => ({ key: p.key, trees: [p] })), lplan[0].q, nW);
        if (out) {
          const by = new Map(out.map((r) => [r.key, r]));
          protos = plan.map((p) => { const r = by.get(p.key); return { H: r.info[0].height, kind: kindOf(p), bark: unpackArrays(r.bark), leaf: unpackArrays(r.leaf), needle: unpackArrays(r.needle) }; });
        }
      } catch (e) { console.warn('[vegetation] prototype workers failed, growing here', e); protos = null; }
    }
    if (!protos) {
      protos = await runSliced((function* growProtos() {
        const res = [];
        for (const p of lplan) {
          const bark = new GeoAcc(), leaf = new GeoAcc(), needle = new GeoAcc();
          const info = generateTree(p.species, p.seed, p.q, bark, leaf, p, needle);
          res.push({ H: info.height, kind: kindOf(p), bark: bark.count ? bark : null, leaf: leaf.count ? leaf : null, needle: needle.count ? needle : null });
          if (due()) yield;
        }
        return res;
      })());
    }
    const bank = packLodBank(protos, LOD_BUCKET_FILL[level]);
    cache.set(key, bank, { bytes: bank.bytes });
    return bank;
  }

  const ts = opts.season || {};
  /** Every planted tree with its seed, ground height and season looks (the same at every quality). */
  function treeList() {
    const list = [];
    for (const p of placements) {
      if (!SPECIES[p.species]) continue;
      const y = p.y ?? opts.terrain?.heightAt?.(p.x, p.z) ?? 0;
      const seed = p.seed ?? Math.floor(hash2(Math.round(p.x * 100), Math.round(p.z * 100), 77) * 1e9);
      // season (veg-profile treeSeason): bare deciduous crowns in winter (twig sprays, marcescent oak/beech leaves),
      // ivy on a share of the big broadleaf trunks
      const sp = SPECIES[p.species], deciduous = (sp.kind === 'broad' || sp.deciduous) && !sp.evergreen;
      const leafless = p.leafless ?? (deciduous && (theater === 'snow' || !!ts.leafless));
      const ivy = p.ivy ?? (sp.kind === 'broad' && !sp.evergreen && sp.H[1] > 9 && hash2(seed & 0xffff, seed >>> 16, 31) < (ts.ivy || 0));
      list.push({ ...p, y, seed, leafless, marc: leafless ? ts.marc || 0 : 0, marcTrees: ts.marcTrees, ivy, dates: p.dates ?? !!ts.dates, fruit: !!ts.fruit });
    }
    return list;
  }
  /** The trees drawn unique at `qName` (`hero`) and those drawn as instanced copies of prototypes (`far`, tree-lod.js). */
  function heroSplit(list, qName) {
    // unique budget: heroes first (p.hero), then a seeded shuffle, so the instanced copies spread evenly through forests
    const maxU = opts.maxUnique ?? MAX_UNIQUE[qName] ?? 500;
    let hero = list, far = [];
    // instancing candidates = trees in dense stands (forest interiors); solitary / hedge / designed trees stay unique
    const cell = new Map(), ck = (x, z) => Math.floor(x / 6) + ',' + Math.floor(z / 6);
    for (const p of list) cell.set(ck(p.x, p.z), (cell.get(ck(p.x, p.z)) || 0) + 1);
    const dens = (p) => { let n = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) n += cell.get(Math.floor(p.x / 6 + a) + ',' + Math.floor(p.z / 6 + b)) || 0; return n; };
    if (list.length > maxU && gl && opts.instanced !== false) {
      // key: heroes first, then sparsest stands; densest forest interiors end up instanced
      const ord = list.map((p) => [p.hero ? Infinity : 1 / (1 + dens(p)) + 0.02 * hash2(p.seed & 0xffff, p.seed >>> 16, 5), p])
        .sort((a, b) => b[0] - a[0]).map((a) => a[1]);
      hero = ord.slice(0, maxU); far = ord.slice(maxU);
    }
    // load budget (docs/vegetation.md §5): visual-only plants (forest-fill interiors, understorey) have their own small
    // unique budget; past it the densest are instanced (worker generation of 300+ unique M20 plants cost +4-5 s)
    const maxV = opts.maxVisualUnique ?? Math.round(maxU * 0.3);
    if (gl && opts.instanced !== false) {
      const vis = hero.filter((p) => !p.hero && p.species !== 'fallen' && (p.visual || p.understorey || p.fill));
      if (vis.length > maxV) {
        const drop = new Set(vis.map((p) => [dens(p) + 0.02 * hash2(p.seed & 0xffff, p.seed >>> 16, 7), p]).sort((a, b) => b[0] - a[0]).slice(0, vis.length - maxV).map((a) => a[1]));
        hero = hero.filter((p) => !drop.has(p)); far = far.concat([...drop]);
      }
    }
    return { hero, far };
  }
  /** The unique trees in CHUNK m squares (one geometry set per chunk). */
  function chunksOf(hero) {
    const chunks = new Map();
    for (const p of hero) {
      const key = Math.floor(p.x / CHUNK) + ',' + Math.floor(p.z / CHUNK);
      if (!chunks.has(key)) chunks.set(key, { key, trees: [] });
      chunks.get(key).trees.push({ species: p.species, seed: p.seed, x: p.x, y: p.y, z: p.z, scale: p.scale, burnt: p.burnt, leafless: p.leafless, marc: p.marc, marcTrees: p.marcTrees, ivy: p.ivy, dates: p.dates, fruit: p.fruit, crownBase: p.crownBase, crownR: p.crownR, visual: p.visual, clear: p.clear });
    }
    return [...chunks.values()];
  }
  /**
   * The chunks' tree geometry arrays at quality `qName` (session cache, else the workers, else here a slice at a time:
   * the same trees in the same order). `barkOnly` (a set generated to be measured, never drawn): only its bark and tree
   * info are kept in the session cache. @returns {Promise<{out: object[], cached: boolean, worker: boolean}>}
   */
  async function generate(chunkList, qName, nHero, { barkOnly = false } = {}) {
    const q = TREE_QUALITY[qName];
    // generated meshes are a pure function of the chunks + quality: a restart reuses them (session cache)
    const sig = dataKey((h) => { h.str(JSON.stringify(q)); h.str(JSON.stringify(chunkList)); });
    const genKey = `trees:${qName}:${sig}`, barkKey = `trees-bark:${qName}:${sig}`;
    let out = cache.get(genKey) || (barkOnly ? cache.get(barkKey) : null) || null, worker = false;
    const cached = !!out;
    const nW = opts.workers ?? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
    if (!out && opts.workers !== 0 && nHero >= 40) {
      try { out = await genInWorkers(chunkList, q, nW); } catch (e) { console.warn('[vegetation] worker generation failed, falling back', e); out = null; }
      worker = !!out;
    }
    if (!out) {
      // here: tree by tree, a slice at a time (engine/slice.js) — the same trees in the same order
      out = await runSliced((function* genChunks() {
        const res = [];
        for (const c of chunkList) {
          const bark = new GeoAcc(), leaf = new GeoAcc(), needle = new GeoAcc(), info = [];
          for (const t of c.trees) { info.push(generateTree(t.species, t.seed, q, bark, leaf, t, needle)); if (due()) yield; }
          res.push({ key: c.key, bark: bark.count ? bark.toArrays() : null, leaf: leaf.count ? leaf.toArrays() : null, needle: needle.count ? needle.toArrays() : null, info });
        }
        return res;
      })());
    }
    if (!cached && barkOnly) cache.set(barkKey, out.map((r) => ({ key: r.key, bark: r.bark, info: r.info })), { bytes: chunkBytes });
    else if (!cached) cache.set(genKey, out, { bytes: chunkBytes });
    return { out, cached, worker };
  }
  /** Quality of the tree set last built (drawn), null before the first. */
  let builtQuality = null;
  async function build() {
    const t0 = performance.now();
    const q = TREE_QUALITY[quality], qName = quality;
    const { hero, far } = heroSplit(treeList(), qName);
    const chunkList = chunksOf(hero);
    // the trees past the unique budget: instanced copies of K real prototypes a look (species, bare, burnt), grown at
    // this quality with a neutral colour — each copy brings the tints its own seed would have grown (treeLook); grown
    // alongside the unique trees (the same workers), swapped in with them
    const lookOf = (p) => p.species + (p.leafless ? '|bare' : '') + (p.burnt ? '|burnt' : '');
    const counts = new Map();
    for (const p of far) counts.set(lookOf(p), (counts.get(lookOf(p)) || 0) + 1);
    const first = new Map(), K = new Map(), plan = [];
    for (const k of counts.keys()) {
      const [sp] = k.split('|'), bare = k.includes('|bare'), burnt = k.includes('|burnt');
      first.set(k, plan.length); K.set(k, lodProtos(counts.get(k)));
      for (let v = 0; v < K.get(k); v++) {
        plan.push({ key: `lod${plan.length}`, species: sp, seed: 9173 + v * 131 + plan.length * 7, x: 0, y: 0, z: 0, leafless: bare, burnt,
          marc: bare ? ts.marc || 0 : 0, marcTrees: ts.marcTrees, dates: !!ts.dates, fruit: !!ts.fruit, tint0: true,
          sparse: bare || burnt || !SPECIES[sp]?.leaf });
      }
    }
    const [gen, ...banks] = await Promise.all([generate(chunkList, qName, hero.length), ...(plan.length ? TREE_LOD.map((_, lv) => growLodBank(plan, lv)) : [])]);
    const out = gen.out;
    stats.cached = gen.cached;
    stats.worker = gen.worker;
    // swap geometry in only when the new set is ready (no pop-out while regenerating)
    for (const m of [...group.children]) { group.remove(m); m.geometry.dispose(); }
    leafMeshes = [];
    trees = []; stats.tris = 0;
    const byKey = new Map(chunkList.map((c) => [c.key, c]));
    // the root table: every geometry's trees, end to end (entry bases: arraysToGeometry rebases the normals' 4th component)
    let nRoots = 0;
    for (const r of out) for (const a of [r.bark, r.leaf, r.needle]) if (a?.roots) nRoots += a.roots.length / 4;
    const table = new Float32Array(Math.max(1, nRoots) * 4);
    let at = 0;
    const baseOf = (a) => { if (!a?.roots) return 0; const b = at; table.set(a.roots, b * 4); at += a.roots.length / 4; return b; };
    for (const r of out) {
      byKey.get(r.key).trees.forEach((t, i) => trees.push({ ...t, ...r.info[i], lod: false }));
      for (const [a, M] of [[r.bark, barkM], [r.leaf, leafM], [r.needle, needleM]]) {
        if (!a) continue;
        const mesh = new THREE.Mesh(GeoAcc.arraysToGeometry(a, baseOf(a)), M.mat);
        mesh.customDepthMaterial = M.depth;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.name = M === barkM ? 'vegBark' : M === needleM ? 'vegNeedles' : 'vegLeaves';
        if (M === leafM) { leafMeshes.push(mesh); mesh.userData.aoMaterial = aoMat; } // alpha-aware GTAO prepass (engine/gtao-alpha.js)
        if (M === needleM) {
          // needles skip the screen-space GTAO prepass: their crown AO is baked per vertex (aExt.x), and from the 40°
          // camera GTAO read the stacked tiers as one deep crevice — shade-side skirts went black over bright snow
          leafMeshes.push(mesh); mesh.userData.aoExclude = true;
        }
        group.add(mesh);
        stats.tris += a.idx.length / 3;
      }
    }
    const old = U.uRoots.value;
    U.uRoots.value = rootTable(table);
    old.dispose();
    stats.roots = nRoots;
    disposeLod();
    stats.lod = 0;
    if (far.length && banks.length) {
      const tex = banks.map(lodTextures);
      const inst = far.map((p) => {
        const k = lookOf(p), pi = first.get(k) + (p.seed % K.get(k));
        const H = banks[0].protos[pi].H, sp = SPECIES[p.species];
        const want = (sp.H ? sp.H[0] + (sp.H[1] - sp.H[0]) * ((p.seed % 997) / 997) : H) * (p.scale || 1);
        trees.push({ ...p, height: want, lod: true });
        const look = treeLook(p.species, p.seed, { burnt: p.burnt });
        return { x: p.x, y: p.y, z: p.z, yaw: (p.seed % 6283) / 1000, proto: pi, scale: want / H, phase: look.phase, bare: !!p.leafless,
          bark: p.burnt ? [1, 1, 1] : look.tint, leaf: look.leafTint };
      });
      const forest = new LodForest(banks, inst), mats = [];
      const make = (lv, m, u, us) => {
        const M = m === 'bark' ? makeMaterials({ alb: bAlb, nor: bNor }, U, 'bark', { u, us })
          : m === 'leaf' ? makeMaterials({ alb: lAlb, nor: lNor }, U, 'leaf', { u, us }) : makeNeedleMaterials({ alb: nAlb, nor: nNor }, U, { u, us });
        mats.push(M.mat, M.depth);
        return M;
      };
      for (const mesh of forest.meshes(tex, make)) group.add(mesh);
      lodParts = { tex, forest, mats };
      stats.lod = inst.length;
      stats.lodProtos = plan.length;
      stats.lodDraws = forest.lists.length;
      stats.lodMB = +((banks.reduce((n, b) => n + b.bytes, 0) + forest.slots.reduce((n, sl) => n + sl.data.byteLength, 0)) / 1048576).toFixed(2);
      stats.lodLists = forest.lists.map((l) => `L${l.level + 1}${l.mat}:${l.corners / 3}t×${l.members}`).join(' ');
    }
    stats.trees = trees.length;
    stats.unique = hero.length;
    stats.drawCalls = group.children.length;
    stats.genMs = Math.round(performance.now() - t0);
    builtQuality = qName;
  }
  building = build();
  await building;

  let time = 0;
  const sunDir = new THREE.Vector3();
  // brushing (shader uAgit): low vegetation (bushes, hedges, small trees) in an 8 m hash, rebuilt with the tree set
  const agit = new Map();
  let lowHash = null, hashFor = null;
  const nearLow = (x, z, r) => {
    if (hashFor !== trees) {
      lowHash = new Map(); hashFor = trees;
      for (const t of trees) {
        if (!(SPECIES[t.species]?.kind === 'bush' || (t.height ?? 99) < 7)) continue; // (the instanced copies too: 3D sprays part as well)
        const k = Math.floor(t.x / 8) + ',' + Math.floor(t.z / 8);
        if (!lowHash.has(k)) lowHash.set(k, []);
        lowHash.get(k).push(t);
      }
    }
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const t of lowHash.get((Math.floor(x / 8) + a) + ',' + (Math.floor(z / 8) + b)) || []) {
        if (Math.hypot(t.x - x, t.z - z) < (t.crownRadius ?? 1) + r) return true;
      }
    }
    return false;
  };
  return {
    group, stats,
    get trees() { return trees; },
    /** The instanced forest of the trees past the unique budget (tree-lod.js LodForest), or null: tests / tools. */
    get lod() { return lodParts?.forest ?? null; },
    /** @deprecated no longer needed: the renderer's AlphaAwareGTAOPass reads mesh.userData.aoMaterial. Kept as a no-op. */
    attachRenderer() {},
    update(dt, camera) {
      time += dt;
      U.uTime.value = time;
      const sun = scene.getObjectByProperty('isDirectionalLight', true);
      if (sun) { sunDir.copy(sun.position).sub(sun.target.position).normalize(); U.uSunI.value = sun.intensity; }
      U.uSunV.value.copy(sunDir);
      if (camera) U.uSunV.value.transformDirection(camera.matrixWorldInverse);
    },
    setQuality(q2) { if (TREE_QUALITY[q2] && q2 !== quality) { quality = q2; building = build(); } return building; },
    /**
     * The trees gameplay measures (world/map-builder.js stampTreeBranchesG: the branch cells of gun arcs): the bark of
     * the trees GAMEPLAY_TREES ('high') draws unique, generated at that quality — whatever the preset draws. 'low' draws
     * fewer unique trees (MAX_UNIQUE) with half the twigs (TREE_QUALITY): measured on what it drew, the gun arcs changed
     * with the graphics preset. When the drawn set is that quality: its meshes; else a measurement-only copy (never
     * drawn, `dispose` frees it). @returns {Promise<{root: THREE.Object3D, trees: object[], dispose: () => void}>}
     */
    async gameplayBranches() {
      await building;
      if (builtQuality === GAMEPLAY_TREES) { stats.gameplay = { drawn: true }; return { root: group, trees, dispose() {} }; }
      const t0 = performance.now();
      const { hero, far } = heroSplit(treeList(), GAMEPLAY_TREES);
      const chunkList = chunksOf(hero), byKey = new Map(chunkList.map((c) => [c.key, c]));
      const { out, cached, worker } = await generate(chunkList, GAMEPLAY_TREES, hero.length, { barkOnly: true });
      stats.gameplay = { drawn: false, unique: hero.length, cached, worker, ms: Math.round(performance.now() - t0) }; // (load cost at 'low')
      const root = new THREE.Group(), list = [];
      root.name = 'vegetationB:gameplay';
      for (const r of out) {
        byKey.get(r.key).trees.forEach((t, i) => list.push({ ...t, ...r.info[i], lod: false }));
        if (r.bark) { const m = new THREE.Mesh(GeoAcc.arraysToGeometry(r.bark, 0)); m.name = 'vegBark'; root.add(m); }
      }
      for (const p of far) list.push({ ...p, lod: true });
      return { root, trees: list, dispose() { for (const m of root.children) { m.geometry.dispose(); m.material.dispose(); } } };
    },
    setSnow(a) { U.uSnowAmt.value = a; },
    /** The tree root (x, y, z, H + 100·kind) of vertex `i` of one of the group's meshes (tests / tools). */
    rootAt: (geometry, i) => vertexRoot(geometry, i),
    setWind(s) { U.uWindStr.value = s; },
    /**
     * Movers brushing through low vegetation this frame ([{id, x, z, s: strength 0..2, r: reach m}]): the 8 strongest
     * part and shake the sprays they touch, and keep shaking a moment after they pass. Visual only (cover and sight
     * come from the bush structures).
     * @returns {number} active agitators
     */
    agitate(movers, dt = 1 / 60) {
      for (const a of agit.values()) a.s = Math.max(0, a.s - dt * 1.6);
      for (const m of movers) {
        if (!nearLow(m.x, m.z, m.r)) continue;
        const a = agit.get(m.id) || { s: 0 };
        a.x = m.x; a.z = m.z; a.r = m.r; a.s = Math.max(a.s, m.s);
        agit.set(m.id, a);
      }
      for (const [id, a] of agit) if (a.s <= 0.01) agit.delete(id);
      const list = [...agit.values()].sort((p, q) => q.s - p.s);
      for (let i = 0; i < 8; i++) { const a = list[i]; U.uAgit.value[i].set(a ? a.x : 0, a ? a.z : 0, a ? a.s : 0, a ? a.r : 1); }
      return Math.min(8, list.length);
    },
    dispose() {
      gone = true;
      for (const m of group.children) m.geometry.dispose();
      disposeLod();
      scene.remove(group);
      [barkM.mat, barkM.depth, leafM.mat, leafM.depth, needleM.mat, needleM.depth, needleM.aoMat].forEach((m) => m.dispose());
      [lAlb, bAlb, bNor, lNor, nAlb, nNor].forEach((t) => cache.release(t));
      U.uRoots.value.dispose();
    },
  };
}
