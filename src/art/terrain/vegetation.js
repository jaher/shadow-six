/**
 * createVegetation — every placed tree/bush is generated from its own seed (treegen.js), so no two are alike.
 * Geometry is merged per 20 m chunk into 2 draw calls (bark + foliage cards) with frustum culling.
 * Textures: CC0 bark scans and ambientCG leaf-scan cluster cards in two sampler2DArrays.
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
const IMP_TILE = { low: 128, medium: 160, high: 192, ultra: 224 };

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
const vpars = (leaf) => WIND_GLSL + (leaf ? '#define VEG_LEAF\n' : '') + /* glsl */ `
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
    f = f.replace('#include <color_fragment>', `#include <color_fragment>
      float scCov = snowCoverage(normalize(vScWN), vScWP, uSnowAmt ${leaf ? '* 1.15' : ''});${leaf ? `
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
  const [lAlb, bAlb, bNor] = await Promise.all([
    loadStrip(base + 'foliage.webp', true, true), loadStrip(base + 'bark_albedo.webp', true, false), loadStrip(base + 'bark_normal.webp', false, false),
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
        const bark = new GeoAcc(), leaf = new GeoAcc();
        const info = c.trees.map((t) => generateTree(t.species, t.seed, q, bark, leaf, t));
        return { key: c.key, bark: bark.count ? bark.toArrays() : null, leaf: leaf.count ? leaf.toArrays() : null, info };
      });
    }
    // swap geometry in only when the new set is ready (no pop-out while regenerating)
    for (const m of [...group.children]) { group.remove(m); m.geometry.dispose(); }
    leafMeshes = [];
    trees = []; stats.tris = 0;
    const byKey = new Map(chunkList.map((c) => [c.key, c]));
    for (const r of out) {
      byKey.get(r.key).trees.forEach((t, i) => trees.push({ ...t, ...r.info[i], impostor: false }));
      for (const [a, M] of [[r.bark, barkM], [r.leaf, leafM]]) {
        if (!a) continue;
        const mesh = new THREE.Mesh(GeoAcc.arraysToGeometry(a), M.mat);
        mesh.customDepthMaterial = M.depth;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.name = M === barkM ? 'vegBark' : 'vegLeaves';
        if (M === leafM) { leafMeshes.push(mesh); mesh.userData.aoMaterial = aoMat; } // alpha-aware GTAO prepass (engine/gtao-alpha.js)
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
          const bark = new GeoAcc(), leaf = new GeoAcc();
          const info = generateTree(sp, 9173 + v * 131 + protos.length, q, bark, leaf, { x: 0, y: 0, z: 0, leafless: k.includes('|bare'), burnt: k.includes('|burnt') });
          protos.push({ key: k, v, info, bark: bark.count ? bark.toGeometry() : null, leaf: leaf.count ? leaf.toGeometry() : null });
        }
      }
      impBank?.albedo.dispose(); impBank?.normal.dispose();
      const pitch = opts.camera ? Math.asin(Math.min(1, Math.abs(new THREE.Vector3(0, 0, -1).applyQuaternion(opts.camera.quaternion).y))) : THREE.MathUtils.degToRad(opts.pitchDeg ?? 40);
      impBank = bakeImpostors(gl, protos, { barkMat: barkM.mat, leafMat: leafM.mat, leafNormalMat: aoMat, U }, { views: 6, tile: IMP_TILE[quality] ?? 256, pitch });
      for (const pr of protos) { pr.bark?.dispose(); pr.leaf?.dispose(); }
      const inst = imp.map((p) => {
        const base = protoKeys.indexOf(p.species + (p.leafless ? '|bare' : '') + (p.burnt ? '|burnt' : '')) * PROTOS_PER_SPECIES;
        const pi = base + (p.seed % PROTOS_PER_SPECIES);
        const H = protos[pi].info.height, sp = SPECIES[p.species];
        const want = (sp.H ? sp.H[0] + (sp.H[1] - sp.H[0]) * ((p.seed % 997) / 997) : H) * (p.scale || 1);
        trees.push({ ...p, height: want, impostor: true });
        return { x: p.x, y: p.y, z: p.z, rot: ((p.seed % 6283) / 1000), proto: pi, scale: want / H, bright: 0.85 + 0.3 * ((p.seed % 101) / 101) };
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
      [barkM.mat, barkM.depth, leafM.mat, leafM.depth].forEach((m) => m.dispose());
      [lAlb, bAlb, bNor].forEach((t) => t.dispose());
    },
  };
}
