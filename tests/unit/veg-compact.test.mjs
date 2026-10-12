/**
 * Compact vertex attributes (engine/vertex-pack.js, perf/gpu-memory). Vegetation arrays (art/terrain/treegen.js
 * GeoAcc.toArrays / arraysToGeometry): normals and aExt as normalized Int16, aTint as half floats — 3-vectors padded to
 * 4 components (no 3-component 16-bit vertex format in D3D11 / Metal strides: ANGLE would keep a converted copy) — the
 * same values within their step, the geometry reading the very arrays the session cache keeps (no second copy);
 * positions, uv, aInfo and aRoot exact Float32. Terrain / apron normals: Int16 × 4.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { GeoAcc, generateTree, TREE_QUALITY, useThree } from '../../src/art/terrain/treegen.js';
import { snorm16, half16, packNormals } from '../../src/engine/vertex-pack.js';

useThree(THREE);

test('tree arrays: Int16 normals / aExt and half-float tint, within one step of the floats', () => {
  const b = new GeoAcc(), l = new GeoAcc(), n = new GeoAcc();
  generateTree('spruce', 11, TREE_QUALITY.high, b, l, { x: 120, y: 3, z: 340 }, n);
  for (const acc of [b, n]) {
    if (!acc.count) continue;
    const a = acc.toArrays();
    assert.ok(a.n instanceof Int16Array && a.ext instanceof Int16Array && a.tint instanceof Uint16Array);
    assert.ok(a.p instanceof Float32Array && a.info instanceof Float32Array && a.root instanceof Float32Array && a.uv instanceof Float32Array);
    assert.equal(a.n.length, acc.count * 4, 'normals padded to 4 components');
    assert.equal(a.tint.length, acc.count * 4, 'tint padded to 4 components');
    for (let k = 0; k < acc.count; k++) for (let c = 0; c < 3; c++) {
      assert.ok(Math.abs(a.n[k * 4 + c] / 32767 - acc.n[k * 3 + c]) <= 0.5 / 32767 + 1e-7);
      const t = acc.tint[k * 3 + c];
      assert.ok(Math.abs(THREE.DataUtils.fromHalfFloat(a.tint[k * 4 + c]) - t) <= Math.abs(t) / 2048 + 1e-6);
    }
    for (let k = 0; k < acc.count; k++) { assert.equal(a.n[k * 4 + 3], 0); assert.equal(a.tint[k * 4 + 3], 0); }
    for (let i = 0; i < acc.ext.length; i++) assert.ok(Math.abs(a.ext[i] / 32767 - acc.ext[i]) <= 0.5 / 32767 + 1e-7);
    const g = GeoAcc.arraysToGeometry(a);
    assert.equal(g.attributes.normal.normalized, true);
    assert.equal(g.attributes.aExt.normalized, true);
    assert.ok(g.attributes.aTint.isFloat16BufferAttribute);
    assert.equal(g.attributes.aTint.array, a.tint, 'the cached array itself, not a copy');
    assert.equal(g.attributes.aTint.count, acc.count);
    assert.equal(g.attributes.normal.itemSize, 4); assert.equal(g.attributes.aTint.itemSize, 4); assert.equal(g.attributes.aExt.itemSize, 2);
    assert.equal(g.attributes.normal.count, acc.count);
    assert.ok(Math.abs(g.attributes.normal.getY(0) - acc.n[1]) < 1e-4, 'getY reads the normalized value');
    assert.ok(Math.abs(g.attributes.aTint.getZ(0) - acc.tint[2]) < 2e-3, 'getZ reads the half float');
    const f32 = 84, now = 12 + 8 + 8 + 16 + 8 + 16 + 4;
    assert.equal(now, f32 - 12, '−12 bytes a vertex');
  }
});

test('values outside [−1, 1] stay Float32 (nothing clamped)', () => {
  const acc = new GeoAcc();
  acc.vert(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0, 0, [0, 0, 0, 0], [1, 1, 1], [1.2, 0]);
  const a = acc.toArrays();
  assert.ok(a.ext instanceof Float32Array);
  assert.equal(GeoAcc.arraysToGeometry({ ...a, idx: new Uint16Array([0, 0, 0]) }).attributes.aExt.normalized, false);
});

test('vertex-pack: padded Int16 / half arrays; terrain normals Int16 × 4 within one step', () => {
  assert.deepEqual([...snorm16([1, -1, 0.5, 0, 0, 1], 3, 4)], [32767, -32767, 16384, 0, 0, 0, 32767, 0]);
  assert.equal(snorm16([0, 1.01], 2), null);
  const h = half16([1, 0.5, 2], 3, 4);
  assert.deepEqual([...h].map((x) => THREE.DataUtils.fromHalfFloat(x)), [1, 0.5, 2, 0]);
  const geo = new THREE.PlaneGeometry(10, 10, 8, 8);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i)) * Math.cos(p.getY(i) * 0.7));
  geo.computeVertexNormals();
  const ref = geo.attributes.normal.array.slice();
  assert.ok(packNormals(THREE, geo));
  const n = geo.attributes.normal;
  assert.ok(n.array instanceof Int16Array && n.normalized && n.itemSize === 4 && n.count === p.count);
  for (let i = 0; i < n.count; i++) {
    assert.ok(Math.abs(n.getX(i) - ref[i * 3]) <= 0.5 / 32767 + 1e-6 && Math.abs(n.getY(i) - ref[i * 3 + 1]) <= 0.5 / 32767 + 1e-6 && Math.abs(n.getZ(i) - ref[i * 3 + 2]) <= 0.5 / 32767 + 1e-6);
  }
  assert.equal(packNormals(THREE, geo), false, 'already packed');
});
