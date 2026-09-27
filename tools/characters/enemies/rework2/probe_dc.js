import * as THREE from 'three';
import { loadEnemySet, spawnEnemy } from '/chars/enemies/web/enemykit.js';
export default async function () {
  const E = await loadEnemySet('/chars/enemies/out/'); const out = {};
  for (const n of ['kar98k', 'mg34', 'mp40', 'luger', 'walther_p38']) { let k = 0, mats = new Set(); E.weapons[n].root.traverse(o => { if (o.isMesh) { k++; mats.add(o.material.uuid); } }); out[n] = [k, mats.size]; }
  const h = await spawnEnemy(E, 'dc', { id: 'x' }, { id: 'rifleman_v00', url: '/chars/enemies/out/rifleman_v00.glb' });
  h.setAnim('idle', { fade: 0 }); h.update(0.016);
  const vis = []; h.object.traverseVisible(o => { if (o.isMesh) vis.push(o.name || o.type); }); out.visibleMeshes = vis;
  console.log(JSON.stringify(out));
  return { count: 0, render() {} };
}
