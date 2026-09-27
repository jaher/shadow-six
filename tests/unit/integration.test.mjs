/**
 * Cross-team integration (gp merge): the seams between CORE2 / AI / ABILITIES / VEHICLES / MISSIONS13 that
 * no single team's tests cover — one §3.6 explosion implementation, mission switches and raised ladders
 * driving ABILITIES interactables, the witness rule inside the AI band rule, schema for `interactables`.
 */
import { test, assert } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { explode } from '../../src/entities/projectile.js';
import { canSee, targetClass } from '../../src/ai/perception.js';
import { ABILITIES } from '../../src/abilities/index.js';

test('M3 fence switch (MISSIONS13 data) cuts the electric fence power (ABILITIES world.fencePower)', () => {
  const s = makeSim(getMission('m03'), { brains: false });
  const w = s.world;
  assert.equal(w.fencePower.get('st_fence'), true, 'fence starts powered');
  const sw = w.interactables.find((i) => i.interactKind === 'switch' && i.tag === 'fence_switch');
  assert.ok(sw, 'switch interactable built from structure.switches');
  assert.deepEqual(sw.targets, ['st_fence']);
  const sapper = s.cmd('sapper') || w.commandos[0];
  sw.interact(sapper);
  assert.equal(w.fencePower.get('st_fence'), false, 'turned off');
  sw.interact(sapper);
  assert.equal(w.fencePower.get('st_fence'), true, 'and back on');
});

test('M2 raised ladder: one ladder device at the TOP with the snapped link id; lowering enables the link', () => {
  const s = makeSim(getMission('m02'), { brains: false });
  const w = s.world;
  const rec = w.ladders.find((l) => l.id === 'ladder_sw');
  assert.ok(rec && rec.raised);
  const devs = w.interactables.filter((i) => i.interactKind === 'ladder');
  assert.equal(devs.length, 1, 'only raised ladders get a device (ladder_sw_in is down)');
  const lad = devs[0];
  assert.equal(lad.linkId, rec.linkId);
  assert.ok(Math.abs(lad.x - rec.top.x) < 1e-6 && Math.abs(lad.z - rec.top.z) < 1e-6, 'placed at the top');
  const link = w.grid.links.find((l) => l.id === rec.linkId);
  assert.equal(link.enabled, false, 'raised = link disabled');
  const gb = s.cmd('greenberet');
  gb.y = lad.top.y;
  assert.equal(lad.canUse(gb), true);
  lad.interact(gb);
  assert.equal(link.enabled, true, 'lowered');
});

test('§3.6 one implementation: projectile.explode → applyExplosion, vehicle armour decides, accident is silent', () => {
  const s = makeSim({ vehicles: [{ id: 'tank', vehicleType: 'panzer3', x: 20, z: 20 }, { id: 'car', vehicleType: 'kubelwagen', x: 40, z: 40 }] }, { brains: false });
  const w = s.world;
  const tank = w.byId('tank'), car = w.byId('car');
  explode(w, 22, 20, 'grenade');
  assert.equal(!!tank.destroyed, false, 'grenade does not destroy heavy armour');
  explode(w, 42, 40, 'grenade');
  assert.equal(!!car.destroyed, true, 'grenade destroys an unarmoured car');
  s.clear();
  explode(w, 22, 20, 'bomb', null, { accident: true });
  assert.equal(!!tank.destroyed, true, 'bomb destroys heavy armour');
  const ex = s.events.filter((e) => e.name === 'explosion' && e.p.kind === 'bomb');
  assert.equal(ex.length, 1);
  assert.equal(ex[0].p.accident, true);
  assert.equal(s.events.filter((e) => e.name === 'noise' && e.p?.kind === 'explosion' && e.p?.x === 22).length, 0, 'accident makes no noise');
});

test('witness rule lives in targetClass: only the witness keeps a hidden (submerged) man, near band only', () => {
  const s = makeSim({ commandos: [{ role: 'diver', x: 30, z: 30 }], enemies: [guard('a', 30, 24, Math.PI / 2), guard('b', 30, 36, -Math.PI / 2)] }, { brains: false });
  const a = s.get('a'), b = s.get('b');
  // a submerged diver as the AI sees him (ABILITIES sets isVisibleToEnemies=false + witnesses)
  const d = { kind: 'commando', x: 30, z: 30, alive: true, isVisibleToEnemies: false, witnesses: new Set([a]) };
  assert.equal(targetClass(d, {}, a), 'near');
  assert.equal(targetClass(d, {}, b), null);
  assert.equal(targetClass(d), null, 'no viewer → no witness');
  assert.equal(canSee(a, d, s.world), 'near');
  assert.equal(canSee(b, d, s.world), 'none');
});

test('boarding is VEHICLES enterVehicle only (no duplicate board ability); it refuses while carrying', () => {
  assert.equal(ABILITIES.board, undefined);
  const s = makeSim({ commandos: [{ role: 'driver', x: 10, z: 10 }], vehicles: [{ id: 'truck', vehicleType: 'truck', x: 14, z: 10 }] }, { brains: false });
  const dr = s.cmd('driver');
  dr.carrying = { kind: 'body' };
  assert.equal(ABILITIES.enterVehicle.canUse(dr, s.world.byId('truck'), s.world), 'Drop it first.');
  dr.carrying = null;
  assert.equal(ABILITIES.enterVehicle.canUse(dr, s.world.byId('truck'), s.world), true);
});

test('schema: mission.interactables validated (kind, in map, unique ids) and normalized', () => {
  const base = { id: 'x', size: [20, 20] };
  assert.deepEqual(validateMission({ ...base, interactables: [{ interactKind: 'phone', x: 5, z: 5, id: 'p1' }] }).errors, []);
  assert.ok(validateMission({ ...base, interactables: [{ x: 5, z: 5 }] }).errors.some((e) => e.includes('missing interactKind')));
  assert.ok(validateMission({ ...base, interactables: [{ interactKind: 'phone', x: 50, z: 5 }] }).errors.some((e) => e.includes('outside the map')));
  assert.ok(validateMission({ ...base, interactables: [{ interactKind: 'phone', x: 5, z: 5, id: 'a' }, { interactKind: 'lever', x: 6, z: 5, id: 'a' }] }).errors.some((e) => e.includes('duplicate id')));
});

test('save/load: fence power restored from the saved table, or rebuilt from the switch for older saves (§7.6 st_fence)', async () => {
  const { restoreFencePower } = await import('../../src/save.js');
  const s = makeSim(getMission('m03'), { brains: false });
  const w = s.world;
  const sw = w.interactables.find((i) => i.interactKind === 'switch' && i.tag === 'fence_switch');
  sw.on = false; // as deserialized after "Switch off." while loadMission rebuilt the fence powered
  assert.equal(w.fencePower.get('st_fence'), true);
  restoreFencePower(w, null); // legacy snapshot without `fencePower`
  assert.equal(w.fencePower.get('st_fence'), false, 'rebuilt from the restored switch');
  restoreFencePower(w, [['st_fence', true], ['nope', false]]);
  assert.equal(w.fencePower.get('st_fence'), true, 'saved table wins');
  assert.equal(w.fencePower.has('nope'), false, 'unknown ids ignored');
});
