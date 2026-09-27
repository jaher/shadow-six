import { THREE, loadLib, makeChar, ROSTER } from './common.js';
export default async function () {
  const lib = await loadLib(); const R = ROSTER.find(r => r.id === 'sapper'); const h = await makeChar(R, lib, null);
  const out = {};
  for (const c of ['walk', 'run', 'sprint']) {
    h.mixer.stopAllAction(); const a = h.setAnim(c, { fade: 0 }); const d = h.clip(c).duration; const rows = [];
    for (let i = 0; i <= 30; i++) { a.time = d * i / 30; h.mixer.update(0); h.object.updateMatrixWorld(true);
      const p = n => h.bones[n].getWorldPosition(new THREE.Vector3()); const l = p('ball_l'), r = p('ball_r'), pe = p('pelvis');
      rows.push([i, +l.y.toFixed(3), +l.z.toFixed(3), +r.y.toFixed(3), +r.z.toFixed(3), +pe.y.toFixed(3), +pe.z.toFixed(3)]); }
    out[c] = { d, meta: lib.meta[c], rows }; h.setAnim('idle', { fade: 0 });
  }
  return { count: 0, result: () => out };
}
