/**
 * The BCD ground overlay's decals (render/bcd-overlay.js: the puppet's range disc and ring, the knock-out arc, the
 * set-piece timers) are made at load and drawn by the load's program warm-up frame (`userData.warmShow`,
 * Game._warmFrame), not first on the first knock-out of play (e02's walkthrough linked two programs then: a
 * double-sided decal, one per side's pass). They are flat ground decals drawn in ONE pass (forceSinglePass, as the
 * selection and noise rings): three's back / front pass pair for a transparent double-sided material is two programs
 * of its own (LIGHTS OUT e01's walkthrough at t≈129: video-perf "programs compiled during play 2"); one pass uses the
 * same program as the noise rings (same material parameters).
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { BcdOverlay } from '../../src/render/bcd-overlay.js';
import { Selection } from '../../src/render/selection.js';
import { NoiseRings } from '../../src/render/noise-rings.js';
import { CONFIG } from '../../src/config.js';

/** The material fields three's program key reads for a MeshBasicMaterial without maps. */
const programFields = (m) => ({ type: m.type, transparent: m.transparent, side: m.side, fog: m.fog, forceSinglePass: m.forceSinglePass,
  toneMapped: m.toneMapped, vertexColors: m.vertexColors, map: m.map, alphaTest: m.alphaTest, alphaHash: m.alphaHash, premultipliedAlpha: m.premultipliedAlpha,
  dithering: m.dithering, onBeforeCompile: String(m.customProgramCacheKey()) });

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

test('BCD overlay: the prewarmed decals are single-pass, the noise rings\' program', () => {
  const group = new THREE.Group();
  const ov = new BcdOverlay(group, () => null);
  ov.prewarm();
  const ring = new NoiseRings(new THREE.Group())._make().mesh;
  for (const m of group.children) {
    assert.equal(m.material.forceSinglePass, true, 'one pass: no back / front program pair');
    assert.deepEqual(programFields(m.material), programFields(ring.material), 'the same program as the (prewarmed) noise rings');
  }
});

test('BCD overlay: the first stunned man reuses the prewarmed arc (no new mesh), and every overlay decal is single-pass', () => {
  const group = new THREE.Group();
  const ov = new BcdOverlay(group, () => null);
  ov.prewarm();
  const n0 = group.children.length;
  const arc = ov.arcs[0];
  const e = { alive: true, ko: 'stunned', state: 'idle', x: 4, z: 6, y: 0, koT: CONFIG.bcd.koDuration / 2, object3d: null };
  const world = { commandos: [], enemies: [e], groundY: () => 0 };
  ov.update(world);
  assert.equal(group.children.length, n0, 'no new mesh');
  assert.equal(ov.arcs[0], arc, 'the same arc');
  assert.equal(arc.visible, true, 'shown under him');
  assert.ok(Math.abs(arc.position.x - 4) < 1e-9 && Math.abs(arc.position.z - 6) < 1e-9, 'at his feet');
  // a puppet controller's disc + ring and a set-piece timer: all single-pass too
  const pup = { x: 2, z: 2, y: 0, object3d: null };
  const c = { alive: true, x: 0, z: 0, y: 0, object3d: null, puppet: null };
  pup.puppetOf = c; c.puppet = { ...pup, puppetOf: c };
  const w2 = { commandos: [c], enemies: [e], groundY: () => 0, _bcdTimers: new Map([['p', { x: 9, z: 9, k: 0.5 }]]) };
  ov.update(w2);
  assert.ok(group.children.length >= 4, `disc, ring, arc, timer (${group.children.length})`);
  for (const m of group.children) assert.equal(m.material.forceSinglePass, true, 'single-pass');
  ov.update(null);
  assert.ok(group.children.every((m) => !m.visible), 'no BCD world: all hidden');
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
