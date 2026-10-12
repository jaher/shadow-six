/**
 * Ducks (src/world/duck-water.js, src/art/duck-model.js, src/art/duck-wake.js): user request "make the ducks more
 * realistic (as seen in mission 1)". Eiders and mallards stepped at 60 Hz on a fjord-like pond: a loose flock with
 * spacing, eased paddling, riding the chop, activities (preen, rest, dive / up-end, flap), alarm, the eider's take-off
 * run with splashes and the mallard's jump, formation flight, the glide-in and skid landing, determinism; the model
 * (budget, plumage per sex, wing spread / fold, hidden divers) and the V wakes.
 */
import { test, assert } from './lib.mjs';
import { BirdSim } from '../../src/world/bird-sim.js';
import { DUCK_HABITS, chop } from '../../src/world/duck-water.js';
import { duckGeometry, createDuckMesh, writeDucks, DUCK_SPECIES } from '../../src/art/duck-model.js';
import { createDuckWakes, wakeSpeed } from '../../src/art/duck-wake.js';

/** 80 × 60 m fjord arm: 3 m deep offshore, shelving to the banks; wind `ws` m/s towards +x. */
function fjord(ws = 3, o = {}) {
  const body = { o: { type: 'lake', preset: 'fjord' } };
  const ev = { splash: 0, disturb: 0, ripple: 0, flush: 0, call: 0 };
  const env = {
    ev, wind: (x, z, out) => { out[0] = ws; out[1] = 0; },
    water: (x, z) => {
      if (x < 0 || x > 80 || z < 0 || z > 60) return null;
      const shore = Math.min(x, 80 - x, z, 60 - z);
      return { depth: Math.min(3, 0.3 + shore * 0.35), shore, flow: [0, 0], level: -0.1, ice: false, body };
    },
    ground: (x, z) => (x < 0 || x > 80 || z < 0 || z > 60 ? 0.2 : -1.5),
    fields: [], perches: [], bounds: [-10, -10, 90, 70],
    splash() { ev.splash++; }, ripple() { ev.ripple++; }, disturb() { ev.disturb++; }, flush() { ev.flush++; }, call() { ev.call++; },
    ...o,
  };
  return env;
}
const eiders = (n = 8, x = 40, z = 30) => [{ kind: 'duck', sp: 'eider', x, z, n, body: 0 }];
const mallards = (n = 5, x = 40, z = 30) => [{ kind: 'duck', sp: 'mallard', x, z, n, body: 0 }];
const H = 1 / 60;
const step = (sim, s, f) => { for (let k = 0; k < Math.round(s / H); k++) { sim.step(H); f?.(k); } };

test('spawn: a loose raft of eiders on open water, drakes and hens mixed, ~1.5 body lengths apart', () => {
  const sim = new BirdSim(eiders(10), fjord(), 11), D = sim.birds;
  assert.equal(D.length, 10);
  assert.ok(D.every((b) => b.st === 'swim' && b.kind === 'duck' && fjord().water(b.x, b.z)));
  const hens = D.filter((b) => b.hen).length;
  assert.ok(hens >= 2 && hens <= 8, `hens ${hens}/10`);
  let minD = 9;
  for (const a of D) for (const b of D) if (a !== b) minD = Math.min(minD, Math.hypot(a.x - b.x, a.z - b.z));
  assert.ok(minD > DUCK_HABITS.eider.sep * 0.9, `spacing ${minD.toFixed(2)} m`);
  assert.equal(sim.flocks.length, 1);
  assert.equal(sim.flocks[0].members.length, 10);
});

test('swimming: eased paddling and turns, spacing kept, varied activities, divers hidden then back, inside the water', () => {
  const env = fjord(3), sim = new BirdSim(eiders(8), env, 21), D = sim.birds;
  const prev = D.map((b) => ({ x: b.x, z: b.z, v: b.v, yaw: b.yaw }));
  const acts = new Set(); let maxDv = 0, maxTurn = 0, maxStep = 0, close = 0, samples = 0, hidden = 0, surfaced = 0, wasHidden = new Set();
  step(sim, 240, () => {
    D.forEach((b, i) => {
      const p = prev[i];
      acts.add(b.act);
      if (b.hidden) { hidden++; wasHidden.add(b); } else if (wasHidden.has(b)) { surfaced++; wasHidden.delete(b); }
      if (b.act !== 'dive' && b.st === 'swim') {
        maxDv = Math.max(maxDv, Math.abs(b.v - p.v) / H);
        maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(b.yaw - p.yaw), Math.cos(b.yaw - p.yaw))) / H);
        maxStep = Math.max(maxStep, Math.hypot(b.x - p.x, b.z - p.z) / H);
      }
      assert.ok(env.water(b.x, b.z), 'stays on the water');
      Object.assign(p, { x: b.x, z: b.z, v: b.v, yaw: b.yaw });
    });
    for (const a of D) for (const b of D) if (a !== b && !a.hidden && !b.hidden) { samples++; if (Math.hypot(a.x - b.x, a.z - b.z) < 0.45) close++; }
  });
  assert.ok(D.every((b) => b.st === 'swim'), `all still swimming (${JSON.stringify(sim.census())})`);
  for (const a of ['paddle', 'drift', 'preen']) assert.ok(acts.has(a), `${a} seen (${[...acts]})`);
  assert.ok(acts.has('dive') && acts.has('flap') || acts.has('rest'), `dive / flap / rest seen (${[...acts]})`);
  assert.ok(maxDv < 0.45, `speed eased: max |dv/dt| ${maxDv.toFixed(2)} m/s²`);
  assert.ok(maxTurn < 1.0, `turns eased: max ${maxTurn.toFixed(2)} rad/s`);
  assert.ok(maxStep < 0.8, `paddling pace ≤ 0.8 m/s (max ${maxStep.toFixed(2)})`);
  assert.ok(close / samples < 0.01, `ducks keep apart (${(100 * close / samples).toFixed(2)} % of pairs < 0.45 m)`);
  assert.ok(hidden > 0 && surfaced > 0, `eiders dive (hidden ${hidden} frames) and come back up (${surfaced})`);
  assert.ok(env.ev.ripple > 0, 'paddling leaves faint ripples');
  // the flock stays together: everyone within 6 m of the middle
  const cx = D.reduce((a, b) => a + b.x, 0) / D.length, cz = D.reduce((a, b) => a + b.z, 0) / D.length;
  assert.ok(D.every((b) => Math.hypot(b.x - cx, b.z - cz) < 6.5), 'a loose flock');
});

test('riding the chop: a few mm–cm of heave and a few degrees of rocking, neighbours out of step', () => {
  const sim = new BirdSim(eiders(6), fjord(4), 5), D = sim.birds;
  const ys = D.map(() => []);
  step(sim, 20, () => D.forEach((b, i) => { if (b.act !== 'dive' && b.act !== 'flap' && !b.hidden) ys[i].push([b.y, b.wp, b.roll]); }));
  for (const s of ys) {
    if (s.length < 200) continue;
    const y = s.map((q) => q[0]), lo = Math.min(...y), hi = Math.max(...y);
    assert.ok(hi - lo > 0.004 && hi - lo < 0.06, `heave ${(hi - lo).toFixed(3)} m`);
    assert.ok(Math.max(...s.map((q) => Math.abs(q[1]))) < 0.12 && Math.max(...s.map((q) => Math.abs(q[2]))) < 0.12, 'rocking ≤ 7°');
  }
  const o = [0, 0, 0];
  const a = chop(sim, 10, 10, o)[0], b = chop(sim, 10.6, 10.3, o)[0];
  assert.ok(Math.abs(a - b) > 1e-4, 'the waves travel across the water (phase changes with position)');
});

test('alarm: someone walking up just outside the wary radius → necks up, the flock swims off; closer → it flushes', () => {
  const env = fjord(2), sim = new BirdSim(eiders(6), env, 3), D = sim.birds;
  step(sim, 3);
  const c = [D.reduce((a, b) => a + b.x, 0) / 6, D.reduce((a, b) => a + b.z, 0) / 6], R = DUCK_HABITS.eider ? D[0].S.wary : 12;
  const T = { x: c[0] - R * 1.45, z: c[1], moving: true };
  sim.setThreats([T]);
  const d0 = D.map((b) => b.x);
  step(sim, 2.5);
  const alert = D.filter((b) => b.act === 'alert');
  assert.ok(alert.length >= 3, `alert ${alert.length}/6`);
  assert.ok(alert.every((b) => b.neckU > 0.05), 'necks stretched up');
  assert.ok(D.filter((b, i) => b.x > d0[i]).length >= 4, 'swimming away from the danger');
  assert.equal(sim.census().flee || 0, 0, 'no flush yet');
  T.x = c[0] - R * 0.6;
  step(sim, 0.8);
  assert.ok((sim.census().flee || 0) >= 5, `flushed ${JSON.stringify(sim.census())}`);
});

test('eider take-off: a startled beat, then a run across the water with wing slaps and pattering feet, lift-off at speed', () => {
  const env = fjord(0.2), sim = new BirdSim(eiders(6), env, 9), D = sim.birds;
  step(sim, 3);
  const under = D.filter((b) => b.act === 'dive' && b.dv >= 1); // a diver hears nothing; it comes up later
  const n = sim.noise(D[0].x - 20, D[0].z, 60);
  assert.ok(n >= 1, `flushed ${n}`);
  const runs = new Map();
  step(sim, 4, () => {
    for (const b of D) {
      if (b.run && b.run.t >= 0) { const r = runs.get(b) || { x0: b.x, z0: b.z, vmax: 0, ymax: -9, frames: 0, amp: 0 }; r.vmax = Math.max(r.vmax, b.v); r.ymax = Math.max(r.ymax, b.y); r.frames++; r.x1 = b.x; r.z1 = b.z; r.amp = Math.max(r.amp, b.amp); runs.set(b, r); }
    }
  });
  assert.ok(runs.size >= 6 - under.length, `the whole flock runs off (contagion): ${runs.size}, ${under.length} under water`);
  for (const r of runs.values()) {
    const d = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    assert.ok(d > 2.5 && d < 10, `run ${d.toFixed(1)} m`);
    assert.ok(r.vmax > 5.5, `lift-off speed ${r.vmax.toFixed(1)} m/s`);
    assert.ok(r.ymax < -0.1 + 0.1, 'pattering on the surface, not flying');
    assert.ok(r.frames / 60 > 0.9 && r.frames / 60 < 1.8, `run ${(r.frames / 60).toFixed(2)} s`);
    assert.ok(r.amp > 0.9, 'full wingbeats');
  }
  assert.ok(env.ev.splash >= runs.size, `a splash per take-off (${env.ev.splash})`);
  assert.ok(env.ev.disturb > runs.size * 10, `wing slaps + foot pattering (${env.ev.disturb})`);
  const up = [...runs.keys()];
  assert.ok(up.every((b) => !b.run && (b.st === 'flee' || b.st === 'fly') && b.y > 0.3), `airborne (${up.map((b) => b.st + ':' + b.y.toFixed(1))})`);
  assert.ok(up.every((b) => b.y < 6), 'eiders fly low over the water');
});

test('flight in formation, then the flock glides in and skids onto the water together', () => {
  const env = fjord(3), sim = new BirdSim(eiders(5), env, 13), D = sim.birds;
  step(sim, 2);
  sim.noise(D[0].x + 15, D[0].z + 5, 60);
  let airSpacing = 9, slotErr = [], seq = D.map(() => []), skids = [], jumps = 0;
  const last = D.map((b) => [b.x, b.y, b.z]);
  step(sim, 90, (k) => {
    D.forEach((b, i) => {
      const s = seq[i]; if (s[s.length - 1] !== b.st) s.push(b.st);
      if (b.st === 'skid' && s[s.length - 2] === 'final' && !b._seenSkid) { b._seenSkid = true; skids.push(b.v); }
      if (b.st !== 'skid') b._seenSkid = false;
      const [x, y, z] = last[i], dd = Math.hypot(b.x - x, b.y - y, b.z - z) / H;
      if (dd > 20) jumps++;
      last[i] = [b.x, b.y, b.z];
    });
    const air = D.filter((b) => b.st === 'fly' && !b.run);
    if (k % 30 === 0 && air.length >= 2) for (const a of air) for (const b of air) if (a !== b) airSpacing = Math.min(airSpacing, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    const F = sim.flocks[0], L = F.lead;
    if (k % 30 === 0 && L && L.st === 'fly') for (const b of air) if (b !== L && b.slotLead === L) {
      const c = Math.cos(L.yaw), s = Math.sin(L.yaw), side = b.slot % 2 ? 1 : -1, rank = Math.ceil(b.slot / 2);
      const back = 1.7 * rank + 0.35 * ((b.slot * 7) % 3), lat = side * 1.15 * rank;
      slotErr.push(Math.hypot(L.x - c * back - s * lat - b.x, L.z - s * back + c * lat - b.z));
    }
  });
  assert.equal(jumps, 0, 'no teleports (≤ 20 m/s between steps)');
  assert.ok(airSpacing > 0.9, `never on top of each other in the air (min ${airSpacing.toFixed(2)} m)`);
  slotErr.sort((a, b) => a - b);
  assert.ok(slotErr.length > 5 && slotErr[slotErr.length >> 1] < 3, `followers hold their slots (median error ${slotErr[slotErr.length >> 1]?.toFixed(2)} m)`);
  assert.ok(D.filter((b) => b.st === 'swim').length >= 4, `back on the water (${JSON.stringify(sim.census())})`);
  assert.ok(skids.length >= 4 && skids.every((v) => v >= 0.8 && v <= 4), `skid landings at ${skids.map((v) => v.toFixed(1))} m/s`);
  for (const s of seq) if (s.includes('skid')) assert.ok(s.join(',').includes('final,skid,swim'), `final → skid → swim (${s})`);
  const cx = D.reduce((a, b) => a + b.x, 0) / D.length, cz = D.reduce((a, b) => a + b.z, 0) / D.length;
  assert.ok(D.filter((b) => Math.hypot(b.x - cx, b.z - cz) < 10).length >= 4, 'landed together');
});

test('mallards: up-end to feed, spring straight up off the water when flushed', () => {
  const env = fjord(1), sim = new BirdSim(mallards(5), env, 7), D = sim.birds;
  let dab = 0;
  step(sim, 120, () => { for (const b of D) dab = Math.max(dab, b.dab); });
  assert.ok(dab > 0.9, `tail up (dab ${dab.toFixed(2)})`);
  assert.ok(D.every((b) => !b.hidden), 'mallards do not dive');
  sim.noise(D[0].x - 15, D[0].z, 60);
  let vy = 0;
  step(sim, 1.5, () => { for (const b of D) vy = Math.max(vy, b.vy); });
  assert.ok(vy > 3, `jump take-off (vy ${vy.toFixed(1)} m/s)`);
});

test('deterministic: same seed, same ducks', () => {
  const tr = (seed) => { const sim = new BirdSim(eiders(6), fjord(3), seed); step(sim, 30); sim.noise(40, 20, 60); step(sim, 20); return sim.birds.map((b) => [b.x.toFixed(5), b.y.toFixed(5), b.z.toFixed(5), b.st, b.act].join()).join('|'); };
  assert.equal(tr(4), tr(4));
  assert.notEqual(tr(4), tr(5));
});

test('model: budget, parts, spread wings span the species span, folded wings lie on the body', () => {
  for (const sp of Object.keys(DUCK_SPECIES)) {
    const g = duckGeometry(sp), S = new BirdSim([], fjord()).env && { eider: 1.0, mallard: 0.9 }[sp];
    assert.ok(g.index.count / 3 < 360, `${sp} ${g.index.count / 3} triangles`);
    for (const a of ['aWing', 'aFold', 'aPat', 'aPart', 'normal']) assert.ok(g.attributes[a], `${sp} ${a}`);
    const P = g.attributes.position, W = g.attributes.aWing, F = g.attributes.aFold;
    let zmax = 0, fz = 0, fy = -9, ymin = 9;
    for (let i = 0; i < P.count; i++) {
      if (W.getY(i) !== 0) { zmax = Math.max(zmax, Math.abs(P.getZ(i))); fz = Math.max(fz, Math.abs(F.getZ(i))); fy = Math.max(fy, F.getY(i)); }
      ymin = Math.min(ymin, P.getY(i));
    }
    assert.ok(Math.abs(zmax * 2 - S) < 0.02, `${sp} span ${(zmax * 2).toFixed(2)} m`);
    assert.ok(fz < 0.13 && fy < 0.12, `${sp} folded wings on the body (|z| ≤ ${fz.toFixed(3)}, y ≤ ${fy.toFixed(3)})`);
    assert.ok(ymin < -0.05, `${sp} rides low: the hull reaches ${ymin.toFixed(3)} m below the waterline`);
  }
  const sim = new BirdSim(eiders(4), fjord(), 2), h = createDuckMesh('eider', 4);
  sim.birds[1].hidden = true;
  assert.equal(writeDucks(h, sim.birds, null), 3, 'divers under water are not drawn');
  const hens = sim.birds.filter((b) => !b.hidden).map((b) => (b.hen ? 1 : 0));
  assert.deepEqual([...h.plum.array.slice(0, 3)], hens, 'plumage per sex');
  assert.ok(h.mesh.customDepthMaterial && h.duck, 'shadow material runs the same animation');
});

test('sounds: a quiet call now and then (≥ 5 s apart), one take-off flurry per flock, nothing with "Nature sounds" off', async () => {
  const { MockAudioContext, EventBus } = await import('./audio-mock.mjs');
  const { createAudio } = await import('../../src/audio/audio.js');
  const { SFX } = await import('../../src/audio/manifest.js');
  const { synth } = await import('../../src/audio/synth.js');
  const events = new EventBus(), clock = { t: 0 };
  const audio = createAudio(events, { createContext: () => new MockAudioContext(), now: () => clock.t, rand: () => 0.1, autoUnlock: false, loadAssets: false });
  audio.unlock();
  const played = (id) => audio.log.filter((l) => l.name === id);
  events.emit('ambient:call', { x: 3, z: 4, species: 'eider', hen: false });
  events.emit('ambient:call', { x: 5, z: 4, species: 'eider', hen: true });
  assert.equal(played('eider_coo').length, 1, 'the drake coos');
  assert.equal(played('eider_grunt').length, 0, 'a second call within 5 s is skipped');
  clock.t = 6; events.emit('ambient:call', { x: 5, z: 4, species: 'eider', hen: true });
  assert.equal(played('eider_grunt').length, 1, 'the hen grunts');
  clock.t = 12; events.emit('ambient:call', { x: 5, z: 4, species: 'mallard', hen: true });
  assert.equal(played('mallard_quack').length, 1);
  for (let k = 0; k < 6; k++) events.emit('ambient:flush', { x: k, z: 0, species: 'eider', kind: 'duck' });
  events.emit('ambient:flush', { x: 0, z: 0, species: 'crow', kind: 'crow' });
  assert.equal(played('duck_takeoff').length, 1, 'one flurry for the flock, none for crows');
  for (const id of ['eider_coo', 'eider_grunt', 'mallard_quack', 'duck_takeoff']) {
    assert.equal(SFX[id].bus, 'ambience', `${id} on the ambience bus`);
    assert.ok(SFX[id].gain <= 0.16, `${id} quiet (${SFX[id].gain})`);
    const b = synth(SFX[id].recipe, 22050, 1);
    assert.ok(b.length > 22050 * 0.3 && !b.some(Number.isNaN), `${id} renders`);
  }
  audio.setOption('natureSounds', false);
  clock.t = 30; events.emit('ambient:call', { x: 5, z: 4, species: 'eider', hen: false }); events.emit('ambient:flush', { x: 0, z: 0, species: 'eider', kind: 'duck' });
  assert.equal(played('eider_coo').length, 1, 'silent with Nature sounds off');
  assert.equal(played('duck_takeoff').length, 1);
});

test('V wakes: two arms open behind a paddling duck and stay on the water when it stops; a foam wash only at speed', () => {
  const W = createDuckWakes(2), S = { len: 0.62 };
  const b = { kind: 'duck', st: 'swim', act: 'paddle', S, x: 10, z: 10, y: -0.1, gy: -0.1, yaw: 0, v: 0.3, hidden: false };
  const still = { kind: 'duck', st: 'swim', act: 'drift', S, x: 20, z: 20, y: -0.1, gy: -0.1, yaw: 0, v: 0, hidden: false };
  let t = 0;
  for (let k = 0; k < 180; k++) { t += 1 / 60; b.x += b.v / 60; W.update([b, still], t, -0.1, null); }
  assert.ok(!W.trails.has(still), 'a still duck leaves no wake');
  const P = W.mesh.geometry.attributes.position, C = W.mesh.geometry.attributes.color, n = W.stats.verts;
  assert.ok(n > 40 && W.mesh.visible && W.mesh.layers.mask === 1 << 11, `ribbons on the late FX layer (${n} verts)`);
  let behind = 0, maxSide = 0, maxA = 0, ahead = 0;
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), z = P.getZ(i), a = C.getW(i);
    if (a < 0.01) continue;
    if (x < b.x) behind++; else if (x > b.x + 0.25) ahead++;
    maxSide = Math.max(maxSide, Math.abs(z - b.z)); maxA = Math.max(maxA, a);
    assert.ok(Math.abs(P.getY(i) - (-0.1 + 0.012)) < 0.005, 'on the water surface');
  }
  assert.ok(behind > 20 && ahead === 0, `arms trail behind the duck (${behind} behind, ${ahead} ahead)`);
  const run = 3 * 0.3, expect = 0.08 + 0.3 * 0.4 * 3; // laid 0.9 m back, crest out at v·tan22° × age
  assert.ok(maxSide > 0.2 && maxSide < expect + 0.15, `the V opens out (${maxSide.toFixed(2)} m to the side after ${run.toFixed(1)} m)`);
  assert.ok(maxA > 0.1 && maxA < 0.5, `faint crests (alpha ≤ ${maxA.toFixed(2)})`);
  // stops: the wake stays where it was laid and fades out
  b.v = 0; const x0 = b.x;
  for (let k = 0; k < 60; k++) { t += 1 / 60; W.update([b], t, -0.1, null); }
  assert.ok(W.stats.verts > 0, 'still there a second after stopping');
  for (let k = 0; k < 300; k++) { t += 1 / 60; W.update([b], t, -0.1, null); }
  assert.equal(W.stats.verts, 0, 'gone after ~3.6 s'); assert.equal(b.x, x0);
  // the take-off run: a dashed foam wash down the middle; a diver under water: nothing
  const r = { ...b, st: 'flee', run: { t: 0.3 }, v: 5, x: 30, z: 30 };
  for (let k = 0; k < 40; k++) { t += 1 / 60; r.x += r.v / 60; W.update([r], t, -0.1, null); }
  let wash = 0; for (let i = 0; i < W.stats.verts; i++) if (Math.abs(P.getZ(i) - 30) < 0.08 && C.getW(i) > 0.05 && C.getX(i) > 0.4) wash++;
  assert.ok(wash > 4, `foam wash at speed (${wash})`);
  assert.equal(wakeSpeed({ ...b, hidden: true, v: 0.3 }), -1);
  assert.equal(wakeSpeed({ ...b, act: 'dive', dv: 1, v: 0.3 }), -1);
  assert.equal(wakeSpeed({ ...b, st: 'fly', v: 9 }), -1);
});

test('a flock flushed near the map edge flies out over the map, not off its edge', () => {
  const env = fjord(1, { bounds: [0, 0, 80, 60] }), sim = new BirdSim(eiders(5, 4, 30), env, 6), D = sim.birds;
  step(sim, 2);
  sim.noise(D[0].x + 20, D[0].z, 60); // the danger is inland: away from it would be off the west edge
  let off = 0;
  step(sim, 25, () => { for (const b of D) if (b.st !== 'swim' && b.x < -6) off++; });
  assert.equal(off, 0, 'never more than 6 m past the edge');
  assert.ok(D.every((b) => b.x > 2), `landed inside the map (${D.map((b) => b.x.toFixed(1))})`);
});

test('no duck pops in or out: what is drawn of each bird changes gradually, frame by frame (dives, surfacing, flushes, landings)', () => {
  // user: "In the duck video it feels like one duck appears out of nowhere" (an eider coming up from a dive was drawn
  // all at once 26 cm under the surface). Visibility of a bird = drawn ? 1 − its submerged fade : 0, from the
  // instance buffers writeDucks fills (no view culling here: every bird is on screen).
  const env = fjord(2), sim = new BirdSim(eiders(8), env, 77), D = sim.birds, h = createDuckMesh('eider', 8);
  const P = new Float32Array(3), M = h.mesh.instanceMatrix.array;
  const visible = () => {
    const n = writeDucks(h, D, null), out = new Map();
    for (let i = 0; i < n; i++) {
      const x = M[i * 16 + 12], y = M[i * 16 + 13], z = M[i * 16 + 14];
      const b = D.find((q) => Math.abs(q.x - x) < 1e-4 && Math.abs(q.y - y) < 1e-4 && Math.abs(q.z - z) < 1e-4);
      if (b) out.set(b, 1 - h.leg1.array[i * 4 + 2]);
    }
    return D.map((b) => out.get(b) ?? 0);
  };
  let prev = visible(), worst = 0, dives = 0, ups = 0, at = '';
  const was = D.map(() => false);
  const check = (k) => {
    const v = visible();
    v.forEach((q, i) => {
      const d = Math.abs(q - prev[i]);
      if (d > worst) { worst = d; at = `bird ${i} frame ${k}: ${prev[i].toFixed(2)} → ${q.toFixed(2)} (${D[i].st}/${D[i].act})`; }
      const under = q < 0.01; if (under && !was[i]) dives++; if (!under && was[i]) ups++; was[i] = under;
    });
    prev = v;
  };
  step(sim, 150, check);
  sim.noise(D[0].x - 20, D[0].z, 60); // the flock flushes, flies round and lands again
  step(sim, 60, check);
  assert.ok(dives >= 2 && ups >= 2, `eiders went under (${dives}) and came back up (${ups})`);
  assert.ok(worst <= 0.2, `largest change in one 60 Hz frame ${worst.toFixed(2)} (${at})`);
});
