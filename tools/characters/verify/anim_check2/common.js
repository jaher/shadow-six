// round-2 anim/perf check: each group through ITS OWN reworked runtime (the path the consolidation step will wire in)
import * as THREE from 'three';
import * as CK from '/chars/pipeline/web/charkit.js';                 // shared (used by ca_runtime + enemykit)
import * as SW from '/chars/pipeline/web/weapons.js';
import { loadCALib, createCommando, equipCA } from '/chars/commandos_a/web/ca_runtime.js';
import * as CBK from '/chars/commandos_b/pipeline/web/charkit.js';
import * as CBW from '/chars/commandos_b/pipeline/web/weapons.js';
import { loadEnemySet, spawnEnemy } from '/chars/enemies/web/enemykit.js';
import { spawnSquadMember, assignSquadVariants } from '/chars/commandos_b/pipeline/web/squadkit.js';
import * as GK from '/chars/guests/pipeline/web/charkit.js';
import { loadGuestLib, createGuest } from '/chars/guests/pipeline/web/guestkit.js';
export { THREE, spawnSquadMember, assignSquadVariants };

export const REQ_CORE = ['idle','walk','run','crawl_idle','crawl','swim','dive','aim','shoot','stab','throw','punch','plant','climb','carry_idle','carry_walk','die','dead','surrender','salute','look_around','use'];
export const REQ_EXTRA = ['kneel_shoot','syringe','dig','bury','drag','lower_ladder','carry_barrel','pickup','handsup_held','talk','wave','drive','sit','rifle_shoot','stand_up','die_prone','dead_prone'];
export const ENEMY_CLIPS = ['idle','walk','run','look_around','aim','shoot','rifle_shoot','reload','die','dead','surrender','handsup_held','talk','salute','sit','drive','hit','smoke','walk_hands_back','idle_hands_back','binoculars','point','detonate'];
export const GUEST_CLIPS = ['idle','walk','run','crawl_idle','crawl','die','dead','surrender','handsup_held','sit','drive','talk','wave','tied_idle','tied_walk','freed','follow_walk','follow_idle','go_prone','get_up','die_run'];

const CA = '/chars/commandos_a/out/', CB = '/chars/commandos_b/final/', EN = '/chars/enemies/out/', GU = '/chars/guests/out/';
export const ROSTER = [
  { id: 'greenberet', url: CA + 'greenberet.glb', group: 'ca', weapon: 'colt1911', walk: 2.25, run: 5.4, crawl: 0.9, carry: 1.6 },
  { id: 'sniper', url: CA + 'sniper.glb', group: 'ca', weapon: 'no4_sniper', walk: 2.25, run: 4.5, crawl: 0.9 },
  { id: 'marine', url: CA + 'marine.glb', group: 'ca', weapon: 'harpoon_gun', walk: 2.25, run: 4.5, crawl: 0.9 },
  { id: 'marine_diver', url: CA + 'marine_diver.glb', group: 'ca', weapon: 'harpoon_gun', walk: 2.25, run: 4.5, crawl: 0.9, swim: 1.8 },
  { id: 'sapper', url: CB + 'sapper.glb', group: 'cb', weapon: 'walther_p38', walk: 2.25, run: 4.5, crawl: 0.9 },
  { id: 'driver', url: CB + 'driver.glb', group: 'cb', weapon: 'thompson', walk: 2.25, run: 5.4, crawl: 0.9 },
  { id: 'driver_burns', url: CB + 'driver_burns.glb', group: 'cb', weapon: 'thompson', walk: 2.25, run: 5.4, crawl: 0.9 },
  { id: 'spy', url: CB + 'spy.glb', group: 'cb', weapon: 'walther_p38', disguise: CB + 'spy_disguise.glb', walk: 2.25, run: 4.5, crawl: 0.9, carry: 1.6 },
  ...['rifleman_v00','trooper_v00','sentry_v00','sergeant_v00','officer_v00','mg_v00','engineer_v04','crew_v00','afrika_v00','winter_v00','general_schleper']
    .map(id => ({ id, group: 'enemy', walk: 0.9, walk2: 1.8, run: 3.8 })),
  ...['mcrae','informer','gilbert','prisoner_farmhand','prisoner_worker','prisoner_oldman','prisoner_clerk','civ_tram_driver']
    .map(id => ({ id, url: GU + id + '.glb', group: 'guest', walk: 2.25, run: 4.5, crawl: 0.9 })),
];

const G = {};
export async function group(g) {
  if (G[g]) return G[g];
  if (g === 'ca') { const lib = await loadCALib(); const W = await SW.loadWeapons('/chars/out/weapons.glb');
    G[g] = { lib, make: async (R, wpn = true) => { const h = createCommando(await CK.loadCharacter(R.url), lib); if (wpn && R.weapon) equipCA(h, W, R.weapon); return h; } }; }
  if (g === 'cb') { const lib = await CBK.loadAnimLibrary('/chars/commandos_b/out/anims.glb'); const W = await CBW.loadWeapons('/chars/commandos_b/out/weapons/weapons.glb');
    G[g] = { lib, make: async (R, wpn = true) => { const tpl = await CBK.loadCharacter(R.url); const dis = R.disguise ? await CBK.loadCharacter(R.disguise) : null;
      const h = CBK.createHumanoid(tpl, lib, { disguise: dis }); if (wpn && R.weapon) CBW.equip(h, W, R.weapon); return h; } }; }
  if (g === 'enemy') { const E = await loadEnemySet(EN); let k = 0;
    const find = (id) => Object.values(E.variantsByType).flat().find(v => v.id === id);
    G[g] = { lib: E.lib, E, make: async (R) => spawnEnemy(E, 'chk', { id: 'c' + (k++) }, find(R.id)) }; }
  if (g === 'guest') { const lib = await loadGuestLib();
    G[g] = { lib, make: async (R) => createGuest(await GK.loadCharacter(R.url), lib, { id: R.id }) }; }
  return G[g];
}
export async function makeChar(R, wpn = true) { const g = await group(R.group); return g.make(R, wpn); }

export function orthoCam(W, H, pxPerM, target = new THREE.Vector3(0, 0.9, 0)) {
  const hw = W / 2 / pxPerM, hh = H / 2 / pxPerM;
  const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.1, 400);
  const pitch = THREE.MathUtils.degToRad(40);
  cam.position.set(target.x, target.y + 100 * Math.sin(pitch), target.z + 100 * Math.cos(pitch));
  cam.lookAt(target); cam.updateProjectionMatrix();
  return cam;
}
