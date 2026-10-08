/**
 * Snow drifts are walked over (user 2026-10-07, "Yes reopen it": M1's barracks alley was closed by the drifts the snow
 * variants pile against their walls). world/placement-visual.js SNOW_WADE: snow lying lower than 0.6 m is no
 * occupancy for the nav analyses that pass `wade` (visual nav stamps, standing visuals, solid-prop bodies); the wall
 * under it and deeper snow still count, and the drift stays a surface the feet stand on (lowSurfaces).
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { planCells, planHull, standingCells, lowSurfaces, visualSignature, SNOW_WADE, isSnowMaterial, snowTris } from '../../src/world/placement-visual.js';

/** A 0.3 m log wall along x (z 0 … 0.3, 2.5 m tall) with a drift on its south face: 0 at z 2.3 → `top` m at the wall. */
function wallWithDrift(top = 0.7, mat = 'kit:snow') {
  const root = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 2.5, 0.3, 4, 5, 1), new THREE.MeshBasicMaterial({ name: 'kit:log_hewn' })); // (vertices every 0.5 m up)
  wall.position.set(0, 1.25, 0.15); root.add(wall);
  // the drift: a ramp (two triangles each across x), from the foot of the wall (z 0.3, y top) down to z 2.3, y 0
  const g = new THREE.BufferGeometry();
  const P = [-3, top, 0.3, 3, top, 0.3, 3, 0, 2.3, -3, 0, 2.3];
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex([0, 2, 1, 0, 3, 2]); // upward facing
  const drift = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ name: mat }));
  drift.name = 'mesh_0_19'; root.add(drift);
  root.position.set(10, 0, 10);
  root.updateMatrixWorld(true);
  return root;
}
const reach = (rects, z0 = 10) => Math.max(...rects.map((r) => Math.max(r[0][1], r[2][1]))) - z0; // how far south (m) the occupancy goes
const covers = (rects, x, z) => rects.some((r) => x >= Math.min(r[0][0], r[2][0]) && x <= Math.max(r[0][0], r[2][0]) && z >= Math.min(r[0][1], r[2][1]) && z <= Math.max(r[0][1], r[2][1]));

test('snow wade: the library kits\' snow materials are snow; a mixed mesh tests its groups', () => {
  assert.equal(SNOW_WADE, 0.6);
  for (const n of ['kit:snow', 'kit:snow~cce0f7', 'kit:snow_soft', 'dressing:snow']) assert.ok(isSnowMaterial({ name: n }), n);
  for (const n of ['kit:snowplough', 'kit:log_hewn', 'snow', 'kit:turf_grass']) assert.ok(!isSnowMaterial({ name: n }), n);
  const g = new THREE.BoxGeometry(1, 1, 1); // 6 groups of 6 indices
  const m = new THREE.Mesh(g, [0, 1, 2, 3, 4, 5].map((k) => new THREE.MeshBasicMaterial({ name: k === 2 ? 'kit:snow' : 'kit:granite' })));
  const s = snowTris(m);
  assert.ok(s && s(12) && s(15) && !s(0) && !s(18), 'only the triangles of the snow group');
  assert.equal(snowTris(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ name: 'kit:granite' }))), null);
});

test('snow wade: a drift against a wall is no body occupancy below 0.6 m; the wall and deeper snow still are', () => {
  const root = wallWithDrift(0.7);
  const band = { minY: 0.3, maxY: 1.8, cell: 0.25, close: 0 }; // the visual nav stamps' body band (map-builder stampVisualNav)
  const full = planCells(root, band), waded = planCells(root, { ...band, wade: SNOW_WADE });
  // the drift is above 0.3 m for its first (0.7-0.3)/0.7 × 2 m = 1.14 m out from the wall face (z 0.3 → 1.44)
  assert.ok(reach(full) > 1.3, `without wading the drift's body part reaches ${reach(full).toFixed(2)} m out`);
  // waded: only the snow above 0.6 m (0.29 m out from the face) and the wall itself
  assert.ok(reach(waded) < 0.3 + 0.29 + 0.26, `waded: the occupancy stops at the deep snow by the wall (${reach(waded).toFixed(2)} m)`);
  assert.ok(covers(waded, 10, 10.3), 'the wall itself still blocks (its south face)');
  // a low drift (0.45 m at the wall) is no occupancy at all; a log of the same shape is
  const low = wallWithDrift(0.45);
  assert.ok(reach(planCells(low, { ...band, wade: SNOW_WADE })) <= 0.3 + 0.26, 'a 0.45 m drift: only the wall');
  const logRamp = wallWithDrift(0.45, 'kit:granite');
  assert.ok(reach(planCells(logRamp, { ...band, wade: SNOW_WADE })) > 0.5, 'the same ramp in stone still blocks (only snow is waded)');
  // the low parts' band (0.12–0.3 m: a kerb's face) has no snow left in it
  const lowRects = planCells(low, { minY: 0.12, maxY: 0.3, cell: 0.25, close: 0, wade: SNOW_WADE }) || [];
  assert.ok(!lowRects.length || reach(lowRects) <= 0.3 + 0.26, 'no low-part stamp from the drift');
});

test('snow wade: standing visuals and solid-prop hulls leave the drift out; the feet still stand on it', () => {
  const root = wallWithDrift(0.45);
  const ground = () => 0;
  const st = standingCells(root, ground, { lo: 0.15, hi: 1.2, cell: 0.25, wade: SNOW_WADE });
  const st0 = standingCells(root, ground, { lo: 0.15, hi: 1.2, cell: 0.25 });
  const zMax = (set) => Math.max(...[...set].map((k) => (+k.split(',')[1] + 1) * 0.25)) - 10;
  assert.ok(zMax(st0) > 1, `without wading the drift stands up to ${zMax(st0).toFixed(2)} m out`);
  assert.ok(zMax(st) <= 0.3 + 0.25, `waded: only the wall stands (${zMax(st).toFixed(2)} m)`);
  const hull = planHull(root, { minY: 0.15, maxY: 1.6, wade: SNOW_WADE });
  assert.ok(Math.max(...hull.map((p) => p[1])) - 10 <= 0.3 + 1e-6, 'the solid hull is the wall, not the drift round its foot');
  // feet: the drift's top is still a walking surface (0.45 m at the wall, 0 at its toe)
  const surf = lowSurfaces(root, { maxY: 0.8, cell: 0.2 });
  const at = (x, z) => surf.get(`${Math.floor(x / 0.2)},${Math.floor(z / 0.2)}`);
  assert.ok(at(10, 10.5) > 0.3 && at(10, 11.5) < at(10, 10.5), 'feet ride the drift');
});

test('snow wade: the session memo tells a snow mesh from the same geometry in another material', () => {
  const a = wallWithDrift(0.45), b = wallWithDrift(0.45, 'kit:granite');
  b.children[1].geometry = a.children[1].geometry; b.children[0].geometry = a.children[0].geometry;
  assert.notEqual(visualSignature(a), visualSignature(b));
  const band = { minY: 0.3, maxY: 1.8, cell: 0.25, close: 0, wade: SNOW_WADE };
  assert.ok(reach(planCells(b, band)) > reach(planCells(a, band)), 'cached separately');
});

test('snow wade: the clip audit wades through the drift too (a knee in its shallow part is no clipping), not the deep snow or the wall', async () => {
  const { partsOf } = await import('../../src/debug/clip-audit.js');
  const { measurePair } = await import('../../src/debug/clip-geom.js');
  const root = wallWithDrift(0.7);
  const item = (parts) => ({ parts });
  // a 0.2 m "knee" cube sunk in the drift 1.5 m out (snow top there 0.7 × 0.8 / 2 = 0.28 m) and one in the deep snow
  const knee = (z, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial()); m.position.set(10, y, z); m.updateMatrixWorld(true); return item(partsOf(m)); };
  const all = item(partsOf(root)), waded = item(partsOf(root, { wade: SNOW_WADE }));
  assert.ok(measurePair(knee(11.5, 0.2), all), 'without wading the knee clips the drift');
  assert.equal(measurePair(knee(11.5, 0.2), waded), null, 'waded: a knee in shallow drift snow is no contact');
  assert.ok(measurePair(knee(10.45, 0.62), waded), 'the deep snow at the wall foot (above 0.6 m) still is');
  assert.ok(measurePair(knee(10.3, 1.2), waded), 'and the wall');
});
