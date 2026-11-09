/**
 * Grid pathfinding: 8-connected A* (binary heap, octile heuristic, no corner cutting) followed by
 * string-pulling with a walkability line test. Pure module (no three.js).
 * See docs/ARCHITECTURE.md § Pathfinding.
 * @module world/pathfinding
 */

import { T, B, MAX_STEP, NavGrid } from './grid.js';
import { anyFields } from '../core/shapes.js';

const SQRT2 = Math.SQRT2;
/** Extra cost factor for wading through shallow water / swimming, so land & bridges are preferred. */
const WATER_COST = 1.8;
/** Max distance (m) to look for a walkable substitute when the goal (or start) cell is blocked. */
export const NEAREST_WALKABLE_RADIUS = 3;
/** Clearance used by string pulling (m, < CELL/2) so smoothed paths don't graze wall corners. */
/** Clearance (m) of a path's goal from structure-blocked cells (clearOfWalls; within the goal's own cell). */
export const GOAL_CLEARANCE = 0.45;
export const SMOOTH_CLEARANCE = 0.35; // agent body radius (placement rule e): smoothed legs keep arms and rifle off walls
/** Clearance (m) a taut (player's) path keeps off the body-clearance mask, past the mask's own inflation. */
export const AVOID_CLEARANCE = 0.2;

/** Min-heap of node indices keyed by an external Float64Array of f-scores. */
class NodeHeap {
  /** `items`: the array to keep the heap in (buffers' own, grown as needed and kept for the next search: no 4 KB array
   * made per search) or a capacity. */
  constructor(items, f) {
    this.items = typeof items === 'number' ? new Int32Array(items) : items;
    this.size = 0;
    this.f = f;
  }

  push(n) {
    if (this.size >= this.items.length) {
      const grown = new Int32Array(this.items.length * 2);
      grown.set(this.items);
      this.items = grown;
    }
    const a = this.items, f = this.f, fn = f[n];
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1, ap = a[p];
      if (f[ap] <= fn) break;
      a[i] = ap;
      i = p;
    }
    a[i] = n;
  }

  pop() {
    // (the same sift as ever — each key read once per step, the last item's once: f is only read here, never written)
    const a = this.items, f = this.f;
    const top = a[0];
    const size = --this.size, last = a[size], fl = f[last];
    let i = 0;
    const half = size >> 1;
    while (i < half) {
      let c = 2 * i + 1, ac = a[c], fc = f[ac];
      if (c + 1 < size) { const ar = a[c + 1], fr = f[ar]; if (fr < fc) { c++; ac = ar; fc = fr; } }
      if (fc >= fl) break;
      a[i] = ac;
      i = c;
    }
    a[i] = last;
    return top;
  }
}

/** Per-grid scratch buffers, reused between searches (stamp trick avoids clearing). */
const scratch = new WeakMap();
function buffers(grid) {
  let b = scratch.get(grid);
  if (!b || b.n !== grid.size) {
    b = {
      n: grid.size,
      // (by slot: a search numbers the cells it reaches in the order it reaches them — the heap's keys, the g a step
      // compares, lie together in these, not spread over the map: a blast tick's searches waited on memory)
      g: new Float64Array(grid.size),
      f: new Float64Array(grid.size),
      parent: new Int32Array(grid.size), // the slot it was reached from (-1: the start)
      via: new Int32Array(grid.size), // link id used to reach the node (0 = grid step)
      cellOf: new Int32Array(grid.size),
      heap: new Int32Array(1024), // (the open set's array, kept between searches: NodeHeap grows it, searchPath keeps the growth)
      // (by cell: 2·search → reached this search, its slot in slotOf; 2·search + 1 → closed)
      st: new Uint32Array(grid.size),
      slotOf: new Int32Array(grid.size),
      search: 0,
    };
    scratch.set(grid, b);
  }
  b.search++;
  if (b.search >= 0x7ffffff0) {
    b.st.fill(0);
    b.search = 1;
  }
  return b;
}

const EMPTY_SETS = Object.freeze([]);
const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
/** The map sides a step in each direction needs room on (areasFor's flood: 1 east, 2 west, 4 south, 8 north). */
const NBR_NEED = [1, 2, 4, 8, 5, 9, 6, 10];

/**
 * Find a path on the NavGrid.
 * @param {import('./grid.js').NavGrid} grid
 * @param {number} sx start x (m)
 * @param {number} sz start z (m)
 * @param {number} tx target x (m)
 * @param {number} tz target z (m)
 * @param {{swim?: boolean, maxNodes?: number, smooth?: boolean, taut?: boolean, role?: string, dynamic?: boolean, noLinks?: boolean, noWalkLinks?: boolean, dive?: boolean, avoid?: Uint8Array, fire?: Uint8Array, nearRadius?: number, lying?: boolean}} [opts]
 *   dive: a submerged diver, who also passes grid `underpass` cells (NavGrid.isWalkable).
 *   lying: a crawler's path — on and off ramps and stairs head-on, along their middle (alignRuns).
 *   taut: pull the smoothed path taut (tautenPath: bends only at the real corners; a player's commandos).
 *   avoid: extra keep-out mask (grid.isWalkable opts.avoid; body clearance around vehicles). nearRadius: how far (m) a
 *   blocked start / goal looks for a walkable substitute (default 3). fire: the grid's `fire` layer — burning cells are
 *   kept out of like the mask's (the enemies, world/fires.js; its own caches keyed by grid.fireVersion).
 *   role: unit role for off-grid links (grid.linkAllowed; undefined → only links open to everyone,
 *   '*' → every enabled link). noLinks: plan on grid steps only (no climb edges / ladders — §3.4 a
 *   commando carrying a body or barrel walks around them); the walked links (a stair link, a plank: `walk`) stay
 *   open unless noWalkLinks too. dynamic: treat grid.dynamicBlock as blocking (vehicles this step).
 * @returns {{x:number, z:number, y?:number, link?:{id:number, kind:string, walk?:string}}[] | null} waypoints
 *   including the (possibly substituted) start and goal, or null when unreachable. A waypoint reached by
 *   traversing an off-grid link carries `link` (and `y`, the link end height): the unit must climb /
 *   use the ladder from the previous waypoint (the link's other end) to this one.
 */
/**
 * Rule (e) goals: a destination closer than the body radius to a structure-blocked cell (block or navBlock: walls,
 * buildings, their visual reach) is pushed away from it, within its own cell, so the unit does not stop with a
 * shoulder, boot or rifle in the wall. Water and map edges don't count.
 * @returns {{x:number, z:number}}
 */
export function clearOfWalls(grid, x, z, i = Math.floor(x / grid.cell), j = Math.floor(z / grid.cell), r = SMOOTH_CLEARANCE) {
  const { cols, rows, block, navBlock, cell: c } = grid;
  const x0 = i * c, z0 = j * c, m = r; // (as far as its own cell allows: the clamp below)
  let px = x, pz = z, moved = false;
  for (let pass = 0; pass < 2; pass++) {
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
      const k = jj * cols + ii;
      if (block[k] === B.NONE && !(navBlock && navBlock[k])) continue;
      // nearest point of that cell's square
      const qx = Math.min(Math.max(px, ii * c), (ii + 1) * c), qz = Math.min(Math.max(pz, jj * c), (jj + 1) * c);
      const dx = px - qx, dz = pz - qz, d = Math.hypot(dx, dz);
      if (d >= m - 1e-9) continue;
      if (d > 1e-9) { px = qx + (dx / d) * m; pz = qz + (dz / d) * m; } else { px -= di * (m - d); pz -= dj * (m - d); }
      moved = true;
    }
    if (moved) { px = Math.min(Math.max(px, x0 + 0.01), x0 + c - 0.01); pz = Math.min(Math.max(pz, z0 + 0.01), z0 + c - 0.01); }
  }
  return moved ? { x: px, z: pz } : { x, z };
}

/** Extra cost factor of a cell edge-adjacent to a blocked cell (walls, buildings, visual nav blocks). */
export const HUG_COST = 1.35;
/** staticLayers' step cost codes → the factor: 0 open ground, 1 beside a wall (HUG_COST), 2 water or shallows off a bridge. */
const MUL_OF = new Float64Array([1, HUG_COST, WATER_COST]);
/** Is cell (i, j) edge-adjacent to a structure-blocked cell (block or navBlock; water and map edges don't count)? */
export function hugsObstacle(grid, i, j) {
  const { cols, rows, block, navBlock } = grid;
  for (let q = 0; q < 4; q++) {
    const ii = i + (q === 0) - (q === 1), jj = j + (q === 2) - (q === 3);
    if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
    const k = jj * cols + ii;
    if (block[k] !== B.NONE || (navBlock && navBlock[k])) return true;
  }
  return false;
}

/**
 * The static layers every search reads at each neighbour, worked out once per grid version (like areasFor's labels,
 * kept until the grid's layers change): `open[swim]` — grid.isWalkable's static test (block, nav stamps, cut fence
 * holes, bridges, water) without the dynamic layer or a clearance mask; `mul` — the step's cost factor on that cell as
 * a code, MUL_OF[code] (WATER_COST on water or shallows off a bridge, else HUG_COST beside a wall: hugsObstacle, else
 * 1). Same answers as the tests made cell by cell; a blast's tick reads them a few hundred thousand times.
 */
const _layers = new WeakMap();
/** staticLayers' open test for cells [k0, k1) into `o`. */
function openRows(grid, swim, o, k0, k1) {
  const { block, navBlock, fenceHole, bridge, terrain } = grid, NONE = B.NONE;
  for (let k = k0; k < k1; k++) o[k] = block[k] !== NONE || (navBlock[k] && !fenceHole[k]) ? 0 : bridge[k] ? 1 : terrain[k] === T.WATER ? (swim ? 1 : 0) : 1;
}
/**
 * staticLayers' dive test for cells [k0, k1) into `o` (grid.isWalkable with opts.dive, but for its `underpass` cells,
 * which a search reads off the grid itself: a deck_underpass set-piece flags them without a new grid version): open
 * water or shallows, off a bridge, no structure, no nav stamp.
 */
function openRowsDive(grid, o, k0, k1) {
  const { block, navBlock, bridge, terrain } = grid, NONE = B.NONE, W = T.WATER, S = T.SHALLOW;
  for (let k = k0; k < k1; k++) { const t = terrain[k]; o[k] = (t === W || t === S) && !bridge[k] && block[k] === NONE && !navBlock[k] ? 1 : 0; }
}
/** staticLayers' step cost factor for rows [j0, j1) into `m`, as a code: MUL_OF[code] (a byte a cell, not a double: an eighth of
 * the memory a search reads at each neighbour and a blast's tick copies at each version — the same factors). */
function mulRows(grid, m, j0, j1) {
  // (a row per call: one long call with the loop over a row inside was compiled on the stack for the row loop and thrown
  // out again at every row's end — ~200 deopts, a few ms, at the first search of a mission)
  for (let j = j0; j < j1; j++) mulRow(grid, m, j);
}
function mulRow(grid, m, j, ia = 0, ib = grid.cols - 1) {
  const { block, navBlock, bridge, terrain, cols, rows } = grid, NONE = B.NONE;
  for (let i = ia, k = j * cols + ia; i <= ib; i++, k++) {
    const t = terrain[k];
    if ((t === T.WATER || t === T.SHALLOW) && !bridge[k]) m[k] = 2;
    else m[k] = (i + 1 < cols && (block[k + 1] !== NONE || !!navBlock[k + 1])) || (i > 0 && (block[k - 1] !== NONE || !!navBlock[k - 1]))
      || (j + 1 < rows && (block[k + cols] !== NONE || !!navBlock[k + cols])) || (j > 0 && (block[k - cols] !== NONE || !!navBlock[k - cols])) ? 1 : 0;
  }
}
/**
 * The step masks of rows [j0, j1) into `nb` over the walk layer `o` (staticLayers' nb): bit d (DI / DJ's order: E W S N,
 * SE NE SW NW) when the neighbour that way is on the map, open in `o` and a step reaches it (grid.canStep's height and
 * run tests from this cell) — and for a diagonal, when both edge neighbours beside it are so too (no corner cutting).
 * searchPath's fast path reads one byte a cell expanded for the eight neighbours' static walk and step tests; the
 * vehicles, the clearance mask and the search's own state it still reads cell by cell. Same tests, same order.
 */
function stepMaskRows(grid, o, nb, j0, j1) {
  for (let j = j0; j < j1; j++) stepMaskRow(grid, o, nb, j);
}
function stepMaskRow(grid, o, nb, j, ia = 0, ib = grid.cols - 1) {
  const cols = grid.cols, rows = grid.rows, elev = grid.elev, runOf = grid.runOf;
  for (let i = ia, k = j * cols + ia; i <= ib; i++, k++) {
    const ek = elev[k], rk = runOf ? runOf[k] : 0;
    const kE = k + 1, kW = k - 1, kS = k + cols, kN = k - cols;
    const e = i + 1 < cols && o[kE] === 1 && Math.abs(ek - elev[kE]) <= MAX_STEP && (!runOf || rk === runOf[kE] || grid.canStep(k, kE));
    const w = i > 0 && o[kW] === 1 && Math.abs(ek - elev[kW]) <= MAX_STEP && (!runOf || rk === runOf[kW] || grid.canStep(k, kW));
    const s = j + 1 < rows && o[kS] === 1 && Math.abs(ek - elev[kS]) <= MAX_STEP && (!runOf || rk === runOf[kS] || grid.canStep(k, kS));
    const n = j > 0 && o[kN] === 1 && Math.abs(ek - elev[kN]) <= MAX_STEP && (!runOf || rk === runOf[kN] || grid.canStep(k, kN));
    let m = (e ? 1 : 0) | (w ? 2 : 0) | (s ? 4 : 0) | (n ? 8 : 0);
    if (e && s) { const q = kS + 1; if (o[q] === 1 && Math.abs(ek - elev[q]) <= MAX_STEP && (!runOf || rk === runOf[q] || grid.canStep(k, q))) m |= 16; }
    if (e && n) { const q = kN + 1; if (o[q] === 1 && Math.abs(ek - elev[q]) <= MAX_STEP && (!runOf || rk === runOf[q] || grid.canStep(k, q))) m |= 32; }
    if (w && s) { const q = kS - 1; if (o[q] === 1 && Math.abs(ek - elev[q]) <= MAX_STEP && (!runOf || rk === runOf[q] || grid.canStep(k, q))) m |= 64; }
    if (w && n) { const q = kN - 1; if (o[q] === 1 && Math.abs(ek - elev[q]) <= MAX_STEP && (!runOf || rk === runOf[q] || grid.canStep(k, q))) m |= 128; }
    nb[k] = m;
  }
}
/** staticLayers' step masks for walk layer `si` (0 on foot, 1 swimming), made in full at their first use. */
function stepMasksOf(L, grid, si) {
  let b = L.nb[si];
  if (!b) { b = new Uint8Array(grid.size); stepMaskRows(grid, L.open[si], b, 0, grid.rows); L.nb[si] = b; }
  return b;
}
/** The cells k in [k0, k1) where layers `a` and `b` differ, onto `out`. */
function changedCells(a, b, k0, k1, out) {
  for (let k = k0; k < k1; k++) if (a[k] !== b[k]) out.push(k);
}
/**
 * The static layers' changes from one version to the next, as staticLayers' row path made them (the last LAYER_LOG_MAX):
 * `from` → `to`, the cells whose walk test (on foot, swimming) or step cost changed, `have` which layers were compared
 * (1 on foot, 2 swimming, 4 the costs; one made afresh later is not). A version reached by a whole rebuild (a plain bump,
 * the links changed) has no record: nothing before it carries over (findPath's carryChains).
 */
const _layerLog = new WeakMap();
const LAYER_LOG_MAX = 32;
function logLayers(grid, from, to, ch, have) {
  let log = _layerLog.get(grid);
  if (!log) _layerLog.set(grid, (log = []));
  log.push({ from, to, ch: Int32Array.from(ch), have });
  if (log.length > LAYER_LOG_MAX) log.shift();
}
/** staticLayers' walk layer `si` (1 swimming, 2 diving) at L's version: patched from the last version that had it
 * (L.src: its array, the rows changed since), else made whole. The swimmers' step masks come along when that version had
 * them (stepMasksOf otherwise makes them whole). */
function layerOf(grid, L, si) {
  const N = grid.size, S = L.src[si];
  if (S) {
    const o = S.o.slice(), cols = grid.cols;
    for (let j = S.j0; j < S.j1; j++) { const a = j * cols + S.ia, b = j * cols + S.ib + 1; if (si === 2) openRowsDive(grid, o, a, b); else openRows(grid, si === 1, o, a, b); }
    L.open[si] = o;
    if (si === 1 && S.nb) { const b = S.nb.slice(); for (let j = S.j0; j < S.j1; j++) stepMaskRow(grid, o, b, j, S.ia, S.ib); L.nb[1] = b; }
    L.src[si] = null;
  } else {
    const o = new Uint8Array(N);
    if (si === 2) openRowsDive(grid, o, 0, N); else openRows(grid, si === 1, o, 0, N);
    L.open[si] = o;
  }
  return L.open[si];
}
/** The step masks of this grid version for tests (tests/unit/step-masks): on foot, or swimming. */
export function stepMasksFor(grid, swim = false) { return stepMasksOf(staticLayers(grid, swim), grid, swim ? 1 : 0); }
/** staticLayers for tests: the per-version open / cost layers a search reads (tests/unit/static-layers). */
export function staticLayersOf(grid, swim = false) { return staticLayers(grid, swim); }
function staticLayers(grid, swim, costs = true, dive = false) {
  let L = _layers.get(grid);
  if (!L || L.version !== grid.version || L.size !== grid.size || L.links !== grid.links || L.index !== grid._linkIndex) {
    // the grid changed within known rows only since L (NavGrid.dirtyRowsSince: a blast's destroyed solids and nav
    // stamps): those rows (± 1: a cell's cost reads its neighbours) are redone on copies — a search still running on L
    // keeps its own arrays — instead of the whole grid in the blast's tick
    const same = L && L.size === grid.size && L.links === grid.links && L.index === grid._linkIndex;
    const d = same ? grid.dirtyRowsSince?.(L.version) : null;
    const P = d ? L : null;
    L = { version: grid.version, size: grid.size, links: grid.links, index: grid._linkIndex, open: [null, null, null], mul: null, linked: undefined, nb: [null, null], src: [null, null, null] };
    if (P) {
      // (the rectangle the writers named — NavGrid's dirty log keeps their columns too — grown by one cell: a cost reads
      // its four neighbours, a step mask its eight)
      const cols = grid.cols, j0 = Math.max(0, d.j0 - 1), j1 = Math.min(grid.rows, d.j1 + 2), ia = Math.max(0, d.i0 - 1), ib = Math.min(cols - 1, d.i1 + 1);
      // (and the cells whose walk test or step cost the redone rows changed, logged: findPath's chain reuse across versions)
      const ch = [];
      if (P.open[0]) { const o = P.open[0].slice(); for (let j = j0; j < j1; j++) { const a = j * cols + ia, b = j * cols + ib + 1; openRows(grid, false, o, a, b); changedCells(P.open[0], o, a, b, ch); } L.open[0] = o; }
      if (P.mul) { const m = P.mul.slice(); for (let j = j0; j < j1; j++) { mulRow(grid, m, j, ia, ib); changedCells(P.mul, m, j * cols + ia, j * cols + ib + 1, ch); } L.mul = m; }
      L.linked = P.linked;
      if (P.nb[0] && L.open[0]) { const b = P.nb[0].slice(); for (let j = j0; j < j1; j++) stepMaskRow(grid, L.open[0], b, j, ia, ib); L.nb[0] = b; }
      // (the swimming and diving layers — and the swimmers' masks — when first asked at this version: from the last
      // version that had them, its rectangle since redone (layerOf); a blast's tick asks for few of them)
      for (const si of [1, 2]) {
        const Q = P.src[si];
        L.src[si] = P.open[si] ? { o: P.open[si], nb: si === 1 ? P.nb[1] : null, j0, j1, ia, ib }
          : Q ? { o: Q.o, nb: Q.nb, j0: Math.min(Q.j0, j0), j1: Math.max(Q.j1, j1), ia: Math.min(Q.ia, ia), ib: Math.max(Q.ib, ib) } : null;
      }
      logLayers(grid, P.version, L.version, ch, (P.open[0] ? 1 : 0) | (P.mul ? 4 : 0));
    }
    _layers.set(grid, L);
  }
  const si = dive ? 2 : swim ? 1 : 0, N = grid.size;
  if (!L.open[si]) layerOf(grid, L, si);
  if (!costs) return L; // (areasFor: the open cells only)
  if (!L.mul) { const m = new Uint8Array(N); mulRows(grid, m, 0, grid.rows); L.mul = m; }
  // (the cells a link touches — grid.linksAt's own index — as flags: most expanded cells have none to look up)
  if (L.linked === undefined) {
    const idx = grid._linkIndex;
    if (idx instanceof Map) { const f = new Uint8Array(N); for (const k of idx.keys()) if (k >= 0 && k < N) f[k] = 1; L.linked = f; } else L.linked = null;
  }
  return L;
}

/**
 * Failed searches remembered within one epoch (World.findPath passes the world tick as `opts.memo`): a search that
 * failed after reaching EVERY cell it could reach (its heap ran dry, not its node cap) leaves the set R of those cells —
 * whatever its goal was. A later search under the same walk rules (swim / dive, the same avoid mask, role, links) from a
 * start inside R to a goal outside R cannot succeed (whatever it reaches, the first start reached too): it returns null
 * at once — exactly what its own full search would return. A blast heard by every guard on the map, inside a bunker none
 * of them can reach, cost ~100 such floods in one tick (M3: 2 s). Never for `dynamic` searches (the vehicle layer is
 * restamped within a tick); a new epoch or a new grid version starts afresh.
 */
const failMemos = new WeakMap();
/** Cells expanded by every A* search so far (a running count: callers budget their searches per tick by it). */
export const searchStats = { expanded: 0 };
/** How often findPath answered from a search it kept (tests): the same points (`found`), the same two cells (`chain`). */
export const reuseStats = { found: 0, chain: 0 };
const maskIds = new WeakMap();
let nextMaskId = 1;
/** Failed-search sets kept per epoch (each a byte per cell). */
const FAIL_MEMO_MAX = 24;
function failMemo(grid, epoch) {
  let m = failMemos.get(grid);
  if (!m || m.epoch !== epoch || m.version !== grid.version) {
    m = { epoch, version: grid.version, sets: new Map(), pockets: new Map(), n: 0 };
    failMemos.set(grid, m);
  }
  return m;
}
/**
 * The goals (failKey|goal cell) found this grid version to have more than POCKET_MAX cells able to reach them: in no small
 * pocket, whatever the start — searchPath skips the pocket test for them. Kept for the grid version, not the epoch (the
 * failed-search memo's tick): the enumeration reads the grid as it stands under the key's rules and mask (a mask is never
 * written once made) and nothing else — and a goal found wide only lets the search run on, as the test would have. M14's
 * squads re-plan to one goal tick after tick: each tick's first search flooded its pocket again (0.2-1.3 ms).
 */
const _wide = new WeakMap();
function wideOf(grid) {
  let W = _wide.get(grid);
  if (!W || W.version !== grid.version) _wide.set(grid, (W = { version: grid.version, set: new Set() }));
  return W.set;
}
function failKey(walkOpts, opts) {
  let mask = 0;
  if (walkOpts.avoid) { mask = maskIds.get(walkOpts.avoid); if (!mask) maskIds.set(walkOpts.avoid, (mask = nextMaskId++)); }
  return `${walkOpts.swim ? 1 : 0}${walkOpts.dive ? 1 : 0}${opts.noLinks ? 1 : 0}${opts.noWalkLinks ? 1 : 0}|${mask}|${opts.role ?? ''}${walkOpts.fire ? `|f${walkOpts.fireV}` : ''}`;
}

/**
 * Connected areas of the static walkable grid, per walk rules (swim / dive, the links a role may take): a label per cell,
 * 0 = not walkable. Two cells with different labels have no path between them under ANY search on top of those rules —
 * the labelling takes every step a search may take (either direction of a step, diagonals whenever both cells are open,
 * every allowed link) and nothing the vehicle layer (`dynamic`) or a body-clearance mask (`avoid`) adds can only take
 * cells away. So a search whose goal lies in another area returns null at once, exactly what its own full flood would
 * return: guards who hear a blast in a pit none of them can enter (M11's sealed quarry: ~20–55 ms a flood, a dozen in
 * one tick) no longer flood the map one by one. Built lazily, kept until the grid's static layers or links change.
 */
const _areas = new WeakMap();
function linksSig(grid) {
  const L = grid.links || [];
  let n = 0, s = 0;
  for (const l of L) if (l.enabled) { n++; s = (s * 31 + (l.id | 0)) % 2147483647; }
  return `${L.length}:${n}:${s}`;
}
/**
 * The links a search under these rules may take (enabled, open to `role`, walked ones only under noLinks), as a key: a
 * labelling depends on the role only through them — the squad's men and the guards, allowed the same links, share one
 * (M3's four men boarding the truck built four, ~4 ms each, in one tick). Memoised per links array and enabled state.
 */
const _allowed = new WeakMap();
function allowedSig(grid, role, opts) {
  const L = grid.links || [];
  let m = _allowed.get(L);
  const en = linksSig(grid);
  if (!m || m.en !== en) { m = { en, map: new Map() }; _allowed.set(L, m); }
  const k = `${role ?? ''}|${opts.noLinks ? 1 : 0}`;
  let sig = m.map.get(k);
  if (sig === undefined) {
    const ids = [];
    for (const l of L) if (grid.linkAllowed(l, role) && !(opts.noLinks && !l.walk)) ids.push(l.id);
    sig = ids.join(',');
    m.map.set(k, sig);
  }
  return sig;
}
function areaKey(grid, walkOpts, role, opts, hasLinks) {
  const sig = hasLinks ? allowedSig(grid, role, opts) : '-';
  return `${walkOpts.swim ? 1 : 0}${walkOpts.dive ? 1 : 0}${opts.noLinks ? 1 : 0}${opts.noWalkLinks ? 1 : 0}|${sig}`;
}
/** The rules (swim, role, noLinks, noWalkLinks) labellings were built for, oldest first (rewarmAreas). */
const _recent = new WeakMap();
const RECENT_MAX = 12;
/** The labelling areasFor would return, when this grid version already has it (built by a search, warmAreas or
 * rewarmAreas); else null — nothing is built. */
function areasCached(grid, walkOpts, role, opts, hasLinks) {
  const per = _areas.get(grid);
  const lab = per && per.version === grid.version && per.links === grid.links ? per.map.get(areaKey(grid, walkOpts, role, opts, hasLinks)) : null;
  if (!lab) noteRules(grid, walkOpts, role, opts); // (a search ran under these rules without it: rewarmAreas builds it)
  return lab || null;
}
/** Note the rules (swim, role, noLinks, noWalkLinks) a search ran under, for rewarmAreas (newest last, RECENT_MAX kept). */
function noteRules(grid, walkOpts, role, opts) {
  let rec = _recent.get(grid);
  if (!rec) _recent.set(grid, (rec = new Map()));
  const rk = `${walkOpts.swim ? 1 : 0}${opts.noLinks ? 1 : 0}${opts.noWalkLinks ? 1 : 0}|${role ?? ''}`;
  if (!rec.has(rk)) {
    rec.set(rk, [!!walkOpts.swim, role, !!opts.noLinks, !!opts.noWalkLinks]);
    if (rec.size > RECENT_MAX) rec.delete(rec.keys().next().value);
  }
}
function areasFor(grid, walkOpts, role, opts, hasLinks) {
  let per = _areas.get(grid);
  if (!per || per.version !== grid.version || per.links !== grid.links) { per = { version: grid.version, links: grid.links, map: new Map() }; _areas.set(grid, per); }
  const key = areaKey(grid, walkOpts, role, opts, hasLinks);
  let lab = per.map.get(key);
  if (lab) return lab;
  noteRules(grid, walkOpts, role, opts);
  const cols = grid.cols, rows = grid.rows, N = grid.size, bare = { swim: !!walkOpts.swim, dive: !!walkOpts.dive };
  let open;
  if (bare.dive) { open = new Uint8Array(N); for (let j = 0, k = 0; j < rows; j++) for (let i = 0; i < cols; i++, k++) open[k] = grid.isWalkable(i, j, bare) ? 1 : 0; }
  // (grid.isWalkable's own test for these rules, cell by cell: no dynamic layer, no mask — the searches' own copy)
  else open = staticLayers(grid, bare.swim, false).open[bare.swim ? 1 : 0];
  // (the grid changed only in known rows since these rules were last labelled — a blast's cleared cells, its nav stamps:
  // NavGrid.dirtyRowsSince — and no cell there went from open to shut: the last labelling, joined where the cells that
  // opened join it — the same partition a full flood gives, ~0.5 ms instead of ~3 ms after each of a blast's bumps)
  const lastOf = _areasLast.get(grid) || (_areasLast.set(grid, new Map()), _areasLast.get(grid)), last = lastOf.get(key);
  if (!bare.dive && last && last.links === grid.links) {
    const inc = relabelOpened(grid, last, open, role, opts, hasLinks);
    if (inc) {
      per.map.set(key, inc.lab);
      lastOf.set(key, { version: grid.version, links: grid.links, lab: inc.lab, open, next: inc.next });
      return inc.lab;
    }
  }
  // (links by cell, the ones this search may take)
  let adj = null, adjAt = null;
  if (hasLinks) {
    adj = new Map(); adjAt = new Uint8Array(N);
    for (const L of grid.links) {
      if (!grid.linkAllowed(L, role) || (opts.noLinks && !L.walk)) continue;
      if (!open[L.ka] || !open[L.kb]) continue;
      (adj.get(L.ka) || adj.set(L.ka, []).get(L.ka)).push(L.kb);
      (adj.get(L.kb) || adj.set(L.kb, []).get(L.kb)).push(L.ka);
      adjAt[L.ka] = adjAt[L.kb] = 1;
    }
  }
  lab = new Int32Array(N);
  const queue = new Int32Array(N), elev = grid.elev, runOf = grid.runOf;
  let next = 0;
  for (let s0 = 0; s0 < N; s0++) {
    if (!open[s0] || lab[s0]) continue;
    const id = ++next;
    let qh = 0, qt = 0;
    queue[qt++] = s0; lab[s0] = id;
    while (qh < qt) {
      const k = queue[qh++], i = k % cols;
      // (the 8 neighbours by index offset; `m`: which sides of the map this cell is not on — same cells, same tests)
      const m = (i + 1 < cols ? 1 : 0) | (i > 0 ? 2 : 0) | (k + cols < N ? 4 : 0) | (k >= cols ? 8 : 0), ek = elev[k];
      for (let d = 0; d < 8; d++) {
        if ((m & NBR_NEED[d]) !== NBR_NEED[d]) continue;
        const nk = k + DI[d] + DJ[d] * cols;
        if (!open[nk] || lab[nk]) continue;
        // (grid.canStep either way: the elevation step is symmetric; only a ramp's side needs its own test)
        if (Math.abs(ek - elev[nk]) > MAX_STEP) continue;
        if (runOf && runOf[k] !== runOf[nk] && !grid.canStep(k, nk) && !grid.canStep(nk, k)) continue;
        lab[nk] = id; queue[qt++] = nk;
      }
      if (adjAt && adjAt[k]) for (const nk of adj.get(k)) if (!lab[nk]) { lab[nk] = id; queue[qt++] = nk; }
    }
  }
  per.map.set(key, lab);
  if (!bare.dive) lastOf.set(key, { version: grid.version, links: grid.links, lab, open, next });
  return lab;
}

/** relabelOpened: at most this many cells shut by the changes it joins (more: a full flood). */
const SHUT_MAX = 4096;
/** shutKeepsAreas looks this many cells round the shut ones for a way between their neighbours. */
const SHUT_WINDOW = 16;
/** A pocket the shut cells cut off an area (shutKeepsAreas) is labelled on its own up to this many cells (more: a full flood). */
const POCKET_CELLS = 4096;
/**
 * What the shut cells do to the areas they cut through: for each old area, the cells beside the shut ones (its 8
 * neighbours with a step to them, a link's other end) still open must be joined by steps among open cells within
 * SHUT_WINDOW of the shut ones (any area's, or newly open) — then any way through a shut cell has a detour and the
 * area stays whole (joined to others only where newly open cells join them). One that is not is followed on, as far
 * as it goes: back to the rest (a detour farther out), or round a pocket of the old area's own cells closed off (no
 * newly open cell in it, at most POCKET_CELLS) — a new area of its own. @returns {number[][]|null} the pockets (cells),
 * or null: a full flood answers (a corridor shut across, a pocket too big or joined to newly open cells).
 */
function shutKeepsAreas(grid, shut, oldLab, oldOpen, open, oldLinks, links, steps) {
  const cols = grid.cols, rows = grid.rows;
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const k of shut) { const i = k % cols, j = (k - i) / cols; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
  i0 = Math.max(0, i0 - SHUT_WINDOW); i1 = Math.min(cols - 1, i1 + SHUT_WINDOW); j0 = Math.max(0, j0 - SHUT_WINDOW); j1 = Math.min(rows - 1, j1 + SHUT_WINDOW);
  // the cells beside the shut ones (by the steps a flood took over the old layer), still open, by old area
  const byArea = new Map();
  for (const s of shut) steps(s, oldOpen, oldLinks, (nk) => {
    if (!open[nk]) return;
    const a = oldLab[nk];
    if (!a) return;
    let set = byArea.get(a); if (!set) byArea.set(a, (set = new Set())); set.add(nk);
  });
  const inWin = (k) => { const i = k % cols, j = (k - i) / cols; return i >= i0 && i <= i1 && j >= j0 && j <= j1; };
  const pockets = [];
  for (const [area, set] of byArea) {
    if (set.size < 2) continue;
    for (const k of set) if (!inWin(k)) return null; // (a link's far end out of the window: no local answer)
    const seen = new Set(), queue = [];
    const first = set.values().next().value;
    seen.add(first); queue.push(first);
    let left = set.size - 1;
    for (let q = 0; q < queue.length && left > 0; q++) {
      steps(queue[q], open, links, (nk) => {
        if (seen.has(nk) || !inWin(nk)) return;
        seen.add(nk); queue.push(nk);
        if (set.has(nk)) left--;
      });
    }
    if (!left) continue;
    // the neighbours not reached: followed on without the window — back to the rest, or round a pocket of their own
    for (const u of set) {
      if (seen.has(u)) continue;
      const P = new Set([u]), pq = [u];
      let back = false, bad = false;
      for (let q = 0; q < pq.length && !back && !bad; q++) {
        steps(pq[q], open, links, (nk) => {
          if (back || bad || P.has(nk)) return;
          if (seen.has(nk)) { back = true; return; } // (the rest of the area, after all)
          if (oldLab[nk] !== area || P.size >= POCKET_CELLS) { bad = true; return; } // (newly open, another area's, too big)
          P.add(nk); pq.push(nk);
        });
      }
      if (bad) return null;
      if (back) { for (const k of P) seen.add(k); continue; }
      pockets.push([...P]);
      for (const k of P) seen.add(k); // (its other neighbours: in this pocket)
    }
  }
  return pockets;
}

/**
 * The last labelling built per rules (areasFor's key) — its grid version, the open layer it was flooded over (static
 * layers are never written once made: a change makes a copy), its last label id — for relabelOpened.
 */
const _areasLast = new WeakMap();
/**
 * `last`'s labelling brought to the grid as it stands, or null (a full flood then): every change since `last.version`
 * confined to known rows (NavGrid.dirtyRowsSince) and none of them shut an open cell — the walk layer's rows compared
 * with the one `last` was flooded over; elevation, ramps and links change only with a version bump of their own (no rows
 * known). Cells that only opened can only join areas: each run of newly open cells takes a new label, and the areas it
 * touches (by the flood's own steps: the 8 neighbours, the elevation step, a ramp's sides either way, an allowed link
 * with both ends open) become one, under the least of their labels. Labels are compared for equality only.
 */
function relabelOpened(grid, last, open, role, opts, hasLinks) {
  const d = grid.dirtyRowsSince(last.version);
  if (!d) return null;
  const cols = grid.cols, N = grid.size, old = last.open, opened = [], shut = [];
  // (the cells the writers named: a cell's walk test reads only its own layers)
  for (let j = Math.max(0, d.j0), je = Math.min(grid.rows - 1, d.j1); j <= je; j++) {
    for (let k = j * cols + Math.max(0, d.i0), ke = j * cols + Math.min(cols - 1, d.i1); k <= ke; k++) {
      if (open[k] === old[k]) continue;
      if (open[k]) opened.push(k); else shut.push(k);
    }
  }
  if (!opened.length && !shut.length) return { lab: last.lab, next: last.next }; // (the same open cells: the same areas — shared, never written)
  if (shut.length > SHUT_MAX) return null;
  const elev = grid.elev, runOf = grid.runOf;
  // (the steps a flood takes from cell k under the open layer `o`: the 8 neighbours with the elevation step and a ramp's
  // sides either way, and the allowed links with both ends open)
  const linksOf = (o) => {
    if (!hasLinks) return null;
    const m = new Map();
    for (const L of grid.links) {
      if (!grid.linkAllowed(L, role) || (opts.noLinks && !L.walk)) continue;
      if (!o[L.ka] || !o[L.kb]) continue;
      (m.get(L.ka) || m.set(L.ka, []).get(L.ka)).push(L.kb);
      (m.get(L.kb) || m.set(L.kb, []).get(L.kb)).push(L.ka);
    }
    return m;
  };
  const adj = linksOf(open);
  const steps = (k, o, links, fn) => {
    const i = k % cols, m = (i + 1 < cols ? 1 : 0) | (i > 0 ? 2 : 0) | (k + cols < N ? 4 : 0) | (k >= cols ? 8 : 0), ek = elev[k];
    for (let dd = 0; dd < 8; dd++) {
      if ((m & NBR_NEED[dd]) !== NBR_NEED[dd]) continue;
      const nk = k + DI[dd] + DJ[dd] * cols;
      if (!o[nk]) continue;
      if (Math.abs(ek - elev[nk]) > MAX_STEP) continue;
      if (runOf && runOf[k] !== runOf[nk] && !grid.canStep(k, nk) && !grid.canStep(nk, k)) continue;
      fn(nk);
    }
    const ls = links?.get(k);
    if (ls) for (const nk of ls) fn(nk);
  };
  const pockets = shut.length ? shutKeepsAreas(grid, shut, last.lab, old, open, linksOf(old), adj, steps) : [];
  if (!pockets) return null;
  const lab = last.lab.slice(), parent = new Map();
  for (const k of shut) lab[k] = 0;
  let next = last.next;
  for (const P of pockets) { const id = ++next; for (const k of P) lab[k] = id; }
  const find = (l) => { let r = l; while (parent.has(r)) r = parent.get(r); return r; };
  let joined = false;
  const queue = new Int32Array(opened.length);
  for (const s0 of opened) {
    if (lab[s0]) continue; // (reached from an earlier one)
    const id = ++next, touched = new Set();
    let qh = 0, qt = 0;
    queue[qt++] = s0; lab[s0] = id;
    let bad = false;
    const reach = (nk) => {
      if (lab[nk] === 0) { if (qt >= queue.length) { bad = true; return; } lab[nk] = id; queue[qt++] = nk; } // (shut before: newly open)
      else if (lab[nk] !== id) touched.add(lab[nk]);
    };
    while (qh < qt) steps(queue[qh++], open, adj, reach);
    if (bad) return null; // (an open cell unlabelled outside the rows compared: never — a full flood rather than a guess)
    if (!touched.size) continue;
    // (one area: under the least label among them)
    let c = id;
    for (const l of touched) { const r = find(l); if (r < c) c = r; }
    for (const l of [id, ...touched]) { const r = find(l); if (r !== c) parent.set(r, c); }
    joined = true;
  }
  if (joined) {
    const canon = new Int32Array(next + 1);
    let oldMoved = false;
    for (let l = 0; l <= next; l++) { const r = parent.size ? find(l) : l; canon[l] = r; if (r !== l && l <= last.next) oldMoved = true; }
    // (two areas of the last labelling joined: their cells lie anywhere — every cell. Else only labels made here moved —
    // the newly open cells' runs (joined to the areas they touch) and the pockets': their cells are those lists, and the
    // rest of the grid keeps its labels — the same array, without a pass over the whole grid, cold code at a blast:
    // ~0.45 ms of M14's barrel tick each time, for its 2 opened cells)
    if (oldMoved) { for (let k = 0; k < N; k++) { const l = lab[k]; if (l) lab[k] = canon[l]; } }
    else {
      for (const k of opened) { const l = lab[k]; if (l) lab[k] = canon[l]; }
      for (const P of pockets) for (const k of P) { const l = lab[k]; if (l) lab[k] = canon[l]; }
    }
  }
  return { lab, next };
}

/**
 * The area labelling a search under these rules (findPath's opts: swim / allowWater, role, noLinks, noWalkLinks) would
 * build at its first use, built now: a cache fill only (keyed like the search's own, rebuilt when the grid changes), so
 * every search answers the same. The walkthrough runs it on its title card (engine/idle-warm.js): M3's first tick built
 * the guards' and the squad's labellings, ~5 ms of it.
 */
/**
 * Fill the static layers every search reads (staticLayers: the walk test, the step cost factors and the link flags of
 * this grid version) now — a cache fill only, the same layers a first search builds lazily: on a still screen
 * (engine/idle-warm.js) instead of the first tick of play, whose first orders paid ~2-3 ms for them (M18).
 */
export function warmPathCosts(grid) {
  if (grid?.size) stepMasksOf(staticLayers(grid, false), grid, 0); // (and the step masks on foot: made in full once)
}

/** The area labelling a search under these rules reads (areasFor; tests/unit/areas-incremental). */
export function areaLabelsOf(grid, opts = {}) {
  const o = { role: opts.role, noLinks: !!opts.noLinks, noWalkLinks: !!opts.noWalkLinks };
  const hasLinks = (!o.noLinks || !o.noWalkLinks) && grid.links && grid.links.length > 0;
  return areasFor(grid, { swim: !!(opts.swim || opts.allowWater), dive: false }, o.role, o, hasLinks);
}

export function warmAreas(grid, opts = {}) {
  if (!grid?.size || opts.dive) return;
  const o = { role: opts.role, noLinks: !!opts.noLinks, noWalkLinks: !!opts.noWalkLinks };
  const hasLinks = (!o.noLinks || !o.noWalkLinks) && grid.links && grid.links.length > 0;
  areasFor(grid, { swim: !!(opts.swim || opts.allowWater), dive: false }, o.role, o, hasLinks);
}

/**
 * Between ticks (Game.render): once the grid has held still for REWARM_AFTER calls since its static layers or links last
 * changed (a blast's stamp), the labelling of one rule set searches used before that change and the grid now lacks, built
 * now — a cache fill only (areasFor's own, for the grid as it stands; a search builds the same lazily). M3: the squad's
 * two labellings (the men, the Diver swimming) were rebuilt in the tick they boarded the truck, ~7 ms of it, 24 s after
 * the bunker blast that changed the grid. A grid that keeps changing (M11's fireworks) is left alone.
 * @returns {boolean} one was built
 */
export const REWARM_AFTER = 30;
const _still = new WeakMap();
export function rewarmAreas(grid) {
  const rec = grid && _recent.get(grid);
  if (!rec || !rec.size) return false;
  const sig = linksSig(grid);
  let st = _still.get(grid);
  if (!st || st.version !== grid.version || st.links !== grid.links || st.sig !== sig) { _still.set(grid, (st = { version: grid.version, links: grid.links, sig, n: 0, done: false })); }
  if (st.done || ++st.n < REWARM_AFTER) return false;
  for (const [swim, role, noLinks, noWalkLinks] of rec.values()) {
    const walkOpts = { swim, dive: false }, opts = { noLinks, noWalkLinks };
    const hasLinks = (!noLinks || !noWalkLinks) && !!grid.links && grid.links.length > 0;
    const per = _areas.get(grid);
    if (per && per.version === grid.version && per.links === grid.links && per.map.has(areaKey(grid, walkOpts, role, opts, hasLinks))) continue;
    areasFor(grid, walkOpts, role, opts, hasLinks);
    return true;
  }
  st.done = true;
  return false;
}

/** Expansions after which a search without this grid version's area labelling at hand builds it and asks it (searchPath). */
export const AREAS_AT = 2000;
/** Expansions after which a search asks whether its goal is shut in a small pocket (goalPocketExcludes). */
export const POCKET_AT = 2500;
/** Largest pocket (cells) worth enumerating for that question. */
export const POCKET_MAX = 2500;
const _pocketSeen = new WeakMap();
const _ladderEnds = new WeakMap();
/** The cells of every ladder's (and stair link's) two ends, per grid (rebuilt when its links change). */
function ladderEnds(grid) {
  const links = grid.links || [];
  let c = _ladderEnds.get(grid);
  if (!c || c.links !== links || c.n !== links.length) {
    const set = new Set();
    for (const L of links) if (L.kind === 'ladder') { set.add(L.ka); set.add(L.kb); }
    _ladderEnds.set(grid, (c = { links, n: links.length, set, flags: null, near: null }));
  }
  return c.set;
}
/** The cells beside a ladder's end (one of their eight neighbours is one): searchPath's step-mask path leaves them to the
 * cell-by-cell path, which notes a ladder end the mask shuts (noteEnd). Per links, as ladderEnds. */
function ladderEndNear(grid) {
  const fl = ladderEndFlags(grid), c = _ladderEnds.get(grid);
  if (!c.near || c.near.length !== grid.size) {
    const nr = new Uint8Array(grid.size), cols = grid.cols, rows = grid.rows;
    for (let k = 0; k < fl.length; k++) {
      if (fl[k] !== 1) continue;
      const i = k % cols, j = (k - i) / cols;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < cols && b < rows) nr[b * cols + a] = 1; }
    }
    c.near = nr;
  }
  return c.near;
}
/** ladderEnds as one flag a cell (1: a ladder's end): the search's quick look before it asks the set (isEnd). */
function ladderEndFlags(grid) {
  const set = ladderEnds(grid), c = _ladderEnds.get(grid);
  if (!c.flags || c.flags.length !== grid.size) { const fl = new Uint8Array(grid.size); for (const k of set) if (k >= 0 && k < fl.length) fl[k] = 1; c.flags = fl; }
  return c.flags;
}
/**
 * Is goal cell `goalK` inside a pocket of at most POCKET_MAX cells — every cell from which a search can step (or climb,
 * links) into the goal, enumerated backwards over the very rule the search steps by — that does not hold `startK`?
 * Then no search from `startK` reaches the goal: findPath returns null, exactly as its full flood would (a charge
 * blown inside a bunker nobody can walk into: every guard who hears it flooded the whole map, ~20 ms each).
 * @returns {number[]|null} the pocket's cells, or null = can't tell (it is larger, or holds the start): search on
 */
/**
 * goalPocketExcludes for a search on the static walk layer (searchPath's fast path): the same enumeration — the same
 * cells in the same order, the same early answers — with grid.isWalkable's test for these rules written out on the layer
 * (the vehicles, the mask; a ladder end the mask shuts open as one, `endF`: searchPath's pocketOpen) and canStep's
 * height test before its call: no call per cell.
 */
function goalPocketExcludesOpen(grid, goalK, startK, sOpen, dynB, avM, frM, endF, role, hasLinks, noLinks, info) {
  const cols = grid.cols, rows = grid.rows, elev = grid.elev, runOf = grid.runOf, NONE = B.NONE;
  let mark = _pocketSeen.get(grid);
  if (!mark || mark.a.length !== grid.size) { mark = { a: new Uint32Array(grid.size), id: 0 }; _pocketSeen.set(grid, mark); }
  if (++mark.id >= 0xfffffff0) { mark.a.fill(0); mark.id = 1; }
  const seen = mark.a, id = mark.id, queue = [goalK];
  seen[goalK] = id;
  // (`open`: pocketOpen — walked, or a ladder end the mask shuts; `walk`: grid.isWalkable, the corner rule's own test)
  const open = (q) => sOpen[q] === 1 && (dynB === null || dynB[q] === NONE) && (frM === null || frM[q] === 0) && (avM === null || !avM[q] || (endF !== null && endF[q] === 1));
  const walk = (q) => sOpen[q] === 1 && (dynB === null || dynB[q] === NONE) && (avM === null || !avM[q]) && (frM === null || frM[q] === 0);
  const step = (a, b) => Math.abs(elev[a] - elev[b]) <= MAX_STEP && (!runOf || runOf[a] === runOf[b] || grid.canStep(a, b));
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q], i = k % cols, j = (k - i) / cols;
    for (let d = 0; d < 8; d++) {
      const pi = i - DI[d], pj = j - DJ[d];
      if (pi < 0 || pj < 0 || pi >= cols || pj >= rows) continue;
      const pk = pj * cols + pi;
      if (!open(pk)) continue;
      if (seen[pk] === id) continue;
      if (d >= 4 && (!walk(pk + DI[d]) || !walk(pk + DJ[d] * cols))) continue; // (both on the map: pk and k are)
      if (!step(pk, k)) continue;
      if (d >= 4 && (!step(pk, pj * cols + i) || !step(pk, j * cols + pi))) continue;
      if (pk === startK) return null;
      seen[pk] = id; queue.push(pk);
      if (queue.length > POCKET_MAX) { if (info) info.wide = true; return null; }
    }
    if (hasLinks) {
      for (const L of grid.linksAt(k)) {
        if (!grid.linkAllowed(L, role) || (noLinks && !L.walk)) continue;
        const pk = L.ka === k ? L.kb : L.ka;
        if (seen[pk] === id) continue;
        if (pk < 0 || pk >= grid.size || !open(pk)) continue;
        if (pk === startK) return null;
        seen[pk] = id; queue.push(pk);
        if (queue.length > POCKET_MAX) { if (info) info.wide = true; return null; }
      }
    }
  }
  return queue;
}
function goalPocketExcludes(grid, goalK, startK, walkOpts, role, hasLinks, noLinks, open = (i, j) => grid.isWalkable(i, j, walkOpts), info = null) {
  const cols = grid.cols;
  let mark = _pocketSeen.get(grid);
  if (!mark || mark.a.length !== grid.size) { mark = { a: new Uint32Array(grid.size), id: 0 }; _pocketSeen.set(grid, mark); }
  if (++mark.id >= 0xfffffff0) { mark.a.fill(0); mark.id = 1; }
  const seen = mark.a, id = mark.id, queue = [goalK];
  seen[goalK] = id;
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q], i = k % cols, j = (k - i) / cols;
    // every p with a step p → k: p walkable (searches only expand walkable cells), the step's own rules from p's side
    for (let d = 0; d < 8; d++) {
      const pi = i - DI[d], pj = j - DJ[d];
      if (!open(pi, pj)) continue;
      const pk = pj * cols + pi;
      if (seen[pk] === id) continue;
      if (d >= 4 && (!grid.isWalkable(pi + DI[d], pj, walkOpts) || !grid.isWalkable(pi, pj + DJ[d], walkOpts))) continue;
      if (!grid.canStep(pk, k)) continue;
      if (d >= 4 && (!grid.canStep(pk, pj * cols + i) || !grid.canStep(pk, j * cols + pi))) continue;
      if (pk === startK) return null;
      seen[pk] = id; queue.push(pk);
      if (queue.length > POCKET_MAX) { if (info) info.wide = true; return null; }
    }
    if (hasLinks) {
      for (const L of grid.linksAt(k)) {
        if (!grid.linkAllowed(L, role) || (noLinks && !L.walk)) continue;
        const pk = L.ka === k ? L.kb : L.ka;
        if (seen[pk] === id) continue;
        const pi = pk % cols, pj = (pk - pi) / cols;
        if (!open(pi, pj)) continue;
        if (pk === startK) return null;
        seen[pk] = id; queue.push(pk);
        if (queue.length > POCKET_MAX) { if (info) info.wide = true; return null; }
      }
    }
  }
  return queue;
}

/**
 * A free cell to leave a shut start cell by: among the free cells within `nearest`'s distance + 0.5 m of (sx, sz) that
 * he gets to in a straight line over free cells (his own excepted), the one that costs least from here to the goal (out
 * to it, then straight on: d(s, c) + d(c, t)). Null: none (the nearest one, as before).
 */
function stepOutToward(grid, sx, sz, tx, tz, nearest, walkOpts) {
  const c = grid.cell, d0 = Math.hypot(nearest.x - sx, nearest.z - sz), R = d0 + 0.5;
  const si = Math.floor(sx / c), sj = Math.floor(sz / c);
  const straight = (x, z) => {
    const L = Math.hypot(x - sx, z - sz), n = Math.max(1, Math.ceil(L / (c / 4)));
    for (let q = 1; q <= n; q++) {
      const i = Math.floor((sx + ((x - sx) * q) / n) / c), j = Math.floor((sz + ((z - sz) * q) / n) / c);
      if ((i !== si || j !== sj) && !grid.isWalkable(i, j, walkOpts)) return false;
    }
    return true;
  };
  const i0 = Math.floor((sx - R) / c), i1 = Math.floor((sx + R) / c), j0 = Math.floor((sz - R) / c), j1 = Math.floor((sz + R) / c);
  let best = null, bc = Infinity;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (!grid.isWalkable(i, j, walkOpts)) continue;
    const x = (i + 0.5) * c, z = (j + 0.5) * c, d = Math.hypot(x - sx, z - sz);
    if (d > R) continue;
    const cost = d + Math.hypot(tx - x, tz - z);
    if (cost < bc - 1e-9 && straight(x, z)) { bc = cost; best = { x, z, i, j }; }
  }
  return best;
}

/**
 * The searches findPath ran to their goal on a grid version (the last FOUND_MAX of them), kept for a later one that asks
 * the same — the same start and goal, the same rules — or differs only in its body-clearance mask (`avoid`) outside the
 * box the first search looked at: Unit._planPath asks the same way once per inflation tier, every guard who hears a
 * blast (M2's depot: ~30 searches in its tick), a guard stood still asks again a tick later (M14's barrel blast: a 15 700-
 * cell search twice, the second time ~8 ms — the masks are made afresh each tick, the same within the box). Both masks
 * holding the same cells within REUSE_PAD of that box (start and goal, every cell it expanded and their neighbours, the
 * links' far ends — the smoothing's lines run between its path's points, inside it), both searches test the same cells
 * with the same answers: the same path, the same cells expanded (counted again on searchStats). A path found does not
 * depend on the epoch (the failed-search memo answers only searches that fail: one that reaches its goal never meets
 * it), so a later tick reuses it too. Never for a search that moved its start or goal (the nearest free cell: a ring
 * search), a dynamic one (the vehicle layer is restamped within a tick), a dive, a crawler's (alignRuns looks further) —
 * and only within one grid version. (Masks are never written once made: body-clearance.js makes a new one per change.)
 */
const _found = new WeakMap();
const FOUND_MAX = 32;
/**
 * The cell chains of those searches, for another start and goal in the same two cells (CHAIN_MAX of a grid version):
 * the A* reads only cells — its start and goal cells, the rules, the grid, the mask — so a search between the same two
 * cells under the same rules, the masks equal within its box, expands the same cells in the same order and finds the
 * same chain; only the points at its ends and the smoothing from them are this query's own (finishPath). M14's
 * charges: a squad of twenty re-plans to one goal from sixteen cells. Never for a moved start or goal (the nearest free
 * cell is a ring search from the point itself).
 */
const _chains = new WeakMap();
const CHAIN_MAX = 48;
const REUSE_PAD = 2;
const sameRules = (a, b) => a.role === b.role && !!a.noLinks === !!b.noLinks && !!a.noWalkLinks === !!b.noWalkLinks && !!a.swim === !!b.swim
  && (a.maxNodes ?? 40000) === (b.maxNodes ?? 40000) && a.smooth === b.smooth && !!a.taut === !!b.taut
  && (a.fire || null) === (b.fire || null);
/** Is a kept search's answer (`L`: its fire version) good for these rules under the fires as they burn? A search round
 * the fires (opts.fire, world/fires.js) is kept for its fire version only: the layer is written in place, never `version`. */
const fireSame = (opts, L, grid) => !opts.fire || L.fireV === grid.fireVersion;
/** Do masks `a` and `b` (null: no mask) hold the same cells within REUSE_PAD of `box`? */
function maskSame(grid, a, b, box) {
  if (a === b) return true;
  const cols = grid.cols, i0 = Math.max(0, box[0] - REUSE_PAD), j0 = Math.max(0, box[1] - REUSE_PAD);
  const i1 = Math.min(cols - 1, box[2] + REUSE_PAD), j1 = Math.min(grid.rows - 1, box[3] + REUSE_PAD);
  if (!a || !b) {
    const m = a || b;
    for (let j = j0; j <= j1; j++) for (let k = j * cols + i0, e = j * cols + i1; k <= e; k++) if (m[k]) return false;
    return true;
  }
  for (let j = j0; j <= j1; j++) for (let k = j * cols + i0, e = j * cols + i1; k <= e; k++) if (a[k] !== b[k]) return false;
  return true;
}
const copyPath = (p) => p.map((q) => (q.link ? { ...q, link: { ...q.link } } : { ...q }));
/**
 * The chains kept from an earlier grid version brought to this one (`C.version` → grid.version): kept when every change
 * between them is in staticLayers' log (row-confined bumps: the walk layers and step costs compared cell by cell; heights,
 * ramps and links change only with a plain bump, which has no record) and none of the cells it changed lies at or next
 * to a cell the search expanded, or is a link end it looked at (`foot`): the A* reads nothing else of the grid — the
 * walk test, height, run and cost of the expanded cells' eight neighbours, the links of the expanded cells — so run
 * again it expands the same cells in the same order and finds the same chain; the smoothing is redone on the grid as it
 * is (finishPath). M14's charges: the guards standing in the casemate's yard plan again after each bump, from the same
 * cells, while the changes lie at the far guns. Otherwise dropped.
 */
function carryChains(grid, C) {
  const to = grid.version;
  staticLayers(grid, false, true, false); // (the layers brought to this version: their row path logs what changed)
  const log = _layerLog.get(grid), chs = [];
  let v = C.version, have = 7;
  if (log) for (const r of log) if (r.from === v) { if (r.ch.length) chs.push(r.ch); have &= r.have; v = r.to; if (v === to) break; }
  C.version = to;
  if (v !== to) { C.list.length = 0; return; }
  if (!chs.length) return;
  const cols = grid.cols;
  C.list = C.list.filter((E) => {
    if (!E.foot || (have & 4) === 0 || (have & (E.opts.swim ? 2 : 1)) === 0) return false;
    const b = E.box, w = b[2] - b[0] + 1, foot = E.foot;
    for (const ch of chs) {
      for (let n = 0; n < ch.length; n++) {
        const k = ch[n], ci = k % cols, cj = (k - ci) / cols;
        if (ci < b[0] - 1 || ci > b[2] + 1 || cj < b[1] - 1 || cj > b[3] + 1) continue;
        for (let j = Math.max(b[1], cj - 1), j1 = Math.min(b[3], cj + 1); j <= j1; j++) {
          for (let i = Math.max(b[0], ci - 1), i1 = Math.min(b[2], ci + 1); i <= i1; i++) if (foot[(j - b[1]) * w + i - b[0]]) return false;
        }
      }
    }
    return true;
  });
}
export function findPath(grid, sx, sz, tx, tz, opts = {}) {
  const plain = !opts.dynamic && !opts.dive && !opts.lying;
  let F = null;
  if (plain) {
    F = _found.get(grid);
    if (!F || F.version !== grid.version) _found.set(grid, (F = { version: grid.version, list: [] }));
    const avoid = opts.avoid || null;
    for (let n = F.list.length - 1; n >= 0; n--) {
      const L = F.list[n];
      if (L.sx !== sx || L.sz !== sz || L.tx !== tx || L.tz !== tz || !sameRules(opts, L.opts) || !fireSame(opts, L, grid) || !maskSame(grid, avoid, L.avoid, L.box)) continue;
      searchStats.expanded += L.expanded; reuseStats.found++;
      return copyPath(L.path);
    }
  }
  if (plain) {
    const C = _chains.get(grid);
    if (C && C.version !== grid.version) carryChains(grid, C);
    if (C && C.list.length) {
      const c = grid.cell, si = Math.floor(sx / c), sj = Math.floor(sz / c), gi = Math.floor(tx / c), gj = Math.floor(tz / c);
      if (grid.inBounds(si, sj) && grid.inBounds(gi, gj) && (si !== gi || sj !== gj)) {
        const startK = sj * grid.cols + si, goalK = gj * grid.cols + gi, avoid = opts.avoid || null;
        for (let n = C.list.length - 1; n >= 0; n--) {
          const E = C.list[n];
          if (E.startK !== startK || E.goalK !== goalK || !sameRules(opts, E.opts) || !fireSame(opts, E, grid) || !maskSame(grid, avoid, E.avoid, E.box)) continue;
          searchStats.expanded += E.expanded; reuseStats.chain++;
          // (searchPath's rules: the fires only while any burn)
          const fire = opts.fire && grid.fireCells > 0 ? opts.fire : null;
          const walkOpts = { swim: !!opts.swim, dynamic: false, dive: false, avoid, fire, fireV: fire ? grid.fireVersion : 0 };
          const goal = clearOfWalls(grid, tx, tz, gi, gj, GOAL_CLEARANCE);
          const p = finishPath(grid, E.chain, E.chainVia, { x: sx, z: sz }, goal, opts, walkOpts, E.fast ? staticLayers(grid, !!opts.swim, true, false).open[opts.swim ? 1 : 0] : null);
          F.list.push({ sx, sz, tx, tz, avoid, fireV: grid.fireVersion, opts: { ...opts }, box: E.box, expanded: E.expanded, path: copyPath(p) });
          if (F.list.length > FOUND_MAX) F.list.shift();
          return p;
        }
      }
    }
  }
  const info = { endBlocked: true, moved: false, box: null, expanded: 0, chain: null, chainVia: null, fast: false, plain, foot: null };
  info.endBlocked = false; // (a field that changes — a search giving back its cells writes it: not a constant, core/shapes.js)
  const p = searchPath(grid, sx, sz, tx, tz, opts, false, info);
  if (p && plain && info.box && !info.moved) {
    F.list.push({ sx, sz, tx, tz, avoid: opts.avoid || null, fireV: grid.fireVersion, opts: { ...opts }, box: info.box, expanded: info.expanded, path: copyPath(p) });
    if (F.list.length > FOUND_MAX) F.list.shift();
    if (info.chain && info.chain.length > 1) {
      let C = _chains.get(grid);
      if (C && C.version !== grid.version) carryChains(grid, C);
      if (!C) _chains.set(grid, (C = { version: grid.version, list: [] }));
      C.list.push({ startK: info.chain[0], goalK: info.chain[info.chain.length - 1], avoid: opts.avoid || null, fireV: grid.fireVersion, opts: { ...opts }, box: info.box, expanded: info.expanded, chain: info.chain, chainVia: info.chainVia, fast: info.fast, foot: info.foot });
      if (C.list.length > CHAIN_MAX) C.list.shift();
    }
  }
  if (p || !info.endBlocked) return p;
  // (shut out where a body-clearance mask covers a ladder's end — a tank ladder's foot a step from its shell, M8's deck
  // ladders: again, the ladder ends open as the ladders' own ends only. A search that never needs them runs as it
  // always did)
  return searchPath(grid, sx, sz, tx, tz, opts, true, null);
}

/**
 * grid.isWalkable(i, j, walkOpts) as a closure over the grid's layers (the same test, read live — nothing cached): the
 * search asks it ~10 times a cell expanded, and M11's blast ticks spent a third of their searches in the call itself.
 * A dive keeps the grid's own test.
 */
function walker(grid, walkOpts) {
  const { cols, rows, block, navBlock, fenceHole, bridge, terrain } = grid;
  if (walkOpts.dive || !block || !navBlock || !fenceHole || !bridge || !terrain) return (i, j) => grid.isWalkable(i, j, walkOpts);
  const dyn = walkOpts.dynamic ? grid.dynamicBlock : null, avoid = walkOpts.avoid || null, fire = walkOpts.fire || null, swim = !!walkOpts.swim, NONE = B.NONE, WATER = T.WATER;
  return (i, j) => {
    if (i < 0 || j < 0 || i >= cols || j >= rows) return false;
    const k = j * cols + i;
    if (block[k] !== NONE || (navBlock[k] && !fenceHole[k])) return false;
    if (dyn && dyn[k] !== NONE) return false;
    if (avoid && avoid[k]) return false;
    if (fire && fire[k]) return false;
    if (bridge[k]) return true;
    if (terrain[k] === WATER) return swim;
    return true;
  };
}

/**
 * The search's own code warmed once a page, at a mission's load (Game's idle warm): long searches on the mission's grid
 * as it stands, the area labelling taken as not at hand (`codeWarm`), so that searchPath's rarely run parts — the late
 * area answer at AREAS_AT, the goal pocket at POCKET_AT, the heap grown past its first size, the clearance mask's ladder
 * ends — have run before its optimized code is made. Met first in play, each threw that code out mid-tick and the tick's
 * remaining searches ran unoptimized: M14's barrel blast, a 15.7k-cell search at twice the time a cell. Cache fills
 * only (this grid version's labels and layers, as warmAreas / warmPathCosts): no search answers differently after it,
 * and the cells it counts are given back to searchStats.
 * @returns {boolean} the warm-up ran
 */
let codeWarm = false, codeWarmed = false;
export function warmSearchCode(grid) {
  if (codeWarmed || !grid?.size) return false;
  const lab = areaLabelsOf(grid), o = staticLayers(grid, false, false).open[0], N = grid.size, c = grid.cell, cols = grid.cols;
  // two open cells of one walk area far apart: the first from the map's first corner, the last of its area from the other
  let a = -1, b = -1;
  for (let k = 0; k < N && a < 0; k++) if (o[k] === 1 && lab[k]) a = k;
  for (let k = N - 1; k > a && a >= 0 && b < 0; k--) if (o[k] === 1 && lab[k] === lab[a]) b = k;
  if (a < 0 || b < 0) return false;
  const at = (k) => [((k % cols) + 0.5) * c, (Math.floor(k / cols) + 0.5) * c];
  const [ax, az] = at(a), [bx, bz] = at(b);
  const e0 = searchStats.expanded, info = () => { const o = { endBlocked: true, moved: false, box: null, expanded: 0, chain: null, chainVia: null, fast: false, plain: false, foot: null }; o.endBlocked = false; return o; };
  // (and a search round the fires — world/fires.js, a blast's first: the fire layer's tests in the A* and the smoothing's
  // lines — with an empty fire layer of its own, `fireCells` counted for it alone: the same answer as without)
  const fc = grid.fireCells;
  codeWarm = true; codeWarmed = true;
  try {
    searchPath(grid, ax, az, bx, bz, { maxNodes: 6000 }, false, info());
    searchPath(grid, ax, az, bx, bz, { maxNodes: 6000, avoid: new Uint8Array(N), role: '*' }, false, info());
    if (!fc) { grid.fireCells = 1; searchPath(grid, ax, az, bx, bz, { maxNodes: 6000, fire: new Uint8Array(N) }, false, info()); }
  } finally { codeWarm = false; searchStats.expanded = e0; grid.fireCells = fc; }
  // (and the labelling's own paths after a change in known rows — a ring of cells shut round a pocket, then opened again —
  // with the layers redone over those rows: relabelOpened, shutKeepsAreas, staticLayers' row path; on a small grid of
  // its own, nothing of the mission's touched)
  const s = new NavGrid(12, 12), sc = s.cols, ring = [];
  for (let j = 8; j <= 14; j++) for (let i = 8; i <= 14; i++) if (i === 8 || i === 14 || j === 8 || j === 14) ring.push(j * sc + i);
  staticLayers(s, false, true); areaLabelsOf(s);
  for (const v of [B.HIGH, B.NONE]) { for (const k of ring) s.block[k] = v; s._bumpRows(8, 14); staticLayers(s, false, true); areaLabelsOf(s); }
  return true;
}

/** searchPath's area answer: start and goal cells in two walk areas of this grid version (areasFor) — no search joins them. */
function areasApart(grid, walkOpts, role, opts, hasLinks, startK, goalK) {
  const lab = areasFor(grid, walkOpts, role, opts, hasLinks);
  return !!(lab[startK] && lab[goalK] && lab[startK] !== lab[goalK]);
}
/** searchPath's note of a ladder end the clearance mask shuts, met at (i, j) (`info.endBlocked`): isEnd's test. */
function noteEnd(grid, allEnds, bare, info, i, j) {
  if (!info.endBlocked && grid.inBounds(i, j) && allEnds.has(j * grid.cols + i) && grid.isWalkable(i, j, bare)) info.endBlocked = true;
}

/**
 * searchPath's A* over the step masks, in a function of its own: it pops and expands cells — the step masks' path, the
 * same pushes in the same order — until the goal (1), the node cap (2), the heap dry (0), or a cell its caller expands
 * itself (3: the cell in `S.s` / `S.k`, closed and counted already — at AREAS_AT / POCKET_AT cells, one with links, one
 * beside a ladder end). Only what every search runs is in it: a rare path met first in play (a moved start, a link, a
 * mask's ladder end) threw searchPath's optimised code out — M14's blasts: the next searches ran unoptimised at ~3× the
 * time a cell while it was made again (~130 ms of compiling, so large a function). Its state lives in HOT between runs.
 */
const HOT = { heap: null, cellOf: null, st: null, slotOf: null, g: null, f: null, parent: null, via: null, nbm: null, nearE: null, lk: null, dynB: null, avM: null, frM: null, mul: null,
  cid: 0, oid: 0, goalK: 0, gi: 0, gj: 0, cols: 0, maxNodes: 0, a1: 0, a2: 0, ns: 0, expanded: 0, bi0: 0, bi1: 0, bj0: 0, bj1: 0, s: 0, k: 0 };
anyFields(HOT, null, 'nearE', 'lk', 'dynB', 'avM', 'frM');
function hotRun(S) {
  const heap = S.heap, cellOf = S.cellOf, st = S.st, slotOf = S.slotOf, g = S.g, f = S.f, parent = S.parent, via = S.via;
  const nbm = S.nbm, nearE = S.nearE, lk = S.lk, dynB = S.dynB, avM = S.avM, frM = S.frM, mul = S.mul, NONE = B.NONE;
  const cid = S.cid, oid = S.oid, goalK = S.goalK, gi = S.gi, gj = S.gj, cols = S.cols, maxNodes = S.maxNodes, a1 = S.a1, a2 = S.a2;
  let ns = S.ns, expanded = S.expanded, bi0 = S.bi0, bi1 = S.bi1, bj0 = S.bj0, bj1 = S.bj1, out = 0;
  while (heap.size > 0) {
    const s = heap.pop(), k = cellOf[s];
    if (st[k] === cid) continue;
    st[k] = cid;
    if (k === goalK) { S.s = s; out = 1; break; }
    if (++expanded > maxNodes) { out = 2; break; }
    searchStats.expanded++;
    const i = k % cols, j = (k - i) / cols;
    if (i < bi0) bi0 = i; else if (i > bi1) bi1 = i;
    if (j < bj0) bj0 = j; else if (j > bj1) bj1 = j;
    if (expanded === a1 || expanded === a2 || (lk !== null && lk[k] !== 0) || (nearE !== null && nearE[k] !== 0)) { S.s = s; S.k = k; out = 3; break; }
    const m = nbm[k];
    if (m !== 0) {
      const gk = g[s], kE = k + 1, kW = k - 1, kS = k + cols, kN = k - cols;
      const dE = (m & 0x31) !== 0 && (dynB === null || dynB[kE] === NONE) && (avM === null || !avM[kE]) && (frM === null || frM[kE] === 0);
      const dW = (m & 0xc2) !== 0 && (dynB === null || dynB[kW] === NONE) && (avM === null || !avM[kW]) && (frM === null || frM[kW] === 0);
      const dS = (m & 0x54) !== 0 && (dynB === null || dynB[kS] === NONE) && (avM === null || !avM[kS]) && (frM === null || frM[kS] === 0);
      const dN = (m & 0xa8) !== 0 && (dynB === null || dynB[kN] === NONE) && (avM === null || !avM[kN]) && (frM === null || frM[kN] === 0);
      if ((m & 1) !== 0 && dE && st[kE] !== cid) { // E
        let step = 1;
        step *= MUL_OF[mul[kE]];
        const ng = gk + step;
        let t = -1;
        if (st[kE] !== oid) { t = ns++; st[kE] = oid; slotOf[kE] = t; cellOf[t] = kE; } else if (ng < g[slotOf[kE]]) t = slotOf[kE];
        if (t >= 0) {
          g[t] = ng; parent[t] = s; via[t] = 0;
          const hi = i + 1, hj = j, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
          f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
          heap.push(t);
        }
      }
      if ((m & 2) !== 0 && dW && st[kW] !== cid) { // W
        let step = 1;
        step *= MUL_OF[mul[kW]];
        const ng = gk + step;
        let t = -1;
        if (st[kW] !== oid) { t = ns++; st[kW] = oid; slotOf[kW] = t; cellOf[t] = kW; } else if (ng < g[slotOf[kW]]) t = slotOf[kW];
        if (t >= 0) {
          g[t] = ng; parent[t] = s; via[t] = 0;
          const hi = i - 1, hj = j, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
          f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
          heap.push(t);
        }
      }
      if ((m & 4) !== 0 && dS && st[kS] !== cid) { // S
        let step = 1;
        step *= MUL_OF[mul[kS]];
        const ng = gk + step;
        let t = -1;
        if (st[kS] !== oid) { t = ns++; st[kS] = oid; slotOf[kS] = t; cellOf[t] = kS; } else if (ng < g[slotOf[kS]]) t = slotOf[kS];
        if (t >= 0) {
          g[t] = ng; parent[t] = s; via[t] = 0;
          const hi = i, hj = j + 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
          f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
          heap.push(t);
        }
      }
      if ((m & 8) !== 0 && dN && st[kN] !== cid) { // N
        let step = 1;
        step *= MUL_OF[mul[kN]];
        const ng = gk + step;
        let t = -1;
        if (st[kN] !== oid) { t = ns++; st[kN] = oid; slotOf[kN] = t; cellOf[t] = kN; } else if (ng < g[slotOf[kN]]) t = slotOf[kN];
        if (t >= 0) {
          g[t] = ng; parent[t] = s; via[t] = 0;
          const hi = i, hj = j - 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
          f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
          heap.push(t);
        }
      }
      if ((m & 16) !== 0 && dE && dS) { // SE
        const q = kS + 1;
        if ((dynB === null || dynB[q] === NONE) && (avM === null || !avM[q]) && (frM === null || frM[q] === 0) && st[q] !== cid) {
          let step = SQRT2;
          step *= MUL_OF[mul[q]];
          const ng = gk + step;
          let t = -1;
          if (st[q] !== oid) { t = ns++; st[q] = oid; slotOf[q] = t; cellOf[t] = q; } else if (ng < g[slotOf[q]]) t = slotOf[q];
          if (t >= 0) {
            g[t] = ng; parent[t] = s; via[t] = 0;
            const hi = i + 1, hj = j + 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
            f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
            heap.push(t);
          }
        }
      }
      if ((m & 32) !== 0 && dE && dN) { // NE
        const q = kN + 1;
        if ((dynB === null || dynB[q] === NONE) && (avM === null || !avM[q]) && (frM === null || frM[q] === 0) && st[q] !== cid) {
          let step = SQRT2;
          step *= MUL_OF[mul[q]];
          const ng = gk + step;
          let t = -1;
          if (st[q] !== oid) { t = ns++; st[q] = oid; slotOf[q] = t; cellOf[t] = q; } else if (ng < g[slotOf[q]]) t = slotOf[q];
          if (t >= 0) {
            g[t] = ng; parent[t] = s; via[t] = 0;
            const hi = i + 1, hj = j - 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
            f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
            heap.push(t);
          }
        }
      }
      if ((m & 64) !== 0 && dW && dS) { // SW
        const q = kS - 1;
        if ((dynB === null || dynB[q] === NONE) && (avM === null || !avM[q]) && (frM === null || frM[q] === 0) && st[q] !== cid) {
          let step = SQRT2;
          step *= MUL_OF[mul[q]];
          const ng = gk + step;
          let t = -1;
          if (st[q] !== oid) { t = ns++; st[q] = oid; slotOf[q] = t; cellOf[t] = q; } else if (ng < g[slotOf[q]]) t = slotOf[q];
          if (t >= 0) {
            g[t] = ng; parent[t] = s; via[t] = 0;
            const hi = i - 1, hj = j + 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
            f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
            heap.push(t);
          }
        }
      }
      if ((m & 128) !== 0 && dW && dN) { // NW
        const q = kN - 1;
        if ((dynB === null || dynB[q] === NONE) && (avM === null || !avM[q]) && (frM === null || frM[q] === 0) && st[q] !== cid) {
          let step = SQRT2;
          step *= MUL_OF[mul[q]];
          const ng = gk + step;
          let t = -1;
          if (st[q] !== oid) { t = ns++; st[q] = oid; slotOf[q] = t; cellOf[t] = q; } else if (ng < g[slotOf[q]]) t = slotOf[q];
          if (t >= 0) {
            g[t] = ng; parent[t] = s; via[t] = 0;
            const hi = i - 1, hj = j - 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
            f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
            heap.push(t);
          }
        }
      }
    }
  }
  S.ns = ns; S.expanded = expanded; S.bi0 = bi0; S.bi1 = bi1; S.bj0 = bj0; S.bj1 = bj1;
  return out;
}

/** findPath's A*; `openEnds`: the ladder ends a clearance mask shuts are open as ladder ends (stepped onto to climb,
 * stepped off from it, never walked through); `info.endBlocked`: set when a search without them met one. */
function searchPath(grid, sx, sz, tx, tz, opts, openEnds, info) {
  const swim = !!opts.swim;
  // (fire: burning cells, only while any burn — the search is the same as without it otherwise)
  const fire = opts.fire && grid.fireCells > 0 && !opts.dive ? opts.fire : null;
  const walkOpts = { swim, dynamic: !!opts.dynamic, dive: !!opts.dive, avoid: opts.avoid || null, fire, fireV: fire ? grid.fireVersion : 0 };
  const nearR = opts.nearRadius ?? NEAREST_WALKABLE_RADIUS;
  const role = opts.role;
  // (noLinks: no climbing — a walked link, a flight of stairs or a plank, stays open unless noWalkLinks too)
  const hasLinks = (!opts.noLinks || !opts.noWalkLinks) && grid.links && grid.links.length > 0;
  const maxNodes = opts.maxNodes ?? 40000;
  const c = grid.cell;
  const cols = grid.cols;
  // (a ladder's two ends — where a man stands to climb it — under a body-clearance mask: `openEnds`, open as the
  // ladder's ends; else noted when the search meets one, `info.endBlocked`)
  const allEnds = walkOpts.avoid && hasLinks ? ladderEnds(grid) : null, ends = openEnds ? allEnds : null;
  const bare = allEnds ? { ...walkOpts, avoid: null } : null;
  const isEnd = (i, j) => allEnds !== null && grid.inBounds(i, j) && allEnds.has(j * cols + i) && grid.isWalkable(i, j, bare);
  const walk = walker(grid, walkOpts);
  const open = ends ? (i, j) => walk(i, j) || isEnd(i, j) : walk;
  // (`meet`: the search notes a ladder end the mask shuts that it met — noteEnd, a module function: no closure a search
  // for the optimized code's calls to see change)
  const meet = !!(info && allEnds);
  // (the goal's pocket counts the ends open either way: a pocket shut without them is shut with them too, or not one)
  const pocketOpen = allEnds ? (i, j) => walk(i, j) || isEnd(i, j) : open;

  // Start: if the unit stands in a blocked cell (pushed/spawned badly), leave via the nearest walkable one.
  let start = { x: sx, z: sz };
  let si = Math.floor(sx / c), sj = Math.floor(sz / c);
  // (starting or ending on a ladder's end the mask shuts — just down a tank's ladder, or ordered up it: with the ends open)
  if (meet && (isEnd(si, sj) && !open(si, sj) || isEnd(Math.floor(tx / c), Math.floor(tz / c)) && !open(Math.floor(tx / c), Math.floor(tz / c)))) {
    info.endBlocked = true;
    return null;
  }
  if (!open(si, sj)) {
    let n = grid.nearestWalkable(sx, sz, NEAREST_WALKABLE_RADIUS, walkOpts);
    if (!n) return null;
    // (taut, a player's man on his feet: shut in by the body-clearance mask he steps out on his way — the free cell
    // within half a metre more than the nearest one that lies most toward the goal — not back to the nearest one behind
    // him. Not a crawler: his length does not turn or slide out where a free cell's centre does — M15, the Spy)
    if (opts.taut && !opts.lying && walkOpts.avoid) n = stepOutToward(grid, sx, sz, tx, tz, n, walkOpts) || n;
    si = n.i; sj = n.j; start = { x: n.x, z: n.z };
    if (info) info.moved = true;
  }
  // Goal: substitute the nearest walkable cell within 3 m.
  let goal = { x: tx, z: tz };
  let gi = Math.floor(tx / c), gj = Math.floor(tz / c);
  if (!open(gi, gj)) {
    const n = grid.nearestWalkable(tx, tz, nearR, walkOpts);
    if (!n) return null;
    gi = n.i; gj = n.j; goal = { x: n.x, z: n.z };
    if (info) info.moved = true;
  }
  // (a stride's reach off the wall: the leading boot of a unit arriving at a run stops short of it)
  goal = clearOfWalls(grid, goal.x, goal.z, gi, gj, GOAL_CLEARANCE);
  if (si === gi && sj === gj) return [start, goal];

  const startK = sj * cols + si, goalK = gj * cols + gi;
  // (the goal in another walkable area than the start: no search can join them — areasFor. Asked at once when this grid
  // version's labelling is at hand; else only when the search runs on past AREAS_AT cells or ends without the goal —
  // a search that finds its goal never needed it (a blast's tick: every guard who heard it off to it, the labelling
  // built anew after each of the blast's version bumps, ~1.5–3 ms a time). The same answer: a search that finds its
  // goal joins two cells of one area, and one that learns late that the areas differ returns null as it would have at
  // once — the cells it expanded taken back off searchStats, its ladder-end note (info.endBlocked) as it found it)
  let areasDone = !!walkOpts.dive;
  if (!areasDone && !codeWarm) {
    const lab = areasCached(grid, walkOpts, role, opts, hasLinks);
    if (lab) { areasDone = true; if (lab[startK] && lab[goalK] && lab[startK] !== lab[goalK]) return null; }
  }
  // (the late area answer — areasApart, areasDone set first — is a module function, and giving back the cells counted is
  // written out where it is asked: the optimized search meets no closure of an earlier search there — M14's barrel blast
  // threw the search's optimized code out twice, mid-tick: 'insufficient type feedback', then 'wrong call target')
  // (a failed search this epoch reached this start but not this goal: the goal is out of this start's reach too)
  const memo = opts.memo != null && !walkOpts.dynamic ? failMemo(grid, opts.memo) : null;
  const memoKey = memo ? failKey(walkOpts, opts) + (ends ? '|ends' : '') : null;
  if (memo) {
    // (null either way: the areas asked only where they decide whether the reach's ladder-end note passes on — a
    // labelling flooded for nothing else was ~2-5 ms of M8's blast tick, a guard who heard it from a pocket's reach)
    for (const reach of memo.sets.get(memoKey) || EMPTY_SETS) if (reach[startK] && !reach[goalK]) { if (info && reach.endBlocked) { if (!areasDone) { areasDone = true; if (areasApart(grid, walkOpts, role, opts, hasLinks, startK, goalK)) return null; } info.endBlocked = true; } return null; }
    // (or this goal's pocket — every cell that can reach it — was enumerated this epoch, without this start)
    const pocket = memo.pockets.get(`${memoKey}|${goalK}`);
    if (pocket && !pocket.has(startK)) return null;
  }
  const b = buffers(grid);
  const { g, f, parent, via, cellOf, st, slotOf } = b;
  const oid = 2 * b.search, cid = oid + 1;
  const heap = new NodeHeap(b.heap, f);
  const h = (i, j) => {
    const dx = Math.abs(i - gi), dz = Math.abs(j - gj);
    return (dx + dz) + (SQRT2 - 2) * Math.min(dx, dz);
  };
  st[startK] = oid; slotOf[startK] = 0; cellOf[0] = startK;
  g[0] = 0;
  f[0] = h(si, sj);
  parent[0] = -1;
  via[0] = 0;
  heap.push(0);
  let ns = 1, goalS = -1;
  let expanded = 0;
  let found = false, capped = false;
  // (what an at-once area answer would have left: the late answer gives the cells counted back — areasApart above)
  const expanded0 = searchStats.expanded, endBlocked0 = info ? info.endBlocked : false;
  // (the box of cells the search looks at: the cells it expands, the links' far ends — findPath's reuse)
  let bi0 = Math.min(si, gi), bi1 = Math.max(si, gi), bj0 = Math.min(sj, gj), bj1 = Math.max(sj, gj);
  const terrain = grid.terrain, bridge = grid.bridge;
  // (the common case — on foot or swimming, no ladder ends to open: `open` is grid.isWalkable(walkOpts) — tested inline
  // on the layers, cell by cell: the same answers without the call and its option lookups per neighbour)
  // (a diver too — grid.isWalkable's dive rules: the static layer staticLayers keeps for them, the underpass cells read
  // off the grid — M18's Marine up the river: ~25k cells a search, 21 ms with the test called cell by cell)
  const dive = walkOpts.dive, under = grid.underpass;
  const fast = ends === null && !!grid.block && !!grid.navBlock && !!grid.fenceHole && !!bridge && !!terrain && (!dive || !!under), rows = grid.rows;
  const { block, navBlock, fenceHole, dynamicBlock } = grid, dyn = walkOpts.dynamic, avoid = walkOpts.avoid;
  const SL = fast ? staticLayers(grid, swim, true, dive) : null, sOpen = SL ? SL.open[dive ? 2 : swim ? 1 : 0] : null, mul = SL ? SL.mul : null, linked = SL ? SL.linked : null;
  // (the fast path's walk test, written out where it is asked — no call per neighbour: the static layer, then the
  // vehicles and the mask; a diver's underpass cells are open whatever else, the clearance mask is no diver's —
  // grid.isWalkable. `undQ` / `dynB` / `avM`: null when the rule does not apply; `frM`: the fires' layer while any burn —
  // a burning cell kept out of like the mask's, whatever the ladder ends: world/fires.js)
  const NONE = B.NONE, undQ = fast && dive ? under : null, dynB = fast && dyn ? dynamicBlock : null, avM = fast && !dive && avoid ? avoid : null;
  const frM = fast && fire ? fire : null;
  // (`meet` asked only where a ladder end lies: the others are none — isEnd's set lookup per shut neighbour, spared)
  const endF = fast && meet ? ladderEndFlags(grid) : null;
  // (the step masks of this walk layer — staticLayers' nb — and, when ladder ends are noted, the cells beside one: those
  // take the cell-by-cell path below; not a diver's search)
  const nbm = SL !== null && !dive ? stepMasksOf(SL, grid, swim ? 1 : 0) : null, nearE = endF !== null ? ladderEndNear(grid) : null;
  // (grid.canStep, inline, from the cell being expanded — its height and run read once for its eight neighbours: the
  // elevation step, then a ramp / stair run's sides, the grid's own test)
  const elev = grid.elev, runOf = grid.runOf;
  let ek = 0, rk = 0, kk = 0;
  const stepOut = (q) => Math.abs(ek - elev[q]) <= MAX_STEP && (!runOf || rk === runOf[q] || grid.canStep(kk, q));
  // (hugsObstacle, inline: an edge neighbour blocked by a structure)
  const hugsK = (hi, hj, q) => (hi + 1 < cols && (block[q + 1] !== B.NONE || !!navBlock[q + 1])) || (hi > 0 && (block[q - 1] !== B.NONE || !!navBlock[q - 1]))
    || (hj + 1 < rows && (block[q + cols] !== B.NONE || !!navBlock[q + cols])) || (hj > 0 && (block[q - cols] !== B.NONE || !!navBlock[q - cols]));

  // (the step masks' cells in hotRun, a function of its own; the cells it hands back — and every cell when the masks do not
  // serve — in this loop, as ever)
  const hot = nbm !== null && (!hasLinks || linked !== null) ? HOT : null;
  if (hot !== null) {
    hot.heap = heap; hot.cellOf = cellOf; hot.st = st; hot.slotOf = slotOf; hot.g = g; hot.f = f; hot.parent = parent; hot.via = via;
    hot.nbm = nbm; hot.nearE = nearE; hot.lk = hasLinks ? linked : null; hot.dynB = dynB; hot.avM = avM; hot.frM = frM; hot.mul = mul;
    hot.cid = cid; hot.oid = oid; hot.goalK = goalK; hot.gi = gi; hot.gj = gj; hot.cols = cols; hot.maxNodes = maxNodes; hot.a2 = POCKET_AT;
  }
  for (;;) {
    let s, k;
    if (hot !== null) {
      hot.a1 = areasDone ? -1 : AREAS_AT;
      hot.ns = ns; hot.expanded = expanded; hot.bi0 = bi0; hot.bi1 = bi1; hot.bj0 = bj0; hot.bj1 = bj1;
      const r = hotRun(hot);
      ns = hot.ns; expanded = hot.expanded; bi0 = hot.bi0; bi1 = hot.bi1; bj0 = hot.bj0; bj1 = hot.bj1;
      if (r === 1) { found = true; goalS = hot.s; break; }
      if (r === 2) { capped = true; break; }
      if (r === 0) break;
      s = hot.s; k = hot.k;
    } else {
      if (heap.size === 0) break;
      s = heap.pop(); k = cellOf[s];
      if (st[k] === cid) continue;
      st[k] = cid;
      if (k === goalK) { found = true; goalS = s; break; }
      if (++expanded > maxNodes) { capped = true; break; }
      searchStats.expanded++;
    }
    if (expanded === AREAS_AT && !areasDone) {
      areasDone = true;
      if (areasApart(grid, walkOpts, role, opts, hasLinks, startK, goalK)) { searchStats.expanded = expanded0; if (info) info.endBlocked = endBlocked0; return null; }
    }
    // (a long search: is the goal shut in a small pocket this start cannot be in? then it fails — no need to flood)
    // (a goal already found this epoch to have more than POCKET_MAX cells able to reach it is in no small pocket, whatever
    // the start: that enumeration never depended on the start but to stop at it — three guards off to one blast ask once)
    if (expanded === POCKET_AT && !(memo && wideOf(grid).has(`${memoKey}|${goalK}`))) {
      const po = { wide: false };
      const pocket = fast && !dive ? goalPocketExcludesOpen(grid, goalK, startK, sOpen, dynB, avM, frM, allEnds ? ladderEndFlags(grid) : null, role, hasLinks, !!opts.noLinks, po)
        : goalPocketExcludes(grid, goalK, startK, walkOpts, role, hasLinks, !!opts.noLinks, pocketOpen, po);
      if (pocket) { if (memo) memo.pockets.set(`${memoKey}|${goalK}`, new Set(pocket)); return null; }
      if (po.wide && memo) wideOf(grid).add(`${memoKey}|${goalK}`);
    }
    const i = k % cols, j = (k - i) / cols;
    if (i < bi0) bi0 = i; else if (i > bi1) bi1 = i;
    if (j < bj0) bj0 = j; else if (j > bj1) bj1 = j;
    // (a ladder end the clearance mask shuts, reached on foot: only its ladder goes on from it)
    const endOnly = ends !== null && walkOpts.avoid[k] && via[s] === 0 && k !== startK;
    const gk = g[s];
    ek = elev[k]; rk = runOf ? runOf[k] : 0; kk = k;
    if (nbm !== null && (nearE === null || nearE[k] === 0)) {
      // (the step masks: the eight neighbours' static walk and step tests — the corner rule's two cells for a diagonal —
      // in one byte; the vehicles and the clearance mask still asked of each cell: its own, and a diagonal's two beside
      // it. The same pushes in the same order (E W S N, SE NE SW NW) as the cell-by-cell path below)
      const m = nbm[k];
      if (m !== 0) {
        const kE = k + 1, kW = k - 1, kS = k + cols, kN = k - cols;
        const dE = (m & 0x31) !== 0 && (dynB === null || dynB[kE] === NONE) && (avM === null || !avM[kE]) && (frM === null || frM[kE] === 0);
        const dW = (m & 0xc2) !== 0 && (dynB === null || dynB[kW] === NONE) && (avM === null || !avM[kW]) && (frM === null || frM[kW] === 0);
        const dS = (m & 0x54) !== 0 && (dynB === null || dynB[kS] === NONE) && (avM === null || !avM[kS]) && (frM === null || frM[kS] === 0);
        const dN = (m & 0xa8) !== 0 && (dynB === null || dynB[kN] === NONE) && (avM === null || !avM[kN]) && (frM === null || frM[kN] === 0);
        if ((m & 1) !== 0 && dE && st[kE] !== cid) { // E
          {
            let step = 1;
            step *= MUL_OF[mul[kE]];
            const ng = gk + step;
            let t = -1;
            if (st[kE] !== oid) { t = ns++; st[kE] = oid; slotOf[kE] = t; cellOf[t] = kE; } else if (ng < g[slotOf[kE]]) t = slotOf[kE];
            if (t >= 0) {
              g[t] = ng; parent[t] = s; via[t] = 0;
              const hi = i + 1, hj = j, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
              f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
              heap.push(t);
            }
          }
        }
        if ((m & 2) !== 0 && dW && st[kW] !== cid) { // W
          {
            let step = 1;
            step *= MUL_OF[mul[kW]];
            const ng = gk + step;
            let t = -1;
            if (st[kW] !== oid) { t = ns++; st[kW] = oid; slotOf[kW] = t; cellOf[t] = kW; } else if (ng < g[slotOf[kW]]) t = slotOf[kW];
            if (t >= 0) {
              g[t] = ng; parent[t] = s; via[t] = 0;
              const hi = i - 1, hj = j, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
              f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
              heap.push(t);
            }
          }
        }
        if ((m & 4) !== 0 && dS && st[kS] !== cid) { // S
          {
            let step = 1;
            step *= MUL_OF[mul[kS]];
            const ng = gk + step;
            let t = -1;
            if (st[kS] !== oid) { t = ns++; st[kS] = oid; slotOf[kS] = t; cellOf[t] = kS; } else if (ng < g[slotOf[kS]]) t = slotOf[kS];
            if (t >= 0) {
              g[t] = ng; parent[t] = s; via[t] = 0;
              const hi = i, hj = j + 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
              f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
              heap.push(t);
            }
          }
        }
        if ((m & 8) !== 0 && dN && st[kN] !== cid) { // N
          {
            let step = 1;
            step *= MUL_OF[mul[kN]];
            const ng = gk + step;
            let t = -1;
            if (st[kN] !== oid) { t = ns++; st[kN] = oid; slotOf[kN] = t; cellOf[t] = kN; } else if (ng < g[slotOf[kN]]) t = slotOf[kN];
            if (t >= 0) {
              g[t] = ng; parent[t] = s; via[t] = 0;
              const hi = i, hj = j - 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
              f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
              heap.push(t);
            }
          }
        }
        if ((m & 16) !== 0 && dE && dS) { // SE
          const q = kS + 1;
          if ((dynB === null || dynB[q] === NONE) && (avM === null || !avM[q]) && (frM === null || frM[q] === 0) && st[q] !== cid) {
            let step = SQRT2;
            step *= MUL_OF[mul[q]];
            const ng = gk + step;
            let t = -1;
            if (st[q] !== oid) { t = ns++; st[q] = oid; slotOf[q] = t; cellOf[t] = q; } else if (ng < g[slotOf[q]]) t = slotOf[q];
            if (t >= 0) {
              g[t] = ng; parent[t] = s; via[t] = 0;
              const hi = i + 1, hj = j + 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
              f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
              heap.push(t);
            }
          }
        }
        if ((m & 32) !== 0 && dE && dN) { // NE
          const q = kN + 1;
          if ((dynB === null || dynB[q] === NONE) && (avM === null || !avM[q]) && (frM === null || frM[q] === 0) && st[q] !== cid) {
            let step = SQRT2;
            step *= MUL_OF[mul[q]];
            const ng = gk + step;
            let t = -1;
            if (st[q] !== oid) { t = ns++; st[q] = oid; slotOf[q] = t; cellOf[t] = q; } else if (ng < g[slotOf[q]]) t = slotOf[q];
            if (t >= 0) {
              g[t] = ng; parent[t] = s; via[t] = 0;
              const hi = i + 1, hj = j - 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
              f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
              heap.push(t);
            }
          }
        }
        if ((m & 64) !== 0 && dW && dS) { // SW
          const q = kS - 1;
          if ((dynB === null || dynB[q] === NONE) && (avM === null || !avM[q]) && (frM === null || frM[q] === 0) && st[q] !== cid) {
            let step = SQRT2;
            step *= MUL_OF[mul[q]];
            const ng = gk + step;
            let t = -1;
            if (st[q] !== oid) { t = ns++; st[q] = oid; slotOf[q] = t; cellOf[t] = q; } else if (ng < g[slotOf[q]]) t = slotOf[q];
            if (t >= 0) {
              g[t] = ng; parent[t] = s; via[t] = 0;
              const hi = i - 1, hj = j + 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
              f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
              heap.push(t);
            }
          }
        }
        if ((m & 128) !== 0 && dW && dN) { // NW
          const q = kN - 1;
          if ((dynB === null || dynB[q] === NONE) && (avM === null || !avM[q]) && (frM === null || frM[q] === 0) && st[q] !== cid) {
            let step = SQRT2;
            step *= MUL_OF[mul[q]];
            const ng = gk + step;
            let t = -1;
            if (st[q] !== oid) { t = ns++; st[q] = oid; slotOf[q] = t; cellOf[t] = q; } else if (ng < g[slotOf[q]]) t = slotOf[q];
            if (t >= 0) {
              g[t] = ng; parent[t] = s; via[t] = 0;
              const hi = i - 1, hj = j - 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
              f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
              heap.push(t);
            }
          }
        }
      }
    } else if (fast) {
      // (grid.isWalkable under these rules, inline: on the map, the static layer, the vehicles, the mask — the four edge
      // neighbours' walk tests once, their step tests once when first asked (`s?`: -1 not yet); then the eight in DI / DJ's
      // order, written out one by one: E W S N, SE NE SW NW. A ladder end off the map is none: `noteEnd` asks only on it)
      const inE = i + 1 < cols, inW = i > 0, inS = j + 1 < rows, inN = j > 0, kE = k + 1, kW = k - 1, kS = k + cols, kN = k - cols;
      const wE = inE && ((undQ !== null && undQ[kE] !== 0) || (sOpen[kE] === 1 && (dynB === null || dynB[kE] === NONE) && (avM === null || !avM[kE]) && (frM === null || frM[kE] === 0))), wW = inW && ((undQ !== null && undQ[kW] !== 0) || (sOpen[kW] === 1 && (dynB === null || dynB[kW] === NONE) && (avM === null || !avM[kW]) && (frM === null || frM[kW] === 0)));
      const wS = inS && ((undQ !== null && undQ[kS] !== 0) || (sOpen[kS] === 1 && (dynB === null || dynB[kS] === NONE) && (avM === null || !avM[kS]) && (frM === null || frM[kS] === 0))), wN = inN && ((undQ !== null && undQ[kN] !== 0) || (sOpen[kN] === 1 && (dynB === null || dynB[kN] === NONE) && (avM === null || !avM[kN]) && (frM === null || frM[kN] === 0)));
      let sE = -1, sW = -1, sS = -1, sN = -1;
      if (!wE) { if (endF !== null && inE && endF[kE] === 1) noteEnd(grid, allEnds, bare, info, i + 1, j); }
      else if (st[kE] !== cid) {
        if (!(Math.abs(ek - elev[kE]) <= MAX_STEP && (!runOf || rk === runOf[kE] || grid.canStep(k, kE)))) sE = 0;
        else {
          sE = 1;
          let step = 1;
          if (mul) step *= MUL_OF[mul[kE]];
          else { const t = terrain[kE]; if ((t === T.WATER || t === T.SHALLOW) && !bridge[kE]) step *= WATER_COST; else if (hugsK(i + 1, j, kE)) step *= HUG_COST; }
          const ng = gk + step;
          let t = -1;
          if (st[kE] !== oid) { t = ns++; st[kE] = oid; slotOf[kE] = t; cellOf[t] = kE; } else if (ng < g[slotOf[kE]]) t = slotOf[kE];
          if (t >= 0) {
            g[t] = ng; parent[t] = s; via[t] = 0;
            const hi = i + 1, hj = j, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
            f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
            heap.push(t);
          }
        }
      }
      if (!wW) { if (endF !== null && inW && endF[kW] === 1) noteEnd(grid, allEnds, bare, info, i - 1, j); }
      else if (st[kW] !== cid) {
        if (!(Math.abs(ek - elev[kW]) <= MAX_STEP && (!runOf || rk === runOf[kW] || grid.canStep(k, kW)))) sW = 0;
        else {
          sW = 1;
          let step = 1;
          if (mul) step *= MUL_OF[mul[kW]];
          else { const t = terrain[kW]; if ((t === T.WATER || t === T.SHALLOW) && !bridge[kW]) step *= WATER_COST; else if (hugsK(i - 1, j, kW)) step *= HUG_COST; }
          const ng = gk + step;
          let t = -1;
          if (st[kW] !== oid) { t = ns++; st[kW] = oid; slotOf[kW] = t; cellOf[t] = kW; } else if (ng < g[slotOf[kW]]) t = slotOf[kW];
          if (t >= 0) {
            g[t] = ng; parent[t] = s; via[t] = 0;
            const hi = i - 1, hj = j, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
            f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
            heap.push(t);
          }
        }
      }
      if (!wS) { if (endF !== null && inS && endF[kS] === 1) noteEnd(grid, allEnds, bare, info, i, j + 1); }
      else if (st[kS] !== cid) {
        if (!(Math.abs(ek - elev[kS]) <= MAX_STEP && (!runOf || rk === runOf[kS] || grid.canStep(k, kS)))) sS = 0;
        else {
          sS = 1;
          let step = 1;
          if (mul) step *= MUL_OF[mul[kS]];
          else { const t = terrain[kS]; if ((t === T.WATER || t === T.SHALLOW) && !bridge[kS]) step *= WATER_COST; else if (hugsK(i, j + 1, kS)) step *= HUG_COST; }
          const ng = gk + step;
          let t = -1;
          if (st[kS] !== oid) { t = ns++; st[kS] = oid; slotOf[kS] = t; cellOf[t] = kS; } else if (ng < g[slotOf[kS]]) t = slotOf[kS];
          if (t >= 0) {
            g[t] = ng; parent[t] = s; via[t] = 0;
            const hi = i, hj = j + 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
            f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
            heap.push(t);
          }
        }
      }
      if (!wN) { if (endF !== null && inN && endF[kN] === 1) noteEnd(grid, allEnds, bare, info, i, j - 1); }
      else if (st[kN] !== cid) {
        if (!(Math.abs(ek - elev[kN]) <= MAX_STEP && (!runOf || rk === runOf[kN] || grid.canStep(k, kN)))) sN = 0;
        else {
          sN = 1;
          let step = 1;
          if (mul) step *= MUL_OF[mul[kN]];
          else { const t = terrain[kN]; if ((t === T.WATER || t === T.SHALLOW) && !bridge[kN]) step *= WATER_COST; else if (hugsK(i, j - 1, kN)) step *= HUG_COST; }
          const ng = gk + step;
          let t = -1;
          if (st[kN] !== oid) { t = ns++; st[kN] = oid; slotOf[kN] = t; cellOf[t] = kN; } else if (ng < g[slotOf[kN]]) t = slotOf[kN];
          if (t >= 0) {
            g[t] = ng; parent[t] = s; via[t] = 0;
            const hi = i, hj = j - 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
            f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
            heap.push(t);
          }
        }
      }
      if (inE && inS) { // SE
        const q = kS + 1;
        if (!((undQ !== null && undQ[q] !== 0) || (sOpen[q] === 1 && (dynB === null || dynB[q] === NONE) && (avM === null || !avM[q]) && (frM === null || frM[q] === 0)))) { if (endF !== null && endF[q] === 1) noteEnd(grid, allEnds, bare, info, i + 1, j + 1); }
        // (no corner cutting: both edge neighbours free and steppable)
        else if (wE && wS && st[q] !== cid && (Math.abs(ek - elev[q]) <= MAX_STEP && (!runOf || rk === runOf[q] || grid.canStep(k, q)))) {
          if (sE === -1) sE = (Math.abs(ek - elev[kE]) <= MAX_STEP && (!runOf || rk === runOf[kE] || grid.canStep(k, kE))) ? 1 : 0;
          if (sE === 1) {
            if (sS === -1) sS = (Math.abs(ek - elev[kS]) <= MAX_STEP && (!runOf || rk === runOf[kS] || grid.canStep(k, kS))) ? 1 : 0;
            if (sS === 1) {
              let step = SQRT2;
              if (mul) step *= MUL_OF[mul[q]];
              else { const t = terrain[q]; if ((t === T.WATER || t === T.SHALLOW) && !bridge[q]) step *= WATER_COST; else if (hugsK(i + 1, j + 1, q)) step *= HUG_COST; }
              const ng = gk + step;
              let t = -1;
              if (st[q] !== oid) { t = ns++; st[q] = oid; slotOf[q] = t; cellOf[t] = q; } else if (ng < g[slotOf[q]]) t = slotOf[q];
              if (t >= 0) {
                g[t] = ng; parent[t] = s; via[t] = 0;
                const hi = i + 1, hj = j + 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
                f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
                heap.push(t);
              }
            }
          }
        }
      }
      if (inE && inN) { // NE
        const q = kN + 1;
        if (!((undQ !== null && undQ[q] !== 0) || (sOpen[q] === 1 && (dynB === null || dynB[q] === NONE) && (avM === null || !avM[q]) && (frM === null || frM[q] === 0)))) { if (endF !== null && endF[q] === 1) noteEnd(grid, allEnds, bare, info, i + 1, j - 1); }
        // (no corner cutting: both edge neighbours free and steppable)
        else if (wE && wN && st[q] !== cid && (Math.abs(ek - elev[q]) <= MAX_STEP && (!runOf || rk === runOf[q] || grid.canStep(k, q)))) {
          if (sE === -1) sE = (Math.abs(ek - elev[kE]) <= MAX_STEP && (!runOf || rk === runOf[kE] || grid.canStep(k, kE))) ? 1 : 0;
          if (sE === 1) {
            if (sN === -1) sN = (Math.abs(ek - elev[kN]) <= MAX_STEP && (!runOf || rk === runOf[kN] || grid.canStep(k, kN))) ? 1 : 0;
            if (sN === 1) {
              let step = SQRT2;
              if (mul) step *= MUL_OF[mul[q]];
              else { const t = terrain[q]; if ((t === T.WATER || t === T.SHALLOW) && !bridge[q]) step *= WATER_COST; else if (hugsK(i + 1, j - 1, q)) step *= HUG_COST; }
              const ng = gk + step;
              let t = -1;
              if (st[q] !== oid) { t = ns++; st[q] = oid; slotOf[q] = t; cellOf[t] = q; } else if (ng < g[slotOf[q]]) t = slotOf[q];
              if (t >= 0) {
                g[t] = ng; parent[t] = s; via[t] = 0;
                const hi = i + 1, hj = j - 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
                f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
                heap.push(t);
              }
            }
          }
        }
      }
      if (inW && inS) { // SW
        const q = kS - 1;
        if (!((undQ !== null && undQ[q] !== 0) || (sOpen[q] === 1 && (dynB === null || dynB[q] === NONE) && (avM === null || !avM[q]) && (frM === null || frM[q] === 0)))) { if (endF !== null && endF[q] === 1) noteEnd(grid, allEnds, bare, info, i - 1, j + 1); }
        // (no corner cutting: both edge neighbours free and steppable)
        else if (wW && wS && st[q] !== cid && (Math.abs(ek - elev[q]) <= MAX_STEP && (!runOf || rk === runOf[q] || grid.canStep(k, q)))) {
          if (sW === -1) sW = (Math.abs(ek - elev[kW]) <= MAX_STEP && (!runOf || rk === runOf[kW] || grid.canStep(k, kW))) ? 1 : 0;
          if (sW === 1) {
            if (sS === -1) sS = (Math.abs(ek - elev[kS]) <= MAX_STEP && (!runOf || rk === runOf[kS] || grid.canStep(k, kS))) ? 1 : 0;
            if (sS === 1) {
              let step = SQRT2;
              if (mul) step *= MUL_OF[mul[q]];
              else { const t = terrain[q]; if ((t === T.WATER || t === T.SHALLOW) && !bridge[q]) step *= WATER_COST; else if (hugsK(i - 1, j + 1, q)) step *= HUG_COST; }
              const ng = gk + step;
              let t = -1;
              if (st[q] !== oid) { t = ns++; st[q] = oid; slotOf[q] = t; cellOf[t] = q; } else if (ng < g[slotOf[q]]) t = slotOf[q];
              if (t >= 0) {
                g[t] = ng; parent[t] = s; via[t] = 0;
                const hi = i - 1, hj = j + 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
                f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
                heap.push(t);
              }
            }
          }
        }
      }
      if (inW && inN) { // NW
        const q = kN - 1;
        if (!((undQ !== null && undQ[q] !== 0) || (sOpen[q] === 1 && (dynB === null || dynB[q] === NONE) && (avM === null || !avM[q]) && (frM === null || frM[q] === 0)))) { if (endF !== null && endF[q] === 1) noteEnd(grid, allEnds, bare, info, i - 1, j - 1); }
        // (no corner cutting: both edge neighbours free and steppable)
        else if (wW && wN && st[q] !== cid && (Math.abs(ek - elev[q]) <= MAX_STEP && (!runOf || rk === runOf[q] || grid.canStep(k, q)))) {
          if (sW === -1) sW = (Math.abs(ek - elev[kW]) <= MAX_STEP && (!runOf || rk === runOf[kW] || grid.canStep(k, kW))) ? 1 : 0;
          if (sW === 1) {
            if (sN === -1) sN = (Math.abs(ek - elev[kN]) <= MAX_STEP && (!runOf || rk === runOf[kN] || grid.canStep(k, kN))) ? 1 : 0;
            if (sN === 1) {
              let step = SQRT2;
              if (mul) step *= MUL_OF[mul[q]];
              else { const t = terrain[q]; if ((t === T.WATER || t === T.SHALLOW) && !bridge[q]) step *= WATER_COST; else if (hugsK(i - 1, j - 1, q)) step *= HUG_COST; }
              const ng = gk + step;
              let t = -1;
              if (st[q] !== oid) { t = ns++; st[q] = oid; slotOf[q] = t; cellOf[t] = q; } else if (ng < g[slotOf[q]]) t = slotOf[q];
              if (t >= 0) {
                g[t] = ng; parent[t] = s; via[t] = 0;
                const hi = i - 1, hj = j - 1, hx = hi > gi ? hi - gi : gi - hi, hz = hj > gj ? hj - gj : gj - hj; // (h, written out)
                f[t] = ng + ((hx + hz) + (SQRT2 - 2) * (hx < hz ? hx : hz));
                heap.push(t);
              }
            }
          }
        }
      }
    } else for (let d = 0; d < 8 && !endOnly; d++) {
      const ni = i + DI[d], nj = j + DJ[d];
      const nk = nj * cols + ni;
      if (!open(ni, nj)) { if (meet) noteEnd(grid, allEnds, bare, info, ni, nj); continue; }
      // No corner cutting: a diagonal step needs both orthogonal neighbours free.
      if (d >= 4 && (!walk(i + DI[d], j) || !walk(i, j + DJ[d]))) continue;
      if (st[nk] === cid) continue;
      if (!stepOut(nk)) continue; // elevation discontinuity (raised areas: links only)
      if (d >= 4 && (!stepOut(j * cols + ni) || !stepOut(nk - DI[d]))) continue;
      let step = d >= 4 ? SQRT2 : 1;
      if (mul) step *= MUL_OF[mul[nk]]; // (the same factor, worked out per grid version: staticLayers)
      else {
        const t = terrain[nk];
        if ((t === T.WATER || t === T.SHALLOW) && !bridge[nk]) step *= WATER_COST;
        // clearance (placement rule e): a body is ~0.35 m wide with arms and rifle — prefer cells not touching a wall
        else if (hugsK(ni, nj, nk)) step *= HUG_COST;
      }
      const ng = gk + step;
      let t = -1;
      if (st[nk] !== oid) { t = ns++; st[nk] = oid; slotOf[nk] = t; cellOf[t] = nk; } else if (ng < g[slotOf[nk]]) t = slotOf[nk];
      if (t >= 0) {
        g[t] = ng;
        parent[t] = s;
        via[t] = 0;
        f[t] = ng + h(ni, nj);
        heap.push(t);
      }
    }
    // Off-grid links (climb edges, ladders) touching this cell.
    if (hasLinks && (!linked || linked[k])) {
      for (const L of grid.linksAt(k)) {
        if (!grid.linkAllowed(L, role) || (opts.noLinks && !L.walk)) continue;
        const nk = L.ka === k ? L.kb : L.ka;
        if (st[nk] === cid) continue;
        const ni = nk % cols, nj = (nk - ni) / cols;
        if (ni < bi0) bi0 = ni; else if (ni > bi1) bi1 = ni;
        if (nj < bj0) bj0 = nj; else if (nj > bj1) bj1 = nj;
        if (!open(ni, nj)) { if (meet) noteEnd(grid, allEnds, bare, info, ni, nj); continue; }
        const ng = g[s] + Math.hypot(ni - i, nj - j) + L.cost / c;
        let t = -1;
        if (st[nk] !== oid) { t = ns++; st[nk] = oid; slotOf[nk] = t; cellOf[t] = nk; } else if (ng < g[slotOf[nk]]) t = slotOf[nk];
        if (t >= 0) {
          g[t] = ng;
          parent[t] = s;
          via[t] = L.id;
          f[t] = ng + h(ni, nj);
          heap.push(t);
        }
      }
    }
  }
  b.heap = heap.items; // (grown: kept for the next search)
  if (!found) {
    if (!areasDone) {
      areasDone = true;
      if (areasApart(grid, walkOpts, role, opts, hasLinks, startK, goalK)) { searchStats.expanded = expanded0; if (info) info.endBlocked = endBlocked0; return null; }
    }
    // every cell this start reaches is closed now: remember them for the epoch (see failMemo)
    if (memo && !capped && memo.n < FAIL_MEMO_MAX) {
      const reach = new Uint8Array(grid.size);
      for (let t = 0; t < ns; t++) { const q = cellOf[t]; if (st[q] === cid) reach[q] = 1; } // (every closed cell has a slot)
      if (info?.endBlocked) reach.endBlocked = true;
      const list = memo.sets.get(memoKey);
      if (list) list.push(reach); else memo.sets.set(memoKey, [reach]);
      memo.n++;
    }
    return null;
  }

  if (info) {
    // (and the goal point clearOfWalls set, the start point: the path's smoothing draws its lines between them)
    const gpi = Math.floor(goal.x / c), gpj = Math.floor(goal.z / c), spi = Math.floor(start.x / c), spj = Math.floor(start.z / c);
    info.box = [Math.min(bi0, gpi, spi), Math.min(bj0, gpj, spj), Math.max(bi1, gpi, spi), Math.max(bj1, gpj, spj)];
    info.expanded = expanded;
    // (a plain search's footprint for findPath's chain reuse across versions: the cells it expanded — it read them and
    // their eight neighbours — and the far ends of the links it looked down, by box)
    if (info.plain) {
      const b = info.box, w = b[2] - b[0] + 1, foot = new Uint8Array(w * (b[3] - b[1] + 1));
      for (let t = 0; t < ns; t++) {
        const q = cellOf[t];
        if (st[q] !== cid) continue;
        const qi = q % cols;
        foot[((q - qi) / cols - b[1]) * w + qi - b[0]] = 1;
        if (hasLinks && (!linked || linked[q])) {
          for (const L of grid.linksAt(q)) {
            if (!grid.linkAllowed(L, role) || (opts.noLinks && !L.walk)) continue;
            const e = L.ka === q ? L.kb : L.ka, ei = e % cols, ej = (e - ei) / cols;
            if (ei >= b[0] && ei <= b[2] && ej >= b[1] && ej <= b[3]) foot[(ej - b[1]) * w + ei - b[0]] = 1;
          }
        }
      }
      info.foot = foot;
    }
  }
  // Reconstruct cell chain (start to goal, with the link each cell was reached by: findPath's cell reuse keeps it).
  let len = 0;
  for (let t = goalS; t !== -1; t = parent[t]) len++;
  const chain = new Int32Array(len), chainVia = new Int32Array(len);
  for (let t = goalS, n = len - 1; t !== -1; t = parent[t], n--) { chain[n] = cellOf[t]; chainVia[n] = via[t]; }
  if (info) { info.chain = chain; info.chainVia = chainVia; info.fast = !!sOpen && !dive; }
  return finishPath(grid, chain, chainVia, start, goal, opts, walkOpts, dive ? null : sOpen);
}

/**
 * searchPath's path from its cell chain (start → goal, `chainVia`: the link id each was reached by, 0 for a step):
 * cell centres and link ends, the start and goal points at its ends, then smoothed. The same for a chain found again
 * (findPath's cell reuse) with this query's own start and goal points. `cellOpen`: the walk layer the search read.
 */
function finishPath(grid, chain, chainVia, start, goal, opts, walkOpts, cellOpen) {
  const c = grid.cell, cols = grid.cols;
  const pts = new Array(chain.length);
  const linkAt = []; // indices in pts reached through a link
  for (let n = 0; n < chain.length; n++) {
    const k = chain[n];
    const i = k % cols, j = (k - i) / cols;
    pts[n] = { x: (i + 0.5) * c, z: (j + 0.5) * c };
    if (chainVia[n]) {
      const L = grid.links.find((l) => l.id === chainVia[n]);
      const end = L.ka === k ? L.a : L.b;
      pts[n] = { x: end.x, z: end.z, y: end.y, link: { id: L.id, kind: L.kind, ...(L.walk ? { walk: L.walk } : null) } };
      const prev = L.ka === k ? L.b : L.a;
      if (n > 0) pts[n - 1] = { ...pts[n - 1], x: prev.x, z: prev.z, y: prev.y };
      linkAt.push(n);
    }
  }
  if (!pts[0].link) pts[0] = { ...start, ...(pts[0].y !== undefined ? { y: pts[0].y } : {}) };
  const last = pts.length - 1;
  if (!pts[last].link) pts[last] = goal;
  if (opts.smooth === false) return pts;
  // (a crawler, `lying`: on and off the ramps and stairs head-on, along their middle — alignRuns)
  const aligned = (p) => (opts.lying ? alignRuns(grid, p, walkOpts) : p);
  // (a crawler keeps the full clearance off the body mask too: he turns his whole length at a corner)
  const sm = { taut: !!opts.taut, lying: !!opts.lying };
  // (the smoothing's line tests read the walk layer this search read, for these rules and this version: walkableLine)
  if (cellOpen) walkOpts.cellOpen = cellOpen;
  if (!linkAt.length) return aligned(straightenFlights(grid, smoothPath(grid, pts, walkOpts, sm), walkOpts));
  // Smooth each grid-only run separately; links are kept verbatim.
  const out = [];
  let from = 0;
  for (const n of [...linkAt, pts.length]) {
    const seg = smoothPath(grid, pts.slice(from, n), walkOpts, sm);
    for (const p of seg) out.push(p);
    from = n;
  }
  return aligned(straightenFlights(grid, out, walkOpts));
}

/** How far out (m) a path lines up on a ramp / stair run's axis before its foot / after its head (alignRuns). */
export const RUN_APPROACH = 1.6;

/**
 * A crawler's path (findPath `lying`) on and off a ramp / stair run head-on, along its axis (grid.addRun `align`: the M3
 * barn ramp and dam stairs, the access platform stairs). A man on his feet keeps his own line (the runs' side rules hold
 * for him too: grid.canStep, walkableLine). User 2026-10-08, watching the M3 film: "In the video the rapper crosses the slide when
 * crawling, fix to make it work properly" — the Sapper came at the barn ramp's foot from beside it and crawled up it on
 * the slant, his body over its curbs. Every point of the path on a run moves onto its axis (centred between its sides);
 * where the path comes on at an end it first lines up on the axis RUN_APPROACH m out (shorter when that is not
 * walkable), unless it already comes in along it; going off, it carries on along the axis that far before it turns.
 * The loose points next to such an approach point are pulled out (no going out past it and back). A crawler's body
 * (2.35 m long) is straight along the run before any of it is on it and until all of it is off.
 */
export function alignRuns(grid, pts, walkOpts = {}) {
  const runs = grid.runs?.filter((R) => R.align);
  if (!runs?.length || pts.length < 2) return pts;
  const lOpts = { ...walkOpts, clearance: SMOOTH_CLEARANCE };
  const lineOk = (a, b) => grid.walkableLine(a.x, a.z, b.x, b.z, lOpts);
  /** a straight walkable line on one level (string pulling's rule: no climb but by a ramp) */
  const levelOk = (a, b) => grid.walkableLine(a.x, a.z, b.x, b.z, { ...lOpts, elevRef: grid.elevAt(a.x, a.z) });
  const cellOk = (p) => grid.walkableAt(p.x, p.z, walkOpts);
  const near = (R, p, m = 0.5) => p.x >= R.box[0] - m && p.x <= R.box[2] + m && p.z >= R.box[1] - m && p.z <= R.box[3] + m;
  const onRun = (p) => runs.find((R) => { if (!near(R, p, 0)) return false; const q = grid.runLocal(R, p.x, p.z); return q.s >= 0 && q.s <= R.L && Math.abs(q.v) <= R.w / 2; });
  const onAxis = (p) => { const R = !p.link && onRun(p); if (!R) return p; const q = grid.runLocal(R, p.x, p.z); return { ...p, ...grid.runPoint(R, q.s, 0) }; };
  /** lined up past end sEnd of R, heading in along its axis (within ~15°), or right at it on its axis */
  const lined = (q, sEnd, out1) => (q.s - sEnd) * out1 > -0.05 && Math.abs(q.v) <= 0.15 + 0.27 * Math.abs(q.s - sEnd);
  const loose = (p) => !p.fix && !p.link && !onRun(p);
  const out = [pts[0]]; // (where he is)
  let pull = null; // (an approach point just put down going off a run: the loose points after it are pulled to it)
  for (let n = 1; n < pts.length; n++) {
    const a = pts[n - 1], b = onAxis(pts[n]);
    if (a.link || pts[n].link) { out.push(pts[n]); pull = null; continue; }
    // the run ends this leg crosses, in order along it
    const hits = [];
    for (const R of runs) {
      if (!near(R, a, 3) && !near(R, b, 3)) continue;
      const qa = grid.runLocal(R, a.x, a.z), qb = grid.runLocal(R, b.x, b.z);
      for (const sEnd of [0, R.L]) {
        const da = qa.s - sEnd, db = qb.s - sEnd;
        if (!(da * db < 0 || (da === 0 && db !== 0) || (db === 0 && da !== 0))) continue;
        const t = da / (da - db), v = qa.v + (qb.v - qa.v) * t;
        if (Math.abs(v) > R.w / 2 + 0.25) continue;
        hits.push({ t, R, sEnd, on: sEnd === 0 ? db > da : db < da, qb });
      }
    }
    hits.sort((p, q) => p.t - q.t);
    if (hits.length) pull = null;
    // this leg, lined up: its points, each line between them walkable (else the leg as it was)
    const from = out[out.length - 1], seg = [];
    let lead = null; // (an approach point coming on: loose points before it may be pulled out)
    for (const h of hits) {
      const { R, sEnd } = h, out1 = sEnd === 0 ? -1 : 1; // (outward along s at this end)
      const endP = { ...grid.runPoint(R, sEnd, 0), fix: true };
      const last = () => (seg.length ? seg[seg.length - 1] : from);
      const approachTo = (p, q) => { // a point on the axis out past the end, walkable from p and to q
        for (const D of [RUN_APPROACH, 1.2, 0.8, 0.5]) {
          const A = { ...grid.runPoint(R, sEnd + out1 * D, 0), fix: true };
          if (cellOk(A) && lineOk(p, A) && lineOk(A, q)) return A;
        }
        return null;
      };
      if (h.on) {
        const prev = last();
        if (!lined(grid.runLocal(R, prev.x, prev.z), sEnd, out1)) { const A = approachTo(prev, endP); if (A) { seg.push(A); if (!lead && seg.length === 1) lead = A; } }
        seg.push(endP);
      } else {
        seg.push(endP);
        // (none when the leg ends at the end itself: he stops there, the next leg goes on from it)
        const stop = Math.abs(h.qb.s - sEnd) <= 0.05, A = stop || (lined(h.qb, sEnd, out1) && (h.qb.s - sEnd) * out1 >= RUN_APPROACH - 0.3) ? null : approachTo(endP, b);
        if (A) { seg.push(A); pull = A; }
      }
    }
    seg.push(b);
    let ok = true;
    for (let k = 0, p = from; k < seg.length && ok; p = seg[k++]) ok = cellOk(seg[k]) && (Math.hypot(seg[k].x - p.x, seg[k].z - p.z) < 1e-6 || lineOk(p, seg[k]));
    if (!ok) { // (back on the leg as planned: by its start point when the line from where he got to is not clear)
      const l = out[out.length - 1];
      if (Math.hypot(l.x - a.x, l.z - a.z) > 1e-3 && !lineOk(l, pts[n])) out.push(a);
      out.push(pts[n]); pull = null; continue;
    }
    // (straight to the approach point from further back when he can: not past it and back)
    if (lead) while (out.length >= 2 && loose(out[out.length - 1]) && levelOk(out[out.length - 2], lead)) out.pop();
    // (off a run: the loose points after its approach point are left out while the next one is in line from it)
    const skipB = pull && loose(b) && n + 1 < pts.length && !pts[n + 1].link && levelOk(pull, onAxis(pts[n + 1]));
    if (skipB) seg.pop(); else pull = null;
    for (const p of seg) out.push(p);
  }
  // (no repeated points: one that coincides with the last kept is merged into it)
  const res = [out[0]];
  for (let k = 1; k < out.length; k++) {
    const l = res[res.length - 1];
    if (!out[k].link && !l.link && Math.hypot(out[k].x - l.x, out[k].z - l.z) <= 0.1) res[res.length - 1] = { ...l, ...out[k] };
    else res.push(out[k]);
  }
  for (const p of res) delete p.fix;
  return res;
}

/**
 * Up / down a flight of stairs (world/stairs.js, grid.flights) a man walks straight: the string pulling above stops at
 * a climb of MAX_STEP from where it starts, which left a cell-by-cell zigzag up the M3 dam stairs. Consecutive
 * waypoints on one flight's run (within its width) whose straight line stays walkable are joined.
 */
export function straightenFlights(grid, pts, walkOpts = {}) {
  const F = grid.flights;
  if (!F?.size || pts.length < 3) return pts;
  const on = (p) => {
    for (const f of F.near(p.x, p.z, 0.3)) {
      if (f.link) continue;
      const dx = p.x - f.ox, dz = p.z - f.oz, s = dx * f.ux + dz * f.uz, v = -dx * f.uz + dz * f.ux;
      if (Math.abs(v) <= f.w / 2 && s >= f.sFoot - 0.3 && s <= f.sTop + 0.3) return f;
    }
    return null;
  };
  const fl = pts.map(on), out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const f = fl[i];
    if (f && !pts[i].link && i + 1 < pts.length && !pts[i + 1].link && fl[i - 1] === f && fl[i + 1] === f) {
      // drop it when the line from the last kept point to the next one stays walkable, over cells at the flight's
      // own height (not the ground-level cells along its sides)
      const a = out[out.length - 1], b = pts[i + 1];
      if (grid.walkableLine(a.x, a.z, b.x, b.z, { ...walkOpts, clearance: SMOOTH_CLEARANCE }) && onFlightLine(grid, f, a, b)) continue;
    }
    out.push(pts[i]);
  }
  return out;
}

/**
 * String pulling: from each anchor, jump to the farthest later point still reachable in a straight,
 * walkable line.
 * @param {import('./grid.js').NavGrid} grid
 * @param {{x:number,z:number}[]} pts
 * @param {{swim?: boolean}} walkOpts
 */
export function smoothPath(grid, pts, walkOpts, { taut = false, lying = false } = {}) {
  if (pts.length <= 2) return pts.slice();
  // (taut, a player's path: the body-clearance mask is already inflated by his body's sides — the full clearance
  // offsets are for walls; kept that far off it too he went a body's width further round every hull and prop, and the
  // pull failed along their edges: a wavering chain of cell centres. AVOID_CLEARANCE covers what the mask does not:
  // a standing man's weapon held out ahead, swung round at a corner beside a hull)
  const lineOpts = { ...walkOpts, clearance: SMOOTH_CLEARANCE, elevRef: grid.elevAt ? grid.elevAt(pts[0].x, pts[0].z) : undefined, ...(taut && !lying ? { avoidClearance: AVOID_CLEARANCE } : null) };
  const out = [pts[0]];
  let anchor = 0;
  while (anchor < pts.length - 1) {
    // Greedy forward scan: extend while the straight segment stays walkable. The A* chain is
    // contiguous, so anchor+1 is always reachable. A small look-ahead past the first failure catches
    // shortcuts that reappear after grazing a corner.
    let next = anchor + 1;
    let misses = 0;
    for (let k = anchor + 2; k < pts.length; k++) {
      if (grid.walkableLine(pts[anchor].x, pts[anchor].z, pts[k].x, pts[k].z, lineOpts)) {
        next = k;
        misses = 0;
      } else if (++misses > 6) break;
    }
    out.push(pts[next]);
    anchor = next;
  }
  // (a crawler's path stays as the pull leaves it: his 2.35 m length rounds a corner by the curve its own waypoints
  // shape (entities/path-curve.js), and a corner pulled tighter, or a waypoint fewer, swung it into a solid beside —
  // M14 / M15. His zigzag was the sneak executor's clicks, not these corners)
  if (!taut || lying || out.length < 3 || out.some((p) => p.link)) return out;
  // (a taut leg never comes on to a flight of stairs where the pulled one did not: over its side the rails turn him
  // back — a link flight's cells are open ground to the grid — M12, the Spy cutting past a stair's foot stood still)
  const F = grid.flights?.size ? grid.flights.flights : null;
  // (and by one the pulled corners stay as they are: within 1.2 m of its band, or on a leg that goes on to it — the
  // rails and the walk round to its end are railPath's and railShift's, entities/stair-walk.js)
  const fixed = F ? (P, i) => touchesFlight(F, P[i], P[i], 1.2) || touchesFlight(F, P[i - 1], P[i]) || touchesFlight(F, P[i], P[i + 1]) : null;
  return tautenPath(out, (a, b) => grid.walkableLine(a.x, a.z, b.x, b.z, lineOpts) && !(F && touchesFlight(F, a, b)), { fixed });
}

/**
 * Taut string (user 2026-10-15, watching the M3 walkthrough: "Looking at mission 3 the trajectory of commandos is very zig
 * baggy, making it more straight and decisive. Longer trajectories rather than zig zagging in small trajectories"). The
 * greedy pull above keeps its corners where the A* chain's cell centres were: a corner rounded in two or three shallow
 * bends, a bend left near the goal where the real corner is metres back, a kink of a few degrees between two straight
 * legs. Each corner B (between A and C) slides back along its way in, A → B, as far as the way out to C stays clear,
 * then along its way out, B → C, as far as the way in from A stays clear (each slide only shortens the path: the corner
 * settles a body's clearance off the real corner of the wall), and is dropped once A sees C; two corners close
 * together that round one obstacle become one where their legs meet, when both lines to it are clear. The path then
 * bends only at the real corners. `lineOk(a, b)`: the run's own line test. Links stay verbatim (callers pass link-free
 * runs).
 */
export function tautenPath(pts, lineOk, { passes = 4, fixed = null, slideCorners = true } = {}) {
  if (pts.length < 3) return pts.slice();
  // (`fixed(P, i)`: corner i stays where it is — by a flight of stairs, see smoothPath)
  const keep = fixed || (() => false);
  const P = pts.slice();
  const same = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
  /** the farthest point from `from` toward `to` (fraction of the way) for which ok(point) holds, ok(from) holding */
  const slide = (from, to, ok) => {
    const L = Math.hypot(to.x - from.x, to.z - from.z);
    if (L < 0.03) return null;
    let lo = 0, hi = 1;
    const n = Math.min(12, Math.ceil(Math.log2(L / 0.03)));
    for (let k = 0; k < n; k++) {
      const m = (lo + hi) / 2;
      if (ok({ x: from.x + (to.x - from.x) * m, z: from.z + (to.z - from.z) * m })) lo = m; else hi = m;
    }
    return lo * L > 0.03 ? { ...from, x: from.x + (to.x - from.x) * lo, z: from.z + (to.z - from.z) * lo } : null;
  };
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (let i = 1; i < P.length - 1; i++) {
      const A = P[i - 1], C = P[i + 1];
      if (keep(P, i)) continue;
      // (a point on the straight line between its neighbours, between them: no corner at all — the same walk)
      const ax = C.x - A.x, az = C.z - A.z, L = Math.hypot(ax, az), B = P[i];
      const onLine = L > 1e-6 && Math.abs((B.x - A.x) * az - (B.z - A.z) * ax) / L < 0.01 && ((B.x - A.x) * ax + (B.z - A.z) * az) > 0 && ((C.x - B.x) * ax + (C.z - B.z) * az) > 0;
      if (onLine || lineOk(A, C)) { P.splice(i, 1); i--; changed = true; continue; }
      if (!slideCorners) continue;
      // back along the way in while the way out stays clear (A → point is part of the clear A → B)
      const q = slide(P[i], A, (X) => lineOk(X, C));
      if (q) { P[i] = q; changed = true; }
      // on along the way out while the way in stays clear
      const r = slide(P[i], C, (X) => lineOk(A, X));
      if (r) { P[i] = r; changed = true; }
    }
    // two close corners rounding one obstacle: one corner where their legs meet
    for (let i = 1; slideCorners && i + 2 < P.length; i++) {
      const A = P[i - 1], B = P[i], C = P[i + 1], E = P[i + 2];
      if (Math.hypot(C.x - B.x, C.z - B.z) > 1.5 || keep(P, i) || keep(P, i + 1)) continue;
      const ux = B.x - A.x, uz = B.z - A.z, vx = C.x - E.x, vz = C.z - E.z, den = ux * vz - uz * vx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((E.x - A.x) * vz - (E.z - A.z) * vx) / den; // A + u·t on both lines
      const X = { ...B, x: A.x + ux * t, z: A.z + uz * t };
      if (t < 1 - 1e-6 || Math.hypot(X.x - B.x, X.z - B.z) > 1 || Math.hypot(X.x - C.x, X.z - C.z) > 1) continue;
      if (same(X, A) || same(X, E) || !lineOk(A, X) || !lineOk(X, E)) continue;
      P.splice(i, 2, X);
      changed = true;
    }
    if (!changed) break;
  }
  return P;
}

/** Does segment a → b come within `pad` m of a flight's band (its width, from its foot to its landing's end)? */
export const FLIGHT_PAD = 0.35;
export function touchesFlight(flights, a, b, pad = FLIGHT_PAD) {
  for (const f of flights) {
    const m = pad, s0 = Math.min(f.sFoot, f.railS?.[0] ?? f.sFoot) - m, s1 = Math.max(f.sTop, f.railS?.[1] ?? f.sTop) + m, hv = f.w / 2 + m;
    const loc = (p) => { const dx = p.x - f.ox, dz = p.z - f.oz; return [dx * f.ux + dz * f.uz, -dx * f.uz + dz * f.ux]; };
    const [as, av] = loc(a), [bs, bv] = loc(b);
    // (Liang–Barsky: the segment clipped to the band's rectangle in the flight's frame)
    let t0 = 0, t1 = 1, hit = true;
    for (const [p, q] of [[-(bs - as), as - s0], [bs - as, s1 - as], [-(bv - av), av + hv], [bv - av, hv - av]]) {
      if (Math.abs(p) < 1e-12) { if (q < 0) { hit = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { hit = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { hit = false; break; } if (r < t1) t1 = r; }
    }
    if (hit && t0 <= t1) return true;
  }
  return false;
}

/** Does the line a → b (and its clearance offsets) run over cells within MAX_STEP of flight f's nosing line? */
function onFlightLine(grid, f, a, b) {
  const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 0.1));
  const nx = L > 1e-6 ? (-(b.z - a.z) / L) * SMOOTH_CLEARANCE : 0, nz = L > 1e-6 ? ((b.x - a.x) / L) * SMOOTH_CLEARANCE : 0;
  for (let q = 0; q <= n; q++) {
    const t = q / n;
    for (const k of [-1, 0, 1]) {
      const x = a.x + (b.x - a.x) * t + nx * k, z = a.z + (b.z - a.z) * t + nz * k;
      const s = (x - f.ox) * f.ux + (z - f.oz) * f.uz;
      const y = Math.min(f.yMax, Math.max(f.yMin, f.lineY0 + (s - f.lineS0) * f.slope));
      if (Math.abs(grid.elevAt(x, z) - y) > MAX_STEP) return false;
    }
  }
  return true;
}

/** Total length of a polyline path (m). */
export function pathLength(path) {
  let L = 0;
  for (let k = 1; k < path.length; k++) L += Math.hypot(path[k].x - path[k - 1].x, path[k].z - path[k - 1].z);
  return L;
}
