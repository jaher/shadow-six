/**
 * Canvas covers (truck tarps, car tops, tents): "the cloth on the car is vibrating too fast" / "the back surface
 * detaches from the surrounding cloth". CPU twin of the vertex shader (cloth-wind.js canvasEval) on a box cover with
 * split-normal seams + sagging bays: seam vertices stay welded (< 1 mm), the motion spectrum stays below ~1.5 Hz at
 * any sim time (no `t × speed` chirp), the filters are frame-rate independent, and hoops / rails pin the cloth.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { WindField } from '../../src/world/wind.js';
import { CANVAS_K, canvasAttributes, coverWeightFn, subdivideCanvas, canvasState, canvasStep, canvasUniforms, canvasEval } from '../../src/art/cloth-wind.js';
import { buildTent } from '../../src/art/dressing.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seamGroups, maxGap, spectrum, nearPairs, maxGrowth, triEdges, maxStretch } from '../cloth-probe.mjs';

/** Box cover 2.3 × 1.4 × 3 m (sides, roof, rear + front end panels; separate faces = split-normal seams) whose roof
 *  sags 4 cm between 4 hoops (z = −1.5, −0.5, 0.5, 1.5). */
function cover() {
  const g = new THREE.BoxGeometry(2.3, 1.4, 3, 6, 5, 9);
  g.deleteAttribute('uv');
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const y = P.getY(i) + 2.1, z = P.getZ(i);
    P.setY(i, y > 2.79 ? y - 0.04 * Math.abs(Math.sin(Math.PI * (z + 1.5))) : y);
  }
  g.computeVertexNormals();
  // the bottom face is the open bed: drop it (triangles whose 3 vertices sit at y = 1.4)
  const I = g.index.array, keep = [];
  for (let t = 0; t < I.length; t += 3) if (![0, 1, 2].every((k) => Math.abs(P.getY(I[t + k]) - 1.4) < 1e-6)) keep.push(I[t], I[t + 1], I[t + 2]);
  g.setIndex(keep);
  return g;
}

/** Run the twin over `secs` at `fps`: returns per-frame world-free positions (object frame, metres) + D series. */
function simulate(g, { t0 = 5, secs = 4, fps = 60, speed = 0, wind = WindField.forMission({ theater: 'fjord' }), field = 'welded' } = {}) {
  const P = g.attributes.position, n = P.count, W = g.attributes.aFlap, D = g.attributes.aFlapDir, A = g.attributes.aFlapP, G = g.attributes.aFlapG;
  const N = g.attributes.normal, m = new THREE.Matrix4().makeRotationY(0.7).setPosition(40, 0, 40).elements;
  let x = 40, z = 40;
  const w0 = wind.sample(x, z, t0 - 1), st = canvasState(x, z, w0), U = { air: new Float32Array(4), k: new Float32Array(4), ph: new Float32Array(4) };
  const frames = [], series = Array.from({ length: n }, () => []);
  const F = Math.round(secs * fps), dt = 1 / fps, fwd = [Math.sin(0.7), Math.cos(0.7)];
  for (let f = -fps + 1; f <= F; f++) { // 1 s warm-up from the state created at t0 − 1
    const t = t0 + f * dt;
    x += fwd[0] * speed * dt; z += fwd[1] * speed * dt; m[12] = x; m[14] = z;
    const s = wind.sample(x, z, t);
    canvasStep(st, dt, x, z, s);
    canvasUniforms(st, m, U.air, U.k, U.ph);
    if (f < 0) continue;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const dir = field === 'welded' ? [D.getX(i), D.getY(i), D.getZ(i)] : [N.getX(i), N.getY(i), N.getZ(i)];
      const { D: d } = canvasEval([A.getX(i), A.getY(i), A.getZ(i)], dir, W.getX(i), [G.getX(i), G.getY(i), G.getZ(i)], U);
      for (let c = 0; c < 3; c++) pos[i * 3 + c] = P.getComponent(i, c) + dir[c] * d;
      series[i].push(d);
    }
    frames.push(pos);
  }
  return { frames, series, st };
}

function prepared() {
  const g = subdivideCanvas(cover(), 0.3, 1);
  return canvasAttributes(g, coverWeightFn(g, 1, { rear: -1 }), 1);
}

test('seams stay welded: coincident vertices of the rear panel / sides / roof never separate (< 1 mm)', () => {
  const g = prepared(), groups = seamGroups(g.attributes.position.array);
  assert.ok(groups.length > 40, `the box cover has split-normal seams (${groups.length})`);
  for (const speed of [0, 9]) {
    const { frames } = simulate(g, { speed, t0: 600 });
    const gap = Math.max(...frames.map((p) => maxGap(p, groups)));
    assert.ok(gap < 1e-3, `max seam gap ${(gap * 1000).toFixed(3)} mm at ${speed} m/s`);
  }
  // sensitivity: displacing along the split per-face normals (the old shader) does open the seams
  const old = simulate(g, { field: 'split', t0: 600, secs: 1 });
  assert.ok(Math.max(...old.frames.map((p) => maxGap(p, groups))) > 5e-3, 'per-face normals would tear the seams');
});

test('smooth: dominant motion 0.3–1.5 Hz, < 6 % of the power above 2 Hz, at any sim time, parked or driving', () => {
  const g = prepared(), A = g.attributes.aFlap;
  const pick = []; for (let i = 0; i < A.count; i += 7) if (A.getX(i) > 0.5) pick.push(i);
  for (const t0 of [5, 600, 3600]) for (const speed of [0, 9]) {
    const { series } = simulate(g, { t0, speed, secs: 6 });
    const s = spectrum(pick.map((i) => Float32Array.from(series[i])), 60, 2);
    assert.ok(s.hiFrac < 0.06, `t0 ${t0} v ${speed}: ${JSON.stringify(s)}`);
    assert.ok(s.centroid > 0.2 && s.centroid < 1.5, `centroid ${s.centroid} Hz (t0 ${t0}, v ${speed})`);
    assert.ok(s.ptp > 0.004 && s.ptp < 0.25, `amplitude ${s.ptp} m (t0 ${t0}, v ${speed})`);
  }
  // phase rates never exceed ~1.45 Hz whatever the wind
  assert.ok(CANVAS_K.f0.every((f, i) => f + CANVAS_K.f1[i] <= 1.45));
});

test('frame-rate independent filters and phases (30 / 60 / 144 fps agree)', () => {
  const g = prepared(), out = [];
  for (const fps of [30, 60, 144]) { const { st } = simulate(g, { fps, secs: 3, speed: 6 }); out.push(st); }
  for (const s of out.slice(1)) {
    assert.ok(Math.abs(s.ax - out[0].ax) < 0.15 && Math.abs(s.az - out[0].az) < 0.15, 'low-passed air');
    for (let i = 0; i < 4; i++) { const d = Math.abs(((s.ph[i] - out[0].ph[i] + 9 * Math.PI) % (2 * Math.PI)) - Math.PI); assert.ok(d < 0.1, `phase ${i} ${d}`); }
  }
});

test('pins: hoops (roof crests) and bed rails hold, bays and the rear hem are free; tents weld their crease', () => {
  const g = cover(), fn = coverWeightFn(g, 1, { rear: -1 });
  assert.deepEqual(fn.hoops.map((h) => Math.round(h * 10) / 10), [-1.5, -0.5, 0.5, 1.5]);
  assert.ok(fn(1.15, 2.1, -0.5) < 0.02, 'side on a hoop');
  assert.ok(fn(1.15, 1.42, 0) < 0.05, 'side at the bed rail');
  assert.ok(fn(1.15, 2.2, 0) > 0.9, 'side mid-bay');
  assert.ok(fn(0, 2.76, 0) > 0.9, 'roof mid-bay');
  assert.ok(fn(0, 2.1, -1.5) > 1.4, 'rear panel hem: loose');
  assert.ok(fn(0, 2.1, 1.5) < 1.05, 'front panel: taut');
  const tent = buildTent({ w: 4, d: 4, h: 2.2 });
  let geo = null; tent.traverse((o) => { if (o.isMesh && o.geometry.attributes.aFlapDir) geo = o.geometry; });
  assert.ok(geo, 'tent canvas carries welded directions');
  const groups = seamGroups(geo.attributes.position.array), D = geo.attributes.aFlapDir;
  let worst = 0;
  for (const q of groups) for (const i of q) worst = Math.max(worst, Math.hypot(D.getX(i) - D.getX(q[0]), D.getY(i) - D.getY(q[0]), D.getZ(i) - D.getZ(q[0])));
  assert.ok(worst < 1e-6, 'coincident tent vertices share one direction');
});

/** The Opel Blitz layout: the cover's rear valance is a SEPARATE panel 5 mm behind the cover rim (never welded) and
 *  ends in a rolled-up flap, a closed canvas cylinder 15 cm across whose faces point every way. */
function blitzRear(smooth) {
  const c = cover(), P = c.attributes.position, I = c.index.array, keep = [];
  for (let t = 0; t < I.length; t += 3) if (![0, 1, 2].every((k) => Math.abs(P.getZ(I[t + k]) + 1.5) < 1e-6 && P.getY(I[t + k]) < 2.25)) keep.push(I[t], I[t + 1], I[t + 2]);
  c.setIndex(keep); // open below the valance
  const panel = new THREE.PlaneGeometry(2.3, 0.55, 8, 3).rotateY(Math.PI).translate(0, 2.505, -1.505);
  const roll = new THREE.CylinderGeometry(0.075, 0.075, 2.28, 12, 6).rotateZ(Math.PI / 2).translate(0, 2.175, -1.56);
  for (const q of [panel, roll]) q.deleteAttribute('uv');
  const g = subdivideCanvas(mergeGeometries([c, panel, roll]), 0.3, 1);
  return canvasAttributes(g, coverWeightFn(g, 1, { rear: -1 }), 1, smooth);
}

test('nearby UNWELDED parts move together: separate back panel + rolled-up hem never split, swell or stretch', () => {
  const run = (g, o) => {
    const rest = g.attributes.position.array, near = nearPairs(rest, 2e-3, 0.04), edges = triEdges(g);
    let grow = 0, str = 0;
    for (const p of simulate(g, { secs: 2, ...o }).frames) { grow = Math.max(grow, maxGrowth(p, near)); str = Math.max(str, maxStretch(p, rest, edges)); }
    return { pairs: near.length / 3, grow, str };
  };
  const g = blitzRear();
  for (const o of [{ speed: 0 }, { speed: 12 }, { speed: 0, wind: WindField.forMission({ theater: 'fjord', weather: { wind: { preset: 'fjord', speed: 14 } } }) }]) {
    const r = run(g, { t0: 900, ...o }), tag = `${o.speed} m/s${o.wind ? ', fjord 14 m/s' : ''}`;
    assert.ok(r.pairs > 300, `near pairs found (${r.pairs})`);
    assert.ok(r.grow < 0.012, `${tag}: pairs 2 mm–4 cm apart drift apart ≤ ${(r.grow * 1000).toFixed(1)} mm`);
    assert.ok(r.str < 0.3, `${tag}: edge stretch ${(r.str * 100).toFixed(0)} %`);
  }
  // sensitivity: per-position outward directions (no spatial smoothing) split the roll and tear the panel off the rim
  const old = run(blitzRear(0.002), { speed: 12, t0: 900 });
  assert.ok(old.grow > 0.03 && old.str > 1, `unsmoothed directions would split it (${(old.grow * 1000).toFixed(0)} mm, ${(old.str * 100).toFixed(0)} %)`);
});

