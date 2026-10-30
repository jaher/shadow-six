/**
 * One skinning update per drawn frame (perf/characters-detail).
 *
 * three.js recomputes a skeleton's bone matrices and re-uploads its bone texture in EVERY renderer.render() call
 * (WebGLObjects keys its "once per frame" work on info.render.frame, which each render() bumps): the main pass (with
 * the shadow map), the GTAO normal prepass, the x-ray probes, the water mirror … — 3-4 times a frame for each man on
 * screen (167 skeleton updates a frame for the 46 men of tests/characters-perf). Inside Game.render's draw block every
 * world matrix is final (scene.matrixWorldAutoUpdate is off there and nothing poses a body between the passes), so a
 * skeleton updated once in that block is current for every later pass of the frame: same matrices, same image.
 * Outside a drawn frame (load-time warm renders, tools) skeletons update on every render as before.
 * (render/scope-magnifier.js does the same for its lens renders by pinning info.render.frame.)
 * @module engine/pose-frame
 */
import { Matrix4 } from 'three';

const _m = new Matrix4(), _id = new Matrix4();
/** n: drawn-frame counter; open: inside Game.render's draw block. */
export const POSE_FRAME = { n: 0, open: false };

/** Game.render: the frame's world matrices are final, its passes start. */
export function beginDrawnFrame() { POSE_FRAME.n++; POSE_FRAME.open = true; }
/** Game.render: the frame's passes are done. */
export function endDrawnFrame() { POSE_FRAME.open = false; }

/**
 * Skeleton.update (bone matrix = bone.matrixWorld × inverse bind) at most once per drawn frame, and the bone texture
 * re-uploaded only when a matrix changed: a man stepped at 15 Hz (humanoid-real's idle rule), a settled corpse or a
 * still figure keeps the same 4 KB of bone matrices for frames on end. Same float32 values as three's toArray.
 */
function updateOnce() {
  if (POSE_FRAME.open) {
    if (this._poseFrame === POSE_FRAME.n) return;
    this._poseFrame = POSE_FRAME.n;
  } else this._poseFrame = -1;
  const bones = this.bones, inv = this.boneInverses, out = this.boneMatrices;
  let changed = false;
  for (let i = 0, n = bones.length; i < n; i++) {
    const e = _m.multiplyMatrices(bones[i] ? bones[i].matrixWorld : _id, inv[i]).elements;
    for (let k = 0, o = i * 16; k < 16; k++, o++) {
      const v = Math.fround(e[k]);
      if (out[o] !== v) { out[o] = v; changed = true; }
    }
  }
  if (changed && this.boneTexture !== null) this.boneTexture.needsUpdate = true;
}

/** Make a skeleton update at most once per drawn frame (idempotent). @param {Skeleton} sk */
export function poseOncePerFrame(sk) {
  if (sk && sk.update !== updateOnce) sk.update = updateOnce;
  return sk;
}
