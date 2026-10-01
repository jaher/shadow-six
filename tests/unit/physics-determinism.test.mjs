/**
 * bodies-design §E physics-determinism: the same blast scenario gives bit-identical settled bodies and props; a save
 * taken mid-flight (Rapier snapshot) continues exactly like the uninterrupted run; the physics tier comes from the save.
 */
import { CONFIG } from '../../src/config.js';
import { test, assert } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { Entity } from '../../src/entities/entity.js';
import { createPhysics } from '../../src/physics/world-physics.js';
import { restoreWorld, restorePhysicsLayer } from '../../src/save.js';

/** M1-like barrel scenario: an explosive drum, three guards around it, ten crate stacks. */
export const SCENARIO = {
  size: [60, 60], baseTerrain: 'snow',
  commandos: [{ role: 'sapper', x: 5, z: 5 }],
  enemies: [guard('g1', 30.5, 31.2, 0), guard('g2', 28.2, 29.4, 1), guard('g3', 33.5, 28.6, 2)],
  structures: [
    { id: 'drum', type: 'barrels', x: 30, z: 30, r: 0.3, h: 0.9, explosive: 'barrel', carriable: true, destructible: true, hp: 1 },
    ...Array.from({ length: 10 }, (_, k) => ({ id: `crate${k}`, type: 'crates', x: 24 + (k % 5) * 3, z: 24 + Math.floor(k / 5) * 13, w: 1.2, d: 1.2, h: 1.1 })),
  ],
};

export async function scenarioSim(tier = 'high', def = SCENARIO) {
  Entity.nextId = 1;
  const sim = makeSim(def, { brains: false });
  sim.world.physics = await createPhysics(sim.world, { tier });
  sim.world.house.physicsTier = tier;
  return sim;
}

function ignite(sim) {
  const drum = sim.world.interactables.find((b) => b.interactKind === 'barrel');
  drum.ignite(0, sim.cmd('sapper'));
}

/** Settled state digest: body poses + gameplay positions + prop poses (exact numbers). */
function digest(sim) {
  const w = sim.world;
  return JSON.stringify({
    bodies: w.enemies.map((e) => [e.tag ?? e.id, e.alive, e.x, e.z, e.y, e.settled, e.bodyPose?.b ?? null]),
    props: w.physics.props.items.map((it) => [it.key, it.pose, it.stamp]),
  });
}

test('physics: two runs of the same blast are bit-identical (bodies, poses, props)', async () => {
  const a = await scenarioSim(), b = await scenarioSim();
  assert.equal(a.world.physics.isNull, false, 'Rapier loads in node');
  ignite(a); ignite(b);
  a.run(9); b.run(9);
  const da = digest(a), db = digest(b);
  assert.equal(da, db);
  const dead = a.world.enemies.filter((e) => !e.alive);
  assert.ok(dead.length >= 2, 'the drum kills the guards next to it');
  for (const e of dead) assert.ok(e.settled && e.bodyPose, `guard ${e.id} settled with a baked pose`);
  assert.ok(a.world.physics.props.items.some((it) => it.moved), 'the blast woke some crates');
  assert.equal(a.world.physics.moving(), false, 'everything at rest after 9 s');
});

test('physics: save mid-flight (snapshot) → load → continue equals the uninterrupted run', async () => {
  const ref = await scenarioSim();
  ignite(ref); ref.run(9);
  const a = await scenarioSim();
  ignite(a); a.run(0.4);
  assert.ok(a.world.physics.moving(), 'bodies still flying at 0.4 s');
  const snap = { world: a.world.serialize(), house: { ...a.world.house }, physics: a.world.physics.serialize() };
  assert.ok(snap.physics.snapshot, 'a Rapier snapshot is saved while bodies move');
  const json = JSON.parse(JSON.stringify(snap));
  const b = await scenarioSim();
  restoreWorld(b.world, json.world);
  restorePhysicsLayer(b.world, json);
  b.run(9 - 0.4);
  assert.equal(digest(b), digest(ref));
});

test('physics: the tier comes from the save, not from the machine', async () => {
  const a = await scenarioSim('ultra');
  ignite(a); a.run(0.3);
  const snap = JSON.parse(JSON.stringify({ world: a.world.serialize(), house: { ...a.world.house }, physics: a.world.physics.serialize() }));
  const b = await scenarioSim('low');
  restoreWorld(b.world, snap.world);
  restorePhysicsLayer(b.world, snap);
  assert.equal(b.world.house.physicsTier, 'ultra');
  assert.equal(b.world.physics.tier, 'ultra');
  assert.equal(b.world.physics.caps.ragdolls, CONFIG.physics.gameplayCaps.ragdolls);
});

test('physics: gameplay does not depend on the graphics preset (same bodies, same spots on low and ultra)', async () => {
  const run = async (tier) => {
    const s = await scenarioSim(tier);
    ignite(s); s.run(8);
    return s.world.enemies.map((e) => [e.id, e.alive, +e.x.toFixed(4), +e.z.toFixed(4), !!e.settled]);
  };
  assert.deepEqual(await run('low'), await run('ultra'));
});

test('physics: the save snapshot is packed (sync LZ) and round-trips byte for byte', async () => {
  const { lzPack, lzUnpack } = await import('../../src/physics/persist.js');
  const a = new Uint8Array(200000);
  for (let i = 0; i < a.length; i++) a[i] = i % 3000 < 1500 ? 0 : (i * 2654435761) >>> 24; // zero runs + noise, like a heightfield
  const p = lzPack(a), b = lzUnpack(p);
  assert.equal(b.length, a.length);
  assert.ok(b.every((v, i) => v === a[i]), 'identical');
  assert.ok(p.length < a.length * 0.7, `packed ${p.length} / ${a.length}`);
  const s = await scenarioSim('high');
  ignite(s); s.run(0.3);
  const ph = s.world.physics.serialize();
  assert.ok(ph.snapshot?.startsWith('lz:'), 'a moving world saves a packed snapshot');
});
