// transition snap check: from clip A (0.6 s) to clip B (default fade), 60 Hz: max per-frame move of gun, palms, and any joint
import * as THREE from 'three';
import { loadEnemySet, spawnEnemy } from '/chars/enemies/web/enemykit.js';
export default async function () {
  const A = window.__args; const E = await loadEnemySet('/chars/enemies/out/'); const out = {};
  for (const [id, a, b, sa, sb] of A.cases) {
    const h = await spawnEnemy(E, 's', { id: 's' + id + a + b }, { id, url: `/chars/enemies/out/${id}.glb` });
    h.setAnim(a, { fade: 0, speed: sa }); for (let i = 0; i < 36; i++) h.update(1 / 60);
    h.setAnim(b, { speed: sb });
    const bones = Object.values(h.bones); let prev = null, mx = { gun: 0, palmL: 0, palmR: 0, joint: 0, jn: '' , f: -1};
    for (let f = 0; f < 50; f++) {
      h.update(1 / 60); h.object.updateMatrixWorld(true);
      const cur = { gun: h.weapon ? h.weapon.getWorldPosition(new THREE.Vector3()) : null, palmL: h.bones.hand_l.getWorldPosition(new THREE.Vector3()), palmR: h.bones.hand_r.getWorldPosition(new THREE.Vector3()), J: bones.map(o => o.getWorldPosition(new THREE.Vector3())) };
      if (prev) { for (const k of ['gun', 'palmL', 'palmR']) if (cur[k]) { const d = cur[k].distanceTo(prev[k]); if (d > mx[k]) { mx[k] = d; if (k === 'gun') mx.f = f; } }
        cur.J.forEach((p, i) => { const d = p.distanceTo(prev.J[i]); if (d > mx.joint) { mx.joint = d; mx.jn = bones[i].name + '@' + f; } }); }
      prev = cur;
    }
    for (const k of ['gun', 'palmL', 'palmR', 'joint']) mx[k] = +mx[k].toFixed(3);
    out[`${id}:${a}->${b}`] = mx;
  }
  console.log(JSON.stringify(out));
  return { count: 0, render() {} };
}
