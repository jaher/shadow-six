/**
 * Depth-pass merging (engine/depth-merge.js): a library building's sibling primitives get one merged mesh that the sun
 * shadow map and the GTAO prepass draw instead of them. The pixels must not change: the proxy holds exactly the members'
 * raw positions / normals with the same matrix, it is a mesh only inside those passes, a member is skipped there only
 * while its group is valid, and anything an instance changes (visibility, geometry, material, shadow flag) falls back.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { addDepthMerge, inDepthPass, instancedProxy, DepthProxyMesh, installShadowDepthPass, setDepthMerge } from '../../src/engine/depth-merge.js';
import { readGlbArrayBuffer } from '../../tools/glb-io.mjs';
import { GLTFLoader } from '../../src/engine/glb-gzip.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { assignShadowVariants, isShadowVariant } from '../../src/engine/program-variants.js';

const ALL = new THREE.Frustum(); // every plane far out: anything intersects
for (const p of ALL.planes) p.set(new THREE.Vector3(1, 0, 0), 1e9);

function part(geo, mat = new THREE.MeshStandardMaterial()) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
/** A glTF-like multi-primitive node: a Group with sibling meshes (identity matrices). */
function building(n = 4) {
  const root = new THREE.Group(), node = new THREE.Group();
  node.name = 'main';
  root.add(node);
  for (let i = 0; i < n; i++) {
    const g = new THREE.BoxGeometry(1 + i, 2, 1);
    g.translate(i * 3, 1, 0);
    node.add(part(g));
  }
  return { root, node };
}
const proxyOf = (node) => node.children.find((c) => c.isDepthProxy);
/** Would three draw these in a pass of kind k? (visible, a mesh, a caster for the shadow map, then the cull test) */
const drawnIn = (k, objs) => inDepthPass(k, () => objs.map((o) => o.visible && o.isMesh && (k !== 'shadow' || o.castShadow) && o.intersectsFrustum(ALL)));
/** GTAO swaps every drawn mesh to its stock normal material (userData.aoStock) for the prepass. */
function aoSwap(objs, stock) {
  const was = objs.map((o) => o.material);
  for (const o of objs) o.material = stock;
  return () => objs.forEach((o, i) => { o.material = was[i]; });
}

test('depth merge: one proxy per group of sibling parts — their raw positions / normals concatenated, indexed, same matrix', () => {
  const { root, node } = building(4);
  // a quantised part (normalized int16 positions, int8 normals) in its own layout group, interleaved like meshopt output
  const q = new THREE.BufferGeometry();
  const ib = new THREE.InterleavedBuffer(new Int16Array([0, 0, 0, 7, 32767, 0, 0, 7, 0, 32767, 0, 7, 100, 200, 300, 7]), 4);
  q.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0, true));
  q.setAttribute('normal', new THREE.BufferAttribute(new Int8Array([0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127, 0]), 3, true));
  q.setIndex([0, 1, 2, 1, 3, 2]);
  const q2 = q.clone();
  node.add(part(q), part(q2));
  const st = addDepthMerge(root);
  assert.deepEqual(st, { groups: 2, members: 6 });
  const proxies = node.children.filter((c) => c.isDepthProxy);
  assert.equal(proxies.length, 2);
  const [pf, pq] = proxies;
  const boxes = node.children.slice(0, 4);
  const pos = pf.geometry.attributes.position;
  assert.equal(pos.count, boxes.reduce((s, m) => s + m.geometry.attributes.position.count, 0));
  let at = 0, base = 0, tri = 0;
  for (const m of boxes) {
    const g = m.geometry, a = g.attributes.position.array, nrm = g.attributes.normal.array;
    assert.deepEqual(Array.from(pos.array.subarray(at * 3, at * 3 + a.length)), Array.from(a), 'raw positions');
    assert.deepEqual(Array.from(pf.geometry.attributes.normal.array.subarray(at * 3, at * 3 + nrm.length)), Array.from(nrm), 'raw normals');
    for (let i = 0; i < g.index.count; i++) assert.equal(pf.geometry.index.array[tri + i], g.index.array[i] + base);
    at += g.attributes.position.count; base += g.attributes.position.count; tri += g.index.count;
    assert.equal(m.userData.depthGroup, pf.userData.depthGroup);
    assert.equal(m.userData.depthGeo, m.geometry.uuid);
  }
  assert.equal(pf.geometry.index.count, tri);
  // the quantised group keeps its types and vertex strides: Int16 normalized positions interleaved by 4, Int8 normals
  const qp = pq.geometry.attributes.position;
  assert.ok(qp.isInterleavedBufferAttribute && qp.data.array instanceof Int16Array && qp.data.stride === 4 && qp.normalized && qp.itemSize === 3);
  const xyz = []; for (let i = 0; i < 4; i++) xyz.push(qp.data.array[i * 4], qp.data.array[i * 4 + 1], qp.data.array[i * 4 + 2]);
  assert.deepEqual(xyz, [0, 0, 0, 32767, 0, 0, 0, 32767, 0, 100, 200, 300]);
  assert.equal(qp.count, 8);
  assert.ok(pq.geometry.attributes.normal.array instanceof Int8Array && pq.geometry.attributes.normal.normalized);
  assert.deepEqual(Array.from(pq.geometry.index.array), [0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6]);
  assert.ok(pf.matrix.equals(boxes[0].matrix) && pf.castShadow && !pf.receiveShadow && pf.userData.clip === false);
  assert.equal(pf.material.colorWrite, false, 'never writes colour, in case it is ever drawn there');
  assert.equal(addDepthMerge(root).groups, 0, 'idempotent');
});

test('depth merge: only static opaque parts with the plain depth / stock AO material merge, by shadow side and matrix', () => {
  const { root, node } = building(2);
  const t = part(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ transparent: true }));
  const cut = part(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ alphaTest: 0.5, map: new THREE.Texture() }));
  const noShadow = part(new THREE.BoxGeometry()); noShadow.castShadow = false;
  const layered = part(new THREE.BoxGeometry()); layered.renderOrder = 1;
  const custom = part(new THREE.BoxGeometry()); custom.customDepthMaterial = new THREE.MeshDepthMaterial();
  const ao = part(new THREE.BoxGeometry()); ao.userData.aoMaterial = new THREE.MeshNormalMaterial();
  const glass = part(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'kit:glass_dirty' }));
  const dbl = [0, 1].map(() => part(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })));
  const moved = part(new THREE.BoxGeometry()); moved.position.x = 5; moved.updateMatrix();
  node.add(t, cut, noShadow, layered, custom, ao, glass, ...dbl, moved);
  const st = addDepthMerge(root, { exclude: (o) => /glass/.test(o.material.name) });
  assert.deepEqual(st, { groups: 2, members: 4 }, 'the two plain FrontSide parts, the two DoubleSide ones');
  for (const o of [t, cut, noShadow, layered, custom, ao, glass, moved]) assert.equal(o.userData.depthGroup, undefined);
  const sides = node.children.filter((c) => c.isDepthProxy).map((p) => [p.material.side, p.material.shadowSide]);
  assert.deepEqual(sides.sort(), [[THREE.DoubleSide, THREE.DoubleSide], [THREE.FrontSide, THREE.BackSide]].sort());
  // a skinned / instanced part never merges
  const r2 = new THREE.Group();
  r2.add(new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 2), new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 2));
  r2.children.forEach((c) => { c.castShadow = true; });
  assert.equal(addDepthMerge(r2).groups, 0);
});

test('depth merge: the proxy is a mesh only inside a depth pass, where it replaces its members; colour passes unchanged', () => {
  const { root, node } = building(3);
  addDepthMerge(root);
  const p = proxyOf(node), members = node.children.filter((c) => !c.isDepthProxy);
  assert.equal(p.isMesh, false, 'not a mesh for the colour pass, scene walks, raycasts');
  assert.ok(members.every((m) => m.intersectsFrustum(ALL)), 'members drawn in colour');
  assert.deepEqual(drawnIn('shadow', [...members, p]), [false, false, false, true], 'shadow map: the proxy only');
  setDepthMerge(false);
  assert.deepEqual(drawnIn('shadow', [...members, p]), [true, true, true, false], 'switched off: the members, as unmerged');
  setDepthMerge(true);
  assert.equal(inDepthPass('shadow', () => p.isMesh), true);
  const stock = new THREE.MeshNormalMaterial(); stock.userData.aoStock = true;
  const undo = aoSwap([...members, p], stock);
  assert.deepEqual(drawnIn('ao', [...members, p]), [false, false, false, true], 'AO prepass: the proxy only');
  undo();
  // clones (createBuilding) keep the class and the tags, and resolve their own proxy
  const c = root.clone(true), cn = c.children[0], cp = proxyOf(cn);
  assert.ok(cp instanceof DepthProxyMesh && cp !== p && cp.geometry === p.geometry);
  assert.deepEqual(drawnIn('shadow', cn.children), [false, false, false, true]);
  const hits = [];
  new THREE.Raycaster(new THREE.Vector3(0, 1, -5), new THREE.Vector3(0, 0, 1)).intersectObject(c, true).forEach((h) => hits.push(h.object));
  assert.ok(hits.length > 0 && !hits.some((h) => h.isDepthProxy), 'raycasts hit the members, never the proxy');
});

test('depth merge: a group falls back to its members in a pass where one changed (hidden, new geometry, cut-out, no shadow, side)', () => {
  const stock = new THREE.MeshNormalMaterial(); stock.userData.aoStock = true;
  const cases = {
    hidden: (m) => { m.visible = false; },
    geometry: (m) => { m.geometry = m.geometry.clone(); },
    cutout: (m) => { m.material = new THREE.MeshStandardMaterial({ alphaTest: 0.5, map: new THREE.Texture() }); },
    noShadow: (m) => { m.castShadow = false; },
    side: (m) => { m.material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }); },
    moved: (m) => { m.position.y = 1; m.updateMatrix(); },
    removed: (m) => { m.removeFromParent(); },
  };
  for (const [name, change] of Object.entries(cases)) {
    const { root, node } = building(3);
    addDepthMerge(root);
    const p = proxyOf(node), members = node.children.filter((c) => !c.isDepthProxy);
    change(members[1]);
    const live = node.children.filter((c) => !c.isDepthProxy);
    const shadow = drawnIn('shadow', [...live, p]);
    assert.equal(shadow[shadow.length - 1], false, `${name}: proxy not drawn in the shadow map`);
    assert.ok(live.every((m, i) => shadow[i] === (m.visible && m.castShadow)), `${name}: members drawn by themselves (${shadow})`);
  }
  // AO: a member GTAO gives a cut-out / custom prepass material → that pass falls back; the stock one keeps the proxy
  const { root, node } = building(3);
  addDepthMerge(root);
  const p = proxyOf(node), members = node.children.filter((c) => !c.isDepthProxy);
  const undo = aoSwap([...members, p], stock);
  members[2].material = new THREE.MeshNormalMaterial({ alphaTest: 0.5 }); // a cut-out variant: no aoStock
  assert.deepEqual(drawnIn('ao', [...members, p]), [true, true, true, false]);
  undo();
  assert.deepEqual(drawnIn('shadow', [...members, p]), [false, false, false, true], 'the shadow pass is unaffected');
});

test('depth merge: the proxy is culled by its own bounds, which hold every member: drawn whenever a member would be', () => {
  const { root, node } = building(3); // parts at x -0.5..0.5, 2..4, 4.5..7.5
  addDepthMerge(root);
  const p = proxyOf(node), members = node.children.filter((c) => !c.isDepthProxy);
  root.updateMatrixWorld(true);
  const f = (x0, x1) => { const fr = new THREE.Frustum(); const c = new THREE.OrthographicCamera(x0, x1, 10, -10, -100, 100); c.updateMatrixWorld(); fr.setFromProjectionMatrix(c.projectionMatrix.clone().multiply(c.matrixWorldInverse)); return fr; };
  const drawn = (fr) => inDepthPass('shadow', () => [...members, p].map((o) => o.isMesh && o.intersectsFrustum(fr)));
  for (const [x0, x1] of [[-1, 12], [5, 7], [1.5, 2.5], [-0.4, 0]]) {
    const fr = f(x0, x1), any = members.some((m) => fr.intersectsObject(m)); // (the stock test, no depth-merge hook)
    assert.ok(any, `a member is in [${x0}, ${x1}]`);
    assert.deepEqual(drawn(fr), [false, false, false, true], `[${x0}, ${x1}]: the proxy draws for its members`);
  }
  assert.deepEqual(drawn(f(40, 50)), [false, false, false, false], 'none in view: nothing');
});

test('depth merge: batch proxies (createBuildingBatch) are instanced, share their members\' matrices and tags', () => {
  const { root, node } = building(2);
  addDepthMerge(root);
  const tpl = proxyOf(node);
  const group = new THREE.Group();
  const place = [0, 40, 80].map((x) => new THREE.Matrix4().makeTranslation(x, 0, -x));
  const members = node.children.filter((c) => !c.isDepthProxy).map((o) => {
    const im = new THREE.InstancedMesh(o.geometry, o.material, 3);
    place.forEach((m, k) => im.setMatrixAt(k, m));
    im.castShadow = true; im.userData.depthGroup = o.userData.depthGroup; im.userData.depthGeo = o.userData.depthGeo;
    group.add(im);
    return im;
  });
  const ip = instancedProxy(tpl, members[0]);
  group.add(ip);
  assert.ok(ip.isInstancedMesh && ip.isDepthProxy && ip.isMesh === false && ip.count === 3);
  assert.equal(ip.instanceMatrix, members[0].instanceMatrix, 'the members\' matrices, shared');
  assert.equal(ip.userData.depthGroup, tpl.userData.depthGroup);
  // bounds over every instance, computed now — not later by a cull during the one-instance warm-up frame
  members[0].count = 1;
  assert.ok(ip.boundingBox && ip.boundingBox.max.x > 80 && ip.boundingBox.min.z < -79, JSON.stringify(ip.boundingBox));
  assert.ok(ip.boundingSphere && ip.boundingSphere.radius > 55);
  members[0].count = 3;
  assert.deepEqual(drawnIn('shadow', [...members, ip]), [false, false, true]);
});

test('depth merge: proxies get their shadow-depth variant from the scan like every caster (no shared default depth material)', () => {
  const { root, node } = building(2);
  addDepthMerge(root);
  const scene = new THREE.Scene(); scene.add(root);
  assignShadowVariants(scene);
  const p = proxyOf(node);
  assert.ok(isShadowVariant(p.customDepthMaterial), 'the proxy holds a variant');
  assert.ok(node.children.filter((c) => !c.isDepthProxy).every((m) => isShadowVariant(m.customDepthMaterial)), 'members too');
  assert.deepEqual(drawnIn('shadow', node.children), [false, false, true], 'variants are plain depth: the group stays valid');
});

test('depth merge: the shadow map render is bracketed as a depth pass', () => {
  const sm = { calls: 0, render() { this.calls++; return this.seen = proxy.isMesh; } };
  const proxy = new DepthProxyMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  installShadowDepthPass({ shadowMap: sm });
  installShadowDepthPass({ shadowMap: sm }); // once
  sm.render();
  assert.equal(sm.calls, 1);
  assert.equal(sm.seen, true, 'proxies are meshes while the shadow map renders');
  assert.equal(proxy.isMesh, false);
});

test('depth merge: the M6 W ruin (house_bombed_log_w LOD0) — every opaque part but the pane glass in one depth mesh, bit-exact', async () => {
  const L = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  L.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));
  const gltf = await new Promise((res, rej) => L.parse(readGlbArrayBuffer(new URL('../../assets/models/buildings/norway/house_bombed_log_w.glb', import.meta.url)), '', res, rej));
  const sc = gltf.scene;
  sc.traverse((o) => { if (o.isMesh) o.castShadow = !/decals/.test(o.parent?.name + o.parent?.parent?.name); });
  const glass = (o) => /glass/i.test(o.material?.name || '');
  const st = addDepthMerge(sc, { exclude: glass });
  const main = sc.getObjectByName('main');
  const parts = [];
  main.traverse((o) => { if (o.isMesh && !glass(o)) parts.push(o); });
  assert.equal(st.groups, 1);
  assert.equal(st.members, parts.length);
  assert.ok(parts.length >= 20, `${parts.length} parts`);
  const p = parts[0].parent.children.find((c) => c.isDepthProxy);
  const tris = parts.reduce((s, o) => s + (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, 0);
  assert.equal(p.geometry.index.count / 3, tris, 'same triangle count');
  // world positions of every member vertex, as the shader sees them (dequantised by the same matrix), are the proxy's
  sc.updateMatrixWorld(true);
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  let at = 0;
  for (const o of parts) {
    const a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i += 7) {
      v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
      w.fromBufferAttribute(p.geometry.attributes.position, at + i).applyMatrix4(p.matrixWorld);
      assert.ok(v.equals(w), `${o.name} vertex ${i}`);
    }
    at += a.count;
  }
});
