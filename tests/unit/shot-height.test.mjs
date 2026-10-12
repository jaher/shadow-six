/**
 * Commando line of fire by the §4.2 height sight line (coordinator 2026-10-12: "a guard can shoot over a low crate that
 * the commando can't. Make commando line of fire follow the same height rule, so it's symmetric"). Guards fire on whom
 * perception.canSee sees; a commando's shot (pistol, rifle, SMG, harpoon) now follows the same rule (common.shotSight):
 * a crate or low wall below the line between them hides neither, a wall at man height hides both, and low cover between
 * them hides them from each other when either lies low. Before, every B.HIGH cell blocked a bullet at any height.
 */
import { test, assert } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { ABILITIES } from '../../src/abilities/index.js';
import { canSee } from '../../src/ai/perception.js';
import { shotSight } from '../../src/abilities/common.js';

function scene(structures, role = 'greenberet', cx = 22) {
  const s = makeSim({ size: [50, 30], structures, commandos: [{ role, x: cx, z: 15, heading: Math.PI }], enemies: [guard('g', 10, 15, 0)] }, { brains: false });
  const g = s.get('g'); g.sweepActive = false;
  return { s, w: s.world, g, c: s.cmd(role) };
}

test('shot height: over a 1.2 m crate stack a guard sees the commando and the commando can shoot the guard (both ways)', () => {
  const { w, g, c } = scene([{ id: 'crates', type: 'crates', x: 16, z: 15, w: 2, d: 3, h: 1.2, block: 2 }]);
  assert.equal(w.grid.block[w.grid.idx(32, 30)], 2, 'precondition: the crates are a blocking cell');
  assert.notEqual(canSee(g, c, w), 'none', 'the guard sees him over the crates (and would fire)');
  assert.equal(shotSight(w, c, g), true, 'his line of fire clears them too');
  assert.equal(ABILITIES.pistol.canUse(c, g, w), true, 'the pistol order is accepted (12 m)');
});

test('shot height: a 2.4 m wall hides both ways', () => {
  const { w, g, c } = scene([{ id: 'wall', type: 'wall', points: [[16, 10], [16, 20]], h: 2.4 }]);
  assert.equal(canSee(g, c, w), 'none');
  assert.equal(shotSight(w, c, g), false);
  assert.equal(ABILITIES.pistol.canUse(c, g, w), 'No line of sight.');
});

test('shot height: low cover between them — the guard cannot see the prone man behind it, nor can the prone man shoot back over it', () => {
  const { w, g, c } = scene([{ id: 'sand', type: 'sandbags', x: 20.5, z: 15, rot: Math.PI / 2, w: 6, h: 1.0, block: 1 }]);
  assert.equal(w.grid.block[w.grid.idx(41, 30)], 1, 'precondition: sandbags are low cover');
  c.setStance('crawl'); c.stance = 'crawl';
  assert.equal(canSee(g, c, w), 'none', 'prone behind the sandbags: hidden');
  assert.equal(shotSight(w, c, g), false, 'and his shot back is blocked');
  c.stance = 'stand';
  assert.notEqual(canSee(g, c, w), 'none', 'standing: seen over them');
  assert.equal(shotSight(w, c, g), true, 'and he fires over them');
});

test('shot height: the Sniper kneels to fire (§3.4) — from prone behind sandbags his rifle clears them, and while he kneels the guard sees him', () => {
  const { s, w, g, c } = scene([{ id: 'sand', type: 'sandbags', x: 20.5, z: 15, rot: Math.PI / 2, w: 6, h: 1.0, block: 1 }], 'sniper');
  c.setStance('crawl'); c.stance = 'crawl';
  assert.equal(canSee(g, c, w), 'none', 'lying behind the sandbags: hidden');
  assert.equal(shotSight(w, c, g), false, 'a prone shot (pistol) is blocked');
  assert.equal(shotSight(w, c, g, true), true, 'the rifle: he kneels, his line clears the sandbags');
  assert.equal(ABILITIES.sniper.canUse(c, g, w), true, 'the rifle order is accepted');
  assert.ok(c.issue({ type: 'ability', id: 'sniper', target: g }), 'he takes aim');
  s.run(0.3);
  assert.equal(c.kneeling, true, 'up on one knee');
  assert.equal(c.isLow, false, 'counts as standing');
  assert.notEqual(canSee(g, c, w), 'none', 'the guard sees him over the sandbags while he aims');
  s.run(1);
  assert.equal(g.alive, false, 'the shot is off');
  assert.ok(!c.kneeling && c.isLow, 'down again');
});
