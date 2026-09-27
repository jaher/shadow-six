// draw calls + CPU: 30 enemies (enemykit), 1920x1080 ortho game camera, PCF shadows; per LOD
import * as THREE from 'three';
import { loadEnemySet, spawnEnemy } from '/chars/enemies/web/enemykit.js';
import { assignEnemyVariants } from '/chars/enemies/web/enemy_variety.js';
export default async function (canvas, W, H) {
  const A = window.__args; const r = new THREE.WebGLRenderer({ canvas, antialias: true }); r.setSize(W, H, false); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 }); sun.position.set(10, 20, 10); scene.add(sun);
  const E = await loadEnemySet('/chars/enemies/out/');
  const types = ['rifleman', 'rifleman', 'rifleman', 'trooper', 'sentry', 'sergeant', 'mg', 'engineer', 'rifleman', 'officer'];
  const spawns = []; for (let i = 0; i < 30; i++) spawns.push({ id: 's' + i, type: types[i % 10], squad: 'A', x: i, z: 0 });
  const picks = assignEnemyVariants('perf', spawns, E.variantsByType); const units = [];
  for (let i = 0; i < 30; i++) { const h = await spawnEnemy(E, 'perf', spawns[i], picks.get(spawns[i].id)); h.setAnim(i % 3 ? 'walk' : 'idle', { fade: 0 }); h.object.position.set((i % 6) * 3 - 8, 0, Math.floor(i / 6) * 3 - 6); scene.add(h.object); units.push(h); }
  const cam = new THREE.OrthographicCamera(-W / 80, W / 80, H / 80, -H / 80, 0.1, 200); cam.position.set(0, Math.sin(0.698) * 50, Math.cos(0.698) * 50); cam.lookAt(0, 0, 0);
  const out = {};
  for (const lod of ['LOD0', 'LOD1', 'LOD2']) {
    for (const h of units) h.setLOD(lod);
    for (let f = 0; f < 5; f++) { for (const h of units) h.update(1 / 60); r.render(scene, cam); }
    r.info.autoReset = false; r.info.reset(); r.render(scene, cam); out[lod] = { calls: r.info.render.calls, tris: r.info.render.triangles }; r.info.autoReset = true;
  }
  out.programs = r.info.programs.length; out.textures = r.info.memory.textures;
  const hideT = units[0]; hideT.setLOD('LOD2'); hideT.show('headgear', false); let vis = 0; hideT.object.traverseVisible(o => { if (o.isMesh) vis++; }); out.hiddenHgGeomVerts = hideT.parts.LOD2.geometry.attributes.position.count; hideT.show('headgear', true); out.shownHgGeomVerts = hideT.parts.LOD2.geometry.attributes.position.count; out.merged = units.filter(h => h._hgMerged).length;
  console.log(JSON.stringify(out));
  return { count: 0, render() {} };
}
