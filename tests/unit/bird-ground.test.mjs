/**
 * Ground-bird locomotion (user report: "walks walk strange on the ground, with abrupt movements"): crows walking,
 * hopping, pecking in a field and gulls on a pier deck, stepped at 60 Hz like the game. Per-frame limits on
 * displacement, speed change and heading change; planted feet never slide; steps match the distance walked; the head
 * bobs with the steps; landings and take-offs blend (no pops in height, pitch, wing fold or flap amplitude).
 */
import { test, assert } from './lib.mjs';
import { BirdSim } from '../../src/world/bird-sim.js';
import { restFoot, legDims } from '../../src/world/bird-ground.js';
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

/** Run the crows + gulls for `secs` at 60 Hz, a person walking past the flock at t = 40 s; collect per-frame stats. */
function run(secs = 120, seed = 8, E = env()) {
  const sim = new BirdSim([{ kind: 'crow', sp: 'crow', x: 30, z: 65, n: 6 }, { kind: 'gull', sp: 'gull', x: 22, z: 30, n: 6, body: 0 }], E, seed);
  const R = { maxWalkStep: 0, maxHopStep: 0, maxDv: 0, maxYaw: 0, maxSlide: 0, maxReach: 0, walked: 0, steps: 0, maxBob: 0, bobSwing: 0, maxPeck: 0, hops: 0,
    away: 0, inWall: 0, wallMin: 1e9, peckCut: 0, perchStep: 0, blend: { y: 0, pitch: 0, fold: 0, amp: 0 }, transitions: 0, sim };
  let prev = sim.birds.map(snap);
  for (let f = 0; f < secs * 60; f++) {
    sim.setThreats(f > 40 * 60 && f < 44 * 60 ? [{ x: 30 - 18 + (f - 40 * 60) * DT * 3, z: 65, moving: true }] : []);
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
