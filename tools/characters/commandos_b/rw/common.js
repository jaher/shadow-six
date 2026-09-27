// shared loaders + character roster for the animation/perf check
import * as THREE from 'three';
import { loadCharacter, loadAnimLibrary, createHumanoid } from '/chars/commandos_b/pipeline/web/charkit.js';
import { loadWeapons, equip } from '/chars/commandos_b/pipeline/web/weapons.js';
export { THREE, loadCharacter, loadAnimLibrary, createHumanoid, loadWeapons, equip };

export const REQ_CORE = ['idle','walk','run','crawl_idle','crawl','swim','dive','aim','shoot','stab','throw','punch','plant','climb','carry_idle','carry_walk','die','dead','surrender','salute','look_around','use'];
export const REQ_EXTRA = ['kneel_shoot','syringe','dig','bury','drag','lower_ladder','carry_barrel','pickup','handsup_held','talk','wave','drive','sit','rifle_shoot','stand_up','die_prone','dead_prone','set_trap','cut_wire','change_clothes','carried','walk_fast','run_fast'];
export const ENEMY_CLIPS = ['idle','walk','run','look_around','aim','shoot','rifle_shoot','reload','die','dead','surrender','handsup_held','talk','salute','sit','drive','hit','smoke','walk_hands_back','idle_hands_back','binoculars','point','detonate'];
export const GUEST_CLIPS = ['idle','walk','run','crawl_idle','crawl','die','dead','surrender','handsup_held','sit','drive','talk','wave','tied_idle','tied_walk','freed'];

const CA = '/chars/commandos_a/out/', CB = '/chars/commandos_b/final/', EN = '/chars/enemies/out/', GU = '/chars/guests/out/';
// role speeds from design-spec §3.1 / §4.1 (m/s)
export const ROSTER = [
  { id: 'greenberet', url: CA + 'greenberet.glb', group: 'commando', weapon: 'colt1911', melee: 'knife', walk: 2.25, run: 5.4, crawl: 0.9, carry: 1.6 },
  { id: 'sniper', url: CA + 'sniper.glb', group: 'commando', weapon: 'no4_sniper', walk: 2.25, run: 4.5, crawl: 0.9 },
  { id: 'marine', url: CA + 'marine.glb', group: 'commando', weapon: 'harpoon_gun', melee: 'knife', walk: 2.25, run: 4.5, crawl: 0.9 },
  { id: 'marine_diver', url: CA + 'marine_diver.glb', group: 'commando', weapon: 'harpoon_gun', walk: 2.25, run: 4.5, crawl: 0.9, swim: 1.8 },
  { id: 'sapper', url: CB + 'sapper.glb', group: 'commando', weapon: 'walther_p38', walk: 2.25, run: 4.5, crawl: 0.9 },
  { id: 'driver', url: CB + 'driver.glb', group: 'commando', weapon: 'thompson', walk: 2.25, run: 5.4, crawl: 0.9 },
  { id: 'driver_burns', url: CB + 'driver_burns.glb', group: 'commando', weapon: 'thompson', walk: 2.25, run: 5.4, crawl: 0.9 },
  { id: 'spy', url: CB + 'spy.glb', group: 'commando', weapon: 'walther_p38', melee: 'syringe', disguise: CB + 'spy_disguise.glb', walk: 2.25, run: 4.5, crawl: 0.9, carry: 1.6 },
  ...['rifleman_v00:kar98k','trooper_v00:mp40','sentry_v00:kar98k','sergeant_v00:luger','officer_v00:walther_p38','mg_v00:mg34','engineer_v00:','crew_v00:walther_p38','afrika_v00:kar98k','winter_v00:kar98k','general_schleper:']
    .map(s => { const [id, w] = s.split(':'); return { id, url: EN + id + '.glb', group: 'enemy', weapon: w || null, walk: 0.9, walk2: 1.8, run: 3.8 }; }),
  ...['mcrae','informer','gilbert','prisoner_farmhand','prisoner_worker','prisoner_oldman','prisoner_clerk','civ_tram_driver']
    .map(id => ({ id, url: GU + id + '.glb', group: 'guest', walk: 2.25, run: 4.5, crawl: 0.9 })),
];

// FIX: anims GLBs keep userData.shadowSix on the child node 'Scene', not on gltf.scene -> charkit gets empty meta
// (no groundSpeed, no loop flags) and srcPelvisRest=null (pelvis track not retargeted). fix=true re-reads it.
export function fixLib(lib) {
  let ud = null; lib.gltf.scene.traverse(o => { if (!ud && o.userData && o.userData.shadowSix) ud = o.userData.shadowSix; });
  if (!ud) return lib;
  Object.assign(lib.meta, ud.clips || {}); if (ud.pelvisRest) lib.srcPelvisRest = new THREE.Vector3(...ud.pelvisRest);
  return lib;
}
export async function loadLib({ fix = true } = {}) {
  const lib = await loadAnimLibrary('/chars/commandos_b/out/anims.glb');
  for (const u of ['/chars/enemies/out/enemy_anims.glb', '/chars/guests/out/guest_anims.glb']) {
    try { const ex = await loadAnimLibrary(u); if (fix) for (const [k, c] of ex.clips) if (!lib.clips.has(k)) lib.clips.set(k, c); for (const [k, m] of Object.entries(ex.meta)) if (!lib.meta[k]) lib.meta[k] = m; }
    catch (e) { console.log('extra lib fail', u, e.message); }
  }
  return lib;
}

export async function makeChar(R, lib, W) {
  const tpl = await loadCharacter(R.url);
  const dis = R.disguise ? await loadCharacter(R.disguise) : null;
  const h = createHumanoid(tpl, lib, { disguise: dis });
  if (W && R.weapon) equip(h, W, R.weapon);
  return h;
}

export function orthoCam(W, H, pxPerM, target = new THREE.Vector3(0, 0.9, 0)) {
  const hw = W / 2 / pxPerM, hh = H / 2 / pxPerM;
  const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.1, 400);
  const pitch = THREE.MathUtils.degToRad(40);   // yaw 0: looking north (-Z) from +Z
  cam.position.set(target.x, target.y + 100 * Math.sin(pitch), target.z + 100 * Math.cos(pitch));
  cam.lookAt(target); cam.updateProjectionMatrix();
  return cam;
}
