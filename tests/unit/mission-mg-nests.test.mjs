/**
 * Enemy gunners linked to their guns (design-spec §7.4 mg1 "the Driver can capture it", path 5b;
 * §3.4/§3.7 manning guns): the soldier who mans an emplacement / vehicle IS its crew. Killing him
 * silences the gun and frees the seat; destroying the hull kills him. Regression for M1 mg1_gun, whose
 * crew:['e13'] used to be a separate crew record that never died (the nest kept firing after e13 was
 * knifed and the Driver got "Can't get in: enemy crew aboard").
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';
import { normalizeMission } from '../../src/missions/schema.js';
import '../../src/abilities/index.js';

function sim(id, keep = null) {
  const def = getMission(id);
  const commandos = keep ? def.commandos.filter((c) => keep.includes(c.role)) : def.commandos;
  return makeSim({ ...def, commandos }, { brains: false });
}

test('m01 mg1_gun: e13 is its gunner — knifing e13 silences the nest and the Driver can man it (§7.4 5b)', () => {
  const s = sim('m01', ['greenberet', 'driver']);
  const gun = s.get('mg1_gun'), e13 = s.get('e13');
  const gb = s.cmd('greenberet'), dr = s.cmd('driver');
  assert.ok(gun && e13, 'mg1_gun and e13 exist');
  assert.equal(gun.crewed, true, 'manned while e13 lives');
  assert.equal(gun.canEnter(dr), 'enemy crew aboard');
  assert.equal(gun.crew.filter((c) => c.alive).length, 0, 'no phantom crew record besides e13');
  e13.die('knife', gb);
  assert.equal(gun.crewed, false, 'e13 dead → the nest is empty');
  // a commando standing in the gun's arc is not fired on by the empty nest
  const fires = [];
  s.world.events.on('vehicle:fire', (p) => fires.push(p));
  gb.x = gun.x + 10; gb.z = gun.z; gb.y = 0;
  s.run(3);
  assert.equal(fires.filter((f) => f.vehicle === gun).length, 0, 'the nest stays silent');
  assert.equal(gb.alive, true);
  // the Driver takes the gun over
  assert.equal(gun.canEnter(dr), true);
  dr.x = gun.x - 2; dr.z = gun.z; dr.y = 0;
  assert.ok(dr.issue({ type: 'ability', id: 'enterVehicle', target: gun }));
  s.run(6, () => dr.vehicle === gun);
  assert.equal(dr.vehicle, gun, 'the Driver mans mg1');
  assert.equal(gun.operator, dr);
});

test('m02 pboat: e17 rides the boat as its crew record (§7.5) — no stray gunner left standing in the river', () => {
  const s = sim('m02', ['driver']);
  const boat = s.get('pboat');
  assert.equal(s.get('e17'), null, 'e17 is not spawned as a standalone enemy');
  assert.ok(!s.world.enemies.some((e) => e.spawn?.vehicle), 'no enemy carrying `vehicle:` is spawned');
  assert.ok(!s.world.enemies.some((e) => Math.hypot(e.x - 1, e.z - 36.8) < 3), 'nobody stands in the water at (1,36.8)');
  assert.equal(boat.crew.length, 1, 'one crew record');
  assert.equal(boat.crew[0].ref, 'e17');
  assert.equal(boat.crew[0].soldierType, 'mg');
  assert.equal(boat.crewed, true);
  // the boat's own cone carries e17's post: vision mg, sweep 60 (not the default mg 50), giro 180
  assert.ok(boat.vision, 'the crewed boat sees');
  assert.equal(boat.vision.sweepDeg, 60, 'sweep 60 from e17\'s post');
  assert.equal(boat.giro, 180, 'giro 180 from e17\'s post');
  // facing travel: the traverse arc follows the hull heading, not the spawn heading
  boat.heading += Math.PI;
  assert.equal(boat.canTraverse(boat.heading + 0.1), true, 'gun points ahead of the turned hull');
  assert.equal(boat.canTraverse(boat.heading + Math.PI), false, 'but not astern');
  // the gunner goes down with the hull
  s.get('pboat').destroy(null, 'explosion');
  assert.equal(boat.crew[0].alive, false, 'crew dies with the boat');
  assert.equal(boat.crewed, false);
});

test('schema folds any enemy spawn with `vehicle:` into that vehicle\'s crew (and rejects unknown vehicles)', () => {
  const def = { id: 'fold', size: [60, 60], campaign: 'BEL',
    enemies: [{ id: 'g1', soldierType: 'mg', x: 10, z: 10, vehicle: 'b1', post: { sweep: 70, giro: 90 } },
      { id: 'w1', soldierType: 'soldier', x: 20, z: 20 }],
    vehicles: [{ id: 'b1', vehicleType: 'patrolboat', x: 10, z: 10 }] };
  const m = normalizeMission(def, { quiet: true });
  assert.deepEqual(m.enemies.map((e) => e.id), ['w1']);
  assert.equal(m.vehicles[0].crew.length, 1);
  assert.equal(m.vehicles[0].crew[0].id, 'g1');
  assert.equal(m.vehicles[0].crew[0].post.sweep, 70);
  assert.equal(def.vehicles[0].crew, undefined, 'input not mutated');
  assert.throws(() => normalizeMission({ ...def, vehicles: [] }, { quiet: true }), /names no vehicle/);
});

test('an enemy spawn `emplacement: <gun id>` links him as that gun\'s gunner; plain crew records stay independent', () => {
  const s = makeSim({
    enemies: [{ id: 'g9', soldierType: 'mg', x: 30, z: 30, heading: 0, emplacement: 'nest9' }],
    vehicles: [{ id: 'nest9', vehicleType: 'mgNest', x: 30, z: 30, heading: 0 },
      { id: 'tank9', vehicleType: 'panzer4', x: 10, z: 10, crew: ['tank', 'tank'] }],
    commandos: [{ role: 'driver', x: 20, z: 20 }],
  }, { brains: false });
  const nest = s.get('nest9'), tank = s.get('tank9');
  assert.equal(nest.crewed, true, 'g9 mans nest9');
  assert.equal(nest.canEnter(s.cmd('driver')), 'enemy crew aboard');
  s.get('g9').die('knife', null);
  assert.equal(nest.crewed, false);
  assert.equal(nest.canEnter(s.cmd('driver')), true);
  assert.equal(tank.crewed, true, 'soldier-type crew records are not links');
});

// ---- perception: no hidden second cone on emplacements (§4.2 'logic = display', §10.2) ----
import { viewerFor } from '../../src/ai/vehicle-ai.js';
import { coneAt, pointInCone } from '../../src/ai/perception.js';

test('manned emplacement has no cone of its own: it sees through its gunner\'s drawn cone (m01 mg1_gun / e13)', () => {
  const def = getMission('m01');
  const s = makeSim({ ...def, commandos: def.commandos.filter((c) => c.role === 'diver') }); // live brains: e13 sweeps
  const gun = s.get('mg1_gun'), e13 = s.get('e13');
  s.run(0.5);
  assert.equal(gun.vision, null, 'the gun carries no hidden vision');
  assert.equal(viewerFor(gun), e13, 'the gun\'s viewer is e13 (whose cone is drawn)');
  // cone fidelity at the raft pickup point: the gun's sampled detection geometry == e13's drawn cone
  const P = { x: 36.3, z: 61.2 };
  let hits = 0;
  for (let k = 0; k < 100; k++) {
    const t = s.world.time + k * 0.1;
    const drawn = pointInCone(coneAt(e13, t), P.x, P.z);
    const eye = viewerFor(gun);
    const gunCone = eye.vision ? pointInCone(coneAt(eye, t), P.x, P.z) : false;
    assert.equal(gunCone, drawn, `t=${t.toFixed(1)}: gun cone and drawn cone agree`);
    if (drawn) hits++;
  }
  assert.ok(hits > 0 && hits < 100, 'the sweep crosses the pickup point');
});

test('emplacement with a linked crew record: the vehicle drops its own "mg" cone and never fires by itself', () => {
  // gun cone profile 'mg' (sweep 50°) vs the gunner's post (sweep 35°): only the gunner's may count
  const s = makeSim({
    enemies: [{ id: 'g9', soldierType: 'mg', x: 30, z: 30, heading: 0, post: { heading: 0, sweep: 35, giro: 180 } }],
    vehicles: [{ id: 'nest9', vehicleType: 'mgNest', x: 30, z: 30, heading: 0, crew: ['g9'] }],
    commandos: [{ role: 'driver', x: 5, z: 5 }],
  }, { brains: false });
  const nest = s.get('nest9'), g9 = s.get('g9'), dr = s.cmd('driver');
  assert.ok(nest.vision, 'precondition: an mgNest profile would give the hull a cone');
  const fires = [];
  s.world.events.on('vehicle:fire', (p) => fires.push(p));
  // stand where the 50° gun sweep reaches but the 35° drawn cone mostly does not
  dr.x = 30 + Math.cos(0.38) * 15; dr.z = 30 + Math.sin(0.38) * 15; dr.y = 0;
  s.run(10);
  assert.equal(nest.vision, null, 'no hidden second cone');
  assert.equal(viewerFor(nest), g9);
  assert.equal(fires.filter((f) => f.vehicle === nest).length, 0, 'the gun never fires through a cone of its own');
  g9.die('knife', null);
  assert.equal(nest.crewed, false);
});
