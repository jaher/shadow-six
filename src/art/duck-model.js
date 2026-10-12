/**
 * Ducks (common eider on the Norway fjords and seas, mallard on ponds, lakes and quiet rivers): one InstancedMesh
 * per species, drakes and hens in the same draw (iPlum). User request: "make the ducks more realistic (as seen in
 * mission 1)".
 *
 * - **Shape.** A lofted hull that rides LOW in the water (the model origin is the waterline under the body centre:
 *   about 45 % of the body depth is below it), a broad back, a full breast, a short tail held flat on the water
 *   (eider) or cocked up (mallard), a thick short neck, and the species' head: the eider's long wedge, where the
 *   forehead runs straight down into the bill, and the mallard's round head and flat bill. ~330 triangles.
 * - **Plumage** is painted per FRAGMENT from the rest-pose position (vRest) and a per-part pattern coordinate
 *   (vPat: height round the body section, chord / span on the wings), so the boundaries stay crisp at any zoom
 *   and follow the head, tail and wings as they move. Drake eider: white back, cream-pink breast, black flanks,
 *   belly, rump and tail, the white rear-flank spot, a white head with a black cap and pale green nape, an olive bill;
 *   in flight the white forewing against black flight feathers. Hen eider: warm rufous brown barred dark, the
 *   dark speculum between two thin white bars. Drake mallard: bottle-green head, white collar, chestnut breast,
 *   pale grey flanks, black rear, whitish tail, yellow bill. Hen mallard: scalloped buff-brown, dark crown and eye
 *   stripe, orange bill with a dark saddle. Both: the blue, white-bordered speculum. Fine barring fades out where it
 *   would alias (fwidth), so the zoom-1 view gets the average colour.
 * - **Pose** (per instance, from the sim, src/world/duck-water.js): iPose = (flap phase, amplitude, fold, head
 *   pitch), iLeg0 = (wing set / dihedral, tail wag, tail cock, head fore-aft), iLeg1 = (neck forward, neck up, -,
 *   head yaw). Folded wings blend to an authored folded pose lying on the back and upper flanks (aFold), with the
 *   primaries crossed over the rump; flapping turns the arm about the shoulder and the hand about the wrist (the hand
 *   lags). The head turns about the top of the neck (looks, preening on the back, the tucked-in resting pose), the neck
 *   stretches up (alarm) or forward (flight), the tail cocks and wags. A customDepthMaterial runs the same
 *   animation, so the shadows match.
 * @module art/duck-model
 */
import * as THREE from 'three';
import { BIRD_SPECIES } from '../world/bird-sim.js';
import { animDepthMaterial } from './anim-depth.js';

/**
 * Body, neck, head and tail per species, in units of the species length L (+x forward, y up from the waterline, z the
 * span). body: [x, half-width, height above the waterline, depth below it]; head: [x, centre y, half-width, top,
 * bottom]; neck: [[x, y, r] at the body, at the head]; tail: [root x, root y, tip x, tip y, root half-width, tip half-width].
 */
export const DUCK_SPECIES = {
  eider: {
    body: [[-0.41, 0.045, 0.07, 0.03], [-0.35, 0.10, 0.105, 0.07], [-0.24, 0.148, 0.135, 0.11], [-0.10, 0.172, 0.15, 0.13],
      [0.04, 0.168, 0.145, 0.14], [0.14, 0.145, 0.13, 0.135], [0.21, 0.108, 0.105, 0.105], [0.265, 0.052, 0.07, 0.06]],
    nose: [0.285, 0.02],
    head: [[0.215, 0.205, 0.04, 0.05, 0.045], [0.252, 0.222, 0.058, 0.066, 0.054], [0.298, 0.222, 0.056, 0.058, 0.052],
      [0.338, 0.208, 0.045, 0.04, 0.046], [0.372, 0.19, 0.033, 0.022, 0.032], [0.43, 0.17, 0.023, 0.012, 0.017], [0.478, 0.157, 0.012, 0.006, 0.008]],
    nape: [0.2, 0.208], tip: [0.488, 0.155],
    neck: [[0.155, 0.08, 0.07], [0.235, 0.19, 0.055]],
    tail: [-0.39, 0.06, -0.5, 0.075, 0.07, 0.028],
    headK: 1.08,
    bill: 0.37, // x where the bill starts (feathering slants forward up the eider's frontal lobe)
  },
  mallard: {
    body: [[-0.40, 0.042, 0.095, 0.03], [-0.34, 0.092, 0.115, 0.06], [-0.24, 0.132, 0.135, 0.10], [-0.10, 0.15, 0.14, 0.12],
      [0.04, 0.148, 0.135, 0.125], [0.14, 0.128, 0.122, 0.12], [0.21, 0.094, 0.098, 0.092], [0.26, 0.046, 0.062, 0.05]],
    nose: [0.28, 0.02],
    head: [[0.228, 0.24, 0.034, 0.042, 0.04], [0.262, 0.258, 0.05, 0.058, 0.05], [0.302, 0.26, 0.05, 0.055, 0.048],
      [0.334, 0.254, 0.04, 0.042, 0.04], [0.35, 0.232, 0.031, 0.017, 0.019], [0.405, 0.222, 0.031, 0.01, 0.012], [0.452, 0.215, 0.022, 0.006, 0.008]],
    nape: [0.215, 0.242], tip: [0.462, 0.213],
    neck: [[0.145, 0.085, 0.06], [0.245, 0.22, 0.045]],
    tail: [-0.38, 0.085, -0.52, 0.16, 0.062, 0.034],
    headK: 1.05,
    bill: 0.348,
  },
};
export const isDuck = (sp) => !!DUCK_SPECIES[sp];

const lerp = (a, b, t) => a + (b - a) * t;
const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

/** Body section at x (L units), interpolated between the stations: [half-width, top, bottom]. */
function section(D, x) {
  const B = D.body;
  if (x <= B[0][0]) return [B[0][1], B[0][2], B[0][3]];
  for (let i = 1; i < B.length; i++) {
    if (x <= B[i][0]) { const t = (x - B[i - 1][0]) / (B[i][0] - B[i - 1][0]); return [1, 2, 3].map((k) => lerp(B[i - 1][k], B[i][k], t)); }
  }
  const l = B[B.length - 1]; return [l[1], l[2], l[3]];
}

/**
 * Point on the body surface (L units) at station x and angle `a` round the section (0 = the waterline on the +z
 * side, π/2 = the top of the back), pushed out by `out`, on side `sd`.
 */
function onBody(D, x, a, sd, out = 1.03) {
  const [w, t] = section(D, x), c = Math.cos(a), s = Math.sin(a);
  return [x, t * spow(s, 0.85) * out, sd * w * spow(c, 0.85) * out];
}

/**
 * Geometry in metres. aWing = (span fraction on wings / −1 head / 0 body, side ±1 on wings, hand panel 0/1, shoulder
 * distance from the axis); aFold = folded position of wing vertices; aPat = pattern coordinate (body / head: height
 * round the section −1 … 1 and the fraction along; wings: chord fraction 0 leading … 1 trailing, span fraction; neck,
 * tail: along 0 … 1); aPart: 0 body, 1 head (bill painted by x), 2 neck, 4 tail, 5 arm (inner wing), 6 hand (outer wing).
 */
export function duckGeometry(sp) {
  const S = BIRD_SPECIES[sp], D = DUCK_SPECIES[sp], L = S.len, half = S.span / 2;
  const P = [], W = [], F = [], T = [], A = [], I = [];
  const push = (p, w, f, t, part) => { P.push(p[0] * L, p[1] * L, p[2] * L); W.push(...w); F.push(...(f || p).map((v, k) => (f ? v : p[k] * L))); T.push(...t); A.push(part); return P.length / 3 - 1; };
  const ZW = [0, 0, 0, 0];
  // ---- body: rings round the stations (outward winding), a rounded breast and a closed rump
  const R = 10, B = D.body;
  const ring = (st, part, wv, along, yc = 0) => {
    const [x, w, t, b] = st, out = [];
    for (let j = 0; j < R; j++) {
      const a = (j / R) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), hs = spow(s, 0.85);
      out.push(push([x, yc + (s >= 0 ? t : b) * hs, w * spow(c, 0.85)], wv, null, [hs, along], part));
    }
    return out;
  };
  const strip = (r0, r1) => { for (let j = 0; j < R; j++) { const a = r0[j], b = r0[(j + 1) % R], c = r1[j], d = r1[(j + 1) % R]; I.push(a, c, b, b, c, d); } };
  const fan = (r, apex, flip) => { for (let j = 0; j < R; j++) { const a = r[j], b = r[(j + 1) % R]; if (flip) I.push(apex, a, b); else I.push(apex, b, a); } };
  const rings = B.map((st, i) => ring(st, 0, ZW, i / (B.length - 1)));
  for (let i = 0; i + 1 < rings.length; i++) strip(rings[i], rings[i + 1]);
  fan(rings[rings.length - 1], push([D.nose[0], D.nose[1], 0], ZW, null, [0.2, 1], 0), false);
  fan(rings[0], push([B[0][0] - 0.012, 0.03, 0], ZW, null, [0.4, 0], 0), true);
  // ---- neck: a short thick tube, the top ring moves with the head
  const [n0, n1] = D.neck, HW = [-1, 0, 1, 0];
  const nax = [n1[0] - n0[0], n1[1] - n0[1]], nl = Math.hypot(nax[0], nax[1]), nu = [-nax[1] / nl, nax[0] / nl]; // section "up" ⟂ the neck axis
  const NR = 8, nring = (n, wv, along) => {
    const out = [];
    for (let j = 0; j < NR; j++) {
      const a = (j / NR) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      out.push(push([n[0] + nu[0] * s * n[2], n[1] + nu[1] * s * n[2], c * n[2] * 0.92], wv, null, [s, along], 2));
    }
    return out;
  };
  const nr0 = nring(n0, ZW, 0), nr1 = nring(n1, HW, 1);
  for (let j = 0; j < NR; j++) { const a = nr0[j], b = nr0[(j + 1) % NR], c = nr1[j], d = nr1[(j + 1) % NR]; I.push(a, c, b, b, c, d); }
  // ---- head: a loft from the nape to the bill tip
  const H = D.head.map(([x, yc, w, t, b]) => [x, yc, w * D.headK, t * D.headK, b * D.headK]), HR = 8;
  const hring = (st, along) => {
    const [x, yc, w, t, b] = st, out = [], part = 1; // the bill is painted by x (no triangle spans two parts)
    for (let j = 0; j < HR; j++) {
      const a = (j / HR) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), hs = spow(s, 0.9);
      out.push(push([x, yc + (s >= 0 ? t : b) * hs, w * spow(c, 0.9)], HW, null, [hs, along], part));
    }
    return out;
  };
  const hr = H.map((st, i) => hring(st, i / (H.length - 1)));
  for (let i = 0; i + 1 < hr.length; i++) for (let j = 0; j < HR; j++) { const a = hr[i][j], b = hr[i][(j + 1) % HR], c = hr[i + 1][j], d = hr[i + 1][(j + 1) % HR]; I.push(a, c, b, b, c, d); }
  const hfan = (r, apex, flip) => { for (let j = 0; j < HR; j++) { const a = r[j], b = r[(j + 1) % HR]; if (flip) I.push(apex, a, b); else I.push(apex, b, a); } };
  hfan(hr[0], push([D.nape[0], D.nape[1], 0], HW, null, [0, 0], 1), true);
  hfan(hr[hr.length - 1], push([D.tip[0], D.tip[1], 0], HW, null, [0, 1], 1), false);
  // ---- tail: a short wedge (two faces, the upper one up), rooted in the rump
  const [tx0, ty0, tx1, ty1, tw0, tw1] = D.tail, tl = (u) => [lerp(tx0, tx1, u), lerp(ty0, ty1, u)];
  const tq = [[...tl(0), tw0, 0, 1], [...tl(0), -tw0, 0, -1], [...tl(0.85), tw1, 0.85, 1], [...tl(0.85), -tw1, 0.85, -1], [...tl(1), 0, 1, 0]];
  const ti = tq.map(([x, y, z, u, sd]) => push([x, y, z], ZW, null, [u, sd], 4)), tb = tq.map(([x, y, z, u, sd]) => push([x, y - 0.012, z * 0.9], ZW, null, [u, sd], 4));
  I.push(ti[0], ti[2], ti[1], ti[1], ti[2], ti[3], ti[2], ti[4], ti[3]);
  I.push(tb[0], tb[1], tb[2], tb[1], tb[3], tb[2], tb[2], tb[3], tb[4]);
  // ---- wings: arm (shoulder → wrist) and pointed hand (wrist → tip), both sides; spread rest pose + folded pose
  const wMax = Math.max(...B.map((q) => q[1])), tMax = Math.max(...B.map((q) => q[2]));
  const root = wMax * 0.62, yW = tMax * 0.74, wrist = root + (half / L - root) * 0.4, hl = half / L, xs = 0.1;
  const sf = (z) => (z - root) / (hl - root);
  for (const sd of [1, -1]) {
    // folded: tucked into the flank feathers (just under the body surface), only the primaries' tips crossed over the rump
    const v = (x, z, hand, pat, fold) => push([x, yW, sd * z], [sf(z), sd, hand, root * L], onBody(D, fold[0], fold[1], sd, fold[2] || 0.97).map((q) => q * L), pat, hand ? 6 : 5);
    const fz = sf(wrist), fe = sf(wrist + (hl - wrist) * 0.55), fg = sf(wrist + (hl - wrist) * 0.45);
    // arm: A leading root, B leading wrist, C trailing wrist, D trailing root
    const a0 = v(xs, root, 0, [0, 0], [0.1, 1.05]), b0 = v(xs + 0.035, wrist, 0, [0, fz], [0.13, 0.72]);
    const c0 = v(xs - 0.22, wrist, 0, [1, fz], [-0.12, 0.78]), d0 = v(xs - 0.3, root, 0, [1, 0], [-0.03, 1.22]);
    // hand: B', E leading mid, F tip, G trailing mid, C'
    const b1 = v(xs + 0.035, wrist, 1, [0, fz], [0.13, 0.72]), c1 = v(xs - 0.22, wrist, 1, [1, fz], [-0.12, 0.78]);
    const e1 = v(xs + 0.005, wrist + (hl - wrist) * 0.55, 1, [0, fe], [-0.08, 0.98]), g1 = v(xs - 0.2, wrist + (hl - wrist) * 0.45, 1, [1, fg], [-0.2, 0.92]);
    const f1 = push([xs - 0.17, yW, sd * hl], [1, sd, 1, root * L], [-0.36 * L, (section(D, -0.36)[1] + 0.004) * L, sd * 0.025 * L], [0.5, 1], 6);
    const tris = [[a0, b0, c0], [a0, c0, d0], [b1, e1, g1], [b1, g1, c1], [e1, f1, g1]];
    for (const [p, q, r] of tris) { // upper face up (front-facing seen from above) on both sides
      const ux = P[q * 3] - P[p * 3], uz = P[q * 3 + 2] - P[p * 3 + 2], vx = P[r * 3] - P[p * 3], vz = P[r * 3 + 2] - P[p * 3 + 2];
      if (uz * vx - ux * vz > 0) I.push(p, q, r); else I.push(p, r, q); // normal.y of (u × v) = uz·vx − ux·vz
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 4));
  g.setAttribute('aFold', new THREE.Float32BufferAttribute(F, 3));
  g.setAttribute('aPat', new THREE.Float32BufferAttribute(T, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 1));
  g.setIndex(I);
  g.computeVertexNormals();
  g.userData = { wrist: wrist * L, root: root * L, half, wingY: yW * L, neck: [n1[0] * L, n1[1] * L], tail: [tx0 * L, ty0 * L] };
  return g;
}

const VPARS = /* glsl */ `
attribute vec4 aWing; attribute vec3 aFold; attribute vec2 aPat; attribute float aPart;
attribute vec4 iPose, iLeg0, iLeg1; attribute float iPlum;
uniform float uWrist, uWingY, uL; uniform vec2 uNeck, uTail;
varying vec3 vRest; varying vec2 vPat; varying float vPart, vPlum;
vec2 bRot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(v.x * c - v.y * s, v.x * s + v.y * c); }
`;
const VMAIN = /* glsl */ `
vec3 bp = position; vec3 objectNormal = normal;
vRest = position / uL; vPat = aPat; vPart = aPart; vPlum = iPlum;
if (aWing.y != 0.0) {                                         // wings: flap about shoulder + wrist, blend to the folded pose
  float sd = aWing.y, o = bp.z * sd - aWing.w, wr = uWrist - aWing.w, set = iLeg0.x;
  float a1 = iPose.y * 0.95 * sin(iPose.x) + set + 0.08, a2 = iPose.y * 0.6 * sin(iPose.x - 0.9) - set * 0.45;
  vec2 q = vec2(o, bp.y - uWingY);
  if (aWing.z > 0.5) { vec2 hh = bRot(vec2(q.x - wr, q.y), a2); q = vec2(wr + hh.x, hh.y); }
  q = bRot(q, a1);
  vec3 sp = vec3(bp.x + 0.05 * uL * iPose.y * cos(iPose.x) * aWing.x, uWingY + q.y, sd * (aWing.w + q.x));
  bp = mix(sp, aFold, iPose.z);
  float an = a1 + a2 * aWing.z;
  objectNormal = normalize(mix(vec3(0.0, cos(an), -sd * sin(an)), vec3(0.0, 0.8, sd * 0.6), iPose.z));
} else if (aWing.x < -0.5) {                                  // head (+ neck top): pitch, yaw about the neck top, stretch
  vec2 hq = bRot(bp.xy - uNeck, -iPose.w); bp.xy = uNeck + hq; objectNormal.xy = bRot(objectNormal.xy, -iPose.w);
  vec2 hz = bRot(vec2(bp.x - uNeck.x, bp.z), iLeg1.w); bp.x = uNeck.x + hz.x; bp.z = hz.y;
  objectNormal.xz = bRot(objectNormal.xz, iLeg1.w);
  bp += vec3(iLeg1.x + iLeg0.w, iLeg1.y, 0.0) * uL;
} else if (aPart > 3.5) {                                     // tail: cocked up, wagged
  vec2 tq = bRot(bp.xy - uTail, -iLeg0.z); bp.xy = uTail + tq; objectNormal.xy = bRot(objectNormal.xy, -iLeg0.z);
  vec2 tw = bRot(vec2(bp.x - uTail.x, bp.z), iLeg0.y); bp.x = uTail.x + tw.x; bp.z = tw.y;
}
`;

// plumage (sRGB hex → linear in the shader), per species; e = 1 inside a region, edges anti-aliased with fwidth
const FPARS = /* glsl */ `
varying vec3 vRest; varying vec2 vPat; varying float vPart, vPlum;
vec3 sl(float r, float g, float b) { return pow(vec3(r, g, b) / 255.0, vec3(2.2)); }
float inside(float d) { float w = max(fwidth(d), 1e-4); return smoothstep(-w, w, d); }
// dark crescent bars every period in ph (period units), faded out when finer than ~2.5 px
float bars(float ph, float k) { float f = fract(ph), w = fwidth(ph); return k * smoothstep(0.42, 0.62, f) * (1.0 - smoothstep(0.8, 0.98, f)) * (1.0 - smoothstep(0.22, 0.45, w)); }
// scalloped feathers: a dark centre in each feather cell (rows offset like tiles), pale edges; faded when sub-pixel
float scallops(vec2 q, float k) {
  vec2 c = vec2(q.x + 0.5 * floor(q.y), q.y), f = fract(c) - 0.5, w = fwidth(c);
  float d = length(f * vec2(1.0, 1.4) + vec2(0.0, 0.1));
  return k * (1.0 - smoothstep(0.38, 0.5, d)) * (1.0 - smoothstep(0.25, 0.5, max(w.x, w.y)));
}
vec3 duckPaint() {
  vec3 p = vRest; float h = vPat.x, u = vPat.y, hen = step(0.5, vPlum); int part = int(vPart + 0.5);
  bool up = gl_FrontFacing;
#ifdef EIDER
  vec3 WH = sl(232.0, 230.0, 222.0), CR = sl(236.0, 220.0, 196.0), BK = sl(22.0, 22.0, 25.0), GR = sl(178.0, 206.0, 150.0), BL = sl(160.0, 166.0, 118.0);
  vec3 RU = sl(112.0, 78.0, 50.0), RD = sl(56.0, 39.0, 26.0), RH = sl(108.0, 84.0, 60.0), HB = sl(98.0, 100.0, 86.0);
  vec3 drake, hn;
  if (part == 0) {
    float back = inside(h - 0.56) * inside(p.x + 0.335), thigh = inside(1.0 - length(vec2((p.x + 0.27) / 0.05, (h - 0.34) / 0.2)));
    float breast = inside(p.x - (0.1 + 0.06 * (1.0 - clamp(h, 0.0, 1.0))));
    drake = mix(BK, WH, max(back, thigh));
    drake = mix(drake, mix(CR, WH, smoothstep(0.55, 0.95, h)), breast * inside(h + 0.3));
    hn = mix(RU, RD, bars((p.x + 0.012 * sin(p.z * 60.0) + 0.02 * h * h) / 0.03, 0.5));
    hn = mix(hn, RD * 1.3, 0.35 * inside(-h));
  } else if (part == 1 || part == 2) {
    float cap = inside(h - mix(0.2, -0.45, smoothstep(0.3, 0.37, p.x))) * inside(BILLX - 0.004 - p.x) * inside(p.x - 0.236) * float(part == 1);
    float nape = inside(0.27 - p.x) * inside(0.35 - h) * inside(h + 0.55) * inside(abs(p.z) - 0.022) * float(part == 1);
    drake = mix(WH, GR, nape); drake = mix(drake, BK, cap);
    if (part == 2) drake = mix(CR, WH, smoothstep(0.3, 0.8, u));
    hn = mix(RH, RD, 0.4 * inside(h - 0.45) * float(part == 1));
    hn = mix(hn, RD, bars(p.y / 0.03 + p.x / 0.05, 0.25));
    float bill = inside(p.x - BILLX + 0.012 * h) * float(part == 1);
    drake = mix(drake, BL, bill); hn = mix(hn, HB, bill);
  } else if (part == 4) { drake = BK; hn = RD;
  } else {
    float hand = float(part == 6), sec = inside(h - 0.52), tert = inside(0.14 - u);
    if (up) {
      drake = mix(mix(WH, BK, sec * (1.0 - tert)), BK, hand);
      vec3 cov = mix(sl(110.0, 78.0, 50.0), sl(96.0, 66.0, 42.0), bars(h / 0.25, 0.5));
      float spec = sec * inside(0.92 - h), bar = (inside(h - 0.47) * inside(0.53 - h) + inside(h - 0.92) * inside(0.98 - h)) * (1.0 - hand);
      hn = mix(mix(cov, sl(44.0, 32.0, 24.0), spec), sl(58.0, 42.0, 30.0), hand);
      hn = mix(hn, sl(236.0, 232.0, 222.0), bar);
    } else {
      drake = mix(sl(214.0, 214.0, 206.0), sl(96.0, 96.0, 100.0), max(sec, hand));
      hn = mix(sl(176.0, 164.0, 148.0), sl(104.0, 96.0, 88.0), max(sec, hand));
    }
  }
#else
  vec3 GN = sl(32.0, 84.0, 48.0), CH = sl(96.0, 46.0, 30.0), FG = sl(150.0, 148.0, 140.0), BG = sl(112.0, 101.0, 86.0), BK = sl(22.0, 22.0, 24.0);
  vec3 WT = sl(214.0, 212.0, 204.0), YB = sl(214.0, 188.0, 60.0), BU = sl(134.0, 102.0, 70.0), BD = sl(58.0, 42.0, 28.0), SP = sl(44.0, 62.0, 160.0);
  vec3 drake, hn;
  if (part == 0) {
    float rear = inside(-0.31 - p.x), back = inside(h - 0.62), breast = inside(p.x - 0.13) * inside(0.9 - h);
    drake = mix(FG, BG, back); drake = mix(drake, CH, breast); drake = mix(drake, BK, rear * inside(h + 0.2));
    hn = mix(sl(150.0, 120.0, 86.0), sl(86.0, 64.0, 44.0), 0.35 + scallops(vec2(p.x / 0.08, h * 3.2 + abs(p.z) * 4.0), 0.6)); // pale fringes round dark feather centres
    hn = mix(hn, BD, 0.25 * inside(h - 0.6));
  } else if (part == 1 || part == 2) {
    float collar = inside(u - 0.12) * inside(0.3 - u) * float(part == 2);
    drake = part == 2 ? mix(CH, GN, inside(u - 0.25)) : GN;
    drake = mix(drake, WT, collar);
    float crown = inside(h - 0.45) * float(part == 1), stripe = inside(h - 0.04) * inside(0.2 - h) * inside(p.x - 0.262) * float(part == 1);
    hn = mix(sl(170.0, 136.0, 96.0), BD, max(crown, stripe * 0.9));
    hn = mix(hn, BD, bars(p.y / 0.025, 0.2));
    float bill = inside(p.x - BILLX) * float(part == 1);
    drake = mix(drake, YB, bill);
    hn = mix(hn, mix(sl(200.0, 124.0, 52.0), sl(84.0, 62.0, 46.0), inside(h - 0.1) * inside(0.43 - p.x)), bill);
  } else if (part == 4) { drake = mix(WT, BK, inside(0.25 - u)); hn = mix(BU, BD, bars(u / 0.25, 0.6));
  } else {
    float hand = float(part == 6), spec = inside(h - 0.55) * inside(0.92 - h) * (1.0 - hand);
    float bar = (inside(h - 0.5) * inside(0.55 - h) + inside(h - 0.92) * inside(0.98 - h)) * (1.0 - hand);
    if (up) {
      drake = mix(mix(sl(122.0, 116.0, 104.0), sl(90.0, 86.0, 78.0), hand), SP, spec);
      hn = mix(mix(sl(122.0, 94.0, 66.0), sl(84.0, 70.0, 56.0), hand), SP, spec);
      drake = mix(drake, WT, bar); hn = mix(hn, WT, bar);
    } else {
      drake = mix(sl(220.0, 220.0, 212.0), sl(140.0, 140.0, 136.0), max(inside(h - 0.55), hand));
      hn = mix(sl(206.0, 198.0, 184.0), sl(134.0, 128.0, 120.0), max(inside(h - 0.55), hand));
    }
  }
#endif
  return mix(drake, hn, hen);
}
`;

/** Instanced ducks of one species (cap instances). */
export function createDuckMesh(sp, cap, o = {}) {
  const g = duckGeometry(sp), U = g.userData, S = BIRD_SPECIES[sp];
  const pose = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4), plum = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
  const leg0 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4), leg1 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  for (const a of [pose, leg0, leg1]) a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iPose', pose); g.setAttribute('iPlum', plum); g.setAttribute('iLeg0', leg0); g.setAttribute('iLeg1', leg1);
  const uni = { uWrist: { value: U.wrist }, uWingY: { value: U.wingY }, uL: { value: S.len }, uNeck: { value: new THREE.Vector2(...U.neck) }, uTail: { value: new THREE.Vector2(...U.tail) } };
  const def = (sp === 'eider' ? '#define EIDER\n' : '#define MALLARD\n') + `#define BILLX ${DUCK_SPECIES[sp].bill.toFixed(4)}\n`;
  const m = new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = VPARS + sh.vertexShader.replace('#include <beginnormal_vertex>', VMAIN).replace('#include <begin_vertex>', 'vec3 transformed = bp;');
    sh.fragmentShader = def + FPARS + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = duckPaint();');
  };
  m.customProgramCacheKey = () => `duck1_${sp}`;
  const mesh = new THREE.InstancedMesh(g, m, cap);
  mesh.customDepthMaterial = animDepthMaterial(VPARS, VMAIN + 'vec3 transformed = bp;', uni, 'duckDepth1');
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0; mesh.frustumCulled = false; mesh.name = `bird_${sp}`;
  mesh.castShadow = o.shadows !== false; mesh.receiveShadow = false;
  mesh.userData.waterIgnore = true; mesh.userData.dynamic = true; mesh.userData.ambientLife = 'bird';
  return { mesh, pose, plum, leg0, leg1, cap, sp, duck: true };
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YZX'), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

/** Write the visible ducks (not those under water on a dive) into the instance buffers; returns the count. */
export function writeDucks(h, birds, inView) {
  let n = 0;
  const A = h.pose.array, Pl = h.plum.array, L0 = h.leg0.array, L1 = h.leg1.array;
  for (const b of birds) {
    if (n >= h.cap) break;
    if (b.hidden || (inView && !inView(b.x, b.z, b.y))) continue;
    _e.set(b.bank + (b.roll || 0), -b.yaw, b.pitch + (b.wp || 0) - (b.dab || 0) * 1.75);
    _q.setFromEuler(_e);
    _p.set(b.x, b.y, b.z);
    _m.compose(_p, _q, _s);
    h.mesh.setMatrixAt(n, _m);
    const k = n * 4;
    A[k] = b.ph; A[k + 1] = b.amp; A[k + 2] = b.fold; A[k + 3] = b.peck || 0;
    L0[k] = b.wset || 0; L0[k + 1] = b.wag || 0; L0[k + 2] = b.cock || 0; L0[k + 3] = b.bob || 0;
    L1[k] = b.neckF || 0; L1[k + 1] = b.neckU || 0; L1[k + 2] = 0; L1[k + 3] = b.look || 0;
    Pl[n] = b.hen ? 1 : 0;
    n++;
  }
  h.mesh.count = n;
  if (n) { h.mesh.instanceMatrix.needsUpdate = true; h.pose.needsUpdate = true; h.plum.needsUpdate = true; h.leg0.needsUpdate = true; h.leg1.needsUpdate = true; }
  return n;
}
