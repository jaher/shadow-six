/**
 * §4.10 selection rules [manual]: a captured or jailed man, or one currently held under fire, cannot be
 * multi-selected; he can be selected alone. Drives engine/input.js with a stub game (no DOM).
 */
import { test, assert } from './lib.mjs';
import { Input, multiSelectable } from '../../src/engine/input.js';

function rig() {
  const mk = (id, x) => ({ id, kind: 'commando', role: id, alive: true, state: 'active', held: false, selected: false, x, y: 0, z: 0 });
  const commandos = [mk('greenberet', 10), mk('diver', 20), mk('driver', 30), mk('sniper', 40)];
  const world = { commandos, events: { emit() {} } };
  const cameraController = {
    worldToScreen: (x, y, z) => ({ x: x * 10, y: 100 + z }),
    isOnScreen: () => true,
    recenterOn() {},
  };
  const game = { world, state: 'playing', cameraController, events: { emit() {} } };
  const inp = new Input(game, null);
  const [gb, diver, driver, sniper] = commandos;
  return { inp, world, gb, diver, driver, sniper };
}
const ids = (inp) => inp.selection.map((c) => c.id).sort().join();

test('selection §4.10: multiSelectable rejects held / captured / jailed', () => {
  assert.equal(multiSelectable({ state: 'active', held: false }), true);
  assert.equal(multiSelectable({ state: 'active', held: true }), false);
  assert.equal(multiSelectable({ state: 'captured' }), false);
  assert.equal(multiSelectable({ state: 'jailed' }), false);
  assert.equal(multiSelectable({ state: 'held' }), false);
});

test('selection §4.10: box select drops held, captured and jailed men', () => {
  const { inp, diver, driver, sniper } = rig();
  diver.held = true; driver.state = 'captured'; sniper.state = 'jailed';
  inp.boxSelect(0, 0, 10000, 10000);
  assert.equal(ids(inp), 'greenberet');
  assert.equal(diver.selected, false);
  assert.equal(driver.selected, false);
  assert.equal(sniper.selected, false);
});

test('selection §4.10: a box around only one held man selects him alone', () => {
  const { inp, diver } = rig();
  diver.held = true;
  inp.boxSelect(195, 0, 205, 1000);
  assert.equal(ids(inp), 'diver');
});

test('selection §4.10: select-all (8) and multi-unit select skip restricted men', () => {
  const { inp, world, diver, driver } = rig();
  diver.held = true; driver.state = 'jailed';
  inp.select(world.commandos.filter((c) => c.alive));
  assert.equal(ids(inp), 'greenberet,sniper');
});

test('selection §4.10: key/portrait selects a held or captured man alone', () => {
  const { inp, gb, diver, driver } = rig();
  inp.select([gb]);
  diver.held = true; driver.state = 'captured';
  assert.equal(inp.selectUnit(diver), true);
  assert.equal(ids(inp), 'diver');
  inp.select([driver]);
  assert.equal(ids(inp), 'driver');
});

test('selection §4.10: Ctrl-add cannot put a restricted man in a group', () => {
  const { inp, gb, sniper, diver } = rig();
  diver.held = true;
  inp.select([gb]);
  inp.selectUnit(diver, { ctrl: true });
  assert.equal(ids(inp), 'greenberet', 'held man not added to the group');
  // held man selected alone, then Ctrl-adding a free man leaves only multi-selectable men
  inp.select([diver]);
  inp.select([sniper], { add: true });
  assert.equal(ids(inp), 'sniper');
  // ordinary Ctrl toggles still work
  inp.select([gb]);
  inp.select([sniper], { toggle: true });
  assert.equal(ids(inp), 'greenberet,sniper');
  inp.select([sniper], { toggle: true });
  assert.equal(ids(inp), 'greenberet');
});

test('selection §5.2: portrait click on a selected man deselects him; key 1–7 recentres instead (§2.3)', () => {
  const { inp, gb, sniper } = rig();
  let recentres = 0;
  inp.game.cameraController.recenterOn = () => { recentres++; };
  // portrait click selects, a second portrait click on the same man deselects (no recentre)
  inp.selectUnit(gb, { portrait: true });
  assert.equal(ids(inp), 'greenberet');
  inp.selectUnit(gb, { portrait: true });
  assert.equal(ids(inp), '', 'second portrait click deselects');
  assert.equal(recentres, 0, 'deselecting never recentres');
  // in a group, a portrait click on a selected member removes just him (as a map click does)
  inp.select([gb, sniper]);
  inp.selectUnit(sniper, { portrait: true });
  assert.equal(ids(inp), 'greenberet');
  // portrait click on an unselected man replaces the selection
  inp.selectUnit(sniper, { portrait: true });
  assert.equal(ids(inp), 'sniper');
  // the select KEY of an already-selected man keeps him selected and always recentres
  recentres = 0;
  inp.selectUnit(sniper);
  assert.equal(ids(inp), 'sniper');
  assert.equal(recentres, 1, 'key on an already-selected man recentres');
});
