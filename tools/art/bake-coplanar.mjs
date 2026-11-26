#!/usr/bin/env node
/**
 * Bake the coplanar separation of library buildings (art/coplanar-baked.js): for each asset, each LOD's GLB is loaded
 * in node exactly as the game's building library prepares it (its baked flags dropped, art/building-fixups.js
 * applyAssetFixups), its triangles' positions are snapshot, art/coplanar-split.js separateCoplanar runs the asset's
 * stages (BAKE_OPTS in art/coplanar-baked.js), and every triangle that moved is written with its offsets — the plan a
 * mission applies to its own placed instance at load, in milliseconds (the split itself took up to 0.9 s a LOD on the
 * main thread). Each LOD's plan carries the fingerprint of the geometry it was baked on.
 *
 *   node tools/art/bake-coplanar.mjs church_village_b house_halftimber_a …   (default: every asset in BAKE_OPTS)
 *   node tools/art/bake-coplanar.mjs --check   (exit 1 when a plan is missing or stale: tests/unit/coplanar-baked)
 *
 * Writes assets/models/buildings/coplanar/<asset>.json.
 */
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
register(pathToFileURL(join(ROOT, 'tests/unit/resolve-hooks.mjs')).href);
// (art/building-fixups.js fixBunkerNet loads its net textures unconditionally: an image stub that never loads)
globalThis.document ??= { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, set src(v) { /* never loads */ } }) };

const THREE = await import('three');
const { readGlbArrayBuffer } = await import(pathToFileURL(join(ROOT, 'tools/glb-io.mjs')).href);
const { GLTFLoader } = await import(pathToFileURL(join(ROOT, 'src/engine/glb-gzip.js')).href);
const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
const { applyAssetFixups } = await import(pathToFileURL(join(ROOT, 'src/art/building-fixups.js')).href);
const { separateCoplanar } = await import(pathToFileURL(join(ROOT, 'src/art/coplanar-split.js')).href);
const { BAKE_OPTS, PLAN_UNIT, planMeshes, lodPrint } = await import(pathToFileURL(join(ROOT, 'src/art/coplanar-baked.js')).href);
const { BAKED_FLAG } = await import(pathToFileURL(join(ROOT, 'src/art/building-library.js')).href);

const args = process.argv.slice(2);
const check = args.includes('--check');
const names = args.filter((a) => !a.startsWith('--'));
const assets = names.length ? names : Object.keys(BAKE_OPTS);
const OUT = join(ROOT, 'assets/models/buildings/coplanar');

// every building manifest (the base one and the add-ons)
const MAN = {};
for (const f of ['manifest.json', ...(JSON.parse(readFileSync(join(ROOT, 'assets/models/buildings/manifest.json'), 'utf8')).addons || [])]) {
  const p = join(ROOT, 'assets/models/buildings', f.endsWith('.json') ? f : `${f}.json`);
  if (existsSync(p)) Object.assign(MAN, JSON.parse(readFileSync(p, 'utf8')).assets || {});
}
if (Object.keys(MAN).length < 50) {
  // (the add-on list lives in the code: read every manifest-*.json beside the base one)
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(join(ROOT, 'assets/models/buildings')).filter((x) => /^manifest.*\.json$/.test(x))) Object.assign(MAN, JSON.parse(readFileSync(join(ROOT, 'assets/models/buildings', f), 'utf8')).assets || {});
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));
const load = (url) => new Promise((res, rej) => loader.parse(readGlbArrayBuffer(join(ROOT, 'assets/models', url)), '', res, rej));

/** Every triangle corner of every mesh, in root space: key → Float64Array (t*9 + k*3 + c). */
function snapshot(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), out = new Map(), v = new THREE.Vector3();
  for (const { o, key } of planMeshes(root)) {
    const g = o.geometry, P = g.getAttribute('position'), I = g.index, n = I ? I.count : P.count;
    const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), a = new Float64Array(n * 3);
    for (let t = 0; t < n; t++) { v.fromBufferAttribute(P, I ? I.getX(t) : t).applyMatrix4(M); a[t * 3] = v.x; a[t * 3 + 1] = v.y; a[t * 3 + 2] = v.z; }
    out.set(key, a);
  }
  return out;
}

/** One stage of separateCoplanar, restricted to the meshes `only` names (the others detached meanwhile). */
function runStage(root, st) {
  const o = { ...st };
  if (st.fixedRx) o.fixed = new RegExp(st.fixedRx);
  delete o.fixedRx; delete o.only;
  const parked = [];
  if (st.only) {
    const rx = new RegExp(st.only);
    for (const { o: m } of planMeshes(root)) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (!mats.some((x) => rx.test(x?.name || ''))) parked.push([m, m.parent]);
    }
    for (const [m, p] of parked) p.remove(m);
  }
  try { return separateCoplanar(root, o); } finally { for (const [m, p] of parked) p.add(m); }
}

async function bake(name) {
  const meta = MAN[name];
  if (!meta) throw new Error(`no such asset: ${name}`);
  const opts = BAKE_OPTS[name];
  if (!opts) throw new Error(`${name}: no BAKE_OPTS entry (art/coplanar-baked.js)`);
  const lods = [];
  for (let i = 0; i < meta.lods.length; i++) {
    const t0 = performance.now();
    const g = await load(meta.lods[i].url);
    const root = g.scene;
    const flags = []; root.traverse((x) => { if (BAKED_FLAG.test(x.name)) flags.push(x); }); for (const f of flags) f.removeFromParent();
    applyAssetFixups(root, name, i, 'assets/', meta);
    const print = lodPrint(root), before = snapshot(root);
    // (a parked mesh is re-added at the end of its parent's children: the traversal order — the plan's addresses —
    // is taken from the snapshot above, by key, so the order after does not matter)
    const stats = opts.stages.map((st) => runStage(root, st));
    const after = snapshot(root), meshes = [];
    for (const [key, a] of before) {
      const b = after.get(key);
      if (!b || b.length !== a.length) throw new Error(`${name} lod${i}: mesh ${key} changed shape in the bake`);
      const tris = [];
      for (let t = 0; t < a.length / 9; t++) {
        const off = [];
        let any = false;
        for (let k = 0; k < 9; k++) { const d = Math.round((b[t * 9 + k] - a[t * 9 + k]) / PLAN_UNIT); off.push(d); if (d) any = true; }
        if (!any) continue;
        const same = off[0] === off[3] && off[0] === off[6] && off[1] === off[4] && off[1] === off[7] && off[2] === off[5] && off[2] === off[8];
        tris.push(same ? [t * 3, off[0], off[1], off[2]] : [t * 3, ...off]);
      }
      if (tris.length) meshes.push({ key, tris });
    }
    lods.push({ lod: i, print, meshes });
    console.log(`${name} lod${i}: ${meshes.reduce((s, m) => s + m.tris.length, 0)} triangles moved in ${meshes.length} meshes (${stats.map((s) => `${s.pairs} pairs/${s.moved} moved`).join(', ')}) ${(performance.now() - t0).toFixed(0)} ms`);
  }
  return { asset: name, tool: 'tools/art/bake-coplanar.mjs v1', unit: PLAN_UNIT, opts, lods };
}

let bad = 0;
mkdirSync(OUT, { recursive: true });
for (const name of assets) {
  const plan = await bake(name);
  const file = join(OUT, `${name}.json`);
  if (check) {
    const old = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    const same = old && JSON.stringify(old.lods) === JSON.stringify(plan.lods) && JSON.stringify(old.opts) === JSON.stringify(plan.opts);
    if (!same) { bad++; console.log(`STALE ${name}: ${old ? 'differs from a fresh bake' : 'no plan'} — run node tools/art/bake-coplanar.mjs ${name}`); }
    continue;
  }
  writeFileSync(file, JSON.stringify(plan));
  console.log(`→ ${file}`);
}
process.exit(bad ? 1 : 0);
