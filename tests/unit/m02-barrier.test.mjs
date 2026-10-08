/**
 * M2 barrier gate / MG platforms / access platform (user request "Make a barrier gate. In mission 2 there should be
 * a machine gun on a platform and a platform to be able to enter the space which has the car on the side…").
 * The barrier's walk-round and the boom physics are in missions13 / gate-smash; here: the MG gunners see and fire
 * over the palisade from their open decks, and plat_sw's stair is a walkable graded strip.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { loadGrid } from './mission-check.mjs';
import { getMission } from '../../src/missions/index.js';
import { findPath } from '../../src/world/pathfinding.js';
import { overWallsTest, MAX_STEP } from '../../src/world/grid.js';
import { Entity } from '../../src/entities/entity.js';
import { Commando } from '../../src/entities/commando.js';
import '../../src/abilities/index.js';

test('overWallsTest: a wall under the sight line does not block, one above it (or of unknown height) does', () => {
  const H = { 1: 3.0, 2: 8.0 };
  const over = overWallsTest({ heightOf: (k) => H[k] ?? null, eyeY: 7.15, targetTopY: 1.5 });
  assert.equal(over(1, 0.1), true, '3 m palisade near the tower: the line is still ~6.6 m up');
  assert.equal(over(1, 0.9), false, 'near the target the line is down at ~2 m');
  assert.equal(over(2, 0.1), false, 'a taller building blocks');
  assert.equal(over(3, 0.1), false, 'unknown height blocks');
  assert.equal(overWallsTest(null), null);
});

/** M2 with the sniper standing `dist` m out along e9's post heading (outside the NE palisade). */
function gunnerScene(dist, patch = null) {
  Entity.nextId = 1;
  const def0 = getMission('m02');
  const def = patch ? { ...def0, enemies: def0.enemies.map((e) => (e.id === 'e9' ? { ...e, ...patch } : e)) } : def0;
  const s = makeSim(def), w = s.world, e9 = s.get('e9'), c = s.cmd('sniper');
  const h = e9.post.heading;
  c.setPosition(e9.x + Math.cos(h) * dist, e9.z + Math.sin(h) * dist);
  const ev = [];
  w.events.on('enemy:spotted', (x) => { if (x.enemy === e9) ev.push(['spotted', w.time]); });
  w.events.on('shot', (x) => { if (x.shooter === e9) ev.push(['shot', w.time, x.hit]); });
  return { s, w, e9, c, ev };
}

test('m02 MG platforms: the gunner on t2 (deck 5.5 m) sees a man in his arc beyond the palisade and fires on him', () => {
  const { s, e9, c, ev } = gunnerScene(20);
  assert.ok(e9.y > 5 && e9.vision.overWalls && e9.vision.overlooks);
  s.run(6);
  assert.ok(ev.some((e) => e[0] === 'spotted'), 'spotted');
  assert.ok(ev.some((e) => e[0] === 'shot' && e[2]), `fires and hits (${JSON.stringify(ev.slice(0, 4))})`);
  assert.ok(!c.alive || c.hp < c.maxHp, 'the man is hit');
});

test('m02 MG platforms: without overWalls the same gunner is blind behind his own palisade (the flag is what lets him see)', () => {
  const { s, ev } = gunnerScene(20, { overWalls: false });
  s.run(6);
  assert.equal(ev.length, 0, JSON.stringify(ev));
});

test('m02 plat_sw: the stair is a graded walkable strip from the landing (2.2 m) to the camp floor; walkers use it both ways', () => {
  const { grid } = loadGrid(getMission('m02'));
  const down = findPath(grid, 28.3, 42.9, 33.5, 42.2, { role: 'sniper' });
  const up = findPath(grid, 33.5, 42.2, 28.3, 42.9, { role: 'sniper' });
  assert.ok(down && up, 'paths both ways');
  assert.ok(![...down, ...up].some((p) => p.link), 'no ladder / climb link: the stair is walked');
  // along the downward path the floor falls in steps no taller than MAX_STEP (sampled every 5 cm: down the stair the
  // path runs straight, world/pathfinding.js straightenFlights)
  const ys = [];
  for (let i = 1; i < down.length; i++) {
    const a = down[i - 1], b = down[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
    for (let q = i === 1 ? 0 : 1; q <= n; q++) ys.push(grid.elevAt(a.x + ((b.x - a.x) * q) / n, a.z + ((b.z - a.z) * q) / n));
  }
  assert.ok(Math.abs(ys[0] - 2.2) < 0.05 && ys[ys.length - 1] < 0.05, `from the landing to the floor (${ys[0].toFixed(2)} → ${ys[ys.length - 1].toFixed(2)})`);
  for (let i = 1; i < ys.length; i++) assert.ok(Math.abs(ys[i] - ys[i - 1]) <= MAX_STEP + 1e-6, `step ${i}: ${ys[i - 1].toFixed(2)} → ${ys[i].toFixed(2)}`);
  assert.ok(ys.filter((y) => y > 0.3 && y < 1.9).length >= 2, 'it goes through the stair cells');
  assert.ok(!getMission('m02').ladders.some((l) => l.id === 'ladder_sw_in'), 'the old inner-steps link is gone');
});

test('m02 plat_sw: a walker on the stair follows its slope, not the graded cells (no cell-by-cell height snaps)', () => {
  const ctx = loadGrid(getMission('m02')), { grid, world } = ctx;
  assert.equal(grid.ramps?.length, 1, 'the stair registers one ramp');
  const c = world.add(new Commando({ role: 'sniper', x: 28.3, z: 42.9 }));
  c.y = grid.elevAt(28.3, 42.9);
  for (const [x, z, y1] of [[33.5, 42.2, 0], [28.3, 42.9, 2.2]]) {
    assert.ok(c.moveTo(x, z), `path to (${x}, ${z})`);
    let jump = 0, prev = c.y, n = 0;
    for (let k = 0; k < 60 * 15 && c.path; k++) { c.update(1 / 60); jump = Math.max(jump, Math.abs(c.y - prev)); n += Math.abs(c.y - prev) > 1e-4; prev = c.y; }
    assert.ok(Math.abs(c.y - y1) < 0.05 && Math.hypot(c.x - x, c.z - z) < 0.6, `reached (${x}, ${z}) at y ${c.y.toFixed(2)}`);
    // walking pace × the stair's slope (2.2 m over 3.2 m) is ~0.04 m per tick; a cell snap was 0.3-0.55 m
    assert.ok(jump < 0.1, `largest height change in one tick ${jump.toFixed(3)} m`);
    assert.ok(n > 20, `the height changes gradually over many ticks (${n})`);
  }
});
