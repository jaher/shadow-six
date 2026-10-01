import { test, assert } from './lib.mjs';
import { touchFirst, pressPrompt, narrowPortrait } from '../../src/ui/touch.js';

const win = (q, touchPoints = 0) => ({ matchMedia: (s) => ({ matches: q.includes(s) }), navigator: { maxTouchPoints: touchPoints } });

test('touch: a phone (no hover, coarse pointer) is touch-first; a desktop or a touch laptop with a mouse is not', () => {
  assert.equal(touchFirst(win(['(hover: none) and (pointer: coarse)'], 5)), true, 'phone');
  assert.equal(touchFirst(win(['(pointer: fine)'], 0)), false, 'desktop');
  assert.equal(touchFirst(win(['(pointer: fine)'], 10)), false, 'touch laptop with a trackpad');
  assert.equal(touchFirst(win([], 5)), true, 'touch points and no fine pointer');
  assert.equal(touchFirst({}), false, 'no matchMedia (node)');
});

test('touch: the title prompt names the input the player has', () => {
  assert.equal(pressPrompt(true), 'TAP TO CONTINUE');
  assert.match(pressPrompt(false), /^PRESS ANY KEY OR CLICK$/);
});

test('touch: the rotate hint is for narrow portrait screens only', () => {
  assert.equal(narrowPortrait(390, 664), true, 'iPhone portrait');
  assert.equal(narrowPortrait(664, 390), false, 'iPhone landscape');
  assert.equal(narrowPortrait(768, 1024), false, 'tablet portrait is wide enough');
});
