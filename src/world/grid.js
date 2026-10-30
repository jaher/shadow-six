/**
 * NavGrid — typed-array occupancy/terrain layers, line-of-sight and ray casts.
 * Pure module (no three.js). See docs/ARCHITECTURE.md § NavGrid.
 *
 * Cell (i, j) covers x ∈ [i·CELL, (i+1)·CELL), z ∈ [j·CELL, (j+1)·CELL).
 * @module world/grid
 */

import { pointInPolygon } from '../core/math.js';
import { due } from '../engine/slice.js';

/** nav stamp keys that are the walkers' clearances only (grid.visBlock): hulls test their own (hullBlocked) */
const WALKER_STAMP = /^(vis:|low:|headroom$)/;

/** Cell size in metres. */
export const CELL = 0.5;

/** Terrain codes (`grid.terrain`). */
export const T = Object.freeze({ GROUND: 0, ROAD: 1, SAND: 2, SNOW: 3, GRASS: 4, WATER: 5, SHALLOW: 6, MUD: 7 });
/** Terrain code → name (lower case), e.g. T_NAMES[T.WATER] === 'water'. */
export const T_NAMES = Object.freeze(['ground', 'road', 'sand', 'snow', 'grass', 'water', 'shallow', 'mud']);

/** Obstacle height classes (`grid.block`). */
export const B = Object.freeze({ NONE: 0, LOW: 1, HIGH: 2, FENCE: 3 });

/**
 * Resolve a terrain name or code to a code.
 * @param {string|number} t
 * @returns {number}
 */
export function terrainCode(t) {
  if (typeof t === 'number') return t;
  const i = T_NAMES.indexOf(String(t).toLowerCase());
  if (i < 0) throw new Error(`unknown terrain "${t}"`);
  return i;
}

/** Max height difference (m) between two adjacent cells that units can step across (§10.2 elev). */
export const MAX_STEP = 0.6;
/** A raised cell blocks sight when its elev exceeds both endpoint heights by more than this (m) (legacy lineOfSight). */
export const LOS_CLEAR = 1.0;
/**
 * Height sight (sightLine / sightRay, §4.2 "Occlusion by height"): the top of a B.LOW cell above its surface (m). Low
 * cover is low by class: a crawler's sight line passes under it near him, a standing man's never does.
 */
export const LOW_TOP = 1.0;
/**
 * Height sight: an open raised floor (a deck, a wall walk, a roof terrace, a plateau, a ramp) within this of the
 * viewer's or the target's own feet is that man's level, not an occluder between them — whether men on different levels
 * see each other is the §4.2 roof and deck-edge rules' call (perception.levelHides), as in BEL.
 */
export const LEVEL_TOL = 0.5;
/** Link kinds (§7.3 climbLinks / ladders). */
const EMPTY = Object.freeze([]);
/** Version bumps NavGrid keeps the touched rows of (dirtyRowsSince). */
const DIRTY_LOG = 64;
export const LINK = Object.freeze({ CLIMB: 'climb', LADDER: 'ladder' });

/**
 * @typedef {object} GridLink  off-grid pathfinding edge
 * @property {number} id
 * @property {'climb'|'ladder'} kind
 * @property {{x:number, z:number, y:number}} a  bottom (or either) end
 * @property {{x:number, z:number, y:number}} b  top (or other) end
 * @property {string[]|null} roles  unit roles allowed to use it (null = everyone, enemies included)
 * @property {boolean} enabled  false = unusable (e.g. a raised ladder)
 * @property {number} cost  extra path cost (m-equivalent) on top of the endpoint distance
 * @property {number} ka  cell index of a;  @property {number} kb  cell index of b
 */

/**
 * Sight over walls from high up (an MG gunner on an open platform, `overWalls`): a blocking cell whose structure is
 * lower than the sight line where it crosses that cell does not block. `ow` = {heightOf(k) → m | null, eyeY, targetTopY,
 * scale?} (scale: traverse parameter t per unit of the eye → target line, castRay overshoots its end). Cells with no
 * known height keep blocking. @returns {((k: number, t: number) => boolean)|null}
 */
export function overWallsTest(ow) {
  if (!ow || typeof ow.heightOf !== 'function') return null;
  const s = ow.scale ?? 1, y0 = ow.eyeY, y1 = ow.targetTopY ?? 1.5;
  return (k, t) => {
    const h = ow.heightOf(k);
    return h != null && h < y0 + (y1 - y0) * Math.min(1, t * s);
  };
}

/**
 * Steepest sight slope (height over distance) a cell blocks: a top `rise` m above the eye over the stretch [d0, d1] of
 * the line hides every target whose sight slope is below it (highest at the near edge for a top above the eye, at the
 * far edge for one below it). Shared by sightLine and sightRay so the drawn cone and detection agree.
 */
/** sightRay's march state (it never re-enters): the steepest obstacle slope per target kind (0 standing, 1 low), the
 *  open floors crossed per kind (their surface heights FE and slopes FM, FN of them), per-height flags. */
const SR = { M: new Float64Array(2), FE: [new Float64Array(64), new Float64Array(64)], FM: [new Float64Array(64), new Float64Array(64)], FN: new Int32Array(2), low: new Uint8Array(8), hid: new Uint8Array(8) };
/** _traverse's current cell entry / exit (parametric), for its visitor. */
const TV = new Float64Array(2);

export function sightSlope(rise, d0, d1) {
  return rise > 0 ? rise / Math.max(d0, 1e-6) : rise / Math.max(d1, 1e-6);
}

export class NavGrid {
  /**
   * @param {number} width  map width W (m, along X)
   * @param {number} depth  map depth D (m, along Z)
   * @param {number} [cell=CELL]
   */
  constructor(width, depth, cell = CELL) {
    this.width = width;
    this.depth = depth;
    this.cell = cell;
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(depth / cell);
    const n = this.cols * this.rows;
    this.size = n;
    /** @type {Uint8Array} terrain code per cell (T.*) */
    this.terrain = new Uint8Array(n);
    /** @type {Uint8Array} obstacle class per cell (B.*) */
    this.block = new Uint8Array(n);
    /** @type {Uint8Array} 1 = walkable deck over water */
    this.bridge = new Uint8Array(n);
    /** @type {Int32Array} id of the structure occupying the cell (0 = none) */
    this.owner = new Int32Array(n);
    /**
     * 1 = open water under a deck or its girders (set-piece `deck_underpass`, M16/M18): a diver (opts.dive)
     * passes these cells whatever their block/bridge state; everyone else sees the deck and its girders.
     * Static (rebuilt with the map), not saved.
     * @type {Uint8Array}
     */
    this.underpass = new Uint8Array(n);
    /**
     * ≠ 0 = a hole cut through a wire fence (Sapper's cutters, abilities/sapper.js): an opening a man walks through
     * upright — open ground (block B.NONE) for everyone on foot, standing, crouched or crawling; the fence's visual nav
     * stamp (navBlock) does not close it. The value (1 / 2) is the side its cut flaps were folded back to
     * (abilities/sapper.js normalSign); the wire layer draws the hole from these cells. Saved.
     * @type {Uint8Array}
     */
    this.fenceHole = new Uint8Array(n);
    /** Number of fenceHole cells (0: nothing to look for). */
    this.fenceHoleCount = 0;
    /**
     * Dynamic occluders (§4.2 OCLU, §10.2): B.* per cell, CLEARED AND RE-STAMPED EVERY SIM STEP by the
     * vehicles/trains system (clearDynamic() + stampDynamic()). Blocks sight (lineOfSight/castRay, unless
     * opts.dynamic === false); blocks movement only when isWalkable() gets opts.dynamic = true.
     * `dynamicVersion` changes only when what is stamped changes (a parked truck re-stamped on the same cells every
     * step leaves it alone), never `version` (so static caches survive).
     * @type {Uint8Array}
     */
    this.dynamicBlock = new Uint8Array(n);
    this._dynVer = 0;
    this._dynSig = 0; // order-free signature of this step's stamps (stampDynamic)
    this._dynSigSeen = 0;
    this._dynamicDirty = false;
    /**
     * Surface height per cell (m) for roofs, wall tops, towers, platforms (§10.2, roof rule §4.2).
     * 0 = ground. A cell with elev > 0 and block B.NONE is a walkable raised surface; neighbours whose
     * elev differs by more than MAX_STEP are not connected (raised areas are reached via links only).
     * For LOS a cell whose elev is higher than both endpoints' heights + LOS_CLEAR blocks like B.HIGH.
     * @type {Float32Array}
     */
    this.elev = new Float32Array(n);
    /**
     * 1 = this raised cell is natural ground (the walkways of a `cliff` plateau / terrace or a `road` ramp, written by
     * map-builder applyElevation), so its terrain code still says what it is underfoot (snow, sand, grass...);
     * 0 = a built floor (roof, deck, wall walk, tower). Read by ai/running-noise stepSurface. Static, not saved.
     * @type {Uint8Array}
     */
    this.naturalElev = new Uint8Array(n);
    /**
     * Grid owner ids of the structures that RAISE a level (walkways, decks, ramps, raised footprints, tower decks) and of
     * every cliff / road (map-builder applyElevation): their own blocked cells measure their height from the ground (a
     * cliff's h is the plateau's), so blockBase never lifts them. Static, not saved.
     * @type {Set<number>}
     */
    this.levelOwners = new Set();
    /**
     * Nav-only blocks (placement rule e, world/placement.js): cells where a structure's VISUAL stands outside its
     * gameplay footprint (steps, porches' posts, woodpiles, splayed tower legs) or where an idle movable prop
     * (pushable wagon) sits. Counted per stamp key; blocks walking (isWalkable), never sight or cover.
     * @type {Uint8Array}
     */
    this.navBlock = new Uint8Array(n);
    this._navStamps = new Map();
    /**
     * Of navBlock, the count of the walkers' own stamps (WALKER_STAMP): a structure's visual stamp (`vis:`, map-builder
     * stampVisualNav: what is drawn at body height with the walkers' body clearance round it, RULES.bodyNav), the
     * clearance round its low parts (`low:`: a step's face, a plinth, a kerb — their tops are walked on), the head room
     * under its overhangs (`headroom`). A hull keeps its own clearances (its outline, its height under an overhang:
     * grid.overLo, a step up: grid.elev): it tests only what is drawn there, without the walkers' ring — the `hull:`
     * stamps in hullBlock (hullBlocked). @type {Uint8Array}
     */
    this.visBlock = new Uint8Array(n);
    /** @type {Uint8Array} */
    this.hullBlock = new Uint8Array(n);
    this._hullStamps = new Map();
    /**
     * A mission's opt-in (`hullDrawn`, map-builder): its hulls test hullBlocked, not every nav stamp. Elsewhere vehicles
     * keep the walkers' clearance as their own (their routes were laid and tuned on it: M6's armoured car took another
     * way past the farm with it off and found the Green Beret). @type {boolean}
     */
    this.hullDrawn = false;
    /**
     * A mission's opt-in (`deckWays`, map-builder): its decks over water are walkers' ways that keepWays reopens like dry
     * ground, and its measured decks' railings (`deck:` stamps) give way at a cut too (M4: the pier stair's flights and
     * the pier deck meet inside each other's railings). Elsewhere the stamps stay as they were tuned. @type {boolean}
     */
    this.deckWays = false;
    /**
     * Mission `noWalk` areas (map-builder stampNoWalk; M3: the foot of the dam's face): 1 = nobody may be there, not
     * even a body coming to rest (it is moved out, physics/feedback.js). Their cells are navBlock stamps too. null = none.
     * @type {Uint8Array|null}
     */
    this.noWalk = null;
    /**
     * Overhead visuals (placement rules d/e): per open cell the lowest / highest point of structure visuals above
     * body height (eaves, porch roofs, a tower's cabin). Walkers pass under; vehicles taller than `overLo` and gun
     * barrels at its height do not. Allocated on the first overStamp (null = nothing overhead anywhere).
     * @type {Float32Array|null}
     */
    this.overLo = null;
    /** @type {Float32Array|null} */
    this.overHi = null;
    /** Same for tree branches (soft: gun arcs only). @type {Float32Array|null} */
    this.softLo = null;
    /** @type {Float32Array|null} */
    this.softHi = null;
    this._overStamps = new Map();
    /**
     * Standing visuals at quarter-cell resolution (placement rule e, bodies): what rises 0.15–1.2 m above the local
     * walking surface (stakes along a wall walk, railings, crates). Counted per stamp key; bodies never lie across
     * it (fallHeading / settleBody), walking is not affected. null until the first solidStamp.
     * @type {Uint8Array|null}
     */
    this.solid = null;
    this._solidStamps = new Map();
    /** Measured visual top (world y) of structure footprint cells (0 = unknown; gun arcs, placement rule d). @type {Float32Array|null} */
    this.blockTop = null;
    /**
     * Off-grid links fed to the pathfinder (§10.2): climb edges (GB only by default) and ladders
     * (everyone). See addLink(). `_linkIndex` maps a cell index → links touching it.
     * @type {GridLink[]}
     */
    this.links = [];
    this._linkIndex = new Map();
    this._nextLinkId = 1;
    /** Bumped on every write so caches (cone meshes, path caches) can invalidate. */
    this.version = 0;
    // (set later — ramps and stair runs as the map adds them, the body-top cache, walkableLine's per-grid visitor and
    // its last call's options — declared here so the grid keeps one hidden-class shape: a field first added in play
    // threw away the optimised code of everything that reads the grid)
    this.ramps = undefined; this.runs = undefined; this.runOf = undefined;
    this._bb = undefined; this._bbOn = undefined; this._bbVer = undefined;
    this._wlHasRef = false; this._wlRef = NaN; this._wlOpts = null; this._wlBlocked = null; // (NaN: a double field)
  }

  /** Layer lookup by name. */
  layer(name) {
    const l = this[name];
    if (!(l instanceof Uint8Array || l instanceof Int32Array || l instanceof Float32Array)) throw new Error(`unknown grid layer "${name}"`);
    return l;
  }

  // ---------------------------------------------------------------- coordinates

  /** @returns {{i:number, j:number}} cell containing world point (x, z) (may be out of bounds). */
  worldToCell(x, z) {
    return { i: Math.floor(x / this.cell), j: Math.floor(z / this.cell) };
  }

  /** @returns {{x:number, z:number}} world centre of cell (i, j). */
  cellCenter(i, j) {
    return { x: (i + 0.5) * this.cell, z: (j + 0.5) * this.cell };
  }

  inBounds(i, j) {
    return i >= 0 && j >= 0 && i < this.cols && j < this.rows;
  }

  /** Flat index of cell (i, j). Caller guarantees bounds. */
  idx(i, j) {
    return j * this.cols + i;
  }

  // ---------------------------------------------------------------- queries

  /** Deep water (swimmers only), bridges excluded. */
  isWater(i, j) {
    if (!this.inBounds(i, j)) return false;
    const k = this.idx(i, j);
    return this.terrain[k] === T.WATER && !this.bridge[k];
  }

  /**
   * @param {number} i
   * @param {number} j
   * @param {{swim?: boolean, dynamic?: boolean, dive?: boolean, avoid?: Uint8Array}} [opts] swim: deep water is walkable (the diver);
   *   dynamic: also treat dynamicBlock (vehicles/trains this step) as blocking; dive: a submerged diver keeps to
   *   open water (WATER/SHALLOW, no deck, no obstacle) plus the `underpass` cells under a deck and its girders;
   *   avoid: Uint8Array mask (1 = keep out), e.g. body-clearance.avoidMask around vehicle hulls
   */
  isWalkable(i, j, opts) {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return false;
    const k = j * this.cols + i;
    if (opts && opts.dive) {
      if (this.underpass[k]) return true;
      const t = this.terrain[k];
      if ((t !== T.WATER && t !== T.SHALLOW) || this.bridge[k] || this.block[k] !== B.NONE || this.navBlock[k]) return false;
      return !(opts.dynamic && this.dynamicBlock[k] !== B.NONE);
    }
    if (this.block[k] !== B.NONE || (this.navBlock[k] && !this.fenceHole[k])) return false; // (a cut fence hole: open)
    if (opts && opts.dynamic && this.dynamicBlock[k] !== B.NONE) return false;
    if (opts && opts.avoid && opts.avoid[k]) return false; // body clearance around vehicle hulls (world/body-clearance.js)
    if (this.bridge[k]) return true;
    if (this.terrain[k] === T.WATER) return !!(opts && opts.swim);
    return true;
  }

  /** Is (x, z) an `underpass` cell (open water under a deck, divers only)? */
  underpassAt(x, z) {
    const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    return this.inBounds(i, j) && this.underpass[this.idx(i, j)] === 1;
  }

  /**
   * Make cell k part of a hole cut through a fence: open ground for anyone on foot (block → B.NONE; its visual nav
   * stamp no longer counts). `side` (1 / 2): where its flaps were folded back. The caller bumps `version` once done.
   */
  setFenceHole(k, side = 1) {
    if (k < 0 || k >= this.size) return;
    this.block[k] = B.NONE;
    if (!this.fenceHole[k]) this.fenceHoleCount++;
    this.fenceHole[k] = side === 2 ? 2 : 1;
  }

  /** Is (x, z) a `fenceHole` cell (a hole cut through a fence)? */
  fenceHoleAt(x, z) {
    const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    return this.inBounds(i, j) && this.fenceHole[this.idx(i, j)] !== 0;
  }

  /** isWalkable() at a world point. */
  walkableAt(x, z, opts) {
    return this.isWalkable(Math.floor(x / this.cell), Math.floor(z / this.cell), opts);
  }

  /** Block class at a world point (B.HIGH outside the map). */
  blockAt(x, z) {
    const i = Math.floor(x / this.cell);
    const j = Math.floor(z / this.cell);
    return this.inBounds(i, j) ? this.block[this.idx(i, j)] : B.HIGH;
  }

  /** Terrain code at a world point (T.GROUND outside). */
  terrainAt(x, z) {
    const i = Math.floor(x / this.cell);
    const j = Math.floor(z / this.cell);
    return this.inBounds(i, j) ? this.terrain[this.idx(i, j)] : T.GROUND;
  }

  /**
   * Highest obstacle class among the 8 neighbours of the cell at (x, z) — a cheap "cover" query.
   * @returns {number} B.*
   */
  coverAt(x, z) {
    const { i, j } = this.worldToCell(x, z);
    let best = B.NONE;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        if (!this.inBounds(i + di, j + dj)) continue;
        const b = this.block[this.idx(i + di, j + dj)];
        if (b === B.HIGH) return B.HIGH;
        if (b === B.LOW) best = B.LOW;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- writers

  _write(k, layer, value, owner) {
    layer[k] = value;
    if (owner !== undefined && owner !== null) this.owner[k] = owner;
  }

  /**
   * version++ for a change confined to cell rows j0..j1 (an empty range: nothing a cell layer holds). The last
   * DIRTY_LOG such bumps are kept while nothing else bumps the version in between (a writer's own `version++`
   * starts the log afresh): dirtyRowsSince tells a per-version cache (pathfinding's staticLayers) which rows to redo.
   */
  _bumpRows(j0, j1) {
    let log = this._dirtyLog;
    if (!log || (log.length && log[log.length - 1].v !== this.version)) log = this._dirtyLog = [];
    log.push({ v: this.version + 1, j0, j1 });
    if (log.length > DIRTY_LOG) log.shift();
    this.version++;
  }

  /** The rows {j0, j1} every version bump after `version` up to now touched, or null when not known (redo everything). */
  dirtyRowsSince(version) {
    const log = this._dirtyLog;
    if (!log || !log.length || version >= this.version || log[log.length - 1].v !== this.version || log[0].v > version + 1) return null;
    let j0 = Infinity, j1 = -Infinity;
    for (let n = log.length - 1; n >= 0 && log[n].v > version; n--) { if (log[n].j0 < j0) j0 = log[n].j0; if (log[n].j1 > j1) j1 = log[n].j1; }
    return { j0, j1 };
  }

  /** Rows j0..j1 spanned by cell indices `cells` (an iterable). */
  _rowsOf(cells, out = { j0: Infinity, j1: -Infinity }) {
    const cols = this.cols;
    for (const k of cells) { const j = (k / cols) | 0; if (j < out.j0) out.j0 = j; if (j > out.j1) out.j1 = j; }
    return out;
  }

  /**
   * Fill an axis-aligned rectangle given by its min corner (x, z) and size (w, d).
   * A cell is filled when its centre lies inside the rectangle.
   * @param {string} layerName 'terrain' | 'block' | 'bridge' | 'owner'
   */
  fillRect(x, z, w, d, layerName, value, owner) {
    const layer = this.layer(layerName);
    const c = this.cell;
    const i0 = Math.max(0, Math.round(x / c));
    const j0 = Math.max(0, Math.round(z / c));
    const i1 = Math.min(this.cols, Math.round((x + w) / c));
    const j1 = Math.min(this.rows, Math.round((z + d) / c));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) this._write(j * this.cols + i, layer, value, owner);
    this.version++;
  }

  /**
   * Fill a polygon (cells whose centre is inside). points: [[x,z],...] or [{x,z},...].
   */
  fillPoly(points, layerName, value, owner) {
    const layer = this.layer(layerName);
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of points) {
      const [px, pz] = Array.isArray(p) ? p : [p.x, p.z];
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
    }
    const c = this.cell;
    const i0 = Math.max(0, Math.floor(minX / c)), i1 = Math.min(this.cols - 1, Math.floor(maxX / c));
    const j0 = Math.max(0, Math.floor(minZ / c)), j1 = Math.min(this.rows - 1, Math.floor(maxZ / c));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (pointInPolygon((i + 0.5) * c, (j + 0.5) * c, points)) this._write(j * this.cols + i, layer, value, owner);
      }
    }
    this._bumpRows(j0, j1);
  }

  /**
   * Fill a rectangle of size (w along the heading, d across it) centred at (cx, cz), rotated by
   * `rotHeading` (radians, 0 = long side along +X).
   */
  fillOrientedRect(cx, cz, w, d, rotHeading, layerName, value, owner) {
    const layer = this.layer(layerName);
    const cos = Math.cos(rotHeading), sin = Math.sin(rotHeading);
    const hw = w / 2, hd = d / 2;
    const ext = Math.abs(hw * cos) + Math.abs(hd * sin);
    const extZ = Math.abs(hw * sin) + Math.abs(hd * cos);
    const c = this.cell;
    const i0 = Math.max(0, Math.floor((cx - ext) / c)), i1 = Math.min(this.cols - 1, Math.floor((cx + ext) / c));
    const j0 = Math.max(0, Math.floor((cz - extZ) / c)), j1 = Math.min(this.rows - 1, Math.floor((cz + extZ) / c));
    const eps = 1e-6;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * c - cx, pz = (j + 0.5) * c - cz;
        const u = px * cos + pz * sin; // along heading
        const v = -px * sin + pz * cos; // across
        if (Math.abs(u) <= hw + eps && Math.abs(v) <= hd + eps) this._write(j * this.cols + i, layer, value, owner);
      }
    }
    this.version++;
  }

  /** Fill a disc of radius r centred at (cx, cz). Always marks at least the centre cell. */
  fillCircle(cx, cz, r, layerName, value, owner) {
    const layer = this.layer(layerName);
    const c = this.cell;
    const i0 = Math.max(0, Math.floor((cx - r) / c)), i1 = Math.min(this.cols - 1, Math.floor((cx + r) / c));
    const j0 = Math.max(0, Math.floor((cz - r) / c)), j1 = Math.min(this.rows - 1, Math.floor((cz + r) / c));
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * c - cx, dz = (j + 0.5) * c - cz;
        if (dx * dx + dz * dz <= r2) this._write(j * this.cols + i, layer, value, owner);
      }
    }
    const { i, j } = this.worldToCell(cx, cz);
    if (this.inBounds(i, j)) this._write(this.idx(i, j), layer, value, owner);
    this.version++;
  }

  /**
   * Fill a polyline of the given width (walls, fences, roads, rivers): one oriented rect per segment
   * plus round joints. `width` may be an array (one width per point): each segment is then a tapered
   * quad between its end widths (natural river banks, M2).
   * @param {Array<[number,number]|{x:number,z:number}>} points
   * @param {number|number[]} width
   */
  /** fillPoly() as a sliced job (engine/slice.js): the same cells, pausing between rows. */
  *fillPolyG(points, layerName, value, owner) {
    const layer = this.layer(layerName);
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of points) {
      const [px, pz] = Array.isArray(p) ? p : [p.x, p.z];
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
    }
    const c = this.cell;
    const i0 = Math.max(0, Math.floor(minX / c)), i1 = Math.min(this.cols - 1, Math.floor(maxX / c));
    const j0 = Math.max(0, Math.floor(minZ / c)), j1 = Math.min(this.rows - 1, Math.floor(maxZ / c));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (pointInPolygon((i + 0.5) * c, (j + 0.5) * c, points)) this._write(j * this.cols + i, layer, value, owner);
      }
      if (due()) yield;
    }
    this.version++;
  }

  /** fillLine() as a sliced job (engine/slice.js): the same cells in the same order, pausing between pieces. */
  *fillLineG(points, width, layerName, value, owner) {
    const pts = points.map((p) => (Array.isArray(p) ? p : [p.x, p.z]));
    const wAt = (k) => (Array.isArray(width) ? (width[k] ?? width[width.length - 1]) : width);
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const wa = wAt(k), wb = wAt(k + 1);
      if (wa === wb) { this.fillOrientedRect((ax + bx) / 2, (az + bz) / 2, len, wa, Math.atan2(bz - az, bx - ax), layerName, value, owner); if (due()) yield; continue; }
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      yield* this.fillPolyG([[ax + nx * wa / 2, az + nz * wa / 2], [bx + nx * wb / 2, bz + nz * wb / 2],
        [bx - nx * wb / 2, bz - nz * wb / 2], [ax - nx * wa / 2, az - nz * wa / 2]], layerName, value, owner);
    }
    for (let k = 1; k + 1 < pts.length; k++) { this.fillCircle(pts[k][0], pts[k][1], wAt(k) / 2, layerName, value, owner); if (due()) yield; }
  }

  fillLine(points, width, layerName, value, owner) {
    const pts = points.map((p) => (Array.isArray(p) ? p : [p.x, p.z]));
    const wAt = (k) => (Array.isArray(width) ? (width[k] ?? width[width.length - 1]) : width);
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const wa = wAt(k), wb = wAt(k + 1);
      if (wa === wb) { this.fillOrientedRect((ax + bx) / 2, (az + bz) / 2, len, wa, Math.atan2(bz - az, bx - ax), layerName, value, owner); continue; }
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      this.fillPoly([[ax + nx * wa / 2, az + nz * wa / 2], [bx + nx * wb / 2, bz + nz * wb / 2],
        [bx - nx * wb / 2, bz - nz * wb / 2], [ax - nx * wa / 2, az - nz * wa / 2]], layerName, value, owner);
    }
    for (let k = 1; k + 1 < pts.length; k++) this.fillCircle(pts[k][0], pts[k][1], wAt(k) / 2, layerName, value, owner);
  }

  /**
   * Reset every cell owned by `owner`: block → NONE, bridge → 0, owner → 0 (terrain untouched).
   * Used by destructibles and opened gates/cut fences.
   * @returns {number} number of cells cleared
   */
  clearOwner(owner) {
    let n = 0, k0 = -1, k1 = -1;
    // (TypedArray indexOf jumps from one of the owner's cells to the next: a structure's destroy runs this once, in its
    // blast's tick, where a cell-by-cell loop never optimised cost ~0.8 ms on M18's 120 000 cells; the same cells)
    const O = this.owner;
    for (let k = O.indexOf(owner); k >= 0 && k < this.size; k = O.indexOf(owner, k + 1)) {
      this.block[k] = B.NONE;
      this.bridge[k] = 0;
      O[k] = 0;
      if (k0 < 0) k0 = k;
      k1 = k;
      n++;
    }
    if (n) this._bumpRows((k0 / this.cols) | 0, (k1 / this.cols) | 0);
    return n;
  }

  // ---------------------------------------------------------------- elevation (§10.2)

  /** Surface height (m) at a world point (0 outside the map). */
  elevAt(x, z) {
    const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    return this.inBounds(i, j) ? this.elev[this.idx(i, j)] : 0;
  }

  /**
   * A stair / ramp whose graded `elev` cells step down a cell at a time: the unit on it takes the sloped height along
   * its run instead (no 0.3-0.5 m snaps per cell). r: {ax, az (top), bx, bz (foot), w (width), ya, yb (heights)}.
   */
  addRamp(r) {
    // (`viewOnly`: a terrain road ramp's slab, for a lying man's pose alone — surfaceY / nearRamp leave it out)
    const dx = r.bx - r.ax, dz = r.bz - r.az, len = Math.hypot(dx, dz);
    if (!(len > 0.1)) return;
    (this.ramps ||= []).push({ ...r, ux: dx / len, uz: dz / len, len });
  }

  /**
   * Height of ramp r's walking line at arc length t from its top (a) toward its foot (b), clamped to its ends: its
   * measured `prof` ([[t, y], …], t increasing: the M3 barn ramp, a flat lip at its foot, a slope, the plank deck at
   * its head) or the straight line from ya to yb.
   */
  static rampLineY(r, t) {
    const P = r.prof;
    if (!P) return r.ya + (r.yb - r.ya) * Math.min(1, Math.max(0, t / r.len));
    if (t <= P[0][0]) return P[0][1];
    for (let k = 1; k < P.length; k++) if (t <= P[k][0]) return P[k - 1][1] + ((P[k][1] - P[k - 1][1]) * (t - P[k - 1][0])) / (P[k][0] - P[k - 1][0] || 1);
    return P[P.length - 1][1];
  }

  /**
   * The walking line of the ramp (grid.ramps) under (x, z): within `m` m of its width, between `m` m before its foot and
   * after its top (clamped to their heights there), or null. For a man lying on it (art/stair-gait.js rampGround):
   * the slope his body pitches to, not the cells' steps nor the flat ground beside it.
   */
  rampY(x, z, m = 0.6) {
    if (this.ramps) for (const r of this.ramps) {
      const px = x - r.ax, pz = z - r.az, t = px * r.ux + pz * r.uz;
      if (t < -m || t > r.len + m || Math.abs(px * r.uz - pz * r.ux) > r.w / 2 + m) continue;
      return NavGrid.rampLineY(r, t);
    }
    return null;
  }

  /**
   * A ramp / stair RUN (user 2026-10-08, watching the M3 solution film: "In the video the rapper crosses the slide when
   * crawling, fix to make it work properly": the Sapper got onto the barn's ramp from beside its foot and crawled up it
   * on the slant, his body across its stone curbs). A man gets on to a run only at its foot or its head, head-on,
   * never across its sides (curbs, railings, stringers, the faces of a road cut):
   *  - canStep: a step between a cell of the run and one off it must cross one of its ends, from straight in front of it;
   *  - walkableLine (path smoothing): a line never crosses its sides;
   *  - `lane` (m, < w): the walkable width between its curbs, centred; the band's cells outside it are nav-blocked;
   *  - `align`: paths on it keep to its axis, centred between its sides, and come on and off it head-on, lined up from
   *    APPROACH m out (pathfinding alignRuns): a crawler's body lies along it, clear of the curbs.
   * r: {id?, pts: [[x, z], …] (foot → head), w: width (m), lane?, align?}. Cells whose centre lies on its band are
   * marked in `runOf` (index + 1). The M3 barn ramp and dam stairs (structures' `ramps`) and the access platform
   * stairs. @returns {object|null} the run
   */
  addRun(r) {
    const P = (r.pts || []).map((q) => (Array.isArray(q) ? [q[0], q[1]] : [q.x, q.z]));
    const segs = [];
    let L = 0;
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[i + 1], l = Math.hypot(bx - ax, bz - az);
      if (l > 1e-6) { segs.push({ ax, az, ux: (bx - ax) / l, uz: (bz - az) / l, l, s0: L }); L += l; }
    }
    if (!(L > 0.3) || !(r.w > 0)) return null;
    const hw = r.w / 2, lane = Math.min(r.w, r.lane ?? r.w);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of P) { x0 = Math.min(x0, x - hw); z0 = Math.min(z0, z - hw); x1 = Math.max(x1, x + hw); z1 = Math.max(z1, z + hw); }
    const run = { id: r.id ?? `run${(this.runs || []).length}`, pts: P, w: r.w, lane, align: !!r.align, segs, L, box: [x0, z0, x1, z1] };
    (this.runs ||= []).push(run);
    this.runOf ||= new Uint16Array(this.cols * this.rows);
    const n = this.runs.length, c = this.cell, curb = [];
    const i0 = Math.max(0, Math.floor(x0 / c)), i1 = Math.min(this.cols - 1, Math.floor(x1 / c));
    const j0 = Math.max(0, Math.floor(z0 / c)), j1 = Math.min(this.rows - 1, Math.floor(z1 / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const q = this.runLocal(run, (i + 0.5) * c, (j + 0.5) * c);
      if (q.s < 0 || q.s > L || Math.abs(q.v) > hw) continue;
      const k = j * this.cols + i;
      this.runOf[k] = n;
      if (Math.abs(q.v) > lane / 2) curb.push(k);
    }
    if (curb.length) this.navStamp(`run-curb:${run.id}`, curb);
    this.version++;
    return run;
  }

  /**
   * (s, v) of (x, z) in run R's frame: s the arc length from its foot (negative before it, past L beyond its head), v
   * the signed distance to the left of its axis (nearest leg).
   */
  runLocal(R, x, z) {
    let best = null;
    const last = R.segs.length - 1;
    for (let n = 0; n <= last; n++) {
      const g = R.segs[n], dx = x - g.ax, dz = z - g.az, t = dx * g.ux + dz * g.uz, v = -dx * g.uz + dz * g.ux;
      const tc = t < 0 ? 0 : t > g.l ? g.l : t, d = Math.hypot(dx - g.ux * tc, dz - g.uz * tc);
      if (best && d >= best.d) continue;
      best = { d, s: g.s0 + ((n === 0 && t < 0) || (n === last && t > g.l) ? t : tc), v };
    }
    return best;
  }

  /** World (x, z) at run coordinates (s, v) (s < 0 / > L: on its axis carried on past its foot / head). */
  runPoint(R, s, v = 0) {
    const n = s <= 0 ? 0 : s >= R.L ? R.segs.length - 1 : R.segs.findIndex((g) => s <= g.s0 + g.l);
    const g = R.segs[Math.max(0, n)], t = s - g.s0;
    return { x: g.ax + g.ux * t - g.uz * v, z: g.az + g.uz * t + g.ux * v };
  }

  /** The run whose band (x, z) is on (between its ends, within its width + `m`), or null. */
  runAt(x, z, m = 0) {
    if (this.runs) for (const R of this.runs) {
      if (x < R.box[0] - m || x > R.box[2] + m || z < R.box[1] - m || z > R.box[3] + m) continue;
      const q = this.runLocal(R, x, z);
      if (q.s >= 0 && q.s <= R.L && Math.abs(q.v) <= R.w / 2 + m) return R;
    }
    return null;
  }

  /** Does cell k (off run #ri) lie past one of that run's ends, straight in front of it (within its width + half a cell)? */
  _pastRunEnd(ri, k) {
    const R = this.runs[ri], c = this.cell, i = k % this.cols, q = this.runLocal(R, (i + 0.5) * c, ((k - i) / this.cols + 0.5) * c);
    return (q.s < 0 || q.s > R.L) && Math.abs(q.v) <= R.w / 2 + c / 2;
  }

  /**
   * Does the line a → b cross the side of a run (its band's long edges, between its ends)? A line coming on at its
   * foot or head crosses an end, not a side.
   */
  crossesRunSide(ax, az, bx, bz) {
    if (!this.runs) return false;
    const lx0 = Math.min(ax, bx), lx1 = Math.max(ax, bx), lz0 = Math.min(az, bz), lz1 = Math.max(az, bz);
    for (const R of this.runs) {
      if (lx1 < R.box[0] || lx0 > R.box[2] || lz1 < R.box[1] || lz0 > R.box[3]) continue;
      const h = R.w / 2;
      for (const g of R.segs) {
        const ta = (ax - g.ax) * g.ux + (az - g.az) * g.uz, va = -(ax - g.ax) * g.uz + (az - g.az) * g.ux;
        const tb = (bx - g.ax) * g.ux + (bz - g.az) * g.uz, vb = -(bx - g.ax) * g.uz + (bz - g.az) * g.ux;
        for (const e of [h, -h]) {
          if ((va - e) * (vb - e) >= 0) continue;
          const t = ta + ((tb - ta) * (e - va)) / (vb - va);
          if (t > 1e-6 && t < g.l - 1e-6) return true;
        }
      }
    }
    return false;
  }

  /**
   * Height a walker stands at (m): the sloped line of a ramp he is on (within its width and a cell of its graded strip),
   * else the cell's elev (elevAt).
   */
  surfaceY(x, z) {
    const e = this.elevAt(x, z);
    // stair flights (world/stairs.js StairField, attached by map-builder): the nosing line of the M3 dam stairs and the
    // access platform stairs, so a walker climbs smoothly instead of a graded cell's height at a time
    if (this.flights?.size) { const y = this.flights.simY(x, z, e, MAX_STEP); if (y != null) return y; }
    if (this.ramps) for (const r of this.ramps) {
      if (r.viewOnly) continue; // (a terrain road ramp's slab: the view's, map-builder roadRampLine)
      // only over its own graded cells: strictly between its ends' heights (not the landing / a wall walk beside it)
      if (e <= Math.min(r.ya, r.yb) + 0.01 || e >= Math.max(r.ya, r.yb) - 0.01) continue;
      const px = x - r.ax, pz = z - r.az, t = px * r.ux + pz * r.uz;
      if (t < -this.cell || t > r.len + this.cell || Math.abs(px * r.uz - pz * r.ux) > r.w / 2 + this.cell) continue;
      const y = NavGrid.rampLineY(r, t);
      if (Math.abs(y - e) <= MAX_STEP) return y;
    }
    return e;
  }

  /** Is (x, z) on or within `m` m of a ramp (a walker there eases over the steps onto / off it)? */
  nearRamp(x, z, m = 1) {
    if (this.ramps) for (const r of this.ramps) {
      if (r.viewOnly) continue;
      const px = x - r.ax, pz = z - r.az, t = px * r.ux + pz * r.uz;
      if (t >= -m && t <= r.len + m && Math.abs(px * r.uz - pz * r.ux) <= r.w / 2 + m) return true;
    }
    return false;
  }

  /** Can a unit step directly between adjacent cells ka and kb (elevation continuity)? */
  canStep(ka, kb) {
    if (Math.abs(this.elev[ka] - this.elev[kb]) > MAX_STEP) return false;
    // a ramp / stair run (addRun): on and off it only across its foot or its head, never over its side
    const ro = this.runOf;
    if (!ro || ro[ka] === ro[kb]) return true;
    return (!ro[ka] || this._pastRunEnd(ro[ka] - 1, kb)) && (!ro[kb] || this._pastRunEnd(ro[kb] - 1, ka));
  }

  // ---------------------------------------------------------------- dynamic occluders (§4.2 OCLU)

  /**
   * Version of the dynamic layer's content: bumped when the stamps differ from those last read (sight caches, the drawn
   * cones key on it), not merely because the layer was cleared and stamped again the same.
   */
  get dynamicVersion() {
    if (this._dynSig !== this._dynSigSeen) { this._dynSigSeen = this._dynSig; this._dynVer++; }
    return this._dynVer;
  }

  set dynamicVersion(v) { this._dynVer = v; this._dynSigSeen = this._dynSig; }

  /** Zero the dynamic layer. Called once per sim step before vehicles/trains re-stamp themselves. */
  clearDynamic() {
    if (this._dynamicDirty) {
      this.dynamicBlock.fill(0);
      this._dynamicDirty = false;
    }
    this._dynSig = 0;
  }

  /**
   * Stamp an oriented rectangle (centre, size w along the heading, d across) into the dynamic layer.
   * @param {number} [value=B.HIGH]
   * @returns {number} cells written
   */
  stampDynamic(cx, cz, w, d, rotHeading, value = B.HIGH) {
    const c = Math.cos(rotHeading), s = Math.sin(rotHeading);
    const r = Math.hypot(w, d) / 2;
    const c0 = this.worldToCell(cx - r, cz - r), c1 = this.worldToCell(cx + r, cz + r);
    let n = 0;
    for (let j = Math.max(0, c0.j); j <= Math.min(this.rows - 1, c1.j); j++) {
      for (let i = Math.max(0, c0.i); i <= Math.min(this.cols - 1, c1.i); i++) {
        // (cellCenter written out: an object per cell of every hull, every tick a vehicle moves)
        const dx = (i + 0.5) * this.cell - cx, dz = (j + 0.5) * this.cell - cz;
        const u = dx * c + dz * s, v = -dx * s + dz * c;
        if (Math.abs(u) <= w / 2 && Math.abs(v) <= d / 2) {
          const k = this.idx(i, j);
          if (value > this.dynamicBlock[k]) this.dynamicBlock[k] = value;
          n++;
        }
      }
    }
    if (n) {
      this._dynamicDirty = true;
      // (order-free: a sum of per-stamp hashes of the rounded footprint)
      let h = Math.imul(Math.round(cx * 1000) | 0, 0x9e3779b1) ^ Math.imul(Math.round(cz * 1000) | 0, 0x85ebca77);
      h = Math.imul(h ^ (Math.round(w * 1000) | 0), 0xc2b2ae3d) ^ Math.imul(Math.round(d * 1000) | 0, 0x27d4eb2f);
      h = Math.imul(h ^ (Math.round(rotHeading * 10000) | 0), 0x165667b1) ^ value;
      this._dynSig = (this._dynSig + (h | 0)) | 0;
    }
    return n;
  }

  /**
   * Nav-only block stamp (see navBlock): replaces the cells previously stamped under `key` with `cells`
   * (cell indices). Bumps `version` when anything changed (paths replan).
   * @param {string} key @param {Iterable<number>} cells
   */
  navStamp(key, cells) {
    const prev = this._navStamps.get(key), next = new Set(cells), vis = WALKER_STAMP.test(key);
    // (the rows of the cells whose count changes — not every row the two sets span: M18's head room re-stamp after the
    // bridge's fall spans the whole map and changes ~400 cells by the bridge; staticLayers redoes the dirty rows)
    const r = { j0: Infinity, j1: -Infinity }, cols = this.cols;
    if (prev) for (const k of prev) if (!next.has(k)) { if (this.navBlock[k]) { this.navBlock[k]--; if (vis && this.visBlock[k]) this.visBlock[k]--; } const j = (k / cols) | 0; if (j < r.j0) r.j0 = j; if (j > r.j1) r.j1 = j; }
    for (const k of next) if (!prev || !prev.has(k)) { this.navBlock[k] = Math.min(255, this.navBlock[k] + 1); if (vis) this.visBlock[k] = Math.min(255, this.visBlock[k] + 1); const j = (k / cols) | 0; if (j < r.j0) r.j0 = j; if (j > r.j1) r.j1 = j; }
    if (next.size) this._navStamps.set(key, next); else this._navStamps.delete(key);
    this._bumpRows(r.j0, r.j1);
  }

  /**
   * A drawn footprint for hulls (see hullBlock): replaces the cells previously stamped under `key` with `cells`.
   * @param {string} key @param {Iterable<number>} cells
   */
  hullStamp(key, cells) {
    const prev = this._hullStamps.get(key), next = new Set(cells);
    const r = { j0: Infinity, j1: -Infinity }, cols = this.cols; // (the rows of the cells that change: navStamp)
    if (prev) for (const k of prev) if (!next.has(k)) { if (this.hullBlock[k]) this.hullBlock[k]--; const j = (k / cols) | 0; if (j < r.j0) r.j0 = j; if (j > r.j1) r.j1 = j; }
    for (const k of next) if (!prev || !prev.has(k)) { this.hullBlock[k] = Math.min(255, this.hullBlock[k] + 1); const j = (k / cols) | 0; if (j < r.j0) r.j0 = j; if (j > r.j1) r.j1 = j; }
    if (next.size) this._hullStamps.set(key, next); else this._hullStamps.delete(key);
    this._bumpRows(r.j0, r.j1);
  }

  /**
   * Does cell `k`'s nav block stop a hull (in a `hullDrawn` mission)? Any nav stamp but the walkers' own (a wagon
   * parked, a no-walk area), or what a structure draws there itself — not the walkers' clearances round it (a tank's
   * nose and outline keep their own): in the browser M20's Panzer III could get neither between the hut h_w3 and the
   * barracks nor into the SW gate's passage, past the rings round that hut and the gatehouse's towers.
   */
  hullBlocked(k) {
    return this.navBlock[k] > this.visBlock[k] || this.hullBlock[k] > 0;
  }

  /**
   * Overhead stamp (see overLo): replaces the cells previously stamped under `key` with `cells` (cell index →
   * [lo, hi] world y). Bumps `version` (gun arcs / drive probes recompute). `soft` (tree branches) goes to
   * softLo / softHi instead: gun barrels keep out of it, hulls brush through.
   * @param {string} key @param {Map<number, [number, number]>} cells @param {boolean} [soft]
   */
  overStamp(key, cells, soft = false) {
    const n = this.cols * this.rows;
    if (!this.overLo) for (const f of ['overLo', 'softLo']) this[f] = new Float32Array(n).fill(Infinity);
    if (!this.overHi) for (const f of ['overHi', 'softHi']) this[f] = new Float32Array(n).fill(-Infinity);
    const touched = new Set(this._overStamps.get(key)?.cells.keys() || []);
    for (const k of cells.keys()) touched.add(k);
    if (cells.size) this._overStamps.set(key, { cells: new Map(cells), soft }); else this._overStamps.delete(key);
    // (the cells with an overhang — overLo finite — kept as a set: the head room stamp walks those, not the whole grid)
    const over = this.overCells || (this.overCells = new Set());
    for (const k of touched) {
      let lo = Infinity, hi = -Infinity, slo = Infinity, shi = -Infinity;
      for (const st of this._overStamps.values()) {
        const r = st.cells.get(k);
        if (!r) continue;
        if (st.soft) { if (r[0] < slo) slo = r[0]; if (r[1] > shi) shi = r[1]; } else { if (r[0] < lo) lo = r[0]; if (r[1] > hi) hi = r[1]; }
      }
      this.overLo[k] = lo; this.overHi[k] = hi; this.softLo[k] = slo; this.softHi[k] = shi;
      if (this.overLo[k] !== Infinity) over.add(k); else over.delete(k);
    }
    const r = this._rowsOf(touched);
    this._bumpRows(r.j0, r.j1);
  }

  /**
   * Standing-visual stamp (see `solid`): replaces the quarter cells previously stamped under `key` with `cells`
   * ("i,j" keys at cell / 2, as from placement-visual standingCells).
   * @param {string} key @param {Iterable<string>} cells
   */
  solidStamp(key, cells) {
    const S = this.cols * 2;
    if (!this.solid) this.solid = new Uint8Array(S * this.rows * 2);
    const toIdx = (c) => { const [i, j] = c.split(',').map(Number); return i >= 0 && j >= 0 && i < S && j < this.rows * 2 ? j * S + i : -1; };
    const prev = this._solidStamps.get(key), next = new Set();
    for (const c of cells) { const k = toIdx(c); if (k >= 0) next.add(k); }
    if (prev) for (const k of prev) if (!next.has(k) && this.solid[k]) this.solid[k]--;
    for (const k of next) if (!prev || !prev.has(k)) this.solid[k] = Math.min(255, this.solid[k] + 1);
    if (next.size) this._solidStamps.set(key, next); else this._solidStamps.delete(key);
  }

  /** Does a standing visual occupy (x, z)? (quarter-cell resolution; false when nothing was stamped) */
  solidAt(x, z) {
    if (!this.solid) return false;
    const h = this.cell / 2, i = Math.floor(x / h), j = Math.floor(z / h);
    return i >= 0 && j >= 0 && i < this.cols * 2 && j < this.rows * 2 && this.solid[j * this.cols * 2 + i] > 0;
  }

  /** Cells of an oriented rect (centre, w along heading, d across) whose centres lie inside it. */
  rectCells(cx, cz, w, d, heading = 0) {
    const out = [], c = Math.cos(heading), s = Math.sin(heading), r = Math.hypot(w, d) / 2;
    const c0 = this.worldToCell(cx - r, cz - r), c1 = this.worldToCell(cx + r, cz + r);
    for (let j = Math.max(0, c0.j); j <= Math.min(this.rows - 1, c1.j); j++) for (let i = Math.max(0, c0.i); i <= Math.min(this.cols - 1, c1.i); i++) {
      const p = this.cellCenter(i, j), dx = p.x - cx, dz = p.z - cz;
      if (Math.abs(dx * c + dz * s) <= w / 2 && Math.abs(-dx * s + dz * c) <= d / 2) out.push(this.idx(i, j));
    }
    return out;
  }

  /** Dynamic block class at a world point (0 outside). */
  dynamicAt(x, z) {
    const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    return this.inBounds(i, j) ? this.dynamicBlock[this.idx(i, j)] : 0;
  }

  // ---------------------------------------------------------------- links (§10.2 climb / ladder)

  /**
   * Add an off-grid pathfinding link between world points a and b (both should be walkable cells,
   * usually with different elev). Links are bidirectional.
   * @param {'climb'|'ladder'} kind
   * @param {{x:number, z:number, y?:number}} a
   * @param {{x:number, z:number, y?:number}} b
   * @param {{roles?: string[]|null, enabled?: boolean, cost?: number, id?: number, walk?: 'stairs'|'plank', heading?: number}} [opts]
   *   roles default: climb → ['greenberet'] (spec §3.3), ladder → null (everyone); walk: a ladder link walked as a
   *   stair flight / plank (pathfinding keeps it for a man who may not climb); heading: a ladder's climbing facing
   * @returns {GridLink}
   */
  addLink(kind, a, b, opts = {}) {
    const ca = this.worldToCell(a.x, a.z), cb = this.worldToCell(b.x, b.z);
    if (!this.inBounds(ca.i, ca.j) || !this.inBounds(cb.i, cb.j)) throw new Error('grid link endpoint outside the map');
    const link = {
      id: opts.id ?? this._nextLinkId++,
      kind,
      a: { x: a.x, z: a.z, y: a.y ?? this.elevAt(a.x, a.z) },
      b: { x: b.x, z: b.z, y: b.y ?? this.elevAt(b.x, b.z) },
      roles: opts.roles !== undefined ? opts.roles : kind === LINK.CLIMB ? ['greenberet'] : null,
      enabled: opts.enabled ?? true,
      // a ladder link that is walked, not climbed: a flight of stairs or a plank (mission `ladders[].kind`)
      ...(opts.walk ? { walk: opts.walk } : null),
      // a climb link's own time (s; mission `climbLinks[].climbTime`, `ladders[].climbTime`): its climb is far longer
      // than its crossing (a ladder's: the walk to it, the way over a wall at its top)
      ...(opts.climbTime > 0 ? { climbTime: opts.climbTime } : null),
      // the facing of a ladder's climber (mission `ladders[].heading`: the ladder faces the other way)
      ...(opts.heading != null ? { heading: opts.heading } : null),
      cost: 0,
      ka: this.idx(ca.i, ca.j),
      kb: this.idx(cb.i, cb.j),
    };
    link.cost = opts.cost ?? Math.abs(link.b.y - link.a.y) * 2; // climbing is slow: 2 m of path per metre of height
    this._nextLinkId = Math.max(this._nextLinkId, link.id + 1);
    this.links.push(link);
    for (const k of [link.ka, link.kb]) {
      if (!this._linkIndex.has(k)) this._linkIndex.set(k, []);
      this._linkIndex.get(k).push(link);
    }
    this.version++;
    return link;
  }

  /** Remove a link by id. @returns {boolean} */
  removeLink(id) {
    const i = this.links.findIndex((l) => l.id === id);
    if (i < 0) return false;
    const [l] = this.links.splice(i, 1);
    for (const k of [l.ka, l.kb]) {
      const arr = this._linkIndex.get(k);
      if (arr) { arr.splice(arr.indexOf(l), 1); if (!arr.length) this._linkIndex.delete(k); }
    }
    this.version++;
    return true;
  }

  /** Enable/disable a link (e.g. raise/lower a ladder). */
  setLinkEnabled(id, on) {
    const l = this.links.find((x) => x.id === id);
    if (l && l.enabled !== !!on) { l.enabled = !!on; this.version++; }
    return l || null;
  }

  /** Links touching cell index k (empty array if none). */
  linksAt(k) {
    return this._linkIndex.get(k) || EMPTY;
  }

  /**
   * May a unit of `role` use `link`? Enabled links with roles null are open to everyone; otherwise the
   * role must be listed. role '*' (tests/tools) may use every enabled link.
   */
  linkAllowed(link, role) {
    if (!link.enabled) return false;
    if (!link.roles) return true;
    return role === '*' || (role != null && link.roles.includes(role));
  }

  // ---------------------------------------------------------------- line of sight

  /**
   * Cell-index predicate "this cell was stamped by footprint h" ({x, z, w, d, heading}, same test as
   * stampDynamic), used to let a vehicle's own hull stamp not blind its own eye.
   */
  _hullTest(h) {
    const c = Math.cos(h.heading || 0), s = Math.sin(h.heading || 0), cols = this.cols, cell = this.cell;
    const hw = h.w / 2, hd = h.d / 2;
    return (k) => {
      const dx = ((k % cols) + 0.5) * cell - h.x, dz = (Math.floor(k / cols) + 0.5) * cell - h.z;
      return Math.abs(dx * c + dz * s) <= hw && Math.abs(-dx * s + dz * c) <= hd;
    };
  }

  /**
   * Visit the cells crossed by segment A→B (Amanatides–Woo DDA), in order, excluding A's cell and
   * B's cell. `visit(k)` returns true to stop; the cell's parametric entry and exit are TV[0] / TV[1] as it is called
   * (0..1; a side cell touched exactly at a corner has exit = entry) — read them first thing: numbers handed in a
   * typed array, not as arguments (a double argument to a callback is a boxed number per cell: steady garbage).
   * @returns {boolean} true if stopped by the visitor
   */
  _traverse(ax, az, bx, bz, visit) {
    const c = this.cell;
    let i = Math.floor(ax / c), j = Math.floor(az / c);
    const ti = Math.floor(bx / c), tj = Math.floor(bz / c);
    const dx = bx - ax, dz = bz - az;
    const stepI = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepJ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepI ? Math.abs(c / dx) : Infinity;
    const tDeltaZ = stepJ ? Math.abs(c / dz) : Infinity;
    let tMaxX = stepI > 0 ? ((i + 1) * c - ax) / dx : stepI < 0 ? (i * c - ax) / dx : Infinity;
    let tMaxZ = stepJ > 0 ? ((j + 1) * c - az) / dz : stepJ < 0 ? (j * c - az) / dz : Infinity;
    const maxSteps = Math.abs(ti - i) + Math.abs(tj - j) + 2;
    for (let s = 0; s < maxSteps; s++) {
      let t;
      if (Math.abs(tMaxX - tMaxZ) < 1e-12) {
        // Exactly through a corner: check both side cells (conservative — a corner can't be peeked through).
        t = tMaxX;
        if (t > 1) return false;
        const ni = i + stepI, nj = j + stepJ;
        if (!(ni === ti && j === tj) && this.inBounds(ni, j)) { TV[0] = t; TV[1] = t; if (visit(this.idx(ni, j))) return true; }
        if (!(i === ti && nj === tj) && this.inBounds(i, nj)) { TV[0] = t; TV[1] = t; if (visit(this.idx(i, nj))) return true; }
        i = ni; j = nj;
        tMaxX += tDeltaX; tMaxZ += tDeltaZ;
      } else if (tMaxX < tMaxZ) {
        t = tMaxX;
        if (t > 1) return false;
        i += stepI; tMaxX += tDeltaX;
      } else {
        t = tMaxZ;
        if (t > 1) return false;
        j += stepJ; tMaxZ += tDeltaZ;
      }
      if (i === ti && j === tj) return false;
      if (!this.inBounds(i, j)) return false;
      TV[0] = t; TV[1] = Math.min(1, tMaxX, tMaxZ);
      if (visit(this.idx(i, j))) return true;
    }
    return false;
  }

  /**
   * Line of sight between two world points (XZ). Blocked by any B.HIGH cell strictly between the
   * endpoints' cells; B.LOW blocks only when `targetLow && !viewerElevated`; B.FENCE never blocks.
   * The dynamicBlock layer (vehicles, trains) blocks the same way unless `dynamic === false`.
   * Raised cells (elev > max(viewerY, targetY) + LOS_CLEAR) block too. The roof-level rule (§4.2) is
   * perception's job (it compares unit y values), not the grid's.
   * `ownOwner`: grid owner id of the structure the viewer is posted in (bunker crew) — its cells do not block.
   * `ownHull` {x, z, w, d, heading}: the viewer's own vehicle footprint — its dynamic stamp does not block
   * (a crewed vehicle looks from its gun mount, inside its own hull; §7.5 pboat).
   * `targetHull` {x, z, w, d, heading}: the target vehicle's own footprint — its dynamic stamp does not
   * block a shot at that vehicle (an occluding hull never hides its own centre).
   * `passOwners` Set of grid owner ids whose static cells do not block (a bullet through planks: the
   * `shotThrough` structures, abilities/common.js shotLosOpts).
   * @param {{viewerElevated?: boolean, targetLow?: boolean, dynamic?: boolean, viewerY?: number, targetY?: number, ownHull?: object, targetHull?: object, passOwners?: Set<number>}} [opts]
   * @returns {boolean} true when visible
   */
  lineOfSight(ax, az, bx, bz, opts) {
    const lowBlocks = !!(opts && opts.targetLow && !opts.viewerElevated);
    const useDyn = !(opts && opts.dynamic === false);
    const own = useDyn && opts?.ownHull ? this._hullTest(opts.ownHull) : null;
    const tgt = useDyn && opts?.targetHull ? this._hullTest(opts.targetHull) : null;
    // 2.5D: raised cells (elev) block like B.HIGH when higher than both endpoints (+LOS_CLEAR).
    const hy = Math.max(opts?.viewerY ?? 0, opts?.targetY ?? 0) + LOS_CLEAR;
    const block = this.block, dyn = this.dynamicBlock, elev = this.elev;
    const ownOwner = opts?.ownOwner || 0, owner = this.owner, pass = opts?.passOwners || null;
    const over = overWallsTest(opts?.overWalls);
    const blocked = this._traverse(ax, az, bx, bz, (k) => {
      const t = TV[0];
      // the viewer's own bunker: he looks out of its slit; a `passOwners` structure: the bullet goes through
      const b = (ownOwner && owner[k] === ownOwner) || (pass && owner[k] && pass.has(owner[k])) ? B.NONE : block[k];
      if ((b === B.HIGH || (lowBlocks && b === B.LOW)) && !(over && over(k, t))) return true;
      if (elev[k] > hy) return true;
      if (useDyn) { const d = dyn[k]; if ((d === B.HIGH || (lowBlocks && d === B.LOW)) && !(own && own(k)) && !(tgt && tgt(k))) return true; }
      return false;
    });
    return !blocked;
  }

  // ---------------------------------------------------------------- sight by height (§4.2 "Occlusion by height")

  /**
   * The height (m, absolute) a sight line has to clear over cell k: its surface (elev: ground, ramp, deck, plateau,
   * roof) or the top of what stands on it. B.HIGH: surface + the owning structure's height (`o.heightOf(k)`; a cell
   * with no known height blocks at any height — Infinity). B.LOW is LOW COVER, BEL's rule kept (§4.2): it only ever
   * hides a low target (`low`: crawling, swimming, seated, a body) and is open ground for a standing one; from the
   * ground (`o.lowCover` 'block', the default) it hides that low man wherever he lies behind it, as in BEL; from a
   * raised post (`o.lowCover` 'height': a tower, a roof, a plateau) by height — surface + min(height, LOW_TOP), so
   * only right behind it. B.FENCE and open cells: the surface. The dynamic layer (vehicles, OCLU) blocks at any height
   * (B.HIGH) or as low cover (B.LOW). `ownOwner` cells (the viewer's own bunker), `passOwners` cells (a round through
   * `shotThrough` planks) and `ownHull` / `targetHull` stamps are open.
   * @param {number} k @param {{heightOf?: (k: number) => number|null, ownOwner?: number, passOwners?: Set<number>, dynamic?: boolean, lowCover?: 'block'|'height'}} o
   * @param {((k: number) => boolean)|null} [own] @param {((k: number) => boolean)|null} [tgt] @param {boolean} [low]
   * @returns {number}
   */
  sightTop(k, o, own = null, tgt = null, low = false) {
    const e = this.elev[k];
    let top = e;
    const ow = this.owner[k];
    const b = ow && ((o?.ownOwner && ow === o.ownOwner) || o?.passOwners?.has(ow)) ? B.NONE : this.block[k];
    if (b === B.HIGH) {
      const h = o?.heightOf ? o.heightOf(k) : null;
      top = h == null ? Infinity : this.blockBase(k) + h;
    } else if (b === B.LOW && low) {
      if (o?.lowCover !== 'height') return Infinity;
      const h = o?.heightOf ? o.heightOf(k) : null;
      top = this.blockBase(k) + Math.min(h ?? LOW_TOP, LOW_TOP);
    }
    if (!(o && o.dynamic === false)) {
      const d = this.dynamicBlock[k];
      if (d && !(own && own(k)) && !(tgt && tgt(k))) {
        if (d === B.HIGH) return Infinity;
        if (d === B.LOW && low) top = o?.lowCover !== 'height' ? Infinity : Math.max(top, e + LOW_TOP);
      }
    }
    return top;
  }

  /**
   * The ground a blocked cell's structure stands on (m): its own elev, or — a natural level (a cliff's plateau or
   * terrace, naturalElev) stamps elev on its open cells only, so a ruin wall standing on it (M8: its strips leave
   * holes for the walls) keeps elev 0 under it — the highest natural-level open cell within 1 m of it. A wall on a 4 m
   * plateau tops out at 4 m + its height, not at its height (else a guard on the plateau saw through every wall up
   * there). Not lifted: the level's own structure and every cliff (levelOwners: their h is from the ground), and
   * anything beside a BUILT floor only (a palisade at the foot of an MG deck stands on the ground). Memoised until the
   * grid changes.
   * @param {number} k @returns {number}
   */
  blockBase(k) {
    const e = this.elev[k];
    if (e > 0) return e;
    const ow = this.owner[k];
    if (this.levelOwners.has(ow)) return e;
    if (this._bbVer !== this.version || !this._bb) {
      if (!this._bb || this._bb.length !== this.size) { this._bb = new Float32Array(this.size); this._bbOn = null; }
      this._bb.fill(-1);
      this._bbVer = this.version;
    }
    let b = this._bb[k];
    if (b >= 0) return b;
    b = 0;
    // a structure stands ON the level when most of the open ground round it (1 m) is that natural level (M8's walls,
    // M5's hilltop station: ~100 %); one at its foot or built into its edge (M12's harbour HQ, M11's walls below the
    // mesa: <= 47 %) stands on the ground. Anonymous blocks (owner 0) by their own cell's ring.
    if (ow ? this._onLevel().get(ow) : this._ringShare(k) >= 0.5) {
      const cols = this.cols, i0 = k % cols, j0 = (k - i0) / cols;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const i = i0 + di, j = j0 + dj;
        if (!this.inBounds(i, j)) continue;
        const q = this.idx(i, j);
        if (this.naturalElev[q] && (this.block[q] === B.NONE || this.block[q] === B.FENCE)) b = Math.max(b, this.elev[q]);
      }
    }
    this._bb[k] = b;
    return b;
  }

  /** Share (0..1) of the open cells within 1 m of cell k that are raised natural ground. @param {number} k */
  _ringShare(k) {
    const cols = this.cols, i0 = k % cols, j0 = (k - i0) / cols;
    let n = 0, nat = 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = i0 + di, j = j0 + dj;
      if (!this.inBounds(i, j)) continue;
      const q = this.idx(i, j);
      if (this.block[q] !== B.NONE && this.block[q] !== B.FENCE) continue;
      n++;
      if (this.naturalElev[q] && this.elev[q] > 0) nat++;
    }
    return n ? nat / n : 0;
  }

  /** owner → stands on a natural level (blockBase): >= half its 1 m ring is raised natural ground. One pass over the
   * map, kept for the mission (a door opening or a hut blown up moves no structure on or off a plateau; a whole-map
   * pass after every grid change was a 3-9 ms hitch). @returns {Map<number, boolean>} */
  _onLevel() {
    if (this._bbOn) return this._bbOn;
    const tot = new Map(), nat = new Map(), cols = this.cols;
    for (let k = 0; k < this.size; k++) {
      const ow = this.owner[k];
      if (!ow || this.elev[k] > 0 || (this.block[k] !== B.HIGH && this.block[k] !== B.LOW) || this.levelOwners.has(ow)) continue;
      const i0 = k % cols, j0 = (k - i0) / cols;
      let n = 0, m = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const i = i0 + di, j = j0 + dj;
        if (!this.inBounds(i, j)) continue;
        const q = this.idx(i, j);
        if (this.block[q] !== B.NONE && this.block[q] !== B.FENCE) continue;
        n++;
        if (this.naturalElev[q] && this.elev[q] > 0) m++;
      }
      if (n) { tot.set(ow, (tot.get(ow) || 0) + n); nat.set(ow, (nat.get(ow) || 0) + m); }
    }
    const on = new Map();
    for (const [ow, n] of tot) on.set(ow, nat.get(ow) / n >= 0.5);
    return (this._bbOn = on);
  }

  /**
   * Line of sight by HEIGHT (§4.2): from an eye at `o.eyeY` over (ax, az) to a target point `o.targetY` high over
   * (bx, bz) (`o.targetLow`: a low target, whom low cover hides). A crossed cell blocks only when its sightTop rises
   * above the straight sight line where the line passes over it (anywhere between the cell's entry and exit) — a bump,
   * a drift, a low wall or a crate below the line does not; the ground just behind it is hidden only where the line
   * really passes under its top. A's and B's own cells never block (as lineOfSight), nor does the open floor of either
   * man's own level (LEVEL_TOL of `o.viewerY` / `o.targetBaseY`: the deck he stands on, the wall walk the target stands
   * on). The same rule, ray by ray, is sightRay (the drawn cone).
   * @param {{eyeY: number, targetY: number, targetLow?: boolean, viewerY?: number, targetBaseY?: number, heightOf?: Function, ownOwner?: number, ownHull?: object, targetHull?: object, dynamic?: boolean}} o
   * @returns {boolean} true when visible
   */
  sightLine(ax, az, bx, bz, o) {
    const D = Math.hypot(bx - ax, bz - az);
    if (!(D > 1e-9)) return true;
    const eye = o.eyeY, s = (o.targetY - eye) / D, low = !!o.targetLow;
    const useDyn = o.dynamic !== false;
    const own = useDyn && o.ownHull ? this._hullTest(o.ownHull) : null;
    const tgt = useDyn && o.targetHull ? this._hullTest(o.targetHull) : null;
    const vy = o.viewerY ?? null, ty = o.targetBaseY ?? null, elev = this.elev;
    // (the _traverse march written out, the cell test inline — up to three cells a step: the two side cells of an exact
    // corner, then the cell entered: the most frequent sight test of the sim, whose visitor closure and context per
    // call (and boxed numbers per cell) were steady garbage. The same cells, in the same order, with the same t.)
    const c = this.cell;
    let i = Math.floor(ax / c), j = Math.floor(az / c);
    const ti = Math.floor(bx / c), tj = Math.floor(bz / c);
    const dx = bx - ax, dz = bz - az;
    const stepI = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepJ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepI ? Math.abs(c / dx) : Infinity;
    const tDeltaZ = stepJ ? Math.abs(c / dz) : Infinity;
    let tMaxX = stepI > 0 ? ((i + 1) * c - ax) / dx : stepI < 0 ? (i * c - ax) / dx : Infinity;
    let tMaxZ = stepJ > 0 ? ((j + 1) * c - az) / dz : stepJ < 0 ? (j * c - az) / dz : Infinity;
    const maxSteps = Math.abs(ti - i) + Math.abs(tj - j) + 2;
    for (let st = 0; st < maxSteps; st++) {
      let t, sideA = -1, sideB = -1;
      if (Math.abs(tMaxX - tMaxZ) < 1e-12) {
        t = tMaxX;
        if (t > 1) return true;
        const ni = i + stepI, nj = j + stepJ;
        if (!(ni === ti && j === tj) && this.inBounds(ni, j)) sideA = this.idx(ni, j);
        if (!(i === ti && nj === tj) && this.inBounds(i, nj)) sideB = this.idx(i, nj);
        i = ni; j = nj;
        tMaxX += tDeltaX; tMaxZ += tDeltaZ;
      } else if (tMaxX < tMaxZ) {
        t = tMaxX;
        if (t > 1) return true;
        i += stepI; tMaxX += tDeltaX;
      } else {
        t = tMaxZ;
        if (t > 1) return true;
        j += stepJ; tMaxZ += tDeltaZ;
      }
      // visits this step: side A (t, t), side B (t, t), then the cell entered (t, min(1, tMaxX, tMaxZ)) unless the end
      for (let v = 0; v < 3; v++) {
        let k, t1 = t;
        if (v === 0) { if (sideA < 0) continue; k = sideA; } else if (v === 1) { if (sideB < 0) continue; k = sideB; } else {
          if (i === ti && j === tj) return true;
          if (!this.inBounds(i, j)) return true;
          k = this.idx(i, j); t1 = Math.min(1, tMaxX, tMaxZ);
        }
        const top = this.sightTop(k, o, own, tgt, low);
        if (top === Infinity) return false;
        if (top === elev[k] && ((vy != null && Math.abs(top - vy) <= LEVEL_TOL) || (ty != null && Math.abs(top - ty) <= LEVEL_TOL))) continue; // a man's own floor
        if (s < sightSlope(top - eye, t * D, t1 * D)) return false;
      }
    }
    return true;
  }

  /**
   * The drawn cone's ray (§10.2: the cone IS the detection geometry): where along the ray from (ax, az) at `angle`
   * sightLine reaches a target standing on the surface, for each target height in `heights` (m above the surface;
   * `o.lowOf[i]`: height i is a low target, whom low cover hides): per height the sorted, disjoint [d0, d1] distance
   * intervals within min(maxDist, map edge). One DDA march: the steepest blocking slope of the cells crossed so far
   * (A's cell excluded) decides each cell's visible part exactly (a target in a cell is seen when its sight slope ≥ that
   * maximum, as sightLine; the open floors are kept by level so a target never counts his own floor, nor the viewer
   * his — `o.viewerY`). A cell that blocks at any height (a wall, a building, a vehicle) ends the ray. `o.hide(k, base,
   * i)` → true hides target height i standing in cell k (perception's roof and deck-edge rules); options as sightLine
   * (eyeY, viewerY, heightOf, ownOwner, ownHull, dynamic). `o.pastEdge` (the drawn cone only, never detection):
   * past the map edge the ray runs on over open ground on the last cell's surface to maxDist instead of stopping
   * at the border — the scenery apron out there carries no occluders, so the cone keeps its geometric extent.
   * @param {number[]} heights
   * @returns {number[][][]} intervals[i] = [[d0, d1], …]
   */
  sightRay(ax, az, angle, maxDist, heights, o) {
    // (the march below keeps its state in module scratch — the obstacle slopes and open floors per target kind, the
    // per-height flags — and its steps written out: every drawn cone casts hundreds of these rays a rebuild, and the
    // closures, records and arrays made per ray were the largest steady garbage of the frame. The same steps, the same
    // arithmetic and the same intervals as before.)
    const NH = heights.length;
    const out = [];
    for (let n = 0; n < NH; n++) out.push([]);
    const dx = Math.cos(angle), dz = Math.sin(angle);
    let L = maxDist;
    if (!o.pastEdge) { // (o.pastEdge: the border does not cut the ray; the march below still ends at the last cell)
      if (dx > 1e-12) L = Math.min(L, (this.width - ax) / dx);
      if (dx < -1e-12) L = Math.min(L, -ax / dx);
      if (dz > 1e-12) L = Math.min(L, (this.depth - az) / dz);
      if (dz < -1e-12) L = Math.min(L, -az / dz);
    }
    if (!(L > 0)) return out;
    const eye = o.eyeY, vy = o.viewerY ?? null;
    const S = SR;
    if (S.low.length < NH) { S.low = new Uint8Array(NH * 2); S.hid = new Uint8Array(NH * 2); }
    const lowOf = S.low, hidden = S.hid;
    for (let n = 0; n < NH; n++) { lowOf[n] = o.lowOf?.[n] ? 1 : 0; hidden[n] = 0; }
    const useDyn = o.dynamic !== false;
    const own = useDyn && o.ownHull ? this._hullTest(o.ownHull) : null;
    const hide = o.hide || null;
    const c = this.cell, elev = this.elev, block = this.block, dyn = this.dynamicBlock;
    let i = Math.floor(ax / c), j = Math.floor(az / c);
    const stepI = dx > 1e-12 ? 1 : dx < -1e-12 ? -1 : 0, stepJ = dz > 1e-12 ? 1 : dz < -1e-12 ? -1 : 0;
    const tDeltaX = stepI ? Math.abs(c / dx) : Infinity, tDeltaZ = stepJ ? Math.abs(c / dz) : Infinity;
    let tMaxX = stepI > 0 ? ((i + 1) * c - ax) / dx : stepI < 0 ? (i * c - ax) / dx : Infinity;
    let tMaxZ = stepJ > 0 ? ((j + 1) * c - az) / dz : stepJ < 0 ? (j * c - az) / dz : Infinity;
    // what the cells crossed so far block, for a standing (0) and a low (1) target: M = the steepest blocking slope of
    // the obstacles; the open floors (top = surface) by level, so a target never counts his own floor (sightLine's
    // LEVEL_TOL rule) and the viewer's floor is left out altogether
    const M = S.M, FE = S.FE, FM = S.FM, FN = S.FN;
    M[0] = -Infinity; M[1] = -Infinity; FN[0] = 0; FN[1] = 0;
    // a target standing in cell k between d0 and d1 (perception's per-level rules memoised by the surface height: a
    // ray crosses few distinct levels)
    let hBase = NaN;
    let d = 0, first = true, lastK = -1;
    for (let guard = 0; guard < 1e6 && d < L; guard++) {
      let k, d1, last = false;
      if (!this.inBounds(i, j)) { // past the map edge (o.pastEdge): the last cell's surface, seen as far as the slopes crossed so far allow, to the ray's end
        if (!(o.pastEdge && lastK >= 0)) break;
        k = lastK; d1 = L; last = true;
      } else k = this.idx(i, j);
      const corner = !last && Math.abs(tMaxX - tMaxZ) < 1e-12;
      const dExit = last ? L : Math.min(tMaxX, tMaxZ, L);
      // a wall / building / hull face: nothing beyond, nobody stands in it
      const ts = last || first ? 0 : this.sightTop(k, o, own, null, false);
      if (ts === Infinity) break;
      if (!last) d1 = dExit;
      // reach(k, d, d1)
      {
        const base = elev[k];
        if (hide && base !== hBase) { hBase = base; for (let n = 0; n < NH; n++) hidden[n] = hide(k, base, n) ? 1 : 0; }
        let m0 = M[0], m1 = M[1];
        for (let f = 0, nf = FN[0], fe = FE[0], fm = FM[0]; f < nf; f++) if (Math.abs(fe[f] - base) > LEVEL_TOL && fm[f] > m0) m0 = fm[f];
        for (let f = 0, nf = FN[1], fe = FE[1], fm = FM[1]; f < nf; f++) if (Math.abs(fe[f] - base) > LEVEL_TOL && fm[f] > m1) m1 = fm[f];
        for (let n = 0; n < NH; n++) {
          if (hide && hidden[n]) continue;
          const Mn = lowOf[n] ? m1 : m0;
          let p0 = d, p1 = d1;
          if (Mn !== -Infinity) {
            const av = base + heights[n] - eye; // visible at d ⇔ av / d ≥ M
            if (av >= 0) { if (!(Mn <= 0)) p1 = Math.min(d1, av / Mn); } else if (Mn < 0) p0 = Math.max(d, av / Mn); else continue;
          }
          if (!(p1 > p0)) continue; // push(n, p0, p1)
          const iv = out[n], lv = iv[iv.length - 1];
          if (lv && p0 - lv[1] <= 1e-9) lv[1] = Math.max(lv[1], p1); else iv.push([p0, p1]);
        }
      }
      if (last) break;
      lastK = k;
      // crossBoth: the cell entered (ts, d → dExit), then — exactly through a corner, after d = dExit — both side cells
      // at that point (as _traverse: a corner can't be peeked through)
      const wasFirst = first;
      first = false;
      if (!wasFirst) this._srCrossBoth(k, ts, d, dExit, o, own, eye, vy, useDyn, block, dyn);
      if (dExit >= L) break;
      d = dExit;
      if (corner) {
        const ni = i + stepI, nj = j + stepJ;
        let wall = false;
        if (this.inBounds(ni, j)) { const kk = this.idx(ni, j); if (this._srCrossBoth(kk, this.sightTop(kk, o, own, null, false), d, d, o, own, eye, vy, useDyn, block, dyn)) wall = true; }
        if (this.inBounds(i, nj)) { const kk = this.idx(i, nj); if (this._srCrossBoth(kk, this.sightTop(kk, o, own, null, false), d, d, o, own, eye, vy, useDyn, block, dyn)) wall = true; }
        if (wall) break;
        i = ni; j = nj; tMaxX += tDeltaX; tMaxZ += tDeltaZ;
      } else if (tMaxX < tMaxZ) { i += stepI; tMaxX += tDeltaX; } else { j += stepJ; tMaxZ += tDeltaZ; }
    }
    return out;
  }

  /** sightRay's crossing of cell k (top ts for a standing target) between d0 and d1: its slopes into the scratch state
   *  of both target kinds (an obstacle raises M, an open floor its level's slope). @returns {boolean} a wall */
  _srCrossBoth(k, ts, d0, d1, o, own, eye, vy, useDyn, block, dyn) {
    // (the cell's top for a low target: low cover counts only there)
    const tl = ts !== Infinity && (block[k] === B.LOW || (useDyn && dyn[k] === B.LOW)) ? this.sightTop(k, o, own, null, true) : ts;
    const S = SR, e = this.elev[k];
    for (let s = 0; s < 2; s++) {
      const top = s ? tl : ts;
      const sl = top === Infinity ? Infinity : sightSlope(top - eye, d0, d1);
      if (top !== e) { if (sl > S.M[s]) S.M[s] = sl; continue; } // an obstacle
      if (vy != null && Math.abs(top - vy) <= LEVEL_TOL) continue; // the viewer's own floor
      const fe = S.FE[s], n = S.FN[s];
      let f = -1;
      for (let q = 0; q < n; q++) if (fe[q] === top) { f = q; break; }
      if (f < 0) {
        if (n === fe.length) { const g = new Float64Array(n * 2), h = new Float64Array(n * 2); g.set(fe); h.set(S.FM[s]); S.FE[s] = g; S.FM[s] = h; }
        f = n; S.FE[s][f] = top; S.FM[s][f] = -Infinity; S.FN[s] = n + 1;
      }
      if (sl > S.FM[s][f]) S.FM[s][f] = sl;
    }
    return ts === Infinity;
  }

  /**
   * Distance from (ax, az) along `angle` to the first B.HIGH cell (or the map edge), capped at maxDist.
   * The origin's own cell is ignored. Used by vision-cone meshes. Also stops at dynamicBlock B.HIGH
   * cells (unless `dynamic === false`) and at raised cells higher than viewerY + LOS_CLEAR.
   * @param {{viewerElevated?: boolean, dynamic?: boolean, viewerY?: number}} [opts]
   * @returns {number}
   */
  castRay(ax, az, angle, maxDist, opts) { // eslint-disable-line no-unused-vars
    const bx = ax + Math.cos(angle) * maxDist;
    const bz = az + Math.sin(angle) * maxDist;
    let hitT = 1;
    const block = this.block;
    if (maxDist <= 0) return 0;
    // Traverse past the end so the end cell itself is tested, then clamp to maxDist.
    const ext = (maxDist + this.cell * 2) / maxDist;
    const ex = ax + (bx - ax) * ext, ez = az + (bz - az) * ext;
    const useDyn = !(opts && opts.dynamic === false);
    const own = useDyn && opts?.ownHull ? this._hullTest(opts.ownHull) : null;
    const dyn = this.dynamicBlock, elev = this.elev;
    const hy = (opts?.viewerY ?? 0) + LOS_CLEAR;
    const ownOwner = opts?.ownOwner || 0, owner = this.owner;
    // a viewer high over a wall (overWalls): the cone runs on past walls under the sight line to its far end
    const over = overWallsTest(opts?.overWalls && { ...opts.overWalls, scale: ext });
    this._traverse(ax, az, ex, ez, (k) => {
      const t = TV[0];
      if ((block[k] === B.HIGH && !(ownOwner && owner[k] === ownOwner) && !(over && over(k, t))) || elev[k] > hy || (useDyn && dyn[k] === B.HIGH && !(own && own(k)))) {
        hitT = t * ext;
        return true;
      }
      return false;
    });
    // Map edge.
    let edgeT = Infinity;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    if (dx > 0) edgeT = Math.min(edgeT, (this.width - ax) / dx);
    if (dx < 0) edgeT = Math.min(edgeT, -ax / dx);
    if (dz > 0) edgeT = Math.min(edgeT, (this.depth - az) / dz);
    if (dz < 0) edgeT = Math.min(edgeT, -az / dz);
    return Math.max(0, Math.min(maxDist, hitT * maxDist, edgeT));
  }

  /**
   * Walkability line test used by path smoothing: both endpoint cells and every cell crossed by the
   * segment must be walkable (a segment through an exact cell corner tests both side cells).
   * With `opts.clearance` > 0 the two parallel segments offset by ±clearance are tested too, so
   * smoothed paths keep some distance from wall corners. Keep clearance < CELL/2.
   * With `opts.elevRef` (m) every cell must also be within MAX_STEP of that height (same level).
   * With `opts.avoidClearance` the avoid mask (body clearance, world/body-clearance.js: already inflated by the body's
   * reach) is kept only that far off by the offset lines (≤ clearance), the full clearance off the grid's own blocks.
   * @param {{swim?: boolean, clearance?: number, dynamic?: boolean, elevRef?: number, avoidClearance?: number}} [opts]
   */
  walkableLine(ax, az, bx, bz, opts) {
    const c = this.cell;
    if (!this.isWalkable(Math.floor(ax / c), Math.floor(az / c), opts)) return false;
    if (!this.isWalkable(Math.floor(bx / c), Math.floor(bz / c), opts)) return false;
    const cols = this.cols;
    const ref = opts && opts.elevRef;
    const elev = this.elev;
    if (ref !== undefined && (Math.abs(this.elevAt(ax, az) - ref) > MAX_STEP || Math.abs(this.elevAt(bx, bz) - ref) > MAX_STEP)) return false;
    // (the cell test is one function per grid, its rules in fields set for this call — walkableLine never re-enters: a
    // closure per call was steady garbage, path smoothing and every man's lane ask it many times a tick. `+ref`: the
    // number the subtraction used — null as 0)
    this._wlHasRef = ref !== undefined; this._wlRef = ref !== undefined ? +ref : 0; this._wlOpts = opts;
    const blocked = this._wlBlocked || (this._wlBlocked = (k) => {
      const i = k % this.cols;
      if (this._wlHasRef && Math.abs(this.elev[k] - this._wlRef) > MAX_STEP) return true;
      return !this.isWalkable(i, (k - i) / this.cols, this._wlOpts);
    });
    // (`_wlOpts` keeps the last call's options until the next one: the grid's own, nothing a mission unload misses)
    if (this._traverse(ax, az, bx, bz, blocked)) return false;
    if (this.runs && this.crossesRunSide(ax, az, bx, bz)) return false; // (on to a ramp / stair over its side)
    const r = opts && opts.clearance;
    if (r) {
      const len = Math.hypot(bx - ax, bz - az);
      if (len > 1e-6) {
        // (`avoidClearance`: the avoid mask — body clearance, already inflated by the body's reach — kept only that far
        // off by the offset lines; `clearance` is for walls and buildings)
        let side = blocked;
        const ra = opts.avoid && opts.avoidClearance != null ? Math.min(r, opts.avoidClearance) : null;
        if (ra != null) {
          const bare = { ...opts, avoid: null }, av = opts.avoid;
          side = (k) => { const i = k % cols; if (ref !== undefined && Math.abs(elev[k] - ref) > MAX_STEP) return true; return !this.isWalkable(i, (k - i) / cols, bare); };
          if (ra > 0) {
            const ox = (-(bz - az) / len) * ra, oz = ((bx - ax) / len) * ra, inMask = (k) => av[k] === 1;
            if (this._traverse(ax + ox, az + oz, bx + ox, bz + oz, inMask)) return false;
            if (this._traverse(ax - ox, az - oz, bx - ox, bz - oz, inMask)) return false;
          }
        }
        const nx = (-(bz - az) / len) * r, nz = ((bx - ax) / len) * r;
        if (this._traverse(ax + nx, az + nz, bx + nx, bz + nz, side)) return false;
        if (this._traverse(ax - nx, az - nz, bx - nx, bz - nz, side)) return false;
      }
    }
    return true;
  }

  /**
   * Nearest walkable cell centre to (x, z) within maxDist metres (ring search), or null.
   * @returns {{x:number, z:number, i:number, j:number} | null}
   */
  nearestWalkable(x, z, maxDist = 3, opts) {
    const c = this.cell;
    const ci = Math.floor(x / c), cj = Math.floor(z / c);
    // ({x, z, i, j} literals: a spread of cellCenter's {x, z} plus i, j reshaped every {x, z} point in the program)
    if (this.isWalkable(ci, cj, opts)) return { x: (ci + 0.5) * c, z: (cj + 0.5) * c, i: ci, j: cj };
    const maxR = Math.ceil(maxDist / c);
    let best = null, bestD = Infinity;
    for (let r = 1; r <= maxR; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di, j = cj + dj;
          if (!this.isWalkable(i, j, opts)) continue;
          const px = (i + 0.5) * c, pz = (j + 0.5) * c;
          const d = Math.hypot(px - x, pz - z);
          if (d < bestD && d <= maxDist + c) { bestD = d; best = { x: px, z: pz, i, j }; }
        }
      }
      // Any cell in a later ring is at least (r * c) away; stop when that exceeds the best found.
      if (best && bestD <= r * c) break;
    }
    return best;
  }

  /** Plain-object snapshot of all layers (for save games of destructible maps). */
  serialize() {
    const enc = (a) => Array.from(a);
    const hole = [];
    for (let k = 0; k < this.size; k++) if (this.fenceHole[k]) hole.push(this.fenceHole[k] === 2 ? -1 - k : k); // (side 2: −1 − k)
    return {
      width: this.width, depth: this.depth, cell: this.cell, block: enc(this.block), bridge: enc(this.bridge), owner: enc(this.owner),
      links: this.links.map((l) => ({ id: l.id, enabled: l.enabled })), // geometry comes from mission data
      hole, // holes cut through fences (sparse)
    };
  }

  /** Restore layers written by serialize() (terrain is rebuilt from mission data). */
  deserialize(data) {
    if (data.block) this.block.set(data.block);
    if (data.bridge) this.bridge.set(data.bridge);
    if (data.owner) this.owner.set(data.owner);
    this.fenceHole.fill(0);
    this.fenceHoleCount = 0;
    // (`crawl`: a save from when the cutters opened a crawl-only hole — the same cells are a walk-through hole now)
    for (const v of data.hole || data.crawl || []) {
      const k = v < 0 ? -1 - v : v;
      if (k < this.size && !this.fenceHole[k]) { this.fenceHole[k] = v < 0 ? 2 : 1; this.fenceHoleCount++; }
    }
    if (data.links) for (const l of data.links) { const x = this.links.find((y) => y.id === l.id); if (x) x.enabled = l.enabled; }
    this.version++;
  }
}
