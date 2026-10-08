/**
 * Animal prints (user 2026-10-08: "Dog is leaving human footprints"). A guard dog leaves paw prints, never boot prints:
 *  - the visual trail (art/terrain.js stampWorld): a man stamps alternating boot prints ('walker'), a dog its paws —
 *    the real dog one print per paw touchdown of the gait clip playing (art/unit-model.js pawFalls, dogkit
 *    measurePawContacts), a dog without a built skeleton and the BCD animals by their gait table ('animal');
 *  - the prints are small (a paw, not a sole), in the dog's own pattern: the trot in diagonal pairs, each hind paw
 *    landing near its fore print, all four within a narrow straddle — a man's two lines of boots are wider apart;
 *  - on the real dog GLBs (node, no textures): every gait clip's footfalls are measured where the skinned pads really
 *    stand, at the frame they come down;
 *  - gameplay: the 'footprint' event and the stored print say what made it (`foot`); a German's own dog's prints stay
 *    harmless (never AI-visible, as his own boot prints), a commando's boots are intruder tracks as before;
 *  - walking crows set their feet down as small bird prints (env.footfall).
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { stampWorld } from '../../src/art/terrain.js';
import { TrailSystem, ANIMAL_GAITS } from '../../src/art/terrain/trails.js';
import { measureGroundSpeeds, measurePawContacts, createDog, PAWS } from '../../src/art/characters/guests/dogkit.js';
import { footOf } from '../../src/ai/footprints.js';
import { makeWorld, addCommando, addEnemy, run } from './ai-harness.mjs';
import { T } from '../../src/world/grid.js';
import { BirdSim } from '../../src/world/bird-sim.js';

const grid = { cell: 1, cols: 100, rows: 100, terrain: new Uint8Array(100 * 100) };
function stubTerrain() {
  const calls = [];
  return { calls, stampTrail: (kind, x, z, heading, o) => calls.push({ kind, x, z, heading, ...o }) };
}

test('stampWorld: a guard dog stamps paw prints (its real paws\' touchdowns, else its gait), a man boot prints', () => {
  const man = { id: 1, alive: true, path: [1], x: 10, z: 10, y: 0, heading: 0, stance: 'stand', moveMode: 'walk' };
  const dog = { id: 2, alive: true, path: [1], x: 20, z: 10, y: 0, heading: 0, stance: 'stand', soldierType: 'dog', speed: 1.3 };
  const falls = [{ x: 30.4, z: 10.07, side: -1, fore: true, w: 0.045, l: 0.057 }, { x: 29.85, z: 9.92, side: 1, fore: false, w: 0.052, l: 0.055 }];
  const real = { id: 3, alive: true, path: [1], x: 30, z: 10, y: 0, heading: 0, stance: 'stand', soldierType: 'dog', model: { pawFalls: [...falls] } };
  const lion = { id: 4, alive: true, path: [1], x: 40, z: 10, y: 0, heading: 0, stance: 'stand', soldierType: 'lion' };
  const t = stubTerrain();
  stampWorld(t, { commandos: [man], enemies: [dog, real, lion], vehicles: [] }, grid);
  const of = (id) => t.calls.filter((c) => c.id === 'u' + id);
  assert.deepEqual(of(1).map((c) => c.kind), ['walker'], 'the man: boot prints');
  assert.deepEqual(of(2).map((c) => `${c.kind}:${c.foot}`), ['animal:dog'], 'a dog without a skeleton: paw prints by its gait table');
  assert.deepEqual(of(3).map((c) => `${c.kind}:${c.foot}`), ['paw:dog', 'paw:dog'], 'the real dog: one paw print per footfall');
  assert.deepEqual(of(3).map((c) => [c.x, c.z, c.side]), falls.map((f) => [f.x, f.z, f.side]), 'printed where its paws stood');
  assert.ok(of(3).every((c) => c.width < 0.08 && c.length < 0.08), 'paw-sized');
  assert.equal(real.model.pawFalls.length, 0, 'footfalls drained');
  assert.deepEqual(of(4).map((c) => `${c.kind}:${c.foot}`), ['animal:lion'], 'BCD lion: its own prints');
  assert.ok(t.calls.every((c) => c.record === false), 'visual only');
  assert.ok(!t.calls.some((c) => c.kind === 'walker' && c.id !== 'u1'), 'no boots for an animal');
  // a dog that stopped / was carried off: its last footfalls are dropped, nothing stamped
  real.path = null; real.model.pawFalls.push(falls[0]);
  const t2 = stubTerrain();
  stampWorld(t2, { commandos: [], enemies: [real], vehicles: [] }, grid);
  assert.equal(t2.calls.length, 0);
  assert.equal(real.model.pawFalls.length, 0);
  assert.equal(footOf(man), 'boot'); assert.equal(footOf(dog), 'dog'); assert.equal(footOf({ soldierType: 'ostrich' }), 'ostrich');
});

/** TrailSystem stamping on a stub (no GL): the quads it pushes, with the stamp's centre / size / side. */
function trailStub() {
  const pushed = [];
  const stub = Object.create(TrailSystem.prototype);
  Object.assign(stub, { sources: new Map(), stats: { stamps: 0 }, _record() {}, onStep: null,
    _push(kind, x, z, c, s, len, qw, fw, odo, depth, berm, side) { pushed.push({ kind, x, z, len, qw, fw, side, depth, n: stub.frame }); } });
  stub.frame = 0;
  return { stub, pushed };
}
const SNOW = { snow: 0.97, soft: 0.157, coh: 0.88, name: 'snow' }, FIRM = { snow: 0, soft: 0.02, coh: 0.7, name: 'dirt' };

test('a trotting dog\'s paw prints: small, in diagonal pairs, each hind paw near its fore print, a narrow track — a man\'s boots are not', () => {
  const { stub, pushed } = trailStub();
  const v = 1.3, dt = 1 / 60;
  for (let i = 0; i < 4 / (v * dt); i++) { stub.frame = i; stub._animalSteps(i * v * dt, 0, 0, { id: 'u2', foot: 'dog', speed: v }, FIRM); }
  assert.ok(pushed.length >= 16, `prints over 4 m (${pushed.length})`);
  assert.ok(pushed.every((p) => p.kind === 7), 'paw prints (trail kind 7)');
  assert.ok(pushed.every((p) => p.fw < 0.075 && p.len / 1.5 < 0.08), `paw-sized (≤ 7.5 × 8 cm): ${pushed[0].fw} × ${(pushed[0].len / 1.5).toFixed(3)}`);
  const L = ANIMAL_GAITS.dog.trot.L;
  assert.ok(Math.abs(pushed.length - (4 / L) * 4) <= 4, `four prints a stride of ${L} m (${pushed.length})`);
  // diagonal pairs: within a few frames a left fore and a right hind (or the reverse) touch down together
  const fore = (p) => p.fw < 0.06;   // the fore prints are the narrower ones (ANIMAL_GAITS.dog)
  for (let k = 0; k + 1 < pushed.length - 1; k += 2) {
    const a = pushed[k], b = pushed[k + 1];
    assert.ok(Math.abs(a.n - b.n) <= 3, `pair ${k}: together (frames ${a.n}, ${b.n})`);
    assert.ok(a.side === -b.side, `pair ${k}: one left, one right`);
    assert.ok(fore(a) !== fore(b), `pair ${k}: a fore and a hind paw`);
  }
  // each hind print lands within 12 cm of the same side's last fore print (the trot's register)
  let near = 0, n = 0;
  for (const h of pushed.filter((p) => p.fw > 0.06)) {
    const f = pushed.filter((p) => p.fw < 0.06 && p.side === h.side && p.n <= h.n).at(-1);
    if (!f) continue;
    n++; if (Math.hypot(h.x - f.x, h.z - f.z) < 0.12) near++;
  }
  assert.ok(n >= 6 && near === n, `hind on fore (${near}/${n})`);
  const zs = pushed.map((p) => p.z), straddle = Math.max(...zs) - Math.min(...zs);
  // the man's boots on the same line
  const man = trailStub();
  for (let i = 0; i < 4 / (1.4 * dt); i++) man.stub._steps('walk', i * 1.4 * dt, 0, 0, { id: 'u1' }, FIRM);
  assert.ok(man.pushed.length >= 4 && man.pushed.every((p) => p.kind === 2 && p.fw >= 0.2 && p.len >= 0.34), 'boot prints');
  const mz = man.pushed.map((p) => p.z), mStraddle = Math.max(...mz) - Math.min(...mz);
  assert.ok(straddle < 0.17 && straddle < mStraddle * 0.8, `dog straddle ${straddle.toFixed(3)} m < man ${mStraddle.toFixed(3)} m`);
  const area = (p, pad) => p.fw * p.len / pad;
  assert.ok(area(pushed[0], 1.5) < 0.1 * area(man.pushed[0], 1), 'a paw print is a fraction of a boot print');
  // deep soft snow: the paw sinks and the hole widens (as a boot's), still far smaller than a boot's
  const deep = trailStub();
  for (let i = 0; i < 2 / (v * dt); i++) deep.stub._animalSteps(i * v * dt, 0, 0, { id: 'u2', foot: 'dog', speed: v }, SNOW);
  assert.ok(deep.pushed.every((p) => p.kind === 7 && p.fw > 0.07 && p.fw < 0.1), `snow hole ${deep.pushed[0].fw.toFixed(3)} m`);
  // walk and gallop use their own tables; birds and the ostrich their own print styles (|side| = style)
  const st = (foot) => { const s = trailStub(); for (let i = 0; i < 300; i++) s.stub._animalSteps(i * 0.02, 0, 0, { id: foot, foot }, FIRM); return s.pushed; };
  assert.ok(st('dog').every((p) => Math.abs(p.side) === 1));
  assert.ok(st('lion').every((p) => Math.abs(p.side) === 2 && p.fw > 0.1), 'lion: big cat prints');
  assert.ok(st('chicken').every((p) => Math.abs(p.side) === 3 && p.fw < 0.07), 'chicken: small bird prints');
  assert.ok(st('ostrich').every((p) => Math.abs(p.side) === 4), 'ostrich: two-toed prints');
});

// ------------------------------------------------------------------ the real dogs (GLB in node: bones and skin only)

const A = new URL('../../assets/characters/dogs/', import.meta.url).pathname;
async function dogTpl(id) {
  const buf = readFileSync(A + id + '.glb'), ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const L = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  L.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));
  const g = await new Promise((res, rej) => L.parse(ab, '', res, rej));
  const tpl = { gltf: g, clips: new Map(g.animations.map((c) => [c.name, c])), meta: JSON.parse(readFileSync(A + id + '.sidecar.json', 'utf8')) };
  tpl.groundSpeed = measureGroundSpeeds(tpl);
  tpl.pawContacts = measurePawContacts(tpl);
  return tpl;
}

test('real dogs: every gait clip\'s footfalls — each paw once a cycle, the trot in diagonal pairs, prints under the real pads as they come down', async () => {
  for (const id of ['dog_a', 'dog_b', 'dog_c']) {
    const tpl = await dogTpl(id), C = tpl.pawContacts;
    assert.ok(C, `${id}: contacts measured`);
    assert.deepEqual(Object.keys(C.clips).sort(), ['run', 'sniff_walk', 'trot', 'walk'], `${id}: every gait`);
    for (const p of C.paws) assert.ok(p.w > 0.03 && p.w < 0.08 && p.l > 0.03 && p.l < 0.08, `${id} ${p.name}: paw ${p.w.toFixed(3)} × ${p.l.toFixed(3)} m`);
    for (const [name, c] of Object.entries(C.clips)) {
      assert.deepEqual(c.steps.map((s) => s.paw).sort(), [0, 1, 2, 3], `${id} ${name}: each paw lands once a cycle`);
      const lat = c.steps.map((s) => s.x);
      assert.ok(Math.max(...lat) - Math.min(...lat) < 0.17, `${id} ${name}: narrow straddle`);
    }
    const tr = C.clips.trot.steps, at = (n) => tr.find((s) => PAWS[s.paw] === n).t / C.clips.trot.dur;
    const ph = (a, b) => { const d = Math.abs(at(a) - at(b)) % 1; return Math.min(d, 1 - d); };
    assert.ok(ph('fpaw_l', 'hpaw_r') < 0.06 && ph('fpaw_r', 'hpaw_l') < 0.06, `${id} trot: diagonal pairs (${ph('fpaw_l', 'hpaw_r').toFixed(2)}, ${ph('fpaw_r', 'hpaw_l').toFixed(2)})`);
    assert.ok(ph('fpaw_l', 'fpaw_r') > 0.4, `${id} trot: the pairs alternate`);
  }
  // dog_a moving at its gaits' pace: each footfall's print vs the skinned pads of that paw (lowest skin), frame by frame
  const tpl = await dogTpl('dog_a');
  const v = new THREE.Vector3();
  for (const [gait, sp] of [['walk', 0.55], ['sniff_walk', 0.3], ['trot', 1.3], ['run', 2.8]]) {
    const d = createDog(tpl);
    let mesh = null; d.object.traverse((o) => { if (o.isSkinnedMesh && o.name === 'LOD0') mesh = o; });
    const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight, idx = {};
    for (const n of PAWS) {
      const bi = mesh.skeleton.bones.findIndex((b) => b.name === n); idx[n] = [];
      for (let i = 0; i < si.count; i++) { let w = 0; for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k); if (w > 0.5) idx[n].push(i); }
    }
    const pads = (n) => {
      const P = idx[n].map((i) => { mesh.getVertexPosition(i, v); return v.clone().applyMatrix4(mesh.matrixWorld); });
      const y0 = Math.min(...P.map((p) => p.y)), low = P.filter((p) => p.y < y0 + 0.012);
      return { x: low.reduce((a, p) => a + p.x, 0) / low.length, z: low.reduce((a, p) => a + p.z, 0) / low.length, y: y0 };
    };
    d.setAnim(gait, { speed: sp, fade: 0 });
    let z = 0; const live = [];
    for (let i = 0; i < 180; i++) {
      z += sp / 60; d.update(1 / 60); d.object.updateMatrixWorld(true);
      for (const f of d.takeFootfalls()) live.push({ ...f, wz: f.z + z, n: 0, best: 9 });
      for (const f of live) {
        if (f.n++ > 8) continue;
        const p = pads(f.paw), e = Math.hypot(p.x - f.x, p.z + z - f.wz);
        if (f.n === 1) { f.e0 = e; f.h0 = p.y; }
        f.best = Math.min(f.best, e);
      }
    }
    const done = live.filter((f) => f.n > 8);
    assert.ok(done.length >= (gait === 'sniff_walk' ? 4 : 8), `${gait}: footfalls (${done.length})`);
    for (const f of done) {
      assert.ok(f.best < 0.012, `${gait} ${f.paw}: the print is where the pads stand (${(f.best * 100).toFixed(1)} cm)`);
      assert.ok(f.e0 < 0.035, `${gait} ${f.paw}: at the touchdown frame the pads are on it (${(f.e0 * 100).toFixed(1)} cm)`);
      if (gait !== 'run') assert.ok(f.h0 < 0.03, `${gait} ${f.paw}: the pads are down (${(f.h0 * 100).toFixed(1)} cm up)`); // (the gallop clip's paws dip through the ground)
    }
  }
});

// ------------------------------------------------------------------ gameplay prints

test('§4.8 gameplay prints say what made them: a German\'s dog\'s paws are harmless, a commando\'s boots are tracks', () => {
  const w = makeWorld({});
  w.grid.terrain.fill(T.SNOW);
  const c = addCommando(w, 'driver', 20, 30);
  const dog = addEnemy(w, { id: 'dog1', soldierType: 'dog', x: 20, z: 50, heading: 0 });
  dog.brain = { update() {}, serialize: () => null };   // walked by the test, not its post
  const evs = [];
  w.events.on('footprint', (p) => evs.push(p));
  c.moveTo(32, 30); dog.moveTo(32, 50);
  run(w, 10);
  const mine = evs.filter((e) => e.owner === c), its = evs.filter((e) => e.owner === dog);
  assert.ok(mine.length >= 8 && its.length >= 8, `prints on snow (${mine.length} boots, ${its.length} paws)`);
  assert.ok(mine.every((e) => e.foot === 'boot' && e.aiVisible), 'the commando: boot prints, intruder tracks');
  assert.ok(its.every((e) => e.foot === 'dog' && !e.aiVisible), 'the guard dog: paw prints, its own side\'s (no TRACKS)');
  const stored = w.ai.footprints.list.filter((p) => p.ownerId === dog.id);
  assert.ok(stored.length >= 8 && stored.every((p) => p.foot === 'dog' && !p.aiVisible), 'stored as paw prints');
  assert.equal(w.ai.footprints.query(26, 50, 10).length, 0, 'no AI-visible print on the dog\'s line');
  const saved = w.ai.footprints.serialize();
  w.ai.footprints.deserialize(saved);
  assert.ok(w.ai.footprints.list.some((p) => p.foot === 'dog') && w.ai.footprints.list.some((p) => p.foot === 'boot'), 'save / load keeps the foot');
});

test('walking crows set their feet down as small bird prints (env.footfall; none on a perch)', () => {
  const fields = []; for (let x = 2; x < 58; x += 2) for (let z = 10; z < 50; z += 2) fields.push([x, z]);
  const prints = [];
  const env = { wind: (x, z, out) => { out[0] = 2; out[1] = 0; }, water: () => null, ground: () => 0, fields, perches: [],
    splash() {}, ripple() {}, footfall: (x, z, yaw, sp, side) => prints.push({ x, z, yaw, sp, side }) };
  const sim = new BirdSim([{ kind: 'crow', sp: 'crow', x: 30, z: 30, n: 4 }], env, 8);
  for (let k = 0; k < 40 * 30; k++) sim.step(1 / 30);
  assert.ok(prints.length > 20, `crow prints (${prints.length})`);
  assert.ok(prints.every((p) => p.sp === 'crow' && Math.abs(p.side) === 1 && Number.isFinite(p.x + p.z + p.yaw)));
  assert.ok(prints.some((p) => p.side > 0) && prints.some((p) => p.side < 0), 'both feet');
});
