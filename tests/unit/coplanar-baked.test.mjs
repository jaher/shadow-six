/**
 * Baked coplanar plans (art/coplanar-baked.js, tools/art/bake-coplanar.mjs): every plan matches the GLB it was baked
 * on (a rebuilt asset fails here until it is baked again), and a plan applied to a placed instance's LOD puts every
 * triangle where the separation itself puts it, on the instance's own geometry copies — the shared template stays
 * untouched; a geometry other than the baked one is left alone.
 */
import { test, assert } from './lib.mjs';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import { readGlbArrayBuffer } from '../../tools/glb-io.mjs';
import { GLTFLoader } from '../../src/engine/glb-gzip.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BAKE_OPTS, lodPrint, applyLodPlan, planMeshes } from '../../src/art/coplanar-baked.js';
import { applyAssetFixups, COPLANAR_SPLIT } from '../../src/art/building-fixups.js';
import { separateCoplanar } from '../../src/art/coplanar-split.js';
import { BAKED_FLAG } from '../../src/art/building-library.js';
import { BAKED_SPLIT } from '../../src/missions/expansion/e06_thin_ice.js';

const B = new URL('../../assets/models/buildings/', import.meta.url);
const MAN = {};
for (const f of readdirSync(B).filter((x) => /^manifest.*\.json$/.test(x))) Object.assign(MAN, JSON.parse(readFileSync(new URL(f, B), 'utf8')).assets || {});
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));
/** The load's fixups in node: building-fixups' camo-net pass loads its textures unconditionally — an image stub for
 *  that synchronous call only (a DOM left behind would change what other test modules do at import). */
function fixups(root, name, i) {
  const had = 'document' in globalThis;
  if (!had) globalThis.document = { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, set src(v) { /* never loads */ } }) };
  try { return applyAssetFixups(root, name, i, 'assets/', MAN[name]); } finally { if (!had) delete globalThis.document; }
}
/** A LOD scene as the building library prepares it (flags dropped, the load's fixups). */
async function lodScene(name, i) {
  const g = await new Promise((res, rej) => loader.parse(readGlbArrayBuffer(new URL(`../${MAN[name].lods[i].url}`, B)), '', res, rej));
  const root = g.scene, flags = [];
  root.traverse((x) => { if (BAKED_FLAG.test(x.name)) flags.push(x); });
  for (const f of flags) f.removeFromParent();
  fixups(root, name, i);
  return root;
}
const planOf = (name) => JSON.parse(readFileSync(new URL(`coplanar/${name}.json`, B), 'utf8'));
/** Every triangle corner in root space, by mesh key. */
function corners(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), out = new Map(), v = new THREE.Vector3();
  for (const { o, key } of planMeshes(root)) {
    const g = o.geometry, P = g.getAttribute('position'), I = g.index, n = I ? I.count : P.count, a = [];
    const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (let t = 0; t < n; t++) { v.fromBufferAttribute(P, I ? I.getX(t) : t).applyMatrix4(M); a.push(v.x, v.y, v.z); }
    out.set(key, a);
  }
  return out;
}
/** The bake's stages (tools/art/bake-coplanar.mjs runStage), on a scene of its own. */
function stages(root, opts) {
  for (const st of opts.stages) {
    const o = { ...st };
    if (st.fixedRx) o.fixed = new RegExp(st.fixedRx);
    delete o.fixedRx; delete o.only;
    const parked = [];
    if (st.only) {
      const rx = new RegExp(st.only);
      for (const { o: m } of planMeshes(root)) if (!(Array.isArray(m.material) ? m.material : [m.material]).some((x) => rx.test(x?.name || ''))) parked.push([m, m.parent]);
      for (const [m, p] of parked) p.remove(m);
    }
    try { separateCoplanar(root, o); } finally { for (const [m, p] of parked) p.add(m); }
  }
}

test('coplanar-baked: every asset in BAKE_OPTS has a plan, baked with its options, for every LOD, on the geometry the game loads', async () => {
  for (const name of Object.keys(BAKE_OPTS)) {
    assert.ok(existsSync(new URL(`coplanar/${name}.json`, B)), `${name}: a plan (node tools/art/bake-coplanar.mjs ${name})`);
    assert.equal(COPLANAR_SPLIT.has(name), false, `${name}: not split at load as well`);
    const plan = planOf(name);
    assert.deepEqual(plan.opts, BAKE_OPTS[name], `${name}: baked with its BAKE_OPTS (re-bake after changing them)`);
    assert.equal(plan.lods.length, MAN[name].lods.length, `${name}: a plan per LOD`);
    for (const lp of plan.lods) assert.equal(lodPrint(await lodScene(name, lp.lod)), lp.print, `${name} lod${lp.lod}: the GLB is the one baked (re-run tools/art/bake-coplanar.mjs ${name})`);
  }
});

test('coplanar-baked: e06 opts its own instances in — every one with a baked plan', () => {
  for (const { asset } of BAKED_SPLIT) assert.ok(BAKE_OPTS[asset], `${asset} baked`);
});

test('coplanar-baked: a plan puts every triangle where the separation puts it, on the instance\'s own geometry copies', async () => {
  for (const [name, lod] of [['church_village_b', 2], ['house_halftimber_c', 2], ['fishing_shed_a_snow', 2]]) {
    const plan = planOf(name), lp = plan.lods.find((q) => q.lod === lod);
    const template = await lodScene(name, lod);
    const shared = new Map(planMeshes(template).map(({ o, key }) => [key, o.geometry]));
    const inst = template.clone(true); // (as createBuilding attaches a LOD: geometries shared with the template)
    const moved = applyLodPlan(inst, lp, { name, warn: null });
    assert.equal(moved, lp.meshes.reduce((s, m) => s + m.tris.length, 0), `${name} lod${lod}: every planned triangle moved`);
    for (const { o, key } of planMeshes(inst)) {
      const own = lp.meshes.some((m) => m.key === key);
      assert.equal(o.geometry !== shared.get(key), own, `${name} ${key}: ${own ? 'its own copy' : 'still the shared geometry'}`);
    }
    assert.equal(lodPrint(template), lp.print, `${name}: the template untouched`);
    // the separation run afresh on another copy: the same corners (to the plan's 0.1 mm and the GLB's quantisation)
    const ref = await lodScene(name, lod);
    stages(ref, plan.opts);
    const a = corners(inst), b = corners(ref);
    let worst = 0;
    for (const [key, xs] of a) { const ys = b.get(key); for (let k = 0; k < xs.length; k++) worst = Math.max(worst, Math.abs(xs[k] - ys[k])); }
    assert.ok(worst < 0.0015, `${name} lod${lod}: every corner where the separation puts it (worst ${(worst * 1000).toFixed(2)} mm)`);
  }
});

test('coplanar-baked: a geometry other than the baked one is left alone (a stale plan never moves the wrong triangles)', async () => {
  const name = 'church_village_b', plan = planOf(name), lp = plan.lods.find((q) => q.lod === 2);
  const inst = (await lodScene(name, 2)).clone(true);
  const m = planMeshes(inst).find(({ key }) => key === lp.meshes[0].key).o;
  m.geometry = m.geometry.clone();
  const P = m.geometry.getAttribute('position');
  P.setX(0, P.getX(0) + 7); // (the "rebuilt" asset: a raw quantised step of 7)
  const warned = [];
  assert.equal(applyLodPlan(inst, lp, { name, warn: (s) => warned.push(s) }), 0);
  assert.equal(warned.length, 1);
});
