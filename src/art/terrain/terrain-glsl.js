/**
 * GLSL for the splat terrain (injected into MeshStandardMaterial via onBeforeCompile).
 * Hex-tiling after Mikkelsen, "Practical Real-Time Hex-Tiling" (JCGT 2022): 3 randomly offset+rotated
 * samples per layer on a shared world-space triangle grid, blended with contrast-preserving weights.
 * @module terrain-b/terrain-glsl
 */

export const COMMON = /* glsl */ `
uniform highp sampler2DArray tAlb;
uniform highp sampler2DArray tNor;
uniform highp sampler2DArray tDat;
uniform sampler2D tSplatA;
uniform sampler2D tSplatB;
uniform sampler2D tNoise;
uniform sampler2D tTrail;
uniform sampler2D tFlat;
uniform vec4 uMap;          // W, D, 1/W, 1/D
uniform vec2 uTrailTexel;   // 1/trail RT size
uniform float uTile[8];     // 1/tile metres
uniform float uSoft[8];
uniform float uWet[8];
uniform float uSnow[8];
uniform float uGrass[8];
uniform float uIce[8];
uniform float uSlush[8];
uniform vec3 uTintL[8];
uniform float uGrassShade;
uniform float uDebug;
uniform float uHexScale;    // hex cells per metre
uniform float uMacro;       // macro variation strength
uniform float uSparkle;
uniform float uHexOn;       // 0 = single sample (low preset)
uniform vec3 uSunDirW;
uniform vec3 uSunCol;
uniform vec2 uWind;         // normalised wind direction (xz)
uniform float uTime;
varying vec3 vWPos;
varying vec3 vWNrm;

vec2 tbHash2(vec2 p) {
  vec2 r = mat2(127.1, 311.7, 269.5, 183.3) * p;
  return fract(sin(r) * 43758.5453);
}
float tbHash1(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 tbHash3(vec2 p) {
  return fract(sin(vec3(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)), dot(p, vec2(419.2, 371.9)))) * 43758.5453);
}
mat2 tbRot(ivec2 idx) {
  float a = abs(float(idx.x * idx.y)) + abs(float(idx.x + idx.y)) + 3.14159265;
  a = mod(a, 6.2831853);
  if (a > 3.14159265) a -= 6.2831853;
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}
// Triangle grid (hex tiling): barycentric weights + vertex ids
void tbTriGrid(vec2 st, out vec3 w, out ivec2 v1, out ivec2 v2, out ivec2 v3) {
  st *= 3.46410162;
  vec2 sk = mat2(1.0, 0.0, -0.57735027, 1.15470054) * st;
  ivec2 base = ivec2(floor(sk));
  vec3 t = vec3(fract(sk), 0.0);
  t.z = 1.0 - t.x - t.y;
  float s = step(0.0, -t.z);
  float s2 = 2.0 * s - 1.0;
  w = vec3(-t.z * s2, s - t.y * s2, s - t.x * s2);
  v1 = base + ivec2(int(s), int(s));
  v2 = base + ivec2(int(s), int(1.0 - s));
  v3 = base + ivec2(int(1.0 - s), int(s));
}
vec2 tbCen(ivec2 v) {
  vec2 c = mat2(1.0, 0.0, 0.5, 0.8660254) * vec2(v); // inverse skew
  return c / 3.46410162;
}
struct TbHex { vec3 w; vec2 c1, c2, c3; vec2 o1, o2, o3; mat2 r1, r2, r3; };
TbHex tbHex(vec2 p) {
  TbHex h;
  ivec2 v1, v2, v3;
  tbTriGrid(p * uHexScale, h.w, v1, v2, v3);
  h.c1 = tbCen(v1) / uHexScale; h.c2 = tbCen(v2) / uHexScale; h.c3 = tbCen(v3) / uHexScale;
  h.r1 = tbRot(v1); h.r2 = tbRot(v2); h.r3 = tbRot(v3);
  h.o1 = tbHash2(vec2(v1)); h.o2 = tbHash2(vec2(v2)); h.o3 = tbHash2(vec2(v3));
  return h;
}
float tbLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// One layer through the hex tiler → albedo (linear), world-ish normal xy (tangent = +x, bitangent = -z), data
void tbLayer(TbHex h, vec2 p, vec2 dx, vec2 dy, int L, out vec3 alb, out vec3 nrm, out vec3 dat) {
  float t = uTile[L];
  float fl = float(L);
  if (uHexOn < 0.5) {
    vec2 uv = p * t;
    alb = textureGrad(tAlb, vec3(uv, fl), dx * t, dy * t).rgb;
    nrm = textureGrad(tNor, vec3(uv, fl), dx * t, dy * t).rgb * 2.0 - 1.0;
    dat = textureGrad(tDat, vec3(uv, fl), dx * t, dy * t).rgb;
    return;
  }
  vec2 u1 = (h.r1 * (p - h.c1) + h.c1) * t + h.o1;
  vec2 u2 = (h.r2 * (p - h.c2) + h.c2) * t + h.o2;
  vec2 u3 = (h.r3 * (p - h.c3) + h.c3) * t + h.o3;
  vec2 dx1 = h.r1 * dx * t, dy1 = h.r1 * dy * t;
  vec2 dx2 = h.r2 * dx * t, dy2 = h.r2 * dy * t;
  vec2 dx3 = h.r3 * dx * t, dy3 = h.r3 * dy * t;
  vec3 a1 = textureGrad(tAlb, vec3(u1, fl), dx1, dy1).rgb;
  vec3 a2 = textureGrad(tAlb, vec3(u2, fl), dx2, dy2).rgb;
  vec3 a3 = textureGrad(tAlb, vec3(u3, fl), dx3, dy3).rgb;
  vec3 lw = vec3(tbLum(a1), tbLum(a2), tbLum(a3));
  lw /= (dot(lw, vec3(1.0 / 3.0)) + 1e-4);
  vec3 W = h.w * mix(vec3(1.0), lw, 0.55);
  W = pow(max(W, 1e-4), vec3(5.0));
  W /= dot(W, vec3(1.0));
  alb = W.x * a1 + W.y * a2 + W.z * a3;
  vec3 n1 = textureGrad(tNor, vec3(u1, fl), dx1, dy1).rgb * 2.0 - 1.0;
  vec3 n2 = textureGrad(tNor, vec3(u2, fl), dx2, dy2).rgb * 2.0 - 1.0;
  vec3 n3 = textureGrad(tNor, vec3(u3, fl), dx3, dy3).rgb * 2.0 - 1.0;
  n1.xy = transpose(h.r1) * n1.xy; n2.xy = transpose(h.r2) * n2.xy; n3.xy = transpose(h.r3) * n3.xy;
  nrm = W.x * n1 + W.y * n2 + W.z * n3;
  dat = W.x * textureGrad(tDat, vec3(u1, fl), dx1, dy1).rgb + W.y * textureGrad(tDat, vec3(u2, fl), dx2, dy2).rgb
      + W.z * textureGrad(tDat, vec3(u3, fl), dx3, dy3).rgb;
}
`;

export const VERT_PARS = /* glsl */ `
uniform sampler2D tSplatA;
uniform sampler2D tSplatB;
uniform sampler2D tTrail;
uniform vec4 uMap;
uniform float uSoft[8];
varying vec3 vWPos;
varying vec3 vWNrm;
`;

// after <begin_vertex>: displace by trail ruts/berms scaled by the layer softness at this vertex
export const VERT_MAIN = /* glsl */ `
{
  vec2 tuv = position.xz * uMap.zw;
  vec4 tr = texture(tTrail, tuv);
  vec4 sa = texture(tSplatA, tuv), sb = texture(tSplatB, tuv);
  float soft = dot(sa, vec4(uSoft[0], uSoft[1], uSoft[2], uSoft[3])) + dot(sb, vec4(uSoft[4], uSoft[5], uSoft[6], uSoft[7]));
  transformed.y += (-tr.r + 0.45 * tr.g) * soft;
}
`;
export const VERT_WORLD = /* glsl */ `
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);
`;

// replaces <map_fragment>: computes albedo, roughness, AO, world normal and snow glints
export const FRAG_MAIN = /* glsl */ `
vec2 tuv = vWPos.xz * uMap.zw;
vec2 p = vec2(vWPos.x, -vWPos.z);
vec2 pdx = dFdx(p), pdy = dFdy(p);
vec4 nz = texture(tNoise, vWPos.xz / 23.0);
vec4 nzL = texture(tNoise, vWPos.xz / 97.0 + 0.37);
vec4 sa = texture(tSplatA, tuv), sb = texture(tSplatB, tuv);
float Wt[8];
Wt[0] = sa.r; Wt[1] = sa.g; Wt[2] = sa.b; Wt[3] = sa.a; Wt[4] = sb.r; Wt[5] = sb.g; Wt[6] = sb.b; Wt[7] = sb.a;
// organic break-up of splat borders (different noise phase per layer)
vec4 nzF = texture(tNoise, vWPos.xz / 3.1);
for (int k = 0; k < 8; k++) Wt[k] *= 0.6 + 0.8 * fract(nzF.r + nzF.g * 1.7 + float(k) * 0.37) * 0.5 + 0.2 * nz[k & 3];
int i0 = 0, i1 = 1, i2 = 2; float w0 = -1.0, w1 = -1.0, w2 = -1.0;
for (int k = 0; k < 8; k++) {
  float v = Wt[k];
  if (v > w0) { w2 = w1; i2 = i1; w1 = w0; i1 = i0; w0 = v; i0 = k; }
  else if (v > w1) { w2 = w1; i2 = i1; w1 = v; i1 = k; }
  else if (v > w2) { w2 = v; i2 = k; }
}
TbHex hx = tbHex(p);
vec3 A0, N0, D0, A1 = vec3(0.0), N1 = vec3(0.0, 0.0, 1.0), D1 = vec3(0.0), A2 = vec3(0.0), N2 = vec3(0.0, 0.0, 1.0), D2 = vec3(0.0);
tbLayer(hx, p, pdx, pdy, i0, A0, N0, D0);
if (w1 > 0.02) tbLayer(hx, p, pdx, pdy, i1, A1, N1, D1); else w1 = 0.0;
if (w2 > 0.04) tbLayer(hx, p, pdx, pdy, i2, A2, N2, D2); else w2 = 0.0;
// height blend
vec3 ws = vec3(w0, w1, w2) / (w0 + w1 + w2 + 1e-5);
// height blend with the layers' own height maps + a 0.5–1 m noise so borders break up around stones/clumps
float hbN = texture(tNoise, vWPos.xz / 1.9).g - 0.5;
vec3 ha = vec3(D0.b, D1.b, D2.b) * 0.9 + ws * 1.25 + vec3(hbN, -hbN, hbN * 0.5) * 0.35;
float hm = max(ha.x, max(ha.y, ha.z)) - 0.22;
vec3 bw = max(ha - hm, 0.0) * step(0.001, ws);
bw /= (bw.x + bw.y + bw.z + 1e-5);
vec3 albT = bw.x * A0 * uTintL[i0] + bw.y * A1 * uTintL[i1] + bw.z * A2 * uTintL[i2];
float iceF = bw.x * uIce[i0] + bw.y * uIce[i1] + bw.z * uIce[i2];
float slushF = bw.x * uSlush[i0] + bw.y * uSlush[i1] + bw.z * uSlush[i2];
vec3 nT = bw.x * N0 + bw.y * N1 + bw.z * N2;
vec3 dT = bw.x * D0 + bw.y * D1 + bw.z * D2;
float softF = bw.x * uSoft[i0] + bw.y * uSoft[i1] + bw.z * uSoft[i2];
float wetF = bw.x * uWet[i0] + bw.y * uWet[i1] + bw.z * uWet[i2];
float snowF = bw.x * uSnow[i0] + bw.y * uSnow[i1] + bw.z * uSnow[i2];
float grassF = bw.x * uGrass[i0] + bw.y * uGrass[i1] + bw.z * uGrass[i2];
albT *= mix(1.0, 0.64, clamp(grassF, 0.0, 1.0) * uGrassShade);
// macro variation: large-scale brightness / hue / roughness drift (kills residual repetition)
float mB = mix(0.76, 1.2, nz.r) * mix(0.88, 1.1, nzL.g);
vec3 hue = mix(vec3(1.0), mix(vec3(0.93, 1.02, 0.9), vec3(1.08, 1.0, 0.82), nz.g), uMacro * (1.0 - snowF * 0.8));
albT *= mix(vec3(1.0), mB * hue, uMacro);
float rough = clamp(dT.g + (nz.b - 0.5) * 0.16 * uMacro, 0.04, 1.0);
float ao = mix(1.0, dT.r, 0.85);
// tangent frame: +x, -z, normal = geometric world normal
vec3 Ng = normalize(vWNrm);
vec3 Tg = normalize(vec3(1.0, 0.0, 0.0) - Ng * Ng.x);
vec3 Bg = cross(Ng, Tg);
vec4 tr = texture(tTrail, tuv);
tr.a = texture(tFlat, tuv).r;
float rut = clamp(tr.r, 0.0, 1.0);
float soft01 = clamp(softF / 0.05, 0.0, 1.0);
nT.xy *= (1.0 - 0.35 * snowF) * (1.0 - 0.75 * rut * soft01); // art review: snow micro-normals read as brushed fur under the low sun
vec3 nW = normalize(Tg * nT.x + Bg * nT.y + Ng * max(nT.z, 0.15));
// ---- snow: wind sastrugi ridges + bluish sub-surface cavities -----------------------------------
if (snowF > 0.01) {
  vec2 q = vec2(dot(vWPos.xz, uWind), dot(vWPos.xz, vec2(-uWind.y, uWind.x)));
  vec2 qs = vec2(q.x / 7.0, q.y / 0.9);
  float e = 0.02;
  float s0 = texture(tNoise, qs).a, sx = texture(tNoise, qs + vec2(e, 0.0)).a, sy = texture(tNoise, qs + vec2(0.0, e)).a;
  vec2 g = vec2((sx - s0) / (e * 7.0), (sy - s0) / (e * 0.9)) * 0.028;
  vec2 gw = g.x * uWind + g.y * vec2(-uWind.y, uWind.x);
  nW = normalize(nW - vec3(gw.x, 0.0, gw.y) * snowF);
  float cav = 1.0 - dT.b;
  albT *= mix(vec3(1.0), vec3(0.8, 0.88, 1.03), snowF * smoothstep(0.35, 0.9, cav) * 0.6);
}
// ---- frozen pond (T-A graft): dark clear ice, white crack network, trapped bubbles, wind-blown snow dust ----
if (iceF > 0.01) {
  vec2 ip = vWPos.xz;
  // cracks: cellular noise edges at two scales
  vec2 cc = ip / 1.7; vec2 ci = floor(cc); float d1 = 9.0, d2 = 9.0;
  for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
    vec2 g = ci + vec2(float(xx), float(yy));
    vec2 o = g + tbHash2(g) - cc; float dd = dot(o, o);
    if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
  }
  float crack = 1.0 - smoothstep(0.0, 0.035, sqrt(d2) - sqrt(d1));
  crack *= smoothstep(0.35, 0.6, texture(tNoise, ip / 9.0).g);
  vec4 nzI = texture(tNoise, ip / 6.0);
  float dust = smoothstep(0.5, 0.75, nzI.a + 0.25 * (texture(tNoise, vec2(dot(ip, uWind), dot(ip, vec2(-uWind.y, uWind.x))) / vec2(9.0, 1.4)).a - 0.5));
  float bub = step(0.985, tbHash1(floor(ip * 22.0))) * 0.6;
  vec3 iceA = mix(vec3(0.045, 0.07, 0.085), vec3(0.11, 0.15, 0.17), nzI.r) * (1.0 + bub);
  iceA = mix(iceA, vec3(0.55, 0.62, 0.68), crack * 0.7);
  iceA = mix(iceA, vec3(0.78, 0.82, 0.88), dust);
  albT = mix(albT, iceA, iceF);
  rough = mix(rough, mix(0.06, 0.55, max(dust, crack * 0.6)), iceF);
  nW = normalize(mix(nW, Ng, iceF * (1.0 - dust) * 0.9));
  ao = mix(ao, 1.0, iceF * 0.8);
}
// ---- trails: ruts, berms, footprints -------------------------------------------------------------
float hC = -tr.r + 0.45 * tr.g;
vec2 te = uTrailTexel;
float hX1 = dot(texture(tTrail, tuv + vec2(te.x, 0.0)).rg, vec2(-1.0, 0.45));
float hX0 = dot(texture(tTrail, tuv - vec2(te.x, 0.0)).rg, vec2(-1.0, 0.45));
float hZ1 = dot(texture(tTrail, tuv + vec2(0.0, te.y)).rg, vec2(-1.0, 0.45));
float hZ0 = dot(texture(tTrail, tuv - vec2(0.0, te.y)).rg, vec2(-1.0, 0.45));
vec2 dh = vec2(hX1 - hX0, hZ1 - hZ0) / (2.0 * te * uMap.xy) * max(softF, 0.004);
nW = normalize(nW - vec3(dh.x, 0.0, dh.y) * 1.3);
// rut self-shadowing: march towards the sun through the trail height field
vec2 sdir = normalize(uSunDirW.xz + vec2(1e-5));
float tanE = uSunDirW.y / max(length(uSunDirW.xz), 1e-3);
float occ = 0.0;
for (int k = 1; k <= 5; k++) {
  float dd = float(k) * 0.022;
  float hk = dot(texture(tTrail, tuv + sdir * dd * uMap.zw).rg, vec2(-1.0, 0.45));
  occ = max(occ, ((hk - hC) * softF - dd * tanE) / 0.006);
}
float tbTrShadow = clamp(occ, 0.0, 1.0) * step(0.004, softF);
// dry disturbed soil is darker + rougher; berms lighter (loose material)
albT *= mix(1.0, 0.82, rut * soft01 * (1.0 - snowF)) * (1.0 + 0.07 * tr.g * soft01);
// trampled grass: darker, yellower, flattened
albT *= mix(vec3(1.0), vec3(0.72, 0.74, 0.62), clamp(tr.a, 0.0, 1.0) * grassF * 0.8);
// snow prints: compacted, blue shadowed interior
albT *= mix(vec3(1.0), vec3(0.6, 0.7, 0.88), clamp(rut * 1.2, 0.0, 1.0) * snowF * (1.0 - slushF)); // art review: prints read at zoom 1
// trampled road slush (T-A graft): churned ruts turn wet brown-grey, berms stay dirty white
float slN = texture(tNoise, vWPos.xz / 2.3).b, slN2 = texture(tNoise, vWPos.xz / 0.7 + 0.3).a;
float sl = slushF * smoothstep(0.1, 0.5, rut + 0.45 * (slN - 0.5) + 0.2 * (slN2 - 0.5)) * smoothstep(0.2, 0.55, slN * 0.7 + slN2 * 0.3 + 0.15);
albT = mix(albT, vec3(0.36, 0.34, 0.31) * mix(0.75, 1.2, slN2), sl * 0.7);
albT *= mix(1.0, 0.86, slushF * smoothstep(0.1, 0.5, tr.g));
rough = mix(rough, 0.28, sl);
// mud: glossy wet ruts + water pooling in the deepest parts
float wetRut = clamp(rut * 1.4, 0.0, 1.0) * wetF;
albT *= mix(1.0, 0.62, wetRut);
rough = mix(rough, rough * 0.45, wetRut);
float puddle = smoothstep(0.38, 0.62, rut + (texture(tNoise, vWPos.xz / 3.7).r - 0.5) * 0.35) * smoothstep(0.3, 0.6, wetF);
albT *= mix(1.0, 0.55, puddle);
rough = mix(rough, 0.04, puddle);
nW = normalize(mix(nW, Ng, puddle * 0.92));
ao = mix(ao, 1.0, puddle);
// ---- snow glints ------------------------------------------------------------------------------
vec3 Vw = isOrthographic ? normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2])) : normalize(cameraPosition - vWPos);
vec3 Hh = normalize(Vw + normalize(uSunDirW));
// must-fix 12: glint cells are world-anchored AND at least ~2.5 px wide (power-of-two metres chosen from the
// pixel footprint, which does not change while panning), each glint is a small in-cell disc -> no pan flicker.
float fp = max(length(fwidth(vWPos.xz)), 1e-4);
float csz = exp2(ceil(log2(max(fp * 2.5, 1.0 / 55.0))));
vec2 cell = floor(vWPos.xz / csz);
vec2 inC = fract(vWPos.xz / csz) - 0.5;
vec3 rn = tbHash3(cell) * 2.0 - 1.0;
vec3 gn = normalize(vec3(rn.x, abs(rn.z) + 0.05, rn.y));
float disc = smoothstep(0.32, 0.12, length(inC - (tbHash2(cell + 3.3) - 0.5) * 0.4));
float glint = 6.0 * pow(max(dot(gn, Hh), 0.0), 300.0) * step(0.55, tbHash1(cell + 7.1)) * disc;
float tbGlint = glint * max(snowF * (1.0 - iceF), 0.0) * (1.0 - rut) * (1.0 - slushF) * uSparkle * max(dot(Ng, normalize(uSunDirW)), 0.0);
if (uDebug > 0.5) albT = vec3(tr.r, tr.g, tr.a) * 0.8;
diffuseColor.rgb = albT;
float tbRough = rough;
float tbAO = ao * (1.0 - 0.45 * clamp(rut * 1.3, 0.0, 1.0) * soft01); // art review: sky occlusion inside ruts/prints (reads in shade too)
vec3 tbNw = nW;
`;

export const FRAG_ROUGH = /* glsl */ `float roughnessFactor = tbRough;`;
export const FRAG_NORMAL = /* glsl */ `normal = normalize((viewMatrix * vec4(tbNw, 0.0)).xyz);`;
export const FRAG_EMIS = /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance += tbGlint * uSunCol;`;
export const FRAG_AO = /* glsl */ `
reflectedLight.indirectDiffuse *= tbAO;
reflectedLight.indirectSpecular *= computeSpecularOcclusion(max(dot(geometryNormal, geometryViewDir), 0.0), tbAO, material.roughness);
reflectedLight.directDiffuse *= mix(1.0, tbAO, 0.35) * (1.0 - 0.8 * tbTrShadow);
reflectedLight.directSpecular *= 1.0 - 0.9 * tbTrShadow;
`;
