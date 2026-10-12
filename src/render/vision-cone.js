/**
 * Vision cones — owned by AI (design-spec §4.2 Display, §10.2). The drawn cone IS the detection geometry:
 * the fan is perception.coneAt(enemy) (apex, head heading, ±halfFov, near(θ) = far(θ)/2, far(θ)) cut ray by ray by
 * grid.sightRay — the same height sight line (eye → a target's top, every crossed cell's sightTop: surfaces, low cover,
 * structures by their height, vehicles), roof and deck-edge rules (perception.levelHides) that perception.canSee
 * applies with grid.sightLine. A ray is no longer one length: it is a list of spans — the stretches where a STANDING
 * man is seen (a bump, a drift or a low wall below the eye no longer cuts the cone; a pocket of dead ground behind a
 * rise or under a wall walk is left out), each tagged `near` (dark band: a crawler is seen there too) or `far` (the
 * light shade: the far band, and the hint inside the near band where only a crawler is hidden — behind low cover).
 * Rays: ≥ 96 across the aperture (≤ 0.75° apart), then adaptive refinement: an interval is split while its two rays
 * disagree (span count or kind, an end jumping > 0.5 m) or its mid ray's span ends lie more than
 * CONFIG.stealth.coneRayTol from the chords of its neighbours (tests/unit/cone-fidelity.test.mjs, cone-height.test.mjs
 * sample thousands of points against coneRegions and against VisionCone.drawnAt).
 * Cost: VisionCone builds the SECTOR the head sweeps through once per post (a walker's every MOVE_EPS walked; the
 * dynamic occluders are versioned by content) and each frame only moves the cone shader's uniforms (window, near, far).
 * Under VisionCones a rebuild is spread over frames (CONFIG.stealth.coneBudgetMs a frame, round robin over the shown
 * cones, the old sector riding along meanwhile) and a walking walker's sector is built coarse; the settled cone (he
 * stands still) is the exact one.
 *
 * Look [EXE]: flat 50% alpha, hard edges, BEL palette green (#02BC6F near / #07675A far) or desert orange
 * (#D26E02 / #6B4C01) from mission.coneColors; ground layer (Renderer.decalScene: depth-tested, so trees,
 * roofs and tall props draw over it), DRAPED over the drawn ground (grid elev + world.groundY relief, sliced every
 * 1 m) so the terrain's undulation never hides it (user 2026-10-11). No colour change by alert level unless
 * CONFIG.stealth.alertTint. VisionCones shows ONE cone at a time (CONFIG.stealth.multiCone), brightens the spotter's
 * cone to 75% for 1 s (§4.2 "automatically illuminated") and draws the red 0.6 m probe ring (setProbe(x, z)).
 * @module render/vision-cone
 */

import * as THREE from 'three';
import { ownerHeight } from '../world/placement.js';
import { CONFIG } from '../config.js';
import { coneAt, probe as probeCone, postOwner, levelHides, targetHeight, lowCoverMode } from '../ai/perception.js';

const Y = 0.07;
/** Rebuild thresholds: 2 cm / ~0.06°. */
const EPS_POS = 0.02, EPS_ANG = 0.001;
const DEG = Math.PI / 180, TAU = Math.PI * 2;
/** Span kinds: NEAR = a crawler is seen too (dark band); FAR = only a standing man (light shade). */
const NEAR = 0, FAR = 1;

/** Legacy export (alertTint colours by alertLevel 0/1/2). */
export const CONE_COLORS = [0x02bc6f, 0xe0c030, 0xe04030];

/** Near/far colours (hex numbers) of a palette name ('green' | 'desert'). */
export function paletteColors(name = 'green') {
  const p = CONFIG.stealth.coneColors[name] || CONFIG.stealth.coneColors.green;
  return { near: new THREE.Color(p.near).getHex(), far: new THREE.Color(p.far).getHex() };
}

/** Intersect sorted disjoint interval lists. */
function intersect(a, b) {
  const out = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    const lo = Math.max(a[i][0], b[j][0]), hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return out;
}

/** Sorted disjoint intervals `a` minus `b`. */
function subtract(a, b) {
  const out = [];
  for (const [lo0, hi] of a) {
    let lo = lo0;
    for (const [b0, b1] of b) {
      if (b1 <= lo || b0 >= hi) continue;
      if (b0 > lo) out.push([lo, b0]);
      lo = Math.max(lo, b1);
      if (lo >= hi) break;
    }
    if (hi > lo) out.push([lo, hi]);
  }
  return out;
}

/**
 * Classified spans of one ray from the standing / low visibility intervals: NEAR where both a standing and a low man
 * are seen inside the near band, FAR where only a standing man is (near band behind low cover, or the far band).
 * @returns {{r0: number, r1: number, k: number}[]} sorted by r0
 */
export function raySpans(stand, low, near, far) {
  const S = intersect(stand, [[0, far]]);
  const nearIv = intersect(intersect(S, low), [[0, near]]);
  const out = [];
  for (const [r0, r1] of nearIv) out.push({ r0, r1, k: NEAR });
  for (const [r0, r1] of subtract(S, nearIv)) out.push({ r0, r1, k: FAR });
  return out.sort((p, q) => p.r0 - q.r0);
}

/**
 * The cone fan of a viewer: angles (rad, ascending), per-ray spans ({r0, r1, k}: k 0 near / 1 far) and `dists` (where
 * a standing man is first hidden along each ray — the reach of the first span from the apex; legacy / chord tests).
 * @param {object} enemy viewer (coneAt input; its `world` gives the structure heights and the mission's rules)
 * @param {object|null} grid NavGrid (sightRay; a grid with only castRay: one span cut there) or null (no occlusion)
 * @param {{t?: number, rays?: number, tol?: number, maxRays?: number, world?: object}} [o]
 * @returns {{cone: object, angles: number[], dists: number[], spans: {r0: number, r1: number, k: number}[][]}|null}
 */
export function coneFan(enemy, grid, o = {}) {
  const it = coneFanSteps(enemy, grid, o);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/**
 * coneFan in steps (a generator: yields after each base ray's interval, returns the fan) so VisionCones can spread a
 * rebuild over frames. `o.step` (rad): the base ray spacing of a sector (default 0.75°); `o.cornerTol` (m): how fine
 * an occluder corner is split at the far edge (default 0.02) — coarser for a walker's cone while he walks.
 */
export function* coneFanSteps(enemy, grid, o = {}) {
  const cone = coneAt(enemy, o.t);
  if (!cone) return null;
  const S = CONFIG.stealth;
  const world = o.world || enemy.world || null;
  // `o.sector` {a0, a1}: the fan over that absolute angle range instead of the head's window, out to the profile's
  // longest reach with the near/far split left to the cone shader (VisionCone: kind NEAR = a crawler is seen there)
  const sec = o.sector || null;
  const fov = sec ? sec.a1 - sec.a0 : cone.halfFov * 2;
  const base = Math.max(o.rays ?? S.coneRays, Math.ceil(fov / (0.75 * DEG)));
  const tol = o.tol ?? S.coneRayTol;
  const cornerTol = o.cornerTol ?? 0.02;
  const maxRays = o.maxRays ?? S.coneMaxRays;
  const heights = [targetHeight(false), targetHeight(true)];
  const sightOpts = {
    eyeY: cone.y, viewerY: cone.vy, lowOf: [false, true], lowCover: lowCoverMode(cone), heightOf: world?.structures ? ownerHeight(world) : null, ownHull: enemy.ownHull, ownOwner: world ? postOwner(enemy, world) : 0,
    hide: (k, ty, n) => levelHides(cone, ty, n === 1, world),
  };
  const reachMax0 = Math.max(cone.far, enemy.vision?.far ?? enemy.vision?.range ?? cone.far);
  const nearCut = sec ? reachMax0 : cone.near, farCut = sec ? reachMax0 : cone.far;
  const one = (d) => raySpans([[0, d]], [[0, d]], nearCut, farCut);
  // `o.cache` (VisionCone): a ray's raw sight intervals depend on its absolute angle, the apex and the eye, not on the
  // head — a sentry sweeping on his post re-reads them frame after frame (cast out to the profile's longest reach, cut
  // to this frame's elliptical far / near by raySpans)
  const reachMax = reachMax0;
  let memo = null;
  if (o.cache && grid?.sightRay) {
    const key = `${grid.version}|${grid.dynamicVersion || 0}|${cone.x}|${cone.z}|${cone.vy}|${cone.y}|${reachMax}|${cone.overlooks}|${cone.elevated}|${world?.mission?.rules?.roofRule}|${enemy.ownHull ? JSON.stringify(enemy.ownHull) : ''}`;
    if (o.cache.key !== key || !o.cache.map || o.cache.map.size > 20000) { o.cache.key = key; o.cache.map = new Map(); }
    memo = o.cache.map;
  }
  const raw = (a) => {
    let r = memo?.get(a);
    if (!r) { r = grid.sightRay(cone.x, cone.z, a, reachMax, heights, sightOpts); memo?.set(a, r); }
    return r;
  };
  const cast = grid?.sightRay
    ? (a) => { const [st, lo] = raw(a); return raySpans(st, lo, nearCut, farCut); }
    : grid?.castRay ? (a) => one(grid.castRay(cone.x, cone.z, a, farCut, { viewerElevated: cone.elevated, viewerY: cone.vy, ownHull: enemy.ownHull }))
      : () => one(farCut);
  const reach = (sp) => { let d = 0; for (const s of sp) { if (s.r0 > d + 1e-9) break; d = Math.max(d, s.r1); } return d; };
  const a0 = sec ? sec.a0 : cone.heading - cone.halfFov;
  const angles = [], spans = [];
  let count = base + 1;
  const MIN_DA = 2e-5;
  // chord error of the mid ray's end `m` against the segment from end `a` (ray aa) to end `b` (ray ab), XZ from the apex
  const err = (aa, da, ab, db, am, dm) => {
    const x0 = Math.cos(aa) * da, z0 = Math.sin(aa) * da, x1 = Math.cos(ab) * db, z1 = Math.sin(ab) * db;
    const xm = Math.cos(am) * dm, zm = Math.sin(am) * dm;
    const ex = x1 - x0, ez = z1 - z0, L2 = ex * ex + ez * ez;
    let u = L2 > 0 ? ((xm - x0) * ex + (zm - z0) * ez) / L2 : 0;
    u = Math.max(0, Math.min(1, u));
    return Math.hypot(xm - (x0 + ex * u), zm - (z0 + ez * u));
  };
  const same = (A, B) => A.length === B.length && A.every((s, i) => s.k === B[i].k);
  const refine = (aa, A, ab, B, depth) => {
    if (ab - aa < MIN_DA || count >= maxRays || depth > 24) return;
    const am = (aa + ab) / 2, M = cast(am);
    let split = !same(A, B) || !same(A, M);
    if (!split) {
      // a span end jumping across the interval (an occluder corner / shadow edge): split until the two rays are within
      // 2 cm of each other at their far end (angle ± ε); a curved / slanted end: split while off the chord
      for (let i = 0; i < A.length && !split; i++) {
        for (const f of ['r0', 'r1']) {
          const ea = A[i][f], eb = B[i][f], em = M[i][f];
          if ((Math.abs(ea - eb) > 0.5 && (ab - aa) * Math.max(ea, eb) > cornerTol) || err(aa, ea, ab, eb, am, em) > tol) { split = true; break; }
        }
      }
    }
    // an occluder corner (the reach from the apex jumps) is split down to 2 cm at the far edge, as it always was; any other
    // disagreement (a pocket, the light hint behind low cover) to coneRayTol
    if (!split || (ab - aa) * farCut <= (Math.abs(reach(A) - reach(B)) > 0.5 ? cornerTol : tol)) return;
    count++;
    refine(aa, A, am, M, depth + 1);
    angles.push(am); spans.push(M);
    refine(am, M, ab, B, depth + 1);
  };
  // base rays on a fixed angular grid (fov / base apart, multiples of it) between the two edge rays: the same absolute
  // angles frame after frame (the cache above), whatever the head's sweep
  const step = sec ? (o.step ?? 0.75 * DEG) : fov / base, a1 = a0 + fov; // (a sector: one fixed global grid, so rebuilt sectors share rays)
  const grid0 = [];
  for (let q = Math.floor(a0 / step) + 1; q * step < a1 - 1e-9; q++) if (q * step > a0 + 1e-9) grid0.push(q * step);
  grid0.push(a1);
  let pa = a0, ps = cast(a0);
  angles.push(pa); spans.push(ps);
  for (const a of grid0) {
    const sp = cast(a);
    refine(pa, ps, a, sp, 0);
    angles.push(a); spans.push(sp);
    pa = a; ps = sp;
    yield;
  }
  return { cone, angles, spans, dists: spans.map(reach) };
}

/**
 * Pair the spans of two neighbouring rays into quads: spans of the same kind that overlap. A one-to-one pair keeps
 * each ray's own ends (a slanted wall face stays slanted); a span overlapping several on the other ray is cut to each
 * overlap. Calls quad(r0a, r1a, r0b, r1b, kind).
 */
function pairSpans(A, B, quad) {
  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    const hits = [];
    for (let j = 0; j < B.length; j++) { const b = B[j]; if (b.k === a.k && b.r1 > a.r0 && b.r0 < a.r1) hits.push(j); }
    for (const j of hits) {
      const b = B[j];
      let back = 0;
      for (const c of A) if (c.k === b.k && c.r1 > b.r0 && c.r0 < b.r1) back++;
      if (hits.length === 1 && back === 1) quad(a.r0, a.r1, b.r0, b.r1, a.k);
      else { const lo = Math.max(a.r0, b.r0), hi = Math.min(a.r1, b.r1); quad(lo, hi, lo, hi, a.k); }
    }
  }
}

/**
 * The drawn regions of a fan in world XZ as quads ([[x, z] × 4], unsliced): `stand` = everywhere a standing man is
 * seen (both kinds), `low` = where a crawler is seen too (the dark near kind). Used by tests (point-in-region).
 * @returns {{stand: number[][][], low: number[][][]}}
 */
export function coneRegions(fan) {
  const { cone, angles, spans } = fan;
  const stand = [], low = [];
  const P = (a, r) => [cone.x + Math.cos(a) * r, cone.z + Math.sin(a) * r];
  for (let k = 0; k + 1 < angles.length; k++) {
    const aa = angles[k], ab = angles[k + 1];
    pairSpans(spans[k], spans[k + 1], (r0a, r1a, r0b, r1b, kind) => {
      const q = [P(aa, r0a), P(aa, r1a), P(ab, r1b), P(ab, r0b)];
      stand.push(q);
      if (kind === NEAR) low.push(q);
    });
  }
  return { stand, low };
}

/** Is (x, z) inside any of the quads? */
export function inRegion(quads, x, z) {
  for (const q of quads) {
    let c = false;
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      const [xi, zi] = q[i], [xj, zj] = q[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    if (c) return true;
  }
  return false;
}

/** Radial slice length (m) of the draped mesh: short enough for the ground relief (drift ridges, dune ripples). */
const SLICE = 1.0;

/** Ground-height lattice spacing (m) and tile size (lattice steps) of groundSampler. */
const GH_STEP = 1.0, GH_TILE = 32;
const groundCache = new WeakMap();

/**
 * The drawn ground height under a cone vertex: world.groundY (terrain relief + paved raises: roads.raiseAt is a
 * lookup per call, far too slow for tens of thousands of cone vertices a frame) sampled on a 1 m lattice, each lattice
 * point once, the first time a cone reaches it (a whole tile at once was 1000 groundY calls, a 10-30 ms hitch), then
 * read back bilinearly. The terrain is static for a mission (cached per world and groundY function).
 * @returns {((x: number, z: number) => number)|null}
 */
export function groundSampler(world) {
  const gy = typeof world?.groundY === 'function' ? world.groundY : null;
  if (!gy) return null;
  let c = groundCache.get(world);
  if (!c || c.gy !== gy) { c = { gy, tiles: new Map() }; groundCache.set(world, c); }
  if (c.fn) return c.fn;
  const n = GH_TILE + 1, span = GH_TILE * GH_STEP, tiles = c.tiles;
  const tile = (ti, tj) => {
    const key = ti * 65536 + tj;
    let t = tiles.get(key);
    if (!t) { t = new Float32Array(n * n).fill(NaN); tiles.set(key, t); }
    return t;
  };
  const at = (t, ti, tj, i, j) => {
    const q = j * n + i;
    let v = t[q];
    if (v !== v) v = t[q] = gy.call(world, ti * span + i * GH_STEP, tj * span + j * GH_STEP) || 0; // (NaN: not sampled yet)
    return v;
  };
  return (c.fn = (x, z) => {
    const ti = Math.floor(x / span), tj = Math.floor(z / span);
    const t = tile(ti, tj);
    const fx = (x - ti * span) / GH_STEP, fz = (z - tj * span) / GH_STEP;
    const i = Math.min(GH_TILE - 1, Math.floor(fx)), j = Math.min(GH_TILE - 1, Math.floor(fz)), u = fx - i, v = fz - j;
    const a = at(t, ti, tj, i, j), b = at(t, ti, tj, i + 1, j), cc = at(t, ti, tj, i, j + 1), d = at(t, ti, tj, i + 1, j + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (cc * (1 - u) + d * u) * v;
  });
}

/** Room for `more` position floats in a vertex buffer {a: positions, l: lowVis, n: floats used}. */
function grow(o, more) {
  if (o.n + more <= o.a.length) return;
  const na = new Float32Array(Math.max(o.a.length * 2, o.n + more)), nl = new Float32Array(na.length / 3);
  na.set(o.a.subarray(0, o.n)); nl.set(o.l.subarray(0, o.n / 3));
  o.a = na; o.l = nl;
}

/** ms clock for the cones' frame budget. */
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A growable non-indexed triangle geometry: positions + `lowVis` (1 where a crawler is seen too). */
function triGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 1024), 3));
  g.setAttribute('lowVis', new THREE.BufferAttribute(new Float32Array(1024), 1));
  g.setDrawRange(0, 0);
  return g;
}

/** A walker's cone is rebuilt once he has walked this far (m); in between it rides along with him (render only). */
const MOVE_EPS = 0.3;
/**
 * A walker's cone while he walks (render only; VisionCones' budgeted rebuilds): base rays 1.5° apart, edges to 0.25 m,
 * occluder corners to 0.15 m, the drape sliced every 2 m. Once he stands still the exact sector is built (the settled
 * cone is perception's, tests/unit/cone-height). */
const COARSE = { step: 1.5 * DEG, tol: 0.25, cornerTol: 0.15 };
const SLICE_COARSE = 2.0;
/** Extra angle (rad) a sector keeps either side of the head's whole sweep. */
const SECTOR_MARGIN = 10 * DEG;

/**
 * The cone shader (MeshBasicMaterial + onBeforeCompile): the mesh holds the SECTOR the head sweeps through, out to the
 * profile's longest reach, already cut by occlusion (grid.sightRay spans); each frame only the uniforms move — the
 * head's window (apex, heading ± halfFov), this frame's near / far (elliptical) — and the fragment keeps exactly
 * perception's pointInCone: the near (dark) mesh where a crawler is seen too (lowVis) inside the near band, the far
 * (light) mesh everywhere else a standing man is seen. `kind` 0 near, 1 far.
 */
function coneMaterial(u, kind) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: CONFIG.stealth.coneAlpha, depthWrite: false, depthTest: true, fog: false,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uApex = u.apex; sh.uniforms.uHead = u.head; sh.uniforms.uHalf = u.half;
    sh.uniforms.uNear = u.near; sh.uniforms.uFar = u.far; sh.uniforms.uKind = { value: kind };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float lowVis;\nvarying float vLowVis;\nvarying vec2 vConeXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLowVis = lowVis;\nvConeXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uApex;\nuniform float uHead, uHalf, uNear, uFar, uKind;\nvarying float vLowVis;\nvarying vec2 vConeXZ;')
      .replace('void main() {', `void main() {
  vec2 cdv = vConeXZ - uApex; float cdd = length(cdv);
  float cda = atan(cdv.y, cdv.x) - uHead; cda -= 6.283185307179586 * floor((cda + 3.141592653589793) / 6.283185307179586);
  if (cdd > uFar || (cdd > 1e-4 && abs(cda) > uHalf)) discard;
  bool cNear = vLowVis > 0.5 && cdd <= uNear;
  if ((uKind < 0.5) != cNear) discard;`);
  };
  mat.customProgramCacheKey = () => 'vision-cone-sector';
  return mat;
}

/**
 * One enemy's cone: the near (dark) and far (light) kinds of its sector's spans, draped over the drawn ground. The
 * sector (the head's whole sweep at his post, or the window of a walker) is built once per post / every MOVE_EPS
 * walked / when the head leaves it / when the grid changes; in between a frame costs a few uniforms (render cost of
 * a shown cone back near the flat fan's). drawnAt(x, z) answers what the shader draws there (tests).
 */
export class VisionCone {
  /**
   * Accepts `new VisionCone(enemy, world, opts)` or `new VisionCone(opts)`.
   * @param {object} [enemy] @param {object} [world]
   * @param {{palette?: 'green'|'desert', alertTint?: boolean, maxRays?: number}} [opts]
   */
  constructor(enemy = null, world = null, opts = {}) {
    if (enemy && !enemy.vision && !enemy.kind && world == null) { opts = enemy; enemy = null; }
    this.enemy = enemy;
    this.world = world;
    this.opts = opts;
    this.cap = (opts.maxRays ?? CONFIG.stealth.coneMaxRays) + 2;
    this.group = new THREE.Group();
    this.group.name = 'vision-cone';
    this.group.renderOrder = 5;
    this.geo = triGeometry();
    this.nearGeo = this.farGeo = this.geo; // (one geometry, two shaders)
    this._u = { apex: { value: new THREE.Vector2() }, head: { value: 0 }, half: { value: 0 }, near: { value: 0 }, far: { value: 0 } };
    this.nearMesh = new THREE.Mesh(this.geo, coneMaterial(this._u, NEAR));
    this.farMesh = new THREE.Mesh(this.geo, coneMaterial(this._u, FAR));
    this.nearMesh.frustumCulled = this.farMesh.frustumCulled = false;
    this.group.add(this.farMesh, this.nearMesh);
    this.object3d = this.group;
    this.highlight = false;
    this._colorKey = null;
    /** The built sector {x, z, vy, el, gv, a0, a1, reach}, or null. */
    this._sector = null;
    this._cone = null;
    /** Number of sector rebuilds and rays of the last one (tests/perf). */
    this.rebuilds = 0;
    this.rayCount = 0;
    /** Last sector fan {cone, angles, spans, dists} (the drawn geometry before the shader's window). */
    this.fan = null;
  }

  /**
   * Refresh for `enemy` (call each frame while shown): this frame's window into the uniforms; the sector rebuilt only
   * when stale. @returns {boolean} rebuilt
   */
  update(enemy = this.enemy, budget = null) {
    if (!enemy) return false;
    const world = enemy.world || this.world || null;
    const grid = world?.grid || null;
    const cone = coneAt(enemy);
    this.group.visible = !!cone;
    if (!cone) return false;
    this._setColor(enemy);
    this._cone = cone;
    const u = this._u;
    u.apex.value.set(cone.x, cone.z); u.head.value = cone.heading; u.half.value = cone.halfFov; u.near.value = cone.near; u.far.value = cone.far;
    const gv = grid ? grid.version * 1e6 + (grid.dynamicVersion || 0) : -1;
    const reach = Math.max(cone.far, enemy.vision?.far ?? enemy.vision?.range ?? cone.far);
    const S = this._sector;
    // walking: the apex moved since the last frame (a budgeted walker's cone is built coarse until he stands still)
    const moving = this._lastX != null && Math.hypot(cone.x - this._lastX, cone.z - this._lastZ) > 1e-4;
    this._lastX = cone.x; this._lastZ = cone.z;
    const inside = (a) => { const d = a - (S.a0 + S.a1) / 2; return Math.abs(d - TAU * Math.round(d / TAU)) <= (S.a1 - S.a0) / 2 + 1e-9; };
    const stale = !S || S.gv !== gv || S.vy !== cone.vy || S.el !== cone.elevated || S.reach < reach - 1e-9
      || Math.hypot(cone.x - S.x, cone.z - S.z) > MOVE_EPS || !inside(cone.heading - cone.halfFov) || !inside(cone.heading + cone.halfFov)
      || (S.coarse && !moving); // settled: the exact sector
    if (!stale) { this._job = null; this.group.position.set(cone.x - S.x, 0, cone.z - S.z); return false; }
    const coarse = !!budget && moving;
    if (!budget || !S) { // unbudgeted (tests, tools) or a cone's first build: at once
      this._job = null;
      const it = this._buildSteps(enemy, cone, world, grid, gv, reach, coarse);
      let r = it.next();
      while (!r.done) r = it.next();
      this._finish(r.value, cone);
      return true;
    }
    // VisionCones' frame budget: the rebuild runs a slice at a time (round robin over the shown cones) while the
    // shown sector rides along with him; it lands a few frames later (perception itself is exact all along)
    this.group.position.set(cone.x - S.x, 0, cone.z - S.z);
    if (!this._job) this._job = this._buildSteps(enemy, cone, world, grid, gv, reach, coarse);
    while (!budget.steps || now() < budget.until) { // (at least one step a frame overall: a rebuild always gets on)
      budget.steps = (budget.steps || 0) + 1;
      const r = this._job.next();
      if (r.done) { this._job = null; this._finish(r.value, cone); return true; }
    }
    return false;
  }

  /**
   * A sector rebuild in steps (generator): the fan over the head's whole sweep (+ margin), then its draped mesh into
   * the staging buffer; returns what _finish needs.
   */
  *_buildSteps(enemy, cone, world, grid, gv, reach, coarse) {
    // the sector: the head's whole sweep round its centre (body heading + head offset), plus a margin
    const amp = enemy.sweepActive ? Math.abs((enemy.sweepAmp ?? enemy.vision?.sweep ?? 0) * (enemy.sweepW ?? 1)) : 0;
    let c = (enemy.heading || 0) + (enemy.headOffset || 0) + (enemy.headCarry || 0);
    c += TAU * Math.round((cone.heading - c) / TAU);
    let a0 = c - cone.halfFov - amp - SECTOR_MARGIN, a1 = c + cone.halfFov + amp + SECTOR_MARGIN;
    a0 = Math.min(a0, cone.heading - cone.halfFov - DEG); a1 = Math.max(a1, cone.heading + cone.halfFov + DEG);
    if (a1 - a0 > TAU) { a0 = cone.heading - Math.PI; a1 = a0 + TAU; }
    const fan = yield* coneFanSteps(enemy, grid && (grid.sightRay || grid.castRay) ? grid : null,
      { maxRays: this.cap - 2, world, cache: this._rays || (this._rays = {}), sector: { a0, a1 }, ...(coarse ? COARSE : null) });
    const buf = this._stage || (this._stage = { a: new Float32Array(3 * 1024), l: new Float32Array(1024), n: 0 });
    buf.n = 0;
    yield* this._meshSteps(fan, world, grid, buf, coarse ? SLICE_COARSE : SLICE);
    return { fan, sector: { x: fan.cone.x, z: fan.cone.z, vy: cone.vy, el: cone.elevated, gv, a0, a1, reach, coarse } };
  }

  /** A finished rebuild: its buffer becomes the shown one. */
  _finish({ fan, sector }, cone) {
    const shown = this._b;
    this._b = this._stage; this._stage = shown || null;
    this._commit();
    this._sector = sector;
    this.group.position.set(cone.x - sector.x, 0, cone.z - sector.z);
    this.fan = fan;
    this.rebuilds++;
    this.rayCount = fan.angles.length;
  }

  /** Draped triangles of a sector fan into buffer `o` (lowVis 1 on the NEAR kind), in steps: one ray pair a step. */
  *_meshSteps(fan, world, grid, o, sliceLen = SLICE) {
    const gs = groundSampler(world);
    const el = grid?.elevAt ? (x, z) => grid.elevAt(x, z) : null;
    const slice = gs || el ? sliceLen : Infinity; // (sliced to drape the relief and to cut the risers of raised cells finely)
    const { angles, spans } = fan, ex = fan.cone.x, ez = fan.cone.z;
    const put = (lv, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) => {
      grow(o, 18);
      const a = o.a, l = o.l;
      let n = o.n;
      a[n] = ax; a[n + 1] = ay; a[n + 2] = az; a[n + 3] = bx; a[n + 4] = by; a[n + 5] = bz; a[n + 6] = cx; a[n + 7] = cy; a[n + 8] = cz;
      a[n + 9] = cx; a[n + 10] = cy; a[n + 11] = cz; a[n + 12] = bx; a[n + 13] = by; a[n + 14] = bz; a[n + 15] = dx; a[n + 16] = dy; a[n + 17] = dz;
      const v = n / 3;
      for (let q = 0; q < 6; q++) l[v + q] = lv;
      o.n = n + 18;
    };
    // a quad between the rays (A side ra0→ra1, B side rb0→rb1) whose corners straddle a step in the raised cells (a
    // cliff or roof edge: corners more than MAX_STEP apart) is cut finer and its parts on the riser are left out, so the
    // cone lies on each level and never paints the face between them
    const g = gs || (() => 0);
    const riser = (lv, ca, sa, cb, sb, ra0, ra1, rb0, rb1, depth) => {
      for (let q = 0; q < 3; q++) {
        const u0 = q / 3, u1 = (q + 1) / 3;
        const a0 = ra0 + (ra1 - ra0) * u0, a1 = ra0 + (ra1 - ra0) * u1, b0 = rb0 + (rb1 - rb0) * u0, b1 = rb0 + (rb1 - rb0) * u1;
        const A0x = ex + ca * a0, A0z = ez + sa * a0, A1x = ex + ca * a1, A1z = ez + sa * a1;
        const B0x = ex + cb * b0, B0z = ez + sb * b0, B1x = ex + cb * b1, B1z = ez + sb * b1;
        const e0 = el(A0x, A0z), e1 = el(A1x, A1z), e2 = el(B0x, B0z), e3 = el(B1x, B1z);
        if (Math.max(e0, e1, e2, e3) - Math.min(e0, e1, e2, e3) > 0.6) { if (depth < 2) riser(lv, ca, sa, cb, sb, a0, a1, b0, b1, depth + 1); continue; }
        put(lv, A0x, Y + e0 + g(A0x, A0z), A0z, B0x, Y + e2 + g(B0x, B0z), B0z, A1x, Y + e1 + g(A1x, A1z), A1z, B1x, Y + e3 + g(B1x, B1z), B1z);
      }
    };
    for (let r = 0; r + 1 < angles.length; r++) {
      const ca = Math.cos(angles[r]), sa = Math.sin(angles[r]), cb = Math.cos(angles[r + 1]), sb = Math.sin(angles[r + 1]);
      pairSpans(spans[r], spans[r + 1], (r0a, r1a, r0b, r1b, kind) => {
        const lv = kind === NEAR ? 1 : 0;
        const m = Math.max(1, Math.min(64, Math.ceil(Math.max(r1a - r0a, r1b - r0b) / slice)));
        // corners carried from one slice to the next: each ground height is looked up once
        let Ax = ex + ca * r0a, Az = ez + sa * r0a, Bx = ex + cb * r0b, Bz = ez + sb * r0b;
        let eA = el ? el(Ax, Az) : 0, eB = el ? el(Bx, Bz) : 0;
        let yA = Y + eA + g(Ax, Az), yB = Y + eB + g(Bx, Bz);
        for (let q = 1; q <= m; q++) {
          const uu = q / m, ra = r0a + (r1a - r0a) * uu, rb = r0b + (r1b - r0b) * uu;
          const Cx = ex + ca * ra, Cz = ez + sa * ra, Dx = ex + cb * rb, Dz = ez + sb * rb;
          const eC = el ? el(Cx, Cz) : 0, eD = el ? el(Dx, Dz) : 0;
          const yC = Y + eC + g(Cx, Cz), yD = Y + eD + g(Dx, Dz);
          if (el && Math.max(eA, eB, eC, eD) - Math.min(eA, eB, eC, eD) > 0.6) riser(lv, ca, sa, cb, sb, r0a + (r1a - r0a) * (q - 1) / m, ra, r0b + (r1b - r0b) * (q - 1) / m, rb, 1);
          else put(lv, Ax, yA, Az, Bx, yB, Bz, Cx, yC, Cz, Dx, yD, Dz);
          Ax = Cx; Az = Cz; Bx = Dx; Bz = Dz; eA = eC; eB = eD; yA = yC; yB = yD;
        }
      });
      yield;
    }
  }

  /** Hand the buffers to the geometry (attributes re-made when they grew). */
  _commit() {
    const o = this._b, geo = this.geo;
    let pa = geo.attributes.position, la = geo.attributes.lowVis;
    if (pa.array.length < o.a.length) {
      pa = new THREE.BufferAttribute(new Float32Array(o.a.length), 3); geo.setAttribute('position', pa);
      la = new THREE.BufferAttribute(new Float32Array(o.a.length / 3), 1); geo.setAttribute('lowVis', la);
    }
    pa.array.set(o.a.subarray(0, o.n)); la.array.set(o.l.subarray(0, o.n / 3));
    pa.needsUpdate = la.needsUpdate = true;
    geo.setDrawRange(0, o.n / 3);
    geo.boundingSphere = null;
  }

  /**
   * What the cone shader draws at (x, z) this frame: 'near' (dark: a crawler is seen too), 'far' (light: only a
   * standing man) or null — the sector's triangles (moved with the group) under the head's window and near / far.
   * The JS twin of coneMaterial's fragment test (tests: drawn cone == detection).
   * @returns {'near'|'far'|null}
   */
  drawnAt(x, z) {
    const c = this._cone, o = this._b;
    if (!c || !o) return null;
    const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
    let a = Math.atan2(dz, dx) - c.heading;
    a -= TAU * Math.floor((a + Math.PI) / TAU);
    if (d > c.far || (d > 1e-4 && Math.abs(a) > c.halfFov)) return null;
    const px = x - this.group.position.x, pz = z - this.group.position.z;
    const A = o.a;
    let hit = -1;
    for (let t = 0; t < o.n; t += 9) {
      const x0 = A[t], z0 = A[t + 2], x1 = A[t + 3], z1 = A[t + 5], x2 = A[t + 6], z2 = A[t + 8];
      const d0 = (px - x1) * (z0 - z1) - (x0 - x1) * (pz - z1), d1 = (px - x2) * (z1 - z2) - (x1 - x2) * (pz - z2), d2 = (px - x0) * (z2 - z0) - (x2 - x0) * (pz - z0);
      if (((d0 < 0) || (d1 < 0) || (d2 < 0)) && ((d0 > 0) || (d1 > 0) || (d2 > 0))) continue;
      hit = Math.max(hit, o.l[t / 3]);
      if (hit >= 1) break;
    }
    if (hit < 0) return null;
    return hit >= 1 && d <= c.near ? 'near' : 'far';
  }

  /** Flat BEL palette (or alertTint colours), 50% alpha; 75% while the spotter highlight is on. */
  _setColor(enemy) {
    const tint = this.opts.alertTint ?? CONFIG.stealth.alertTint;
    const lvl = Math.max(0, Math.min(2, enemy.alertLevel | 0));
    const pal = this.opts.palette || this.world?.mission?.coneColors || enemy.world?.mission?.coneColors || 'green';
    const key = `${pal}|${tint ? lvl : 0}|${this.highlight}`;
    if (key === this._colorKey) return;
    this._colorKey = key;
    const c = paletteColors(pal);
    let near = c.near, far = c.far;
    if (tint && lvl > 0) {
      const t = new THREE.Color(CONFIG.stealth.alertTintColors[lvl]).getHex();
      near = t;
      far = new THREE.Color(t).multiplyScalar(0.55).getHex();
    }
    this.nearMesh.material.color.setHex(near);
    this.farMesh.material.color.setHex(far);
    const a = this.highlight ? CONFIG.stealth.spotterHighlight.alpha : CONFIG.stealth.coneAlpha;
    this.nearMesh.material.opacity = this.farMesh.material.opacity = a;
  }

  dispose() {
    this.nearGeo.dispose(); this.farGeo.dispose();
    this.nearMesh.material.dispose(); this.farMesh.material.dispose();
    this.group.removeFromParent();
  }
}

/**
 * Keeps the shown cone(s) in `scene` (Renderer.decalScene). BEL shows ONE cone at a time
 * (CONFIG.stealth.multiCone): turning a cone on (enemy.coneVisible = true, the eye button / click) hides the
 * previously shown one. `?debug=cones` (or `showAll`) shows every cone (Shift+V cheat).
 * Spotter highlight: 'enemy:spotted' (CHALLENGE / COMBAT entry) or 'enemy:noise-turn' (a lure turns a
 * post-holder) makes that enemy's cone the shown one at 75%
 * alpha for 1 s. Probe marker: setProbe(x, z[, enemy]) drops the red 0.6 m ring; the first enemy whose cone (standing
 * test) contains it gets its cone shown and the ring pulses; each marker triggers once; clearProbe().
 */
export class VisionCones {
  constructor(world, scene, opts = {}) {
    this.world = world;
    this.scene = scene;
    this.opts = opts;
    /** @type {Map<any, VisionCone>} */
    this.cones = new Map();
    /** Enemies whose cone is shown, oldest first. */
    this.shown = [];
    let dbg = false;
    try { dbg = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === 'cones'; } catch { dbg = false; }
    this.showAll = opts.showAll ?? dbg;
    /** Extra cones on show (debug video mode: the guards that matter to the step), or null. Drawing only. */
    this.forced = null;
    this.highlightUntil = new Map();
    this.probe = null;
    const offs = [
      world?.events?.on?.('enemy:spotted', ({ enemy }) => this.spotted(enemy)),
      // a post-holder swung round by a lure: show his cone turning (replay round 3, M3 bunker gunner)
      world?.events?.on?.('enemy:noise-turn', ({ enemy }) => this.spotted(enemy)),
    ].filter(Boolean);
    this._off = offs.length ? () => offs.forEach((f) => f()) : null;
  }

  /** §4.2 spotter highlight: show this enemy's cone at 75% alpha for 1 s. */
  spotted(enemy) {
    if (!enemy || !enemy.vision || !this.world.enemies?.includes?.(enemy)) return; // vehicle sightings: no foot cone
    enemy.coneVisible = true;
    this._promote(enemy);
    this.highlightUntil.set(enemy, (this.world.time ?? 0) + CONFIG.stealth.spotterHighlight.dur);
  }

  _promote(e) {
    const i = this.shown.indexOf(e);
    if (i >= 0) this.shown.splice(i, 1);
    this.shown.push(e);
    const max = Math.max(1, this.opts.multiCone ?? CONFIG.stealth.multiCone);
    while (this.shown.length > max) this.shown.shift().coneVisible = false;
  }

  /**
   * Drop the red probe marker at (x, z) (Shift+click on the ground). `enemy`: the cone the caller already found covering
   * the point and showed (Game.probe) — the marker is then triggered at once, so a later frame never re-shows a cone the
   * player has hidden since (eye tool, click) as a "late" trigger.
   */
  setProbe(x, z, enemy = null) {
    this.clearProbe();
    const r = CONFIG.stealth.probeRing / 2;
    const geo = new THREE.RingGeometry(r - 0.07, r, 32);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
    mesh.position.set(x, Y + 0.01, z);
    mesh.renderOrder = 6;
    this.scene?.add(mesh);
    this.probe = { x, z, mesh, triggered: !!enemy, enemy: enemy || null, t0: enemy ? (this.world.time ?? 0) : 0 };
    if (enemy) this._promote(enemy);
    return this.probe;
  }

  clearProbe() {
    if (!this.probe) return;
    this.probe.mesh.geometry.dispose();
    this.probe.mesh.material.dispose();
    this.probe.mesh.removeFromParent();
    this.probe = null;
  }

  _updateProbe() {
    const p = this.probe;
    if (!p) return;
    const now = this.world.time ?? 0;
    if (!p.triggered) {
      const e = probeCone(this.world, p.x, p.z);
      if (e) { p.triggered = true; p.enemy = e; p.t0 = now; e.coneVisible = true; this._promote(e); }
    }
    p.mesh.scale.setScalar(p.triggered ? 1 + 0.3 * Math.abs(Math.sin((now - p.t0) * 5)) : 1);
  }

  /** Per-frame refresh (call from Game.render). */
  update() {
    const w = this.world;
    for (const e of w.enemies) if (e.coneVisible && !this.shown.includes(e)) this._promote(e);
    this.shown = this.shown.filter((e) => e.coneVisible && w.enemies.includes(e));
    this._updateProbe();
    const t = w.time ?? 0;
    const shown = [];
    for (const e of w.enemies) {
      const show = (e.coneVisible || this.showAll || !!this.forced?.has(e)) && e.alive !== false && !e.removed && e.state !== 'dead' && !!e.vision && !e.incapacitated;
      let cone = this.cones.get(e);
      if (show) {
        if (!cone) { cone = new VisionCone(e, w, this.opts); this.cones.set(e, cone); this.scene.add(cone.group); }
        cone.highlight = (this.highlightUntil.get(e) ?? -1) > t;
        shown.push([e, cone]);
      } else if (cone) {
        cone.dispose();
        this.cones.delete(e);
      }
    }
    // one frame budget (CONFIG.stealth.coneBudgetMs) for the sector rebuilds of the cones already built, taken round
    // robin from a different cone each frame: a rebuild is spread over frames instead of a hitch (a cone's first build
    // is whole, at once)
    const budget = { until: now() + (this.opts.budgetMs ?? CONFIG.stealth.coneBudgetMs ?? 0.5), steps: 0 };
    const n = shown.length, r0 = n ? (this._rr = ((this._rr ?? -1) + 1) % n) : 0;
    for (let k = 0; k < n; k++) { const [e, cone] = shown[(r0 + k) % n]; cone.update(e, budget); }
    for (const [e, cone] of this.cones) if (!w.enemies.includes(e)) { cone.dispose(); this.cones.delete(e); }
  }

  dispose() {
    this._off?.();
    this.clearProbe();
    for (const c of this.cones.values()) c.dispose();
    this.cones.clear();
  }
}

export default VisionCones;
