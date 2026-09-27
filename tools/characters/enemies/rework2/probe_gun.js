import * as THREE from 'three';
import { loadWeapons } from '/chars/pipeline/web/weapons.js';
export default async function () {
  const W = await loadWeapons('/chars/out/weapons.glb'); const out = {};
  for (const n of ['mg34', 'kar98k', 'mp40']) {
    const w = W[n].root; w.updateMatrixWorld(true); const inv = w.matrixWorld.clone().invert(); const S = {};
    w.traverse(c => { const m = c.name.match(/(grip_r|grip_l|butt|muzzle|sling_f|sling_b|bipod)$/); if (m && c !== w) S[m[1]] = c.position.toArray().map(x => +x.toFixed(3)); });
    const rows = {}; const v = new THREE.Vector3();
    w.traverse(o => { if (!o.isMesh) return; const p = o.geometry.attributes.position; const M = o.matrixWorld.clone().premultiply(inv);
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(M); const z = Math.round(v.z * 50) / 50; if (z < 0.1 || z > 0.4) continue; const r = rows[z] || (rows[z] = { ymin: 9, ymax: -9, xmin: 9, xmax: -9 }); r.ymin = Math.min(r.ymin, v.y); r.ymax = Math.max(r.ymax, v.y); r.xmin = Math.min(r.xmin, v.x); r.xmax = Math.max(r.xmax, v.x); } });
    for (const r of Object.values(rows)) for (const k in r) r[k] = +r[k].toFixed(3);
    out[n] = { S, rows };
  }
  console.log(JSON.stringify(out));
  return { count: 0, render() {} };
}
