/**
 * The rear strap curtain of the canvas-covered lorry (user request 2026-10-07: "In the tailgate or the truck can we
 * make the stripes slide sideways as commandos enter the truck from behind"; art/strap-curtain.js). A man (capsules
 * along his bones, as art/vehicle-crew.js hands them over) climbs through the rear opening of the Opel Blitz cargo
 * (five straps 0.9 m long at x = ±0.8, ±0.4, 0 under the roll): the straps in his way slide SIDEWAYS out of his body
 * (never a link inside it, never two straps through each other, never through the canvas walls), then swing back and
 * settle; several men in a row keep them parted; wind leans them a little; the mesh at rest is the modelled straps.
 * Run with the unit suite: node tests/unit/run.mjs strap-curtain
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { STRAP_K, curtainState, curtainStep, curtainPush, curtainPenetration, strapOffset, curtainMotion, curtainGeometry, findRearStraps } from '../../src/art/strap-curtain.js';

const DEFS = [-0.8, -0.4, 0, 0.4, 0.8].map((x) => ({ x, y: 2.551, z: -3.022, len: 0.9, w: 0.02, t: 0.01 }));
const fresh = () => curtainState(DEFS, { half: 1.1 });
const dt = 1 / 60;

/**
 * A man standing at feet (x0, y0, z0), facing +z (into the bay), bent forward at the hips by `bend` rad (stooping
 * under the canvas, as art/vehicle-crew.js stoopUnder keeps his head below the rolled-up flap), as body capsules (core first).
 */
function man(x0, y0, z0, id = 'm', bend = 0, drop = 0) {
  const cb = Math.cos(bend), sb = Math.sin(bend), hip = 0.95;
  // bent at the hips by `bend`, crouched by `drop` (the hips lowered, knees half as much, feet where they are)
  const dy = (y) => (y >= hip - 0.05 ? drop : y > 0.3 ? drop * 0.5 : 0);
  const p = (q) => (q[1] <= hip ? [x0 + q[0], y0 + q[1] - dy(q[1]), z0 + q[2]] : [x0 + q[0], y0 + hip - drop + (q[1] - hip) * cb - q[2] * sb, z0 + (q[1] - hip) * sb + q[2] * cb]);
  const c = (a, b, r, k) => ({ a: p(a), b: p(b), r, id: `${id}:${k}`, core: k === 0 });
  return [
    c([0, 0.95, 0], [0, 1.38, 0.02], 0.15, 0), c([0, 1.38, 0.02], [0, 1.55, 0.03], 0.15, 1), c([0.19, 1.47, 0.03], [-0.19, 1.47, 0.03], 0.08, 2),
    c([0, 1.55, 0.03], [0, 1.66, 0.04], 0.06, 3), c([0, 1.69, 0.05], [0, 1.76, 0.05], 0.115, 4),
    // climbing: elbows out, hands forward on the tailgate / the canvas frame
    c([0.2, 1.47, 0.03], [0.36, 1.3, 0.15], 0.06, 5), c([0.36, 1.3, 0.15], [0.33, 1.42, 0.38], 0.05, 6),
    c([-0.2, 1.47, 0.03], [-0.36, 1.3, 0.15], 0.06, 7), c([-0.36, 1.3, 0.15], [-0.33, 1.42, 0.38], 0.05, 8),
    c([0.1, 0.92, 0], [0.11, 0.5, 0.06], 0.085, 9), c([0.11, 0.5, 0.06], [0.11, 0.09, 0], 0.065, 10),
    c([-0.1, 0.92, 0], [-0.11, 0.5, 0.06], 0.085, 11), c([-0.11, 0.5, 0.06], [-0.11, 0.09, 0], 0.065, 12),
  ];
}
/** Over the tailgate like art/vehicle-crew.js tailgateMotion: up from the ground 1.2 m behind onto the tailgate (0.8 s), on under the canvas (0.4 s). */
/** Ceiling over the bay (model frame): under the rolled-up flap at the opening, the canvas roof inside (as art/vehicle-crew.js). */
const ceilAt = (z) => (z < -3.169 ? 2.461 + (-3.169 - z) * 1.6 : z < -2.949 ? 2.461 : Math.min(2.799, 2.461 + (z + 2.949) * 1.6));
/**
 * He stoops as far as his crown, neck, back and shoulders must to clear the canvas (vehicle-crew stoopUnder): bent
 * forward up to 40°, then crouched.
 */
function stooped(x0, y0, z0, id, bend = 0) {
  let drop = 0, caps = man(x0, y0, z0, id, bend, drop);
  const over = () => Math.max(...[1, 2, 3, 4].map((k) => { const c = caps[k]; return Math.max(c.a[1], c.b[1]) + c.r - ceilAt((c.a[2] + c.b[2]) / 2); }));
  for (let i = 0; i < 30 && over() > 1e-3; i++) {
    if (bend < 0.7) bend = Math.min(0.7, bend + 0.06); else drop = Math.min(0.45, drop + 0.03);
    caps = man(x0, y0, z0, id, bend, drop);
  }
  return caps;
}
function climbAt(t, x0 = 0.05, id = 'm') {
  const sm = (k) => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
  if (t < 0.8) { const k = t / 0.8; return stooped(x0 * (1 - sm(k)), 0.02 + 1.13 * sm(k * 1.5 - 0.1), -4.25 + 1.39 * sm(k), id, 0.5 * sm(k * 1.6 - 0.3)); }
  const k = (t - 0.8) / 0.4;
  return stooped(0, 1.15, -2.86 + 1.24 * sm(k), id, 0.3);
}
const order = (C) => { // closest two straps' links come across the opening (x, z) at any level
  let g = Infinity;
  for (let k = 1; k <= STRAP_K.seg; k++) for (let i = 0; i < C.straps.length; i++) for (let j = i + 1; j < C.straps.length; j++) {
    const A = C.straps[i].P, B = C.straps[j].P;
    g = Math.min(g, Math.hypot(B[k * 3] - A[k * 3], B[k * 3 + 2] - A[k * 3 + 2]));
  }
  return g;
};
const restDev = (C) => { let m = 0; for (const s of C.straps) for (let k = 0; k <= STRAP_K.seg; k++) m = Math.max(m, Math.hypot(s.P[k * 3] - s.x, s.P[k * 3 + 1] - (s.y - (s.len * k) / STRAP_K.seg), s.P[k * 3 + 2] - s.z)); return m; };
const stretch = (C) => { let m = 0; for (const s of C.straps) for (let k = 1; k <= STRAP_K.seg; k++) { const i = (k - 1) * 3, j = k * 3; m = Math.max(m, Math.hypot(s.P[j] - s.P[i], s.P[j + 1] - s.P[i + 1], s.P[j + 2] - s.P[i + 2]) / s.l - 1); } return m; }; // links never longer (a tip may fold)

test('a man climbing in over the tailgate parts the straps sideways: none inside him, none through another, back at rest after', () => {
  const C = fresh();
  let pen = 0, gap = Infinity, str = 0, wall = 0;
  const off = C.straps.map(() => ({ lo: 0, hi: 0 })), mid = [];
  for (let f = 0; f < 60 * 7; f++) {
    const t = f * dt;
    curtainStep(C, dt, {});
    const caps = t >= 0.5 && t < 1.7 ? climbAt(t - 0.5) : [];
    curtainPush(C, caps);
    if (caps.length) pen = Math.max(pen, curtainPenetration(C, caps));
    gap = Math.min(gap, order(C)); str = Math.max(str, stretch(C));
    for (const s of C.straps) for (let k = 1; k <= STRAP_K.seg; k++) wall = Math.max(wall, Math.abs(s.P[k * 3]));
    C.straps.forEach((s, i) => { const o = strapOffset(C, i, 6); off[i].lo = Math.min(off[i].lo, o); off[i].hi = Math.max(off[i].hi, o); });
    if (f % 30 === 0) mid.push(+strapOffset(C, 2, 6).toFixed(3));
  }
  assert.ok(pen <= 0.001, `no link inside his body on any frame (deepest ${(pen * 1000).toFixed(2)} mm)`);
  // the straps in his way slide aside: the middle one by a body half-width, the ±0.4 ones out of his shoulders' way;
  // the ones he passes on his left go left (+x), on his right go right
  assert.ok(Math.max(-off[2].lo, off[2].hi) > 0.2, `the middle strap slides aside (${off[2].lo.toFixed(3)} … ${off[2].hi.toFixed(3)} m)`);
  assert.ok(Math.max(-off[1].lo, off[3].hi) > 0.02, `the straps beside him give way too (${off[1].lo.toFixed(3)}, ${off[3].hi.toFixed(3)} m)`);
  assert.ok(Math.abs(off[0].lo) < 0.25 && Math.abs(off[4].hi) < 0.25, 'the outer straps only gather (pushed by their neighbours)');
  assert.ok(gap >= STRAP_K.gap * 0.75, `no strap passes through another (stacked or one in front of the other: closest ${(gap * 100).toFixed(1)} cm)`);
  assert.ok(wall <= 1.1 - STRAP_K.wall + 1e-9, `nothing goes through the canvas walls (|x| ≤ ${wall.toFixed(3)} m)`);
  assert.ok(str < 0.08, `the leather does not stretch (no tearing) (${(str * 100).toFixed(2)} %)`);
  // 5 s after he passed: hanging straight again, barely moving
  assert.ok(restDev(C) < 0.01, `back at rest (${(restDev(C) * 1000).toFixed(1)} mm from the rest pose; middle strap ${mid.join(' ')})`);
  assert.ok(curtainMotion(C) < 0.02, `settled (${curtainMotion(C).toFixed(4)} m/s)`);
});

test('the swing back is damped: each overshoot smaller than the last, settled within ~3 s', () => {
  const C = fresh();
  const series = [];
  for (let f = 0; f < 60 * 6; f++) {
    const t = f * dt;
    curtainStep(C, dt, {});
    curtainPush(C, t >= 0.2 && t < 1.4 ? climbAt(t - 0.2) : []);
    if (t >= 1.4) series.push(strapOffset(C, 2, 8));
  }
  const peaks = [];
  for (let i = 1; i + 1 < series.length; i++) if (Math.abs(series[i]) >= Math.abs(series[i - 1]) && Math.abs(series[i]) > Math.abs(series[i + 1]) && Math.abs(series[i]) > 0.004) peaks.push(Math.abs(series[i]));
  assert.ok(peaks.length >= 2, `it swings back past rest (${peaks.map((p) => p.toFixed(3)).join(' ')})`);
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] < peaks[i - 1], `overshoot ${i} smaller (${peaks.map((p) => p.toFixed(3)).join(' ')})`);
  const late = series.slice(180).reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  assert.ok(late < 0.015, `after 3 s it hangs within 1.5 cm of rest (${(late * 100).toFixed(2)} cm)`);
});

test('getting out the same way parts them too, and men in a row keep the opening parted', () => {
  // out: from under the canvas back over the tailgate (the climb reversed)
  const C = fresh();
  let pen = 0, maxOut = 0;
  for (let f = 0; f < 60 * 2; f++) {
    const t = f * dt;
    curtainStep(C, dt, {});
    const caps = t < 1.2 ? climbAt(1.2 - t, 0.05, 'out') : [];
    curtainPush(C, caps);
    if (caps.length) pen = Math.max(pen, curtainPenetration(C, caps));
    maxOut = Math.max(maxOut, Math.abs(strapOffset(C, 2, 6)));
  }
  assert.ok(pen <= 0.001 && maxOut > 0.2, `out: parted (${maxOut.toFixed(3)} m), never inside him (${(pen * 1000).toFixed(2)} mm)`);
  // three men 0.6 s apart (one on the tailgate as the next climbs): each parts the middle strap, never one inside a
  // man, all back at rest after the last
  const R = fresh(), per = [0, 0, 0];
  let penR = 0;
  for (let f = 0; f < 60 * 7; f++) {
    const t = f * dt;
    curtainStep(R, dt, {});
    const caps = [];
    for (let m = 0; m < 3; m++) {
      const tm = t - 0.3 - m * 0.6;
      if (tm >= 0 && tm < 1.2) { caps.push(...climbAt(tm, 0.05, `m${m}`)); if (tm > 0.55 && tm < 0.85) per[m] = Math.max(per[m], Math.abs(strapOffset(R, 2, 6))); }
    }
    curtainPush(R, caps);
    if (caps.length) penR = Math.max(penR, curtainPenetration(R, caps));
  }
  assert.ok(per.every((o) => o > 0.15), `three men in a row: each parts the middle strap (${per.map((o) => o.toFixed(2)).join(', ')} m)`);
  assert.ok(penR <= 0.001, `never inside any of them (${(penR * 1000).toFixed(2)} mm)`);
  assert.ok(restDev(R) < 0.01, 'at rest after the last');
});

test('wind and the hull: the straps lean downwind a few degrees, swing back when the lorry pulls away, stay inextensible', () => {
  const C = fresh();
  // relative air 8 m/s blowing into the opening (model +z) for 3 s
  for (let f = 0; f < 180; f++) curtainStep(C, dt, { air: [0, 0, 8] });
  const s = C.straps[2], end = STRAP_K.seg * 3, lean = Math.atan2(s.P[end + 2] - s.P[2], s.P[1] - s.P[end + 1]) / (Math.PI / 180);
  assert.ok(lean > 2 && lean < 15, `leans ${lean.toFixed(1)}° in an 8 m/s wind`);
  // pulling away (2.5 m/s² forward for 1 s): the free ends swing back (−z), then return
  const D = fresh();
  let back = 0;
  for (let f = 0; f < 60; f++) { curtainStep(D, dt, { acc: [0, 0, 2.5] }); back = Math.min(back, D.straps[2].P[end + 2] - D.straps[2].z); }
  assert.ok(back < -0.05, `the straps swing back as it pulls away (${back.toFixed(3)} m)`);
  assert.ok(stretch(D) < 0.03 && stretch(C) < 0.03, 'no stretch');
  // the pins ride on the roll: a pin offset moves the whole strap with it
  const E = fresh();
  for (let f = 0; f < 120; f++) curtainStep(E, dt, { pins: E.straps.map(() => [0.01, 0.02, -0.03]) });
  assert.ok(Math.abs(E.straps[0].P[0] - (-0.8 + 0.01)) < 1e-9 && Math.abs(E.straps[0].P[end + 1] - (2.551 + 0.02 - 0.9)) < 0.002, 'the strap hangs from the displaced pin');
});

test('the mesh: at rest it is the modelled straps; findRearStraps picks the straps under a cover\'s rear end', () => {
  const C = fresh(), g = curtainGeometry(C);
  g.computeBoundingBox();
  const b = g.boundingBox;
  assert.ok(Math.abs(b.min.x + 0.81) < 1e-3 && Math.abs(b.max.x - 0.81) < 1e-3, `x ${b.min.x.toFixed(3)} … ${b.max.x.toFixed(3)}`);
  assert.ok(Math.abs(b.min.y - 1.651) < 1e-3 && Math.abs(b.max.y - 2.551) < 1e-3, `y ${b.min.y.toFixed(3)} … ${b.max.y.toFixed(3)}`);
  assert.ok(Math.abs(b.min.z + 3.027) < 1e-3 && Math.abs(b.max.z + 3.017) < 1e-3, `z ${b.min.z.toFixed(3)} … ${b.max.z.toFixed(3)}`);
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-4, 'unit normals');
  // a model: the cover (an open-backed box over the bed), 5 straps in its rear opening, a strap-like post elsewhere
  const inst = new THREE.Group();
  const cover = new THREE.Mesh(new THREE.BoxGeometry(2.27, 1.4, 3.05), new THREE.MeshBasicMaterial());
  cover.position.set(0, 2.17, -1.585); inst.add(cover);
  const straps = new THREE.Mesh(new (class extends THREE.BufferGeometry {})(), new THREE.MeshBasicMaterial({ name: 'leather' }));
  const parts = DEFS.map((d) => new THREE.BoxGeometry(d.w, d.len, d.t).translate(d.x, d.y - d.len / 2, d.z));
  const merged = parts.reduce((acc, p) => { const P = acc.pos, I = acc.idx, o = P.length / 3; P.push(...p.attributes.position.array); I.push(...Array.from(p.index.array, (i) => i + o)); return acc; }, { pos: [], idx: [] });
  straps.geometry.setAttribute('position', new THREE.Float32BufferAttribute(merged.pos, 3)); straps.geometry.setIndex(merged.idx);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1, 0.03).translate(1.0, 1.0, 2.0), new THREE.MeshBasicMaterial());
  inst.add(straps, post);
  const found = findRearStraps(inst, cover);
  assert.ok(found && found.meshes.length === 1 && found.meshes[0] === straps, 'the strap mesh is found, the post is not');
  assert.equal(found.defs.length, 5);
  assert.ok(found.defs.every((d, i) => Math.abs(d.x - DEFS[i].x) < 1e-6 && Math.abs(d.len - 0.9) < 1e-6 && Math.abs(d.y - 2.551) < 1e-6), 'pins and lengths');
});
