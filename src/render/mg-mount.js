/**
 * A gunner working a platform MG (art/mg-platform.js `mg34-mount`; M2 towers t1 / t2, gunners e8 / e9 with
 * `tower: 't1'`): while he is at his post on the deck the mount (tripod + gun) is laid along his displayed heading
 * about his position, he kneels behind the butt (UnitModel ctx `mounted` → `kneel_shoot`) with his own gun put away and
 * his hands on the grips (enemy_weapons.js `h.mount`), and his shots leave the MG muzzle (render/fx.js). Once he is
 * gone (dead, or down the ladder) the gun stays where he last laid it. Render-only: the sim (traverse, LOS) is unchanged.
 * @module render/mg-mount
 */

import * as THREE from 'three';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

/** The platform's mount for this enemy (cached), or null. */
export function mountOf(e) {
  if (e._mgm) return e._mgm;
  // the platform model can come in after him (dressing / async art): look again for a while, then give up
  if (e.soldierType !== 'mg' || e.spawn?.tower == null || (e._mgmTries = (e._mgmTries || 0) + 1) > 120) return null;
  const s = e.world?.structures?.get?.(String(e.spawn.tower));
  const root = s?.object3d, gun = root?.getObjectByName?.('mg34-mount');
  if (!gun) return null;
  root.updateWorldMatrix(true, false);
  const c = root.getWorldPosition(new THREE.Vector3());   // his post: the deck centre (the gun's home)
  e._mgm = { gun, spec: gun.userData.mount, deckY: root.userData.deckY ?? e.spawn.y ?? 0, home: { x: c.x, z: c.z } };
  return e._mgm;
}

/** Is he at the gun now (alive, on the deck at his post)? */
export function manning(e, m = mountOf(e)) {
  if (!m || !e.alive || e.state === 'dead' || e.downed) return false;
  if (Math.abs((e.y ?? 0) - m.deckY) > 0.4) return false;
  return Math.hypot(e.x - m.home.x, e.z - m.home.z) < 0.45 && !e.path;
}

/**
 * Per frame, after Entity.syncTransform and before the model's mixer (hand IK reads the mount): lay the gun along his
 * displayed facing and hand the grips to his runtime.
 */
export function mgMountFrame(e) {
  const m = mountOf(e);
  if (!m) return;
  const on = manning(e, m), inner = e.model?.real?.inner || null;
  e._mgManned = on;
  if (inner) {
    if (on && !inner.mount) {
      inner.mount = { grip: m.gun.getObjectByName('grip'), support: m.gun.getObjectByName('support'), gun: m.gun };
      inner._mountedGun = true;   // his own MG 34 stays put away (not dropped beside him when he falls at the gun)
    } else if (!on && inner.mount) {
      inner.mount = null;
      if (e.alive) inner._mountedGun = false;   // left the gun alive (down the ladder): his own gun comes out again
    }
  }
  if (!on) return;
  const o = e.object3d, par = m.gun.parent;
  if (!o || !par) return;
  par.updateWorldMatrix(true, false);
  par.getWorldQuaternion(_q); _e.setFromQuaternion(_q, 'YXZ');
  _v.set(o.position.x, 0, o.position.z);
  par.worldToLocal(_v);
  m.gun.position.set(_v.x, m.gun.position.y, _v.z);
  // model forward is +z (rotation.y = π/2 − heading); the gun's muzzle is its +x
  m.gun.rotation.set(0, o.rotation.y - Math.PI / 2 - _e.y, 0);
  m.gun.updateMatrixWorld(true);
}

/**
 * Where his shot leaves the gun: the MG muzzle toward `to` (he faces his target), world coordinates; null when he is
 * not at a mounted gun (or headless: no platform model).
 * @param {object} e enemy @param {{x:number, z:number}} to @param {(x:number, z:number) => number} groundY
 */
export function mgMuzzle(e, to, groundY) {
  const m = mountOf(e);
  if (!m || !manning(e, m) || !to) return null;
  const dx = to.x - e.x, dz = to.z - e.z, d = Math.hypot(dx, dz) || 1, k = m.spec.muzzle;
  return { x: e.x + (dx / d) * k, y: groundY(e.x, e.z) + (e.y ?? 0) + m.spec.bore + 0.005, z: e.z + (dz / d) * k };
}
