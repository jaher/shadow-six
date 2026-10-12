/**
 * Render efficiency infrastructure (perf/render-efficiency): spatial chunking of big static meshes
 * (engine/chunking.js), per-variant override materials (engine/program-variants.js) and sun shadow caster culling
 * by shadow reach (engine/shadow-cull.js). The pixels must not change: chunks draw exactly the original triangles,
 * once, with the original material; a caster is dropped only when its shadow cannot reach a receiving view.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { chunkMesh, unchunkMesh, chunkLargeMeshes, chunkable, meshTriangles } from '../../src/engine/chunking.js';
import { variantKey, VariantCache, assignShadowVariants, checkShadowVariants } from '../../src/engine/program-variants.js';
import { ShadowReachCull } from '../../src/engine/shadow-cull.js';

function plane(w = 100, d = 80, seg = 2) {
  const g = new THREE.PlaneGeometry(w, d, w * seg, d * seg);
  g.rotateX(-Math.PI / 2);
  g.translate(w / 2, 0, d / 2);
  return g;
}

const triSet = (geo, start = 0, count = geo.index.count) => {
  const s = [], a = geo.index.array;
  for (let i = start; i < start + count; i += 3) s.push([a[i], a[i + 1], a[i + 2]].join(','));
  return s;
};

test('chunkMesh: rows of cells cover every triangle once, cells hold their triangles; proxy not drawn, raycasts once', () => {
  const geo = plane();
  const before = triSet(geo).sort();
  const mat = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrainT';
  mesh.receiveShadow = true;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const rows = chunkMesh(mesh, { cell: 24, pad: 1 });
  assert.ok(rows && rows.length === 4, `4 rows of 24 m (got ${rows?.length})`);
  assert.equal(mesh.isMesh, false, 'the proxy is not drawn');
  assert.equal(mesh.children.length, rows.length);
  const drawn = [];
  const pos = geo.attributes.position, v = new THREE.Vector3();
  let cells = 0;
  for (const r of rows) {
    assert.equal(r.material, mat);
    assert.equal(r.receiveShadow, true);
    assert.equal(r.geometry.index, geo.index, 'shared index');
    assert.equal(r.geometry.attributes.position, pos, 'shared positions');
    const { start, count } = r.geometry.drawRange;
    drawn.push(...triSet(geo, start, count));
    assert.equal(r.__row.cells.length, 5, '5 cells of 24 m per row');
    for (const c of r.__row.cells) {
      cells++;
      for (const t of triSet(geo, c.start, c.count)) for (const k of t.split(',')) assert.ok(c.box.containsPoint(v.fromBufferAttribute(pos, +k)), 'vertex inside its cell box');
    }
  }
  assert.equal(cells, 20);
  assert.deepEqual(drawn.sort(), before, 'same triangles, each once');
  assert.deepEqual(triSet(geo).sort(), before, 'the proxy geometry keeps every triangle');
  // forwarding: later writes on the proxy reach the rows
  const m2 = new THREE.MeshStandardMaterial();
  mesh.material = m2; mesh.castShadow = true;
  assert.ok(rows.every((c) => c.material === m2 && c.castShadow));
  // raycast through the proxy (the rows never answer): one hit, reported by the proxy
  scene.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(new THREE.Vector3(30.11, 10, 30.17), new THREE.Vector3(0, -1, 0)); // inside one triangle
  const hits = rc.intersectObject(scene, true);
  assert.equal(hits.length, 1, 'one hit for one surface: ' + hits.map((h) => h.object.name + '@' + h.distance.toFixed(2)).join(' '));
  assert.equal(hits[0].object, mesh);
  // a geometry swap draws the new geometry whole
  const other = plane(10, 10, 1);
  mesh.geometry = other;
  assert.equal(mesh.isMesh, true);
  assert.equal(mesh.children.length, 0);
  assert.equal(mesh.geometry, other);
  assert.equal(mesh.material, m2);
});

test('chunking: transparent, unculled, skinned, instanced or small meshes are left whole', () => {
  const t = new THREE.Mesh(plane(), new THREE.MeshBasicMaterial({ transparent: true }));
  assert.equal(chunkable(t), false);
  const u = new THREE.Mesh(plane(), new THREE.MeshBasicMaterial());
  u.frustumCulled = false;
  assert.equal(chunkable(u), false);
  const im = new THREE.InstancedMesh(plane(), new THREE.MeshBasicMaterial(), 4);
  assert.equal(chunkable(im), false);
  const root = new THREE.Group();
  const small = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 30, 30, 30), new THREE.MeshBasicMaterial());
  const big = new THREE.Mesh(plane(200, 200, 4), new THREE.MeshBasicMaterial());
  root.add(small, big);
  const st = chunkLargeMeshes(root, { cell: 24, maxCell: 24, minTris: 20000 });
  assert.equal(st.meshes, 1);
  assert.equal(small.isMesh, true);
  assert.equal(big.isMesh, false);
  assert.equal(meshTriangles(big), 200 * 4 * 200 * 4 * 2);
  assert.equal(st.chunks, 9, '200 m in 24 m rows (the last row partial)');
  assert.ok(unchunkMesh(big) && big.isMesh && big.children.length === 0);
});

test('rows: culled by their box, then cut to the span of their cells in that camera', () => {
  const mesh = new THREE.Mesh(plane(96, 96, 1), new THREE.MeshBasicMaterial());
  const rows = chunkMesh(mesh, { cell: 24 });
  const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 500);
  cam.position.set(30, 100, 30); cam.up.set(0, 0, -1); cam.lookAt(30, 0, 30); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  mesh.updateMatrixWorld(true);
  const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const seen = rows.filter((r) => r.intersectsFrustum(f));
  assert.ok(seen.length >= 1 && seen.length <= 3, `a 20 m view sees 1–3 rows (${seen.length})`);
  for (const r of seen) {
    r.onBeforeRender(null, null, cam, r.geometry, r.material, null);
    const { start, count } = r.geometry.drawRange, cells = r.__row.cells;
    const inSpan = cells.filter((c) => c.start >= start && c.start + c.count <= start + count);
    assert.ok(count > 0 && inSpan.length >= 1 && inSpan.length <= 2, `the 20 m view spans 1–2 of the row's 4 cells (${inSpan.length})`);
  }
});

test('program variants: one material per object kind, the base for plain meshes, shader hooks kept', () => {
  const g = new THREE.BoxGeometry();
  const m = new THREE.MeshDepthMaterial();
  m.onBeforeCompile = () => {};
  m.customProgramCacheKey = () => 'k';
  const plain = new THREE.Mesh(g, m), inst = new THREE.InstancedMesh(g, m, 2), skinned = new THREE.SkinnedMesh(g, m);
  assert.equal(variantKey(plain), '');
  assert.equal(variantKey(inst), 'i');
  assert.equal(variantKey(skinned), 's');
  const vc = new VariantCache();
  assert.equal(vc.get(m, ''), m);
  const a = vc.get(m, 'i'), b = vc.get(m, 'i');
  assert.ok(a !== m && a === b, 'one stable clone per key');
  assert.equal(a.onBeforeCompile, m.onBeforeCompile);
  assert.equal(a.customProgramCacheKey(), 'k');
  // shadow casters: instanced get their own depth material; alpha-tested or custom ones are left to three / the owner
  const scene = new THREE.Scene();
  const cast = (o) => { o.castShadow = true; scene.add(o); return o; };
  const i1 = cast(new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial(), 2));
  const i2 = cast(new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ map: new THREE.Texture(), alphaTest: 0.5 }), 2));
  const own = new THREE.MeshDepthMaterial();
  const i3 = cast(new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial(), 2)); i3.customDepthMaterial = own;
  const s1 = cast(new THREE.Mesh(g, new THREE.MeshStandardMaterial()));
  assignShadowVariants(scene);
  assert.ok(i1.customDepthMaterial?.isMeshDepthMaterial, 'instanced: variant depth material');
  assert.equal(i2.customDepthMaterial, undefined, 'alpha-tested: three clones its own');
  assert.equal(i3.customDepthMaterial, own, "the owner's material is kept");
  assert.equal(s1.customDepthMaterial, undefined, 'plain mesh: three default');
  i1.material.alphaTest = 0.5; i1.material.map = new THREE.Texture();
  checkShadowVariants();
  assert.equal(i1.customDepthMaterial, undefined, 'turned alpha-tested: variant withdrawn the same frame');
});

test('shadow reach: a caster is kept when its shadow can land in the view, dropped otherwise', () => {
  const light = new THREE.DirectionalLight();
  const cull = new ShadowReachCull(light);
  // camera looking straight down at (0, 0, 0), 20 m square view
  const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 500);
  cam.position.set(0, 100, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const sun = new THREE.Vector3(-1, 1, 0).normalize(); // sun in the west, 45°: shadows fall east (+x)
  cull.pad = 0;
  cull.setViews([cam], sun);
  assert.equal(cull.enabled, true);
  const box = (x, z, h) => new THREE.Box3(new THREE.Vector3(x - 1, 0, z - 1), new THREE.Vector3(x + 1, h, z + 1));
  assert.equal(cull._reachBox(box(0, 0, 2)), true, 'in view');
  assert.equal(cull._reachBox(box(-20, 0, 15)), true, 'tall tower west of the view: its shadow reaches in');
  assert.equal(cull._reachBox(box(-20, 0, 2)), false, 'low hut west of the view: shadow 2 m long');
  assert.equal(cull._reachBox(box(20, 0, 30)), false, 'east of the view: shadows fall away from it');
  assert.equal(cull._reachBox(box(0, 30, 30)), false, 'north of the view');
  // through the shadow frustum override, only while enabled
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  mesh.position.set(-20, 1, 0); mesh.updateMatrixWorld();
  const f = light.shadow.getFrustum();
  f.planes.forEach((p) => p.set(new THREE.Vector3(1, 0, 0), 1e6)); // shadow frustum: everything inside
  assert.equal(f.intersectsObject(mesh), false, 'culled by reach');
  cull.enabled = false;
  assert.equal(f.intersectsObject(mesh), true, 'stock test when disabled');
});
