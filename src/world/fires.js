/**
 * Fires in the simulation (user 2026-11-08: "Enemies should not walk through the fire").
 *
 * The flames themselves are drawn by the VFX (render/fx.js, render/vfx/effects.js, blaze.js); this module keeps the
 * simulation's own record of WHERE something burns and WHEN, from the same events the VFX answers and the same sizes
 * and burn times (the constants below: the VFX imports them, the sim never imports render code):
 *  - a destroyed structure (`explosion` kind 'structure'): its burning wreck over the flattened footprint (60 s), a fuel
 *    tank's fire round its wreck (90 s), a bunker's small fire in its doorway (30 s), and the blast's burning ground;
 *  - a bomb (`explosion` kind 'bomb'): the burning ground of its blast (explosion_large's residual fire, ~16 s);
 *  - a fuel drum (`explosion` kind 'barrel'): its burning spill (10 s), an oil-rack store's fire (45 s, M8);
 *  - a destroyed vehicle (`vehicle:destroyed`): its burning wreck while the game burns it (vehicle.burning, §3.6 20 s:
 *    the hull and the 1.5 m round it where the fire hurts, plus half a cell);
 *  - a `fire` event with a radius (M17's burning oil spill): that circle until its `fire` off;
 *  - a mission `fx` campfire (`fire_small` / `campfire` / `fire`): for the whole mission.
 *
 * Each fire has a footprint (the flames' ellipse or the hull's rectangle, plus FIRE_MARGIN) and a window: it starts to
 * count once its flames have caught (burn level 0.5, a fraction of a second after the blast — never in the blast's own
 * tick) and stops once they are down to a smoulder (blazeLevel: 12 % at SMOULDER_AT · burn — the glowing embers after it
 * are walkable), or when the game puts it out (a wreck's `burning`, a spill's `fire` off). While it counts its cells
 * are stamped in the grid's `fire` layer (NavGrid.fire: a count per cell, `fireCells`, `fireVersion`). The enemies plan
 * round it (Enemy.pathQuery → findPath `fire`), stop at its edge when their goal is in it, and step out of it when it
 * catches under them (FireField.update → react). The player's commandos are not affected.
 *
 * Deterministic: driven by sim events and world.time only; stamped at the start of a tick (World.refreshDynamicOccluders,
 * before any unit moves); saved with the world (serialize / deserialize).
 * @module world/fires
 */

import { T } from './grid.js';
import { CONFIG } from '../config.js';
import { isFuelStructure, fuelBlastScale } from '../art/fuel-tanks.js';

/** Share of its burn time after which a fire is down to its smoulder (blazeLevel's 12 %). */
export const SMOULDER_AT = 0.86;

/** Burn level 0..1 over a fire's age: catches over `ramp` s; with a known burn time it holds to hold·burn, dies down
 *  to a smoulder (0.12) by SMOULDER_AT·burn, then smoulders out (→ 0.08 at `burn`, and on until stopped). Shared with
 *  the VFX (render/vfx/blaze.js re-exports it; the VOLUME shader computes the same curve). */
export function blazeLevel(ramp, burn = 0, hold = 0.55) {
  return (a) => {
    let k = Math.min(1, 0.25 + 0.75 * a / Math.max(ramp, 1e-3));
    if (burn > 0) {
      const d0 = burn * Math.min(hold, 0.8), d1 = burn * SMOULDER_AT;
      if (a >= d1) k *= Math.max(0.08, 0.12 - 0.04 * (a - d1) / Math.max(burn - d1, 1e-3));
      else if (a > d0) k *= 1 - 0.88 * ((a - d0) / Math.max(d1 - d0, 1e-3)) ** 0.85;
    }
    return k;
  };
}

/**
 * The fire recipes' sizes and burn times, shared by the VFX (render/fx.js, render/vfx/effects.js) and the sim.
 *  structure: a destroyed building / gun burns on its flattened footprint — the VFX's burning_wreck, size
 *    min(w|d, max)·k, its flames in the ellipse (kx, kz)·size; `skip`: types that do not burn.
 *  tank: a fuel tank's fire (fuel_tank_fire) `delay` s after its blast, its pool bed over (long, short)·footprint.
 *  bunker: concrete does not burn: a small fire in the doorway (fire_small, `scale`).
 *  barrel: a drum's burning spill (fuel_pool_fire, `delay` s after its blast; a chained drum's smaller); its flames
 *    inside box·R. rack: a rack of oil drums (M8's store) burns on as a bigger pool fire.
 *  residual: explosion_large's burning ground — the blast's own tongues for `cut` s, then a low fire over box·R·scale
 *    until `end` s.
 *  small: a campfire's flames (fire_small): diameter D·scale.
 */
export const FIRE = Object.freeze({
  structure: Object.freeze({ burn: 60, max: 9, k: 0.8, kx: 0.42, kz: 0.38, ramp: 1.5, hold: 0.65,
    skip: Object.freeze(['sandbags', 'fence', 'gate', 'wall', 'bridge', 'crater', 'sign', 'lamp_post', 'telegraph_pole']) }),
  tank: Object.freeze({ burn: 90, delay: 0.35, ramp: 0.9, hold: 0.6, long: 0.425, short: 0.4 }),
  bunker: Object.freeze({ burn: 30, scale: 1.1 }),
  barrel: Object.freeze({ r: 1.5, chainR: 1.1, burn: 10, delay: 0.15, ramp: 0.35, hold: 0.5, box: 0.95, chainDist: 8, chainWindow: 2.5 }),
  rack: Object.freeze({ r: 1.6, burn: 45, hold: 0.55, tall: 1.3, smokeK: 1.1 }),
  residual: Object.freeze({ cut: 2.5, end: 18, R: 2.5, box: 0.8, ramp: 0.5, hold: 0.1 }),
  small: Object.freeze({ D: 0.55, ramp: 0.6 }),
});

/** Keep-out margin round the flames (m): a body's reach plus the heat. */
export const FIRE_MARGIN = 0.75;
/** How far (m) an enemy looks for the edge of a fire his goal lies in, or for the way out of one he stands in. */
export const FIRE_EDGE_R = 12;
/** A burning wreck's keep-out round its hull (m): where its fire hurts (vehicle.js _updateWreck: wreckFireRadius − 1)
 *  and half a cell more, so that no walker on a cell outside it is inside that reach. */
const wreckMargin = () => Math.max(FIRE_MARGIN, CONFIG.vehicles.wreckFireRadius - 1 + 0.5);

/**
 * When a fire of this recipe counts, relative to its start (s): from its catch (burn level 0.5, ramp / 3) to its smoulder
 * (SMOULDER_AT · burn; Infinity for an unbounded fire). `delay`: the VFX starts the fire that long after the event.
 */
export function flameWindow(ramp, burn, delay = 0) {
  return { on: delay + ramp / 3, off: burn > 0 && burn < 1e5 ? delay + burn * SMOULDER_AT : Infinity };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const VEHICLE_ON = FIRE.structure.ramp / 3; // (a wreck's flames: the burning_wreck recipe's catch)

/**
 * The fires an `explosion` event starts (the VFX's choice for the same event, render/fx.js onExplosion /
 * _structureBlast), as specs {kind, shape, on, off} with times relative to the event. Pure.
 * @param {{x:number, z:number, radius?:number, kind:string, source?:any}} e
 * @param {{grid?:object, chained?:boolean, hullBlast?:boolean}} ctx  chained: another blast within FIRE.barrel.chainDist m
 *   and chainWindow s before it (a chained drum's smaller spill); hullBlast: a vehicle's own hull blast (drawn and
 *   burning as its wreck)
 * @returns {object[]}
 */
export function firesOfExplosion(e, ctx = {}) {
  const out = [], x = e.x, z = e.z, r = e.radius ?? 5, kind = e.kind, src = e.source, g = ctx.grid;
  if (x == null || z == null) return out;
  if (kind === 'vehicle' || kind === 'grenade' || kind === 'shell') return out; // (no sustained fire: wrecks burn as vehicles)
  // in open water a blast is a water column (fx.js: a charge on a wading-depth ledge still burns)
  if (g?.terrainAt) {
    const t = g.terrainAt(x, z), c = g.worldToCell(x, z), deck = g.inBounds(c.i, c.j) && g.bridge[g.idx(c.i, c.j)];
    if (!deck && (t === T.WATER || (t === T.SHALLOW && kind !== 'bomb' && kind !== 'structure'))) return out;
  }
  const residual = (cx, cz, scale) => {
    const R = FIRE.residual;
    out.push({ kind: 'ground', shape: { x: cx, z: cz, a: R.box * R.R * scale, b: R.box * R.R * scale, rot: 0, m: FIRE_MARGIN }, on: 0.25,
      off: flameWindow(R.ramp, R.end - R.cut, R.cut).off });
  };
  if (kind === 'barrel') {
    if (ctx.hullBlast) return out;
    const B0 = FIRE.barrel, pr = (ctx.chained ? B0.chainR : B0.r) * B0.box, w0 = flameWindow(B0.ramp, B0.burn, B0.delay);
    out.push({ kind: 'spill', shape: { x, z, a: pr, b: pr, rot: 0, m: FIRE_MARGIN }, on: w0.on, off: w0.off });
    const variant = src?.params?.variant ?? src?.params?.structure?.variant ?? src?.variant ?? '';
    if (/rack/.test(variant)) {
      const K = FIRE.rack, w1 = flameWindow(B0.ramp, K.burn);
      out.push({ kind: 'rack', shape: { x, z, a: K.r * B0.box, b: K.r * B0.box, rot: 0, m: FIRE_MARGIN }, on: w1.on, off: w1.off });
    }
    return out;
  }
  if (kind === 'bomb') { residual(x, z, clamp(r / 9, 0.7, 1.3)); return out; }
  if (kind !== 'structure') {
    if (r >= 9) residual(x, z, clamp(r / 14, 0.6, 1.6)); // (fx.js: an unknown class this big is drawn as explosion_large)
    return out;
  }
  const def = src?.structure || src?.params?.structure || src?.def || {};
  const type = def.type || src?.type || '';
  if (isFuelStructure({ ...def, type }) || def.explosive === 'fuel') {
    const k = fuelBlastScale(def), w = def.w ?? (def.r ?? 2) * 2, d = def.d ?? (def.r ?? 2) * 2, K = FIRE.tank, lw = w >= d;
    const win = flameWindow(K.ramp, K.burn, K.delay);
    residual(x, z, 1.15 * k.scale);
    out.push({ kind: 'tank', shape: { x, z, a: (lw ? K.long : K.short) * w, b: (lw ? K.short : K.long) * d, rot: def.rot ?? 0, m: FIRE_MARGIN }, on: win.on, off: win.off });
    return out;
  }
  if (src?.bunker || type === 'bunker' || type === 'casemate_gun') {
    const c = def.entry?.charge, door = def.entry?.path?.at(-1) ?? c ?? [x, z], K = FIRE.bunker, S = FIRE.small;
    const win = flameWindow(S.ramp, K.burn), rr = (S.D * K.scale) / 2;
    residual(c ? c[0] : x, c ? c[1] : z, clamp(r / 10, 0.7, 1.4));
    out.push({ kind: 'door', shape: { x: door[0], z: door[1], a: rr, b: rr, rot: 0, m: FIRE_MARGIN }, on: win.on, off: win.off });
    return out;
  }
  residual(x, z, clamp(r / 10, 0.7, 1.4));
  if (FIRE.structure.skip.includes(type)) return out;
  const S = FIRE.structure, sx = Math.min(def.w ?? r * 0.9, S.max) * S.k, sz = Math.min(def.d ?? r * 0.9, S.max) * S.k, win = flameWindow(S.ramp, S.burn);
  out.push({ kind: 'structure', shape: { x, z, a: sx * S.kx, b: sz * S.kz, rot: def.rot ?? 0, m: FIRE_MARGIN }, on: win.on, off: win.off });
  return out;
}

/** The fire of a mission `fx` entry (a campfire), or null. */
export function fireOfMissionFx(f) {
  if (!f || f.x == null || f.z == null || !/^(fire_small|campfire|fire)$/.test(f.kind || '')) return null;
  if (f.kind === 'fire' && f.r > 0.8) { const a = FIRE.barrel.box * f.r; return { kind: 'pool', shape: { x: f.x, z: f.z, a, b: a, rot: 0, m: FIRE_MARGIN }, on: 0, off: Infinity }; }
  const a = (FIRE.small.D * (f.scale ?? 1)) / 2;
  return { kind: 'camp', shape: { x: f.x, z: f.z, a, b: a, rot: 0, m: FIRE_MARGIN }, on: 0, off: Infinity };
}

/** Is world point (x, z) inside shape `s` (ellipse, or `rect` — a hull's oriented rectangle) grown by its margin? */
export function inShape(s, x, z) {
  const dx = x - s.x, dz = z - s.z, c = Math.cos(s.rot), sn = Math.sin(s.rot);
  const lx = dx * c + dz * sn, lz = -dx * sn + dz * c, A = s.a + s.m, Bz = s.b + s.m;
  if (s.rect) return Math.abs(lx) <= A && Math.abs(lz) <= Bz;
  return (lx / A) ** 2 + (lz / Bz) ** 2 <= 1;
}

/** The cells (indices) of a shape on the grid: those whose centre lies inside it. @returns {number[]} */
export function shapeCells(g, s) {
  const R = Math.hypot(s.a + s.m, s.b + s.m), c = g.cell, out = [];
  const i0 = Math.max(0, Math.floor((s.x - R) / c)), i1 = Math.min(g.cols - 1, Math.floor((s.x + R) / c));
  const j0 = Math.max(0, Math.floor((s.z - R) / c)), j1 = Math.min(g.rows - 1, Math.floor((s.z + R) / c));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (inShape(s, (i + 0.5) * c, (j + 0.5) * c)) out.push(j * g.cols + i);
  return out;
}

/** Is (x, z) on a burning cell? */
export function fireAt(g, x, z) {
  if (!g?.fireCells) return false;
  const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
  return i >= 0 && j >= 0 && i < g.cols && j < g.rows && g.fire[j * g.cols + i] > 0;
}

/**
 * freeCellNear's candidates round (x, z): the free cells (walkable under `swim`, not burning) within FIRE_EDGE_R, in its
 * scan order (rows, then columns), as [px, pz, d, ...] — kept for this grid version and fire version, FREE_NEAR_MAX
 * points: a squad sent to one spot inside a fire asks it once a man, each scoring the same cells from his own place (M14's
 * gun 4 spill: twenty men re-planning in one tick each scanned the same 49 x 49 cells). The same cells, the same numbers.
 */
const _freeNear = new WeakMap();
const FREE_NEAR_MAX = 8;
function freeCellsNear(g, x, z, swim) {
  let C = _freeNear.get(g);
  if (!C || C.v !== g.version || C.fv !== g.fireVersion || C.fire !== g.fire) _freeNear.set(g, (C = { v: g.version, fv: g.fireVersion, fire: g.fire, list: [] }));
  for (let n = C.list.length - 1; n >= 0; n--) { const e = C.list[n]; if (e.x === x && e.z === z && e.swim === swim) return e.cells; }
  const c = g.cell, R = FIRE_EDGE_R, ci = Math.floor(x / c), cj = Math.floor(z / c), n = Math.ceil(R / c), opts = { swim }, cells = [];
  for (let j = cj - n; j <= cj + n; j++) {
    for (let i = ci - n; i <= ci + n; i++) {
      if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) continue;
      const k = j * g.cols + i;
      if (g.fire[k] || !g.isWalkable(i, j, opts)) continue;
      const px = (i + 0.5) * c, pz = (j + 0.5) * c, d = Math.hypot(px - x, pz - z);
      if (d > R) continue;
      cells.push(px, pz, d);
    }
  }
  C.list.push({ x, z, swim, cells });
  if (C.list.length > FREE_NEAR_MAX) C.list.shift();
  return cells;
}

/** A free cell (walkable, not burning) for `pick`'s score, within FIRE_EDGE_R of (x, z); `line`: reached from (x, z) in
 *  a straight line over walkable cells (fire or not). @returns {{x:number, z:number}|null} */
function freeCellNear(g, x, z, swim, score, line = false) {
  const c = g.cell, opts = { swim: !!swim };
  const straight = (px, pz) => {
    const L = Math.hypot(px - x, pz - z), m = Math.max(1, Math.ceil(L / (c / 4)));
    for (let q = 1; q < m; q++) { const qx = x + ((px - x) * q) / m, qz = z + ((pz - z) * q) / m; if (!g.walkableAt(qx, qz, opts)) return false; }
    return true;
  };
  const cells = freeCellsNear(g, x, z, !!swim);
  let best = null, bs = Infinity;
  for (let q = 0; q < cells.length; q += 3) {
    const px = cells[q], pz = cells[q + 1], s = score(px, pz, cells[q + 2]);
    if (s < bs - 1e-9 && (!line || straight(px, pz))) { bs = s; best = { x: px, z: pz }; }
  }
  return best;
}

/** Goal (x, z) inside a fire, approached from (sx, sz): the free cell at its edge on his side (nearest the goal, then
 *  nearest him: d(goal) + d(start) / 4). @returns {{x:number, z:number}|null} */
export function fireEdge(g, x, z, sx, sz, swim = false) {
  return freeCellNear(g, x, z, swim, (px, pz, d) => d + 0.25 * Math.hypot(px - sx, pz - sz));
}

/** Standing at (x, z) inside a fire, bound for (tx, tz): the way out — the nearest free cell he walks to in a straight
 *  line, the one toward his goal among near-equals (d + d(goal) / 4). @returns {{x:number, z:number}|null} */
export function fireExit(g, x, z, tx, tz, swim = false) {
  return freeCellNear(g, x, z, swim, (px, pz, d) => d + 0.25 * Math.hypot(tx - px, tz - pz), true);
}

/**
 * Where a path first enters a burning cell, from (x0, z0) along its points from `from` on: {k, x, z, fx, fz, d} (the
 * waypoint index it enters on, the last point before the fire, the first one in it, the way there in metres), or null
 * when it never does. Sampled every quarter metre.
 */
export function firstFireOnPath(g, x0, z0, path, from = 0) {
  let ax = x0, az = z0, lx = x0, lz = z0, d = 0;
  for (let k = Math.max(0, from); k < path.length; k++) {
    const p = path[k], L = Math.hypot(p.x - ax, p.z - az), n = Math.max(1, Math.ceil(L / 0.25));
    for (let q = 1; q <= n; q++) {
      const x = ax + ((p.x - ax) * q) / n, z = az + ((p.z - az) * q) / n;
      if (fireAt(g, x, z)) return { k, x: lx, z: lz, fx: x, fz: z, d };
      lx = x; lz = z; d += L / n;
    }
    ax = p.x; az = p.z;
  }
  return null;
}

/** Can this man be steered out of / round a fire now (alive, out in the open, not carried, held, aboard, dug in...)? */
const MOVABLE = (e) => e.alive && !!e.world && !e.removed && e.state === 'active' && !e.vehicle && !e.carriedBy && !e.buried && !e.held && !e.hidden && (e.y || 0) < 1;
/** Everyone the fires turn: the player's men, then the enemies (one fixed order). */
function* men(w) { yield* w.commandos; yield* w.enemies; }

/**
 * The world's fires (world.fires): records, the grid's `fire` layer, and the enemies' reactions when one catches.
 */
export class FireField {
  /** @param {import('./world.js').World} world */
  constructor(world) {
    this.world = world;
    /** @type {{id:number, kind:string, shape:object, t0:number, on:number, off:number, vid?:number, stamped:boolean, cells:number[]|null}[]} */
    this.list = [];
    this.nextId = 1;
    /** Recent blasts {x, z, t} (a chained drum's smaller spill) and vehicle hull blasts {x, z, t} (drawn as the wreck). */
    this._blasts = [];
    this._hulls = [];
    world.listen('explosion', (e) => this._onExplosion(e));
    world.listen('vehicle:destroyed', (e) => this._onVehicle(e));
    world.listen('fire', (e) => this._onFireEvent(e));
  }

  /** Burning (stamped) right now? */
  get active() { return this.world.grid.fireCells > 0; }

  /** Register a fire spec {kind, shape, on, off} (times relative to now). @returns {object} its record */
  add(spec, extra = null) {
    const t = this.world.time;
    const f = { id: this.nextId++, kind: spec.kind, shape: { ...spec.shape }, t0: t, on: t + (spec.on ?? 0), off: t + (spec.off ?? Infinity), stamped: false, cells: null, ...(extra || null) };
    this.list.push(f);
    return f;
  }

  /** Mission `fx` campfires (map build: once). */
  addMissionFx(mission) {
    for (const f of mission?.fx || []) { const s = fireOfMissionFx(f); if (s) this.add(s); }
  }

  _onExplosion(e) {
    const w = this.world, t = w.time;
    if (e?.x == null || e?.z == null) return;
    const B0 = FIRE.barrel;
    this._blasts = this._blasts.filter((b) => t - b.t < B0.chainWindow);
    const chained = e.kind === 'barrel' && this._blasts.some((b) => t - b.t > 0.02 && Math.hypot(b.x - e.x, b.z - e.z) < B0.chainDist);
    this._blasts.push({ x: e.x, z: e.z, t });
    // (the tanker's own drum blast, set off with its hull: its spill is drawn and burns as the wreck — fx.js _suppress)
    this._hulls = this._hulls.filter((h) => t - h.t < 0.25);
    const hullBlast = e.kind === 'barrel' && !(e.source && e.source.interactKind === 'barrel') && this._hulls.some((h) => Math.hypot(h.x - e.x, h.z - e.z) < 2);
    for (const s of firesOfExplosion(e, { grid: w.grid, chained, hullBlast })) this.add(s);
  }

  _onVehicle(e) {
    const v = e?.vehicle, w = this.world;
    if (!v) return;
    this._hulls.push({ x: v.x, z: v.z, t: w.time });
    // (vehicle.js destroy: boats, rafts and emplacements do not burn; one in open water neither — fx.js)
    if (v.def?.raft || v.def?.kind === 'emplacement' || v.def?.kind === 'boat' || v.isBoat) return;
    const g = w.grid, c = g.worldToCell(v.x, v.z), k = g.inBounds(c.i, c.j) ? g.idx(c.i, c.j) : -1;
    if (k >= 0 && !g.bridge[k] && (g.terrain[k] === T.WATER || g.terrain[k] === T.SHALLOW)) return;
    const [len, wid] = v.def?.size || [4, 2];
    this.add({ kind: 'wreck', shape: { x: v.x, z: v.z, a: len / 2, b: wid / 2, rot: v.heading ?? 0, m: wreckMargin(), rect: true }, on: VEHICLE_ON, off: Infinity }, { vid: v.id });
  }

  /** A `fire` event with a radius (M17's spill): a circle until its `fire` off at the same spot. */
  _onFireEvent(e) {
    if (e?.x == null || e?.z == null) return;
    if (e.on === false) {
      for (const f of this.list) if (f.kind === 'event' && f.off === Infinity && Math.hypot(f.shape.x - e.x, f.shape.z - e.z) < 0.5) f.off = this.world.time;
      return;
    }
    if (!(e.r > 0)) return;
    this.add({ kind: 'event', shape: { x: e.x, z: e.z, a: e.r, b: e.r, rot: 0, m: FIRE_MARGIN }, on: 0, off: Infinity });
  }

  /** Has this fire been put out by the game (a wreck no longer burning)? */
  _out(f) {
    if (f.vid == null) return false;
    const v = this.world.byId(f.vid);
    return !v || v.removed || !v.burning;
  }

  _stamp(f, on) {
    const g = this.world.grid, F = g.fire;
    if (on) {
      f.cells = shapeCells(g, f.shape);
      for (const k of f.cells) if (F[k]++ === 0) g.fireCells++;
    } else {
      for (const k of f.cells || []) if (F[k] > 0 && --F[k] === 0) g.fireCells--;
      f.cells = null;
    }
    f.stamped = on;
  }

  /**
   * Start of a tick (World.refreshDynamicOccluders, before anyone moves): fires that have caught are stamped, those down
   * to a smoulder (or put out) wiped; then the enemies react to the new ones (react). Nothing at all without fires.
   */
  update() {
    if (!this.list.length) return;
    const w = this.world, t = w.time;
    let changed = false, caught = null, wiped = false;
    for (let n = 0; n < this.list.length; n++) {
      const f = this.list[n];
      const over = t >= f.off - 1e-9 || this._out(f);
      if (!f.stamped && !over && t >= f.on - 1e-9) { this._stamp(f, true); changed = true; (caught ||= []).push(f); } else if (f.stamped && over) { this._stamp(f, false); changed = wiped = true; }
    }
    // (spent fires leave the list: wiped ones, and ones that went out before they caught)
    for (let n = this.list.length - 1; n >= 0; n--) { const f = this.list[n]; if (!f.stamped && (t >= f.off - 1e-9 || this._out(f))) this.list.splice(n, 1); }
    if (changed) w.grid.fireVersion++;
    if (wiped) this.resume();
    if (caught) this.react(caught);
    else if (w.grid.fireCells && w.tick % 15 === 0) this.react(null); // (a man who got into the flames another way: out)
  }

  /**
   * A fire went out: the men still walking up to the edge of one that stood on their way to a goal go on to that goal
   * now it no longer burns — a cut path gets its rest back as it was (no new search), a plan made to a fire's edge is
   * made again to the goal itself. Those who got there already look from where they stand.
   */
  resume() {
    const g = this.world.grid;
    for (const e of men(this.world)) {
      const C = e._fireCut, F = e._fireGoal;
      if (C) {
        e._fireCut = null;
        const goal = C.goal, same = e.path === C.cutPath;
        if (!MOVABLE(e) || !e.path || e.moveTarget !== C.cut) continue; // (got there, or another order since)
        if (fireAt(g, goal.x, goal.z) || (same && firstFireOnPath(g, C.cut.x, C.cut.z, C.path, C.k))) { e._fireCut = C; continue; } // (still burning)
        // (his cut path as it was: its rest back; re-pathed to the cut since — a grid change — planned to the goal again)
        if (same) { e.path = C.path; e.moveTarget = C.path[C.path.length - 1]; } else e.moveTo(goal.x, goal.z, { run: e.moveMode === 'run', onArrive: e._onArrive });
      } else if (F) {
        if (!MOVABLE(e) || !e.path || e.moveTarget !== F.end) { e._fireGoal = null; continue; }
        if (fireAt(g, F.x, F.z)) continue;
        e.moveTo(F.x, F.z, { run: e.moveMode === 'run', onArrive: e._onArrive });
      }
    }
  }

  /**
   * The enemies and the fires that just caught (`caught`; null: a periodic check for men standing in any fire):
   *  - one standing in the flames steps out (the nearest free cell he walks to straight; his planner does the rest);
   *  - one walking a path into them: when his goal is in the fire he stops at its edge (his path cut where it would
   *    enter), else he plans again (round it).
   */
  react(caught) {
    const w = this.world, g = w.grid;
    // (the box round the fires that caught: a path that keeps out of it is not looked along)
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (const f of caught || []) { const R = Math.hypot(f.shape.a + f.shape.m, f.shape.b + f.shape.m); bx0 = Math.min(bx0, f.shape.x - R); bx1 = Math.max(bx1, f.shape.x + R); bz0 = Math.min(bz0, f.shape.z - R); bz1 = Math.max(bz1, f.shape.z + R); }
    for (const e of men(w)) {
      if (!MOVABLE(e) || e.knifeHold) continue;
      const tr = e.track || e, P = e.path, steer = !!(P && P.length === 1 && P[0].steer);
      if (fireAt(g, tr.x, tr.z)) {
        if (P && !steer && e.moveTarget && !e._climb && !e._ladder) { this._replan(e); continue; }
        const out = fireExit(g, tr.x, tr.z, tr.x, tr.z, e.canSwim);
        if (out) e.moveTo(out.x, out.z, { run: true });
        continue;
      }
      if (!caught || !P || steer || !e.moveTarget || e._climb || e._ladder) continue;
      let px0 = tr.x, pz0 = tr.z, px1 = tr.x, pz1 = tr.z;
      for (let k = Math.max(0, e.pathIndex); k < P.length; k++) { const q = P[k]; if (q.x < px0) px0 = q.x; else if (q.x > px1) px1 = q.x; if (q.z < pz0) pz0 = q.z; else if (q.z > pz1) pz1 = q.z; }
      if (px1 < bx0 || px0 > bx1 || pz1 < bz0 || pz0 > bz1) continue;
      const hit = firstFireOnPath(g, tr.x, tr.z, P, e.pathIndex);
      if (!hit) continue;
      // (a fire that will be out before he can get to it, even running — a drum's spill 100 m off — is no fire on his way)
      if (hit.d / Math.max(e.speed || 0, e.faction === 'player' ? CONFIG.units.run.greenberet : CONFIG.ai.chaseSpeed) > this.burnsUntil(hit.fx, hit.fz) - w.time + 1) continue;
      const goal = P[P.length - 1];
      if (fireAt(g, goal.x, goal.z)) {
        // (his goal is in the flames: he walks on to their edge and stops there — or, if they are out before he gets
        // there, on along the rest of his way: resume)
        const cut = { x: hit.x, z: hit.z };
        e.path = [...P.slice(0, hit.k), cut];
        if (e.pathIndex >= e.path.length) e.pathIndex = e.path.length - 1;
        e.moveTarget = cut;
        e._fireCut = { path: P, k: hit.k, cut, cutPath: e.path, goal: { x: goal.x, z: goal.z } };
      } else this._replan(e);
    }
  }

  /** Until when (world time) the fires stamped over (x, z) burn: the latest of their ends (Infinity: until put out). */
  burnsUntil(x, z) {
    let t = -Infinity;
    for (const f of this.list) if (f.stamped && inShape(f.shape, x, z)) t = Math.max(t, f.vid != null ? Infinity : f.off);
    return t === -Infinity ? this.world.time : t;
  }

  /** His path again to where he was going (Unit._followPath's own re-path on a grid change). */
  _replan(e) {
    const t = e.moveTarget, cb = e._onArrive, run = e.moveMode === 'run';
    if (!e.moveTo(t.x, t.z, { run, onArrive: cb })) e.stop();
  }

  serialize() {
    return { next: this.nextId, list: this.list.map((f) => ({ id: f.id, kind: f.kind, shape: { ...f.shape }, t0: f.t0, on: f.on, off: Number.isFinite(f.off) ? f.off : null, vid: f.vid ?? null, stamped: f.stamped })),
      blasts: this._blasts.map((b) => ({ ...b })), hulls: this._hulls.map((h) => ({ ...h })) };
  }

  /** Restore saved fires: the grid's fire layer is not saved — the stamped ones are stamped again. */
  deserialize(d) {
    const g = this.world.grid;
    for (const f of this.list) if (f.stamped) this._stamp(f, false);
    g.fire.fill(0); g.fireCells = 0;
    this.list = [];
    this.nextId = d?.next ?? 1;
    this._blasts = (d?.blasts || []).map((b) => ({ ...b }));
    this._hulls = (d?.hulls || []).map((h) => ({ ...h }));
    for (const s of d?.list || []) {
      const f = { id: s.id, kind: s.kind, shape: { ...s.shape }, t0: s.t0, on: s.on, off: s.off ?? Infinity, stamped: false, cells: null, ...(s.vid != null ? { vid: s.vid } : null) };
      this.list.push(f);
      if (s.stamped) this._stamp(f, true);
    }
    g.fireVersion++;
  }
}
