// Copied from scratchpad chars/enemies/web/enemy_weapons.js by tools/characters/consolidate/copy_runtime.py (imports/URLs rewritten; moved to src/art/characters in art integration 2). CC0 project code.
// enemy_weapons.js - enemy weapon holds solved EVERY frame after the mixer (fixes the stale-pose solve in pipeline weapons.js)
//  long guns (kar98k, mg34, mp40, ...):
//    aim   - shouldered: butt in the right shoulder pocket, bore under the right eye, pointing along the unit's facing
//            (pitch follows the head); right palm IK'd to grip_r, left palm IK'd to the fore-stock support point
//    low   - reload: butt at the right hip, muzzle 25 deg down and across the body; right hand cycles the bolt
//    sling - right shoulder, muzzle up, in the CHEST frame (follows torso lean);  back - flat on the back
//    drop  - die/dead/surrender: carried in the right hand while falling, then lying on the ground beside the body
//  hand guns (luger, walther_p38): in the right hand for aim/shoot/pistol_idle/reload, otherwise holstered (hidden)
import * as THREE from 'three';
import { twoBoneIK } from '../pipeline/weapons.js';
import { updBones } from './enemy_runtime.js';
import { proneGrip } from '../prone-grips.js';

export const LONG = new Set(['kar98k', 'mp40', 'mg34', 'mg42', 'no4_sniper', 'thompson', 'harpoon_gun']);
// per gun: hold mode for 'aim' + support-hand point (weapon local; +Z muzzle, +Y up). Kar98k: palm under the fore-stock
// (the socket at z .34 is out of an arm's reach once the butt is in the shoulder); MG34 standing: under the barrel jacket
const GUN = {
  kar98k: { aim: 'shoulder', support: [0, -0.035, 0.25] }, no4_sniper: { aim: 'shoulder', support: [0, -0.035, 0.25] },
  mg34: { aim: 'shoulder', support: [0, -0.006, 0.28] }, mg42: { aim: 'shoulder', support: [0, -0.006, 0.28] },   // palm on the jacket underside (was a fist 3 cm below it)
  mp40: { aim: 'chest', support: [0, -0.035, 0.18] },     // stock folded on the model: fired from the chest, left hand on the magazine housing
  thompson: { aim: 'shoulder', support: [0, -0.06, 0.22] }, harpoon_gun: { aim: 'shoulder', support: [0, -0.02, 0.26] },
};
export const HOLD_E = { aim: 'aim', rifle_aim: 'aim', shoot: 'aim', rifle_shoot: 'aim', rifle_fire: 'aim', aim_up: 'aim', aim_down: 'aim', kneel_shoot: 'aim',
  reload: 'low', rifle_reload: 'low', die: 'drop', dead: 'drop', surrender: 'drop', handsup_held: 'drop', sit: 'back', drive: 'back', detonate: 'back',
  die_prone: 'drop', dead_prone: 'drop', go_prone: 'back', get_up: 'back' };   // crawl* / prone_*: hand grips of prone-grips.js
const HAND_CLIPS = ['aim', 'shoot', 'pistol_idle', 'reload'];

const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const wpos = (o) => o.getWorldPosition(V());
// perf: read world data straight from matrixWorld (valid after updBones; getWorld* re-composes every ancestor per call)
const _dp = new THREE.Vector3(), _ds = new THREE.Vector3();
const wpf = (o) => V().setFromMatrixPosition(o.matrixWorld), wqf = (o) => { const q = Q(); o.matrixWorld.decompose(_dp, q, _ds); return q; };
const palm = (B, s) => wpos(B['hand_' + s]).lerp(wpos(B['middle_01_' + s]), 0.55);

// bind-pose data from the skinned mesh: head/chest bind rotations + right-eye offset in head space
export function bindInfo(h) {
  const sm = Object.values(h.parts).find(m => m.isSkinnedMesh && m.name.startsWith('LOD0')) || Object.values(h.parts).find(m => m.isSkinnedMesh);
  const sk = sm.skeleton, idx = (n) => sk.bones.findIndex(b => b.name === n);
  const bind = (n) => new THREE.Matrix4().copy(sk.boneInverses[idx(n)]).invert().premultiply(sm.bindMatrixInverse);
  const q = (n) => new THREE.Quaternion().setFromRotationMatrix(bind(n));
  const eye = h.info.eyeR ? new THREE.Vector3(h.info.eyeR[0], h.info.eyeR[2], -h.info.eyeR[1]) : new THREE.Vector3(-0.032, 1.62, 0.09);
  return { headQ: q('Head'), neckQ: q('neck_01'), chestQ: q('spine_03'), eyeHead: eye.applyMatrix4(bind('Head').invert()) };
}

// world transform for the gun: socket `s` (weapon local) at world point p, +Z along z, +Y towards upHint
function gunMatrix(w, s, p, z, upHint) {
  const y = upHint.clone().addScaledVector(z, -upHint.dot(z)).normalize(), x = V().crossVectors(y, z);
  const q = Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return new THREE.Matrix4().compose(p.clone().sub(s.clone().applyQuaternion(q)), q, new THREE.Vector3(1, 1, 1));
}
function setWorld(w, M) { const par = w.parent; M.clone()   // parent (the unit) matrixWorld is current: updBones at solve start
  .premultiply(par.matrixWorld.clone().invert()).decompose(w.position, w.quaternion, w.scale); w.updateMatrixWorld(true); }
function aimHand(B, s, dir) {   // swing the hand so wrist->middle knuckle points along dir (world); keeps it attached
  const hb = B['hand_' + s], cur = wpos(B['middle_01_' + s]).sub(wpos(hb)).normalize();
  const nw = Q().setFromUnitVectors(cur, dir.clone().normalize()).multiply(hb.getWorldQuaternion(Q()));
  hb.quaternion.copy(hb.parent.getWorldQuaternion(Q()).invert().multiply(nw)); hb.updateMatrixWorld(true);
}
function handTo(B, s, target, dir, k = 1) {   // palm (not wrist) onto target; k<1 = partial (hold cross-fade)
  if (dir) aimHand(B, s, k < 1 ? palm(B, s).sub(wpos(B['hand_' + s])).normalize().lerp(dir.clone().normalize(), k) : dir);
  if (k < 1) target = palm(B, s).lerp(target, k);
  const off = palm(B, s).sub(wpos(B['hand_' + s]));
  return twoBoneIK(B['upperarm_' + s], B['lowerarm_' + s], B['hand_' + s], target.clone().sub(off));
}

const setWorldQ = (b, q) => { b.quaternion.copy(b.parent.getWorldQuaternion(Q()).invert().multiply(q)); b.updateMatrixWorld(true); };
// rotate the arm about the shoulder->wrist axis (hand stays put) so the elbow swings towards world direction `want`, by fraction k.
// Rifle hold: elbow down-out, so the forearm runs under the jaw and never through the helmet skirt / cap peak
function swivel(B, s, want, k) {
  const ua = B['upperarm_' + s], S = wpos(ua), E = wpos(B['lowerarm_' + s]), ax = wpos(B['hand_' + s]).sub(S).normalize();
  const c = E.sub(S), d = want.clone(); c.addScaledVector(ax, -c.dot(ax)); d.addScaledVector(ax, -d.dot(ax));
  if (c.lengthSq() < 1e-8 || d.lengthSq() < 1e-8) return 0;
  c.normalize(); d.normalize(); const ang = Math.atan2(V().crossVectors(c, d).dot(ax), c.dot(d)) * k;
  const hq = B['hand_' + s].getWorldQuaternion(Q());
  setWorldQ(ua, Q().setFromAxisAngle(ax, ang).multiply(ua.getWorldQuaternion(Q()))); setWorldQ(B['hand_' + s], hq);
  return ang;
}

export function equipEnemy(h, lib, name) {
  if (!lib || !lib[name]) return null;
  if (h.weapon) h.weapon.removeFromParent();
  const w = lib[name].root.clone(true); w.name = 'weapon_' + name;
  const S = {}; w.traverse(c => { const m = c.name.match(/(grip_r|grip_l|butt|muzzle|sling_f|sling_b|tip|scope|bipod)$/); if (m && c !== w) S[m[1]] = c.position.clone(); });
  w.userData.sockets = S; w.traverse(c => { if (c.isMesh) c.castShadow = true; });
  h.weapon = w; h.weaponName = name; h.object.add(w);
  h._bind = h._bind || bindInfo(h);
  if (!h._wpost) { h._wpost = true; h._post.push((dt) => solveEnemyWeapon(h, dt)); }
  h._holdClip = 'idle';
  return w;
}

// Slung rifle rests ON the back: ~24 skin probe points under the gun (picked once per variant at the first sling frame, LOD0
// body) are skinned by hand each frame (sum w * bone.matrixWorld * boneInverse * bindMatrix * v); the gun slides along its
// own +Y (away from the back) so the most protruding probe keeps a 6 mm gap. Was 5-8 cm off the back at mid-run.
const PRESS_GAP = 0.006;
function slingProbe(h, w) {
  const sm = Object.values(h.parts).filter(m => m.isSkinnedMesh && /^LOD0/.test(m.name)).sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count)[0];
  if (!sm) return null;
  const inv = w.matrixWorld.clone().invert(), P = sm.geometry.attributes.position, v = V(), bins = new Map();
  const under = new Map(); const gv = V();   // gun underside (min local y) per 3 cm z-bin, |x| < 3 cm
  w.traverse(o => { if (!o.isMesh) return; const gp = o.geometry.attributes.position, M = o.matrixWorld.clone().premultiply(inv);
    for (let i = 0; i < gp.count; i++) { gv.fromBufferAttribute(gp, i).applyMatrix4(M); if (Math.abs(gv.x) > 0.03) continue; const b = Math.round(gv.z / 0.03); under.set(b, Math.min(under.get(b) ?? 9, gv.y)); } });
  for (let i = 0; i < P.count; i += 1) {
    sm.getVertexPosition(i, v); v.applyMatrix4(sm.matrixWorld).applyMatrix4(inv);
    const b = Math.round(v.z / 0.03); if (!under.has(b) || Math.abs(v.x) > 0.05 || v.y < under.get(b) - 0.2 || v.y > under.get(b) + 0.05) continue;
    const c = v.y - under.get(b), cur = bins.get(b); if (!cur || c > cur.c) bins.set(b, { i, c, b });
  }
  const sel = [...bins.values()].sort((a, b) => b.c - a.c).slice(0, 24); if (!sel.length) return null;
  const si = sm.geometry.attributes.skinIndex, sw = sm.geometry.attributes.skinWeight;
  return { sm, pts: sel.map(({ i, b }) => ({ u: under.get(b), p: V().fromBufferAttribute(P, i).applyMatrix4(sm.bindMatrix), j: [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)], k: [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)] })) };
}
const _m = new THREE.Matrix4(), _acc = new THREE.Vector3(), _t = new THREE.Vector3(), _inv = new THREE.Matrix4();
function slingPress(h, w) {
  const key = '_sling_' + h.weaponName, C = h._rt || h;
  if (C[key] === undefined) C[key] = slingProbe(h, w);
  const pr = C[key]; if (!pr) return;
  const sk = pr.sm.skeleton; _inv.copy(w.matrixWorld).invert(); let c = -9;
  for (const q of pr.pts) {
    _acc.set(0, 0, 0);
    for (let k = 0; k < 4; k++) { if (!q.k[k]) continue; _m.multiplyMatrices(sk.bones[q.j[k]].matrixWorld, sk.boneInverses[q.j[k]]); _acc.addScaledVector(_t.copy(q.p).applyMatrix4(_m), q.k[k]); }
    c = Math.max(c, _acc.applyMatrix4(_inv).y - q.u);
  }
  const shift = THREE.MathUtils.clamp(c + PRESS_GAP, -0.09, 0.06); if (Math.abs(shift) < 1e-4) return;
  w.position.addScaledVector(V().setFromMatrixColumn(w.matrix, 1).normalize(), shift); w.updateMatrixWorld(true);
  h.slingShift = shift;
}
// gun pose (world matrix) for a carry/hold mode; two = both hands on the gun
function holdPose(h, hold, F) {
  const { B, S, g, fwd, up, left, cf, cu, cl, pitch } = F;
  if (hold === 'sling' || hold === 'back') {
    const s3 = wpf(B.spine_03), coat = /greatcoat|general_coat/.test(h.info.outfit || '') ? 0.015 : 0;
    if (hold === 'back') return { M: gunMatrix(null, S.grip_r, s3.clone().addScaledVector(cf, -0.17 + coat).addScaledVector(cl, 0.05).addScaledVector(cu, 0.02), cl.clone().negate().addScaledVector(cu, 0.35).normalize(), cf.clone().negate()), two: false };
    return { M: gunMatrix(null, S.grip_r, s3.clone().addScaledVector(cf, -0.13 + coat).addScaledVector(cl, -0.13).addScaledVector(cu, -0.08), cu.clone().addScaledVector(cl, 0.18).addScaledVector(cf, -0.12).normalize(), cf.clone().negate()), two: false };
  }
  const shR = wpos(B.upperarm_r), neck = wpos(B.neck_01);
  let dir, butt;
  if (hold === 'aim' && g.aim === 'shoulder') {
    dir = fwd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
    const pocket = shR.clone().lerp(neck, 0.3).addScaledVector(cf, 0.07);
    // cheek weld: bore ~5.5 cm under the right eye; the butt slides from the pocket towards that line by at most 4.5 cm
    const eye = h._bind.eyeHead.clone().applyMatrix4(B.Head.matrixWorld);
    const line = eye.clone().addScaledVector(up, -0.055).addScaledVector(dir, -dir.dot(V().subVectors(eye, pocket)));
    const bsock = (S.butt || V()).clone().sub(S.grip_r || V());
    const want = line.clone().addScaledVector(up, bsock.y);
    const d = want.clone().sub(pocket); if (d.length() > 0.045) d.setLength(0.045);
    butt = pocket.clone().add(d);
  } else if (hold === 'aim') {   // chest (MP40, folded stock)
    dir = fwd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
    butt = shR.clone().lerp(wpos(B.pelvis), 0.33).addScaledVector(cf, 0.17).addScaledVector(cl, 0.05);
  } else {   // low / reload: butt at the right hip, muzzle forward-up across the body
    dir = fwd.clone().multiplyScalar(0.75).addScaledVector(up, 0.45).addScaledVector(left, 0.35).normalize();
    butt = wpos(B.pelvis).addScaledVector(up, 0.18).addScaledVector(cf, 0.13).addScaledVector(left, -0.12);
  }
  return { M: gunMatrix(null, S.butt || new THREE.Vector3(0, 0, -0.3), butt, dir.normalize(), up), two: true, dir, shoulder: hold === 'aim' && g.aim === 'shoulder' };
}
function blendM(A, Bm, s) {
  const pa = V(), qa = Q(), sa = V(), pb = V(), qb = Q(), sb = V(); A.decompose(pa, qa, sa); Bm.decompose(pb, qb, sb);
  return new THREE.Matrix4().compose(pa.lerp(pb, s), qa.slerp(qb, s), new THREE.Vector3(1, 1, 1));
}
const smooth = (x) => x * x * (3 - 2 * x);

export function solveEnemyWeapon(h, dt = 0) {
  const w = h.weapon; if (!w) return;
  const B = h.bones, name = h.weaponName, S = w.userData.sockets, clip = h._holdClip || 'idle', act = h._holdAction;
  updBones(h);
  const rootQ = wqf(h.object);
  const fwd = V().set(0, 0, 1).applyQuaternion(rootQ), up = V().set(0, 1, 0).applyQuaternion(rootQ), left = V().set(1, 0, 0).applyQuaternion(rootQ);
  // a gunner at a platform MG (render/mg-mount.js): his own gun stays put away (also when he falls there), his hands
  // on the mount's pistol grip (right) and butt stock (left)
  if (h.mount || h._mountedGun) {
    w.visible = false; h._wKey = 'hide'; h._twoHand = false; h._dropM = null;
    if (h.mount?.grip && !/^(die|dead)/.test(clip)) mountHands(h, B, h.mount);
    return;
  }
  w.visible = true; h._twoHand = false;
  // prone death (docs/crawl-animation.md §4.5): the gun stays in the fist while he is hit and the elbows give way, and is
  // released at 0.45 s (it then rolls off the forearm: weapon-handover.js blends it onto the ground beside him)
  const dying = !proneGrip(clip, name, S) && clip === 'die_prone' && act && act.time < 0.45;
  const pg = proneGrip(clip, name, S) || (dying ? proneGrip('crawl', name, S) : null);
  if (dying && pg && !pg.hide) {   // the fist carries the gun as the arms give way, the gun keeps its lie (no swing up)
    if (!h._die) { w.updateMatrixWorld(true); h._die = { q: w.quaternion.clone(), s: w.worldToLocal(palm(B, 'r')) }; }
    const pl = h.object.worldToLocal(palm(B, 'r'));
    w.quaternion.copy(h._die.q); w.position.copy(pl).sub(h._die.s.clone().multiply(w.scale).applyQuaternion(w.quaternion)); w.updateMatrixWorld(true);
    h._wKey = 'pg:r'; h._dropM = null; return;
  }
  h._die = null;
  h._wKey = pg ? (pg.hide ? 'hide' : 'pg:' + pg.hand) : HOLD_E[clip] === 'drop' ? 'drop' : 'std';   // weapon-handover.js
  if (pg) {
    if (pg.hide) { w.visible = false; return; }
    setWorld(w, B['hand_' + pg.hand].matrixWorld.clone().multiply(pg.local)); h._dropM = null; return;
  }
  if (!LONG.has(name)) {   // pistol
    if (!HAND_CLIPS.includes(clip)) { w.visible = false; return; }
    const z = wpos(B.hand_r).sub(wpos(B.lowerarm_r)).normalize();
    setWorld(w, gunMatrix(w, S.grip_r, palm(B, 'r'), z, up)); return;
  }
  const g = GUN[name] || GUN.kar98k;
  const hold = HOLD_E[clip] || 'sling';
  const t = act ? act.time : 0;
  if (hold !== h._curHold) { h._prevHold = h._curHold || null; h._curHold = hold; }
  if (hold === 'drop') {
    const fallT = clip === 'die' ? 0.55 : 0;
    if (t < fallT) {   // still in the hand while he buckles
      setWorld(w, gunMatrix(w, S.grip_r, palm(B, 'r'), fwd.clone().multiplyScalar(0.6).addScaledVector(up, -0.8).normalize(), fwd)); return;
    }
    const prone = clip === 'die_prone' || clip === 'dead_prone';
    if (!h._dropM || (h._dropClip !== clip && !(prone && h._dropClip === 'die_prone'))) {   // lying on its side on the ground, beside the right hand / at his feet
      const dead = clip === 'die' || clip === 'dead';
      const dl = (h._rt && h._rt.dropLoc) || [-0.55, -0.25];
      // prone: where it left the fist, moved out beside his right arm (not under the torso), muzzle forward
      const loc = dead ? new THREE.Vector3(dl[0], 0, dl[1]) : prone ? new THREE.Vector3(Math.min(w.position.x - 0.12, -0.42), 0, w.position.z - 0.05) : new THREE.Vector3(-0.1, 0, 0.45);
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dead ? 0.5 : prone ? -0.12 : 1.35);
      const ql = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2).premultiply(yaw);
      if (!w.userData.lbox) { w.updateMatrixWorld(true); const inv = w.matrixWorld.clone().invert(), bb = new THREE.Box3();
        w.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); bb.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld.clone().premultiply(inv))); } }); w.userData.lbox = bb; }
      const bb = w.userData.lbox; let ymin = 9;
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) ymin = Math.min(ymin, new THREE.Vector3(x, y, z).applyQuaternion(ql).y);
      loc.y = -ymin / Math.max(1e-3, h.object.scale.y) + 0.003;
      h._dropM = new THREE.Matrix4().compose(loc, ql, new THREE.Vector3(1, 1, 1)); h._dropClip = clip;
    }
    w.position.setFromMatrixPosition(h._dropM); w.quaternion.setFromRotationMatrix(h._dropM); w.scale.set(1, 1, 1); w.updateMatrixWorld(true);
    return;
  }
  h._dropM = null;
  // chest frame (follows spine bend): rotation of spine_03 away from its bind orientation
  const Rc = wqf(B.spine_03).multiply(rootQ.clone().multiply(h._bind.chestQ).invert());
  const req = h._requested || clip;
  const pitch = (h.aimPitch || 0) + (req === 'aim_up' ? 0.26 : req === 'aim_down' ? -0.26 : 0);
  const F = { B, S, g, fwd, up, left, cf: fwd.clone().applyQuaternion(Rc), cu: up.clone().applyQuaternion(Rc), cl: left.clone().applyQuaternion(Rc), pitch };
  const shoulderOf = (hd) => hd === 'aim' && g.aim === 'shoulder';
  const prevHold0 = h._prevHold && h._prevHold !== 'drop' && h._prevHold !== hold ? h._prevHold : null;
  const aw0 = act ? act.getEffectiveWeight() : 1, s0 = prevHold0 && aw0 < 0.999 ? smooth(THREE.MathUtils.clamp(aw0, 0, 1)) : 1;
  const shk = (shoulderOf(hold) ? s0 : 0) + (prevHold0 && shoulderOf(prevHold0) ? 1 - s0 : 0);
  if (shk > 0) headOnStock(h, B, rootQ, shk);
  const cur = holdPose(h, hold, F);
  // cross-fade between holds with the incoming action's weight (idle->aim no longer snaps the gun 0.5-0.75 m in one frame)
  const prevHold = h._prevHold && h._prevHold !== 'drop' && h._prevHold !== hold ? h._prevHold : null;
  const aw = act ? act.getEffectiveWeight() : 1, s = prevHold && aw < 0.999 ? smooth(THREE.MathUtils.clamp(aw, 0, 1)) : 1;
  if (s >= 1) h._prevHold = null;
  const prev = s < 1 ? holdPose(h, prevHold, F) : null;
  setWorld(w, prev ? blendM(prev.M, cur.M, s) : cur.M);
  if (hold === 'sling' && !prev) slingPress(h, w);
  const hw = prev ? (cur.two && prev.two ? 1 : cur.two ? s : prev.two ? 1 - s : 0) : (cur.two ? 1 : 0);
  if (hw <= 0) return;
  const Mw = w.matrixWorld, dir = V().setFromMatrixColumn(Mw, 2).normalize();
  const gr = S.grip_r.clone().applyMatrix4(Mw), sp = new THREE.Vector3(...g.support).applyMatrix4(Mw);
  const gx = V().setFromMatrixColumn(Mw, 0), gy = V().setFromMatrixColumn(Mw, 1);
  let tr = gr;
  if (hold === 'low' && act && S.grip_r) {   // bolt cycling during reload
    const u = THREE.MathUtils.clamp(t / Math.max(0.1, act.getClip().duration), 0, 1), k = Math.sin(Math.PI * Math.min(1, u * 1.6)) ** 2;
    tr = gr.clone().addScaledVector(dir, 0.1 * k).addScaledVector(gy, 0.05 * k).addScaledVector(gx, -0.05 * k);
  }
  h.ikErrorR = handTo(B, 'r', tr, dir.clone().multiplyScalar(0.45).addScaledVector(gy, -0.75).addScaledVector(gx, 0.3), hw);
  const sh = (cur.shoulder ? (prev ? s : 1) : 0) + (prev && prev.shoulder ? 1 - s : 0);
  if (sh > 0) h.elbowSwing = swivel(B, 'r', up.clone().multiplyScalar(-ELBOW[0]).addScaledVector(left, -ELBOW[1]).addScaledVector(fwd, -ELBOW[2]), sh * hw);
  h.ikError = handTo(B, 'l', sp, gx.clone().multiplyScalar(-0.85).addScaledVector(dir, 0.45).addScaledVector(gy, 0.15), hw);
  h._twoHand = hw >= 0.999; h._support = g.support;
}
/** Both hands on a mounted gun (h.mount {grip, support, gun}: world markers, gun muzzle along its +x), elbows down-out. */
function mountHands(h, B, mt) {
  mt.gun.updateMatrixWorld(true);
  const fwd = V().setFromMatrixColumn(mt.gun.matrixWorld, 0).setY(0).normalize(), up = V().set(0, 1, 0), right = V().crossVectors(fwd, up).normalize();
  h.ikErrorR = handTo(B, 'r', wpos(mt.grip), fwd.clone().multiplyScalar(0.5).addScaledVector(up, -0.8).addScaledVector(right, -0.2));
  swivel(B, 'r', up.clone().multiplyScalar(-0.8).addScaledVector(right, 0.6), 1);
  h.ikError = handTo(B, 'l', wpos(mt.support), fwd.clone().multiplyScalar(0.55).addScaledVector(right, 0.6).addScaledVector(up, -0.35));
  swivel(B, 'l', up.clone().multiplyScalar(-0.8).addScaledVector(right, -0.6), 1);
}

// shouldered long gun: neck and head set upright-ish (the rifle_aim clip + idle base bowed the head ~40 deg so the helmet
// brim came down over the right hand): head pitched HEAD[0] deg down, canted HEAD[1] deg onto the stock, neck half of that
export const HEAD = [8, 4];
function headOnStock(h, B, rootQ, k) {
  const d2r = Math.PI / 180;
  for (const [bn, bq, f] of [['neck_01', h._bind.neckQ, 0.5], ['Head', h._bind.headQ, 1]]) {
    const R = Q().setFromEuler(new THREE.Euler(HEAD[0] * f * d2r, 0, HEAD[1] * f * d2r, 'ZXY'));
    const want = rootQ.clone().multiply(R).multiply(bq), b = B[bn];
    setWorldQ(b, b.getWorldQuaternion(Q()).slerp(want, k));
  }
}
// right elbow direction in the shoulder hold (down, out to the right, back): forearm under the jaw line
export const ELBOW = [0.9, 0.4, 0.1];
