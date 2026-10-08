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

const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Find a path on the NavGrid.
 * @param {import('./grid.js').NavGrid} grid
 * @param {number} sx start x (m)
 * @param {number} sz start z (m)
 * @param {number} tx target x (m)
 * @param {number} tz target z (m)
 * @param {{swim?: boolean, maxNodes?: number, smooth?: boolean, role?: string, dynamic?: boolean, noLinks?: boolean, noWalkLinks?: boolean, dive?: boolean, avoid?: Uint8Array, nearRadius?: number}} [opts]
 *   dive: a submerged diver, who also passes grid `underpass` cells (NavGrid.isWalkable).
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

export function findPath(grid, sx, sz, tx, tz, opts = {}) {
  const swim = !!opts.swim;
  const walkOpts = { swim, dynamic: !!opts.dynamic, dive: !!opts.dive, avoid: opts.avoid || null };
  const nearR = opts.nearRadius ?? NEAREST_WALKABLE_RADIUS;
  const role = opts.role;
  // (noLinks: no climbing — a walked link, a flight of stairs or a plank, stays open unless noWalkLinks too)
  const hasLinks = (!opts.noLinks || !opts.noWalkLinks) && grid.links && grid.links.length > 0;
  const maxNodes = opts.maxNodes ?? 40000;
  const c = grid.cell;
  const cols = grid.cols;

  // Start: if the unit stands in a blocked cell (pushed/spawned badly), leave via the nearest walkable one.
  let start = { x: sx, z: sz };
  let si = Math.floor(sx / c), sj = Math.floor(sz / c);
  if (!grid.isWalkable(si, sj, walkOpts)) {
    const n = grid.nearestWalkable(sx, sz, NEAREST_WALKABLE_RADIUS, walkOpts);
    if (!n) return null;
    si = n.i; sj = n.j; start = { x: n.x, z: n.z };
  }
  // Goal: substitute the nearest walkable cell within 3 m.
  let goal = { x: tx, z: tz };
  let gi = Math.floor(tx / c), gj = Math.floor(tz / c);
  if (!grid.isWalkable(gi, gj, walkOpts)) {
    const n = grid.nearestWalkable(tx, tz, nearR, walkOpts);
    if (!n) return null;
    gi = n.i; gj = n.j; goal = { x: n.x, z: n.z };
  }
  // (a stride's reach off the wall: the leading boot of a unit arriving at a run stops short of it)
  goal = clearOfWalls(grid, goal.x, goal.z, gi, gj, GOAL_CLEARANCE);
  if (si === gi && sj === gj) return [start, goal];

  const b = buffers(grid);
  const { g, f, parent, stamp, closed, via } = b;
  const id = b.search;
  const heap = new NodeHeap(1024, f);
  const startK = sj * cols + si, goalK = gj * cols + gi;
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
  let found = false;
  const terrain = grid.terrain, bridge = grid.bridge;

  while (heap.size > 0) {
    const k = heap.pop();
    if (closed[k] === id) continue;
    closed[k] = id;
    if (k === goalK) { found = true; break; }
    if (++expanded > maxNodes) break;
    const i = k % cols, j = (k - i) / cols;
    for (let d = 0; d < 8; d++) {
      const ni = i + DI[d], nj = j + DJ[d];
      if (!grid.isWalkable(ni, nj, walkOpts)) continue;
      // No corner cutting: a diagonal step needs both orthogonal neighbours free.
      if (d >= 4 && (!grid.isWalkable(i + DI[d], j, walkOpts) || !grid.isWalkable(i, j + DJ[d], walkOpts))) continue;
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
        if (!grid.isWalkable(ni, nj, walkOpts)) continue;
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
  if (!found) return null;

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
  if (!linkAt.length) return straightenFlights(grid, smoothPath(grid, pts, walkOpts), walkOpts);
  // Smooth each grid-only run separately; links are kept verbatim.
  const out = [];
  let from = 0;
  for (const n of [...linkAt, pts.length]) {
    const seg = smoothPath(grid, pts.slice(from, n), walkOpts);
    for (const p of seg) out.push(p);
    from = n;
  }
  return straightenFlights(grid, out, walkOpts);
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
export function smoothPath(grid, pts, walkOpts) {
  if (pts.length <= 2) return pts.slice();
  const lineOpts = { ...walkOpts, clearance: SMOOTH_CLEARANCE, elevRef: grid.elevAt ? grid.elevAt(pts[0].x, pts[0].z) : undefined };
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
  return out;
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
