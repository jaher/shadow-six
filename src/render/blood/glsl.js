/**
 * Shared GLSL for the blood layers (pools, decals, smears, stains): the colour/age curve of model.js bloodColor()
 * (fresh arterial red → dark maroon → dried brown; snow ×4 slower with a vivid core), the per-surface drying
 * multiplier, and small hash noises. Colours arrive as linear uniforms built from CONFIG.blood.colors.
 * @module render/blood/glsl
 */
import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { SURFACES } from './model.js';

/** Uniforms every blood material shares (one object: updating it updates all). */
export function bloodUniforms() {
  const C = CONFIG.blood, lin = (h) => new THREE.Color(h); // THREE.Color(hex) converts sRGB → linear working space
  const dm = SURFACES.map((s) => C.surfaces[s]?.dryMul ?? 1);
  return {
    uBloodTime: { value: 0 },
    uBFresh: { value: lin(C.colors.fresh) }, uBDark: { value: lin(C.colors.dark) }, uBDry: { value: lin(C.colors.dry) },
    uBSnow: { value: lin(C.colors.snowCore) }, uBHalo: { value: lin(C.colors.halo) },
    uBAge: { value: new THREE.Vector4(C.age.dark[0], C.age.dark[1], C.age.dry[0], C.age.dry[1]) },
    uBDryMul: { value: new THREE.Vector3(dm[1], dm[4], dm[8]) }, // snow, mud, ice (others 1)
    uBloodPx: { value: 40 }, // screen px per metre (game camera): tiny drops keep a minimum, softer footprint
  };
}

/** Declarations + functions (fragment and vertex safe). Surface codes follow model.js SURFACES. */
export const BLOOD_GLSL = /* glsl */`
uniform float uBloodTime;
uniform vec3 uBFresh, uBDark, uBDry, uBSnow, uBHalo;
uniform vec4 uBAge;
uniform vec3 uBDryMul;
float bDryMul(float sf) { return sf > 0.5 && sf < 1.5 ? uBDryMul.x : sf > 3.5 && sf < 4.5 ? uBDryMul.y : sf > 7.5 && sf < 8.5 ? uBDryMul.z : 1.0; }
// base tone by age on surface sf; .a = wetness (1 fresh … 0 dry)
vec4 bloodTone(float age, float sf) {
  float a = age / bDryMul(sf);
  float d = clamp((a - uBAge.x * 0.25) / (uBAge.y - uBAge.x * 0.25), 0.0, 1.0);
  float y = clamp((a - uBAge.z) / (uBAge.w - uBAge.z), 0.0, 1.0);
  vec3 fresh = sf > 0.5 && sf < 1.5 ? uBSnow : uBFresh;
  return vec4(mix(mix(fresh, uBDark, d), uBDry, y), 1.0 - clamp(a / uBAge.z, 0.0, 1.0));
}
float bHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bHash(i), bHash(i + vec2(1.0, 0.0)), f.x), mix(bHash(i + vec2(0.0, 1.0)), bHash(i + vec2(1.0, 1.0)), f.x), f.y); }
`;

/**
 * Terrain trail displacement (art/terrain/terrain-glsl.js VERT_MAIN) replayed on blood geometry, so pools, smears and
 * decals lie IN footprints, drag furrows, craters and the snow melt dip instead of floating over them. The terrain mesh
 * is displaced at its vertices only (segPerM per metre), so the same 4 corners are sampled and interpolated.
 * Returns {uniforms, defines} to merge into a material, or null without the real terrain.
 */
export function trailFollow(world) {
  const t = world?.terrain?.terrain, U = t?.uniforms;
  if (!U?.tTrail?.value || !U.tSplatA || !U.uMap || !U.uSoft) return null;
  return {
    uniforms: { tTrail: U.tTrail, tSplatA: U.tSplatA, tSplatB: U.tSplatB, uMap: U.uMap, uSoft: U.uSoft, uSegPerM: { value: t.segPerM || 4 } },
  };
}

export const TRAIL_VERT_PARS = /* glsl */`
#ifdef S6_TRAIL
uniform sampler2D tTrail; uniform sampler2D tSplatA; uniform sampler2D tSplatB; uniform vec4 uMap; uniform float uSoft[8]; uniform float uSegPerM;
float s6Dy1(vec2 p) {
  vec2 tuv = p * uMap.zw;
  vec4 tr = texture2D(tTrail, tuv), sa = texture2D(tSplatA, tuv), sb = texture2D(tSplatB, tuv);
  float soft = dot(sa, vec4(uSoft[0], uSoft[1], uSoft[2], uSoft[3])) + dot(sb, vec4(uSoft[4], uSoft[5], uSoft[6], uSoft[7]));
  return (-tr.r + 0.45 * tr.g) * soft;
}
float s6TrailDy(vec2 xz) {
  vec2 g = xz * uSegPerM, i = floor(g), f = g - i, s = vec2(1.0 / uSegPerM);
  vec2 p = i * s.x;
  return mix(mix(s6Dy1(p), s6Dy1(p + vec2(s.x, 0.0)), f.x), mix(s6Dy1(p + vec2(0.0, s.y)), s6Dy1(p + s), f.x), f.y);
}
#endif
`;
export const TRAIL_VERT_MAIN = /* glsl */`
#ifdef S6_TRAIL
{
  #ifdef USE_INSTANCING
  vec4 s6w = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #else
  vec4 s6w = modelMatrix * vec4(transformed, 1.0);
  #endif
  mvPosition.xyz += (viewMatrix * vec4(0.0, s6TrailDy(s6w.xz), 0.0, 0.0)).xyz;
  gl_Position = projectionMatrix * mvPosition;
}
#endif
`;

/** Patch a vertex shader (onBeforeCompile) to follow the terrain trails when `follow` (trailFollow()) is set. */
export function followTrails(sh, follow) {
  if (!follow) return;
  Object.assign(sh.uniforms, follow.uniforms);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\n#define S6_TRAIL\n${TRAIL_VERT_PARS}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${TRAIL_VERT_MAIN}`);
}
