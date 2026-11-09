/**
 * fires.js freeCellNear (fireEdge / fireExit) keeps the free cells round a point for its grid version and fire version: a
 * squad sent to one spot inside a fire asks once a man (M14's gun 4 spill). The answers are the old scan's, cell for cell,
 * whatever the fires and the grid do between the asks; a change to the fire layer is seen through its fire version.
 * Run: node tests/unit/run.mjs fire-edge-cache
 */
import { test, assert } from './lib.mjs';
import { NavGrid, B, T } from '../../src/world/grid.js';
import { fireEdge, fireExit, FIRE_EDGE_R } from '../../src/world/fires.js';

/** The scan as it was (no cache): the reference. */
function refNear(g, x, z, swim, score, line = false) {
  const c = g.cell, R = FIRE_EDGE_R, ci = Math.floor(x / c), cj = Math.floor(z / c), n = Math.ceil(R / c), opts = { swim: !!swim };
  const straight = (px, pz) => {
    const L = Math.hypot(px - x, pz - z), m = Math.max(1, Math.ceil(L / (c / 4)));
    for (let q = 1; q < m; q++) { const qx = x + ((px - x) * q) / m, qz = z + ((pz - z) * q) / m; if (!g.walkableAt(qx, qz, opts)) return false; }
    return true;
  };
  let best = null, bs = Infinity;
  for (let j = cj - n; j <= cj + n; j++) {
    for (let i = ci - n; i <= ci + n; i++) {
      if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) continue;
      const k = j * g.cols + i;
      if (g.fire[k] || !g.isWalkable(i, j, opts)) continue;
      const px = (i + 0.5) * c, pz = (j + 0.5) * c, d = Math.hypot(px - x, pz - z);
      if (d > R) continue;
      const s = score(px, pz, d);
      if (s < bs - 1e-9 && (!line || straight(px, pz))) { bs = s; best = { x: px, z: pz }; }
    }
  }
  return best;
}
const refEdge = (g, x, z, sx, sz, swim = false) => refNear(g, x, z, swim, (px, pz, d) => d + 0.25 * Math.hypot(px - sx, pz - sz));
const refExit = (g, x, z, tx, tz, swim = false) => refNear(g, x, z, swim, (px, pz, d) => d + 0.25 * Math.hypot(tx - px, tz - pz), true);
const mkRng = (seed) => { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
const same = (a, b) => (a === null && b === null) || (!!a && !!b && a.x === b.x && a.z === b.z);

/** Stamp a rectangle of fire (counts per cell, fireCells), as FireField._stamp does; the caller bumps fireVersion. */
function burn(g, x, z, hw, hd, on) {
  const c = g.cell, cells = [];
  for (let j = Math.max(0, Math.floor((z - hd) / c)); j <= Math.min(g.rows - 1, Math.floor((z + hd) / c)); j++) {
    for (let i = Math.max(0, Math.floor((x - hw) / c)); i <= Math.min(g.cols - 1, Math.floor((x + hw) / c)); i++) cells.push(j * g.cols + i);
  }
  for (const k of cells) { if (on) { if (g.fire[k]++ === 0) g.fireCells++; } else if (g.fire[k] > 0 && --g.fire[k] === 0) g.fireCells--; }
  return cells;
}

test('fire-edge cache: fireEdge / fireExit answer as the uncached scan, over fires catching and dying and grid writes', () => {
  let asks = 0, hits = 0;
  for (let sc = 0; sc < 40; sc++) {
    const rnd = mkRng(1000 + sc), g = new NavGrid(40 + Math.floor(rnd() * 40), 40 + Math.floor(rnd() * 40));
    for (let k = 0; k < 10; k++) g.fillRect(rnd() * g.width, rnd() * g.depth, 0.5 + rnd() * 5, 0.5 + rnd() * 5, 'block', B.HIGH);
    for (let k = 0; k < 2; k++) g.fillRect(rnd() * g.width, rnd() * g.depth, 1 + rnd() * 6, 1 + rnd() * 6, 'terrain', T.WATER);
    const fires = [], spots = [];
    for (let k = 0; k < 3; k++) spots.push({ x: 1 + rnd() * (g.width - 2), z: 1 + rnd() * (g.depth - 2) });
    for (let t = 0; t < 30; t++) {
      const r = rnd();
      if (r < 0.25) { const p = spots[Math.floor(rnd() * spots.length)]; fires.push(burn(g, p.x + (rnd() - 0.5) * 4, p.z + (rnd() - 0.5) * 4, 0.5 + rnd() * 3, 0.5 + rnd() * 3, true)); g.fireVersion++; }
      else if (r < 0.35 && fires.length) { for (const k of fires.splice(Math.floor(rnd() * fires.length), 1)[0]) if (g.fire[k] > 0 && --g.fire[k] === 0) g.fireCells--; g.fireVersion++; }
      else if (r < 0.42) g.fillRect(rnd() * g.width, rnd() * g.depth, 0.5 + rnd() * 3, 0.5 + rnd() * 3, 'block', rnd() < 0.5 ? B.HIGH : B.NONE);
      // a squad: several men ask the same spot from their own places
      const p = spots[Math.floor(rnd() * spots.length)], swim = rnd() < 0.2;
      for (let m = 0; m < 4; m++) {
        const sx = rnd() * g.width, sz = rnd() * g.depth;
        const a = fireEdge(g, p.x, p.z, sx, sz, swim), b = refEdge(g, p.x, p.z, sx, sz, swim);
        assert.ok(same(a, b), `fireEdge sc${sc} t${t}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
        const e = fireExit(g, p.x, p.z, sx, sz, swim), f = refExit(g, p.x, p.z, sx, sz, swim);
        assert.ok(same(e, f), `fireExit sc${sc} t${t}: ${JSON.stringify(e)} vs ${JSON.stringify(f)}`);
        asks += 2; if (m > 0) hits += 2;
      }
    }
  }
  assert.ok(asks > 4000 && hits > 3000, `asked ${asks} times, ${hits} from a kept scan`);
});

test('fire-edge cache: a fire layer written without its fire version is not seen (the version is the key) — then is', () => {
  const g = new NavGrid(40, 40), x = 20, z = 20, sx = 5, sz = 20;
  burn(g, x, z, 2, 2, true); g.fireVersion++;
  const a = fireEdge(g, x, z, sx, sz);
  assert.ok(same(a, refEdge(g, x, z, sx, sz)), 'answered as the scan');
  // the cell it chose catches fire, the fire version left alone: the kept scan still offers it (stale, by contract)
  const k = Math.floor(a.z / g.cell) * g.cols + Math.floor(a.x / g.cell);
  g.fire[k]++; g.fireCells++;
  const stale = fireEdge(g, x, z, sx, sz);
  assert.ok(same(stale, a) && !same(stale, refEdge(g, x, z, sx, sz)), 'without the version bump the kept cells answer (negative control)');
  g.fireVersion++;
  assert.ok(same(fireEdge(g, x, z, sx, sz), refEdge(g, x, z, sx, sz)), 'with it, the scan is made again');
});
