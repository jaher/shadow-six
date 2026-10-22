/**
 * Roof ways (clip-2 ways, M3 dam bunker): a structure with a walkable roof reached by a climb link and its `entry`
 * path only (`roofWays: false`) must not have its nav ring held open for the mission points standing on the roof.
 * walkPieces labels cells by 4-connection and no elevation, so the crew's post / door approach / link roof end counted
 * as ground points the berm's visual nav stamp was cutting off, and keepWays relaxed the ring round the whole mound
 * (clipping seed 11: e32 ran into the berm, 0.6 m deep). map-builder groundWays.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { NavGrid, MAX_STEP } from '../../src/world/grid.js';
import { stampVisualNav, groundWays } from '../../src/world/map-builder.js';

const CX = 15, CZ = 15, ROOF_R = 2, ROOF_Y = 2.8;

/** A flat-topped earth mound (6 m → 2.2 m radius, 3 m high) with a raised walkable roof on its top: a bunker + berm. */
function mound(roofWays) {
  const grid = new NavGrid(30, 30);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 6, 3, 32, 6), new THREE.MeshBasicMaterial({ name: 'kit:turf' }));
  mesh.position.set(CX, 1.5, CZ);
  const root = new THREE.Group();
  root.add(mesh);
  root.updateMatrixWorld(true);
  for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.cols; i++) {
    const c = grid.cellCenter(i, j);
    if (Math.hypot(c.x - CX, c.z - CZ) <= ROOF_R) grid.elev[grid.idx(i, j)] = ROOF_Y;
  }
  const def = { id: 'mound', type: 'bunker', x: CX, z: CZ, w: 4, d: 4, ...(roofWays === false ? { roofWays: false } : null) };
  const built = [{ owner: 100001, type: 'bunker', def, object3d: root }];
  const world = { grid, structureDoors: new Map(), mission: {}, events: { on: () => () => {} } };
  return { grid, built, world };
}

/** Angles (of 36) along which a walker can get from the roof's rim out to open ground over non-blocked cells. */
function openSpokes(grid) {
  let open = 0;
  for (let a = 0; a < 36; a++) {
    const c = Math.cos((a * Math.PI) / 18), s = Math.sin((a * Math.PI) / 18);
    let shut = false;
    for (let r = ROOF_R + 0.5; r <= 7.5 && !shut; r += 0.25) {
      const i = Math.floor((CX + c * r) / grid.cell), j = Math.floor((CZ + s * r) / grid.cell);
      if (!grid.isWalkable(i, j)) shut = true;
    }
    if (!shut) open++;
  }
  return open;
}

test('roof ways: the roof points of a `roofWays: false` structure are no ground ways', () => {
  const { grid, built } = mound(false);
  const ways = [[CX, CZ], [CX + 1, CZ - 1], [3, 3], [CX + 4.5, CZ]]; // two on the roof, two on the ground (one at the berm's foot)
  const kept = groundWays(grid, built, ways);
  assert.deepEqual(kept, [[3, 3], [CX + 4.5, CZ]], 'the ground points stay, the roof points go');
  // a structure without the flag keeps every point (the rule is the mission data's)
  assert.equal(groundWays(grid, mound().built, ways).length, 4);
  // a flagged structure whose centre is not on a raised level (a bunker without a roof) changes nothing
  const flat = mound(false);
  flat.grid.elev.fill(0);
  assert.equal(groundWays(flat.grid, flat.built, ways).length, 4);
  // the raised level is the cells a step from one another over MAX_STEP above the ground: another roof elsewhere is not its own
  const two = mound(false);
  two.grid.elev[two.grid.idx(5, 5)] = ROOF_Y;
  assert.equal(groundWays(two.grid, two.built, [[2.75, 2.75]]).length, 1, 'a raised cell apart from the roof is a way');
  assert.ok(ROOF_Y > MAX_STEP);
});

test('roof ways: the berm ring stays shut round a flagged roof (it was relaxed open for the roof points)', () => {
  const points = [[CX, CZ], [CX + 1, CZ - 1], [3, 3], [27, 27]]; // the crew's post and a door approach on the roof, two spawns outside
  const flagged = mound(false);
  stampVisualNav(flagged.world, flagged.built, points);
  assert.ok(flagged.grid.navBlock.some((v) => v), 'the berm is stamped');
  assert.equal(openSpokes(flagged.grid), 0, 'no way through the ring: nobody walks up the berm');
  // the same mound without the flag: the roof points are ways, the ring is cut open to keep them connected (the old behaviour)
  const plain = mound();
  stampVisualNav(plain.world, plain.built, points);
  assert.ok(openSpokes(plain.grid) > 0, `without the flag the ring is relaxed open (${openSpokes(plain.grid)} spokes)`);
});
