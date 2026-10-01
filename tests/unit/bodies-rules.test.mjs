/** bodies-design §0.1 / §0.3, §E: the CLASSIC 1998 preset plays exactly like the original. */
import { test, assert } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { ABILITIES } from '../../src/abilities/index.js';
import { roleKeyMap } from '../../src/engine/hotkeys.js';
import { CONFIG } from '../../src/config.js';

const CLASSIC = { dragBodies: false, buddyRescue: false, dropWhenShot: false };
const SIX = ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy'];

test('classic1998: no house ability on any commando, hotkeys and BEL flags untouched', () => {
  const s = makeSim({ houseRules: CLASSIC, commandos: SIX.map((role, k) => ({ role, x: 10 + k * 2, z: 10 })) }, { brains: false });
  for (const c of s.world.commandos) {
    for (const id of ['drag', 'carryToggle']) assert.ok(!c.abilities.includes(id), `${c.role} ${id}`);
    assert.equal(c.abilities.includes('drop'), false, 'drop only appears while carrying (available)');
  }
  assert.deepEqual(roleKeyMap('greenberet', CONFIG.rulesets.BEL), { knife: 'X', pistol: 'G', decoyDrop: 'Q', decoyToggle: 'I', shovel: 'F', hand: 'H' });
  for (const [k, v] of Object.entries(CONFIG.rulesets.BEL)) if (typeof v === 'boolean') assert.equal(v, false, k);
  assert.equal(ABILITIES.drag.hotkey, null);
});

test('classic1998: only the GB and the Spy can hand a body', () => {
  for (const role of SIX) {
    const s = makeSim({ houseRules: CLASSIC, commandos: [{ role, x: 10, z: 10 }], enemies: [guard('d', 11, 10)] }, { brains: false });
    const c = s.cmd(role), b = s.get('d');
    b.die('knife', null);
    const ok = c.issue({ type: 'ability', id: 'hand', target: b });
    assert.equal(ok, role === 'greenberet' || role === 'spy', role);
    if (!ok) assert.equal(c.lastRefusal.text, "Can't carry bodies.");
    assert.equal(c.issue({ type: 'ability', id: 'drag', target: b }), false, `${role}: no drag`);
  }
});

test('classic1998: 0 HP is death (no DOWNED); a carrier who is shot keeps his load', () => {
  const s = makeSim({ houseRules: CLASSIC, commandos: [{ role: 'greenberet', x: 10, z: 10 }, { role: 'sniper', x: 20, z: 10 }], enemies: [guard('d', 11, 10)] }, { brains: false });
  const gb = s.cmd('greenberet'), sn = s.cmd('sniper'), b = s.get('d');
  b.die('knife', null);
  gb.issue({ type: 'ability', id: 'hand', target: b });
  s.run(2, () => gb.carrying === b);
  gb.takeDamage(50, null, 'shot');
  assert.equal(gb.carrying, b, 'keeps it');
  sn.takeDamage(sn.hp, null, 'shot');
  assert.equal(sn.alive, false);
  assert.equal(sn.downed, null);
});

test('forced house rules of a mission are printed as briefing lines', async () => {
  const { forcedRuleLines } = await import('../../src/core/house-rules.js');
  assert.deepEqual(forcedRuleLines({}), []);
  const l = forcedRuleLines({ houseRules: { buddyRescue: false, dragBodies: true } });
  assert.equal(l.length, 2);
  assert.ok(l.some((t) => /lost/.test(t)) && l.some((t) => /drag/.test(t)));
});
