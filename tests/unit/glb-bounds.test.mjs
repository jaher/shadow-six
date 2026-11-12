/**
 * Model GLB bounds (fix/lorry-slab: M0's parked Opel Blitz drew a flat brown slab over the canal and the compound).
 * The library's GLBs are KHR_mesh_quantization: Uint16 positions read through the node's dequantisation scale. The
 * parked-model merge (art/vehicle-library.js mergeParked, a mission's `vehicleArtMerge`) baked that scale into a copy
 * still holding the Uint16 array — metres truncated to whole units, negatives wrapped to 65535 — so the merged lorry
 * reached 65 km out. Guarded here at both ends:
 *  - every model GLB (vehicles, buildings, bridges): each POSITION accessor has bounds, no integer component sits at
 *    its type's limit (an overflowed size pass), and the model's extent through its node transforms is sane — a
 *    vehicle's within its sidecar bbox;
 *  - every vehicle GLB decoded (node, no textures): the drawn bounds match the sidecar bbox, and merged as a parked
 *    model (mergeParked) the bounds, triangle count and materials are unchanged, the baked copies plain Float32.
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { glbJson, readGlbArrayBuffer } from '../../tools/glb-io.mjs'; // GLBs are gzip-wrapped (src/engine/glb-gzip.js)
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeParked, floatAttributes } from '../../src/art/vehicle-library.js';

const MODELS = new URL('../../assets/models/', import.meta.url).pathname;
const VEH = MODELS + 'vehicles/';
const MAN = JSON.parse(readFileSync(VEH + 'manifest.json', 'utf8'));
const walk = (p) => (statSync(p).isFile() ? (p.endsWith('.glb') ? [p] : [])
  : readdirSync(p, { withFileTypes: true }).flatMap((e) => walk(join(p, e.name))));
/** integer componentType → [min, max] of the type */
const LIMIT = { 5120: [-128, 127], 5121: [0, 255], 5122: [-32768, 32767], 5123: [0, 65535], 5125: [0, 2 ** 32 - 1] };
const MAX_EXTENT = 300; // m: nothing in the game is longer than the Bismarck (251 m)
const rel = (f) => f.slice(MODELS.length);

/** The model's AABB from its accessors' min/max through the node transforms, and the defects found on the way. */
function accessorBounds(j) {
  const nodes = j.nodes || [], world = [], box = new THREE.Box3(), bad = [];
  const local = (n) => (n.matrix ? new THREE.Matrix4().fromArray(n.matrix) : new THREE.Matrix4().compose(
    new THREE.Vector3(...(n.translation || [0, 0, 0])), new THREE.Quaternion(...(n.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(n.scale || [1, 1, 1]))));
  const visit = (i, parent) => { world[i] = parent.clone().multiply(local(nodes[i])); for (const c of nodes[i].children || []) visit(c, world[i]); };
  for (const s of j.scenes || []) for (const r of s.nodes || []) visit(r, new THREE.Matrix4());
  nodes.forEach((n, i) => {
    if (n.mesh == null || !world[i]) return;
    for (const p of j.meshes[n.mesh].primitives) {
      const a = j.accessors[p.attributes.POSITION];
      if (!a?.min || !a?.max) { bad.push(`mesh ${n.mesh}: POSITION without min/max`); continue; }
      let mn = a.min, mx = a.max;
      const lim = LIMIT[a.componentType];
      if (lim && !a.normalized && (mx.some((v) => v >= lim[1]) || (lim[0] < 0 && mn.some((v) => v <= lim[0])))) bad.push(`mesh ${n.mesh}: quantized POSITION at the type limit (${mn} .. ${mx})`);
      if (lim && a.normalized) { mn = mn.map((v) => Math.max(v / lim[1], -1)); mx = mx.map((v) => Math.max(v / lim[1], -1)); }
      if (![...mn, ...mx].every(Number.isFinite)) { bad.push(`mesh ${n.mesh}: non-finite bounds`); continue; }
      box.union(new THREE.Box3(new THREE.Vector3(...mn), new THREE.Vector3(...mx)).applyMatrix4(world[i]));
    }
  });
  return { box, bad };
}

/**
 * Is `box` within the sidecar bbox, padded by `k` of its size + `c` m? (The accessor-level box is conservative: a wreck's
 * scattered parts sit on rotated nodes, so their accessor boxes swell when turned.)
 */
function withinMeta(box, bbox, k = 0.1, c = 0.05) {
  const mn = new THREE.Vector3(...bbox.min), mx = new THREE.Vector3(...bbox.max), pad = mx.clone().sub(mn).multiplyScalar(k).addScalar(c);
  return box.min.clone().sub(mn.clone().sub(pad)).toArray().every((v) => v >= 0) && mx.clone().add(pad).sub(box.max).toArray().every((v) => v >= 0);
}

const metaOf = new Map(); // vehicle GLB path → sidecar bbox
for (const m of Object.values(MAN.models)) {
  const bbox = JSON.parse(readFileSync(VEH + m.meta, 'utf8')).bbox;
  for (const l of m.lods || []) if (l && bbox) metaOf.set(VEH + l, bbox);
}

test('model GLBs: positions within their quantisation range, every model a sane size (vehicles within their sidecar bbox)', () => {
  const files = walk(MODELS), bad = [];
  assert.ok(files.length > 1000, `model GLBs found (${files.length})`);
  for (const f of files) {
    const { box, bad: b } = accessorBounds(glbJson(f));
    for (const s of b) bad.push(`${rel(f)}: ${s}`);
    if (box.isEmpty()) continue;
    const size = box.getSize(new THREE.Vector3());
    if (Math.max(size.x, size.y, size.z) > MAX_EXTENT) bad.push(`${rel(f)}: ${size.toArray().map((v) => v.toFixed(1)).join(' × ')} m`);
    const bbox = metaOf.get(f);
    if (bbox && !withinMeta(box, bbox, 0.25, 0.25)) bad.push(`${rel(f)}: bounds ${box.min.toArray().map((v) => v.toFixed(2))} .. ${box.max.toArray().map((v) => v.toFixed(2))} outside its sidecar bbox`);
  }
  assert.deepEqual(bad, [], bad.slice(0, 12).join('\n'));
});

// ------------------------------------------------------------------ decoded (node: geometry only, no textures)

const LOADER = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
LOADER.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));
const decode = (f) => new Promise((res, rej) => LOADER.parse(readGlbArrayBuffer(f), '', (g) => res(g.scene), rej));
const tris = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return n; };
const mats = (root) => { const s = new Set(); root.traverse((o) => { if (o.isMesh) s.add(o.material.uuid); }); return [...s].sort(); };

test('floatAttributes: quantized / normalised / interleaved attributes come out as plain Float32 with the same values', () => {
  const g = new THREE.BufferGeometry();
  const ib = new THREE.InterleavedBuffer(new Uint16Array([0, 1, 16383, 9, 2, 3, 4, 9]), 4);
  g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
  g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array([127, 0, -127, 0, 127, 0]), 3, true));
  const uv = new THREE.Float32BufferAttribute([0.25, 0.5, 1, 0], 2);
  g.setAttribute('uv', uv);
  floatAttributes(g);
  for (const a of Object.values(g.attributes)) assert.ok(a.array instanceof Float32Array && !a.normalized && !a.isInterleavedBufferAttribute);
  assert.deepEqual([...g.attributes.position.array], [0, 1, 16383, 2, 3, 4]);
  assert.deepEqual([...g.attributes.normal.array], [1, 0, -1, 0, 1, 0]);
  assert.equal(g.attributes.uv, uv, 'a plain Float32 attribute is kept as it is');
  // the defect itself: a matrix baked into the Uint16 array wraps; into the Float32 copy it lands in metres
  const q = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Uint16Array([0, 0, 0, 16383, 16383, 16383]), 3));
  const deq = new THREE.Matrix4().compose(new THREE.Vector3(-1.195, -0.46, -3.109), new THREE.Quaternion(), new THREE.Vector3(3.79e-4, 3.79e-4, 3.79e-4));
  assert.equal(q.clone().applyMatrix4(deq).attributes.position.getX(0), 65535, 'baked into the integer array: -1.195 m wraps to 65535');
  const f = floatAttributes(q.clone()).applyMatrix4(deq).attributes.position;
  assert.ok(Math.abs(f.getX(0) + 1.195) < 1e-6 && Math.abs(f.getX(1) - (16383 * 3.79e-4 - 1.195)) < 1e-4, 'dequantised first: metres');
});

test('vehicle GLBs decoded: drawn bounds within the sidecar bbox; merged as a parked model (mergeParked) bounds, triangles and materials unchanged', async () => {
  const bad = [];
  let n = 0, merged = 0;
  for (const [f, bbox] of metaOf) {
    const scene = await decode(f);
    scene.updateMatrixWorld(true);
    const before = new THREE.Box3().setFromObject(scene, true), t0 = tris(scene), m0 = mats(scene);
    if (!withinMeta(before, bbox)) bad.push(`${rel(f)}: decoded bounds ${before.min.toArray().map((v) => v.toFixed(2))} .. ${before.max.toArray().map((v) => v.toFixed(2))} outside its sidecar bbox`);
    const out = mergeParked({ lods: new Map([[0, scene]]) });
    merged += out.length; n++;
    for (const m of out) {
      for (const [k, a] of Object.entries(m.geometry.attributes)) if (!(a.array instanceof Float32Array) || a.normalized) bad.push(`${rel(f)}: merged ${k} is ${a.array.constructor.name}${a.normalized ? ' (normalised)' : ''}`);
    }
    scene.updateMatrixWorld(true);
    const after = new THREE.Box3().setFromObject(scene, true);
    const d = Math.max(...after.min.clone().sub(before.min).toArray().map(Math.abs), ...after.max.clone().sub(before.max).toArray().map(Math.abs));
    if (!(d < 1e-3)) bad.push(`${rel(f)}: merged bounds moved ${d.toFixed(3)} m (${after.min.toArray().map((v) => v.toFixed(1))} .. ${after.max.toArray().map((v) => v.toFixed(1))})`);
    if (tris(scene) !== t0) bad.push(`${rel(f)}: ${t0} → ${tris(scene)} triangles merged`);
    assert.deepEqual(mats(scene), m0, `${rel(f)}: same materials`);
    for (const m of out) m.geometry.dispose();
  }
  assert.ok(n > 200 && merged > 100, `vehicle GLBs decoded (${n}), merged meshes (${merged})`);
  assert.deepEqual(bad, [], bad.slice(0, 12).join('\n'));
});
