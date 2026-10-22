/**
 * Gameplay-world fingerprint (tests/preset-determinism.test.mjs, `__game.gameplayFingerprint()`): what the simulation
 * reads of a loaded mission, hashed field by field — every NavGrid layer (blocks, nav stamps, overhangs, tree branches,
 * standing visuals, measured tops, levelled bases, crawl steps…), its links and stair flights, the body solids, the
 * ground and lying heights under the men, structures, interactables, ladders, water obstacles, the mission registries,
 * every entity's spawn state, the house rules and physics gameplay caps, the RNG.
 *
 * The rule it guards: gameplay never depends on the graphics preset. Art LOD / detail may differ ('low' draws coarser
 * buildings and trees), but whatever gameplay measures on the art (world/map-builder.js stamps, body solids, branch
 * cells, deck heights, ladders) is the same at every preset — two cold loads of a mission at 'low' and 'high' give the
 * same fingerprint. Before 2026-10-22 they did not: 'low' measured the library buildings on LOD1 (LOD0 not preloaded)
 * and the trees on its own coarser set, and the M3 walkthrough at 'low' drifted off the logic run and timed out.
 *
 * Pure reads; no three.js. Hashes are 64-bit FNV-1a pairs over exact bytes (numbers as float64).
 * @module debug/gameplay-fingerprint
 */

const _f64 = new Float64Array(1), _u32 = new Uint32Array(_f64.buffer);

function hasher() {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  const mix = (x) => { a = Math.imul(a ^ x, 0x01000193); b = Math.imul(b ^ ((x + 0x7f4a7c15) | 0), 0x5bd1e995); b ^= b >>> 15; };
  return {
    bytes(u8) { for (let i = 0; i < u8.length; i++) mix(u8[i]); mix(0x100); },
    str(t) { t = String(t); for (let i = 0; i < t.length; i++) mix(t.charCodeAt(i)); mix(0x101); },
    num(x) { _f64[0] = x; mix(_u32[0]); mix(_u32[1]); },
    hex() { return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0'); },
  };
}
const bytesOf = (ta) => new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
const hashBytes = (ta) => { const h = hasher(); h.bytes(bytesOf(ta)); return h.hex(); };
const hashStr = (s) => { const h = hasher(); h.str(s); return h.hex(); };

/** Keys never followed: drawn objects, back references, caches. */
const SKIP_KEY = /^(_|object3d$|mesh$|model$|world$|game$|scene$|visual$|vis$|library$|root$|group$|material$|geometry$|parent$|events$|brain$|ai$|physics$|body$|anim)/;

/**
 * Plain, stable data of a value (numbers exact; drawn objects, functions, private and back-reference keys left out;
 * Maps / Sets in insertion order; depth-limited, cycle-safe).
 */
export function plain(v, depth = 6, seen = new Set()) {
  if (v == null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return undefined;
  if (v.isObject3D || v.isMaterial || v.isBufferGeometry || v.isTexture) return undefined;
  if (seen.has(v) || depth < 0) return '…';
  if (ArrayBuffer.isView(v)) return `${v.constructor.name}:${hashBytes(v)}`;
  seen.add(v);
  try {
    if (Array.isArray(v)) return v.map((x) => { const p = plain(x, depth - 1, seen); return p === undefined ? null : p; });
    if (v instanceof Map) return { $map: [...v.entries()].map(([k, x]) => [plain(k, 1, seen), plain(x, depth - 1, seen) ?? null]) };
    if (v instanceof Set) return { $set: [...v].map((x) => plain(x, depth - 1, seen) ?? null) };
    const out = {};
    for (const k of Object.keys(v)) {
      if (SKIP_KEY.test(k)) continue;
      const p = plain(v[k], depth - 1, seen);
      if (p !== undefined) out[k] = p;
    }
    return out;
  } finally { seen.delete(v); }
}

/** Per entity: what spawning made of it (position, facing, state, kit, route) — not its drawn model. */
function entityState(e) {
  const pick = {};
  for (const k of ['id', 'type', 'kind', 'tag', 'role', 'team', 'faction', 'x', 'y', 'z', 'heading', 'alive', 'hp', 'stance', 'state',
    'vehicleType', 'inventory', 'route', 'patrol', 'waypoints', 'post', 'home', 'facing', 'sightRange', 'fov']) {
    if (e[k] !== undefined) pick[k] = plain(e[k], 3);
  }
  if (e.def) pick.def = plain(e.def, 3);
  if (e.model?.dims) pick.dims = plain({ l: e.model.dims.l, w: e.model.dims.w, h: e.model.dims.h, scale: e.model.dims.scale }); // (hull solids)
  return pick;
}

/** Height samples of a ground function at every other cell centre (1 m on the 0.5 m grid). */
function heightSamples(world, fn, grid) {
  const f = world[fn];
  if (typeof f !== 'function') return null;
  const out = new Float64Array(Math.ceil(grid.cols / 2) * Math.ceil(grid.rows / 2));
  let n = 0;
  for (let j = 0; j < grid.rows; j += 2) for (let i = 0; i < grid.cols; i += 2) out[n++] = f.call(world, (i + 0.5) * grid.cell, (j + 0.5) * grid.cell) || 0;
  return out;
}

/**
 * Fingerprint of the loaded world: `{fields: {name: hash}, detail: {name: {rows?: hash[], items?: [hash, text][]}}}`.
 * `detail` (for a report of what differs): per grid row hashes of every layer, per item hashes + short texts of the
 * listed fields.
 * @param {object} world @param {{game?: object}} [o]
 */
export function gameplayFingerprint(world, o = {}) {
  const fields = {}, detail = {};
  const grid = world.grid;
  // every NavGrid layer (typed arrays; null ones — never stamped — as null)
  for (const k of Object.keys(grid)) {
    const v = grid[k];
    if (k.startsWith('_') || !(ArrayBuffer.isView(v) || (v === null && /^(over|soft|solid|block|noWalk|flat|crawl)/.test(k)))) continue;
    if (!v) { fields[`grid.${k}`] = 'null'; continue; }
    fields[`grid.${k}`] = hashBytes(v);
    const per = v.length / (grid.rows || 1), rows = [];
    if (Number.isInteger(per)) for (let j = 0; j < grid.rows; j++) rows.push(hashBytes(v.subarray(j * per, (j + 1) * per)));
    detail[`grid.${k}`] = { rows };
  }
  fields['grid.meta'] = hashStr(JSON.stringify(plain({ cols: grid.cols, rows: grid.rows, cell: grid.cell, fenceHoleCount: grid.fenceHoleCount, levelOwners: grid.levelOwners })));
  const list = (name, v, fn = (x) => plain(x)) => {
    // (an array, a Map / Set / other iterable, or one object: its own list of one)
    const arr = v == null ? [] : Array.isArray(v) ? v : typeof v[Symbol.iterator] === 'function' && typeof v !== 'string' ? [...v] : [v];
    const items = arr.map((x) => { const s = JSON.stringify(fn(x)) ?? 'null'; return [hashStr(s), s.length > 400 ? s.slice(0, 400) + '…' : s]; });
    fields[name] = hashStr(items.map((x) => x[0]).join(','));
    detail[name] = { items };
  };
  list('grid.links', grid.links);
  list('stairs', world.stairs || grid.flights);
  list('bodySolids', world.bodySolids?.list, (s) => plain({ owner: s.owner, R: s.R, gone: s.gone }));
  for (const fn of ['groundY', 'lyingY']) {
    const s = heightSamples(world, fn, grid);
    fields[`ground.${fn}`] = s ? hashBytes(s) : 'none';
    if (s) {
      const w = Math.ceil(grid.cols / 2), rows = [];
      for (let j = 0; j * w < s.length; j++) rows.push(hashBytes(s.subarray(j * w, (j + 1) * w)));
      detail[`ground.${fn}`] = { rows };
    }
  }
  list('structures', [...(world.structures?.values?.() || [])], (s) => plain({ owner: s.owner, type: s.type, cat: s.cat, def: s.def, top: s.top, h: s.h, footprints: s.footprints }, 5));
  list('interactables', world.interactables);
  list('entities', world.entities, entityState);
  list('ladders', world.ladders);
  list('waterObstacles', world.waterObstacles);
  list('switchStations', world.switchStations);
  list('fencePosts', world.fencePosts);
  const reg = { zones: world.zones, markers: world.markers, jails: world.jails, barracks: world.barracks, triplines: world.triplines,
    extraction: world.extraction, structureDoors: world.structureDoors, objectives: world.objectives };
  for (const [k, v] of Object.entries(reg)) fields[`registry.${k}`] = hashStr(JSON.stringify(plain(v) ?? null));
  // house rules (the physics tier only scales visual extras: physics/world-physics.js caps; left out) + gameplay caps
  const { physicsTier, ...house } = world.house || {};
  fields.house = hashStr(JSON.stringify(plain(house)));
  const caps = world.physics?.caps ? { ...world.physics.caps } : null;
  if (caps) delete caps.debris; // (visual debris only; the gate pieces are caps.gatePieces)
  fields['physics.caps'] = hashStr(JSON.stringify(plain(caps)));
  fields.rng = hashStr(JSON.stringify({ seed: world.rng?.seed, state: world.rng?.state }));
  fields.time = hashStr(JSON.stringify({ time: world.time, tick: world.tick }));
  return { fields, detail };
}

/**
 * What differs between two fingerprints: [{field, rows?: number[], items?: {i, a, b}[]}] (empty = the same world).
 */
export function diffFingerprints(A, B) {
  const out = [];
  for (const k of new Set([...Object.keys(A.fields), ...Object.keys(B.fields)])) {
    if (A.fields[k] === B.fields[k]) continue;
    const da = A.detail?.[k], db = B.detail?.[k], d = { field: k };
    if (da?.rows && db?.rows) { d.rows = []; for (let j = 0; j < Math.max(da.rows.length, db.rows.length); j++) if (da.rows[j] !== db.rows[j]) d.rows.push(j); }
    if (da?.items && db?.items) {
      d.items = [];
      for (let i = 0; i < Math.max(da.items.length, db.items.length); i++) if (da.items[i]?.[0] !== db.items[i]?.[0]) d.items.push({ i, a: da.items[i]?.[1], b: db.items[i]?.[1] });
      d.count = [da.items.length, db.items.length];
    }
    out.push(d);
  }
  return out;
}
