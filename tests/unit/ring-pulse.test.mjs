import * as THREE from 'three';
import { test, assert, near } from './lib.mjs';
import { CHESS_MARKER, CHESS_RING, PULSE_CYCLE, ringAlpha, ringPulse, ringShape } from '../../src/render/ring-pulse.js';
import { MARKER_SCALE, RING_SCALE, Selection } from '../../src/render/selection.js';

/** The 3d_chess formula, verbatim (board_renderer.cpp). */
function chess(t) {
  const phase = (t % 1.2) / 1.2;
  let pulse = 1 - phase;
  pulse = pulse * pulse * (3 - 2 * pulse);
  return { pulse, inner: 0.28 + pulse * 0.10, outer: 0.40 + pulse * 0.08, a: 0.5 + pulse * 0.4, mi: 0.22 + pulse * 0.08, mo: 0.36 + pulse * 0.06, ma: 0.4 + pulse * 0.3 };
}

test('ring pulse: chess 1.2 s cycle values at t = 0, 0.6, 1.2, 1.8', () => {
  assert.equal(PULSE_CYCLE, 1.2);
  const want = { 0: 1, 0.6: 0.5, 1.2: 1, 1.8: 0.5 };
  for (const [t, p] of Object.entries(want)) {
    const c = chess(+t);
    near(ringPulse(+t), p, 1e-9, `pulse(${t})`);
    near(ringPulse(+t), c.pulse, 1e-9, `pulse(${t}) vs chess`);
    const s = ringShape(+t, CHESS_RING, 1);
    near(s.inner, c.inner, 1e-9, 'inner'); near(s.outer, c.outer, 1e-9, 'outer'); near(s.alpha, c.a, 1e-9, 'alpha');
    const m = ringShape(+t, CHESS_MARKER, 1);
    near(m.inner, c.mi, 1e-9, 'marker inner'); near(m.outer, c.mo, 1e-9, 'marker outer'); near(m.alpha, c.ma, 1e-9, 'marker alpha');
  }
  near(ringPulse(0.3), 0.84375, 1e-9, 'eased (smoothstep of 1 − phase)');
  assert.ok(ringPulse(1.1999) < 1e-3, 'contracts to rest just before the snap back');
  // scaled: resting centre line = the old 0.47 m ring; reduced motion = resting shape
  const rest = ringShape(0.6, CHESS_RING, RING_SCALE, true);
  near((rest.inner + rest.outer) / 2, 0.47, 1e-9, 'resting ring centre (m)');
  near(rest.alpha, 0.5, 1e-9, 'resting alpha');
  const mr = ringShape(0, CHESS_MARKER, MARKER_SCALE, true);
  near((mr.inner + mr.outer) / 2, 0.225, 1e-9, 'resting marker centre (m)');
});

test('ring pulse: chess fragment profile (peak 0.8·a on the centre line, soft glow, discard)', () => {
  near(ringAlpha(0.34, 0.28, 0.40, 1), 0.8, 1e-9, 'peak');
  near(ringAlpha(0.40, 0.28, 0.40, 1), 0.35 * Math.exp(-3), 1e-9, 'edge = glow only');
  assert.equal(ringAlpha(0.50, 0.28, 0.40, 1), 0, 'discarded well outside');
  assert.ok(ringAlpha(0.37, 0.28, 0.40, 1) < 0.8 && ringAlpha(0.37, 0.28, 0.40, 1) > 0.35 * Math.exp(-3), 'falls off smoothly');
});

test('ring pulse: Selection rings pulse from each commando\'s own selection time (real clock)', () => {
  const scene = new THREE.Scene();
  const sel = new Selection(scene);
  let now = 100;
  sel.clock = () => now;
  const a = { selected: true, alive: true, x: 0, z: 0 }, b = { selected: false, alive: true, x: 5, z: 0 };
  const opts = { reducedMotion: 'off' };
  const world = { commandos: [a, b], events: { on: () => () => {} }, game: { options: opts } };
  sel.attach(world);
  const uni = (i) => sel.rings[i].material.userData.ring;
  sel.update(0.016);
  near(uni(0).uRingInner.value, 0.38 * RING_SCALE, 1e-9, 'fresh selection: wide');
  near(sel.rings[0].material.opacity, 0.9, 1e-9, 'fresh selection: bright');
  near(sel.rings[0].children[0].material.opacity, 0.9 * 0.55 / 0.95, 1e-9, 'x-ray ghost pulses, dimmer');
  near(sel.rings[0].children[0].material.userData.ring.uRingOuter.value, 0.48 * RING_SCALE, 1e-9, 'ghost radius follows');
  now += 0.6; b.selected = true; // add b: a keeps its phase, b starts fresh
  sel.update(0.6);
  near(sel.rings[0].material.opacity, 0.7, 1e-9, 'a at 0.6 s');
  near(sel.rings[1].material.opacity, 0.9, 1e-9, 'b starts at its own selection');
  now += 5; // paused game: dt 0 but the real clock runs, the pulse keeps animating
  sel.update(0);
  near(sel.rings[0].material.opacity, 0.5 + 0.4 * ringPulse(5.6), 1e-9, 'a keeps pulsing while paused');
  a.selected = false; b.selected = false; sel.update(0);
  a.selected = true; b.selected = true; sel.update(0); // group re-selection: both restart together
  near(sel.rings[0].material.opacity, 0.9, 1e-9, 'group: a restarts');
  near(sel.rings[1].material.opacity, 0.9, 1e-9, 'group: b restarts');
  opts.reducedMotion = 'on';
  now += 0.3; sel.update(0);
  near(uni(0).uRingInner.value, 0.28 * RING_SCALE, 1e-9, 'reduced motion: static resting ring');
  near(sel.rings[0].material.opacity, 0.5, 1e-9, 'reduced motion: resting alpha');
  opts.reducedMotion = 'off';
  sel.marker(1, 1, true);
  const m = sel.markers[0].mesh.material;
  near(m.userData.ring.uRingOuter.value, 0.42 * MARKER_SCALE, 1e-9, 'marker spawns wide (chess move disc)');
  near(m.opacity, 0.7, 1e-9, 'marker spawns bright');
  sel.update(0.3);
  near(m.opacity, 0.4 + 0.3 * ringPulse(0.3), 1e-9, 'marker pulses with its age');
  sel.update(0.45);
  assert.ok(m.opacity < 0.3, `marker fades at the end of its life (${m.opacity})`);
  sel.update(0.2);
  assert.equal(sel.markers.length, 0, 'marker gone after its life');
  sel.dispose();
});
