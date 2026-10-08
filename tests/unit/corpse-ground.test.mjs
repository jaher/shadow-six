/**
 * Dead men lie on the ground (the user, 2026-10-08: "bodies of dead soldiers are still floating on the ground"):
 * art/body-kit.js (the belt kit merged into a body mesh) and art/corpse-ground.js (the drawn corpse laid on the drawn
 * ground), on real character GLBs in node.
 *
 *  - kit: a German rifleman's bread bag, canteen, gas-mask can, pouches (small components hanging off the pelvis /
 *    spine / a thigh) are kit; his tunic, trousers, boots, hands and head are not; the Green Beret's boots, hands and
 *    puttees are not either. Lying on his back in the death clip the rifleman's kit hangs 10+ cm under his body.
 *  - the old grounding (the clip lifted onto its lowest vertex — the kit) left the rifleman's back, head, hands and
 *    heels in the air; laid on the ground by restOnGround every part (hips, chest, head, hands, feet) touches flat
 *    ground, a 12° slope and rippled snow, his kit under him; a body high up (on a crate) is left alone.
 *  - the physics heightfield query (fieldAt) is never under its samples' triangulation.
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { adaptClip } from '../../src/art/characters/pipeline/charkit.js';
import { bodyKit, KIT_SIZE } from '../../src/art/body-kit.js';
import { restOnGround, CORPSE_BONES } from '../../src/art/corpse-ground.js';
import { fieldAt } from '../../src/physics/statics.js';

const A = new URL('../../assets/characters/', import.meta.url).pathname;
async function glb(path) {
  const buf = readFileSync(A + path), ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const L = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  L.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));   // node: geometry and bones only
  return new Promise((res, rej) => L.parse(ab, '', res, rej));
}
const meta = (sc) => { let u = sc.userData.shadowSix || null; if (!u) sc.traverse((o) => { if (!u && o.userData?.shadowSix) u = o.userData.shadowSix; }); return u || {}; };
const ANIMS = {};
/** The clip library: the enemies' own die / dead, the UAL base library for the prone ones. */
const anims = async (clip) => { const f = /prone/.test(clip) ? 'base_anims' : 'enemy_anims'; return (ANIMS[f] ||= await glb(`anims/${f}.glb`)); };

/** A UnitModel-shaped body on a character GLB, posed in the last frame of `clip` (adapted to it), its root at `at`. */
async function body(path, clip = 'dead', at = [0, 0, 0], yaw = 0.7) {
  const L = await anims(clip), g = await glb(path);
  const root = new THREE.Group(), bodyG = new THREE.Group(); bodyG.name = 'body'; root.add(bodyG); bodyG.add(g.scene);
  const bones = {}; g.scene.traverse((o) => { if (o.isBone && !(o.name in bones)) bones[o.name] = o; });
  const info = meta(g.scene), lm = meta(L.scene);
  const c0 = L.animations.find((c) => c.name === clip);
  const c = adaptClip(c0, { srcPelvisRest: lm.pelvisRest ? new THREE.Vector3(...lm.pelvisRest) : null, tgtPelvisRest: info.pelvisRest ? new THREE.Vector3(...info.pelvisRest) : null, ratio: info.pelvisRatio || 1 });
  for (const tr of c.tracks) {
    const i = tr.name.lastIndexOf('.'), b = bones[tr.name.slice(0, i)], p = tr.name.slice(i + 1);
    if (b && (p === 'quaternion' || p === 'position')) b[p].fromArray(tr.createInterpolant().evaluate(c.duration - 1e-4));
  }
  root.position.set(...at); root.rotation.y = yaw;
  root.updateMatrixWorld(true);
  return { root, characterId: path, real: { inner: { bones, object: g.scene }, getSocket: (n) => bones[n] || null }, _body: () => bodyG };
}
function lightest(m) {
  let mesh = null;
  m.real.inner.object.traverse((o) => { if (o.isSkinnedMesh && /^LOD\d+$/.test(o.name) && (!mesh || o.geometry.attributes.position.count < mesh.geometry.attributes.position.count)) mesh = o; });
  return mesh;
}
const PARTS = { head: /^(head|neck)/i, chest: /^(spine_0[23]|clavicle)/i, hips: /^(pelvis|spine_01|thigh)/i, hands: /^(hand|lowerarm|index|middle|ring|pinky|thumb)/i, feet: /^(calf|foot|ball)/i };
/** Lowest vertex of each part (kit apart) over the ground function. */
function gaps(m, ground) {
  const mesh = lightest(m), K = bodyKit(mesh), V = new THREE.Vector3(), out = { kit: Infinity, all: Infinity };
  for (const p in PARTS) out[p] = Infinity;
  m.root.updateMatrixWorld(true);
  const names = mesh.skeleton.bones.map((b) => b.name);
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
    mesh.getVertexPosition(i, V).applyMatrix4(mesh.matrixWorld);
    const d = V.y - ground(V.x, V.z);
    if (K.kit[i]) { out.kit = Math.min(out.kit, d); continue; }
    out.all = Math.min(out.all, d);
    const n = names[K.dom[i]];
    for (const p in PARTS) if (PARTS[p].test(n)) out[p] = Math.min(out[p], d);
  }
  return out;
}
/** Lift the pelvis so the lowest vertex — kit included — is 4 mm over flat ground at y0 (the grounding before the fix). */
function oldGrounding(m, y0 = 0) {
  const mesh = lightest(m), V = new THREE.Vector3();
  m.root.updateMatrixWorld(true);
  let lo = Infinity;
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) { mesh.getVertexPosition(i, V).applyMatrix4(mesh.matrixWorld); lo = Math.min(lo, V.y); }
  const p = m.real.inner.bones.pelvis, w = p.getWorldPosition(new THREE.Vector3());
  w.y += y0 + 0.004 - lo; p.position.copy(p.parent.worldToLocal(w)); m.root.updateMatrixWorld(true);
}

test('kit: a rifleman\'s bread bag, canteen and pouches are kit; his garments, boots, hands and head are not', async () => {
  for (const path of ['enemies/rifleman_v12.glb', 'enemies/rifleman_v11.glb', 'commandos/greenberet.glb']) {
    const m = await body(path), mesh = lightest(m), K = bodyKit(mesh);
    const names = mesh.skeleton.bones.map((b) => b.name), kitBones = new Set(), bodyBones = new Set();
    for (let i = 0; i < K.kit.length; i++) (K.kit[i] ? kitBones : bodyBones).add(names[K.dom[i]]);
    for (const b of kitBones) assert.ok(/^(pelvis|spine_0\d|clavicle_|thigh_)/.test(b), `${path}: kit only on the belt / straps (${b})`);
    for (const b of ['Head', 'hand_l', 'hand_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r', 'calf_l', 'thigh_l', 'pelvis', 'spine_03']) assert.ok(bodyBones.has(b), `${path}: ${b} is body`);
    assert.ok(K.kitCount < 0.4 * K.kit.length, `${path}: most of the mesh is the man (kit ${K.kitCount} of ${K.kit.length} vertices)`);
    const per = (b) => { let k = 0; for (let i = 0; i < K.kit.length; i++) if (!K.kit[i] && names[K.dom[i]] === b) k++; return k; };
    for (const b of ['pelvis', 'spine_03', 'thigh_l']) assert.ok(per(b) > 20, `${path}: his tunic / trousers are not kit (${b}: ${per(b)} body vertices)`);
    if (/rifleman/.test(path)) {
      assert.ok(K.kitCount >= 80, `${path}: his belt kit found (${K.kitCount} vertices)`);
      const g = gaps(m, () => 0);
      assert.ok(g.kit < g.all - 0.08, `${path}: on his back the kit hangs under him (kit ${g.kit.toFixed(3)}, body ${g.all.toFixed(3)})`);
    }
  }
  assert.ok(KIT_SIZE <= 0.5);
});

test('a rifleman on his back: grounded on his kit he lay in the air; laid on the ground every part touches', async () => {
  const m = await body('enemies/rifleman_v12.glb', 'dead', [3, 0, 4]);
  const flat = () => 0;
  oldGrounding(m);
  const before = gaps(m, flat);
  assert.ok(before.chest > 0.1 && before.head > 0.15 && before.all > 0.1, `old grounding: in the air (chest ${before.chest.toFixed(3)}, head ${before.head.toFixed(3)}, lowest ${before.all.toFixed(3)})`);
  const r = restOnGround(m, flat, null);
  assert.ok(r && r.moved, 'laid down');
  const g = gaps(m, flat);
  for (const p of Object.keys(PARTS)) assert.ok(g[p] <= 0.02 && g[p] >= -0.03, `${p} on the ground (${g[p].toFixed(3)} m)`);
  assert.ok(g.kit < -0.05, `his kit under him, in the ground (${g.kit.toFixed(3)})`);
  // the pass writes only the bones it declares
  const B = m.real.inner.bones, keep = new Map(Object.entries(B).map(([k, b]) => [k, b.quaternion.clone()]));
  restOnGround(m, () => 0.05, null);
  for (const [k, q] of keep) if (!CORPSE_BONES.includes(k)) assert.ok(B[k].quaternion.equals(q), `${k} untouched`);
});

test('on a 12° slope and on rippled snow every part touches; a body high up (on a crate) is left alone', async () => {
  const slope = (x, z) => 2 + Math.tan(12 * Math.PI / 180) * (x * 0.8 + z * 0.6);
  // snow drift ripples: 5 cm over ~2 m, 2 cm over 0.8 m
  const bumps = (x, z) => 1 + 0.05 * Math.sin(x * 3.1) * Math.cos(z * 2.3) + 0.02 * Math.sin(z * 7.9 + x);
  for (const [name, ground, prone] of [['slope', slope, false], ['bumps', bumps, false], ['slope, on his face', slope, true]]) {
    const m = await body('enemies/rifleman_v11.glb', prone ? 'dead_prone' : 'dead', [5, 0, 7]);
    m.root.position.y = ground(5, 7); m.root.updateMatrixWorld(true);
    oldGrounding(m, ground(5, 7));
    restOnGround(m, ground, null);
    const g = gaps(m, ground);
    for (const p of ['hips', 'chest', 'head']) assert.ok(g[p] <= 0.035 && g[p] >= -0.05, `${name}: ${p} on the ground (${g[p].toFixed(3)} m)`);
    for (const p of ['hands', 'feet']) assert.ok(g[p] <= 0.04 && g[p] >= -0.07, `${name}: ${p} on the ground (${g[p].toFixed(3)} m)`);
  }
  const m = await body('enemies/rifleman_v12.glb', 'dead', [0, 0, 0]);
  oldGrounding(m, 0.9);
  const before = gaps(m, () => 0), r = restOnGround(m, () => 0, null), after = gaps(m, () => 0);
  assert.ok(Math.abs(after.hips - before.hips) < 1e-6 && r.shift === 0, `0.9 m up: not pulled down (${before.hips.toFixed(3)} → ${after.hips.toFixed(3)})`);
});

test('fieldAt: the heightfield as built is never under the triangulation of its samples', () => {
  const ncols = 4, nrows = 3, step = 1, H = new Float32Array((ncols + 1) * (nrows + 1));
  for (let c = 0; c <= ncols; c++) for (let r = 0; r <= nrows; r++) H[c * (nrows + 1) + r] = (c === 2 && r === 1) ? 0.45 : 0.05 * c;
  const f = { heights: H, step, ncols, nrows };
  assert.ok(Math.abs(fieldAt(f, 2, 1) - 0.45) < 1e-6, 'at a sample: the sample');
  assert.ok(Math.abs(fieldAt(f, 0.5, 2.5) - 0.025) < 1e-6, 'flat between samples: linear');
  // next to the 0.45 m sample the surface ramps up to it over 1 m
  const v = fieldAt(f, 1.75, 1.25);
  assert.ok(v > 0.25 && v <= 0.45, `beside a raised sample: on its ramp (${v.toFixed(3)})`);
  assert.equal(fieldAt(null, 1, 1), null);
});
