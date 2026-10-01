/**
 * §7.3 commando spawn `stance: 'crawl'` is applied at mission start (M15 fix #6; also M04, M08, M18, M20):
 * the commando starts prone with no stance-change lockout; a spawn without `stance` still starts standing.
 */
import { test, assert } from './lib.mjs';
import { Game } from '../../src/game.js';
import { World } from '../../src/world/world.js';

test('spawn: stance crawl starts the commando prone; no stance → standing', () => {
  const world = new World({ size: [40, 40] });
  const def = { commandos: [
    { id: 'sp', role: 'spy', x: 5, z: 5, stance: 'crawl', inventory: { pistol: 1 } },
    { id: 'sn', role: 'sniper', x: 8, z: 5, inventory: { pistol: 1 } },
  ], enemies: [], vehicles: [] };
  Game.prototype._spawnUnits.call({}, world, def);
  const sp = world.commandos.find((c) => c.role === 'spy');
  const sn = world.commandos.find((c) => c.role === 'sniper');
  assert.equal(sp.stance, 'crawl');
  assert.ok(!(sp._stanceT > 0), 'already down: no lockout');
  assert.equal(sn.stance, 'stand');
});
