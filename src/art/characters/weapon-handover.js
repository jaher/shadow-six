// weapon-handover.js - smooth weapon hand-overs between holds that re-seat the gun (CC0 project code).
// The prone set moves the weapon between bones and grips: prone_shoot (support hand) -> crawl_idle (right fist),
// go_prone / get_up (slung -> hands -> slung), aim rigs -> prone grips. Each runtime places the gun for the NEW clip at
// once, on a body that is still cross-fading out of the old pose, so the gun popped (a No.4 stood vertical for ~6
// frames after a prone shot). Runs after every other weapon post-solve of a character (charkit update): when the
// placement key changes (parent bone, or the runtime's own h._wKey), the gun is blended in character-root space from
// where it was last drawn to its new placement over DUR seconds.
import * as THREE from 'three';

export const DUR = 0.25;
const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4();
const _pa = new THREE.Vector3(), _qa = new THREE.Quaternion(), _sa = new THREE.Vector3();
const _pb = new THREE.Vector3(), _qb = new THREE.Quaternion(), _sb = new THREE.Vector3();

function blend(A, B, t, out) {
  A.decompose(_pa, _qa, _sa); B.decompose(_pb, _qb, _sb);
  return out.compose(_pa.lerp(_pb, t), _qa.slerp(_qb, t), _sa.lerp(_sb, t));
}

/**
 * Per-frame hand-over blend of h.weapon (call last, after the runtime's weapon solve).
 * @param {{weapon?:THREE.Object3D, object:THREE.Object3D, _wKey?:string}} h humanoid instance @param {number} dt seconds
 */
export function weaponHandover(h, dt) {
  const w = h.weapon, st = h._ho || (h._ho = { key: null, lp: null, lq: null, from: null, t: 0, set: null, keep: null, w: null });
  // undo last frame's blended override when the runtime did not re-place the gun since (fixed bone-local grips)
  if (st.set && w && w.position.equals(st.set.p) && w.quaternion.equals(st.set.q)) { w.position.copy(st.keep.p); w.quaternion.copy(st.keep.q); w.scale.copy(st.keep.s); }
  st.set = null;
  if (w !== st.w) { st.w = w; st.key = null; st.lp = null; st.from = null; }   // another prop equipped: nothing to blend from
  if (!w || !w.parent || !w.visible || !h.object) { st.key = null; st.lp = null; st.from = null; return; }
  const key = h._wKey ?? (w.parent === h.object ? 'root' : w.parent.name);
  if (st.key !== null && key !== st.key && st.lp) {                 // hand-over: blend from where it was drawn
    h.object.updateMatrixWorld(true);
    _inv.copy(h.object.matrixWorld).invert();
    const last = new THREE.Matrix4().compose(st.lq.p, st.lq.q, st.lq.s);
    st.from = st.lp === h.object ? last : _inv.clone().multiply(st.lp.matrixWorld).multiply(last);
    st.t = 0;
  }
  st.key = key;
  if (st.from) {
    st.t += dt;
    const u = Math.min(1, st.t / DUR), e = u * u * (3 - 2 * u);
    if (u >= 1) st.from = null;
    else {
      h.object.updateMatrixWorld(true);                                 // bones are current only after this (rare: blends)
      _inv.copy(h.object.matrixWorld).invert();
      const cur = _m.multiplyMatrices(_inv, w.matrixWorld);            // intended placement, character-root space
      const shown = blend(st.from, cur, e, new THREE.Matrix4());
      st.keep = { p: w.position.clone(), q: w.quaternion.clone(), s: w.scale.clone() };
      _m.copy(w.parent.matrixWorld).invert().multiply(h.object.matrixWorld).multiply(shown);   // root space -> parent space
      _m.decompose(w.position, w.quaternion, w.scale); w.updateMatrixWorld(true);
      st.set = { p: w.position.clone(), q: w.quaternion.clone() };
    }
  }
  // cheap per-frame record of the placement (parent + local TRS; no matrix work unless a hand-over happens)
  st.lp = w.parent;
  const L = st.lq || (st.lq = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() });
  L.p.copy(w.position); L.q.copy(w.quaternion); L.s.copy(w.scale);
}
