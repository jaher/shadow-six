/** BCD sandbox mission b00 (docs/bcd-plan.md §3 N13): loads headless under BCD, every station present. */
import { test, assert } from './lib.mjs';
import { getMission, CAMPAIGNS } from '../../src/missions/index.js';
import { normalizeMission } from '../../src/missions/schema.js';
import { bcdSim } from './bcd-sim.mjs';

test('b00: a valid BCD dev mission (strict schema), not in the BCD campaign list', () => {
  const m = getMission('b00');
  assert.equal(m.campaign, 'BCD');
  assert.equal(m.dev, true);
  assert.ok(!CAMPAIGNS.BCD.includes(m));
  const n = normalizeMission(m, { strict: true, quiet: true });
  assert.equal(n.difficulty, 'hard');
  assert.ok(n.enemies.some((e) => e.id === 'hard_extra') && !n.enemies.some((e) => e.id === 'easy_extra'));
  const e = normalizeMission(m, { difficulty: 'easy', quiet: true });
  assert.ok(e.enemies.some((q) => q.id === 'easy_extra') && !e.enemies.some((q) => q.id === 'hard_extra'));
  assert.equal(e.par.time, 1000);
});

test('b00: every commando, guest, unit type and mechanic spawns; 20 s of sim run cleanly with no alarm', () => {
  const { id, ...def } = getMission('b00'); // eslint-disable-line no-unused-vars
  const s = bcdSim({ ...def, id: 'b00x' });
  const roles = s.world.commandos.map((c) => c.role).sort();
  assert.deepEqual(roles, ['diver', 'driver', 'greenberet', 'natasha', 'sapper', 'skopje', 'sniper', 'spy']);
  const types = new Set(s.world.enemies.map((e) => e.soldierType));
  for (const t of ['gestapo', 'lieutenant', 'zookeeper', 'snitch', 'pow', 'lion', 'ostrich', 'chicken', 'dog']) assert.ok(types.has(t), t);
  const kinds = new Set(s.world.interactables.map((i) => i.interactKind));
  for (const k of ['drawbridge', 'drawbridgeSwitch', 'seaMine', 'pushable', 'lift', 'knapsack']) assert.ok(kinds.has(k), k);
  assert.equal(s.cmd('skopje').state, 'jailed', 'Skopje waits to be reached');
  s.run(20);
  assert.ok(!s.alarmed(), 'a quiet map until the tester acts');
  for (const c of s.world.commandos) assert.ok(c.alive, c.role);
});
