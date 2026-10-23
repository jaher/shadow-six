/**
 * Decoy sound waves (user 2026-10-22: "When decoy beeps can we have some transparent air blast animation around it",
 * "Like sound wave"; then "For decoy I would rather have the air bend / refract with a spherical sound wave around the
 * decoy"): render/decoy-waves.js (the waves' state and clock) and render/decoy-refraction.js (the post pass that bends the
 * picture behind each shell). Every decoy beep (the 'noise' event of kind 'decoy', the one the beep sound plays from) sends
 * three spherical shells out; the leader runs out to the hearing radius, the whole pulse is gone before the next beep, one
 * draw per decoy, no sim change. Pure shape maths + the pool driven by a real headless sim + the pass against a mock
 * renderer (the GPU side: tests/decoy-wave.test.mjs).
 */
import * as THREE from 'three';
import { test, assert, near } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { CONFIG } from '../../src/config.js';
import {
  DecoyWaves, WAVE_RINGS, WAVE_TRAVEL, WAVE_LIFE, WAVE_R0, WAVE_BEND, WAVE_CENTRE_H, ringFront, ringAlpha, ringSigma, waveShape, packShells,
} from '../../src/render/decoy-waves.js';
import { RefractionPass, discRect } from '../../src/render/decoy-refraction.js';

const R = CONFIG.stealth.noise.decoy.radius;
const PULSE = CONFIG.stealth.noise.decoy.pulse;

test('decoy waves: three shells; the leader runs out to the hearing radius, the others fall short; all gone before the next beep', () => {
  assert.equal(WAVE_RINGS.length, 3);
  assert.equal(R, 13.5);
  assert.ok(WAVE_LIFE < PULSE, `the pulse (${WAVE_LIFE} s) ends before the next beep (${PULSE} s)`);
  assert.equal(ringFront(0, 0, R), -1);
  assert.equal(ringFront(WAVE_LIFE + 0.01, 2, R), -1);
  assert.equal(waveShape(WAVE_LIFE + 0.01, R).hi, 0, 'nothing left to draw');
  // each shell starts at the radio's case and runs out to its own reach (the leader: the full hearing radius)
  for (let k = 0; k < 3; k++) {
    const t0 = WAVE_RINGS[k].delay;
    near(ringFront(t0 + 1e-3, k, R), WAVE_R0, 0.05, `shell ${k} starts at the case`);
    near(ringFront(t0 + WAVE_TRAVEL - 1e-3, k, R), R * WAVE_RINGS[k].reach, 0.05, `shell ${k} reach`);
    let prev = -1;
    for (let t = t0 + 0.01; t < t0 + WAVE_TRAVEL; t += 0.02) {
      const r = ringFront(t, k, R);
      assert.ok(r > prev, `shell ${k} only grows (${t})`);
      prev = r;
    }
  }
  assert.ok(WAVE_RINGS[0].reach === 1 && WAVE_RINGS[1].reach < 1 && WAVE_RINGS[2].reach < WAVE_RINGS[1].reach);
  // the shells stay apart (read as separate fronts) while they run
  for (let t = 0.3; t < 1.0; t += 0.05) {
    const s = waveShape(t, R);
    assert.ok(s.rings[0].r - s.rings[1].r > 2 && s.rings[1].r - s.rings[2].r > 2, `shells apart at ${t}: ${s.rings.map((q) => q.r.toFixed(1))}`);
  }
  // the leader still bends the air clearly when it is within a metre of the radius (the player reads the reach), gone at the end
  const near1 = (() => { for (let t = 0; t < WAVE_TRAVEL; t += 0.005) if (ringFront(t, 0, R) >= R - 1) return t; })();
  assert.ok(ringAlpha(near1, 0) > 0.5, `leader strength ${ringAlpha(near1, 0).toFixed(2)} within 1 m of the radius`);
  assert.equal(ringAlpha(WAVE_TRAVEL, 0), 0);
  // the shell softens as it spreads
  assert.ok(ringSigma(WAVE_TRAVEL - 1e-3, 0) > ringSigma(0.05, 0));
  // the draw band holds every shell (and ends just past the radius)
  for (let t = 0.02; t < WAVE_LIFE; t += 0.03) {
    const s = waveShape(t, R);
    for (const q of s.rings) if (q.r >= 0) assert.ok(q.r >= s.lo && q.r <= s.hi, `band holds ${q.r} at ${t}`);
    assert.ok(s.hi <= R + 3 * ringSigma(WAVE_TRAVEL, 0) + 1e-6, 'the band ends just past the radius');
  }
  near(ringFront(WAVE_TRAVEL - 1e-3, 0, 9), 9, 0.05, "a mission's own radius scales it");
});

test('decoy waves: the shells\' numbers for the pass (radius, softness, bend in metres, phase), two pulses', () => {
  const out = new Float32Array(24), sh = waveShape(0, 1);
  packShells(0.5, R, sh, out, 0);
  for (let k = 0; k < 3; k++) {
    const r = ringFront(0.5, k, R);
    near(out[k * 4], r, 1e-3);
    near(out[k * 4 + 1], ringSigma(0.5, k), 1e-6);
    near(out[k * 4 + 2], ringAlpha(0.5, k) * WAVE_BEND, 1e-6);
    assert.equal(out[k * 4 + 3], k);
  }
  packShells(WAVE_LIFE + 0.1, R, sh, out, 12);
  for (let k = 0; k < 3; k++) assert.equal(out[12 + k * 4 + 2], 0, 'a finished pulse bends nothing');
  assert.ok(WAVE_BEND > 0.1 && WAVE_BEND < 1, 'a shift of a few tenths of a metre');
});

/** A world with a Green Beret who plants a decoy and switches it on; returns the pieces. */
function decoyWorld() {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }] });
  const gb = s.cmd('greenberet');
  gb.issue({ type: 'ability', id: 'decoyDrop', target: gb });
  s.run(0.9);
  gb.moveTo(20, 10); s.run(3);
  const decoy = s.world.interactables.find((i) => i.interactKind === 'decoy');
  const waves = new DecoyWaves();
  s.world.game = { options: {} };
  waves.attach(s.world);
  return { s, gb, decoy, waves };
}
const toggle = (s, gb) => gb.issue({ type: 'ability', id: 'decoyToggle', target: gb });
const pulseTimes = (s) => s.events.filter((e) => e.name === 'noise' && e.p.kind === 'decoy').map((e) => e.t);

test('decoy waves: a beep starts a wave at once, it grows to the hearing radius and fades, gone before the next beep; one wave per decoy', () => {
  const { s, gb, decoy, waves } = decoyWorld();
  assert.ok(decoy && !decoy.on);
  for (let i = 0; i < 20; i++) { s.run(0.1); waves.update(0.1, 1); }
  assert.equal(waves.active, 0, 'a decoy that is off draws nothing');
  assert.equal(waves.slots.length, 0, 'and has made no slot');
  toggle(s, gb);
  s.run(0.05);
  waves.update(0.05, 1);
  assert.equal(waves.active, 1, 'the first beep draws a wave at once');
  const w0 = waves.slots[0], t0 = pulseTimes(s)[0];
  assert.ok(t0 != null && s.world.time - t0 < 0.1, 'started with the beep');
  near(w0.R, 13.5);
  near(w0.cx, decoy.x, 1e-6); near(w0.cz, decoy.z, 1e-6);
  near(w0.cy, WAVE_CENTRE_H, 0.5, 'the shells are spheres round the radio\'s middle, just above the ground');
  assert.equal(waves.drawn[0], w0);
  // it grows, then fades, and is gone before the next beep (every 1.5 s)
  let last = -1, maxHi = 0, goneAt = null;
  for (let i = 0; i < 27; i++) {
    s.run(0.05); waves.update(0.05, 1);
    const age = s.world.time - t0;
    if (age < 0.9) { assert.ok(w0.hi > last - 1e-6, `band grows (${age})`); last = w0.hi; }
    maxHi = Math.max(maxHi, w0.hi);
    if (goneAt == null && waves.active === 0) goneAt = age;
  }
  assert.ok(maxHi > 13 && maxHi < 16, `reaches the hearing radius (band to ${maxHi.toFixed(1)} m)`);
  assert.ok(goneAt != null && goneAt <= WAVE_LIFE + 0.1 && goneAt < PULSE, `gone after ${goneAt}`);
  // the next beep (1.5 s after the first) starts a new wave in the same slot
  const beeps = pulseTimes(s);
  for (let i = 0; i < 60 && pulseTimes(s).length < 2; i++) { s.run(0.05); waves.update(0.05, 1); }
  assert.equal(pulseTimes(s).length, 2);
  near(pulseTimes(s)[1] - beeps[0], PULSE, 0.06);
  s.run(0.03); waves.update(0.01, 1);
  assert.equal(waves.active, 1, 'the second beep draws again');
  assert.equal(waves.slots.length, 1, 'in the same slot (one draw per decoy)');
  // switched off: the running wave finishes, no new one
  toggle(s, gb);
  for (let i = 0; i < 80; i++) { s.run(0.05); waves.update(0.05, 1); }
  assert.equal(waves.active, 0);
  assert.equal(pulseTimes(s).length, 2, 'off: silent');
  waves.dispose();
});

test('decoy waves: the clock is the interpolated sim time (a pause freezes it); reduced motion, other noises and a lost world draw nothing', () => {
  const { s, gb, waves } = decoyWorld();
  toggle(s, gb);
  s.run(0.3); // (the first beep is 0.3 s old)
  const t0 = pulseTimes(s)[0];
  waves.update(1 / 60, 1);
  const w0 = waves.slots[0];
  near(w0.age, s.world.time - t0, 1e-9);
  const a = w0.age;
  waves.update(5, 1); waves.update(5, 1); // real time passing while the sim is paused
  near(w0.age, a, 1e-9, 'frozen with the sim');
  waves.update(1 / 60, 0.5); // half a tick short of the latest tick: the interpolated time
  near(w0.age, a - 0.5 / 60, 1e-9);
  assert.equal(w0.rings[12 + 2], 0, 'no earlier pulse');
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
});

test('decoy waves: each decoy has its own wave; the pool is bounded; a picked-up decoy lets go of its slot; a beep inside a running wave overlaps cleanly', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }] });
  s.world.game = { options: {} };
  const waves = new DecoyWaves();
  waves.attach(s.world);
  const srcs = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `d${i}`, x: 10 + i * 8, z: 30, removed: false, alive: true }));
  for (const d of srcs.slice(0, 3)) s.world.emitNoise(d.x, d.z, 13.5, 'decoy', d);
  s.run(0.05); waves.update(0.01, 1);
  assert.equal(waves.active, 3, 'one wave (one draw) per decoy');
  assert.equal(new Set(waves.drawn).size, 3);
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
  assert.equal(waves.slots.length, 4, 'no new slot: the freed one is reused');
  assert.equal(waves.active, 1);
  near(waves.slots[0].cx, 40, 1e-9);
  // a beep that comes while the last pulse is still running (a short pulse period): both are drawn
  s.run(0.5);
  s.world.emitNoise(b.x, b.z, 13.5, 'decoy', b);
  s.run(0.05); waves.update(0.01, 1);
  const w = waves.slots[0];
  assert.ok(w.rings[2] > 0 && w.rings[12 + 2] > 0, 'shells of both pulses bend the air');
  assert.ok(w.age >= 0 && w.age < 0.3, `the new pulse is young (${w.age.toFixed(2)})`);
  assert.equal(waves.active, 1);
  for (let i = 0; i < 160; i++) { s.run(0.05); waves.update(0.05, 1); }
  assert.equal(waves.active, 0, 'and both end');
  waves.dispose();
});

test('decoy refraction pass: the rectangle of a shell on screen; no work while no wave; per wave 2 copies + 1 draw, scissors put back', () => {
  const cam = new THREE.OrthographicCamera(-20, 20, 11.25, -11.25, 1, 500);
  cam.position.set(0, 80, 90); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const v = new THREE.Vector3(0, 0, 0).applyMatrix4(cam.matrixWorldInverse);
  const rc = [0, 0, 0, 0];
  discRect(cam, v.x, v.y, 5, 1280, 720, rc);
  // 5 m of a 40 m wide view is an eighth of the width each side of the middle
  assert.ok(rc.every((x, i) => Math.abs(x - [480, 200, 800, 520][i]) <= 1), `a 320 × 320 px rectangle round the middle (5 m of a 40 m wide, 22.5 m high view): ${rc}`);
  discRect(cam, v.x + 100, v.y, 5, 1280, 720, rc);
  assert.ok(rc[2] <= rc[0], 'a disc off the right edge: empty');
  discRect(cam, v.x + 19, v.y, 5, 1280, 720, rc);
  assert.ok(rc[2] === 1280 && rc[0] < rc[2], 'one over the edge: clamped to the target');

  const waves = new DecoyWaves();
  const eng = { camera: cam };
  const pass = new RefractionPass(eng, waves);
  const rb = new THREE.WebGLRenderTarget(1280, 720);
  rb.depthTexture = new THREE.DepthTexture(1280, 720);
  const calls = [];
  let target = null;
  const renderer = {
    autoClear: true,
    getRenderTarget: () => target,
    setRenderTarget(t) { target = t; calls.push(['target', t === rb ? 'read' : t === pass.colorRT ? 'color' : t === pass.depthRT ? 'depth' : 'other', t?.scissorTest, t ? [...t.scissor.toArray()] : null]); },
    render(mesh) { calls.push(['draw', mesh.material.uniforms.tColor ? 'copyColor' : mesh.material.uniforms.tDepth && !mesh.material.uniforms.tScene ? 'copyDepth' : 'refract', renderer.autoClear]); },
  };
  pass.render(renderer, null, rb);
  assert.equal(calls.length, 0, 'no wave: no work at all');
  assert.equal(pass.draws, 0);
  // one wave on screen
  waves.drawn.push({ cx: 0, cy: 0.3, cz: 0, lo: 2, hi: 6, age: 0.4, rings: Float32Array.from([5, 0.5, 0.3, 0, 3, 0.4, 0.2, 1, 1, 0.3, 0.1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) });
  pass.render(renderer, null, rb);
  assert.equal(pass.draws, 3, 'colour copy, depth copy, one draw for the decoy');
  assert.deepEqual(calls.filter((c) => c[0] === 'draw').map((c) => c[1]), ['copyColor', 'copyDepth', 'refract']);
  assert.ok(calls.filter((c) => c[0] === 'draw').every((c) => c[2] === false), 'never clears what it draws over');
  assert.deepEqual(calls.filter((c) => c[0] === 'target').map((c) => c[1]).slice(0, 3), ['color', 'depth', 'read'], 'colour copy → depth copy → the read buffer');
  assert.equal(rb.scissorTest, false, 'the read buffer\'s scissor is put back');
  assert.equal(pass.colorRT.scissorTest, false);
  const U = pass.refract.material.uniforms;
  near(U.uCentre.value.z, new THREE.Vector3(0, 0.3, 0).applyMatrix4(cam.matrixWorldInverse).z, 1e-6);
  near(U.uBand.value.y, 6);
  near(U.uRing.value[0].x, 5); near(U.uRing.value[0].z, 0.3);
  near(U.uPx.value.x, 0.5 * cam.projectionMatrix.elements[0], 1e-9);
  assert.equal(pass.colorRT.width, 1280, 'its targets follow the buffer');
  // two decoys: two draws, one pair of copies
  waves.drawn.push({ cx: 8, cy: 0.3, cz: 5, lo: 1, hi: 4, age: 0.2, rings: new Float32Array(24) });
  calls.length = 0;
  pass.render(renderer, null, rb);
  assert.equal(pass.draws, 4);
  // gain 0 (tests): nothing at all
  pass.gain = 0; calls.length = 0;
  pass.render(renderer, null, rb);
  assert.equal(calls.length, 0);
  // the load's warm-up: draws every program once, tiny, whatever is on screen
  pass.gain = 1; waves.drawn.length = 0; pass.warm = true; calls.length = 0;
  pass.render(renderer, null, rb);
  assert.equal(pass.draws, 3);
  assert.ok(calls.filter((c) => c[0] === 'target').every((c) => c[3] == null || c[3][2] <= 4), 'the warm-up draws are a few pixels');
  pass.dispose();
  rb.depthTexture.dispose(); rb.dispose();
});
