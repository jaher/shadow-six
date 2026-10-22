/**
 * The Green Beret's explosive-drum carry (user 2026-10-22, "When green beret walks a barrel does the body move well?":
 * it floated at head height and swallowed his head). Sim: the pick-up steps him in to the drum, he walks it at
 * units.carryBarrel, turns at most abilities.carry.barrel.turnRate and turns round on the spot before walking off,
 * sets it down where he began (as he held it) and steps back off it; a drum laid over a body goes on the body from 0.6 m.
 * Art (real body + the baked clips of ca_anims.glb): the drum read back off his hands (art/barrel-carry.js) keeps clear
 * of his torso, arms, legs and head, its top under his chin, the same off either hand; the lift ends where the hold
 * begins, the walk's planted feet move at the sim speed.
 */
import { test, assert, near } from './lib.mjs';
import * as THREE from 'three';
import { readGlbArrayBuffer } from '../../tools/glb-io.mjs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { makeSim, guard } from './abilsim.mjs';
import { CONFIG } from '../../src/config.js';
import { adaptClip } from '../../src/art/characters/pipeline/charkit.js';
import { drumFromHands, poseCarriedDrum, EASE } from '../../src/art/barrel-carry.js';
import { BARREL_GRIP, BARREL_CLIPS, BARREL_DRUM } from '../../src/art/characters/barrel-grip.js';
import { mapAnim, LOCOMOTION } from '../../src/art/unit-anim-map.js';
import { wrapAngle, angleDiff } from '../../src/core/math.js';
import { clearance } from '../../tools/characters/barrel/fit.mjs';

const BAR = CONFIG.abilities.carry.barrel;
const drumSim = (o = {}) => makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10, heading: 0 }], interactables: [{ kind: 'barrel', id: 'b1', x: 13, z: 10, heading: 1.0 }], ...o }, { brains: false });

/** Order the pick-up; returns {startD, endD, t} (his distance to the drum when the lift starts / ends, lift time). */
function pickUp(s, gb, b) {
  assert.ok(gb.issue({ type: 'ability', id: 'hand', target: b }));
  s.run(6, () => gb.currentActionId === 'hand');
  const startD = Math.hypot(b.x - gb.x, b.z - gb.z), t0 = s.world.time, at = { x: b.x, z: b.z };
  assert.equal(gb._anim, 'barrel_lift', 'the lift clip plays');
  assert.ok(b.pendingLift?.by === gb, 'the drum knows it is being lifted (art/barrel-carry.js)');
  s.run(2, () => gb.carrying === b);
  return { startD, endD: Math.hypot(at.x - gb.x, at.z - gb.z), t: s.world.time - t0 };
}

test('barrel pick-up: he steps in to the drum over the lift, takes it at carry.pick, keeps its turn about its axis', () => {
  const s = drumSim(), gb = s.cmd('greenberet'), b = s.get('b1');
  const r = pickUp(s, gb, b);
  assert.ok(r.startD > 1.0 && r.startD <= CONFIG.abilities.carry.reach + 1e-6, `stopped short of the solid drum (${r.startD.toFixed(2)} m)`);
  near(r.endD, BAR.stand, 0.035, 'stepped in to `stand` from its centre');
  near(r.t, CONFIG.abilities.carry.pick, 0.02, 'pick-up time');
  near(b.carrySpin, wrapAngle(1.0 - gb.heading), 1e-9, 'its spin = its heading less his');
  s.run(0.1);
  assert.equal(b.pendingLift, null);
  assert.equal(gb._anim, 'carry_barrel_idle');
});

test('barrel carry: carryBarrel pace, turns at most turnRate, turns round on the spot before he walks off', () => {
  const s = drumSim(), gb = s.cmd('greenberet'), b = s.get('b1');
  pickUp(s, gb, b); s.run(0.3);
  assert.equal(gb.speed, CONFIG.units.carryBarrel);
  assert.ok(gb.issue({ type: 'move', x: gb.x - 6, z: gb.z + 0.4 }));    // about-face
  const anims = new Set();
  let maxRate = 0, movedWhileOff = 0, h = gb.heading, x = gb.x, z = gb.z, firstMove = null, n = 0;
  while (gb.path && n++ < 600) {
    s.step();
    const rate = Math.abs(angleDiff(h, gb.heading)) * 60, d = Math.hypot(gb.x - x, gb.z - z);
    const wp = gb.path?.[gb.pathIndex], err = wp ? Math.abs(angleDiff(gb.heading, Math.atan2(wp.z - gb.z, wp.x - gb.x))) : 0;
    maxRate = Math.max(maxRate, rate);
    if (err > BAR.pivot[1] + 0.06 && d > 1e-6) movedWhileOff++;
    if (firstMove == null && d > 1e-4) firstMove = n / 60;
    anims.add(gb._anim);
    h = gb.heading; x = gb.x; z = gb.z;
  }
  assert.ok(maxRate <= BAR.turnRate * 1.0001, `turn rate ${(maxRate * 180 / Math.PI).toFixed(0)} deg/s`);
  assert.ok(maxRate > BAR.turnRate * 0.9, 'he did turn at the cap');
  assert.equal(movedWhileOff, 0, 'no headway while still turned away');
  assert.ok(firstMove > 0.3, `turned round before walking off (${firstMove?.toFixed(2)} s)`);
  assert.ok(anims.has('carry_barrel_turn') && anims.has('carry_barrel'), [...anims].join(','));
});

test('barrel set-down: on the spot ahead of where he began, as he held it; he steps back off it', () => {
  const s = drumSim(), gb = s.cmd('greenberet'), b = s.get('b1');
  pickUp(s, gb, b);
  assert.ok(gb.issue({ type: 'move', x: 16, z: 14 })); s.run(10, () => !gb.path); s.run(0.3);
  const x0 = gb.x, z0 = gb.z, h = gb.heading, spin = b.carrySpin;
  assert.ok(gb.useAbility('drop', gb));
  assert.equal(gb._anim, 'barrel_put_down');
  const spot = b.pendingDrop?.spot;
  assert.ok(spot, 'the set-down spot is known from the start');
  near(spot.x, x0 + Math.cos(h) * 0.6, 1e-9); near(spot.z, z0 + Math.sin(h) * 0.6, 1e-9);
  s.run(2, () => !gb.carrying);
  assert.equal(b.carriedBy, null);
  near(b.x, spot.x, 1e-9, 'stood where the clip put it down'); near(b.z, spot.z, 1e-9);
  near(b.heading, wrapAngle(h + spin), 1e-9, 'turned with him');
  near(Math.hypot(gb.x - x0, gb.z - z0), BAR.back, 0.01, 'stepped back');
  assert.ok(Math.hypot(gb.x - b.x, gb.z - b.z) > 0.7);
  s.run(0.1);
  assert.equal(b.pendingDrop, null);
});

test('barrel over a body: he walks to 0.6 m short of it and lowers the drum onto it', () => {
  const s = drumSim({ enemies: [guard('d', 18, 13)] }), gb = s.cmd('greenberet'), b = s.get('b1'), d = s.get('d');
  d.die('knife', null);
  pickUp(s, gb, b);
  assert.ok(gb.issue({ type: 'ability', id: 'hand', target: d }));
  s.run(10, () => gb.currentActionId === 'hand');
  near(Math.hypot(d.x - gb.x, d.z - gb.z), 0.6, 0.12, 'stands 0.6 m short of the body');
  assert.equal(gb._anim, 'barrel_put_down');
  s.run(2, () => !gb.carrying);
  near(b.x, d.x, 1e-9); near(b.z, d.z, 1e-9);
  assert.ok(d.hiddenUnderBarrel);
});

test('barrel carry: deterministic, and a save keeps its spin', () => {
  const run = () => {
    const s = drumSim(), gb = s.cmd('greenberet'), b = s.get('b1');
    pickUp(s, gb, b);
    gb.issue({ type: 'move', x: 6, z: 14 }); s.run(8, () => !gb.path);
    gb.useAbility('drop', gb); s.run(2, () => !gb.carrying);
    return [gb.x, gb.z, gb.heading, b.x, b.z, b.heading];
  };
  assert.deepEqual(run(), run());
  const s = drumSim(), gb = s.cmd('greenberet'), b = s.get('b1');
  pickUp(s, gb, b);
  const d = b.serialize();
  assert.equal(d.carrySpin, b.carrySpin);
  b.carrySpin = 0; b.deserialize(d);
  near(b.carrySpin, d.carrySpin, 0);
});

test('barrel anims: the hold, turn, lift and set-down map to the barrel clips (carry clips as the fallback)', () => {
  assert.deepEqual(mapAnim('carry_barrel'), ['barrel_walk', 'carry_walk']);
  assert.deepEqual(mapAnim('carry_barrel_idle'), ['barrel_idle', 'carry_idle']);
  assert.equal(mapAnim('carry_barrel_turn')[0], 'barrel_turn');
  assert.equal(mapAnim('barrel_lift')[0], 'barrel_lift');
  assert.equal(mapAnim('barrel_put_down')[0], 'barrel_put_down');
  assert.ok(LOCOMOTION.has('carry_barrel'));
  for (const n of ['barrel_idle', 'barrel_walk', 'barrel_turn', 'barrel_lift', 'barrel_put_down']) assert.ok(BARREL_CLIPS[n], n);
});

// ------------------------------------------------------------------ the drum on the hands (art/barrel-carry.js)

/** Hand bones placed so that the drum read off them is at (p, q). */
function handsFor(p, q) {
  const root = new THREE.Group(), D = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)), H = {};
  for (const s of ['l', 'r']) {
    const G = new THREE.Matrix4().compose(new THREE.Vector3(...BARREL_GRIP[s].p), new THREE.Quaternion(...BARREL_GRIP[s].q), new THREE.Vector3(1, 1, 1));
    const b = new THREE.Bone(); b.name = 'hand_' + s;
    D.clone().multiply(G.invert()).decompose(b.position, b.quaternion, b.scale);
    root.add(b); H[s] = b;
  }
  root.updateMatrixWorld(true);
  return H;
}
const fakeCarrier = (H, clip, heading = 0) => ({ heading, y: 0, model: { clip, real: { inner: { bones: { hand_l: H.l, hand_r: H.r } } } } });

test('barrel-carry: the drum is read back off the hand bones (BARREL_GRIP), spun by its own turn', () => {
  const p = new THREE.Vector3(3, 0.6, -2), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.7, 0.05));
  const H = handsFor(p, q), P = new THREE.Vector3(), Q = new THREE.Quaternion();
  drumFromHands(H, 0, P, Q);
  near(P.distanceTo(p), 0, 1e-5); near(Q.angleTo(q), 0, 1e-5);
  drumFromHands(H, 0.5, P, Q);
  near(P.distanceTo(p), 0, 1e-5);
  near(Q.angleTo(q), 0.5, 1e-5, 'spun about its axis');
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(Q), axis0 = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  near(axis.angleTo(axis0), 0, 1e-5, 'about its own axis');
});

test('barrel-carry: on the ground until his hands reach it, then on them; set down onto the spot by the release', () => {
  const hold = new THREE.Vector3(0.1, 0.6, 0.66), H = handsFor(hold, new THREE.Quaternion());
  const c = fakeCarrier(H, 'barrel_lift', Math.PI / 2);
  const o = new THREE.Group(); o.position.set(0, 0, 0.74);
  const b = { object3d: o, carriedBy: null, pendingLift: { by: c, t: 0.2, dur: 1 }, pendingDrop: null, heading: Math.PI / 2, carrySpin: 0 };
  assert.ok(poseCarriedDrum(b));
  near(o.position.distanceTo(new THREE.Vector3(0, 0, 0.74)), 0, 1e-9, 'before contact: where it stands');
  o.position.set(0, 0, 0.74); b.pendingLift.t = BARREL_CLIPS.barrel_lift.contact + EASE.lift + 0.01;
  poseCarriedDrum(b);
  near(o.position.distanceTo(hold), 0, 1e-6, 'after contact + ease: on his hands');
  c.model.clip = 'barrel_put_down';
  Object.assign(b, { pendingLift: null, carriedBy: c, carrySpin: 0, pendingDrop: { by: c, t: 0.0, dur: 0.8, spot: { x: 0, z: 1.2 } } });
  poseCarriedDrum(b);
  near(o.position.distanceTo(hold), 0, 1e-6, 'on his hands while he lowers it');
  b.pendingDrop.t = BARREL_CLIPS.barrel_put_down.release;
  poseCarriedDrum(b);
  near(o.position.distanceTo(new THREE.Vector3(0, 0, 1.2)), 0, 1e-6, 'on its spot by the release');
  c.model.clip = 'idle';
  assert.equal(poseCarriedDrum(b), false, 'not a barrel clip: left to the sim / the pelvis ride');
});

// ------------------------------------------------------------------ the baked clips on his real body

const A = new URL('../../assets/characters/', import.meta.url).pathname;
async function glb(path) {
  const L = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  L.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));
  return new Promise((res, rej) => L.parse(readGlbArrayBuffer(A + path), '', res, rej));
}
const meta = (sc) => { let u = sc.userData.shadowSix || null; if (!u) sc.traverse((o) => { if (!u && o.userData?.shadowSix) u = o.userData.shadowSix; }); return u || {}; };
let GB = null;
async function gbBody() {
  if (GB) return GB;
  const [base, ca, g] = await Promise.all([glb('anims/base_anims.glb'), glb('anims/ca_anims.glb'), glb('commandos/greenberet.glb')]);
  const info = meta(g.scene), src = meta(base.scene).pelvisRest, cam = meta(ca.scene).clips || {};
  const bones = {}; g.scene.traverse((o) => { if (o.isBone && !(o.name in bones)) bones[o.name] = o; });
  const meshes = []; g.scene.traverse((o) => { if (o.isSkinnedMesh && /^(LOD0|LOD0_alpha|headgear)$/.test(o.name)) meshes.push(o); });
  const clips = {};
  for (const c of ca.animations) if (/^barrel_/.test(c.name)) {
    clips[c.name] = adaptClip(c, { srcPelvisRest: new THREE.Vector3(...src), tgtPelvisRest: new THREE.Vector3(...info.pelvisRest), ratio: info.pelvisRatio || 1 });
  }
  const rig = { meshes, update: () => g.scene.updateMatrixWorld(true) };
  GB = { g, bones, clips, meta: cam, info, rig };
  return GB;
}
function pose(B, name, t) {
  const c = B.clips[name];
  for (const tr of c.tracks) {
    const i = tr.name.lastIndexOf('.'), b = B.bones[tr.name.slice(0, i)], p = tr.name.slice(i + 1);
    if (b && (p === 'quaternion' || p === 'position')) b[p].fromArray(tr.createInterpolant().evaluate(Math.min(t, c.duration - 1e-5)));
  }
  B.g.scene.updateMatrixWorld(true);
}
const drumAt = (B) => {
  const P = new THREE.Vector3(), Q = new THREE.Quaternion();
  drumFromHands({ l: B.bones.hand_l, r: B.bones.hand_r }, 0, P, Q);
  return { P, Q, M: new THREE.Matrix4().compose(P, Q, new THREE.Vector3(1, 1, 1)) };
};
const oneHand = (B, s) => new THREE.Matrix4().multiplyMatrices(B.bones['hand_' + s].matrixWorld, new THREE.Matrix4().compose(new THREE.Vector3(...BARREL_GRIP[s].p), new THREE.Quaternion(...BARREL_GRIP[s].q), new THREE.Vector3(1, 1, 1)));

test('barrel clips (real body): the drum on his hands keeps clear of torso / arms / legs / head, top under his chin', async () => {
  const B = await gbBody();
  const worst = { body: 1, hand: 1, chin: 1, hands: 0 };
  const lift = BARREL_CLIPS.barrel_lift, put = BARREL_CLIPS.barrel_put_down;
  const plan = [['barrel_idle', 0, 1], ['barrel_walk', 0, 1], ['barrel_turn', 0, 1], ['barrel_lift', lift.contact + 0.05, 1], ['barrel_put_down', 0, put.release - 0.03]];
  for (const [name, a, b] of plan) {
    const dur = B.clips[name].duration;
    for (let k = 0; k <= 10; k++) {
      const t = name === 'barrel_lift' || name === 'barrel_put_down' ? a + (b - a) * (k / 10) : (dur * k) / 10;
      pose(B, name, t);
      const D = drumAt(B), c = clearance(B.rig, D.M, { r: BARREL_DRUM.r, h: BARREL_DRUM.h });
      worst.body = Math.min(worst.body, c.torso.min, c.arm.min, c.leg.min, c.head.min);
      worst.hand = Math.min(worst.hand, c.handL.min, c.handR.min);
      const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(D.Q);
      const top = D.P.y + ax.y * BARREL_DRUM.h + BARREL_DRUM.r * Math.sqrt(Math.max(0, 1 - ax.y * ax.y));
      if (D.P.y > 0.3) worst.chin = Math.min(worst.chin, c.chin - top);
      const pl = new THREE.Vector3().setFromMatrixPosition(oneHand(B, 'l')), pr = new THREE.Vector3().setFromMatrixPosition(oneHand(B, 'r'));
      worst.hands = Math.max(worst.hands, pl.distanceTo(pr));
    }
  }
  console.log(`  barrel clips: closest body vertex ${(worst.body * 100).toFixed(1)} cm, hand ${(worst.hand * 100).toFixed(1)} cm, drum top under the chin >= ${(worst.chin * 100).toFixed(1)} cm, hands agree within ${(worst.hands * 1000).toFixed(1)} mm`);
  assert.ok(worst.body >= -0.01, `no torso / arm / leg / head vertex more than 1 cm inside the drum (${(worst.body * 100).toFixed(1)} cm)`);
  assert.ok(worst.hand >= -0.015 && worst.hand <= 0.01, `palms on the drum (${(worst.hand * 100).toFixed(1)} cm)`);
  assert.ok(worst.chin >= 0.06, `drum top under his chin (${(worst.chin * 100).toFixed(1)} cm)`);
  assert.ok(worst.hands <= 0.015, `the drum read off either hand is the same (${(worst.hands * 1000).toFixed(1)} mm)`);
});

test('barrel clips (real body): the lift ends and the set-down starts in the hold; the walk keeps pace with the sim', async () => {
  const B = await gbBody();
  pose(B, 'barrel_idle', 0); const h0 = drumAt(B).P.clone(), hl = B.bones.hand_l.getWorldPosition(new THREE.Vector3());
  pose(B, 'barrel_lift', 1.0); near(drumAt(B).P.distanceTo(h0), 0, 0.01, 'lift end = hold'); near(B.bones.hand_l.getWorldPosition(new THREE.Vector3()).distanceTo(hl), 0, 0.01);
  pose(B, 'barrel_put_down', 0); near(drumAt(B).P.distanceTo(h0), 0, 0.01, 'set-down start = hold');
  pose(B, 'barrel_put_down', BARREL_CLIPS.barrel_put_down.release); const pd = drumAt(B).P;
  near(pd.y, 0, 0.02, 'on the ground at the release'); near(pd.z, BARREL_CLIPS.barrel_put_down.d, 0.03, 'dropSpot distance (with his step back after)');
  pose(B, 'barrel_lift', BARREL_CLIPS.barrel_lift.contact); const pl = drumAt(B).P;
  near(pl.y, 0, 0.02, 'hands on the drum on the ground'); near(pl.z, BARREL_CLIPS.barrel_lift.d, 0.03, 'at `stand` from his root');
  // the walk: the planted foot moves back at the sim pace once played at speed / (groundSpeed × his pelvisRatio)
  const m = B.meta.barrel_walk, ratio = B.info.pelvisRatio || 1;
  near(m.groundSpeed * ratio, CONFIG.units.carryBarrel, 0.01, 'played at 1× at the carry pace');
  const dur = B.clips.barrel_walk.duration, zs = [];
  for (let k = 0; k < 30; k++) { pose(B, 'barrel_walk', (dur * k) / 30); const a = B.bones.ball_l.getWorldPosition(new THREE.Vector3()); zs.push([a.y, a.z]); }
  const low = Math.min(...zs.map((q) => q[0])), planted = zs.map((q, k) => [k, q]).filter(([, q]) => q[0] < low + 0.01);
  const v = (planted[0][1][1] - planted.at(-1)[1][1]) / ((planted.at(-1)[0] - planted[0][0]) * dur / 30);
  near(v, CONFIG.units.carryBarrel, 0.12, `planted foot speed in the clip (${v.toFixed(2)} m/s)`);
});
