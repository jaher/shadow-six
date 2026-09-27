// squad_posture.js - per-man idle choice + a posture overlay for standing idles (bible §5.2: "no two alike").
// The UAL idle stands wide-legged, knees bent, torso pitched forward (a crouch). For standing idle clips this overlay,
// run right after the mixer every frame, (1) pitches spine_01/02 back so the neck sits over the pelvis (+ a small seeded
// lean), (2) narrows the stance to a seeded ankle half-width, (3) raises the pelvis so the knees are nearly straight and
// (4) re-solves both legs with two-bone IK to ankle targets at the ORIGINAL ankle height (feet stay grounded/planted).
// The bones it touches are restored to the mixer's values before the next mixer.update (PropertyMixer skips writes of
// unchanged values, so an overlay would otherwise accumulate on held keys).
import * as THREE from 'three';
import { ik2 } from './synth.js';
import { mulberry32 } from '/chars/pipeline/web/variety.js';

export const STANDING = new Set(['idle', 'look_around', 'fold_arms', 'idle_hands_back', 'talk', 'smoke', 'pistol_idle']);
const IDLES = [['idle', 0.4], ['look_around', 0.2], ['fold_arms', 0.2], ['idle_hands_back', 0.2]];
const TOUCH = ['pelvis', 'spine_01', 'spine_02', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _ax = new THREE.Vector3();

export function installPosture(h, j) {
  const r = mulberry32(j.seed ^ 0x5eed);
  let u = r(), pick = 'idle'; for (const [n, w] of IDLES) { if (u < w) { pick = n; break; } u -= w; }
  if (!h.clip(pick)) pick = 'idle';
  const P = { idle: pick, halfW: 0.075 + r() * 0.05, lean: THREE.MathUtils.degToRad(-1 + r() * 5), knee: 0.955 + r() * 0.025,
    tempo: 0.88 + r() * 0.24, phase: r() * 4, enabled: true };
  h.posture = P;
  const B = h.bones, root = h.object;
  const saved = TOUCH.filter(n => B[n]).map(n => ({ b: B[n], q: new THREE.Quaternion(), p: new THREE.Vector3() }));
  let dirty = false;
  // setAnim: 'idle' -> this man's idle (tempo + phase offset); remember the playing clip for the overlay
  const set0 = h.setAnim.bind(h);
  h.setAnim = (name, o = {}) => {
    const n = name === 'idle' ? P.idle : name;
    const a = set0(n, n !== name ? { ...o, timeScale: (o.timeScale || 1) * P.tempo } : o) || set0(name, o);
    if (a && n !== name && a.time === 0) a.time = P.phase % a.getClip().duration;
    h._anim = a ? n : name;
    return a;
  };
  const up0 = h.update.bind(h);
  h.update = (dt) => { if (dirty) { for (const s of saved) { s.b.quaternion.copy(s.q); s.b.position.copy(s.p); } dirty = false; } up0(dt); };
  const L = (o) => root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
  h._post.unshift(() => {
    if (!P.enabled || !STANDING.has(h._anim)) return;
    for (const s of saved) { s.q.copy(s.b.quaternion); s.p.copy(s.b.position); }
    dirty = true;
    root.updateMatrixWorld(true);
    // (1) torso: neck over pelvis
    const pel = L(B.pelvis), neck = L(B.neck_01 || B.spine_03);
    const ang = Math.atan2(neck.z - pel.z, neck.y - pel.y);
    const d = ang - P.lean;
    if (Math.abs(d) > 0.01) {
      _ax.set(1, 0, 0).transformDirection(root.matrixWorld);
      for (const [n, k] of [['spine_01', 0.55], ['spine_02', 0.45]]) {
        const b = B[n]; if (!b) continue;
        _q.setFromAxisAngle(_ax, -d * k).multiply(b.getWorldQuaternion(new THREE.Quaternion()));
        b.quaternion.copy(b.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(_q)); b.updateMatrixWorld(true);
      }
    }
    // (2)+(3) stance width and pelvis height
    const legs = ['l', 'r'].map(s => ({ s, t: B['thigh_' + s], c: B['calf_' + s], f: B['foot_' + s] })).filter(g => g.t && g.c && g.f);
    if (legs.length !== 2) return;
    // body over the feet: move the pelvis so the neck is above the ankle midpoint (+ small seeded lean)
    const a0 = L(legs[0].f), a1 = L(legs[1].f), midZ = (a0.z + a1.z) / 2;
    const nk = L(B.neck_01 || B.spine_03), dz0 = THREE.MathUtils.clamp(midZ + 0.03 + P.lean * 0.4 - nk.z, -0.12, 0.12);
    const pel2 = pel.clone(); pel2.z += dz0;
    let dy = 0.08;
    for (const g of legs) {
      g.ank = L(g.f); g.ank.z = midZ + (g.ank.z - midZ) * 0.55;
      g.hip = L(g.t); g.hip.z += dz0;
      g.len = g.hip.distanceTo(L(g.c)) + L(g.c).distanceTo(g.ank);
      const side = Math.sign(g.ank.x - pel.x) || (g.s === 'l' ? 1 : -1);
      if (Math.abs(g.ank.x - pel.x) > P.halfW) g.ank.x = pel.x + side * P.halfW;
      const dx = g.hip.x - g.ank.x, dz = g.hip.z - g.ank.z, want = P.knee * g.len;
      const need = Math.sqrt(Math.max(0, want * want - dx * dx - dz * dz)) - (g.hip.y - g.ank.y);
      dy = Math.min(dy, need);
    }
    dy = Math.max(0, dy);
    if (dy > 0.002 || Math.abs(dz0) > 0.002) {
      const pw = B.pelvis.getWorldPosition(new THREE.Vector3());
      _a.copy(pel2).setY(pel.y + dy); root.localToWorld(_a);
      B.pelvis.position.add(B.pelvis.parent.worldToLocal(_a.clone()).sub(B.pelvis.parent.worldToLocal(pw)));
      B.pelvis.updateMatrixWorld(true);
    }
    // (4) legs: IK to the narrowed ankle targets at the clip's ankle height, knees toward the front
    for (const g of legs) {
      const tgt = root.localToWorld(g.ank.clone());
      const knee = L(g.c); knee.z += 0.4; root.localToWorld(knee);
      ik2(g.t, g.c, g.f, tgt, knee);
    }
  });
  return P;
}
