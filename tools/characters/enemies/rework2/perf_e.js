// CPU update cost: 30 enemies (enemykit or squadkit), mixed clips; h.update only (render cost excluded)
import * as THREE from 'three';
import { loadEnemySet, spawnEnemy } from '/chars/enemies/web/enemykit.js';
import { assignEnemyVariants } from '/chars/enemies/web/enemy_variety.js';
export default async function () {
  const A = window.__args; const E = await loadEnemySet('/chars/enemies/out/');
  const SK = A.squad ? await import('/chars/commandos_b/pipeline/web/squadkit.js') : null;
  const types = ['rifleman', 'rifleman', 'rifleman', 'trooper', 'sentry', 'sergeant', 'mg', 'engineer', 'rifleman', 'officer'];
  const spawns = []; for (let i = 0; i < 30; i++) spawns.push({ id: 's' + i, type: types[i % 10], squad: 'A', x: i, z: 0 });
  const picks = assignEnemyVariants('perf', spawns, E.variantsByType);
  const scene = new THREE.Scene(); const units = [];
  const anims = ['walk', 'idle', 'look_around', 'walk', 'run', 'idle', 'aim', 'walk'];
  for (let i = 0; i < 30; i++) {
    const h = SK ? await SK.spawnSquadMember(E, 'perf', spawns[i], picks.get(spawns[i].id)) : await spawnEnemy(E, 'perf', spawns[i], picks.get(spawns[i].id));
    const a = A.anim || anims[i % anims.length]; h.setAnim(a, { fade: 0, speed: a === 'walk' ? 0.9 : a === 'run' ? 3.8 : null }); h.update(Math.random());
    h.object.position.set((i % 6) * 3, 0, Math.floor(i / 6) * 3); scene.add(h.object); units.push(h);
  }
  scene.updateMatrixWorld(true);
  for (let f = 0; f < 120; f++) for (const h of units) h.update(1 / 60);
  const T = []; for (let f = 0; f < 300; f++) { const t0 = performance.now(); for (const h of units) h.update(1 / 60); scene.updateMatrixWorld(); T.push(performance.now() - t0); }
  T.sort((a, b) => a - b);
  console.log(JSON.stringify({ squad: !!A.squad, anim: A.anim || 'mix', med: +T[150].toFixed(3), p90: +T[270].toFixed(3) }));
  return { count: 0, render() {} };
}
