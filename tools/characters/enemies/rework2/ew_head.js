// enemy_weapons.js - enemy weapon holds solved EVERY frame after the mixer (fixes the stale-pose solve in pipeline weapons.js)
//  long guns (kar98k, mg34, mp40, ...):
//    aim   - shouldered: butt in the right shoulder pocket, bore under the right eye, pointing along the unit's facing
//            (pitch follows the head); right palm IK'd to grip_r, left palm IK'd to the fore-stock support point
//    low   - reload: butt at the right hip, muzzle 25 deg down and across the body; right hand cycles the bolt
//    sling - right shoulder, muzzle up, in the CHEST frame (follows torso lean);  back - flat on the back
//    drop  - die/dead/surrender: carried in the right hand while falling, then lying on the ground beside the body
//  hand guns (luger, walther_p38): in the right hand for aim/shoot/pistol_idle/reload, otherwise holstered (hidden)
import * as THREE from 'three';
import { twoBoneIK } from '/chars/pipeline/web/weapons.js';

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
  reload: 'low', rifle_reload: 'low', die: 'drop', dead: 'drop', surrender: 'drop', handsup_held: 'drop', sit: 'back', drive: 'back', detonate: 'back' };
const HAND_CLIPS = ['aim', 'shoot', 'pistol_idle', 'reload'];

const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const wpos = (o) => o.getWorldPosition(V());
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
function setWorld(w, M) { const par = w.parent; par.updateMatrixWorld(true); M.clone().premultiply(par.matrixWorld.clone().invert()).decompose(w.position, w.quaternion, w.scale); w.updateMatrixWorld(true); }
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

