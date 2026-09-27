// Copied from scratchpad chars/commandos_b/pipeline/web/rig_util.js by tools/characters/consolidate/copy_runtime.py (imports/URLs rewritten; moved to src/art/characters in art integration 2). CC0 project code.
// rig_util.js - skeleton helpers from the verified prototype (realism/characters/web/rig.js), CC0 project code.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
export function bonesOf(root) { const m = {}; root.traverse(o => { if (o.isBone && !(o.name in m)) m[o.name] = o; }); return m; }
export function orderedBones(root) { const a = []; root.traverse(o => { if (o.isBone) a.push(o); }); return a; }
const wpos = (o) => o.getWorldPosition(new THREE.Vector3());
const wquat = (o) => o.getWorldQuaternion(new THREE.Quaternion());

// Anatomical segments of the UAL skeleton: bone -> child joint that defines its direction.
// Spine/pelvis/neck/head/root/ball are NOT swung (their axis conventions differ between rigs; both rigs stand upright).
export const UAL_SEGMENTS = (() => {
  const s = {};
  for (const side of ['l', 'r']) {
    s['clavicle_' + side] = 'upperarm_' + side;
    s['upperarm_' + side] = 'lowerarm_' + side;
    s['lowerarm_' + side] = 'hand_' + side;
    s['hand_' + side] = 'middle_01_' + side;
    for (const f of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
      s[`${f}_01_${side}`] = `${f}_02_${side}`;
      s[`${f}_02_${side}`] = `${f}_03_${side}`;
    }
    s['thigh_' + side] = 'calf_' + side;
    s['calf_' + side] = 'foot_' + side;
    s['foot_' + side] = 'ball_' + side;
  }
  return s;
})();

// Pose/fit `root`'s skeleton in place.
//  pos(name)  -> world Vector3 target for that joint, or null (keep local offset)
//  dir(name)  -> world direction target for segment name->UAL_SEGMENTS[name], or null (no swing)
export function fitSkeleton(root, { pos = () => null, dir = () => null, segments = UAL_SEGMENTS }) {
  root.updateMatrixWorld(true);
  const B = bonesOf(root);
  for (const b of orderedBones(root)) {
    const p = pos(b.name);
    if (p) { b.position.copy(b.parent.worldToLocal(p.clone())); b.updateMatrixWorld(true); }
    const d = segments[b.name] ? dir(b.name) : null;
    if (d) {
      const child = B[segments[b.name]];
      const cur = b.localToWorld(child.position.clone()).sub(wpos(b)).normalize();
      const sw = new THREE.Quaternion().setFromUnitVectors(cur, d.clone().normalize());
      const nwq = sw.multiply(wquat(b));
      b.quaternion.copy(wquat(b.parent).invert().multiply(nwq));
    }
    b.updateMatrixWorld(true);
  }
}

