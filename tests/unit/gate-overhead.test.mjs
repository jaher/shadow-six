/** Rule (d/e) overhead clearance (world/map-builder.js stampOverhead) skips gates: their leaves swing (a gate may start
 *  open with its leaves still drawn closed at build time), so a gate's passage is never an overhang a lorry stops at
 *  (M19 gate_s: the closed leaves' tops read as a 1.8 m beam; the base lorry never drove in through the open gate). */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { NavGrid } from '../../src/world/grid.js';
import { stampOverhead } from '../../src/world/map-builder.js';

const slab = (x, z, w, d, y0, y1) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, y1 - y0, d), new THREE.MeshBasicMaterial());
  m.position.set(x, (y0 + y1) / 2, z);
  const g = new THREE.Group(); g.add(m); g.updateMatrixWorld(true);
  return g;
};

test('overhead clearance: a gate\'s leaves never stamp an overhang over its passage; a porch roof does', () => {
  const g = new NavGrid(30, 30);
  const world = { grid: g, events: { on: () => () => {} } };
  const built = [
    // a 4 m double gate drawn closed (leaves 0.1–3 m up) over open cells (the gate is open: its cells unblocked)
    { object3d: slab(10, 10, 4, 0.2, 0.1, 3), def: { id: 'gate_s', type: 'gate', x: 10, z: 10, w: 4, h: 3, open: true }, type: 'gate', owner: 7 },
    // a porch roof 2.4–2.6 m up over open ground
    { object3d: slab(20, 20, 3, 3, 2.4, 2.6), def: { id: 'porch', type: 'hut', x: 20, z: 20, w: 3, d: 3, h: 2.6 }, type: 'hut', owner: 8 },
  ];
  stampOverhead(world, built);
  const lo = (x, z) => { const c = g.worldToCell(x, z); return g.overLo ? g.overLo[g.idx(c.i, c.j)] : Infinity; };
  assert.equal(lo(10, 10), Infinity, 'the gate passage has no overhang');
  assert.equal(lo(11.5, 10), Infinity);
  assert.ok(lo(20, 20) < 2.7, `the porch roof stamps its underside (${lo(20, 20)})`);
});
