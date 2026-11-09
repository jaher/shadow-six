/**
 * NavGrid.fillPoly / fillPolyG find a polygon's cells a row at a time (the edges the row crosses, sorted) instead of
 * asking pointInPolygon at every cell of the bounding box (M16's river: 100k cells x 15 edges in one load task). They
 * must fill exactly the cells the per-cell test fills, in the same order, with the same owner: random polygons —
 * convex, concave, self-crossing, with repeated points and flat edges, points as [x,z] or {x,z}, cut by the grid's
 * edges, vertices on cell centres and on cell lines — filled both ways into twin grids, every layer cell compared.
 */
import { test, assert } from './lib.mjs';
import { NavGrid, B, T } from '../../src/world/grid.js';
import { pointInPolygon } from '../../src/core/math.js';
import { runSync } from '../../src/engine/slice.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** The fill as it was: every cell of the bounding box asked (the order of the writes recorded). */
function fillPolyRef(g, points, layerName, value, owner, log) {
  const layer = g.layer(layerName);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    const [px, pz] = Array.isArray(p) ? p : [p.x, p.z];
    minX = Math.min(minX, px); maxX = Math.max(maxX, px); minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
  }
  const c = g.cell;
  const i0 = Math.max(0, Math.floor(minX / c)), i1 = Math.min(g.cols - 1, Math.floor(maxX / c));
  const j0 = Math.max(0, Math.floor(minZ / c)), j1 = Math.min(g.rows - 1, Math.floor(maxZ / c));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (pointInPolygon((i + 0.5) * c, (j + 0.5) * c, points)) { log.push(j * g.cols + i); g._write(j * g.cols + i, layer, value, owner); }
  }
}

function polygon(r, W, D) {
  const n = 3 + Math.floor(r() * 14), cx = r() * W, cz = r() * D, R = 2 + r() * 30, pts = [];
  const kind = r();
  for (let k = 0; k < n; k++) {
    let x, z;
    if (kind < 0.4) { const a = (k / n) * 6.283 + (r() - 0.5) * 0.3, rr = R * (0.4 + r() * 0.6); x = cx + Math.cos(a) * rr; z = cz + Math.sin(a) * rr; } // star / concave
    else if (kind < 0.6) { x = cx + (r() - 0.5) * 2 * R; z = cz + (r() - 0.5) * 2 * R; } // self-crossing
    else { x = Math.round((cx + (r() - 0.5) * 2 * R) * 4) / 4; z = Math.round((cz + (r() - 0.5) * 2 * R) * 4) / 4; } // on cell lines / centres (cell 0.5)
    if (r() < 0.1 && pts.length) { const q = pts[pts.length - 1]; x = Array.isArray(q) ? q[0] : q.x; } // flat or repeated
    pts.push(r() < 0.5 ? [x, z] : { x, z });
  }
  return pts;
}

test('fillPoly / fillPolyG: the cells the per-cell test fills, in its order', () => {
  let polys = 0, cells = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed * 2654435761), W = 40 + Math.floor(r() * 40), D = 40 + Math.floor(r() * 40);
    const a = new NavGrid(W, D), b = new NavGrid(W, D), cgrid = new NavGrid(W, D);
    for (let k = 0; k < 4; k++) {
      const pts = polygon(r, W, D), layer = r() < 0.5 ? 'terrain' : 'block', v = layer === 'terrain' ? T.WATER : B.HIGH, own = 1 + k;
      const log = [], seen = [];
      fillPolyRef(a, pts, layer, v, own, log);
      // (the live code's writes, recorded the same way)
      const w0 = b._write;
      b._write = function (idx, ...rest) { seen.push(idx); return w0.call(this, idx, ...rest); };
      b.fillPoly(pts, layer, v, own);
      b._write = w0;
      runSync(cgrid.fillPolyG(pts, layer, v, own));
      assert.deepEqual(seen, log, `seed ${seed} poly ${k}: the same cells in the same order`);
      polys++; cells += log.length;
    }
    for (const L of ['terrain', 'block']) {
      assert.deepEqual(Array.from(b.layer(L)), Array.from(a.layer(L)), `seed ${seed}: ${L} layer`);
      assert.deepEqual(Array.from(cgrid.layer(L)), Array.from(a.layer(L)), `seed ${seed}: ${L} layer (sliced)`);
    }
  }
  assert.ok(polys === 1200 && cells > 100000, `${polys} polygons, ${cells} cells`);
});
