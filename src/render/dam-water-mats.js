/**
 * Materials of the dam water FX (render/dam-water.js): flowing sheets and trickles, the splash zone, wet streaks and
 * ice columns (the pool: dam-water-pool-glsl.js; spray and mist: dam-water-spray.js). All transparent, tinted by
 * `uLight` (overcast ambient) and the shared `damLight`, drawn on the late FX layer after the water surface.
 * @module render/dam-water-mats
 */
import * as THREE from 'three';

const NOISE = /* glsl */`
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

const VERT = /* glsl */`
attribute vec2 flow; // x: across (0..1), y: metres along the flow from its source
varying vec2 vF; varying float vFog;
void main() { vF = flow; vec4 mv = modelViewMatrix * vec4(position, 1.0); vFog = -mv.z; gl_Position = projectionMatrix * mv; }
`;

/**
 * Flowing water on the face. The pattern is advected in TRAVEL TIME, tau(s) = (sqrt(v0^2 + 2 g s) - v0) / g (s = metres
 * fallen from the lip, v0 = `uSpeed`), so it accelerates down the face and its features stretch with the fall like
 * real falling water. Top: a smooth glassy laminar sheet (sky reflection, streamwise striations, fine ridge glints);
 * from the aeration inception point white fingers grow and merge into streaked white water with frayed edges, then
 * the curtain whitens and frays where it hits the pool. `uThin` 1 = a trickle clinging to the concrete: a glassy film
 * with glints and droplet packets running down.
 */
const SHEET_FRAG = /* glsl */`
uniform float uTime, uSpeed, uAlpha, uLen, uSeed, uLight, uFade, uThin, uNight, uInc;
uniform vec3 uSky;
varying vec2 vF;
${NOISE}
void main() {
  float across = vF.x, s = max(vF.y, 0.0);
  float vel = sqrt(uSpeed * uSpeed + 19.62 * s), tau = (vel - uSpeed) / 9.81, eta = tau - uTime;
  float stretch = vel / max(uSpeed, 0.5);                       // how far features have been pulled out
  // edges: the sheet necks in as it falls and its rims break into fingers that shed droplets
  float ec = min(across, 1.0 - across), fray = fbm(vec2(across * 5.0 + uSeed, eta * 3.1));
  float ew = 0.05 + 0.13 * smoothstep(0.0, 3.0, s) + 0.1 * fray;
  float fingE = fbm(vec2(across * 10.0 + uSeed, eta * 4.0 / sqrt(stretch)));
  float edge = smoothstep(0.35 * ew, ew, ec + 0.4 * (fingE - 0.45) * smoothstep(0.4, 2.5, s));
  vec2 dg = vec2(across * 30.0 + uSeed, eta * 38.0), di = floor(dg);
  float drop = step(0.78, h21(di + uSeed)) * (1.0 - smoothstep(0.12, 0.32, length((fract(dg) - 0.5) * vec2(1.0, 0.7))));
  drop *= step(ec, ew * 1.2) * (1.0 - edge) * smoothstep(0.4, 1.6, s);
  // glassy laminar top: dark, sky-reflecting, fine streamwise striations, ridge glints and Kelvin-Helmholtz ripple
  // bands that grow down the fall and race down with the water
  float stri = fbm(vec2(across * 22.0 + uSeed, eta * 0.8));
  float ridge = smoothstep(0.62, 0.82, vnoise(vec2(across * 46.0 + uSeed * 3.0, eta * 1.5)));
  // (value noise along the travel time, not a sine: the bands come at irregular spacings and strengths, never a ladder)
  float khp = eta * 13.0 + across * 2.0 + fbm(vec2(across * 4.0 + uSeed, eta * 1.3)) * 3.0;
  float kh = smoothstep(0.58, 0.9, vnoise(vec2(across * 3.1 + uSeed * 1.3, khp)) * 0.75 + 0.25 * vnoise(vec2(across * 9.0 + uSeed, khp * 1.7 + 4.0)));
  kh *= smoothstep(0.05, 1.0, s) * smoothstep(0.3, 0.7, fbm(vec2(across * 5.0 + uSeed * 2.0, eta * 2.2)));   // broken, irregular
  float lipG = 1.0 - smoothstep(0.0, 0.25, s);                    // the crest's curve mirrors the sky
  // (linear values: the frame is tone-mapped to sRGB afterwards, so 0.02 already reads as dark water)
  vec3 glass = mix(vec3(0.012, 0.018, 0.022), uSky * 0.95, clamp(0.03 + 0.08 * stri + 0.4 * kh + 0.5 * lipG, 0.0, 1.0)) + vec3(0.5) * ridge * 0.3;
  // aeration: milky first (bubbles drawn in), then white fingers from the inception point merging into white water
  float fing = fbm(vec2(across * 7.0 + uSeed, eta * 1.1));
  float si = uInc + 0.5 * (fbm(vec2(across * 2.0 + uSeed, 0.3)) - 0.5);
  float milk = smoothstep(si - 0.6, si + 0.3, s) * 0.15 * (0.5 + fing);
  float aer = smoothstep(si + 1.0 * (fing - 0.5) - 0.1, si + 1.0 * (fing - 0.5) + 0.55, s);
  float streak = fbm(vec2(across * 16.0 + uSeed, eta * 2.2 / (0.6 + 0.4 * stretch)));
  float clump = fbm(vec2(across * 6.0 + uSeed * 1.7, eta * 5.0)) + 0.5 * (vnoise(vec2(across * 55.0 + uSeed, eta * 18.0)) - 0.5); // lumps + grain
  vec3 white = mix(vec3(0.3, 0.34, 0.37), vec3(0.96, 0.98, 0.99), smoothstep(0.36, 0.62, 0.6 * streak + 0.4 * clump + 0.08 * aer));
  // impact: an opaque, ragged white band where the curtain hits the pool (pulsing with the arriving water)
  float hc = 0.35 + 0.65 * fbm(vec2(across * 9.0 + uSeed, eta * 2.0));
  float crown = smoothstep(uLen - hc - 0.15, uLen - hc + 0.1, s);
  vec3 col = mix(glass, vec3(0.42, 0.48, 0.5), milk * (1.0 - aer));
  col = mix(col, white, aer);
  col = mix(col, vec3(0.93, 0.95, 0.96) * (0.85 + 0.15 * fray), crown);
  float a = uAlpha * edge * mix(mix(0.78 + 0.12 * stri, 0.85, milk), 0.9 + 0.1 * smoothstep(0.3, 0.7, streak), aer);
  a = max(max(a, uAlpha * crown * smoothstep(0.0, 0.6 * ew, ec + 0.1 * (fray - 0.5))), drop * 0.85);
  col = mix(col, vec3(0.9, 0.93, 0.95), drop * (1.0 - edge));
  // trickle: a thin glassy film, glints on the ridges and droplet packets running down (same travel-time clock)
  float pulse = smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(eta * 6.2832 * 1.4 + uSeed * 7.0));
  float n = fbm(vec2(across * 3.0 + uSeed, eta * 2.0));
  float glint = smoothstep(0.62, 0.8, fbm(vec2(across * 9.0 + uSeed, eta * 1.2))) * (1.0 - abs(across - 0.5) * 2.0);
  float aT = uAlpha * smoothstep(0.0, 0.22, across) * smoothstep(1.0, 0.78, across) * (0.22 + 0.5 * pulse * n + 0.5 * glint);
  vec3 colT = mix(vec3(0.42, 0.47, 0.5), vec3(0.92, 0.95, 0.96), clamp(glint + 0.5 * pulse, 0.0, 1.0));
  vec3 outC = mix(col, colT, uThin) * uLight * mix(1.0, 0.6, uNight);
  gl_FragColor = vec4(outC, mix(a, aT, uThin) * uFade);
}`;

/**
 * Splash crown where a spillway sheet hits the pool: an opaque, ragged white band of water thrown up and out (it widens
 * as it rises past the sheet's sides), its torn top lumps rising and falling back. `uInner` = the sheet's share of the
 * band's width.
 */
const CROWN_FRAG = /* glsl */`
uniform float uTime, uAlpha, uLen, uSeed, uLight, uNight, uFade, uInner;
varying vec2 vF;
${NOISE}
void main() {
  float h = clamp(1.0 - vF.y / max(uLen, 0.3), 0.0, 1.0), e = abs(vF.x - 0.5) * 2.0;   // h: 0 at the pool, 1 at the top
  float n = fbm(vec2(vF.x * 10.0 + uSeed, vF.y * 2.0 + uTime * 2.4));
  float n2 = fbm(vec2(vF.x * 23.0 + uSeed * 2.0, vF.y * 5.0 + uTime * 3.6));
  float jet = vnoise(vec2(vF.x * 34.0 + uSeed, vF.y * 3.0 - uTime * 5.0));   // upthrown streaks
  float top = 0.18 + 0.45 * n + 0.25 * (n2 - 0.5) + 0.3 * (jet - 0.5) - 0.25 * smoothstep(uInner, 1.0, e);
  float wid = uInner + (1.0 - uInner) * smoothstep(0.1, 1.0, h) * (0.2 + 0.45 * n);
  float a = (1.0 - smoothstep(top - 0.2, top + 0.04, h)) * (1.0 - smoothstep(wid - 0.2, wid, e + 0.12 * (n2 - 0.5)));
  a *= smoothstep(0.22, 0.45, n2 + 0.6 * (1.0 - h) + 0.3 * (jet - 0.5));        // solid at the waterline, torn into lumps above
  vec3 c = mix(vec3(0.78, 0.82, 0.85), vec3(1.0), smoothstep(0.25, 0.7, n2 + 0.3 * (1.0 - h) + 0.25 * (jet - 0.5)));
  gl_FragColor = vec4(c * uLight * mix(1.0, 0.6, uNight), uAlpha * a * (0.92 + 0.08 * n2) * uFade);
}`;

/** Dark wet concrete (no water): a static darkening streak, ragged at its edges and fading at its bottom end. */
const WET_FRAG = /* glsl */`
uniform float uAlpha, uLen, uSeed;
varying vec2 vF;
${NOISE}
void main() {
  float e = abs(vF.x - 0.5) * 2.0, n = fbm(vec2(vF.x * 4.0 + uSeed, vF.y * 0.7));
  float a = uAlpha * smoothstep(1.0, 0.35 + 0.4 * n, e) * smoothstep(uLen, uLen * 0.55, vF.y) * (0.6 + 0.4 * n);
  gl_FragColor = vec4(vec3(0.07, 0.08, 0.085), a);
}`;

/**
 * Splash zone at the foot of the face: concrete soaked dark by the spray (strongest at the waterline), glistening,
 * with a fringe of frozen spray (rime) speckles along its top edge.
 */
const SPLASH_FRAG = /* glsl */`
uniform float uAlpha, uLen, uSeed, uLight, uTime;
varying vec2 vF;
${NOISE}
void main() {
  float t = clamp(vF.y / max(uLen, 0.3), 0.0, 1.0), e = abs(vF.x - 0.5) * 2.0;
  float n = fbm(vec2(vF.x * 14.0 + uSeed, vF.y * 3.0));
  float side = smoothstep(1.0, 0.55 + 0.3 * n, e);
  float wet = smoothstep(0.05 + 0.35 * n, 0.75, t) * side;
  float glint = smoothstep(0.82, 0.95, vnoise(vec2(vF.x * 90.0, vF.y * 30.0 - uTime * 0.25))) * wet;
  float rime = smoothstep(0.86, 0.96, vnoise(vec2(vF.x * 160.0 + uSeed, vF.y * 55.0))) * smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.2, 0.4, t)) * side;
  float a = uAlpha * max(wet * 0.8, rime * 0.7) + glint * 0.25;
  vec3 c = mix(vec3(0.05, 0.06, 0.065), vec3(0.85, 0.9, 0.93) * uLight, clamp(rime * 1.2 + glint, 0.0, 1.0));
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
}`;

/** Frozen trickle: a translucent bluish ice column tapering down, with a bright central ridge (static). */
const ICE_FRAG = /* glsl */`
uniform float uAlpha, uSeed, uLight, uLen;
varying vec2 vF;
${NOISE}
void main() {
  float t = clamp(vF.y / max(uLen, 0.3), 0.0, 1.0), e = abs(vF.x - 0.5) * 2.0;
  float wf = mix(1.0, 0.3, t * t) + 0.12 * sin(vF.y * 4.0 + uSeed) + 0.1 * (fbm(vec2(vF.y * 1.7, uSeed)) - 0.5);
  float n = fbm(vec2(vF.x * 7.0 + uSeed, vF.y * 1.4));
  float a = uAlpha * (1.0 - smoothstep(wf - 0.25, wf, e)) * (0.55 + 0.45 * n);
  vec3 col = mix(vec3(0.58, 0.70, 0.78), vec3(0.95, 0.98, 1.0), smoothstep(0.4, 0.9, (1.0 - e / max(wf, 0.05)) * 0.7 + n * 0.5));
  gl_FragColor = vec4(col * uLight, a);
}`;

const shared = { uTime: { value: 0 }, uLight: { value: 1 }, uFade: { value: 1 } };
/** Lighting for the lit parts (pool, sheets): night factor, sun strength 0..1, world direction to the sun, sky radiance. */
export const damLight = { uNight: { value: 0 }, uSunI: { value: 0.3 }, uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.3).normalize() }, uSky: { value: new THREE.Vector3(0.55, 0.6, 0.66) } };

function make(name, frag, u, vert = VERT) {
  const m = new THREE.ShaderMaterial({
    name, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { ...shared, ...damLight, ...Object.fromEntries(Object.entries(u).map(([k, v]) => [k, { value: v }])) },
  });
  m.userData.shared = false;
  return m;
}

/** Shared animation uniforms (time, light, fade-out after the dam is destroyed). */
export const damWaterUniforms = shared;
export const sheetMaterial = (o) => make('dam_water_sheet', SHEET_FRAG, { uInc: o.inception ?? 3.9, uSpeed: o.speed ?? 3, uAlpha: o.alpha ?? 0.8, uLen: o.len ?? 6, uSeed: o.seed ?? 0, uThin: o.thin ? 1 : 0 });
export const crownMaterial = (o) => make('dam_splash_crown', CROWN_FRAG, { uAlpha: o.alpha ?? 0.95, uLen: o.len ?? 1, uSeed: o.seed ?? 0, uInner: o.inner ?? 0.5 });
export const wetMaterial = (o) => make('dam_wet_streak', WET_FRAG, { uAlpha: o.alpha ?? 0.35, uLen: o.len ?? 6, uSeed: o.seed ?? 0 });
export const splashMaterial = (o) => make('dam_splash_zone', SPLASH_FRAG, { uAlpha: o.alpha ?? 0.5, uLen: o.len ?? 2, uSeed: o.seed ?? 0 });
export const iceMaterial = (o) => make('dam_ice_column', ICE_FRAG, { uAlpha: o.alpha ?? 0.85, uSeed: o.seed ?? 0, uLen: o.len ?? 3 });
