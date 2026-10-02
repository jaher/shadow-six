/**
 * Desert shrub archetypes (docs/vegetation.md §3.2): real low-poly 3D plants that replace the flat star rosettes.
 * Seeded builders fill {pos, nor, col, sway, idx}: woody stems are 3-sided tubes, fine twigs crossed ribbons, leaves
 * and thorns tiny quads with crown-shell normals (the bush shades as one volume). `sway` 0 at the root → 1 at the
 * outer twig tips drives the wind bend. Pure (no THREE) so the unit tests can measure them.
 * @module terrain-b/scrub-geo
 */
import { rng } from './noise.js';

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function makeB() { return { pos: [], nor: [], col: [], sway: [], wid: [], idx: [], h: 0.5 }; }

/** wd: [dx, dy, dz, half-width] — the unit offset of this vertex from its centre line and the local half-width, so
 * the shader can widen sub-pixel twigs to ≥ ~1 px (no crawling silhouettes while the camera pans). */
function vtx(B, p, n, c, s, wd = [0, 0, 0, 1]) { B.pos.push(...p); B.nor.push(...n); B.col.push(...c); B.sway.push(s); B.wid.push(...wd); return B.pos.length / 3 - 1; }
const W4 = (d, k, w) => [d[0] * k, d[1] * k, d[2] * k, w];

/** Orthonormal frame around a direction. */
function frame(d) {
  const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(d, up)), v = cross(d, u);
  return [u, v];
}

/** 3-sided tube segment p0→p1 (no caps). */
function tube(B, p0, p1, r0, r1, c0, c1, s0, s1) {
  const d = norm([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]), [u, v] = frame(d), b = B.pos.length / 3;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2, o = add([0, 0, 0], u, Math.cos(a)), n = add(o, v, Math.sin(a));
    vtx(B, add(p0, n, r0), n, c0, s0, W4(n, 1, r0));
    vtx(B, add(p1, n, r1), n, c1, s1, W4(n, 1, r1));
  }
  for (let k = 0; k < 3; k++) {
    const i = b + k * 2, j = b + ((k + 1) % 3) * 2;
    B.idx.push(i, j, i + 1, j, j + 1, i + 1);
  }
}

/** Crossed ribbons (fine twig): two quads at 90° along p0→p1. */
function ribbon(B, p0, p1, w, c, s0, s1) {
  const d = norm([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]), [u, v] = frame(d);
  for (const ax of [u, v]) {
    const b = B.pos.length / 3, n = norm(add(cross(d, ax), [0, 0.6, 0]));
    vtx(B, add(p0, ax, -w), n, c, s0, W4(ax, -1, w)); vtx(B, add(p0, ax, w), n, c, s0, W4(ax, 1, w));
    vtx(B, add(p1, ax, -w * 0.4), n, c, s1, W4(ax, -1, w * 0.4)); vtx(B, add(p1, ax, w * 0.4), n, c, s1, W4(ax, 1, w * 0.4));
    B.idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
  }
}

/** Leaf / thorn quad at p, pointing along d; normal = crown shell (outward from `centre`, biased up). */
function leafQ(B, p, d, len, w, c, s, centre) {
  const [u] = frame(d), b = B.pos.length / 3;
  const n = norm(add(norm([p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]]), [0, 0.7, 0]));
  vtx(B, add(p, u, -w), n, c, s, W4(u, -1, w)); vtx(B, add(p, u, w), n, c, s, W4(u, 1, w));
  vtx(B, add(add(p, d, len), u, -w * 0.3), n, c, s, W4(u, -1, w * 0.3)); vtx(B, add(add(p, d, len), u, w * 0.3), n, c, s, W4(u, 1, w * 0.3));
  B.idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
}

/** Rotate direction d by a random cone of half-angle `ang` and bend toward `bias`. */
function jitter(r, d, ang, bias, kb) {
  const [u, v] = frame(d), a = r() * Math.PI * 2, t = ang * (0.5 + 0.5 * r());
  let n = add(add(d, u, Math.cos(a) * Math.tan(t)), v, Math.sin(a) * Math.tan(t));
  if (bias) n = add(norm(n), bias, kb);
  return norm(n);
}

/**
 * Recursive branching shrub. o: {stems, elev:[lo,hi] (rad from vertical), len, rad, depth, kids, spread, leafPer,
 * leafLen, leafW, wood, leaf, leafDry, dryFrac, tubeDepth, gravity}
 */
function branchy(B, r, o) {
  const centre = [0, o.len * 0.6, 0];
  const grow = (p, d, len, rad, depth, s0) => {
    const segs = depth === 0 ? 3 : 2;
    let q = p, dir = d;
    for (let k = 0; k < segs; k++) {
      dir = jitter(r, dir, 0.25, [0, -1, 0], (o.gravity ?? 0.04) * (depth + 1));
      const q1 = add(q, dir, len / segs);
      const s1 = Math.min(1, s0 + (len / segs) / (o.len * 1.4));
      if (depth < (o.tubeDepth ?? 1)) tube(B, q, q1, rad, rad * 0.75, o.wood, o.wood, s0, s1);
      else ribbon(B, q, q1, rad * 0.9, o.wood2 || o.wood, s0, s1);
      if (depth >= 1 && o.leafPer) for (let l = 0; l < o.leafPer; l++) {
        const f = r(), lp = add(q, dir, (len / segs) * f), ld = jitter(r, dir, 1.1, [0, 1, 0], 0.3);
        const c = r() < (o.dryFrac ?? 0) ? o.leafDry : o.leaf;
        leafQ(B, lp, ld, o.leafLen * (0.6 + 0.8 * r()), o.leafW * (0.7 + 0.6 * r()), c, s0 + (s1 - s0) * f, centre);
      }
      q = q1; s0 = s1; rad *= 0.75;
      B.h = Math.max(B.h, q[1]);
    }
    if (depth < o.depth) {
      const kids = o.kids[0] + ((r() * (o.kids[1] - o.kids[0] + 1)) | 0);
      for (let c = 0; c < kids; c++) grow(q, jitter(r, dir, o.spread, [0, 0.3, 0], 0.2), len * (0.55 + 0.2 * r()), rad * 0.7, depth + 1, s0);
    }
  };
  for (let s = 0; s < o.stems; s++) {
    const az = (s / o.stems) * Math.PI * 2 + r() * 0.8, el = o.elev[0] + (o.elev[1] - o.elev[0]) * r();
    const d = [Math.sin(el) * Math.cos(az), Math.cos(el), Math.sin(el) * Math.sin(az)];
    grow([Math.cos(az) * 0.03, 0, Math.sin(az) * 0.03], d, o.len * (0.45 + 0.25 * r()), o.rad, 0, 0);
  }
}

/** Linear-space colours (pre-light). */
const C = {
  wood: [0.11, 0.085, 0.06], woodGrey: [0.27, 0.25, 0.22], twig: [0.16, 0.12, 0.08],
  thornLeaf: [0.075, 0.115, 0.045], dryLeaf: [0.26, 0.2, 0.1], salt: [0.15, 0.18, 0.12], saltDry: [0.28, 0.25, 0.17],
  rod: [0.12, 0.15, 0.075], rodOld: [0.2, 0.19, 0.12],
};

/** Archetype builders (B, r, lod) — lod 0.4 … 1.3 scales fine detail (quality preset). */
export const SCRUB = {
  /** Camel-thorn (Alhagi): a dense spiny dome of wiry twigs, 0.3–0.8 m. */
  camelthorn: (B, r, lod) => branchy(B, r, {
    stems: 8, elev: [0.5, 1.15], len: 0.72, rad: 0.011, depth: 2, kids: [2, 2], spread: 0.75, gravity: 0.05,
    leafPer: Math.max(2, Math.round(5 * lod)), leafLen: 0.06, leafW: 0.013, wood: C.wood, wood2: C.twig,
    leaf: C.thornLeaf, leafDry: C.dryLeaf, dryFrac: 0.3,
  }),
  /** Saltbush / Haloxylon: a dense grey-green ball, 0.5–1.1 m, jointed stems inside. */
  saltbush(B, r, lod) {
    branchy(B, r, { stems: 5, elev: [0.3, 0.9], len: 0.6, rad: 0.012, depth: 1, kids: [2, 3], spread: 0.6, leafPer: 0, wood: C.wood });
    const n = Math.round(300 * lod), rx = 0.55, ry = 0.45, centre = [0, 0.38, 0];
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, y = r() * 2 - 1, sh = Math.pow(r(), 0.35); // denser towards the shell
      const rr = Math.sqrt(1 - y * y) * sh;
      const p = [Math.cos(a) * rr * rx, centre[1] + y * sh * ry * (y < 0 ? 0.75 : 1), Math.sin(a) * rr * rx];
      if (p[1] < 0.03) continue;
      const d = jitter(r, norm([p[0], p[1] - centre[1] + 0.3, p[2]]), 0.9);
      leafQ(B, p, d, 0.065 + 0.04 * r(), 0.018 + 0.01 * r(), r() < 0.2 ? C.saltDry : C.salt, Math.min(1, p[1] / 0.75), centre);
    }
    B.h = Math.max(B.h, centre[1] + ry);
  },
  /** White broom (Retama): long, almost leafless green rods arching out of a woody base, 1–2 m. */
  retama(B, r, lod) {
    const rods = Math.round(22 * Math.min(1.2, lod + 0.2));
    for (let k = 0; k < rods; k++) {
      const az = r() * Math.PI * 2, el = 0.15 + 0.55 * r(), L = 0.9 + 0.8 * r();
      let d = [Math.sin(el) * Math.cos(az), Math.cos(el), Math.sin(el) * Math.sin(az)], p = [Math.cos(az) * 0.05, 0, Math.sin(az) * 0.05];
      const segs = 6, col = r() < 0.25 ? C.rodOld : C.rod;
      for (let s = 0; s < segs; s++) {
        d = norm(add(d, [d[0] * 0.25, -0.16 * (s / segs), d[2] * 0.25])); // arch out and droop at the tip
        const q = add(p, d, L / segs);
        tube(B, p, q, 0.007 * (1 - s / segs * 0.7), 0.007 * (1 - (s + 1) / segs * 0.7), s ? col : C.wood, col, (s / segs) ** 1.3, ((s + 1) / segs) ** 1.3);
        p = q; B.h = Math.max(B.h, p[1]);
      }
    }
  },
  /** Dead, bleached twig skeleton (as common as live plants in the desert). */
  deadtwig: (B, r) => branchy(B, r, {
    stems: 6, elev: [0.6, 1.3], len: 0.5, rad: 0.008, depth: 2, kids: [1, 3], spread: 0.8, gravity: 0.08,
    leafPer: 0, wood: C.woodGrey, wood2: C.woodGrey,
  }),
};

/** Build an archetype → typed arrays {pos, nor, col, sway, wid, idx, height, radius}. */
export function scrubArchetype(name, seed = 1, lod = 1) {
  const B = makeB();
  SCRUB[name](B, rng(seed * 7919 + name.length * 31), lod);
  let rad = 0;
  for (let i = 0; i < B.pos.length; i += 3) rad = Math.max(rad, Math.hypot(B.pos[i], B.pos[i + 2]));
  let hy = 0; for (let i = 1; i < B.pos.length; i += 3) hy = Math.max(hy, B.pos[i]);
  return {
    pos: new Float32Array(B.pos), nor: new Float32Array(B.nor), col: new Float32Array(B.col), sway: new Float32Array(B.sway), wid: new Float32Array(B.wid),
    idx: B.idx, height: hy, radius: rad,
  };
}
