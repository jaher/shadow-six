/**
 * createVegetation — every placed tree/bush is generated from its own seed (treegen.js), so no two are alike.
 * Geometry is merged per 20 m chunk into 2 draw calls (bark + foliage cards; conifer needle sprays use their own
 * needle material, so only a chunk mixing broadleaves and conifers has a third) with frustum culling.
 * Textures: CC0 bark scans, ambientCG leaf-scan cluster cards and the baked needle-spray atlas in sampler2DArrays.
 * Shader: wind sway (trunk) + flutter (cards), bent crown normals, leaf translucency, snow cover, alpha-tested shadows.
 * @module terrain-b/vegetation
 */
import * as THREE from 'three';
import { generateTree, GeoAcc, TREE_QUALITY, SPECIES, useThree } from './treegen.js';
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

function loadStrip(url, srgb, alpha) {
  return loadLayerArray(url, { srgb, anisotropy: 4, wrap: alpha ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping });
}

/** Hierarchical (SpeedTree-style) wind, step 4w: trunk bend from the root + branch sway + leaf flutter + palm whip,
 * all from the shared WindField sampled at the tree root (gust fronts roll through canopies tree by tree). */
const vpars = (leaf, needle = false) => WIND_GLSL + (leaf ? '#define VEG_LEAF\n' : '') + (needle ? '#define VEG_NEEDLE\n' : '') + /* glsl */ `
#ifdef VEG_NEEDLE
attribute vec2 aExt;  // crown AO, signed snow catch (conifers.js)
varying vec2 vExt;
#endif
attribute vec4 aInfo;   // layer, sway weight (height), flex (0 trunk .. 1 leaf), phase
attribute vec3 aTint;
attribute vec4 aRoot;   // tree root x, y, z, H + 100·kind (0 broad, 1 conifer, 2 palm, 3 bush)
uniform float uTime;
uniform vec2 uWind;
uniform float uWindStr; // 0..1 multiplier (0 while baking impostors)
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
#ifdef VEG_NEEDLE
vExt = aExt;
#endif
`;

function makeMaterials(tex, U, kind) {
  const leaf = kind === 'leaf';
  const mat = new THREE.MeshStandardMaterial({ roughness: leaf ? 0.7 : 0.92, metalness: 0, side: leaf ? THREE.DoubleSide : THREE.FrontSide, alphaTest: leaf ? 0.45 : 0 });
  mat.normalMap = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); // enables perturbNormal2Arb
  mat.normalMap.needsUpdate = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { tArr: { value: tex.alb }, tArrN: { value: tex.nor || tex.alb } });
    sh.vertexShader = vpars(leaf) + sh.vertexShader.replace('#include <begin_vertex>', VBEGIN);
    let f = sh.fragmentShader;
    f = f.replace('#include <map_fragment>', `
      vec4 tA = texture(tArr, vVUv);
      ${leaf ? 'if (tA.a < 0.45) discard;' : ''}
      diffuseColor.rgb *= tA.rgb * vTint;`);
    if (leaf) {
      // no back-face flip: bent crown normals give the volumetric look
      f = f.replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
        .replace('#include <normal_fragment_maps>', '')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          // must-fix 6/7: translucent, back-lit cards. Light transmitted through leaves/needles facing away from the
          // sun (wrap + transmission) and canopy multiple scattering on the ambient, so cards never go black.
          vec3 Ls = normalize(uSunV);
          float trl = pow(max(dot(-Ls, normalize(vViewPosition)), 0.0), 3.0);
          float back = max(-dot(normal, Ls), 0.0);
          vec3 trans = diffuseColor.rgb * vec3(1.0, 1.08, 0.6) * uSunI * (0.07 + 0.16 * back + 0.3 * trl) * (1.0 - scCov);
          reflectedLight.directDiffuse += trans;
          reflectedLight.indirectDiffuse *= 1.3;`);
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
      scCov *= smoothstep(0.26, 0.62, scNoise(vScWP * 1.9) * 0.6 + scNoise(vScWP * 8.5) * 0.4);` : ''}
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.84, 0.9), scCov);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.6, scCov);');
    f = f.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n  if (uBake > 0.5) gl_FragColor = vec4(diffuseColor.rgb, 1.0); // impostor albedo bake');
    sh.fragmentShader = 'uniform highp sampler2DArray tArr;\nuniform highp sampler2DArray tArrN;\nuniform vec3 uSunV;\nuniform float uSunI;\nuniform float uBake;\nvarying vec3 vVUv;\nvarying vec3 vTint;\nvarying float vFlex;\n' + SNOW_COVER_GLSL + f;
  };
  mat.customProgramCacheKey = () => 'vegB-' + kind;
  let depth = null;
  if (leaf) {
    depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    depth.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, { tArr: { value: tex.alb } });
      sh.vertexShader = vpars(true) + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 objectNormal = normal;\n' + VBEGIN);
      sh.fragmentShader = 'uniform highp sampler2DArray tArr;\nvarying vec3 vVUv;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (texture(tArr, vVUv).a < 0.45) discard;');
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
    Object.assign(sh.uniforms, U, { tArr: { value: tex } });
    sh.vertexShader = vpars(true) + sh.vertexShader.replace('#include <begin_vertex>', VBEGIN);
    sh.fragmentShader = 'uniform highp sampler2DArray tArr;\nvarying vec3 vVUv;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (texture(tArr, vVUv).a < 0.45) discard;');
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
  const [lAlb, bAlb, bNor, nAlb, nNor] = await Promise.all([
    loadStrip(base + 'foliage.webp', true, true), loadStrip(base + 'bark_albedo.webp', true, false), loadStrip(base + 'bark_normal.webp', false, false),
    loadStrip(base + 'needles.webp', true, true), loadStrip(base + 'needles_n.webp', false, true),
  ]);
  const wind = new THREE.Vector2(opts.wind?.x ?? 1, opts.wind?.z ?? 0.25).normalize();
  const snowDefault = opts.snow ?? (theater === 'snow' ? 1 : 0);
  const U = {
    ...WIND_UNIFORMS, // step 4w shared wind
    uTime: { value: 0 }, uWind: { value: wind }, uWindStr: { value: opts.windStrength ?? 1 },
    uSnowAmt: { value: snowDefault }, uSnowBias: { value: 0 },
    uSunV: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: 3 }, uBake: { value: 0 },
  };
  const barkM = makeMaterials({ alb: bAlb, nor: bNor }, U, 'bark');
  const leafM = makeMaterials({ alb: lAlb }, U, 'leaf');
  const aoMat = aoNormalMaterial(lAlb, U);
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

  async function build() {
    const t0 = performance.now();
    const q = TREE_QUALITY[quality];
    const list = [];
    for (const p of placements) {
      if (!SPECIES[p.species]) continue;
      const y = p.y ?? opts.terrain?.heightAt?.(p.x, p.z) ?? 0;
      const seed = p.seed ?? Math.floor(hash2(Math.round(p.x * 100), Math.round(p.z * 100), 77) * 1e9);
      list.push({ ...p, y, seed, leafless: p.leafless ?? (theater === 'snow' && SPECIES[p.species].kind === 'broad') });
    }
    // unique budget: heroes first (p.hero), then a seeded shuffle, so impostors are spread evenly through forests
    const maxU = opts.maxUnique ?? MAX_UNIQUE[quality] ?? 500;
    let hero = list, imp = [];
    if (list.length > maxU && gl && opts.impostors !== false) {
      // impostor candidates = trees in dense stands (forest interiors); solitary / hedge / designed trees stay unique
      const cell = new Map(), ck = (x, z) => Math.floor(x / 6) + ',' + Math.floor(z / 6);
      for (const p of list) cell.set(ck(p.x, p.z), (cell.get(ck(p.x, p.z)) || 0) + 1);
      const dens = (p) => { let n = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) n += cell.get(Math.floor(p.x / 6 + a) + ',' + Math.floor(p.z / 6 + b)) || 0; return n; };
      // key: heroes first, then sparsest stands; densest forest interiors end up as impostors
      const ord = list.map((p) => [p.hero ? Infinity : 1 / (1 + dens(p)) + 0.02 * hash2(p.seed & 0xffff, p.seed >>> 16, 5), p])
        .sort((a, b) => b[0] - a[0]).map((a) => a[1]);
      hero = ord.slice(0, maxU); imp = ord.slice(maxU);
    }
    const chunks = new Map();
    for (const p of hero) {
      const key = Math.floor(p.x / CHUNK) + ',' + Math.floor(p.z / CHUNK);
      if (!chunks.has(key)) chunks.set(key, { key, trees: [] });
      chunks.get(key).trees.push({ species: p.species, seed: p.seed, x: p.x, y: p.y, z: p.z, scale: p.scale, burnt: p.burnt, leafless: p.leafless, crownBase: p.crownBase, crownR: p.crownR });
    }
    const chunkList = [...chunks.values()];
    let out = null;
    const nW = opts.workers ?? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
    if (opts.workers !== 0 && hero.length >= 40) {
      try { out = await genInWorkers(chunkList, q, nW); } catch (e) { console.warn('[vegetation] worker generation failed, falling back', e); out = null; }
    }
    stats.worker = !!out;
    if (!out) {
      out = chunkList.map((c) => {
        const bark = new GeoAcc(), leaf = new GeoAcc(), needle = new GeoAcc();
        const info = c.trees.map((t) => generateTree(t.species, t.seed, q, bark, leaf, t, needle));
        return { key: c.key, bark: bark.count ? bark.toArrays() : null, leaf: leaf.count ? leaf.toArrays() : null, needle: needle.count ? needle.toArrays() : null, info };
      });
    }
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
      // K prototypes per species/variant, baked once per quality change
      const protoKeys = [...new Set(imp.map((p) => p.species + (p.leafless ? '|bare' : '') + (p.burnt ? '|burnt' : '')))];
      const protos = [];
      for (const k of protoKeys) {
        const [sp] = k.split('|');
        for (let v = 0; v < PROTOS_PER_SPECIES; v++) {
          const bark = new GeoAcc(), leaf = new GeoAcc(), needle = new GeoAcc();
          const info = generateTree(sp, 9173 + v * 131 + protos.length, q, bark, leaf, { x: 0, y: 0, z: 0, leafless: k.includes('|bare'), burnt: k.includes('|burnt') }, needle);
          protos.push({ key: k, v, info, bark: bark.count ? bark.toGeometry() : null, leaf: leaf.count ? leaf.toGeometry() : null, needle: needle.count ? needle.toGeometry() : null });
        }
      }
      impBank?.albedo.dispose(); impBank?.normal.dispose();
      const pitch = opts.camera ? Math.asin(Math.min(1, Math.abs(new THREE.Vector3(0, 0, -1).applyQuaternion(opts.camera.quaternion).y))) : THREE.MathUtils.degToRad(opts.pitchDeg ?? 40);
      impBank = bakeImpostors(gl, protos, { barkMat: barkM.mat, leafMat: leafM.mat, leafNormalMat: aoMat, needleMat: needleM.mat, needleNormalMat: needleM.aoMat, U }, { views: 6, tile: IMP_TILE[quality] ?? 256, pitch });
      for (const pr of protos) { pr.bark?.dispose(); pr.leaf?.dispose(); pr.needle?.dispose(); }
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
    dispose() {
      for (const m of group.children) m.geometry.dispose();
      scene.remove(group);
      [barkM.mat, barkM.depth, leafM.mat, leafM.depth, needleM.mat, needleM.depth, needleM.aoMat].forEach((m) => m.dispose());
      [lAlb, bAlb, bNor, nAlb, nNor].forEach((t) => t.dispose());
    },
  };
}
