/**
 * The BCD ground overlay's decals (render/bcd-overlay.js: the puppet's range disc and ring, the knock-out arc) are
 * made at load and drawn by the load's program warm-up frame (`userData.warmShow`, Game._warmFrame), not first on
 * the first knock-out of play (e02's walkthrough linked two programs then: a double-sided decal, one per side's pass).
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { BcdOverlay } from '../../src/render/bcd-overlay.js';
import { Selection } from '../../src/render/selection.js';

test('BcdOverlay.prewarm: its first disc, ring and arc made hidden, drawn by the warm-up frame, and reused in play', () => {
  const group = new THREE.Group();
  const o = new BcdOverlay(group);
  o.prewarm();
  assert.equal(o.discs.length, 1);
  assert.equal(o.rings.length, 1);
  assert.equal(o.arcs.length, 1);
  for (const m of [o.discs[0], o.rings[0], o.arcs[0]]) {
    assert.equal(m.parent, group, 'in the overlay\'s group (the decal scene)');
    assert.equal(m.visible, false, 'hidden until used');
    assert.equal(m.userData.warmShow, true, 'drawn by the load\'s warm-up frame');
  }
  const arc = o.arcs[0];
  o.prewarm();
  assert.equal(o.arcs.length, 1, 'idempotent');
  // the first stunned man's arc is that same decal
  const e = { alive: true, ko: 'stunned', koT: 10, x: 3, z: 4, y: 0 };
  o.update({ commandos: [], enemies: [e] });
  assert.equal(o.arcs[0], arc);
  assert.equal(arc.visible, true);
  o.update({ commandos: [], enemies: [] });
  assert.equal(arc.visible, false);
  o.dispose();
});

test('Selection.prewarmBcd: only a BCD world (rules.puppet) makes the overlay', () => {
  const scene = new THREE.Scene();
  const s = new Selection(scene);
  s.prewarmBcd({ rules: {} });
  assert.equal(s.bcd ?? null, null, 'not in a BEL world');
  s.prewarmBcd({ rules: { puppet: true } });
  assert.ok(s.bcd && s.bcd.arcs.length === 1 && s.bcd.arcs[0].userData.warmShow, 'a BCD world: the overlay and its first arc');
  s.dispose();
});
