/**
 * The Green Beret's explosive drum in his hands (user 2026-10-22, "When green beret walks a barrel does the body move
 * well?" — it did not: the drum floated at head height on a fixed offset from his sim position). The drum is read
 * back off his hand bones every drawn frame: the barrel clips (tools/characters/barrel) all grip it at the same place,
 * so its base frame in each hand bone's space is one constant (characters/barrel-grip.js BARREL_GRIP), and the drum
 * goes wherever his hands take it — the walk's bob and waddle, the lean, every cross-fade between the clips.
 *
 *   pick-up  (Barrel.pendingLift, abilities/shared.js): on the ground where it stands until his hands reach it
 *            (BARREL_CLIPS.barrel_lift.contact), then eased onto them over EASE s (he stands `stand` m off when the
 *            step-in was possible, the distance the clip was authored for: then the ease moves it by nothing)
 *   carried  on his hands
 *   set-down (Barrel.pendingDrop): on his hands, eased onto the spot the sim stands it on over the EASE s before the
 *            clip's release — the same spot when it is the dropSpot ahead of him (0.6 m, the clip's), a body's place for
 *            a drum laid over a body — and left there
 *
 * The spin about its own axis is the drum's (Barrel.carrySpin: its heading less his when he took it), so a drum that
 * is picked up and set down again turns with him, never round its axis in his hands. Visual only: the sim keeps its
 * own carried-drum position (Barrel.update). A carrier without the barrel clips (a placeholder body, a kit without
 * them) keeps the old pelvis ride (Barrel.renderUpdate).
 * @module art/barrel-carry
 */
import * as THREE from 'three';
import { BARREL_GRIP, BARREL_CLIPS } from './characters/barrel-grip.js';
import { headingToRotY } from '../core/math.js';

/** Seconds over which the drum goes from the ground onto his hands (pick-up) or from them onto its spot (set-down). */
export const EASE = { lift: 0.22, drop: 0.3 };

const compose = (g) => new THREE.Matrix4().compose(new THREE.Vector3(...g.p), new THREE.Quaternion(...g.q), new THREE.Vector3(1, 1, 1));
const GRIP = { l: compose(BARREL_GRIP.l), r: compose(BARREL_GRIP.r) };
const _m = new THREE.Matrix4(), _pl = new THREE.Vector3(), _pr = new THREE.Vector3(), _ql = new THREE.Quaternion(), _qr = new THREE.Quaternion();
const _s = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _spin = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);
const sstep = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

/** The carrier's hand bones when his model is playing one of the barrel clips (they grip the drum), else null. */
export function gripBones(c) {
  const m = c?.model, inner = m?.real?.inner;
  if (!inner?.bones || !BARREL_CLIPS[m.clip]) return null;
  const l = inner.bones.hand_l, r = inner.bones.hand_r;
  return l && r ? { l, r } : null;
}

/**
 * Drum base frame from both hands (position averaged, rotation halfway), spun about its own axis by `spin` (rad).
 * @returns {boolean} false without hand bones
 */
export function drumFromHands(H, spin, outP, outQ) {
  H.l.updateWorldMatrix(true, false); H.r.updateWorldMatrix(true, false);
  _m.multiplyMatrices(H.l.matrixWorld, GRIP.l).decompose(_pl, _ql, _s);
  _m.multiplyMatrices(H.r.matrixWorld, GRIP.r).decompose(_pr, _qr, _s);
  outP.copy(_pl).add(_pr).multiplyScalar(0.5);
  outQ.copy(_ql).slerp(_qr, 0.5);
  if (spin) outQ.multiply(_spin.setFromAxisAngle(_Y, -spin));
  return true;
}

/** The drum of `b` posed for this frame (after every model's update). @returns {boolean} posed */
export function poseCarriedDrum(b) {
  const o = b.object3d;
  if (!o || b.exploded) return false;
  const lift = !b.carriedBy && b.pendingLift ? b.pendingLift : null, drop = b.pendingDrop || null;
  const c = b.carriedBy || lift?.by || drop?.by || null;
  const H = c ? gripBones(c) : null;
  if (!H) return false;
  // his hold, the drum turned on its axis as it stood when he took it
  const spin = b.carriedBy ? b.carrySpin || 0 : wrap((b.heading || 0) - (c.heading || 0));
  drumFromHands(H, spin, _p, _q);
  if (lift) {   // on the ground until his hands are on it, then onto them
    const k = sstep(((lift.t ?? 0) - (BARREL_CLIPS.barrel_lift?.contact ?? 0)) / EASE.lift);
    o.position.lerp(_p, k);
    o.quaternion.slerp(_q, k);
  } else if (drop) {   // on his hands, then onto the spot where the sim stands it
    const rel = BARREL_CLIPS.barrel_put_down?.release ?? drop.dur ?? 0.5;
    const k = sstep(((drop.t ?? 0) - (rel - EASE.drop)) / EASE.drop);
    if (k > 0 && drop.spot) {
      const gy = c.world?.groundY ? c.world.groundY(drop.spot.x, drop.spot.z) : 0;
      _p.lerp(_s.set(drop.spot.x, (c.y || 0) + gy, drop.spot.z), k);
      _q.slerp(_q2.setFromAxisAngle(_Y, headingToRotY((c.heading || 0) + (b.carrySpin || 0))), k);
    }
    o.position.copy(_p); o.quaternion.copy(_q);
  } else { o.position.copy(_p); o.quaternion.copy(_q); }
  b._drumPosed = true;
  return true;
}

/** Every carried or changing-hands drum of the world, after the character updates (Game.render). */
export function barrelCarryFrame(world) {
  const list = world?.interactables;
  if (!list) return;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.interactKind !== 'barrel' || !(b.carriedBy || b.pendingLift || b.pendingDrop || b._drumPosed)) continue;
    if (!poseCarriedDrum(b) && b._drumPosed) {   // let go (or the carrier lost his barrel clip): upright again
      b._drumPosed = false;
      if (b.object3d && !b.carriedBy) { b.object3d.rotation.x = 0; b.object3d.rotation.z = 0; }
    }
  }
}

function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
