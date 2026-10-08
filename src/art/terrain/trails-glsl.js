/**
 * Stamp + fade shaders for the world-space trail/deformation render target.
 * Deformation RT (RG16F, single buffer): R = depression (1 ≈ full layer softness depth), G = displaced berm.
 * Flatten RT (R16F, 1/4 resolution): R = grass flatten. Fading is an in-place multiply blend (no ping-pong copy).
 * Realism (must-fix 8): per-stamp cohesion (sand 0.3 … mud/snow 1) controls tread crispness, sand spill,
 * edge wobble and depth noise so tracks are never perfectly regular.
 * Heading convention (ARCHITECTURE.md): facing = (cos h, sin h) in (x, z).
 * @module terrain-b/trails-glsl
 */
export const STAMP_VERT = /* glsl */ `
attribute vec4 iPosDir;   // x, z, cos h, sin h
attribute vec4 iSize;     // length (along), quad width (across), feature width, odometer at centre
attribute vec4 iParam;    // kind, depth, berm, side/seed
attribute vec2 iExtra;    // cohesion 0..1, seed
uniform vec2 uMapSize;
varying vec2 vExtra;
varying vec2 vLocal;      // metres: x = across (right +), y = along (forward +)
varying vec4 vSize;
varying vec4 vParam;
void main() {
  vec2 f = iPosDir.zw;
  vec2 r = vec2(-f.y, f.x);
  vec2 l = vec2(position.x * iSize.y, position.y * iSize.x);
  vec2 w = iPosDir.xy + r * l.x + f * l.y;
  vLocal = l; vSize = iSize; vParam = iParam; vExtra = iExtra;
  gl_Position = vec4(w / uMapSize * 2.0 - 1.0, 0.0, 1.0);
}`;

export const STAMP_FRAG = /* glsl */ `
precision highp float;
varying vec2 vLocal;
varying vec4 vSize;
varying vec4 vParam;
varying vec2 vExtra;
uniform float uFlat;      // 1 = writing the flatten RT
uniform float uTexelM;    // RT texel (m): animal prints only show their pads where a texel resolves them
float h1(float n) { return fract(sin(n * 91.345) * 47453.5453); }
float n1(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
float ellipse(vec2 p, vec2 c, vec2 r) { vec2 d = (p - c) / r; return 1.0 - dot(d, d); }
float blob(vec2 p, vec2 c, vec2 r, float e) { return smoothstep(0.0, e, ellipse(p, c, r)); }
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  int kind = int(vParam.x + 0.5);
  float D = vParam.y, Bm = vParam.z, side = vParam.w;
  float u = vLocal.x, v = vLocal.y, L = vSize.x, fw = vSize.z;
  float coh = vExtra.x, sd = vExtra.y;
  float odo = vSize.w + v;
  float ends = kind == 7 ? 1.0 : smoothstep(0.5 * L, 0.5 * L - 0.04, abs(v));
  float R = 0.0, G = 0.0, A = 0.0;
  // track wander + width breathing (steering corrections, load shifts) and depth noise
  float wob = (n1(odo * 0.45 + sd * 7.0) - 0.5) * 0.09 + (n1(odo * 4.3 + sd * 3.0) - 0.5) * 0.03 * (1.0 - coh);
  float dnz = 0.78 + 0.34 * n1(odo * 1.3 + sd * 11.0) + 0.12 * (n2(vec2(u * 30.0, odo * 30.0) + sd) - 0.5);
  if (kind == 0 || kind == 1) {            // tire (0) / tank track (1)
    u += wob;
    fw *= 0.93 + 0.14 * n1(odo * 0.7 + sd * 5.0);
    float a = abs(u) / (0.5 * fw) + (n2(vec2(u * 18.0, odo * 7.0) + sd) - 0.5) * 0.35 * (1.0 - coh); // crumbling rut wall
    float odoJ = odo + 0.025 * (n1(odo * 2.2 + sd) - 0.5);   // tread spacing jitter (slip)
    float core = smoothstep(1.0, 0.82, a);
    float pattern;
    if (kind == 0) {                        // chevron tread + sipes
      float ch = fract((odoJ + abs(u) * 0.55) / 0.12);
      pattern = smoothstep(0.35, 0.45, ch) * smoothstep(0.85, 0.75, ch);
      pattern *= step(0.08, abs(u) / fw);   // centre rib
      pattern = mix(0.5, pattern, 0.2 + 0.8 * coh * coh);    // dry sand: tread lugs slump
      R = core * (0.55 + 0.45 * pattern) * (0.85 + 0.15 * a * a);
    } else {                                // grouser bars + guide horn gap
      float g = fract(odoJ / 0.155);
      pattern = smoothstep(0.1, 0.18, g) * smoothstep(0.62, 0.54, g);
      pattern *= 0.75 + 0.25 * step(0.12, abs(abs(u) / fw - 0.5));  // worn/missing grouser ends
      pattern = mix(0.5, pattern, 0.2 + 0.8 * coh * coh);
      R = core * (0.62 + 0.38 * pattern);
    }
    // sand spill: loose grains slide back into the rut in irregular tongues (less in cohesive mud/snow)
    float spill = smoothstep(0.55, 0.85, n2(vec2(u * 9.0, odo * 3.5) + sd * 3.1)) * (1.0 - coh) * 0.7;
    R *= (1.0 - spill) * dnz;
    float bermX = smoothstep(0.9, 1.15, a) * smoothstep(1.75, 1.2, a);
    G = bermX * (0.55 + 0.45 * n2(vec2(u * 12.0, odo * 5.0) + side * 17.0)) + spill * 0.4 * core;
    A = smoothstep(1.35, 1.0, a);
  } else if (kind == 2) {                   // boot print (side = ±1 mirrors)
    vec2 p = vec2(u * side, v) * (0.2 / fw);   // fw > 0.2: widened deep-snow print (trails.js _steps)
    float sole = ellipse(p, vec2(0.004, 0.05), vec2(0.052, 0.085));
    float heel = ellipse(p, vec2(-0.004, -0.085), vec2(0.043, 0.048));
    float m = max(sole, heel);
    float body = smoothstep(0.0, 0.25, m);
    vec2 lg = fract(p / vec2(0.022, 0.02)) - 0.5;
    float lug = smoothstep(0.32, 0.22, max(abs(lg.x), abs(lg.y)));
    lug = mix(0.5, lug, coh);                                  // crisp lugs only in cohesive ground
    float toe = smoothstep(0.02, 0.12, v) * 0.15;                // toe push-off digs deeper
    R = body * (0.8 + 0.2 * lug + toe) * (v > -0.03 ? 1.0 : 0.95) * dnz;
    G = smoothstep(-0.55, -0.1, m) * smoothstep(0.08, -0.08, m) * (0.6 + 0.5 * (1.0 - coh) * smoothstep(0.0, 0.1, v));
    A = smoothstep(-0.8, 0.0, m);
  } else if (kind == 3) {                   // crawl furrow: body + alternating elbow/knee pits
    float a = abs(u) / (0.5 * fw);
    float furrow = smoothstep(1.0, 0.35, a) * (0.55 + 0.45 * n1(odo * 2.3));
    float ph = fract(odo / 0.9);
    float el = max(ellipse(vec2(u, ph), vec2(0.27, 0.25), vec2(0.07, 0.09)), ellipse(vec2(u, ph), vec2(-0.27, 0.7), vec2(0.07, 0.09)));
    R = max(furrow * 0.45, smoothstep(0.0, 0.3, el) * 0.8);
    G = smoothstep(0.9, 1.15, a) * smoothstep(1.6, 1.15, a) * 0.5;
    A = smoothstep(1.4, 0.9, a);
  } else if (kind == 4) {                   // dragged body: two wandering heel ruts, a faint smoothed band (coat, buttocks)
    float wv = (n1(odo * 1.7 + sd * 5.0) - 0.5) * 0.05;                 // the legs swing / splay a little
    float sp = 0.1 + (n1(odo * 0.9 + sd * 9.0) - 0.5) * 0.04;
    float cr = (n2(vec2(u * 40.0, odo * 16.0) + sd) - 0.5) * 0.018 * (1.2 - coh); // crumbling rut walls
    float dl = abs(u - wv + sp) + cr, dr = abs(u - wv - sp) + cr;
    float wl = 0.03 + 0.015 * n1(odo * 3.1 + sd), wr = 0.03 + 0.015 * n1(odo * 2.7 + sd * 3.0);
    // heels bounce and dig in unevenly: depth varies, short skips on the right / left in turn
    float gl = smoothstep(0.25, 0.45, n1(odo * 2.2 + sd * 2.0)), gr = smoothstep(0.25, 0.45, n1(odo * 2.2 + sd * 2.0 + 17.3));
    float hl = smoothstep(wl, wl * 0.3, dl) * (0.45 + 0.55 * n1(odo * 6.0 + sd)) * (0.35 + 0.65 * gl);
    float hr = smoothstep(wr, wr * 0.3, dr) * (0.45 + 0.55 * n1(odo * 5.3 + sd * 7.0)) * (0.35 + 0.65 * gr);
    float band = smoothstep(0.2, 0.05, abs(u - wv * 0.5)) * (0.1 + 0.08 * n2(vec2(u * 25.0, odo * 3.0) + sd * 5.0));
    R = max(max(hl, hr), band) * dnz;
    float bl = smoothstep(wl * 0.9, wl * 1.6, dl) * smoothstep(wl * 2.8, wl * 1.6, dl);
    float br = smoothstep(wr * 0.9, wr * 1.6, dr) * smoothstep(wr * 2.8, wr * 1.6, dr);
    G = max(bl * (0.3 + 0.7 * gl), br * (0.3 + 0.7 * gr)) * 0.55 * (0.6 + 0.4 * n2(vec2(u * 30.0, odo * 9.0)));
    A = smoothstep(0.26, 0.1, abs(u - wv * 0.5));
  } else if (kind == 5) {                   // crater / explosion scar
    float rr = length(vec2(u, v)) / (0.5 * fw);
    R = smoothstep(1.0, 0.1, rr);
    G = smoothstep(0.85, 1.05, rr) * smoothstep(1.7, 1.1, rr);
    A = smoothstep(1.8, 1.0, rr);
  } else if (kind == 7) {                   // animal print (trails.js _paw): |side| = style, its sign mirrors left feet
    float st = floor(abs(side) + 0.5), sg = side < 0.0 ? -1.0 : 1.0, Lp = L / 1.5;   // the quad has a berm margin (PAW_PAD)
    vec2 q = vec2(u * sg / fw, v / Lp);                  // print units: ±0.5 across / along, toes forward
    // the pads show only where a texel is well under a pad (~1/5 of the print); a smaller print is its outline
    float det = smoothstep(0.32, 0.12, uTexelM / min(fw, Lp)), e = 0.6, pad, env;
    if (st < 1.5) {                         // dog: four oval toe pads, claw marks ahead of the middle two, a rounded-triangle main pad
      float mp = max(blob(q, vec2(0.0, -0.2), vec2(0.27, 0.19), e), blob(q, vec2(0.0, -0.09), vec2(0.16, 0.13), e));
      float tp = max(max(blob(q, vec2(-0.115, 0.2), vec2(0.105, 0.14), e), blob(q, vec2(0.115, 0.2), vec2(0.105, 0.14), e)),
                     max(blob(q, vec2(-0.315, 0.03), vec2(0.1, 0.13), e), blob(q, vec2(0.315, 0.03), vec2(0.1, 0.13), e)));
      float cl = max(max(blob(q, vec2(-0.1, 0.43), vec2(0.035, 0.05), e), blob(q, vec2(0.1, 0.43), vec2(0.035, 0.05), e)),
                     0.7 * max(blob(q, vec2(-0.37, 0.23), vec2(0.03, 0.04), e), blob(q, vec2(0.37, 0.23), vec2(0.03, 0.04), e)));
      pad = max(max(mp, tp), 0.8 * cl);
      env = blob(q, vec2(0.0, 0.0), vec2(0.45, 0.5), 0.5);
    } else if (st < 2.5) {                  // big cat: no claws, a three-lobed main pad, the toes in a lopsided arc
      float mp = max(blob(q, vec2(0.0, -0.17), vec2(0.3, 0.19), e), max(max(blob(q, vec2(-0.17, -0.3), vec2(0.13, 0.11), e),
                     blob(q, vec2(0.0, -0.33), vec2(0.12, 0.1), e)), blob(q, vec2(0.17, -0.3), vec2(0.13, 0.11), e)));
      float tp = max(max(blob(q, vec2(-0.37, 0.08), vec2(0.1, 0.12), e), blob(q, vec2(-0.13, 0.27), vec2(0.105, 0.13), e)),
                     max(blob(q, vec2(0.12, 0.3), vec2(0.105, 0.13), e), blob(q, vec2(0.36, 0.13), vec2(0.1, 0.12), e)));
      pad = max(mp, tp);
      env = blob(q, vec2(0.0, -0.02), vec2(0.5, 0.48), 0.5);
    } else if (st < 3.5) {                  // bird: three thin toes forward, one back
      vec2 hb = vec2(0.0, -0.1);
      float d = min(min(seg(q, hb, vec2(0.0, 0.5)), seg(q, hb, vec2(-0.42, 0.3))), min(seg(q, hb, vec2(0.42, 0.3)), seg(q, hb, vec2(0.0, -0.46))));
      pad = smoothstep(0.1, 0.04, d);
      env = 0.45 * blob(q, vec2(0.0, 0.05), vec2(0.35, 0.42), 0.6);
    } else {                                // ostrich: a big inner toe with its nail, a small outer one
      float d1 = seg(q, vec2(-0.04, -0.36), vec2(0.0, 0.4)), d2 = seg(q, vec2(0.1, -0.12), vec2(0.34, 0.16));
      pad = max(max(smoothstep(0.17, 0.09, d1), 0.8 * smoothstep(0.1, 0.05, d2)), blob(q, vec2(0.0, 0.46), vec2(0.04, 0.05), e));
      env = blob(q, vec2(0.05, 0.0), vec2(0.3, 0.5), 0.5);
    }
    R = mix(env, max(pad, 0.3 * env), det) * (0.85 + 0.15 * coh) * dnz;
    // berm: what the paw pushed aside, a low ring round the print (looser ground spills more)
    G = blob(q * 0.78, vec2(0.0), vec2(0.5), 0.9) * (1.0 - smoothstep(0.0, 0.25, env)) * (0.5 + 0.5 * (1.0 - coh));
    A = env * (st > 2.5 && st < 3.5 ? 0.1 : 0.6);       // a bird hardly bends the grass
  } else {                                  // 6: flatten only (grass push-down)
    float rr = length(vec2(u / (0.5 * fw), v / (0.5 * L)));
    A = smoothstep(1.0, 0.6, rr);
  }
  R *= ends; G *= ends; A *= ends;
  gl_FragColor = uFlat > 0.5 ? vec4(A, 0.0, 0.0, 1.0) : vec4(R * D, G * Bm, 0.0, 1.0);
}`;

// in-place fade: outputs a per-texel multiplier; the material blends dst = dst * src (no read of the RT)
export const FADE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSplatA;
uniform sampler2D tSplatB;
uniform vec4 uTauA, uTauB;   // per-layer rut life (s)
uniform float uDt;
uniform float uFlatTau;      // grass recovery (s); > 0 = flatten RT
varying vec2 vUv;
void main() {
  if (uFlatTau > 0.0) { gl_FragColor = vec4(exp(-uDt / uFlatTau)); return; }
  float tau = dot(texture2D(tSplatA, vUv), uTauA) + dot(texture2D(tSplatB, vUv), uTauB);
  gl_FragColor = vec4(vec2(exp(-uDt / max(tau, 1.0))), 1.0, 1.0);
}`;

export const FADE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
