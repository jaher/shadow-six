// The Marine in the water (art/swim-pose.js, user 2026-10-11): the water column under a man, standing on the bed
// instead of the surface, the swim layer's base clip, the diver's bubbles (art/water.js WakeTracker).
import { test, assert, near } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { waterColumn, wadeOffset, shownSubmerged } from '../../src/art/swim-pose.js';
import { mapAnim } from '../../src/art/unit-anim-map.js';
import { WakeTracker } from '../../src/art/water.js';

/** A 10 × 10 m grid: x < 4 dry ground, 4..6 shallows, x ≥ 6 deep water; a deck over the deep water at z ≥ 8. */
function fakeWorld() {
  const cols = 20, rows = 20, cell = 0.5, terrain = new Uint8Array(cols * rows), bridge = new Uint8Array(cols * rows), elev = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = (i + 0.5) * cell, z = (j + 0.5) * cell, k = j * cols + i;
    terrain[k] = x < 4 ? 0 : x < 6 ? 6 : 5;
    if (x >= 6 && z >= 8) bridge[k] = 1;
  }
  const bed = (x) => (x < 4 ? 0 : x < 6 ? -0.35 : -1.2);
  return {
    grid: { cols, rows, cell, terrain, bridge, elev },
    terrain: { heightAt: (x) => bed(x), surfaceAt: (x) => bed(x) },
    water: { level: -0.1, sample: (x, z) => (x >= 4 ? { level: -0.1, depth: -0.1 - bed(x) } : null) },
    groundY: (x, z) => (x >= 4 && !(x >= 6 && z >= 8) ? 0 : x >= 6 && z >= 8 ? 0.4 : bed(x)),
  };
}

test('waterColumn: level and bed under a man on a water / shallow cell; null on land and under a deck', () => {
  const w = fakeWorld();
  assert.equal(waterColumn(w, 2, 2), null, 'dry ground');
  const s = waterColumn(w, 5, 2), d = waterColumn(w, 8, 2);
  assert.ok(s && !s.deep && near(s.level, -0.1) === undefined && near(s.bed, -0.35) === undefined);
  assert.ok(d && d.deep && near(d.bed, -1.2) === undefined);
  assert.equal(waterColumn(w, 8, 9), null, 'on a deck over the water');
  assert.equal(waterColumn({ grid: w.grid }, 5, 2), null, 'no drawn terrain (placeholder): nothing to stand on');
});

test('wadeOffset: wading / swimming men are drawn standing on the bed, not on the surface; not aboard, dead, on a deck', () => {
  const w = fakeWorld();
  const mk = (x, z, u = {}) => {
    const root = { position: { x, y: w.groundY(x, z), z } };
    const unit = { world: w, alive: true, x, z, y: 0, state: 'active', ...u };
    return { model: { root }, unit, root };
  };
  let m = mk(5, 2);
  near(wadeOffset(m.model, m.unit), -0.35); near(m.root.position.y, -0.35, 1e-9, 'soles on the 25 cm shallows bed (surface -0.1)');
  m = mk(8, 2); wadeOffset(m.model, m.unit); near(m.root.position.y, -1.2, 1e-9, 'deep water: the bed');
  m = mk(2, 2); near(wadeOffset(m.model, m.unit), 0); near(m.root.position.y, 0, 1e-9, 'dry land: unchanged');
  m = mk(8, 9); wadeOffset(m.model, m.unit); near(m.root.position.y, 0.4, 1e-9, 'on the deck: unchanged');
  for (const u of [{ vehicle: {} }, { state: 'inVehicle' }, { alive: false }, { state: 'carried' }, { _ladder: {} }]) {
    m = mk(5, 2, u); wadeOffset(m.model, m.unit); near(m.root.position.y, 0, 1e-9, JSON.stringify(Object.keys(u)));
  }
});

test('swim layer base clip: the Marine\'s swim / dive play the upright treading loop under the procedural pose', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../assets/characters/manifest.json', import.meta.url)));
  assert.ok(manifest.animations.base_anims.clips.includes('swim_idle'));
  assert.deepEqual(mapAnim('swim', { faction: 'player', role: 'diver', waterLayer: true }), ['swim_idle', 'swim']);
  assert.deepEqual(mapAnim('dive', { faction: 'player', role: 'diver', waterLayer: true }), ['swim_idle', 'dive']);
  assert.deepEqual(mapAnim('swim', { faction: 'player', role: 'diver' }), ['swim', 'swim_idle'], 'without the layer: as before');
  assert.deepEqual(mapAnim('shoot', { faction: 'player', role: 'diver', waterLayer: true }), ['shoot'], 'actions: their own clips');
  assert.equal(shownSubmerged({ _swim: { submerged: true } }), true);
  assert.equal(shownSubmerged({}), false);
});

test('WakeTracker: a diver breathes out bubbles over his head now and then (moving or not); a swimmer at the surface does not', () => {
  const run = (stance, moving) => {
    const dots = [];
    const e = { x: 10, z: 10, heading: 0, stance, underwater: stance === 'dive', alive: true };
    const sink = { disturb: (x, z, s, r, foam) => { if (r < 0.25 && foam >= 0.4) dots.push([x - e.x, z - e.z]); } };
    const tr = new WakeTracker(sink, () => true);
    for (let i = 0; i < 300; i++) { if (moving) e.x += 1.8 / 60; tr.update([e], 1 / 60); }
    return { dots, e };
  };
  for (const moving of [false, true]) {
    const { dots, e } = run('dive', moving);
    assert.ok(dots.length >= 6 && dots.length <= 30, `diving (${moving ? 'swimming' : 'hovering'}): ${dots.length} bubble boils in 5 s`);
    assert.ok(dots.every(([dx, dz]) => dx > 0.3 && dx < 1.1 && Math.abs(dz) < 0.4), 'over his head (0.7 m ahead of his hips)');
  }
  assert.equal(run('swim', true).dots.length, 0, 'no bubbles at the surface');
});
