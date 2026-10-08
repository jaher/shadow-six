/**
 * NavGrid — typed-array occupancy/terrain layers, line-of-sight and ray casts.
 * Pure module (no three.js). See docs/ARCHITECTURE.md § NavGrid.
 *
 * Cell (i, j) covers x ∈ [i·CELL, (i+1)·CELL), z ∈ [j·CELL, (j+1)·CELL).
 * @module world/grid
 */

import { pointInPolygon } from '../core/math.js';

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
/** A raised cell blocks sight when its elev exceeds both endpoint heights by more than this (m). */
export const LOS_CLEAR = 1.0;
/** Link kinds (§7.3 climbLinks / ladders). */
const EMPTY = Object.freeze([]);
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
     * ≠ 0 = a hole cut low in a wire fence (Sapper's cutters, abilities/sapper.js): open ground (block B.NONE) that only a
     * man on his belly gets through — isWalkable() passes it only with opts.crawl (commandos who can crawl; a standing
     * one goes prone at the hole, Commando._holeStance). Vehicles, enemies and anyone carrying a load go round. The
     * value (1 / 2) is the side its cut flap was peeled to (abilities/sapper.js normalSign). Saved.
     * @type {Uint8Array}
     */
    this.crawlway = new Uint8Array(n);
    /** Number of crawlway cells (0: nothing to look for). */
    this.crawlwayCount = 0;
    /**
     * Dynamic occluders (§4.2 OCLU, §10.2): B.* per cell, CLEARED AND RE-STAMPED EVERY SIM STEP by the
     * vehicles/trains system (clearDynamic() + stampDynamic()). Blocks sight (lineOfSight/castRay, unless
     * opts.dynamic === false); blocks movement only when isWalkable() gets opts.dynamic = true.
     * Writes bump `dynamicVersion`, never `version` (so static caches survive).
     * @type {Uint8Array}
     */
    this.dynamicBlock = new Uint8Array(n);
    this.dynamicVersion = 0;
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
     * Nav-only blocks (placement rule e, world/placement.js): cells where a structure's VISUAL stands outside its
     * gameplay footprint (steps, porches' posts, woodpiles, splayed tower legs) or where an idle movable prop
     * (pushable wagon) sits. Counted per stamp key; blocks walking (isWalkable), never sight or cover.
     * @type {Uint8Array}
     */
    this.navBlock = new Uint8Array(n);
    this._navStamps = new Map();
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
   *   avoid: Uint8Array mask (1 = keep out), e.g. body-clearance.avoidMask around vehicle hulls;
   *   crawl: a man who can crawl — the `crawlway` cells (holes cut in a fence) are open to him
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
    if (this.block[k] !== B.NONE || this.navBlock[k]) return false;
    if (this.crawlway[k] && !(opts && opts.crawl)) return false; // a hole cut low in a fence: on the belly only
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
   * Make cell k a crawlway (a hole cut low in a fence): open ground for crawlers only (block → B.NONE). The caller bumps
   * `version` once it is done.
   */
  setCrawlway(k, side = 1) {
    if (k < 0 || k >= this.size) return;
    this.block[k] = B.NONE;
    if (!this.crawlway[k]) this.crawlwayCount++;
    this.crawlway[k] = side === 2 ? 2 : 1;
  }

  /** Is (x, z) a `crawlway` cell (a hole cut low in a fence: crawlers only)? */
  crawlwayAt(x, z) {
    const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    return this.inBounds(i, j) && this.crawlway[this.idx(i, j)] !== 0;
  }

  /** Is a crawlway cell's centre within r (≤ 1 m) of (x, z)? (A diagonal hole is crossed at its cells' corner.) */
  crawlwayNear(x, z, r = 0.45) {
    if (!this.crawlwayCount) return false;
    const c = this.cell, i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c), j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!this.inBounds(i, j) || !this.crawlway[this.idx(i, j)]) continue;
      if (Math.hypot((i + 0.5) * c - x, (j + 0.5) * c - z) <= r) return true;
    }
    return false;
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
    this.version++;
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
    let n = 0;
    for (let k = 0; k < this.size; k++) {
      if (this.owner[k] === owner) {
        this.block[k] = B.NONE;
        this.bridge[k] = 0;
        this.owner[k] = 0;
        n++;
      }
    }
    if (n) this.version++;
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
    const dx = r.bx - r.ax, dz = r.bz - r.az, len = Math.hypot(dx, dz);
    if (!(len > 0.1)) return;
    (this.ramps ||= []).push({ ...r, ux: dx / len, uz: dz / len, len });
  }

  /**
   * Height a walker stands at (m): the sloped line of a ramp he is on (within its width and a cell of its graded strip),
   * else the cell's elev (elevAt).
   */
  surfaceY(x, z) {
    const e = this.elevAt(x, z);
    if (this.ramps) for (const r of this.ramps) {
      // only over its own graded cells: strictly between its ends' heights (not the landing / a wall walk beside it)
      if (e <= Math.min(r.ya, r.yb) + 0.01 || e >= Math.max(r.ya, r.yb) - 0.01) continue;
      const px = x - r.ax, pz = z - r.az, t = px * r.ux + pz * r.uz;
      if (t < -this.cell || t > r.len + this.cell || Math.abs(px * r.uz - pz * r.ux) > r.w / 2 + this.cell) continue;
      const y = r.ya + (r.yb - r.ya) * Math.min(1, Math.max(0, t / r.len));
      if (Math.abs(y - e) <= MAX_STEP) return y;
    }
    return e;
  }

  /** Is (x, z) on or within `m` m of a ramp (a walker there eases over the steps onto / off it)? */
  nearRamp(x, z, m = 1) {
    if (this.ramps) for (const r of this.ramps) {
      const px = x - r.ax, pz = z - r.az, t = px * r.ux + pz * r.uz;
      if (t >= -m && t <= r.len + m && Math.abs(px * r.uz - pz * r.ux) <= r.w / 2 + m) return true;
    }
    return false;
  }

  /** Can a unit step directly between adjacent cells ka and kb (elevation continuity)? */
  canStep(ka, kb) {
    return Math.abs(this.elev[ka] - this.elev[kb]) <= MAX_STEP;
  }

  // ---------------------------------------------------------------- dynamic occluders (§4.2 OCLU)

  /** Zero the dynamic layer. Called once per sim step before vehicles/trains re-stamp themselves. */
  clearDynamic() {
    if (this._dynamicDirty) {
      this.dynamicBlock.fill(0);
      this._dynamicDirty = false;
      this.dynamicVersion++;
    }
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
        const p = this.cellCenter(i, j);
        const dx = p.x - cx, dz = p.z - cz;
        const u = dx * c + dz * s, v = -dx * s + dz * c;
        if (Math.abs(u) <= w / 2 && Math.abs(v) <= d / 2) {
          const k = this.idx(i, j);
          if (value > this.dynamicBlock[k]) this.dynamicBlock[k] = value;
          n++;
        }
      }
    }
    if (n) { this._dynamicDirty = true; this.dynamicVersion++; }
    return n;
  }

  /**
   * Nav-only block stamp (see navBlock): replaces the cells previously stamped under `key` with `cells`
   * (cell indices). Bumps `version` when anything changed (paths replan).
   * @param {string} key @param {Iterable<number>} cells
   */
  navStamp(key, cells) {
    const prev = this._navStamps.get(key), next = new Set(cells);
    if (prev) for (const k of prev) if (!next.has(k) && this.navBlock[k]) this.navBlock[k]--;
    for (const k of next) if (!prev || !prev.has(k)) this.navBlock[k] = Math.min(255, this.navBlock[k] + 1);
    if (next.size) this._navStamps.set(key, next); else this._navStamps.delete(key);
    this.version++;
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
    for (const k of touched) {
      let lo = Infinity, hi = -Infinity, slo = Infinity, shi = -Infinity;
      for (const st of this._overStamps.values()) {
        const r = st.cells.get(k);
        if (!r) continue;
        if (st.soft) { if (r[0] < slo) slo = r[0]; if (r[1] > shi) shi = r[1]; } else { if (r[0] < lo) lo = r[0]; if (r[1] > hi) hi = r[1]; }
      }
      this.overLo[k] = lo; this.overHi[k] = hi; this.softLo[k] = slo; this.softHi[k] = shi;
    }
    this.version++;
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
   * @param {{roles?: string[]|null, enabled?: boolean, cost?: number, id?: number}} [opts]
   *   roles default: climb → ['greenberet'] (spec §3.3), ladder → null (everyone)
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
   * B's cell. `visit(k, tEnter)` returns true to stop; tEnter is the parametric entry (0..1).
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
        if (!(ni === ti && j === tj) && this.inBounds(ni, j) && visit(this.idx(ni, j), t)) return true;
        if (!(i === ti && nj === tj) && this.inBounds(i, nj) && visit(this.idx(i, nj), t)) return true;
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
      if (visit(this.idx(i, j), t)) return true;
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
    const blocked = this._traverse(ax, az, bx, bz, (k, t) => {
      // the viewer's own bunker: he looks out of its slit; a `passOwners` structure: the bullet goes through
      const b = (ownOwner && owner[k] === ownOwner) || (pass && owner[k] && pass.has(owner[k])) ? B.NONE : block[k];
      if ((b === B.HIGH || (lowBlocks && b === B.LOW)) && !(over && over(k, t))) return true;
      if (elev[k] > hy) return true;
      if (useDyn) { const d = dyn[k]; if ((d === B.HIGH || (lowBlocks && d === B.LOW)) && !(own && own(k)) && !(tgt && tgt(k))) return true; }
      return false;
    });
    return !blocked;
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
    this._traverse(ax, az, ex, ez, (k, t) => {
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
   * @param {{swim?: boolean, clearance?: number, dynamic?: boolean, elevRef?: number}} [opts]
   */
  walkableLine(ax, az, bx, bz, opts) {
    const c = this.cell;
    if (!this.isWalkable(Math.floor(ax / c), Math.floor(az / c), opts)) return false;
    if (!this.isWalkable(Math.floor(bx / c), Math.floor(bz / c), opts)) return false;
    const cols = this.cols;
    const ref = opts && opts.elevRef;
    const elev = this.elev;
    if (ref !== undefined && (Math.abs(this.elevAt(ax, az) - ref) > MAX_STEP || Math.abs(this.elevAt(bx, bz) - ref) > MAX_STEP)) return false;
    const blocked = (k) => {
      const i = k % cols;
      if (ref !== undefined && Math.abs(elev[k] - ref) > MAX_STEP) return true;
      return !this.isWalkable(i, (k - i) / cols, opts);
    };
    if (this._traverse(ax, az, bx, bz, blocked)) return false;
    const r = opts && opts.clearance;
    if (r) {
      const len = Math.hypot(bx - ax, bz - az);
      if (len > 1e-6) {
        const nx = (-(bz - az) / len) * r, nz = ((bx - ax) / len) * r;
        if (this._traverse(ax + nx, az + nz, bx + nx, bz + nz, blocked)) return false;
        if (this._traverse(ax - nx, az - nz, bx - nx, bz - nz, blocked)) return false;
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
    if (this.isWalkable(ci, cj, opts)) return { ...this.cellCenter(ci, cj), i: ci, j: cj };
    const maxR = Math.ceil(maxDist / c);
    let best = null, bestD = Infinity;
    for (let r = 1; r <= maxR; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di, j = cj + dj;
          if (!this.isWalkable(i, j, opts)) continue;
          const p = this.cellCenter(i, j);
          const d = Math.hypot(p.x - x, p.z - z);
          if (d < bestD && d <= maxDist + c) { bestD = d; best = { ...p, i, j }; }
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
    const crawl = [];
    for (let k = 0; k < this.size; k++) if (this.crawlway[k]) crawl.push(this.crawlway[k] === 2 ? -1 - k : k); // (side 2: −1 − k)
    return {
      width: this.width, depth: this.depth, cell: this.cell, block: enc(this.block), bridge: enc(this.bridge), owner: enc(this.owner),
      links: this.links.map((l) => ({ id: l.id, enabled: l.enabled })), // geometry comes from mission data
      crawl, // holes cut in fences (sparse)
    };
  }

  /** Restore layers written by serialize() (terrain is rebuilt from mission data). */
  deserialize(data) {
    if (data.block) this.block.set(data.block);
    if (data.bridge) this.bridge.set(data.bridge);
    if (data.owner) this.owner.set(data.owner);
    this.crawlway.fill(0);
    this.crawlwayCount = 0;
    if (data.crawl) for (const v of data.crawl) {
      const k = v < 0 ? -1 - v : v;
      if (k < this.size && !this.crawlway[k]) { this.crawlway[k] = v < 0 ? 2 : 1; this.crawlwayCount++; }
    }
    if (data.links) for (const l of data.links) { const x = this.links.find((y) => y.id === l.id); if (x) x.enabled = l.enabled; }
    this.version++;
  }
}
