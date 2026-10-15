/**
 * Mission-kept ground against mesh body clearance (map-builder navKeepPoints, mission `navKeep`): M8's lane between
 * the Gatling pit's sandbag ring and the supply track's side, the only way to the pit's open side and the ground N of
 * it, which the ring's mesh clearance squeezed shut in the real game (solution m08: e32, e30 and e31 are knifed there).
 */
import { test, assert } from './lib.mjs';
import { navKeepPoints } from '../../src/world/map-builder.js';
import M08 from '../../src/missions/m08_pyrotechnics.js';

test('navKeep: a mission\'s kept discs join the door and link keeps (radius given or the door disc)', () => {
  const world = { mission: { navKeep: [[10, 20, 1.4], [30, 40]] }, structureDoors: new Map(), grid: { links: [] } };
  const keep = navKeepPoints(world, []);
  assert.ok(keep.some(([x, z, r]) => x === 10 && z === 20 && r === 1.4), 'the given radius');
  assert.ok(keep.some(([x, z, r]) => x === 30 && z === 40 && r > 0), 'a default radius');
  assert.equal(navKeepPoints({ mission: {}, structureDoors: new Map(), grid: { links: [] } }, []).length, 0, 'none without navKeep');
});

test('m08: the lane W of the Gatling pit is kept (beside the ring, clear of its sandbags)', () => {
  const mission = M08.default ?? M08;
  const keep = mission.navKeep || [];
  assert.ok(keep.length >= 1, 'm08 keeps a disc');
  const ring = (mission.structures || []).find((s) => s.id === 'mg_pit');
  assert.ok(ring, 'the pit ring');
  for (const [x, z, r] of keep) {
    // west of the ring (the ring's own cells are grid blocks: the keep frees only the mesh's margin beside them)
    assert.ok(x < ring.x - (ring.ring?.r ?? 2), `disc W of the ring (${x} < ${ring.x - (ring.ring?.r ?? 2)})`);
    assert.ok(Math.hypot(x - ring.x, z - ring.z) - r < (ring.ring?.r ?? 2) + 0.6, 'and reaching the ring\'s margin');
  }
});
