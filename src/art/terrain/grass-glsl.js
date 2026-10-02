/**
 * Instanced grass tuft vertex code (shared by the colour material and the shadow depth material).
 * @module terrain-b/grass-glsl
 */
import { WIND_GLSL } from '../../world/wind.js';

export const GRASS_PARS = WIND_GLSL + /* glsl */ `
attribute vec4 iOff;    // x, y, z, rotation
attribute vec4 iScl;    // height scale, width scale, colour random, type (veg-profile GRASS_TYPES index)
attribute vec2 iExt;    // LOD rank 0..1 (shuffled prefix order), dryness 0 lush .. 1 straw
attribute vec4 aBlade;  // t (0 root → 1 tip), side (-1/0/1), lateral dir xz
attribute float aPart;  // 0 blade / leaf, 1 seed head / plume / awn
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
uniform vec4 uLodV;       // view centre xz, view half-width (m), global density fraction
uniform vec3 uGRoot[12];  // per archetype: lush root / tip, dry root / tip, seed-head colour (veg-profile season)
uniform vec3 uGTip[12];
uniform vec3 uDRoot[12];
uniform vec3 uDTip[12];
uniform vec3 uGHead[12];
uniform float uGAmp[12];  // wind bend amplitude (m at the tip): stiffness class per archetype
uniform float uFrost;     // rime on upward faces (winter missions)
varying vec3 vGCol;
varying float vGT;
vec3 grassPos(vec3 p, inout vec3 n) {
  float t = aBlade.x;
  int ty = int(iScl.w + 0.5);
  float s = sin(iOff.w), c = cos(iOff.w);
  vec2 wp = iOff.xz;
  // density LOD without popping: the shuffled rank fades (shrinks) out over the last 12 % instead of vanishing
  float dv = length(wp - uLodV.xy) / max(uLodV.z, 1.0);
  float f = uLodV.w * mix(1.0, 0.7, smoothstep(0.78, 0.92, dv));
  f = f > 0.999 ? 2.0 : f;
  float fade = 1.0 - smoothstep(f - 0.12, f, iExt.x);
  // widen thin blades to stay >= ~1px at the current zoom (prevents sub-pixel shimmer)
  float extra = max(uMinW - 0.012 * iScl.y, 0.0) * 0.5 * (1.0 - t * 0.7) + 0.006 * (uLodW - 1.0) * (1.0 - t * 0.8);
  p.xz += aBlade.zw * aBlade.y * extra;
  p *= fade;
  p.y *= iScl.x;
  p.xz *= mix(1.0, iScl.x, 0.6);
  vec4 tr = texture(tTrail, wp * uMapG.zw);
  tr.a = texture(tFlatG, wp * uMapG.zw).r;
  vec2 uvG = wp * uMapG.zw;
  float inMap = step(0.0, uvG.x) * step(uvG.x, 1.0) * step(0.0, uvG.y) * step(uvG.y, 1.0); // apron tufts: no trail / blood smear
  float fl = clamp(tr.a + tr.r * 0.8, 0.0, 1.0) * inMap;
  // trampled: pressed down and splayed along the ground
  vec2 outD = length(p.xz) > 1e-4 ? normalize(p.xz) : vec2(0.7, 0.7);
  p.xz += outD * t * fl * 0.35 * iScl.x;
  p.y *= 1.0 - 0.82 * fl;
  // wind (step 4w, world/wind.js): static lean ∝ v² + blade oscillation; gust fronts roll through as visible waves.
  // Amplitude per archetype (reeds wave as a stand, marram whips, forbs barely move).
  vec4 wS = windSample(wp);
  float ws = windStr(wS) * uWindStr;
  vec2 wd = length(wS.xy) > 1e-3 ? wS.xy / length(wS.xy) : uWindA.xy;
  float amp = uGAmp[ty];
  float ph = uWindA.w * (2.1 + 1.3 * iScl.z) * (amp > 0.5 ? 0.6 : 1.0) + iScl.z * 6.2831 + dot(wp, wd) * 0.4;
  float lean = ws * ws * 1.2 + wS.z * uWindStr * (0.35 + ws) * 0.9;
  float osc = (sin(ph) * 0.6 + sin(ph * 2.3 + 1.3) * 0.25 + wS.w * 0.15) * (0.08 + ws * 0.7 + wS.z * 0.5) * uWindStr;
  float sway = min(lean + osc * 0.45, 1.3) * (1.0 - fl);
  float bend = t * t * iScl.x;
  vec2 wOff = (wd * sway + vec2(-wd.y, wd.x) * osc * 0.3 * (1.0 - fl)) * bend * amp;
  float wDy = -sway * sway * bend * amp * 0.25;
  // seed heads / plumes flutter on top of the stem motion
  wOff += aPart * vec2(-wd.y, wd.x) * sin(ph * 3.1 + iOff.x * 7.0) * 0.02 * (0.3 + ws) * uWindStr;
  vec3 r = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  r.xz += wOff; r.y += wDy;
  n = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.45 + 0.3 * fl));
  n.xz += wd * sway * 0.45 * t; n = normalize(n);                   // leaning blades show their paler flanks
  // colour: per-archetype root → tip gradient, lush ↔ dry by the instance dryness, field patches, hue jitter
  vec4 mz = texture(tNoiseG, wp / 23.0);
  vec4 mzS = texture(tNoiseG, wp / 5.3 + 0.2);
  float d = clamp(iExt.y + (mzS.b - 0.5) * 0.25, 0.0, 1.0);
  vec3 root = mix(uGRoot[ty], uDRoot[ty], d), tip = mix(uGTip[ty], uDTip[ty], d);
  vec3 col = mix(root, tip, smoothstep(0.0, 0.85, t));
  col = mix(col, uDTip[ty] * vec3(0.8, 0.72, 0.6), smoothstep(0.78, 1.0, t) * smoothstep(0.25, 0.7, d) * 0.6); // dead tips
  col = mix(col, uGHead[ty], aPart);
  col *= vec3(0.94 + 0.12 * iScl.z, 1.0, 1.06 - 0.12 * iScl.z) * mix(0.82, 1.15, iScl.z) * mix(0.8, 1.18, mz.r);
  col *= mix(0.42, 1.0, smoothstep(0.0, 0.6, t));                    // canopy self-occlusion / contact shadow
  col *= mix(1.0, 0.7, fl);
  col = mix(col, vec3(0.36, 0.39, 0.43), uFrost * smoothstep(0.3, 1.0, t) * (0.4 + 0.6 * mzS.g));
  col *= 1.0 + min(wS.z, 1.0) * 0.16 * t * uWindStr;                 // silvery sheen as a gust front sweeps the field
  col = mix(col, vec3(0.12, 0.012, 0.008) * (0.7 + 0.6 * iScl.z), texture(tBloodG, wp * uMapG.zw).r * inMap * 0.85 * (0.35 + 0.65 * (1.0 - t * 0.6)));
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
