/**
 * Z-fighting detector core (tools/art/zfight-core.mjs, CLI tools/art/zfight.mjs). User: "Make sure there is no
 * z-fighting in the geometry". Tiny synthetic scenes with negative controls:
 *   two coplanar overlapping quads → flagged (a); the same quads a resolvable distance apart → not flagged;
 *   a ground disc flush on a sloped terrain patch → flagged (c); the same with polygonOffset, with polygonOffset +
 *   depthWrite:false + renderOrder, or lifted → not flagged; depthWrite:false + renderOrder alone still fights the
 *   terrain (the decal is depth-TESTED against it) → flagged; doubled faces in one geometry → flagged (b);
 *   two coplanar ground layers → flagged (d), the same pair drawn depthWrite:false in renderOrder → not flagged;
 *   the image rules: a speckle cluster stays, a one-pixel intersection line goes.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import {
  depthModel, collectSurfaces, gatherTriangles, buildBVH, coplanarScan, coplanarFindings, terrainHeight, terrainScan,
  terrainFindings, makeVisibility, materialState, canFight, pairBand, flickerClusters, unexplainedInto, matchAllow, namesOf,
} from '../../tools/art/zfight-core.mjs';

// the game camera (engine/camera.js): ortho, near 1, far 700, 24-bit depth, yaw 15 / pitch 40, zoom 1 and 2
const model = () => depthModel({ near: 1, far: 700, depthFormat: 'd24', zMax: 300, zooms: [1, 2], yaws: [15, 0, 45] });

function quad(w, d, mat, { x = 0, y = 0, z = 0, flipDiag = false, rot = 0, name = 'quad' } = {}) {
  const g = new THREE.PlaneGeometry(w, d, 1, 1).rotateX(-Math.PI / 2);
  if (flipDiag) g.setIndex([0, 2, 3, 0, 3, 1]); // the other diagonal: different triangles, same plane
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z); m.rotation.y = rot; m.name = name;
  return m;
}

/** Run the geometric kinds a / b / d on a scene: findings list. */
function scanScene(scene) {
  const M = model();
  const recs = collectSurfaces(scene);
  const surf = recs.filter((r) => r.cls === 'surface');
  const T = gatherTriangles(surf);
  const B = buildBVH(T);
  const terr = recs.filter((r) => r.cls === 'terrain');
  let TB = null, TT = null;
  if (terr.length) { TT = gatherTriangles(terr); TB = buildBVH(TT); }
  const vis = makeVisibility(B, T, TB, M);
  const raw = coplanarScan(T, B, M, { minPx: 0.05 });
  const out = coplanarFindings(T, raw, M, vis).filter((f) => f.visible && f.px >= 1);
  if (TB) {
    const H = terrainHeight(TB);
    // (d: a coplanar pair lying on the terrain)
    for (const f of out) { const h = H(f.point.x, f.point.z); if (h != null && Math.abs(f.point.y - h) < 0.1) f.kind = 'd'; }
    const samples = terrainScan(T, H, TT.mats[0], M, {});
    out.push(...terrainFindings(T, samples, M, vis).filter((f) => f.visible && f.px >= 1));
  }
  return out;
}

/** A sloped terrain patch (named like the game's terrain mesh) and its height function. */
function slopedTerrain() {
  const g = new THREE.PlaneGeometry(20, 20, 20, 20).rotateX(-Math.PI / 2);
  const P = g.attributes.position;
  const hy = (x, z) => 0.12 * x + 0.05 * z + 2;
  for (let i = 0; i < P.count; i++) P.setY(i, hy(P.getX(i), P.getZ(i)));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: 'terrain' }));
  m.name = 'terrainB';
  return { mesh: m, hy };
}

/** A disc draped on the terrain at its own vertices (its triangles are not the terrain's). */
function disc(hy, mat, { r = 1.5, x = 1.3, z = -0.7, lift = 0 } = {}) {
  const g = new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) P.setY(i, hy(P.getX(i) + x, P.getZ(i) + z) + lift);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, 0, z); m.name = 'threshing_floor';
  return m;
}

const std = (name, o = {}) => new THREE.MeshStandardMaterial({ name, ...o });

test('depth model: game camera numbers (ortho 1–700 m, 24-bit)', () => {
  const M = model();
  assert.ok(Math.abs(M.qDepth - 699 / 2 ** 24) < 1e-12, 'one 24-bit step over 699 m');
  const g = [0, 1, 0], f = M.frames[0];
  const e1 = M.eps(g, f, M.zooms[0]), e2 = M.eps(g, f, M.zooms[1]);
  assert.ok(e1 > 5e-5 && e1 < 2e-3, `ground noise at zoom 1 in a sane range: ${e1}`);
  assert.ok(e2 < e1, 'closer zoom: smaller depth slope per pixel, less noise');
  // polygonOffset -1/-2 on the ground pulls ~1 slope-pixel: centimetres at zoom 1
  const pull = M.pull({ po: [-1, -2] }, M.slope(g, f, M.zooms[0]));
  assert.ok(pull > 0.02 && pull < 0.04, `pull ${pull}`);
});

test('draw order: depthWrite:false drawn first never fights; transparent after opaque', () => {
  const op = materialState(std('o')), dec = materialState(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
  assert.equal(canFight(op, dec), true, 'a decal drawn after an opaque surface is depth-tested against it');
  const d1 = { ...dec, ro: 1 }, d2 = { ...dec, ro: 2 };
  assert.equal(canFight(d1, d2), false, 'two depthWrite:false layers in renderOrder: the later one always draws over');
  const o1 = { ...op, ro: 0 }, o2 = { ...materialState(std('p')), dw: false, tr: false, ro: -1 };
  assert.equal(canFight(o1, o2), false, 'drawn first without writing depth');
});

test('a: two coplanar overlapping quads of two meshes → flagged', () => {
  const s = new THREE.Scene();
  s.add(quad(4, 3, std('roof_a'), { x: 0, y: 3, z: 0, name: 'slab_a' }));
  s.add(quad(4, 3, std('roof_b'), { x: 1.5, y: 3, z: 0.5, flipDiag: true, name: 'slab_b' }));
  const f = scanScene(s);
  assert.equal(f.length, 1, JSON.stringify(f));
  assert.equal(f[0].kind, 'a');
  assert.ok(f[0].area > 4 && f[0].px > 1000, `overlap ${f[0].area} m², ${f[0].px} px²`);
  assert.ok([f[0].a.item, f[0].b.item].sort().join() === 'slab_a,slab_b', 'names both meshes');
});

test('a (negative): the same quads 5 mm apart, and 1.5 mm apart → not flagged', () => {
  for (const dy of [0.005, 0.0015]) {
    const s = new THREE.Scene();
    s.add(quad(4, 3, std('roof_a'), { y: 3, name: 'slab_a' }));
    s.add(quad(4, 3, std('roof_b'), { x: 1.5, y: 3 + dy, z: 0.5, flipDiag: true, name: 'slab_b' }));
    const f = scanScene(s);
    assert.equal(f.length, 0, `${dy} m apart: ${JSON.stringify(f)}`);
  }
});

test('a: a crossing at 0.05° fights in a band along the line; at 10° it is only an edge', () => {
  for (const [deg, want] of [[0.05, 1], [10, 0]]) {
    const s = new THREE.Scene();
    s.add(quad(6, 6, std('a'), { y: 1, name: 'floor' }));
    const q = quad(6, 6, std('b'), { y: 1, name: 'tilted' });
    q.rotation.z = (deg * Math.PI) / 180;
    s.add(q);
    const f = scanScene(s);
    assert.equal(f.length, want, `${deg}°: ${JSON.stringify(f.map((x) => [x.kind, x.px]))}`);
  }
});

test('a: hidden under another slab (not seen from the camera) → not flagged', () => {
  const s = new THREE.Scene();
  s.add(quad(2, 2, std('a'), { y: 1, name: 'lower_a' }));
  s.add(quad(2, 2, std('b'), { y: 1, x: 0.4, flipDiag: true, name: 'lower_b' }));
  const lid = new THREE.Mesh(new THREE.BoxGeometry(60, 0.2, 60), std('lid')); lid.position.y = 1.5; lid.name = 'lid';
  s.add(lid);
  assert.equal(scanScene(s).length, 0);
});

test('b: doubled faces in one geometry → flagged', () => {
  const a = new THREE.PlaneGeometry(2, 2, 1, 1).rotateX(-Math.PI / 2).toNonIndexed();
  const b = new THREE.PlaneGeometry(2, 2, 1, 1).rotateX(-Math.PI / 2);
  b.setIndex([0, 2, 3, 0, 3, 1]);
  const b2 = b.toNonIndexed();
  const P = new Float32Array([...a.attributes.position.array, ...b2.attributes.position.array]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  const m = new THREE.Mesh(g, std('plaster')); m.name = 'kit_merged'; m.position.y = 0.4;
  const s = new THREE.Scene(); s.add(m);
  const f = scanScene(s);
  assert.equal(f.length, 1, JSON.stringify(f));
  assert.equal(f[0].kind, 'b');
  assert.equal(f[0].a.item, 'kit_merged');
});

test('c: a disc flush on a sloped terrain patch → flagged', () => {
  const { mesh, hy } = slopedTerrain();
  const s = new THREE.Scene(); s.add(mesh); s.add(disc(hy, std('floor_stone')));
  const f = scanScene(s);
  assert.equal(f.length, 1, JSON.stringify(f));
  assert.equal(f[0].kind, 'c');
  assert.ok(f[0].px > 1000, `${f[0].px} px²`);
  assert.ok(f[0].fix.liftMm > 0 && f[0].fix.polygonOffsetFactor <= -1, JSON.stringify(f[0].fix));
});

test('c (negative): with polygonOffset, polygonOffset + depthWrite:false + renderOrder, or a 3 cm lift → not flagged', () => {
  const { hy } = slopedTerrain();
  const cases = {
    polygonOffset: () => disc(hy, std('floor', { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 })),
    'polygonOffset+depthWrite:false+renderOrder': () => {
      const d = disc(hy, new THREE.MeshStandardMaterial({ name: 'decal', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
      d.renderOrder = 1;
      return d;
    },
    lift: () => disc(hy, std('floor'), { lift: 0.03 }),
  };
  for (const [k, mk] of Object.entries(cases)) {
    const s = new THREE.Scene(); s.add(slopedTerrain().mesh); s.add(mk());
    const f = scanScene(s);
    assert.equal(f.length, 0, `${k}: ${JSON.stringify(f)}`);
  }
});

test('c: depthWrite:false + renderOrder alone does not resolve a decal flush on the terrain → flagged', () => {
  const { mesh, hy } = slopedTerrain();
  const d = disc(hy, new THREE.MeshStandardMaterial({ name: 'decal', transparent: true, depthWrite: false })); d.renderOrder = 1;
  const s = new THREE.Scene(); s.add(mesh); s.add(d);
  const f = scanScene(s);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'c');
});

test('d: two coplanar ground layers → flagged; drawn depthWrite:false in renderOrder → not flagged', () => {
  const { mesh, hy } = slopedTerrain();
  const mk = (mat, x, ro) => { const d = disc(hy, mat, { x, lift: 0.04 }); d.renderOrder = ro; d.name = `patch_${x}`; return d; };
  const s = new THREE.Scene(); s.add(mesh); s.add(mk(std('dirt'), 0, 0)); s.add(mk(std('gravel'), 1.2, 0));
  const f = scanScene(s);
  assert.equal(f.length, 1, JSON.stringify(f));
  assert.equal(f[0].kind, 'd');
  const dec = (n) => new THREE.MeshStandardMaterial({ name: n, transparent: true, depthWrite: false });
  const s2 = new THREE.Scene(); const t2 = slopedTerrain().mesh; s2.add(t2); s2.add(mk(dec('dirt'), 0, 1)); s2.add(mk(dec('gravel'), 1.2, 2));
  assert.equal(scanScene(s2).length, 0);
});

test('pairBand: exact coplanar overlap area and a polygonOffset that resolves it', () => {
  const M = model();
  const t1 = [0, 0, 0, 1, 0, 0, 0, 0, -1], t2 = [0, 0, 0, 1, 0, 0, 0, 0, -1];
  const n = [0, 1, 0];
  const S = materialState(std('a'));
  const r = pairBand(t1, t2, n, S, S, M);
  assert.ok(r && Math.abs(r.area - 0.5) < 1e-9, 'whole triangle fights');
  const P = materialState(std('b', { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  assert.equal(pairBand(t1, t2, n, S, P, M), null, 'factor -1 pulls the second one clear at every zoom/yaw');
});

test('image rules: a speckle cluster survives the density filter, a one-pixel line does not', () => {
  const w = 64, h = 48, m = new Uint8Array(w * h);
  for (let x = 2; x < 60; x++) m[10 * w + x] = 1; // an intersection line
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 25; y < 40; y++) for (let x = 20; x < 40; x++) if (rnd() < 0.4) m[y * w + x] = 1; // speckle
  const cl = flickerClusters(m, w, h, { r: 3, min: 8, minN: 6 });
  assert.equal(cl.length, 1, JSON.stringify(cl.map((c) => [c.n, c.cx, c.cy])));
  assert.ok(cl[0].cy > 24 && cl[0].cy < 40);
});

test('image rules: a sub-pixel shift of an edge is explained; a flat area flipping colour is not', () => {
  const w = 16, h = 8, base = new Uint8Array(w * h * 3), jit = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = x < 8 ? 40 : 200; for (let c = 0; c < 3; c++) { base[(y * w + x) * 3 + c] = v; jit[(y * w + x) * 3 + c] = x === 8 ? 120 : v; } }
  const m1 = new Uint8Array(w * h);
  assert.equal(unexplainedInto(base, jit, w, h, 8, m1), 0, 'edge moved by half a pixel');
  jit[(4 * w + 3) * 3] = 200; jit[(4 * w + 3) * 3 + 1] = 200;
  const m2 = new Uint8Array(w * h);
  assert.equal(unexplainedInto(base, jit, w, h, 8, m2), 1, 'a dark pixel turning light in a flat dark area');
});

test('allow-list: by item / material with wildcards, near a point', () => {
  const f = { kind: 'c', a: { id: 'props/x', item: 'prop:hut:h1', mesh: 'floor', mat: 'kit:stone' }, b: { id: 'terrain', item: 'terrain' }, point: { x: 10, y: 0, z: 5 } };
  assert.ok(matchAllow([{ mission: 'e01', a: 'prop:hut:*', b: 'terrain', reason: 'r' }], 'e01', f));
  assert.equal(matchAllow([{ mission: 'e01', a: 'prop:hut:*', b: 'terrain' }], 'e01', f), null, 'no reason, no match');
  assert.equal(matchAllow([{ a: 'kit:stone', near: [40, 40], reason: 'r' }], 'e01', f), null, 'elsewhere');
  assert.ok(matchAllow([{ a: 'kit:stone', near: [11, 6], reason: 'r' }], 'e01', f));
});

test('names: the placed item, its named part and the mesh from a scene path', () => {
  const n = namesOf('props/prop:house:st_admin/fit/(-)/building:house_timber_c_snow:st_admin/lod0/main/(-)/mesh_0_2');
  assert.equal(n.item, 'prop:house:st_admin');
  assert.equal(n.part, 'building:house_timber_c_snow:st_admin');
  assert.equal(n.mesh, 'mesh_0_2');
  assert.equal(namesOf('terrain:ground/terrainB/terrainB:chunk').item, 'terrainB');
});
