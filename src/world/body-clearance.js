/**
 * Body clearance against solid obstacles (docs/clipping-audit.md "characters vs vehicles and solid props").
 *
 * A man is not a point. Standing he is a disc of BODY.stand.r around his position. Prone (crawling, downed, lying
 * dead) he is a capsule along his heading: the pelvis sits on the unit position, the hands and muzzle reach
 * BODY.prone.front ahead and the toes BODY.prone.back behind (docs/crawl-animation.md §3). Units path on the 0.5 m
 * NavGrid by their centre, so without this a crawler's legs or head slid under a parked truck or into a crate and a
 * moving vehicle could roll over a prone man and leave him alive under the chassis.
 *
 * Obstacles (all as oriented rects {x, z, h, hl, hw} or discs {x, z, r}; `src` = the entity, when it is one):
 *  - vehicle hulls: land vehicles and visible trains, wrecks included (isSolidHull);
 *  - movers: standing fuel drums (discs) and BCD pushables (wagon / fuel tank rects, rolling or at rest);
 *  - static solids (world.bodySolids, setStaticSolids): crates, drums stacks, fuel tanks, rocks, carts, furniture,
 *    plane / boat / train-car props — the min-area rect of each visual at body height (map-builder registers them).
 * Walls, fences, buildings and the rest of the nav grid keep their own rules (grid block + rule (e) visual nav).
 *
 * Pure geometry + world queries; no three.js.
 * @module world/body-clearance
 */

/**
 * Body shapes (m). `front`/`back`: capsule extent ahead / behind the unit position, `r`: capsule radius; `arms`: a
 * second capsule across the body, `at` m behind the unit position, reaching `half` m to each side.
 */
export const BODY = {
  stand: { front: 0.3, back: 0.3, r: 0.3 },
  // front: the weapon held out ahead of the face when he stops (crawl-animation.md §4.1); back: the dragging toe of the
  // straight leg, measured 1.0-1.06 m behind the unit position in the stroke (clip-2: 0.92 let it into a wagon's side)
  prone: { front: 1.3, back: 1.05, r: 0.3 },
  // a man lying dead on his back (the settled death pose: art 'dead' clip, physics/ragdoll LIE.supine): he fell
  // backwards, so his heels are 0.65 m ahead of where he stood, his head 1.25 m behind it, and his hands flung out
  // past the head, 1.45 m behind it and up to 0.7 m to each side (a man who died crawling lies like a crawler)
  dead: { front: 0.65, back: 1.25, r: 0.3, arms: { at: 1.45, half: 0.7, r: 0.15 } },
};
/** Clearance kept at a stop / after lying down (m). */
export const STOP_MARGIN = 0.1;
/** Clearance the step guard keeps while moving / turning (m). */
export const MOVE_MARGIN = 0.05;
/** Half the diagonal of a 0.5 m cell: any point of a free cell is at least (inflation) from a hull. */
const CELL_SLACK = 0.354;

const PRONE_STANCES = new Set(['crawl', 'downed', 'prone', 'dead_prone']);

/** Shape of a stance ('crawl' / 'downed' / 'prone' / 'dead_prone' lie on the belly, 'dead' on the back). */
export function bodyShape(stance) {
  return stance === 'dead' ? BODY.dead : PRONE_STANCES.has(stance) ? BODY.prone : BODY.stand;
}

/** Corpse stance of a man who died in stance `st` (a crawler dies on his belly, anyone else falls on his back). */
export const deadStance = (st) => (st === 'crawl' || st === 'prone' ? 'dead_prone' : 'dead');

/** Segment ends + radius of the body capsule at (x, z) facing `heading`. */
export function bodyCapsule(x, z, heading, stance) {
  const S = bodyShape(stance);
  const c = Math.cos(heading), s = Math.sin(heading);
  const a = S.front - S.r, b = S.back - S.r;
  return { ax: x + c * a, az: z + s * a, bx: x - c * b, bz: z - s * b, r: S.r };
}

/** The flung-out arms of a body shape that has them (a corpse on his back), as a capsule across it, or null. */
export function armsCapsule(x, z, heading, stance) {
  const A = bodyShape(stance).arms;
  if (!A) return null;
  const c = Math.cos(heading), s = Math.sin(heading), mx = x - c * A.at, mz = z - s * A.at, l = A.half - A.r;
  return { ax: mx - s * l, az: mz + c * l, bx: mx + s * l, bz: mz - c * l, r: A.r };
}

/**
 * Oriented hull rectangle of a vehicle (the larger of def.size and the model's measured dims).
 * @returns {{x:number, z:number, h:number, hl:number, hw:number}}
 */
export function hullRect(v, x = v.x, z = v.z, h = v.heading) {
  const [l, w] = v.def.size;
  const d = v.model?.dims;
  return { x, z, h, hl: Math.max(l, d?.l || 0) / 2, hw: Math.max(w, d?.w || 0) / 2 };
}

/** Signed distance from a point to an oriented rect or a disc {x, z, r} (negative inside). */
export function rectSDF(px, pz, R) {
  if (R.r != null) return Math.hypot(px - R.x, pz - R.z) - R.r;
  const c = Math.cos(R.h), s = Math.sin(R.h), dx = px - R.x, dz = pz - R.z;
  const a = Math.abs(dx * c + dz * s) - R.hl, b = Math.abs(-dx * s + dz * c) - R.hw;
  return Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0);
}

function segPointDist(ax, az, bx, bz, px, pz) {
  const ux = bx - ax, uz = bz - az, L2 = ux * ux + uz * uz;
  const t = L2 > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * ux + (pz - az) * uz) / L2)) : 0;
  return Math.hypot(ax + ux * t - px, az + uz * t - pz);
}

/**
 * Gap between a capsule and an oriented rect or a disc (m): > 0 clear, < 0 penetration depth. Exact for a disc; for a
 * rect exact to ~2 cm (the segment is sampled every 5 cm; the rect corners are tested against the segment exactly).
 */
export function capsuleRectGap(C, R) {
  if (R.r != null) return segPointDist(C.ax, C.az, C.bx, C.bz, R.x, R.z) - R.r - C.r;
  const len = Math.hypot(C.bx - C.ax, C.bz - C.az);
  const n = Math.max(1, Math.ceil(len / 0.05));
  let d = Infinity;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    d = Math.min(d, rectSDF(C.ax + (C.bx - C.ax) * t, C.az + (C.bz - C.az) * t, R));
  }
  if (d > 0) {
    const c = Math.cos(R.h), s = Math.sin(R.h);
    for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const px = R.x + c * u * R.hl - s * v * R.hw, pz = R.z + s * u * R.hl + c * v * R.hw;
      d = Math.min(d, segPointDist(C.ax, C.az, C.bx, C.bz, px, pz));
    }
  }
  return d - C.r;
}

/** Bounding radius of an obstacle about its centre. */
function obsRadius(R) {
  return R.r != null ? R.r : Math.hypot(R.hl, R.hw);
}

/** Is this vehicle a solid hull men can't lie or stand under (land vehicles, visible trains, their wrecks)? */
export function isSolidHull(v) {
  if (!v || v.removed || v.hiddenRail || !v.def) return false;
  const k = v.def.kind;
  return k === 'land' || k === 'rail';
}

/**
 * Fuel drums standing on the ground (not carried, not blown up): disc radius (m). The drum measures 0.32 m in radius at its rims;
 * the rest keeps a standing man's swinging arms and port-arms rifle (up to ~0.45 m out of his centre, past the 0.3 m
 * body) out of it while he runs past or turns beside it (clip-2: M2 `e12` turning on the spot by `bar4`, 0.053 m).
 */
const DRUM_R = 0.42;

/**
 * Solid movers among the world's interactables: standing fuel drums (discs) and BCD pushables (rects, rolling or at
 * rest). Cached per interactables array length; the shapes are read live (they move).
 */
function moverEntities(world) {
  const list = world?.interactables;
  if (!list?.length) return [];
  const c = world._bodyMovers;
  if (c && c.list === list && c.n === list.length) return c.out;
  const out = list.filter((it) => it.interactKind === 'barrel' || it.interactKind === 'pushable');
  world._bodyMovers = { list, n: list.length, out };
  return out;
}

/** Obstacle shape of a mover now, or null (carried, exploded, destroyed, gone). */
export function moverShape(it) {
  if (!it || it.removed) return null;
  if (it.interactKind === 'barrel') {
    if (it.exploded || it.carriedBy || it.alive === false || (it.y || 0) > 0.3) return null;
    return { x: it.x, z: it.z, r: DRUM_R, src: it };
  }
  if (it.interactKind === 'pushable') {
    if (it.destroyed || !it.size) return null;
    return { x: it.x, z: it.z, h: it.heading ?? 0, hl: it.size[0] / 2, hw: it.size[1] / 2, src: it };
  }
  return null;
}

/**
 * Every dynamic obstacle now (vehicle hulls + movers), skipping `ignore` (an entity or an array of them); with
 * `near` {x, z, reach} only those within `reach` m of their shape (cheap prefilter before any shape is built).
 */
export function dynamicObstacles(world, ignore = null, near = null) {
  const skip = (e) => e === ignore || (Array.isArray(ignore) && ignore.includes(e));
  const out = [];
  const far = (e, r) => !!near && Math.hypot(e.x - near.x, e.z - near.z) > r + near.reach;
  for (const v of world?.vehicles || []) {
    if (!isSolidHull(v) || skip(v)) continue;
    const d = v.model?.dims;
    if (far(v, Math.hypot(Math.max(v.def.size[0], d?.l || 0), Math.max(v.def.size[1], d?.w || 0)) / 2)) continue;
    const R = hullRect(v); R.src = v; out.push(R);
  }
  for (const it of moverEntities(world)) {
    if (skip(it) || far(it, it.size ? Math.hypot(it.size[0], it.size[1]) / 2 : DRUM_R)) continue;
    const R = moverShape(it);
    if (R) out.push(R);
  }
  return out;
}

const BUCKET = 4;

/**
 * Register the static solid obstacles of a map (replaces any previous set): [{owner, R}] with R a rect or disc.
 * `owner` (grid structure owner) lets removeStaticSolids drop one when its structure is destroyed.
 */
export function setStaticSolids(world, list) {
  const S = { list: [], buckets: new Map(), version: ((world.bodySolids?.version) || 0) + 1, masks: new Map() };
  for (const o of list || []) if (o?.R) S.list.push({ owner: o.owner ?? null, R: o.R, gone: false });
  S.list.forEach((o, k) => {
    const r = obsRadius(o.R);
    for (let bj = Math.floor((o.R.z - r) / BUCKET); bj <= Math.floor((o.R.z + r) / BUCKET); bj++) {
      for (let bi = Math.floor((o.R.x - r) / BUCKET); bi <= Math.floor((o.R.x + r) / BUCKET); bi++) {
        const key = bi * 65536 + bj;
        if (!S.buckets.has(key)) S.buckets.set(key, []);
        S.buckets.get(key).push(k);
      }
    }
  });
  world.bodySolids = S;
  return S.list.length;
}

/** Drop the static solids of a structure owner (destroyed). */
export function removeStaticSolids(world, owner) {
  const S = world?.bodySolids;
  if (!S || owner == null) return 0;
  let n = 0;
  for (const o of S.list) if (o.owner === owner && !o.gone) { o.gone = true; n++; }
  if (n) { S.version++; S.masks.clear(); }
  return n;
}

/** Static solids within `reach` m of (x, z) (bucket lookup + circle prefilter). */
export function staticNear(world, x, z, reach) {
  const S = world?.bodySolids;
  if (!S?.list.length) return [];
  const out = [], q = (S.query = (S.query || 0) + 1);
  for (let bj = Math.floor((z - reach) / BUCKET); bj <= Math.floor((z + reach) / BUCKET); bj++) {
    for (let bi = Math.floor((x - reach) / BUCKET); bi <= Math.floor((x + reach) / BUCKET); bi++) {
      const list = S.buckets.get(bi * 65536 + bj);
      if (!list) continue;
      for (const k of list) {
        const o = S.list[k];
        if (o.q === q) continue;
        o.q = q;
        if (o.gone || Math.hypot(x - o.R.x, z - o.R.z) > obsRadius(o.R) + reach) continue;
        out.push(o.R);
      }
    }
  }
  return out;
}

/** Any solid obstacle on this map at all (vehicle hulls, movers, static solids)? */
export function hasObstacles(world) {
  if (world?.bodySolids?.list.length) return true;
  if ((world?.vehicles || []).some((v) => isSolidHull(v))) return true;
  return moverEntities(world).some((it) => moverShape(it));
}

/** Solid obstacles (hulls, movers, static solids) near (x, z) within `reach` m of their shape. */
export function hullsNear(world, x, z, reach, ignore = null) {
  const out = dynamicObstacles(world, ignore, { x, z, reach });
  for (const R of staticNear(world, x, z, reach)) out.push(R);
  return out;
}

/**
 * Smallest gap (m) between a body at this pose and any solid obstacle (Infinity when none is near).
 * @param {object} world @param {number} x @param {number} z @param {number} heading @param {string} stance
 * @param {object|object[]} [ignore] entities to skip (the vehicle he is getting out of, the drum he picks up)
 */
export function bodyGap(world, x, z, heading, stance, ignore = null) {
  const S = bodyShape(stance);
  const hulls = hullsNear(world, x, z, Math.max(S.front, S.back, S.arms ? Math.hypot(S.arms.at, S.arms.half) : 0) + 0.5, ignore);
  if (!hulls.length) return Infinity;
  const C = bodyCapsule(x, z, heading, stance), A = armsCapsule(x, z, heading, stance);
  let g = Infinity;
  for (const R of hulls) g = Math.min(g, capsuleRectGap(C, R), A ? capsuleRectGap(A, R) : Infinity);
  // a crawler's limbs reach out of the capsule: the drawn-up knee (one side, then the other) and the splayed toes
  if (CRAWL_LIMBS.has(stance)) {
    const c = Math.cos(heading), s = Math.sin(heading);
    for (const [a, l, r] of LIMBS) {
      const px = x + c * a - s * l, pz = z + s * a + c * l;
      for (const R of hulls) g = Math.min(g, (R.r != null ? Math.hypot(px - R.x, pz - R.z) - R.r : rectSDF(px, pz, R)) - r);
    }
  }
  return g;
}

/** Stances whose limbs splay out of the body capsule (crawl-animation.md §3: frog-legged low crawl). */
const CRAWL_LIMBS = new Set(['crawl', 'downed']);
/**
 * Limb discs [along (m, + ahead), lateral (m), radius] of a crawler, measured on the crawl stroke (clip-2): the
 * drawn-up knee 0.64 m to his side just behind the hips, the toes of the straight leg up to 1.07 m behind, 0.37 m out.
 */
const LIMBS = [[-0.15, 0.5, 0.17], [-0.15, -0.5, 0.17], [-0.95, 0.3, 0.17], [-0.95, -0.3, 0.17]];

/** Gap of a unit's current body (its stance and heading). */
export function unitGap(u, world = u.world) {
  return bodyGap(world, u.x, u.z, u.heading, unitStance(u), u.vehicle || null);
}

/** Body stance class of a unit: lying (crawl / downed / dead on his back / dead on his belly) or upright. */
export function unitStance(u) {
  if (u.alive === false || u.state === 'dead') return deadStance(u.stance);
  return u.stance;
}

function stampObstacle(g, mask, R, pad) {
  const r = obsRadius(R) + pad;
  const c0 = g.worldToCell(R.x - r, R.z - r), c1 = g.worldToCell(R.x + r, R.z + r);
  for (let j = Math.max(0, c0.j); j <= Math.min(g.rows - 1, c1.j); j++) {
    for (let i = Math.max(0, c0.i); i <= Math.min(g.cols - 1, c1.i); i++) {
      const p = g.cellCenter(i, j);
      if (rectSDF(p.x, p.z, R) < pad) mask[j * g.cols + i] = 1;
    }
  }
}

/**
 * Avoid mask for NavGrid paths (grid.isWalkable opts.avoid): 1 on every cell whose centre is closer than
 * `inflate + CELL_SLACK` to a solid obstacle, so every point of a free cell keeps `inflate` from it. The static
 * solids' part is cached per inflation (until one is destroyed); hulls and movers are stamped on a copy.
 * @param {object|object[]} [ignore] entities left out (see bodyGap)
 * @returns {Uint8Array|null} null when the world has no solid obstacles
 */
export function avoidMask(world, inflate, ignore = null) {
  const g = world?.grid;
  if (!g) return null;
  const pad = inflate + CELL_SLACK;
  const S = world.bodySolids;
  let base = null;
  if (S?.list.length) {
    const key = `${inflate}|${g.cols}x${g.rows}`;
    base = S.masks.get(key);
    if (!base) {
      base = new Uint8Array(g.cols * g.rows);
      for (const o of S.list) if (!o.gone) stampObstacle(g, base, o.R, pad);
      S.masks.set(key, base);
    }
  }
  const dyn = dynamicObstacles(world, ignore);
  if (!dyn.length) return base;
  const mask = base ? base.slice() : new Uint8Array(g.cols * g.rows);
  for (const R of dyn) stampObstacle(g, mask, R, pad);
  return mask;
}

/**
 * Inflation tiers (m) for a stance's path query (every point of the path keeps the stop margin): prone tries
 * any-heading room first, then lying parallel.
 */
export function inflationTiers(stance) {
  const S = bodyShape(stance);
  const lat = S.r + STOP_MARGIN;
  const full = Math.max(S.front, S.back) + STOP_MARGIN;
  return full > lat + 1e-6 ? [full, lat] : [lat];
}

/** Does a turn in place from h0 to h1 (shortest way) keep the body ≥ margin from every hull? */
export function sweepClear(world, x, z, h0, h1, stance, margin, ignore = null) {
  let d = h1 - h0;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const n = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 36)));
  for (let k = 1; k <= n; k++) if (bodyGap(world, x, z, h0 + (d * k) / n, stance, ignore) < margin) return false;
  return true;
}

/**
 * Nearest pose where the whole body keeps `margin` from every hull: the same spot with the nearest heading that is
 * reachable by turning in place (sweep clear when `sweep`), else the nearest walkable spot (rings to `maxDist`) with
 * the heading closest to the current one. Returns null when nothing is free.
 * `fits(x, z, h)`: an extra test every pose must pass (a body laid down: room for the physics' lying pose);
 * `shiftFirst`: the nearest spot with the SAME heading is tried before any turn (a man put down is laid a little
 * aside rather than swung round).
 * @returns {{x:number, z:number, heading:number, moved:boolean}|null}
 */
export function clearPose(world, x, z, heading, stance, { margin = STOP_MARGIN, ignore = null, sweep = true, maxDist = 2, walkable = null, fits = null, shiftFirst = false } = {}) {
  const free = (px, pz, h) => bodyGap(world, px, pz, h, stance, ignore) >= margin && (!fits || fits(px, pz, h));
  if (free(x, z, heading)) return { x, z, heading, moved: false };
  const DH = Math.PI / 12;
  const order = [];
  for (let k = 1; k <= 12; k++) { order.push(heading + k * DH, heading - k * DH); }
  const ok = walkable || ((px, pz) => world.grid?.walkableAt?.(px, pz) ?? true);
  /** Nearest ring spot (to maxDist) where one of `hs` is free (the heading closest to the current one), or null. */
  const rings = (hs) => {
    for (let r = 0.25; r <= maxDist + 1e-6; r += 0.25) {
      const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.25));
      let best = null;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 2 * Math.PI, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!ok(px, pz)) continue;
        for (const h of hs) {
          if (!free(px, pz, h)) continue;
          const dh = Math.abs(Math.atan2(Math.sin(h - heading), Math.cos(h - heading)));
          if (!best || dh < best.dh) best = { x: px, z: pz, heading: h, dh };
          break;
        }
      }
      if (best) return { x: best.x, z: best.z, heading: best.heading, moved: true };
    }
    return null;
  };
  if (shiftFirst) { const p = rings([heading]); if (p) return p; }
  for (const h of order) {
    if (!free(x, z, h)) continue;
    if (sweep && !sweepClear(world, x, z, heading, h, stance, Math.min(margin, MOVE_MARGIN), ignore)) continue;
    return { x, z, heading: h, moved: false };
  }
  return rings([heading, ...order]);
}

/**
 * Minimum-area oriented rect around a convex polygon [[x, z], …] (rotating calipers over its edges), as an obstacle
 * {x, z, h, hl, hw}. A round outline stays a rect (its corners overhang a disc by ≤ 0.41 r);
 * callers pick a disc themselves when they know the shape is round.
 */
export function minAreaRect(hull) {
  if (!hull?.length) return null;
  if (hull.length < 3) {
    const xs = hull.map((p) => p[0]), zs = hull.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, h: 0, hl: Math.max(0.05, (x1 - x0) / 2), hw: Math.max(0.05, (z1 - z0) / 2) };
  }
  let best = null;
  for (let k = 0; k < hull.length; k++) {
    const p = hull[k], q = hull[(k + 1) % hull.length];
    const h = Math.atan2(q[1] - p[1], q[0] - p[0]), c = Math.cos(h), s = Math.sin(h);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of hull) {
      const u = x * c + z * s, v = -x * s + z * c;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-9) {
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      best = { area, x: um * c - vm * s, z: um * s + vm * c, h, hl: Math.max(0.05, (u1 - u0) / 2), hw: Math.max(0.05, (v1 - v0) / 2) };
    }
  }
  const { area, ...R } = best;
  return R;
}

/** The pushable `u` is pushing right now (its rect moves with him and is no obstacle to him), or null. */
export function pushedBy(world, u) {
  for (const it of moverEntities(world)) if (it.interactKind === 'pushable' && it.pusher === u && it.goal) return it;
  return null;
}
