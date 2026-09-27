// anim_e.js - locomotion slip (unit moved at speed), transition pops, via enemykit
import * as THREE from 'three';
import { loadEnemySet, spawnEnemy } from '/chars/enemies/web/enemykit.js';
export default async function () {
  const A = window.__args; const E = await loadEnemySet('/chars/enemies/out/'); const all = Object.values(E.variantsByType).flat();
  return { count: A.ids.length, async render(i) {
    const id = A.ids[i]; const h = await spawnEnemy(E, 'anim', { id: 'a_' + id }, all.find(v => v.id === id));
    const B = h.bones, res = {}; const dt = 1 / 60;
    for (const [clip, speed] of A.loco) {
      h.object.position.set(0, 0, 0); h.setAnim('idle', { fade: 0 }); h.update(0);
      h.setAnim(clip, { speed, fade: 0 }); const feet = ['ball_l', 'ball_r'], prev = [null, null], slips = [], steps = []; let lastLow = null, nSteps = 0; const prevF = [null, null], ank = [[], []];
      for (let f = 0; f < 240; f++) {
        h.object.position.z += speed * dt; h.update(dt); h.object.updateMatrixWorld(true);
        const P = feet.map(b => B[b].getWorldPosition(new THREE.Vector3()));
        const low = P[0].y < P[1].y ? 0 : 1;
        if (f > 30) { const p = P[low], q = prev[low]; if (q && p.y < 0.06) slips.push(Math.hypot(p.x - q.x, p.z - q.z) / dt); if (lastLow !== null && low !== lastLow) nSteps++; }
        const Fk = ['foot_l', 'foot_r'].map(b => B[b].getWorldPosition(new THREE.Vector3()));
        if (f > 30) for (const k of [0, 1]) { const pa = prevF[k]; if (pa && Fk[k].y < Fk[1 - k].y + 0.01) ank[k].push(Math.hypot(Fk[k].x - pa.x, Fk[k].z - pa.z) / dt); }
        prevF[0] = Fk[0]; prevF[1] = Fk[1];
        lastLow = low; prev[0] = P[0]; prev[1] = P[1];
      }
      slips.sort((a, b) => a - b);
      res[clip + '@' + speed] = { slipMed: +(slips[slips.length >> 1] || 0).toFixed(2), slipP80: +(slips[Math.floor(slips.length * 0.8)] || 0).toFixed(2), stepsPerMin: Math.round(nSteps / (210 * dt) * 60), ts: +h._holdAction.getEffectiveTimeScale().toFixed(2), clip: h._holdClip, ankMinL: +Math.min(...ank[0]).toFixed(2), ankMinR: +Math.min(...ank[1]).toFixed(2), ankMedL: +ank[0].sort((a,b)=>a-b)[ank[0].length>>2].toFixed(2), ankMedR: +ank[1].sort((a,b)=>a-b)[ank[1].length>>2].toFixed(2) };
    }
    // transition pop: run -> die, idle -> aim (max joint travel per frame, metres)
    for (const [a, b] of [['run', 'die'], ['idle', 'aim'], ['aim', 'idle'], ['walk', 'reload']]) {
      h.object.position.set(0, 0, 0); h.setAnim(a, { fade: 0 }); for (let f = 0; f < 20; f++) h.update(dt);
      h.setAnim(b, { loop: false }); let prevP = null, mx = 0;
      for (let f = 0; f < 40; f++) { h.update(dt); h.object.updateMatrixWorld(true); const P = Object.values(B).map(o => o.getWorldPosition(new THREE.Vector3()));
        if (prevP) for (let k = 0; k < P.length; k++) mx = Math.max(mx, P[k].distanceTo(prevP[k])); prevP = P; }
      res['pop_' + a + '>' + b] = +mx.toFixed(3);
    }
    return { label: null, res: { id, ...res } };
  } };
}
