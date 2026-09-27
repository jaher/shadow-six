/** ABILITIES per commando (design-spec §3.4): one test per ability. */
import { test, assert, near } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { CONFIG } from '../../src/config.js';
import { B } from '../../src/world/grid.js';
import { canSee } from '../../src/ai/perception.js';

const pulses = (s) => s.events.filter((e) => e.name === 'noise' && e.p.kind === 'decoy');

test('#11 knife: silent kill at 0.3 s — no noise event at all', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }], enemies: [guard('e1', 14, 10, 0)] }, { brains: false });
  const gb = s.cmd('greenberet'), e = s.get('e1');
  assert.ok(gb.issue({ type: 'ability', id: 'knife', target: e, run: true }));
  s.run(3, () => !e.alive);
  assert.equal(e.alive, false);
  assert.equal(e.deathCause, 'knife');
  assert.equal(s.count('noise'), 0, 'silent');
  assert.equal(s.count('shot'), 0);
});

test('knife from a crawl: he stands up (0.6 s), walks up and stabs — never "Stand up first."', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }], enemies: [guard('e1', 14, 10, 0)] }, { brains: false });
  const gb = s.cmd('greenberet'), e = s.get('e1');
  const msgs = [];
  s.world.events.on('message', (p) => msgs.push(p.text));
  assert.ok(gb.issue({ type: 'stance', stance: 'crawl' }));
  s.run(0.6);
  assert.equal(gb.stance, 'crawl');
  assert.ok(gb.issue({ type: 'ability', id: 'knife', target: e }), 'knife accepted from a crawl');
  assert.equal(gb.stance, 'stand', 'stands up at once');
  const x0 = gb.x;
  s.run(0.5);
  near(gb.x, x0, 1e-6, 'no movement while getting up (0.6 s)');
  assert.ok(e.alive);
  s.run(4, () => !e.alive);
  assert.equal(e.alive, false);
  assert.equal(e.deathCause, 'knife');
  assert.deepEqual(msgs, [], 'no refusal / warning');
  // already in reach while crawling: still waits for the stand before the stab
  const s2 = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }], enemies: [guard('e2', 11, 10, 0)] }, { brains: false });
  const gb2 = s2.cmd('greenberet'), e2 = s2.get('e2');
  gb2.issue({ type: 'stance', stance: 'crawl' });
  s2.run(0.6);
  assert.ok(gb2.issue({ type: 'ability', id: 'knife', target: e2 }));
  s2.run(0.55);
  assert.ok(e2.alive, 'no stab before he is on his feet');
  s2.run(1.5, () => !e2.alive);
  assert.equal(e2.alive, false);
});

test('knife: M7 Marine without knife has no knife action; knife cannot reach elevated/in-vehicle enemies', () => {
  const s = makeSim({ commandos: [{ role: 'diver', x: 10, z: 10, inventory: { knife: 0 } }, { role: 'greenberet', x: 12, z: 10 }], enemies: [guard('tower', 14, 10, 0, { elevated: true, y: 4 })] }, { brains: false });
  assert.ok(!s.cmd('diver').abilities.includes('knife'));
  const gb = s.cmd('greenberet');
  assert.equal(gb.issue({ type: 'ability', id: 'knife', target: s.get('tower') }), false);
});

test('sniper rifle: 45 m one-shot kill, silent, limited rounds, 0.5 s bolt; ammo box +3; greyed at 0', () => {
  const s = makeSim({
    commandos: [{ role: 'sniper', x: 5, z: 10, inventory: { sniperRifle: 1 } }],
    enemies: [guard('e1', 49, 10), guard('e2', 49, 14)],
    interactables: [{ kind: 'ammo', id: 'box', x: 6, z: 12 }],
  }, { brains: false });
  const sn = s.cmd('sniper');
  assert.ok(sn.issue({ type: 'ability', id: 'sniper', target: s.get('e1') }));
  s.run(0.55);
  assert.ok(s.get('e1').alive, 'kneel + aim 0.6 s first');
  s.run(0.2);
  assert.equal(s.get('e1').alive, false);
  assert.equal(s.count('noise'), 0, 'no noise event');
  assert.equal(sn.inventory.get('sniperRifle'), 0);
  assert.ok(sn.abilities.includes('sniper'), 'icon stays (greyed) at 0 rounds');
  assert.equal(sn.issue({ type: 'ability', id: 'sniper', target: s.get('e2') }), false, 'no rounds');
  assert.ok(sn.issue({ type: 'ability', id: 'hand', target: s.get('box') }));
  s.run(1.5);
  assert.equal(sn.inventory.get('sniperRifle'), 3, 'ammo box +3');
  sn.issue({ type: 'ability', id: 'sniper', target: s.get('e2') });
  s.run(1.0);
  assert.equal(s.get('e2').alive, false);
});

test('SMG: 5-round fan ±15° to 18 m, 100 damage per round, one burst per click, 20 bursts, smg noise', () => {
  const s = makeSim({ commandos: [{ role: 'driver', x: 10, z: 30, inventory: { smg: 20 } }], enemies: [guard('a', 20, 30), guard('b', 20, 32.6), guard('c', 20, 36)] }, { brains: false });
  const dr = s.cmd('driver');
  assert.ok(dr.abilities.includes('smg'));
  dr.issue({ type: 'ability', id: 'smg', target: { x: 20, z: 30 } });
  s.run(0.5);
  assert.equal(dr.inventory.get('smg'), 19);
  assert.equal(s.get('a').hp, 100, 'centre ray: one round (100)');
  assert.equal(s.get('b').hp, 100, 'side ray (+7.5° ≈ 1.3 m at 10 m) hits b');
  assert.equal(s.get('c').hp, 200, 'outside the fan');
  const n = s.last('noise');
  assert.equal(n.p.kind, 'smg');
  assert.equal(s.count('shot', (p) => p.weapon === 'smg'), 5);
  const s2 = makeSim({ commandos: [{ role: 'driver', x: 10, z: 30 }] });
  assert.ok(!s2.cmd('driver').abilities.includes('smg'), 'no SMG outside its missions');
});

test('harpoon: 9 m silent kill, 3.0 s reload, unlimited', () => {
  const s = makeSim({ commandos: [{ role: 'diver', x: 10, z: 10 }], enemies: [guard('e1', 18.5, 10), guard('e2', 18.5, 12)] }, { brains: false });
  const d = s.cmd('diver');
  d.issue({ type: 'ability', id: 'harpoon', target: s.get('e1') });
  s.run(0.5);
  assert.equal(s.get('e1').alive, false);
  assert.equal(s.count('noise'), 0);
  assert.equal(d.issue({ type: 'ability', id: 'harpoon', target: s.get('e2') }), false, 'reloading');
  s.run(3.0);
  assert.ok(d.issue({ type: 'ability', id: 'harpoon', target: s.get('e2') }));
  s.run(0.5);
  assert.equal(s.get('e2').alive, false);
  assert.ok(d.has('harpoon'));
});

test('decoy: Q plants (activator replaces it), I toggles, one pulse every 1.5 s, H picks it up', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }] });
  const gb = s.cmd('greenberet');
  assert.ok(gb.abilities.includes('decoyDrop') && !gb.abilities.includes('decoyToggle'));
  gb.issue({ type: 'ability', id: 'decoyDrop', target: gb });
  s.run(0.9);
  assert.ok(!gb.has('decoy') && gb.has('decoyActivator'));
  assert.ok(gb.abilities.includes('decoyToggle') && !gb.abilities.includes('decoyDrop'));
  gb.moveTo(30, 10); s.run(3);
  gb.issue({ type: 'ability', id: 'decoyToggle', target: gb });
  s.run(4.6);
  const p = pulses(s);
  assert.equal(p.length, 4, 'pulses at 0, 1.5, 3.0, 4.5 s');
  near(p[1].t - p[0].t, 1.5, 0.051);
  assert.equal(p[0].p.radius, 13.5);
  assert.equal(p[0].p.level, 1);
  gb.issue({ type: 'ability', id: 'decoyToggle', target: gb });
  s.run(3);
  assert.equal(pulses(s).length, 4, 'off: silent');
  const decoy = s.world.interactables.find((i) => i.interactKind === 'decoy');
  gb.issue({ type: 'ability', id: 'hand', target: decoy });
  s.run(12, () => gb.has('decoy'));
  assert.ok(gb.has('decoy') && !gb.has('decoyActivator'), 'Q restored');
});

test('shovel: snow/sand only; buried = invisible; witness keeps him (near band); rise 1.0 s', () => {
  const s = makeSim({
    terrain: [{ type: 'rect', terrain: 'snow', x: 0, z: 0, w: 30, d: 60 }],
    commandos: [{ role: 'greenberet', x: 10, z: 10, inventory: { shovel: 1 } }, { role: 'greenberet', id: 'gb2', x: 40, z: 10, inventory: { shovel: 1 } }],
    enemies: [guard('w', 10, 20, -Math.PI / 2)],
  }, { brains: false });
  const gb = s.cmd('greenberet'), gb2 = s.get('gb2'), w = s.get('w');
  assert.equal(gb2.issue({ type: 'ability', id: 'shovel', target: gb2 }), false, 'grass: no');
  assert.notEqual(canSee(w, gb, s.world), 'none', 'guard sees him before');
  gb.issue({ type: 'ability', id: 'shovel', target: gb });
  s.run(2.1);
  assert.ok(gb.buried && gb.state === 'hidden' && !gb.isVisibleToEnemies);
  assert.equal(canSee(w, gb, s.world), 'near', 'witness keeps seeing him');
  w.heading = Math.PI / 2; s.run(0.2);
  assert.equal(canSee(w, gb, s.world), 'none', 'out of the witness cone');
  w.heading = -Math.PI / 2; s.run(0.2);
  assert.equal(canSee(w, gb, s.world), 'none', 'witness lost him for good');
  assert.equal(gb.issue({ type: 'move', x: 5, z: 5 }), false, 'buried: cannot move');
  assert.ok(gb.issue({ type: 'cancel' }), 'right-click rises');
  s.run(1.05);
  assert.ok(!gb.buried && gb.state === 'active' && gb.isVisibleToEnemies);
});

test('climb: GB crosses a wall through a climb link (0.5 m/s, unit:climb); others cannot; not while carrying', () => {
  const s = makeSim({
    structures: [{ type: 'wall', points: [[20, 0], [20, 60]] }],
    climbLinks: [{ a: [18.5, 30, 0], b: [21.5, 30, 0] }],
    commandos: [{ role: 'greenberet', x: 10, z: 30 }, { role: 'sapper', x: 10, z: 32 }],
  });
  const gb = s.cmd('greenberet');
  assert.equal(s.cmd('sapper').issue({ type: 'move', x: 30, z: 30 }), false, 'sapper cannot climb');
  assert.ok(gb.issue({ type: 'ability', id: 'climb', target: { x: 22, z: 30 } }));
  s.run(20, () => Math.hypot(gb.x - 21.5, gb.z - 30) < 0.1 && !gb.path);
  assert.ok(gb.x > 21, 'over the wall');
  const c = s.last('unit:climb');
  assert.ok(c && c.p.kind === 'climb');
  const tLink = s.events.filter((e) => e.name === 'unit:climb')[0].t;
  assert.ok(s.world.time - tLink >= 3 / CONFIG.abilities.climbSpeed - 0.2, 'climbing at 0.5 m/s');
});

test('carry a body: GB/Spy only, 1.6 m/s, no running, right-click drops (0.8 s); Sapper cannot', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }, { role: 'sapper', x: 10, z: 14 }], enemies: [guard('dead', 11, 12)] }, { brains: false });
  const gb = s.cmd('greenberet'), body = s.get('dead');
  body.die('knife', gb);
  assert.equal(s.cmd('sapper').issue({ type: 'ability', id: 'hand', target: body }), false);
  assert.ok(gb.issue({ type: 'ability', id: 'hand', target: body }));
  s.run(2.5, () => gb.carrying === body);
  assert.equal(gb.carrying, body);
  assert.equal(body.state, 'carried');
  assert.ok(gb.abilities.includes('drop'), 'drop action while carrying');
  gb.issue({ type: 'move', x: 30, z: 10, run: true });
  assert.equal(gb.moveMode, 'walk', 'run order becomes a walk');
  near(gb.speed, 1.6, 1e-9);
  s.run(1);
  near(body.x, gb.x, 1e-6);
  assert.ok(gb.issue({ type: 'cancel' }));
  s.run(0.85);
  assert.equal(gb.carrying, null);
  assert.equal(body.state, 'dead');
});

test('carrying a body: a move whose shortest route climbs is re-planned on foot around the wall (§3.4, M1 §7.4 step 2)', () => {
  const s = makeSim({
    structures: [{ type: 'wall', points: [[20, 0], [20, 45]] }],
    climbLinks: [{ a: [18.5, 30, 0], b: [21.5, 30, 0] }],
    commandos: [{ role: 'greenberet', x: 17, z: 30 }],
    enemies: [guard('dead', 17, 31)],
  }, { brains: false });
  const gb = s.cmd('greenberet'), body = s.get('dead');
  // Without a load the shortest route is the climb link.
  assert.ok(gb.issue({ type: 'move', x: 24, z: 30 }));
  assert.ok(gb.path.some((p) => p.link), 'unloaded: climbs');
  gb.stop();
  body.die('knife', gb);
  assert.ok(gb.issue({ type: 'ability', id: 'hand', target: body }));
  s.run(3, () => gb.carrying === body);
  assert.equal(gb.carrying, body);
  assert.ok(gb.issue({ type: 'move', x: 24, z: 30 }), 'a walking route exists: accepted');
  assert.ok(gb.path && !gb.path.some((p) => p.link), 'no climb link in the route');
  assert.ok(gb.path.some((p) => p.z > 44), 'walks around the wall end');
  s.run(60, () => !gb.path);
  assert.ok(Math.hypot(gb.x - 24, gb.z - 30) < 0.3, 'arrived with the body');
  assert.equal(gb.carrying, body);
  assert.ok(!s.events.some((e) => e.name === 'unit:climb'), 'never climbed');
});

test('carrying a body: refused only when every route needs a climb link', () => {
  const s = makeSim({
    structures: [{ type: 'wall', points: [[20, 0], [20, 60]] }],
    climbLinks: [{ a: [18.5, 30, 0], b: [21.5, 30, 0] }],
    commandos: [{ role: 'greenberet', x: 17, z: 30 }],
    enemies: [guard('dead', 17, 31)],
  }, { brains: false });
  const gb = s.cmd('greenberet'), body = s.get('dead');
  body.die('knife', gb);
  gb.issue({ type: 'ability', id: 'hand', target: body });
  s.run(3, () => gb.carrying === body);
  assert.equal(gb.carrying, body);
  assert.equal(gb.issue({ type: 'move', x: 24, z: 30 }), false, 'wall spans the map: no walking route');
  assert.ok(!gb.path);
  assert.ok(gb.issue({ type: 'move', x: 12, z: 30 }), 'same side: fine');
});

test('barrel: GB carries it; clicking a body with it hides the body under the barrel', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }], enemies: [guard('dead', 16, 10)], interactables: [{ kind: 'barrel', id: 'b', x: 11, z: 10 }] }, { brains: false });
  const gb = s.cmd('greenberet'), body = s.get('dead'), b = s.get('b');
  body.die('knife', gb);
  gb.issue({ type: 'ability', id: 'hand', target: b });
  s.run(2, () => gb.carrying === b);
  assert.equal(b.carriedBy, gb);
  gb.issue({ type: 'ability', id: 'hand', target: body });
  s.run(6, () => body.hiddenUnderBarrel);
  assert.ok(body.hiddenUnderBarrel && body.hiddenBody, 'body removed from perception');
  assert.equal(gb.carrying, null);
  near(b.x, body.x, 1e-6);
});

test('bear trap: kills the first enemy within 0.5 m silently; commandos do not trigger; H re-arms it', () => {
  const s = makeSim({ commandos: [{ role: 'sapper', x: 10, z: 10 }, { role: 'greenberet', x: 5, z: 12 }], enemies: [guard('e', 25, 12)] });
  const sp = s.cmd('sapper'), gb = s.cmd('greenberet'), e = s.get('e');
  assert.ok(sp.issue({ type: 'ability', id: 'trap', target: { x: 11, z: 11 } }));
  s.run(3, () => s.world.interactables.some((i) => i.interactKind === 'trap'));
  const trap = s.world.interactables.find((i) => i.interactKind === 'trap');
  assert.ok(trap && !sp.has('bearTrap'));
  gb.moveTo(trap.x + 3, trap.z); s.run(6);
  assert.ok(gb.alive && !trap.sprung, 'commando walks over it');
  e.brain.update = () => {};
  e.moveTo(trap.x - 3, trap.z); s.run(20, () => trap.sprung);
  assert.ok(trap.sprung && !e.alive);
  assert.equal(e.deathCause, 'trap');
  assert.equal(s.count('noise', (p) => p.source !== gb), 0, 'silent');
  sp.issue({ type: 'ability', id: 'hand', target: trap });
  s.run(4, () => sp.has('bearTrap'));
  assert.ok(sp.has('bearTrap'), 'picked up, ready to set again');
});

test('grenade: lobbed over a wall to ≤ 13.5 m, 1.0 s flight, class grenade; friendly fire', () => {
  const s = makeSim({
    structures: [{ type: 'wall', points: [[20, 20], [20, 40]] }],
    commandos: [{ role: 'sapper', x: 15, z: 30, inventory: { grenade: 2 } }, { role: 'greenberet', x: 25, z: 34 }],
    enemies: [guard('e', 25, 30)],
  }, { brains: false });
  const sp = s.cmd('sapper'), gb = s.cmd('greenberet');
  sp.issue({ type: 'ability', id: 'grenade', target: { x: 25, z: 30 } });
  s.run(0.75);
  assert.equal(sp.inventory.get('grenade'), 1);
  assert.equal(s.count('explosion'), 0, 'in flight');
  s.run(1.0);
  assert.equal(s.count('explosion'), 1);
  assert.equal(s.get('e').alive, false, '200 damage within 4.5 m');
  assert.equal(gb.hp, 0, 'friend at 4 m takes 200 too');
});

test('wire cutters: 1.5 m gap in fence cells; reinforced wire immune; live electric fence shocks (20) until switched off', () => {
  const s = makeSim({
    structures: [
      { type: 'fence', id: 'f1', points: [[30, 0], [30, 20]] },
      { type: 'fence', id: 'f2', points: [[30, 22], [30, 40]], reinforced: true },
      { type: 'fence', id: 'f3', points: [[30, 42], [30, 60]], electric: true },
    ],
    interactables: [{ kind: 'switch', id: 'sw', x: 20, z: 50, targets: ['f3'] }],
    commandos: [{ role: 'sapper', x: 25, z: 10, inventory: { wireCutters: 1 } }],
  });
  const sp = s.cmd('sapper'), g = s.world.grid;
  assert.equal(g.blockAt(30, 10), B.FENCE);
  assert.ok(sp.issue({ type: 'ability', id: 'cutters', target: { x: 30, z: 10 } }));
  s.run(8, () => g.blockAt(30, 10) !== B.FENCE);
  assert.equal(g.blockAt(30, 10), B.NONE, 'cut');
  assert.equal(g.blockAt(30, 12), B.FENCE, 'gap is only 1.5 m');
  assert.equal(sp.issue({ type: 'ability', id: 'cutters', target: { x: 30, z: 30 } }), false, 'reinforced');
  sp.issue({ type: 'ability', id: 'cutters', target: { x: 30, z: 50 } });
  s.run(40, () => sp.hp < sp.maxHp);
  assert.equal(sp.maxHp - sp.hp, 20, 'electric shock');
  assert.equal(g.blockAt(30, 50), B.FENCE, 'cut failed');
  sp.issue({ type: 'ability', id: 'use', target: s.get('sw') });
  s.run(10, () => s.world.fencePower.get('f3') === false);
  assert.equal(s.world.fencePower.get('f3'), false, 'power off');
  sp.issue({ type: 'ability', id: 'cutters', target: { x: 30, z: 50 } });
  s.run(20, () => g.blockAt(30, 50) !== B.FENCE);
  assert.equal(g.blockAt(30, 50), B.NONE);
  assert.equal(sp.maxHp - sp.hp, 20, 'no second shock');
});
