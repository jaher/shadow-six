/**
 * M1/M2 fuel drums (design-spec §7.4 barrels, solution path 5; §3.6 barrel class; §3.4 GB carries barrels):
 * mission structures {type:'barrels', explosive:'barrel'} must spawn real Barrel entities (not inert
 * explosiveTarget markers), so a bullet sets them off and the Green Beret can carry one to the relay.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { Barrel } from '../../src/entities/interactables.js';
import '../../src/abilities/index.js';

const DRUMS = { m01: ['b1', 'b2', 'b3', 'b4', 'b5'], m02: ['bar1', 'bar2', 'bar3', 'bar4'] };

/** Mission sim with only the listed commandos kept (other units stay, enemies brain-less). */
function sim(id, keep = null) {
  const def = getMission(id);
  const commandos = keep ? def.commandos.filter((c) => keep.includes(c.role)) : def.commandos;
  return makeSim({ ...def, commandos }, { brains: false });
}

for (const id of Object.keys(DRUMS)) {
  test(`${id}: every fuel drum is a Barrel entity (carriable, shootable)`, () => {
    const s = sim(id);
    for (const b of DRUMS[id]) {
      const e = s.get(b);
      assert.ok(e instanceof Barrel, `${b} is a Barrel`);
      assert.equal(e.interactKind, 'barrel');
      assert.equal(e.exploded, false);
      assert.ok(s.world.structures.has(b), `${b} still registered in world.structures`);
    }
    assert.equal(s.world.interactables.filter((i) => i.interactKind === 'explosiveTarget' && DRUMS[id].includes(i.tag)).length, 0);
  });

  test(`${id}: a pistol shot at a drum detonates it (§3.6)`, () => {
    const s = sim(id);
    const [first] = DRUMS[id];
    const b = s.get(first);
    const shooter = s.world.commandos.find((c) => c.abilities.includes('pistol'));
    shooter.x = b.x + 6; shooter.z = b.z; shooter.y = 0;
    assert.ok(shooter.issue({ type: 'ability', id: 'pistol', target: b }), 'pistol accepts the drum as target');
    s.run(1.5, () => b.exploded);
    assert.ok(b.exploded, `${first} exploded`);
    const shot = s.events.find((e) => e.name === 'shot' && e.p.target === b);
    assert.ok(shot && shot.p.hit, 'shot hits the drum');
    assert.ok(s.events.some((e) => e.name === 'explosion'), 'explosion event');
  });
}

test('m01: damage (not only bullets) sets a drum off; neighbours chain', () => {
  const s = sim('m01');
  const drums = Object.fromEntries(DRUMS.m01.map((id) => [id, s.get(id)]));
  drums.b2.takeDamage(80, null);
  s.run(1);
  for (const id of ['b1', 'b2', 'b3']) assert.ok(drums[id].exploded, `${id} exploded`);
  assert.ok(!drums.b4.exploded && s.get('b4') === drums.b4, 'b4 is far away');
});

test('m01 path 5a: the GB carries a drum to the relay, the Driver shoots it and the relay goes up', () => {
  const s = sim('m01', ['greenberet', 'driver']);
  const gb = s.cmd('greenberet'), dr = s.cmd('driver'), b4 = s.get('b4');
  // skip the approach (paths 1–4): the GB is next to the drums by mg1, the Driver waits south of the relay
  gb.x = 23; gb.z = 33.6; gb.y = 0;
  dr.x = 16; dr.z = 24; dr.y = 0;
  assert.ok(gb.issue({ type: 'ability', id: 'hand', target: b4 }), 'GB can pick up the drum');
  s.run(3, () => gb.carrying === b4);
  assert.equal(b4.carriedBy, gb, 'carried');
  gb.issue({ type: 'move', x: 16, z: 13 });
  s.run(40, () => !gb.path?.length && Math.hypot(gb.x - 16, gb.z - 13) < 0.6);
  assert.ok(Math.hypot(gb.x - 16, gb.z - 13) < 1, `GB reached the relay (${gb.x.toFixed(1)}, ${gb.z.toFixed(1)})`);
  assert.ok(gb.issue({ type: 'cancel' }), 'right-click drops the drum');
  s.run(1);
  assert.equal(gb.carrying, null);
  assert.ok(Math.hypot(b4.x - 12, b4.z - 12) < 5, 'drum stands by the hut');
  gb.issue({ type: 'move', x: 24, z: 24 });
  s.run(12);
  assert.ok(Math.hypot(dr.x - b4.x, dr.z - b4.z) < 13.5, 'Driver in pistol range');
  assert.ok(dr.issue({ type: 'ability', id: 'pistol', target: b4 }));
  s.run(2, () => b4.exploded);
  assert.ok(b4.exploded, 'drum exploded ' + JSON.stringify({ b: [b4.x, b4.z], dr: [dr.x, dr.z, dr.action?.id ?? dr.state], shots: s.events.filter((e) => e.name === 'shot').map((e) => [e.p.hit, e.p.target?.id ?? e.p.target?.tag ?? null, e.p.to]) }));
  s.run(0.5);
  const hut = s.get('relay_hut'), mast = s.get('relay_mast');
  assert.ok(hut.destroyed, 'relay_hut destroyed');
  assert.ok(mast.destroyed, 'relay_mast destroyed');
  assert.ok(gb.alive && dr.alive, 'both commandos clear of the blast ' + JSON.stringify([gb.alive, gb.hp, dr.alive, dr.hp]));
});

test('validateMission rejects explosive/carriable structures that are not fuel drums', () => {
  const base = { id: 'x', size: [40, 40], campaign: 'BEL', commandos: [{ role: 'greenberet', x: 5, z: 5 }] };
  const ok = validateMission({ ...base, structures: [{ id: 'd', type: 'barrels', x: 10, z: 10, explosive: 'barrel', carriable: true }] });
  assert.deepEqual(ok.errors, []);
  const bad1 = validateMission({ ...base, structures: [{ id: 't', type: 'fueltank', x: 10, z: 10, explosive: 'barrel' }] });
  assert.ok(bad1.errors.some((e) => /explosive/.test(e)), 'explosive fuel tank rejected');
  const bad2 = validateMission({ ...base, structures: [{ id: 'd', type: 'barrels', x: 10, z: 10, explosive: 'bomb' }] });
  assert.ok(bad2.errors.some((e) => /explosive/.test(e)), 'non-barrel explosive class rejected');
  const bad3 = validateMission({ ...base, structures: [{ id: 'c', type: 'crates', x: 10, z: 10, carriable: true }] });
  assert.ok(bad3.errors.some((e) => /carriable/.test(e)), 'carriable crate rejected');
  for (const id of Object.keys(DRUMS)) assert.deepEqual(validateMission(getMission(id)).errors, [], `${id} valid`);
});
