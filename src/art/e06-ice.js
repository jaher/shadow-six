/**
 * LIGHTS OUT e06 "Thin Ice": the broken ice of the harbour (art review r1: "uniform coffin and hexagon prisms … read as
 * tiles, not broken ice"; "a perfectly radial daisy ring" round the fishermen's holes).
 *
 *  - floes: irregular outlines (a jagged polygon, notched, long or squat), 0.3–3 m across with most of them small,
 *    0.05–0.35 m thick, a humped, uneven top; afloat ones flat, rafted ones tilted up on the ice edge or on another
 *    floe; their tops snow-crusted, bare grey or dirty, their broken edges glassy blue-grey;
 *  - brash in the lead and the channel drifted against the downwind (south-west) shore and packed along the tug's hull,
 *    thinning to scattered pans in the open water;
 *  - the mines' heaved collars, the pressure ridges' piled slabs;
 *  - the fishermen's holes: dark water in a ragged hole, a slush rim, a few uneven chunks thrown out on the windward side.
 * Every piece is placed clear of the others it would lie flat on (no two tops in one plane: zfight), all in a handful
 * of merged meshes (a material each). Visual only, drawn by e06-dressing.js's iceArt.
 * @module art/e06-ice
 */
import * as THREE from 'three';
import { snowCrustMaterial, paintedMaterial } from './kit-props.js';
import { addSnowCover } from './terrain/snowfx.js';
import { propSnowAmount } from './terrain.js';
import { vnoise } from './terrain/noise.js';
import { COMMON, VERT_PARS, VERT_WORLD, FRAG_MAIN, FRAG_ROUGH, FRAG_NORMAL, FRAG_EMIS, FRAG_AO } from './terrain/terrain-glsl.js';

/** Signed distance from (x, z) to polygon P (negative inside). */
export function polySD(P, x, z) {
  let inside = false, d2 = Infinity;
  for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
    const [ax, az] = P[a], [bx, bz] = P[b];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    const ex = bx - ax, ez = bz - az, L = ex * ex + ez * ez || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L)), qx = ax + t * ex - x, qz = az + t * ez - z;
    d2 = Math.min(d2, qx * qx + qz * qz);
  }
  return inside ? -Math.sqrt(d2) : Math.sqrt(d2);
}

/**
 * polySD of a long polygon (the channel: 160 corners), fast — its edges bucketed on a grid of `cell` m for the distance
 * and on rows of 1 m for the inside test. Distances past `reach` come back as ±`reach`.
 */
export function polyIndex(P, reach = 4, cell = 2) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  x0 -= reach; z0 -= reach; x1 += reach; z1 += reach;
  const cols = Math.ceil((x1 - x0) / cell), rows = Math.ceil((z1 - z0) / cell), grid = Array.from({ length: cols * rows }, () => []);
  const zr = Math.ceil(z1 - z0), band = Array.from({ length: zr + 1 }, () => []);
  for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
    const [ax, az] = P[a], [bx, bz] = P[b];
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / cell)), i1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx) + reach - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - z0) / cell)), j1 = Math.min(rows - 1, Math.floor((Math.max(az, bz) + reach - z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * cols + i].push(a, b);
    for (let r = Math.max(0, Math.floor(Math.min(az, bz) - z0)); r <= Math.min(zr, Math.floor(Math.max(az, bz) - z0)); r++) band[r].push(a, b);
  }
  return (x, z) => {
    if (x < x0 || x >= x1 || z < z0 || z >= z1) return reach;
    let inside = false;
    const B = band[Math.floor(z - z0)];
    for (let k = 0; k < B.length; k += 2) {
      const [ax, az] = P[B[k]], [bx, bz] = P[B[k + 1]];
      if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    }
    let d2 = reach * reach;
    const G = grid[Math.floor((z - z0) / cell) * cols + Math.floor((x - x0) / cell)];
    for (let k = 0; k < G.length; k += 2) {
      const [ax, az] = P[G[k]], [bx, bz] = P[G[k + 1]];
      const ex = bx - ax, ez = bz - az, L = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L)), qx = ax + t * ex - x, qz = az + t * ez - z;
      d2 = Math.min(d2, qx * qx + qz * qz);
    }
    return inside ? -Math.sqrt(d2) : Math.sqrt(d2);
  };
}

/** Point in polygon (even-odd). */
export function inPoly(P, x, z) {
  let inside = false;
  for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
    const [ax, az] = P[a], [bx, bz] = P[b];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

let EDGE = null, WATER = null, WET = null;
/** The broken edges' glassy blue-grey ice, the holes' black water. */
function edgeMaterial() {
  EDGE ??= new THREE.MeshStandardMaterial({ color: 0x6e93a2, roughness: 0.2, metalness: 0, name: 'e06:ice_edge' });
  return EDGE;
}
/** The wet margin along the fast ice's broken edge: dark, glossy, no snow on it (the water washes over it). */
function wetMaterial() {
  WET ??= new THREE.MeshStandardMaterial({ color: 0x4d5a63, roughness: 0.28, metalness: 0, name: 'e06:ice_wet' });
  return WET;
}

// ---- the sheet's own surface on the slabs (verifier r3: "flat, untextured, low-poly plates … plain light-grey tops,
// crisp straight polygon edges", luminance spread 2.9 on a top against 8–22 on the sheet beside it)
const SHEET_VERT_PARS = /* glsl */ `
attribute vec2 aE6Splat;
attribute vec2 aE6;
varying vec2 vE6Splat;
varying vec2 vE6;
`;
const SHEET_FRAG_PARS = /* glsl */ `
varying vec2 vE6Splat;
varying vec2 vE6;
vec4 e6NoTrail(vec2 uv) { return vec4(0.0); }
`;
// (after the terrain's own albedo, roughness and glints, before they are written out)
const SHEET_WET = /* glsl */ `
{
  // the slab's own tone, then the wet margin along its broken edge — the water washes over it: darker, glossier, no
  // glints; its inner line broken up by the noise at two scales (a smooth ramp alone read as a ruled band)
  float e6n = tbNz(vWPos.xz, 1.1).g * 0.55 + tbNz(vWPos.xz + 7.3, 0.33).b * 0.45;
  float e6w = smoothstep(0.44, 0.7, vE6.x + (e6n - 0.5) * 0.8);
  albT *= vE6.y;
  albT = mix(albT, albT * vec3(0.46, 0.51, 0.57), e6w);
  rough = mix(rough, 0.24, e6w);
  tbGlint *= 1.0 - e6w;
}
`;
/** FRAG_MAIN read at the slab's own splat point, with no trail field and the slab's tone and wet margin. */
function sheetFragMain() {
  const TUV = 'vec2 tuv = (vWPos.xz - uOrigin) * uMap.zw;', DBG = 'if (uDebug > 0.5)';
  if (!FRAG_MAIN.includes(TUV) || !FRAG_MAIN.includes(DBG)) throw new Error('[e06-ice] terrain FRAG_MAIN changed: the sheet tops need its splat lookup and debug line');
  return FRAG_MAIN.replace(TUV, 'vec2 tuv = (vE6Splat - uOrigin) * uMap.zw;')
    .replace(/texture\(tTrail, /g, 'e6NoTrail(').replace(/texture\(tFlat, /g, 'e6NoTrail(')
    .replace(DBG, SHEET_WET + DBG);
}
const SHEET_MATS = new WeakMap();
/**
 * The fast ice's slab tops in the sheet's own surface: the terrain's shader (its layers through the hex tiler, the wind
 * sastrugi and the ice paint's scoured patches, its glints) bound to the terrain's own uniforms `U` — one set, so they
 * follow the sun, the HD textures and the quality preset — with three changes: the splat is read at `aE6Splat` (a
 * point of the sheet behind the slab, its snow and its bared ice; under the water the splat is the pond ice), no trail
 * field (nobody walks out there), and `aE6` (x: the wet margin's ramp, y: the slab's tone). Null without a terrain.
 */
export function sheetTopMaterial(U) {
  if (!U?.tSplatA) return null;
  let m = SHEET_MATS.get(U);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, color: 0xffffff, name: 'e06:ice_sheet' });
  const frag = sheetFragMain();
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = VERT_PARS + SHEET_VERT_PARS + sh.vertexShader
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + VERT_WORLD + 'vE6Splat = aE6Splat;\nvE6 = aE6;\n');
    sh.fragmentShader = COMMON + SHEET_FRAG_PARS + sh.fragmentShader
      .replace('#include <map_fragment>', frag)
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', FRAG_EMIS)
      .replace('#include <aomap_fragment>', FRAG_AO);
  };
  m.customProgramCacheKey = () => 'e06:iceSheet';
  // (its snow is the terrain's own: the scene's prop snow pass leaves it alone)
  m.userData.snowCover = true;
  m.userData.e6Sheet = true;
  SHEET_MATS.set(U, m);
  return m;
}

/**
 * The cells the fast ice's edge covers (a fine grid over the harbour): its slabs never overlap each other, and no floe,
 * brash, rubble or rafted plate is laid flat on one (two tops in one plane would fight).
 */
class Occ {
  constructor(x0, z0, x1, z1, cell = 0.07) {
    this.x0 = x0; this.z0 = z0; this.c = cell;
    this.cols = Math.ceil((x1 - x0) / cell); this.rows = Math.ceil((z1 - z0) / cell);
    this.a = new Uint8Array(this.cols * this.rows);
  }
  /** Cells of polygon `poly` ([[x, z]…], by their centres): already taken (count), or mark them (`mark`). A scanline fill. */
  poly(poly, mark = false) {
    let z0 = Infinity, z1 = -Infinity;
    for (const [, z] of poly) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const c = this.c, j0 = Math.max(0, Math.floor((z0 - this.z0) / c)), j1 = Math.min(this.rows - 1, Math.floor((z1 - this.z0) / c));
    const xs = this._xs || (this._xs = []);
    let n = 0;
    for (let j = j0; j <= j1; j++) {
      const z = this.z0 + (j + 0.5) * c;
      xs.length = 0;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const [ax, az] = poly[a], [bx, bz] = poly[b];
        if ((az > z) !== (bz > z)) xs.push(ax + ((bx - ax) * (z - az)) / (bz - az));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - this.x0) / c - 0.5)), i1 = Math.min(this.cols - 1, Math.floor((xs[k + 1] - this.x0) / c - 0.5));
        for (let i = i0, kk = j * this.cols + i0; i <= i1; i++, kk++) { if (mark) this.a[kk] = 1; else n += this.a[kk]; }
      }
    }
    return n;
  }
  /** Is any of the disc (x, z, r) on a slab (its centre and 8 points round it)? */
  disc(x, z, r) {
    for (let k = -1; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, px = k < 0 ? x : x + Math.cos(a) * r, pz = k < 0 ? z : z + Math.sin(a) * r;
      const i = Math.floor((px - this.x0) / this.c), j = Math.floor((pz - this.z0) / this.c);
      if (i >= 0 && j >= 0 && i < this.cols && j < this.rows && this.a[j * this.cols + i]) return true;
    }
    return false;
  }
}

/**
 * Points every `step` m round polygon `P` (water inside), each with its tangent and its normal into the water, the
 * normals smoothed over ±`win` m (a bank's small wiggles do not fan the offsets out); `s`: arc length.
 */
function bankSamples(P, step = 0.25, win = 0.75) {
  let area = 0;
  for (let a = 0, b = P.length - 1; a < P.length; b = a++) area += (P[b][0] - P[a][0]) * (P[b][1] + P[a][1]);
  const sgn = area > 0 ? 1 : -1; // (which side of an edge the inside lies)
  const out = [];
  let s = 0, carry = 0;
  for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length], L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L;
    for (let u = carry; u < L; u += step) out.push({ x: ax + tx * u, z: az + tz * u, tx, tz, nx: -tz * sgn, nz: tx * sgn, s: s + u });
    carry = (Math.ceil((L - carry) / step) * step + carry) - L;
    s += L;
  }
  const n = out.length, w = Math.max(1, Math.round(win / step));
  const sm = out.map((p, i) => {
    let nx = 0, nz = 0;
    for (let k = -w; k <= w; k++) { const q = out[(i + k + n) % n]; nx += q.nx; nz += q.nz; }
    const L = Math.hypot(nx, nz) || 1;
    return { ...p, nx: nx / L, nz: nz / L };
  });
  // (the polygon's winding decides `sgn`; the normals must lead into the water — a vote over the samples, flipped if not)
  let vote = 0;
  for (let i = 0; i < n; i += 7) vote += polySD(P, sm[i].x + sm[i].nx * 0.15, sm[i].z + sm[i].nz * 0.15) < 0 ? 1 : -1;
  if (vote < 0) for (const p of sm) { p.nx = -p.nx; p.nz = -p.nz; }
  // (the water lies on one side of the way round for the whole polygon: `up`, the winding that faces a top upward —
  // from the unsmoothed normal's side, not a smoothed normal's, which swings round a sharp corner)
  return { pts: sm, length: s, up: sgn * (vote < 0 ? -1 : 1) < 0 };
}

/**
 * The fast ice's broken edge along the open water of `poly` (verifier r2: the water shader's shore shelf, one smooth
 * white stroke traced round the water — e06 has none; verifier r3: the slabs that replaced it were flat, untextured
 * plates with crisp polygon outlines, lining both banks as one chain of white tiles that outlined the water). Where the
 * bank is the frozen sheet (`land(x, z)`, the point 0.8 m back from the water) the edge is broken in scattered
 * clusters — a slow noise along the bank decides where (`cover`: the share of the bank's length, `clusterScale` m its
 * wavelength) — with stretches of the sheet's own broken edge (the terrain's bank) between them and now and then a lone
 * chip broken off there (`chipP` per metre). In a cluster, slabs 0.9–2.6 m along the bank (`len`), cracked apart by
 * 6–22 cm of dark water or a slab gone (brash and slush in the gap), each its own reach out over the water (bays and
 * tongues, a slow wander between `wMin` and `wMax`, narrower toward a cluster's ends), its outline rotten (pitted at
 * three scales), its corners rounded and chipped, its own thickness and lean, a few rafted up at the outer edge or awash.
 * Their tops are the sheet's own surface (sheetTopMaterial: its grain, wind streaks and scoured ice, read behind the
 * slab), a wet margin along the broken edge with a ragged inner line (noise in the shader), the broken face glassy grey
 * down into the water, the inner side turned down steeply into the sheet (no top lies in the ground's plane).
 * `blocked(x, z)`: no slab there (hulls, decks, piers); `keep`: the Marine's way in and out of the water stays open.
 * Marks the slabs in `occ`; brash beyond the edge and slush in the gaps; returns the slab count.
 */
function iceEdge(B, R, o, mats, spots, occ) {
  const { poly, land, blocked = () => false, keep = () => true, wMin = 0.6, wMax = 3.2, wMid = 1.6, wAmp = 0.7,
    len = [0.9, 2.6], gapP = 0.1, wind = [-0.6, 0.8], zMin = -14, raiseP = 0.1, awashP = 0.12,
    cover = 0.45, clusterScale = 9, chipP = 0.04, tone: toneMul = 1, detachP = 0.14 } = o;
  const { pts, length, up } = bankSamples(poly);
  const n = pts.length, step = length / n;
  const ok = pts.map((p) => p.z > zMin && keep(p.x, p.z) && land(p.x - p.nx * 0.8, p.z - p.nz * 0.8));
  // runs of ice bank (rotated to start at a stretch that is not one: no run wraps round the polygon's start)
  let start = ok.findIndex((v) => !v);
  if (start < 0) start = 0;
  const runs = [];
  for (let k = 0, cur = null; k <= n; k++) {
    const i = (start + k) % n, v = k < n && ok[i];
    if (v) (cur ||= []).push(pts[i]); else if (cur) { if (cur.length > 4) runs.push(cur); cur = null; }
  }
  const ph1 = R() * 6.28, ph2 = R() * 6.28, ph3 = R() * 6.28, ph4 = R() * 6.28, ph5 = R() * 6.28, seed = Math.floor(R() * 1e6);
  const wAt = (s) => wMid + wAmp * (0.6 * Math.sin(s * 0.23 + ph1) + 0.4 * Math.sin(s * 0.61 + ph2)) + 0.25 * Math.sin(s * 1.7 + ph3);
  // (the tops' tone in stretches along the bank, not slab by slab: a few per cent darker or greyer for tens of metres)
  const toneAt = (s) => toneMul * (0.95 + 0.05 * Math.sin(s * 0.083 + ph4) + 0.035 * Math.sin(s * 0.29 + ph5));
  // the clusters: two octaves of value noise along the bank; the threshold is the quantile that leaves `cover` of the
  // ice bank's samples in a cluster (exact, whatever the noise drew)
  const clN = (s) => 0.68 * vnoise(s / clusterScale, 0.37, seed) + 0.32 * vnoise(s / (clusterScale * 0.31), 5.11, seed + 7);
  const onBank = [];
  for (const run of runs) for (const p of run) onBank.push(clN(p.s));
  onBank.sort((a, b) => a - b);
  const thr = onBank.length ? onBank[Math.min(onBank.length - 1, Math.floor((1 - cover) * onBank.length))] : 1;
  const top = onBank.length ? onBank[onBank.length - 1] : 1;
  // a cluster's strength 0..1: its slabs narrower and smaller toward its ends
  const clAt = (s) => Math.max(0, (clN(s) - thr) / Math.max(1e-3, top - thr));
  const sd = o.sd || polyIndex(poly), inWater = (x, z, m) => sd(x, z) < -m;
  let slabs = 0;
  for (const run of runs) {
    let sk = null;
    const L = (run.length - 1) * step;
    // the bank point, tangent and normal at arc length u along the run
    const at = (u) => {
      const f = Math.max(0, Math.min(run.length - 1.001, u / step)), i = Math.floor(f), t = f - i, a = run[i], b = run[i + 1];
      const nx = a.nx + (b.nx - a.nx) * t, nz = a.nz + (b.nz - a.nz) * t, nl = Math.hypot(nx, nz) || 1;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: a.tx, tz: a.tz, nx: nx / nl, nz: nz / nl, s: a.s + step * t };
    };
    const base = { poly, blocked, wAt, wMin, wMax, wind, inWater, up, toneAt, raiseP, awashP, bounds: o.bounds, seed };
    for (let u = R() * 0.4; u < L - 0.6;) {
      const c = clAt(at(u).s);
      if (c <= 0) { // the sheet's own edge: now and then a lone chip broken off it
        if (R() < chipP * 0.5) {
          const u1 = Math.min(L, u + 0.45 + R() * 0.5);
          if (u1 - u >= 0.4) {
            const r = slab(B, R, at, u, u1, { ...base, sk0: null, scale: 0.28 + R() * 0.2, raiseP: 0, awashP: 0.3, detachP: 0.3 }, mats, spots, occ);
            if (r !== false) slabs++;
          }
          u = u1 + 0.4 + R() * 0.8;
        } else u += 0.5;
        sk = null;
        continue;
      }
      // (now and then a long plate still in one piece; shorter ones toward a cluster's ends)
      const sl = (R() < 0.12 * c ? len[1] + R() * 1.4 : len[0] + (len[1] - len[0]) * Math.pow(R(), 1.3)) * (0.55 + 0.45 * Math.min(1, c * 2.5));
      const u1 = Math.min(L, u + sl);
      if (u1 - u < 0.5) break;
      if (R() < gapP) { // a slab gone: open water at the bank, brash and slush in it
        gapFill(B, R, at, u, u1, sd, mats, spots, occ, blocked);
        u = u1 + 0.1 + R() * 0.3;
        sk = null;
        continue;
      }
      // (a crack's slant shared by the slabs either side of it: they fit like the two halves of one break)
      const sk1 = slab(B, R, at, u, u1, { ...base, sk0: sk, scale: 0.45 + 0.55 * Math.min(1, c * 2), detachP }, mats, spots, occ);
      if (sk1 !== false) { slabs++; sk = sk1; } else sk = null;
      u = u1 + (R() < 0.1 ? 0.3 + R() * 0.3 : 0.06 + Math.pow(R(), 1.5) * 0.16); // the crack (now and then a wide lead)
    }
  }
  return slabs;
}

/** Mirror a coordinate into [lo, hi] (a splat read past the map's edge comes back inside it, a mirror of its paint). */
const mirror = (v, lo, hi) => {
  const w = hi - lo;
  if (!(w > 0)) return v;
  let t = (v - lo) % (2 * w);
  if (t < 0) t += 2 * w;
  return lo + (t > w ? 2 * w - t : t);
};

/** A crack between two slabs: its slant (a share of the reach, sideways) and the seed of its wander. */
const crack = (R) => ({ s: (R() - 0.5) * 0.55, w: Math.floor(R() * 1e6) });
/**
 * A crack's sideways wander (m) at share t of the way out (0 at the bank line, 1 at the broken edge): up to ±8 cm at two
 * scales, by the share so that every row of a slab bends with it alike (rows of different reach never cross).
 */
const crackWig = (c, t) => {
  const u = Math.min(1, Math.max(0, t));
  return Math.min(1, u * 3) * ((vnoise(u * 3.3, 0.71, c.w) - 0.5) * 0.13 + (vnoise(u * 10.7, 1.93, c.w + 1) - 0.5) * 0.045);
};

/**
 * One slab of the fast ice's edge from arc length u0 to u1 along a bank run (`at`), its first crack `o.sk0` (crack():
 * the last slab's last, so the two fit like the halves of one break); `o.scale` shrinks its reach (a cluster's end, a
 * lone chip); `o.detachP`: the chance it has broken free and drifted off the bank (a broken face on its inner side too,
 * floating lower, turned a little). Returns its last crack (the next slab's first), or false if it found no room.
 */
function slab(B, R, at, u0, u1, o, mats, spots, occ) {
  const span = u1 - u0, K = Math.max(5, Math.ceil(span / 0.13) + 1), rows = [];
  // the slab's own reach: the bank's wander, a bay (a slab broke away) or a tongue (a floe froze back on) now and then
  const kind = R(), mul = (kind < 0.12 ? 0.55 + R() * 0.2 : kind > 0.94 ? 1.2 + R() * 0.25 : 0.85 + R() * 0.3) * (o.scale ?? 1);
  // broken free: drifted 0.15–0.6 m off the bank and turned up to 7 degrees, afloat (its top lower than the sheet's)
  const free = R() < (o.detachP ?? 0), drift = free ? 0.15 + R() * 0.45 : 0, turn = free ? (R() - 0.5) * 0.24 : 0;
  // its own thickness over the sheet and its own lean (along the bank and across it): no two slabs in one plane
  const top = free ? -0.035 + 0.05 * R() : 0.012 + 0.036 * R(), leanU = (R() - 0.5) * 0.05 / Math.max(1, span), leanD = (R() - 0.5) * 0.03;
  // a few rafted up at the outer edge, a few awash (their outer edge dipping into the water)
  const lift = R(), raise = !free && lift < (o.raiseP ?? 0.1) ? 0.05 + R() * 0.1 : 0, awash = !raise && lift > 1 - (o.awashP ?? 0.12);
  // the outline: a slow wander of the reach, then a rotten edge pitted at three scales (value noise along the slab, not
  // a jitter per row: a jitter per row cut the edge into a regular sawtooth), a bite now and then, rounded corners —
  // a quarter-ellipse's fall toward each crack — and one or both chipped off
  const ph = R() * 1000, sd0 = (o.seed ?? 0) + 101, wobble = 0.25 + R() * 0.2;
  const rc = Math.min(0.65, span * 0.34) * (0.6 + 0.55 * R()), chip0 = R() < 0.45 ? 0.12 + R() * 0.2 : 0, chip1 = R() < 0.45 ? 0.12 + R() * 0.2 : 0;
  const bite = R() < 0.35 ? { at: 0.2 + R() * 0.6, w: 0.1 + R() * 0.2, d: 0.25 + R() * 0.35 } : null;
  const lipW = 0.035 + R() * 0.03, jag = [];
  let jg = (R() - 0.5) * 0.1, bo = -0.12 + (R() - 0.5) * 0.3;
  for (let k = 0; k < K; k++) {
    const f = k / (K - 1), u = u0 + span * f, p = at(u);
    jg = 0.7 * jg + (R() - 0.5) * 0.06;
    bo = 0.65 * bo + 0.35 * (-0.12 + (R() - 0.5) * 0.36); // (the crack behind it, where it meets the sheet: wandering too)
    let w = Math.max(o.wMin * (o.scale ?? 1), Math.min(o.wMax, o.wAt(p.s) * mul));
    w *= 1 + wobble * (vnoise(u / 1.3 + ph, 0.5, sd0) - 0.5);
    w += (vnoise(u / 0.31 + ph, 1.5, sd0) - 0.5) * 0.16 + (vnoise(u / 0.11 + ph, 2.5, sd0) - 0.5) * 0.07; // pitted
    const e = Math.min(u - u0, u1 - u);
    if (e < rc) w *= 0.55 + 0.45 * Math.sqrt(Math.max(0, 1 - (1 - e / rc) ** 2));
    if (u - u0 < rc * 0.8 && chip0) w *= 1 - chip0 * (1 - (u - u0) / (rc * 0.8));
    if (u1 - u < rc * 0.8 && chip1) w *= 1 - chip1 * (1 - (u1 - u) / (rc * 0.8));
    if (bite) { const t = Math.abs(f - bite.at) / bite.w; if (t < 1) w *= 1 - bite.d * 0.5 * (1 + Math.cos(Math.PI * t)); }
    jag.push(jg);
    // (never so short that its top's columns run back past its lip: a fold, two tops in one plane)
    rows.push({ p: { ...p }, w: Math.max(Math.max(0, bo) + lipW + 0.14, w), bo });
  }
  // the two cracks: slanted (every row leans its share of the slant from the first crack's to the last's, so the rows
  // never cross; the slants kept from closing the outer edge up to less than half the slab's length) and wandering
  const c0 = free || !o.sk0 ? crack(R) : { ...o.sk0 }, c1 = crack(R);
  const wAvg = rows.reduce((a, r) => a + r.w, 0) / K, squeeze = (c0.s - c1.s) * wAvg;
  if (squeeze > 0.5 * span) { const f = (0.5 * span) / squeeze; c0.s *= f; c1.s *= f; }
  // (sideways at distance d out, row k: the row's own wander, the slant, the two cracks' wander blended across; the
  // wander by the share t = d / w of the row's reach, so a short row beside a long one (a rounded corner) bends alike)
  const lat = (k, d, w) => {
    const f = k / (K - 1), t = d / w, sw = Math.min(1, w / 0.9); // (a short row's wander small: no sideways step past its reach)
    return jag[k] * t * sw + (c0.s * (1 - f) + c1.s * f) * d + ((1 - f) * crackWig(c0, t) + f * crackWig(c1, t)) * sw;
  };
  // a slab broken free turns about its middle
  let mx = 0, mz = 0, cx = 0, cz = 0;
  for (const r of rows) { mx += r.p.nx; mz += r.p.nz; cx += r.p.x; cz += r.p.z; }
  const ml = Math.hypot(mx, mz) || 1;
  cx = cx / K + (mx / ml) * (drift + wAvg / 2); cz = cz / K + (mz / ml) * (drift + wAvg / 2);
  const cT = Math.cos(turn), sT = Math.sin(turn);
  const xf = (x, z) => (turn ? [cx + (x - cx) * cT - (z - cz) * sT, cz + (x - cx) * sT + (z - cz) * cT] : [x, z]);
  /** The point at distance d out (past the drift) on row k: on the bank line itself (d = bo, attached) unsheared. */
  const pt = (r, k, d) => xf(r.p.x + r.p.nx * (d + drift) + r.p.tx * lat(k, d, r.w), r.p.z + r.p.nz * (d + drift) + r.p.tz * lat(k, d, r.w));
  const outAt = (r, k, w) => pt(r, k, w);
  // room: out over the water, clear of hulls, decks and piers (the reach cut back until it is); a slab broken free
  // needs water under its inner edge too
  const room = () => {
    for (let k = 0; k < K; k++) {
      const r = rows[k];
      const wLo = Math.max(0, r.bo) + lipW + 0.14;
      while (r.w >= wLo) {
        const [x, z] = outAt(r, k, r.w), [hx, hz] = pt(r, k, r.w * 0.5);
        if (o.inWater(x, z, 0.05) && !o.blocked(x, z) && !o.blocked(hx, hz)) break;
        r.w -= 0.05;
      }
      if (r.w < wLo) return false;
      if (free) { const [ix, iz] = pt(r, k, Math.max(0, r.bo)); if (!o.inWater(ix, iz, 0.03) || o.blocked(ix, iz)) return false; }
    }
    return true;
  };
  // the columns across it: attached, the inner side turned down steeply into the sheet (0.4 m back, 16 cm down — a
  // shallow tuck crossed the ground within a millimetre of it, zfight.mjs) and the bank line; broken free, its inner
  // broken edge and lip; then three across the top, the rounded lip, the broken edge
  const FR = [0.3, 0.62, 0.88];
  const wetW = awash ? 0.9 : 0.22 + R() * 0.35, tone = (o.toneAt ? o.toneAt(at(u0).s) : 1) * (0.93 + R() * 0.1);
  // where the slab's top reads the sheet's paint: one point behind it for the whole slab (a copy of the sheet's own
  // snow and scoured ice, its grain continuous with the sheet's), folded back into the map past its edge
  const back = wAvg + drift + 1.6 + R() * 1.2, ox = -(mx / ml) * back, oz = -(mz / ml) * back, bnd = o.bounds;
  const ext = (x, z, wet) => [bnd ? mirror(x + ox, 0.5, bnd[0] - 0.5) : x + ox, bnd ? mirror(z + oz, 0.5, bnd[1] - 0.5) : z + oz, wet, tone];
  const relief = (x, z) => (vnoise(x / 0.75, z / 0.75, sd0 + 3) - 0.5) * 0.014 + (vnoise(x / 0.26, z / 0.26, sd0 + 5) - 0.5) * 0.005;
  const yTop = (t, k) => {
    const uu = (k / (K - 1) - 0.5) * span;
    let y = top + leanU * uu + leanD * t + raise * Math.max(0, t) ** 1.5;
    if (awash) y -= (top + 0.07) * smooth01(0.25, 1, t);
    return y;
  };
  const rowsV = () => rows.map((r, k) => {
    const w = r.w, d0 = free ? Math.max(0, r.bo) : r.bo, cols = [];
    const wetAt = (d) => Math.max(0, Math.min(1, Math.max(1 - (w - d) / wetW, free ? 1 - (d - d0) / (wetW * 0.7) : 0)));
    if (!free) {
      const [ux, uz] = xf(r.p.x + r.p.nx * (r.bo - 0.4), r.p.z + r.p.nz * (r.bo - 0.4));
      cols.push({ p: [ux, -0.16, uz], wet: 0 });
      const [bx, bz] = xf(r.p.x + r.p.nx * r.bo, r.p.z + r.p.nz * r.bo);
      cols.push({ p: [bx, yTop(0, k) + relief(bx, bz), bz], wet: 0 });
    } else {
      const [ix, iz] = pt(r, k, d0);
      cols.push({ p: [ix, yTop(0, k) - 0.02, iz], wet: 1 });
      const [jx, jz] = pt(r, k, d0 + lipW);
      cols.push({ p: [jx, yTop(0, k) - 0.004 + relief(jx, jz), jz], wet: wetAt(d0 + lipW) });
    }
    const dIn = free ? d0 + lipW : r.bo;
    for (const f of FR) {
      const d = dIn + Math.max(0.02, (w - lipW - dIn) * f), [px, pz] = pt(r, k, d);
      cols.push({ p: [px, yTop(d / w, k) + relief(px, pz), pz], wet: wetAt(d) });
    }
    const [lx, lz] = pt(r, k, w - lipW);
    cols.push({ p: [lx, yTop(1 - lipW / w, k) + relief(lx, lz) - 0.004, lz], wet: wetAt(w - lipW) });
    const [qx, qz] = outAt(r, k, w);
    cols.push({ p: [qx, yTop(1, k) - 0.02 - (awash ? 0.004 : 0), qz], wet: 1 });
    const [fx, fz] = pt(r, k, w + 0.03), [gx, gz] = free ? pt(r, k, d0 - 0.03) : [0, 0];
    return { cols, foot: [fx, FOOT, fz], footIn: free ? [gx, FOOT, gz] : null };
  });
  // no fold: every strip between two rows, seen from above, two triangles wound to the bank's side (round a sharp corner
  // of the bank the rows' reaches converge and cross — the slab would lie over itself, two of its tops in one plane)
  const want = o.up ? -1 : 1, cross2 = (a, b, c) => (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
  let V = null;
  const flat = () => {
    V = rowsV();
    const C = V[0].cols.length;
    for (let k = 0; k + 1 < K; k++) {
      for (let i = 0; i + 1 < C; i++) {
        const a = V[k].cols[i].p, b = V[k + 1].cols[i].p, c = V[k + 1].cols[i + 1].p, d = V[k].cols[i + 1].p;
        if (cross2(a, b, c) * want <= 1e-5 || cross2(a, c, d) * want <= 1e-5) return false;
      }
    }
    return true;
  };
  let fits = room() && flat();
  if (!fits) { // one reach for the whole slab (its mean normal): the rows run out side by side
    for (const r of rows) { r.p.nx = mx / ml; r.p.nz = mz / ml; }
    fits = room() && flat();
    for (let tries = 0; !fits && tries < 2; tries++) { for (const r of rows) r.w *= 0.75; fits = room() && flat(); }
  }
  if (!fits) return false;
  // its footprint over the water (inner edge to outer edge) must not lie on another slab's: cut back, else leave it out
  let foot;
  for (let tries = 0; ; tries++) {
    foot = [...V.map((v) => [v.cols[free ? 0 : 1].p[0], v.cols[free ? 0 : 1].p[2]]), ...V.map((v) => [v.cols[v.cols.length - 1].p[0], v.cols[v.cols.length - 1].p[2]]).reverse()];
    if (occ.poly(foot) <= 2) break;
    if (tries >= 2) return false;
    for (const r of rows) r.w *= 0.78;
    if (!flat()) return false;
  }
  occ.poly(foot, true);
  mats.log?.push([+cx.toFixed(2), +cz.toFixed(2), free ? 1 : 0]);
  // the top: one grid of shared corners (smooth over its hummocks and its lean), in the sheet's own surface
  const topM = mats.sheet || mats.crust, C = V[0].cols.length;
  const grid = V.map((row) => row.cols.map((c) => B.vert(topM, c.p, topM === mats.sheet ? ext(c.p[0], c.p[2], c.wet) : null)));
  const qi = o.up ? (m, a, b, c, d) => { B.face(m, a, b, c); B.face(m, a, c, d); } : (m, a, b, c, d) => { B.face(m, a, c, b); B.face(m, a, d, c); };
  for (let k = 0; k + 1 < K; k++) for (let i = 0; i + 1 < C; i++) qi(topM, grid[k][i], grid[k + 1][i], grid[k + 1][i + 1], grid[k][i + 1]);
  // the broken face, down into the water: one strip of shared corners (rounded round the outline, not a ruled band);
  // broken free, its inner side the same
  const face = V.map((row) => [B.vert(mats.edge, row.cols[C - 1].p), B.vert(mats.edge, row.foot)]);
  for (let k = 0; k + 1 < K; k++) qi(mats.edge, face[k][0], face[k + 1][0], face[k + 1][1], face[k][1]);
  if (free) {
    const inner = V.map((row) => [B.vert(mats.edge, row.cols[0].p), B.vert(mats.edge, row.footIn)]);
    for (let k = 0; k + 1 < K; k++) qi(mats.edge, inner[k][1], inner[k + 1][1], inner[k + 1][0], inner[k][0]);
  }
  // the crack faces at its two ends (down to under the water)
  const q = o.up ? (m, a, b, c, d) => quad(B, m, a, b, c, d) : (m, a, b, c, d) => quad(B, m, a, d, c, b);
  for (const [k, first] of [[0, true], [K - 1, false]]) {
    const ring = V[k].cols.map((c) => c.p), low = ring.map(([x, , z]) => [x, FOOT, z]);
    for (let i = 0; i + 1 < ring.length; i++) {
      if (first) q(mats.edge, ring[i], ring[i + 1], low[i + 1], low[i]);
      else q(mats.edge, ring[i + 1], ring[i], low[i], low[i + 1]);
    }
  }
  // a broken plate shoved up onto it near the edge now and then (clear of its top)
  if (!free && R() < 0.15) {
    const k = 1 + Math.floor(R() * (K - 2)), r = rows[k], d = r.w * (0.5 + 0.3 * R()), sz = 0.3 + R() * 0.45;
    const [x, z] = pt(r, k, d);
    if (spots.free(x, z, sz * 0.45)) { spots.add(x, z, sz * 0.45); floe(B, R, x, z, sz, 0.05 + R() * 0.06, { y0: top + raise + 0.03, tilt: 0.22 + R() * 0.4, top: mats.pick() }); }
  }
  // brash afloat off its broken edge, more of it on a lee shore
  const lee = Math.max(0, -(rows[0].p.nx * o.wind[0] + rows[0].p.nz * o.wind[1]));
  for (let i = 0, nb = 1 + Math.floor(R() * (2 + lee * 4)); i < nb; i++) {
    const k = Math.floor(R() * K), r = rows[k], d = r.w + drift + 0.12 + Math.abs(R() + R() - 1) * (0.8 + lee * 1.4);
    const sz = R() < 0.1 ? 0.7 + R() * 0.6 : 0.18 + R() * 0.45, x = r.p.x + r.p.nx * d + r.p.tx * (R() - 0.5) * 0.4, z = r.p.z + r.p.nz * d + r.p.tz * (R() - 0.5) * 0.4;
    if (!o.inWater(x, z, sz * 0.35) || o.blocked(x, z) || occ.disc(x, z, sz * 0.45) || !spots.free(x, z, sz * 0.45)) continue;
    spots.add(x, z, sz * 0.45);
    floe(B, R, x, z, sz, 0.04 + R() * 0.08, { y0: -0.085, tilt: R() < 0.2 ? 0.06 + R() * 0.12 : 0, top: mats.pick() });
  }
  // (broken free: the next slab's crack is its own)
  return free ? crack(R) : c1;
}
/** smoothstep. */
const smooth01 = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The ice foot along a quay wall (verifier r2: "a dark wet margin against the quay wall", not the white sheet run up to
 * the stone): a narrow ledge of wet, dark ice frozen to the wall at the waterline, 10–35 cm out from the coping's face
 * and 2–4 cm over the water, its outer edge ragged, broken into lengths with gaps of open water between. `wallAt(x, z)`:
 * how far out from the stone the coping's face lies (its signed distance, the quay polygon's), or null (not a quay).
 */
function iceFoot(B, R, bank, mats, occ, wallAt) {
  const { pts, up } = bankSamples(bank.poly, 0.25);
  const zMin = bank.zMin ?? -14;
  const ok = pts.map((p) => p.z > zMin && bank.keep(p.x, p.z) && bank.stone(p.x - p.nx * 0.8, p.z - p.nz * 0.8));
  const q = up ? (m, a, b, c, d) => quad(B, m, a, b, c, d) : (m, a, b, c, d) => quad(B, m, a, d, c, b);
  let pieces = 0;
  for (let i = 0; i < pts.length;) {
    if (!ok[i]) { i++; continue; }
    const n = 2 + Math.floor(R() * 5), run = [];
    for (let k = 0; k < n && i < pts.length && ok[i]; k++, i++) run.push(pts[i]);
    i += R() < 0.35 ? 1 + Math.floor(R() * 3) : 0; // (open water between two lengths)
    if (run.length < 2) continue;
    // the coping's face along this length: where the stone's signed distance reaches the face, marched out from the line
    const rows = [];
    let w = 0.12 + R() * 0.2, bad = false;
    for (const p of run) {
      let d0 = null;
      for (let d = -0.4; d <= 0.6; d += 0.02) { const f = wallAt(p.x + p.nx * d, p.z + p.nz * d); if (f != null && f >= 0) { d0 = d; break; } }
      if (d0 == null) { bad = true; break; }
      w = Math.max(0.08, Math.min(0.38, 0.6 * w + 0.4 * (0.1 + R() * 0.28)));
      const x0 = p.x + p.nx * (d0 - 0.03), z0 = p.z + p.nz * (d0 - 0.03), x1 = p.x + p.nx * (d0 + w), z1 = p.z + p.nz * (d0 + w);
      if (bank.blocked?.(x1, z1)) { bad = true; break; }
      const y = -0.075 + R() * 0.015;
      rows.push({ wall: [x0, y + 0.012, z0], top: [x1 - p.nx * 0.03, y, z1 - p.nz * 0.03], out: [x1, y - 0.012, z1], foot: [x1 + p.nx * 0.02, -0.15, z1 + p.nz * 0.02] });
    }
    if (bad || rows.length < 2) continue;
    const foot = [...rows.map((r) => [r.wall[0], r.wall[2]]), ...rows.map((r) => [r.out[0], r.out[2]]).reverse()];
    if (occ.poly(foot) > 1) continue;
    occ.poly(foot, true);
    for (let k = 0; k + 1 < rows.length; k++) {
      const a = rows[k], b = rows[k + 1];
      q(mats.wet, a.wall, b.wall, b.top, a.top);
      q(mats.wet, a.top, b.top, b.out, a.out);
      q(mats.edge, a.out, b.out, b.foot, a.foot);
    }
    for (const [r, first] of [[rows[0], true], [rows[rows.length - 1], false]]) {
      const ring = [r.wall, r.top, r.out], low = ring.map(([x, , z]) => [x, -0.15, z]);
      for (let k = 0; k + 1 < ring.length; k++) {
        if (first) q(mats.edge, ring[k], ring[k + 1], low[k + 1], low[k]);
        else q(mats.edge, ring[k + 1], ring[k], low[k], low[k + 1]);
      }
    }
    pieces++;
  }
  return pieces;
}

/**
 * Plates shoved up onto the sheet along a broken edge (a berth's ice worked by the ferry and the span): tilted,
 * snow-crusted, 0.6–1.3 m back from the water, now and then — the edge's straight line broken from above.
 */
function edgeRubble(B, R, bank, mats, spots, occ) {
  const { pts } = bankSamples(bank.poly, 0.5);
  let n = 0;
  for (const p of pts) {
    if (R() > bank.rubble || !bank.keep(p.x, p.z) || !bank.land(p.x - p.nx * 0.8, p.z - p.nz * 0.8)) continue;
    const d = 0.6 + R() * 0.7, x = p.x - p.nx * d + p.tx * (R() - 0.5) * 0.3, z = p.z - p.nz * d + p.tz * (R() - 0.5) * 0.3;
    const sz = 0.3 + R() * 0.45, r = sz * 0.5;
    if (!bank.land(x, z) || bank.blocked?.(x, z) || occ.disc(x, z, r) || !spots.free(x, z, r)) continue;
    spots.add(x, z, r);
    floe(B, R, x, z, sz, 0.05 + R() * 0.04, { y0: -0.035, tilt: 0.22 + R() * 0.35, top: R() < 0.75 ? mats.crust : mats.grey });
    n++;
  }
  return n;
}

/**
 * Brash and slush afloat in a berth's open water, packed against its sides and its outer end, thin in the middle (the
 * span's lowering sweeps it): `pit` {x0, x1, z0, z1}, the water under the raised deck clear of its girders. Thin, flat
 * pieces (their tops under the lowered deck's plate: they never show through it).
 */
function pitBrash(B, R, pit, mats, spots, occ) {
  const { x0, x1, z0, z1, n: max = 90 } = pit, W = x1 - x0;
  let n = 0;
  for (let k = 0; k < max * 2.5 && n < max; k++) {
    const side = R() < 0.5, x = side ? x0 + Math.pow(R(), 2) * W * 0.55 : x1 - Math.pow(R(), 2) * W * 0.55;
    const z = z0 + Math.pow(R(), 1.6) * (z1 - z0);
    const sz = R() < 0.12 ? 0.5 + R() * 0.3 : 0.14 + R() * 0.34, r = sz * 0.5;
    if (x - r < x0 || x + r > x1 || z - r < z0 || z + r > z1 || occ.disc(x, z, r) || !spots.free(x, z, r)) continue;
    spots.add(x, z, r);
    const flat = R() < 0.45;
    floe(B, R, x, z, sz, flat ? 0.018 + R() * 0.012 : 0.03 + R() * 0.02, { y0: -0.088, tilt: !flat && R() < 0.2 ? 0.03 + R() * 0.03 : 0, top: flat ? mats.slush : R() < 0.5 ? mats.grey : R() < 0.5 ? mats.dirty : mats.crust });
    n++;
  }
  return n;
}

/** The foot of a slab's broken face: the fast ice is ~22 cm thick (its top 2–5 cm over the sheet's, the water at -0.1). */
const FOOT = -0.2;

/** A gap where a slab broke away: brash and grey slush packed into it, open water between. */
function gapFill(B, R, at, u0, u1, sd, mats, spots, occ, blocked) {
  for (let i = 0, nb = 3 + Math.floor(R() * 5); i < nb; i++) {
    const p = at(u0 + (u1 - u0) * R()), d = 0.25 + R() * 1.3, sz = 0.16 + R() * 0.42;
    const x = p.x + p.nx * d, z = p.z + p.nz * d;
    if (sd(x, z) > -sz * 0.35 || blocked(x, z) || occ.disc(x, z, sz * 0.45) || !spots.free(x, z, sz * 0.45)) continue;
    spots.add(x, z, sz * 0.45);
    const flat = R() < 0.5; // (slush: a thin wet pan barely above the water)
    floe(B, R, x, z, sz, flat ? 0.02 + R() * 0.015 : 0.04 + R() * 0.06, { y0: -0.088, tilt: flat ? 0 : R() * 0.2, top: flat ? mats.slush : mats.pick() });
  }
}

/** A quad (a, b, c, d counter-clockwise seen from its front) as two triangles. */
function quad(B, m, a, b, c, d) { B.tri(m, a, b, c); B.tri(m, a, c, d); }
function holeWater() {
  if (!WATER) { WATER = new THREE.MeshStandardMaterial({ color: 0x0b1316, roughness: 0.12, metalness: 0.1, name: 'e06:hole' }); WATER.userData.snowCover = true; }
  return WATER;
}

/**
 * e06's own ice tops (the kit's painted snow set under a key no other mission uses): the scene's prop snow on them held
 * back by `bias` (art/terrain/snowfx.js snowCoverage, the same shader and look) — refrozen wet slush, grey or dirty, a
 * thin broken crust at most. Under the full pass every top read bright white whatever its own colour.
 */
function iceTop(tag, color, bias) {
  const m = paintedMaterial('snow', color, { name: `e06:ice_${tag}` }); // (the name only keys the cache: the kit renames it)
  if (!m.userData.snowCover) { addSnowCover(m, { uniforms: { uSnowAmt: propSnowAmount(), uSnowBias: { value: bias } } }); m.userData.snowCover = true; }
  return m;
}

/**
 * Triangles per material, built into one mesh each. `tri` gives every triangle its own corners (flat shading, as the
 * pieces have always been drawn); `vert` + `face` share corners (a slab's top grid: smooth over its hummocks). The
 * sheet material's corners carry [splat x, splat z, wet, tone] (`e`).
 */
class Batch {
  constructor() { this.parts = new Map(); }
  part(mat) {
    let p = this.parts.get(mat);
    if (!p) this.parts.set(mat, p = { pos: [], idx: [], ext: mat.userData?.e6Sheet ? [] : null });
    return p;
  }
  vert(mat, a, e) {
    const p = this.part(mat);
    p.pos.push(a[0], a[1], a[2]);
    if (p.ext) p.ext.push(e ? e[0] : a[0], e ? e[1] : a[2], e ? e[2] : 0, e ? e[3] : 1);
    return p.pos.length / 3 - 1;
  }
  face(mat, i, j, k) { this.part(mat).idx.push(i, j, k); }
  tri(mat, a, b, c, ea, eb, ec) {
    const i = this.vert(mat, a, ea), j = this.vert(mat, b, eb), k = this.vert(mat, c, ec);
    this.part(mat).idx.push(i, j, k);
  }
  build(name) {
    const g = new THREE.Group(); g.name = name;
    for (const [mat, { pos, idx, ext }] of this.parts) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const uv = new Float32Array((pos.length / 3) * 2);
      for (let i = 0, k = 0; i < pos.length; i += 3, k += 2) { uv[k] = pos[i] / 2.2; uv[k + 1] = (pos[i + 2] + pos[i + 1]) / 2.2; }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      if (ext) {
        const n = pos.length / 3, sp = new Float32Array(n * 2), e6 = new Float32Array(n * 2);
        for (let v = 0; v < n; v++) { sp[v * 2] = ext[v * 4]; sp[v * 2 + 1] = ext[v * 4 + 1]; e6[v * 2] = ext[v * 4 + 2]; e6[v * 2 + 1] = ext[v * 4 + 3]; }
        geo.setAttribute('aE6Splat', new THREE.BufferAttribute(sp, 2));
        geo.setAttribute('aE6', new THREE.BufferAttribute(e6, 2));
      }
      geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.name = `${name}:${mat.name || 'mat'}`; m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }
}

/**
 * One floe into the batch: an irregular outline of size `s` (m across) and thickness `th` round (x, z), its underside
 * at y0; `tilt` (rad) leans it about a random horizontal axis (its low edge kept at y0); `top`: the top's material.
 * Returns its footprint radius.
 */
function floe(B, R, x, z, s, th, { y0 = -0.04, tilt = 0, top, edge = edgeMaterial(), aspect = null, yaw = R() * Math.PI * 2 } = {}) {
  const n = 5 + Math.floor(R() * 5), asp = aspect ?? (0.45 + R() * 0.55), ring = [];
  // jagged: each corner its own radius, now and then a deep notch (a piece broken out)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (R() - 0.5) * (4 / n);
    let r = (0.55 + R() * 0.45) * (s / 2);
    if (R() < 0.18) r *= 0.45 + R() * 0.2;
    ring.push([Math.cos(a) * r, Math.sin(a) * r * asp]);
  }
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  // the lean: about a horizontal axis at angle ta; the low edge stays at y0
  const ta = R() * Math.PI * 2, ax = Math.cos(ta), az = Math.sin(ta);
  const lean = (lx, lz) => Math.tan(tilt) * (lx * -az + lz * ax); // height gained across the axis
  let minLean = 0;
  for (const [lx, lz] of ring) minLean = Math.min(minLean, lean(lx, lz));
  const P = (lx, ly, lz) => [x + lx * cy - lz * sy, y0 + ly + lean(lx, lz) - minLean, z + lx * sy + lz * cy];
  // the top: a hummock (a raised centre a little off-centre, an uneven rim)
  // (the centre within a third of the nearest corner's reach: past a notched corner a fan triangle turned over, its top
  // lying over its neighbour's)
  let rMin = Infinity;
  for (const [lx, lz] of ring) rMin = Math.min(rMin, Math.hypot(lx, lz));
  const hc = th * (1.05 + R() * 0.25), cx0 = (R() - 0.5) * 0.4 * rMin, cz0 = (R() - 0.5) * 0.4 * rMin * asp;
  const C = P(cx0, hc, cz0);
  const tops = ring.map(([lx, lz]) => P(lx, th * (0.82 + R() * 0.3), lz));
  const bots = ring.map(([lx, lz]) => P(lx * 0.92, -0.02, lz * 0.92));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    B.tri(top, C, tops[j], tops[i]);
    B.tri(edge, tops[i], tops[j], bots[j]); B.tri(edge, tops[i], bots[j], bots[i]);
  }
  return (s / 2) * Math.max(1, asp);
}

/**
 * Placed floes' discs, so that no two lie flat on each other (two tops in one plane would fight). Bucketed on a 2 m grid
 * (the same test as against every disc: only the cells a disc as big as the biggest yet could reach are looked at).
 */
class Spots {
  constructor() { this.cells = new Map(); this.maxR = 0; }
  key(i, j) { return i * 100003 + j; }
  free(x, z, r) {
    const C = 2, reach = Math.ceil((r + this.maxR) / C), ci = Math.floor(x / C), cj = Math.floor(z / C);
    for (let i = ci - reach; i <= ci + reach; i++) {
      for (let j = cj - reach; j <= cj + reach; j++) {
        const list = this.cells.get(this.key(i, j));
        if (list) for (const q of list) if (!(Math.hypot(q[0] - x, q[1] - z) > q[2] + r)) return false;
      }
    }
    return true;
  }
  add(x, z, r) {
    const k = this.key(Math.floor(x / 2), Math.floor(z / 2));
    let list = this.cells.get(k);
    if (!list) this.cells.set(k, (list = []));
    list.push([x, z, r]);
    this.maxR = Math.max(this.maxR, r);
  }
}

/** A size 0.3–3 m, most of them small (a long tail of big pans). */
const sizeOf = (R, lo = 0.3, hi = 3.0) => lo + (hi - lo) * Math.pow(R(), 2.6);

/**
 * The harbour's broken ice. o: {channel, mines: [{x, z}], ridges, holes, tug: {x, z, w, d}, keep(x, z), wind: [dx, dz]
 * (blowing towards), rng, sheet (sheetTopMaterial: the slabs' tops), bounds: [W, D] (the map the sheet's splat covers)}.
 */
export function buildHarbourIce(o) {
  const R = o.rng, B = new Batch(), spots = new Spots(), C = o.channel, keep = o.keep || (() => true);
  // (tops: a snow crust on the pans broken off the snow-covered sheet; refrozen grey slush with a broken crust; dirty
  // grey-brown slush churned by the breaker's screw — the last two take the scene's snow held back, iceTop)
  const crust = snowCrustMaterial(), grey = iceTop('grey', 0x9eaab6, -0.85), dirty = iceTop('dirty', 0x7f8890, -1.4);
  const topOf = () => { const r = R(); return r < 0.45 ? crust : r < 0.8 ? grey : dirty; };
  const wind = o.wind || [-0.6, 0.8]; // (from the north-east: the brash drifts to the south-west shores)
  const sdC = polyIndex(C), inWater = (x, z, m = 0.25) => sdC(x, z) < -m;
  const tug = o.tug, nearHull = (x, z, pad) => tug && Math.abs(x - tug.x) < tug.w / 2 + pad && Math.abs(z - tug.z) < tug.d / 2 + pad;

  // ---- the mines frozen in: a heaved collar of crusted ice (one low floe), two or three shards leaning on it
  for (const m of o.mines || []) {
    floe(B, R, m.x, m.z, 1.7 + R() * 0.4, 0.07 + R() * 0.05, { y0: -0.03, top: crust, aspect: 0.75 + R() * 0.25 });
    const k = 2 + (R() < 0.5 ? 1 : 0);
    for (let i = 0; i < k; i++) {
      const a = R() * Math.PI * 2, r = 0.95 + R() * 0.15; // (outside the collar's top: no top on top)
      floe(B, R, m.x + Math.cos(a) * r, m.z + Math.sin(a) * r, 0.22 + R() * 0.2, 0.05 + R() * 0.04, { y0: -0.02, tilt: 0.5 + R() * 0.5, top: topOf() });
    }
  }

  // ---- the fast ice's broken edge along every bank of open water (o.banks: the channel and the lead, the berth's slip):
  // slabs over the water, cracks, bays and tongues, rafted plates, brash off the edge (iceEdge); along a stone bank (a
  // mole's head, the tower's face, a quay wall) brash afloat against the stone, thicker where the wind packs it in
  const occ = new Occ(...(o.occBox || [70, -20, 190, 70]));
  const wet = wetMaterial(), slushM = iceTop('slush', 0x8a96a0, -1.4);
  // (the slabs' tops: the sheet's own surface when the terrain is there to lend its shader, else the crust)
  const mats = { crust, grey, dirty, edge: edgeMaterial(), wet, slush: slushM, pick: topOf, sheet: o.sheet || null, log: [] };
  let slabs = 0;
  // (the coping's face along a quay: 0.12 m out from the pavement's edge, pavement/road-mesh.js copingProfile)
  const quays = o.quays || [];
  const wallAt = (x, z) => {
    let m = Infinity;
    for (const qp of quays) m = Math.min(m, polySD(qp, x, z));
    return m > 0.6 ? null : m - 0.12; // (>= 0: out past the coping's face; null: no quay here)
  };
  for (const bank of o.banks || []) {
    const sd = bank.poly === C ? sdC : polyIndex(bank.poly);
    slabs += iceEdge(B, R, { wind, ...bank, sd, bounds: o.bounds }, mats, spots, occ);
    if (bank.iceFoot && quays.length) iceFoot(B, R, bank, mats, occ, wallAt);
    if (bank.rubble) edgeRubble(B, R, bank, mats, spots, occ);
    const { pts } = bankSamples(bank.poly, 0.5);
    for (const p of pts) {
      if (p.z < (bank.zMin ?? -14) || !keep(p.x, p.z) || !bank.stone?.(p.x - p.nx * 0.8, p.z - p.nz * 0.8) || R() > 0.55) continue;
      const lee = Math.max(0, -(p.nx * wind[0] + p.nz * wind[1]));
      const off = 0.3 + Math.pow(R(), 1.6) * (0.9 + lee * 2.4), x = p.x + p.nx * off, z = p.z + p.nz * off;
      const sz = sizeOf(R, 0.25, 0.8 + lee * 0.8);
      if (sd(x, z) > -sz * 0.35 || bank.blocked?.(x, z) || nearHull(x, z, 0.15) || occ.disc(x, z, sz * 0.45) || !spots.free(x, z, sz * 0.45)) continue;
      spots.add(x, z, sz * 0.45);
      floe(B, R, x, z, sz, 0.04 + R() * 0.08, { y0: -0.085, tilt: R() < 0.2 ? 0.06 + R() * 0.1 : 0, top: topOf() });
    }
  }

  for (const pit of [].concat(o.pit || [])) pitBrash(B, R, pit, mats, spots, occ);

  // ---- the lead round the tug: brash packed along the hull (the breaker's own wash), drifted to the lee shore,
  // a few big pans out in the open water, some rafted on each other
  if (tug) {
    for (let k = 0; k < 260; k++) {
      // along the hull: a band 0.2–2.5 m off its sides and ends
      const side = Math.floor(R() * 4), u = R() - 0.5, d = 0.2 + Math.pow(R(), 1.8) * 2.3;
      const x = side < 2 ? tug.x + u * (tug.w + 1) : tug.x + (side === 2 ? -1 : 1) * (tug.w / 2 + d);
      const z = side < 2 ? tug.z + (side === 0 ? -1 : 1) * (tug.d / 2 + d) : tug.z + u * (tug.d + 1);
      const sz = sizeOf(R, 0.3, 1.4);
      if (!inWater(x, z, sz * 0.3) || nearHull(x, z, 0.1) || !keep(x, z) || occ.disc(x, z, sz * 0.45) || !spots.free(x, z, sz * 0.4)) continue;
      spots.add(x, z, sz * 0.42);
      floe(B, R, x, z, sz, 0.05 + R() * 0.1, { y0: -0.05, tilt: R() < 0.15 ? 0.1 + R() * 0.2 : 0, top: R() < 0.3 ? crust : R() < 0.6 ? grey : dirty });
    }
  }
  // the open water of the lead and the channel's mouth: drifted pans, thicker to the south-west
  const [x0, x1, z0, z1] = [80, 140, -8, 63];
  for (let k = 0; k < 420; k++) {
    const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
    // (drift: keep more of them the further downwind they lie in the lead)
    const dl = (x - 120) * wind[0] + (z - 55) * wind[1];
    if (R() > 0.25 + 0.06 * Math.max(0, dl)) continue;
    const sz = R() < 0.08 ? 1.8 + R() * 1.2 : sizeOf(R, 0.3, 1.3);
    if (!inWater(x, z, sz * 0.35 + 0.15) || nearHull(x, z, 0.3) || !keep(x, z) || occ.disc(x, z, sz * 0.5) || !spots.free(x, z, sz * 0.45)) continue;
    spots.add(x, z, sz * 0.48);
    const th = 0.05 + R() * (sz > 1.5 ? 0.22 : 0.12);
    floe(B, R, x, z, sz, th, { y0: -0.06, top: topOf() });
    // now and then a piece shoved up onto a big pan (rafted), clearly above its top
    if (sz > 1.4 && R() < 0.5) {
      const a = R() * Math.PI * 2, rr = sz * 0.22;
      floe(B, R, x + Math.cos(a) * rr, z + Math.sin(a) * rr, 0.35 + R() * 0.5, 0.06 + R() * 0.07, { y0: -0.06 + th * 1.3 + 0.05, tilt: 0.25 + R() * 0.45, top: topOf() });
    }
  }

  // ---- pressure ridges: blocks shoved up and piled along a line — chunky (thick for their size), leaning 15-45 degrees
  // on each other, high in places and down to a low rubble line between, small rubble spilled at their foot; a
  // refrozen crack (`h` < 1) only its low rubble. (Tall thin slabs standing near upright read as fins, not ice.)
  for (const ridge of o.ridges || []) {
    const line = Array.isArray(ridge[0]) ? ridge : ridge.pts, hs = ridge.h ?? 1;
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, az] = line[i], [bx, bz] = line[i + 1], L = Math.hypot(bx - ax, bz - az), ph = R() * 6.28;
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (let s = 0; s < L; s += 0.24 + R() * 0.36) {
        const t = s / L, hgt = hs * (0.3 + 0.7 * Math.max(0, Math.sin(s * 0.21 + ph) * 0.6 + Math.sin(s * 0.57 + ph * 2) * 0.4));
        const off = (R() - 0.5) * 1.6 * (0.5 + hgt), x = ax + (bx - ax) * t + nx * off, z = az + (bz - az) * t + nz * off;
        if (!keep(x, z) || R() > 0.55 + hgt * 0.4 || occ.disc(x, z, 0.6)) continue;
        const big = R() < 0.35 * hgt, sz = big ? 0.7 + R() * 0.9 * hs : sizeOf(R, 0.25, 0.4 + 0.5 * hgt);
        const th = Math.min(sz * 0.45, 0.1 + R() * (big ? 0.22 : 0.12)) * (0.6 + 0.4 * hs);
        floe(B, R, x, z, sz, th, { y0: -0.03 + R() * 0.16 * hgt, tilt: (0.25 + R() * 0.55) * Math.min(1, 0.45 + hgt), top: topOf() });
        // rubble at the foot, on the side it fell
        if (R() < 0.35 * hgt + 0.15) {
          const d = (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.6), rx = x + nx * d, rz = z + nz * d;
          const rs = 0.15 + R() * 0.25; // (clear of the other rubble it could lie flat beside: spots)
          if (keep(rx, rz) && !occ.disc(rx, rz, rs * 0.5) && spots.free(rx, rz, rs * 0.5)) { spots.add(rx, rz, rs * 0.5); floe(B, R, rx, rz, rs, 0.05 + R() * 0.05, { y0: -0.02, tilt: R() * 0.5, top: topOf() }); }
        }
      }
    }
  }

  // ---- the fishermen's holes: dark water in a ragged hole, a grey slush rim, a few chunks thrown out to one side
  const water = holeWater(), slush = iceTop('slush', 0x8a96a0, -1.4); // (wet grey slush: no snow lies on it)
  for (const [hx, hz] of o.holes || []) {
    // (a hacked hole: many short edges, bitten in and chipped out, longer one way; the slush pushed out unevenly)
    const n = 15 + Math.floor(R() * 5), rim = [], hole = [], ax = 0.75 + R() * 0.25, rot = R() * Math.PI;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (R() - 0.5) * 0.25;
      let r = 0.3 + R() * 0.1;
      if (R() < 0.25) r *= R() < 0.5 ? 0.78 : 1.22; // a bite, a chip
      const c = Math.cos(a), sn = Math.sin(a), px = c * r, pz = sn * r * ax;
      hole.push([hx + px * Math.cos(rot) - pz * Math.sin(rot), hz + px * Math.sin(rot) + pz * Math.cos(rot)]);
      const rr = r + 0.14 + R() * 0.42 * (0.5 + 0.5 * Math.abs(Math.sin(a * 1.7 + rot)));
      const qx = c * rr, qz = sn * rr * ax;
      rim.push([hx + qx * Math.cos(rot) - qz * Math.sin(rot), hz + qx * Math.sin(rot) + qz * Math.cos(rot)]);
    }
    // the water 4 cm under the slush; the slush a sloping ring 3–7 cm over the ice (never flat on it)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      B.tri(water, [hx, 0.028, hz], [hole[j][0], 0.028, hole[j][1]], [hole[i][0], 0.028, hole[i][1]]);
      const hi = 0.065 + (i % 3) * 0.008, hj = 0.065 + (j % 3) * 0.008;
      B.tri(slush, [hole[i][0], hi, hole[i][1]], [hole[j][0], hj, hole[j][1]], [rim[j][0], 0.035, rim[j][1]]);
      B.tri(slush, [hole[i][0], hi, hole[i][1]], [rim[j][0], 0.035, rim[j][1]], [rim[i][0], 0.035, rim[i][1]]);
      B.tri(edgeMaterial(), [hole[i][0], hi, hole[i][1]], [hole[i][0], 0.0, hole[i][1]], [hole[j][0], 0.0, hole[j][1]]);
      B.tri(edgeMaterial(), [hole[i][0], hi, hole[i][1]], [hole[j][0], 0.0, hole[j][1]], [hole[j][0], hj, hole[j][1]]);
    }
    // chunks chopped out and thrown aside: two to five, of different sizes, on one side (where the man stood)
    const side = R() * Math.PI * 2, k = 2 + Math.floor(R() * 4);
    for (let i = 0; i < k; i++) {
      const a = side + (R() - 0.5) * 1.6, r = 0.95 + R() * 0.9, sz = 0.18 + R() * 0.45;
      const x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r;
      if (!spots.free(x, z, sz * 0.5)) continue;
      spots.add(x, z, sz * 0.5);
      floe(B, R, x, z, sz, 0.06 + R() * 0.08, { y0: 0.0, tilt: 0.15 + R() * 0.7, top: R() < 0.5 ? grey : crust });
    }
  }
  const g = B.build('e06:ice');
  g.userData.slabs = slabs;
  g.userData.slabAt = mats.log; // (each slab's middle and whether it broke free: tests, tools)
  return g;
}
