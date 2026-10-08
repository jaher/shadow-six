/**
 * Shared GLSL for anti-tiling (texture repetition) — used by the pavement shader (art/pavement/pavement-glsl.js) and
 * the generic material patch (art/anti-tiling.js). The splat terrain keeps its own copy (art/terrain/terrain-glsl.js).
 *
 *  - Hex tiling in texture UV, after Mikkelsen, "Practical Real-Time Hex-Tiling" (JCGT 2022): three samples per map on
 *    a triangle grid, each with its own random offset and (optionally) rotation, blended with luminance-weighted,
 *    contrast-preserving weights. Cell size: `cells` grid steps per texture repeat (2√3 → vertices 0.29 repeat apart).
 *  - Hash-based value noise and fbm that never repeat (no periodic noise texture): macro variation, stains, grime.
 * @module art/anti-tiling-glsl
 */

export const AT_COMMON = /* glsl */ `
float atHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
vec2 atHash2(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
vec4 atHash4(vec2 p) {
  vec4 q = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}
// value noise (hash lattice, no repetition) and a 3-octave fbm, both in 0..1
float atNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(atHash(i), atHash(i + vec2(1.0, 0.0)), u.x), mix(atHash(i + vec2(0.0, 1.0)), atHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float atFbm(vec2 p) { return atNoise(p) * 0.5 + atNoise(p * 2.03 + 7.1) * 0.3 + atNoise(p * 4.1 + 3.7) * 0.2; }
float atLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// ---- hex tiling --------------------------------------------------------------------------------------
struct AtHex { vec3 w; vec2 c1, c2, c3, o1, o2, o3; mat2 r1, r2, r3; };
void atTriGrid(vec2 st, out vec3 w, out vec2 v1, out vec2 v2, out vec2 v3) {
  vec2 sk = mat2(1.0, 0.0, -0.57735027, 1.15470054) * st;
  vec2 base = floor(sk);
  vec3 t = vec3(fract(sk), 0.0);
  t.z = 1.0 - t.x - t.y;
  float s = step(0.0, -t.z), s2 = 2.0 * s - 1.0;
  w = vec3(-t.z * s2, s - t.y * s2, s - t.x * s2);
  v1 = base + vec2(s, s); v2 = base + vec2(s, 1.0 - s); v3 = base + vec2(1.0 - s, s);
}
mat2 atRot(float h, float amount) { float a = (h - 0.5) * 6.2831853 * amount, c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
/** Hex cells over texture UV: \`cells\` grid steps per repeat, \`rot\` 0 (offsets only) .. 1 (any rotation), \`seed\` decorrelates maps. */
AtHex atHex(vec2 uv, float cells, float rot, float seed) {
  AtHex h; vec2 v1, v2, v3;
  atTriGrid(uv * cells, h.w, v1, v2, v3);
  mat2 ik = mat2(1.0, 0.0, 0.5, 0.8660254);              // inverse skew: vertex → grid space
  h.c1 = ik * v1 / cells; h.c2 = ik * v2 / cells; h.c3 = ik * v3 / cells;
  vec4 a = atHash4(v1 + seed * 17.3), b = atHash4(v2 + seed * 17.3), c = atHash4(v3 + seed * 17.3);
  h.o1 = a.xy; h.o2 = b.xy; h.o3 = c.xy;
  h.r1 = atRot(a.z, rot); h.r2 = atRot(b.z, rot); h.r3 = atRot(c.z, rot);
  return h;
}
vec2 atUV1(AtHex h, vec2 uv) { return h.r1 * (uv - h.c1) + h.c1 + h.o1; }
vec2 atUV2(AtHex h, vec2 uv) { return h.r2 * (uv - h.c2) + h.c2 + h.o2; }
vec2 atUV3(AtHex h, vec2 uv) { return h.r3 * (uv - h.c3) + h.c3 + h.o3; }
/** Albedo-luminance-weighted, sharpened blend weights (contrast preserving: no washed-out averages). */
vec3 atHexW(AtHex h, vec3 a1, vec3 a2, vec3 a3) {
  vec3 lw = vec3(atLum(a1), atLum(a2), atLum(a3));
  lw /= dot(lw, vec3(1.0 / 3.0)) + 1e-4;
  vec3 W = pow(max(h.w * mix(vec3(1.0), lw, 0.55), 1e-4), vec3(5.0));
  return W / dot(W, vec3(1.0));
}
vec4 atTex3(sampler2D t, AtHex h, vec3 W, vec2 uv, vec2 dx, vec2 dy) {
  return W.x * textureGrad(t, atUV1(h, uv), h.r1 * dx, h.r1 * dy) + W.y * textureGrad(t, atUV2(h, uv), h.r2 * dx, h.r2 * dy)
       + W.z * textureGrad(t, atUV3(h, uv), h.r3 * dx, h.r3 * dy);
}
/** Tangent-space normal map (0..1 encoded) through the hex tiler, each tap's xy rotated back. */
vec3 atNor3(sampler2D t, AtHex h, vec3 W, vec2 uv, vec2 dx, vec2 dy) {
  vec3 n1 = textureGrad(t, atUV1(h, uv), h.r1 * dx, h.r1 * dy).xyz * 2.0 - 1.0;
  vec3 n2 = textureGrad(t, atUV2(h, uv), h.r2 * dx, h.r2 * dy).xyz * 2.0 - 1.0;
  vec3 n3 = textureGrad(t, atUV3(h, uv), h.r3 * dx, h.r3 * dy).xyz * 2.0 - 1.0;
  n1.xy = transpose(h.r1) * n1.xy; n2.xy = transpose(h.r2) * n2.xy; n3.xy = transpose(h.r3) * n3.xy;
  return W.x * n1 + W.y * n2 + W.z * n3;
}
`;
