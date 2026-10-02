/**
 * Dynamic clipping rules (clip-2, docs/clipping-audit.md): climbs over the wall's real top, landings kept clear,
 * goals pushed off walls, deck ends kept reachable, walk-under clearance of tree branches.
 */
import { test, assert } from './lib.mjs';
import { climbTrack, climbAt, resolvePlacement, landingObstacles } from '../../src/world/placement.js';
import { clearOfWalls, findPath } from '../../src/world/pathfinding.js';
import { keepDeckAccess, deckEnds } from '../../src/world/map-builder.js';
import { clearBranch } from '../../src/art/terrain/treegen.js';
import { NavGrid, B } from '../../src/world/grid.js';

test('climb (e): the track rises at the wall face, crosses above its measured top, lands on the far side', () => {
  const g = new NavGrid(10, 4);
  g.fillRect(4.5, 0, 1, 4, 'block', B.HIGH); // wall x ∈ [4.5, 5.5)
  g.blockTop = new Float32Array(g.cols * g.rows);
  for (let k = 0; k < g.block.length; k++) if (g.block[k]) g.blockTop[k] = 1.8;
  const T = climbTrack(g, { x: 3, z: 2, y: 0 }, { x: 7, z: 2, y: 0 }, { r: 0.35 });
  assert.equal(T.L, 4);
  assert.ok(T.len > 4 + 2 * 1.7, `the track includes the climb up and down (${T.len.toFixed(2)} m)`);
  for (let f = 0; f <= 1.0001; f += 0.02) {
    const p = climbAt(T, f), x = 3 + p.d;
    if (x + 0.35 > 4.5 && x - 0.35 < 5.5) assert.ok(p.y >= 1.8, `over the wall at x ${x.toFixed(2)} the feet are above its top (${p.y.toFixed(2)})`);
  }
  assert.deepEqual(climbAt(T, 0), { d: 0, y: 0 });
  assert.deepEqual(climbAt(T, 1), { d: 4, y: 0 });
});

test('climb (b): poles, trees and pickups keep clear of a climb landing (relocated)', () => {
  const links = { climbLinks: [{ a: [10, 10, 0], b: [12, 10, 0] }] };
  assert.equal(landingObstacles(links).length, 2);
  const pole = { id: 'p', type: 'telegraph_pole', x: 12.1, z: 10.1, h: 7 };
  const res = resolvePlacement([pole], { links, points: true });
  const p = res.structures[0];
  assert.ok(Math.hypot(p.x - 12, p.z - 10) >= 0.8, `pole moved off the landing (${p.x}, ${p.z})`);
  assert.ok(res.log.some((l) => /climb1:b/.test(l)));
});

test('goals (e): a destination beside a wall is pushed a body radius off it, within its cell; open ground untouched', () => {
  const g = new NavGrid(10, 10);
  g.fillRect(5, 0, 1, 10, 'block', B.HIGH); // wall x ∈ [5, 6)
  const q = clearOfWalls(g, 4.95, 3.3);
  assert.ok(q.x <= 4.75 + 1e-9 && q.x >= 4.5, `pushed west (${q.x})`);
  assert.ok(Math.abs(q.z - 3.3) < 0.25, 'stays in its cell along the wall');
  assert.deepEqual(clearOfWalls(g, 2.2, 3.3), { x: 2.2, z: 3.3 });
  const p = findPath(g, 1, 1, 4.95, 8);
  assert.ok(p[p.length - 1].x <= 4.75 + 1e-9, 'findPath ends clear of the wall');
  g.navBlock[g.idx(3, 3)] = 1; // a visual nav block counts too
  assert.ok(clearOfWalls(g, 2.02, 1.7).x > 2.02);
});

test('deck ends (e): a stamp closing every landing of an end gives that end its lanes back; open ends keep the stamp', () => {
  const pairs = [{ i: 10, j: 5, lane: [1, 2, 3] }, { i: 10, j: 6, lane: [4, 5, 6] }, { i: 30, j: 5, lane: [7, 8, 9] }];
  assert.equal(deckEnds(pairs).length, 2);
  const out = new Set([1, 4, 5, 7]); // end 1 fully closed at its first lane cells, end 2 closed too
  keepDeckAccess(pairs, out);
  assert.ok(!out.has(1) && !out.has(4) && !out.has(5) && !out.has(7), 'both ends reopened');
  const out2 = new Set([1, 5]); // end 1 still has lane 4 open → its stamp stays
  keepDeckAccess(pairs, out2);
  assert.ok(out2.has(1) && out2.has(5));
});

test('trees (e): below head height a branch ends at the trunk reach; higher or inner branches untouched', () => {
  const P = (x, y, z) => ({ x, y, z });
  const low = [P(0, 1.2, 0), P(0.3, 1.1, 0), P(0.7, 0.9, 0), P(1.1, 0.7, 0)];
  assert.equal(clearBranch(low, { y: 1.95, r: 0.35 }), 1);
  assert.equal(clearBranch(low, null), 3);
  const high = [P(0, 2.5, 0), P(0.6, 2.4, 0), P(1.2, 2.2, 0), P(1.8, 2.0, 0)];
  assert.equal(clearBranch(high, { y: 1.95, r: 0.35 }), 3);
  const out = [P(0, 1.5, 0), P(0.5, 1.5, 0)];
  assert.equal(clearBranch(out, { y: 1.95, r: 0.35 }), 0, 'dropped');
});

test('hulls (d): nose against a wall, a 180° turn backs up first; the corners never sweep into the wall; no room → forbidden', async () => {
  const { World } = await import('../../src/world/world.js');
  const { createVehicle } = await import('../../src/entities/vehicle.js');
  const w = new World({ size: [80, 60] });
  w.vehicleFactory = createVehicle;
  w.grid.fillRect(50, 0, 2, 60, 'block', B.HIGH); // wall x ∈ [50, 52)
  const tk = w.spawnVehicle('panzer2', { x: 47.4, z: 30, heading: 0 }); // nose 5 cm short of the wall
  const inWall = () => tk._outline(tk.x, tk.z, tk.heading, 0).some(([x]) => x > 50 + 1e-6);
  assert.ok(!inWall());
  assert.ok(!tk._turnClear(tk.x, tk.z, 0, Math.PI / 2), 'turning here swings a corner through the wall');
  const b = tk.turnPlan(20, 30);
  assert.ok(b > 0 && b <= 3, `backs up first (${b} m)`);
  assert.ok(tk.canDriveTo(20, 30));
  assert.ok(tk.driveTo(20, 30));
  for (let k = 0; k < 60 * 6; k++) { tk.update(1 / 60); assert.ok(!inWall(), `corner in the wall at h ${tk.heading.toFixed(2)} (${tk.x.toFixed(2)})`); }
  assert.ok(tk.x < 45, `then drives off west (${tk.x.toFixed(2)})`);
  // boxed in (wall ahead, a wall 1 m behind the tail): no turn, forbidden cursor
  w.grid.fillRect(43, 0, 1, 60, 'block', B.HIGH);
  const t2 = w.spawnVehicle('panzer2', { x: 47.4, z: 10, heading: 0 });
  assert.equal(t2.turnPlan(47.4, 0), null);
  assert.equal(t2.canDriveTo(47.4, 0), false);
});

test('hulls (d): tail against a wall, the hull pulls forward before it turns; a lower bank or the ramp under it is no obstacle to the sweep', async () => {
  const { World } = await import('../../src/world/world.js');
  const { createVehicle } = await import('../../src/entities/vehicle.js');
  const w = new World({ size: [80, 60] });
  w.vehicleFactory = createVehicle;
  w.grid.fillRect(50, 0, 2, 60, 'block', B.HIGH); // wall x ∈ [50, 52)
  const tk = w.spawnVehicle('panzer2', { x: 47.4, z: 30, heading: Math.PI }); // tail 5 cm short of the wall
  const inWall = () => tk._outline(tk.x, tk.z, tk.heading, 0).some(([x]) => x > 50 + 1e-6);
  const b = tk.turnPlan(tk.x, 50);
  assert.ok(b < 0 && b >= -3, `pulls forward first (${b} m)`);
  assert.ok(tk.driveTo(tk.x, 50), 'the order is taken');
  for (let k = 0; k < 60 * 8; k++) { tk.update(1 / 60); assert.ok(!inWall(), `corner in the wall at h ${tk.heading.toFixed(2)}`); }
  assert.ok(tk.z > 36, `then drives off south (${tk.z.toFixed(2)})`);
  // a hull on a raised walk (elev 2): the corners may swing over the lower ground beside it
  const w2 = new World({ size: [40, 40] });
  w2.vehicleFactory = createVehicle;
  for (let j = 30; j < 50; j++) for (let i = 30; i < 50; i++) w2.grid.elev[w2.grid.idx(i, j)] = 2;
  const t2 = w2.spawnVehicle('panzer2', { x: 20, z: 20, heading: 0 });
  t2.y = 2;
  assert.ok(t2._sweepFree(14.6, 20), 'the bank below the raised walk');
  for (let j = 30; j < 50; j++) w2.grid.elev[w2.grid.idx(49, j)] = 3.6;
  assert.ok(!t2._sweepFree(24.75, 20.25), 'a step up onto a higher walk is still in the way');
  // a ramp rising 0.15 m per cell ahead of the hull: its far end, 1.5 m higher, does not block the sweep
  for (let i = 40; i < 50; i++) for (let j = 30; j < 50; j++) w2.grid.elev[w2.grid.idx(i, j)] = 2 + 0.15 * (i - 39);
  assert.ok(t2._sweepFree(24.75, 20.25), 'the ramp the hull is on');
});

test('trees (b): a crown lifted over a vehicle lane also gets a floor at the vehicle top; drooping branches end there', async () => {
  const { pruneTree, routeObstacles, OBSTACLE_H } = await import('../../src/world/placement.js');
  const lane = routeObstacles([{ id: 'boat', vehicleType: 'patrolboat', route: { points: [[0, 0], [20, 0]] } }]);
  assert.equal(lane[0].def.h, OBSTACLE_H.vehicle, 'a lane is as tall as the vehicles on it');
  const hint = pruneTree({ type: 'pine', x: 10, z: 3, h: 10 }, lane);
  assert.ok(hint.crownBase >= OBSTACLE_H.vehicle + 0.9 - 1e-9 && hint.crownFloor >= OBSTACLE_H.vehicle + 0.25 - 1e-9, JSON.stringify(hint));
  const P = (x, y, z) => ({ x, y, z });
  const sag = [P(0, 4.1, 0), P(0.8, 3.9, 0), P(1.6, 3.6, 0), P(2.4, 3.3, 0)]; // a spruce bough sagging over the lane
  const clear = [{ y: 1.95, r: 0.35 }, { y: hint.crownFloor, r: 0.35 }];
  assert.equal(clearBranch(sag, clear), 2, 'cut before it sags under the floor');
  assert.equal(clearBranch(sag, clear[0]), 3, 'the walk-under rule alone keeps it');
});

test('weapons (e): aiming at a wall within the barrel reach, the unit steps back; over a low wall or from a wall walk he fires over it', async () => {
  const { weaponRoom } = await import('../../src/world/placement.js');
  const g = new NavGrid(10, 6);
  g.fillRect(5, 0, 1, 6, 'block', B.HIGH); // wall x ∈ [5, 6), 2.2 m
  g.blockTop = new Float32Array(g.cols * g.rows);
  for (let k = 0; k < g.block.length; k++) if (g.block[k]) g.blockTop[k] = 2.2;
  const b = weaponRoom(g, 4.4, 3, 0);
  assert.ok(b >= 0.3 - 1e-9 && b <= 0.5, `steps back ${b} m (barrel 0.3–0.9 m ahead)`);
  assert.equal(weaponRoom(g, 4.8, 3, 0), 0.5, 'no full room within 0.5 m: as far as allowed');
  assert.equal(weaponRoom(g, 3.5, 3, 0), 0, 'room already');
  assert.equal(weaponRoom(g, 4.6, 3, Math.PI), 0, 'facing away');
  g.fillRect(4, 0, 0.5, 6, 'block', B.HIGH); // a wall right behind too
  assert.equal(weaponRoom(g, 4.6, 3, 0, 0, { max: 0.5 }), 0.1, 'a wall behind too: only to the end of his cell');
  assert.equal(weaponRoom(g, 4.52, 3, 0, 0, { max: 0.5 }), null, 'boxed in: stays');
  g.fillRect(4, 0, 0.5, 6, 'block', B.NONE);
  assert.equal(weaponRoom(g, 4.6, 3, 0, 1.4), 0, 'on a 1.4 m wall walk the shoulder is over the top');
  for (let k = 0; k < g.block.length; k++) if (g.block[k]) g.blockTop[k] = 1.0;
  assert.equal(weaponRoom(g, 4.6, 3, 0), 0, 'over a 1 m sandbag wall');
  const { Unit } = await import('../../src/entities/unit.js').catch(() => ({}));
  assert.ok(Unit, 'unit module loads');
});

test('raised walks (e): walk cells beside the stakes are blocked while the walk stays in one piece; posts stay open', async () => {
  const { stampWalkClearance } = await import('../../src/world/map-builder.js');
  const g = new NavGrid(20, 6);
  for (let i = 4; i < 36; i++) for (let j = 4; j < 7; j++) g.elev[g.idx(i, j)] = 2.2; // walk z ∈ [2, 3.5), x ∈ [2, 18)
  g.solidStamp('stakes', Array.from({ length: 80 }, (_, k) => `${k},14`)); // a row of stakes along z ∈ [3.5, 3.75)
  const n = stampWalkClearance({ grid: g }, [[5.25, 3.25]]);
  assert.ok(n > 20, `${n} cells`);
  assert.ok(g.navBlock[g.idx(20, 6)] && !g.navBlock[g.idx(20, 5)] && !g.navBlock[g.idx(20, 4)], 'the row next to the stakes only');
  assert.ok(!g.navBlock[g.idx(10, 6)], 'the post at (5.25, 3.25) stays open');
  // a one-cell-wide walk would be cut in two by a stake beside its middle: left alone
  const h = new NavGrid(20, 6);
  for (let i = 4; i < 36; i++) h.elev[h.idx(i, 4)] = 2.2;
  h.solidStamp('post', ['40,10']); // beside cell (20, 4)
  assert.equal(stampWalkClearance({ grid: h }, []), 0);
});

test('ways (e): a stamp that cuts a way between mission points steps down; a deck keeps its crossing', async () => {
  const { walkPieces, keepWays, deckCrossing, deckCrossingKept } = await import('../../src/world/map-builder.js');
  const g = new NavGrid(20, 10);
  g.fillRect(0, 4, 9, 2, 'block', B.HIGH); g.fillRect(10, 4, 10, 2, 'block', B.HIGH); // a wall with a 1 m gap at x 9..10
  const labels0 = walkPieces(g), ways = [[4, 2], [4, 16]]; // a point north and one south of the wall
  const full = new Set([g.idx(18, 8), g.idx(19, 8), g.idx(18, 9), g.idx(19, 9)]), half = new Set([g.idx(18, 8), g.idx(18, 9)]);
  const far = { key: 'far', levels: [new Set([g.idx(2, 0), g.idx(30, 1)]), new Set()] };
  const st = { key: 'post', levels: [full, half, new Set()] };
  g.navStamp('far', far.levels[0]); g.navStamp('post', full);
  assert.equal(keepWays(g, labels0, ways, [far, st]), 1, 'one step down');
  assert.ok(g.isWalkable(19, 8) && !g.isWalkable(18, 8), 'the gap narrowed, not shut');
  assert.ok(!far.lv?.size && !g.isWalkable(30, 1), 'a stamp away from the cut keeps its margin');
  // a long stamp shutting the gap gives way only near it
  const g2 = new NavGrid(20, 10);
  g2.fillRect(0, 4, 9, 2, 'block', B.HIGH); g2.fillRect(10, 4, 10, 2, 'block', B.HIGH);
  const strip = new Set(), strip2 = new Set();
  for (let i = 0; i < 40; i++) { strip.add(g2.idx(i, 7)); if (i < 16 || i > 21) strip2.add(g2.idx(i, 7)); }
  const long = { key: 'long', levels: [strip, new Set()] };
  const l0 = walkPieces(g2);
  g2.navStamp('long', strip);
  keepWays(g2, l0, ways, [long]);
  assert.ok(g2.isWalkable(18, 7) && !g2.isWalkable(2, 7) && !g2.isWalkable(36, 7), 'opened by the gap only');
  // a deck (bridge cells) over water x ∈ [4, 16): its crossing survives a post beside the way, not one across it
  const d = new NavGrid(20, 4);
  d.fillRect(4, 0, 12, 4, 'terrain', 5); // water (T.WATER)
  d.fillRect(4, 1.5, 12, 1, 'bridge', 1);
  const pairs = [{ i: 8, j: 3 }, { i: 8, j: 4 }, { i: 31, j: 3 }, { i: 31, j: 4 }], def = { x: 10, z: 2, rot: 0, w: 12 };
  const before = deckCrossing(d, def, pairs, null);
  assert.deepEqual(before, { a: 2, b: 2, linked: true });
  assert.equal(deckCrossingKept(before, deckCrossing(d, def, pairs, new Set([d.idx(20, 3), d.idx(20, 4)]))), false, 'cut across');
  assert.equal(deckCrossingKept(before, deckCrossing(d, def, pairs, new Set([d.idx(20, 3)]))), true, 'a post beside the way');
});

test('pickups (e): the crate on the ground is walked round and taken from its edge; picked up, the way is free', async () => {
  const { World } = await import('../../src/world/world.js');
  const { createPickup } = await import('../../src/entities/interactables.js');
  const w = new World({ size: [20, 20] });
  const p = createPickup('timeBomb', 10.1, 10.1, 1);
  w.add(p);
  assert.ok(!w.grid.walkableAt(10.1, 10.1), 'its cell is nav-blocked');
  const a = p.approachFrom({ x: 6, z: 10.1 });
  assert.ok(Math.abs(a.x - (10.1 - 0.65)) < 1e-9 && Math.abs(a.z - 10.1) < 1e-9, `reached from its west edge (${a.x})`);
  const c = { inventory: new Map(), has() { return false; }, nickname: 'GB', role: 'greenberet', refreshAbilities() {} };
  p.interact?.(c);
  assert.ok(w.grid.walkableAt(10.1, 10.1), 'taken: free again');
});

test('bodies (e): a corpse on its back keeps its flung-out hands out of a building\'s foot; clear hands stay put', async () => {
  const { settleHands } = await import('../../src/world/placement.js');
  const g = new NavGrid(20, 20);
  g.fillRect(12, 0, 8, 20, 'block', B.HIGH); // a building x ∈ [12, 20)
  // facing -x (heading π): head 1.25 m behind him (+x), hands 1.45 m behind and 0.7 m out → x ≈ 12.05 at x 10.6
  const off = settleHands(g, 10.6, 10, Math.PI);
  assert.ok(off && off.moved <= 0.6 && off.x < 10.6, `slides away from the wall (${JSON.stringify(off)})`);
  assert.ok(off.x + 1.45 + 0.15 < 12, `both hands now short of the wall (${off.x})`);
  assert.equal(settleHands(g, 9, 10, Math.PI), null, 'clear already: stays');
});

test('drums (e): a standing man keeps a running arm\'s and rifle\'s reach off a fuel drum (M2 e12 × bar4)', async () => {
  const { moverShape, bodyGap } = await import('../../src/world/body-clearance.js');
  const drum = { interactKind: 'barrel', x: 0, z: 0 };
  const S = moverShape(drum);
  assert.ok(S.r >= 0.32 + 0.09, `drum disc ${S.r} m: its 0.32 m rims + the arm's swing past the 0.3 m body`);
  const w = { interactables: [drum], vehicles: [] };
  // where e12 stopped beside bar4 (0.69 m from its centre) is now inside the clearance
  assert.ok(bodyGap(w, 0.69, 0, 0, 'stand') < 0.05, 'the old stopping spot is too close');
});
