/** Stance button (bottom HUD, left of the hand): which figure it shows and when it is disabled (stance-button.js). */
import { test, assert } from './lib.mjs';
import { stanceButtonState, canTakeStance, STANCE_TIP } from '../../src/ui/stance-button.js';
import { ICON_MANIFEST } from '../../src/ui/icon-manifest.js';
import { toolHTML } from '../../src/ui/icon-art.js';

const man = (o = {}) => ({ alive: true, stance: 'stand', state: 'idle', ...o });

test('stance button shows the posture a click switches TO: crawling figure while upright, standing while crawling', () => {
  assert.deepEqual(stanceButtonState([man()]), { to: 'crawl', icon: 'tool/stance.crawl', disabled: false });
  assert.deepEqual(stanceButtonState([man({ stance: 'crawl' })]), { to: 'stand', icon: 'tool/stance.stand', disabled: false });
  // group: everyone crawling -> stand; anyone upright -> crawl (same rule as HUD.togglePosture)
  assert.equal(stanceButtonState([man({ stance: 'crawl' }), man({ stance: 'crawl' })]).to, 'stand');
  assert.equal(stanceButtonState([man({ stance: 'crawl' }), man()]).to, 'crawl');
  assert.equal(stanceButtonState([man({ stance: 'crawl' }), man()]).disabled, false);
  // dead men in the list do not count
  assert.equal(stanceButtonState([man({ stance: 'crawl' }), man({ alive: false })]).to, 'stand');
  assert.match(STANCE_TIP, /LIE DOWN \/ STAND UP \(C \/ S\)/);
});

test('stance button is disabled with no selection or when nobody selected can change stance', () => {
  assert.equal(stanceButtonState([]).disabled, true);
  assert.equal(stanceButtonState(null).disabled, true);
  assert.equal(stanceButtonState([man()]).icon, 'tool/stance.crawl', 'empty-ish state still shows a figure');
  for (const o of [{ state: 'inVehicle' }, { vehicle: {} }, { hidden: true }, { buried: true }, { downed: true },
    { carrying: { kind: 'body' } }, { noCrawl: true }, { diving: true }, { currentAction: { interruptible: false } }, { state: 'jailed' }]) {
    assert.equal(stanceButtonState([man(o)]).disabled, true, JSON.stringify(o));
  }
  // a man carrying a body cannot lie down, but a crawler... is never carrying; standing up is fine for a downed-free crawler
  assert.equal(canTakeStance(man({ stance: 'crawl' }), 'stand'), true);
  assert.equal(canTakeStance(man({ carrying: { kind: 'interactable' } }), 'crawl'), false);
  // in water (Unit.setStance refuses crawl)
  const wet = man({ x: 1, z: 2, world: { groundAt: () => ({ water: true }) } });
  assert.equal(stanceButtonState([wet]).disabled, true);
  // one able man in a group keeps it enabled
  assert.equal(stanceButtonState([man({ state: 'inVehicle' }), man()]).disabled, false);
});

test('stance icons ship with every tool state in one shared box (no shift on toggle), larger than the old figurines', () => {
  for (const t of ['stance.crawl', 'stance.stand']) {
    const h = toolHTML(`tool/${t}`);
    for (const v of ['base', 'hover', 'pressed', 'active', 'disabled']) assert.ok(h.includes(`data-v="${v}"`), `${t} ${v}`);
  }
  const a = ICON_MANIFEST['tool/stance.crawl'].b, b = ICON_MANIFEST['tool/stance.stand'].b;
  assert.deepEqual(a, b, 'both stance renders share one box');
  assert.ok(a[0] >= 56 && a[1] >= 44, `box ${a} big enough to read and to tap at uiScale 1`);
  assert.equal(ICON_MANIFEST['tool/posture.prone'], undefined, 'old top-bar posture art is retired');
});
