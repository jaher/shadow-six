/**
 * Vegetation vertex arrays (art/terrain/treegen.js GeoAcc.toArrays / arraysToGeometry, perf/gpu-memory): normals and
 * aExt as normalized Int16, aTint as half floats — the same values within their step, the geometry reading the very
 * arrays the session cache keeps (no second copy); positions, uv, aInfo and aRoot exact Float32.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { GeoAcc, generateTree, TREE_QUALITY, useThree } from '../../src/art/terrain/treegen.js';

useThree(THREE);

test('tree arrays: Int16 normals / aExt and half-float tint, within one step of the floats', () => {
  const b = new GeoAcc(), l = new GeoAcc(), n = new GeoAcc();
  generateTree('spruce', 11, TREE_QUALITY.high, b, l, { x: 120, y: 3, z: 340 }, n);
  for (const acc of [b, n]) {
    if (!acc.count) continue;
    const a = acc.toArrays();
    assert.ok(a.n instanceof Int16Array && a.ext instanceof Int16Array && a.tint instanceof Uint16Array);
    assert.ok(a.p instanceof Float32Array && a.info instanceof Float32Array && a.root instanceof Float32Array && a.uv instanceof Float32Array);
    for (let i = 0; i < acc.n.length; i++) assert.ok(Math.abs(a.n[i] / 32767 - acc.n[i]) <= 0.5 / 32767 + 1e-7);
    for (let i = 0; i < acc.ext.length; i++) assert.ok(Math.abs(a.ext[i] / 32767 - acc.ext[i]) <= 0.5 / 32767 + 1e-7);
    for (let i = 0; i < acc.tint.length; i++) assert.ok(Math.abs(THREE.DataUtils.fromHalfFloat(a.tint[i]) - acc.tint[i]) <= Math.abs(acc.tint[i]) / 2048 + 1e-6);
    const g = GeoAcc.arraysToGeometry(a);
    assert.equal(g.attributes.normal.normalized, true);
    assert.equal(g.attributes.aExt.normalized, true);
    assert.ok(g.attributes.aTint.isFloat16BufferAttribute);
    assert.equal(g.attributes.aTint.array, a.tint, 'the cached array itself, not a copy');
    assert.equal(g.attributes.aTint.count, acc.count);
    assert.ok(Math.abs(g.attributes.normal.getY(0) - acc.n[1]) < 1e-4, 'getY reads the normalized value');
    const f32 = 84, now = 12 + 6 + 8 + 16 + 6 + 16 + 4;
    assert.equal(now, f32 - 16, '−16 bytes a vertex');
  }
});

test('values outside [−1, 1] stay Float32 (nothing clamped)', () => {
  const acc = new GeoAcc();
  acc.vert(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0, 0, [0, 0, 0, 0], [1, 1, 1], [1.2, 0]);
  const a = acc.toArrays();
  assert.ok(a.ext instanceof Float32Array);
  assert.equal(GeoAcc.arraysToGeometry({ ...a, idx: new Uint16Array([0, 0, 0]) }).attributes.aExt.normalized, false);
});
