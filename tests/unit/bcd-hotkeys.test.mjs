/** BCD key layout (docs/bcd-plan.md §2, step N2) and Easy/Hard data variants (§1.12, step N12). */
import { test, assert } from './lib.mjs';
import { CONFIG } from '../../src/config.js';
import { roleKeyMap, abilitiesForKey, hotkeyFor } from '../../src/engine/hotkeys.js';
import { normalizeMission, applyVariant } from '../../src/missions/schema.js';
import { knapsackView } from '../../src/ui/knapsack-model.js';
import { bcdHelpRows } from '../../src/ui/bcd-ui.js';
import { bcdSim } from './bcd-sim.mjs';

const BCD = CONFIG.rulesets.BCD;
const ROLES = ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy', 'natasha', 'skopje'];

test('BCD keys: never repeated inside one role’s kit (time/remote bomb share B as in BEL)', () => {
  for (const r of ROLES) {
    const m = roleKeyMap(r, BCD);
    const seen = {};
    for (const [id, k] of Object.entries(m)) {
      if (seen[k] && !(k === 'B' && ['timeBomb', 'remoteBomb'].includes(id))) assert.fail(`${r}: ${id} and ${seen[k]} both on ${k}`);
      seen[k] = id;
    }
  }
});

test('BCD keys: the §2 table (moved and new keys)', () => {
  const want = {
    greenberet: { knockoutFist: 'X', knife: 'W', handcuff: 'J', pistol: 'Q', decoyDrop: 'G', decoyToggle: 'I', shovel: 'F', stone: 'Y', cigarettes: 'V', puppet: 'R', hand: 'H' },
    sniper: { sniper: 'E', pistol: 'Q', stone: 'Y', cigarettes: 'V', puppet: 'R', firstAid: 'K', hand: 'H' },
    diver: { knife: 'W', harpoon: 'E', pistol: 'Q', dive: 'D', raft: 'N', stone: 'Y', cigarettes: 'V', puppet: 'R', hand: 'H' },
    sapper: { pistol: 'Q', trap: 'W', timeBomb: 'B', remoteBomb: 'B', detonate: 'A', grenade: 'E', cutters: 'J', stone: 'Y', cigarettes: 'V', puppet: 'R', hand: 'H' },
    driver: { knockoutClub: 'X', smg: 'W', pistol: 'Q', rifle: 'E', stone: 'Y', cigarettes: 'V', puppet: 'R', firstAid: 'K', hand: 'H' },
    spy: { knockoutChloroform: 'X', syringe: 'W', uniform: 'U', distract: 'D', handcuff: 'J', hanger: 'T', pistol: 'Q', stone: 'Y', cigarettes: 'V', puppet: 'R', firstAid: 'K', hand: 'H' },
    natasha: { lipstick: 'D', beretta: 'Q', cigarettes: 'V', handGuest: 'H' },
    skopje: { stone: 'Y', cigarettes: 'V', handGuest: 'H' },
  };
  for (const r of ROLES) assert.deepEqual(roleKeyMap(r, BCD), want[r], r);
  assert.equal(hotkeyFor('smg', BCD), 'w', 'the SMG moves to W');
});

test('BCD keys: each BCD key arms the right def (X = knock-out, not the knife)', () => {
  const ids = (code) => abilitiesForKey(code, BCD).map((d) => d.id);
  assert.deepEqual(ids('KeyX'), ['knockoutFist', 'knockoutClub', 'knockoutChloroform']);
  assert.ok(ids('KeyW').includes('knife') && ids('KeyW').includes('smg') && ids('KeyW').includes('syringe'));
  assert.deepEqual(ids('KeyY'), ['stone']);
  assert.deepEqual(ids('KeyV'), ['cigarettes']);
  assert.deepEqual(ids('KeyR'), ['puppet']);
  assert.deepEqual(ids('KeyT'), ['hanger']);
  assert.ok(ids('KeyE').includes('rifle'));
  assert.deepEqual(ids('KeyM'), [], 'M is free under BCD');
  assert.deepEqual(ids('KeyL'), [], 'L is free under BCD');
});

test('BCD keys reach the knapsack labels and the help screen; nothing under BEL', () => {
  const s = bcdSim({ commandos: [{ role: 'driver', x: 10, z: 10 }] });
  const v = knapsackView([s.cmd('driver')], s.world);
  const smg = v.items?.find((i) => i.id === 'leeEnfield');
  if (smg) assert.equal(smg.key, 'E');
  const rows = bcdHelpRows(BCD);
  assert.ok(rows.some(([k, t]) => k === 'X' && /Fist/.test(t)));
  assert.ok(rows.some(([k]) => k === '7 / 8'));
  assert.deepEqual(bcdHelpRows(CONFIG.rulesets.BEL), []);
});

const VAR_DEF = {
  id: 'vtest', size: [60, 60], campaign: 'BCD',
  enemies: [
    { id: 'a', soldierType: 'soldier', x: 10, z: 10, route: { type: 'PINGPONG', vel: 2, points: [{ x: 10, z: 10, wait: 2 }, { x: 20, z: 10, wait: 4 }] } },
    { id: 'h', soldierType: 'soldier', x: 30, z: 30, only: 'hard' },
    { id: 'e', soldierType: 'soldier', x: 40, z: 40, only: 'easy' },
  ],
  variants: { easy: { routeSpeedMul: 0.8, pauseMul: 2.5, par: { time: 677 } }, hard: { par: { time: 692 }, enemyPatch: { a: { heading: 1 } } } },
};

test('BCD Easy/Hard: variant merge in schema (extra guards, removals, route speed, pauses, par time)', () => {
  const hard = normalizeMission(VAR_DEF, { difficulty: 'hard', quiet: true });
  const easy = normalizeMission(VAR_DEF, { difficulty: 'easy', quiet: true });
  assert.deepEqual(hard.enemies.map((e) => e.id), ['a', 'h']);
  assert.deepEqual(easy.enemies.map((e) => e.id), ['a', 'e']);
  assert.equal(hard.par.time, 692);
  assert.equal(easy.par.time, 677);
  assert.equal(hard.enemies[0].heading, 1);
  assert.ok(Math.abs(easy.enemies[0].route.vel - 1.6) < 1e-9, 'Easy routes walk at 0.8×');
  assert.deepEqual(easy.enemies[0].route.points.map((p) => p.wait), [5, 10], 'pauses 2.5×');
  assert.equal(hard.difficulty, 'hard');
  assert.equal(normalizeMission(VAR_DEF, { quiet: true }).difficulty, 'hard', 'default: the retail base');
  const bel = { id: 'b', size: [10, 10], enemies: [{ id: 'x', x: 1, z: 1 }] };
  assert.equal(applyVariant(bel, 'easy'), bel, 'BEL defs pass through untouched');
});
