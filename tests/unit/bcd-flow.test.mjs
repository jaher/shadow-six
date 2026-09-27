/** BCD UI and flow (docs/bcd-plan.md §1.11–§1.13; step N12): Commando Warnings, career, passwords, Skill. */
import { test, assert } from './lib.mjs';
import { CONFIG } from '../../src/config.js';
import { CommandoWarnings, SKILL_CHOICES } from '../../src/ui/bcd-ui.js';
import { Flow } from '../../src/core/flow.js';
import { rankIndex, rankName } from '../../src/core/scoring.js';
import { encodePassword, decodePassword } from '../../src/core/passwords.js';
import { bcdSim, post } from './bcd-sim.mjs';

test('BCD Commando Warnings: blue while inside a cone, red for 1.5 s after a hit / near miss, off under BEL', () => {
  const s = bcdSim({ commandos: [{ role: 'sniper', x: 30, z: 20 }, { role: 'spy', x: 5, z: 5 }], enemies: [post('a', 20, 20, 0)] });
  const cw = new CommandoWarnings(s.world);
  const sn = s.cmd('sniper'), spy = s.cmd('spy');
  s.run(0.1);
  assert.equal(cw.state(sn), 'blue');
  assert.equal(cw.state(spy), null);
  assert.equal(cw.state(sn, false), null, 'option off');
  s.world.events.emit('shot', { shooter: s.get('a'), to: { x: 30.5, z: 20 }, target: null, hit: false, weapon: 'rifle', from: { x: 20, z: 20 } });
  assert.equal(cw.state(sn), 'red', 'near miss');
  s.run(1.6);
  assert.notEqual(cw.state(sn), 'red');
  cw.dispose();
  const bel = bcdSim({ campaign: 'BEL', commandos: [{ role: 'sniper', x: 30, z: 20 }], enemies: [post('a', 20, 20, 0)] });
  bel.run(0.1);
  assert.equal(new CommandoWarnings(bel.world).state(bel.cmd('sniper')), null);
});

test('BCD career: starts at Major (36 gold), 8 missions × 3 gold reach Field Marshal at 60; BEL starts at 0', () => {
  const f = new Flow(null, [], 'BCD');
  assert.equal(f.gold, 36);
  assert.equal(rankIndex(f.gold), 6);
  assert.equal(rankName(36), CONFIG.mission.ranks[6]);
  assert.equal(rankIndex(36 + CONFIG.rulesets.BCD.maxGold), 10);
  assert.equal(new Flow(null, [], 'BEL').gold, 0);
  assert.equal(new Flow(null, [], 'BEL').difficulty, null);
});

test('BCD password: carries the Skill bit and replays one mission; BEL codes are unchanged', () => {
  const easy = encodePassword('BCD', 3, 2, 7, 'easy'), hard = encodePassword('BCD', 3, 2, 7, 'hard');
  assert.notEqual(easy, hard);
  assert.deepEqual(decodePassword(easy), { campaign: 'BCD', mission: 3, stars: 2, rank: 7, difficulty: 'easy' });
  assert.deepEqual(decodePassword(hard), { campaign: 'BCD', mission: 3, stars: 2, rank: 7, difficulty: 'hard' });
  assert.equal(encodePassword('BEL', 5, 1, 2, 'easy'), encodePassword('BEL', 5, 1, 2), 'BEL ignores the bit');
  assert.deepEqual(decodePassword(encodePassword('BEL', 5, 1, 2)), { campaign: 'BEL', mission: 5, stars: 1, rank: 2 });
  const game = { events: null };
  const f = new Flow(game, [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }], 'BCD');
  assert.equal(f.enterPassword(easy), 'b3');
  assert.equal(f.difficulty, 'easy');
  assert.equal(game.difficulty, 'easy', 'the next load uses the Easy data');
});

test('BCD Skill screen choices; BEL flow refuses a difficulty', () => {
  assert.deepEqual(SKILL_CHOICES.map((c) => c.id), ['easy', 'hard']);
  assert.equal(new Flow(null, [], 'BEL').setDifficulty('easy'), false);
  const f = new Flow(null, [], 'BCD');
  assert.equal(f.difficulty, 'hard');
  assert.equal(f.setDifficulty('easy'), true);
  assert.equal(f.serialize().difficulty, 'easy');
});
