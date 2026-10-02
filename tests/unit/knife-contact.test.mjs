/**
 * Contact knife kill (user 2026-10-02: "When killing someone from behind it should look like you are stabbing the front
 * neck from behind. When stabbing from the front it should look as if there is no distance"): abilities/knife-contact.js
 * (sim) + art/knife-kill.js (the paired poses).
 *
 *  - front / behind: the attacker within ±70° of the victim's back is "behind", anything else "front"
 *  - the sim: at reach he steps in (0.1–0.3 s, never through the victim) to body contact — 0.41 m behind him facing
 *    his way, or 0.31 m in front facing him — the victim is held where he stands (no slide, no turn, even with a
 *    route), the kill comes 0.3 s after the step, silent; from behind the corpse lies on its face ahead of him, from the
 *    front it is pushed back off the blade; no room (a wall behind him, water, another level): the classic stab
 *  - the poses on the real bodies (Green Beret and a German rifleman GLB in node): at the hit frame the torsos touch
 *    (chest-to-back / chest-to-chest surface gap within a few cm), the left palm is on his mouth, the knife tip is at
 *    his throat (from behind) / in his belly (from the front) — hands placed by IK on his own bones
 */
import { test, assert, near } from './lib.mjs';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { makeSim, guard } from './abilsim.mjs';
import { CONFIG } from '../../src/config.js';
import { B as BLOCK } from '../../src/world/grid.js';
import { knifeSide, contactPlan, stepAt, CONTACT, knifeTimes } from '../../src/abilities/knife-contact.js';
import { knifeKillFrame, pairMetrics, contactMarks } from '../../src/art/knife-kill.js';
import { BoneGuard } from '../../src/art/pose-blend.js';
import { equip } from '../../src/art/characters/pipeline/weapons.js';
import { adaptClip } from '../../src/art/characters/pipeline/charkit.js';
import { headingToRotY } from '../../src/core/math.js';

const K = CONFIG.abilities.knife;
const DEG = Math.PI / 180;

test('front / behind: within ±70° of his back is behind, anything else front (any heading)', () => {
  for (const h of [0, 1, -2.5, Math.PI]) {
    const v = { x: 5, z: 5, heading: h };
    const at = (deg) => ({ x: 5 + Math.cos(h + Math.PI + deg * DEG) * 1.1, z: 5 + Math.sin(h + Math.PI + deg * DEG) * 1.1 });
    for (const d of [0, 30, -30, 69, -69]) assert.equal(knifeSide(at(d), v), 'behind', `h ${h}, ${d}° off his back`);
    for (const d of [71, -71, 90, -90, 135, 180]) assert.equal(knifeSide(at(d), v), 'front', `h ${h}, ${d}° off his back`);
  }
});

/** Sim with the Green Beret `d` m from a guard at (20, 20) facing east, at `deg` degrees off the guard's back. */
function setup(deg, d = 4, extra = {}) {
  const gx = 20, gz = 20, a = Math.PI + deg * DEG;
  const s = makeSim({ commandos: [{ role: 'greenberet', x: gx + Math.cos(a) * d, z: gz + Math.sin(a) * d, heading: a + Math.PI }],
    enemies: [guard('e1', gx, gz, 0)], ...extra }, { brains: false });
  return { s, gb: s.cmd('greenberet'), e: s.get('e1') };
}

/** Run a knife order; per tick: the action's record, both men's positions; stops 1 s after the kill. */
function runKill(s, gb, e, run = false) {
  const rows = [];
  let start = null, kill = null;
  s.world.events.on('ability:start', (p) => { if (p.id === 'knife' && start == null) start = s.world.time; });
  s.world.events.on('unit:killed', (p) => { if (p.unit === e) kill = s.world.time; });
  assert.ok(gb.issue({ type: 'ability', id: 'knife', target: e, run }), 'knife order');
  for (let i = 0; i < 900 && (kill == null || s.world.time < kill + 1); i++) {
    s.step();
    rows.push({ t: s.world.time, gx: gb.x, gz: gb.z, gh: gb.heading, ex: e.x, ez: e.z, eh: e.heading, alive: e.alive, act: gb.currentActionId });
  }
  return { rows, start, kill, rec: (s.world.knifeKills || []).find((r) => r.v === e) || null };
}

test('behind: the step in to chest-on-back contact, held victim, kill 0.3 s after the step, prone corpse ahead, silent', () => {
  const { s, gb, e } = setup(25);
  const { rows, start, kill, rec } = runKill(s, gb, e);
  assert.ok(rec && rec.side === 'behind', 'contact kill from behind');
  const P = rec.plan;
  assert.ok(P.close >= CONTACT.close[0] - 1e-9 && P.close <= CONTACT.close[1] + 1e-9, `step ${P.close.toFixed(3)} s`);
  near(kill - start, P.close + K.hit, 1 / 60 + 1e-9, 'the kill 0.3 s after the step');
  const hit = rows.find((r) => r.t >= kill - 1e-9);
  // at the hit: right behind him (his facing), body contact distance, both facing his way
  near(Math.hypot(hit.gx - P.v.x, hit.gz - P.v.z), CONTACT.behind, 1e-6, 'contact distance');
  const bx = P.v.x - Math.cos(P.v.h) * CONTACT.behind, bz = P.v.z - Math.sin(P.v.h) * CONTACT.behind;
  near(Math.hypot(hit.gx - bx, hit.gz - bz), 0, 1e-6, 'straight behind him');
  near(Math.atan2(Math.sin(hit.gh - P.v.h), Math.cos(hit.gh - P.v.h)), 0, 1e-6, 'facing his way');
  // the step: smooth (no teleport) and never through him
  const act = rows.filter((r) => r.t > start && r.t <= kill);
  for (let i = 1; i < act.length; i++) assert.ok(Math.hypot(act[i].gx - act[i - 1].gx, act[i].gz - act[i - 1].gz) <= CONTACT.speed * 1.6 / 60 + 1e-6, 'smooth step');
  for (const r of act) assert.ok(Math.hypot(r.gx - P.v.x, r.gz - P.v.z) >= CONTACT.behind - 1e-6, 'never closer than contact');
  // the victim is held: not one mm of slide or a turn from the start to the hit
  for (const r of rows.filter((q) => q.t >= start && q.alive)) {
    near(Math.hypot(r.ex - P.v.x, r.ez - P.v.z), 0, 1e-9, 'held');
    near(r.eh, P.v.h, 1e-9, 'not turned');
  }
  // he pitches forward onto his face, away from the attacker
  assert.equal(e.alive, false); assert.equal(e.deathCause, 'knife');
  assert.equal(e.stance, 'crawl', 'lies on his belly (prone corpse)');
  const ahead = (e.x - P.v.x) * Math.cos(P.v.h) + (e.z - P.v.z) * Math.sin(P.v.h);
  assert.ok(ahead > 0.6, `corpse ahead of where he stood (${ahead.toFixed(2)} m)`);
  assert.equal(s.count('noise'), 0, 'silent');
});

test('behind: the victim is held even when his brain walks him off (a patrol mid-step)', () => {
  const { s, gb, e } = setup(0, 1.15);
  // a route he keeps walking (brain stub: move him each tick as a patrol would)
  e.brain.update = () => { if (!e.path) e.moveTo(e.x + 6, e.z); };
  const { rows, start, rec } = runKill(s, gb, e);
  assert.ok(rec, 'contact kill');
  const held = rows.filter((r) => r.t >= start && r.alive);
  assert.ok(held.length > 10, 'held for the step and the stab');
  for (const r of held) near(Math.hypot(r.ex - rec.plan.v.x, r.ez - rec.plan.v.z), 0, 1e-9, 'no slide while held');
  assert.equal(e.alive, false);
});

test('front: face to face at no distance, he turns to the blade, is pushed back off it and falls on his back', () => {
  for (const deg of [180, 120, 90]) {   // straight on, and from his side (he turns to face the attacker)
    const { s, gb, e } = setup(deg);
    const { rows, kill, rec } = runKill(s, gb, e);
    assert.ok(rec && rec.side === 'front', `${deg}°: a frontal contact kill`);
    const P = rec.plan, hit = rows.find((r) => r.t >= kill - 1e-9);
    near(Math.hypot(hit.gx - P.v.x, hit.gz - P.v.z), CONTACT.front, 1e-6, `${deg}°: chest-to-chest distance`);
    const face = Math.atan2(P.v.z - hit.gz, P.v.x - hit.gx);
    near(Math.atan2(Math.sin(hit.gh - face), Math.cos(hit.gh - face)), 0, 1e-6, `${deg}°: the attacker faces him`);
    near(Math.atan2(Math.sin(P.vh - (face + Math.PI)), Math.cos(P.vh - (face + Math.PI))), 0, 1e-6, `${deg}°: he turned to face the attacker`);
    assert.equal(e.stance, 'stand', 'falls on his back (the standing death)');
    const back = Math.hypot(e.x - P.v.x, e.z - P.v.z);
    assert.ok(back > 0.5 && back < 1.2, `${deg}°: pushed back off the blade (${back.toFixed(2)} m)`);
  }
});

test('no room for contact: a wall behind him, the Marine knifing from the water, a dog → the classic stab', () => {
  // a wall right behind his back: the contact spot is in it
  const { s, gb, e } = setup(25);
  const g = s.world.grid;
  for (let dz = -1.5; dz <= 1.5; dz += 0.25) { const i = Math.floor((20 - 0.45) / g.cell), j = Math.floor((20 + dz) / g.cell); g.block[j * g.cols + i] = BLOCK.HIGH; }
  assert.equal(contactPlan(s.world, { x: 18.9, z: 19.6, heading: 0, stance: 'stand', y: 0 }, e), null, 'no contact spot in the wall');
  // a wall right in front of him (no room to pitch forward, straight or diagonal): no contact kill from behind
  const t2 = setup(25), g2 = t2.s.world.grid;
  for (let dz = -2; dz <= 2; dz += 0.25) for (const dx of [0.6, 0.85]) { const i = Math.floor((20 + dx) / g2.cell), j = Math.floor((20 + dz) / g2.cell); g2.block[j * g2.cols + i] = BLOCK.HIGH; }
  assert.equal(contactPlan(t2.s.world, { x: 18.9, z: 19.6, heading: 0, stance: 'stand', y: 0 }, t2.e), null, 'nowhere to fall');
  // the knife still kills the classic way (stab at arm's length, the kill at 0.3 s)
  let start = null, kill = null;
  t2.s.world.events.on('ability:start', () => { start ??= t2.s.world.time; });
  t2.s.world.events.on('unit:killed', () => { kill ??= t2.s.world.time; });
  assert.ok(t2.gb.issue({ type: 'ability', id: 'knife', target: t2.e }));
  t2.s.run(6, () => !t2.e.alive);
  assert.equal(t2.e.alive, false, 'killed');
  near(kill - start, K.hit, 1 / 60 + 1e-9, 'classic: kill at 0.3 s');
  assert.ok(!(t2.s.world.knifeKills || []).length, 'no contact record');
  // a dog, a man prone, the switch off
  assert.equal(contactPlan(s.world, gb, { ...e, soldierType: 'dog', kind: 'enemy', x: e.x, z: e.z, heading: 0 }), null, 'dog');
  assert.equal(contactPlan(s.world, gb, { ...e, stance: 'crawl', kind: 'enemy', x: e.x, z: e.z, heading: 0 }), null, 'prone victim');
  assert.equal(contactPlan(s.world, { ...gb, underwater: true, x: gb.x, z: gb.z, heading: 0, stance: 'stand' }, e) === null, true, 'from the water');
  CONFIG.abilities.knife.contact = false;
  try { assert.equal(contactPlan(s.world, { x: 18.9, z: 19.6, heading: 0, stance: 'stand', y: 0 }, setup(25).e), null, 'switch off'); }
  finally { CONFIG.abilities.knife.contact = true; }
});

test('timing: the step is 0.1–0.3 s at a lunge; hit = step + 0.3 s, end = step + 0.6 s; classic unchanged', () => {
  const { s, gb, e } = setup(0, 1.2);
  gb.setPosition(e.x - 1.19, e.z, 0);
  const P = contactPlan(s.world, gb, e);
  assert.ok(P);
  const T = knifeTimes(P), C = knifeTimes(null);
  near(T.hit - T.close, K.hit, 1e-9); near(T.dur - T.close, K.dur, 1e-9);
  near(C.hit, K.hit, 1e-9); near(C.dur, K.dur, 1e-9);
  near(P.close, (1.19 - CONTACT.behind) / CONTACT.speed, 1e-9, 'a lunge');
  const p0 = stepAt(P, 0), p1 = stepAt(P, P.close);
  near(p0.x, gb.x, 1e-9); near(p1.x, P.to.x, 1e-9); near(p1.z, P.to.z, 1e-9);
});

// ------------------------------------------------------------------ the poses on the real bodies

const A = new URL('../../assets/characters/', import.meta.url).pathname;
async function glb(path) {
  const buf = readFileSync(A + path), ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const L = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  L.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));   // node: geometry and bones only
  return new Promise((res, rej) => L.parse(ab, '', res, rej));
}
/** The pipeline's shadowSix userData of a GLB (on the scene or one of its nodes). */
const meta = (sc) => { let u = sc.userData.shadowSix || null; if (!u) sc.traverse((o) => { if (!u && o.userData?.shadowSix) u = o.userData.shadowSix; }); return u || {}; };
let LIB = null;
async function lib() {
  if (LIB) return LIB;
  const [anims, weapons] = await Promise.all([glb('anims/base_anims.glb'), glb('weapons/weapons.glb')]);
  const rest = meta(anims.scene).pelvisRest;
  LIB = { anims, weapons, srcPelvisRest: rest ? new THREE.Vector3(...rest) : null };
  return LIB;
}
/** A UnitModel-shaped body (the parts art/knife-kill.js reads) on a character GLB, its clips from the UAL library. */
async function body(path, id) {
  const L = await lib(), g = await glb(path);
  const root = new THREE.Group(), bodyG = new THREE.Group(); bodyG.name = 'body'; root.add(bodyG); bodyG.add(g.scene);
  const bones = {}; g.scene.traverse((o) => { if (o.isBone && !(o.name in bones)) bones[o.name] = o; });
  const info = meta(g.scene), cache = new Map();
  const clip = (n) => {   // the library clip adapted to this body as the character runtimes do (pipeline/charkit.js)
    if (cache.has(n)) return cache.get(n);
    const c0 = L.anims.animations.find((c) => c.name === n);
    const c = c0 ? adaptClip(c0, { srcPelvisRest: L.srcPelvisRest, tgtPelvisRest: info.pelvisRest ? new THREE.Vector3(...info.pelvisRest) : null, ratio: info.pelvisRatio || 1 }) : null;
    cache.set(n, c); return c;
  };
  const inner = { bones, object: g.scene, clip, _post: [], weapon: null, setAnim() {} };
  const m = { root, characterId: id, real: { inner, getSocket: (n) => bones[n] || null }, fallback: null, _guard: new BoneGuard(),
    _body: () => bodyG, _mw: new THREE.Matrix4(), setAnim() {}, update() {} };
  return m;
}
/** The "mixer": his clip pose at frame t (only the bones a clip drives), after the guard put back last frame's writes. */
function mixer(m, name, t) {
  m._guard.restore();
  const c = m.real.inner.clip(name), B = m.real.inner.bones;
  for (const tr of c.tracks) {
    const i = tr.name.lastIndexOf('.'), b = B[tr.name.slice(0, i)], p = tr.name.slice(i + 1);
    if (b && (p === 'quaternion' || p === 'position')) b[p].fromArray(tr.createInterpolant().evaluate(Math.min(t, c.duration - 1e-5)));
  }
}
function place(m, u) {
  m.root.position.set(u.x, 0, u.z); m.root.rotation.set(0, headingToRotY(u.heading), 0);
  m.root.updateMatrixWorld(true);
}

/** Run a knife kill with both real bodies drawn every tick; the metrics at the hit frame. */
async function poseRun(deg) {
  const { s, gb, e } = setup(deg);
  const am = await body('commandos/greenberet.glb', 'gb'), vm = await body('enemies/rifleman_v12.glb', 'rifleman_v12');
  const L = await lib();
  const knife = L.weapons.scene.getObjectByName('knife');
  mixer(am, 'idle', 0); mixer(vm, 'idle', 0); place(am, gb); place(vm, e);
  equip(am.real.inner, { knife: { root: knife, sockets: {} } }, 'knife', { clip: 'stab' });
  gb.model = am; e.model = vm;
  let hitM = null, start = null, kill = null, maxRoot = 0;
  s.world.events.on('ability:start', () => { start ??= s.world.time; });
  s.world.events.on('unit:killed', () => { kill ??= s.world.time; });
  assert.ok(gb.issue({ type: 'ability', id: 'knife', target: e }));
  for (let i = 0; i < 600 && (kill == null || s.world.time < kill + 0.5); i++) {
    s.step();
    mixer(am, gb.currentActionId === 'knife' ? 'stab' : 'idle', 0.2); mixer(vm, 'idle', 0);
    place(am, gb); place(vm, e);
    knifeKillFrame(s.world, 1, 1 / 60);
    const rec = (s.world.knifeKills || [])[0];
    if (rec && start != null && e.alive) maxRoot = Math.max(maxRoot, Math.hypot(vm.root.position.x - rec.plan.v.x, vm.root.position.z - rec.plan.v.z));
    if (kill != null && !hitM) hitM = { ...pairMetrics(gb, e), side: rec?.side };
  }
  return { m: hitM, maxRoot, marks: { a: contactMarks(am), v: contactMarks(vm) } };
}

test('poses (real bodies): from behind the torsos touch, the left palm is on his mouth, the knife tip at his throat', async () => {
  const { m, maxRoot, marks } = await poseRun(20);
  assert.ok(m && m.side === 'behind', 'contact kill from behind drawn');
  console.log(`  knife from behind at the hit: torso ${m.torso.toFixed(3)} m, gap ${m.gap.toFixed(3)} m, palm-mouth ${m.palmMouth.toFixed(3)} m, tip-throat ${m.tipThroat.toFixed(3)} m`);
  assert.ok(marks.a.chestZ > 0.12 && marks.v.backZ < -0.15, `body depths: his chest ${marks.a.chestZ.toFixed(3)}, the German's back ${marks.v.backZ.toFixed(3)}`);
  assert.ok(m.gap <= 0.02 && m.gap >= -0.06, `chest on his back: surface gap ${m.gap.toFixed(3)} m`);
  assert.ok(m.torso <= 0.45, `torsos (spine_03) ${m.torso.toFixed(3)} m apart — the bodies' own depth (chest + back)`);
  assert.ok(m.palmMouth <= 0.05, `left palm on his mouth: ${m.palmMouth.toFixed(3)} m`);
  assert.ok(m.tipThroat != null && m.tipThroat <= 0.05, `knife tip at the front of his throat: ${m.tipThroat?.toFixed(3)} m`);
  near(maxRoot, 0, 1e-6, 'his drawn root held where he stood');
});

test('poses (real bodies): from the front no gap — chests touching, the blade in his belly at zero distance', async () => {
  const { m } = await poseRun(180);
  assert.ok(m && m.side === 'front', 'frontal contact kill drawn');
  console.log(`  knife from the front at the hit: roots ${m.root.toFixed(3)} m, chest gap ${m.gap.toFixed(3)} m, tip-belly ${m.tipBelly.toFixed(3)} m`);
  assert.ok(m.gap <= 0.03 && m.gap >= -0.06, `chest to chest: surface gap ${m.gap.toFixed(3)} m (${JSON.stringify(m)})`);
  assert.ok(m.root <= 0.35, `${m.root.toFixed(3)} m between them`);
  assert.ok(m.tipBelly != null && m.tipBelly <= 0.05, `knife tip in his belly: ${m.tipBelly?.toFixed(3)} m`);
});
