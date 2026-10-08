/**
 * Anti-tiling for the textured kit / dressing / castle / library-building materials (MeshStandardMaterial with tiling
 * PBR maps on world-scale UVs). One shader patch, chained onto any existing onBeforeCompile:
 *
 *  - 'iso' finishes (plaster, render, screed, concrete tops, sand, gravel, rock, mud …): hex tiling on medium and up
 *    (art/anti-tiling-glsl.js: 3 randomly offset + rotated taps of every map, smooth weights, variance-preserving
 *    blend, normals rotated back); low keeps one plain sample,
 *  - 'shift' finishes (bricks, ashlar, planks, roof tiles, corrugated sheet … whose courses must stay straight): the
 *    courses repeat as laid, but the texture's low frequencies (stains, patches: a coarse mip) are hex-tiled and
 *    swapped in (medium and up),
 *  - no per-object uv offset or tone: pieces that abut (plateau slabs, roofs, walls built from several boxes or GLB
 *    meshes) keep continuous texturing across their shared edges; buildings differ through the world-space variation,
 *  - both: macro variation in world space that never repeats — building-scale tone / hue, a 10-30 m colour drift, grime
 *    patches, rain streaks and rising damp on walls, dust on roofs — with roughness and normal strength following.
 * The preset only switches a shared uniform (setAntiTilingQuality): one program per material for every preset.
 * @module art/anti-tiling
 */
import * as THREE from 'three';
import { AT_COMMON } from './anti-tiling-glsl.js';
import { pfbm } from './terrain/noise.js';

/** Shared uniforms: uAtMode 0 = low (no hex), 1 = hex on; uAtMacro scales the macro variation (1 = on). */
export const AT_UNIFORMS = { uAtMode: { value: 1 }, uAtMacro: { value: 1 }, tAtNoise: { value: null } };
/** Small tileable fbm noise (RGBA: base periods 4, 3, 6, 8), built once on first use. */
export function atNoiseTexture() {
  if (AT_UNIFORMS.tAtNoise.value) return AT_UNIFORMS.tAtNoise.value;
  const n = 128, d = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const o = (j * n + i) * 4;
    d[o] = pfbm(i, j, n, 4, 4, 911) * 255; d[o + 1] = pfbm(i, j, n, 3, 3, 917) * 255;
    d[o + 2] = pfbm(i, j, n, 6, 3, 923) * 255; d[o + 3] = pfbm(i, j, n, 8, 3, 929) * 255;
  }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return (AT_UNIFORMS.tAtNoise.value = t);
}
export const AT_HEX = { low: 0, medium: 1, high: 1, ultra: 1 };
let atPreset = null;
/** Follow the render preset (called per displayed frame by the map handle; a no-op unless it changed). */
export function setAntiTilingQuality(preset) {
  if (preset === atPreset || !(preset in AT_HEX)) return;
  atPreset = preset;
  AT_UNIFORMS.uAtMode.value = AT_HEX[preset];
}

/** Library finishes (assets/textures/lib/materials.json names) that may be hex-tiled; value = rotation 0..1. */
const ISO = {
  plaster_white: 1, plaster_limewash: 1, adobe_ochre: 1, plaster_rough: 1, concrete_bunker: 1, concrete_slab: 1,
  gravel: 1, snow: 1, mud: 1, sand: 0.12, limewash_worn: 1, mud_render: 1, mud_render2: 1, limewash_lumpy: 1,
  screed_roof: 1, screed_lime: 1, sod: 1, turf_grass: 1, rock_cliff: 1, scree_grey: 1, snow_soft: 1,
  concrete_aggregate: 1, gravel_grey: 1, granite_polished: 1, limestone_smooth: 1, paint_metal: 1, steel_galv: 1,
  bitumen_felt: 1,
};
/** Atlases, cut-outs, glass, decals: never touched. */
const NONE = new Set(['glass_dirty', 'interior_dark', 'curtain', 'decals', 'decals_dz', 'signs', 'stele_face', 'mesh_screen',
  'foliage_atlas', 'fuel_stencils', 'fuel_grating', 'camo_netting', 'palm_frond_dz', 'water_flow', 'cast_iron', 'steel_grating']);

/**
 * Anti-tiling class of a library finish (file base name, e.g. 'plaster_limewash' or 'plaster_limewash_diff').
 * @returns {{kind: 'iso'|'shift'|'none', rot: number}}
 */
export function antiTilingClass(name) {
  const n = String(name || '').replace(/\.(jpg|png|webp)$/, '').replace(/_(diff|nor|arm|rgba)$/, '');
  if (!n || NONE.has(n)) return { kind: 'none', rot: 0 };
  if (n in ISO) return { kind: 'iso', rot: ISO[n] };
  return { kind: 'shift', rot: 0 };
}

const VERT_PARS = /* glsl */ `
varying vec3 vAtW;
`;
const VERT_MAIN = /* glsl */ `
{
  vec4 atP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    atP = instanceMatrix * atP;
  #endif
  #ifdef USE_BATCHING
    atP = batchingMatrix * atP;
  #endif
  vAtW = (modelMatrix * atP).xyz;
}
`;
const FRAG_PARS = /* glsl */ `
uniform float uAtMode;
uniform float uAtMacro;
uniform sampler2D tAtNoise;
uniform vec4 uAtCfg;   // hex (0/1), rotation 0..1, macro strength, grime
varying vec3 vAtW;
${AT_COMMON}
AtHex atH;
vec3 atW3 = vec3(1.0, 0.0, 0.0);
bool atHexOn = false;
vec4 atArm = vec4(1.0);
// normal / ARM maps on hex: the same three taps and weights as the albedo. (Reading only the dominant tap switched the
// lighting detail and roughness abruptly where the dominant tap changed: on low-contrast finishes those lines are the
// hex cells' straight edges, i.e. straight seams across every plaster roof and floor.)
vec4 atSample(sampler2D t, vec2 uv) {
  if (!atHexOn) return texture(t, uv);
  return atTex3(t, atH, atW3, uv, dFdx(uv), dFdy(uv));
}
vec3 atSampleN(sampler2D t, vec2 uv) {
  if (!atHexOn) return texture(t, uv).xyz * 2.0 - 1.0;
  return atNor3(t, atH, atW3, uv, dFdx(uv), dFdy(uv));
}
`;
// map_fragment: set up the hex cells + weights from the albedo, then sample it
const MAP = /* glsl */ `
atHexOn = uAtCfg.x > 0.5 && uAtMode > 0.5;
#ifdef USE_MAP
{
  vec2 uv = vMapUv;
  vec4 sampledDiffuseColor;
  if (atHexOn) {
    atH = atHex(uv, 3.4641016, uAtCfg.y, 0.0);
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    vec4 a1 = textureGrad(map, atUV1(atH, uv), atH.r1 * dx, atH.r1 * dy);
    vec4 a2 = textureGrad(map, atUV2(atH, uv), atH.r2 * dx, atH.r2 * dy);
    vec4 a3 = textureGrad(map, atUV3(atH, uv), atH.r3 * dx, atH.r3 * dy);
    atW3 = atHexW(atH, a1.rgb, a2.rgb, a3.rgb);
    sampledDiffuseColor = atVP(a1, a2, a3, atW3, atMean(map));
  } else {
    sampledDiffuseColor = texture(map, uv);
    if (uAtMode > 0.5) {
      // structured finishes (courses, laps, tiles stay put): only the texture's low frequencies (stains, patches,
      // sun-bleached areas at 1/8 repeat and up, read from a coarse mip) are hex-tiled: divide out the repeat's own,
      // multiply in a randomly placed, turned one. Blurred content blends without seams.
      float L = log2(float(textureSize(map, 0).x)) - 3.0;
      vec3 lo = textureLod(map, uv, L).rgb;
      AtHex hl = atHex(uv, 2.0, 1.0, 5.0);
      vec3 lw = hl.w * hl.w; lw /= dot(lw, vec3(1.0));
      vec3 lh = atVP(textureLod(map, atUV1(hl, uv), L), textureLod(map, atUV2(hl, uv), L), textureLod(map, atUV3(hl, uv), L), lw, atMean(map)).rgb;
      sampledDiffuseColor.rgb *= clamp(lh / max(lo, vec3(0.015)), vec3(0.6), vec3(1.6));
    }
  }
  diffuseColor *= sampledDiffuseColor;
}
#else
  atHexOn = false;
#endif
float atGrime = 0.0, atNrmK = 1.0, atRoughD = 0.0;
{ // macro variation (world space): building-scale tone + hue, colour drift, grime, rain streaks, rising damp, roof dust.
  // Three fetches of a small tileable noise texture at incommensurate scales / angles (no visible period).
  vec3 wp = vAtW;
  #ifdef FLAT_SHADED
    float ny = abs(normalize(cross(dFdx(vAtW), dFdy(vAtW))).y);
  #else
    float ny = abs(normalize((vec4(normalize(vNormal), 0.0) * viewMatrix).xyz).y);
  #endif
  float up = smoothstep(0.55, 0.85, ny), side = 1.0 - smoothstep(0.35, 0.7, ny);
  float k = uAtCfg.z * uAtMacro;
  vec4 n1 = texture(tAtNoise, wp.xz / 53.0 + 0.17);                                    // ~13 m blobs: one building, one tone
  vec4 n2 = texture(tAtNoise, mat2(0.8, -0.6, 0.6, 0.8) * (wp.xz + wp.y * 0.61) / 11.3 + 0.37); // ~3 m: grime, dust
  vec4 n3 = texture(tAtNoise, vec2((wp.x + wp.z) / 7.0, wp.y / 41.0));               // vertical rain streaks
  vec3 tone = vec3(0.92 + 0.16 * n1.r) * mix(vec3(0.97, 0.99, 1.03), vec3(1.03, 1.0, 0.965), n1.g);
  tone *= 0.96 + 0.08 * n2.a;
  diffuseColor.rgb *= mix(vec3(1.0), tone, k);
  float g = smoothstep(0.52, 0.78, n2.r * 0.6 + n1.b * 0.4);
  float streak = side * smoothstep(0.55, 0.85, n3.b);
  float damp = side * (1.0 - smoothstep(0.0, 0.7 + 0.6 * n3.a, wp.y - 0.05));   // rising damp off the ground
  atGrime = clamp(g * 0.7 + streak * 0.5 + damp * 0.6, 0.0, 1.0) * uAtCfg.w * k;
  diffuseColor.rgb *= 1.0 - 0.28 * atGrime;
  float dust = up * smoothstep(0.5, 0.75, n2.g) * uAtCfg.w * k;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))) * vec3(1.06, 1.0, 0.9), dust * 0.35);
  atRoughD = (atGrime * 0.06 + dust * 0.08 - damp * 0.1 * uAtCfg.w) * k;
  atNrmK = 1.0 - 0.3 * dust;
}
`;
// AT_ARM_RM / AT_ARM_AO: metalness / AO share the roughness map (one ARM texture): sampled once (3 taps on hex)
const ROUGH = /* glsl */ `
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  #ifdef AT_PLAIN_R
    atArm = texture2D(roughnessMap, vRoughnessMapUv);
  #else
    atArm = atSample(roughnessMap, vRoughnessMapUv);
  #endif
  roughnessFactor *= atArm.g;
#endif
roughnessFactor = clamp(roughnessFactor + atRoughD, 0.04, 1.0);
`;
const METAL = /* glsl */ `
float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
  #ifdef AT_ARM_RM
    vec4 texelMetalness = atArm;
  #elif defined(AT_PLAIN_M)
    vec4 texelMetalness = texture2D(metalnessMap, vMetalnessMapUv);
  #else
    vec4 texelMetalness = atSample(metalnessMap, vMetalnessMapUv);
  #endif
  metalnessFactor *= texelMetalness.b;
#endif
`;
// a separate AO map is a baked, unique (uv1) occlusion: never hex-tiled or offset; only a shared ARM map reuses atArm
const AO = THREE.ShaderChunk.aomap_fragment.replace('texture2D( aoMap, vAoMapUv )', '\n#ifdef AT_ARM_AO\n atArm\n#else\n texture2D( aoMap, vAoMapUv )\n#endif\n');
const NORMAL = THREE.ShaderChunk.normal_fragment_maps
  .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', '\n#ifdef AT_PLAIN_N\n vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;\n#else\n vec3 mapN = atSampleN( normalMap, vNormalMapUv );\n#endif\n')
  .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * atNrmK;');

const keep = (inc) => `\n// ${inc}`;   // the include stays visible (commented) for later patches that anchor on it

/**
 * Patch a material in place (idempotent). Chains any existing onBeforeCompile and program key.
 * @param {THREE.Material} mat MeshStandardMaterial / MeshPhysicalMaterial
 * @param {{kind?: 'iso'|'shift'|'none', rot?: number, macro?: number, grime?: number, lib?: string}} [o]
 *   lib = library finish name (sets kind / rot); macro 0..1 strength of the tone / colour drift; grime 0..1
 * @returns {THREE.Material}
 */
const PATCHED = new WeakSet();
export function antiTile(mat, o = {}) {
  if (!mat || !mat.isMeshStandardMaterial || PATCHED.has(mat)) return mat;
  const cls = o.lib ? antiTilingClass(o.lib) : { kind: o.kind ?? 'shift', rot: o.rot ?? 1 };
  if (cls.kind === 'none') return mat;
  PATCHED.add(mat);
  const cfg = new THREE.Vector4(cls.kind === 'iso' ? 1 : 0, o.rot ?? cls.rot, o.macro ?? 1, o.grime ?? 0.5);
  mat.userData.antiTiling = { kind: cls.kind };
  // Material.clone() drops instance hooks: clones (painted / double-sided variants) get the same patch
  mat.clone = function () { const c = Object.getPrototypeOf(this).clone.call(this); delete c.clone; return antiTile(c, o); };
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey.call(mat);
  // maps on another uv set than the albedo (baked AO / lightmap uvs) are sampled as they are
  const ch = (t) => t?.channel ?? 0, onMapUV = (t) => !!t && (!mat.map || (ch(t) === ch(mat.map) && t.matrix.equals(mat.map.matrix)));
  const armRM = () => !!(mat.roughnessMap && mat.roughnessMap === mat.metalnessMap);
  const armAO = () => !!(mat.roughnessMap && mat.roughnessMap === mat.aoMap && onMapUV(mat.roughnessMap));
  const flags = () => (armRM() ? 'R' : '') + (armAO() ? 'A' : '') + (mat.normalMap && !onMapUV(mat.normalMap) ? 'n' : '')
    + (mat.roughnessMap && !onMapUV(mat.roughnessMap) ? 'r' : '') + (mat.metalnessMap && !onMapUV(mat.metalnessMap) ? 'm' : '');
  mat.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r);
    atNoiseTexture();
    sh.uniforms.uAtMode = AT_UNIFORMS.uAtMode; sh.uniforms.uAtMacro = AT_UNIFORMS.uAtMacro; sh.uniforms.tAtNoise = AT_UNIFORMS.tAtNoise;
    const f = flags(), def = (c, d) => (f.includes(c) ? `#define ${d}\n` : '');
    const defs = def('R', 'AT_ARM_RM') + def('A', 'AT_ARM_AO') + def('n', 'AT_PLAIN_N') + def('r', 'AT_PLAIN_R') + def('m', 'AT_PLAIN_M');
    sh.fragmentShader = defs + sh.fragmentShader;
    sh.uniforms.uAtCfg = { value: cfg };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <map_fragment>', MAP + keep('#include <map_fragment>'))
      .replace('#include <roughnessmap_fragment>', ROUGH + keep('#include <roughnessmap_fragment>'))
      .replace('#include <metalnessmap_fragment>', METAL + keep('#include <metalnessmap_fragment>'))
      .replace('#include <normal_fragment_maps>', NORMAL + keep('#include <normal_fragment_maps>'))
      .replace('#include <aomap_fragment>', AO + keep('#include <aomap_fragment>'));
  };
  mat.customProgramCacheKey = () => `${prevKey}|at:${cls.kind}${flags()}`;
  mat.needsUpdate = true;
  return mat;
}
