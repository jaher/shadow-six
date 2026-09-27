/** Art integration 2 review fixes: real-world building scale, procedural dressing for non-library props. */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, fitScale } from '../../src/art/building-props.js';
import { buildProp } from '../../src/art/props.js';
import { boulderGeometry, buildCliff, consolidate, seedOf } from '../../src/art/dressing.js';

const manifest = JSON.parse(readFileSync(new URL('../../assets/models/buildings/manifest.json', import.meta.url)));
const withLib = async (fn) => { await useManifest(manifest, 'm99'); try { return await fn(); } finally { await useManifest(null); } };
const meshes = (o) => { const out = []; o.traverse((c) => { if (c.isMesh) out.push(c); }); return out; };

test('fitScale: near-uniform plan scale, doors never shrink under 1.9 m (or native), height follows the plan', () => {
  // an 8 × 6 footprint on a 12 × 6 barracks used to squeeze it to 0.67 × 1 (doors 1.7 m)
  const a = fitScale(8 / 12, 1, 2.1);
  assert.ok(Math.max(a.sx, a.sz) / Math.min(a.sx, a.sz) <= 1.26, JSON.stringify(a));
  assert.ok(2.1 * a.sy >= 1.9 - 1e-9, 'door ≥ 1.9 m');
  // a 5 × 4 bunker on the 8.8 × 6.8 asset: clamped at 0.72 (visual overhangs a little rather than 1.1 m doors)
  const b = fitScale(5 / 8.8, 4 / 6.8, 1.95);
  assert.ok(b.sx >= 0.72 && b.sz >= 0.72 && 1.95 * b.sy >= 1.85, JSON.stringify(b));
  // low native doors (log cabins, 1.75 m) are never shrunk
  assert.ok(1.75 * fitScale(0.85, 0.98, 1.75).sy >= 1.75 - 1e-9);
  // good fits pass through unchanged
  const c = fitScale(1.05, 0.97, 2.1);
  assert.ok(Math.abs(c.sx - 1.05) < 1e-9 && Math.abs(c.sz - 0.97) < 1e-9);
});

test('size fallback: a badly-sized hint swaps to a related building of the right size', () => withLib(() => {
  const s = { id: 'barr_L_b', variant: 'timber_long', x: 0, z: 0, w: 8, d: 6 };
  const p = pickAsset('barracks', s, { theater: 'snow', missionId: 'm01' });
  assert.ok(!/^barracks_/.test(p.name), p.name);
  const e = p.turn ? [p.ext.d, p.ext.w] : [p.ext.w, p.ext.d];
  assert.ok(Math.abs(Math.log(8 / e[0])) < 0.3 && Math.abs(Math.log(6 / e[1])) < 0.3, `${p.name} ${e}`);
  // a hint that fits keeps its asset
  assert.equal(pickAsset('barracks', { id: 'L', variant: 'timber_long', w: 16, d: 7 }, { theater: 'snow' }).name, 'barracks_a');
}));

test('dressing: boulders are closed, grounded and seeded; cliffs follow the mission polygon', () => {
  const g = boulderGeometry(1.5, 1.2, 1, 42, 4);
  const bb = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
  assert.ok(bb.min.y < 0 && bb.max.y > 1 && bb.max.y < 2.2, JSON.stringify(bb));
  assert.equal(g.attributes.position.count, boulderGeometry(1.5, 1.2, 1, 42, 4).attributes.position.count);
  assert.ok(seedOf('a') !== seedOf('b'));
  const poly = [[84, 20], [148, 20], [148, 34], [124, 38], [84, 42]];
  const c = buildCliff({ id: 'cliff_e', points: poly, h: 12, x: 116, z: 31 });
  const cb = new THREE.Box3().setFromObject(c);
  assert.ok(cb.max.y > 10 && cb.max.y < 16 && cb.min.y < 0, `height ${cb.min.y}..${cb.max.y}`);
  assert.ok(cb.min.x > 84 - 116 - 3 && cb.max.x < 148 - 116 + 3 && cb.max.z - cb.min.z > 18, 'within the polygon ± noise');
});

test('dressing via buildProp: walls, rocks, cliffs, sandbag rings, poles are real geometry, few draw calls, same footprints', () => {
  const ctx = { theater: 'snow' };
  const wall = buildProp('wall', { id: 'w', variant: 'palisade_wire', points: [[0, 0], [20, 0], [20, 12]], h: 2.4, width: 0.5 }, ctx);
  const inst = meshes(wall.object3d).find((m) => m.isInstancedMesh);
  assert.ok(inst && inst.count > 100, 'palisade stakes instanced');
  assert.ok(meshes(wall.object3d).length <= 3, `palisade draw calls ${meshes(wall.object3d).length}`);
  assert.deepEqual(wall.footprints, buildProp('wall', { id: 'w', variant: 'palisade_wire', points: [[0, 0], [20, 0], [20, 12]], h: 2.4, width: 0.5 }, { library: false }).footprints);
  const ring = buildProp('sandbags', { id: 'mg', variant: 'mg_ring', x: 5, z: 5, ring: { r: 1.8 }, h: 1 }, ctx);
  const bags = meshes(ring.object3d).find((m) => m.isInstancedMesh);
  assert.ok(bags && bags.count > 40, 'ring of sandbags');
  for (const [type, p] of [['rocks', { id: 'r', w: 5, d: 3, h: 2 }], ['generator', { id: 't', variant: 'transformer', w: 2, d: 1.4, h: 2 }],
    ['telegraph_pole', { id: 'p', variant: 'lattice_pylon', h: 18 }], ['tent', { id: 'c', w: 4, d: 4, h: 2.2 }], ['ruins', { id: 'u', variant: 'wall_ruin', w: 16, d: 1.5, h: 1.6 }]]) {
    const r = buildProp(type, { x: 0, z: 0, ...p }, ctx);
    const n = meshes(r.object3d).length;
    assert.ok(n >= 1 && n <= 4, `${type}: ${n} meshes`);
    assert.ok(!meshes(r.object3d).some((m) => m.geometry.type === 'DodecahedronGeometry'), type);
  }
  // placeholders stay available (?buildings=0)
  const ph = buildProp('rocks', { id: 'r', w: 5, d: 3, h: 2 }, { library: false });
  assert.equal(meshes(ph.object3d)[0].geometry.type, 'DodecahedronGeometry');
  // consolidate keeps one mesh per material
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial();
  for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(), m); b.position.x = k; g.add(b); }
  assert.equal(consolidate(g).children.length, 1);
});
