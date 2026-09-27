/** ABILITIES: Marine, Spy, interactables, guests and §3.8 loadouts. */
import { test, assert, near } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { canSee } from '../../src/ai/perception.js';
import { belLoadout, BEL_LOADOUTS, spawnInventory, firstAidCarrier, canPickUp } from '../../src/items.js';

// river: deep 37.5–42.5, shallow banks 36.5–37.5 and 42.5–43.5
const RIVER = {
  shoreShallowWidth: 0, // keep the deep channel (the §7.3 shore pass would make this 5 m river all shallow)
  terrain: [{ type: 'path', terrain: 'shallow', points: [[40, 0], [40, 60]], width: 7 }],
  structures: [{ type: 'river', points: [[40, 0], [40, 60]], width: 5 }],
};

test('diving gear: only in shallow water; submerged = invisible except to witnesses; stays in the water; off only in shallow', () => {
  const s = makeSim({ ...RIVER, commandos: [{ role: 'diver', x: 30, z: 10 }], enemies: [guard('w', 37, 20, -Math.PI / 2), guard('late', 20, 10, 0)] }, { brains: false });
  const d = s.cmd('diver'), w = s.get('w'), late = s.get('late');
  late.heading = Math.PI; // looks away while he dives
  assert.equal(d.issue({ type: 'ability', id: 'dive', target: d }), false, 'not on land');
  d.setPosition(36.9, 10);
  assert.notEqual(canSee(w, d, s.world), 'none');
  assert.ok(d.issue({ type: 'ability', id: 'dive', target: d }));
  s.run(1.6);
  assert.ok(d.diving && d.underwater && d.stance === 'dive');
  assert.equal(canSee(w, d, s.world), 'near', 'witness keeps him');
  late.heading = 0; s.run(0.1);
  assert.equal(canSee(late, d, s.world), 'none', 'others cannot see him');
  d.issue({ type: 'move', x: 20, z: 10 }); // towards land: refused / cut at the water's edge
  s.run(8);
  assert.ok(s.world.groundAt(d.x, d.z).shallow || s.world.groundAt(d.x, d.z).water, 'did not leave the water');
  d.issue({ type: 'move', x: 40, z: 30 }); s.run(15);
  assert.equal(d.stance, 'dive');
  assert.equal(d.issue({ type: 'ability', id: 'dive', target: d }), false, 'gear off only in shallow water');
  d.issue({ type: 'move', x: 37, z: 30 }); s.run(5);
  assert.ok(d.issue({ type: 'ability', id: 'dive', target: d }));
  s.run(1.6);
  assert.ok(!d.diving && !d.underwater && d.stance === 'stand');
});

test('raft: T deploys in shallow water only (2.0 s) and he boards; H packs it (2.0 s); packed raft slows him', () => {
  const s = makeSim({ ...RIVER, commandos: [{ role: 'diver', x: 30, z: 10, inventory: { inflatableBoat: 1 } }] });
  const d = s.cmd('diver');
  near(d.speed, 2.25 - 0.9, 1e-9, 'walk 1.35 with the packed raft');
  assert.equal(d.issue({ type: 'ability', id: 'raft', target: d }), false, 'not on land');
  d.setPosition(36.9, 10);
  assert.ok(d.issue({ type: 'ability', id: 'raft', target: d }));
  s.run(2.1);
  const raft = s.world.vehicles.find((v) => v.vehicleType === 'raft');
  assert.ok(raft && raft.occupants.includes(d) && raft.operator === d);
  assert.ok(!d.has('inflatableBoat'));
  assert.ok(d.issue({ type: 'exit' }));
  d.setPosition(36.9, 12);
  assert.ok(d.issue({ type: 'ability', id: 'hand', target: raft }));
  s.run(5, () => raft.removed);
  assert.ok(d.has('inflatableBoat') && raft.removed, 'packed');
});

test('#12 disguised Spy: unseen walking past a guard; injecting in view unmasks him (uniform back, noise 9 m, N=1000)', () => {
  const s = makeSim({ startDisguised: ['spy'], commandos: [{ role: 'spy', x: 10, z: 10 }], enemies: [guard('e1', 20, 10, Math.PI), guard('e2', 24, 12, Math.PI)] }, { brains: false });
  const spy = s.cmd('spy'), e1 = s.get('e1'), e2 = s.get('e2');
  assert.ok(spy.disguised);
  assert.equal(canSee(e1, spy, s.world), 'none');
  assert.notEqual(canSee(e1, spy, s.world, { ignoreDisguise: true }), 'none');
  spy.issue({ type: 'move', x: 16, z: 10 }); s.run(3);
  assert.ok(spy.disguised, 'walking is fine');
  spy.issue({ type: 'ability', id: 'syringe', target: e1 });
  s.run(3, () => !e1.alive);
  s.step();
  assert.equal(e1.alive, false);
  assert.equal(e1.deathCause, 'injection');
  assert.ok(!spy.disguised, 'unmasked');
  assert.ok(spy.has('uniform'), 'uniform back in the knapsack');
  assert.equal(e2.nervousness, 1000);
  const n = s.events.find((e) => e.name === 'noise' && e.p.kind === 'spyUnmask');
  assert.ok(n && n.p.radius === 9 && n.p.level === 1);
  assert.ok(s.count('enemy:unmasked-spy') >= 1);
  assert.equal(s.count('shot'), 0, 'no blood/tracer');
});

test('disguise: running in view unmasks; U re-dresses only outside every cone', () => {
  const s = makeSim({ startDisguised: ['spy'], commandos: [{ role: 'spy', x: 10, z: 10 }], enemies: [guard('e1', 20, 10, Math.PI)] }, { brains: false });
  const spy = s.cmd('spy');
  spy.issue({ type: 'move', x: 14, z: 10, run: true });
  s.run(0.5);
  assert.ok(!spy.disguised, 'running is suspicious');
  assert.equal(spy.issue({ type: 'ability', id: 'uniform', target: spy }), false, 'watched');
  spy.issue({ type: 'move', x: 10, z: 30 }); s.run(12);
  assert.ok(spy.issue({ type: 'ability', id: 'uniform', target: spy }));
  s.run(1.6);
  assert.ok(spy.disguised && !spy.has('uniform'));
});

test('clothesline: the Spy takes the uniform (1.5 s) and is dressed at once', () => {
  const s = makeSim({ commandos: [{ role: 'spy', x: 10, z: 10 }, { role: 'greenberet', x: 12, z: 10 }], interactables: [{ kind: 'clothesline', id: 'cl', x: 11, z: 12 }] });
  const spy = s.cmd('spy');
  assert.ok(!spy.abilities.includes('uniform'));
  assert.equal(s.cmd('greenberet').issue({ type: 'ability', id: 'use', target: s.get('cl') }), false);
  spy.issue({ type: 'ability', id: 'use', target: s.get('cl') });
  s.run(3);
  assert.ok(spy.disguised);
});

test('clothesline: an items[] uniform with variant clothesline becomes the device (use, 1.5 s, dressed at once)', () => {
  // regression: M3 declared the uniform as a Hand pickup; 'use' was refused ('Nothing to operate.')
  const s = makeSim({ commandos: [{ role: 'spy', x: 10, z: 10 }], items: [{ id: 'ul', itemId: 'uniform', x: 11, z: 11, count: 1, variant: 'clothesline' }] });
  const spy = s.cmd('spy'), line = s.get('ul');
  assert.equal(line.interactKind, 'clothesline');
  assert.ok(spy.issue({ type: 'ability', id: 'use', target: line }), 'use accepted');
  s.run(1.3);
  assert.ok(!spy.disguised, 'still taking it (1.5 s activation)');
  s.run(1.5);
  assert.ok(spy.disguised && !spy.has('uniform'), 'dressed at once, nothing left in the knapsack');
  assert.equal(line.count, 0);
});

test('distract: target stops facing the Spy; a leader freezes his squad; a level-2 noise ends it', () => {
  const s = makeSim({
    startDisguised: ['spy'],
    commandos: [{ role: 'spy', x: 10, z: 20 }],
    enemies: [guard('sgt', 20, 20, 0, { soldierType: 'sergeant', squad: { id: 'p1', leader: true } }), guard('tr', 18.8, 20, 0, { soldierType: 'trooper', squad: { id: 'p1' } })],
  }, { brains: false });
  const spy = s.cmd('spy'), sgt = s.get('sgt'), tr = s.get('tr');
  assert.ok(spy.issue({ type: 'ability', id: 'distract', target: sgt }));
  s.run(6, () => spy.currentActionId === 'distract');
  s.run(0.5);
  assert.equal(spy.currentActionId, 'distract');
  assert.ok(Math.hypot(spy.x - sgt.x, spy.z - sgt.z) <= 1.6);
  assert.equal(sgt.brain.distracted, spy);
  assert.equal(tr.brain.distracted, spy, 'squad frozen');
  const face = Math.atan2(spy.z - sgt.z, spy.x - sgt.x);
  near(Math.cos(sgt.heading - face), 1, 1e-3, 'faces the Spy');
  s.run(30);
  assert.equal(spy.currentActionId, 'distract', 'lasts indefinitely');
  s.world.emitNoise(30, 20, 18, 'pistol', null);
  s.step(); s.step();
  assert.equal(spy.currentActionId, null, 'noise ends it');
  assert.equal(sgt.brain.distracted, null);
  assert.equal(tr.brain.distracted, null);
});

test('hideout: enterable building hides him (invisible, cannot shoot); photo click lets him out', () => {
  const s = makeSim({ structures: [{ type: 'house', id: 'h1', x: 20, z: 20, rot: 0, enterable: true }], commandos: [{ role: 'greenberet', x: 10, z: 30 }], enemies: [guard('e', 20, 35, -Math.PI / 2)] }, { brains: false });
  const gb = s.cmd('greenberet'), door = s.get('h1:door');
  assert.ok(door && door.enterable);
  gb.issue({ type: 'ability', id: 'use', target: door });
  s.run(10, () => gb.hidden);
  assert.ok(gb.hidden && gb.state === 'hidden' && !gb.isVisibleToEnemies);
  assert.equal(gb.issue({ type: 'ability', id: 'pistol', target: s.get('e') }), false, 'cannot shoot from inside');
  assert.equal(gb.issue({ type: 'move', x: 5, z: 5 }), false);
  assert.ok(gb.issue({ type: 'exit' }));
  assert.ok(!gb.hidden && gb.state === 'active' && s.world.grid.walkableAt(gb.x, gb.z));
});

test('devices: phone rings (phone noise every 2 s); raised ladder lowered only from the top; switch & jail door', () => {
  const s = makeSim({
    ladders: [{ id: 'lad', x: 10, z: 40, top: [10, 42, 3], raised: true }],
    interactables: [{ kind: 'phone', id: 'ph', x: 12, z: 10 }, { kind: 'jail', id: 'jail1', x: 30, z: 30 }],
    commandos: [{ role: 'greenberet', x: 10, z: 12 }, { role: 'guest', id: 'mcrae', x: 31, z: 31, jailed: true, jailId: 'jail1' }],
  });
  const gb = s.cmd('greenberet');
  gb.issue({ type: 'ability', id: 'use', target: s.get('ph') });
  s.run(6);
  const rings = s.events.filter((e) => e.name === 'noise' && e.p.kind === 'phone');
  assert.ok(rings.length >= 2 && rings.length <= 3, `${rings.length} rings`);
  near(rings[1].t - rings[0].t, 2, 0.02);
  const lad = s.world.interactables.find((i) => i.interactKind === 'ladder');
  assert.ok(lad && s.world.grid.links.find((l) => l.id === lad.linkId).enabled === false);
  assert.notEqual(lad.canUse(gb), true, 'not from the bottom');
  gb.setPosition(10, 42); gb.y = 3;
  assert.equal(lad.canUse(gb), true);
  lad.interact(gb);
  assert.equal(s.world.grid.links.find((l) => l.id === lad.linkId).enabled, true);
  const mc = s.get('mcrae');
  assert.equal(mc.state, 'jailed');
  gb.y = 0;
  gb.setPosition(29, 29);
  gb.issue({ type: 'ability', id: 'use', target: s.get('jail1') });
  s.run(2);
  assert.equal(mc.state, 'active');
  assert.equal(s.count('unit:freed'), 1);
});

test('§4.10 jail rescue refused while an enemy sees the rescuer (order and 1.5 s completion)', () => {
  const s = makeSim({
    interactables: [{ kind: 'jail', id: 'jail1', x: 30, z: 30 }],
    commandos: [{ role: 'greenberet', x: 29, z: 29 }, { role: 'guest', id: 'mcrae', x: 31, z: 31, jailed: true, jailId: 'jail1' }],
    enemies: [guard('w', 38, 29, Math.PI)],
  }, { brains: false });
  const gb = s.cmd('greenberet'), mc = s.get('mcrae'), jail = s.get('jail1'), w = s.get('w');
  assert.notEqual(canSee(w, gb, s.world), 'none', 'sentry watches the door');
  assert.equal(jail.canUse(gb), 'They can see you.');
  gb.issue({ type: 'ability', id: 'use', target: jail });
  s.run(3);
  assert.equal(mc.state, 'jailed', 'not freed in front of a sentry');
  assert.equal(s.count('unit:freed'), 0);
  // Guard turns away mid-activation → allowed; turns back before 1.5 s → refused at completion.
  w.heading = 0; if (w.post) w.post.heading = 0;
  assert.equal(canSee(w, gb, s.world), 'none');
  assert.equal(jail.canUse(gb), true);
  gb.issue({ type: 'ability', id: 'use', target: jail });
  s.run(0.5);
  w.heading = Math.PI; if (w.post) w.post.heading = Math.PI;
  s.run(2);
  assert.equal(mc.state, 'jailed', 'witness at completion cancels the rescue');
  // Unwatched: freed.
  w.heading = 0; if (w.post) w.post.heading = 0;
  gb.issue({ type: 'ability', id: 'use', target: jail });
  s.run(2);
  assert.equal(mc.state, 'active');
  assert.equal(s.count('unit:freed'), 1);
});

test('air-drop crate: each role takes only what it may carry (§3.2 table)', () => {
  const s = makeSim({
    interactables: [{ kind: 'crate', id: 'drop', x: 20, z: 20, contents: { sniperRifle: 3, timeBomb: 1, smg: 20 } }],
    commandos: [{ role: 'driver', x: 19, z: 20 }, { role: 'sapper', x: 21, z: 20, inventory: { grenade: 3 } }, { role: 'sniper', x: 20, z: 21, inventory: { sniperRifle: 4 } }],
  });
  const dr = s.cmd('driver'), sp = s.cmd('sapper'), sn = s.cmd('sniper'), crate = s.get('drop');
  assert.ok(!dr.abilities.includes('smg'));
  dr.issue({ type: 'ability', id: 'hand', target: crate }); s.run(1);
  assert.equal(dr.inventory.get('smg'), 20);
  assert.ok(dr.abilities.includes('smg'), 'SMG action appears');
  sp.issue({ type: 'ability', id: 'hand', target: crate }); s.run(1);
  assert.ok(sp.has('timeBomb') && sp.abilities.includes('timeBomb'));
  sn.issue({ type: 'ability', id: 'hand', target: crate }); s.run(1);
  assert.equal(sn.inventory.get('sniperRifle'), 7);
  assert.ok(crate.removed, 'empty crate disappears');
  assert.ok(canPickUp('greenberet', 'barrel') && !canPickUp('spy', 'barrel') && canPickUp('spy', 'body') && !canPickUp('guest', 'body'));
});

test('guests (§3.5): no items, cannot crawl in single file, followers keep 1.0 m behind', () => {
  const s = makeSim({ commandos: [
    { role: 'guest', id: 'gilbert', x: 10, z: 10 },
    { role: 'guest', id: 'p1', x: 10, z: 11, follow: 'gilbert' },
    { role: 'guest', id: 'p2', x: 10, z: 12, follow: 'p1' },
  ] });
  const g = s.get('gilbert'), p1 = s.get('p1'), p2 = s.get('p2');
  assert.equal(g.maxHp, 100);
  assert.ok(!g.abilities.includes('hand') && !g.abilities.includes('pistol'));
  p1.issue({ type: 'stance', stance: 'crawl' });
  assert.equal(p1.stance, 'stand');
  g.issue({ type: 'move', x: 30, z: 10 });
  s.run(15);
  near(Math.hypot(p1.x - g.x, p1.z - g.z), 1.0, 0.45, 'p1 behind Gilbert');
  near(Math.hypot(p2.x - p1.x, p2.z - p1.z), 1.0, 0.45, 'p2 behind p1');
});

test('§3.8 BEL loadouts: kits, medic, never time+remote, M7 Marine without knife, no shovel from M12', () => {
  for (let n = 1; n <= 20; n++) {
    const L = belLoadout(n);
    assert.ok(L, `M${n}`);
    for (const [role, inv] of Object.entries(L.inventories)) {
      const kit = spawnInventory(role, inv);
      assert.ok(!(kit.timeBomb && kit.remoteBomb), `M${n} ${role} bombs`);
      assert.equal(kit.pistol, 1, `M${n} ${role} pistol`);
      if (role === 'greenberet') assert.equal(!!kit.shovel, n <= 11, `M${n} shovel`);
    }
  }
  assert.equal(spawnInventory('diver', belLoadout(7).inventories.diver).knife, undefined);
  assert.equal(spawnInventory('sniper', belLoadout(14).inventories.sniper).sniperRifle, 8);
  assert.equal(spawnInventory('driver', belLoadout(1).inventories.driver).smg, 20, '100 rounds = 20 bursts');
  assert.deepEqual(spawnInventory('sapper', belLoadout(11).inventories.sapper), { pistol: 1, bearTrap: 1, grenade: 1, remoteBomb: 3, detonator: 1 });
  assert.equal(belLoadout(6).medic, 'sniper');
  assert.equal(belLoadout(12).medic, 'spy');
  assert.equal(belLoadout(1).medic, 'driver');
  assert.equal(firstAidCarrier(BEL_LOADOUTS[17].team), 'spy');
  for (const n of [9, 11, 12, 17]) assert.ok(belLoadout(n).startDisguised, `M${n} disguised`);
  assert.equal(BEL_LOADOUTS[20].team.length, 6);
});
