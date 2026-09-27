// weapons.js — weapon props (out/weapons.glb) with sockets, auto attachment per clip and left-hand two-bone IK.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const LONG = new Set(['kar98k', 'mp40', 'mg34', 'mg42', 'no4_sniper', 'thompson', 'harpoon_gun']);
// hold per clip for long guns (default 'sling'); pistols/knives/syringe/bombs are 'hand' while the clip uses them
export const HOLD = { aim: 'aim', aim_up: 'aim', aim_down: 'aim', shoot: 'aim', rifle_shoot: 'aim', kneel_shoot: 'aim', reload: 'aim',
  crouch_idle: 'sling', crouch_walk: 'sling', crawl: 'back', crawl_idle: 'back', swim: 'back', swim_idle: 'back', dive: 'back',
  climb: 'back', drag: 'back', carry_idle: 'back', carry_walk: 'back', carry_barrel: 'back', die: 'drop', dead: 'drop', surrender: 'drop', handsup_held: 'drop' };
const HAND_CLIPS = { knife: ['stab', 'aim', 'crouch_walk', 'crouch_idle'], syringe: ['syringe'], stick_grenade: ['throw'],
  time_bomb: ['plant'], remote_bomb: ['plant'], luger: ['aim', 'shoot', 'pistol_idle', 'reload'], walther_p38: ['aim', 'shoot', 'pistol_idle', 'reload'],
  colt1911: ['aim', 'shoot', 'pistol_idle', 'reload'] };

export async function loadWeapons(url) {
  const g = await new GLTFLoader().loadAsync(url);
  const lib = {};
  for (const o of [...g.scene.children]) {
    if (!o.isMesh && !o.isGroup && !o.isObject3D) continue;
    const sockets = {};
    o.traverse(c => { if (c !== o && !c.isMesh) { const m = c.name.match(/(grip_r|grip_l|butt|muzzle|sling_f|sling_b|tip|scope|bipod)$/); if (m) sockets[m[1]] = c; } });
    o.traverse(c => { if (c.isMesh) { c.castShadow = true; } });
    lib[o.name] = { root: o, sockets };
  }
  return lib;
}

const wpos = (o) => o.getWorldPosition(new THREE.Vector3());
const palm = (B, s) => wpos(B['hand_' + s]).lerp(wpos(B['middle_01_' + s]), 0.55);

function setWorldQuat(b, q) { b.quaternion.copy(b.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q)); b.updateMatrixWorld(true); }

// place weapon so that socket `grip_r` is at `grip` with forward (+Z) = z and up (+Y) ~ upHint, then parent to `bone`
function place(w, bone, grip, z, upHint) {
  const y = upHint.clone().addScaledVector(z, -upHint.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  const g = w.userData.sockets.grip_r ? w.userData.sockets.grip_r.position : new THREE.Vector3();
  const pos = grip.clone().sub(g.clone().applyQuaternion(q));
  bone.updateMatrixWorld(true);
  const inv = bone.matrixWorld.clone().invert();
  const M = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)).premultiply(inv);
  bone.add(w); M.decompose(w.position, w.quaternion, w.scale);
}

// two-bone analytic IK (absolute; idempotent even if the mixer skips unchanged tracks)
export function twoBoneIK(a, b, c, target) {
  const pa = wpos(a), pb = wpos(b), pc = wpos(c);
  const lab = pb.distanceTo(pa), lcb = pc.distanceTo(pb);
  const lat = THREE.MathUtils.clamp(target.distanceTo(pa), 0.01, lab + lcb - 0.001);
  const cl = (x) => THREE.MathUtils.clamp(x, -1, 1);
  const ac = pc.clone().sub(pa).normalize(), ab = pb.clone().sub(pa).normalize(), ba = ab.clone().negate(), bc = pc.clone().sub(pb).normalize(), at = target.clone().sub(pa).normalize();
  const ac_ab_0 = Math.acos(cl(ac.dot(ab))), ba_bc_0 = Math.acos(cl(ba.dot(bc))), ac_at_0 = Math.acos(cl(ac.dot(at)));
  const ac_ab_1 = Math.acos(cl((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)));
  const ba_bc_1 = Math.acos(cl((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));
  let ax0 = new THREE.Vector3().crossVectors(ac, ab); if (ax0.lengthSq() < 1e-10) ax0.set(1, 0, 0); ax0.normalize();
  let ax1 = new THREE.Vector3().crossVectors(ac, at); if (ax1.lengthSq() < 1e-10) ax1.set(1, 0, 0); ax1.normalize();
  const r0 = new THREE.Quaternion().setFromAxisAngle(ax0, ac_ab_1 - ac_ab_0);
  const r1 = new THREE.Quaternion().setFromAxisAngle(ax0, ba_bc_1 - ba_bc_0);
  const r2 = new THREE.Quaternion().setFromAxisAngle(ax1, ac_at_0);
  const aw = a.getWorldQuaternion(new THREE.Quaternion()), bw = b.getWorldQuaternion(new THREE.Quaternion()), cw = c.getWorldQuaternion(new THREE.Quaternion());
  const r20 = r2.clone().multiply(r0);
  setWorldQuat(a, r20.clone().multiply(aw));
  setWorldQuat(b, r20.clone().multiply(r1).multiply(bw));
  setWorldQuat(c, cw);                              // keep the hand's world orientation
  return wpos(c).distanceTo(target);
}

// equip(h, lib, name, {clip}) — attaches (and re-solves on every setAnim). Returns the weapon object.
export function equip(h, lib, name, { clip = null } = {}) {
  if (!lib || !lib[name]) return null;
  if (h.weapon) h.weapon.removeFromParent();
  const w = lib[name].root.clone(true);
  const sockets = {}; w.traverse(c => { const m = c.name.match(/(grip_r|grip_l|butt|muzzle|sling_f|sling_b|tip|scope|bipod)$/); if (m && c !== w) sockets[m[1]] = c; });
  w.userData.sockets = sockets; w.name = 'weapon_' + name;
  h.weapon = w; h.weaponName = name;
  h.solveWeapon = (clipName) => solve(h, clipName);
  if (!h._ikInstalled) {
    h._ikInstalled = true;
    h._post.push(() => {
      if (!h.weapon || !h._twoHand || !h.weapon.parent) return;
      const t = wpos(h.weapon.userData.sockets.grip_l);
      h.ikError = twoBoneIK(h.bones.upperarm_l, h.bones.lowerarm_l, h.bones.hand_l, t);
    });
    const orig = h.setAnim;
    h.setAnim = (n, o) => { const a = orig(n, o); if (h.weapon) solve(h, n); return a; };
  }
  solve(h, clip);
  return w;
}

function solve(h, clipName) {
  const w = h.weapon, name = h.weaponName, B = h.bones;
  h.object.updateMatrixWorld(true);
  const rootQ = h.object.getWorldQuaternion(new THREE.Quaternion());
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ), up = new THREE.Vector3(0, 1, 0).applyQuaternion(rootQ);
  const left = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ);
  h._twoHand = false;
  w.visible = true;
  if (LONG.has(name)) {
    const hold = HOLD[clipName] || 'sling';
    if (hold === 'aim' || hold === 'lowready') {
      const sh = wpos(B.upperarm_r), pr = palm(B, 'r'), pl = palm(B, 'l');
      const z = hold === 'aim' ? pr.clone().lerp(pl, 0.5).sub(sh).normalize() : pl.clone().sub(pr).normalize();
      place(w, B.hand_r, pr, z, up);
      h._twoHand = !!w.userData.sockets.grip_l;
    } else if (hold === 'drop') {
      w.visible = false;
    } else {   // sling over the right shoulder (muzzle up) or flat on the back (crawl/swim/carry)
      const s3 = wpos(B.spine_03);
      if (hold === 'back') place(w, B.spine_03, s3.clone().addScaledVector(fwd, -0.17).addScaledVector(left, 0.05).addScaledVector(up, 0.02), left.clone().multiplyScalar(-1).addScaledVector(up, 0.35).normalize(), fwd.clone().negate());
      else place(w, B.spine_03, s3.clone().addScaledVector(fwd, -0.13).addScaledVector(left, -0.13).addScaledVector(up, -0.08), up.clone().addScaledVector(left, 0.18).addScaledVector(fwd, -0.12).normalize(), fwd.clone().negate());
    }
  } else {
    const clips = HAND_CLIPS[name] || [];
    if (clipName && !clips.includes(clipName)) { w.visible = false; B.hand_r.add(w); return; }
    const pr = palm(B, 'r');
    const z = wpos(B.hand_r).sub(wpos(B.lowerarm_r)).normalize();
    place(w, B.hand_r, pr, z, up);
  }
}
