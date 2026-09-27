/** Phase-1 merge (art integration + menus): the shared option and credits seams stay consistent. */
import { test, assert } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { reducedMotion } from '../../src/render/fx.js';
import { OPTION_DEFAULTS } from '../../src/ui/ui-config.js';
import { OPTION_ROWS } from '../../src/ui/options-panel.js';

const ROOT = new URL('../../', import.meta.url);

test('reduced motion: menus tri-state drives the explosion camera shake (booleans still accepted)', () => {
  assert.equal(OPTION_DEFAULTS.reducedMotion, 'system');
  assert.equal(reducedMotion('on'), true);
  assert.equal(reducedMotion(true), true);
  assert.equal(reducedMotion('off'), false);
  assert.equal(reducedMotion(false), false);
  assert.equal(reducedMotion(undefined), false);
  const mm = globalThis.matchMedia;
  try {
    globalThis.matchMedia = () => ({ matches: true });
    assert.equal(reducedMotion('system'), true);
    globalThis.matchMedia = () => ({ matches: false });
    assert.equal(reducedMotion('system'), false);
  } finally { globalThis.matchMedia = mm; }
});

test('options panel has one reduced-motion row, with the menus tri-state', () => {
  const rows = OPTION_ROWS.filter((r) => r[0] === 'reducedMotion');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0][2], ['system', 'on', 'off']);
});

test('CREDITS.md keeps every team\'s rows and no merge markers', () => {
  const s = readFileSync(new URL('CREDITS.md', ROOT), 'utf8');
  assert.ok(!/^(<<<<<<<|=======|>>>>>>>)/m.test(s), 'no conflict markers');
  for (const k of ['assets/portraits/**', 'assets/ui/tex/oak@', '### Buildings & bridges', 'assets/audio/voice/**', 'Menu foley']) {
    assert.ok(s.includes(k), k);
  }
  assert.ok(!s.includes('all sounds synthesized at runtime so far'), 'stale audio placeholder row dropped');
});
