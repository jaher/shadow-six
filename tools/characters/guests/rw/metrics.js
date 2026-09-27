import { THREE } from './common.js';
const J = ['pelvis', 'Head', 'foot_l', 'foot_r', 'ball_l', 'ball_r', 'hand_l', 'hand_r', 'calf_l', 'calf_r', 'upperarm_r', 'clavicle_r', 'spine_03'];
const wp = (o) => o.getWorldPosition(new THREE.Vector3());
export const r2 = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;

export function snap(h) {
  h.object.updateMatrixWorld(true);
  const s = {}; for (const j of J) if (h.bones[j]) s[j] = wp(h.bones[j]); return s;
}
// min world y of the visible-LOD skinned vertices (every `step`-th vertex of LOD2 for speed)
const _v = new THREE.Vector3();
export function minVertY(h, step = 2) {
  const m = h.parts.LOD2 || h.parts.LOD1; if (!m) return null;
  m.updateMatrixWorld(true); const n = m.geometry.attributes.position.count; let mn = 1e9, mx = -1e9, at = -1;
  for (let i = 0; i < n; i += step) { m.getVertexPosition(i, _v); _v.applyMatrix4(m.matrixWorld); if (_v.y < mn) { mn = _v.y; at = i; } if (_v.y > mx) mx = _v.y; }
  const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight; let bi = 0, bw = -1;
  for (let k = 0; k < 4; k++) if (sw.getComponent(at, k) > bw) { bw = sw.getComponent(at, k); bi = si.getComponent(at, k); }
  return [mn, mx, m.skeleton.bones[bi].name];
}
// restart a clip with no cross-fade (setAnim ignores a repeat of the current name)
export function start(h, name, o = {}) {
  h.object.rotation.set(0, 0, 0); h._settled = null;   // guests r1: travel clips (board_car) turn the root
  h.mixer.stopAllAction();
  h.setAnim(name === 'idle' ? 'dead' : 'idle', { fade: 0 });
  h.mixer.stopAllAction();
  const a = h.setAnim(name, { fade: 0, ...o });
  h.mixer.update(0); return a;
}
// step a clip for `dur` s at 60 Hz, moving the root forward (+Z) at `v` m/s; returns per-frame snapshots
export function run(h, dur, v = 0, { verts = 0 } = {}) {
  const dt = 1 / 60, fr = [];
  for (let i = 0, n = Math.round(dur / dt); i <= n; i++) {
    if (i) { h.object.position.z += v * dt; h.update(dt); }
    const s = snap(h); if (verts && i % verts === 0) s.vy = minVertY(h); fr.push(s);
  }
  return fr;
}
// stance slide: for each effector take the frames where it is in the lowest `q` fraction of its height range AND within 4 cm
// of its minimum; report mean |horizontal speed| there (0 = planted) and the signed forward component (+ = foot drifts
// forward = the root moves faster than the clip's stride supports -> implied ground speed = v - fwd)
export function slide(fr, names, q = 0.2) {
  const dt = 1 / 60, out = {};
  for (const n of names) {
    const ys = fr.map(f => f[n].y), mn = Math.min(...ys), mx = Math.max(...ys);
    const lim = Math.min(mn + (mx - mn) * q, mn + 0.04); let sum = 0, fz = 0, cnt = 0;
    for (let i = 1; i < fr.length; i++) if (ys[i] <= lim && ys[i - 1] <= lim) {
      const dx = (fr[i][n].x - fr[i - 1][n].x) / dt, dz = (fr[i][n].z - fr[i - 1][n].z) / dt; sum += Math.hypot(dx, dz); fz += dz; cnt++;
    }
    out[n] = { stanceFrac: r2(cnt / (fr.length - 1), 2), slide: r2(cnt ? sum / cnt : NaN, 3), fwd: r2(cnt ? fz / cnt : NaN, 3), minY: r2(mn, 3) };
  }
  return out;
}
// max per-frame joint displacement (m) in root-local space (root translation removed)
export function jitter(fr, from = 1, to = fr.length) {
  let mx = 0, at = -1;
  for (let i = Math.max(1, from); i < to; i++) for (const j of J) {
    if (!fr[i][j]) continue;
    const a = fr[i][j].clone().sub(fr[i].pelvis).setY(fr[i][j].y), b = fr[i - 1][j].clone().sub(fr[i - 1].pelvis).setY(fr[i - 1][j].y);
    const d = a.distanceTo(b); if (d > mx) { mx = d; at = i; }
  }
  return { max: r2(mx, 3), at };
}
export function poseDiff(a, b) { let mx = 0; for (const j of J) if (a[j] && b[j]) mx = Math.max(mx, a[j].distanceTo(b[j])); return r2(mx, 3); }
// weapon direction in character frame (forward +Z): yaw (+ = to character's left/+X), pitch (+ = up), plus IK error
export function weaponAim(h) {
  const w = h.weapon; if (!w || !w.parent || !w.visible) return null;
  h.object.updateMatrixWorld(true);
  const q = w.getWorldQuaternion(new THREE.Quaternion()); const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const inv = h.object.getWorldQuaternion(new THREE.Quaternion()).invert(); z.applyQuaternion(inv);
  const s = w.userData.sockets; const B = h.bones;
  const out = { yaw: r2(THREE.MathUtils.radToDeg(Math.atan2(z.x, z.z)), 1), pitch: r2(THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(z.y, -1, 1))), 1) };
  if (s.muzzle) out.muzzleY = r2(wp(s.muzzle).y, 2);
  if (s.butt) out.buttToShoulder = r2(wp(s.butt).distanceTo(wp(B.upperarm_r).lerp(wp(B.clavicle_r), 0.5)), 3);
  if (s.grip_l && h._twoHand) out.ikErr = r2(h.ikError ?? NaN, 3);
  if (s.grip_l && h._twoHand) out.handLToGripL = r2(wp(B.hand_l).lerp(wp(B.middle_01_l), 0.55).distanceTo(wp(s.grip_l)), 3);
  if (s.scope) out.scopeToHead = r2(wp(s.scope).distanceTo(wp(B.Head)), 3);
  return out;
}
// character-frame coordinates of a world point
export function local(h, p) { return h.object.worldToLocal(p.clone()); }
