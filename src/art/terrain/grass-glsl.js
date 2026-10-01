/**
 * Instanced grass tuft vertex code (shared by the colour material and the shadow depth material).
 * @module terrain-b/grass-glsl
 */
import { WIND_GLSL } from '../../world/wind.js';

export const GRASS_PARS = WIND_GLSL + /* glsl */ `
attribute vec4 iOff;    // x, y, z, rotation
attribute vec4 iScl;    // height scale, width scale, colour random, type (0 green, 1 dry, 2 weed, 3 snow-poke)
attribute vec4 aBlade;  // t (0 root → 1 tip), side (-1/0/1), lateral dir xz
uniform float uTime;
uniform vec2 uWind;
uniform float uWindStr;
uniform sampler2D tTrail;
uniform sampler2D tFlatG;
uniform sampler2D tBloodG; // world-space blood mask (render/blood, bodies-design §B.3 grass): blades darken red-brown
uniform sampler2D tNoiseG;
uniform vec4 uMapG;
uniform float uMinW;      // metres: min blade width for the current pixel footprint
uniform float uLodW;      // blade width multiplier compensating the density LOD
varying vec3 vGCol;
varying float vGT;
vec3 grassPos(vec3 p, inout vec3 n) {
  float t = aBlade.x;
  float s = sin(iOff.w), c = cos(iOff.w);
  // widen thin blades to stay >= ~1px at the current zoom (prevents sub-pixel shimmer)
  float extra = max(uMinW - 0.012 * iScl.y, 0.0) * 0.5 * (1.0 - t * 0.7) + 0.006 * (uLodW - 1.0) * (1.0 - t * 0.8);
  p.xz += aBlade.zw * aBlade.y * extra;
  p.y *= iScl.x;
  p.xz *= mix(1.0, iScl.x, 0.6);
  vec2 wp = iOff.xz;
  vec4 tr = texture(tTrail, wp * uMapG.zw);
  tr.a = texture(tFlatG, wp * uMapG.zw).r;
  float fl = clamp(tr.a + tr.r * 0.8, 0.0, 1.0);
  // trampled: pressed down and splayed along the ground
  vec2 outD = length(p.xz) > 1e-4 ? normalize(p.xz) : vec2(0.7, 0.7);
  p.xz += outD * t * fl * 0.35 * iScl.x;
  p.y *= 1.0 - 0.82 * fl;
  // wind (step 4w, world/wind.js): static lean ∝ v² + blade oscillation; gust fronts roll through as visible waves
  vec4 wS = windSample(wp);
  float ws = windStr(wS) * uWindStr;
  vec2 wd = length(wS.xy) > 1e-3 ? wS.xy / length(wS.xy) : uWindA.xy;
  float ph = uWindA.w * (2.1 + 1.3 * iScl.z) + iScl.z * 6.2831 + dot(wp, wd) * 0.4;
  float lean = ws * ws * 1.2 + wS.z * uWindStr * (0.35 + ws) * 0.9;
  float osc = (sin(ph) * 0.6 + sin(ph * 2.3 + 1.3) * 0.25 + wS.w * 0.15) * (0.08 + ws * 0.7 + wS.z * 0.5) * uWindStr;
  float sway = min(lean + osc * 0.45, 1.3) * (1.0 - fl);
  float bend = t * t * iScl.x;
  vec2 wOff = (wd * sway + vec2(-wd.y, wd.x) * osc * 0.3 * (1.0 - fl)) * bend * 0.28;
  float wDy = -sway * sway * bend * 0.07;
  vec3 r = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  r.xz += wOff; r.y += wDy;
  n = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.55 + 0.3 * fl));
  n.xz += wd * sway * 0.45 * t; n = normalize(n);                   // leaning blades show their paler flanks
  // colour
  vec4 mz = texture(tNoiseG, wp / 23.0);
  vec4 mzS = texture(tNoiseG, wp / 5.3 + 0.2);
  vec3 green = mix(vec3(0.075, 0.09, 0.032), vec3(0.16, 0.155, 0.065), smoothstep(0.3, 0.72, mz.g)); // toned: less saturated/dark (must-fix 5)
  green = mix(green, vec3(0.17, 0.15, 0.075), smoothstep(0.55, 0.8, mzS.b) * 0.7);
  vec3 dry = mix(vec3(0.2, 0.15, 0.075), vec3(0.3, 0.24, 0.13), iScl.z);
  vec3 col = iScl.w < 0.5 ? green : iScl.w < 1.5 ? dry : iScl.w < 2.5 ? vec3(0.06, 0.08, 0.035) : vec3(0.19, 0.15, 0.09);
  col *= mix(0.8, 1.2, iScl.z) * mix(0.72, 1.25, mz.r);
  col = mix(col, col * vec3(1.25, 1.1, 0.7), t * t * 0.5);          // sun-bleached tips
  col *= mix(0.4, 1.0, smoothstep(0.0, 0.65, t));                    // canopy self-occlusion
  col *= mix(1.0, 0.7, fl);
  col *= 1.0 + min(wS.z, 1.0) * 0.16 * t * uWindStr;                 // silvery sheen as a gust front sweeps the field
  col = mix(col, vec3(0.12, 0.012, 0.008) * (0.7 + 0.6 * iScl.z), texture(tBloodG, wp * uMapG.zw).r * 0.85 * (0.35 + 0.65 * (1.0 - t * 0.6)));
  vGCol = col;
  vGT = t;
  return r + iOff.xyz;
}
`;

export const GRASS_NORMAL = /* glsl */ `
vec3 objectNormal = normal;
vec3 gP = grassPos(position, objectNormal);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(1.0, 0.0, 0.0);
#endif
`;
export const GRASS_BEGIN = /* glsl */ `vec3 transformed = gP;`;
export const GRASS_BEGIN_DEPTH = /* glsl */ `vec3 gN = vec3(0.0, 1.0, 0.0); vec3 transformed = grassPos(position, gN);`;
export const GRASS_COLOR = /* glsl */ `diffuseColor.rgb = vGCol;`;
