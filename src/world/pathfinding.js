/**
 * Grid pathfinding: 8-connected A* (binary heap, octile heuristic, no corner cutting) followed by
 * string-pulling with a walkability line test. Pure module (no three.js).
 * See docs/ARCHITECTURE.md § Pathfinding.
 * @module world/pathfinding
 */

import { T, B, MAX_STEP } from './grid.js';

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
  constructor(capacity, f) {
    this.items = new Int32Array(capacity);
    this.size = 0;
    this.f = f;
  }

  push(n) {
    if (this.size >= this.items.length) {
      const grown = new Int32Array(this.items.length * 2);
      grown.set(this.items);
      this.items = grown;
    }
    const a = this.items, f = this.f;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[a[p]] <= f[n]) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = n;
  }

  pop() {
    const a = this.items, f = this.f;
    const top = a[0];
    const last = a[--this.size];
    let i = 0;
    const half = this.size >> 1;
    while (i < half) {
      let c = 2 * i + 1;
      if (c + 1 < this.size && f[a[c + 1]] < f[a[c]]) c++;
      if (f[a[c]] >= f[last]) break;
      a[i] = a[c];
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
      g: new Float64Array(grid.size),
      f: new Float64Array(grid.size),
      parent: new Int32Array(grid.size),
      stamp: new Uint32Array(grid.size), // == search id → g/parent valid
      closed: new Uint32Array(grid.size), // == search id → closed
      via: new Int32Array(grid.size), // link id used to reach the node (0 = grid step)
      search: 0,
    };
    scratch.set(grid, b);
  }
  b.search++;
  if (b.search >= 0xfffffff0) {
    b.stamp.fill(0);
    b.closed.fill(0);
    b.search = 1;
  }
  return b;
}

const EMPTY_SETS = Object.freeze([]);
const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Find a path on the NavGrid.
 * @param {import('./grid.js').NavGrid} grid
 * @param {number} sx start x (m)
 * @param {number} sz start z (m)
 * @param {number} tx target x (m)
 * @param {number} tz target z (m)
 * @param {{swim?: boolean, maxNodes?: number, smooth?: boolean, taut?: boolean, role?: string, dynamic?: boolean, noLinks?: boolean, noWalkLinks?: boolean, dive?: boolean, avoid?: Uint8Array, nearRadius?: number, lying?: boolean}} [opts]
 *   dive: a submerged diver, who also passes grid `underpass` cells (NavGrid.isWalkable).
 *   lying: a crawler's path — on and off ramps and stairs head-on, along their middle (alignRuns).
 *   taut: pull the smoothed path taut (tautenPath: bends only at the real corners; a player's commandos).
 *   avoid: extra keep-out mask (grid.isWalkable opts.avoid; body clearance around vehicles). nearRadius: how far (m) a
 *   blocked start / goal looks for a walkable substitute (default 3).
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
function failKey(walkOpts, opts) {
  let mask = 0;
  if (walkOpts.avoid) { mask = maskIds.get(walkOpts.avoid); if (!mask) maskIds.set(walkOpts.avoid, (mask = nextMaskId++)); }
  return `${walkOpts.swim ? 1 : 0}${walkOpts.dive ? 1 : 0}${opts.noLinks ? 1 : 0}${opts.noWalkLinks ? 1 : 0}|${mask}|${opts.role ?? ''}`;
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
function areasFor(grid, walkOpts, role, opts, hasLinks) {
  let per = _areas.get(grid);
  if (!per || per.version !== grid.version || per.links !== grid.links) { per = { version: grid.version, links: grid.links, map: new Map() }; _areas.set(grid, per); }
  const key = areaKey(grid, walkOpts, role, opts, hasLinks);
  let lab = per.map.get(key);
  if (lab) return lab;
  let rec = _recent.get(grid);
  if (!rec) _recent.set(grid, (rec = new Map()));
  const rk = `${walkOpts.swim ? 1 : 0}${opts.noLinks ? 1 : 0}${opts.noWalkLinks ? 1 : 0}|${role ?? ''}`;
  if (!rec.has(rk)) {
    rec.set(rk, [!!walkOpts.swim, role, !!opts.noLinks, !!opts.noWalkLinks]);
    if (rec.size > RECENT_MAX) rec.delete(rec.keys().next().value);
  }
  const cols = grid.cols, rows = grid.rows, N = grid.size, bare = { swim: !!walkOpts.swim, dive: !!walkOpts.dive };
  const open = new Uint8Array(N);
  if (bare.dive) for (let j = 0, k = 0; j < rows; j++) for (let i = 0; i < cols; i++, k++) open[k] = grid.isWalkable(i, j, bare) ? 1 : 0;
  else {
    // (grid.isWalkable's own test for these rules, cell by cell without the call: no dynamic layer, no mask)
    const { block, navBlock, fenceHole, bridge, terrain } = grid, swim = bare.swim;
    for (let k = 0; k < N; k++) {
      open[k] = block[k] !== B.NONE || (navBlock[k] && !fenceHole[k]) ? 0 : bridge[k] ? 1 : terrain[k] === T.WATER ? (swim ? 1 : 0) : 1;
    }
  }
  // (links by cell, the ones this search may take)
  let adj = null;
  if (hasLinks) {
    adj = new Map();
    for (const L of grid.links) {
      if (!grid.linkAllowed(L, role) || (opts.noLinks && !L.walk)) continue;
      if (!open[L.ka] || !open[L.kb]) continue;
      (adj.get(L.ka) || adj.set(L.ka, []).get(L.ka)).push(L.kb);
      (adj.get(L.kb) || adj.set(L.kb, []).get(L.kb)).push(L.ka);
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
      const k = queue[qh++], i = k % cols, j = (k - i) / cols;
      for (let d = 0; d < 8; d++) {
        const ni = i + DI[d], nj = j + DJ[d];
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const nk = nj * cols + ni;
        if (!open[nk] || lab[nk]) continue;
        // (grid.canStep either way: the elevation step is symmetric; only a ramp's side needs its own test)
        if (Math.abs(elev[k] - elev[nk]) > MAX_STEP) continue;
        if (runOf && runOf[k] !== runOf[nk] && !grid.canStep(k, nk) && !grid.canStep(nk, k)) continue;
        lab[nk] = id; queue[qt++] = nk;
      }
      const ls = adj?.get(k);
      if (ls) for (const nk of ls) if (!lab[nk]) { lab[nk] = id; queue[qt++] = nk; }
    }
  }
  per.map.set(key, lab);
  return lab;
}

/**
 * The area labelling a search under these rules (findPath's opts: swim / allowWater, role, noLinks, noWalkLinks) would
 * build at its first use, built now: a cache fill only (keyed like the search's own, rebuilt when the grid changes), so
 * every search answers the same. The walkthrough runs it on its title card (engine/idle-warm.js): M3's first tick built
 * the guards' and the squad's labellings, ~5 ms of it.
 */
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
    _ladderEnds.set(grid, (c = { links, n: links.length, set }));
  }
  return c.set;
}
/**
 * Is goal cell `goalK` inside a pocket of at most POCKET_MAX cells — every cell from which a search can step (or climb,
 * links) into the goal, enumerated backwards over the very rule the search steps by — that does not hold `startK`?
 * Then no search from `startK` reaches the goal: findPath returns null, exactly as its full flood would (a charge
 * blown inside a bunker nobody can walk into: every guard who hears it flooded the whole map, ~20 ms each).
 * @returns {number[]|null} the pocket's cells, or null = can't tell (it is larger, or holds the start): search on
 */
function goalPocketExcludes(grid, goalK, startK, walkOpts, role, hasLinks, noLinks, open = (i, j) => grid.isWalkable(i, j, walkOpts)) {
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
      if (queue.length > POCKET_MAX) return null;
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
        if (queue.length > POCKET_MAX) return null;
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

export function findPath(grid, sx, sz, tx, tz, opts = {}) {
  const info = { endBlocked: false };
  const p = searchPath(grid, sx, sz, tx, tz, opts, false, info);
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
  const dyn = walkOpts.dynamic ? grid.dynamicBlock : null, avoid = walkOpts.avoid || null, swim = !!walkOpts.swim, NONE = B.NONE, WATER = T.WATER;
  return (i, j) => {
    if (i < 0 || j < 0 || i >= cols || j >= rows) return false;
    const k = j * cols + i;
    if (block[k] !== NONE || (navBlock[k] && !fenceHole[k])) return false;
    if (dyn && dyn[k] !== NONE) return false;
    if (avoid && avoid[k]) return false;
    if (bridge[k]) return true;
    if (terrain[k] === WATER) return swim;
    return true;
  };
}

/** findPath's A*; `openEnds`: the ladder ends a clearance mask shuts are open as ladder ends (stepped onto to climb,
 * stepped off from it, never walked through); `info.endBlocked`: set when a search without them met one. */
function searchPath(grid, sx, sz, tx, tz, opts, openEnds, info) {
  const swim = !!opts.swim;
  const walkOpts = { swim, dynamic: !!opts.dynamic, dive: !!opts.dive, avoid: opts.avoid || null };
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
  const meet = info && allEnds ? (i, j) => { if (!info.endBlocked && isEnd(i, j)) info.endBlocked = true; } : null;
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
  }
  // Goal: substitute the nearest walkable cell within 3 m.
  let goal = { x: tx, z: tz };
  let gi = Math.floor(tx / c), gj = Math.floor(tz / c);
  if (!open(gi, gj)) {
    const n = grid.nearestWalkable(tx, tz, nearR, walkOpts);
    if (!n) return null;
    gi = n.i; gj = n.j; goal = { x: n.x, z: n.z };
  }
  // (a stride's reach off the wall: the leading boot of a unit arriving at a run stops short of it)
  goal = clearOfWalls(grid, goal.x, goal.z, gi, gj, GOAL_CLEARANCE);
  if (si === gi && sj === gj) return [start, goal];

  const startK = sj * cols + si, goalK = gj * cols + gi;
  // (the goal in another walkable area than the start: no search can join them — areasFor)
  if (!walkOpts.dive) {
    const lab = areasFor(grid, walkOpts, role, opts, hasLinks);
    if (lab[startK] && lab[goalK] && lab[startK] !== lab[goalK]) return null;
  }
  // (a failed search this epoch reached this start but not this goal: the goal is out of this start's reach too)
  const memo = opts.memo != null && !walkOpts.dynamic ? failMemo(grid, opts.memo) : null;
  const memoKey = memo ? failKey(walkOpts, opts) + (ends ? '|ends' : '') : null;
  if (memo) {
    for (const reach of memo.sets.get(memoKey) || EMPTY_SETS) if (reach[startK] && !reach[goalK]) { if (info && reach.endBlocked) info.endBlocked = true; return null; }
    // (or this goal's pocket — every cell that can reach it — was enumerated this epoch, without this start)
    const pocket = memo.pockets.get(`${memoKey}|${goalK}`);
    if (pocket && !pocket.has(startK)) return null;
  }
  const b = buffers(grid);
  const { g, f, parent, stamp, closed, via } = b;
  const id = b.search;
  const heap = new NodeHeap(1024, f);
  const h = (i, j) => {
    const dx = Math.abs(i - gi), dz = Math.abs(j - gj);
    return (dx + dz) + (SQRT2 - 2) * Math.min(dx, dz);
  };
  g[startK] = 0;
  f[startK] = h(si, sj);
  parent[startK] = -1;
  via[startK] = 0;
  stamp[startK] = id;
  heap.push(startK);
  let expanded = 0;
  let found = false, capped = false;
  const terrain = grid.terrain, bridge = grid.bridge;

  while (heap.size > 0) {
    const k = heap.pop();
    if (closed[k] === id) continue;
    closed[k] = id;
    if (k === goalK) { found = true; break; }
    if (++expanded > maxNodes) { capped = true; break; }
    searchStats.expanded++;
    // (a long search: is the goal shut in a small pocket this start cannot be in? then it fails — no need to flood)
    if (expanded === POCKET_AT) {
      const pocket = goalPocketExcludes(grid, goalK, startK, walkOpts, role, hasLinks, !!opts.noLinks, pocketOpen);
      if (pocket) { if (memo) memo.pockets.set(`${memoKey}|${goalK}`, new Set(pocket)); return null; }
    }
    const i = k % cols, j = (k - i) / cols;
    // (a ladder end the clearance mask shuts, reached on foot: only its ladder goes on from it)
    const endOnly = ends !== null && walkOpts.avoid[k] && via[k] === 0 && k !== startK;
    for (let d = 0; d < 8 && !endOnly; d++) {
      const ni = i + DI[d], nj = j + DJ[d];
      if (!open(ni, nj)) { if (meet) meet(ni, nj); continue; }
      // No corner cutting: a diagonal step needs both orthogonal neighbours free.
      if (d >= 4 && (!walk(i + DI[d], j) || !walk(i, j + DJ[d]))) continue;
      const nk = nj * cols + ni;
      if (closed[nk] === id) continue;
      if (!grid.canStep(k, nk)) continue; // elevation discontinuity (raised areas: links only)
      if (d >= 4 && (!grid.canStep(k, j * cols + ni) || !grid.canStep(k, nj * cols + i))) continue;
      let step = d >= 4 ? SQRT2 : 1;
      const t = terrain[nk];
      if ((t === T.WATER || t === T.SHALLOW) && !bridge[nk]) step *= WATER_COST;
      // clearance (placement rule e): a body is ~0.35 m wide with arms and rifle — prefer cells not touching a wall
      else if (hugsObstacle(grid, ni, nj)) step *= HUG_COST;
      const ng = g[k] + step;
      if (stamp[nk] !== id || ng < g[nk]) {
        stamp[nk] = id;
        g[nk] = ng;
        parent[nk] = k;
        via[nk] = 0;
        f[nk] = ng + h(ni, nj);
        heap.push(nk);
      }
    }
    // Off-grid links (climb edges, ladders) touching this cell.
    if (hasLinks) {
      for (const L of grid.linksAt(k)) {
        if (!grid.linkAllowed(L, role) || (opts.noLinks && !L.walk)) continue;
        const nk = L.ka === k ? L.kb : L.ka;
        if (closed[nk] === id) continue;
        const ni = nk % cols, nj = (nk - ni) / cols;
        if (!open(ni, nj)) { if (meet) meet(ni, nj); continue; }
        const ng = g[k] + Math.hypot(ni - i, nj - j) + L.cost / c;
        if (stamp[nk] !== id || ng < g[nk]) {
          stamp[nk] = id;
          g[nk] = ng;
          parent[nk] = k;
          via[nk] = L.id;
          f[nk] = ng + h(ni, nj);
          heap.push(nk);
        }
      }
    }
  }
  if (!found) {
    // every cell this start reaches is closed now: remember them for the epoch (see failMemo)
    if (memo && !capped && memo.n < FAIL_MEMO_MAX) {
      const reach = new Uint8Array(grid.size);
      for (let k = 0; k < reach.length; k++) if (closed[k] === id) reach[k] = 1;
      if (info?.endBlocked) reach.endBlocked = true;
      const list = memo.sets.get(memoKey);
      if (list) list.push(reach); else memo.sets.set(memoKey, [reach]);
      memo.n++;
    }
    return null;
  }

  // Reconstruct cell chain.
  const cellsRev = [];
  for (let k = goalK; k !== -1; k = parent[k]) cellsRev.push(k);
  const pts = new Array(cellsRev.length);
  const linkAt = []; // indices in pts reached through a link
  for (let n = 0; n < cellsRev.length; n++) {
    const k = cellsRev[cellsRev.length - 1 - n];
    const i = k % cols, j = (k - i) / cols;
    pts[n] = { x: (i + 0.5) * c, z: (j + 0.5) * c };
    if (via[k]) {
      const L = grid.links.find((l) => l.id === via[k]);
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
