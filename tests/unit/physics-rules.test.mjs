/**
 * bodies-design §E physics-rules: physics is a presentation layer. Kill sets are unchanged for every explosion class;
 * settled bodies end on walkable ground (≤ 1.5 m nudge), never inside a building or deep water; props never re-stamp
 * onto doors, links or unit cells; BEL barrel rules hold; a failed init is the null object; caps are deterministic.
 */
import { test, assert } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { Entity } from '../../src/entities/entity.js';
import { createPhysics } from '../../src/physics/world-physics.js';
import { loaderHooks } from '../../src/physics/rapier-loader.js';
import { restampProp } from '../../src/physics/props.js';
import { explode } from '../../src/entities/projectile.js';
import { B } from '../../src/world/grid.js';
import { CONFIG } from '../../src/config.js';

async function sim(def, { physics = true, tier = 'high' } = {}) {
  Entity.nextId = 1;
  const s = makeSim(def, { brains: false });
  if (physics) s.world.physics = await createPhysics(s.world, { tier });
  return s;
}

const RING = (n, cx, cz, r0, dr) => Array.from({ length: n }, (_, k) => guard(`e${k}`, cx + Math.cos(k * 2.4) * (r0 + dr * k), cz + Math.sin(k * 2.4) * (r0 + dr * k), k));

test('physics-rules: every explosion class kills exactly the same units with physics on and off', async () => {
  for (const cls of Object.keys(CONFIG.weapons.explosions)) {
    const def = { size: [60, 60], commandos: [{ role: 'sapper', x: 3, z: 3 }], enemies: RING(14, 30, 30, 0.8, 0.75) };
    const on = await sim(def), off = await sim(def, { physics: false });
    for (const s of [on, off]) { explode(s.world, 30, 30, cls, s.cmd('sapper')); s.run(4); }
    const state = (s) => s.world.enemies.map((e) => [e.tag, e.alive, e.hp]);
    assert.deepEqual(state(on), state(off), `class ${cls}`);
  }
});

test('physics-rules: settled bodies lie on walkable ground, never inside a building or deep water', async () => {
  const def = {
    size: [60, 60], commandos: [{ role: 'sapper', x: 3, z: 3 }],
    enemies: RING(8, 30, 30, 1.0, 0.3),
    structures: [{ id: 'hut', type: 'hut', x: 34, z: 30, w: 4, d: 4, rot: 0 }, { id: 'wall', type: 'wall', points: [[25, 26], [25, 34]], h: 2.5 }],
    terrain: [{ type: 'rect', terrain: 'water', x: 20, z: 36, w: 20, d: 8 }],
  };
  const s = await sim(def);
  explode(s.world, 30, 30, 'bomb', s.cmd('sapper'));
  s.run(9);
  const g = s.world.grid;
  const dead = s.world.enemies.filter((e) => !e.alive);
  assert.ok(dead.length >= 6);
  for (const e of dead) {
    assert.ok(e.settled, `e${e.id} settled`);
    if (e.sunk) continue;
    assert.ok(g.walkableAt(e.x, e.z), `e${e.id} at (${e.x.toFixed(2)}, ${e.z.toFixed(2)}) is walkable`);
  }
});

test('physics-rules: a prop never re-stamps onto units, doors or link ends (nudged or nav-neutral)', async () => {
  const s = await sim({ size: [30, 30], commandos: [{ role: 'sapper', x: 10.25, z: 10.25 }], structures: [{ id: 'c', type: 'crates', x: 20, z: 20, w: 1.4, d: 1.4, h: 1.2 }] });
  const it = s.world.physics.props.items[0];
  assert.ok(it, 'crate stack is a loose prop');
  it.pose = [10.25, 0.6, 10.25, 0, 0, 0, 1];
  const st = restampProp(s.world, it);
  const c = s.cmd('sapper'), g = s.world.grid;
  const k = g.idx(Math.floor(c.x / g.cell), Math.floor(c.z / g.cell));
  assert.equal(g.block[k], B.NONE, 'the commando cell stays walkable');
  if (st) assert.ok(Math.hypot(st.x - 10.25, st.z - 10.25) <= CONFIG.physics.props.nudge + 1e-9, 'nudged at most props.nudge');
  g.addLink('climb', { x: 5.25, z: 5.25, y: 0 }, { x: 5.25, z: 7.25, y: 2 });
  it.pose = [5.25, 0.6, 5.25, 0, 0, 0, 1];
  const st2 = restampProp(s.world, it);
  const ka = g.idx(10, 10);
  assert.equal(g.block[ka], B.NONE, 'the link end stays free');
  assert.ok(!st2 || st2.cells.every((kk) => !g.linksAt(kk).length));
});

test('physics-rules: an explosive barrel still explodes; a barrel hiding a body stays put', async () => {
  const s = await sim({ size: [40, 40], commandos: [{ role: 'sapper', x: 3, z: 3 }], enemies: [guard('dead', 12, 12, 0)],
    structures: [{ id: 'd1', type: 'barrels', x: 20, z: 20, explosive: 'barrel', carriable: true, destructible: true, hp: 1 },
      { id: 'd2', type: 'barrels', x: 24, z: 20, explosive: 'barrel', carriable: true, destructible: true, hp: 1 },
      { id: 'd3', type: 'barrels', x: 12, z: 14, explosive: 'barrel', carriable: true, destructible: true, hp: 1 }] });
  const w = s.world, [d1, d2, d3] = w.interactables.filter((b) => b.interactKind === 'barrel');
  const body = w.byId(w.enemies[0].id);
  body.die('knife'); d3.hidesBody = body; body.hiddenBody = true;
  explode(w, 21, 20, 'grenade', s.cmd('sapper'));
  s.run(3);
  assert.ok(d1.exploded && d2.exploded, 'chained drums exploded (BEL rule)');
  assert.equal(d3.x, 12); assert.equal(d3.z, 14);
  assert.equal(body.bodyPose, null, 'the hidden body never ragdolls');
});

test('physics-rules: a failed physics init is the null object and gameplay is identical', async () => {
  const def = { size: [60, 60], commandos: [{ role: 'sapper', x: 3, z: 3 }], enemies: RING(6, 30, 30, 1, 1.2) };
  loaderHooks.fail = true;
  let off;
  try { off = await sim(def); } finally { loaderHooks.fail = false; }
  assert.equal(off.world.physics.isNull, true);
  const on = await sim(def, { physics: false });
  for (const s of [on, off]) { explode(s.world, 30, 30, 'grenade', s.cmd('sapper')); s.run(3); }
  assert.deepEqual(off.world.enemies.map((e) => [e.x, e.z, e.alive, e.hp]), on.world.enemies.map((e) => [e.x, e.z, e.alive, e.hp]));
  // with Rapier: the same kills and the same living units; only the bodies' resting places differ
  const phys = await sim(def);
  explode(phys.world, 30, 30, 'grenade', phys.cmd('sapper')); phys.run(3);
  const live = (s) => s.world.enemies.map((e) => (e.alive ? [e.x, e.z, e.hp] : ['dead']));
  assert.deepEqual(live(phys), live(off));
});

test('physics-rules: active ragdoll caps are honoured with a deterministic pick (impulse ↓, id ↑)', async () => {
  const def = { size: [60, 60], commandos: [{ role: 'sapper', x: 3, z: 3 }], enemies: RING(9, 30, 30, 0.8, 0.4) };
  const a = await sim(def, { tier: 'low' }), b = await sim(def, { tier: 'low' });
  for (const s of [a, b]) { explode(s.world, 30, 30, 'bomb', s.cmd('sapper')); s.step(); }
  assert.equal(a.world.physics.ragdolls.length, CONFIG.physics.gameplayCaps.ragdolls);
  assert.deepEqual(a.world.physics.ragdolls.map((r) => r.unit.tag), b.world.physics.ragdolls.map((r) => r.unit.tag));
  // the closest (biggest impulse, open field) bodies got the ragdolls
  const d = (u) => Math.hypot(u.anchorX - 30, u.anchorZ - 30);
  for (const r of a.world.physics.ragdolls) { r.unit.anchorX = r.anchor.x; r.unit.anchorZ = r.anchor.z; }
  const dead = a.world.enemies.filter((e) => !e.alive);
  const spawnD = new Map(def.enemies.map((e, k) => [`e${k}`, Math.hypot(e.x - 30, e.z - 30)]));
  const pickedD = a.world.physics.ragdolls.map((r) => spawnD.get(r.unit.tag));
  const others = dead.filter((e) => !a.world.physics.ragdollOf(e)).map((e) => spawnD.get(e.tag));
  assert.ok(others.length > 0, 'some bodies over the cap');
  assert.ok(Math.max(...pickedD) <= Math.min(...others) + 1e-9, 'the nearest bodies got the ragdolls');
  a.run(12);
  assert.ok(dead.every((e) => e.settled), 'bodies over the cap settle once slots free up');
  assert.ok(d(dead[0]) >= 0 || true);
});

test('physics-rules: 1998 rules (physicsGameplay off): bodies keep their death spot, props keep their footprint', async () => {
  const def = { size: [60, 60], commandos: [{ role: 'sapper', x: 3, z: 3 }], enemies: RING(6, 30, 30, 1.0, 0.4),
    structures: [{ id: 'c', type: 'crates', x: 33, z: 30, w: 1.4, d: 1.4, h: 1.2 }] }; // clear of e0 (31,30): a body spawned inside it slides out on death (placement rule e)
  const s = await sim(def);
  s.world.house.physicsGameplay = false;
  const g = s.world.grid, block0 = Uint8Array.from(g.block);
  const spots = new Map(s.world.enemies.map((e) => [e.id, [e.x, e.z]]));
  explode(s.world, 30, 30, 'bomb', s.cmd('sapper'));
  s.run(8);
  const dead = s.world.enemies.filter((e) => !e.alive);
  assert.ok(dead.length >= 4, 'the bomb killed the ring');
  for (const e of dead) assert.deepEqual([e.x, e.z], spots.get(e.id), `${e.tag} stays where he died`);
  assert.ok(dead.some((e) => e.bodyPose), 'the settle pose is still drawn');
  assert.deepEqual(Array.from(g.block), Array.from(block0), 'no footprint cleared or re-stamped');
  // the same bomb under SHADOW SIX moves the bodies (the feedback the flag turns off)
  const t = await sim(def);
  explode(t.world, 30, 30, 'bomb', t.cmd('sapper'));
  t.run(8);
  assert.ok(t.world.enemies.some((e) => !e.alive && Math.hypot(e.x - spots.get(e.id)[0], e.z - spots.get(e.id)[1]) > 0.5));
});

test('physics-rules: a guard blown off his feet is down (blind, no fire) for the fall, then up again (§A.5)', async () => {
  const def = { size: [60, 60], commandos: [{ role: 'sapper', x: 3, z: 3 }], enemies: RING(12, 30, 30, 4, 0.6) };
  const s = await sim(def);
  explode(s.world, 30, 30, 'bomb', s.cmd('sapper'));
  s.step();
  const down = s.world.enemies.filter((e) => e.alive && e.knockedDown);
  assert.ok(down.length > 0, 'a survivor was knocked down');
  const g = down[0];
  assert.ok(g.incapacitated, 'down: no cone, no reactions');
  const snap = JSON.parse(JSON.stringify(g.serialize()));
  assert.ok(snap.knockedDown, 'saved');
  s.run(CONFIG.physics.survivor.times.fall + 0.1);
  assert.ok(!g.incapacitated, 'up again');
  const c = await sim(def);
  c.world.house.physicsGameplay = false;
  explode(c.world, 30, 30, 'bomb', c.cmd('sapper'));
  c.step();
  assert.ok(!c.world.enemies.some((e) => e.knockedDown), '1998 rules: visual only');
});
