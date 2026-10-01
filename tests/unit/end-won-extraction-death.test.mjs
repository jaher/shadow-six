/**
 * §8.1: a won extraction never overrides the loss countdown for a dead commando (M15 fix #2: the escape objective
 * counts only the living, so the last three aboard used to win with the Spy dead on the pavement).
 * Drives Game.prototype._checkEnd on a stub game (no renderer).
 */
import { test, assert } from './lib.mjs';
import { Game } from '../../src/game.js';
import { CONFIG } from '../../src/config.js';

function stubGame(commandos) {
  const g = {
    world: { commandos, mission: { extraction: { vehicleId: 'van' } }, extraction: { vehicleId: 'van' }, objectives: [], byId: () => null, clock: 0 },
    pendingEnd: null, ended: null, events: { list: [], emit(n, p) { this.list.push([n, p]); } },
    _endMission(won, reason) { this.ended = { won, reason }; },
  };
  g._lossCondition = Game.prototype._lossCondition;
  g._checkEnd = Game.prototype._checkEnd;
  return g;
}

test('end: a won extraction with a dead commando runs the loss countdown and ends lost', () => {
  const g = stubGame([{ id: 'a', alive: true, inVehicle: 'van' }, { id: 'b', alive: false }]);
  g._checkEnd({ won: true }, 0.1);
  assert.equal(g.ended, null, 'no instant win');
  assert.equal(g.pendingEnd?.won, false);
  assert.equal(g.pendingEnd?.code, 'died');
  for (let t = 0; t < CONFIG.mission.lostDelay + 1 && !g.ended; t += 0.1) g._checkEnd({ won: true }, 0.1);
  assert.equal(g.ended?.won, false);
  assert.match(g.ended.reason, /DIED/);
});

test('end: a won extraction with everyone alive still wins at once', () => {
  const g = stubGame([{ id: 'a', alive: true, inVehicle: 'van' }, { id: 'b', alive: true, inVehicle: 'van' }]);
  g._checkEnd({ won: true }, 0.1);
  assert.deepEqual(g.ended, { won: true, reason: 'MISSION COMPLETED' });
});

test('end: _endMission is idempotent (one mission:won per run, M15 fix round 2)', () => {
  const g = { state: 'playing', pendingEnd: null, missionDef: { id: 'm15' }, flow: null,
    world: { stats: { startTime: 0 }, time: 10 },
    events: { list: [], emit(n, p) { this.list.push([n, p]); } },
    _setState(s) { this.state = s; } };
  Game.prototype._endMission.call(g, true, 'MISSION COMPLETED');
  Game.prototype._endMission.call(g, true, 'MISSION COMPLETED');
  Game.prototype._endMission.call(g, false, 'late loss');
  assert.equal(g.events.list.filter(([n]) => n === 'mission:won' || n === 'mission:lost').length, 1);
  assert.equal(g.state, 'won');
});
