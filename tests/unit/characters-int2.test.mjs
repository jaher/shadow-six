/** Art integration 2: character library behind the Unit model contract (anim mapping, weapons, looks, fallback). */
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { mapAnim, actionWeapon, CARRY_WEAPON, LOCOMOTION, lookType, guestCharacter, missionNumber, fnv1a } from '../../src/art/unit-anim-map.js';
import { createUnitModel, characterContext } from '../../src/art/unit-model.js';
import { ANIMS } from '../../src/art/humanoid.js';
import { Commando } from '../../src/entities/commando.js';
import { Enemy } from '../../src/entities/enemy.js';

const manifest = JSON.parse(readFileSync(new URL('../../assets/characters/manifest.json', import.meta.url)));
const clipsOf = (lib) => new Set(manifest.animations[lib].clips);
const COMMANDO = new Set([...clipsOf('commando_anims'), ...clipsOf('ca_anims'), ...clipsOf('base_anims'), ...clipsOf('enemy_anims'), ...clipsOf('guest_anims')]);
const ENEMY = new Set([...clipsOf('base_anims'), ...clipsOf('enemy_anims')]);

test('every gameplay animation maps to a clip the libraries have (commandos and enemies)', () => {
  for (const name of ANIMS) {
    const c = mapAnim(name, { faction: 'player', role: 'greenberet' });
    assert.ok(c.some((n) => COMMANDO.has(n)), `commando ${name} → ${c}`);
    const e = mapAnim(name, { faction: 'enemy' });
    assert.ok(e.some((n) => ENEMY.has(n)), `enemy ${name} → ${e}`);
  }
});

test('action-specific clips: prone deaths, syringe, dig, uniform, cutters, trap, sniper kneel, enemy body check', () => {
  assert.deepEqual(mapAnim('die', { stance: 'crawl' }), ['die_prone', 'die']);
  assert.deepEqual(mapAnim('dead', { stance: 'crawl' }), ['dead_prone', 'dead']);
  assert.equal(mapAnim('stab', { actionId: 'syringe' })[0], 'syringe');
  assert.equal(mapAnim('stab', { actionId: 'knife' })[0], 'stab');
  assert.equal(mapAnim('use', { actionId: 'shovel' })[0], 'dig');
  assert.equal(mapAnim('use', { actionId: 'uniform' })[0], 'change_clothes');
  assert.equal(mapAnim('use', { actionId: 'cutters' })[0], 'cut_wire');
  assert.equal(mapAnim('plant', { actionId: 'trap' })[0], 'set_trap');
  assert.equal(mapAnim('shoot', { role: 'sniper', actionId: 'sniper' })[0], 'kneel_shoot');
  assert.equal(mapAnim('shoot', { role: 'greenberet', actionId: 'pistol' })[0], 'shoot');
  assert.equal(mapAnim('use', { faction: 'enemy' })[0], 'crouch_idle');
  assert.equal(mapAnim('dead', { carried: true })[0], 'carried');
  for (const n of ['die_prone', 'dead_prone', 'syringe', 'dig', 'change_clothes', 'cut_wire', 'set_trap', 'kneel_shoot', 'carried'])
    assert.ok(COMMANDO.has(n), n);
  assert.ok(ENEMY.has('crouch_idle'));
});

test('dogs: gameplay names map to dogkit clips', () => {
  assert.deepEqual(mapAnim('punch', { dog: true }), ['attack']);
  assert.deepEqual(mapAnim('shoot', { dog: true }), ['bark']);
  assert.deepEqual(mapAnim('salute', { dog: true }), ['idle']);
  assert.ok(LOCOMOTION.has('walk') && LOCOMOTION.has('crawl') && LOCOMOTION.has('swim') && !LOCOMOTION.has('idle'));
});

test('weapons per role and action', () => {
  assert.equal(actionWeapon('greenberet', 'knife'), 'knife');
  assert.equal(actionWeapon('spy', 'syringe'), 'syringe');
  assert.equal(actionWeapon('spy', 'pistol'), 'walther_p38');
  assert.equal(actionWeapon('greenberet', 'pistol'), 'colt1911');
  assert.equal(actionWeapon('sniper', 'sniper'), 'no4_sniper');
  assert.equal(actionWeapon('driver', 'smg'), 'thompson');
  assert.equal(actionWeapon('diver', 'harpoon'), 'harpoon_gun');
  assert.equal(actionWeapon('sapper', 'grenade'), false);
  assert.equal(actionWeapon('sapper', 'use'), null);
  const lib = manifest.weapons['weapons/weapons.glb'].split(' ');
  for (const [role, w] of Object.entries(CARRY_WEAPON)) if (w) assert.ok(lib.includes(w), `${role}: ${w}`);
});

test('enemy looks: desert → Afrika Korps, snow → about half in winter kit, stable per spawn; guests; mission numbers', () => {
  assert.equal(lookType({ id: 'e1', soldierType: 'sentry' }, 'desert', 'm09'), 'afrika');
  assert.equal(lookType({ id: 'e1', soldierType: 'officer' }, 'desert', 'm09'), 'officer');
  let winter = 0;
  for (let i = 0; i < 200; i++) if (lookType({ id: 'e' + i, soldierType: 'soldier' }, 'snow', 'm01') === 'winter') winter++;
  assert.ok(winter > 70 && winter < 130, String(winter));
  assert.equal(lookType({ id: 'e7', soldierType: 'soldier' }, 'snow', 'm01'), lookType({ id: 'e7', soldierType: 'soldier' }, 'snow', 'm01'));
  assert.equal(lookType({ id: 'e7', soldierType: 'mg' }, 'snow', 'm01'), 'mg');
  for (const t of ['afrika', 'winter', 'mg', 'officer', 'sentry']) assert.ok(manifest.enemyTypes[t], t);
  assert.equal(guestCharacter('mcrae'), 'mcrae');
  assert.equal(guestCharacter('gilbert'), 'gilbert');
  assert.ok(guestCharacter('prisoner_3').startsWith('prisoner_'));
  for (const g of ['mcrae', 'informer', 'gilbert', 'civ_tram_driver', 'prisoner_worker']) assert.ok(manifest.characters[g], g);
  assert.equal(missionNumber('m08'), 8);
  assert.equal(missionNumber('m12_train'), 12);
  assert.equal(missionNumber('sandbox'), 0);
  assert.equal(fnv1a('a'), fnv1a('a'));
});

test('without the library (node, ?chars=0, load failure) units keep the placeholder capsule', () => {
  assert.equal(characterContext().ready, false);
  const m = createUnitModel({ faction: 'player', role: 'spy' });
  assert.ok(m.root && typeof m.setAnim === 'function' && !m.isReal);
  const c = new Commando({ role: 'sapper', x: 1, z: 2 });
  const e = new Enemy({ id: 'e1', soldierType: 'sentry', x: 3, z: 4 });
  assert.equal(c.model.unit, c);
  assert.equal(e.model.unit, e);
  c.playAction('plant', 1);
  assert.equal(c.model.anim, 'plant');
  c.playAction('plant', 1);   // a repeated one-shot restarts (restart:true)
  assert.equal(c.model.animTime, 0);
});
