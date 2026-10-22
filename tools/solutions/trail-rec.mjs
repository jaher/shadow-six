/**
 * Trail recorder for solution runs (tools/solutions/trail.mjs): every commando's place each tick, every order the
 * driver gives (the game's own 'unit:order' event) and every path the game hands a commando (the planned waypoints, and
 * whether an order or the game itself re-planned it). Engine-agnostic like the driver: attach it to a World, call
 * `tick()` after every Game.step. Pure data out (typed arrays as base64), measured by trail-metrics.mjs.
 * @module tools/solutions/trail-rec
 */

/** Per-tick flags (one byte per commando per tick). */
export const F = Object.freeze({ PATH: 1, VEHICLE: 2, CRAWL: 4, SWIM: 8, ACTION: 16, BURIED: 32, ANIM: 64, DEAD: 128 });

const toB64 = (ta) => {
  const u8 = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * @param {object} world
 * @param {{every?: number, grid?: boolean}} [o] every: record every n-th tick (1 = all); grid: dump the nav layers
 * @returns {{tick: () => void, result: () => object, dispose: () => void}}
 */
export function attachTrail(world, { every = 1, grid = true } = {}) {
  const w = world;
  const units = w.commandos.slice();
  const n = units.length;
  let cap = 1 << 16, len = 0, k = 0;
  let T = new Float32Array(cap), X = new Float32Array(cap * n), Z = new Float32Array(cap * n), H = new Float32Array(cap * n), FL = new Uint8Array(cap * n);
  const grow = () => {
    const c2 = cap * 2;
    const g = (a, m) => { const b = new a.constructor(c2 * m); b.set(a); return b; };
    T = g(T, 1); X = g(X, n); Z = g(Z, n); H = g(H, n); FL = g(FL, n); cap = c2;
  };
  const orders = [];
  const paths = [];
  const lastPath = units.map(() => null);
  const pendingOrder = units.map(() => null);
  const roleOf = (u) => u.role ?? u.tag ?? String(u.id);
  const copyPath = (p) => p.map((q) => [Math.round(q.x * 1000) / 1000, Math.round(q.z * 1000) / 1000, q.link ? 1 : 0]);
  const pushPath = (i, u, cause, o) => paths.push({ t: +w.time.toFixed(4), u: i, cause, order: o ? orders.indexOf(o) : -1, from: [+u.x.toFixed(3), +u.z.toFixed(3)], pts: copyPath(u.path), steer: !!u.path[0]?.steer });
  const off = w.events.on('unit:order', (e) => {
    const u = e.unit, i = units.indexOf(u);
    if (i < 0) return;
    const o = e.order || {};
    const rec = { t: +w.time.toFixed(4), u: i, role: roleOf(u), type: o.type, x: o.x, z: o.z, run: !!o.run, id: o.id, at: [+u.x.toFixed(3), +u.z.toFixed(3)], stance: u.stance, by: globalThis.__trailCtx?.at?.(-1) ?? null };
    orders.push(rec);
    // (moveTo ran before the event: the order's own path is on him now; a buried man's walk starts after his rise)
    if (u.path && u.path !== lastPath[i]) { lastPath[i] = u.path; pushPath(i, u, 'order', rec); pendingOrder[i] = null; } else pendingOrder[i] = o.type === 'move' ? rec : null;
  });
  const sample = () => {
    if (len >= cap) grow();
    T[len] = w.time;
    for (let i = 0; i < n; i++) {
      const u = units[i], q = len * n + i;
      X[q] = u.x; Z[q] = u.z; H[q] = u.heading ?? 0;
      let f = 0;
      if (u.path) f |= F.PATH;
      if (u.vehicle || u.state === 'inVehicle') f |= F.VEHICLE;
      if (u.stance === 'crawl' || u.stance === 'downed') f |= F.CRAWL;
      if (u.stance === 'swim' || u.stance === 'dive') f |= F.SWIM;
      if (u.currentAction || u.pendingAbility) f |= F.ACTION;
      if (u.buried) f |= F.BURIED;
      if (u._moving) f |= F.ANIM;
      if (!u.alive) f |= F.DEAD;
      FL[q] = f;
    }
    len++;
  };
  const watchPaths = () => {
    for (let i = 0; i < n; i++) {
      const u = units[i], p = u.path;
      if (p === lastPath[i]) continue;
      lastPath[i] = p;
      if (!p) continue;
      // who planned it: a move order still waiting for its walk (a buried man rising first), else the game itself
      // (a re-path: the grid changed, the body guard, a crawler's re-path round a step…)
      const o = pendingOrder[i];
      pendingOrder[i] = null;
      pushPath(i, u, o ? 'order' : 'game', o);
    }
  };
  sample();
  return {
    tick() {
      watchPaths();
      if (++k % every === 0) sample();
    },
    dispose() { off?.(); },
    result() {
      const g = w.grid;
      const out = {
        n, roles: units.map(roleOf), len, dt: (w.time - T[0]) / Math.max(1, len - 1),
        t: toB64(T.subarray(0, len)), x: toB64(X.subarray(0, len * n)), z: toB64(Z.subarray(0, len * n)), h: toB64(H.subarray(0, len * n)), f: toB64(FL.subarray(0, len * n)),
        orders, paths,
      };
      if (grid && g) {
        out.grid = { cols: g.cols, rows: g.rows, cell: g.cell, terrain: toB64(g.terrain), block: toB64(g.block), navBlock: g.navBlock ? toB64(g.navBlock) : null, elev: toB64(g.elev), bridge: toB64(g.bridge) };
      }
      return out;
    },
  };
}

/**
 * Tag the driver's helpers so every order records which one gave it (D.sneak, D.go, …): order.by in the trail.
 * @param {object} D a driver (driver.mjs makeDriver)
 */
export function tagDriver(D, names = ['sneak', 'go', 'path', 'face', 'row', 'rowTo', 'rowSafe', 'rowHops', 'stance', 'idle']) {
  const stack = (globalThis.__trailCtx ||= []);
  for (const k of names) {
    const fn = D[k];
    if (typeof fn !== 'function') continue;
    D[k] = async function tagged(...a) { stack.push(k); try { return await fn.apply(this, a); } finally { stack.pop(); } };
  }
  return D;
}

/** Decode a result's base64 arrays (node or browser). */
export function decodeTrail(r) {
  const dec = (s, Ctor) => {
    let u8;
    if (typeof Buffer !== 'undefined') u8 = new Uint8Array(Buffer.from(s, 'base64'));
    else { const b = atob(s); u8 = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i); }
    return new Ctor(u8.buffer, u8.byteOffset, u8.byteLength / Ctor.BYTES_PER_ELEMENT);
  };
  const out = { ...r, t: dec(r.t, Float32Array), x: dec(r.x, Float32Array), z: dec(r.z, Float32Array), h: dec(r.h, Float32Array), f: dec(r.f, Uint8Array) };
  if (r.grid) out.grid = { ...r.grid, terrain: dec(r.grid.terrain, Uint8Array), block: dec(r.grid.block, Uint8Array), navBlock: r.grid.navBlock ? dec(r.grid.navBlock, Uint8Array) : null, elev: dec(r.grid.elev, Float32Array), bridge: dec(r.grid.bridge, Uint8Array) };
  return out;
}
