/**
 * A gate's moving parts are nobody's ground (clipping seed 11: M2 e15 aiming beside gate_se, 0.065 m into its fork rest;
 * GPU side: tests/gate-seat.test.mjs). world/placement-visual.js lowSurfaces leaves out `userData.surface === false`
 * subtrees; art/breakable-gates.js sets it on every leaf (a boom's pole with its HALT plate and counterweight) and on
 * a log gate post's tarred band. Before, the HALT plate's underside under a shut boom (0.66 m), the counterweight's
 * bottom (0.75 m) and the band's top cap (0.5 m) were low surfaces: world.groundY at the boom's centre read 0.66, so the
 * model and its physics frame were seated 0.66 m up, and a man under an open boom or in M2's footway stepped up onto them.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { buildBreakableGate } from '../../src/art/breakable-gates.js';
import { lowSurfaces, visualSignature } from '../../src/world/placement-visual.js';
import { getMission } from '../../src/missions/index.js';

/** The gate model placed as props.js places it (local +x along the gate line at `rot`), with its low surfaces. */
function placed(def) {
  const g = buildBreakableGate(def);
  g.position.set(def.x, 0, def.z); g.rotation.y = -(def.rot ?? 0);
  g.updateMatrixWorld(true);
  return g;
}
const top = (g) => Math.max(0, ...lowSurfaces(g, { maxY: 0.8, cell: 0.2 }).values());

test('gate surface: the M2 / M4 booms offer no ground at all (the posts\' footings are flush pads)', () => {
  const defs = [...getMission('m02').structures, ...getMission('m04').structures].filter((s) => s.type === 'gate' && /boom/.test(s.variant || ''));
  assert.equal(defs.length, 4, 'gate_se, gate_outer, boom_x1, boom_x2');
  for (const d of defs) {
    const g = placed(d), y = top(g);
    // (the footings were 12 cm slabs, a step that lifted a boot beside the fork rest: M2 e6 at t = 34 s, seed 11)
    assert.ok(y < 0.02, `${d.id}: highest low surface ${y.toFixed(3)} m (the concrete footings stand 1.5 cm out of the ground)`);
    assert.ok(g.userData.gate.leaves.every((l) => l.userData.surface === false), `${d.id}: its leaf is no surface`);
  }
});

test('gate surface: without the flag the HALT plate is ground again, and the analysis cache tells them apart', () => {
  const d = getMission('m02').structures.find((s) => s.id === 'gate_se');
  const g = placed(d), sig = visualSignature(g);
  for (const l of g.userData.gate.leaves) delete l.userData.surface;
  assert.notEqual(visualSignature(g), sig, 'the surface flag is part of the visual signature');
  const y = top(g);
  assert.ok(y > 0.6, `the plate's underside / counterweight read as ground (${y.toFixed(3)} m): the test measures the leaf`);
  // (any subtree: a plain mesh marked off is left out too)
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1));
  plate.position.set(0, 0.3, 0); const root = new THREE.Group(); root.add(plate); root.updateMatrixWorld(true);
  assert.ok(Math.abs(top(root) - 0.35) < 1e-6);
  plate.userData.surface = false;
  assert.equal(top(root), 0);
});
