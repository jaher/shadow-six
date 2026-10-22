/**
 * Click feedback (user 2026-10-21): a click order spawns four inward-pointing arrows at its
 * destination - green for a move order, red for a kill order at an enemy, and no disc either way.
 * The colour is classified by the click itself (engine/input.js clickMarkerFor) from the game's
 * own resolution, never guessed: red only when an issued kill ability resolves to a living enemy.
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { EventBus } from '../../src/core/events.js';
import { Input, clickMarkerFor } from '../../src/engine/input.js';
import { Selection, CLICK_LIFE, CLICK_RADIUS, CLICK_ARROWS, CLICK_HEAD_LEN, CLICK_HEAD_HW } from '../../src/render/selection.js';

const enemy = (x, z, alive = true) => ({ kind: 'enemy', x, z, alive, state: 'idle' });
const shotWorld = (enemies) => ({ enemies, interactables: [], vehicles: [] });

test('clickMarkerFor: targeted kill abilities mark a living enemy red', () => {
  const e = enemy(7, 9);
  for (const id of ['knife', 'syringe', 'sniper', 'harpoon', 'rifle']) {
    assert.deepEqual(clickMarkerFor({ id }, e, shotWorld([e])), { kind: 'attack', x: 7, z: 9 }, id);
  }
});

test('clickMarkerFor: no red for dead enemies, non-lethal abilities, or objects', () => {
  const e = enemy(7, 9);
  assert.equal(clickMarkerFor({ id: 'knife' }, enemy(7, 9, false), shotWorld([])), null); // already dead
  for (const id of ['distract', 'handcuff', 'lipstick', 'puppetDistract']) {
    assert.equal(clickMarkerFor({ id }, e, shotWorld([e])), null, id); // enemy target, but not a kill
  }
  const barrel = { kind: 'interactable', interactKind: 'barrel', x: 7, z: 9, exploded: false };
  assert.equal(clickMarkerFor({ id: 'sniper' }, barrel, shotWorld([])), null); // a shot at an object
  assert.equal(clickMarkerFor(null, e, shotWorld([e])), null);
  assert.equal(clickMarkerFor({ id: 'knife' }, null, shotWorld([e])), null);
});

test('clickMarkerFor: point firearms are red only when shotTarget puts an enemy at the point', () => {
  const e = enemy(10.5, 20);
  const w = shotWorld([e]);
  // clicked point within the game's own 1.0 m shot resolution of the enemy: the shot is at him
  assert.deepEqual(clickMarkerFor({ id: 'pistol' }, { x: 10, z: 20 }, w), { kind: 'attack', x: 10.5, z: 20 });
  assert.deepEqual(clickMarkerFor({ id: 'beretta' }, { x: 10, z: 20 }, w), { kind: 'attack', x: 10.5, z: 20 });
  // open ground: the shot resolves to the point itself, so no marker
  assert.equal(clickMarkerFor({ id: 'pistol' }, { x: 30, z: 40 }, w), null);
  assert.equal(clickMarkerFor({ id: 'smg' }, { x: 30, z: 40 }, w), null);
});

/** An Input with the world/game/targeting stubbed so _tryIssueTargeted runs the real issue path. */
function fakeInput(def, target, world) {
  const bus = new EventBus();
  const markers = [];
  bus.on('ui:move-marker', (p) => markers.push(p));
  const orders = [];
  const commando = { issue: (o) => { orders.push(o); return true; } };
  const inp = Object.create(Input.prototype);
  const w = world || { enemies: [], interactables: [], vehicles: [] };
  w.events = bus; // Input.world is a getter onto game.world
  inp.game = { world: w, enqueue: (fn) => fn() };
  inp.targeting = { def, abilityId: def.id, commando, commandos: [commando] };
  inp.resolveTarget = () => target;
  inp.cancelTargeting = () => {};
  return { inp, markers, orders };
}

test('input: an issued knife order emits the red marker at the enemy; a distract order emits none', () => {
  const e = enemy(7, 9);
  const knife = { id: 'knife', targeting: 'enemy', cursor: 'knife', canUse: () => true };
  const a = fakeInput(knife, e);
  assert.equal(a.inp._tryIssueTargeted(0, 0, false), true);
  assert.equal(a.orders.length, 1);
  assert.deepEqual(a.markers, [{ kind: 'attack', x: 7, z: 9 }]);

  const distract = { id: 'distract', targeting: 'enemy', cursor: 'target', canUse: () => true };
  const b = fakeInput(distract, e);
  assert.equal(b.inp._tryIssueTargeted(0, 0, false), true);
  assert.equal(b.orders.length, 1);
  assert.deepEqual(b.markers, []);
});

test('input: a refused ability (canUse fails) emits no marker', () => {
  const e = enemy(7, 9);
  const knife = { id: 'knife', targeting: 'enemy', canUse: () => 'Too far.' };
  const a = fakeInput(knife, e);
  assert.equal(a.inp._tryIssueTargeted(0, 0, false), false);
  assert.deepEqual(a.markers, []);
});

/** A Selection bound to a flat fake world (no renderer; geometry is plain data). */
function fakeSelection() {
  const sel = new Selection(new THREE.Scene());
  const bus = new EventBus();
  const world = { events: bus, commandos: [], enemies: [], groundY: () => 0, grid: null, game: { options: {} } };
  sel.attach(world);
  return { sel, bus };
}

const VERTS = 7; // vertices per arrow (tip, arrowhead base pair, shaft quad)
/** An effect's vertices grouped per arrow, in build order (tip first). */
const arrowsOf = (e) => {
  const pos = e.mesh.geometry.attributes.position, out = [];
  for (let i = 0; i < CLICK_ARROWS; i++) {
    const vs = [];
    for (let v = 0; v < VERTS; v++) vs.push({ x: pos.getX(i * VERTS + v), z: pos.getZ(i * VERTS + v) });
    out.push(vs);
  }
  return out;
};
const distC = (e, p) => Math.hypot(p.x - e.x, p.z - e.z);

test('selection: move and attack markers spawn the arrows only - no disc either way', () => {
  const { sel, bus } = fakeSelection();
  bus.emit('ui:move-marker', { x: 5, z: 6, kind: 'move' });
  assert.equal(sel.markers.length, 0); // user 2026-10-21: no circle
  assert.equal(sel.clickEffects.length, 1);
  assert.equal(sel.clickEffects[0].kind, 'move');
  bus.emit('ui:move-marker', { x: 7, z: 9, kind: 'attack' });
  assert.equal(sel.markers.length, 0);
  assert.equal(sel.clickEffects.length, 2);
  assert.equal(sel.clickEffects[1].kind, 'attack');
  sel.dispose();
});

test('selection: four arrows point inward, converge over the life, fade, and are gone by CLICK_LIFE', () => {
  const { sel } = fakeSelection();
  const e = sel.clickEffect(5, 6, 'move');
  const arrows = arrowsOf(e);
  assert.equal(arrows.length, CLICK_ARROWS);
  assert.equal(e.mesh.geometry.attributes.position.count, CLICK_ARROWS * VERTS);
  const angles = [];
  for (const a of arrows) {
    // the tip is the arrow's innermost vertex; every other vertex sits farther from the centre
    for (let v = 1; v < a.length; v++) assert.ok(distC(e, a[v]) > distC(e, a[0]), 'tip is innermost');
    // the arrowhead base is CLICK_HEAD_LEN behind the tip, flared to CLICK_HEAD_HW
    assert.ok(Math.abs(distC(e, a[1]) - Math.hypot(CLICK_RADIUS + CLICK_HEAD_LEN, CLICK_HEAD_HW)) < 1e-6, 'head base');
    // pointing inward: the six rear vertices average out to a point on the tip's own ray, beyond the tip
    const cx = a.slice(1).reduce((s, p) => s + p.x, 0) / 6 - e.x, cz = a.slice(1).reduce((s, p) => s + p.z, 0) / 6 - e.z;
    const tx = a[0].x - e.x, tz = a[0].z - e.z;
    assert.ok((cx * tx + cz * tz) / (Math.hypot(cx, cz) * Math.hypot(tx, tz)) > 0.99, 'rear centroid on the tip ray');
    assert.ok(Math.hypot(cx, cz) > Math.hypot(tx, tz), 'body behind the tip');
    angles.push(Math.atan2(tz, tx));
  }
  angles.sort((m, n) => m - n);
  for (let i = 1; i < angles.length; i++) assert.ok(angles[i] - angles[i - 1] > 1.0, 'arrows spread around the point');
  const meanTip = (list) => list.reduce((s, a) => s + distC(e, a[0]), 0) / list.length;
  const t0 = meanTip(arrows);
  assert.ok(Math.abs(t0 - CLICK_RADIUS) < 1e-6, 'tips spawn at CLICK_RADIUS: ' + t0);
  sel.update(0.3); // ~40% through the life: well into the converge
  const t1 = meanTip(arrowsOf(e));
  assert.ok(t1 < t0 - 0.15, 'converged ' + t0.toFixed(2) + ' -> ' + t1.toFixed(2));
  sel.update(0.4); // t = 0.7 s: inside the fade window
  assert.ok(e.mat.opacity < 0.5, 'fading, opacity ' + e.mat.opacity);
  assert.ok(e.t < CLICK_LIFE + 0.1);
  sel.update(0.1); // t = 0.8 s >= CLICK_LIFE (0.75)
  assert.equal(sel.clickEffects.length, 0);
  sel.dispose();
});
