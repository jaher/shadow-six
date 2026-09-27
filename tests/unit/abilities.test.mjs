/** ABILITIES: weapons, explosives, first aid (design-spec §3.2–§3.6, behaviour tests #8–#10). */
import { test, assert, near } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { CONFIG, KILL } from '../../src/config.js';
import { ABILITIES, groupIntersection } from '../../src/abilities/index.js';
import { applyExplosion, explosionDamage } from '../../src/abilities/explosions.js';
import { Barrel } from '../../src/entities/interactables.js';

const GB = { role: 'greenberet', x: 10, z: 10, heading: 0 };

test('#10 pistol: three hits kill a soldier, two do not; 13.5 m range, pistol noise 18 m', () => {
  const s = makeSim({ commandos: [GB], enemies: [guard('e1', 20, 10, 0)] }, { brains: false });
  const gb = s.cmd('greenberet'), e = s.get('e1');
  assert.ok(gb.abilities.includes('pistol'));
  assert.ok(gb.issue({ type: 'ability', id: 'pistol', target: e }));
  s.run(0.6);
  assert.equal(e.hp, 120, 'one hit = 80');
  assert.equal(gb.armed, 'pistol', 'pistol stays drawn');
  assert.equal(gb.issue({ type: 'move', x: 5, z: 5 }), false, 'move refused while drawn');
  gb.issue({ type: 'ability', id: 'pistol', target: e });
  s.run(0.5);
  assert.ok(e.alive && e.hp === 40, 'two hits do not kill');
  gb.issue({ type: 'ability', id: 'pistol', target: e });
  s.run(0.5);
  assert.equal(e.alive, false, 'third hit kills');
  const n = s.events.filter((x) => x.name === 'noise' && x.p.kind === 'pistol');
  assert.equal(n.length, 3);
  assert.equal(n[0].p.radius, 18);
  assert.equal(n[0].p.level, 2);
  assert.ok(gb.issue({ type: 'cancel' }) && gb.armed === null, 'right-click holsters');
  assert.ok(Math.hypot(gb.x - 10, gb.z - 10) < 0.01, 'in range: no walking');
});

test('pistol cadence ≥ 0.15 s and draw time per role', () => {
  assert.equal(CONFIG.abilities.pistolDraw.greenberet, 0.3);
  assert.equal(CONFIG.abilities.pistolDraw.spy, 0.2);
  const s = makeSim({ commandos: [{ role: 'spy', x: 10, z: 10 }], enemies: [guard('e1', 15, 10)] }, { brains: false });
  const spy = s.cmd('spy'), e = s.get('e1');
  spy.issue({ type: 'ability', id: 'pistol', target: e });
  s.run(0.19);
  assert.equal(e.hp, 200, 'not before the 0.2 s draw');
  s.run(0.05);
  assert.equal(e.hp, 120);
});

test('#9 first aid: +34 HP per dose at 0.5 s of 1.5 s, capped, 6 doses (Driver carries it)', () => {
  const s = makeSim({ commandos: [GB, { role: 'driver', x: 11, z: 10 }] });
  const gb = s.cmd('greenberet'), dr = s.cmd('driver');
  assert.equal(dr.inventory.get('firstAid'), 6);
  assert.ok(!gb.inventory.has('firstAid'));
  gb.hp = 100;
  assert.ok(dr.issue({ type: 'ability', id: 'firstAid', target: gb }));
  s.run(0.45);
  assert.equal(gb.hp, 100);
  s.run(0.1);
  assert.equal(gb.hp, 134, '+34 at 0.5 s');
  s.run(1.0);
  assert.equal(dr.inventory.get('firstAid'), 5);
  for (let k = 0; k < 5; k++) { gb.hp = 10; dr.issue({ type: 'ability', id: 'firstAid', target: gb }); s.run(1.6); assert.equal(gb.hp, 44); }
  assert.ok(!dr.has('firstAid'), 'six doses used');
  gb.hp = 10;
  assert.equal(dr.issue({ type: 'ability', id: 'firstAid', target: gb }), false, 'kit empty');
  // cap
  const s2 = makeSim({ commandos: [GB, { role: 'driver', x: 11, z: 10 }] });
  const g2 = s2.cmd('greenberet');
  g2.hp = 190;
  s2.cmd('driver').issue({ type: 'ability', id: 'firstAid', target: g2 });
  s2.run(1.6);
  assert.equal(g2.hp, 200);
});

test('#8 time bomb: explodes exactly 10.0 s after release (plant 1.0 s), class bomb 6.75 m', () => {
  const s = makeSim({ commandos: [{ role: 'sapper', x: 10, z: 10, heading: 0, inventory: { timeBomb: 2 } }], enemies: [guard('near', 16, 10), guard('far', 17.5, 10)] }, { brains: false });
  const sp = s.cmd('sapper');
  assert.ok(sp.issue({ type: 'ability', id: 'timeBomb', target: sp }));
  s.run(1.05);
  const armed = s.last('bomb:armed');
  assert.ok(armed, 'bomb:armed');
  assert.equal(armed.p.kind, 'time');
  assert.equal(armed.p.fuse, 10);
  sp.moveTo(2, 10, { run: true });
  s.run(12, () => s.count('bomb:exploded') > 0);
  const ex = s.last('bomb:exploded');
  near(ex.t - armed.t, 10.0, 1e-6, 'fuse');
  assert.equal(sp.inventory.get('timeBomb'), 1);
  assert.equal(s.get('near').alive, false, 'inside 6.75 m: dead');
  assert.equal(s.get('far').alive, true, 'outside 6.75 m: untouched');
  assert.ok(s.events.some((e) => e.name === 'noise' && e.p.kind === 'explosion' && e.p.level === 3));
});

test('remote bombs: A detonates the OLDEST first after 0.2 s; detonator appears; never with time bombs', () => {
  const s = makeSim({ commandos: [{ role: 'sapper', x: 10, z: 10, inventory: { remoteBomb: 2, timeBomb: 3 } }] }, { brains: false });
  const sp = s.cmd('sapper');
  assert.ok(!sp.inventory.has('timeBomb') && sp.has('detonator'));
  assert.ok(sp.abilities.includes('remoteBomb') && sp.abilities.includes('detonate') && !sp.abilities.includes('timeBomb'));
  sp.issue({ type: 'ability', id: 'remoteBomb', target: sp }); s.run(1.1);
  sp.moveTo(20, 10); s.run(5);
  sp.issue({ type: 'ability', id: 'remoteBomb', target: sp }); s.run(1.1);
  const bombs = s.world.interactables.filter((b) => b.interactKind === 'bomb');
  assert.equal(bombs.length, 2);
  sp.moveTo(40, 10, { run: true }); s.run(6);
  assert.ok(sp.issue({ type: 'ability', id: 'detonate', target: sp }));
  s.run(0.15);
  assert.equal(s.count('bomb:exploded'), 0, 'radio delay');
  s.run(0.1);
  assert.equal(s.count('bomb:exploded'), 1);
  near(s.last('bomb:exploded').p.x, bombs[0].x, 1e-6, 'oldest first');
  sp.issue({ type: 'ability', id: 'detonate', target: sp }); s.run(0.3);
  assert.equal(s.count('bomb:exploded'), 2);
  assert.equal(sp.issue({ type: 'ability', id: 'detonate', target: sp }), false);
});

test('§3.6 explosion classes: damage table', () => {
  assert.equal(explosionDamage('bomb', 6.7), KILL);
  assert.equal(explosionDamage('bomb', 6.8), 0);
  assert.equal(explosionDamage('grenade', 4.4), 200);
  assert.equal(explosionDamage('grenade', 6.0), 100);
  assert.equal(explosionDamage('barrel', 4.9), KILL);
  assert.equal(explosionDamage('barrel', 6.5), 100);
  assert.equal(explosionDamage('vehicle', 8.9), 180);
  assert.equal(explosionDamage('shell', 2.0), KILL);
  assert.equal(explosionDamage('shell', 4.0), 150);
});

test('§3.6 barrel chain reaction: shooting a barrel ignites others within 6.75 m after 0.2 s', () => {
  const s = makeSim({
    commandos: [GB],
    enemies: [guard('e1', 30, 14), guard('e2', 45, 10)],
    interactables: [{ kind: 'barrel', id: 'b1', x: 30, z: 10 }, { kind: 'barrel', id: 'b2', x: 36, z: 10 }, { kind: 'barrel', id: 'b3', x: 42, z: 10 }, { kind: 'barrel', id: 'b4', x: 52, z: 10 }],
  }, { brains: false });
  const b1 = s.get('b1');
  assert.ok(b1 instanceof Barrel);
  b1.takeDamage(80, s.cmd('greenberet'), 'pistol');
  s.step();
  assert.ok(b1.exploded);
  assert.equal(s.get('e1').alive, false, 'e1 inside 5 m');
  const b2 = s.get('b2'), b3 = s.get('b3'), b4 = s.get('b4');
  assert.ok(!b2.exploded, 'chain waits 0.2 s');
  s.run(0.25);
  assert.ok(b2.exploded, 'b2 chained');
  s.run(0.25);
  assert.ok(b3.exploded, 'b3 chained from b2 (6 m apart)');
  s.run(0.5);
  assert.ok(!b4.exploded, 'b4 is 10 m from b3: no chain');
  assert.equal(s.get('e2').alive, false);
});

test('§3.6 structures: grenades spare the fuel depot, a bomb within 3 m of the marker razes it', () => {
  const def = { commandos: [GB], structures: [{ type: 'fueltank', id: 'depot', x: 30, z: 30, destructible: true, hp: 100 }] };
  const s = makeSim(def, { brains: false });
  const depot = s.get('depot');
  applyExplosion(s.world, 31, 30, 'grenade', null);
  assert.equal(depot.destroyed, false);
  applyExplosion(s.world, 30 + depot.radius + 4, 30, 'bomb', null);
  assert.equal(depot.destroyed, false, 'bomb too far from the marker');
  applyExplosion(s.world, 30 + depot.radius + 2.5, 30, 'bomb', null);
  assert.equal(depot.destroyed, true);
});

test('multi-selection offers the shared abilities only (group intersection)', () => {
  const s = makeSim({ commandos: [GB, { role: 'sapper', x: 12, z: 10 }] });
  const ids = groupIntersection(s.world.commandos.map((c) => c.abilities));
  assert.ok(ids.includes('pistol') && ids.includes('hand'));
  assert.ok(!ids.includes('knife') && !ids.includes('trap'));
  for (const id of Object.keys(ABILITIES)) assert.ok(ABILITIES[id].campaigns === null || ABILITIES[id].campaigns.includes('BEL'), id);
});
