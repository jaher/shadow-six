/**
 * The trees' sun (src/art/terrain/vegetation.js; user 2026-11-10: "No trees are a single billboard. All trees are
 * detailed"): every tree material (unique and instanced: bark, leaf sprays, needles) reads the shared uniforms uSunV
 * (unit vector towards the sun, view space) and uSunI. The vegetation hangs under a group (the terrain's ground, the
 * apron's), and its update() looked for the sun in that group only: it never found it, uSunV stayed (0, 0, 0) — no
 * back-lit leaf / needle translucency, and the needles' sun-ward shadow lookup took normalize(0).
 */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { test, assert, near } from './lib.mjs';
import { vegetationSun, setVegetationSun, vegetationSunSync } from '../../src/art/terrain/vegetation.js';

/** The game's scene graph in small: the sun + target in the scene, the trees two groups down (ground → vegetation). */
function world() {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffffff, 3.2);
  sun.castShadow = true;
  sun.position.set(-30, 40, -30);
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xffffff, 0x444444, 0.3));
  const ground = new THREE.Group(), veg = new THREE.Group();
  scene.add(ground); ground.add(veg);
  // the game camera: orthographic, south of its target, 40° down
  const camera = new THREE.OrthographicCamera(-20, 20, 12, -12, 1, 600);
  camera.position.set(0, 100 * Math.sin(40 * Math.PI / 180), 100 * Math.cos(40 * Math.PI / 180));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const U = { uSunV: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: 3 } };
  return { scene, sun, ground, veg, camera, U };
}

test('vegetation sun: found from the vegetation group under the ground (the old lookup in that group found none)', () => {
  const { sun, ground, veg } = world();
  assert.equal(ground.getObjectByProperty('isDirectionalLight', true), undefined, 'the bug: the ground group holds no sun');
  assert.equal(vegetationSun(veg), sun, 'found in the scene the group hangs in');
  const R = { sun: new THREE.DirectionalLight() };
  assert.equal(vegetationSun(veg, R), R.sun, "the renderer's sun first");
  assert.equal(vegetationSun(new THREE.Group()), null, 'none: null');
});

test('vegetation sun: uSunV is the unit view-space vector towards the sun after update (non-zero), uSunI its intensity', () => {
  const { sun, veg, camera, U } = world();
  const sync = vegetationSunSync(veg, U);
  assert.ok(sync(camera), 'written');
  const v = U.uSunV.value;
  assert.ok(v.lengthSq() > 0.99 && v.lengthSq() < 1.01, `unit, non-zero (${v.toArray().map((a) => a.toFixed(3))})`);
  const want = sun.position.clone().sub(sun.target.position).normalize().transformDirection(camera.matrixWorldInverse);
  near(v.distanceTo(want), 0, 1e-6, 'view space');
  // back to world: towards the sun (up and north-west of the ground)
  const w = v.clone().transformDirection(camera.matrixWorld);
  assert.ok(w.y > 0.5 && w.x < 0 && w.z < 0, `world (${w.toArray().map((a) => a.toFixed(2))})`);
  near(U.uSunI.value, 3.2, 1e-9, 'intensity');
  // the sun moves (another mission's lighting): followed on the next update
  sun.position.set(30, 20, 30); sun.intensity = 0.35;
  sync(camera);
  const w2 = U.uSunV.value.clone().transformDirection(camera.matrixWorld);
  assert.ok(w2.x > 0 && w2.z > 0, 'follows the sun');
  near(U.uSunI.value, 0.35, 1e-9);
});

test("vegetation sun: the renderer's sunDir when it is the renderer's sun; no sun / no direction keeps the last value", () => {
  const { sun, veg, camera, U } = world();
  const R = { sun, sunDir: new THREE.Vector3(0.3, 0.7, 0.6).normalize() };
  sun.position.set(0, 1, 0); // (a sun not placed yet this frame: the renderer's direction holds)
  vegetationSunSync(veg, U, R)(camera);
  near(U.uSunV.value.clone().transformDirection(camera.matrixWorld).distanceTo(R.sunDir), 0, 1e-6, 'sunDir');
  const before = U.uSunV.value.clone();
  assert.equal(setVegetationSun(U, null, camera), false);
  sun.position.copy(sun.target.position);
  assert.equal(setVegetationSun(U, sun, camera), false, 'degenerate direction');
  near(U.uSunV.value.distanceTo(before), 0, 0, 'kept (never a zero vector)');
});

test('vegetation sun: update() syncs the shared uniforms of every tree material (unique + instanced) through it', () => {
  const src = readFileSync(new URL('../../src/art/terrain/vegetation.js', import.meta.url), 'utf8');
  assert.ok(/vegetationSunSync\(group, U, opts\.renderer\)/.test(src) && /update\(dt, camera\) \{[^}]*syncSun\(camera\)/.test(src), 'update() → syncSun(camera)');
  assert.ok(!/scene\.getObjectByProperty\('isDirectionalLight'/.test(src), 'no lookup in the vegetation parent group');
  // the instanced forest's colour materials share the set's U (makeMaterials / makeNeedleMaterials(…, U, …, { u, us }))
  assert.ok(/makeMaterials\(\{ alb: lAlb, nor: lNor \}, U, 'leaf', \{ u, us \}\)/.test(src) && /makeNeedleMaterials\(\{ alb: nAlb, nor: nNor \}, U, \{ u, us \}\)/.test(src));
});
