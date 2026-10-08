// Copied from scratchpad chars/enemies/web/enemy_runtime.js by tools/characters/consolidate/copy_runtime.py (imports/URLs rewritten; moved to src/art/characters in art integration 2). CC0 project code.
// enemy_runtime.js - enemy-side runtime fixes layered on pipeline charkit (the pipeline files are shared and left untouched):
//   fixLibMeta   anims GLBs keep userData.shadowSix on the child node 'Scene' -> charkit.loadAnimLibrary sees empty meta
//                (no groundSpeed => no foot-slide timeScale, no loop flags, pelvis track not retargeted)
//   ground clamp die/dead: per template, the lowest skinned vertex (body + helmet; not the belt kit, art/body-kit.js) over
//                the clip is measured once and the pelvis is lifted so the body does not sink under the ground
//   stride warp  run/sprint: UAL Jog/Sprint feet sweep back at ~2x the root speed; the feet are pulled towards the hips
//                along the travel direction (factor = planted-foot speed / clip foot speed) and the legs two-bone IK'd
//   perf         static bounding sphere + frustum culling on; one Skeleton shared by all skinned meshes of a unit
//   bodyPosition corpse footprint = pelvis on the ground (die ends 0.45-0.6 m from the unit origin)
//   props        detonator box (engineer 'detonate'), binoculars in the hands (officer 'binoculars'), cigarette ('smoke')
import * as THREE from 'three';
import { twoBoneIK } from '../pipeline/weapons.js';
import { bindInfo } from './enemy_weapons.js';
import { skinnedMinY } from '../skin-min.js';
import { bodyVertexList } from '../../body-kit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const wpos = (o) => o.getWorldPosition(V());
const palm = (B, s) => wpos(B['hand_' + s]).lerp(wpos(B['middle_01_' + s]), 0.55);

// perf: refresh only the skeleton's world matrices (not LOD meshes, props, weapon): the unit's own matrix + the bone tree
export function updBones(h) {
  if (!h._boneTop) { let b = h.bones.pelvis; while (b.parent && b.parent !== h.object) b = b.parent; h._boneTop = b; }
  h.object.updateWorldMatrix(true, false); h._boneTop.updateMatrixWorld(true);
}

export function fixLibMeta(lib) {
  let ud = null; lib.gltf.scene.traverse(o => { if (!ud && o.userData && o.userData.shadowSix) ud = o.userData.shadowSix; });
  if (ud) { Object.assign(lib.meta, ud.clips || {}); if (ud.pelvisRest) lib.srcPelvisRest = new THREE.Vector3(...ud.pelvisRest); }
  return lib;
}

// LOD thresholds (anim_check lodsheet: LOD0/1/2 read the same at 40 and 80 px/m)
export const enemyLodFor = (px) => px >= 120 ? 'LOD0' : px >= 50 ? 'LOD1' : 'LOD2';
// gait variant by requested ground speed (enemy_anims.glb walk_fast / run_slow / run_fast = commandos_b re-synthesis):
// alert walk 1.8 m/s was a 170-178 steps/min shuffle on the 0.92 m/s walk; run 3.8 m/s skated the left heel on the UAL jog
export const GAIT = { walk: [['walk', 1.45], ['walk_fast', 1e9]], run: [['run_slow', 4.15], ['run', 4.95], ['run_fast', 1e9]] };
export const STRIDE = { run: 0.5, sprint: 0.46 };   // planted speed / clip stance-foot speed (measured: Jog 6.2 m/s vs 3.1, Sprint 9.8 vs 4.6)

export function perfSetup(h) {
  h.object.updateMatrixWorld(true);
  const rootInv = h.object.matrixWorld.clone().invert();
  let first = null;
  h.object.traverse(m => {
    if (!m.isMesh) return;
    const toMesh = m.matrixWorld.clone().premultiply(rootInv).invert();
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.75, -0.2), 1.95).applyMatrix4(toMesh);
    m.frustumCulled = true;
    if (!m.isSkinnedMesh) return;
    const sk = m.skeleton;
    if (!first) { first = sk; return; }
    if (sk.bones.length === first.bones.length && sk.bones.every((b, i) => b === first.bones[i]) &&
        sk.boneInverses.every((bi, i) => bi.elements.every((e, j) => Math.abs(e - first.boneInverses[i].elements[j]) < 1e-5))) m.skeleton = first;
  });
}

// lowest point of the unit (object space) while `clip` plays, sampled on a scratch instance at identity transform.
// A lying man (die / dead clips) rests on his body, not on his belt kit (art/body-kit.js): on his back the bread bag and
// canteen hang 15-20 cm below it, and lifting the clip onto them held the whole corpse up in the air.
const LYING = /^(die|dead)(_prone)?$/;
export function groundCurve(scratch, clipName, n = 24, stride = 2) {
  const c = scratch.clip(clipName); if (!c) return null;
  const meshes = []; scratch.object.traverse(o => { if (o.isSkinnedMesh && (/^LOD1/.test(o.name) || /headgear/.test(o.name))) meshes.push(o); });
  const lists = LYING.test(clipName) ? meshes.map((m) => bodyVertexList(m, stride)) : null;
  const a = scratch.setAnim(clipName, { fade: 0, loop: false }); const lift = new Float32Array(n + 1);
  for (let k = 0; k <= n; k++) {
    a.time = c.duration * k / n; scratch.mixer.update(0); scratch.object.updateMatrixWorld(true);
    let ymin = 9;
    meshes.forEach((m, i) => { ymin = Math.min(ymin, lists ? skinnedMinY(m, { list: lists[i] }) : skinnedMinY(m, { stride })); });
    lift[k] = Math.max(0, 0.004 - ymin);
  }
  return { dur: c.duration, lift };
}
const sampleCurve = (G, t) => { const u = THREE.MathUtils.clamp(t / G.dur, 0, 1) * (G.lift.length - 1), i = Math.floor(u), f = u - i; return G.lift[i] + ((G.lift[Math.min(i + 1, G.lift.length - 1)] - G.lift[i]) * f); };

// seat / water clips are not clamped; loops get one constant lift (lowest sole on the ground, no bob flattening), one-shots a curve
const NO_CLAMP = new Set(['sit', 'drive', 'sit_enter', 'sit_exit', 'swim', 'swim_idle', 'dive', 'climb']);
function groundFor(h, name) {
  const C = h._ground; if (!C || NO_CLAMP.has(name)) return null;
  if (!(name in C)) {
    const loop = (h._rt.lib.meta[name] || {}).loop !== false && !/^(die|dead)$/.test(name) || name === 'dead';
    const G = h._rt.scratch.clip(name) ? groundCurve(h._rt.scratch, name, loop ? 12 : 24) : null;
    if (G && loop) { const m = Math.min(name === 'dead' ? 0.4 : 0.06, Math.max(...G.lift)); G.lift = new Float32Array([m, m]); }
    C[name] = G;
  }
  return C[name];
}
// The lift is re-applied on top of the CLEAN mixer value every frame. THREE's PropertyMixer only writes a bone value when the
// blended result changes, so once a clip holds a still pose (die end, dead, one-shot ends) the pelvis keeps what we wrote last
// frame; adding to it again made corpses rise into the sky (91 m after 10 s). Object-space offset, no matrixWorld update.
function groundClamp(h) {
  const p = h.bones.pelvis, gc = h._gc || (h._gc = { clean: V(), out: V(), on: false, q: Q(), d: V() });
  if (gc.on && p.position.equals(gc.out)) p.position.copy(gc.clean);   // mixer did not write this frame: undo our last lift
  gc.clean.copy(p.position); gc.on = false;
  const G = h._holdClip && groundFor(h, h._holdClip); if (!G || !h._holdAction) return;
  const lift = sampleCurve(G, h._holdAction.time) * Math.min(1, h._holdAction.getEffectiveWeight() * 1.5); if (lift <= 1e-5) return;
  let sc = 1; gc.q.identity();
  for (let o = p.parent; o && o !== h.object; o = o.parent) { gc.q.premultiply(o.quaternion); sc *= o.scale.y; }
  p.position.add(gc.d.set(0, lift / sc, 0).applyQuaternion(gc.q.invert()));
  gc.out.copy(p.position); gc.on = true;
}

function strideWarp(h) {
  const k0 = STRIDE[h._holdClip]; if (!k0 || !h._holdAction) return;
  const k = 1 - (1 - k0) * h._holdAction.getEffectiveWeight(), B = h.bones;
  updBones(h);
  const fwd = V().set(0, 0, 1).applyQuaternion(h.object.getWorldQuaternion(Q()));
  for (const s of ['l', 'r']) {
    const hip = wpos(B['thigh_' + s]), ft = wpos(B['foot_' + s]);
    const tgt = ft.clone().addScaledVector(fwd, -ft.clone().sub(hip).dot(fwd) * (1 - k));
    twoBoneIK(B['thigh_' + s], B['calf_' + s], B['foot_' + s], tgt);
  }
}

// running: head nodded 7 deg forward (weighted by the clip's fade) - on the UAL jog / re-synthesised runs the head tips
// back at the end of the stride and the M35 rear skirt dipped 26-30 mm into the collar / satchel strap (engineer_v04)
const RUNS = new Set(['run', 'run_slow', 'run_fast', 'sprint']);
const _nq = new THREE.Quaternion(), _nq2 = new THREE.Quaternion(), _nax = new THREE.Vector3();
function runNod(h) {
  if (!RUNS.has(h._holdClip) || !h._holdAction) return;
  const w = h._holdAction.getEffectiveWeight(); if (w <= 0) return;
  const hb = h.bones.Head; updBones(h);
  _nax.set(1, 0, 0).applyQuaternion(h.object.getWorldQuaternion(_nq));      // unit's left = nod axis (world)
  hb.parent.getWorldQuaternion(_nq2).invert(); _nax.applyQuaternion(_nq2).normalize();   // -> head parent space
  hb.quaternion.premultiply(_nq.setFromAxisAngle(_nax, THREE.MathUtils.degToRad(7) * w));
}

// ---------------- draw calls: headgear merged into LOD1/LOD2 ----------------
// The helmet/cap is its own mesh (hideable), i.e. +1 draw call and +1 shadow call per soldier at every zoom. At LOD1/LOD2
// (the game zooms) it is drawn inside the body mesh: per template the LOD geometry + headgear geometry are merged once
// (same skin, same atlas material). Hiding the headgear (h.show('headgear', false)) swaps the plain LOD geometry back.
function mergedGeom(a, b) {   // same attribute set on both (missing ones zero-filled), both indexed or both not
  const names = [...new Set([...Object.keys(a.attributes), ...Object.keys(b.attributes)])];
  const prep = (g) => {
    let c = g.clone(); c.morphAttributes = {};
    if (!!a.index !== !!b.index && c.index) c = c.toNonIndexed();
    for (const n of names) if (!c.attributes[n]) { const o = a.attributes[n] || b.attributes[n];
      c.setAttribute(n, new THREE.BufferAttribute(new o.array.constructor(c.attributes.position.count * o.itemSize), o.itemSize, o.normalized)); }
    return c;
  };
  return mergeGeometries([prep(a), prep(b)], false);
}
export function mergeHeadgearLODs(h, cache) {
  const hg = h.parts.headgear; if (!hg || !hg.isSkinnedMesh) return false;
  const lods = ['LOD1', 'LOD2'].map(n => h.parts[n]).filter(m => m && m.isSkinnedMesh && m.skeleton === hg.skeleton && m.material === hg.material);
  if (!lods.length) return false;
  cache.hgMerged = cache.hgMerged || {};
  const orig = {}, merged = {};
  for (const m of lods) {
    if (!cache.hgMerged[m.name]) { try { cache.hgMerged[m.name] = mergedGeom(m.geometry, hg.geometry); } catch (e) { cache.hgMerged[m.name] = null; } }
    if (!cache.hgMerged[m.name]) continue;
    orig[m.name] = m.geometry; merged[m.name] = cache.hgMerged[m.name]; m.geometry = merged[m.name];
  }
  if (!Object.keys(merged).length) return false;
  let lod = 'LOD0', hgOn = true;
  const sync = () => { for (const [n, g] of Object.entries(merged)) h.parts[n].geometry = hgOn ? g : orig[n]; hg.visible = hgOn && (lod === 'LOD0' || !merged[lod]); };
  const setLOD0 = h.setLOD.bind(h), show0 = h.show.bind(h);
  h.setLOD = (name) => { setLOD0(name); lod = name; sync(); };
  h.show = (part, v) => { show0(part, v); if (part && ('headgear'.includes(part) || part.includes('headgear'))) hgOn = v; sync(); };
  sync();
  return true;
}

// ---------------- props (own work, CC0) ----------------
const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...o });
function makeProps() {
  const det = new THREE.Group(); det.name = 'prop_detonator';
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.15), M(0x3b3a2c, { roughness: 0.8 })); box.position.y = 0.065; det.add(box);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 8), M(0x777777, { metalness: 0.8, roughness: 0.4 })); rod.name = 'rod'; det.add(rod);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.2, 8), M(0x2a1d12)); bar.rotation.z = Math.PI / 2; bar.name = 'bar'; det.add(bar);
  for (const s of [-1, 1]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.02, 8), M(0x8a7a50, { metalness: 0.7 })); t.position.set(s * 0.06, 0.14, 0.03); det.add(t); }
  const bino = new THREE.Group(); bino.name = 'prop_binoculars';
  for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.11, 12), M(0x1a1a18, { roughness: 0.5 })); b.rotation.x = Math.PI / 2; b.position.x = s * 0.031; bino.add(b); }
  const br = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.018, 0.05), M(0x1a1a18)); bino.add(br);
  const cig = new THREE.Group(); cig.name = 'prop_cigarette';
  const pa = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.07, 8), M(0xeeeae0, { roughness: 0.9 })); pa.rotation.z = Math.PI / 2; pa.position.x = 0.035; cig.add(pa);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0044, 0.0044, 0.006, 8), M(0x331100, { emissive: 0xff5a10, emissiveIntensity: 1.5 })); tip.rotation.z = Math.PI / 2; tip.position.x = 0.071; cig.add(tip);
  for (const g of [det, bino, cig]) { g.visible = false; g.traverse(o => { if (o.isMesh) o.castShadow = true; }); }
  return { det, bino, cig };
}

function solveProps(h) {
  const P = h._props, B = h.bones, clip = h._holdClip; if (!P) return;
  P.det.visible = clip === 'detonate'; P.bino.visible = clip === 'binoculars' && !(h.info.kit || []).includes('binoculars');
  P.cig.visible = clip === 'smoke';
  if (!P.det.visible && !P.bino.visible && !P.cig.visible) return;   // perf: no matrix update when no prop is out
  updBones(h);
  if (P.det.visible) {   // box fixed in object space; plunger bar follows the hands
    P.det.position.set(h._detXZ ? h._detXZ[0] : 0, 0, h._detXZ ? h._detXZ[1] : 0.42);
    P.det.updateMatrixWorld(true);
    const mid = P.det.worldToLocal(palm(B, 'l').lerp(palm(B, 'r'), 0.5));
    const top = THREE.MathUtils.clamp(mid.y - 0.012, 0.15, 0.36);
    const rod = P.det.getObjectByName('rod'), bar = P.det.getObjectByName('bar');
    rod.scale.y = top - 0.12; rod.position.set(0, 0.12 + (top - 0.12) / 2, 0); bar.position.set(0, top, 0);
  }
  if (P.bino.visible) {   // at the eyes, then both palms onto the barrels
    const hq = B.Head.getWorldQuaternion(Q()).multiply(h.object.getWorldQuaternion(Q()).multiply(h._bind.headQ).invert());
    const hf = V().set(0, 0, 1).applyQuaternion(h.object.getWorldQuaternion(Q())).applyQuaternion(hq);
    const eye = h._bind.eyeHead.clone().applyMatrix4(B.Head.matrixWorld);
    const hl = V().set(1, 0, 0).applyQuaternion(h.object.getWorldQuaternion(Q())).applyQuaternion(hq);
    const c = eye.addScaledVector(hl, 0.032).addScaledVector(hf, 0.085);
    const m = new THREE.Matrix4().lookAt(c.clone().add(hf), c, V().crossVectors(hf, hl)).setPosition(c);
    m.premultiply(h.object.matrixWorld.clone().invert()); m.decompose(P.bino.position, P.bino.quaternion, P.bino.scale);
    P.bino.updateMatrixWorld(true);
    for (const [s, sx] of [['l', 1], ['r', -1]]) {
      const tg = c.clone().addScaledVector(hl, sx * 0.045).addScaledVector(hf, 0.005).addScaledVector(V().crossVectors(hf, hl), 0.0);
      const off = palm(B, s).sub(wpos(B['hand_' + s]));
      twoBoneIK(B['upperarm_' + s], B['lowerarm_' + s], B['hand_' + s], tg.sub(off));
    }
  }
  if (P.cig.visible) {   // between index and middle finger, pointing out across the hand
    const a = wpos(B.index_02_r).lerp(wpos(B.middle_02_r), 0.5), dir = wpos(B.index_02_r).sub(wpos(B.ring_02_r)).normalize();
    const z = V().crossVectors(dir, V().set(0, 1, 0)).normalize(), y = V().crossVectors(z, dir);
    const m = new THREE.Matrix4().makeBasis(dir, y, z).setPosition(a.addScaledVector(dir, -0.01));
    m.premultiply(h.object.matrixWorld.clone().invert()); m.decompose(P.cig.position, P.cig.quaternion, P.cig.scale);
  }
}

// install on a created humanoid: clip bookkeeping, ground curves (from `scratch`, a second instance of the same template), props
export function installRuntime(h, scratch, cache, lib) {
  cache.scratch = scratch; cache.lib = lib || cache.lib;
  const orig = h.setAnim;
  const AIMY = /^(rifle_aim|rifle_fire|rifle_reload)$/;
  const play = (name, o, src) => { const a = orig(name, o); if (a) { h._holdClip = name; h._holdAction = a; h._requested = src; } return a; };
  h.setAnim = (name, o = {}) => {
    const src = name, alias = (h.clipAlias || {})[name]; if (alias && h.clip(alias)) name = alias;
    if (o.speed != null && GAIT[name]) for (const [n, lim] of GAIT[name]) if (o.speed < lim) { if (h.clip(n)) name = n; break; }
    h._pending = null;
    if (/^(die|dead)$/.test(name) && o.fade == null) o = { ...o, fade: 0.35 };
    // shouldering / lowering a long gun: 0.35 s (a 0.2 s fade moved the rifle 8-9 cm per frame)
    if (o.fade == null && (AIMY.test(name) !== AIMY.test(h._holdClip || '')) && h.weapon) o = { ...o, fade: 0.35 };
    // hands clasped behind the back -> any other clip: the arm quaternions are ~180 deg from the run/aim arms, so a direct
    // cross-fade flips mid-way (0.5-0.7 m hand jump in one frame). Unclasp through the plain idle first, then play the clip.
    if (/_hands_back$/.test(h._holdClip || '') && !/_hands_back$/.test(name) && name !== 'idle' && h.clip('idle') && (o.fade == null || o.fade > 0)) {
      const a = play('idle', { fade: 0.22 }, 'idle'); h._pending = { name, o: { ...o, fade: 0.2 }, src, at: 0.2 };
      return a;
    }
    return play(name, o, src);
  };
  h._post.push((dt) => { const P = h._pending; if (!P) return; P.at -= dt; if (P.at <= 0) { h._pending = null; play(P.name, P.o, P.src); } });
  h.autoLOD = (px) => h.setLOD(enemyLodFor(px));
  if (!cache.ground) cache.ground = {};
  // precompute ground curves at mission load (unit-model warm()): a first use mid-combat cost a hitch per variant
  h.warmGround = (names) => { for (const n0 of names) { const n = (h.clipAlias || {})[n0] || n0; if (h.clip(n)) groundFor(h, n); } };
  if (!cache.det && scratch.clip('detonate')) {
    const a = scratch.setAnim('detonate', { fade: 0, loop: false }); a.time = 1.0; scratch.mixer.update(0); scratch.object.updateMatrixWorld(true);
    const mid = palm(scratch.bones, 'l').lerp(palm(scratch.bones, 'r'), 0.5); cache.det = [mid.x, mid.z];
  }
  if (!cache.dropLoc && scratch.clip('dead')) {   // where the dropped long gun lies: along the right forearm of the dead pose
    const a = scratch.setAnim('dead', { fade: 0 }); a.time = 0; scratch.mixer.update(0); scratch.object.updateMatrixWorld(true);
    const pr = palm(scratch.bones, 'r'), el = wpos(scratch.bones.lowerarm_r); cache.dropLoc = [pr.x * 0.6 + el.x * 0.4 - 0.08, pr.z * 0.6 + el.z * 0.4 + 0.1];
  }
  h._ground = cache.ground; h._rt = cache; h._detXZ = cache.det; h._bind = h._bind || bindInfo(h);
  const P = makeProps(); h._props = P; h.object.add(P.det, P.bino, P.cig);
  h._post.unshift(() => { groundClamp(h); strideWarp(h); runNod(h); });
  h._post.push(() => solveProps(h));
  // corpse footprint: after die the pelvis ends 0.45-0.6 m from the unit origin, so pick-up range, the 'body found'
  // test and carry attach must use this (world x/z of the pelvis on the ground), not h.object.position
  h.bodyPosition = (out = V()) => { h.object.updateMatrixWorld(true); const p = wpos(h.bones.pelvis); return out.set(p.x, h.object.position.y, p.z); };
  perfSetup(h);
  h._hgMerged = mergeHeadgearLODs(h, cache);
  return h;
}
