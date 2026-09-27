// held-pose float check: idle -> clip (default fade), 60 Hz for 12 s; pelvis world y at 1,2,3,6,12 s
import * as THREE from 'three';
import { loadEnemySet, spawnEnemy } from '/chars/enemies/web/enemykit.js';
export default async function () {
  const A = window.__args; const E = await loadEnemySet('/chars/enemies/out/'); const out = {};
  const SK = A.squad ? await import('/chars/commandos_b/pipeline/web/squadkit.js') : null;
  for (const id of A.ids) for (const clip of A.clips) {
    const h = await (SK ? SK.spawnSquadMember : spawnEnemy)(E, 'f', { id: 'f' + id + clip }, { id, url: `/chars/enemies/out/${id}.glb` });
    h.setAnim('idle', { fade: 0 }); for (let i = 0; i < 30; i++) h.update(1 / 60);
    const a = h.setAnim(clip, { loop: false }); if (!a) { out[id + ':' + clip] = 'missing'; continue; }
    const rec = []; const p = new THREE.Vector3();
    for (let f = 1; f <= 720; f++) { h.update(1 / 60); if ([60, 120, 180, 360, 720].includes(f)) { h.object.updateMatrixWorld(true); rec.push(+h.bones.pelvis.getWorldPosition(p).y.toFixed(3)); } }
    out[id + ':' + clip] = rec;
  }
  console.log(JSON.stringify(out));
  return { count: 0, render() {} };
}
