/**
 * Ruin kit (user 2026-11-10: "Buildings in ruins should look more realistic"): the shared generators every ruin builder
 * draws its broken masonry with — mud-brick village walls (M8, M9, M10), field-stone walls (M11, M16, M18, M19), burnt
 * brick houses (M15) and the dressing laid over the library's bombed shells (art/ruin-dress.js: M4, M6, M7, M15 …).
 *
 *  - break edge (`breakProfile`): a broken wall head that is jagged and irregular at every scale — a wandering line,
 *    collapse bites with sloping sides, corners standing higher, free ends broken down — cut into the masonry's own
 *    units: brick and stone break along their courses (small, uneven steps a course high, never a row of crenels),
 *    mud brick crumbles round and soft (smooth, rain-rounded, gullied). The two faces break at different heights, so
 *    the head shows the wall's thickness and its rubble core; loose units lie on it;
 *  - wall (`wallRun`): the masonry along a polyline from that edge — the face texture's courses exposed at the break,
 *    the render / plaster surviving in ragged spalled patches lower down (`skin`), the joist pockets of a lost floor;
 *  - rubble (`mound`, `talus`, `scatter`): mounds of the fallen masonry sloping against the walls and under each
 *    collapse, loose units half-sunk in them and strewn round the ruin, sand-drifted in the desert (`drift`); the snow
 *    theatres' top-facing snow shader covers them like every prop (terrain.coverPropsWithSnow);
 *  - structure remains (`beam`, `chimney`): charred beams always resting ON something — a wall head, a joist pocket, a
 *    mound or the ground (`supportAt` says what is there; tests/unit/ruin-kit.test.mjs checks every end);
 *  - weathering: one vertex-colour layer over the masonry texture — soot and scorch streaks under the broken top and
 *    above the openings, damp / dust at the foot, AO where the wall meets the ground and in the core, a per-ruin tint
 *    (seeded: no two ruins the same colour); weeds in the rubble (temperate).
 *
 * VISUAL ONLY: everything the kit builds is one group with `userData.clip = false`, so no gameplay measure of the
 * structure (nav stamps, low surfaces, body solids, placement hulls, the clip audit: world/placement-visual.js) ever
 * sees it. A builder that replaces its old look keeps the old meshes as the stamping source: `navProxy` stops them
 * drawing (a hidden material of the same name) while leaving them where every measure finds them, unchanged.
 * Draw calls: one masonry mesh per ruin (walls, units, mounds, beams share its material, coloured per vertex), a skin
 * mesh (render / plaster, the desert drifts, weeds) and a decal mesh where used (no shadows). Deterministic by seed.
 * @module art/ruin-kit
 */
import * as THREE from 'three';
import { dressingMaterial, rng, seedOf, fbm, libTexture } from './dressing.js';
import { scopedMemo } from '../engine/scoped-assets.js';

// ---------------------------------------------------------------- styles

/**
 * Masonry kinds: face texture set + its tile (m per repeat), the unit (one brick / stone, m: length, height, depth),
 * the course height a break steps by, column widths (m) the head is cut into, the skin (render / plaster) set, the
 * crumble ('angular' steps on courses, 'round' smooth), base colour multipliers.
 */
export const RUIN_KINDS = {
  brick: { bulge: 0.008, face: 'brick', tile: 1.0, unit: [0.23, 0.07, 0.11], course: 0.075, cols: [0.115, 0.46], crumble: 'angular', skin: 'plaster', skinTile: 3.0,
    core: [0.78, 0.72, 0.68], dust: [1.5, 1.42, 1.36], tintVar: 0.1 },
  mud: { face: 'mudbrick', tile: 2.0, unit: [0.34, 0.09, 0.17], course: 0.1, cols: [0.16, 0.42], crumble: 'round', skin: 'adobe', skinTile: 2.5,
    core: [0.92, 0.87, 0.8], dust: [1.24, 1.18, 1.08], tintVar: 0.08, base: [1.24, 1.17, 1.07], bulge: 0.035, skinK: [1.1, 1.07, 1.02] },
  stone: { bulge: 0.02, face: 'fieldstone', tile: 1.52, unit: [0.36, 0.17, 0.24], course: 0.18, cols: [0.22, 0.6], crumble: 'angular', skin: 'plasterRough', skinTile: 2.0,
    core: [0.8, 0.78, 0.74], dust: [1.25, 1.22, 1.18], tintVar: 0.08 },
  stoneGrey: { bulge: 0.02, face: 'stone', tile: 1.7, unit: [0.34, 0.16, 0.22], course: 0.17, cols: [0.22, 0.56], crumble: 'angular', skin: 'plasterRough', skinTile: 2.0,
    core: [0.8, 0.78, 0.75], dust: [1.25, 1.24, 1.22], tintVar: 0.07 },
  limestone: { bulge: 0.02, face: 'rubble', tile: 2.0, unit: [0.36, 0.19, 0.25], course: 0.2, cols: [0.24, 0.62], crumble: 'angular', skin: 'mudRender', skinTile: 1.6,
    core: [0.86, 0.82, 0.75], dust: [1.16, 1.1, 1.0], tintVar: 0.07, base: [1.18, 1.1, 0.96] },
  rubbleStone: { bulge: 0.02, face: 'rubble', tile: 2.0, unit: [0.34, 0.18, 0.24], course: 0.19, cols: [0.24, 0.6], crumble: 'angular', skin: 'plasterRough', skinTile: 2.0,
    core: [0.84, 0.8, 0.75], dust: [1.2, 1.16, 1.08], tintVar: 0.07 },
};

/** Theatre weathering: foot colour (damp / dust), soot colour, weeds, sand drifts. */
const THEATRE = {
  temperate: { foot: [0.48, 0.48, 0.38], weeds: 1, drift: 0 },
  night: { foot: [0.48, 0.48, 0.38], weeds: 1, drift: 0 },
  coast: { foot: [0.5, 0.52, 0.44], weeds: 0.6, drift: 0 },
  snow: { foot: [0.52, 0.53, 0.56], weeds: 0, drift: 0 },
  desert: { foot: [0.74, 0.66, 0.56], weeds: 0, drift: 1 },
};
const SOOT = [0.045, 0.04, 0.036]; // (vertex colours are linear: a soot black that reads as black)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- materials

const MATS = new Map();
/**
 * The kit's material for a dressing set: the set's own (textured, anti-tiled) material with vertex colours on — one
 * per set, shared by every ruin of the mission (compiled by the load's warm-up frame like every prop's).
 * @param {string} set dressing set name (art/dressing.js SETS)
 */
export function ruinMaterial(set) {
  return scopedMemo('ruin-kit:mat', MATS, set, () => {
    const m = dressingMaterial(set).clone();
    m.vertexColors = true;
    m.name = `ruin:${set}`;
    m.userData.shared = true;
    return m;
  }, { free: (m) => m.dispose() });
}

/** Weathering decal atlases (textures/lib: tools/blender/kit/lib/decals.json), cells [u0, v0, u1, v1]. */
export const DECALS = {
  decals_rgba: { streak_rain: [0, 0.75, 0.25, 1], moss_patch: [0.5, 0.75, 0.75, 1], damp_base: [0.75, 0.75, 1, 1], soot: [0, 0.5, 0.25, 0.75],
    crack: [0.25, 0.5, 0.5, 0.75], lichen: [0.75, 0.5, 1, 0.75], efflorescence: [0, 0.25, 0.25, 0.5], stain_blotch: [0.25, 0.25, 0.5, 0.5],
    dirt_splash: [0.5, 0.25, 0.75, 0.5], streak_long: [0.75, 0.25, 1, 0.5] },
  decals_dz_rgba: { soot_a: [0, 0.75, 0.25, 1], soot_b: [0.25, 0.75, 0.5, 1], grime_a: [0.5, 0.75, 0.75, 1], grime_b: [0.75, 0.75, 1, 1],
    damp_rise: [0, 0.5, 0.25, 0.75], dust_wash: [0.75, 0.5, 1, 0.75], scorch_a: [0, 0.25, 0.25, 0.5], scorch_b: [0.25, 0.25, 0.5, 0.5],
    crack_fine: [0, 0, 0.25, 0.25], render_loss: [0.25, 0, 0.5, 0.25], ash: [0.75, 0, 1, 0.25] },
};
const HAS_DOM = typeof document !== 'undefined';
const DECAL_MATS = new Map();
/** The decal atlas material (transparent, no depth write, pulled towards the camera; tinted per vertex). */
export function decalMaterial(atlas) {
  return scopedMemo('ruin-kit:decal', DECAL_MATS, atlas, () => {
    const m = new THREE.MeshStandardMaterial({ name: `ruin:decal:${atlas}`, transparent: true, depthWrite: false, roughness: 1, metalness: 0,
      vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      map: HAS_DOM ? libTexture(`${atlas}.png`, true) : null, color: HAS_DOM ? 0xffffff : 0x444444 });
    m.userData.shared = true;
    return m;
  }, { free: (m) => m.dispose() });
}

const HIDDEN = new Map();
/** A never-drawn material carrying `name` (the gameplay measures read material names: snow). */
function hiddenMaterial(name) {
  let m = HIDDEN.get(name);
  if (!m) { m = new THREE.MeshBasicMaterial({ visible: false, name }); m.userData.shared = true; m.userData.navProxy = true; HIDDEN.set(name, m); }
  return m;
}

/**
 * Keep `root`'s meshes as the gameplay stamping source but stop drawing them: each keeps its geometry, place, name
 * and `visible` (every measure walks visible meshes), its material swapped for a hidden one of the same name; no
 * shadow. The new look is drawn by the kit's group (`userData.clip = false`) beside them. @returns {THREE.Object3D}
 */
export function navProxy(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => hiddenMaterial(m?.name ?? '')) : hiddenMaterial(o.material?.name ?? '');
    o.castShadow = false; o.receiveShadow = false;
    o.userData.navProxy = true;
  });
  root.userData.navProxy = true;
  return root;
}

// ---------------------------------------------------------------- geometry buckets

/** Triangle soup with per-vertex colour (non-indexed: flat-shaded facets suit broken masonry). */
class Bucket {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; }
  get count() { return this.p.length / 3; }
  /** One triangle (corners [x, y, z], uvs [u, v], colours [r, g, b]); the facet normal from its winding. */
  tri(a, b, c, ua, ub, uc, ca, cb, cc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-12)) return; // (degenerate — or not finite: never a NaN corner in the buffers)
    nx /= l; ny /= l; nz /= l;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    this.c.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
  }
  /** Quad a-b-c-d (counter-clockwise seen from its front). */
  quad(a, b, c, d, ua, ub, uc, ud, ca, cb, cc, cd) {
    this.tri(a, b, c, ua, ub, uc, ca, cb, cc);
    this.tri(a, c, d, ua, uc, ud, ca, cc, cd);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

const mul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

/** Box corners of a unit (half extents hx, hy, hz) with chipped corners, placed by a 3×3 rotation + centre. */
const BOX_FACES = [[0, 1, 3, 2], [4, 6, 7, 5], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]; // (no bottom: never seen)

// ---------------------------------------------------------------- the break edge

/**
 * A broken wall head along a run `len` m long for gameplay height `h`: `top(u)` (m) for u in [0, len] — never below
 * `min` × h nor above `max` × h. Large scale: a wandering line with collapse bites (sloping sides, flat or ragged
 * floors), the ends: `endA` / `endB` 'free' (broken down) | 'corner' (standing higher) | 'flush'. Seeded.
 * @returns {{top: (u: number) => number, bites: {u: number, w: number, d: number}[]}}
 */
export function breakProfile(len, h, R, o = {}) {
  const lo = (o.min ?? 0.62) * h, hi = (o.max ?? 1.06) * h, base = h * (o.base ?? 0.93);
  const knots = [];
  const step = o.round ? 0.9 : 0.7;
  let v = base + (R() - 0.5) * 0.1 * h;
  for (let u = 0; u <= len + step; u += step * (0.6 + R() * 0.8)) {
    v += (R() - 0.5) * 0.16 * h + (base - v) * 0.25;
    knots.push([Math.min(u, len + step), clamp(v, lo, hi)]);
  }
  const bites = [];
  const nb = Math.max(o.bites ?? 0, Math.round(len / (o.biteEvery ?? 5.5) * (0.6 + R() * 0.8)));
  for (let k = 0; k < nb; k++) {
    const w = (0.4 + R() * Math.min(1.6, len * 0.18)) * (o.biteW ?? 1), d = (0.25 + R() * 0.75) * (hi - lo) * (o.biteDepth ?? 1);
    bites.push({ u: w + R() * Math.max(0.01, len - 2 * w), w, d, floor: R() * 0.5, skew: (R() - 0.5) * 0.6 });
  }
  const walk = (u) => {
    let i = 0;
    while (i + 1 < knots.length - 1 && knots[i + 1][0] < u) i++;
    const [a, va] = knots[i], [b, vb] = knots[Math.min(i + 1, knots.length - 1)];
    const t = b > a ? clamp((u - a) / (b - a), 0, 1) : 0;
    return lerp(va, vb, o.round ? t * t * (3 - 2 * t) : t);
  };
  const endDrop = (u, kind) => {
    if (kind === 'corner') return -(0.05 + 0.06 * fbm(u * 2, 3.3, 0, 77, 1)) * h * smooth(1.2, 0, u);
    if (kind === 'free') return (0.2 + 0.3 * Math.abs(fbm(len * 0.37, 1.7, 0, 91, 1))) * h * smooth(1.8, 0, u);
    return 0;
  };
  const endLo = (u, kind) => (kind === 'free' ? (o.endLo ?? 0.22) * h * smooth(0.9, 0, u) : 0);
  const top = (u) => {
    let y = walk(u);
    for (const b of bites) {
      const x = (u - b.u) / b.w;
      const a = Math.abs(x + b.skew * x * x);
      if (a < 1) y -= b.d * (a < b.floor ? 1 : 1 - smooth(b.floor, 1, a));
    }
    y -= endDrop(u, o.endA) + endDrop(len - u, o.endB);
    y += (o.round ? 0.025 : 0.04) * h * fbm(u * 1.9, 0.5, 0, o.seed ?? 5, 2);
    return clamp(y, lo - endLo(u, o.endA) - endLo(len - u, o.endB), hi);
  };
  return { top, bites, lo, hi };
}

// ---------------------------------------------------------------- the kit

/**
 * One ruin's builder: accumulate walls, rubble, beams and weathering, then `build()` one visual-only group.
 * @param {{kind?: keyof RUIN_KINDS, theater?: string, id?: string, seed?: string|number, soot?: number, detail?: number,
 *   skin?: string|null, tint?: number[]}} o soot 0..1 (a burnt-out house 1, a shelled field wall 0.15); detail scales
 *   the loose units (0.5 on a busy start view)
 */
export class RuinKit {
  constructor(o = {}) {
    this.style = RUIN_KINDS[o.kind] || RUIN_KINDS.brick;
    this.kindName = RUIN_KINDS[o.kind] ? o.kind : 'brick';
    this.theater = THEATRE[o.theater] ? o.theater : 'temperate';
    this.T = THEATRE[this.theater];
    this.id = String(o.id ?? o.seed ?? 'ruin');
    this.seed = seedOf(`ruin-kit:${o.seed ?? this.id}`);
    this.R = rng(this.seed);
    this.soot = o.soot ?? 0.35;
    this.detail = o.detail ?? 1;
    this.faceSet = o.face ?? this.style.face;
    this.skinSet = o.skin === undefined ? this.style.skin : o.skin;
    const R = this.R, tv = this.style.tintVar;
    // per-ruin colour: brightness and a warm / cool cast (seeded: no two ruins the same)
    const k = 1 + (R() - 0.5) * 2 * tv, warm = (R() - 0.5) * tv;
    const b0 = this.style.base || [1, 1, 1];
    this.tint = o.tint ?? [b0[0] * k * (1 + warm), b0[1] * k, b0[2] * k * (1 - warm)];
    this.face = new Bucket(); this.skin = new Bucket(); this.sand = new Bucket(); this.decals = new Map();
    this.walls = []; this.mounds = []; this.beams = []; this.pieces = 0; this.supports = [];
  }

  // ------------------------------------------------------------ colour layer

  /** Vertex colour of the masonry at height y on a wall whose broken top is `top` there (`face`: 1 outer, -1 inner). */
  wallColour(s, y, top, o = {}) {
    const st = this.style, T = this.T;
    let c = this.tint.slice();
    // per-column / per-patch variation of the units (the texture's own courses carry the bricks)
    c = scale3(c, 1 + 0.07 * fbm(s * 1.7, y * 2.1, 3, this.seed & 0xffff, 2));
    // the core and the head: dustier, lighter mortar; moss and lichen on a field wall's head (temperate)
    if (o.core) {
      c = mul(c, st.core);
      if (o.moss && this.T.weeds > 0) c = mix3(c, [0.5, 0.6, 0.32], smooth(0.1, 0.6, fbm(s * 1.4, y * 3, 6, this.seed & 0x7ff, 3) * 0.5 + 0.5) * 0.55);
    }
    // the foot: damp / dust band, AO where the wall meets the ground
    const foot = 1 - smooth(0.05, 0.7 + 0.25 * fbm(s * 0.8, 1, 0, 3, 2), y);
    c = mix3(c, mul(c, T.foot), foot * 0.85);
    c = scale3(c, 1 - 0.6 * (1 - smooth(-0.12, 0.32, y)));
    // soot: a blackened band under the broken head (fire inside), vertical streaks, heavier inside a burnt house
    const soot = this.soot * (o.inner ? 1.25 : 1) * (o.sootK ?? 1);
    if (soot > 0) {
      const streak = smooth(0.15, 0.75, fbm(s * 2.6, 0.3, 1, this.seed & 0xfff, 3) * 0.5 + 0.5);
      const band = smooth(top - 1.1 - 0.4 * streak, top - 0.05, y) * 0.6 + streak * smooth(top * 0.3, top, y) * 0.45;
      const blot = smooth(0.35, 0.9, fbm(s * 0.9, y * 0.7, 2, this.seed & 0x3ff, 3) * 0.5 + 0.5) * 0.35;
      // a burnt room: the smoke layer blackened everything above a ragged line about half way up
      const smoke = o.inner && this.soot > 0.6 ? smooth(-0.15, 0.25, y - this.smokeLine(s)) * 0.85 : 0;
      c = mix3(c, mul(c, SOOT), clamp(soot * Math.max(smoke, band + blot * smooth(0.4, 1.4, y)), 0, 0.95));
    }
    return c;
  }

  // ------------------------------------------------------------ units (bricks, stones, chunks)

  /**
   * One loose unit (a brick, a stone, a half): an 8-corner box, chipped corners, placed at (x, y, z) with yaw / tilt.
   * `size` [l, h, d] m; `colour` multiplier; `y` is its centre.
   */
  unit(x, y, z, size, yaw, tiltX, tiltZ, colour, chip = 0.18) {
    const R = this.R, [l, hh, d] = size, hx = l / 2, hy = hh / 2, hz = d / 2;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cxr = Math.cos(tiltX), sxr = Math.sin(tiltX), czr = Math.cos(tiltZ), szr = Math.sin(tiltZ);
    const corners = [];
    for (let i = 0; i < 8; i++) {
      let px = (i & 4 ? 1 : -1) * hx * (1 - R() * chip), py = (i & 2 ? 1 : -1) * hy * (1 - R() * chip * 0.6), pz = (i & 1 ? 1 : -1) * hz * (1 - R() * chip);
      // tilt about x then z, then yaw about y
      let t = py * cxr - pz * sxr; pz = py * sxr + pz * cxr; py = t;
      t = px * czr - py * szr; py = px * szr + py * czr; px = t;
      corners.push([x + px * cy + pz * sy, y + py, z - px * sy + pz * cy]);
    }
    const tile = this.style.tile, ou = R() * 7, ov = R() * 7, col = colour;
    for (const [a, b, c, dd] of BOX_FACES) {
      const P = [corners[a], corners[b], corners[c], corners[dd]];
      // box uv: the unit's own size on the texture (one brick / stone of it), a random spot
      const span = (q, r) => Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]) / tile;
      const w = span(P[0], P[1]), h2 = span(P[1], P[2]);
      this.face.quad(P[0], P[1], P[2], P[3], [ou, ov], [ou + w, ov], [ou + w, ov + h2], [ou, ov + h2], col, col, col, col);
    }
    this.pieces++;
  }

  /** A unit's colour: the ruin's tint, a dusty / sooty / pale variant now and then. */
  unitColour(dusty = 0.3, burnt = this.soot) {
    const R = this.R;
    let c = scale3(this.tint, 0.82 + R() * 0.3);
    if (R() < dusty) c = mul(c, this.style.dust);
    if (R() < burnt * 0.5) c = mix3(c, mul(c, SOOT), 0.35 + R() * 0.45);
    return c;
  }

  // ------------------------------------------------------------ walls

  /**
   * Broken masonry along a polyline (world frame, the gameplay line): its head from `breakProfile`, cut into columns of
   * the kind's units; both faces, the head (thickness + core), the column steps, the ends. Records the wall for
   * `supportAt`. @param {number[][]} points @param {{h: number, width: number, min?: number, max?: number,
   * ends?: ('free'|'corner'|'flush')[], skin?: number|number[], skinTop?: number, pockets?: number, batter?: number,
   * crestUnits?: number, inner?: number}} o skin: share of each face rendered (number: both; [outer, inner]);
   * inner: which side (+1 / -1 across the line, left normal) is a burnt room's inside
   * @returns {{top: (k: number, u: number) => number, segments: object[]}}
   */
  wallRun(points, o) {
    const st = this.style, R = this.R, h = o.h, t = o.width, round = st.crumble === 'round';
    const segs = [];
    let s0 = 0;
    for (let k = 0; k + 1 < points.length; k++) {
      const [ax, az] = points[k], [bx, bz] = points[k + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-3) continue;
      const first = k === 0, last = k + 2 === points.length;
      const endA = first ? (o.ends?.[0] ?? 'free') : 'corner', endB = last ? (o.ends?.[1] ?? 'free') : 'corner';
      // run-ons: half the thickness past each joint and free end (corners close), none at a flush end
      const eA = endA === 'flush' ? 0 : t / 2, eB = endB === 'flush' ? 0 : t / 2, Lw = L + eA + eB;
      const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
      const prof = o.profile ? o.profile(k, Lw) : breakProfile(Lw, h, R, { min: o.min, max: o.max, base: o.base, endA, endB, round, seed: (this.seed + k) & 0xffff,
        biteEvery: o.biteEvery, biteDepth: o.biteDepth, biteW: o.biteW });
      const seg = { ax, az, bx, bz, L, Lw, eA, tx, tz, nx, nz, t, h, prof, s0, cols: [] };
      this.wallSegment(seg, o);
      segs.push(seg); this.walls.push(seg);
      s0 += L;
    }
    return { segments: segs, top: (k, u) => segs[k]?.prof.top(u) ?? 0 };
  }

  /** One straight run of a wall (see wallRun). */
  wallSegment(seg, o) {
    const st = this.style, R = this.R, round = st.crumble === 'round';
    const { ax, az, tx, tz, nx, nz, t, Lw, eA, prof } = seg;
    const course = st.course, batter = o.batter ?? (round ? 0.07 : 0);
    // columns along the run: widths from the unit (brick: half-brick multiples), heights quantised on courses
    const cols = [], CW = o.cols ?? st.cols;
    for (let u = 0; u < Lw - 1e-4;) {
      let w = CW[0] + R() * (CW[1] - CW[0]);
      if (!round) w = Math.max(CW[0], Math.round(w / st.cols[0]) * st.cols[0]);
      w = Math.min(w, Lw - u);
      if (Lw - u - w < CW[0] * 0.6) w = Lw - u;
      const um = u + w / 2;
      let yA = prof.top(um), yB;
      if (round) {
        yA = Math.min(prof.hi, yA + (R() - 0.5) * 0.03);
        yB = yA - Math.abs(fbm(um * 1.3, 2.2, 0, 31, 2)) * 0.14 - R() * 0.03;
      } else {
        const j = R();
        yA += j < 0.18 ? -course : j > 0.88 ? course : 0;
        yA = clamp(Math.round(yA / course) * course, prof.lo, Math.max(prof.lo, Math.floor(prof.hi / course) * course));
        const off = R() < 0.45 ? 0 : R() < 0.7 ? course : 2 * course;
        yB = Math.max(prof.lo - course, yA - off);
      }
      if (R() < 0.5) [yA, yB] = [yB, yA];
      // the head across the thickness: outer edge, the core (lumpy, a little proud or sunk), inner edge
      const eR = round ? 0.07 + R() * 0.05 : 0; // (mud brick melts: the head's edges rounded off well down its faces)
      const ym = Math.max(yA, yB) + (round ? 0.04 : (R() - 0.4) * course * 0.7);
      cols.push({ u0: u, u1: u + w, yA, yB, ym, eA: yA - eR, eB: yB - eR });
      u += w;
    }
    seg.cols = cols;
    // world position of (u along the run from its start incl. the run-on, across offset v, height y)
    const P = (u, v, y) => [ax + tx * (u - eA) + nx * v, y, az + tz * (u - eA) + nz * v];
    const bul = st.bulge ?? 0, bs = (this.seed + 7 * seg.s0) & 0xffff;
    const halfU = (u, y, side) => t / 2 * (1 + batter * (1 - clamp(y / Math.max(0.5, seg.h), 0, 1))) + bul * fbm((seg.s0 + u) * 0.7, y * 0.6, side, bs, 2);
    const y0 = o.base0 ?? -0.15;
    const ROWS = [y0, ...[0.12, 0.5, 1.0, 1.6, 2.3, 3.1, 4.0, 5.0, 6.2, 7.5, 9].filter((y) => y > y0 + 0.06)];
    const tile = st.tile, s0 = seg.s0 - eA;
    const skinShare = Array.isArray(o.skin) ? o.skin : [o.skin ?? 0, o.skin ?? 0];
    const inner = o.inner ?? 0;
    // faces: one quad strip per column per row (the colour layer needs the rows)
    for (const c of cols) {
      for (const side of [1, -1]) {
        const top = side > 0 ? c.yA : c.yB, edge = side > 0 ? c.eA : c.eB, isIn = inner !== 0 && side === inner;
        const ys = ROWS.filter((y) => y < edge - 0.02).concat([edge]);
        const col = (s, y) => this.wallColour(s, y, top, { inner: isIn });
        for (let r = 0; r + 1 < ys.length; r++) {
          const y0 = ys[r], y1 = ys[r + 1];
          const a = P(c.u0, side * halfU(c.u0, y0, side), y0), b = P(c.u1, side * halfU(c.u1, y0, side), y0), cc = P(c.u1, side * halfU(c.u1, y1, side), y1), d = P(c.u0, side * halfU(c.u0, y1, side), y1);
          const su0 = (s0 + c.u0) / tile * side, su1 = (s0 + c.u1) / tile * side;
          const ca = col(s0 + c.u0, y0), cb = col(s0 + c.u1, y0), cc2 = col(s0 + c.u1, y1), cd = col(s0 + c.u0, y1);
          if (side > 0) this.face.quad(a, b, cc, d, [su0, y0 / tile], [su1, y0 / tile], [su1, y1 / tile], [su0, y1 / tile], ca, cb, cc2, cd);
          else this.face.quad(b, a, d, cc, [su1, y0 / tile], [su0, y0 / tile], [su0, y1 / tile], [su1, y1 / tile], cb, ca, cd, cc2);
        }
      }
      // the head: outer edge → core → inner edge (the core lumpy and dusty)
      const um = (c.u0 + c.u1) / 2;
      const moss = !!o.moss;
      const coreC = this.wallColour(s0 + um, c.ym, c.ym, { core: true, moss });
      const eAc = this.wallColour(s0 + c.u0, c.eA, c.eA, { core: true, moss }), eBc = this.wallColour(s0 + c.u0, c.eB, c.eB, { core: true, moss });
      const A0 = P(c.u0, halfU(c.u0, c.eA, 1), c.eA), A1 = P(c.u1, halfU(c.u1, c.eA, 1), c.eA), M0 = P(c.u0, 0, c.ym), M1 = P(c.u1, 0, c.ym);
      const B0 = P(c.u0, -halfU(c.u0, c.eB, -1), c.eB), B1 = P(c.u1, -halfU(c.u1, c.eB, -1), c.eB);
      const uvT = (q) => [q[0] / tile, q[2] / tile];
      this.face.quad(A0, A1, M1, M0, uvT(A0), uvT(A1), uvT(M1), uvT(M0), eAc, eAc, coreC, coreC);
      this.face.quad(M0, M1, B1, B0, uvT(M0), uvT(M1), uvT(B1), uvT(B0), coreC, coreC, eBc, eBc);
    }
    // the steps between columns (only the part standing above the neighbour's head) and the two ends
    const ground = { eA: y0, ym: y0, eB: y0 };
    const heads = (c) => [c.eA, c.ym, c.eB];
    for (let i = 0; i <= cols.length; i++) {
      const Lc = cols[i - 1] || ground, Rc = cols[i] || ground, u = cols[i] ? cols[i].u0 : cols[i - 1].u1;
      const fl = heads(Lc), fr = heads(Rc);
      // across the thickness: outer (v = +1) → middle → inner (v = -1), the side face of the higher column
      const vs = [1, 0, -1];
      for (let q = 0; q < 2; q++) {
        for (const dir of [1, -1]) { // dir 1: the right column is higher (its face looks -u), -1: the left is (+u)
          const hiP = dir > 0 ? fr : fl, loP = dir > 0 ? fl : fr;
          const h0 = hiP[q] - loP[q], h1 = hiP[q + 1] - loP[q + 1];
          if (h0 <= 1e-3 && h1 <= 1e-3) continue;
          let f0 = 0, f1 = 1;
          if (h0 <= 0) f0 = h0 / (h0 - h1); else if (h1 <= 0) f1 = h0 / (h0 - h1);
          const vk = (k, y) => (vs[k] > 0 ? halfU(u, y, 1) : vs[k] < 0 ? -halfU(u, y, -1) : 0);
          const at = (f, arr) => lerp(arr[q], arr[q + 1], f), vv = (f, y) => lerp(vk(q, y), vk(q + 1, y), f);
          const pt = (f, arr) => { const y = at(f, arr); return P(u, vv(f, y), y); };
          const pts = [pt(f0, loP), pt(f1, loP), pt(f1, hiP), pt(f0, hiP)];
          const cl = this.wallColour(s0 + u, (at(f0, hiP) + at(f0, loP)) / 2, at(f0, hiP), { core: true });
          const uvS = (p) => [(nx * (p[0] - ax) + nz * (p[2] - az)) / tile, p[1] / tile];
          if (dir > 0) this.face.quad(pts[1], pts[0], pts[3], pts[2], uvS(pts[1]), uvS(pts[0]), uvS(pts[3]), uvS(pts[2]), cl, cl, cl, cl);
          else this.face.quad(pts[0], pts[1], pts[2], pts[3], uvS(pts[0]), uvS(pts[1]), uvS(pts[2]), uvS(pts[3]), cl, cl, cl, cl);
        }
      }
    }
    // loose units on the head (some half off it), a few fallen to the foot
    const crestN = Math.round(Lw * (o.crestUnits ?? (round ? 0.9 : 1.6)) * this.detail);
    const cap = o.capTop ?? Infinity;
    for (let n = 0; n < crestN; n++) {
      const c = cols[Math.floor(R() * cols.length)], u = lerp(c.u0, c.u1, R()), v = (R() - 0.5) * t * 0.8;
      const y = c.ym + st.unit[1] * 0.42;
      if (y + st.unit[1] * 0.6 > cap) continue;
      const [x, , z] = P(u, v, 0);
      this.unit(x, y, z, this.unitSize(R() < 0.3 ? 0.5 : 1), Math.atan2(-tz, tx) + (R() - 0.5) * 1.2, (R() - 0.5) * 0.3, (R() - 0.5) * 0.3, this.unitColour(0.45));
    }
    // joist pockets of a lost floor (a burnt house): dark recesses on the inside face in a row
    if (o.pockets && inner) {
      const y0 = o.pockets;
      for (let u = 0.5 + R() * 0.3; u < Lw - 0.5; u += 0.55 + R() * 0.25) {
        const c = cols.find((q) => u >= q.u0 && u < q.u1);
        const top = inner > 0 ? c?.yA : c?.yB;
        if (!c || top < y0 + 0.35) continue;
        const w = 0.13, hh = 0.2, v = (uu, y) => inner * (halfU(uu, y, inner) + 0.016);
        const a = P(u - w / 2, v(u - w / 2, y0), y0), b = P(u + w / 2, v(u + w / 2, y0), y0), cc = P(u + w / 2, v(u + w / 2, y0 + hh), y0 + hh), d = P(u - w / 2, v(u - w / 2, y0 + hh), y0 + hh);
        const dark = scale3(this.tint, 0.16);
        if (inner > 0) this.face.quad(a, b, cc, d, [0, 0], [0.05, 0], [0.05, 0.08], [0, 0.08], dark, dark, dark, dark);
        else this.face.quad(b, a, d, cc, [0, 0], [0.05, 0], [0.05, 0.08], [0, 0.08], dark, dark, dark, dark);
        seg.pocketsAt = seg.pocketsAt || [];
        seg.pocketsAt.push({ u, y: y0 });
      }
    }
    // render / plaster: ragged spalled patches on each face, never up to the break (the courses show there)
    if (this.skinSet) for (const side of [1, -1]) {
      const share = side > 0 ? skinShare[0] : skinShare[1];
      if (share > 0) this.skinFace(seg, side, share, o, halfU);
    }
  }

  /** Unit size, whole or half (`k` 0.5), a little variation (× the kit's `unitScale`: dressed blocks, big rubble). */
  unitSize(k = 1) {
    const R = this.R, [l, h, d] = this.style.unit, u = this.unitScale ?? 1;
    return [l * k * u * (0.9 + R() * 0.2), h * u * (0.9 + R() * 0.2), d * u * (0.9 + R() * 0.2)];
  }

  /**
   * A room's floor between ruined walls: beaten earth / lime plaster in ragged patches (marching squares over a noise
   * mask) on a rectangle (centre x, z; w × d along / across `rot`), a hair over the ground, in the skin's mesh.
   */
  floorPatch(x, z, w, d, rot, o = {}) {
    if (!this.skinSet) return;
    const c = Math.cos(rot), sn = Math.sin(rot), g = 0.25, nu = Math.max(2, Math.ceil(w / g)), nv = Math.max(2, Math.ceil(d / g));
    const sd = (this.seed + 77 + this.mounds.length) & 0xffff, field = new Float32Array((nu + 1) * (nv + 1));
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i * g, v = j * g, edge = Math.min(u, w - u, v, d - v);
      field[j * (nu + 1) + i] = fbm(u * 0.8, v * 0.8, 3, sd, 3) * 0.6 + (o.share ?? 0.25) + Math.min(0, (edge - 0.25) * 2);
    }
    const y = o.y ?? 0.015, tile = this.style.skinTile;
    const at = (u, v) => { const lx = u - w / 2, lz = v - d / 2; return [x + lx * c - lz * sn, y, z + lx * sn + lz * c]; };
    const col = (u, v) => scale3(mul(this.tint, [0.9, 0.86, 0.8]), 0.8 + 0.12 * fbm(u * 1.7, v * 1.7, 5, sd + 3, 2));
    marchSquares(field, nu, nv, g, w, (poly) => {
      for (let k = 1; k + 1 < poly.length; k++) {
        const [u0, v0] = poly[0], [u1, v1] = poly[k], [u2, v2] = poly[k + 1];
        // (the (u, v) plane maps to x, z: counter-clockwise in (u, v) is clockwise seen from above — flip)
        this.skin.tri(at(u0, v0), at(u2, v2), at(u1, v1), [u0 / tile, v0 / tile], [u2 / tile, v2 / tile], [u1 / tile, v1 / tile], col(u0, v0), col(u2, v2), col(u1, v1));
      }
    });
  }

  /**
   * Weathering streaks down a wall face under its broken head: rain / grime runs (the decal atlases), `n` of them on
   * the `side` face of a segment, darkest where the head dips (the water ran off there).
   */
  faceStreaks(seg, side, n, o = {}) {
    const R = this.R, atlas = this.theater === 'desert' ? 'decals_dz_rgba' : 'decals_rgba';
    const cells = this.theater === 'desert' ? ['grime_a', 'grime_b', 'dust_wash'] : ['streak_rain', 'streak_long', 'streak_rain'];
    for (let k = 0; k < n; k++) {
      const c = seg.cols[Math.floor(R() * seg.cols.length)], u = (c.u0 + c.u1) / 2 - seg.eA, top = side > 0 ? c.eA : c.eB;
      if (top < 1.2) continue;
      const hh = Math.min(top - 0.1, 1.2 + R() * 1.4), off = seg.t / 2 + (this.style.bulge ?? 0) + 0.016;
      const p = [seg.ax + seg.tx * u + seg.nx * side * off, top - hh / 2 - 0.05, seg.az + seg.tz * u + seg.nz * side * off];
      this.decal(atlas, cells[Math.floor(R() * cells.length)], p, [seg.nx * side, 0, seg.nz * side], 0.6 + R() * 0.9, hh, o.col ?? [0.62, 0.58, 0.54]);
    }
  }

  /**
   * Render / plaster on one face of a wall run (`side` +1 / -1): a noise mask over a grid, its outline traced by
   * marching squares (ragged, organic edges), full cells merged row by row; kept below the break (an exposed band of
   * the courses under the broken head) and off the very foot.
   */
  skinFace(seg, side, share, o, halfU) {
    const { ax, az, tx, tz, nx, nz, Lw, eA, cols } = seg;
    const g = o.skinCell ?? 0.16, tile = this.style.skinTile, off = 0.012;
    const topAt = (u) => { const c = cols.find((q) => u >= q.u0 && u <= q.u1) || cols[cols.length - 1]; return side > 0 ? c.yA : c.yB; };
    const maxTop = Math.max(...cols.map((c) => Math.max(c.yA, c.yB)));
    const nu = Math.max(2, Math.ceil(Lw / g)), nv = Math.max(2, Math.ceil(maxTop / g));
    const sd = (this.seed + (side > 0 ? 17 : 29)) & 0xffff;
    const exposed = o.skinTop ?? 0.35; // the band under the break the plaster has gone from (m)
    const field = new Float32Array((nu + 1) * (nv + 1));
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = Math.min(Lw, i * g), y = j * g, top = topAt(u);
      const n = fbm(u * 0.55 + side * 3.1, y * 0.75, 0, sd, 4) * 0.5 + fbm(u * 2.3, y * 2.6, 1, sd + 5, 2) * 0.22;
      const lim = top - exposed - 0.25 * Math.abs(fbm(u * 0.9, 4.4, 0, sd + 9, 2));
      let f = n + (share - 0.5) * 1.1 - 0.18 * smooth(0.6, 2.6, y);
      if (y > lim) f = Math.min(f, (lim - y) * 3);
      if (y < 0.08) f = Math.min(f, (y - 0.08) * 3);
      field[j * (nu + 1) + i] = f;
    }
    const at = (u, y) => {
      const hw = halfU(u, y, side) + off;
      return [ax + tx * (u - eA) + nx * side * hw, y, az + tz * (u - eA) + nz * side * hw];
    };
    const col = (u, y) => {
      let c = mul(scale3(this.tint, 1.0 / ((this.style.base || [1, 1, 1])[1])), this.style.skinK || [1.02, 1.0, 0.97]);
      c = this.skinColour(c, u + seg.s0, y, topAt(u), side === (o.inner ?? 0));
      return c;
    };
    const uvAt = (u, y) => [(seg.s0 - eA + u) / tile * side, y / tile];
    const emit = (poly) => {
      for (let k = 1; k + 1 < poly.length; k++) {
        const [u0, y0] = poly[0], [u1, y1] = poly[k], [u2, y2] = poly[k + 1];
        const A = at(u0, y0), B = at(u1, y1), C = at(u2, y2);
        if (side > 0) this.skin.tri(A, B, C, uvAt(u0, y0), uvAt(u1, y1), uvAt(u2, y2), col(u0, y0), col(u1, y1), col(u2, y2));
        else this.skin.tri(A, C, B, uvAt(u0, y0), uvAt(u2, y2), uvAt(u1, y1), col(u0, y0), col(u2, y2), col(u1, y1));
      }
    };
    marchSquares(field, nu, nv, g, Lw, emit);
  }

  /** The ragged smoke line of a burnt room (m): about half its walls' height, wandering. */
  smokeLine(s) { return (this.smokeH ?? 1.4) + 0.35 * fbm(s * 0.45, 2.7, 0, (this.seed + 3) & 0xffff, 3); }

  /** The skin's colour layer: soot (more inside a burnt room), the foot's damp, a grimy tide line. */
  skinColour(c, s, y, top, inner) {
    const T = this.T;
    c = scale3(c, 1 + 0.06 * fbm(s * 1.1, y * 1.3, 7, this.seed & 0x7ff, 2));
    const foot = 1 - smooth(0.1, 0.9, y);
    c = mix3(c, mul(c, T.foot), foot * 0.75);
    const soot = this.soot * (inner ? 1.4 : 0.8);
    if (soot > 0) {
      const streak = smooth(0.2, 0.8, fbm(s * 2.2, 0.7, 4, this.seed & 0x1ff, 3) * 0.5 + 0.5);
      const smoke = inner && this.soot > 0.6 ? smooth(-0.12, 0.2, y - this.smokeLine(s)) * (0.72 + 0.2 * streak) : 0;
      c = mix3(c, mul(c, SOOT), clamp(Math.max(smoke, soot * (smooth(top - 1.4, top - 0.2, y) * 0.55 + streak * smooth(0.6, top, y) * 0.4)), 0, 0.94));
    }
    return c;
  }

  // ------------------------------------------------------------ rubble

  /**
   * A rubble mound: an irregular heap `w` × `d` (m, along local x / z of `rot`), crest `h`, centred at (x, z); `lean`
   * (m, a wall line {ax, az, bx, bz}) piles it against a wall (highest at the wall, sloping away). Loose units half
   * sunk in it. Records its height field for `supportAt`. @returns {(x: number, z: number) => number} height there
   */
  mound(o) {
    const R = this.R, st = this.style;
    const { x, z } = o, w = Math.max(0.3, o.w), d = Math.max(0.3, o.d), h = o.h, rot = o.rot ?? 0;
    const c = Math.cos(rot), s = Math.sin(rot), sd = (this.seed + this.mounds.length * 13) & 0xffff;
    const lean = o.lean ? (() => {
      const { ax, az, bx, bz } = o.lean, L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L;
      return (px, pz) => { const tt = clamp((px - ax) * ux + (pz - az) * uz, 0, L); return Math.hypot(px - ax - ux * tt, pz - az - uz * tt); };
    })() : null;
    // polar: the toe at radius rim(θ) (an ellipse w × d, wobbled), the profile a rounded / angular cap, lumps on it
    const NT = clamp(Math.round(Math.PI * (w + d) / 2 / 0.4), 10, 22), wob = Array.from({ length: NT }, (_, k) => 1 + 0.16 * fbm(Math.cos(k / NT * 6.283) * 1.3, Math.sin(k / NT * 6.283) * 1.3, 0, sd, 2));
    const rim = (th) => {
      const f = ((th / 6.283185) % 1 + 1) % 1 * NT, k0 = Math.floor(f) % NT, k1 = (k0 + 1) % NT, tt = f - Math.floor(f);
      const e = 1 / Math.hypot(Math.cos(th) / (w / 2), Math.sin(th) / (d / 2));
      return e * lerp(wob[k0], wob[k1], tt);
    };
    // a heap's section: a concave toe running out flat onto the ground, a rounded crest (an S curve), lumpy all over
    const lump = st.crumble === 'round' ? 0.16 : 0.24;
    const heightLocal = (lx, lz) => {
      const th = Math.atan2(lz, lx), r = Math.hypot(lx, lz), rr = rim(th), k = 1 - r / rr;
      if (k <= 0) return 0;
      let y = h * smooth(0, o.flat ?? 0.85, k);
      y += h * lump * fbm(lx * 2.6, lz * 2.6, 2, sd + 3, 3) * smooth(0, 0.35, k);
      return Math.max(0, y);
    };
    const y0 = o.y0 ?? 0;
    const height = (px, pz) => {
      const dx = px - x, dz = pz - z, lx = dx * c + dz * s, lz = -dx * s + dz * c;
      let y = heightLocal(lx, lz);
      if (y > 0 && lean) y *= 0.55 + 0.45 * smooth(o.leanW ?? 1.6, 0, lean(px, pz));
      return y > 0 ? y0 + y : 0;
    };
    const RINGS = [0, 0.3, 0.55, 0.75, 0.9, 1.0];
    const G = [];
    for (let i = 0; i < RINGS.length; i++) for (let k = 0; k < NT; k++) {
      const th = (k / NT) * 6.283185, rr = rim(th) * RINGS[i], lx = Math.cos(th) * rr, lz = Math.sin(th) * rr;
      const px = x + lx * c - lz * s, pz = z + lx * s + lz * c;
      G.push([px, i === RINGS.length - 1 ? y0 - 0.04 : Math.max(y0 - 0.02, height(px, pz)), pz]);
    }
    const tile = st.tile * 0.8;
    const colAt = (p) => {
      const n = fbm(p[0] * 1.6, p[2] * 1.6, 5, sd + 11, 2);
      let cc = scale3(this.tint, 0.92 + 0.12 * n);
      cc = mix3(cc, mul(cc, st.dust), smooth(-0.2, 0.5, fbm(p[0] * 0.8, p[2] * 0.8, 9, sd + 21, 2)) * 0.8);
      // (a heap's toe runs out onto the ground: barely darker there — no dark ring round it — the lumps carry the shade)
      if (this.theater !== 'desert') cc = scale3(cc, 0.86 + 0.14 * smooth(y0 - 0.04, y0 + 0.22, p[1]));
      if (this.soot > 0.5) cc = mix3(cc, mul(cc, SOOT), 0.18 * this.soot);
      if (this.theater === 'desert') cc = mix3(mul(cc, [1.1, 1.06, 1.0]), mul(cc, this.T.foot), 0.5 + 0.5 * (1 - smooth(0, 0.3, p[1])));
      return cc;
    };
    const uv = (p) => [p[0] / tile, p[2] / tile];
    for (let i = 0; i + 1 < RINGS.length; i++) for (let k = 0; k < NT; k++) {
      const a = G[i * NT + k], b = G[i * NT + (k + 1) % NT], cc = G[(i + 1) * NT + (k + 1) % NT], dd = G[(i + 1) * NT + k];
      // (counter-clockwise seen from above: rings run outwards, angles counter-clockwise in x → z)
      if (i === 0) { this.face.tri(a, cc, dd, uv(a), uv(cc), uv(dd), colAt(a), colAt(cc), colAt(dd)); continue; }
      this.face.quad(a, b, cc, dd, uv(a), uv(b), uv(cc), uv(dd), colAt(a), colAt(b), colAt(cc), colAt(dd));
    }
    // loose units half sunk in it (denser on the crest), a few fallen down its toe
    const n = Math.round(w * d * (o.density ?? 6) * this.detail);
    for (let q = 0; q < n; q++) {
      const th = R() * 6.2832, rr = rim(th) * Math.sqrt(R()) * 1.05, lx = Math.cos(th) * rr, lz = Math.sin(th) * rr;
      const px = x + lx * c - lz * s, pz = z + lx * s + lz * c, y = height(px, pz);
      if (y <= y0 + 0.01 && R() < 0.6) continue;
      if (y <= 0) continue;
      const sz = this.unitSize(R() < 0.35 ? 0.5 : 1);
      this.unit(px, y + sz[1] * 0.15, pz, sz, R() * 6.3, (R() - 0.5) * 0.9, (R() - 0.5) * 0.9, this.unitColour(0.4));
    }
    this.mounds.push({ x, z, w, d, rot, h, height });
    return height;
  }

  /**
   * Talus along one face of a wall segment: a long low mound against it (`side` +1 / -1 of its left normal) from u0 to
   * u1 (m along the segment), `h` at the wall. `reach`: how far it runs out (m).
   */
  talus(seg, side, u0, u1, h, reach = 1.2) {
    const { ax, az, tx, tz, nx, nz, t } = seg, len = Math.max(0.4, u1 - u0), um = (u0 + u1) / 2;
    const off = t / 2 + reach * 0.32;
    const x = ax + tx * um + nx * side * off, z = az + tz * um + nz * side * off;
    const rot = Math.atan2(tz, tx);
    const wallLine = { ax: ax + tx * u0 + nx * side * t / 2, az: az + tz * u0 + nz * side * t / 2, bx: ax + tx * u1 + nx * side * t / 2, bz: az + tz * u1 + nz * side * t / 2 };
    return this.mound({ x, z, w: len, d: reach * 1.25, h, rot, lean: wallLine, leanW: reach, density: 5 });
  }

  /**
   * Loose units strewn round a ruin: `n` units on the ground in the band [r0, r1] m off a set of wall segments
   * (both sides), lying flat (a few on edge), dustier further out.
   */
  scatter(segments, n, r0 = 0.15, r1 = 1.8, side = 0) {
    const R = this.R;
    n = Math.round(n * this.detail);
    for (let q = 0; q < n && segments.length; q++) {
      const seg = segments[Math.floor(R() * segments.length)], u = R() * seg.L;
      const sd = side || (R() < 0.5 ? 1 : -1), off = seg.t / 2 + r0 + Math.pow(R(), 1.7) * (r1 - r0);
      const x = seg.ax + seg.tx * u + seg.nx * sd * off, z = seg.az + seg.tz * u + seg.nz * sd * off;
      const sz = this.unitSize(R() < 0.4 ? 0.5 : 1), edge = R() < 0.12;
      const y = this.supportAt(x, z) + (edge ? sz[2] / 2 : sz[1] / 2) * 0.8;
      this.unit(x, y, z, sz, R() * 6.3, edge ? Math.PI / 2 : (R() - 0.5) * 0.25, (R() - 0.5) * 0.25, this.unitColour(0.55));
    }
  }

  // ------------------------------------------------------------ structure remains

  /**
   * A charred beam from a to b ([x, y, z], the centre line of its BOTTOM face at each end: what it rests on), section
   * w × h (m). Recorded for the support tests.
   */
  beam(a, b, w = 0.14, h = 0.18, o = {}) {
    const R = this.R, dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
    if (L < 0.1) return;
    const ux = dx / L, uy = dy / L, uz = dz / L;
    // side vector: horizontal, across the beam; up vector: across both
    let sx = -uz, sz = ux; const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
    const vx = uy * sz, vy = uz * sx - ux * sz, vz = -uy * sx;
    const vl = Math.hypot(vx, vy, vz) || 1, up = [vx / vl, vy / vl, vz / vl];
    if (up[1] < 0) { up[0] = -up[0]; up[1] = -up[1]; up[2] = -up[2]; }
    const corner = (p, sgnS, k) => [p[0] + sx * sgnS * w / 2 + up[0] * k * h, p[1] + up[1] * k * h, p[2] + sz * sgnS * w / 2 + up[2] * k * h];
    const ends = [a, b], P = [];
    for (const e of ends) for (const k of [0, 1]) for (const sg of [-1, 1]) P.push(corner(e, sg, k));
    // P: [a lo -, a lo +, a hi -, a hi +, b lo -, b lo +, b hi -, b hi +]
    const char = o.charred === false ? scale3(this.tint, 0.55) : [0.11 + R() * 0.04, 0.095 + R() * 0.03, 0.085 + R() * 0.02];
    const ember = mix3(char, [0.32, 0.24, 0.17], o.charred === false ? 0 : 0.35);
    const faces = [[0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3], [0, 1, 3, 2], [4, 6, 7, 5]];
    // uv stretched along the beam: the face texture's courses smear into a grain
    const g = (p) => [(p[0] * ux + p[1] * uy + p[2] * uz) * 0.12, (p[0] * sx + p[2] * sz) * 1.5 + p[1] * 1.5];
    for (const [i, j, k, l] of faces) this.face.quad(P[i], P[j], P[k], P[l], g(P[i]), g(P[j]), g(P[k]), g(P[l]), char, ember, char, ember);
    this.beams.push({ a, b, w, h, kind: o.kind ?? 'beam' });
    this.pieces++;
  }

  /**
   * A chimney stack standing out of a wall segment at u (m along it), on the `side` face (+1 / -1): a breast 0.7 m wide
   * proud of the face, rising `rise` m over the broken head there, a sooty flue at its top.
   */
  chimney(seg, u, side, rise = 1.2) {
    const { ax, az, tx, tz, nx, nz, t } = seg;
    const c = seg.cols.find((q) => u >= q.u0 && u < q.u1) || seg.cols[0];
    const top = c.ym + rise, w = 0.72, dp = 0.42;
    const cx = ax + tx * (u - seg.eA) + nx * side * (t / 2 + dp / 2 - 0.05), cz = az + tz * (u - seg.eA) + nz * side * (t / 2 + dp / 2 - 0.05);
    const yaw = Math.atan2(-tz, tx);
    const col = (y) => this.wallColour(u + seg.s0, y, top, { sootK: 1.4 });
    // the stack as stacked courses: a shaft from the ground and a slightly corbelled cap
    const shaft = (y0, y1, ww, dd) => {
      const hx = ww / 2, hz = dd / 2, cs = Math.cos(yaw), sn = Math.sin(yaw);
      const p = (lx, y, lz) => [cx + lx * cs + lz * sn, y, cz - lx * sn + lz * cs];
      const q = [p(-hx, y0, -hz), p(hx, y0, -hz), p(hx, y0, hz), p(-hx, y0, hz), p(-hx, y1, -hz), p(hx, y1, -hz), p(hx, y1, hz), p(-hx, y1, hz)];
      const tile = this.style.tile, uv = (a2) => [(a2[0] + a2[2]) / tile, a2[1] / tile];
      const F = [[0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0], [4, 7, 6, 5]];
      for (const [i, j, k, l] of F) this.face.quad(q[i], q[j], q[k], q[l], uv(q[i]), uv(q[j]), uv(q[k]), uv(q[l]), col(q[i][1]), col(q[j][1]), col(q[k][1]), col(q[l][1]));
      return p;
    };
    shaft(-0.1, top - 0.32, w, dp);
    const p = shaft(top - 0.32, top, w + 0.08, dp + 0.08);
    // the flue: a black square in the cap
    const blk = scale3(SOOT, 0.6), f = 0.13;
    this.face.quad(p(-f, top + 0.003, -f), p(-f, top + 0.003, f), p(f, top + 0.003, f), p(f, top + 0.003, -f), [0, 0], [0, 0.1], [0.1, 0.1], [0.1, 0], blk, blk, blk, blk);
    this.chimneyAt = { x: cx, z: cz, top };
  }

  /**
   * A window left in a surviving wall (segment `seg`, its `side` face): the opening's dark burnt-out void flush on the
   * face (the masonry behind it stays: the wall still blocks what it blocks), a charred timber frame, a stone sill and a
   * lintel — only where the head stands a lintel's height over the opening. @returns {boolean} drawn
   */
  windowFrame(seg, u, side, sill = 0.95, w = 0.9, h = 1.15) {
    const { ax, az, tx, tz, nx, nz, t, eA } = seg;
    const ok = seg.cols.filter((c) => c.u1 > u - w / 2 - 0.3 && c.u0 < u + w / 2 + 0.3);
    if (!ok.length || Math.min(...ok.map((c) => Math.min(c.eA, c.eB))) < sill + h + 0.25) return false;
    const off = t / 2 + (this.style.bulge ?? 0) + 0.02; // (over the face's bulge and its render)
    const P = (uu, y, o2 = 0) => [ax + tx * (uu - eA) + nx * side * (off + o2), y, az + tz * (uu - eA) + nz * side * (off + o2)];
    const quad = (u0, u1, y0, y1, o2, col) => {
      const a = P(u0, y0, o2), b = P(u1, y0, o2), c = P(u1, y1, o2), d = P(u0, y1, o2);
      if (side > 0) this.face.quad(a, b, c, d, [0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02], col, col, col, col);
      else this.face.quad(b, a, d, c, [0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02], col, col, col, col);
    };
    // the void: near black, a little lighter low down (the burnt room's floor of rubble catching some light)
    const dark = scale3(SOOT, 0.7), floor = scale3(SOOT, 2.2);
    quad(u - w / 2, u + w / 2, sill + 0.25, sill + h, 0, dark);
    quad(u - w / 2, u + w / 2, sill, sill + 0.25, 0, floor);
    // frame: charred jambs, head and a broken bar across
    const fr = [0.1, 0.085, 0.075], fw = 0.07, d2 = 0.035;
    quad(u - w / 2 - fw, u - w / 2, sill, sill + h, d2, fr);
    quad(u + w / 2, u + w / 2 + fw, sill, sill + h, d2, fr);
    quad(u - w / 2 - fw, u + w / 2 + fw, sill + h - 0.01, sill + h + fw, d2, fr);
    if (this.R() < 0.6) quad(u - w / 2, u + w * (0.1 + this.R() * 0.3), sill + h * 0.55, sill + h * 0.55 + 0.045, d2, fr);
    // stone sill and lintel (the masonry kind's own units, paler)
    const stone = mul(this.tint, this.style.dust);
    const sx = (y0, y1, o2) => quad(u - w / 2 - 0.12, u + w / 2 + 0.12, y0, y1, o2, stone);
    sx(sill - 0.07, sill, 0.05); sx(sill + h + fw, sill + h + fw + 0.16, 0.02);
    this.pieces++;
    return true;
  }

  /**
   * Grass / weed tufts in the rubble and at the walls' feet (temperate only): `n` tufts round the given points, each a
   * few bent blades (drawn with the skin's pale texture where the ruin has one, so the greens read true).
   */
  weeds(points, n) {
    const R = this.R;
    if (!(this.T.weeds > 0)) return;
    const B = this.skinSet ? this.skin : this.face, k = this.skinSet ? 1.05 : 1.9;
    n = Math.round(n * this.T.weeds * this.detail);
    for (let q = 0; q < n && points.length; q++) {
      const [px, pz] = points[Math.floor(R() * points.length)];
      const x = px + (R() - 0.5) * 0.6, z = pz + (R() - 0.5) * 0.6, y0 = this.supportAt(x, z) - 0.01;
      const blades = 4 + Math.floor(R() * 4), dry = R() < 0.4;
      const base = scale3(dry ? [0.5, 0.45, 0.28] : [0.24, 0.33, 0.12], k), tip = scale3(dry ? [0.78, 0.7, 0.44] : [0.46, 0.55, 0.24], k);
      for (let b = 0; b < blades; b++) {
        const a = R() * 6.3, hh = 0.14 + R() * 0.26, lean = 0.05 + R() * 0.12, w = 0.018 + R() * 0.012;
        const cx = Math.cos(a), cz = Math.sin(a);
        const p0 = [x - cz * w, y0, z + cx * w], p1 = [x + cz * w, y0, z - cx * w], p2 = [x + cx * lean, y0 + hh, z + cz * lean];
        // (both sides of the blade: two triangles back to back)
        B.tri(p0, p1, p2, [0, 0], [0.01, 0], [0.005, 0.04], base, base, tip);
        B.tri(p1, p0, p2, [0, 0], [0.01, 0], [0.005, 0.04], scale3(base, 0.8), scale3(base, 0.8), scale3(tip, 0.8));
      }
      this.pieces++;
    }
  }

  /**
   * Sand drifted against a wall face (desert): a long, soft, low drift in the sand set (`sand` mesh, no shadow).
   */
  drift(seg, side, u0, u1, h = 0.35, reach = 1.1) {
    if (!(this.T.drift > 0)) return;
    const { ax, az, tx, tz, nx, nz, t } = seg, R = this.R;
    const nu = Math.max(3, Math.ceil((u1 - u0) / 0.3)), nv = 4;
    const G = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = lerp(u0, u1, i / nu), f = j / nv, e = Math.sin(Math.PI * i / nu);
      const off = t / 2 - 0.02 + f * reach * (0.8 + 0.4 * (fbm(u * 0.7, 3, 0, this.seed & 0xff, 2) * 0.5 + 0.5));
      const y = (h * e * Math.pow(1 - f, 1.6) * (0.8 + 0.4 * fbm(u * 1.1, 1, 0, 13, 2))) - (j === nv ? 0.05 : 0);
      G.push([ax + tx * u + nx * side * off, y, az + tz * u + nz * side * off]);
    }
    // (in the skin's mesh where the ruin has one — the render's smooth ochre tinted to the sand: one draw less)
    const B = this.skinSet ? this.skin : this.sand, sandK = this.skinSet ? [1.02, 0.94, 0.8] : [1, 0.98, 0.95];
    const tile = 3, uv = (p) => [p[0] / tile, p[2] / tile];
    const col = (p) => scale3(sandK, 0.9 + 0.1 * smooth(0, h, p[1]) + (R() - 0.5) * 0.02);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = G[j * (nu + 1) + i], b = G[j * (nu + 1) + i + 1], c = G[(j + 1) * (nu + 1) + i + 1], d = G[(j + 1) * (nu + 1) + i];
      if (side > 0) B.quad(a, b, c, d, uv(a), uv(b), uv(c), uv(d), col(a), col(b), col(c), col(d));
      else B.quad(b, a, d, c, uv(b), uv(a), uv(d), uv(c), col(b), col(a), col(d), col(c));
    }
  }

  /**
   * A weathering decal: atlas cell `cell` on a quad centred at c ([x, y, z]) facing `n` (unit), `w` × `h` m (h along the
   * up direction projected on the quad; a floor decal's 'up' is `up`), tinted / faded by `col` [r, g, b] and `alpha`
   * (vertex alpha via the colour: the atlas carries the shape).
   */
  decal(atlas, cell, c, n, w, h, col = [1, 1, 1], up = [0, 1, 0]) {
    const rect = DECALS[atlas]?.[cell];
    if (!rect) return;
    let B = this.decals.get(atlas);
    if (!B) { B = new Bucket(); this.decals.set(atlas, B); }
    // tangent frame: right = up × n, top = n × right
    let rx = up[1] * n[2] - up[2] * n[1], ry = up[2] * n[0] - up[0] * n[2], rz = up[0] * n[1] - up[1] * n[0];
    let rl = Math.hypot(rx, ry, rz);
    if (rl < 1e-4) { rx = 1; ry = 0; rz = 0; rl = 1; }
    rx /= rl; ry /= rl; rz /= rl;
    const tx = n[1] * rz - n[2] * ry, ty = n[2] * rx - n[0] * rz, tz = n[0] * ry - n[1] * rx;
    const P = (a, b) => [c[0] + rx * a * w / 2 + tx * b * h / 2, c[1] + ry * a * w / 2 + ty * b * h / 2, c[2] + rz * a * w / 2 + tz * b * h / 2];
    const [u0, v0, u1, v1] = rect;
    B.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), [u0, v0], [u1, v0], [u1, v1], [u0, v1], col, col, col, col);
  }

  // ------------------------------------------------------------ queries

  /**
   * What stands at (x, z): the highest of the ground (0), the mounds and the wall heads over that point (m). The
   * kit's own support model — every beam end and slab edge must rest on it.
   */
  supportAt(x, z) {
    let y = 0;
    for (const f of this.supports) y = Math.max(y, f(x, z));
    for (const m of this.mounds) y = Math.max(y, m.height(x, z));
    for (const s of this.walls) {
      const px = x - s.ax, pz = z - s.az, u = px * s.tx + pz * s.tz + s.eA, v = px * s.nx + pz * s.nz;
      if (u < 0 || u > s.Lw || Math.abs(v) > s.t / 2 + 1e-3) continue;
      const c = s.cols.find((q) => u >= q.u0 && u <= q.u1);
      // (the head across the thickness: the outer edge, the core's ridge in the middle, the inner edge)
      if (c) y = Math.max(y, v >= 0 ? lerp(c.ym, c.eA, Math.min(1, v / (s.t / 2))) : lerp(c.ym, c.eB, Math.min(1, -v / (s.t / 2))));
    }
    return y;
  }

  /** Is (x, y, z) inside a wall's masonry (a joist end in its pocket)? */
  inWall(x, y, z) {
    for (const s of this.walls) {
      const px = x - s.ax, pz = z - s.az, u = px * s.tx + pz * s.tz + s.eA, v = px * s.nx + pz * s.nz;
      if (u < 0 || u > s.Lw || Math.abs(v) > s.t / 2 + 0.02) continue;
      const c = s.cols.find((q) => u >= q.u0 && u <= q.u1);
      if (c && y <= Math.min(c.yA, c.yB) + 1e-3 && y >= -0.2) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ build

  /**
   * The ruin's visual: one group (`userData.clip = false`: no gameplay measure sees it), one masonry mesh, a skin mesh
   * and a sand mesh where used. @returns {THREE.Group}
   */
  build(name = `ruin-kit:${this.id}`) {
    const g = new THREE.Group();
    g.name = name;
    g.userData.clip = false;
    g.userData.ruinKit = { pieces: this.pieces, beams: this.beams.length, mounds: this.mounds.length };
    const add = (bucket, set, cast, nm) => {
      if (!bucket.count) return null;
      const m = new THREE.Mesh(bucket.geometry(), ruinMaterial(set));
      m.name = nm; m.castShadow = cast; m.receiveShadow = true;
      m.userData.clip = false;
      g.add(m);
      return m;
    };
    add(this.face, this.faceSet, true, `${name}:masonry`);
    if (this.skinSet) add(this.skin, this.skinSet, false, `${name}:skin`);
    add(this.sand, 'sand', false, `${name}:sand`);
    for (const [atlas, B] of this.decals) {
      if (!B.count) continue;
      const m = new THREE.Mesh(B.geometry(), decalMaterial(atlas));
      m.name = `${name}:decals`; m.castShadow = false; m.receiveShadow = true; m.renderOrder = 1;
      m.userData.clip = false; m.userData.aoExclude = true;
      g.add(m);
    }
    return g;
  }
}

// ---------------------------------------------------------------- marching squares

/**
 * Trace the region field > 0 over a grid (nu × nv cells of g m; x clamped to `maxU`) as polygons in (u, y): full cells
 * merged into row runs, edge cells cut by linear interpolation (the 16 cases; saddles split). `emit(poly)` gets each
 * convex polygon [[u, y], …] counter-clockwise.
 */
export function marchSquares(field, nu, nv, g, maxU, emit) {
  const W = nu + 1, F = (i, j) => field[j * W + i];
  const X = (i) => Math.min(maxU, i * g);
  for (let j = 0; j < nv; j++) {
    let run = -1;
    const flush = (i) => { if (run >= 0) { emit([[X(run), j * g], [X(i), j * g], [X(i), (j + 1) * g], [X(run), (j + 1) * g]]); run = -1; } };
    for (let i = 0; i < nu; i++) {
      const a = F(i, j), b = F(i + 1, j), c = F(i + 1, j + 1), d = F(i, j + 1);
      const full = a > 0 && b > 0 && c > 0 && d > 0;
      if (full) { if (run < 0) run = i; continue; }
      flush(i);
      if (a <= 0 && b <= 0 && c <= 0 && d <= 0) continue;
      // corners counter-clockwise: (i,j) a, (i+1,j) b, (i+1,j+1) c, (i,j+1) d; walk the edges, keeping inside parts
      const P = [[X(i), j * g, a], [X(i + 1), j * g, b], [X(i + 1), (j + 1) * g, c], [X(i), (j + 1) * g, d]];
      const saddle = (a > 0) === (c > 0) && (b > 0) === (d > 0) && (a > 0) !== (b > 0);
      const cut = (p, q) => { const t = p[2] / (p[2] - q[2]); return [lerp(p[0], q[0], t), lerp(p[1], q[1], t)]; };
      if (saddle) {
        // two separate corners (the centre taken as outside): each inside corner with its two edge cuts
        for (let k = 0; k < 4; k++) {
          const p = P[k];
          if (p[2] <= 0) continue;
          const prev = P[(k + 3) % 4], next = P[(k + 1) % 4];
          emit([cut(p, prev), [p[0], p[1]], cut(p, next)]);
        }
        continue;
      }
      const poly = [];
      for (let k = 0; k < 4; k++) {
        const p = P[k], q = P[(k + 1) % 4];
        if (p[2] > 0) poly.push([p[0], p[1]]);
        if ((p[2] > 0) !== (q[2] > 0)) poly.push(cut(p, q));
      }
      if (poly.length >= 3) emit(poly);
    }
    flush(nu);
  }
}
