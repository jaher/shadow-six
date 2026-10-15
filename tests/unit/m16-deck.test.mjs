/**
 * M16's truss bridge is walkable and drivable end to end in the real game (sol/m16). With its deck measured on the
 * visual, the overhead bracing (3.2 m, under the 3.5 m probe) and the deck seams over the piers cut the deck into
 * islands, and libraryDecks stamped everything off the middle island as railing (nav-only blocks): nobody could walk
 * the bridge and the lorry stopped at its end. `deckMeasure: false` keeps the gameplay rect as the deck, at the
 * analytic ramp to `deckTop`, and never asks the visual. GPU side: tests/m16-solution.test.mjs drives across it.
 */
import { test, assert, near } from './lib.mjs';
import { libraryDecks } from '../../src/world/map-library.js';
import { B } from '../../src/world/grid.js';
import { MISSIONS } from '../../src/missions/index.js';

function fakeBuilt(def) {
  return { def, type: def.type, owner: 100000, footprints: [{ shape: 'rect', x: def.x, z: def.z, w: def.w, d: def.d, rot: def.rot ?? 0, block: B.HIGH }],
    library: { ladders: [], roofs: [], climbEdges: [], doors: [], piers: [], bridge: null, scale: [0.58, 0.99, 1], setDoorOpen() {} } };
}

test('m16 bridge: deckMeasure false → an unmeasured analytic deck at deckTop, ramps at the ends, no railing stamps', () => {
  const m16 = MISSIONS.find((m) => m.id === 'm16');
  const def = m16.structures.find((s) => s.id === 'bridge');
  assert.equal(def.deckMeasure, false);
  let asked = 0;
  const [deck] = libraryDecks([fakeBuilt(def)], { measure: () => { asked++; return { heightAt: () => 3.2, parapet: () => true }; } });
  assert.equal(asked, 0, 'the visual is never measured');
  assert.ok(deck && !deck.measured, 'unmeasured: map-builder stamps no railing cells');
  const c = Math.cos(def.rot), s = Math.sin(def.rot), at = (u, v = 0) => deck.heightAt(def.x + u * c - v * s, def.z + u * s + v * c);
  near(at(0), def.deckTop, 1e-6);
  near(at(-30, 3), def.deckTop, 1e-6);
  assert.ok(at(def.w / 2 - 0.2) < 0.15 && at(-def.w / 2 + 0.2) < 0.15, 'ramps down to the ground at both ends');
  assert.ok(at(def.w / 2 - def.deckRamp - 0.5) > def.deckTop - 0.05, 'level again a ramp in');
  // headless (no measure): the same deck
  const [h] = libraryDecks([fakeBuilt(def)]);
  near(h.heightAt(def.x, def.z), def.deckTop, 1e-6);
});

test('a library bridge without the flag is still measured on the visual', () => {
  let asked = 0;
  const def = { id: 'b', type: 'truss_bridge', x: 20, z: 20, w: 30, d: 6, rot: 0 };
  const [deck] = libraryDecks([fakeBuilt(def)], { measure: () => { asked++; return { heightAt: () => 1.1, parapet: () => false }; } });
  assert.equal(asked, 1);
  assert.ok(deck.measured);
  near(deck.heightAt(20, 20), 1.1, 1e-6);
});
