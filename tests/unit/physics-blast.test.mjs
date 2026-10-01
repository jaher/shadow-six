/**
 * bodies-design §A.3 / §A.5 / §0.3 / ground marks: the blast impulse model (falloff, reach, clamp, lift, wall shielding
 * with the 0.15 floor), survivor reaction bands, the house-rules layer, and the explosion ground-mark surface rules.
 */
import { test, assert, near } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { Entity } from '../../src/entities/entity.js';
import { createPhysics } from '../../src/physics/world-physics.js';
import { blastParams, blastImpulse, occlusion } from '../../src/physics/blast.js';
import { survivorReaction } from '../../src/physics/blast-apply.js';
import { resolveHouseRules, restoreHouseRules } from '../../src/core/house-rules.js';
import { markSurface, BlastMarks } from '../../src/render/blast-marks.js';
import { explode } from '../../src/entities/projectile.js';
import { CONFIG } from '../../src/config.js';

const fakeWorld = { time: 0, groundY: null };

test('blast: impulse falls off with distance, is clamped, and stops at 2.5 × the kill radius', () => {
  const bp = blastParams(fakeWorld, { x: 0, z: 0, radius: 6.75, kind: 'grenade' });
  near(bp.Rb, 2.5 * 6.75, 1e-9, 'reach');
  near(bp.r0, 0.35 * 6.75, 1e-9, 'r0');
  let last = Infinity;
  for (const r of [0.5, 1, 2, 4, 8, 12, 16]) {
    const j = blastImpulse(bp, r, 1, 0, 0.7, 75, 1e9).J;
    assert.ok(j < last, `J decreases at ${r} m`); last = j;
  }
  assert.equal(blastImpulse(bp, bp.Rb + 0.1, 1, 0, 0.7, 75, 1e9).J, 0, 'nothing beyond R_b');
  const big = blastParams(fakeWorld, { x: 0, z: 0, radius: 6.75, kind: 'bomb' });
  assert.equal(blastImpulse(big, 0.3, 1, 0, 0.7, 75, CONFIG.physics.blast.maxDvBody).dv, CONFIG.physics.blast.maxDvBody, 'Δv clamp');
  assert.ok(blastImpulse(big, 5, 1, 0, 0.7, 75, 1e9).J > blastImpulse(bp, 5, 1, 0, 0.7, 75, 1e9).J, 'a bomb (Q 3) pushes harder than a grenade');
  const near0 = blastImpulse(bp, 1, 1, 0, 0.7, 75, 1e9).dir, far = blastImpulse(bp, 14, 1, 0, 0.7, 75, 1e9).dir;
  assert.ok(near0.y > far.y && near0.x > 0.8, 'outward with more lift close to the blast');
});

test('blast: a wall between the blast and a target shields it (3 rays, floor 0.15)', async () => {
  Entity.nextId = 1;
  const s = makeSim({ size: [40, 40], commandos: [{ role: 'sapper', x: 3, z: 3 }], structures: [{ id: 'w', type: 'wall', points: [[20, 10], [20, 30]], h: 3 }] }, { brains: false });
  s.world.physics = await createPhysics(s.world, {});
  const pw = s.world.physics, bp = blastParams(s.world, { x: 17, z: 20, radius: 6.75, kind: 'bomb' });
  near(occlusion(pw.rw, pw.R, s.world, bp, 23, 20), CONFIG.physics.blast.occMin, 1e-9, 'behind the wall');
  near(occlusion(pw.rw, pw.R, s.world, bp, 14, 20), 1, 1e-9, 'open side');
});

test('blast: survivors flinch / stagger / fall by the speed the blast would give them (visual only)', () => {
  const S = CONFIG.physics.survivor;
  assert.equal(survivorReaction(0.01), null);
  assert.equal(survivorReaction(S.flinch - 0.01), 'flinch');
  assert.equal(survivorReaction(S.flinch + 0.01), 'stagger');
  assert.equal(survivorReaction(S.fall + 0.01), 'fall');
  assert.equal(survivorReaction(S.fall + 3, 'crawl'), 'flinch', 'crawling men only flinch');
});

test('blast: survivors keep their simulation state; only the visual reaction is set', async () => {
  Entity.nextId = 1;
  const s = makeSim({ size: [60, 60], commandos: [{ role: 'sapper', x: 3, z: 3 }], enemies: [guard('near', 37.5, 30, 0), guard('far', 44, 30, 0)] }, { brains: false });
  s.world.physics = await createPhysics(s.world, {});
  const [a, b] = s.world.enemies;
  const before = [a.x, a.z, a.state, a.hp, b.x, b.z, b.state, b.hp];
  explode(s.world, 30, 30, 'grenade', s.cmd('sapper'));
  s.step();
  assert.deepEqual([a.x, a.z, a.state, a.hp, b.x, b.z, b.state, b.hp], before);
  assert.ok(a.blastReact && b.blastReact, 'both react');
  assert.ok(a.blastReact.kind !== 'flinch' || a.blastReact.off <= CONFIG.physics.survivor.maxOffset);
  assert.ok(a.blastReact.off >= b.blastReact.off, 'the nearer man is pushed harder');
});

test('house rules: presets, per-rule options (→ custom), mission overrides, save restore', () => {
  const d = resolveHouseRules();
  assert.equal(d.preset, 'shadowSix');
  assert.deepEqual([d.dragBodies, d.buddyRescue, d.dropWhenShot, d.ragdollAllDeaths], [true, true, true, true]);
  const c = resolveHouseRules({ preset: 'classic1998', tier: 'low' });
  assert.deepEqual([c.dragBodies, c.buddyRescue, c.dropWhenShot, c.ragdollAllDeaths, c.physicsTier], [false, false, false, true, 'low']);
  const o = resolveHouseRules({ options: { rulesPreset: 'classic1998', dragBodies: true } });
  assert.equal(o.preset, 'custom'); assert.equal(o.dragBodies, true);
  assert.equal(resolveHouseRules({ mission: { houseRules: { buddyRescue: false } } }).buddyRescue, false);
  const r = restoreHouseRules({ preset: 'classic1998', dragBodies: false, physicsTier: 'ultra' }, d);
  assert.equal(r.physicsTier, 'ultra'); assert.equal(r.dragBodies, false);
  assert.equal(restoreHouseRules(null, d), d, 'old saves keep the current preset');
});

test('ground marks: soft ground → crater, road / decks / roofs → scorch, water → none; saved and restored', () => {
  Entity.nextId = 1;
  const s = makeSim({ size: [40, 40], baseTerrain: 'snow', commandos: [{ role: 'sapper', x: 3, z: 3 }],
    terrain: [{ type: 'rect', terrain: 'road', x: 10, z: 0, w: 4, d: 40 }, { type: 'rect', terrain: 'water', x: 30, z: 0, w: 10, d: 40 }] }, { brains: false });
  const w = s.world;
  assert.equal(markSurface(w, 5, 5), 'soft');
  assert.equal(markSurface(w, 12, 5), 'hard');
  assert.equal(markSurface(w, 36, 5), 'water');
  w.grid.elev[w.grid.idx(10, 40)] = 3;
  assert.equal(markSurface(w, 5.25, 20.25), 'hard', 'a roof');
  const m = new BlastMarks(w, null);
  for (const [x, cls] of [[5, 'grenade'], [12, 'bomb'], [36, 'grenade']]) explode(w, x, 8, cls, s.cmd('sapper'));
  assert.deepEqual(m.marks.map((k) => [k.s, k.cls]), [['soft', 'grenade'], ['hard', 'bomb']]);
  const m2 = new BlastMarks(w, null);
  m2.restore(JSON.parse(JSON.stringify(m.serialize())));
  assert.deepEqual(m2.marks, m.marks);
  m.dispose(); m2.dispose();
});
