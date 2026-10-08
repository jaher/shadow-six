/**
 * Pavement shader (PROGRESS step 3p), injected into MeshStandardMaterial via onBeforeCompile.
 *  - road-space texturing: u across the carriageway, v along it (setts courses stay square to the kerb on curves),
 *    world-space rotated for areas; per-slab random offsets (concrete, quay) with procedural expansion joints,
 *  - steep parallax occlusion mapping on the CC0 height (ard.b) under the fixed orthographic camera,
 *  - wear (polished wheel lanes, oil streaks), cracks + sealed tar seams, repair patches, weeds in the joints,
 *    ragged crumbling edges, gutters (setts laid along the kerb), period road markings, shell-crater damage,
 *  - weather: snow packed into joints and off the wheel lanes, wetness, puddles that fill the joints first,
 *  - trail films: the terrain's trail field (tyres, boots) leaves mud / slush / dust films on hard surfaces.
 * Anti-tiling (the paving pattern stays regular, the texture repeat does not show):
 *  - slab paving (flags, quay): every slab of the world grid takes a random slab of the scan's own 4 × 4 grid, turned
 *    by a random quarter turn / mirrored, between procedural joints; per-slab tone, tilt, roughness, odd replaced slabs,
 *  - stones / bricks (setts, Belgian blocks, fan pavé, herringbone): a stone-ID map (tools/render/pave_stones.py) gives
 *    each stone in the world its own key, hence its own tone / hue / tilt / polish, and divides out the scan's own
 *    per-stone tones (which repeat with the texture); setts and Belgian blocks also get a block shuffle: every run of
 *    ~4 stones along a course is a random piece of a random course of the scan, cut between stones,
 *  - tar macadam: hex tiling (3 rotated + offset taps; a rotated second sample under a noise mask on low),
 *  - everywhere: world-space macro variation that never repeats (tone and colour drift, oil / damp stains, grime).
 * @module art/pavement/pavement-glsl
 */
import { AT_COMMON } from '../anti-tiling-glsl.js';

export const PAVE_VERT_PARS = /* glsl */ `
attribute vec4 aPave;   // s (m along), t (m across, +left), edge distance (m, inside > 0), half width (m)
attribute vec4 aPvMisc; // crater damage 0..1, gutter width (m, kerbed roads), markings code, 1 = road ribbon / 0 = area
attribute vec2 aPvDir;  // unit direction of v (along the road / area pattern) in world xz
varying vec4 vPave;
varying vec4 vPvMisc;
varying vec2 vPvDir;
varying vec3 vPvW;
`;

export const PAVE_VERT_MAIN = /* glsl */ `
vPave = aPave; vPvMisc = aPvMisc; vPvDir = aPvDir;
vPvW = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

export const PAVE_FRAG_PARS = /* glsl */ `
uniform sampler2D tPvDiff;
uniform sampler2D tPvNor;
uniform sampler2D tPvArd;
uniform sampler2D tPvTrail;
uniform vec4 uPvMap;     // map W, D, trail on (0/1), normal strength
uniform vec4 uPvTex;     // 1/tile (1/m), POM depth (m), POM steps, isotropic anti-tiling (0/1)
uniform vec3 uPvTint;
uniform vec3 uPvDirt;    // joint / edge dirt colour (theatre)
uniform vec3 uPvFilm;    // trail film colour (mud, slush, dust)
uniform vec3 uPvWeed;
uniform vec4 uPvWear;    // wear, cracks, patches, weeds
uniform vec4 uPvWeather; // snow, wetness, puddles, film strength
uniform vec4 uPvSlab;    // slab size u, v (m; 0 = none), joint width (m), running bond (0/1)
uniform float uPvSat;   // albedo saturation (granite quays: greyer)
uniform vec4 uPvKind;    // ragged edges (0/1), asphalt-like (0/1), patch style (0 asphalt, 1 tar over stone), gutter tile ratio
uniform sampler2D tPvSid; // stone IDs (NEAREST; tools/render/pave_stones.py): centre uv, wrap * 25 + scan tone level
uniform vec4 uPvStone;   // per-stone variation on (0/1), tone amplitude, scan-tone removal 0..1, stone size (uv)
uniform vec4 uPvSrcU;    // slab shuffle: the scan's own joint centres along u (4 per repeat) …
uniform vec4 uPvSrcV;    // … and along v
uniform vec4 uPvShuf;    // shuffle on (0/1), source margin (uv), per-slab tone amplitude, hex tiling (0 off, 1 2-tap, 2 hex)
uniform vec4 uPvCourse;  // block shuffle: courses per repeat (0 = off), random shift (0/1), run length (uv)
uniform float uPvRows[12]; // the scan's course boundaries (v, ascending; [n] = [0] + 1)
uniform sampler2D tAtNoise; // shared tileable noise (art/anti-tiling.js) for the macro variation
varying vec4 vPave;
varying vec4 vPvMisc;
varying vec2 vPvDir;
varying vec3 vPvW;
float pvRough = 0.8, pvMetal = 0.0, pvAO = 1.0;
vec3 pvNts = vec3(0.0, 0.0, 1.0), pvT = vec3(1.0, 0.0, 0.0), pvB = vec3(0.0, 1.0, 0.0);

float pvHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 pvHash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float pvNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pvHash(i), pvHash(i + vec2(1, 0)), u.x), mix(pvHash(i + vec2(0, 1)), pvHash(i + vec2(1, 1)), u.x), u.y);
}
float pvFbm(vec2 p) { return pvNoise(p) * 0.5 + pvNoise(p * 2.03 + 7.1) * 0.3 + pvNoise(p * 4.1 + 3.7) * 0.2; }
// distance to the nearest Voronoi cell border (crack network)
float pvCrack(vec2 p) {
  vec2 n = floor(p), f = fract(p), mg, mr;
  float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)), o = pvHash2(n + g), r = g + o - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  md = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j)), o = pvHash2(n + g), r = g + o - f;
    if (dot(mr - r, mr - r) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return md;
}
vec4 pvTex(sampler2D t, vec2 uv, vec2 dx, vec2 dy) { return textureGrad(t, uv, dx, dy); }
${AT_COMMON}
// course of a stone centre v (uv): the last boundary at or below it
int pvRowOf(float v, int n) {
  float x = fract(v - uPvRows[0]);
  int r = 0;
  for (int i = 1; i < 12; i++) { if (i >= n) break; if (x >= uPvRows[i] - uPvRows[0]) r = i; }
  return r;
}
`;

/** Replaces <map_fragment>: pattern, POM, sampling, wear, damage, weather → diffuseColor + pv* globals. */
export const PAVE_FRAG_MAIN = /* glsl */ `
vec2 pvDir = normalize(vPvDir + vec2(1e-5, 0.0));
vec3 pvNv = normalize(vNormal);
pvT = normalize((viewMatrix * vec4(-pvDir.y, 0.0, pvDir.x, 0.0)).xyz);
pvT = normalize(pvT - pvNv * dot(pvT, pvNv));
pvB = cross(pvNv, pvT);
vec2 pvP = vPave.yx;                     // metres: u across (+left), v along
float pvRoad = vPvMisc.w, pvHW = vPave.w, pvEdge = vPave.z;
float pvGut = vPvMisc.y > 0.01 && abs(vPave.y) > pvHW - vPvMisc.y ? 1.0 : 0.0;
if (pvEdge < 0.0) discard; // outside the area
float pvHole = smoothstep(0.0, 0.06, vPvMisc.x - 0.7 - 0.25 * pvNoise(vPvW.xz * 2.3)); // crater core: paving blown out
float pvMac = pvFbm(vPvW.xz * 0.11);
float pvRag = pvFbm(vPvW.xz * 1.7) * 0.75 + pvNoise(vPvW.xz * 6.0) * 0.25;
if (uPvKind.x > 0.5 && pvEdge < pvRag * 0.45 - 0.05) discard;
vec2 pvUV = pvP * uPvTex.x;
vec2 pvPdx = dFdx(pvP), pvPdy = dFdy(pvP);
vec2 pvDx = pvPdx * uPvTex.x, pvDy = pvPdy * uPvTex.x;
float pvJoint = 0.0, pvSlabOn = 0.0;
vec4 pvSh = vec4(0.5);                    // per-slab randoms (tone, hue, tilt …)
vec2 pvBev = vec2(0.0);                   // slab arris: normal leans into the joint
mat2 pvM = mat2(1.0);                     // slab shuffle: source quarter turn / mirror (normals turn back with it)
if (uPvSlab.x > 0.0) {
  vec2 q = pvP / uPvSlab.xy;
  if (uPvSlab.w > 0.5) q.x += 0.5 * floor(q.y);
  vec2 cell = floor(q), f = fract(q) * uPvSlab.xy, de2 = min(f, uPvSlab.xy - f);
  float jw = uPvSlab.z * 0.5 * (0.75 + 0.5 * pvNoise(vPvW.xz * 2.7 + cell * 1.3));   // hand-laid: joints breathe
  float ed = min(de2.x, de2.y);
  pvJoint = 1.0 - smoothstep(jw, jw + 0.012, ed);
  pvSlabOn = 1.0;
  pvSh = atHash4(cell * vec2(1.0, 1.37) + 41.3);
  // rounded arris over ~2.5 cm: the slab surface falls toward the nearest joint (reads at zoom 2, sharpens the grid)
  vec2 ex = vec2(f.x < uPvSlab.x * 0.5 ? -1.0 : 1.0, f.y < uPvSlab.y * 0.5 ? -1.0 : 1.0);
  pvBev = ex * (1.0 - smoothstep(jw, jw + 0.025, de2)) * 0.45;
  if (uPvShuf.x > 0.5) { // the scan's own 4 × 4 slabs, one at random per world slab, a quarter turn / mirror each
    vec4 hs = atHash4(cell * vec2(1.0, 1.37) + 7.7);
    int si = int(hs.x * 3.999), sj = int(hs.y * 3.999), k = int(hs.z * 3.999);
    float m = uPvShuf.y;
    float u0 = uPvSrcU[si] + m, u1 = (si < 3 ? uPvSrcU[si + 1] : uPvSrcU[0] + 1.0) - m;
    float v0 = uPvSrcV[sj] + m, v1 = (sj < 3 ? uPvSrcV[sj + 1] : uPvSrcV[0] + 1.0) - m;
    vec2 inner = uPvSlab.xy - uPvSlab.z;
    vec2 t = clamp((f - uPvSlab.z * 0.5) / inner, 0.0, 1.0) - 0.5;
    pvM = k == 0 ? mat2(1.0) : k == 1 ? mat2(0.0, 1.0, -1.0, 0.0) : k == 2 ? mat2(-1.0) : mat2(0.0, -1.0, 1.0, 0.0);
    if (hs.w > 0.5) pvM = pvM * mat2(-1.0, 0.0, 0.0, 1.0);
    vec2 sz = vec2(u1 - u0, v1 - v0);
    pvUV = vec2(u0, v0) + sz * (pvM * t + 0.5);
    pvDx = sz * (pvM * (pvPdx / inner)); pvDy = sz * (pvM * (pvPdy / inner));
  } else {
    pvUV = (f + pvHash2(cell) * 13.0) * uPvTex.x;   // concrete: each slab its own piece of the scan
  }
}
if (pvGut > 0.5) { pvUV = pvP.yx * uPvTex.x * uPvKind.w; pvDx = dFdx(pvUV); pvDy = dFdy(pvUV); }
// block shuffle (setts, Belgian blocks): the stones' courses stay continuous, but every run of ~4 stones along a course
// shows a random piece of a random course of the scan. A texel belongs to the block that holds its stone's centre (the
// stone-ID map gives the centre), else to the neighbouring block across the nearest run end / course edge, else the
// joint widens. Cuts therefore always fall between stones. Stone keys follow the world (course, run).
float pvCrs = 0.0, pvRun = 0.0, pvCrsGap = 0.0;
if (uPvCourse.x > 0.5) {
  int n = int(uPvCourse.x);
  float N = uPvCourse.x, Lr = uPvCourse.z, yw = pvUV.y * N, c0 = floor(yw), tt = yw - c0;
  bool far = uPvStone.w / max(max(length(pvDx), length(pvDy)), 1e-6) < 1.5; // stones under ~1.5 px: no classification
  vec2 best = vec2(0.0); float bestC = c0, bestR = 0.0, bestS = 1.0; bool found = false;
  for (int k = 0; k < 4; k++) {
    float c = k >= 2 ? (tt < 0.5 ? c0 - 1.0 : c0 + 1.0) : c0;
    float ph = atHash(vec2(c, 9.13)) * Lr;                       // run ends staggered course to course
    float xr = (pvUV.x - ph) / Lr, r0 = floor(xr);
    float rr = (k == 1 || k == 3) ? r0 + (xr - r0 < 0.5 ? -1.0 : 1.0) : r0;
    vec4 h = atHash4(vec2(c * 1.618 + rr * 0.1317, rr * 3.17 + c * 0.071));
    int r = min(int(h.x * N), n - 1);
    float b0 = uPvRows[r], b1 = uPvRows[r + 1], du = floor(h.y * 64.0) / 64.0 * uPvCourse.y;
    vec2 suv = vec2(pvUV.x + du, b0 + (yw - c) * (b1 - b0));
    if (k == 0) { best = suv; bestC = c; bestR = rr; bestS = (b1 - b0) * N; }
    if (far) break;
    vec3 id = texture(tPvSid, suv).rgb;
    float bb = floor(id.b * 255.0 + 0.5), wr = floor(bb / 25.0);
    float uc = floor(suv.x) + floor(wr / 3.0) - 1.0 + floor(id.r * 255.0 + 0.5) / 255.0 - du; // world u of its centre
    if (pvRowOf(floor(id.g * 255.0 + 0.5) / 255.0, n) == r && floor((uc - ph) / Lr) == rr) {
      best = suv; bestC = c; bestR = rr; bestS = (b1 - b0) * N; found = true; break;
    }
  }
  if (!far && !found) pvCrsGap = 1.0;
  pvUV = best; pvCrs = bestC; pvRun = bestR;
  pvDx.y *= bestS; pvDy.y *= bestS;
}
// repair patches: rectangles across a lane (roads) or scattered (areas)
float pvPatch = 0.0;
if (uPvWear.z > 0.0) {
  float cs = 6.5, ci = floor(vPave.x / cs);
  vec2 pc = pvRoad > 0.5 ? vec2(ci, 3.0) : floor(vPvW.xz / 5.0);
  if (pvHash(pc + 0.37) < uPvWear.z) {
    vec2 r2 = pvHash2(pc + 1.7);
    vec2 lp = pvRoad > 0.5 ? vec2(vPave.y, vPave.x - ci * cs) : vPvW.xz - pc * 5.0;
    vec2 c = pvRoad > 0.5 ? vec2((r2.x - 0.5) * pvHW, cs * 0.5) : vec2(2.5);
    vec2 hs = pvRoad > 0.5 ? vec2(0.6 + r2.y * pvHW * 0.5, 0.8 + r2.x * 2.0) : vec2(0.8) + r2 * 1.5;
    float pa = (r2.y - 0.5) * 0.5 * (1.0 - pvRoad);                // areas: patches at odd angles
    lp = mat2(cos(pa), -sin(pa), sin(pa), cos(pa)) * (lp - c) + c;
    vec2 d = abs(lp - c) - hs + (pvNoise(vPvW.xz * 3.0) - 0.5) * 0.12 + (pvNoise(vPvW.xz * 0.9) - 0.5) * 0.35;
    pvPatch = (1.0 - smoothstep(-0.02, 0.0, max(d.x, d.y))) * (0.55 + 0.45 * r2.x);
  }
}
// steep parallax occlusion mapping (height = ard.b, 1 = top)
vec3 pvV = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
vec3 pvVt = vec3(dot(pvV, pvT), dot(pvV, pvB), dot(pvV, pvNv));
float pvDepth = uPvTex.y * uPvTex.x * (1.0 - pvPatch) * (1.0 - 0.5 * smoothstep(0.3, 0.8, vPvMisc.x));
int pvSteps = uPvShuf.x > 0.5 || (uPvShuf.w > 1.5 && uPvSlab.x <= 0.0) ? 0 : int(uPvTex.z); // no POM on shuffled slabs / hex tar
if (pvSteps > 0 && pvDepth > 0.0) {
  float dl = 1.0 / float(pvSteps), layer = 0.0;
  vec2 delta = pvVt.xy / max(pvVt.z, 0.35) * pvDepth * dl, uvS = pvUV;
  float dCur = 1.0 - pvTex(tPvArd, uvS, pvDx, pvDy).b;
  for (int i = 0; i < 32; i++) {
    if (i >= pvSteps || layer >= dCur) break;
    uvS -= delta; layer += dl;
    dCur = 1.0 - pvTex(tPvArd, uvS, pvDx, pvDy).b;
  }
  vec2 prev = uvS + delta;
  float after = dCur - layer, before = (1.0 - pvTex(tPvArd, prev, pvDx, pvDy).b) - layer + dl;
  pvUV = mix(uvS, prev, clamp(after / (after - before + 1e-5), 0.0, 1.0));
}
vec4 pvD; vec3 pvNt, pvA;
if (uPvKind.y > 0.5 && uPvShuf.w > 1.5 && uPvSlab.x <= 0.0) { // tar macadam: hex tiling, 3 rotated + offset taps
  AtHex hx = atHex(pvUV, 3.4641016, 1.0, 0.0);
  vec3 a1 = textureGrad(tPvDiff, atUV1(hx, pvUV), hx.r1 * pvDx, hx.r1 * pvDy).rgb;
  vec3 a2 = textureGrad(tPvDiff, atUV2(hx, pvUV), hx.r2 * pvDx, hx.r2 * pvDy).rgb;
  vec3 a3 = textureGrad(tPvDiff, atUV3(hx, pvUV), hx.r3 * pvDx, hx.r3 * pvDy).rgb;
  vec3 W = atHexW(hx, a1, a2, a3);
  pvD = vec4(atVP(vec4(a1, 1.0), vec4(a2, 1.0), vec4(a3, 1.0), W, atMean(tPvDiff)).rgb, 1.0);
  pvNt = atNor3(tPvNor, hx, W, pvUV, pvDx, pvDy);
  pvA = atTex3(tPvArd, hx, W, pvUV, pvDx, pvDy).xyz;
} else {
pvD = pvTex(tPvDiff, pvUV, pvDx, pvDy);
pvNt = pvTex(tPvNor, pvUV, pvDx, pvDy).xyz * 2.0 - 1.0;
pvA = pvTex(tPvArd, pvUV, pvDx, pvDy).xyz;
pvNt.xy = transpose(pvM) * pvNt.xy;
}
if (uPvKind.y > 0.5 && uPvTex.w > 0.5 && uPvShuf.w > 0.5 && uPvShuf.w < 1.5) { // low preset: a rotated second sample under a low-frequency mask
  mat2 R = mat2(0.8, -0.6, 0.6, 0.8);
  vec2 uv2 = R * pvUV + vec2(0.37, 0.71), dx2 = R * pvDx, dy2 = R * pvDy;
  float m = smoothstep(0.35, 0.65, pvFbm(vPvW.xz * 0.23));
  pvD = mix(pvD, pvTex(tPvDiff, uv2, dx2, dy2), m);
  vec3 n2 = pvTex(tPvNor, uv2, dx2, dy2).xyz * 2.0 - 1.0;
  n2.xy = transpose(R) * n2.xy;
  pvNt = mix(pvNt, n2, m);
  pvA = mix(pvA, pvTex(tPvArd, uv2, dx2, dy2).xyz, m);
}
vec3 col = mix(vec3(dot(pvD.rgb, vec3(0.3, 0.59, 0.11))), pvD.rgb, uPvSat) * uPvTint * (0.9 + 0.2 * pvMac);
float hgt = pvA.b, rough = pvA.g;
hgt = mix(hgt, min(hgt, 0.12), pvCrsGap);             // course shuffle: no stone here, the joint widens
float joint = max(pvJoint, 1.0 - smoothstep(0.18, 0.42, hgt));
vec3 n = vec3(pvNt.xy * uPvMap.w, max(pvNt.z, 0.2));
// ---- anti-tiling: per stone / per slab variation, then macro variation that never repeats -------------------
float pvFp = max(length(pvDx), length(pvDy));          // uv per pixel
if (uPvStone.x > 0.5) { // stones / bricks: each stone in the world its own tone, hue, tilt and polish
  vec3 sid = texture(tPvSid, pvUV).rgb;
  float b = floor(sid.b * 255.0 + 0.5), wr = floor(b / 25.0), lvl = b - wr * 25.0;
  vec2 rep = floor(pvUV) + vec2(floor(wr / 3.0), mod(wr, 3.0)) - 1.0;
  if (uPvCourse.x > 0.5) rep = vec2(pvRun, pvCrs);       // block shuffle: the world (run, course) is the stone's instance
  vec2 key = rep * 257.0 + floor(sid.rg * 255.0 + 0.5);
  vec4 st = atHash4(key + 0.37);
  float fade = smoothstep(2.0, 5.0, uPvStone.w / max(pvFp, 1e-6)); // stones under ~3 px fade to their mean (no shimmer)
  float scan = 0.6 + lvl * (0.8 / 24.0);                 // the scan's own tone of this stone (repeats with the tile)
  float tone = (1.0 + uPvStone.y * (st.x * 2.0 - 1.0 + (st.y > 0.9 ? -0.9 : 0.0))) * mix(1.0, 1.0 / scan, uPvStone.z);
  vec3 hue = mix(vec3(0.95, 0.99, 1.05), vec3(1.05, 1.0, 0.94), st.z);
  col *= mix(vec3(1.0), tone * mix(vec3(1.0), hue, uPvStone.y * 4.0), fade * (1.0 - pvJoint));
  float near = smoothstep(4.0, 9.0, uPvStone.w / max(pvFp, 1e-6));  // settle tilt only once a stone is ~6 px+ (no glitter)
  n.xy += (st.zw - 0.5) * 0.12 * near * (1.0 - joint);
  rough = clamp(rough + (st.w - 0.5) * 0.06 * fade, 0.0, 1.0);
}
if (pvSlabOn > 0.5) { // slabs: tone, colour, settle tilt, roughness; a few replaced (paler, cleaner) or stained slabs
  vec4 s2 = atHash4(pvSh.xy * 113.0 + pvSh.zw * 71.0);
  float rep = step(0.94, s2.w), old = step(s2.w, 0.05);
  col *= (1.0 + uPvShuf.z * (pvSh.x * 2.0 - 1.0)) * mix(vec3(0.97, 0.99, 1.03), vec3(1.03, 1.0, 0.96), pvSh.y);
  col = mix(col, col * vec3(1.12, 1.1, 1.06), rep * 0.8);
  col *= 1.0 - 0.18 * old;
  n.xy += (s2.xy - 0.5) * 0.1 * (1.0 - pvJoint) + pvBev;
  rough = clamp(rough + (pvSh.w - 0.5) * 0.12 - rep * 0.05, 0.0, 1.0);
}
{ // macro: colour drift (~12 m), grime (~3 m), damp / oil stains (~1 m, in clusters), sun-bleached patches (~6 m);
  // three fetches of a small tileable noise at incommensurate scales and angles (art/anti-tiling.js)
  vec2 wq = vPvW.xz;
  vec4 m1 = texture(tAtNoise, wq / 47.0 + 0.13);
  vec4 m2 = texture(tAtNoise, mat2(0.8, -0.6, 0.6, 0.8) * wq / 9.7 + 0.41);
  vec4 m3 = texture(tAtNoise, mat2(0.6, 0.8, -0.8, 0.6) * wq / 3.3 + 0.77);
  col *= mix(vec3(0.95, 0.985, 1.04), vec3(1.05, 1.0, 0.94), m1.g);
  float grime = smoothstep(0.52, 0.8, m2.r * 0.65 + m1.b * 0.35) * (0.5 + 0.5 * joint);
  col = mix(col, mix(col, uPvDirt, 0.45) * 0.82, grime * 0.4);
  float clus = smoothstep(0.45, 0.75, m1.r * 0.6 + m2.g * 0.4);
  float stain = smoothstep(0.6, 0.72, m3.r * 0.6 + m2.a * 0.4) * clus;
  col *= 1.0 - 0.26 * stain; rough = mix(rough, rough * 0.72, stain);
  float bl = smoothstep(0.6, 0.85, m1.a * 0.5 + m2.b * 0.5) * (1.0 - stain);
  col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))) * 1.1, bl * 0.22);
}
if (pvJoint > 0.0) { n.xy *= 1.0 - pvJoint * 0.7; hgt = mix(hgt, 0.1, pvJoint); }
col = mix(col, uPvDirt * (0.8 + 0.4 * pvNoise(vPvW.xz * 9.0)), joint * 0.55);
rough = mix(rough, 0.95, joint * 0.5);
float edgeD = 1.0 - smoothstep(0.0, 0.9, pvEdge - pvRag * 0.45);
col = mix(col, uPvDirt, edgeD * 0.45 * uPvKind.x);
${'' /* wear */}
float lane = 0.0, oil = 0.0;
if (pvRoad > 0.5 && pvHW > 1.2) {
  float lc = pvHW > 2.6 ? pvHW * 0.5 : 0.0, a = abs(abs(vPave.y) - lc);
  lane = exp(-pow((a - 0.8) / 0.28, 2.0)) * (0.7 + 0.3 * pvNoise(vec2(vPave.x * 0.2, 3.0))) * uPvWear.x;
  oil = exp(-pow(a / 0.3, 2.0)) * smoothstep(0.35, 0.8, pvNoise(vec2(vPave.x * 0.35, vPave.y * 2.0))) * uPvWear.x;
  col *= 1.0 - 0.07 * lane - 0.25 * oil;
  rough = mix(rough, rough * 0.6, lane); rough = mix(rough, 0.35, oil * 0.5);
}
`;

export const PAVE_FRAG_MAIN2 = /* glsl */ `
float crk = 0.0, seam = 0.0;
if (uPvWear.y > 0.0) { // crack network; some cracks sealed with glossy tar (asphalt), the construction joint too
  vec2 cp = vPvW.xz * 0.4 + (vec2(pvNoise(vPvW.xz * 0.9), pvNoise(vPvW.xz * 0.9 + 5.0)) - 0.5) * 0.35 + (vec2(pvNoise(vPvW.xz * 7.0), pvNoise(vPvW.xz * 7.0 + 2.0)) - 0.5) * 0.03;
  float e = pvCrack(cp);
  float mask = smoothstep(1.0 - uPvWear.y, 1.25 - uPvWear.y, pvFbm(vPvW.xz * 0.19 + 11.0) + vPvMisc.x * 0.8);
  crk = (1.0 - smoothstep(0.004, 0.02, e)) * mask;
  seam = (1.0 - smoothstep(0.02, 0.045, e)) * step(0.62, pvHash(floor(cp) + 0.5)) * smoothstep(0.3, 0.6, uPvWear.y) * uPvKind.y * mask;
  if (pvRoad > 0.5 && uPvKind.y > 0.5 && uPvSlab.x <= 0.0) seam = max(seam, 1.0 - smoothstep(0.03, 0.055, abs(vPave.y + (pvNoise(vec2(vPave.x * 0.3, 1.0)) - 0.5) * 0.08)));
  col = mix(col, col * 0.25, crk);
  col = mix(col, vec3(0.035, 0.035, 0.038), seam); rough = mix(rough, 0.3, seam);
  n.xy *= 1.0 - 0.8 * seam;
}
if (pvPatch > 0.0) { // repairs: fresher tar over asphalt, or a tar patch over stone
  vec3 pc = uPvKind.z > 0.5 ? vec3(0.075, 0.074, 0.078) * (0.75 + 0.5 * pvFbm(vPvW.xz * 3.0)) : col * (uPvSlab.x > 0.0 ? 0.88 : 0.72);
  col = mix(col, pc, pvPatch); rough = mix(rough, uPvKind.z > 0.5 ? 0.55 : 0.75, pvPatch);
  n = mix(n, vec3(0.0, 0.0, 1.0), pvPatch * 0.7);
  float pvRim = pvPatch * (1.0 - pvPatch) * 4.0;
  col *= 1.0 - 0.5 * pvRim;
  joint *= 1.0 - pvPatch;
}
float dm = smoothstep(0.05, 0.6, vPvMisc.x);  // shell craters: scorched, shattered, rubble-filled
if (dm > 0.0) {
  col = mix(col, mix(uPvDirt * 0.5, vec3(0.035, 0.032, 0.03), smoothstep(0.5, 1.0, vPvMisc.x)), dm * 0.85);
  rough = mix(rough, 0.95, dm);
  n.xy += (vec2(pvFbm(vPvW.xz * 2.5), pvFbm(vPvW.xz * 2.5 + 3.0)) - 0.5) * 0.8 * dm;
}
if (pvHole > 0.0) { // churned earth and rubble where the paving was blown out
  vec2 ruv = mat2(0.6, -0.8, 0.8, 0.6) * vPvW.xz * 1.9;
  vec3 grit = textureGrad(tPvDiff, ruv, dFdx(ruv), dFdy(ruv)).rgb;
  vec3 gn = textureGrad(tPvNor, ruv, dFdx(ruv), dFdy(ruv)).xyz * 2.0 - 1.0;
  float gl = dot(grit, vec3(0.33));
  vec3 earth = mix(uPvDirt * 0.35, vec3(0.035, 0.032, 0.03), 0.4 + 0.4 * pvFbm(vPvW.xz * 1.3)) * (0.55 + 1.1 * gl);
  col = mix(col, earth, pvHole);
  rough = mix(rough, 0.97, pvHole);
  n = mix(n, normalize(vec3(gn.xy * 1.6, gn.z)), pvHole);
  joint *= 1.0 - pvHole; hgt = mix(hgt, 0.5, pvHole);
}
// weeds in joints and cracks where traffic is light (edges, areas)
float weed = uPvWear.w * max(joint, crk) * smoothstep(0.52, 0.72, pvFbm(vPvW.xz * 1.4)) * (1.0 - lane)
  * mix(1.0, 0.25, pvRoad * smoothstep(0.4, 1.5, pvEdge)) * (1.0 - pvPatch);
col = mix(col, uPvWeed * (0.55 + 0.7 * pvNoise(vPvW.xz * 23.0)), weed); rough = mix(rough, 0.8, weed);
float mk = 0.0;
if (vPvMisc.z > 0.5 && pvRoad > 0.5 && pvGut < 0.5) { // period road paint: 1 dashed centre, 2 solid, 3 edge lines, 4 dashed + edges
  float code = vPvMisc.z, c = 1.0 - smoothstep(0.05, 0.065, abs(vPave.y));
  if (code < 1.5 || code > 3.5) mk = c * step(fract(vPave.x / 9.0), 0.4);
  else if (code < 2.5) mk = c;
  if (code > 2.5) mk = max(mk, 1.0 - smoothstep(0.05, 0.065, abs(abs(vPave.y) - (pvHW - 0.3))));
  mk *= smoothstep(0.25, 0.55, pvNoise(vPvW.xz * 6.0) * 0.6 + pvNoise(vPvW.xz * 30.0) * 0.4 + 0.25 - lane * 0.4) * (1.0 - joint * 0.6) * (1.0 - dm);
  col = mix(col, vec3(0.78, 0.77, 0.72), mk); rough = mix(rough, 0.6, mk);
}
float film = 0.0;
if (uPvMap.z > 0.5) { // tyre / boot films from the terrain trail field
  vec2 tr = texture(tPvTrail, vPvW.xz / uPvMap.xy).rg;
  film = smoothstep(0.004, 0.05, tr.r + tr.g * 0.5) * uPvWeather.w;
  col = mix(col, uPvFilm, film * 0.65); rough = mix(rough, 0.5, film * 0.6);
}
float snow = uPvWeather.x;
if (snow > 0.0) { // packed into joints, drifted at the edges, cleared to wet slush in the wheel lanes
  float sn = snow * (0.55 + 0.6 * pvFbm(vPvW.xz * 0.35)) + joint * 0.45 * snow + (1.0 - smoothstep(0.0, 1.2, pvEdge)) * 0.4 * snow;
  sn -= (lane * 1.3 + oil * 0.3) * snow * pvRoad + film * 0.8 + dm * 0.8;
  sn = smoothstep(0.35, 0.75, sn - (hgt - 0.5) * 0.3);
  col = mix(col, vec3(0.78, 0.8, 0.84) * (0.92 + 0.1 * pvNoise(vPvW.xz * 5.0)), sn);
  rough = mix(rough, 0.72, sn); n = mix(n, vec3(0.0, 0.0, 1.0), sn * 0.85);
  float sl = lane * snow * (1.0 - sn) * pvRoad;
  col *= 1.0 - 0.3 * sl; rough = mix(rough, 0.2, sl * 0.7);
  hgt = mix(hgt, 1.0, sn);
}
float pud = 0.0;
if (uPvWeather.z > 0.0) { // puddles fill the joints first, then drown whole stones
  float lvl = (pvFbm(vPvW.xz * 0.21 + 3.3) - (1.0 - uPvWeather.z * 0.55)) * 1.6 + (lane * 0.15 + pvGut * 0.25) * pvRoad;
  pud = smoothstep(0.0, 0.06, lvl - hgt * 0.5) * (1.0 - 0.5 * pvPatch);
}
float wet = max(max(uPvWeather.y, pud), pvGut * 0.5 * uPvWeather.z);
col *= mix(1.0, 0.6, wet); rough = mix(rough, rough * 0.4, wet);
col = mix(col, uPvDirt, pvGut * 0.2);
if (pud > 0.0) { rough = mix(rough, snow > 0.3 ? 0.1 : 0.03, pud); n = mix(n, vec3(0.0, 0.0, 1.0), pud); col *= 1.0 - 0.3 * pud; }
diffuseColor.rgb = col;
pvRough = clamp(rough, 0.03, 1.0);
pvAO = mix(1.0, pvA.r, 0.9) * (1.0 - joint * 0.25);
pvNts = normalize(n);
`;

/** Patch a MeshStandardMaterial into a pavement material (uniforms object shared per surface). */
export function injectPavement(mat, uniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + PAVE_VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + PAVE_VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + PAVE_FRAG_PARS)
      .replace('#include <map_fragment>', PAVE_FRAG_MAIN + PAVE_FRAG_MAIN2)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = pvRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = pvMetal;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize(pvT * pvNts.x + pvB * pvNts.y + normal * pvNts.z);')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= pvAO;\nreflectedLight.indirectSpecular *= mix(1.0, pvAO, 0.6);');
  };
  mat.customProgramCacheKey = () => 'pavement2';
  return mat;
}
