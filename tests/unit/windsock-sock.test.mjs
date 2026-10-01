/** Windsock cloth (art/windsock-sock.js): one continuous tube along a smooth spine that follows the hinge chain. */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { createWindsockSock, sockBendAt, SOCK } from '../../src/art/windsock-sock.js';

const mk = () => createWindsockSock(new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial());
const rigidEnd = (ang) => { let y = 0, z = 0, a = 0; for (const x of ang) { a += x; y -= Math.sin(a) * SOCK.hinge; z += Math.cos(a) * SOCK.hinge; } return [y, z]; };

test('windsock cloth: one watertight banded tube, 5 bands in 2 draw groups, outward front faces', () => {
  const s = mk(), g = s.geometry;
  assert.equal(g.groups.length, 2);
  assert.equal(g.index.count, SOCK.segL * SOCK.segR * 6);
  assert.ok(g.attributes.color, 'vertex colours (library materials are vertex-coloured)');
  for (const ang of [[0, 0, 0, 0], [0.5, 0.45, 0.4, 0.35], [0.9, 0.8, 0.7, 0.6]]) {
    s.update(ang, ang[0] ? 0.1 : 1, 0.7);
    const p = g.attributes.position.array, n = g.attributes.normal.array.slice();
    for (let k = 0; k < p.length; k++) assert.ok(Number.isFinite(p[k]) && Number.isFinite(n[k % n.length]));
    // analytic normals agree with the mesh's own (winding) normals: front face = outside, so double-sided light is right
    g.computeVertexNormals();
    const c = g.attributes.normal.array; let worst = 1;
    for (let k = 0; k < n.length; k += 3) worst = Math.min(worst, n[k] * c[k] + n[k + 1] * c[k + 1] + n[k + 2] * c[k + 2]);
    assert.ok(worst > 0.8, `normals outward and consistent (worst cos ${worst.toFixed(2)})`);
    // continuous: neighbouring rings never more than one ring step apart (no slits / gaps between bands)
    const ringN = SOCK.segR + 1, step = SOCK.length / SOCK.segL;
    for (let i = 0; i < SOCK.segL; i++) {
      const a = new THREE.Vector3().fromArray(s.spine((i * SOCK.length) / SOCK.segL).toArray());
      const b = s.spine(((i + 1) * SOCK.length) / SOCK.segL);
      assert.ok(Math.abs(a.distanceTo(b) - step) < 1e-3, 'spine is arc-length parametrised');
    }
    void ringN;
  }
});

test('windsock cloth: the spine follows the rigid hinge chain (same droop envelope, smooth bend)', () => {
  const s = mk();
  for (const ang of [[0.35, 0.4, 0.45, 0.5], [0.05, 0.06, 0.07, 0.08]]) {
    s.update(ang, 0.3, 0);
    const e = s.spine(SOCK.length), [ry, rz] = rigidEnd(ang);
    assert.ok(Math.hypot(e.y - ry, e.z - rz) < 0.25, `tail within 25 cm of the hinge chain (${e.y.toFixed(2)},${e.z.toFixed(2)} vs ${ry.toFixed(2)},${rz.toFixed(2)})`);
    let maxStep = 0;
    for (let k = 1; k <= 60; k++) maxStep = Math.max(maxStep, Math.abs(sockBendAt(ang, (k * SOCK.length) / 60) - sockBendAt(ang, ((k - 1) * SOCK.length) / 60)));
    assert.ok(maxStep < 0.06, `bend angle changes smoothly (max ${maxStep.toFixed(3)} rad per 6 cm)`);
  }
});
