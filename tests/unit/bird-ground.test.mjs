/**
 * Ground-bird locomotion (user report: "walks walk strange on the ground, with abrupt movements"): crows walking,
 * hopping, pecking in a field and gulls on a pier deck, stepped at 60 Hz like the game (and at 144 Hz, like a fast
 * display: the birds are stepped once per rendered frame on interpolated sim time). Per-frame limits on
 * displacement, speed change and heading change; planted feet never slide; steps match the distance walked; the head
 * bobs with the steps; landings and take-offs blend (no pops in height, pitch, wing fold or flap amplitude).
 */
import { test, assert } from './lib.mjs';
import { BirdSim } from '../../src/world/bird-sim.js';
import { restFoot, legDims, strideTime } from '../../src/world/bird-ground.js';
import { BIRD_SPECIES } from '../../src/world/bird-sim.js';
import { birdGeometry, createBirdMesh, writeBirds } from '../../src/art/bird-model.js';

const fields = []; for (let x = 2; x < 58; x += 2) for (let z = 50; z < 80; z += 2) fields.push([x, z]);
const wet = (x, z) => x > 0 && x < 60 && z > 0 && z < 40;
function env(ws = 2) {
  return {
    wind: (x, z, o) => { o[0] = ws; o[1] = 0.4; },
    water: (x, z) => (wet(x, z) ? { level: -0.1, depth: 1, shore: Math.min(x, 60 - x, z, 40 - z), flow: [0, 0], ice: false } : null),
    ground: (x, z) => (wet(x, z) ? -1.2 : 0.15 * Math.sin(x * 0.3) + 0.1 * Math.cos(z * 0.4)), // rolling field
    fields, perches: [{ x: 20, y: 0.5, z: 41 }, { x: 22, y: 0.5, z: 41 }, { x: 24, y: 0.5, z: 41 }],
  };
}
const DT = 1 / 60, TAU = Math.PI * 2, dA = (a, b) => Math.abs(((a - b + Math.PI * 3) % TAU) - Math.PI);
const snap = (b) => ({ st: b.st, peck: b.peck, x: b.x, y: b.y, z: b.z, yaw: b.yaw, v: b.v, pitch: b.pitch, fold: b.fold, amp: b.amp, hop: !!b.hop, launch: b.launch > 0,
  feet: b.feet?.map((f) => ({ x: f.x, y: f.y, z: f.z, planted: f.s < 0 && !f.air })) });

/** Centre of the crows on the ground (their home if none are). */
function flockAt(sim) {
  const C = sim.birds.filter((b) => b.sp === 'crow' && b.st === 'ground');
  return C.length ? [C.reduce((a, b) => a + b.x, 0) / C.length, C.reduce((a, b) => a + b.z, 0) / C.length] : [30, 65];
}

/** Run the crows + gulls for `secs` at 60 Hz, a person walking past the flock at t = 40 s; collect per-frame stats. */
function run(secs = 120, seed = 8, E = env()) {
  const sim = new BirdSim([{ kind: 'crow', sp: 'crow', x: 30, z: 65, n: 6 }, { kind: 'gull', sp: 'gull', x: 22, z: 30, n: 6, body: 0 }], E, seed);
  const R = { maxWalkStep: 0, maxHopStep: 0, maxDv: 0, maxYaw: 0, maxSlide: 0, maxReach: 0, walked: 0, steps: 0, maxBob: 0, bobSwing: 0, maxPeck: 0, hops: 0,
    away: 0, inWall: 0, wallMin: 1e9, peckCut: 0, perchStep: 0, blend: { y: 0, pitch: 0, fold: 0, amp: 0 }, transitions: 0, stretch: [], sim };
  let prev = sim.birds.map(snap), P = [30, 65];
  for (let f = 0; f < secs * 60; f++) {
    if (f === 40 * 60) P = flockAt(sim); // the walker sets off 18 m from wherever the crows are feeding by then
    sim.setThreats(f > 40 * 60 && f < 44 * 60 ? [{ x: P[0] - 18 + (f - 40 * 60) * DT * 3, z: P[1], moving: true }] : []);
    sim.step(DT);
    sim.birds.forEach((b, i) => {
      const p = prev[i], q = snap(b);
      if (b.G && p.st === 'ground' && q.st === 'ground') {
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (q.hop || p.hop) { R.maxHopStep = Math.max(R.maxHopStep, d); if (q.hop && !p.hop) R.hops++; }
        else {
          R.maxWalkStep = Math.max(R.maxWalkStep, d); R.walked += d;
          R.maxDv = Math.max(R.maxDv, Math.abs(q.v - p.v)); R.maxYaw = Math.max(R.maxYaw, dA(q.yaw, p.yaw));
        }
        q.feet.forEach((ft, k) => {
          const o = p.feet[k];
          if (o.planted && ft.planted) R.maxSlide = Math.max(R.maxSlide, Math.hypot(ft.x - o.x, ft.y - o.y, ft.z - o.z));
          if (o.planted && !ft.planted && !q.hop) R.steps++;
          const r = restFoot(b, k, 0, { x: 0, z: 0 });
          if (!q.hop) R.maxReach = Math.max(R.maxReach, Math.hypot(ft.x - r.x, ft.z - r.z) / b.G.leg);
          // the leg is drawn as a straight stick from the hip to the foot: how far is it stretched?
          const G = b.G, c = Math.cos(b.yaw), sn = Math.sin(b.yaw), sd = k ? -1 : 1;
          if (!q.hop) R.stretch.push(Math.hypot(ft.x - (b.x + c * G.hipX - sn * sd * G.zr), ft.y - (b.y + G.hipY), ft.z - (b.z + sn * G.hipX + c * sd * G.zr)) / G.leg);
        });
        R.maxBob = Math.max(R.maxBob, Math.abs(b.bob)); if (q.v > 0.2) R.bobSwing = Math.max(R.bobSwing, Math.abs(b.bob));
        R.maxPeck = Math.max(R.maxPeck, b.peck);
        if (b.act === 'away') R.away++;
        if (E.blocked) { if (E.blocked(b.x, b.z)) R.inWall++; R.wallMin = Math.min(R.wallMin, E.wallDist(b.x, b.z)); }
      }
      if (b.G && p.st === 'ground' && q.st === 'takeoff' && p.peck > 0.05) R.peckCut++;
      // change of the per-frame drift on a post (the old settle snapped the last 2 cm onto it in one frame)
      const dx = q.x - p.x, dz = q.z - p.z; q.dx = dx; q.dz = dz;
      if (b.G && q.st === 'perched' && (p.st === 'perched' || p.st === 'final')) R.perchStep = Math.max(R.perchStep, Math.hypot(dx - (p.dx || 0), dz - (p.dz || 0)));
      // landing / take-off blends: any footed bird leaving or reaching the ground / deck
      const grounded = (s) => s === 'ground' || s === 'perched';
      if (b.G && (grounded(p.st) || grounded(q.st))) {
        if (p.st !== q.st) R.transitions++;
        if (!q.hop && !p.hop) R.blend.y = Math.max(R.blend.y, Math.abs(q.y - p.y));
        R.blend.pitch = Math.max(R.blend.pitch, Math.abs(q.pitch - p.pitch));
        R.blend.fold = Math.max(R.blend.fold, Math.abs(q.fold - p.fold)); R.blend.amp = Math.max(R.blend.amp, Math.abs(q.amp - p.amp));
      }
      prev[i] = q;
    });
  }
  return R;
}

test('crows walk without teleports or heading snaps; speed and turn rate are eased', () => {
  const R = run();
  assert.ok(R.walked > 8, `crows walked ${R.walked.toFixed(1)} m`);
  assert.ok(R.maxWalkStep <= 0.8 * DT + 1e-6, `walking displacement per frame ${R.maxWalkStep.toFixed(4)} m (≤ 0.8 m/s)`);
  assert.ok(R.maxDv <= 2.5 * DT + 1e-6, `speed change per frame ${R.maxDv.toFixed(4)} m/s (accel ≤ 2.5 m/s²)`);
  assert.ok(R.maxYaw <= 3.3 * DT, `heading change per frame ${R.maxYaw.toFixed(4)} rad (≤ 3.3 rad/s)`);
  assert.ok(R.hops >= 2 && R.maxHopStep <= 2.2 * DT, `${R.hops} two-footed hops, ${R.maxHopStep.toFixed(3)} m per frame`);
  assert.ok(R.maxPeck > 0.9, 'pecks reach the ground');
  assert.ok(R.away > 0, 'someone walking up at the edge of the wary radius makes the crows walk off first');
});

test('crow feet: planted feet never slide, the steps match the distance walked, the legs keep their reach, the head bobs', () => {
  for (const seed of [8, 5, 11]) {
    const R = run(120, seed);
    assert.ok(R.maxSlide < 1e-9, `planted foot slid ${R.maxSlide}`);
    const perM = R.steps / R.walked;
    assert.ok(perM > 6 && perM < 30, `${perM.toFixed(1)} steps per metre walked (crow steps ~5–15 cm)`);
    assert.ok(R.maxReach < 1.05, `feet stay within reach of the hips (${R.maxReach.toFixed(2)} × leg)`);
    // verifier 2026-10-01: longer strides left the trailing foot ~1.27 leg from the hip at every brisk step (p99 1.2–1.3,
    // max 1.6: a visibly stretching "rubber leg"); the old 6 cm steps kept p99 ≈ 1.07–1.10
    const S = [...R.stretch].sort((a, b) => a - b), p99 = S[Math.floor(S.length * 0.99)], mx = S[S.length - 1];
    assert.ok(p99 <= 1.12 && mx <= 1.3, `seed ${seed}: hip-to-foot distance p99 ${p99.toFixed(3)}, max ${mx.toFixed(3)} × leg (legs over-stretch)`);
    const G = legDims(BIRD_SPECIES.crow);
    assert.ok(R.bobSwing > 0.01 && R.maxBob <= G.leg * 0.45 + 1e-9, `head-bob ${R.bobSwing.toFixed(3)} m while walking`);
  }
});

test('landings and take-offs blend: no pops in height, pitch, wing fold or flap amplitude', () => {
  const R = run();
  assert.ok(R.transitions >= 6, `landings / take-offs seen ${R.transitions}`);
  assert.ok(R.blend.y < 0.05, `height step ${R.blend.y.toFixed(3)} m per frame`);
  assert.ok(R.blend.pitch < 0.12, `pitch step ${R.blend.pitch.toFixed(3)} rad per frame`);
  assert.ok(R.blend.fold < 0.1 && R.blend.amp < 0.1, `fold ${R.blend.fold.toFixed(3)} / amp ${R.blend.amp.toFixed(3)} per frame`);
  const a = run(30, 3).sim.birds.map((b) => b.x + b.z), b = run(30, 3).sim.birds.map((q) => q.x + q.z);
  assert.deepEqual(a, b, 'deterministic');
});

test('bird model: crows and gulls have legs whose feet follow the sim feet (planted feet stay put on screen)', () => {
  for (const sp of ['gull', 'crow']) {
    const g = birdGeometry(sp), W = g.attributes.aWing.array;
    let legs = 0; for (let i = 0; i < W.length; i += 4) if (W[i] < -1.5) legs++;
    assert.ok(legs >= 16 && g.index.count / 3 < 200, `${sp} legs ${legs} verts`);
  }
  const E = env(), sim = new BirdSim([{ kind: 'crow', sp: 'crow', x: 30, z: 65, n: 1 }], E, 2), b = sim.birds[0];
  for (let k = 0; k < 120; k++) sim.step(DT);
  const h = createBirdMesh('crow', 1), L0 = h.leg0.array;
  writeBirds(h, [b], null);
  // rebuild the left foot in world space from the instance matrix + leg offset: it must be where the sim put it
  const m = new Float32Array(16); h.mesh.instanceMatrix.array.slice(0, 16).forEach((v, i) => { m[i] = v; });
  const G = b.G, lx = G.hipX + L0[0], ly = -G.stand + L0[1], lz = G.zr + L0[2];
  const wx = m[0] * lx + m[4] * ly + m[8] * lz + m[12], wy = m[1] * lx + m[5] * ly + m[9] * lz + m[13], wz = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
  const f = b.feet[0];
  assert.ok(Math.hypot(wx - f.x, wy - f.y, wz - f.z) < 1e-4, `rendered foot at the sim foot (${wx.toFixed(3)},${wy.toFixed(3)},${wz.toFixed(3)} vs ${f.x.toFixed(3)},${f.y.toFixed(3)},${f.z.toFixed(3)})`);
});

test('crows never walk, hop or shy into an obstacle: a palisade across their field (M2 report: a crow half inside the logs)', () => {
  const wall = (x, z) => x > 33.5 && x < 34.5 && z > 44 && z < 86;
  for (const seed of [8, 5, 11, 2]) {
    const E = env();
    E.fields = fields.filter(([x]) => Math.abs(x - 34) >= 2); // the field runs right up to the logs on both sides
    E.blocked = wall; E.wallDist = (x, z) => Math.max(0, Math.abs(x - 34) - 0.5);
    const R = run(120, seed, E);
    assert.ok(R.wallMin < 2, `seed ${seed}: crows feed near the palisade (closest ${R.wallMin.toFixed(2)} m)`);
    assert.equal(R.inWall, 0, `seed ${seed}: ${R.inWall} frames of a crow standing inside the palisade`);
    assert.ok(R.wallMin > 0.15, `seed ${seed}: crows keep their bill out of the logs (closest ${R.wallMin.toFixed(2)} m)`);
    assert.ok(R.maxDv <= 2.5 * DT + 1e-6, `seed ${seed}: braking at the wall is eased (${R.maxDv.toFixed(4)} m/s per frame)`);
  }
});

test('a timed take-off never cuts a peck; a gull landing on a post shuffles the last cm, no snap', () => {
  for (const seed of [8, 5, 11, 3]) {
    const R = run(150, seed);
    assert.equal(R.peckCut, 0, `seed ${seed}: ${R.peckCut} take-offs started mid-peck`);
    assert.ok(R.perchStep < 0.004, `seed ${seed}: a gull settling on a post jerks ${R.perchStep.toFixed(4)} m per frame²`);
  }
});

/**
 * User report 2026-10-01: "Birds are jerking when walking make their movement smoother". What a viewer sees, per
 * RENDERED frame (60 and 144 Hz): the head (it carried a square-wave head-bob, stopping dead then lurching at
 * 30–160 m/s²), the body's bounce (a corner at every foot lift-off), the speed (acceleration switched fully on / off
 * in one frame), the heading, the hop take-off / landing (0 ↔ 1.5 m/s in one frame), the end of a walk (a 0.33 m/s
 * stop) and the cadence (7.5 steps/s of 6 cm: a twitchy scurry).
 */
function smoothRun(hz, seed, secs = 120) {
  const sim = new BirdSim([{ kind: 'crow', sp: 'crow', x: 30, z: 65, n: 6 }], env(), seed), dt = 1 / hz;
  const H = sim.birds.map(() => []), gt = sim.birds.map(() => 0);
  const R = { head: 0, vy: 0, jerk: 0, yawAcc: 0, hop: 0, endV: 0, ends: 0, steps: 0, wt: 0, wd: 0, headV: 1e9, bobMin: 0 };
  const head = (b) => { const L = b.S.len * 0.36 + b.bob; return [b.x + Math.cos(b.yaw) * L, b.z + Math.sin(b.yaw) * L]; };
  const dy = (u, w) => Math.atan2(Math.sin(u - w), Math.cos(u - w));
  let P = [30, 65];
  for (let f = 0; f < secs * hz; f++) {
    const t = f * dt;
    if (f === 40 * hz) P = flockAt(sim);
    sim.setThreats(t > 40 && t < 44 ? [{ x: P[0] - 18 + (t - 40) * 3, z: P[1], moving: true }] : []);
    const acts = sim.birds.map((b) => b.act);
    sim.step(dt);
    sim.birds.forEach((b, i) => {
      gt[i] = b.st === 'ground' ? gt[i] + dt : 0;
      if (acts[i] === 'walk' && b.act === 'stand' && b.st === 'ground') { R.endV = Math.max(R.endV, b.v); R.ends++; }
      const Q = H[i]; Q.push({ st: b.st, hop: !!b.hop, v: b.v, x: b.x, y: b.y, z: b.z, yaw: b.yaw, hd: head(b), peck: b.peck, planted: b.feet.map((q) => q.s < 0 && !q.air) });
      if (Q.length > 3) Q.shift();
      if (Q.length < 3 || !Q.every((q) => q.st === 'ground')) return;
      const [p, c, d] = Q, a2 = (k) => (d[k] - 2 * c[k] + p[k]) / dt ** 2;
      if (gt[i] < 0.1) return; // touching down from flight: the landing blend test covers it
      if (Q.some((q) => q.hop)) { R.hop = Math.max(R.hop, Math.abs(Math.hypot(d.x - c.x, d.z - c.z) - Math.hypot(c.x - p.x, c.z - p.z)) / dt); return; }
      R.head = Math.max(R.head, Math.hypot((d.hd[0] - 2 * c.hd[0] + p.hd[0]) / dt ** 2, (d.hd[1] - 2 * c.hd[1] + p.hd[1]) / dt ** 2));
      R.jerk = Math.max(R.jerk, Math.abs(d.v - 2 * c.v + p.v) / dt ** 2);
      R.yawAcc = Math.max(R.yawAcc, Math.abs(dy(d.yaw, c.yaw) - dy(c.yaw, p.yaw)) / dt ** 2);
      if (d.v > 0.1 && gt[i] > 0.6 && Q.every((q) => q.peck < 0.02)) R.vy = Math.max(R.vy, Math.abs(a2('y'))); // walking (a landing's leg spring / a peck's crouch aside)
      if (d.v > 0.15) { R.headV = Math.min(R.headV, Math.hypot(d.hd[0] - c.hd[0], d.hd[1] - c.hd[1]) / dt / d.v); R.bobMin = Math.min(R.bobMin, b.bob); }
      if (d.v > 0.25 && c.v > 0.25) { R.wt += dt; R.wd += Math.hypot(d.x - c.x, d.z - c.z); d.planted.forEach((pl, k) => { if (c.planted[k] && !pl) R.steps++; }); }
    });
  }
  return R;
}

test('walking crows move smoothly on screen at 60 and 144 fps: gentle head-bob, no bounce corners, eased speed / heading / hops / stops', () => {
  for (const [hz, seed] of [[60, 8], [60, 5], [144, 8], [144, 11]]) {
    const R = smoothRun(hz, seed), at = `${hz} Hz seed ${seed}`;
    assert.ok(R.wt > 10 && R.ends >= 5, `${at}: crows walked ${R.wt.toFixed(1)} s, ${R.ends} walks ended`);
    assert.ok(R.head <= 12, `${at}: head acceleration ${R.head.toFixed(1)} m/s² (a square-wave bob jerks the head at 30–160)`);
    assert.ok(R.headV >= 0.3, `${at}: the head keeps moving while the bird walks (slowest ${R.headV.toFixed(2)} × body speed; it used to stop dead)`);
    assert.ok(R.bobMin >= -0.005, `${at}: the head sinks ${(-R.bobMin * 1000).toFixed(1)} mm back into the body`);
    assert.ok(R.vy <= 4, `${at}: body bounce acceleration ${R.vy.toFixed(2)} m/s² (a corner at each foot lift-off: 10+)`);
    assert.ok(R.jerk <= 25, `${at}: walking-speed jerk ${R.jerk.toFixed(0)} m/s³ (acceleration switched on / off in one frame: 200+)`);
    assert.ok(R.yawAcc <= 26, `${at}: heading acceleration ${R.yawAcc.toFixed(0)} rad/s²`);
    assert.ok(R.hop <= 0.6, `${at}: hop speed change ${R.hop.toFixed(2)} m/s per frame (take-off / landing in one frame: 1.5)`);
    assert.ok(R.endV <= 0.15, `${at}: a walk ends at ${R.endV.toFixed(3)} m/s (it used to stop from 0.33)`);
    const sps = R.steps / R.wt, len = R.wd / R.steps;
    assert.ok(sps >= 3 && sps <= 6, `${at}: ${sps.toFixed(1)} steps/s while walking (7.5 read as a scurry)`);
    assert.ok(len >= 0.07 && len <= 0.16, `${at}: steps of ${(len * 100).toFixed(1)} cm (6 cm read as a shuffle)`);
  }
  assert.ok(strideTime(0.3) > 0.45 && strideTime(0.75) >= 0.38, 'stride time: unhurried at a stroll, brisk when walking off');
});

/**
 * Verifier 2026-10-01: a crow touching down with a 0.6 m/s run-out a few cm short of a wall (or the water's edge) froze
 * in one frame (0.42 m/s → 0: 60 m/s² at 144 Hz) while its speed decayed on, the feet stepping on the spot, then lurched
 * and froze again. The run-out must brake to a stop short of the obstacle with the body moving at the bird's speed.
 */
test('a landing run-out that comes in just short of a wall or the water brakes to a stop, never stops dead', () => {
  for (const hz of [60, 144]) for (const kind of ['wall', 'water']) for (const gap of [0.06, 0.1, 0.15]) {
    const E = { wind: (x, z, o) => { o[0] = 1; o[1] = 0; }, ground: () => 0, fields, perches: [],
      water: (x) => (kind === 'water' && x > 34 ? { level: -0.1, depth: 1, shore: x - 34, flow: [0, 0], ice: false } : null) };
    if (kind === 'wall') E.blocked = (x) => x > 34 && x < 35;
    const sim = new BirdSim([{ kind: 'crow', sp: 'crow', x: 30, z: 65, n: 1 }], E, 4), b = sim.birds[0], dt = 1 / hz, at = `${hz} Hz ${kind} ${gap} m`;
    for (let k = 0; k < 30; k++) sim.step(dt);
    b.st = 'final'; b.x = 34 - gap; b.z = 65; b.yaw = 0; b.yr = 0; b.vx = 0.6; b.vz = 0; b.vy = -0.3;
    sim._settle(b, 'ground', null);
    let px = b.x, pz = b.z, psp = null, dv = 0, frozen = 0, inside = 0;
    for (let k = 0; k < hz; k++) {
      sim.step(dt);
      if (b.st !== 'ground' || b.hop) break;
      const sp = Math.hypot(b.x - px, b.z - pz) / dt;
      if (psp !== null) dv = Math.max(dv, Math.abs(sp - psp));
      if (b.v > 0.02 && sp < 0.5 * b.v) frozen++;
      if (b.x > 34) inside++;
      psp = sp; px = b.x; pz = b.z;
    }
    assert.equal(frozen, 0, `${at}: ${frozen} frames of the body frozen while the bird still walks at speed`);
    assert.equal(inside, 0, `${at}: the crow ran into the ${kind}`);
    assert.ok(dv <= 6.5 * dt, `${at}: run-out speed change ${(dv / dt).toFixed(1)} m/s² (a stop dead: 25–60)`);
    assert.ok(b.v < 0.01, `${at}: stopped (${b.v.toFixed(3)} m/s)`);
  }
});
