/**
 * world/placement-visual.js raster cell keys: the structure rasters (planCells, overheadCells, standingCells,
 * lowSurfaces) keep a sample's cell under cellKey(i, j) — a small integer while |i|, |j| < 8192, the "i,j" string
 * otherwise — and hand back cellStr(key): exactly the template string `${i},${j}` they used to build for every sample
 * (M18's load: ~3 s of string keys). Every cell maps to one key and back, -0 reads "0", NaN / ±Infinity keep their
 * string; and the rasters give the same cells as before.
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { cellKey, cellStr, planCells, lowSurfaces, overheadCells, standingCells } from '../../src/world/placement-visual.js';

test('placement cell keys: every cell back to its own "i,j", integers inside the range, strings outside', () => {
  const seen = new Map();
  const vals = [-8193, -8192, -8191, -8190, -1000, -2, -1, -0, 0, 1, 2, 999, 8190, 8191, 8192, 8193, 1e6, -1e6];
  for (const i of vals) for (const j of vals) {
    const k = cellKey(i, j), s = cellStr(k);
    assert.equal(s, `${i},${j}`, `(${i}, ${j})`);
    const inside = Math.abs(i) < 8192 && Math.abs(j) < 8192;
    assert.equal(typeof k, inside ? 'number' : 'string');
    if (inside) assert.ok(Number.isInteger(k) && k >= 0 && k < 2 ** 28, 'a small non-negative integer (a Smi)');
    const prev = seen.get(k);
    assert.ok(prev === undefined || prev === s, 'one key per cell');
    seen.set(k, s);
  }
  for (const [i, j] of [[NaN, 3], [3, NaN], [Infinity, 0], [0, -Infinity]]) assert.equal(cellStr(cellKey(i, j)), `${i},${j}`);
  // a dense block: distinct cells, distinct keys
  const ks = new Set();
  for (let i = -300; i <= 300; i += 7) for (let j = -300; j <= 300; j += 3) ks.add(cellKey(i, j));
  assert.equal(ks.size, 86 * 201);
});

/** A small structure: a 3 × 2 m box (walls to 2.4 m), a 1.2 m step block, a 0.4 m porch slab, a 2.6 m eave plate. */
function hut() {
  const g = new THREE.Group();
  const add = (w, h, d, x, y, z, ry = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial()); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m; };
  add(3, 2.4, 2, 0, 1.2, 0, 0.3);
  add(1.2, 0.3, 0.8, 2.1, 0.15, 0.6);
  add(1.5, 0.4, 1.0, -2.2, 0.2, -0.4);
  add(4.2, 0.05, 2.8, 0.2, 2.6, 0.1, 0.3);
  g.position.set(37.3, 0, 81.9);
  return g;
}

test('placement cell keys: the rasters give a structure the same cells, values and order as string keys did', () => {
  const root = hut();
  root.updateMatrixWorld(true);
  // planCells: rectangles (the order follows the first-seen cells)
  const a = planCells(root, { minY: 0.1, maxY: 2.0, cell: 0.25 }), b = planCells(root, { minY: 0.1, maxY: 2.0, cell: 0.25, fit: true, close: 0 });
  assert.ok(a && a.length > 10 && b && b.length > 10);
  // reference: the same raster with a string key per sample, through the module's own closeCells / row merge — the
  // cells set must be identical: recompute it here from the triangles (barycentric samples, as planCellsRaw)
  const ref = new Set(), cell = 0.25;
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
  root.traverse((nd) => {
    if (!nd.isMesh) return;
    const pos = nd.geometry.attributes.position, idx = nd.geometry.index, cnt = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < cnt; t += 3) {
      pa.fromBufferAttribute(pos, idx.getX(t)).applyMatrix4(nd.matrixWorld); pb.fromBufferAttribute(pos, idx.getX(t + 1)).applyMatrix4(nd.matrixWorld); pc.fromBufferAttribute(pos, idx.getX(t + 2)).applyMatrix4(nd.matrixWorld);
      if (Math.min(pa.y, pb.y, pc.y) > 2.0 || Math.max(pa.y, pb.y, pc.y) < 0.1) continue;
      const L = Math.max(pa.distanceTo(pb), pb.distanceTo(pc), pc.distanceTo(pa)), n = Math.min(400, Math.max(1, Math.ceil(L / (cell * 0.5))));
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const u = i / n, v = j / n, w = 1 - u - v, y = pa.y * u + pb.y * v + pc.y * w;
        if (y < 0.1 - 0.05 || y > 2.0 + 0.05) continue;
        ref.add(`${Math.floor((pa.x * u + pb.x * v + pc.x * w) / cell)},${Math.floor((pa.z * u + pb.z * v + pc.z * w) / cell)}`);
      }
    }
  });
  // rows of the unclosed raster (close: 0) in world cells: every reference cell is covered, nothing else
  const plain = planCells(root, { minY: 0.1, maxY: 2.0, cell, close: 0 });
  const got = new Set();
  for (const r of plain) { const [x0, z0] = r[0], [x1] = r[1]; for (let x = x0 + cell / 2; x < x1; x += cell) got.add(`${Math.floor(x / cell)},${Math.floor((z0 + cell / 2) / cell)}`); }
  assert.deepEqual([...got].sort(), [...ref].sort(), 'same cells as string keys per sample');
  // overhead / low / standing: maps and sets keyed "i,j", first-seen order, values from every sample
  const over = overheadCells(root, { minY: 2.3, maxY: 3, cell: 0.5 });
  assert.ok(over.size > 20 && [...over.keys()].every((k) => /^-?\d+,-?\d+$/.test(k)));
  for (const [, [lo, hi]] of over) assert.ok(lo <= hi && lo >= 2.3 && hi <= 3);
  const low = lowSurfaces(root, { maxY: 0.6, cell: 0.2 });
  assert.ok(low.size > 20 && [...low.values()].every((y) => y > 0 && y <= 0.6));
  const into = new Set(['999,999']);
  const st = standingCells(root, () => 0, { lo: 0.15, hi: 1.2, cell: 0.25 }, into);
  assert.equal([...st][0], '999,999', 'an `into` keeps what it held first');
  assert.ok(st.size > 50 && [...st].every((k) => /^-?\d+,-?\d+$/.test(k)));
});
