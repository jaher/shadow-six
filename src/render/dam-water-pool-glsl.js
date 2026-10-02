/**
 * Shader of the water below the dam (render/dam-water-pool.js): drawn over the water surface (late FX layer,
 * premultiplied alpha) and driven by the baked flow field (`uFlow`: rg = current in the dam frame (m/s), b = foam
 * density, a = aeration) and the persistent foam field (`uFoamF`, render/dam-water-foam.js: r = foam thickness carried
 * by the current, gba = each parcel's displacement since birth and age). The field is sampled back-traced along the
 * current by the time since its last step. The lace is a Worley wall network drawn at the foam's material coordinate,
 * so it travels and deforms with the foam and is never re-seeded: grey translucent threads where the foam is thin,
 * white rafts where it is thick. At the plunge: two impact plumes under the sheets that widen and merge downstream,
 * aerated milky water and a pulsing boil churning in place, whose upwelling domes lift and push the foam outwards
 * with clear water bursting through their centres, ending at a fixed, ragged, brighter roller toe; past it 2-3
 * irregular decaying humps (lit crests, blue-grey troughs, visible through the foam). Ripple normals are flow-mapped
 * over three staggered 7.2 s layers. Every animated term is periodic in 3600 s (the clock wrap in dam-water.js).
 * @module render/dam-water-pool-glsl
 */

export const POOL_VERT = /* glsl */`
attribute vec2 dam;  // dam frame (u along the crest, v downstream), metres
varying vec2 vDam;
void main() { vDam = dam; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export const POOL_FRAG = /* glsl */`
uniform sampler2D uFlow, uLace, uNorm, uFoamF;
uniform vec4 uDomain;          // u0, v0, 1/width, 1/height
uniform float uTime, uLight, uFade, uBoilV, uNight, uSunI, uStepT, uMid;
uniform vec4 uSheets;          // u of the two sheets, their half width at the face
uniform vec4 uFoamDom;         // the foam field's domain: u0, v0, 1/width, 1/height
uniform vec3 uSunDir, uSky;    // world direction towards the sun, sky radiance
uniform vec2 uRot;             // world xz of the dam frame's +u axis (cos, sin of the dam's rotation)
varying vec2 vDam;
// ripple flow-map period (s; divides the 3600 s clock): three layers a third of a period apart
#define PERIOD 7.2
#define TAU 6.2832
vec2 h22(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
// sine-free hash: stays exact for the large cell ids of the material coordinates
vec2 hs22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
float h12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), f.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), f.x), f.y); }
float lace(vec2 p) { return texture2D(uLace, p).r; }   // uniform 0..1 (mean 0.5, std 0.289)
// a small lift for thin foam so the faintest lace still shows grey filaments before it fades out
// Worley foam walls in cells of 1 unit, distance stretched by st along d: 1 on a wall of half-width w, 0 in the cells
float walls(vec2 p, vec2 d, float st, float w, float aa) {
  vec2 gi = floor(p), gf = fract(p), n = vec2(-d.y, d.x); float d1 = 9.0, d2 = 9.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j)), h = hs22(gi + o), v = gf - o - 0.1 - 0.8 * h;
    // each cell its own size (a power diagram, not a regular Voronoi): bubbles of mixed sizes
    v = vec2(dot(v, n), dot(v, d) / st); float e = dot(v, v) - 0.12 * fract(h.x * 7.7 + h.y * 3.1);
    if (e < d1) { d2 = d1; d1 = e; } else if (e < d2) d2 = e;
  }
  return 1.0 - smoothstep(w - aa - 0.08, w + aa + 0.04, sqrt(max(d2, 0.0) + 0.12) - sqrt(max(d1, 0.0) + 0.12));
}
// one layer of lace (metres): open cells whose size changes from patch to patch (~0.42 m, and ~0.8 m in the looser
// patches), ~0.17 m cells inside the denser foam, curved, the walls' width varying along them (some thick and white,
// some thin grey threads) and their brightness with the foam texture. Thin foam is torn: its walls break into
// fragments with irregular gaps, so it reads as drifting lace, not a crack network
float net(vec2 p, vec2 d, float st, float w, float wf, float aa, float dens) {
  p += (vec2(vn(p * 1.4), vn(p * 1.4 + 5.2)) - 0.5) * 0.4;      // curved walls, not straight polygon edges
  float wv = 0.15 + 1.4 * vn(p * 2.3 + 3.3);
  float big = smoothstep(0.42, 0.7, vn(p * 0.21 + 1.7));
  float c = big < 0.999 ? walls(p / 0.42, d, st, w * wv, aa / 0.42 * 0.6) : 0.0;
  if (big > 0.001) c = mix(c, walls(p / 0.8 + 2.3, d, st, w * wv * 0.7, aa / 0.8 * 0.6), big);
  if (wf > 0.0) c = max(c, walls(p / 0.17 + 5.1, d, st, wf * (0.3 + 1.3 * vn(p * 3.7)), aa / 0.17 * 0.6) * 0.8);
  c *= smoothstep(0.22, 0.52, vn(p * 1.3 + 11.0) * 0.8 + 0.25 * vn(p * 3.1 + 2.0) + 0.55 * dens);
  // the walls are bands of bubbles, not clean lines: the foam texture eats into them
  float b = lace(p / 1.4);
  return c * smoothstep(0.18, 0.6, b + 0.25 * c) * (0.6 + 0.4 * b);
}
float g0(float f) { return 0.1 * smoothstep(0.04, 0.2, f) * (1.0 - smoothstep(0.3, 0.6, f)); }
// one flow-mapped layer k of 3: its position (displaced about its mid-phase, at most +-7.2 m) and its weight
// (sin^2, the three sum to 1.5): a layer re-seeds only while its weight is zero
vec2 fmPos(vec2 x, vec2 va, float k, out float w) {
  float t = uTime / PERIOD + k / 3.0, ph = fract(t);
  w = sin(3.14159 * ph); w = w * w / 1.5;
  return x - va * (ph - 0.5) + floor(t) * vec2(3.71 + k, 1.93 - k * 0.7);
}
// bubbles surface small, grow and persist, then burst at once
float bubbles(vec2 p, float dens) {
  vec2 g = p / 0.32, gi = floor(g), gf = fract(g), h = h22(gi);
  float life = fract(uTime / 2.4 + h.x * 13.0), r = 0.16 * smoothstep(0.0, 0.7, life) * (1.0 - step(0.95, life)) * step(h.y, dens);
  return 1.0 - smoothstep(r * 0.4, r + 1e-4, length(gf - 0.25 - 0.5 * h));
}
void main() {
  vec2 tc = (vDam - uDomain.xy) * uDomain.zw;
  vec4 F = texture2D(uFlow, tc);
  // the boil's foam and aeration are read through a ragged, slowly breathing warp (mostly across the stream, its
  // wiggles a few metres long), so its flanks fray irregularly into the slack water instead of following the jet's
  // straight edges
  vec2 wq = vDam * vec2(0.3, 0.42) + 0.5 * vec2(sin(uTime * TAU / 40.0 + vDam.y * 0.2), cos(uTime * TAU / 30.0 - vDam.x * 0.15));
  vec2 wp = vec2(vn(wq) - 0.5, vn(wq + 7.3) - 0.5) * vec2(3.4, 1.2) + vec2(vn(vDam * 0.95 + 2.7) - 0.5, vn(vDam * 0.95 + 9.1) - 0.5) * vec2(1.4, 0.6);
  vec4 Fw = texture2D(uFlow, tc + wp * uDomain.zw);
  vec2 vel = F.rg; float foamD = Fw.b, aer = Fw.a, sp = length(vel);
  float edge = smoothstep(0.0, 0.05, tc.x) * smoothstep(1.0, 0.95, tc.x) * smoothstep(0.0, 0.05, tc.y) * smoothstep(1.0, 0.95, tc.y);
  if (edge * (foamD + aer + sp) < 0.004) discard;
  float rel = vDam.y - uBoilV;
  vec2 dir = sp > 1e-3 ? vel / sp : vec2(0.0, 1.0);
  // the two impact plumes under the sheets, widening and merging downstream; the fixed ragged roller toe
  float wd = uSheets.z + 0.45 * max(vDam.y - uMid, 0.0);
  float pl = max(exp(-pow((vDam.x - uSheets.x) / wd, 2.0)), exp(-pow((vDam.x - uSheets.y) / wd, 2.0)));
  float toeV = 1.9 + 1.4 * (vn(vec2(vDam.x * 0.55, 3.1)) - 0.5);
  float plg = 1.0 - smoothstep(toeV - 0.7, toeV + 0.25, rel + 0.25 * (vn(vDam * vec2(1.7, 0.9) + 5.1) - 0.5));
  // persistent foam (the advected field), back-traced along the current by the time since its last step
  float tau = clamp(uTime - uStepT, 0.0, 0.2);
  vec2 xb = vDam - vel * tau;
  vec4 FF = texture2D(uFoamF, (xb - uFoamDom.xy) * uFoamDom.zw);
  float ff = FF.r;
  // the foam's material coordinate: where it was born, shifted by when (render/dam-water-foam.js)
  vec2 mc = xb - FF.gb - vec2(0.0, 1.6 * (uStepT - FF.a));
  // ripples carried by the current (flow-mapped normals, 3 staggered layers)
  vec2 va = vel * min(1.0, 2.0 / max(sp, 1e-3)) * PERIOD;
  float w0, w1, w2;
  vec2 p0 = fmPos(vDam, va, 0.0, w0), p1 = fmPos(vDam, va, 1.0, w1), p2 = fmPos(vDam, va, 2.0, w2);
  // the lace: a connected network of cell walls (Worley F2 - F1) at the foam's material coordinate, so it travels and
  // deforms with the foam itself; two cell sizes (~0.55 m, and ~0.2 m inside the denser foam). The field's thickness
  // sets the walls' width: thin foam is a sparse net of grey filaments, thick foam has walls so wide that the cells
  // close up into white rafts with a few holes. The distance is measured slightly stretched along the current
  // (continuous direction, no fixed banks), so the cells lengthen a little more in the fast core
  float dens = clamp(smoothstep(0.05, 0.9, ff) + g0(ff), 0.0, 1.0);
  float st = 1.0;
  float aa = 0.03 + length(fwidth(mc));   // (m) filtered where the strain packs the walls tighter than pixels
  float ww = mix(0.03, 0.85, dens), wf = mix(0.0, 0.55, smoothstep(0.25, 0.9, dens));
  float cov = net(mc, dir, st, ww, wf, aa, dens);
  // where the strain has packed the walls into threads finer than ~2 px (shear layers, eddies): foam lines instead,
  // ridges of a coarser noise at the same material coordinate, so the shear draws them out into thin streaks of
  // varying weight with clear water between them (a plain smear of the mean coverage reads as stretched texture)
  float pack = length(fwidth(mc)) / max(length(fwidth(vDam)), 1e-5);
  float pk = smoothstep(1.8, 3.2, pack);
  if (pk > 0.0) {
    float r1 = 1.0 - abs(2.0 * vn(mc * 0.55 + 4.4) - 1.0), r2 = 1.0 - abs(2.0 * vn(mc * 1.3 + 8.1) - 1.0);
    float fl = max(smoothstep(0.62, 0.92, r1), 0.7 * smoothstep(0.74, 0.95, r2)) * (0.5 + 0.5 * vn(mc * 0.3));
    fl = mix(fl, 0.4, smoothstep(10.0, 30.0, pack));            // packed past even those: a faint even sheen
    cov = mix(cov, (0.75 * ww + 0.25) * fl, pk);
  }
  cov *= smoothstep(0.02, 0.12, ff);
  float thick = smoothstep(0.45, 1.05, ff);
  float far = smoothstep(3.0, 26.0, rel);
  float foamA = cov * mix(0.35, 0.92, thick) * mix(1.0, 0.8, far);
  // the jump past the toe: 2-3 irregular humps, decaying downstream, their phase broken across the stream
  float zone = smoothstep(toeV - 0.3, toeV + 1.0, rel) * smoothstep(0.5, 1.1, sp) * exp(-max(rel - toeV - 0.6, 0.0) / 4.5);
  float wph = (rel - toeV) * TAU / 2.6 + 3.2 * (vn(vec2(vDam.x * 0.35, rel * 0.15)) - 0.5) + 0.3 * sin(uTime * TAU / 4.0 + vDam.x * 0.3);
  float slope = cos(wph) * zone, hump = sin(wph) * zone;
  // the boil: aerated water churning in place and pulsing (+-15 % on an irregular 1.5-3.6 s clock), brightest in
  // the plumes; upwelling domes lift and push the foam outwards, clear darker water bursting through at their centres
  float puls = (0.5 * sin(uTime * TAU / 2.4 + vDam.x * 0.5) + 0.3 * sin(uTime * TAU / 1.5 + vDam.y * 0.7 + 1.3) + 0.4 * sin(uTime * TAU / 3.6 - vDam.x * 0.3)) / 1.2;
  float aerP = aer * (1.0 + 0.15 * puls) * mix(0.55, 1.1, pl);
  float churn = 0.5, dome = 0.0, core = 0.0, lift = 0.0; vec2 push = vec2(0.0);
  if (aer > 0.02) {
    vec2 cd = vec2(0.13, -0.09) * uTime;
    float c0 = lace(vDam / 2.3 + cd);
    vec2 gg = vDam / 1.6 + (vec2(c0, texture2D(uLace, vDam * 0.1 + vec2(0.0, uTime / 120.0), 3.0).r) - 0.5) * 0.8, gi = floor(gg), gf = fract(gg);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j)), h = h22(gi + o), c = o + 0.2 + 0.6 * h;
      float h3 = fract(h.x * 5.3 + h.y * 2.1), P = 1.5 + 0.5 * floor(h.y * 4.0);   // 1.5..3 s: each divides 3600
      float ph = fract(uTime / P + h.x * 7.0);
      float amp = smoothstep(0.0, 0.2, ph) * (1.0 - smoothstep(0.55, 1.0, ph)) * step(0.3, h3);
      float r = (0.45 + 0.35 * fract(h.y * 9.1)) * (0.6 + 0.4 * smoothstep(0.0, 0.5, ph)) * (1.0 + 0.15 * puls);
      vec2 dv = (gf - c) * vec2(1.0, 0.8); float d = length(dv), m = amp * (1.0 - smoothstep(0.0, r, d));
      push += dv * m; dome = max(dome, m);
      core = max(core, amp * (1.0 - smoothstep(0.12 * r, 0.5 * r, d)));
    }
    push *= 1.6;                                              // metres
    float c1 = lace(vDam / 2.3 + cd - push * 0.8 / 2.3);
    float c2 = lace(vDam / 1.25 + vec2(0.07, -0.15) * uTime + c1 * 0.35 - push / 1.25);
    churn = 0.5 * (c1 + c2);
    lift = dome - 0.6 * core + 0.5 * (c0 - 0.5);
  }
  float boilA = clamp(smoothstep(0.5, 0.78, churn * 0.9 + 0.42 * aerP - 0.6 * core + 0.1 * dome), 0.0, 1.0)
    * smoothstep(0.12, 0.65, aerP + (churn - 0.5) * 0.5) * plg * mix(0.35, 1.0, pl);
  // the toe: a fixed, ragged, brighter transverse line where the roller ends
  float toe = exp(-pow((rel - toeV) / 0.3, 2.0)) * smoothstep(0.06, 0.3, aer) * mix(0.45, 1.0, pl) * (0.75 + 0.25 * churn * 2.0 - 0.25);
  toe *= smoothstep(0.38, 0.6, churn + 0.3 * (lace(vDam / 1.7 + vec2(0.0, uTime * 0.05)) - 0.5));   // ragged, churning
  float bub = bubbles(vDam - push * 0.5, aer * 0.7) * plg;
  float fa = clamp(max(max(foamA, boilA * 0.95), max(bub * 0.8, toe * 0.95)), 0.0, 1.0);
  // aerated (milky) body under the foam, clearer where the domes burst
  float aA = (smoothstep(0.1, 1.0, aerP) * (0.22 + 0.3 * churn) + 0.08 * smoothstep(0.2, 1.0, foamD)) * (1.0 - 0.45 * core)
    * mix(1.0, 0.35, smoothstep(toeV, toeV + 4.0, rel));                // the bubbles rise out past the jump: clearer
  // relief through the foam: the boil's lit domes / grey-blue troughs, the humps' lit crests / shadowed troughs
  float relief = smoothstep(0.08, 0.5, aer) * plg;
  float lit = mix(0.0, clamp(lift * 1.4, -1.0, 1.0), relief) + 1.1 * hump - 0.5 * slope;
  vec3 tint = mix(vec3(0.66, 0.75, 0.83), vec3(1.06), smoothstep(-0.9, 0.8, lit));
  tint = mix(vec3(1.0), tint, clamp(relief + zone * 1.4, 0.0, 1.0));
  vec3 foamCol = mix(vec3(0.7, 0.76, 0.8), vec3(0.95, 0.97, 0.99), max(thick, max(boilA, toe))) * tint * uLight * mix(1.0, 0.6, uNight);
  foamCol *= 1.0 + 0.12 * toe;
  vec3 aerCol = vec3(0.6, 0.73, 0.74) * uLight * mix(1.0, 0.55, uNight);
  vec3 col = aerCol * aA; float a = aA;
  col = col * (1.0 - fa) + foamCol * fa; a = a + fa * (1.0 - a);
  // rough, broken surface: flow-mapped ripples (rougher in the boil and the fast core) + the domes' and humps' slopes
  vec3 n0 = texture2D(uNorm, p0 / 3.1).rgb * 2.0 - 1.0, n1 = texture2D(uNorm, p1 / 3.1 + 0.5).rgb * 2.0 - 1.0, n2 = texture2D(uNorm, p2 / 3.1 + 0.25).rgb * 2.0 - 1.0;
  vec2 nt = (n0.xy * w0 + n1.xy * w1 + n2.xy * w2) * 1.25 * (0.15 + 0.35 * min(sp, 1.6) + 0.6 * aer) + vec2(0.0, -slope * 0.45) + push * 0.5;
  vec3 N = normalize(vec3(nt.x * uRot.x - nt.y * uRot.y, 1.0, nt.x * uRot.y + nt.y * uRot.x));
  vec3 V = normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));
  float fr = pow(1.0 - max(dot(N, V), 0.0), 5.0), fr0 = pow(1.0 - max(V.y, 0.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 spec = uSky * max(fr - fr0, 0.0) * 1.6 + vec3(1.0, 0.97, 0.92) * uSunI * pow(max(dot(R, uSunDir), 0.0), 90.0) * (0.2 + aer);
  spec *= 1.0 - fa * 0.8;
  col += spec * (1.0 - uNight * 0.7);
  // the humps on the clear water: troughs darker, crests catching the sky
  float shade = 0.34 * max(-hump, 0.0) * (1.0 - fa);
  col += vec3(0.1, 0.12, 0.13) * uLight * max(hump, 0.0) * (1.0 - fa) * (1.0 - uNight * 0.7);
  col *= 1.0 - shade; a = a + shade * (1.0 - a);
  float k = edge * uFade;
  gl_FragColor = vec4(col * k, a * k);
}`;
