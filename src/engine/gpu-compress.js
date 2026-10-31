/**
 * GPU texture compression at load time: material maps go to the GPU as BC7 (desktop: EXT_texture_compression_bptc)
 * or ASTC 4×4 (phones, iPads, Apple silicon: WEBGL_compressed_texture_astc) — 1 byte per texel instead of 4, the
 * same images, the same mip chains, no change to what is downloaded.
 *
 * How: three uploads the decoded image exactly as it always did (same pixel-store flags, same internal format, same
 * `generateMipmap`) into a temporary texture; a fragment shader then encodes every 4×4 block of every mip level
 * (one fragment = one block, written as 128 bits to an RGBA32UI target), `readPixels` copies the blocks into a pixel
 * buffer, and once a fence says the GPU is done they come back as the mip levels of a THREE.CompressedTexture (or
 * CompressedArrayTexture for layer arrays). The temporary texture is gone by then, so a map never sits on the GPU
 * uncompressed after its load — and the compressed levels leave page memory after their upload (engine/texture-memory.js
 * COMPRESSED_HOOKS; an upload without them — another sampler, a restored context — encodes them again).
 *
 * Encoders (per block; error measured in the texture's own 8-bit values — sRGB maps in sRGB, as the hardware decodes
 * them; each candidate's least-squares endpoints refitted on its chosen indices with the exact integer interpolation;
 * the smallest error wins per block):
 *  - BC7: mode 6 (one RGBA line, 7-bit endpoints + p-bits, 16 steps; opaque blocks keep alpha exactly 255), mode 5 with
 *    each rotation (colour line + one channel on its own line: normal maps, packed data, cut-out alpha) and, for opaque
 *    blocks the single lines fit poorly, mode 1 (two subsets, best of the 64 shapes by line residual).
 *  - ASTC 4×4: opaque CEM 8 on one plane (16 weight levels, QUANT_192 endpoints) or two planes (one channel on its own,
 *    QUANT_4 / QUANT_160); alpha CEM 12 on one plane (QUANT_8 / QUANT_192) or with alpha on a second plane (QUANT_4 /
 *    QUANT_48); for opaque blocks the single lines fit poorly, two planes on reduced weight grids (3×4 / 4×3 QUANT_8 with
 *    QUANT_64 endpoints, 3×4 QUANT_10 / QUANT_24, 4×4 QUANT_5 / QUANT_48 — astc-encoder's usual picks on normal maps)
 *    and two partitions (the seed whose pattern is nearest the block's two clusters, QUANT_5 / QUANT_32). Endpoints are
 *    ordered so the decoder never blue-contracts.
 *  The costly modes (mode 1; ASTC grids and partitions) and the full candidate search belong to the higher of three
 *  tiers (TIER_COST): the compressor times the fast one on the device and keeps the encode within a GPU-time budget —
 *  or leaves textures uncompressed where even that would slow loading down (software renderers, weak GPUs).
 * Measured (tools/perf/gpu-compress-quality.mjs, RGB PSNR vs the uncompressed upload, full tier): BC7 albedo 45–55 dB,
 * ORM 42–53, normal maps 36–41 (= bc7enc's modes 1/5/6/7 at its highest level; UASTC λ0 scores 36 on the same normal
 * map); ASTC albedo the same, normal maps / ORM 0.3–1.3 dB below BC7 (astc-encoder -medium: 0.6 below).
 * Per-channel error weights: alpha ×2 by default; `texture.userData.compressWeights = [r, g, b, a]` for packed maps
 * (e.g. a coverage mask in blue that an alpha test reads); `texture.userData.noCompress` keeps a map as it is (exact
 * ids in a channel, maps a shader thresholds sharply — water foam / detail normals).
 * Which textures: `compressible(tex)` — 8-bit RGBA images whose sides are multiples of 4, linear filtering (NEAREST
 * maps such as the pavement stone IDs are pixel-exact data and stay as they are), not render targets / data /
 * canvas / video textures. Callers opt in at the loaders (GLTF images, library / dressing maps, terrain and
 * vegetation layer arrays). No extension (or a lost context, or any error) → the texture stays uncompressed.
 * @module engine/gpu-compress
 */

import * as THREE from 'three';
import { due, nextTask, stepFor, SLICED } from './slice.js';

/** @typedef {'bc7'|'astc'} CodecName */

const VERT = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

/** Shared prelude: fetch the 16 texels of this fragment's block as 0..255 values in the texture's own encoding. */
const PRELUDE = (array, tier = 1) => `#version 300 es
#define TIER ${tier}
precision highp float;
precision highp int;
precision highp usampler2D;
${array ? 'uniform highp sampler2DArray uSrc;' : 'uniform highp sampler2D uSrc;'}
uniform int uLevel;
uniform int uLayer;
uniform ivec2 uSize;
uniform bool uSrgb;
uniform vec4 uW; // per-channel error weights (a coverage / alpha channel that an alpha test reads counts more)
uniform int uN; // = 16: the loop bounds below come from it so the compilers keep the loops (unrolled, the shader takes
                // seconds to compile and spills registers)
#define N16 uN
#define N8 (uN >> 1)
#define N4 (uN >> 2)
#define N3 ((uN >> 2) - 1)
#define N64 (uN << 2)
out uvec4 oBlock;
vec4 W;
float wd2(vec4 d) { return dot(d * d, W); }
float wd2(vec3 d) { return dot(d * d, W.rgb); }

float toSrgb(float c) { c = clamp(c, 0.0, 1.0); return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
vec4 fetchPx(ivec2 p) {
  p = min(p, uSize - 1);
  vec4 c = texelFetch(uSrc, ${array ? 'ivec3(p, uLayer)' : 'p'}, uLevel);
  if (uSrgb) c.rgb = vec3(toSrgb(c.r), toSrgb(c.g), toSrgb(c.b));
  return floor(c * 255.0 + 0.5);
}
void orWord(inout uvec4 b, int wi, uint v) { if (wi == 0) b.x |= v; else if (wi == 1) b.y |= v; else if (wi == 2) b.z |= v; else b.w |= v; }
/** Append the low n bits of v at bit position pos (LSB first, little-endian words). */
void put(inout uvec4 b, inout int pos, uint v, int n) {
  int wi = pos >> 5, sh = pos & 31;
  orWord(b, wi, v << uint(sh));
  if (sh + n > 32) orWord(b, wi + 1, v >> uint(32 - sh));
  pos += n;
}
vec4 px[16];
bool opaque;
/** Refinement passes: the fast tier (slow GPUs) keeps two. */
int ITERS() { return TIER == 0 ? 2 : N4; }
/** Candidate steps to test for a texel: all of them, or (fast tier) the projected step ± 1 — its line position t
 * (0..1 between the endpoints) times the step count. */
ivec2 krange(float t, int n) {
  if (TIER > 0) return ivec2(0, n - 1);
  int k = int(clamp(floor(t * float(n - 1) + 0.5), 0.0, float(n - 1)));
  return ivec2(max(k - 1, 0), min(k + 1, n - 1));
}
float lineT(vec4 p, vec4 c0, vec4 c1) { vec4 d = (c1 - c0) * W; float dd = dot(d, c1 - c0); return dd > 0.0 ? dot(p - c0, d) / dd : 0.0; }
/** Blocks whose single-line fit leaves more than ~1.5 levels RMS per channel try two subsets / partitions. */
const float MODE1_ERR = 16.0 * 3.0 * 2.25;
/** Line through the subset's texels: residual (total variance minus the principal one), mean, axis, extent. */
float subsetLine(int mask, int sel, out vec3 mean, out vec3 axis, out vec2 ext) {
  float n = 0.0; vec3 sum = vec3(0.0);
  for (int i = 0; i < N16; i++) if (((mask >> i) & 1) == sel) { n += 1.0; sum += px[i].rgb; }
  mean = sum / max(n, 1.0);
  mat3 cov = mat3(0.0);
  for (int i = 0; i < N16; i++) if (((mask >> i) & 1) == sel) { vec3 d = px[i].rgb - mean; cov += outerProduct(d, d); }
  float tr = cov[0][0] + cov[1][1] + cov[2][2];
  vec3 v = vec3(cov[0][0], cov[1][1], cov[2][2]) + vec3(1e-3, 2e-3, 3e-3);
  for (int k = 0; k < 6; k++) { v = cov * v; float l = max(max(abs(v.x), abs(v.y)), abs(v.z)); if (l > 0.0) v /= l; }
  float vv = dot(v, v);
  axis = vv > 1e-12 ? v * inversesqrt(vv) : vec3(0.57735);
  ext = vec2(1e9, -1e9);
  for (int i = 0; i < N16; i++) if (((mask >> i) & 1) == sel) { float t = dot(px[i].rgb - mean, axis); ext.x = min(ext.x, t); ext.y = max(ext.y, t); }
  return tr - dot(axis, cov * axis);
}
/** The colour channel the block's principal line explains least (its own weight plane helps most). */
int residualChannel(vec4 e0, vec4 e1) {
  vec3 mean = vec3(0.0);
  for (int i = 0; i < N16; i++) mean += px[i].rgb;
  mean *= 1.0 / 16.0;
  vec3 ax = e1.rgb - e0.rgb; float l = dot(ax, ax);
  ax = l > 1e-6 ? ax * inversesqrt(l) : vec3(0.0);
  vec3 r = vec3(0.0);
  for (int i = 0; i < N16; i++) { vec3 d = px[i].rgb - mean; vec3 o = d - ax * dot(d, ax); r += o * o * W.rgb; }
  return r.x >= r.y && r.x >= r.z ? 0 : (r.y >= r.z ? 1 : 2);
}
/** Principal axis of the block's colours (alpha too unless opaque) and the block's extent along it. */
void lineFit(out vec4 e0, out vec4 e1) {
  vec4 mn = vec4(255.0), mx = vec4(0.0), mean = vec4(0.0);
  for (int i = 0; i < N16; i++) { mn = min(mn, px[i]); mx = max(mx, px[i]); mean += px[i]; }
  mean *= 1.0 / 16.0;
  mat4 cov = mat4(0.0);
  for (int i = 0; i < N16; i++) { vec4 d = px[i] - mean; if (opaque) d.a = 0.0; cov += outerProduct(d, d); }
  vec4 axis = mx - mn;
  if (opaque) axis.a = 0.0;
  for (int k = 0; k < N8; k++) {
    axis = cov * axis;
    float l = max(max(abs(axis.r), abs(axis.g)), max(abs(axis.b), abs(axis.a)));
    if (l > 0.0) axis /= l;
  }
  if (dot(axis, axis) < 1e-12) { e0 = mean; e1 = mean; return; }
  axis = normalize(axis);
  float t0 = 1e9, t1 = -1e9;
  for (int i = 0; i < N16; i++) { float t = dot(px[i] - mean, axis); t0 = min(t0, t); t1 = max(t1, t); }
  e0 = clamp(mean + axis * t0, 0.0, 255.0);
  e1 = clamp(mean + axis * t1, 0.0, 255.0);
}
`;

/** BC7 encoder: mode 6 (one RGBA line, 16 steps), mode 5 (colour line + one channel on its own line, each rotation)
 * and, for opaque blocks, mode 1 (two subsets of the 64 shapes); the smallest (weighted) error wins per block. */
const BC7_FRAG = (array, tier) => PRELUDE(array, tier) + `
const int W4[16] = int[16](0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64);
const int W2[4] = int[4](0, 21, 43, 64);
ivec4 quantEp(vec4 e, out int p) {
  if (opaque) { p = 1; ivec4 q = ivec4(clamp(floor((e - 1.0) * 0.5 + 0.5), 0.0, 127.0)); q.a = 127; return q; }
  ivec4 q0 = ivec4(clamp(floor(e * 0.5 + 0.5), 0.0, 127.0));
  ivec4 q1 = ivec4(clamp(floor((e - 1.0) * 0.5 + 0.5), 0.0, 127.0));
  vec4 d0 = vec4(q0 * 2) - e, d1 = vec4(q1 * 2 + 1) - e;
  if (dot(d0, d0) <= dot(d1, d1)) { p = 0; return q0; }
  p = 1; return q1;
}
float mode6(vec4 e0, vec4 e1, out uvec4 b) {
  ivec4 bq0 = ivec4(0), bq1 = ivec4(0); int bp0 = 0, bp1 = 0; int bidx[16]; float best = 1e30;
  for (int it = 0; it < ITERS(); it++) {
    int p0, p1;
    ivec4 q0 = quantEp(e0, p0), q1 = quantEp(e1, p1);
    ivec4 c0 = q0 * 2 + p0, c1 = q1 * 2 + p1;
    ivec4 pal[16];
    for (int k = 0; k < N16; k++) pal[k] = (c0 * (64 - W4[k]) + c1 * W4[k] + 32) >> 6;
    int idx[16]; float err = 0.0;
    float sa = 0.0, sb = 0.0, sc = 0.0; vec4 sx = vec4(0.0), sy = vec4(0.0);
    for (int i = 0; i < N16; i++) {
      float bd = 1e30; int bk = 0;
      ivec2 kr = krange(lineT(px[i], vec4(c0), vec4(c1)), 16);
      for (int k = kr.x; k <= kr.y; k++) { float dd = wd2(vec4(pal[k]) - px[i]); if (dd < bd) { bd = dd; bk = k; } }
      idx[i] = bk; err += bd;
      float w = float(W4[bk]) / 64.0, u = 1.0 - w;
      sa += u * u; sb += u * w; sc += w * w; sx += u * px[i]; sy += w * px[i];
    }
    if (err < best) { best = err; bq0 = q0; bq1 = q1; bp0 = p0; bp1 = p1; for (int i = 0; i < N16; i++) bidx[i] = idx[i]; }
    if (err == 0.0) break;
    float det = sa * sc - sb * sb;
    if (abs(det) < 1e-6) break;
    e0 = clamp((sc * sx - sb * sy) / det, 0.0, 255.0);
    e1 = clamp((sa * sy - sb * sx) / det, 0.0, 255.0);
  }
  // anchor (texel 0) index must have its top bit clear: swap the endpoints and invert the indices
  if (bidx[0] >= 8) {
    ivec4 t = bq0; bq0 = bq1; bq1 = t; int tp = bp0; bp0 = bp1; bp1 = tp;
    for (int i = 0; i < N16; i++) bidx[i] = 15 - bidx[i];
  }
  b = uvec4(0u); int pos = 0;
  put(b, pos, 64u, 7);
  for (int c = 0; c < 4; c++) { put(b, pos, uint(bq0[c]), 7); put(b, pos, uint(bq1[c]), 7); }
  put(b, pos, uint(bp0), 1); put(b, pos, uint(bp1), 1);
  put(b, pos, uint(bidx[0]), 3);
  for (int i = 1; i < N16; i++) put(b, pos, uint(bidx[i]), 4);
  return best;
}
/** 7-bit colour endpoint whose 8-bit expansion (q << 1 | q >> 6) is nearest to v. */
int q7(float v) {
  int q = int(clamp(floor(v * 127.0 / 255.0 + 0.5), 0.0, 127.0));
  float best = 1e9; int bq = q;
  for (int d = -1; d <= 1; d++) { int c = clamp(q + d, 0, 127); float e = abs(float((c << 1) | (c >> 6)) - v); if (e < best) { best = e; bq = c; } }
  return bq;
}
float mode5(vec4 e0, vec4 e1, int rot, out uvec4 b) {
  // colour (RGB, 7-bit endpoints, 2-bit indices)
  ivec3 bc0 = ivec3(0), bc1 = ivec3(0); int cidx[16]; float bestC = 1e30;
  for (int it = 0; it < ITERS(); it++) {
    ivec3 q0 = ivec3(q7(e0.r), q7(e0.g), q7(e0.b)), q1 = ivec3(q7(e1.r), q7(e1.g), q7(e1.b));
    ivec3 c0 = (q0 << 1) | (q0 >> 6), c1 = (q1 << 1) | (q1 >> 6);
    int idx[16]; float err = 0.0;
    float sa = 0.0, sb = 0.0, sc = 0.0; vec3 sx = vec3(0.0), sy = vec3(0.0);
    for (int i = 0; i < N16; i++) {
      float bd = 1e30; int bk = 0;
      for (int k = 0; k < N4; k++) { float dd = wd2(vec3((c0 * (64 - W2[k]) + c1 * W2[k] + 32) >> 6) - px[i].rgb); if (dd < bd) { bd = dd; bk = k; } }
      idx[i] = bk; err += bd;
      float w = float(W2[bk]) / 64.0, u = 1.0 - w;
      sa += u * u; sb += u * w; sc += w * w; sx += u * px[i].rgb; sy += w * px[i].rgb;
    }
    if (err < bestC) { bestC = err; bc0 = q0; bc1 = q1; for (int i = 0; i < N16; i++) cidx[i] = idx[i]; }
    if (err == 0.0) break;
    float det = sa * sc - sb * sb;
    if (abs(det) < 1e-6) break;
    e0.rgb = clamp((sc * sx - sb * sy) / det, 0.0, 255.0);
    e1.rgb = clamp((sa * sy - sb * sx) / det, 0.0, 255.0);
  }
  // alpha (8-bit endpoints, 2-bit indices)
  float amn = 255.0, amx = 0.0;
  for (int i = 0; i < N16; i++) { amn = min(amn, px[i].a); amx = max(amx, px[i].a); }
  float a0 = amn, a1 = amx; int ba0 = 0, ba1 = 0; int aidx[16]; float bestA = 1e30;
  for (int it = 0; it < N3; it++) {
    int q0 = int(clamp(floor(a0 + 0.5), 0.0, 255.0)), q1 = int(clamp(floor(a1 + 0.5), 0.0, 255.0));
    int idx[16]; float err = 0.0;
    float sa = 0.0, sb = 0.0, sc = 0.0, sx = 0.0, sy = 0.0;
    for (int i = 0; i < N16; i++) {
      float bd = 1e30; int bk = 0;
      for (int k = 0; k < N4; k++) { float d = float((q0 * (64 - W2[k]) + q1 * W2[k] + 32) >> 6) - px[i].a; if (d * d * W.a < bd) { bd = d * d * W.a; bk = k; } }
      idx[i] = bk; err += bd;
      float w = float(W2[bk]) / 64.0, u = 1.0 - w;
      sa += u * u; sb += u * w; sc += w * w; sx += u * px[i].a; sy += w * px[i].a;
    }
    if (err < bestA) { bestA = err; ba0 = q0; ba1 = q1; for (int i = 0; i < N16; i++) aidx[i] = idx[i]; }
    if (err == 0.0) break;
    float det = sa * sc - sb * sb;
    if (abs(det) < 1e-6) break;
    a0 = clamp((sc * sx - sb * sy) / det, 0.0, 255.0);
    a1 = clamp((sa * sy - sb * sx) / det, 0.0, 255.0);
  }
  if (cidx[0] >= 2) { ivec3 t = bc0; bc0 = bc1; bc1 = t; for (int i = 0; i < N16; i++) cidx[i] = 3 - cidx[i]; }
  if (aidx[0] >= 2) { int t = ba0; ba0 = ba1; ba1 = t; for (int i = 0; i < N16; i++) aidx[i] = 3 - aidx[i]; }
  b = uvec4(0u); int pos = 0;
  put(b, pos, 32u, 6);
  put(b, pos, uint(rot), 2); // rotation: which channel the scalar line holds (0 = alpha, 1 = R, 2 = G, 3 = B)
  for (int c = 0; c < 3; c++) { put(b, pos, uint(bc0[c]), 7); put(b, pos, uint(bc1[c]), 7); }
  put(b, pos, uint(ba0), 8); put(b, pos, uint(ba1), 8);
  put(b, pos, uint(cidx[0]), 1);
  for (int i = 1; i < N16; i++) put(b, pos, uint(cidx[i]), 2);
  put(b, pos, uint(aidx[0]), 1);
  for (int i = 1; i < N16; i++) put(b, pos, uint(aidx[i]), 2);
  return bestC + bestA;
}

#if TIER == 2
// mode 1: two subsets (one of 64 shapes), RGB endpoints 6 bits + a p-bit shared per subset, 8 steps. Blocks that hold
// two surfaces (stone and mortar, a crease in a normal map) fit two lines far better than one.
const int P2[64] = int[64](52428, 34952, 61166, 60616, 51328, 65260, 65224, 60544, 51200, 65516, 65152, 59392, 65512, 65280, 65520, 61440, 63248, 142, 28928, 2254, 140, 29456, 12544, 36046, 2188, 12560, 26214, 13932, 6120, 4080, 29070, 14748, 43690, 61680, 23130, 13260, 15420, 21930, 38550, 42330, 29646, 5064, 12876, 15324, 27030, 49980, 39270, 1632, 626, 1252, 20032, 10016, 51510, 37740, 14790, 25500, 37686, 40134, 33150, 59160, 52464, 4044, 30532, 60962);
const int A2[64] = int[64](15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2, 15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6, 6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15);
const int W3[8] = int[8](0, 9, 18, 27, 37, 46, 55, 64);
/** 6-bit endpoint + p-bit → 8-bit value. */
ivec3 ep61(ivec3 q, int p) { ivec3 c = (q << 1) | p; return (c << 1) | (c >> 6); }
ivec3 q61(vec3 e, int p) {
  ivec3 q = ivec3(clamp(floor((e * 127.0 / 255.0 - float(p)) * 0.5 + 0.5), 0.0, 63.0));
  ivec3 best = q;
  for (int c = 0; c < 3; c++) {
    float be = 1e9;
    for (int d = -1; d <= 1; d++) { int t = clamp(q[c] + d, 0, 63); int c7 = (t << 1) | p; float err = abs(float((c7 << 1) | (c7 >> 6)) - e[c]); if (err < be) { be = err; best[c] = t; } }
  }
  return best;
}
/** Variance left off the principal axis of a scatter (n points, sum s, sum of outer products q); g: start axis. */
float offAxis(float n, vec3 s, mat3 q, vec3 g) {
  if (n < 1.5) return 0.0;
  mat3 c = q - outerProduct(s, s) / n;
  vec3 v = c * (c * g);
  float vv = dot(v, v);
  if (vv < 1e-12) return c[0][0] + c[1][1] + c[2][2];
  return c[0][0] + c[1][1] + c[2][2] - dot(v, c * v) / vv;
}
/** The shape whose two subsets lie closest to a line each (subset 1 = the block's totals minus subset 0). */
int bestShape() {
  vec3 tS = vec3(0.0); mat3 tQ = mat3(0.0);
  for (int i = 0; i < N16; i++) { tS += px[i].rgb; tQ += outerProduct(px[i].rgb, px[i].rgb); }
  mat3 tc = tQ - outerProduct(tS, tS) / 16.0;
  vec3 g = vec3(tc[0][0], tc[1][1], tc[2][2]) + vec3(1e-3, 2e-3, 3e-3);
  g = tc * (tc * g); g /= max(max(abs(g.x), abs(g.y)), max(abs(g.z), 1e-9));
  float best = 1e30; int part = 0;
  for (int p = 0; p < N64; p++) {
    int mask = P2[p];
    float n1 = 0.0; vec3 s1 = vec3(0.0); mat3 q1 = mat3(0.0);
    for (int i = 0; i < N16; i++) if (((mask >> i) & 1) == 1) { n1 += 1.0; s1 += px[i].rgb; q1 += outerProduct(px[i].rgb, px[i].rgb); }
    float e = offAxis(n1, s1, q1, g) + offAxis(16.0 - n1, tS - s1, tQ - q1, g);
    if (e < best) { best = e; part = p; }
  }
  return part;
}
float mode1(out uvec4 b) {
  int part = bestShape();
  vec3 m, ax; vec2 ex;
  int mask = P2[part];
  int idx[16]; ivec3 bq[4]; int bp[2]; float total = 0.0;
  for (int s = 0; s < 2; s++) {
    subsetLine(mask, s, m, ax, ex);
    vec3 e0 = clamp(m + ax * ex.x, 0.0, 255.0), e1 = clamp(m + ax * ex.y, 0.0, 255.0);
    float best = 1e30; ivec3 b0 = ivec3(0), b1 = ivec3(0); int bpp = 0; int bi[16];
    for (int it = 0; it < ITERS(); it++) {
      // shared p-bit: the one whose two quantized endpoints land nearer
      ivec3 qa0 = q61(e0, 0), qa1 = q61(e1, 0), qb0 = q61(e0, 1), qb1 = q61(e1, 1);
      float ea = wd2(vec3(ep61(qa0, 0)) - e0) + wd2(vec3(ep61(qa1, 0)) - e1);
      float eb = wd2(vec3(ep61(qb0, 1)) - e0) + wd2(vec3(ep61(qb1, 1)) - e1);
      int pp = ea <= eb ? 0 : 1;
      ivec3 q0 = pp == 0 ? qa0 : qb0, q1 = pp == 0 ? qa1 : qb1;
      ivec3 c0 = ep61(q0, pp), c1 = ep61(q1, pp);
      float err = 0.0, sa = 0.0, sb = 0.0, sc = 0.0; vec3 sx = vec3(0.0), sy = vec3(0.0);
      int cur[16];
      for (int i = 0; i < N16; i++) {
        cur[i] = 0;
        if (((mask >> i) & 1) != s) continue;
        float bd = 1e30; int bk = 0;
        for (int k = 0; k < N8; k++) { float dd = wd2(vec3((c0 * (64 - W3[k]) + c1 * W3[k] + 32) >> 6) - px[i].rgb); if (dd < bd) { bd = dd; bk = k; } }
        cur[i] = bk; err += bd;
        float w = float(W3[bk]) / 64.0, u = 1.0 - w;
        sa += u * u; sb += u * w; sc += w * w; sx += u * px[i].rgb; sy += w * px[i].rgb;
      }
      if (err < best) { best = err; b0 = q0; b1 = q1; bpp = pp; for (int i = 0; i < N16; i++) bi[i] = cur[i]; }
      if (err == 0.0) break;
      float det = sa * sc - sb * sb;
      if (abs(det) < 1e-6) break;
      e0 = clamp((sc * sx - sb * sy) / det, 0.0, 255.0);
      e1 = clamp((sa * sy - sb * sx) / det, 0.0, 255.0);
    }
    // the subset's anchor texel (0, or the shape's second anchor) needs its index's top bit clear
    int anchor = s == 0 ? 0 : A2[part];
    if (bi[anchor] >= 4) { ivec3 t = b0; b0 = b1; b1 = t; for (int i = 0; i < N16; i++) if (((mask >> i) & 1) == s) bi[i] = 7 - bi[i]; }
    for (int i = 0; i < N16; i++) if (((mask >> i) & 1) == s) idx[i] = bi[i];
    bq[s * 2] = b0; bq[s * 2 + 1] = b1; bp[s] = bpp;
    total += best;
  }
  b = uvec4(0u); int pos = 0;
  put(b, pos, 2u, 2);
  put(b, pos, uint(part), 6);
  for (int c = 0; c < 3; c++) for (int e = 0; e < 4; e++) put(b, pos, uint(bq[e][c]), 6);
  put(b, pos, uint(bp[0]), 1); put(b, pos, uint(bp[1]), 1);
  int a2 = A2[part];
  for (int i = 0; i < N16; i++) put(b, pos, uint(idx[i]), (i == 0 || i == a2) ? 2 : 3);
  return total;
}
#endif
/** Swap channel c (0..2) with alpha in every texel (mode 5 rotations; applying it twice restores the block). */
void rotate(int c) {
  float wa = W.a;
  if (c == 0) { W.a = W.r; W.r = wa; } else if (c == 1) { W.a = W.g; W.g = wa; } else { W.a = W.b; W.b = wa; }
  for (int i = 0; i < N16; i++) {
    float a = px[i].a;
    if (c == 0) { px[i].a = px[i].r; px[i].r = a; } else if (c == 1) { px[i].a = px[i].g; px[i].g = a; } else { px[i].a = px[i].b; px[i].b = a; }
  }
}
void main() {
  ivec2 blk = ivec2(gl_FragCoord.xy);
  W = uW;
  float amin = 255.0;
  for (int i = 0; i < N16; i++) { px[i] = fetchPx(blk * 4 + ivec2(i & 3, i >> 2)); amin = min(amin, px[i].a); }
  bool solid = amin >= 255.0;
  opaque = solid;
  vec4 e0, e1;
  lineFit(e0, e1);
  uvec4 best;
  float err = mode6(e0, e1, best);
  // mode 5: colour on one line, one channel on its own (alpha, or R / G / B rotated into the alpha slot): channels
  // that vary independently (normal maps, packed data, cut-out alpha) fit it better than one RGBA line
  int cOnly = TIER == 0 ? residualChannel(e0, e1) : -1; // fast tier: only the channel the line leaves the most off it
  for (int rot = 0; rot < N4; rot++) {
    if (err == 0.0) break;
    if (cOnly >= 0 && rot > 0 && rot != cOnly + 1) continue;
    if (rot == 0 && solid) continue; // constant alpha: nothing to separate
    if (rot > 0) rotate(rot - 1);
    opaque = true; // RGB-only principal axis for the colour line
    vec4 f0, f1;
    lineFit(f0, f1);
    opaque = false;
    uvec4 b5;
    float e5 = mode5(f0, f1, rot, b5);
    if (rot > 0) rotate(rot - 1);
    if (e5 < err) { err = e5; best = b5; }
  }
  // opaque blocks the single lines fit poorly (more than ~1.5 levels RMS per channel): two subsets
#if TIER == 2
  if (solid && err > MODE1_ERR) {
    uvec4 b1;
    float e1 = mode1(b1);
    if (e1 < err) { err = e1; best = b1; }
  }
#endif
  oBlock = best;
}`;

/** ASTC 4×4. Opaque blocks: CEM 8 (RGB direct), 16 weight levels, QUANT_192 endpoints, or two weight planes (one
 * channel on its own: normal maps, packed data; QUANT_4 + QUANT_160); full tier: + reduced-grid dual planes and two
 * partitions for the blocks those fit poorly. Blocks with alpha try CEM 12 (RGBA direct) on one weight plane (8 levels,
 * QUANT_192) and on two planes (alpha on its own plane, 4 levels each, QUANT_48 endpoints — cut-out edges) and keep
 * the smaller error. uTab: the rows of astcTables(). */
const ASTC_FRAG = (array, tier) => PRELUDE(array, tier) + `
uniform highp usampler2D uTab;
const int W16[16] = int[16](0, 4, 8, 12, 17, 21, 25, 29, 35, 39, 43, 47, 52, 56, 60, 64);
const int W8[8] = int[8](0, 9, 18, 27, 37, 46, 55, 64);
const int WQ4[4] = int[4](0, 21, 43, 64);
int nW;
int wOf(int k) { return nW == 16 ? W16[k] : W8[k]; }
ivec2 q192(float v) { uvec4 t = texelFetch(uTab, ivec2(int(clamp(floor(v + 0.5), 0.0, 255.0)), 0), 0); return ivec2(t.xy); }
ivec2 q48(float v) { uvec4 t = texelFetch(uTab, ivec2(int(clamp(floor(v + 0.5), 0.0, 255.0)), 2), 0); return ivec2(t.xy); }
uint tritBlock(int t0, int t1, int t2, int t3, int t4) { return texelFetch(uTab, ivec2(t0 + 3 * t1 + 9 * t2 + 27 * t3 + 81 * t4, 1), 0).x; }
ivec2 q160(float v) { uvec4 t = texelFetch(uTab, ivec2(int(clamp(floor(v + 0.5), 0.0, 255.0)), 4), 0); return ivec2(t.xy); }
uint quintBlock(int q0, int q1, int q2) { return texelFetch(uTab, ivec2(q0 + 5 * q1 + 25 * q2, 3), 0).x; }
uint rev32(uint v) {
  v = ((v >> 1u) & 0x55555555u) | ((v & 0x55555555u) << 1u);
  v = ((v >> 2u) & 0x33333333u) | ((v & 0x33333333u) << 2u);
  v = ((v >> 4u) & 0x0F0F0F0Fu) | ((v & 0x0F0F0F0Fu) << 4u);
  v = ((v >> 8u) & 0x00FF00FFu) | ((v & 0x00FF00FFu) << 8u);
  return (v >> 16u) | (v << 16u);
}
/** Endpoint integers (r0 r1 g0 g1 b0 b1 [a0 a1]) as an ISE trit sequence with nb low bits per value. */
void putTrits(inout uvec4 b, inout int pos, int v[8], int nv, int nb) {
  int mask = (1 << nb) - 1;
  for (int g = 0; g < 2; g++) {
    int base = g * 5, cnt = min(5, nv - base);
    int t[5] = int[5](0, 0, 0, 0, 0); int m[5] = int[5](0, 0, 0, 0, 0);
    for (int j = 0; j < 5; j++) if (j < cnt) { t[j] = v[base + j] >> nb; m[j] = v[base + j] & mask; }
    uint T = tritBlock(t[0], t[1], t[2], t[3], t[4]);
    put(b, pos, uint(m[0]), nb); put(b, pos, T & 3u, 2);
    if (cnt > 1) { put(b, pos, uint(m[1]), nb); put(b, pos, (T >> 2u) & 3u, 2); }
    if (cnt > 2) { put(b, pos, uint(m[2]), nb); put(b, pos, (T >> 4u) & 1u, 1); }
    if (cnt > 3) { put(b, pos, uint(m[3]), nb); put(b, pos, (T >> 5u) & 3u, 2); }
    if (cnt > 4) { put(b, pos, uint(m[4]), nb); put(b, pos, (T >> 7u) & 1u, 1); }
  }
}
/** Six endpoint integers as an ISE quint sequence (two full groups of three) with nb low bits per value. */
void putQuints(inout uvec4 b, inout int pos, int v[8], int nb) {
  int mask = (1 << nb) - 1;
  for (int g = 0; g < 2; g++) {
    int a0 = v[g * 3], a1 = v[g * 3 + 1], a2 = v[g * 3 + 2];
    uint Q = quintBlock(a0 >> nb, a1 >> nb, a2 >> nb);
    put(b, pos, uint(a0 & mask), nb); put(b, pos, Q & 7u, 3);
    put(b, pos, uint(a1 & mask), nb); put(b, pos, (Q >> 3u) & 3u, 2);
    put(b, pos, uint(a2 & mask), nb); put(b, pos, (Q >> 5u) & 3u, 2);
  }
}
/** Weight stream (wb bits each, LSB first) → bit-reversed into the top of the block. */
void putWeights(inout uvec4 b, int w[32], int n, int wb) {
  uvec3 s = uvec3(0u); // up to 96 bits
  for (int i = 0; i < 32; i++) {
    if (i >= n) break;
    int at = i * wb, wi = at >> 5, sh = at & 31; uint x = uint(w[i]);
    if (wi == 0) s.x |= x << uint(sh); else if (wi == 1) s.y |= x << uint(sh); else s.z |= x << uint(sh);
    if (sh + wb > 32) { uint hi = x >> uint(32 - sh); if (wi == 0) s.y |= hi; else s.z |= hi; }
  }
  b.w |= rev32(s.x);
  b.z |= rev32(s.y);
  b.y |= rev32(s.z);
}
/** One weight plane: CEM 8 (opaque, 16 levels) or CEM 12 (8 levels), QUANT_192 endpoints. */
float single(vec4 e0, vec4 e1, out uvec4 b) {
  nW = opaque ? 16 : 8;
  ivec4 bi0 = ivec4(0), bi1 = ivec4(0); int bw[16]; float best = 1e30;
  for (int it = 0; it < ITERS(); it++) {
    ivec2 r0 = q192(e0.r), g0 = q192(e0.g), b0 = q192(e0.b), a0 = q192(opaque ? 255.0 : e0.a);
    ivec2 r1 = q192(e1.r), g1 = q192(e1.g), b1 = q192(e1.b), a1 = q192(opaque ? 255.0 : e1.a);
    ivec4 i0 = ivec4(r0.x, g0.x, b0.x, a0.x), i1 = ivec4(r1.x, g1.x, b1.x, a1.x);
    ivec4 c0 = ivec4(r0.y, g0.y, b0.y, opaque ? 255 : a0.y), c1 = ivec4(r1.y, g1.y, b1.y, opaque ? 255 : a1.y);
    // the decoder swaps + blue-contracts when sum(e1.rgb) < sum(e0.rgb): store them the other way round instead
    if (c1.r + c1.g + c1.b < c0.r + c0.g + c0.b) { ivec4 t = c0; c0 = c1; c1 = t; t = i0; i0 = i1; i1 = t; }
    int wd[16]; float err = 0.0;
    float sa = 0.0, sb = 0.0, sc = 0.0; vec4 sx = vec4(0.0), sy = vec4(0.0);
    for (int i = 0; i < N16; i++) {
      float bd = 1e30; int bk = 0;
      ivec2 kr = krange(lineT(px[i], vec4(c0), vec4(c1)), nW);
      for (int k = kr.x; k <= kr.y; k++) {
        int w = wOf(k);
        float dd = wd2(vec4((c0 * (64 - w) + c1 * w + 32) >> 6) - px[i]); if (dd < bd) { bd = dd; bk = k; }
      }
      wd[i] = bk; err += bd;
      float w = float(wOf(bk)) / 64.0, u = 1.0 - w;
      sa += u * u; sb += u * w; sc += w * w; sx += u * px[i]; sy += w * px[i];
    }
    if (err < best) { best = err; bi0 = i0; bi1 = i1; for (int i = 0; i < N16; i++) bw[i] = wd[i]; }
    if (err == 0.0) break;
    float det = sa * sc - sb * sb;
    if (abs(det) < 1e-6) break;
    e0 = clamp((sc * sx - sb * sy) / det, 0.0, 255.0);
    e1 = clamp((sa * sy - sb * sx) / det, 0.0, 255.0);
  }
  b = uvec4(0u); int pos = 0;
  put(b, pos, opaque ? 0x242u : 0x053u, 11); // 4×4 grid, one plane, QUANT_16 / QUANT_8
  put(b, pos, 0u, 2);
  put(b, pos, opaque ? 8u : 12u, 4);
  int v[8] = int[8](bi0.r, bi1.r, bi0.g, bi1.g, bi0.b, bi1.b, bi0.a, bi1.a);
  putTrits(b, pos, v, opaque ? 6 : 8, 6);
  int w32[32];
  for (int i = 0; i < 32; i++) w32[i] = i < 16 ? bw[i] : 0;
  putWeights(b, w32, 16, opaque ? 4 : 3);
  return best;
}
/** Two weight planes (alpha on the second, CCS = 3), 4 levels each, CEM 12 with QUANT_48 endpoints. */
float dual(vec4 e0, vec4 e1, out uvec4 b) {
  float amn = 255.0, amx = 0.0;
  for (int i = 0; i < N16; i++) { amn = min(amn, px[i].a); amx = max(amx, px[i].a); }
  e0.a = amn; e1.a = amx;
  ivec4 bi0 = ivec4(0), bi1 = ivec4(0); int bwc[16]; int bwa[16]; float best = 1e30;
  for (int it = 0; it < ITERS(); it++) {
    ivec2 r0 = q48(e0.r), g0 = q48(e0.g), b0 = q48(e0.b), a0 = q48(e0.a);
    ivec2 r1 = q48(e1.r), g1 = q48(e1.g), b1 = q48(e1.b), a1 = q48(e1.a);
    ivec4 i0 = ivec4(r0.x, g0.x, b0.x, a0.x), i1 = ivec4(r1.x, g1.x, b1.x, a1.x);
    ivec4 c0 = ivec4(r0.y, g0.y, b0.y, a0.y), c1 = ivec4(r1.y, g1.y, b1.y, a1.y);
    if (c1.r + c1.g + c1.b < c0.r + c0.g + c0.b) { ivec4 t = c0; c0 = c1; c1 = t; t = i0; i0 = i1; i1 = t; }
    int wc[16]; int wa[16]; float err = 0.0;
    float sa = 0.0, sb = 0.0, sc = 0.0; vec3 sx = vec3(0.0), sy = vec3(0.0);
    float ta = 0.0, tb = 0.0, tc = 0.0, tx = 0.0, ty = 0.0;
    for (int i = 0; i < N16; i++) {
      float bd = 1e30; int bk = 0;
      for (int k = 0; k < N4; k++) { float dd = wd2(vec3((c0.rgb * (64 - WQ4[k]) + c1.rgb * WQ4[k] + 32) >> 6) - px[i].rgb); if (dd < bd) { bd = dd; bk = k; } }
      float ad = 1e30; int ak = 0;
      for (int k = 0; k < N4; k++) { float d = float((c0.a * (64 - WQ4[k]) + c1.a * WQ4[k] + 32) >> 6) - px[i].a; if (d * d * W.a < ad) { ad = d * d * W.a; ak = k; } }
      wc[i] = bk; wa[i] = ak; err += bd + ad;
      float w = float(WQ4[bk]) / 64.0, u = 1.0 - w;
      sa += u * u; sb += u * w; sc += w * w; sx += u * px[i].rgb; sy += w * px[i].rgb;
      float wA = float(WQ4[ak]) / 64.0, uA = 1.0 - wA;
      ta += uA * uA; tb += uA * wA; tc += wA * wA; tx += uA * px[i].a; ty += wA * px[i].a;
    }
    if (err < best) { best = err; bi0 = i0; bi1 = i1; for (int i = 0; i < N16; i++) { bwc[i] = wc[i]; bwa[i] = wa[i]; } }
    if (err == 0.0) break;
    float det = sa * sc - sb * sb, detA = ta * tc - tb * tb;
    if (abs(det) > 1e-6) { e0.rgb = clamp((sc * sx - sb * sy) / det, 0.0, 255.0); e1.rgb = clamp((sa * sy - sb * sx) / det, 0.0, 255.0); }
    if (abs(detA) > 1e-6) { e0.a = clamp((tc * tx - tb * ty) / detA, 0.0, 255.0); e1.a = clamp((ta * ty - tb * tx) / detA, 0.0, 255.0); }
  }
  b = uvec4(0u); int pos = 0;
  put(b, pos, 0x442u, 11); // 4×4 grid, two planes, QUANT_4
  put(b, pos, 0u, 2);
  put(b, pos, 12u, 4);
  int v[8] = int[8](bi0.r, bi1.r, bi0.g, bi1.g, bi0.b, bi1.b, bi0.a, bi1.a);
  putTrits(b, pos, v, 8, 4);
  pos = 62; put(b, pos, 3u, 2); // colour component selector: alpha on plane 2 (just below the 64 weight bits)
  int w32[32];
  for (int i = 0; i < N16; i++) { w32[i * 2] = bwc[i]; w32[i * 2 + 1] = bwa[i]; }
  putWeights(b, w32, 32, 2);
  return best;
}
#if TIER == 2
uniform highp usampler2D uSeeds; // 256 × 256 RG8UI: the two-partition seed nearest each 16-bit texel mask
const int WQ5[5] = int[5](0, 16, 32, 48, 64);
int seedOf(int mask) { uvec4 v = texelFetch(uSeeds, ivec2(mask & 255, mask >> 8), 0); return int(v.x | (v.y << 8u)); }
int patternOf(int seed) { uvec4 v = texelFetch(uTab, ivec2(seed & 255, 5 + (seed >> 8)), 0); return int(v.x | (v.y << 8u)); }
/** 5-bit endpoint (QUANT_32, bit replication) nearest v: [code, value]. */
ivec2 q32(float v) {
  int q = int(clamp(floor(v * 31.0 / 255.0 + 0.5), 0.0, 31.0)), bq = q; float be = 1e9;
  for (int d = -1; d <= 1; d++) { int c = clamp(q + d, 0, 31); float e = abs(float((c << 3) | (c >> 2)) - v); if (e < be) { be = e; bq = c; } }
  return ivec2(bq, (bq << 3) | (bq >> 2));
}
/** Two clusters of the block's texels (2-means from the split across the principal axis): bit i = texel i's cluster. */
int clusterMask(vec3 axis) {
  vec3 mean = vec3(0.0);
  for (int i = 0; i < N16; i++) mean += px[i].rgb;
  mean *= 1.0 / 16.0;
  int m = 0;
  for (int i = 0; i < N16; i++) if (dot(px[i].rgb - mean, axis) > 0.0) m |= 1 << i;
  for (int it = 0; it < N3; it++) {
    vec3 c0 = vec3(0.0), c1 = vec3(0.0); float n0 = 0.0, n1 = 0.0;
    for (int i = 0; i < N16; i++) { if (((m >> i) & 1) == 1) { c1 += px[i].rgb; n1 += 1.0; } else { c0 += px[i].rgb; n0 += 1.0; } }
    if (n0 < 0.5 || n1 < 0.5) break;
    c0 /= n0; c1 /= n1;
    int nm = 0;
    for (int i = 0; i < N16; i++) if (wd2(px[i].rgb - c1) < wd2(px[i].rgb - c0)) nm |= 1 << i;
    if (nm == m) break;
    m = nm;
  }
  return m;
}
/** Opaque, two partitions (the ASTC seed whose pattern is nearest the block's two clusters), one weight plane with
 * 5 levels, CEM 8 for both with QUANT_32 endpoints: 29 + 60 + 38 bits. Blocks holding two surfaces (stone and mortar,
 * a crease in a normal map), like BC7 mode 1. */
float twoPart(vec4 e0, vec4 e1, out uvec4 b) {
  vec3 ax = e1.rgb - e0.rgb;
  if (dot(ax, ax) < 1e-6) ax = vec3(1.0);
  int seed = seedOf(clusterMask(ax)), mask = patternOf(seed);
  int q[12]; int w[16]; float total = 0.0;
  for (int i = 0; i < 16; i++) w[i] = 0;
  for (int s = 0; s < 2; s++) {
    vec3 m, sax; vec2 ex;
    subsetLine(mask, s, m, sax, ex);
    vec3 a0 = clamp(m + sax * ex.x, 0.0, 255.0), a1 = clamp(m + sax * ex.y, 0.0, 255.0);
    float best = 1e30; ivec3 b0 = ivec3(0), b1 = ivec3(0); int bw[16];
    for (int i = 0; i < 16; i++) bw[i] = 0;
    for (int it = 0; it < ITERS(); it++) {
      ivec2 r0 = q32(a0.r), g0 = q32(a0.g), bl0 = q32(a0.b), r1 = q32(a1.r), g1 = q32(a1.g), bl1 = q32(a1.b);
      ivec3 i0 = ivec3(r0.x, g0.x, bl0.x), i1 = ivec3(r1.x, g1.x, bl1.x);
      ivec3 c0 = ivec3(r0.y, g0.y, bl0.y), c1 = ivec3(r1.y, g1.y, bl1.y);
      if (c1.r + c1.g + c1.b < c0.r + c0.g + c0.b) { ivec3 t = c0; c0 = c1; c1 = t; t = i0; i0 = i1; i1 = t; }
      int cur[16]; float err = 0.0, sa = 0.0, sb = 0.0, sc = 0.0; vec3 sx = vec3(0.0), sy = vec3(0.0);
      for (int i = 0; i < N16; i++) {
        cur[i] = 0;
        if (((mask >> i) & 1) != s) continue;
        float bd = 1e30; int bk = 0;
        for (int k = 0; k < 5; k++) { float dd = wd2(vec3((c0 * (64 - WQ5[k]) + c1 * WQ5[k] + 32) >> 6) - px[i].rgb); if (dd < bd) { bd = dd; bk = k; } }
        cur[i] = bk; err += bd;
        float ww = float(WQ5[bk]) / 64.0, u = 1.0 - ww;
        sa += u * u; sb += u * ww; sc += ww * ww; sx += u * px[i].rgb; sy += ww * px[i].rgb;
      }
      if (err < best) { best = err; b0 = i0; b1 = i1; for (int i = 0; i < N16; i++) bw[i] = cur[i]; }
      if (err == 0.0) break;
      float det = sa * sc - sb * sb;
      if (abs(det) < 1e-6) break;
      a0 = clamp((sc * sx - sb * sy) / det, 0.0, 255.0);
      a1 = clamp((sa * sy - sb * sx) / det, 0.0, 255.0);
    }
    for (int i = 0; i < N16; i++) if (((mask >> i) & 1) == s) w[i] = bw[i];
    int o = s * 6;
    q[o] = b0.r; q[o + 1] = b1.r; q[o + 2] = b0.g; q[o + 3] = b1.g; q[o + 4] = b0.b; q[o + 5] = b1.b;
    total += best;
  }
  b = uvec4(0u); int pos = 0;
  put(b, pos, 0x052u, 11); // 4×4 grid, one plane, QUANT_5
  put(b, pos, 1u, 2);      // two partitions
  put(b, pos, uint(seed), 10);
  put(b, pos, 32u, 6);     // both partitions CEM 8 (base class 0)
  for (int i = 0; i < 12; i++) put(b, pos, uint(q[i]), 5);
  // weights: 16 quints (no low bits) — groups of three as 7-bit blocks, the last weight alone in 3 bits
  uint s0 = 0u, s1 = 0u; int at = 0;
  for (int g = 0; g < 6; g++) {
    int k = g * 3;
    uint Q = quintBlock(w[k], k + 1 < 16 ? w[k + 1] : 0, k + 2 < 16 ? w[k + 2] : 0);
    int nb = g < 5 ? 7 : 3;
    uint v = Q & ((1u << uint(nb)) - 1u);
    if (at < 32) { s0 |= v << uint(at); if (at + nb > 32) s1 |= v >> uint(32 - at); } else s1 |= v << uint(at - 32);
    at += nb;
  }
  b.w |= rev32(s0);
  b.z |= rev32(s1);
  return total;
}
#endif
#if TIER == 2
// Reduced weight grids of the two-plane modes have 3 points on one side and 4 on the other: along a 3-point side, texel
// coordinate u (0..3) infills from grid points TAP3[u].xy, TAP3[u].z / 16 of the second (spec C.2.18, Ds = 342 — exact).
const ivec3 TAP3[4] = ivec3[4](ivec3(0, 0, 0), ivec3(0, 1, 11), ivec3(1, 2, 5), ivec3(2, 2, 0));
/** Grid taps of texel i on an N×M grid: [j0, j1, f1], texel weight = (g[j0]·(16 − f1) + g[j1]·f1 + 8) >> 4. */
ivec3 taps(int i, int N, int M) {
  int x = i & 3, y = i >> 2;
  if (N == 3) { ivec3 t = TAP3[x]; return ivec3(y * 3 + t.x, y * 3 + t.y, t.z); }
  if (M == 3) { ivec3 t = TAP3[y]; return ivec3(t.x * 4 + x, t.y * 4 + x, t.z); }
  return ivec3(i, i, 0);
}
// least-squares 3 grid points from the 4 texel weights of a 3-point side (pseudo-inverse of the TAP3 infill)
const vec4 PINV0 = vec4(0.955516, 0.142349, -0.142349, 0.044484), PINV1 = vec4(-0.227273, 0.727273, 0.727273, -0.227273);
/** Grid weights (N×M, row-major) whose infill best matches the per-texel weights w. */
void fitGrid(float w[16], int N, int M, out float g[16]) {
  for (int k = 0; k < 16; k++) g[k] = w[k]; // 4×4: the grid is the texels
  if (N == 3) for (int y = 0; y < 4; y++) {
    vec4 r = vec4(w[y * 4], w[y * 4 + 1], w[y * 4 + 2], w[y * 4 + 3]);
    g[y * 3] = dot(PINV0, r); g[y * 3 + 1] = dot(PINV1, r); g[y * 3 + 2] = dot(PINV0.wzyx, r);
  }
  if (M == 3) for (int x = 0; x < 4; x++) {
    vec4 r = vec4(w[x], w[x + 4], w[x + 8], w[x + 12]);
    g[x] = dot(PINV0, r); g[x + 4] = dot(PINV1, r); g[x + 8] = dot(PINV0.wzyx, r);
  }
}
// weight quantizations of the reduced grids: 0 = QUANT_8 (3 bits), 2 = QUANT_10 (quint + 1 bit), 3 = QUANT_5 (quint);
// WU10: unquantized values by ISE code (astc-encoder's scrambled order), V10 / C10: the levels in order and their codes
const int WU10[10] = int[10](0, 64, 7, 57, 14, 50, 21, 43, 28, 36);
const int V10[10] = int[10](0, 7, 14, 21, 28, 36, 43, 50, 57, 64);
const int C10[10] = int[10](0, 2, 4, 6, 8, 9, 7, 5, 3, 1);
int wq(int code, int q) { return q == 0 ? W8[code] : q == 2 ? WU10[code] : code * 16; }
int lvl(int k, int q) { return q == 0 ? W8[k] : q == 2 ? V10[k] : k * 16; }
/** ISE code of the weight level of quantization q nearest v (0..64). */
int qw(float v, int q) {
  int n = q == 0 ? 7 : q == 2 ? 9 : 4;
  int r = int(clamp(floor(v * float(n) / 64.0 + 0.5), 0.0, float(n))), best = r; float be = 1e9;
  for (int k = max(r - 1, 0); k <= min(r + 1, n); k++) { float e = abs(float(lvl(k, q)) - v); if (e < be) { be = e; best = k; } }
  return q == 2 ? C10[best] : best;
}
ivec2 q64(float v) { int q = int(clamp(floor(v * 63.0 / 255.0 + 0.5), 0.0, 63.0)); return ivec2(q, (q << 2) | (q >> 4)); }
ivec2 q24(float v) { uvec4 t = texelFetch(uTab, ivec2(int(clamp(floor(v + 0.5), 0.0, 255.0)), 9), 0); return ivec2(t.xy); }
/** Endpoint quantization of the reduced-grid modes: 0 = QUANT_64 (6 bits), 1 = QUANT_48 (trit + 4), 2 = QUANT_24 (trit + 3). */
ivec2 qEp(float v, int eq) { return eq == 0 ? q64(v) : eq == 1 ? q48(v) : q24(v); }
/** A sequence of values as ISE quints with nb low bits each (groups of three; a short last group truncated). */
void putQuintSeq(inout uvec4 st, inout int pos, int v[32], int n, int nb) {
  int mask = (1 << nb) - 1;
  for (int g = 0; g < 11; g++) {
    int base = g * 3;
    if (base >= n) break;
    int cnt = min(3, n - base);
    int a0 = v[base], a1 = cnt > 1 ? v[base + 1] : 0, a2 = cnt > 2 ? v[base + 2] : 0;
    uint Q = quintBlock(a0 >> nb, a1 >> nb, a2 >> nb);
    put(st, pos, uint(a0 & mask), nb); put(st, pos, Q & 7u, 3);
    if (cnt > 1) { put(st, pos, uint(a1 & mask), nb); put(st, pos, (Q >> 3u) & 3u, 2); }
    if (cnt > 2) { put(st, pos, uint(a2 & mask), nb); put(st, pos, (Q >> 5u) & 3u, 2); }
  }
}
/** Opaque, two planes on a reduced N×M weight grid (the decoder infills the 4×4 texel weights), channel c on plane 2,
 * CEM 8: GRIDS[g] = 3×4 / 4×3 with 8 levels and QUANT_64 endpoints, 3×4 with 10 levels and QUANT_24, 4×4 with 5 and
 * QUANT_48 — the modes astc-encoder picks most on normal maps (more weight or endpoint precision for the same bits).
 * Bits only written when the error beats bound. */
const ivec4 GRIDS[4] = ivec4[4](ivec4(3, 4, 0, 0), ivec4(4, 3, 0, 0), ivec4(3, 4, 2, 2), ivec4(4, 4, 3, 1)); // N, M, weight q, endpoint q
const uint GRID_MODE[4] = uint[4](0x5DFu, 0x433u, 0x7CDu, 0x452u);
float dualGrid(int c, int g, vec4 e0, vec4 e1, float bound, out uvec4 b) {
  int N = GRIDS[g].x, M = GRIDS[g].y, L = GRIDS[g].z, eq = GRIDS[g].w, n = N * M;
  vec3 m1 = vec3(1.0); m1[c] = 0.0;
  float mn = 255.0, mx = 0.0;
  for (int i = 0; i < N16; i++) { mn = min(mn, px[i][c]); mx = max(mx, px[i][c]); }
  e0[c] = mn; e1[c] = mx;
  vec3 w1 = W.rgb * m1; float w2 = W[c];
  ivec3 tp[16];
  for (int i = 0; i < N16; i++) tp[i] = taps(i, N, M);
  float best = 1e30; ivec3 bi0 = ivec3(0), bi1 = ivec3(0); int bg1[16]; int bg2[16];
  for (int k = 0; k < 16; k++) { bg1[k] = 0; bg2[k] = 0; }
  for (int it = 0; it < N3; it++) {
    ivec2 r0 = qEp(e0.r, eq), g0 = qEp(e0.g, eq), b0 = qEp(e0.b, eq), r1 = qEp(e1.r, eq), g1 = qEp(e1.g, eq), b1 = qEp(e1.b, eq);
    ivec3 i0 = ivec3(r0.x, g0.x, b0.x), i1 = ivec3(r1.x, g1.x, b1.x);
    ivec3 c0 = ivec3(r0.y, g0.y, b0.y), c1 = ivec3(r1.y, g1.y, b1.y);
    if (c1.r + c1.g + c1.b < c0.r + c0.g + c0.b) { ivec3 t = c0; c0 = c1; c1 = t; t = i0; i0 = i1; i1 = t; }
    vec3 d = vec3(c1 - c0) * m1; float dd = dot(d * d, w1);
    float d2 = float(c1[c] - c0[c]);
    float ws1[16]; float ws2[16];
    for (int i = 0; i < N16; i++) {
      vec3 p = px[i].rgb - vec3(c0);
      ws1[i] = dd > 0.0 ? clamp(64.0 * dot(p * d, w1) / dd, 0.0, 64.0) : 32.0;
      ws2[i] = abs(d2) > 0.0 ? clamp(64.0 * p[c] / d2, 0.0, 64.0) : 32.0;
    }
    float gf1[16]; float gf2[16];
    fitGrid(ws1, N, M, gf1); fitGrid(ws2, N, M, gf2);
    int gq1[16]; int gq2[16]; int gu1[16]; int gu2[16];
    for (int k = 0; k < 16; k++) {
      gq1[k] = 0; gq2[k] = 0; gu1[k] = 0; gu2[k] = 0;
      if (k >= n) continue;
      gq1[k] = qw(gf1[k], L); gq2[k] = qw(gf2[k], L); gu1[k] = wq(gq1[k], L); gu2[k] = wq(gq2[k], L);
    }
    float err = 0.0, sa = 0.0, sb = 0.0, sc = 0.0, ta = 0.0, tb = 0.0, tc = 0.0, tx = 0.0, ty = 0.0; vec3 sx = vec3(0.0), sy = vec3(0.0);
    for (int i = 0; i < N16; i++) {
      ivec3 t = tp[i];
      int wa = (gu1[t.x] * (16 - t.z) + gu1[t.y] * t.z + 8) >> 4, wb = (gu2[t.x] * (16 - t.z) + gu2[t.y] * t.z + 8) >> 4;
      vec3 col = vec3((c0 * (64 - wa) + c1 * wa + 32) >> 6);
      float cc = float((c0[c] * (64 - wb) + c1[c] * wb + 32) >> 6);
      vec3 e = (col - px[i].rgb) * m1; float ec = cc - px[i][c];
      err += dot(e * e, W.rgb) + ec * ec * w2;
      float fa = float(wa) / 64.0, ua = 1.0 - fa, fb = float(wb) / 64.0, ub = 1.0 - fb;
      sa += ua * ua; sb += ua * fa; sc += fa * fa; sx += ua * px[i].rgb; sy += fa * px[i].rgb;
      ta += ub * ub; tb += ub * fb; tc += fb * fb; tx += ub * px[i][c]; ty += fb * px[i][c];
    }
    if (err < best) { best = err; bi0 = i0; bi1 = i1; for (int k = 0; k < 16; k++) { bg1[k] = gq1[k]; bg2[k] = gq2[k]; } }
    if (err == 0.0) break;
    float det = sa * sc - sb * sb, detA = ta * tc - tb * tb;
    vec3 n0 = e0.rgb, n1 = e1.rgb;
    if (abs(det) > 1e-6) { n0 = clamp((sc * sx - sb * sy) / det, 0.0, 255.0); n1 = clamp((sa * sy - sb * sx) / det, 0.0, 255.0); }
    if (abs(detA) > 1e-6) { n0[c] = clamp((tc * tx - tb * ty) / detA, 0.0, 255.0); n1[c] = clamp((ta * ty - tb * tx) / detA, 0.0, 255.0); }
    e0.rgb = n0; e1.rgb = n1;
  }
  if (best >= bound) return best; // not the block's best: skip writing its bits
  b = uvec4(0u); int pos = 0;
  put(b, pos, GRID_MODE[g], 11);
  put(b, pos, 0u, 2);
  put(b, pos, 8u, 4);
  int ev[8] = int[8](bi0.r, bi1.r, bi0.g, bi1.g, bi0.b, bi1.b, 0, 0);
  if (eq == 0) { for (int k = 0; k < 6; k++) put(b, pos, uint(ev[k]), 6); } else putTrits(b, pos, ev, 6, eq == 1 ? 4 : 3);
  int nw = n * 2;
  int w32[32];
  for (int k = 0; k < 32; k++) w32[k] = 0;
  for (int k = 0; k < 16; k++) if (k < n) { w32[k * 2] = bg1[k]; w32[k * 2 + 1] = bg2[k]; }
  // the weight stream, written forward, then bit-reversed into the top of the block; the CCS sits right below it
  uvec4 ws = uvec4(0u); int wpos = 0;
  if (L == 0) { for (int k = 0; k < 32; k++) if (k < nw) put(ws, wpos, uint(w32[k]), 3); }
  else putQuintSeq(ws, wpos, w32, nw, L == 2 ? 1 : 0);
  b.w |= rev32(ws.x); b.z |= rev32(ws.y); b.y |= rev32(ws.z); b.x |= rev32(ws.w);
  pos = 128 - wpos - 2; put(b, pos, uint(c), 2); // colour component selector
  return best;
}
#endif
/** Opaque, two weight planes: channel c (0 R, 1 G, 2 B) on its own plane (CCS = c), 4 levels each, CEM 8 with
 * QUANT_160 endpoints — normal maps and packed data, whose channels vary independently. */
float dualOpaque(int c, vec4 e0, vec4 e1, out uvec4 b) {
  vec3 m1 = vec3(1.0); m1[c] = 0.0; // plane-1 channels
  float mn = 255.0, mx = 0.0;
  for (int i = 0; i < N16; i++) { mn = min(mn, px[i][c]); mx = max(mx, px[i][c]); }
  e0[c] = mn; e1[c] = mx;
  ivec3 bi0 = ivec3(0), bi1 = ivec3(0); int bw1[16]; int bw2[16]; float best = 1e30;
  vec3 w1 = W.rgb * m1;
  float w2 = W[c];
  for (int it = 0; it < ITERS(); it++) {
    ivec2 r0 = q160(e0.r), g0 = q160(e0.g), b0 = q160(e0.b), r1 = q160(e1.r), g1 = q160(e1.g), b1 = q160(e1.b);
    ivec3 i0 = ivec3(r0.x, g0.x, b0.x), i1 = ivec3(r1.x, g1.x, b1.x);
    ivec3 c0 = ivec3(r0.y, g0.y, b0.y), c1 = ivec3(r1.y, g1.y, b1.y);
    if (c1.r + c1.g + c1.b < c0.r + c0.g + c0.b) { ivec3 t = c0; c0 = c1; c1 = t; t = i0; i0 = i1; i1 = t; }
    int wa[16]; int wb[16]; float err = 0.0;
    float sa = 0.0, sb = 0.0, sc = 0.0; vec3 sx = vec3(0.0), sy = vec3(0.0);
    float ta = 0.0, tb = 0.0, tc = 0.0, tx = 0.0, ty = 0.0;
    for (int i = 0; i < N16; i++) {
      float bd = 1e30; int bk = 0;
      for (int k = 0; k < N4; k++) { vec3 d = vec3((c0 * (64 - WQ4[k]) + c1 * WQ4[k] + 32) >> 6) - px[i].rgb; float dd = dot(d * d, w1); if (dd < bd) { bd = dd; bk = k; } }
      float ad = 1e30; int ak = 0;
      for (int k = 0; k < N4; k++) { float d = float((c0[c] * (64 - WQ4[k]) + c1[c] * WQ4[k] + 32) >> 6) - px[i][c]; if (d * d * w2 < ad) { ad = d * d * w2; ak = k; } }
      wa[i] = bk; wb[i] = ak; err += bd + ad;
      float w = float(WQ4[bk]) / 64.0, u = 1.0 - w;
      sa += u * u; sb += u * w; sc += w * w; sx += u * px[i].rgb; sy += w * px[i].rgb;
      float wA = float(WQ4[ak]) / 64.0, uA = 1.0 - wA;
      ta += uA * uA; tb += uA * wA; tc += wA * wA; tx += uA * px[i][c]; ty += wA * px[i][c];
    }
    if (err < best) { best = err; bi0 = i0; bi1 = i1; for (int i = 0; i < N16; i++) { bw1[i] = wa[i]; bw2[i] = wb[i]; } }
    if (err == 0.0) break;
    float det = sa * sc - sb * sb, detA = ta * tc - tb * tb;
    vec3 n0 = e0.rgb, n1 = e1.rgb;
    if (abs(det) > 1e-6) { n0 = clamp((sc * sx - sb * sy) / det, 0.0, 255.0); n1 = clamp((sa * sy - sb * sx) / det, 0.0, 255.0); }
    if (abs(detA) > 1e-6) { n0[c] = clamp((tc * tx - tb * ty) / detA, 0.0, 255.0); n1[c] = clamp((ta * ty - tb * tx) / detA, 0.0, 255.0); }
    e0.rgb = n0; e1.rgb = n1;
  }
  b = uvec4(0u); int pos = 0;
  put(b, pos, 0x442u, 11); // 4×4 grid, two planes, QUANT_4
  put(b, pos, 0u, 2);
  put(b, pos, 8u, 4);
  int v[8] = int[8](bi0.r, bi1.r, bi0.g, bi1.g, bi0.b, bi1.b, 0, 0);
  putQuints(b, pos, v, 5);
  pos = 62; put(b, pos, uint(c), 2); // colour component selector
  int w32[32];
  for (int i = 0; i < 16; i++) { w32[i * 2] = bw1[i]; w32[i * 2 + 1] = bw2[i]; }
  putWeights(b, w32, 32, 2);
  return best;
}
void main() {
  ivec2 blk = ivec2(gl_FragCoord.xy);
  W = uW;
  float amin = 255.0;
  for (int i = 0; i < N16; i++) { px[i] = fetchPx(blk * 4 + ivec2(i & 3, i >> 2)); amin = min(amin, px[i].a); }
  opaque = amin >= 255.0;
  vec4 e0, e1;
  lineFit(e0, e1);
  uvec4 b1;
  float err1 = single(e0, e1, b1);
  if (opaque && err1 > 0.0) {
    int cOnly = TIER == 0 ? residualChannel(e0, e1) : -1; // fast tier: the channel the line leaves the most off it
    int cBest = 0; float eBest = 1e30;
    for (int c = 0; c < 3; c++) {
      if (cOnly >= 0 && c != cOnly) continue;
      uvec4 b2;
      float e2 = dualOpaque(c, e0, e1, b2);
      if (e2 < eBest) { eBest = e2; cBest = c; }
      if (e2 < err1) { err1 = e2; b1 = b2; }
    }
#if TIER == 2
    if (err1 > MODE1_ERR) {
      // reduced-grid dual planes (3×4 / 4×3 QUANT_8 + QUANT_64 endpoints, 3×4 QUANT_10 + QUANT_24, 4×4 QUANT_5 +
      // QUANT_48) for the channel whose own plane helped most, then two partitions where those still fit poorly
      uvec4 b2;
      for (int g = 0; g < N4; g++) {
        float e2 = dualGrid(cBest, g, e0, e1, err1, b2);
        if (e2 < err1) { err1 = e2; b1 = b2; }
      }
      if (err1 > MODE1_ERR) {
        float e2 = twoPart(e0, e1, b2);
        if (e2 < err1) { err1 = e2; b1 = b2; }
      }
    }
#endif
  }
  if (!opaque && err1 > 0.0) {
    opaque = true; // RGB-only principal axis for the colour plane
    vec4 f0, f1;
    lineFit(f0, f1);
    opaque = false;
    uvec4 b2;
    float err2 = dual(f0, f1, b2);
    if (err2 < err1) { oBlock = b2; return; }
  }
  oBlock = b1;
}`;

// ------------------------------------------------------------------ ASTC tables (spec C.2.13 / C.2.12)

/** Unquantized 8-bit value of QUANT_160 ISE value v (quint = v >> 5, bits = v & 31; B = edcb0000e, C = 6). */
export function astcUnq160(v) {
  const D = v >> 5, bits = v & 31;
  const a = bits & 1, b = (bits >> 1) & 1, c = (bits >> 2) & 1, d = (bits >> 3) & 1, e = (bits >> 4) & 1;
  const A = a ? 0x1ff : 0;
  const B = (e << 8) | (d << 7) | (c << 6) | (b << 5) | e;
  let T = D * 6 + B;
  T ^= A;
  return (A & 0x80) | (T >> 2);
}

/** Decode a 7-bit quint block into its three quints (spec C.2.12). */
export function astcQuints(Q) {
  const bit = (x, i) => (x >> i) & 1;
  let q0, q1, q2;
  if (((Q >> 1) & 3) === 3 && ((Q >> 5) & 3) === 0) {
    q2 = (bit(Q, 0) << 2) | ((bit(Q, 4) & (bit(Q, 0) ^ 1)) << 1) | (bit(Q, 3) & (bit(Q, 0) ^ 1)); q1 = 4; q0 = 4;
  } else {
    let C;
    if (((Q >> 1) & 3) === 3) { q2 = 4; C = (((Q >> 3) & 3) << 3) | ((~(Q >> 5) & 3) << 1) | bit(Q, 0); } else { q2 = (Q >> 5) & 3; C = Q & 31; }
    if ((C & 7) === 5) { q1 = 4; q0 = (C >> 3) & 3; } else { q1 = (C >> 3) & 3; q0 = C & 7; }
  }
  return [q0, q1, q2];
}

/** Unquantized 8-bit value of QUANT_48 ISE value v (trit = v >> 4, bits = v & 15; B = dcb000dcb, C = 22). */
export function astcUnq48(v) {
  const D = v >> 4, bits = v & 15;
  const a = bits & 1, b = (bits >> 1) & 1, c = (bits >> 2) & 1, d = (bits >> 3) & 1;
  const A = a ? 0x1ff : 0;
  const B = (d << 8) | (c << 7) | (b << 6) | (d << 2) | (c << 1) | b;
  let T = D * 22 + B;
  T ^= A;
  return (A & 0x80) | (T >> 2);
}

/** Unquantized 8-bit value of QUANT_192 ISE value v (trit = v >> 6, bits = v & 63). */
export function astcUnq192(v) {
  const D = v >> 6, bits = v & 63;
  const a = bits & 1, b = (bits >> 1) & 1, c = (bits >> 2) & 1, d = (bits >> 3) & 1, e = (bits >> 4) & 1, f = (bits >> 5) & 1;
  const A = a ? 0x1ff : 0;
  const B = (f << 8) | (e << 7) | (d << 6) | (c << 5) | (b << 4) | f; // fedcb000f
  let T = D * 5 + B;
  T ^= A;
  return (A & 0x80) | (T >> 2);
}

/** Decode an 8-bit trit block into its five trits (spec C.2.12). */
export function astcTrits(T) {
  const bit = (x, i) => (x >> i) & 1;
  let C, t4, t3;
  if (((T >> 2) & 7) === 7) { C = (((T >> 5) & 7) << 2) | (T & 3); t4 = 2; t3 = 2; } else {
    C = T & 31;
    if (((T >> 5) & 3) === 3) { t4 = 2; t3 = bit(T, 7); } else { t4 = bit(T, 7); t3 = (T >> 5) & 3; }
  }
  let t2, t1, t0;
  if ((C & 3) === 3) { t2 = 2; t1 = bit(C, 4); t0 = (bit(C, 3) << 1) | (bit(C, 2) & (bit(C, 3) ^ 1)); } else if (((C >> 2) & 3) === 3) { t2 = 2; t1 = 2; t0 = C & 3; } else {
    t2 = bit(C, 4); t1 = (C >> 2) & 3; t0 = (bit(C, 1) << 1) | (bit(C, 0) & (bit(C, 1) ^ 1));
  }
  return [t0, t1, t2, t3, t4];
}

/** ASTC partition hash (spec C.2.21 / astc-encoder select_partition): partition of texel (x, y, z) for a seed. */
export function astcPartition(seed, x, y, z, count, small) {
  if (small) { x <<= 1; y <<= 1; z <<= 1; }
  seed += (count - 1) * 1024;
  let r = seed >>> 0;
  r ^= r >>> 15; r = Math.imul(r, 0xEEDE0891) >>> 0; r ^= r >>> 5; r = (r + (r << 16)) >>> 0; r ^= r >>> 7; r ^= r >>> 3;
  r = (r ^ (r << 6)) >>> 0; r ^= r >>> 17; r >>>= 0;
  const sq = (v) => v * v;
  let s1 = sq(r & 15), s2 = sq((r >>> 4) & 15), s3 = sq((r >>> 8) & 15), s4 = sq((r >>> 12) & 15), s5 = sq((r >>> 16) & 15), s6 = sq((r >>> 20) & 15);
  let s7 = sq((r >>> 24) & 15), s8 = sq((r >>> 28) & 15), s9 = sq((r >>> 18) & 15), s10 = sq((r >>> 22) & 15), s11 = sq((r >>> 26) & 15), s12 = sq(((r >>> 30) | (r << 2)) & 15);
  let sh1, sh2;
  if (seed & 1) { sh1 = seed & 2 ? 4 : 5; sh2 = count === 3 ? 6 : 5; } else { sh1 = count === 3 ? 6 : 5; sh2 = seed & 2 ? 4 : 5; }
  const sh3 = seed & 0x10 ? sh1 : sh2;
  s1 >>= sh1; s2 >>= sh2; s3 >>= sh1; s4 >>= sh2; s5 >>= sh1; s6 >>= sh2; s7 >>= sh1; s8 >>= sh2;
  s9 >>= sh3; s10 >>= sh3; s11 >>= sh3; s12 >>= sh3;
  let a = (s1 * x + s2 * y + s11 * z + (r >>> 14)) & 0x3f, b = (s3 * x + s4 * y + s12 * z + (r >>> 10)) & 0x3f;
  let c = (s5 * x + s6 * y + s9 * z + (r >>> 6)) & 0x3f, d = (s7 * x + s8 * y + s10 * z + (r >>> 2)) & 0x3f;
  if (count <= 3) d = 0;
  if (count <= 2) c = 0;
  if (count <= 1) b = 0;
  if (a >= b && a >= c && a >= d) return 0;
  if (b >= c && b >= d) return 1;
  return c >= d ? 2 : 3;
}

/** 16-bit texel mask (bit = partition 1) of each 4×4 two-partition seed. */
export function astcPatterns2() {
  const out = new Uint16Array(1024);
  for (let seed = 0; seed < 1024; seed++) {
    let m = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (astcPartition(seed, x, y, 0, 2, true)) m |= 1 << (y * 4 + x);
    out[seed] = m;
  }
  return out;
}

let SEEDS = null;
/** Builds the seed table in steps: run(n) does the next n masks, true once all are done. */
function seedTableBuilder() {
  const pat = astcPatterns2(), seen = new Set(), cand = [], seeds = [];
  for (let s = 0; s < 1024; s++) {
    const p = pat[s], key = Math.min(p, p ^ 0xffff);
    if (p === 0 || p === 0xffff || seen.has(key)) continue;
    seen.add(key); cand.push(p); seeds.push(s);
  }
  const pc = new Uint8Array(65536);
  for (let i = 1; i < 65536; i++) pc[i] = pc[i >> 1] + (i & 1);
  const out = new Uint8Array(65536 * 2), n = cand.length;
  let m0 = 0;
  return {
    out,
    run(count) {
      const end = Math.min(65536, m0 + count);
      for (let m = m0; m < end; m++) {
        let best = 99, bs = 0;
        for (let k = 0; k < n; k++) {
          const d = pc[m ^ cand[k]], e = 16 - d, dd = d < e ? d : e;
          if (dd < best) { best = dd; bs = seeds[k]; if (dd === 0) break; }
        }
        out[m * 2] = bs & 255; out[m * 2 + 1] = bs >> 8;
      }
      m0 = end;
      return m0 >= 65536;
    },
  };
}
/**
 * For every 16-bit texel mask, the two-partition seed whose pattern differs from it (or from its complement — the
 * partitions can swap) in the fewest texels: RG8UI 256 × 256 (seed low byte, high bits). Built once (~0.1–0.3 s).
 */
export function astcSeedTable() {
  if (SEEDS) return SEEDS;
  const b = seedTableBuilder();
  b.run(65536);
  return (SEEDS = b.out);
}

/** Same, built in slices on later tasks (phones: the page stays responsive). @returns {Promise<Uint8Array>} */
let SEEDS_ASYNC = null;
export function astcSeedTableAsync(slice = 4096) {
  if (SEEDS) return Promise.resolve(SEEDS);
  if (SEEDS_ASYNC) return SEEDS_ASYNC;
  SEEDS_ASYNC = new Promise((ok) => {
    const b = seedTableBuilder();
    const step = () => {
      if (SEEDS) ok(SEEDS);
      else if (b.run(slice)) ok((SEEDS = b.out));
      else post(step);
    };
    post(step);
  });
  return SEEDS_ASYNC;
}

/** QUANT_24 colour values by ISE code (trit + 3 bits; astc-encoder color_scrambled_pquant_to_uquant_q24). */
const Q24 = [0, 255, 33, 222, 66, 189, 99, 156, 11, 244, 44, 211, 77, 178, 110, 145, 22, 233, 55, 200, 88, 167, 121, 134];
let TABLES = null;
/** Rows: 0 nearest QUANT_192 [index, value] per 8-bit value; 1 trit block per 5-trit tuple (base 3); 2 QUANT_48;
 * 3 quint block per 3-quint tuple (base 5); 4 QUANT_160; 5–8 the 16-bit pattern of each two-partition seed (low, high);
 * 9 QUANT_24. */
export const ASTC_TABLE_ROWS = 10;
export function astcTables() {
  if (TABLES) return TABLES;
  const t = new Uint8Array(256 * ASTC_TABLE_ROWS * 2);
  const nearest = (n, unqOf, row) => {
    const unq = Array.from({ length: n }, (_, v) => unqOf(v));
    for (let x = 0; x < 256; x++) {
      let bi = 0, bd = 1e9;
      for (let v = 0; v < n; v++) { const d = Math.abs(unq[v] - x); if (d < bd) { bd = d; bi = v; } }
      t[(row * 256 + x) * 2] = bi; t[(row * 256 + x) * 2 + 1] = unq[bi];
    }
  };
  nearest(192, astcUnq192, 0);
  nearest(48, astcUnq48, 2);
  nearest(160, astcUnq160, 4);
  const qenc = new Int16Array(125).fill(-1);
  for (let Q = 0; Q < 128; Q++) { const [a, b, c] = astcQuints(Q); const k = a + 5 * b + 25 * c; if (qenc[k] < 0) qenc[k] = Q; }
  for (let k = 0; k < 125; k++) t[(3 * 256 + k) * 2] = qenc[k];
  const pat = astcPatterns2();
  for (let sd = 0; sd < 1024; sd++) { t[(5 * 256 + sd) * 2] = pat[sd] & 255; t[(5 * 256 + sd) * 2 + 1] = pat[sd] >> 8; }
  nearest(24, (v) => Q24[v], 9);
  const enc = new Int16Array(243).fill(-1);
  for (let T = 0; T < 256; T++) {
    const [a, b, c, d, e] = astcTrits(T);
    const k = a + 3 * b + 9 * c + 27 * d + 81 * e;
    if (enc[k] < 0) enc[k] = T;
  }
  for (let k = 0; k < 243; k++) t[(256 + k) * 2] = enc[k];
  TABLES = t;
  return t;
}

// ------------------------------------------------------------------ compressor

const CODECS = {
  bc7: { ext: 'EXT_texture_compression_bptc', format: THREE.RGBA_BPTC_Format, frag: BC7_FRAG, gl: [0x8E8C, 0x8E8D] },
  astc: { ext: 'WEBGL_compressed_texture_astc', format: THREE.RGBA_ASTC_4x4_Format, frag: ASTC_FRAG, gl: [0x93B0, 0x93D0] },
};

/** three r186 renamed Source → TextureSource. */
const TextureSource = THREE.TextureSource || THREE.Source;
/** Encoder quality tiers — one program each (`#define TIER`), so a slow GPU never runs (or compiles) the costly modes:
 *  0 fast: the block's line, + one channel on its own line / plane (the one the line misses most), candidate
 *    indices around each texel's projection, 2 refinement passes;
 *  1 base: every rotation (BC7 mode 5) / dual-plane channel (ASTC), every candidate, 4 passes;
 *  2 full: + BC7 mode 1 / ASTC two partitions and reduced-grid dual planes for blocks the single lines fit poorly.
 * TIER_COST: GPU time of each on real maps (normal / ORM / albedo) per unit of the calibration — the fast tier on a
 * noise image — measured where encoding is throughput-bound like on a phone GPU (SwiftShader; rounded up). */
const TIER_COST = { bc7: [1.5, 3, 6], astc: [2.2, 5.5, 13] };
/** GPU time per million texels a tier may cost on real maps: a mission encodes ~150–300 Mtexels (mips included), so
 * 8 ms/Mtexel ≈ 1–2.4 s of GPU time, spread over its load. */
const TIER_BUDGET = 8;
/** When even the fast tier would cost more than this on real maps (≥ 3–5 s per mission), textures are not compressed
 * at all: they upload as they always did (the memory of a build without this module, none of the wait). */
const OFF_MS_PER_MTEXEL = 16;
/** Side of the calibration image (noise: every block does all its work). */
const CALIB_SIZE = 1024;

/**
 * The encoder tier for a calibration (the fast tier's GPU time per Mtexel of noise): the highest whose projected cost
 * on real maps fits TIER_BUDGET — 3 × that with a GPU timer, since real maps are then timed as they load (a tier over
 * 1.5 × the budget steps down) and big GPUs, latency-bound on the calibration, look slower there than they are.
 * @param {CodecName} codec @param {number} ms @param {boolean} timer
 * @returns {0|1|2|null} null: too slow even for the fast tier (compression off)
 */
export function chooseTier(codec, ms, timer) {
  const cost = TIER_COST[codec].map((c) => ms * c), limit = timer ? TIER_BUDGET * 3 : TIER_BUDGET;
  if (!(cost[0] <= OFF_MS_PER_MTEXEL)) return null;
  return cost[2] <= limit ? 2 : cost[1] <= limit ? 1 : 0;
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const mult4 = (n) => n >= 4 && n % 4 === 0;
const mipmapped = (f) => f === THREE.LinearMipmapLinearFilter || f === THREE.LinearMipmapNearestFilter || f === THREE.NearestMipmapLinearFilter || f === THREE.NearestMipmapNearestFilter;
/** Run f on a new task right away (a MessageChannel message: no timer clamping). */
const POST = { mc: null, q: [] };
function post(f) {
  if (!POST.mc && typeof MessageChannel !== 'undefined') { POST.mc = new MessageChannel(); POST.mc.port1.onmessage = () => POST.q.shift()?.(); }
  if (!POST.mc) { setTimeout(f, 0); return; }
  POST.q.push(f);
  POST.mc.port2.postMessage(0);
}
const isBitmap = (x) => typeof ImageBitmap !== 'undefined' && x instanceof ImageBitmap;
/** Bytes of source per upload call of a banded upload (engine/slice.js pauses between calls): ~1–3 ms each. */
const BAND_BYTES = 2 << 20;
/** What a banded encode yields between two bands: the pump goes on after the next frame, not at once. */
const BAND_PAUSE = Symbol('band');
/** Bytes per read-back call (made while the GPU is idle: a plain copy). */
const READ_BYTES = 1 << 20;

/**
 * A compression job's blocks back from its pixel buffer once the fence passed: level by level, pausing between (a sliced
 * job), in reads of READ_BYTES or more (each read is a round trip to the GPU process). Deletes the buffer and the fence.
 * @returns {Generator<void, Uint8Array[]>} the levels' blocks (views of one buffer)
 */
function* collectBlocks(stats, gl, pbo, sync, plan, total) {
  const all = new Uint8Array(total);
  for (let a = 0; a < total;) {
    const t0 = performance.now();
    let b = a;
    for (const L of plan) if (L.off >= b && (b === a || L.off + L.bytes - a <= READ_BYTES)) b = L.off + L.bytes;
    if (b <= a) b = total;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, a, all, a, b - a);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    stats.mainMs += performance.now() - t0;
    stats.readMs += performance.now() - t0;
    a = b;
    if (a < total && due()) yield;
  }
  gl.deleteBuffer(pbo);
  gl.deleteSync(sync);
  return plan.map((L) => all.subarray(L.off, L.off + L.bytes));
}
/** Banded uploads on (the one-call three path otherwise: `?gpubands=0` compares). */
const BANDS = SLICED && !(typeof location !== 'undefined' && /[?&]gpubands=0\b/.test(location.search));

/** Pick the codec a WebGL2 context can sample (null = none: textures stay uncompressed). */
export function detectCodec(gl, prefer = null) {
  if (!gl || typeof gl.getExtension !== 'function' || typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return null;
  const has = {
    bc7: !!gl.getExtension(CODECS.bc7.ext),
    astc: (() => { const e = gl.getExtension(CODECS.astc.ext); return !!e && (!e.getSupportedProfiles || e.getSupportedProfiles().includes('ldr')); })(),
  };
  if (prefer) return has[prefer] ? prefer : null;
  return has.bc7 ? 'bc7' : has.astc ? 'astc' : null;
}

/** Bytes of a compressed level (4×4 blocks of 16 bytes). */
export const blockBytes = (w, h) => Math.ceil(w / 4) * Math.ceil(h / 4) * 16;

/** Mip levels three allocates for a mipmapped w×h texture. */
export const mipLevels = (w, h) => Math.floor(Math.log2(Math.max(w, h))) + 1;

/** Upload parameters of a texture that decide its texels (and so its blocks). */
function paramsOf(tex) {
  return {
    srgb: tex.colorSpace === THREE.SRGBColorSpace, colorSpace: tex.colorSpace, flipY: !!tex.flipY,
    premultiplyAlpha: !!tex.premultiplyAlpha, unpackAlignment: tex.unpackAlignment ?? 4,
    mips: tex.generateMipmaps !== false && mipmapped(tex.minFilter),
    weights: tex.userData?.compressWeights || null,
  };
}
const variantKey = (p) => `${p.colorSpace}|${p.flipY ? 1 : 0}|${p.premultiplyAlpha ? 1 : 0}|${p.mips ? 1 : 0}|${p.weights || ''}`;
/** Error weights R, G, B, A: alpha (cut-outs, blending) counts double — its errors move edges. */
const DEFAULT_WEIGHTS = [1, 1, 1, 2];

export class GpuCompressor {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{codec?: CodecName|null, maxPending?: number, sliceMs?: number, tier?: 0|1|2}} [o] codec: force one (tests),
   *   undefined → detect; tier: force an encoder tier (tests, `?gputier=`), undefined → calibrate (see TIER_COST)
   */
  constructor(renderer, o = {}) {
    this.renderer = renderer;
    this.gl = renderer.getContext();
    this.codec = o.codec !== undefined ? detectCodec(this.gl, o.codec || '-') : detectCodec(this.gl);
    this.format = this.codec ? CODECS[this.codec].format : null;
    this.maxPending = o.maxPending ?? 24;
    /** Encoder tier (TIER_COST). Unless forced, `prewarm()` times the fast tier on this GPU and picks the highest one
     * whose projected cost fits TIER_BUDGET (or turns compression off past OFF_MS_PER_MTEXEL); encodes wait for that.
     * Later encodes are timed too where the GPU has a timer (EXT_disjoint_timer_query_webgl2): a tier that costs
     * more than 1.5 × the budget on real maps steps down. */
    this.tier = o.tier ?? 1;
    this.tierAuto = o.tier === undefined;
    this.calibration = null; // {msPerMtexel, timer, tier} once calibrated
    this._calib = null;
    this.timer = { ext: null, ms: 0, mtexels: 0, pending: [] };
    try { this.timer.ext = this.gl.getExtension?.('EXT_disjoint_timer_query_webgl2') || null; } catch { this.timer.ext = null; }
    this.progs = {};
    this.fbo = null; this.rt = null; this.rtSize = [0, 0]; this.vao = null; this.tab = null;
    this.stats = { textures: 0, arrays: 0, levels: 0, bytesIn: 0, bytesOut: 0, mainMs: 0, uploadMs: 0, readMs: 0, failed: 0 }; // mainMs: main-thread time (upload + encode draws + readback copies)
    this._queue = []; // jobs waiting to be issued
    this._inflight = []; // issued, waiting for their fence
    this._tick = false;
    this.sliceMs = o.sliceMs ?? 10;
    /** Texels per encode band (0: a whole level per draw). Set while the game is played (engine/hd-textures.js): the
     *  GPU work of one task stays a few ms, so the frames are not held behind an atlas's encode. */
    this.encodeBand = 0;
    this._jobs = new WeakMap(); // original Source → Map(variant → Promise<{source, mipmaps}|null>)
    const el = renderer.domElement;
    this._onLost = () => { this.progs = {}; this.fbo = this.rt = this.vao = this.tab = this.seedTex = null; this.rtSize = [0, 0]; };
    el?.addEventListener?.('webglcontextlost', this._onLost);
  }

  /** GL internal format of the compressed texture for a colour space. */
  glFormat(srgb) { return this.codec ? CODECS[this.codec].gl[srgb ? 1 : 0] : 0; }

  /** True when this image texture can go compressed (see the module notes). */
  compressible(tex) {
    if (!this.codec || !tex?.isTexture || tex.isCompressedTexture || tex.isRenderTargetTexture || tex.isDepthTexture || tex.isVideoTexture || tex.isCanvasTexture || tex.isCubeTexture || tex.isData3DTexture || tex.isDataTexture || tex.isDataArrayTexture) return false;
    if (tex.userData?.noCompress) return false;
    if ((tex.format ?? THREE.RGBAFormat) !== THREE.RGBAFormat || (tex.type ?? THREE.UnsignedByteType) !== THREE.UnsignedByteType || tex.internalFormat) return false;
    if (tex.magFilter === THREE.NearestFilter || tex.minFilter === THREE.NearestFilter || tex.minFilter === THREE.NearestMipmapNearestFilter) return false;
    const img = tex.image;
    if (!img || (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement)) return false;
    const w = img.width, h = img.height;
    if (!mult4(w) || !mult4(h)) return false;
    const max = this.renderer.capabilities?.maxTextureSize || 4096;
    return w <= max && h <= max;
  }

  /** Same for a layer array (DataArrayTexture with its data). */
  compressibleArray(tex) {
    if (!this.codec || !tex?.isDataArrayTexture || !tex.image?.data || tex.userData?.noCompress) return false;
    const { width: w, height: h } = tex.image;
    return mult4(w) && mult4(h) && tex.type === THREE.UnsignedByteType && tex.format === THREE.RGBAFormat && !tex.internalFormat &&
      tex.magFilter !== THREE.NearestFilter && tex.minFilter !== THREE.NearestFilter;
  }

  /** Start compiling (and linking) the encoder for 2D maps or layer arrays without waiting for the driver. */
  _compile(array, tier = this.tier) {
    const key = `${this.codec}:${array ? 'a' : '2'}:${tier}`;
    if (this.progs[key]) return this.progs[key];
    const gl = this.gl;
    const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); return x; };
    const p = gl.createProgram();
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, CODECS[this.codec].frag(array, tier));
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    return (this.progs[key] = { p, vs, fs, ready: false });
  }

  /** The encoder program (compiled at install time where KHR_parallel_shader_compile lets the driver do it aside). */
  _program(array, tier = this.tier) {
    const prog = this._compile(array, tier), gl = this.gl;
    if (prog.ready) return prog;
    if (!gl.getProgramParameter(prog.p, gl.LINK_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(prog.fs) || gl.getProgramInfoLog(prog.p);
      throw new Error('encoder shader: ' + log);
    }
    gl.deleteShader(prog.vs); gl.deleteShader(prog.fs);
    const u = (n) => gl.getUniformLocation(prog.p, n);
    Object.assign(prog, { ready: true, vs: null, fs: null, uSrc: u('uSrc'), uLevel: u('uLevel'), uLayer: u('uLayer'), uSize: u('uSize'), uSrgb: u('uSrgb'), uTab: u('uTab'), uW: u('uW'), uN: u('uN'), uSeeds: u('uSeeds') });
    return prog;
  }

  /** Compile both encoders in the background (the game installs the compressor at start, long before a mission). */
  prewarm() {
    if (!this.codec || this.gl.isContextLost()) return;
    this.gl.getExtension('KHR_parallel_shader_compile');
    if (this.tierAuto) {
      this._calibrate(); // compiles the tier it picks
      // desktop GPUs (BC7) mostly keep the full tier: have the driver compile it meanwhile
      if (this.codec === 'bc7') { this._compile(false, 2); this._compile(true, 2); }
      return;
    }
    this._compile(false); this._compile(true);
    if (this.codec === 'astc' && this.tier === 2) astcSeedTableAsync();
  }

  /**
   * Time the fast encoder on a CALIB_SIZE² noise image (GPU timer, else fence wall time: best of three) and pick the
   * tier: the highest whose projected cost fits TIER_BUDGET, or none (compression off) past OFF_MS_PER_MTEXEL.
   * @returns {Promise<void>}
   */
  _calibrate() {
    if (this._calib) return this._calib;
    const gl = this.gl, S = CALIB_SIZE;
    const run = async () => {
      const prog = this._compile(false, 0), par = gl.getExtension('KHR_parallel_shader_compile');
      while (par && !gl.isContextLost() && !gl.getProgramParameter(prog.p, par.COMPLETION_STATUS_KHR)) await wait(16);
      if (gl.isContextLost()) throw new Error('context lost');
      const tex = gl.createTexture(), data = new Uint8Array(S * S * 4);
      for (let i = 0, x = 0x9E3779B9; i < data.length; i += 4) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; data[i] = x; data[i + 1] = x >>> 8; data[i + 2] = x >>> 16; data[i + 3] = 255; }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, S, S);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, data);
      this.renderer.resetState();
      let best = Infinity, timed = false;
      try {
        for (let k = 0; k < 3; k++) {
          const r = await this._timeEncode(tex, S);
          if (r.ms < best) { best = r.ms; timed = r.timer; }
        }
      } finally { if (!gl.isContextLost()) gl.deleteTexture(tex); }
      const ms = best / (S * S / 1e6), tier = chooseTier(this.codec, ms, !!this.timer.ext);
      this.calibration = { msPerMtexel: +ms.toFixed(2), timer: timed, tier };
      if (tier === null) {
        console.info(`[gpu-compress] ${this.codec}: fast encoder ${ms.toFixed(1)} ms per Mtexel of noise (≈ ${(ms * TIER_COST[this.codec][0]).toFixed(0)} on real maps): too slow here, textures stay uncompressed`);
        this.codec = null; this.format = null;
        return;
      }
      this.tier = tier;
      if (!this.timer.ext) this.tierAuto = false; // nothing to time real maps with: decided
      console.info(`[gpu-compress] ${this.codec}: fast encoder ${ms.toFixed(2)} ms per Mtexel of noise (${timed ? 'GPU timer' : 'wall time'}) → tier ${tier}`);
      this._compile(false); this._compile(true);
      if (this.codec === 'astc' && tier === 2) await astcSeedTableAsync();
    };
    this._calib = run().catch((e) => {
      this.tier = 0; this.tierAuto = false;
      console.warn('[gpu-compress] calibration failed, fast tier:', e?.message || e);
    }).finally(() => { this._calibrated = true; this._kick(); });
    return this._calib;
  }

  /** One timed encode of level 0 of a CALIB texture with the fast tier. @returns {Promise<{ms: number, timer: boolean}>} */
  async _timeEncode(tex, S) {
    const gl = this.gl, T = this.timer;
    let q = null;
    try { if (T.ext && !gl.getQuery(T.ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) { q = gl.createQuery(); gl.beginQuery(T.ext.TIME_ELAPSED_EXT, q); } } catch { q = null; }
    const t0 = performance.now();
    let job;
    try { job = this._encodeGl(tex, { w: S, h: S, levels: 1, srgb: false, tier: 0, timed: false }); } finally {
      if (q) gl.endQuery(T.ext.TIME_ELAPSED_EXT);
      this.renderer.resetState();
    }
    // fence wall time: polled on fresh tasks (a fence's status only changes between tasks)
    for (;;) {
      await new Promise((ok) => post(ok));
      if (gl.isContextLost()) throw new Error('context lost');
      const st = gl.clientWaitSync(job.sync, 0, 0);
      if (st === gl.WAIT_FAILED) { job.fail(); throw new Error('wait failed'); }
      if (st !== gl.TIMEOUT_EXPIRED) break;
      if (performance.now() - t0 > 5000) break;
    }
    const wall = performance.now() - t0;
    job.fail(); // frees the readback buffer and the fence; the blocks are not needed
    if (q) {
      for (let i = 0; i < 200 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); i++) await wait(5);
      const ok = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(T.ext.GPU_DISJOINT_EXT);
      const ns = ok ? gl.getQueryParameter(q, gl.QUERY_RESULT) : 0;
      gl.deleteQuery(q);
      if (ok && ns > 0) return { ms: ns / 1e6, timer: true };
    }
    return { ms: wall, timer: false };
  }

  _target(bw, bh) {
    const gl = this.gl;
    if (!this.fbo) this.fbo = gl.createFramebuffer();
    if (this.rtSize[0] < bw || this.rtSize[1] < bh) {
      if (this.rt) gl.deleteTexture(this.rt);
      const w = Math.max(bw, this.rtSize[0]), h = Math.max(bh, this.rtSize[1]);
      this.rt = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.rt);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32UI, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.rt, 0);
      this.rtSize = [w, h];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
  }

  _tables() {
    if (this.tab) return this.tab;
    const gl = this.gl;
    this.tab = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tab);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8UI, 256, ASTC_TABLE_ROWS, 0, gl.RG_INTEGER, gl.UNSIGNED_BYTE, astcTables());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return this.tab;
  }

  /** The two-partition seed table as a 256 × 256 RG8UI texture (astcSeedTable). */
  _seeds() {
    if (this.seedTex) return this.seedTex;
    const gl = this.gl;
    this.seedTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.seedTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8UI, 256, 256, 0, gl.RG_INTEGER, gl.UNSIGNED_BYTE, astcSeedTable());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return this.seedTex;
  }

  /**
   * Issue the encode of every level (and layer) of an uploaded GL texture: draws + readPixels into a pixel buffer.
   * @returns {{sync: WebGLSync, collect: () => Uint8Array[], fail: () => void}} collect (once the fence passed): per
   *   level its blocks (layer arrays: every layer of the level in order)
   */
  _encodeGl(glTex, o) {
    const g = this._encodeGlG(glTex, { ...o, bandTexels: 0 });
    let r = g.next();
    while (!r.done) r = g.next();
    return r.value;
  }

  /**
   * _encodeGl as a generator. `bandTexels` > 0 (the HD upgrades while the game is played: `encodeBand`): the encode
   * draws are cut into bands of block rows (scissored, each read back to its own rows of the pixel buffer) of about
   * that many texels, and it yields after each — the pump's next task, after the page drew a frame. One draw over a
   * 2048² atlas's mip chain is ~5.6 Mtexels: up to ~130 ms of GPU at the full tier, which every frame queued behind it
   * waited for (M12's walkthrough, the first minute of play: 60-100 ms frames every few seconds). The same blocks.
   */
  *_encodeGlG(glTex, { w, h, levels, layers = 0, srgb, weights = null, tier = this.tier, timed = true, bandTexels = 0 }) {
    const gl = this.gl, array = layers > 0, nz = Math.max(1, layers);
    const prog = this._program(array, tier);
    const plan = [];
    let total = 0;
    for (let l = 0; l < levels; l++) {
      const lw = Math.max(1, w >> l), lh = Math.max(1, h >> l), per = blockBytes(lw, lh);
      plan.push({ lw, lh, bw: Math.ceil(lw / 4), bh: Math.ceil(lh / 4), off: total, per, bytes: per * nz });
      total += per * nz;
    }
    const pbo = gl.createBuffer();
    // (all the state the draws need: set again after each pause — three drew frames in between)
    const setup = () => {
      this._target(plan[0].bw, plan[0].bh);
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.disable(gl.POLYGON_OFFSET_FILL); gl.disable(gl.RASTERIZER_DISCARD);
      gl.colorMask(true, true, true, true);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      if (!this.vao) this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.useProgram(prog.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(array ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D, glTex);
      gl.uniform1i(prog.uSrc, 0);
      gl.uniform1i(prog.uSrgb, srgb ? 1 : 0);
      const W = weights || DEFAULT_WEIGHTS;
      gl.uniform4f(prog.uW, W[0], W[1], W[2], W[3]);
      gl.uniform1i(prog.uN, 16);
      if (this.codec === 'astc') {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._tables()); gl.uniform1i(prog.uTab, 1);
        if (tier === 2) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this._seeds()); gl.uniform1i(prog.uSeeds, 2); }
        gl.activeTexture(gl.TEXTURE0);
      }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
      gl.pixelStorei(gl.PACK_ROW_LENGTH, 0);
      gl.pixelStorei(gl.PACK_SKIP_ROWS, 0);
      gl.pixelStorei(gl.PACK_SKIP_PIXELS, 0);
    };
    setup();
    gl.bufferData(gl.PIXEL_PACK_BUFFER, total, gl.STREAM_READ);
    const banded = bandTexels > 0;
    // (a timing spans one go: banded encodes — frames drawn between their bands — are not timed)
    const tq = timed && !banded ? this._timerBegin(plan.reduce((a, L) => a + L.lw * L.lh * nz, 0) / 1e6, tier) : null;
    let acc = 0;
    for (let l = 0; l < plan.length; l++) {
      const L = plan[l];
      // block rows per band (whole levels when not banded)
      const rows = banded ? Math.max(1, Math.min(L.bh, Math.floor(bandTexels / (L.bw * 16)))) : L.bh;
      for (let z = 0; z < nz; z++) {
        for (let r0 = 0; r0 < L.bh; r0 += rows) {
          const n = Math.min(rows, L.bh - r0);
          gl.uniform1i(prog.uLevel, l);
          gl.uniform2i(prog.uSize, L.lw, L.lh);
          if (array) gl.uniform1i(prog.uLayer, z);
          gl.viewport(0, 0, L.bw, L.bh);
          if (n < L.bh) { gl.enable(gl.SCISSOR_TEST); gl.scissor(0, r0, L.bw, n); }
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          if (n < L.bh) gl.disable(gl.SCISSOR_TEST);
          gl.readPixels(0, r0, L.bw, n, gl.RGBA_INTEGER, gl.UNSIGNED_INT, L.off + z * L.per + r0 * L.bw * 16);
          acc += L.bw * n * 16;
          const more = r0 + n < L.bh || z + 1 < nz || l + 1 < plan.length;
          if (banded && more && acc >= bandTexels) {
            acc = 0;
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            gl.flush();
            this.renderer.resetState(); // three's cached GL state no longer matches
            yield BAND_PAUSE; // (the pump: the next band after the page drew a frame)
            setup();
          }
        }
      }
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    if (tq) gl.endQuery(this.timer.ext.TIME_ELAPSED_EXT);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    // the blocks back from the pixel buffer once the fence passed: level by level, pausing between (a sliced job)
    // (in reads of READ_BYTES or more: each read is a round trip to the GPU process — one per level costs more than it saves)
    // (one module generator, not a generator function made per job: each of those brought a prototype object of its own
    // that V8 set up as a prototype — a fresh hidden class per job for the code that steps it)
    const collectG = () => collectBlocks(this.stats, gl, pbo, sync, plan, total);
    const collect = () => { const g = collectG(); let r = g.next(); while (!r.done) r = g.next(); return r.value; };
    return { sync, collect, collectG, fail: () => { if (!gl.isContextLost()) { gl.deleteBuffer(pbo); gl.deleteSync(sync); } } };
  }

  /** Time this encode on the GPU while the tier is being checked on real maps (null: not timing). */
  _timerBegin(mtexels, tier) {
    const T = this.timer, gl = this.gl;
    this._timerPoll();
    if (!this.tierAuto || !T.ext || T.pending.length > 4) return null;
    try {
      if (gl.getQuery(T.ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return null; // someone else is timing
      const q = gl.createQuery();
      gl.beginQuery(T.ext.TIME_ELAPSED_EXT, q);
      T.pending.push({ q, mtexels, tier });
      return q;
    } catch { return null; }
  }

  /** Collect finished timings; past ~8 Mtexels at one tier, step down if it costs more than 1.5 × TIER_BUDGET. */
  _timerPoll() {
    const T = this.timer, gl = this.gl;
    if (!T.ext || !T.pending.length || gl.isContextLost()) return;
    const disjoint = gl.getParameter(T.ext.GPU_DISJOINT_EXT);
    T.pending = T.pending.filter(({ q, mtexels, tier }) => {
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true;
      if (!disjoint && tier === this.tier) { T.ms += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; T.mtexels += mtexels; }
      gl.deleteQuery(q);
      return false;
    });
    if (this.tierAuto && this._calibrated && T.mtexels >= 8) {
      const rate = T.ms / T.mtexels;
      T.ms = 0; T.mtexels = 0;
      if (rate > TIER_BUDGET * 1.5 && this.tier > 0) {
        this.tier--;
        console.info(`[gpu-compress] ${rate.toFixed(1)} ms per Mtexel on real maps: tier ${this.tier} from now on`);
        this._compile(false); this._compile(true);
      } else this.tierAuto = false; // within the budget: decided
    }
  }

  /**
   * A sliced job (engine/slice.js): the source uploaded into a temporary texture a band at a time (rows of an image,
   * layers / rows of an array: ≤ BAND_BYTES per call, the page drawing between them), then its levels encoded. The
   * same texels as three's own upload: the same internal format (SRGB8_ALPHA8 / RGBA8), the same storage levels, an
   * ImageBitmap's pixels as they are (WebGL ignores the flip / premultiply flags for it; <img> sources arrive converted
   * by encodeImage with those flags), an array's bytes; generateMipmap over the finished level 0.
   * @returns {Generator<void, {sync, collect, collectG, fail}>}
   */
  *_issueBands(src, { w, h, layers = 0, srgb, mips, weights = null, alignment = 4 }) {
    const gl = this.gl, r = this.renderer, array = layers > 0, target = array ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D;
    const levels = mips ? mipLevels(w, h) : 1, fmt = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;
    const tex = gl.createTexture();
    try {
      const bind = () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(target, tex);
        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, alignment);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
      };
      // (our state is set again after each pause — three may have drawn in between — and three's cache resynced before it)
      const unbind = () => { gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0); r.resetState(); };
      bind();
      if (array) gl.texStorage3D(target, levels, fmt, w, h, layers); else gl.texStorage2D(target, levels, fmt, w, h);
      const rows = Math.max(4, Math.min(h, Math.floor(BAND_BYTES / (w * 4)) & ~3));
      let bound = true;
      for (let z = 0; z < Math.max(1, layers); z++) {
        for (let y = 0; y < h; y += rows) {
          const t0 = performance.now(), n = Math.min(rows, h - y);
          if (!bound) { bind(); bound = true; }
          if (array) gl.texSubImage3D(target, 0, 0, y, z, w, n, 1, gl.RGBA, gl.UNSIGNED_BYTE, src, (z * h + y) * w * 4);
          else { gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y); gl.texSubImage2D(target, 0, 0, y, w, n, gl.RGBA, gl.UNSIGNED_BYTE, src); }
          const dt = performance.now() - t0;
          this.stats.uploadMs += dt; this.stats.mainMs += dt;
          if ((y + rows < h || z + 1 < layers) && due()) { unbind(); bound = false; yield; }
        }
      }
      if (!bound) bind();
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      const t1 = performance.now();
      if (mips) gl.generateMipmap(target);
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const job = yield* this._encodeGlG(tex, { w, h, levels, layers, srgb, weights, bandTexels: this.encodeBand || 0 });
      this.stats.mainMs += performance.now() - t1;
      return job;
    } finally {
      if (!gl.isContextLost()) gl.deleteTexture(tex); // (the encode draws keep it alive until they ran)
      r.resetState(); // three's cached GL state no longer matches: let it bind everything again
    }
  }

  /**
   * Upload `tmp` through three (its own path: flags, internal format, generated mips), encode its levels, dispose it.
   * @returns {{sync, collect, fail}}
   */
  _issue(tmp, { w, h, layers = 0, srgb, mips, weights = null }) {
    const r = this.renderer, t0 = performance.now();
    try {
      r.initTexture(tmp);
      this.stats.uploadMs += performance.now() - t0;
      const glTex = r.properties.get(tmp).__webglTexture;
      if (!glTex) throw new Error('no upload');
      return this._encodeGl(glTex, { w, h, levels: mips ? mipLevels(w, h) : 1, layers, srgb, weights });
    } finally {
      tmp.dispose();
      r.resetState(); // three's cached GL state no longer matches: let it bind everything again
      this.stats.mainMs += performance.now() - t0;
    }
  }

  /**
   * Queue a job: `issue()` does its synchronous GL work (upload, encode draws, readPixels into a buffer) when the pump
   * gets to it; its blocks come back once its fence has passed. The pump issues jobs in ~10 ms slices (the page stays
   * responsive) with up to maxPending readbacks in flight, and one poller collects every finished fence.
   * @returns {Promise<Uint8Array[]>}
   */
  _schedule(issue) {
    return new Promise((resolve, reject) => { this._queue.push({ issue, resolve, reject }); this._kick(); });
  }

  _kick(delay = -1) {
    if (this._tick) return;
    this._tick = true;
    const go = () => { this._tick = false; this._run(); };
    // (more to do at once: the next task once the page has drawn a frame when one is due — engine/slice.js)
    // ('frame': after the next frame the page draws — a banded encode issues one band per frame, so the GPU queue never
    // holds more than a band ahead of a frame; a hidden page draws none: a timer then)
    if (delay === 'frame') {
      if (typeof requestAnimationFrame === 'function' && !(typeof document !== 'undefined' && document.hidden)) requestAnimationFrame(() => post(go));
      else setTimeout(go, 16);
    } else if (delay < 0) { if (SLICED) nextTask().then(go); else post(go); } else setTimeout(go, delay);
  }

  /** The pump as it was before the responsive load (`?sliced=0` A/B): read-backs as soon as each fence passed. */
  _runClassic(gl, hidden) {
    for (let i = 0; i < this._inflight.length;) {
      const j = this._inflight[i];
      const st = gl.clientWaitSync(j.sync, 0, 0);
      if (st === gl.TIMEOUT_EXPIRED && !hidden && performance.now() - j.t0 < 3000) { i++; continue; }
      this._inflight.splice(i, 1);
      if (st === gl.WAIT_FAILED) { j.fail(); j.reject(new Error('wait failed')); continue; }
      try { j.resolve(j.collect()); } catch (e) { j.fail(); j.reject(e); }
    }
    const t0 = performance.now();
    while (this._queue.length && this._inflight.length < this.maxPending && performance.now() - t0 < this.sliceMs) {
      const q = this._queue.shift();
      try { this._inflight.push({ ...q.issue(), resolve: q.resolve, reject: q.reject, t0: performance.now() }); } catch (e) { q.reject(e); }
    }
    if (this._queue.length && this._inflight.length < this.maxPending) this._kick(); // more to issue: after a yield
    else if (this._inflight.length || this._queue.length) this._kick(1); // waiting on the GPU
    else this._idleSoon();
  }

  _run() {
    const gl = this.gl;
    if (this.tierAuto && !this._calibrated) { // the tier is still being picked (prewarm): go on when it is
      this._calibrate();
      return;
    }
    if (!this.codec) { // calibration turned compression off: what was queued stays uncompressed
      for (const j of this._queue) j.reject(Object.assign(new Error('compression off on this GPU'), { off: true }));
      this._queue = [];
      return;
    }
    if (this.codec === 'astc' && this.tier === 2 && !SEEDS) { // the two-partition table is still being built: go on when it is
      if (!this._seedWait) this._seedWait = astcSeedTableAsync().then(() => { this._seedWait = null; this._kick(); });
      return;
    }
    if (gl.isContextLost()) {
      for (const j of [...this._inflight, ...this._queue, ...(this._current ? [this._current.q] : [])]) j.reject(new Error('context lost'));
      this._inflight = []; this._queue = []; this._current = null;
      return;
    }
    const hidden = typeof document !== 'undefined' && document.hidden; // timers crawl there: read back at once
    if (!SLICED) { this._runClassic(gl, hidden); return; }
    const t0 = performance.now(), left = () => this.sliceMs - (performance.now() - t0);
    // 1. read-backs, only while the GPU has nothing of ours queued: a read waits behind every command issued before it
    //    (reading one job while the next ones' encodes were queued held the page 50–80 ms a read). Fences pass in
    //    order, so the last one issued tells for all of them; then they are read in order, a slice at a time, and no
    //    new encode is issued until they are all read.
    let reading = false, gpuIdle = true, bandWait = false;
    const last = this._inflight[this._inflight.length - 1];
    if (last && !last.passed) {
      const st = gl.clientWaitSync(last.sync, 0, 0);
      if (st === gl.WAIT_FAILED) {
        for (const j of this._inflight.splice(0)) { j.fail(); j.reject(new Error('wait failed')); }
      } else last.passed = st !== gl.TIMEOUT_EXPIRED || hidden || performance.now() - last.t0 > 3000;
      gpuIdle = !this._inflight.length || last.passed;
    }
    while (gpuIdle && this._inflight.length && left() > 0) {
      const j = this._inflight[0];
      j.reader ||= j.collectG ? j.collectG() : (function* () { return j.collect(); })();
      let res;
      try { res = stepFor(j.reader, left()); } catch (e) { this._inflight.shift(); j.fail(); j.reject(e); continue; }
      if (!res.done) break; // its slice is used: on with it next time
      this._inflight.shift();
      j.resolve(res.value);
    }
    if (gpuIdle && this._inflight.length) reading = true;
    // 2. the job being uploaded (a band at a time), then the next ones
    while (!reading && (this._current || this._queue.length) && this._inflight.length < this.maxPending && left() > 0) {
      if (!this._current) {
        const q = this._queue.shift();
        let it;
        try { it = q.issue(); } catch (e) { q.reject(e); continue; }
        this._current = { q, gen: it && typeof it.next === 'function' ? it : null, done: it && typeof it.next === 'function' ? null : it };
      }
      const c = this._current;
      if (c.gen) {
        let res;
        try { res = stepFor(c.gen, left()); } catch (e) { this._current = null; c.q.reject(e); continue; }
        if (!res.done) { if (res.value === BAND_PAUSE) bandWait = true; break; } // its slice is used (or a band issued)
        c.done = res.value;
      }
      this._current = null;
      this._inflight.push({ ...c.done, resolve: c.q.resolve, reject: c.q.reject, t0: performance.now() });
    }
    if (bandWait && !reading) this._kick('frame'); // a band of a banded encode issued: the next one after a frame
    else if (reading || ((this._current || this._queue.length) && this._inflight.length < this.maxPending)) this._kick(); // more to do: after a yield
    else if (this._inflight.length || this._queue.length || this._current) this._kick(1); // waiting on the GPU
    else this._idleSoon();
  }

  /** Nothing left to encode: free the block target (sized for the largest map: MBs) once the pump has been idle a moment. */
  _idleSoon() {
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => {
      if (this._queue.length || this._inflight.length || this._current || this._tick || !this.rt || this.gl.isContextLost()) return;
      // the framebuffer goes too: a texture still attached to an unbound framebuffer would stay allocated
      if (this.fbo) this.gl.deleteFramebuffer(this.fbo);
      this.gl.deleteTexture(this.rt);
      this.fbo = this.rt = null; this.rtSize = [0, 0];
    }, 1500);
  }

  /** Resolves once every queued encode and readback has finished. */
  async idle() {
    while (this._queue.length || this._inflight.length || this._current || this._tick) await new Promise((ok) => setTimeout(ok, 4));
  }

  /** Temporary three texture for an image with the given upload parameters. */
  _tmpImage(image, p) {
    const tmp = new THREE.Texture(image);
    tmp.flipY = p.flipY; tmp.premultiplyAlpha = p.premultiplyAlpha; tmp.unpackAlignment = p.unpackAlignment; tmp.colorSpace = p.colorSpace;
    tmp.minFilter = p.mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    tmp.magFilter = THREE.LinearFilter;
    tmp.generateMipmaps = p.mips;
    tmp.anisotropy = 1;
    tmp.needsUpdate = true;
    return tmp;
  }

  _tmpArray(data, w, h, d, p) {
    const tmp = new THREE.DataArrayTexture(data, w, h, d);
    tmp.colorSpace = p.colorSpace; tmp.unpackAlignment = p.unpackAlignment;
    tmp.minFilter = p.mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    tmp.magFilter = THREE.LinearFilter;
    tmp.generateMipmaps = p.mips;
    tmp.needsUpdate = true;
    return tmp;
  }

  /**
   * Encode an image (ImageBitmap / <img> / ImageData-like) with upload parameters `p`. An ImageBitmap uploads a band of
   * rows at a time (_issueBands); an <img> is first turned into one with the upload's flags (flip, premultiply, colour
   * conversion: what WebGL would apply to it), off the main thread; anything else goes through three in one call.
   * @returns {Promise<Uint8Array[]>}
   */
  encodeImage(image, p) {
    const o = { w: image.width, h: image.height, srgb: p.srgb, mips: p.mips, weights: p.weights, alignment: p.unpackAlignment ?? 4 };
    if (isBitmap(image) && BANDS) return this._schedule(() => this._issueBands(image, o));
    if (BANDS && typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement && typeof createImageBitmap === 'function') {
      // (three's own choice for an <img>: no colour conversion unless the texture's primaries differ from the working space's)
      const CM = THREE.ColorManagement;
      const none = p.colorSpace === THREE.NoColorSpace || CM.getPrimaries(CM.workingColorSpace) === CM.getPrimaries(p.colorSpace);
      return createImageBitmap(image, {
        imageOrientation: p.flipY ? 'flipY' : 'from-image', premultiplyAlpha: p.premultiplyAlpha ? 'premultiply' : 'none',
        colorSpaceConversion: none ? 'none' : 'default',
      }).then((bm) => this._schedule(() => this._issueBands(bm, o)).finally(() => bm.close?.()),
        () => this._schedule(() => this._issue(this._tmpImage(image, p), o)));
    }
    return this._schedule(() => this._issue(this._tmpImage(image, p), o));
  }

  /** Encode a layer array's data (a layer — or a band of its rows — at a time). @returns {Promise<Uint8Array[]>} */
  encodeArray(data, w, h, d, p) {
    if (BANDS && data instanceof Uint8Array) return this._schedule(() => this._issueBands(data, { w, h, layers: d, srgb: p.srgb, mips: p.mips, weights: p.weights, alignment: p.unpackAlignment ?? 4 }));
    return this._schedule(() => this._issue(this._tmpArray(data, w, h, d, p), { w, h, layers: d, srgb: p.srgb, mips: p.mips, weights: p.weights }));
  }

  /**
   * Compress an image texture in place before anything draws it (it becomes a CompressedTexture: same object, so
   * materials, caches and later clones keep working). Textures sharing one image share the result.
   * @param {THREE.Texture} tex image texture with its final colorSpace / flipY / filters, not uploaded yet
   * @param {{reload?: () => Promise<any>}} [o] reload: resolves to an image like tex.image (an upload without the
   *   released levels — a restored context, another sampler — encodes them again from it)
   * @returns {Promise<THREE.Texture>} the same object (compressed, or unchanged when it could not be)
   */
  compress(tex, o = {}) {
    if (tex?.isCompressedTexture || !this.compressible(tex)) return Promise.resolve(tex);
    const src = tex.source, p = paramsOf(tex), key = variantKey(p);
    let byVariant = this._jobs.get(src);
    if (!byVariant) this._jobs.set(src, (byVariant = new Map()));
    let job = byVariant.get(key);
    if (!job) {
      const image = tex.image, w = image.width, h = image.height;
      job = this.encodeImage(image, p).then((data) => {
        const mipmaps = data.map((d, l) => ({ data: d, width: Math.max(1, w >> l), height: Math.max(1, h >> l) }));
        const source = new TextureSource({ width: w, height: h });
        this.stats.textures++; this.stats.levels += data.length;
        this.stats.bytesIn += w * h * 4 * (p.mips ? 4 / 3 : 1); this.stats.bytesOut += data.reduce((a, x) => a + x.byteLength, 0);
        const reload = o.reload ? () => o.reload().then((img) => this.encodeImage(img, p).finally(() => { if (img !== image && isBitmap(img)) img.close?.(); })) : null;
        COMPRESSED_HOOKS.track?.(source, { reload });
        return { source, mipmaps };
      }).catch((e) => {
        this.stats.failed++;
        if (!this.gl.isContextLost() && !e?.off) console.warn('[gpu-compress] kept uncompressed:', e?.message || e);
        return null;
      });
      byVariant.set(key, job);
    }
    return job.then((res) => {
      if (res && tex.source === src && !tex.isCompressedTexture) applyCompressed(tex, this.format, res);
      return tex;
    });
  }

  /**
   * Compress a layer array (DataArrayTexture with its data) in place into a CompressedArrayTexture.
   * @param {{reload?: () => Promise<{data: Uint8Array}>}} [o] reload: the array's data again (restored context)
   * @returns {Promise<THREE.Texture>}
   */
  compressArray(tex, o = {}) {
    if (!this.compressibleArray(tex)) return Promise.resolve(tex);
    const p = paramsOf(tex), img = tex.image;
    p.flipY = false; p.premultiplyAlpha = false;
    const job = { src: tex.source };
    return this.encodeArray(img.data, img.width, img.height, img.depth, p).then((levels) => {
      if (!tex.isDataArrayTexture || tex.source !== job.src) return tex;
      this.stats.arrays++; this.stats.levels += levels.length;
      this.stats.bytesIn += img.width * img.height * img.depth * 4 * (p.mips ? 4 / 3 : 1); this.stats.bytesOut += levels.reduce((a, x) => a + x.byteLength, 0);
      this._finishArray(tex, levels, p, o.reload);
      return tex;
    }).catch((e) => {
      this.stats.failed++;
      if (!this.gl.isContextLost() && !e?.off) console.warn('[gpu-compress] array kept uncompressed:', e?.message || e);
      return tex;
    });
  }

  /** (Own scope: the reload closure must not keep the decoded array alive.) */
  _finishArray(tex, levels, p, reloadData) {
    const { width: w, height: h, depth: d } = tex.image;
    const mipmaps = levels.map((x, l) => ({ data: x, width: Math.max(1, w >> l), height: Math.max(1, h >> l) }));
    const source = new TextureSource({ width: w, height: h, depth: d });
    const reload = reloadData ? () => reloadData().then((r) => this.encodeArray(r?.data ?? r?.image?.data, w, h, d, p)) : null;
    COMPRESSED_HOOKS.track?.(source, { reload });
    applyCompressedArray(tex, this.format, { source, mipmaps });
  }

  /**
   * Encode a render target's colour texture (level 0) into a new compressed texture (same colour space, filters and
   * wraps) — atlases baked once at load (tree impostors): the caller swaps it in and disposes the target, colour and
   * depth. Its level leaves page memory after the upload (nothing can bake it again from here: like the target itself,
   * it is lost with a lost context).
   * @returns {Promise<THREE.Texture|null>} null: not possible here (no codec, odd size, not allocated, lost context)
   */
  compressTarget(rt) {
    const tex = rt?.texture, w = rt?.width, h = rt?.height;
    if (!this.codec || !tex || !mult4(w) || !mult4(h) || tex.type !== THREE.UnsignedByteType || tex.format !== THREE.RGBAFormat) return Promise.resolve(null);
    const glTex = this.renderer.properties.get(tex).__webglTexture;
    if (!glTex) return Promise.resolve(null);
    const srgb = tex.colorSpace === THREE.SRGBColorSpace;
    return this._schedule(() => {
      try { return this._encodeGl(glTex, { w, h, levels: 1, srgb, weights: tex.userData?.compressWeights || null }); } finally { this.renderer.resetState(); }
    }).then(([data]) => {
      const source = new TextureSource({ width: w, height: h });
      const out = new GpuCompressedTexture([{ data, width: w, height: h }], w, h, this.format);
      out.source = source;
      for (const k of ['colorSpace', 'minFilter', 'magFilter', 'wrapS', 'wrapT', 'anisotropy', 'name']) out[k] = tex[k];
      out.generateMipmaps = false; out.flipY = false;
      out.userData.gpuCompressed = true;
      out.needsUpdate = true;
      COMPRESSED_HOOKS.track?.(source, { reload: null, drop: true });
      this.stats.textures++; this.stats.levels++; this.stats.bytesIn += w * h * 4; this.stats.bytesOut += data.byteLength;
      return out;
    }).catch((e) => {
      this.stats.failed++;
      if (!this.gl.isContextLost() && !e?.off) console.warn('[gpu-compress] target kept as it is:', e?.message || e);
      return null;
    });
  }

  dispose() {
    const gl = this.gl;
    this.renderer.domElement?.removeEventListener?.('webglcontextlost', this._onLost);
    if (!gl.isContextLost()) {
      const par = gl.getExtension('KHR_parallel_shader_compile');
      for (const p of Object.values(this.progs)) {
        // a program still linking is left to the context (deleting it then makes Chrome query a deleted object)
        if (!p.ready && par && !gl.getProgramParameter(p.p, par.COMPLETION_STATUS_KHR)) continue;
        if (p.vs) { gl.deleteShader(p.vs); gl.deleteShader(p.fs); }
        gl.deleteProgram(p.p);
      }
      if (this.rt) gl.deleteTexture(this.rt);
      if (this.tab) gl.deleteTexture(this.tab);
      if (this.seedTex) gl.deleteTexture(this.seedTex);
      if (this.fbo) gl.deleteFramebuffer(this.fbo);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this._onLost();
  }
}

// ------------------------------------------------------------------ compressed texture classes

/**
 * Hooks set by engine/texture-memory.js: `track(source, {reload})` when a compressed source is made,
 * `upload(texture)` after three uploaded a compressed texture (releases the CPU levels / refills them).
 */
export const COMPRESSED_HOOKS = { track: null, upload: null };

/** three assigns `this.onUpdate = null` in the constructor: an accessor here survives that, so every clone of a
 * compressed texture (they are made with `new this.constructor()`) reports its uploads too. */
function uploadAccessor(proto) {
  Object.defineProperty(proto, 'onUpdate', {
    configurable: true,
    get() {
      const own = this._ownOnUpdate;
      return (t) => { own?.call(this, t); COMPRESSED_HOOKS.upload?.(t); };
    },
    set(v) { this._ownOnUpdate = v || null; },
  });
}
export class GpuCompressedTexture extends THREE.CompressedTexture {}
export class GpuCompressedArrayTexture extends THREE.CompressedArrayTexture {}
uploadAccessor(GpuCompressedTexture.prototype);
uploadAccessor(GpuCompressedArrayTexture.prototype);

const KEEP = new WeakSet(); // sources whose decoded image other (uncompressed) textures still upload

/** Keep `source`'s decoded image open when textures sharing it go compressed (a sibling texture stays plain). */
export function keepImage(source) { if (source) KEEP.add(source); }

/** Turn an image texture into a compressed one in place (same object identity). */
export function applyCompressed(tex, format, { source, mipmaps }) {
  const old = KEEP.has(tex.source) ? null : tex.source?.data;
  const own = Object.prototype.hasOwnProperty.call(tex, 'onUpdate') ? tex.onUpdate : null;
  delete tex.onUpdate; // the class accessor takes over (keeps the old hook as the texture's own)
  Object.setPrototypeOf(tex, GpuCompressedTexture.prototype);
  if (own) tex.onUpdate = own;
  tex.isCompressedTexture = true;
  tex.source = source;
  tex.mipmaps = mipmaps;
  tex.format = format;
  tex.type = THREE.UnsignedByteType;
  tex.generateMipmaps = false;
  tex.flipY = false; // the blocks hold the uploaded (already flipped) texels
  tex.premultiplyAlpha = false;
  tex.userData.gpuCompressed = true;
  tex.needsUpdate = true;
  if (typeof ImageBitmap !== 'undefined' && old instanceof ImageBitmap) old.close?.();
  return tex;
}

/** Turn a DataArrayTexture into a compressed array in place. */
export function applyCompressedArray(tex, format, { source, mipmaps }) {
  const own = Object.prototype.hasOwnProperty.call(tex, 'onUpdate') ? tex.onUpdate : null;
  delete tex.onUpdate;
  Object.setPrototypeOf(tex, GpuCompressedArrayTexture.prototype);
  if (own) tex.onUpdate = own;
  tex.isCompressedTexture = true;
  tex.isCompressedArrayTexture = true;
  tex.isDataArrayTexture = false;
  tex.layerUpdates ||= new Set();
  tex.wrapR ??= THREE.ClampToEdgeWrapping;
  tex.source = source;
  tex.mipmaps = mipmaps;
  tex.format = format;
  tex.type = THREE.UnsignedByteType;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.premultiplyAlpha = false;
  tex.userData.gpuCompressed = true;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------------ the game's instance

let INSTANCE = null;

/** Create the compressor for the game's renderer (engine/renderer.js). `?gpucompress=0` turns it off (A/B checks),
 * `?gpucompress=astc|bc7` forces a codec, `?gputier=0|1|2` forces an encoder tier (TIER_COST; A/B checks on a busy
 * test GPU, whose calibration varies with the load). */
export function installGpuCompressor(renderer, o = {}) {
  try {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    const flag = q?.get('gpucompress');
    INSTANCE?.dispose?.();
    INSTANCE = null;
    if (flag === '0' || o.enabled === false) return null;
    const codec = flag && flag !== '1' ? flag : o.codec;
    const tier = q?.get('gputier') ?? (o.tier !== undefined ? String(o.tier) : null);
    const c = new GpuCompressor(renderer, { ...(codec !== undefined ? { codec } : {}), ...(/^[012]$/.test(tier || '') ? { tier: Number(tier) } : {}) });
    INSTANCE = c.codec ? c : null;
    INSTANCE?.prewarm(); // the driver compiles the encoders while the menu is up
  } catch (e) {
    console.warn('[gpu-compress] disabled:', e?.message || e);
    INSTANCE = null;
  }
  return INSTANCE;
}

/** The game's compressor (null: not installed, turned off, or no BC7 / ASTC on this device). */
export const gpuCompressor = () => (INSTANCE?.codec ? INSTANCE : null);

/** Resolves once the game's compressor has picked its encoder tier (the calibration): the compressor, or null. */
export async function gpuCompressorReady() {
  if (INSTANCE?.tierAuto && !INSTANCE._calibrated) await INSTANCE._calibrate();
  return gpuCompressor();
}

/** The game compressor's calibration ({msPerMtexel, timer, tier}; tier null = compression off), null if none ran. */
export const gpuCompressorCalibration = () => INSTANCE?.calibration ?? null;

/** Compress a render target's colour texture with the game's compressor (null: none, or not possible). */
export function compressRenderTarget(rt) { return INSTANCE ? INSTANCE.compressTarget(rt) : Promise.resolve(null); }

/** Compress `tex` with the game's compressor when there is one (else resolves to it unchanged). */
export function compressTexture(tex, o) { return INSTANCE ? INSTANCE.compress(tex, o) : Promise.resolve(tex); }

/** Same for a DataArrayTexture. */
export function compressArrayTexture(tex, o) { return INSTANCE ? INSTANCE.compressArray(tex, o) : Promise.resolve(tex); }
