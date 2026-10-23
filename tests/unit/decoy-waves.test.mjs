/**
 * Decoy sound waves (user 2026-10-22: "When decoy beeps can we have some transparent air blast animation around it",
 * "Like sound wave"): render/decoy-waves.js. Every decoy beep (the 'noise' event of kind 'decoy', the one the beep sound
 * plays from) sends three thin translucent rings over the ground; the leader runs out to the hearing radius, the whole
 * pulse is gone before the next beep, one draw per decoy, no sim change. Pure shape maths + the grid draped on the
 * ground + the pool driven by a real headless sim (the GPU side: tests/decoy-wave.test.mjs).
 */
import * as THREE from 'three';
import { test, assert, near } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { CONFIG } from '../../src/config.js';
import {
  DecoyWaves, WAVE_RINGS, WAVE_TRAVEL, WAVE_LIFE, WAVE_R0, WAVE_LIFT, ringFront, ringAlpha, waveShape, waveGeometry, fillWaveGeometry,
} from '../../src/render/decoy-waves.js';

const R = CONFIG.stealth.noise.decoy.radius;
const PULSE = CONFIG.stealth.noise.decoy.pulse;

test('decoy waves: three rings; the leader runs out to the hearing radius, the others fall short; all gone before the next beep', () => {
  assert.equal(WAVE_RINGS.length, 3);
  assert.equal(R, 13.5);
  assert.ok(WAVE_LIFE < PULSE, `the pulse (${WAVE_LIFE} s) ends before the next beep (${PULSE} s)`);
  // not drawn before the pulse / after it
  assert.equal(ringFront(0, 0, R), -1);
  assert.equal(ringFront(WAVE_LIFE + 0.01, 2, R), -1);
  assert.equal(waveShape(WAVE_LIFE + 0.01, R).hi, 0, 'nothing left to draw');
  // each ring starts at the radio's case and runs out to its own reach (the leader: the full hearing radius)
  for (let k = 0; k < 3; k++) {
    const t0 = WAVE_RINGS[k].delay;
    near(ringFront(t0 + 1e-3, k, R), WAVE_R0, 0.05, `ring ${k} starts at the case`);
    near(ringFront(t0 + WAVE_TRAVEL - 1e-3, k, R), R * WAVE_RINGS[k].reach, 0.05, `ring ${k} reach`);
    let prev = -1;
    for (let t = t0 + 0.01; t < t0 + WAVE_TRAVEL; t += 0.02) {
      const r = ringFront(t, k, R);
      assert.ok(r > prev, `ring ${k} only grows (${t})`);
      prev = r;
    }
  }
  assert.ok(WAVE_RINGS[0].reach === 1 && WAVE_RINGS[1].reach < 1 && WAVE_RINGS[2].reach < WAVE_RINGS[1].reach);
  // the rings stay apart (read as separate rings) while they run
  for (let t = 0.3; t < 1.0; t += 0.05) {
    const s = waveShape(t, R);
    assert.ok(s.rings[0].r - s.rings[1].r > 2 && s.rings[1].r - s.rings[2].r > 2, `rings apart at ${t}: ${s.rings.map((q) => q.r.toFixed(1))}`);
  }
  // the leader is still clearly drawn when it is within a metre of the radius (the player reads the reach), gone at the end
  const near1 = (() => { for (let t = 0; t < WAVE_TRAVEL; t += 0.005) if (ringFront(t, 0, R) >= R - 1) return t; })();
  assert.ok(ringAlpha(near1, 0) > 0.5, `leader opacity ${ringAlpha(near1, 0).toFixed(2)} within 1 m of the radius`);
  assert.equal(ringAlpha(WAVE_TRAVEL, 0), 0);
  // the draw band holds every ring (and no more than the wave's own span)
  for (let t = 0.02; t < WAVE_LIFE; t += 0.03) {
    const s = waveShape(t, R);
    for (const q of s.rings) if (q.r >= 0) assert.ok(q.r >= s.lo && q.r <= s.hi, `band holds ${q.r} at ${t}`);
    assert.ok(s.hi <= R + 1.5, 'the band ends just past the radius');
  }
  // a larger or smaller radius scales it (a mission's own decoy radius)
  near(ringFront(WAVE_TRAVEL - 1e-3, 0, 9), 9, 0.05);
});

test('decoy waves: the grid is draped on the terrain (+ lift), and fades out on another level or a cliff face', () => {
  const geo = waveGeometry();
  const pos = geo.attributes.position, vis = geo.attributes.aVis;
  assert.equal(pos.count, vis.count);
  assert.ok(geo.index.count % 6 === 0 && geo.index.count > 0);
  for (let i = 0; i < geo.index.count; i++) assert.ok(geo.index.array[i] < pos.count);
  // flat ground: every vertex at the lift, fully visible
  let h0 = fillWaveGeometry(geo, 50, 50, R, () => 0.2, () => 0);
  near(h0, 0.2);
  for (let v = 0; v < pos.count; v++) { near(pos.getY(v), WAVE_LIFT, 1e-6); assert.equal(vis.getX(v), 1); }
  // a gentle slope (20 %): the ring follows it, still visible; heights relative to the surface under the decoy
  h0 = fillWaveGeometry(geo, 50, 50, R, (x) => 0.2 * x, () => 0);
  near(h0, 10);
  let maxErr = 0, minVis = 1;
  for (let v = 0; v < pos.count; v++) {
    const x = 50 + pos.getX(v) * R;
    maxErr = Math.max(maxErr, Math.abs(pos.getY(v) + h0 - (0.2 * x + WAVE_LIFT)));
    minVis = Math.min(minVis, vis.getX(v));
  }
  assert.ok(maxErr < 1e-4, `follows the slope (${maxErr})`);
  assert.equal(minVis, 1, 'a 20 % slope is no cliff');
  // a raised level (a roof / deck 3 m up, east of x = 55): hidden there, shown on the decoy's own level
  fillWaveGeometry(geo, 50, 50, R, () => 0, (x) => (x > 55 ? 3 : 0));
  let seenOn = 0, seenOff = 0;
  for (let v = 0; v < pos.count; v++) {
    const x = 50 + pos.getX(v) * R;
    if (x > 56) { assert.equal(vis.getX(v), 0, 'hidden on the other level'); seenOff++; } else if (x < 54) { assert.equal(vis.getX(v), 1); seenOn++; }
  }
  assert.ok(seenOn > 100 && seenOff > 100);
  // a cliff face in the terrain (a 4 m step at x = 58): hidden on and around the face
  fillWaveGeometry(geo, 50, 50, R, (x) => (x > 58 ? 4 : 0), () => 0);
  let cliffHidden = 0;
  for (let v = 0; v < pos.count; v++) {
    const x = 50 + pos.getX(v) * R;
    if (Math.abs(x - 58) < 0.3 && vis.getX(v) < 0.5) cliffHidden++;
    assert.ok(Number.isFinite(pos.getY(v)) && Number.isFinite(vis.getX(v)));
  }
  assert.ok(cliffHidden > 10, `the cliff's face is hidden (${cliffHidden})`);
  geo.dispose();
});

/** A world with a Green Beret who plants a decoy and switches it on; returns the pieces. */
function decoyWorld() {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }] });
  const gb = s.cmd('greenberet');
  gb.issue({ type: 'ability', id: 'decoyDrop', target: gb });
  s.run(0.9);
  gb.moveTo(20, 10); s.run(3);
  const decoy = s.world.interactables.find((i) => i.interactKind === 'decoy');
  const group = new THREE.Group();
  const waves = new DecoyWaves(group);
  s.world.game = { options: {} };
  waves.attach(s.world);
  return { s, gb, decoy, group, waves };
}
const toggle = (s, gb) => gb.issue({ type: 'ability', id: 'decoyToggle', target: gb });
const pulseTimes = (s) => s.events.filter((e) => e.name === 'noise' && e.p.kind === 'decoy').map((e) => e.t);

test('decoy waves: a beep starts a wave at once, it grows to the hearing radius and fades, gone before the next beep; one wave per decoy', () => {
  const { s, gb, decoy, group, waves } = decoyWorld();
  assert.ok(decoy && !decoy.on);
  for (let i = 0; i < 20; i++) { s.run(0.1); waves.update(0.1, 1); }
  assert.equal(waves.active, 0, 'a decoy that is off draws nothing');
  assert.equal(waves.slots.length, 0, 'and has made no mesh');
  toggle(s, gb);
  s.run(0.05);
  waves.update(0.05, 1);
  assert.equal(waves.active, 1, 'the first beep draws a wave at once');
  assert.equal(group.children.length, 1);
  const m = waves.slots[0].mesh, u = m.material.uniforms;
  const t0 = pulseTimes(s)[0];
  assert.ok(t0 != null && s.world.time - t0 < 0.1, 'started with the beep');
  near(u.uR.value, 13.5);
  near(m.scale.x, 13.5); near(m.position.x, decoy.x, 1e-6); near(m.position.z, decoy.z, 1e-6);
  assert.ok(m.geometry.attributes.position.array.every(Number.isFinite));
  // it grows, then fades, and is gone before the next beep (every 1.5 s)
  let last = -1, maxHi = 0, goneAt = null;
  for (let i = 0; i < 27; i++) {
    s.run(0.05); waves.update(0.05, 1);
    const age = s.world.time - t0;
    if (age < 0.9) { assert.ok(u.uBand.value.y > last - 1e-6, `band grows (${age})`); last = u.uBand.value.y; }
    maxHi = Math.max(maxHi, u.uBand.value.y);
    if (goneAt == null && waves.active === 0) goneAt = age;
  }
  assert.ok(maxHi > 13 && maxHi < 15, `reaches the hearing radius (band to ${maxHi.toFixed(1)} m)`);
  assert.ok(goneAt != null && goneAt <= WAVE_LIFE + 0.1 && goneAt < PULSE, `gone after ${goneAt}`);
  // the next beep (1.5 s after the first) starts a new wave in the same slot
  const beeps = pulseTimes(s);
  for (let i = 0; i < 60 && pulseTimes(s).length < 2; i++) { s.run(0.05); waves.update(0.05, 1); }
  assert.equal(pulseTimes(s).length, 2);
  near(pulseTimes(s)[1] - beeps[0], PULSE, 0.06);
  waves.update(0.01, 1);
  assert.equal(waves.active, 1, 'the second beep draws again');
  assert.equal(waves.slots.length, 1, 'in the same slot (one draw per decoy)');
  // switched off: the running wave finishes, no new one
  toggle(s, gb);
  for (let i = 0; i < 80; i++) { s.run(0.05); waves.update(0.05, 1); }
  assert.equal(waves.active, 0);
  assert.equal(pulseTimes(s).length, 2, 'off: silent');
  waves.dispose();
  assert.equal(group.children.length, 0);
});

test('decoy waves: the clock is the interpolated sim time (a pause freezes it); reduced motion, other noises and a lost world draw nothing', () => {
  const { s, gb, group, waves } = decoyWorld();
  toggle(s, gb);
  s.run(0.3); // (the first beep is 0.3 s old)
  const t0 = pulseTimes(s)[0];
  waves.update(1 / 60, 1);
  const u = waves.slots[0].mesh.material.uniforms;
  near(u.uAge.value.x, s.world.time - t0, 1e-9);
  const a = u.uAge.value.x;
  waves.update(5, 1); waves.update(5, 1); // real time passing while the sim is paused
  near(u.uAge.value.x, a, 1e-9, 'frozen with the sim');
  waves.update(1 / 60, 0.5); // half a tick short of the latest tick: the interpolated time
  near(u.uAge.value.x, a - 0.5 / 60, 1e-9);
  assert.equal(u.uAge.value.y, -1, 'no earlier pulse');
  // other noises are none of its business
  s.world.emitNoise(5, 5, 13.5, 'footsteps', null, 1);
  s.world.emitNoise(5, 5, 20, 'explosion', null, 3);
  assert.equal(waves.slots.length, 1);
  // reduced motion: nothing (and what was running stops)
  s.world.game.options.reducedMotion = true;
  waves.update(1 / 60, 1);
  assert.equal(waves.active, 0);
  s.world.emitNoise(10, 10, 13.5, 'decoy', null);
  s.run(0.05); waves.update(1 / 60, 1);
  assert.equal(waves.active, 0, 'no wave in reduced motion');
  s.world.game.options.reducedMotion = false;
  // a new mission: detach hides everything and drops the decoy
  s.world.emitNoise(10, 10, 13.5, 'decoy', null);
  s.run(0.05); waves.update(1 / 60, 1);
  assert.equal(waves.active, 1);
  waves.detach();
  assert.equal(waves.active, 0);
  waves.update(1, 1); // (no world: harmless)
  waves.dispose();
  assert.equal(group.children.length, 0);
});

test('decoy waves: each decoy has its own wave; the pool is bounded; a picked-up decoy lets go of its slot; a beep inside a running wave overlaps cleanly', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }] });
  s.world.game = { options: {} };
  const group = new THREE.Group(), waves = new DecoyWaves(group);
  waves.attach(s.world);
  const srcs = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `d${i}`, x: 10 + i * 8, z: 30, removed: false, alive: true }));
  for (const d of srcs.slice(0, 3)) s.world.emitNoise(d.x, d.z, 13.5, 'decoy', d);
  s.run(0.05); waves.update(0.01, 1);
  assert.equal(waves.active, 3, 'one wave (one draw) per decoy');
  assert.equal(new Set(waves.slots.map((q) => q.mesh)).size, 3);
  for (const d of srcs.slice(3)) s.world.emitNoise(d.x, d.z, 13.5, 'decoy', d);
  s.run(0.05); waves.update(0.01, 1);
  assert.ok(waves.slots.length <= 4, `pool bounded (${waves.slots.length})`);
  assert.ok(waves.active <= 4);
  waves.detach();
  waves.attach(s.world);
  // a decoy picked up mid-wave: the wave finishes, then its slot is free for the next decoy
  const a = { id: 'a', x: 30, z: 30, removed: false, alive: true };
  s.world.emitNoise(a.x, a.z, 13.5, 'decoy', a);
  s.run(0.05); waves.update(0.01, 1);
  a.removed = true;
  s.run(2); waves.update(0.01, 1);
  assert.equal(waves.active, 0);
  assert.equal(waves.slots[0].src, null, 'the slot let go of the removed decoy');
  const b = { id: 'b', x: 40, z: 30, removed: false, alive: true };
  s.world.emitNoise(b.x, b.z, 13.5, 'decoy', b);
  s.run(0.05); waves.update(0.01, 1);
  assert.equal(waves.slots.length, 4, 'no new mesh: the freed slot is reused');
  assert.equal(waves.active, 1);
  near(waves.slots[0].mesh.position.x, 40, 1e-9);
  // a beep that comes while the last pulse is still running (a short pulse period): both are drawn
  s.run(0.5);
  s.world.emitNoise(b.x, b.z, 13.5, 'decoy', b);
  s.run(0.05); waves.update(0.01, 1);
  const u = waves.slots[0].mesh.material.uniforms;
  assert.ok(u.uAge.value.x >= 0 && u.uAge.value.y > u.uAge.value.x, `two generations: ${u.uAge.value.x.toFixed(2)} and ${u.uAge.value.y.toFixed(2)}`);
  assert.equal(waves.active, 1);
  for (let i = 0; i < 160; i++) { s.run(0.05); waves.update(0.05, 1); }
  assert.equal(waves.active, 0, 'and both end');
  waves.dispose();
});
