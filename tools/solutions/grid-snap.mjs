/**
 * A whole-grid snapshot of the game's built map, for the headless sim (tools/solutions/navcache.mjs writes it from the
 * browser; headless.mjs lays it over its own mesh-less build). Every typed layer, the stamp tables (nav, hull, solid,
 * overhead), the links (ladders, climbs), the sets and flags the mesh-measured build leaves on the grid: the headless
 * men then path, see and stand on the very grid of the game. Runs in the browser (exportGrid, async: gzip by the
 * CompressionStream) and in node (importGrid).
 */
const TYPED = { Uint8Array, Int8Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array };

export const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
export async function gz(u8) {
  const cs = new CompressionStream('gzip'), w = cs.writable.getWriter();
  w.write(u8); w.close();
  return b64(new Uint8Array(await new Response(cs.readable).arrayBuffer()));
}

/** (browser) → a JSON-able snapshot of grid `g`. */
export async function exportGrid(g) {
  const snap = { arrays: {}, sets: {}, scalars: {}, stamps: {}, links: null };
  for (const k of Object.keys(g)) {
    const v = g[k];
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) snap.arrays[k] = { type: v.constructor.name, data: await gz(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    else if (v instanceof Set) snap.sets[k] = [...v];
    else if ((Number.isFinite(v) || typeof v === 'boolean') && (!k.startsWith('_') || k === '_nextLinkId')) snap.scalars[k] = v;
  }
  const setStamps = (m) => [...m].map(([key, set]) => [key, [...set]]);
  snap.stamps = {
    nav: setStamps(g._navStamps), hull: setStamps(g._hullStamps), solid: setStamps(g._solidStamps),
    over: [...g._overStamps].map(([key, st]) => [key, [...st.cells], !!st.soft]),
  };
  snap.links = g.links.map((l) => JSON.parse(JSON.stringify(l)));
  return snap;
}

/** (node) lay snapshot `snap` over grid `g` (same size): its layers, stamp tables, links and sets replace `g`'s. */
export function importGrid(g, snap, gunzipSync) {
  for (const [k, a] of Object.entries(snap.arrays)) {
    const raw = gunzipSync(Buffer.from(a.data, 'base64'));
    const T = TYPED[a.type];
    const arr = new T(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    if (g[k]?.length === arr.length && g[k].constructor === T) g[k].set(arr); else g[k] = arr;
  }
  for (const k of Object.keys(g)) if (ArrayBuffer.isView(g[k]) && !(k in snap.arrays) && ['overLo', 'overHi', 'softLo', 'softHi', 'solid', 'blockTop'].includes(k)) g[k] = null;
  for (const [k, v] of Object.entries(snap.sets)) g[k] = new Set(v);
  for (const [k, v] of Object.entries(snap.scalars)) if (k !== 'version') g[k] = v;
  g._navStamps = new Map(snap.stamps.nav.map(([key, c]) => [key, new Set(c)]));
  g._hullStamps = new Map(snap.stamps.hull.map(([key, c]) => [key, new Set(c)]));
  g._solidStamps = new Map(snap.stamps.solid.map(([key, c]) => [key, new Set(c)]));
  g._overStamps = new Map(snap.stamps.over.map(([key, cells, soft]) => [key, { cells: new Map(cells), soft }]));
  g.overCells = g.overLo ? new Set() : undefined;
  if (g.overLo) for (let k = 0; k < g.overLo.length; k++) if (g.overLo[k] !== Infinity) g.overCells.add(k);
  g.links = snap.links;
  g._linkIndex = new Map();
  for (const l of g.links) for (const k of [l.ka, l.kb]) { if (!g._linkIndex.has(k)) g._linkIndex.set(k, []); g._linkIndex.get(k).push(l); }
  g._dirtyLog = [];
  g.version = Math.max(g.version, snap.scalars.version ?? 0) + 1;
}

/**
 * (browser) the game's ground relief — world.groundY (the drawn terrain's height under a point, 0 over water, plus the
 * kerbs, steps and decks over it) and world.lyingY (the height a lying body rests on) — as tables: ragdolls and settled
 * bodies read them at any point (physics/ragdoll.js, statics.js), and a millimetre of ground there is a different settle
 * tick, so they are kept exactly. The terrain's own relief is bilinear between a 0.25 m lattice (art/terrain/terrain.js
 * heightAt) and dry/wet is per grid cell: both are kept as they are (the lattice as float32s), what the functions add
 * to them (kerbs, steps, decks) as sparse residuals at the lattice points.
 */
export async function exportGround(w) {
  const g = w.grid, step = 0.25, nx = Math.ceil(g.width / step) + 1, nz = Math.ceil(g.depth / step) + 1, out = { step, nx, nz };
  const hf = w.terrain?.heightAt;
  if (typeof hf !== 'function') out.lattice = null;
  const lat = new Float32Array(nx * nz);
  if (hf) for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) lat[j * nx + i] = hf(i * step, j * step);
  if (hf) out.lattice = await gz(new Uint8Array(lat.buffer));
  const wet = (x, z) => { const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell); return i >= 0 && j >= 0 && i < g.cols && j < g.rows && (g.terrain[j * g.cols + i] === T.WATER || g.terrain[j * g.cols + i] === T.SHALLOW); };
  for (const fn of ['groundY', 'lyingY']) {
    if (typeof w[fn] !== 'function') { out[fn] = null; continue; }
    const res = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = i * step, z = j * step, base = hf ? (wet(x, z) ? 0 : lat[j * nx + i]) : 0, r = (w[fn](x, z) || 0) - base;
      if (Math.abs(r) > 1e-9) res.push(j * nx + i, r);
    }
    out[fn] = res;
  }
  // the print visibility the guards' track-following reads (world.terrain.printVisibility: material × age): constant over
  // each splat texel (0.25 m), so a table of a fresh print's visibility and its life tau is the function
  const pv = w.terrain?.printVisibility;
  if (typeof pv === 'function') {
    const res = 4, tx = Math.ceil(g.width * res), tz = Math.ceil(g.depth * res), v0 = new Float32Array(tx * tz), v1 = new Float32Array(tx * tz);
    for (let j = 0; j < tz; j++) for (let i = 0; i < tx; i++) {
      const x = (i + 0.5) / res, z = (j + 0.5) / res;
      const a = pv(x, z, 0), b = pv(x, z, 1);
      v0[j * tx + i] = a; v1[j * tx + i] = a > 0 && b > 0 && b < a ? -1 / Math.log(b / a) : 0; // (v1: the print's life tau in s, 0 = no decay)
    }
    out.vis = { res, nx: tx, nz: tz, v0: await gz(new Uint8Array(v0.buffer)), v1: await gz(new Uint8Array(v1.buffer)) };
  }
  return out;
}

import { T } from '../../src/world/grid.js';

/** (node) world.terrain for a headless world: printVisibility from a table made by exportGround. */
export function visibilityTerrain(t, gunzipSync) {
  if (!t.vis) return null;
  const { res, nx, nz } = t.vis, u16 = (b) => { const r = gunzipSync(Buffer.from(b, 'base64')); return new Float32Array(r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength)); };
  const v0 = u16(t.vis.v0), v1 = u16(t.vis.v1);
  return {
    printVisibility(x, z, age = 0) {
      const i = Math.min(nx - 1, Math.max(0, Math.floor(x * res))), j = Math.min(nz - 1, Math.max(0, Math.floor(z * res))), k = j * nx + i;
      const a = v0[k], b = v1[k];
      return b > 0 ? a * Math.exp(-age / b) : a;
    },
  };
}

/** (node) a ground function over tables made by exportGround: the lattice bilinear, 0 over water, plus the residuals bilinear. */
export function groundFn(t, key, gunzipSync, grid) {
  if (!t[key]) return null;
  const { step, nx, nz } = t;
  let lat = null;
  if (t.lattice) { const raw = gunzipSync(Buffer.from(t.lattice, 'base64')); lat = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); }
  const res = new Float64Array(nx * nz);
  for (let n = 0; n < t[key].length; n += 2) res[t[key][n]] = t[key][n + 1];
  const hasRes = t[key].length > 0, WET = (c) => c === T.WATER || c === T.SHALLOW;
  const bil = (a, x, z) => {
    const fx = Math.min(Math.max(x / step, 0), nx - 1.0001), fz = Math.min(Math.max(z / step, 0), nz - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * nx + i;
    return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + nx] * (1 - u) + a[k + nx + 1] * u) * v;
  };
  return (x, z) => {
    let y = 0;
    if (lat) {
      const i = Math.floor(x / grid.cell), j = Math.floor(z / grid.cell);
      if (!(i >= 0 && j >= 0 && i < grid.cols && j < grid.rows && WET(grid.terrain[j * grid.cols + i]))) y = bil(lat, Math.min(Math.max(x, 0), grid.width), Math.min(Math.max(z, 0), grid.depth));
    }
    return hasRes ? y + bil(res, x, z) : y;
  };
}
