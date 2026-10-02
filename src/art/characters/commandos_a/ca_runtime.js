// Copied from scratchpad chars/commandos_a/web/ca_runtime.js by tools/characters/consolidate/copy_runtime.py (imports/URLs rewritten; moved to src/art/characters in art integration 2). CC0 project code.
// ca_runtime.js - commandos_a runtime overlay on top of charkit.js + weapons.js (CC0 project code).
//  loadCALib()            shared anims.glb (+ enemy/guest libs) with the userData fix, then commandos_a/out/ca_anims.glb
//                         clips REPLACE same-named shared clips (walk, run, crawl, crawl_idle, kneel_shoot, drag, die, dead, ...)
//  createCommando(tpl,lib,opts)  = charkit.createHumanoid + prone-aware deaths (die -> die_prone / dead -> dead_prone
//                         when the last pose was prone) + stored anim name for the weapon rig
//  equipCA(h, W, name)    = weapons.equip + per-frame long-gun SHOULDER RIG (butt in the shoulder pocket, bore along the
//                         facing, cheek weld by neck/head CCD, right hand on the wrist of the stock, left hand under the
//                         fore-end, pole-vector two-bone IK) instead of the setAnim-time pistol-style solve.
import * as THREE from 'three';
import { skinnedMinY } from '../skin-min.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { loadAnimLibrary, createHumanoid } from '../pipeline/charkit.js';
import { equip, HOLD, twoBoneIK } from '../pipeline/weapons.js';
import { wpos, wquat, setWorldQuat, twoBoneIKPole, handQuat, palmPoint, rotWorld } from './ca_ik.js';
import { isProneHold } from '../prone-grips.js';

export const CA_ANIMS = new URL('../../../../assets/characters/anims/ca_anims.glb', import.meta.url).href;
const LONG = new Set(['kar98k', 'mp40', 'mg34', 'mg42', 'no4_sniper', 'thompson', 'harpoon_gun']);
// prone clips (docs/crawl-animation.md): the low crawl + variants, prone idle / aim / shoot / pistol / turns, prone death
const PRONE = { has: (n) => /^(crawl|prone_|die_prone$|dead_prone$)/.test(n || '') };
// clips that never get a standing<->prone transition (water, deaths, vehicles, carried, the UAL supine get-up)
const NO_TR = new Set(['swim', 'swim_idle', 'dive', 'die', 'dead', 'die_prone', 'dead_prone', 'carried', 'stand_up', 'drive', 'sit', 'climb']);
HOLD.go_prone = 'back'; HOLD.get_up = 'back';

function fixLib(lib) {
  let ud = lib.gltf.scene.userData.shadowSix || null;
  if (!ud || !ud.clips) lib.gltf.scene.traverse(o => { if (!ud && o.userData && o.userData.shadowSix) ud = o.userData.shadowSix; });
  if (!ud) return lib;
  Object.assign(lib.meta, ud.clips || {}); if (ud.pelvisRest) lib.srcPelvisRest = new THREE.Vector3(...ud.pelvisRest);
  return lib;
}
export async function loadCALib({ shared = new URL('../../../../assets/characters/anims/base_anims.glb', import.meta.url).href, extra = [new URL('../../../../assets/characters/anims/enemy_anims.glb', import.meta.url).href, new URL('../../../../assets/characters/anims/guest_anims.glb', import.meta.url).href], overlay = CA_ANIMS } = {}) {
  const lib = fixLib(await loadAnimLibrary(shared));
  for (const u of extra) {
    try { const ex = fixLib(await loadAnimLibrary(u)); for (const [k, c] of ex.clips) if (!lib.clips.has(k)) lib.clips.set(k, c); for (const [k, m] of Object.entries(ex.meta)) if (!lib.meta[k]) lib.meta[k] = m; }
    catch (e) { /* optional */ }
  }
  const ov = fixLib(await loadAnimLibrary(overlay));
  for (const [k, c] of ov.clips) { lib.clips.set(k, c); lib.meta[k] = ov.meta[k] || { loop: true }; }
  lib.overlay = [...ov.clips.keys()];
  // the shared UAL 'sprint' has ~4.5 m/s stance slip (stylized jog); route it to the fixed overlay run so no caller gets it
  if (ov.clips.has('run')) { lib.clips.set('sprint', ov.clips.get('run')); lib.meta.sprint = lib.meta.run; }
  return lib;
}

export function createCommando(tpl, lib, opts = {}) {
  const h = createHumanoid(tpl, lib, opts); h._tpl = tpl;
  const clipBase = h.clip;
  h.clip = (name) => { const c = clipBase(name); if (c && GROUND[name] != null) groundClip(tpl, name, c); return c; };
  const base = h.setAnim;
  h._animName = null; h._prone = false; h._acts = new Map(); h._queued = null;
  h.ownTransitions = true;   // go_prone / get_up handled here (unit-model does not insert them again)
  const play = (n, o) => { const a = base(n, o); if (a) { h._acts.set(a, n); h._clipName = n; h._clipAct = a; } return a; };
  // progress of the current go_prone / get_up transition (0..1)
  const trProg = () => { const a = h._clipAct; return a ? a.time / a.getClip().duration : 1; };
  const proneNow = () => h._clipName === 'go_prone' ? trProg() > 0.5 : h._clipName === 'get_up' ? trProg() < 0.5 : PRONE.has(h._clipName);
  h.setAnim = (name, o = {}) => {
    const snapTo = o.fade === 0 || o.transition === false;   // instant set (spawn, tests): no transition clip
    if (snapTo) h._queued = null;
    if (h._queued) {                               // a transition is playing toward `name`: keep it (callers re-issue every frame)
      if (name === h._queued.name) { h._queued.o = o; return h._clipAct; }
      h._queued = null;
    }
    const prone = proneNow();
    let n = name;
    if (name === 'die' && prone && lib.clips.has('die_prone')) n = 'die_prone';
    if (name === 'dead' && prone && lib.clips.has('dead_prone')) n = 'dead_prone';
    // standing <-> prone goes through an authored transition (drop to the knee, hands down, legs back) instead of a
    // 0.2 s cross-fade; the requested clip follows automatically when the transition ends
    const tr = snapTo || h._animName == null ? null
      : PRONE.has(n) && !prone && !NO_TR.has(h._clipName) ? 'go_prone'
      : !PRONE.has(n) && prone && !NO_TR.has(n) && h._clipName !== 'get_up' ? 'get_up' : null;
    if (tr && tr === h._clipName) { h._queued = { name: n, o, tr }; h._animName = name; h._prone = PRONE.has(n); return h._clipAct; }
    if (tr && lib.clips.has(tr) && n !== h._clipName) {
      // into go_prone quickly: its frame 0 is the standing idle, and a long cross-fade from the standing foot to the kneeling
      // one dipped the toes 13 cm into the ground (review)
      // played over the game's stance-change time when the host sets h.trDur (unit-model: CONFIG.units.stanceDown / Up)
      const want = h.trDur && h.trDur[tr], dur = h.clip(tr)?.duration;
      const a = play(tr, { loop: false, fade: h._clipName === 'go_prone' || h._clipName === 'get_up' ? 0.25 : tr === 'go_prone' ? 0.08 : 0.1,
        timeScale: want && dur ? dur / want : 1 });
      h._queued = { name: n, o, tr }; h._animName = name; h._prone = PRONE.has(n);
      return a;
    }
    const a = play(n, o);
    h._animName = name; h._prone = PRONE.has(n);
    return a;
  };
  const baseUpdate = h.update;
  h.update = (dt) => {
    const q = h._queued, a = h._clipAct;
    if (q && a && a.time + dt * a.getEffectiveTimeScale() >= a.getClip().duration - 1e-4) {   // transition done: hand over
      h._queued = null; play(q.name, { ...q.o, fade: 0.1 });
      if (h._onClipSwap) h._onClipSwap(q.name);   // weapon hold of the clip that now plays (go_prone kept the gun slung)
    }
    baseUpdate(dt);
  };
  // eye (right) in Head-bone space, from the build's eye landmarks (Blender coords -> three: x, z, -y) and bind pose
  const info = h.info || {};
  if (info.eyeR) {
    const sk = Object.values(h.parts).find(p => p.isSkinnedMesh).skeleton;
    const i = sk.bones.findIndex(b => b.name === 'Head');
    const e = new THREE.Vector3(info.eyeR[0], info.eyeR[2], -info.eyeR[1]);
    h._eyeInHead = e.applyMatrix4(sk.boneInverses[i]);
  }
  return h;
}

// ---------------- per-character grounding of lying clips ----------------
// Clips are grounded on the UAL skeleton; MPFB bodies + kit differ in thickness, so lying poses can sink a few cm.
// Once per template+clip: sample the clip on a scratch clone, min skinned-vertex height of LOD2 per frame -> smoothed
// lift added to the pelvis track (value = ramp start: 'die' lifts only while falling, standing frames untouched).
// (the prone set itself is fitted per body by prone-fit.js when pipeline/charkit adapts it: belly, elbows, legs)
const GROUND = { dead: 0, die: 0.45, go_prone: 0, get_up: 0 };
const _v = new THREE.Vector3();
function groundClip(tpl, name, clip) {
  tpl._grounded = tpl._grounded || new Set(); if (tpl._grounded.has(name)) return; tpl._grounded.add(name);
  const root = SkeletonUtils.clone(tpl.gltf.scene); let mesh = null, pel = null;
  root.traverse(o => { if (o.isSkinnedMesh && /^LOD2/.test(o.name)) mesh = o; if (o.isBone && o.name === 'pelvis' && !pel) pel = o; });
  if (!mesh || !pel) return;
  const mixer = new THREE.AnimationMixer(root); mixer.clipAction(clip).play();
  const fps = 30, n = Math.max(2, Math.round(clip.duration * fps) + 1), lift = new Float32Array(n), N = mesh.geometry.attributes.position.count;
  for (let f = 0; f < n; f++) {
    mixer.setTime(Math.min(f / fps, clip.duration - 1e-4)); root.updateMatrixWorld(true);
    const m = skinnedMinY(mesh);
    const r = GROUND[name] ? Math.min(1, (f / fps) / (GROUND[name] * clip.duration)) : 1;
    lift[f] = Math.max(0, -0.008 - m) * r;
  }
  const mx = lift.map((_, f) => Math.max(...lift.slice(Math.max(0, f - 3), f + 4)));
  const sm = mx.map((_, f) => { const a = mx.slice(Math.max(0, f - 2), f + 3); return a.reduce((x, y) => x + y, 0) / a.length; });
  const out = sm.map((v, f) => Math.max(v, lift[f]));
  if (Math.max(...out) < 1e-3) return;
  const par = pel.parent; const p0 = pel.getWorldPosition(new THREE.Vector3());
  const up = par.worldToLocal(p0.clone().add(new THREE.Vector3(0, 1, 0))).sub(par.worldToLocal(p0.clone()));
  const tr = clip.tracks.find(t => t.name === 'pelvis.position'); if (!tr) return;
  for (let k = 0; k < tr.times.length; k++) {
    const f = Math.min(n - 1, Math.round(tr.times[k] * fps)); const d = out[f];
    tr.values[k * 3] += up.x * d; tr.values[k * 3 + 1] += up.y * d; tr.values[k * 3 + 2] += up.z * d;
  }
  tpl._groundLift = tpl._groundLift || {}; tpl._groundLift[name] = +Math.max(...out).toFixed(3);
  mixer.stopAllAction(); mixer.uncacheRoot(root);
}

// ---------------- long-gun shoulder rig ----------------
// weapon-local points (metres): eye target on the sight line ~14 cm ahead of the butt plate
const SIGHT = { no4_sniper: { y: 0.085, eyeZ: -0.20 }, kar98k: { y: 0.045, eyeZ: -0.20 }, harpoon_gun: { y: 0.075, eyeZ: -0.12 }, thompson: { y: 0.06, eyeZ: -0.16 }, mp40: { y: 0.06, eyeZ: -0.1 } };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FORE_MIN = { no4_sniper: 0.16, kar98k: 0.16, harpoon_gun: 0.16, thompson: 0.12, mp40: 0.05 };

export function equipCA(h, W, name, o = {}) {
  const n0 = h._post.length;
  const w = equip(h, W, name, o);
  if (!w || !LONG.has(name)) return w;
  // replace weapons.js' generic left-hand IK post with the rig (keeps its behaviour for non-aim holds)
  const ik = h._post.length > n0 ? h._post.splice(n0, 1)[0] : null;
  if (!h._caRig) {
    h._caRig = true; h._post.push((dt) => weaponPost(h, dt, ik));
    // every setAnim re-places the gun (weapons.js solve); remember the non-aim placement as the gun's HOME
    const sa = h.setAnim; h.setAnim = (n, oo) => { const a = sa(n, oo); captureHome(h, h._clipName || n); return a; };
    h._onClipSwap = (n) => { if (h.solveWeapon) h.solveWeapon(n); captureHome(h, n); };
  }
  h._home = null; h._homeBlend = null; h._wLast = null; captureHome(h, o.clip || h._animName || 'idle');
  return w;
}

// ---------------- gun placement blending ----------------
// weight of the long-gun aim: sum of the effective weights of the playing actions whose hold is 'aim' (fades with the
// mixer's cross-fade in AND out, so the shoulder rig never pops)
export function aimWeight(h) {
  let s = 0, best = 0; h._aimClip = null;
  for (const [a, n] of h._acts || []) if (HOLD[n] === 'aim' && a.enabled && a.isScheduled()) { const ew = a.getEffectiveWeight(); s += ew; if (ew > best) { best = ew; h._aimClip = n; } }
  return Math.min(1, s);
}
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
function relTo(bone, obj) { obj.updateMatrixWorld(true); return bone.matrixWorld.clone().invert().multiply(obj.matrixWorld); }
function blendM(A, Bm, t) {   // TRS blend of two world matrices
  const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3(), pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sb = new THREE.Vector3();
  A.decompose(pa, qa, sa); Bm.decompose(pb, qb, sb);
  return new THREE.Matrix4().compose(pa.lerp(pb, t), qa.slerp(qb, t), sa.lerp(sb, t));
}
function setWorldMatrix(obj, parent, M) {
  if (obj.parent !== parent) parent.add(obj);
  parent.updateMatrixWorld(true); _m.copy(parent.matrixWorld).invert().multiply(M).decompose(obj.position, obj.quaternion, obj.scale); obj.updateMatrixWorld(true);
}
function captureHome(h, clipName) {
  const w = h.weapon; if (!w || !LONG.has(h.weaponName)) return;
  if (HOLD[clipName] === 'aim') { h._homePending = null; return; }   // aim placement is the rig's job; keep the previous home
  // leaving an aim: solve's placement was made on the bladed/aiming chest - re-solve every frame from the (un-rigged)
  // mixer pose until the aim has faded out, then store it
  if (aimWeight(h) > 1e-3) { h._homePending = clipName; h._homeBlend = null; return; }
  h._homePending = null;
  w.updateMatrix();
  const prev = h._home;
  h._home = { parent: w.parent, local: w.matrix.clone(), visible: w.visible, twoHand: !!h._twoHand };
  // sling / back placements are solved from the CURRENT pose; one solved on a prone or crouched body (get_up -> idle)
  // would hang the gun sideways once he stands. Keep the placement solved on an upright body per hold and reuse it.
  const hold = isProneHold(clipName) ? 'prone' : HOLD[clipName] || 'sling', c = h._homeCache || (h._homeCache = {});   // prone: in the hands
  if (w.visible && (hold === 'sling' || hold === 'back')) {
    h.object.updateMatrixWorld(true);
    const ax = wpos(h.bones.Head).sub(wpos(h.bones.pelvis)).normalize().dot(V(0, 1, 0).applyQuaternion(wquat(h.object)));
    const key = h.weaponName + ':' + hold;
    if (ax > 0.9) c[key] = { parent: w.parent, local: h._home.local.clone() };
    else if (c[key]) { h._home.parent = c[key].parent; h._home.local = c[key].local.clone(); }
  }
  // hold changed (sling <-> back): slide the gun over 0.3 s from where it was drawn last frame
  if (h._wLast && prev && prev.visible && w.visible && !(prev.parent === w.parent && prev.local.equals(h._home.local))) h._homeBlend = { from: h._wLast.clone(), t: 0, dur: 0.3 };
}
function weaponPost(h, dt, ik) {
  const w = h.weapon; if (!w) return;
  // a hand weapon swapped in for an action (the Marine's knife): it stays in the fist where equip() put it — the
  // long-gun home (the harpoon gun's place on his back) is not its place (the knife was drawn on his back)
  if (!LONG.has(h.weaponName)) { aimRig(h, 0, null); h.aimW = 0; h._wLast = null; return; }
  const S3 = h.bones.spine_03; h.object.updateMatrixWorld(true);
  const wa = aimWeight(h);
  // home placement in world space (optionally sliding from the previous hold)
  let Hm = null;
  if (h._homePending && h.solveWeapon) {
    const pc = h._homePending; h.solveWeapon(pc); w.updateMatrixWorld(true); Hm = w.matrixWorld.clone();
    if (wa <= 1e-3) { h._homePending = null; h._wLast = null; captureHome(h, pc); }
  } else if (h._home) {
    const hp = h._home.parent; hp.updateMatrixWorld(true);
    Hm = hp.matrixWorld.clone().multiply(h._home.local);
    if (h._homeBlend) {
      const b = h._homeBlend; b.t += dt; const u = Math.min(1, b.t / b.dur), e = u * u * (3 - 2 * u);
      Hm = blendM(S3.matrixWorld.clone().multiply(b.from), Hm, e); if (u >= 1) h._homeBlend = null;
    }
  }
  h.aimW = wa;
  if (wa > 1e-3 && aimRig(h, wa, Hm)) { w.visible = wa > 0.5 || !h._home || h._home.visible; }
  else {
    aimRig(h, 0, null);   // resets the rig state / fore-end socket
    if (h._home) h._twoHand = h._home.twoHand;   // the rig set it while aiming
    if (h._home && Hm) { setWorldMatrix(w, h._home.parent, Hm); if (!h._homeBlend) { w.matrix.copy(h._home.local); w.matrix.decompose(w.position, w.quaternion, w.scale); w.updateMatrixWorld(true); } w.visible = h._home.visible; }
    ik && ik(dt);
  }
  h._wLast = relTo(S3, w);
}

const PS = { l: 1, r: 1 };   // palm-normal sign for UAL hands (palms face down in the bind T-pose; verified by probe)
// bones the rig writes: restore the mixer's value first when the mixer skipped the write (static clips), so the rig never
// accumulates on its own previous output (THREE.PropertyMixer only writes changed values)
const RIG_BONES = ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hand_l'];
function rigBegin(h) {
  const m = h._rigMem || (h._rigMem = {});
  for (const n of RIG_BONES) { const b = h.bones[n], r = m[n]; if (r && b.quaternion.equals(r.post)) b.quaternion.copy(r.pre); m[n] = { pre: b.quaternion.clone(), post: null }; }
  h.object.updateMatrixWorld(true);
}
function rigEnd(h) { for (const n of RIG_BONES) h._rigMem[n].post = h.bones[n].quaternion.clone(); }
const armLen = (B, s) => wpos(B['upperarm_' + s]).distanceTo(wpos(B['lowerarm_' + s])) + wpos(B['lowerarm_' + s]).distanceTo(wpos(B['hand_' + s])) + 0.06;

// elevation (deg) of the Head-joint -> right-eye vector: compare aim vs idle to see how far the head is bowed
export function eyeElev(h) { if (!h._eyeInHead) return null; h.object.updateMatrixWorld(true); const hb = h.bones.Head, E = h._eyeInHead.clone().applyMatrix4(hb.matrixWorld);
  return THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(E.sub(wpos(hb)).normalize().y, -1, 1))); }
// wa = aim weight (0..1): the full solve is computed, then the rig bones are slerped from the mixer pose by wa and the gun
// is blended from its home placement Hm (world matrix; sling/back) to the shouldered placement by wa
export function aimRig(h, wa = 1, Hm = null) {
  const w = h.weapon;
  if (!w || !LONG.has(h.weaponName) || !(wa > 0)) {   // restore the authored fore-end socket for other holds
    if (w && w.userData._gl0 && w.userData.sockets.grip_l) { w.userData.sockets.grip_l.position.copy(w.userData._gl0); w.userData.sockets.grip_l.updateMatrixWorld(true); }
    h._rigMem = null; return false; }
  const B = h.bones, s = w.userData.sockets; rigBegin(h);
  const rq = wquat(h.object), F = V(0, 0, 1).applyQuaternion(rq), Up = V(0, 1, 0).applyQuaternion(rq), Lf = V(1, 0, 0).applyQuaternion(rq);
  const pitch = THREE.MathUtils.degToRad(h.aimPitch || 0);
  const D = F.clone().applyAxisAngle(Lf, -pitch).normalize();
  const sc = w.scale.x || 1;
  const y = Up.clone().addScaledVector(D, -Up.dot(D)).normalize(), x = new THREE.Vector3().crossVectors(y, D);
  const Qw = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, D));
  const butt = s.butt ? s.butt.position.clone() : V(0, 0, -0.3);
  const gl0 = s.grip_l ? (w.userData._gl0 || (w.userData._gl0 = s.grip_l.position.clone())).clone() : null;
  // the support hand may hold anywhere on the fore-end: from grip_l back to FORE_MIN (weapon-local z) - the rig picks the
  // most forward point the left arm reaches after blading (real No.4 / harpoon holds sit 0.18-0.34 m ahead of the trigger)
  const zMin = gl0 ? Math.min(gl0.z, FORE_MIN[h.weaponName] ?? gl0.z - 0.12) : 0;
  const place = (lift = 0) => {   // butt in the shoulder pocket (front of the joint between clavicle and humeral head)
    const pocket = wpos(B.upperarm_r).lerp(wpos(B.clavicle_r), 0.45).addScaledVector(F, 0.045).addScaledVector(Up, -0.005 + lift);
    const pos = pocket.clone().sub(butt.clone().multiplyScalar(sc).applyQuaternion(Qw));
    return { pocket, pos, gL: gl0 ? gl0.clone().multiplyScalar(sc).applyQuaternion(Qw).add(pos) : null };
  };
  // 1) blade the torso (left shoulder forward, turning about the spine) until the support hand can reach the fore-end
  let P = place(); const reachL = armLen(B, 'l') * 0.93; h.blade = 0;
  for (let i = 0; i < 8 && (i < 6 || (P.gL && wpos(B.upperarm_l).distanceTo(P.gL) > reachL)); i++) {   // >= 29 deg blade: brings the head over the stock
    const q = new THREE.Quaternion().setFromAxisAngle(Up, -THREE.MathUtils.degToRad(1.6));
    for (const bn of ['spine_01', 'spine_02', 'spine_03']) rotWorld(B[bn], q);
    h.blade += 4.8; P = place();
  }
  // butt high in the shoulder: raise the stock by ~half the eye-above-sight height (max 5 cm) so the head only has to
  // drop the rest (a low-comb stock + neck-only weld bowed the head ~45 deg)
  const sg = SIGHT[h.weaponName] || { y: 0.06, eyeZ: -0.15 }; let lift = 0;
  if (h._eyeInHead) { const E0 = h._eyeInHead.clone().applyMatrix4(B.Head.matrixWorld), t0 = V(0, sg.y + 0.012, sg.eyeZ).multiplyScalar(sc).applyQuaternion(Qw).add(P.pos);
    lift = THREE.MathUtils.clamp((E0.clone().sub(t0).dot(Up)) * 0.5, 0, 0.05); if (lift > 0.002) P = place(lift); }
  h.buttLift = lift;
  let gz = gl0 ? gl0.z : 0;
  if (gl0) { const sh = wpos(B.upperarm_l), wz = (z) => V(gl0.x, gl0.y, z).multiplyScalar(sc).applyQuaternion(Qw).add(P.pos);
    while (gz - 0.01 >= zMin && sh.distanceTo(wz(gz)) > reachL) gz -= 0.01; }
  h.gripZ = gz; if (gl0) { s.grip_l.position.set(gl0.x, gl0.y, gz); }   // the socket follows the hold (metrics, VFX)
  if (w.parent !== B.spine_03) B.spine_03.attach(w);
  const M = new THREE.Matrix4().compose(P.pos, Qw, V(sc, sc, sc)).premultiply(B.spine_03.matrixWorld.clone().invert());
  M.decompose(w.position, w.quaternion, w.scale); w.updateMatrixWorld(true);
  const toW = (p) => w.localToWorld(p.clone());
  // 2) cheek weld: CCD on neck_01 + Head to put the right eye on the sight line
  if (h._eyeInHead) {
    const tgt = toW(V(0, sg.y + 0.012, sg.eyeZ));
    for (let it = 0; it < 8; it++) for (const [bn, lim] of [['neck_01', 0.3], ['Head', 0.3]]) {
      const b = B[bn], J = wpos(b), E = h._eyeInHead.clone().applyMatrix4(B.Head.matrixWorld);
      const a = E.clone().sub(J).normalize(), c = tgt.clone().sub(J).normalize();
      let q = new THREE.Quaternion().setFromUnitVectors(a, c); const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
      if (ang > lim * 0.5) q = new THREE.Quaternion().slerp(q, lim * 0.5 / ang);
      rotWorld(b, q);
    }
    h.eyeErr = h._eyeInHead.clone().applyMatrix4(B.Head.matrixWorld).distanceTo(tgt);
    h.headPitch = eyeElev(h);
    if (s.scope) h.eyeToSight = h._eyeInHead.clone().applyMatrix4(B.Head.matrixWorld).distanceTo(toW(V(0, sg.y, s.scope.position.z - 0.14)));
  }
  // 3) right hand on the wrist of the stock (fingers forward-down, palm toward the stock), elbow out and down
  const gR = toW(s.grip_r ? s.grip_r.position : V(0, 0, 0));
  const qR = handQuat(B, 'r', PS.r, D.clone().multiplyScalar(0.55).addScaledVector(y, -0.8), x.clone());
  h.ikErrR = solveArm(B, 'r', gR, qR, P.pocket.clone().addScaledVector(Lf, -0.45).addScaledVector(Up, -0.3).addScaledVector(F, -0.1));
  // 4) left hand under the fore-end (palm up, fingers forward-right); elbow below the gun - on the left knee when kneeling
  if (s.grip_l) {
    const gL = toW(V(s.grip_l.position.x, s.grip_l.position.y - 0.012, gz)); h._gripLW = gL.clone();
    const qL = handQuat(B, 'l', PS.l, D.clone().multiplyScalar(0.7).addScaledVector(x, -0.7), y.clone());
    const pole = (h._aimClip || h._animName) === 'kneel_shoot' ? wpos(B.calf_l).addScaledVector(Up, -0.3) : gL.clone().addScaledVector(Up, -0.6).addScaledVector(Lf, 0.25).addScaledVector(F, -0.25);
    h.ikError = solveArm(B, 'l', gL, qL, pole);
    h._twoHand = true;
  }
  if (wa < 0.999) blendRig(h, wa, Hm);
  h.aimW = wa;
  rigEnd(h);
  return true;
}
function blendRig(h, wa, Hm) {
  const B = h.bones, w = h.weapon, m = h._rigMem;
  const local = relTo(B.spine_03, w);                     // shouldered gun relative to the (fully rigged) chest
  for (const n of RIG_BONES) { const post = B[n].quaternion.clone(); B[n].quaternion.copy(m[n].pre).slerp(post, wa); }
  h.object.updateMatrixWorld(true);
  const Aim = B.spine_03.matrixWorld.clone().multiply(local);
  setWorldMatrix(w, B.spine_03, Hm ? blendM(Hm, Aim, wa) : Aim);
}
// put the palm point of hand s at `g` with world rotation q, elbow toward `pole`; returns palm error (m)
function solveArm(B, s, g, q, pole) {
  const hand = B['hand_' + s];
  const off = palmPoint(B, s, PS[s], 0.022).sub(wpos(hand)).applyQuaternion(wquat(hand).invert()).applyQuaternion(q);
  for (let i = 0; i < 2; i++) twoBoneIKPole(B['upperarm_' + s], B['lowerarm_' + s], hand, g.clone().sub(off), pole, q);
  return palmPoint(B, s, PS[s], 0.022).distanceTo(g);
}
