/**
 * Step 4f ambient life: fish schools (habitats / species per theatre, boids inside the wet mask and their depth band,
 * trout rheotaxis, fright, blast stun + recovery, determinism, pause), birds (plan per theatre, wind-aware flight
 * and settling, flush on noise / approach, landing again), the director wiring over a real World (events → stun /
 * flush) and the instanced models (geometry budgets, culling, water-capture tags).
 */
import { test, assert } from './lib.mjs';
import { FishSim, fishPlan, fishHabitat, FISH_SPECIES } from '../../src/world/fish-sim.js';
import { BirdSim, birdPlan, windAtHeight } from '../../src/world/bird-sim.js';
import { createAmbientLife, lifePerches, lifeFields, lifeBodies } from '../../src/render/ambient-life.js';
import { fishGeometry, createFishMesh, writeFish, createFishShadows, writeFishShadows } from '../../src/art/fish-model.js';
import { birdGeometry, createBirdMesh, writeBirds } from '../../src/art/bird-model.js';
import { World } from '../../src/world/world.js';
import { T } from '../../src/world/grid.js';
import m01 from '../../src/missions/m01_baptism_of_fire.js';

/** 60 × 40 m pond: 1.1 m deep in the middle, shelving to 0.25 m at the banks; optional uniform current. */
function pond(flow = [0, 0], o = {}) {
  const body = { o: { type: o.type || 'sea', preset: o.preset || 'fjord' } };
  return {
    body, bodies: [body],
    sample(x, z) {
      if (x < 0 || x > 60 || z < 0 || z > 40) return null;
      const shore = Math.min(x, 60 - x, z, 40 - z);
      return { depth: Math.min(1.1, 0.25 + shore * 0.3), shore, flow, level: -0.1, ice: false, body };
    },
  };
}
const spots = []; for (let x = 3; x < 58; x += 2) for (let z = 3; z < 38; z += 2) spots.push([x, z]);
const run = (sim, s, dt = 1 / 30) => { for (let k = 0; k < s / dt; k++) sim.step(dt); };

test('fish habitats and species per theatre / body; quality scales the population', () => {
  assert.equal(fishHabitat({ type: 'sea' }, 'snow'), 'fjord');
  assert.equal(fishHabitat({ type: 'lake', preset: 'fjord' }, 'snow'), 'fjord', 'M1 still fjord (grid "lake") is a sea arm');
  assert.equal(fishHabitat({ type: 'sea', preset: 'sea' }, 'coast'), 'sea');
  assert.equal(fishHabitat({ type: 'lake', preset: 'harbor' }, 'night'), 'sea');
  assert.equal(fishHabitat({ type: 'river' }, 'snow'), 'river');
  assert.equal(fishHabitat({ type: 'lake', preset: 'lake' }, 'temperate'), 'lake');
  assert.equal(fishHabitat({ type: 'sea', frozen: true }, 'snow'), null);
  const sp = (b, th, q) => new Set(fishPlan([{ ...b, spots, area: 2200 }], th, 3, q).map((p) => p.sp));
  assert.deepEqual([...sp({ type: 'sea' }, 'snow')].sort(), ['cod', 'herring', 'pollock']);
  assert.deepEqual([...sp({ type: 'sea', preset: 'sea' }, 'coast')].sort(), ['mullet', 'seabass']);
  assert.ok(sp({ type: 'river' }, 'snow').has('trout'));
  assert.ok(sp({ type: 'lake', preset: 'lake' }, 'temperate').has('perch'));
  const n = (q) => fishPlan([{ type: 'sea', spots, area: 2200 }], 'snow', 3, q).reduce((a, p) => a + p.n, 0);
  assert.ok(n('low') > 0 && n('low') < n('high') && n('high') <= n('ultra'), `population low ${n('low')} high ${n('high')}`);
  for (const S of Object.values(FISH_SPECIES)) assert.ok(S.len[0] > 0.1 && S.len[1] < 1 && S.band[0] < S.band[1]);
});

test('schools stay in the water and in their depth band; deterministic; frozen at dt 0', () => {
  const W = pond(), plan = fishPlan([{ type: 'sea', spots, area: 2200 }], 'snow', 5);
  const a = new FishSim(plan, W, 9), b = new FishSim(plan, W, 9);
  assert.ok(a.fish.length > 60, `fish ${a.fish.length}`);
  run(a, 40); run(b, 40);
  assert.deepEqual(a.fish.map((f) => [f.x, f.y, f.z]), b.fish.map((f) => [f.x, f.y, f.z]), 'same seed + same steps → same fish');
  for (const f of a.fish) {
    const s = W.sample(f.x, f.z);
    assert.ok(s, `fish left the water at ${f.x.toFixed(1)},${f.z.toFixed(1)}`);
    assert.ok(f.y < s.level - 0.04 && f.y > s.level - s.depth, `fish y ${f.y.toFixed(2)} outside the column`);
    assert.ok(Number.isFinite(f.yaw + f.phase + f.bend));
  }
  // schools hold together (herring / pollock): mean distance to the centroid a few metres at most
  for (const s of a.schools.filter((q) => q.members.length > 8)) {
    const d = s.members.reduce((m, f) => m + Math.hypot(f.x - s.cx, f.z - s.cz), 0) / s.members.length;
    assert.ok(d < 4, `${s.sp} spread ${d.toFixed(2)} m`);
  }
  const snap = JSON.stringify(a.fish.map((f) => [f.x, f.z, f.phase]));
  a.step(0); a.step(-1);
  assert.equal(JSON.stringify(a.fish.map((f) => [f.x, f.z, f.phase])), snap, 'no sim time → nothing moves (pause)');
});

test('river trout hold station head-upstream (rheotaxis) with the tail beating', () => {
  const W = pond([0.8, 0], { type: 'river' });
  const sim = new FishSim(fishPlan([{ type: 'river', spots, area: 2200 }], 'snow', 4), W, 3);
  run(sim, 20);
  const trout = sim.fish.filter((f) => f.sp === 'trout');
  assert.ok(trout.length >= 4);
  const p0 = trout.map((f) => [f.x, f.z]);
  run(sim, 3);
  let up = 0, held = 0;
  trout.forEach((f, i) => {
    if (Math.cos(f.yaw - Math.PI) > 0.8) up++;
    if (Math.hypot(f.x - p0[i][0], f.z - p0[i][1]) < 1) held++; // the others are moving to a new lie
    assert.ok(f.beat > 1, 'swims against the current');
  });
  assert.ok(held >= trout.length * 0.6, `hold their lie against a 0.8 m/s current: ${held}/${trout.length}`);
  assert.ok(up >= trout.length * 0.75, `facing upstream ${up}/${trout.length}`);
  // trout rise to take flies: rings for the water ripples; feeding flashes roll the flank to the sky
  sim.rings.length = 0;
  let rolled = 0;
  for (let k = 0; k < 90 * 30; k++) { sim.step(1 / 30); if (sim.fish.some((f) => Math.abs(f.roll) > 0.5)) rolled++; }
  assert.ok(sim.rings.length >= 3 && sim.rings.every((q) => W.sample(q.x, q.z)), `rise rings ${sim.rings.length}`);
  assert.ok(rolled > 30, `flank flashes seen in ${rolled} steps`);
});

test('fright bursts fish away from a diver; an underwater blast stuns a few that float belly-up, then recover', () => {
  const W = pond();
  const sim = new FishSim(fishPlan([{ type: 'sea', spots, area: 2200 }], 'snow', 5), W, 9);
  run(sim, 10);
  const s = sim.schools.find((q) => q.sp === 'herring');
  const cx = s.cx, cz = s.cz, near = s.members.filter((f) => Math.hypot(f.x - cx, f.z - cz) < 3);
  const d0 = near.reduce((m, f) => m + Math.hypot(f.x - cx, f.z - cz), 0) / near.length;
  sim.setThreats([{ x: cx, z: cz, r: 4.5, s: 1 }]);
  run(sim, 0.6);
  const d1 = near.reduce((m, f) => m + Math.hypot(f.x - cx, f.z - cz), 0) / near.length;
  assert.ok(d1 > d0 + 0.4, `flash expansion ${d0.toFixed(2)} → ${d1.toFixed(2)} m`);
  assert.ok(Math.max(...near.map((f) => Math.hypot(f.vx, f.vz))) > FISH_SPECIES.herring.cruise * 2.5, 'C-start burst speed');
  sim.setThreats([]);
  run(sim, 5);
  const t = sim.schools.find((q) => q.sp === 'pollock') || s, f0 = t.members[0];
  const stunned = sim.impulse(f0.x, f0.z, 6, 1, { blast: true, stun: 3 });
  assert.ok(stunned >= 1 && stunned <= 3 && sim.stunned === stunned, `stunned ${stunned}`);
  run(sim, 3);
  const st = sim.fish.filter((f) => f.stun > 0);
  for (const f of st) { assert.ok(Math.abs(f.roll) > 2.6, 'belly-up'); assert.ok(f.y > f.level - 0.12, `floats up (y ${f.y.toFixed(2)})`); }
  run(sim, 12);
  assert.equal(sim.stunned, 0, 'recovered');
  assert.ok(sim.fish.every((f) => Math.abs(f.roll) < 1.2 && f.rec === 0), 'upright again (feeding flashes roll ≤ 1 rad)');
});

// ------------------------------------------------------------------ birds
const fields = []; for (let x = 2; x < 58; x += 2) for (let z = 50; z < 80; z += 2) fields.push([x, z]);
function birdEnv(ws = 5, o = {}) {
  const W = pond();
  return { wind: (x, z, out) => { out[0] = ws; out[1] = 0; }, water: (x, z) => W.sample(x, z), ground: (x, z) => (W.sample(x, z) ? -1.2 : 0),
    fields, perches: [{ x: 20, y: 0.5, z: 41 }, { x: 22, y: 0.5, z: 41 }, { x: 24, y: 0.5, z: 41 }], splashes: 0,
    splash() { this.splashes++; }, ripple() {}, flush: o.flush };
}

test('bird plan per theatre: gulls + eiders on a Norway fjord, mallards on quiet rivers, crows in fields, none in the desert', () => {
  const sea = [{ type: 'lake', preset: 'fjord', spots, area: 2200 }];
  const kinds = (m) => birdPlan({ fields, perches: [], ...m }, 3).map((p) => p.sp);
  assert.deepEqual([...new Set(kinds({ theater: 'snow', bodies: sea }))].sort(), ['crow', 'eider', 'gull']);
  assert.ok(kinds({ theater: 'temperate', bodies: [{ type: 'river', velocity: 0.5, spots, area: 1200 }] }).includes('mallard'));
  assert.ok(!kinds({ theater: 'temperate', bodies: [{ type: 'river', velocity: 1.6, spots, area: 1200 }] }).includes('mallard'), 'no ducks on a torrent');
  assert.ok(!kinds({ theater: 'snow', night: true, bodies: [] }).includes('crow'), 'crows roost at night');
  assert.equal(kinds({ theater: 'desert', bodies: sea }).length, 0);
  assert.ok(windAtHeight(12) > windAtHeight(1) && windAtHeight(0) >= 0.4);
});

test('birds fly through the moving air, settle facing into the wind, flush at a gunshot and come back', () => {
  let flushed = 0;
  const env = birdEnv(6, { flush: () => flushed++ });
  const plan = birdPlan({ theater: 'snow', bodies: [{ type: 'lake', preset: 'fjord', spots, area: 2200 }], fields, perches: env.perches }, 3);
  const sim = new BirdSim(plan, env, 4);
  run(sim, 30);
  for (const b of sim.birds) assert.ok(Number.isFinite(b.x + b.y + b.z + b.yaw), 'finite');
  // wind towards +X: sitting birds face −X (into the wind) within the preening jitter
  const sitting = sim.birds.filter((b) => b.st === 'perched' || b.st === 'float' || (b.st === 'swim' && Math.hypot(b.wx - b.x, b.wz - b.z) < 0.6));
  for (const b of sitting.filter((q) => q.kind !== 'duck')) assert.ok(Math.cos(b.yaw - Math.PI) > 0.6, `${b.sp} faces into the wind (yaw ${b.yaw.toFixed(2)})`);
  const soaring = sim.birds.filter((b) => b.st === 'soar');
  assert.ok(soaring.length >= 1 && soaring.every((b) => b.y > 4), 'gulls on the wing');
  const grounded = () => sim.birds.filter((b) => ['perched', 'float', 'swim', 'ground'].includes(b.st)).length;
  const g0 = grounded();
  assert.ok(g0 >= 4, `sitting birds ${g0}`);
  const n = sim.noise(30, 45, 120);
  assert.ok(n >= g0 * 0.8 && flushed === n, `flushed ${n}/${g0}`);
  assert.ok(env.splashes > 0, 'ducks splash off the water');
  run(sim, 1.5);
  assert.ok(sim.birds.filter((b) => b.st === 'flee').every((b) => b.vy > 0 || b.y > 2), 'climbing away');
  run(sim, 120);
  assert.ok(grounded() >= g0 * 0.5, `settled again: ${grounded()} (landings ${sim.stats.landings})`);
  // gale: gulls hang into the wind, never blown off the map
  const gale = new BirdSim(plan.filter((p) => p.kind === 'gull'), birdEnv(16), 5);
  run(gale, 60);
  for (const b of gale.birds) assert.ok(b.x > -40 && b.x < 110, `gull kept its patch in a gale (x ${b.x.toFixed(0)})`);
});

test('sitting birds flush when someone walks up; crows commute inside their fields', () => {
  const env = birdEnv(3);
  const sim = new BirdSim([{ kind: 'crow', sp: 'crow', x: 30, z: 65, n: 5 }], env, 8);
  run(sim, 2);
  assert.equal(sim.census().ground, 5);
  const c = sim.birds[0];
  sim.setThreats([{ x: c.x + 3, z: c.z, moving: true }]);
  run(sim, 0.2);
  assert.equal(c.st, 'flee');
  sim.setThreats([]);
  run(sim, 90);
  for (const b of sim.birds) if (b.st === 'ground') assert.ok(fields.some(([x, z]) => Math.abs(x - b.x) < 12 && Math.abs(z - b.z) < 12), 'landed in the fields');
});

// ------------------------------------------------------------------ director + models
test('director over a real World: M1 perches, fields, bodies; explosion in the water stuns fish, a shot flushes birds', () => {
  const P = lifePerches(m01, () => 0.6);
  assert.equal(P.length, 16, 'two M1 piers × 8 perches');
  assert.ok(P.every((p) => p.y === 0.6));
  const w = new World({ size: [60, 90], mission: { id: 't', theater: 'snow', seed: 5, lighting: { sunElevDeg: 15, hdri: 'overcast' } } });
  w.grid.fillRect(0, 0, 60, 40, 'terrain', T.WATER);
  w.grid.fillRect(0, 40, 60, 50, 'terrain', T.SNOW);
  assert.ok(lifeFields(w.grid).length > 60);
  const W = pond([0, 0], { type: 'lake', preset: 'fjord' }), disturbed = [];
  w.water = { ...W, disturb: (...a) => disturbed.push(a), wakes: { onSplash: null, splash() {} } };
  const B = lifeBodies(w.grid, w.water);
  assert.equal(B.length, 1); assert.ok(B[0].area > 2000 && B[0].spots.length > 100);
  const L = createAmbientLife(w, null);
  assert.ok(L.fish.fish.length > 50 && L.birds.birds.some((b) => b.sp === 'crow') && L.birds.birds.some((b) => b.sp === 'gull'));
  for (let k = 0; k < 90; k++) { w.wind.t += 1 / 30; L.frame(1 / 30, null); }
  const f = L.fish.fish.find((q) => q.sp === 'herring');
  w.events.emit('explosion', { x: f.x, z: f.z, radius: 3, kind: 'grenade' });
  assert.ok(L.fish.stunned >= 1, 'underwater blast stuns');
  const g0 = L.birds.census().ground || 0;
  w.events.emit('shot', { from: { x: 30, z: 60 }, to: { x: 35, z: 60 }, hit: false, weapon: 'rifle' });
  assert.ok((L.birds.census().flee || 0) >= g0, 'gunshot flushes the crows');
  w.water.wakes.onSplash?.(10, 10, 1);
  const t0 = JSON.stringify(L.fish.fish.slice(0, 5).map((q) => [q.x, q.z]));
  L.frame(1 / 30, null); // sim time unchanged (paused) → nothing moves
  assert.equal(JSON.stringify(L.fish.fish.slice(0, 5).map((q) => [q.x, q.z])), t0);
  L.dispose();
  w.events.emit('explosion', { x: 20, z: 20, radius: 3 });
});

test('instanced models: geometry budgets, capture tags, culling, soft bed shadows', () => {
  for (const sp of Object.keys(FISH_SPECIES)) assert.ok(fishGeometry(FISH_SPECIES[sp]).index.count / 3 < 260, `${sp} fish triangles`);
  for (const sp of ['gull', 'crow', 'mallard', 'eider']) assert.ok(birdGeometry(sp).index.count / 3 < 200, `${sp} triangles`);
  const sim = new FishSim(fishPlan([{ type: 'sea', spots, area: 2200 }], 'snow', 5), pond(), 2);
  const her = sim.fish.filter((f) => f.sp === 'herring'), h = createFishMesh('herring', her.length);
  assert.ok(h.mesh.userData.waterIgnore && h.mesh.userData.dynamic && !h.mesh.castShadow);
  assert.equal(writeFish(h, her, null), her.length);
  const half = writeFish(h, her, (x) => x < 30);
  assert.equal(half, her.filter((f) => f.x < 30).length, 'culled to the view');
  assert.ok(h.anim.array[1] > 0, 'tail amplitude uploaded');
  const sh = createFishShadows(sim.fish.length);
  assert.equal(writeFishShadows(sh, sim.fish, null, { x: 0.3, y: 0.5, z: 0.4 }, 1), sim.fish.length);
  assert.ok(sh.op.array[0] > 0 && sh.op.array[0] < 0.6);
  const bs = new BirdSim([{ kind: 'gull', sp: 'gull', x: 30, z: 20, n: 3 }], birdEnv(4), 1), bh = createBirdMesh('gull', 3);
  assert.equal(writeBirds(bh, bs.birds, null), 3);
  assert.ok(bh.mesh.customDepthMaterial, 'folded / flapping wings cast matching shadows');
});
