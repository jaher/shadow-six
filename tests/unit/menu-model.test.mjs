import { test, assert } from './lib.mjs';
import {
  nextFocus, edgeFocus, firstEnabled, hotkeyOf, splitHotkey, codeForHotkey, rowForCode, stepSlider, crossedDetent,
  flipChoice, passwordChar, normalizePassword, profileNameChar, KeyBuffer, pickTip, easeProgress, rankLabel,
} from '../../src/ui/menu-model.js';

const MAIN = ['NEW GAME', 'SAVE GAME', 'LOAD GAME', 'OPTIONS', 'CREDITS', 'HELP', 'QUIT GAME'].map((label) => ({ kind: 'item', label }));

test('menu: ↑↓ wrap, rules are skipped, disabled rows stay focusable (§1.9, contract 3)', () => {
  const rows = [{ kind: 'item' }, { kind: 'rule' }, { kind: 'item', disabled: true }, { kind: 'head' }, { kind: 'item' }];
  assert.equal(nextFocus(rows, 0, 1), 2, 'skips the rule, lands on the disabled row');
  assert.equal(nextFocus(rows, 2, 1), 4);
  assert.equal(nextFocus(rows, 4, 1), 0, 'wraps to the top');
  assert.equal(nextFocus(rows, 0, -1), 4, 'wraps to the bottom');
  assert.equal(edgeFocus(rows, 1), 0);
  assert.equal(edgeFocus(rows, -1), 4);
  assert.equal(nextFocus([], 0, 1), -1);
  assert.equal(nextFocus([{ kind: 'rule' }], 0, 1), -1);
});

test('menu: first focus is the first enabled row (SAVE GAME dimmed outside a mission)', () => {
  const rows = MAIN.map((r, i) => ({ ...r, disabled: i === 1 }));
  assert.equal(firstEnabled(rows), 0);
  assert.equal(firstEnabled([{ kind: 'item', disabled: true }, { kind: 'item', locked: true }, { kind: 'item' }]), 2);
  assert.equal(firstEnabled([{ kind: 'item', disabled: true }]), 0, 'all disabled: still focusable');
});

test('menu: 5 queued ↓ presses during a card-in land on row 6 (amendment B4)', () => {
  const buf = new KeyBuffer();
  for (let i = 0; i < 5; i++) buf.push('ArrowDown');
  let f = firstEnabled(MAIN);
  for (const code of buf.drain()) if (code === 'ArrowDown') f = nextFocus(MAIN, f, 1);
  assert.equal(f, 5, 'row 6 (HELP)');
  assert.equal(MAIN[f].label, 'HELP');
  assert.equal(buf.size, 0);
});

test('menu: (X) hotkey grammar (contract 4)', () => {
  assert.equal(hotkeyOf('(Y)ES'), 'Y');
  assert.equal(hotkeyOf('(N)EXT MISSION'), 'N');
  assert.equal(hotkeyOf('LOAD GAME'), null);
  assert.deepEqual(splitHotkey('(P)LAY AGAIN'), { pre: '', key: 'P', post: 'LAY AGAIN' });
  assert.deepEqual(splitHotkey('(S)Í'), { pre: '', key: 'S', post: 'Í' }, 'localised hotkeys come from the string');
  assert.equal(codeForHotkey('N'), 'KeyN');
  assert.equal(codeForHotkey('3'), 'Digit3');
  const rows = [{ kind: 'hotkey', hotkey: 'Y' }, { kind: 'hotkey', hotkey: 'N' }];
  assert.equal(rowForCode(rows, 'KeyN'), 1);
  assert.equal(rowForCode(rows, 'KeyQ'), -1);
});

test('menu: slider steps 5 %, Shift 1 %, clamps, detents every 10 % (§1.5.6)', () => {
  assert.equal(stepSlider(0.8, 1), 0.85);
  assert.equal(stepSlider(0.8, -1, { fine: true }), 0.79);
  assert.equal(stepSlider(0.98, 1), 1);
  assert.equal(stepSlider(0.02, -1), 0);
  assert.equal(stepSlider(50, 1, { min: 0, max: 100 }), 55);
  assert.ok(crossedDetent(0.75, 0.8));
  assert.ok(!crossedDetent(0.8, 0.85));
});

test('menu: toggles flip both ways and wrap (§1.5.5)', () => {
  assert.equal(flipChoice(['submissive', 'indifferent'], 'indifferent', 1), 'submissive');
  assert.equal(flipChoice(['low', 'medium', 'high', 'ultra'], 'ultra', 1), 'low');
  assert.equal(flipChoice(['low', 'medium', 'high', 'ultra'], 'low', -1), 'ultra');
  assert.equal(flipChoice([true, false], true, 1), false);
});

test('menu: password cells read O as 0 and I as 1; paste is trimmed (§1.5.7, S08)', () => {
  assert.equal(passwordChar('o'), '0');
  assert.equal(passwordChar('I'), '1');
  assert.equal(passwordChar('-'), null);
  assert.equal(normalizePassword('  ns2bo7x '), 'NS2B0');
  assert.equal(normalizePassword('ab'), 'AB');
  assert.equal(profileNameChar('t'), 'T');
  assert.equal(profileNameChar('-'), '-');
  assert.equal(profileNameChar('!'), null);
});

test('menu: loading tips prefer the theatre, then unseen ones (S14)', () => {
  const tips = [{ id: 'a', text: 'any' }, { id: 's', text: 'snow', theaters: ['snow'] }, { id: 'd', text: 'desert', theaters: ['desert'] }];
  assert.equal(pickTip(tips, { theater: 'snow', rnd: 0.5 }).id, 's');
  assert.equal(pickTip(tips, { theater: 'snow', seen: new Set(['s']), rnd: 0 }).id, 'a');
  assert.equal(pickTip(tips, { theater: 'desert', seen: new Set(['a', 'd']), rnd: 0 }).id, 'a', 'all seen → any relevant');
  assert.equal(pickTip([], {}), null);
});

test('menu: the loading bar never goes backwards (S14)', () => {
  const a = easeProgress(0.5, 0.2, 0.1);
  assert.equal(a, 0.5);
  const b = easeProgress(0.5, 1, 0.1);
  assert.ok(b > 0.5 && b < 1);
  assert.equal(rankLabel(['Lance-Corporal', 'Corporal'], 1), 'CORPORAL');
  assert.equal(rankLabel(['Lance-Corporal'], 9), 'LANCE-CORPORAL');
});
