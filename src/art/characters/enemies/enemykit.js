// Copied from scratchpad chars/enemies/web/enemykit.js by tools/characters/consolidate/copy_runtime.py (imports/URLs rewritten; moved to src/art/characters in art integration 2). CC0 project code.
// enemykit.js - runtime for the German enemy set (bible §5.2): prebuilt variant GLBs + seeded per-instance jitter.
//   const E = await loadEnemySet('/chars/enemies/out/');                  // index + merged anim library (+enemy clips)
//   const picks = assignEnemyVariants(missionId, spawns, E.variantsByType);    // 30 m / same-squad neighbour rule
//   const h = await spawnEnemy(E, missionId, spawn, picks.get(spawn.id)); // humanoid (ARCHITECTURE interface) + jitter
// Per instance (no extra GLB): height 0.97-1.03, body width 0.97-1.04 (object x-scale), cloth tint +-6 % (skin untouched), helmet
// shows/hides via h.show('headgear', bool). Schleper: h.walkSpeedScale = 0.8 (the game moves him slower).
// Weapons (enemy_weapons.js) are equipped from the variant's spec and solved every frame after the mixer: long guns are
// shouldered with both hands on the gun (aim/shoot -> rifle_aim/rifle_fire clips), slung otherwise, dropped on death.
// enemy_runtime.js: anim meta fix, die/dead ground clamp, run stride warp, props, frustum culling + shared skeleton, LOD.
import * as THREE from 'three';
import { loadCharacter, loadAnimLibrary, createHumanoid } from '../pipeline/charkit.js';
import { instanceJitter } from '../pipeline/variety.js';
import { assignEnemyVariants } from './enemy_variety.js';
import { loadWeapons } from '../pipeline/weapons.js';
import { equipEnemy, LONG } from './enemy_weapons.js';
import { fixLibMeta, installRuntime, enemyLodFor } from './enemy_runtime.js';
import { scoped, touch, sceneBytes, disposeScene } from '../../../engine/scoped-assets.js';
export { enemyLodFor };
export { assignEnemyVariants, instanceJitter };

export async function loadEnemySet(base, { anims = new URL('../../../../assets/characters/anims/base_anims.glb', import.meta.url).href, weapons = new URL('../../../../assets/characters/weapons/weapons.glb', import.meta.url).href, enemyAnims = null } = {}) {
  const [index, lib, ex, W] = await Promise.all([fetch(base + 'enemies_index.json').then(r => r.json()), loadAnimLibrary(anims).then(fixLibMeta),
    loadAnimLibrary(enemyAnims || base + 'enemy_anims.glb').then(fixLibMeta), weapons ? loadWeapons(weapons) : null]);
  for (const [k, c] of ex.clips) lib.clips.set(k, c);
  Object.assign(lib.meta, ex.meta);
  const variantsByType = {};
  for (const [t, vs] of Object.entries(index)) variantsByType[t] = vs.map(v => ({ ...v, url: base + v.id + '.glb' }));
  // spec §4.1 soldierType aliases -> built looks
  for (const [alias, t] of Object.entries({ soldier: 'rifleman', truckDriver: 'crew', courier: 'trooper', gunner: 'mg' })) if (!variantsByType[alias] && variantsByType[t]) variantsByType[alias] = variantsByType[t];
  return { base, index, lib, weapons: W, variantsByType, templates: new Map(), runtime: new Map() };
}

function tintCloth(mesh, tint) {
  const src = mesh.material; const m = src.clone();
  const prev = src.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev && prev.call(src, sh, r);
    sh.uniforms.s6Cloth = { value: new THREE.Color(...tint) };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 s6Cloth;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(1.0), s6Cloth, vS6Mask.y);');
  };
  m.customProgramCacheKey = () => 's6shade_cloth';
  mesh.material = m;
}

/**
 * Load a variant's template, scoped to the missions that use it (engine/scoped-assets.js): a variant no kept mission
 * uses is freed after the next mission loads. Module level, so the callbacks hold only (E, id, p).
 */
function loadTemplate(E, variant) {
  const id = variant.id, p = loadCharacter(variant.url);
  E.templates.set(id, p);
  p.then((tpl) => scoped(`chr:enemy:${id}`, tpl, { bytes: sceneBytes(tpl.gltf.scene), free: (t) => {
    if (E.templates.get(id) === p) { E.templates.delete(id); E.runtime.delete(id); }
    disposeScene(t.gltf.scene);
  } }), () => { if (E.templates.get(id) === p) E.templates.delete(id); });
  return p;
}

export async function spawnEnemy(E, missionId, spawn, variant) {
  if (!E.templates.has(variant.id)) loadTemplate(E, variant);
  else touch(`chr:enemy:${variant.id}`);
  const tpl = await E.templates.get(variant.id);
  const h = createHumanoid(tpl, E.lib);
  if (!E.runtime.has(variant.id)) E.runtime.set(variant.id, { scratch: createHumanoid(tpl, E.lib) });
  const rt = E.runtime.get(variant.id);
  const wname = ((tpl.info.weapon || {}).primary) || null;
  if (wname && E.weapons) equipEnemy(h, E.weapons, wname);
  if (wname && LONG.has(wname)) h.clipAlias = { aim: 'rifle_aim', aim_up: 'rifle_aim', aim_down: 'rifle_aim', kneel_shoot: 'rifle_aim', shoot: 'rifle_fire', rifle_shoot: 'rifle_fire', reload: 'rifle_reload' };
  if ((tpl.info.enemy || {}).soldierType === 'general' || /general/.test(variant.id)) h.clipAlias = Object.assign(h.clipAlias || {}, { walk: 'walk_hands_back', idle: 'idle_hands_back' });   // Schleper's own slow, hands-behind-back gait (walkSpeedScale 0.8 keeps feet planted)
  installRuntime(h, rt.scratch, rt, E.lib);
  const j = instanceJitter(missionId, spawn.id);
  h.object.scale.set(j.heightScale * j.widthScale, j.heightScale, j.heightScale * (1 + (j.widthScale - 1) * 0.5));
  h.object.traverse(o => { if (o.isSkinnedMesh && o.geometry.attributes._mask) tintCloth(o, j.clothTint); });
  h.walkSpeedScale = (tpl.info.enemy || {}).walkSpeedScale || 1;   // game moves him slower; setAnim('walk',{speed}) keeps feet planted
  h.variant = variant; h.jitter = j;
  return h;
}

// distinctness report for a set of spawns: same type within radius / squad must differ in head (and key)
export function checkDistinct(spawns, picks, radius = 30) {
  const bad = [];
  for (const a of spawns) for (const b of spawns) {
    if (a.id >= b.id || a.type !== b.type) continue;
    const near = (a.squad && a.squad === b.squad) || Math.hypot(a.x - b.x, a.z - b.z) < radius;
    if (near && (picks.get(a.id).id === picks.get(b.id).id)) bad.push([a.id, b.id]);
  }
  return bad;
}
