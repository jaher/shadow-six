import { THREE, ROSTER, loadLib, makeChar } from './common.js';
import { start, run, r2 } from './metrics.js';
export default async function (canvas, W, H, args) {
  const lib = await loadLib(); const h = await makeChar(ROSTER.find(r => r.id === 'mcrae'), lib, null); const out = {};
  const K = ['pelvis', 'Head', 'hand_l', 'hand_r', 'foot_l', 'foot_r', 'calf_l'];
  const P = (f) => K.map(k => { const p = h.bones[k].getWorldPosition(new THREE.Vector3()); return [r2(p.x, 2), r2(p.y, 2), r2(p.z, 2)]; });
  const up = () => { const q = h.bones.spine_03.getWorldQuaternion(new THREE.Quaternion()); return ['x', 'y', 'z'].map(a => { const v = new THREE.Vector3(a === 'x' ? 1 : 0, a === 'y' ? 1 : 0, a === 'z' ? 1 : 0).applyQuaternion(q); return v.toArray().map(x => r2(x, 2)); }); };
  for (const c of args.clips || ['stand_up', 'crawl_idle', 'idle', 'die', 'dead_prone', 'crouch_idle']) {
    start(h, c, { loop: false }); const d = h.clip(h.animClip).duration; const rows = [];
    for (let i = 0; i <= 6; i++) { h.mixer.setTime(0); h.setAnim; const a = h.mixer.existingAction(h.clip(h.animClip)); a.time = d * i / 6 * 0.999; h.mixer.update(0); h.object.updateMatrixWorld(true); rows.push({ t: r2(d * i / 6, 2), P: P(), spine03axes: up() }); }
    out[c] = rows;
  }
  return { count: 0, result: () => out };
}
