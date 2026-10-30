// Copied from scratchpad chars/commandos_b/pipeline/web/squad_posture.js by tools/characters/consolidate/copy_runtime.py (imports/URLs rewritten; moved to src/art/characters in art integration 2). CC0 project code.
// squad_posture.js - per-man idle choice + a posture overlay for standing idles (bible §5.2: "no two alike").
// The UAL idle stands wide-legged, knees bent, torso pitched forward (a crouch). For standing idle clips this overlay,
// run right after the mixer every frame, (1) pitches spine_01/02 back so the neck sits over the pelvis (+ a small seeded
// lean), (2) narrows the stance to a seeded ankle half-width, (3) raises the pelvis so the knees are nearly straight and
// (4) re-solves both legs with two-bone IK to ankle targets at the ORIGINAL ankle height (feet stay grounded/planted).
// The bones it touches are restored to the mixer's values before the next mixer.update (PropertyMixer skips writes of
// unchanged values, so an overlay would otherwise accumulate on held keys).
import * as THREE from 'three';
import { mulberry32 } from '../pipeline/variety.js';

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
  // perf/characters-detail: the overlay's world-space reads used three's getWorldPosition / getWorldQuaternion (each
  // re-walks the whole chain from the scene) and whole-subtree updateMatrixWorld(true) after each write: ~500 node
  // updates a step. Here only the bones it reads are kept fresh, with the same products in the same order
  // (updateMatrix + parent.matrixWorld × matrix), so every value — and the pose — is bit for bit the same.
  const below = (b) => { const a = []; for (let o = b; o && o !== B.pelvis; o = o.parent) a.unshift(o); return a; };
  const NECK = B.neck_01 || B.spine_03;
  const spineDown = (top) => below(NECK).filter((o) => o === top || isBelow(o, top));
  const isBelow = (o, top) => { for (let q = o.parent; q; q = q.parent) if (q === top) return true; return false; };
  const LEGS = ['l', 'r'].map((s) => [B['thigh_' + s], B['calf_' + s], B['foot_' + s]]).filter((g) => g.every(Boolean));
  const legChains = LEGS.map((g) => below(g[2]));
  const fresh = (o) => { if (o.matrixAutoUpdate) o.updateMatrix(); if (o.matrixWorldAutoUpdate) o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix); };
  const freshAll = (list) => { for (const o of list) fresh(o); };
  const rootInv = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const L = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(rootInv);
  const WQ = (o) => { const q = new THREE.Quaternion(); o.matrixWorld.decompose(_p, q, _s); return q; };
  const WP = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
  // synth.js ik2 (keepEnd, maxReach 0.999) on fresh matrices: a, b, c re-made after each write
  const ik2f = (a, b, c, target, pole) => {
    fresh(a); fresh(b); fresh(c);
    const cw = WQ(c);
    const pa = WP(a), pb = WP(b), pc = WP(c);
    const l1 = pa.distanceTo(pb), l2 = pb.distanceTo(pc);
    const t = target.clone().sub(pa); let d = t.length();
    d = THREE.MathUtils.clamp(d, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
    const tn = t.clone().normalize();
    const ref = (pole ? pole.clone() : pb.clone()).sub(pa);
    let bend = ref.addScaledVector(tn, -ref.dot(tn));
    if (bend.lengthSq() < 1e-8) bend = pb.clone().sub(pa).addScaledVector(tn, -pb.clone().sub(pa).dot(tn));
    if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1).addScaledVector(tn, -tn.z);
    bend.normalize();
    const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const midT = pa.clone().addScaledVector(tn, l1 * cosA).addScaledVector(bend, l1 * sinA);
    const endT = pa.clone().addScaledVector(tn, d);
    const setWQ = (bone, q, after) => { bone.quaternion.copy(WQ(bone.parent).invert().multiply(q)); fresh(bone); for (const o of after) fresh(o); };
    const swing = (bone, from, to, after) => {
      const p = WP(bone); const u = from.clone().sub(p).normalize(), v = to.clone().sub(p).normalize();
      setWQ(bone, new THREE.Quaternion().setFromUnitVectors(u, v).multiply(WQ(bone)), after);
    };
    swing(a, pb, midT, [b, c]);
    swing(b, WP(c), endT, [c]);
    setWQ(c, cw, []);
  };
  h._post.unshift(() => {
    if (!P.enabled || !STANDING.has(h._anim)) return;
    for (const s of saved) { s.q.copy(s.b.quaternion); s.p.copy(s.b.position); }
    dirty = true;
    // the chain from the scene down to the pelvis, then the spine to the neck and both legs below it
    B.pelvis.updateWorldMatrix(true, false);
    rootInv.copy(root.matrixWorld).invert();
    freshAll(below(NECK)); for (const c of legChains) freshAll(c);
    // (1) torso: neck over pelvis
    const pel = L(B.pelvis), neck = L(NECK);
    const ang = Math.atan2(neck.z - pel.z, neck.y - pel.y);
    const d = ang - P.lean;
    if (Math.abs(d) > 0.01) {
      _ax.set(1, 0, 0).transformDirection(root.matrixWorld);
      for (const [n, k] of [['spine_01', 0.55], ['spine_02', 0.45]]) {
        const b = B[n]; if (!b) continue;
        _q.setFromAxisAngle(_ax, -d * k).multiply(WQ(b));
        b.quaternion.copy(WQ(b.parent).invert().multiply(_q));
        freshAll(spineDown(b));
      }
    }
    // (2)+(3) stance width and pelvis height
    const legs = ['l', 'r'].map(s => ({ s, t: B['thigh_' + s], c: B['calf_' + s], f: B['foot_' + s] })).filter(g => g.t && g.c && g.f);
    if (legs.length !== 2) return;
    // body over the feet: move the pelvis so the neck is above the ankle midpoint (+ small seeded lean)
    const a0 = L(legs[0].f), a1 = L(legs[1].f), midZ = (a0.z + a1.z) / 2;
    const nk = L(NECK), dz0 = THREE.MathUtils.clamp(midZ + 0.03 + P.lean * 0.4 - nk.z, -0.12, 0.12);
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
      const pw = WP(B.pelvis);
      _a.copy(pel2).setY(pel.y + dy); root.localToWorld(_a);
      B.pelvis.position.add(B.pelvis.parent.worldToLocal(_a.clone()).sub(B.pelvis.parent.worldToLocal(pw)));
      fresh(B.pelvis); for (const c of legChains) freshAll(c);
    }
    // (4) legs: IK to the narrowed ankle targets at the clip's ankle height, knees toward the front
    for (const g of legs) {
      const tgt = root.localToWorld(g.ank.clone());
      const knee = L(g.c); knee.z += 0.4; root.localToWorld(knee);
      ik2f(g.t, g.c, g.f, tgt, knee);
    }
  });
  return P;
}
