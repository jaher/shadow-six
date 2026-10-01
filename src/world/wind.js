/**
 * WindField (PROGRESS step 4w) — ONE wind for the whole mission, shared by the CPU (cloth flags, particles, audio,
 * snow puffs, dust devils) and the GPU (grass, trees, impostors, clothing, tarps, water, VFX) through one uniform set.
 *
 * Model: a mean wind (direction + speed, per mission or theater preset) modulated by
 *  - gust FRONTS: three families of curved bands travelling downwind across the map (visible as waves rolling through
 *    grass and canopies), each band with its own strength and lateral patchiness,
 *  - turbulence: advected incommensurate sines (speed ± and direction wobble),
 *  - a slow global envelope (lulls), and
 *  - desert dust devils (a travelling vortex).
 * Everything is a pure function of (x, z, t) with t = SIM time, so it is deterministic under the fixed-step sim, frozen
 * while paused and identical on the CPU (`sample`) and GPU (`WIND_GLSL` windSample) — no state to save.
 * Direction convention: `dirDeg` is the heading the wind blows TOWARDS in world XZ (0° = +X, 90° = +Z).
 * No three.js import (World runs in Node tests): uniform values are Float32Arrays (three accepts arrays for vec4).
 * @module world/wind
 */

/** Theater / weather presets (m/s). gustiness: gust peak ≈ speed·(1 + 1.5·gustiness); blow: wind-borne particles. */
export const WIND_PRESETS = Object.freeze({
  calm: { speed: 1.3, gustiness: 0.18, turbulence: 0.35, dirDeg: 200, spacing: 110, width: 16, blow: null },
  temperate: { speed: 4.5, gustiness: 0.45, turbulence: 0.5, dirDeg: 25, spacing: 70, width: 11, blow: 'leaves' },
  coast: { speed: 8.0, gustiness: 0.7, turbulence: 0.6, dirDeg: 160, spacing: 55, width: 9, blow: 'spray' },
  fjord: { speed: 7.5, gustiness: 0.8, turbulence: 0.7, dirDeg: 20, spacing: 50, width: 8, blow: 'snow' },
  snow: { speed: 6.5, gustiness: 0.65, turbulence: 0.6, dirDeg: 20, spacing: 55, width: 9, blow: 'snow' },
  desert: { speed: 5.0, gustiness: 0.22, turbulence: 0.28, dirDeg: 290, spacing: 120, width: 18, blow: 'sand', devils: 1, hot: true },
  urban: { speed: 3.5, gustiness: 0.5, turbulence: 0.65, dirDeg: 40, spacing: 60, width: 10, blow: 'leaves' },
});

/** Speed (m/s) at which wind-driven visuals reach full strength (Beaufort 7, near gale). */
export const WIND_FULL = 16;
const FK = [1, 1.53, 2.31], FW = [0.6, 0.45, 0.35];
const fract = (x) => x - Math.floor(x);

/**
 * Wind parameters for a mission: preset by theater (calm at dawn/dusk: low sun, or `weather.timeOfDay`) with
 * `weather.wind` overrides {preset?, dirDeg?, speed?, gustiness?, turbulence?, spacing?, width?, blow?, devils?}.
 * @param {object} [def] mission definition
 */
export function resolveWind(def = {}) {
  const w = def?.weather?.wind || {};
  const lowSun = def?.lighting?.sunElevDeg != null && def.lighting.sunElevDeg < 6;
  const dawn = /dawn|dusk/.test(def?.weather?.timeOfDay || '') || (lowSun && def?.theater !== 'snow');
  const key = w.preset || (dawn ? 'calm' : def?.theater) || 'temperate';
  const base = WIND_PRESETS[key] || WIND_PRESETS.temperate;
  const p = { preset: WIND_PRESETS[key] ? key : 'temperate', ...base, ...w };
  p.speed = Math.max(0, +p.speed || 0);
  p.gustiness = Math.min(1.2, Math.max(0, +p.gustiness || 0));
  p.turbulence = Math.min(1.2, Math.max(0, +p.turbulence || 0));
  p.frontSpeed = w.frontSpeed ?? (p.speed * 1.1 + 1.5);
  p.lateral = w.lateral ?? p.spacing * 0.6;
  return p;
}

/** Shared GPU uniforms (one active field per page). Include WIND_GLSL and Object.assign(shader.uniforms, WIND_UNIFORMS). */
export const WIND_UNIFORMS = {
  uWindA: { value: new Float32Array([0.9, 0.42, 4.5, 0]) },   // dir.x, dir.z, mean speed m/s, sim time s
  uWindB: { value: new Float32Array([0.45, 0.5, 6.5, 70]) },  // gustiness, turbulence, front speed m/s, front spacing m
  uWindC: { value: new Float32Array([11, 42, 0, 0]) },        // front width m, lateral scale m, -, -
  uWindD: { value: new Float32Array([0, 0, 1, 0]) },          // dust devil x, z, radius, strength (0 = none)
};

let ACTIVE = null;
/** The WindField that last published the GPU uniforms (frame()): CPU consumers sampling per object (canvas covers). */
export const activeWind = () => ACTIVE;

export class WindField {
  /**
   * @param {object} [params] resolveWind() output (or partial overrides)
   * @param {{W?:number, D?:number, seed?:number}} [o] map size (dust devil paths), seed
   */
  constructor(params = {}, o = {}) {
    this.p = params.frontSpeed != null ? { ...params } : resolveWind({ weather: { wind: params } });
    this.W = o.W ?? 200; this.D = o.D ?? 200; this.seed = o.seed ?? 1;
    const a = (this.p.dirDeg * Math.PI) / 180;
    this.dx = Math.cos(a); this.dz = Math.sin(a);
    this.t = 0;
    /** Legacy {strength 0..1, dir rad} view used by art/flags.js tickFlags + building-props. */
    this.strength = this.p.speed / WIND_FULL;
    this.dir = a;
    this._s = { x: 0, z: 0, speed: 0, gust: 0, turb: 0 };
  }

  static forMission(def, o = {}) { return new WindField(resolveWind(def || {}), o); }

  get preset() { return this.p.preset; }

  /** Slow global envelope (lulls and stronger spells), 0.6..1.0. */
  envelope(t) { return 0.8 + 0.2 * Math.sin(t * 0.037) * Math.sin(t * 0.061 + 1.3); }

  /** Gust front intensity 0..~1.2 at (x, z, t) before gustiness scaling. */
  front(x, z, t) {
    const P = this.p, dx = this.dx, dz = this.dz;
    const s = x * dx + z * dz, l = -x * dz + z * dx;
    let g = 0;
    for (let k = 0; k < 3; k++) {
      const L = P.spacing * FK[k], w = P.width * (1 + 0.3 * k);
      const bs = s + Math.sin(l / (P.lateral * (1 + 0.5 * k)) + k * 1.9) * P.lateral * 0.35;
      const u = (bs - P.frontSpeed * t * (1 - 0.08 * k)) / L + k * 0.371;
      const q = ((fract(u) - 0.5) * L) / w;
      const lat = 0.5 + 0.5 * Math.sin(l / (P.lateral * (0.8 + 0.45 * k)) - k * 2.3 + t * 0.05 * (k + 1));
      const amp = 0.55 + 0.45 * Math.sin(Math.floor(u) * 2.399 + k);
      g += Math.exp(-q * q) * lat * amp * FW[k];
    }
    return Math.min(g, 1.2);
  }

  /** Active dust devil at time t: {x, z, r, s} (s = strength 0..1) or null. Desert presets only. */
  devil(t) {
    if (!this.p.devils) return null;
    const P = 38, life = 16, i = Math.floor(t / P), a = t - i * P;
    if (a < 0 || a > life) return null;
    const h1 = fract(Math.sin((i + this.seed) * 12.9898) * 43758.5453), h2 = fract(Math.sin((i + this.seed) * 78.233) * 12543.21);
    const drift = this.p.speed * 0.55 * a;
    return { x: this.W * (0.15 + 0.7 * h1) + this.dx * drift, z: this.D * (0.15 + 0.7 * h2) + this.dz * drift,
      r: 2.5 + 2.5 * h2, s: Math.sin((Math.PI * a) / life) * this.p.devils };
  }

  /**
   * Wind at a point. @returns {{x:number, z:number, speed:number, gust:number, turb:number}} velocity (m/s),
   * speed (m/s), gust = gustiness-scaled front intensity (0..~1.4), turb (-1..1). `out` is reused when given.
   */
  sample(x, z, t = this.t, out = { x: 0, z: 0, speed: 0, gust: 0, turb: 0 }) {
    const P = this.p, g = this.front(x, z, t) * P.gustiness;
    const vs = P.speed * 0.9 * t, qx = x - this.dx * vs, qz = z - this.dz * vs;
    const tu = Math.sin(qx * 0.21 + qz * 0.13 + t * 0.9) * 0.5 + Math.sin(-qx * 0.11 + qz * 0.37 + t * 1.7 + 2) * 0.3
      + Math.sin(qx * 0.53 - qz * 0.29 + t * 2.9 + 4) * 0.2;
    const tv = Math.sin(qx * 0.17 - qz * 0.23 + t * 0.7 + 1) * 0.6 + Math.sin(qx * 0.41 + qz * 0.31 + t * 2.3 + 3) * 0.4;
    const spd = Math.max(0, P.speed * this.envelope(t) * (1 + 1.5 * g + P.turbulence * 0.22 * tu));
    const ang = P.turbulence * 0.22 * tv, c = Math.cos(ang), s = Math.sin(ang);
    let vx = (this.dx * c - this.dz * s) * spd, vz = (this.dx * s + this.dz * c) * spd;
    const d = this.devil(t);
    if (d) {
      const rx = x - d.x, rz = z - d.z, r = Math.hypot(rx, rz) + 1e-4, k = d.s * 11 * (r / d.r) * Math.exp(1 - r / d.r);
      vx += (-rz / r) * k; vz += (rx / r) * k;
    }
    out.x = vx; out.z = vz; out.speed = Math.hypot(vx, vz); out.gust = g; out.turb = tu;
    return out;
  }

  /** Normalised strength 0..1 (speed / WIND_FULL) at a point. */
  strengthAt(x, z, t = this.t) { return Math.min(1, this.sample(x, z, t, this._s).speed / WIND_FULL); }

  /**
   * Advance to sim time `t` (call once per displayed frame with the interpolated sim time; frozen while paused) and
   * publish the shared GPU uniforms. `at` = {x, z} (view centre) refreshes the legacy strength/dir summary there.
   */
  frame(t, at = null) {
    this.t = t;
    ACTIVE = this;
    const P = this.p, U = WIND_UNIFORMS;
    U.uWindA.value.set([this.dx, this.dz, P.speed, t]);
    U.uWindB.value.set([P.gustiness, P.turbulence, P.frontSpeed, P.spacing]);
    U.uWindC.value.set([P.width, P.lateral, this.envelope(t), 0]);
    const d = this.devil(t);
    U.uWindD.value.set(d ? [d.x, d.z, d.r, d.s] : [0, 0, 1, 0]);
    const s = this.sample(at?.x ?? this.W / 2, at?.z ?? this.D / 2, t, this._s);
    this.strength = Math.min(1, s.speed / WIND_FULL);
    this.dir = Math.atan2(s.z, s.x);
    this.gust = s.gust;
    return this;
  }
}

/**
 * GLSL twin of WindField.sample (keep in sync). `vec4 windSample(vec2 xz)` → (vel.x, vel.z m/s, gust, turb);
 * `windStr(w)` → 0..1 strength; `windDir2()` mean direction. Include once per shader (vertex stage).
 */
export const WIND_GLSL = /* glsl */ `
#ifndef WIND_GLSL_INC
#define WIND_GLSL_INC
uniform vec4 uWindA; uniform vec4 uWindB; uniform vec4 uWindC; uniform vec4 uWindD;
float windFront(vec2 p, float t) {
  vec2 d = uWindA.xy; float s = dot(p, d); float l = -p.x * d.y + p.y * d.x; float g = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float L = uWindB.w * (k == 0 ? 1.0 : k == 1 ? 1.53 : 2.31); float w = uWindC.x * (1.0 + 0.3 * fk);
    float bs = s + sin(l / (uWindC.y * (1.0 + 0.5 * fk)) + fk * 1.9) * uWindC.y * 0.35;
    float u = (bs - uWindB.z * t * (1.0 - 0.08 * fk)) / L + fk * 0.371;
    float q = (fract(u) - 0.5) * L / w;
    float lat = 0.5 + 0.5 * sin(l / (uWindC.y * (0.8 + 0.45 * fk)) - fk * 2.3 + t * 0.05 * (fk + 1.0));
    float amp = 0.55 + 0.45 * sin(floor(u) * 2.399 + fk);
    g += exp(-q * q) * lat * amp * (k == 0 ? 0.6 : k == 1 ? 0.45 : 0.35);
  }
  return min(g, 1.2);
}
vec4 windSample(vec2 p) {
  float t = uWindA.w; vec2 d = uWindA.xy;
  float g = windFront(p, t) * uWindB.x;
  vec2 q = p - d * (uWindA.z * 0.9 * t);
  float tu = sin(q.x * 0.21 + q.y * 0.13 + t * 0.9) * 0.5 + sin(-q.x * 0.11 + q.y * 0.37 + t * 1.7 + 2.0) * 0.3
    + sin(q.x * 0.53 - q.y * 0.29 + t * 2.9 + 4.0) * 0.2;
  float tv = sin(q.x * 0.17 - q.y * 0.23 + t * 0.7 + 1.0) * 0.6 + sin(q.x * 0.41 + q.y * 0.31 + t * 2.3 + 3.0) * 0.4;
  float spd = max(0.0, uWindA.z * uWindC.z * (1.0 + 1.5 * g + uWindB.y * 0.22 * tu));
  float a = uWindB.y * 0.22 * tv; float c = cos(a), s = sin(a);
  vec2 v = vec2(d.x * c - d.y * s, d.x * s + d.y * c) * spd;
  if (uWindD.w > 0.0) {
    vec2 r = p - uWindD.xy; float rl = length(r) + 1e-4;
    v += vec2(-r.y, r.x) / rl * (uWindD.w * 11.0 * (rl / uWindD.z) * exp(1.0 - rl / uWindD.z));
  }
  return vec4(v, g, tu);
}
float windStr(vec4 w) { return min(1.0, length(w.xy) / ${WIND_FULL.toFixed(1)}); }
vec2 windDir2() { return uWindA.xy; }
#endif
`;

/** Patch a material's shader (onBeforeCompile helper): adds the wind uniforms + GLSL after `#include <common>`. */
export function injectWind(shader) {
  Object.assign(shader.uniforms, WIND_UNIFORMS);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + WIND_GLSL);
  return shader;
}
