/**
 * createVegetation — every placed tree/bush is generated from its own seed (treegen.js), so no two are alike.
 * Geometry is merged per 20 m chunk into 2 draw calls (bark + foliage cards; conifer needle sprays use their own
 * needle material, so only a chunk mixing broadleaves and conifers has a third) with frustum culling.
 * Textures: CC0 bark scans, ambientCG leaf-scan cluster cards and the baked needle-spray atlas in sampler2DArrays.
 * Shader: wind sway (trunk) + flutter (cards), bent crown normals, leaf translucency, snow cover, alpha-tested shadows.
 * @module terrain-b/vegetation
 */
import * as THREE from 'three';
import { generateTree, GeoAcc, TREE_QUALITY, SPECIES, LEAF_LAYERS, useThree } from './treegen.js';
import { bakeImpostors, createImpostorMesh } from './impostors.js';
import { WIND_GLSL, WIND_UNIFORMS } from '../../world/wind.js';
useThree(THREE);

/** Unique (fully generated) trees per preset; the rest of a forest becomes impostors (must-fix 11). */
export const MAX_UNIQUE = { low: 150, medium: 300, high: 400, ultra: 500 };
const PROTOS_PER_SPECIES = 2;
const IMP_TILE = { low: 160, medium: 192, high: 224, ultra: 256 };   // whole-tree tiles: below ~1:1 at zoom 1 they read blurry
/** Conifer impostors: light gain standing in for the needle shader's canopy scattering and translucency. */
const IMP_NEEDLE_GAIN = 1.3;

let _pool = null;
function workerPool(n) {
  if (_pool) return _pool;
  const threeUrl = import.meta.resolve ? import.meta.resolve('three') : null;
  if (!threeUrl || typeof Worker === 'undefined') return null;
  const init = { threeUrl, treegenUrl: new URL('./treegen.js', import.meta.url).href };
  _pool = Array.from({ length: n }, () => {
    const w = new Worker(new URL('./treegen.worker.js', import.meta.url), { type: 'module' });
    const ready = new Promise((res, rej) => { w.onmessage = (e) => e.data.ready && res(); w.onerror = rej; });
    w.postMessage({ init });
    return { w, ready };
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
    p.w.onmessage = (e) => { if (e.data.job === job) ok(e.data.chunks); };
    p.w.postMessage({ job, q, chunks: parts[i] });
  })));
  return res.flat();
}

import { SNOW_COVER_GLSL } from './snowfx.js';
import { hash2 } from './noise.js';
import { loadLayerArray } from './layer-image.js';
import { sessionCache as cache, dataKey } from '../../engine/asset-cache.js';

function loadStrip(url, srgb, alpha, tile) {
  // session cache (engine/asset-cache.js): decoded + uploaded once per page, freed on eviction
  return cache.memoAsync(`strip:${url}|${srgb ? 1 : 0}|${alpha ? 1 : 0}|${tile || '-'}`, () => loadLayerArray(url, { srgb, anisotropy: 4, wrap: alpha ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping, tile }).then((t) => cache.retain(t)), {
    bytes: (t) => t.image.width * t.image.height * t.image.depth * 4 * 1.34, dispose: (t) => t.dispose(),
  });
}

/** Impostor-bank cache entry dispose (module level: a callback made inside the builder would keep its whole scope — and the mission — alive). */
const disposeImpostorEntry = (b) => { b.bank.albedo.dispose(); b.bank.normal.dispose(); };

/** Bytes of a worker chunk result (typed arrays). */
const chunkBytes = (out) => out.reduce((n, r) => n + [r.bark, r.leaf].reduce((m, a) => m + (a ? Object.values(a).reduce((k, v) => k + (v?.byteLength || 0), 0) : 0), 0), 0);

/** Hierarchical (SpeedTree-style) wind, step 4w: trunk bend from the root + branch sway + leaf flutter + palm whip,
 * all from the shared WindField sampled at the tree root (gust fronts roll through canopies tree by tree). */
const vpars = (leaf, needle = false) => WIND_GLSL + (leaf ? '#define VEG_LEAF\n' : '') + (needle ? '#define VEG_NEEDLE\n' : '') + /* glsl */ `
#ifdef VEG_LEAF
attribute vec2 aExt;  // crown AO, signed snow catch (broadleaf.js / shrubs.js; conifers.js on the needle material)
varying vec2 vExt;
#ifndef VEG_NEEDLE
varying vec2 vLeaf;   // per-card random, species kind (0 broad, 1 conifer, 2 palm, 3 bush)
#endif
#endif
attribute vec4 aInfo;   // layer, sway weight (height), flex (0 trunk .. 1 leaf), phase
attribute vec3 aTint;
attribute vec4 aRoot;   // tree root x, y, z, H + 100·kind (0 broad, 1 conifer, 2 palm, 3 bush)
uniform float uTime;
uniform vec2 uWind;
uniform float uWindStr; // 0..1 multiplier (0 while baking impostors)
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
const VBEGIN = /* glsl */ `
vec3 transformed = vegWind(position);
vVUv = vec3(uv, aInfo.x);
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

function makeMaterials(tex, U, kind) {
  const leaf = kind === 'leaf';
  const mat = new THREE.MeshStandardMaterial({ roughness: leaf ? 0.7 : 0.92, metalness: 0, side: leaf ? THREE.DoubleSide : THREE.FrontSide, alphaTest: leaf ? 0.45 : 0 });
  mat.normalMap = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); // enables perturbNormal2Arb
  mat.normalMap.needsUpdate = true;
  mat.userData.U = U; // shared vegetation uniforms (season, wind, snow): tests / tools
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { tArr: { value: tex.alb }, tArrN: { value: tex.nor || tex.alb } });
    sh.vertexShader = vpars(leaf) + sh.vertexShader.replace('#include <begin_vertex>', VBEGIN);
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
    f = f.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n  if (uBake > 0.5) gl_FragColor = vec4(diffuseColor.rgb, 1.0); // impostor albedo bake');
    sh.fragmentShader = 'uniform highp sampler2DArray tArr;\nuniform highp sampler2DArray tArrN;\n' + (leaf ? 'uniform vec3 uAut[24];\n' : '') + 'uniform vec3 uSunV;\nuniform float uSunI;\nuniform float uBake;\nuniform vec4 uSeason;\nvarying vec3 vVUv;\nvarying vec3 vTint;\nvarying float vFlex;\n'
      + (leaf ? 'varying vec2 vExt;\nvarying vec2 vLeaf;\n' + LEAF_ALPHA_GLSL : '') + SNOW_COVER_GLSL + f;
  };
  mat.customProgramCacheKey = () => 'vegB-' + kind;
  let depth = null;
  if (leaf) {
    depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    depth.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, { tArrN: { value: tex.nor } });
      sh.vertexShader = vpars(true) + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 objectNormal = normal;\n' + VBEGIN);
      sh.fragmentShader = 'uniform highp sampler2DArray tArrN;\nvarying vec3 vVUv;\n' + LEAF_ALPHA_GLSL + sh.fragmentShader.replace('void main() {', LEAF_DISCARD);
    };
    depth.customProgramCacheKey = () => 'vegB-leafdepth';
  } else {
    depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = vpars(false) + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 objectNormal = normal;\n' + VBEGIN);
    };
    depth.customProgramCacheKey = () => 'vegB-barkdepth';
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
function makeNeedleMaterials(tex, U) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.66, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { tNA: { value: tex.alb }, tNN: { value: tex.nor } });
    // shadow lookup taken 12 cm toward the sun: an alpha-tested card shadowing itself (and the snow body filling
    // its needle gaps) at shadow-map resolution sprinkled black specks through the snow clumps
    sh.vertexShader = 'uniform vec3 uSunV;\n' + vpars(true, true) + sh.vertexShader.replace('#include <begin_vertex>', VBEGIN)
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
          + nCol * uSunI * 0.05 * gB * ao * (1.0 - scCov);`)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n  if (uBake > 0.5) gl_FragColor = vec4(diffuseColor.rgb, 1.0); // impostor albedo bake');
    sh.fragmentShader = 'uniform vec3 uSunV;\nuniform float uSunI;\nuniform float uBake;\nvarying vec3 vTint;\nvarying vec2 vExt;\nvarying float vFlex;\n' + NEEDLE_FRAG_PARS + SNOW_COVER_GLSL + f;
  };
  mat.customProgramCacheKey = () => 'vegB-needle';
  const alphaOnly = (base, key) => {
    base.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, { tNA: { value: tex.alb }, tNN: { value: tex.nor } });
      sh.vertexShader = vpars(true, true) + sh.vertexShader.replace('#include <begin_vertex>', (key === 'depth' ? 'vec3 objectNormal = normal;\n' : '') + VBEGIN);
      sh.fragmentShader = NEEDLE_FRAG_PARS + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (needleAlpha(texture(tNN, vVUv).b) < 0.5) discard;');
    };
    base.customProgramCacheKey = () => 'vegB-needle' + key;
    return base;
  };
  const depth = alphaOnly(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }), 'depth');
  const aoMat = alphaOnly(new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }), 'ao');
  return { mat, depth, aoMat };
}

const CHUNK = 20;

/** Alpha-tested normal material for the GTAO normal/depth prepass (the stock override ignores card alpha). */
function aoNormalMaterial(tex, U) {
  const m = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { tArrN: { value: tex } });
    sh.vertexShader = vpars(true) + sh.vertexShader.replace('#include <begin_vertex>', VBEGIN);
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
export async function createVegetation(scene, placements, theater = 'temperate', opts = {}) {
  const base = opts.assetBase || new URL('../../../assets/terrain/', import.meta.url).href;
  const [lAlb, bAlb, bNor, lNor, nAlb, nNor] = await Promise.all([
    loadStrip(base + 'foliage.webp', true, true, 512), loadStrip(base + 'bark_albedo.webp', true, false), loadStrip(base + 'bark_normal.webp', false, false),
    loadStrip(base + 'foliage_n.webp', false, true, 256), // leaf sprays: rg normal, b coverage (grid of 256 px tiles)
    loadStrip(base + 'needles.webp', true, true), loadStrip(base + 'needles_n.webp', false, true),
  ]);
  const wind = new THREE.Vector2(opts.wind?.x ?? 1, opts.wind?.z ?? 0.25).normalize();
  const snowDefault = opts.snow ?? (theater === 'snow' ? 1 : 0);
  const U = {
    ...WIND_UNIFORMS, // step 4w shared wind
    uTime: { value: 0 }, uWind: { value: wind }, uWindStr: { value: opts.windStrength ?? 1 },
    uSnowAmt: { value: snowDefault }, uSnowBias: { value: 0 },
    uSunV: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: 3 }, uBake: { value: 0 },
    uAgit: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 1)) },
    uSeason: { value: new THREE.Vector4(opts.season?.autumn ?? 0, opts.season?.dull ?? 0, 0, 0) }, // leaf colour by date (treeSeason)
    uAut: { value: autumnTints() },
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
  let impBank = null;
  let building = null;

  const ts = opts.season || {};
  async function build() {
    const t0 = performance.now();
    const q = TREE_QUALITY[quality];
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
    // unique budget: heroes first (p.hero), then a seeded shuffle, so impostors are spread evenly through forests
    const maxU = opts.maxUnique ?? MAX_UNIQUE[quality] ?? 500;
    let hero = list, imp = [];
    // impostor candidates = trees in dense stands (forest interiors); solitary / hedge / designed trees stay unique
    const cell = new Map(), ck = (x, z) => Math.floor(x / 6) + ',' + Math.floor(z / 6);
    for (const p of list) cell.set(ck(p.x, p.z), (cell.get(ck(p.x, p.z)) || 0) + 1);
    const dens = (p) => { let n = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) n += cell.get(Math.floor(p.x / 6 + a) + ',' + Math.floor(p.z / 6 + b)) || 0; return n; };
    if (list.length > maxU && gl && opts.impostors !== false) {
      // key: heroes first, then sparsest stands; densest forest interiors end up as impostors
      const ord = list.map((p) => [p.hero ? Infinity : 1 / (1 + dens(p)) + 0.02 * hash2(p.seed & 0xffff, p.seed >>> 16, 5), p])
        .sort((a, b) => b[0] - a[0]).map((a) => a[1]);
      hero = ord.slice(0, maxU); imp = ord.slice(maxU);
    }
    // load budget (docs/vegetation.md §5): visual-only plants (forest-fill interiors, understorey) have their own small
    // unique budget; past it the densest become impostors (worker generation of 300+ unique M20 plants cost +4-5 s)
    const maxV = opts.maxVisualUnique ?? Math.round(maxU * 0.3);
    if (gl && opts.impostors !== false) {
      const vis = hero.filter((p) => !p.hero && p.species !== 'fallen' && (p.visual || p.understorey || p.fill));
      if (vis.length > maxV) {
        const drop = new Set(vis.map((p) => [dens(p) + 0.02 * hash2(p.seed & 0xffff, p.seed >>> 16, 7), p]).sort((a, b) => b[0] - a[0]).slice(0, vis.length - maxV).map((a) => a[1]));
        hero = hero.filter((p) => !drop.has(p)); imp = imp.concat([...drop]);
      }
    }
    const chunks = new Map();
    for (const p of hero) {
      const key = Math.floor(p.x / CHUNK) + ',' + Math.floor(p.z / CHUNK);
      if (!chunks.has(key)) chunks.set(key, { key, trees: [] });
      chunks.get(key).trees.push({ species: p.species, seed: p.seed, x: p.x, y: p.y, z: p.z, scale: p.scale, burnt: p.burnt, leafless: p.leafless, marc: p.marc, marcTrees: p.marcTrees, ivy: p.ivy, dates: p.dates, fruit: p.fruit, crownBase: p.crownBase, crownR: p.crownR, visual: p.visual, clear: p.clear });
    }
    const chunkList = [...chunks.values()];
    // generated meshes are a pure function of the chunks + quality: a restart reuses them (session cache)
    const genKey = `trees:${quality}:${dataKey((h) => { h.str(JSON.stringify(q)); h.str(JSON.stringify(chunkList)); })}`;
    let out = cache.get(genKey) || null;
    stats.cached = !!out;
    stats.worker = false;
    const nW = opts.workers ?? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
    if (!out && opts.workers !== 0 && hero.length >= 40) {
      try { out = await genInWorkers(chunkList, q, nW); } catch (e) { console.warn('[vegetation] worker generation failed, falling back', e); out = null; }
      stats.worker = !!out;
    }
    if (!out) {
      out = chunkList.map((c) => {
        const bark = new GeoAcc(), leaf = new GeoAcc(), needle = new GeoAcc();
        const info = c.trees.map((t) => generateTree(t.species, t.seed, q, bark, leaf, t, needle));
        return { key: c.key, bark: bark.count ? bark.toArrays() : null, leaf: leaf.count ? leaf.toArrays() : null, needle: needle.count ? needle.toArrays() : null, info };
      });
    }
    if (!stats.cached) cache.set(genKey, out, { bytes: chunkBytes });
    // swap geometry in only when the new set is ready (no pop-out while regenerating)
    for (const m of [...group.children]) { group.remove(m); m.geometry.dispose(); }
    leafMeshes = [];
    trees = []; stats.tris = 0;
    const byKey = new Map(chunkList.map((c) => [c.key, c]));
    for (const r of out) {
      byKey.get(r.key).trees.forEach((t, i) => trees.push({ ...t, ...r.info[i], impostor: false }));
      for (const [a, M] of [[r.bark, barkM], [r.leaf, leafM], [r.needle, needleM]]) {
        if (!a) continue;
        const mesh = new THREE.Mesh(GeoAcc.arraysToGeometry(a), M.mat);
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
    stats.impostors = 0;
    if (imp.length) {
      // K prototypes per species/variant, baked once per quality change (and once per page for the same set:
      // session cache, so a restart neither regenerates the prototypes nor re-renders the atlas)
      const protoKeys = [...new Set(imp.map((p) => p.species + (p.leafless ? '|bare' : '') + (p.burnt ? '|burnt' : '')))];
      const pitch = opts.camera ? Math.asin(Math.min(1, Math.abs(new THREE.Vector3(0, 0, -1).applyQuaternion(opts.camera.quaternion).y))) : THREE.MathUtils.degToRad(opts.pitchDeg ?? 40);
      const tile = IMP_TILE[quality] ?? 256;
      const impKey = `impostors:${dataKey((h) => h.str(JSON.stringify([protoKeys, q, tile, ts.marc || 0, ts.marcTrees || null, +pitch.toFixed(5), theater, U.uSnowAmt.value, U.uSnowBias.value])))}`;
      const prev = impBank;
      const baked = cache.memo(impKey, () => {
        const protos = [];
        for (const k of protoKeys) {
          const [sp] = k.split('|');
          for (let v = 0; v < PROTOS_PER_SPECIES; v++) {
            const bark = new GeoAcc(), leaf = new GeoAcc(), needle = new GeoAcc();
            const info = generateTree(sp, 9173 + v * 131 + protos.length, q, bark, leaf, { x: 0, y: 0, z: 0, leafless: k.includes('|bare'), burnt: k.includes('|burnt'), marc: k.includes('|bare') ? ts.marc || 0 : 0, marcTrees: ts.marcTrees }, needle);
            protos.push({ key: k, v, info, bark: bark.count ? bark.toGeometry() : null, leaf: leaf.count ? leaf.toGeometry() : null, needle: needle.count ? needle.toGeometry() : null });
          }
        }
        const bank = bakeImpostors(gl, protos, { barkMat: barkM.mat, leafMat: leafM.mat, leafNormalMat: aoMat, needleMat: needleM.mat, needleNormalMat: needleM.aoMat, U }, { views: 6, tile, pitch });
        for (const pr of protos) { pr.bark?.dispose(); pr.leaf?.dispose(); pr.needle?.dispose(); }
        cache.retain(bank.albedo); cache.retain(bank.normal);
        return { bank, heights: protos.map((pr) => pr.info.height) };
      }, { bytes: (b) => b.bank.bytes || 0, dispose: disposeImpostorEntry });
      impBank = baked.bank;
      if (prev && prev !== impBank) { cache.release(prev.albedo); cache.release(prev.normal); }
      const protos = baked.heights.map((height) => ({ info: { height } }));
      const inst = imp.map((p) => {
        const base = protoKeys.indexOf(p.species + (p.leafless ? '|bare' : '') + (p.burnt ? '|burnt' : '')) * PROTOS_PER_SPECIES;
        const pi = base + (p.seed % PROTOS_PER_SPECIES);
        const H = protos[pi].info.height, sp = SPECIES[p.species];
        const want = (sp.H ? sp.H[0] + (sp.H[1] - sp.H[0]) * ((p.seed % 997) / 997) : H) * (p.scale || 1);
        trees.push({ ...p, height: want, impostor: true });
        return { x: p.x, y: p.y, z: p.z, rot: ((p.seed % 6283) / 1000), proto: pi, scale: want / H, bright: 0.85 + 0.3 * ((p.seed % 101) / 101), gain: sp.kind === 'conifer' && !p.burnt ? IMP_NEEDLE_GAIN : 0 };
      });
      group.add(createImpostorMesh(impBank, inst));
      stats.impostors = inst.length;
      stats.impostorMB = +(impBank.bytes / 1048576).toFixed(1);
    }
    stats.trees = trees.length;
    stats.unique = hero.length;
    stats.drawCalls = group.children.length;
    stats.genMs = Math.round(performance.now() - t0);
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
        if (t.impostor || !(SPECIES[t.species]?.kind === 'bush' || (t.height ?? 99) < 7)) continue;
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
    setSnow(a) { U.uSnowAmt.value = a; },
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
      for (const m of group.children) m.geometry.dispose();
      scene.remove(group);
      [barkM.mat, barkM.depth, leafM.mat, leafM.depth, needleM.mat, needleM.depth, needleM.aoMat].forEach((m) => m.dispose());
      [lAlb, bAlb, bNor, lNor, nAlb, nNor].forEach((t) => cache.release(t));
    },
  };
}
