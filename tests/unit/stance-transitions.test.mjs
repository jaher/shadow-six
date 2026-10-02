/**
 * Stance transitions (user 2026-10-01: the knife crawl-in "stand-up has no rise animation, so the model snaps from
 * prone to idle"; smooth, realistic movement): go_prone / get_up are one shared path (tools/characters/prone/
 * stance_trans.mjs) - push up on the hands, the right knee under the hip, rock back onto it with the left foot planted,
 * drive up - and its reverse. On the UAL skeleton: the hip rises / falls monotonically through clearly intermediate
 * poses every 0.1 s (no pop), contacts stay on the ground without sliding, nothing levitates, no root motion, and both
 * ends match crawl_idle / idle frame 0. In the game: every unit (commandos and enemies) takes stanceDown 0.5 s /
 * stanceUp 0.6 s without moving, the model picks go_prone / get_up and plays it over exactly that time, and a knife
 * crawl-in keeps the knife in the fist through getting up and the stab.
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { loadUAL } from '../../tools/characters/prone/rig.mjs';
import { CONFIG } from '../../src/config.js';
import { UnitModel } from '../../src/art/unit-model.js';
import { Game } from '../../src/game.js';
import { World } from '../../src/world/world.js';

const ANIMS = new URL('../../assets/characters/anims/', import.meta.url).pathname;
const R = await loadUAL(ANIMS + 'base_anims.glb');
let meta = null; R.scene.traverse((o) => { if (!meta && o.userData.shadowSix) meta = o.userData.shadowSix.clips; });
const clipOf = (n) => R.animations.find((c) => c.name === n);
function poseAt(c, t) {
  for (const tr of c.tracks) {
    const i = tr.name.lastIndexOf('.'), b = R.B[tr.name.slice(0, i)], p = tr.name.slice(i + 1);
    if (b && (p === 'quaternion' || p === 'position')) b[p].fromArray(tr.createInterpolant().evaluate(Math.min(t, c.duration - 1e-5)));
  }
  R.update();
}
const wp = (n) => R.wp(n);
const hip = () => wp('thigh_l').lerp(wp('thigh_r'), 0.5);
const palm = (s) => wp('hand_' + s).lerp(wp('middle_01_' + s), 0.55);
// joint centre -> surface radius (UAL): the lowest of these is the body's ground contact
const CONTACT = [['hand_l', 0.03], ['hand_r', 0.03], ['lowerarm_l', 0.045], ['lowerarm_r', 0.045], ['calf_l', 0.065], ['calf_r', 0.065],
  ['ball_l', 0.02], ['ball_r', 0.02], ['foot_l', 0.06], ['foot_r', 0.06], ['pelvis', 0.12], ['spine_02', 0.13], ['spine_03', 0.14], ['Head', 0.1]];
const lowest = () => Math.min(...CONTACT.map(([n, r]) => wp(n).y - r));
const sampleClip = (n, fps = 30) => {
  const c = clipOf(n), N = Math.round(c.duration * fps) + 1, out = [];
  for (let f = 0; f < N; f++) {
    const t = (f / (N - 1)) * c.duration; poseAt(c, t);
    out.push({ t, hip: hip(), low: lowest(), kneeR: wp('calf_r'), ballL: wp('ball_l'), ballR: wp('ball_r'), palmL: palm('l'), palmR: palm('r'),
      pelvis: wp('pelvis'), head: wp('Head'), handL: wp('hand_l'), footL: wp('foot_l') });
  }
  return out;
};
// hip-joint centre height of crawl_idle / idle frame 0 (UAL)
poseAt(clipOf('crawl_idle'), 0); const PRONE_Y = hip().y;
poseAt(clipOf('idle'), 0); const STAND_Y = hip().y;

test('transition clips: in every library, go_prone = CONFIG stanceDown (0.5 s), get_up = stanceUp (0.6 s), hand contacts', async () => {
  for (const lib of ['base_anims', 'ca_anims', 'commando_anims', 'guest_anims']) {
    const L = lib === 'base_anims' ? R : await loadUAL(ANIMS + lib + '.glb');
    let m = null; L.scene.traverse((o) => { if (!m && o.userData.shadowSix) m = o.userData.shadowSix.clips; });
    for (const [n, T, next] of [['go_prone', CONFIG.units.stanceDown, 'crawl_idle'], ['get_up', CONFIG.units.stanceUp, 'idle']]) {
      const c = L.animations.find((a) => a.name === n);
      assert.ok(c, `${lib}: ${n}`);
      assert.ok(Math.abs(c.duration - T) < 1e-3, `${lib} ${n}: ${c.duration} s vs stance time ${T}`);
      assert.ok(m[n].transition && m[n].prone && m[n].next === next && !m[n].loop, `${lib} ${n} meta`);
      assert.ok(/^\d\d( \d\d)+$/.test(m[n].contacts?.hd || ''), `${lib} ${n}: per-frame hand plant weights`);
    }
  }
});

test('get_up: the hip rises monotonically through intermediate poses every 0.1 s (no pop, no dip back down)', () => {
  const S = sampleClip('get_up');
  for (let i = 1; i < S.length; i++) assert.ok(S[i].hip.y >= S[i - 1].hip.y - 0.01, `hip dips at ${S[i].t.toFixed(3)} s: ${S[i - 1].hip.y.toFixed(3)} -> ${S[i].hip.y.toFixed(3)}`);
  const at = (t) => S[Math.round(t * 30)].hip.y, steps = [0.1, 0.2, 0.3, 0.4, 0.5].map(at);
  assert.ok(steps.filter((y) => y > PRONE_Y + 0.04 && y < STAND_Y - 0.04).length >= 3, 'intermediate heights at 0.1 s steps: ' + steps.map((y) => y.toFixed(2)));
  const all = [0, ...[0.1, 0.2, 0.3, 0.4, 0.5].map((t) => t), 0.6].map((t) => S[Math.round(t * 30)].hip.y);
  for (let i = 1; i < all.length; i++) assert.ok(all[i] - all[i - 1] < 0.3, `0.1 s jump ${all[i - 1].toFixed(2)} -> ${all[i].toFixed(2)}`);
  assert.ok(Math.abs(S[0].hip.y - PRONE_Y) < 0.02 && Math.abs(S.at(-1).hip.y - STAND_Y) < 0.02, 'starts prone, ends standing');
});

test('go_prone: the hip falls monotonically through intermediate poses every 0.1 s', () => {
  const S = sampleClip('go_prone');
  for (let i = 1; i < S.length; i++) assert.ok(S[i].hip.y <= S[i - 1].hip.y + 0.01, `hip bounces at ${S[i].t.toFixed(3)} s`);
  const steps = [0.1, 0.2, 0.3, 0.4].map((t) => S[Math.round(t * 30)].hip.y);
  assert.ok(steps.filter((y) => y > PRONE_Y + 0.04 && y < STAND_Y - 0.04).length >= 3, 'intermediate heights: ' + steps.map((y) => y.toFixed(2)));
});

test('transitions: off the floor nothing goes through the ground and something always touches it (no levitation)', () => {
  for (const n of ['get_up', 'go_prone']) for (const s of sampleClip(n)) {
    if (s.hip.y < 0.2) continue;   // the prone ends: crawl_idle frame 0, fitted per body at runtime like the crawl
    assert.ok(s.low > -0.015, `${n} ${s.t.toFixed(3)} s: ${(-s.low).toFixed(3)} m into the ground`);
    assert.ok(s.low < 0.03, `${n} ${s.t.toFixed(3)} s: floating ${s.low.toFixed(3)} m`);
  }
});

test('get_up: contacts hold - palms planted while pushing up, the kneeling knee and the planted feet do not slide', () => {
  const S = sampleClip('get_up'), ph = meta.get_up.phases, hd = meta.get_up.contacts.hd.split(' ');
  const span = (a, b) => S.filter((s) => s.t >= a - 1e-6 && s.t <= b + 1e-6);
  const drift = (list, k) => Math.max(...list.map((s) => Math.hypot(s[k].x - list[0][k].x, s[k].z - list[0][k].z)));
  S.forEach((s, f) => { if (hd[f] === '99') assert.ok(s.palmL.y < 0.06 && s.palmR.y < 0.08, `palms planted at ${s.t.toFixed(3)} s (${s.palmL.y.toFixed(3)}, ${s.palmR.y.toFixed(3)})`); });
  assert.ok(hd.filter((x) => x === '99').length >= 4, 'hands carry weight for a while');
  const kneel = span(ph[2], ph[3]);
  assert.ok(kneel.every((s) => s.kneeR.y < 0.1), 'right knee on the ground from the push-up to the kneel');
  assert.ok(drift(kneel, 'kneeR') < 0.03, 'kneeling knee slide ' + drift(kneel, 'kneeR').toFixed(3));
  const stand = span(ph[3], ph[5]);
  assert.ok(stand.every((s) => s.ballL.y < 0.04), 'left foot planted from the kneel on');
  assert.ok(drift(stand, 'ballL') < 0.03, 'left foot slide ' + drift(stand, 'ballL').toFixed(3));
  const pivot = span(ph[3], ph[3] + 0.04);
  assert.ok(drift(pivot, 'ballR') < 0.04, 'right toes pivot in place ' + drift(pivot, 'ballR').toFixed(3));
});

test('transitions: no root motion, and both ends are crawl_idle / idle frame 0 (no pop at either hand-over)', () => {
  for (const n of ['get_up', 'go_prone']) for (const s of sampleClip(n)) assert.ok(Math.hypot(s.hip.x, s.hip.z) < 0.25, `${n}: hip ${Math.hypot(s.hip.x, s.hip.z).toFixed(2)} m off the root`);
  const ref = (n, t) => { poseAt(clipOf(n), t); return { pelvis: wp('pelvis'), head: wp('Head'), handL: wp('hand_l'), footL: wp('foot_l') }; };
  const same = (a, b, what) => { for (const k of ['pelvis', 'head', 'handL', 'footL']) assert.ok(a[k].distanceTo(b[k]) < 0.04, `${what} ${k} off by ${a[k].distanceTo(b[k]).toFixed(3)}`); };
  const up = sampleClip('get_up'), dn = sampleClip('go_prone');
  same(up[0], ref('crawl_idle', 0), 'get_up start vs crawl_idle'); same(dn.at(-1), ref('crawl_idle', 0), 'go_prone end vs crawl_idle');
  same(up.at(-1), ref('idle', 0), 'get_up end vs idle'); same(dn[0], ref('idle', 0), 'go_prone start vs idle');
});

// ---- the game side: every unit, no movement while changing stance ----
function spawn() {
  const world = new World({ size: [40, 40] });
  const def = { commandos: [{ id: 'gb', role: 'greenberet', x: 5, z: 5, inventory: { knife: 1, pistol: 1 } }],
    enemies: [{ id: 'e1', soldierType: 'soldier', x: 20, z: 20 }], vehicles: [] };
  Game.prototype._spawnUnits.call({}, world, def);
  return world;
}

test('stance change: commandos and enemies take stanceDown / stanceUp and do not move meanwhile', () => {
  const world = spawn();
  for (const u of [world.commandos[0], world.enemies[0]]) {
    u.setStance('crawl');
    assert.ok(Math.abs(u._stanceT - CONFIG.units.stanceDown) < 1e-9, `${u.id} lies down in stanceDown`);
    u._stanceT = 0; u.setStance('stand');
    assert.ok(Math.abs(u._stanceT - CONFIG.units.stanceUp) < 1e-9, `${u.id} gets up in stanceUp`);
    const x = u.x, z = u.z;
    u.moveTo(u.x + 5, u.z);
    for (let t = 0; t < CONFIG.units.stanceUp - 0.05; t += CONFIG.sim.dt) u.update(CONFIG.sim.dt);
    assert.ok(Math.hypot(u.x - x, u.z - z) < 1e-9, `${u.id} stays put while getting up`);
  }
});

/** A UnitModel over a stub character (records setAnim / setWeapon). */
function stubModel(opts, durs = { go_prone: 1.0, get_up: 1.2 }) {
  const calls = [], weapons = [];
  const inner = { clip: (n) => ({ duration: durs[n] ?? 1 }), bones: {}, weaponName: null };
  const real = { root: new THREE.Object3D(), ready: Promise.resolve(), inner, characterId: 'stub', entry: {},
    setAnim: (n, o) => calls.push([n, o]), hasAnim: () => true, setWeapon: (w) => { weapons.push(w); return null; }, update: () => true,
    getSocket: () => null, weaponName: () => '' };
  return { m: new UnitModel(real, opts), calls, weapons, inner };
}

test('model: a stance flip plays go_prone / get_up over exactly the stance time, then the requested clip', async () => {
  const { m, calls, inner } = stubModel({ faction: 'enemy', soldierType: 'soldier' });
  await m.ready;
  const u = { stance: 'stand', alive: true, state: 'active' };
  m.unit = u; m._shown = true; m.setAnim('idle');
  u.stance = 'crawl'; m.setAnim('crawl_idle');
  let [n, o] = calls.at(-1);
  assert.equal(n, 'go_prone');
  assert.ok(Math.abs(o.speed - 1.0 / CONFIG.units.stanceDown) < 1e-9 && o.loop === false, 'go_prone retimed to stanceDown: ' + JSON.stringify(o));
  assert.ok(Math.abs(m._tr.left - (CONFIG.units.stanceDown - 0.08)) < 1e-9, 'crawl_idle follows at the end');
  m.update(CONFIG.units.stanceDown, u);
  assert.ok(!m._tr && /^crawl_idle/.test(calls.at(-1)[0]), 'hand-over to the prone idle: ' + calls.at(-1)[0]);
  u.stance = 'stand'; m.setAnim('idle');
  [n, o] = calls.at(-1);
  assert.equal(n, 'get_up');
  assert.ok(Math.abs(o.speed - 1.2 / CONFIG.units.stanceUp) < 1e-9, 'get_up retimed to stanceUp');
  assert.deepEqual(inner.trDur, { go_prone: CONFIG.units.stanceDown, get_up: CONFIG.units.stanceUp }, 'own-transition runtimes get the same times');
  // a dead or carried man never plays a stance transition
  u.alive = false; u.stance = 'crawl'; m._tr = null; m.setAnim('die');
  assert.notEqual(calls.at(-1)[0], 'go_prone');
});

test('model: a knife crawl-in keeps the knife in the fist through getting up, the last steps and the stab', async () => {
  const { m, weapons } = stubModel({ faction: 'player', role: 'greenberet' });
  const u = { stance: 'crawl', alive: true, state: 'active', pendingAbility: { def: { id: 'knife' } }, currentActionId: null };
  m.unit = u;
  await m.ready;
  m.setAnim('crawl');
  assert.equal(weapons.at(-1), 'knife', 'crawling in knife in hand');
  u.stance = 'stand'; m.setAnim('idle');
  assert.equal(weapons.at(-1), 'knife', 'getting up knife in hand');
  m.setAnim('walk');
  assert.equal(weapons.at(-1), 'knife', 'steps in knife in hand');
  // Commando._updatePending: pendingAbility cleared, start() plays the stab, then currentActionId is set
  u.pendingAbility = null; m.setAnim('stab', { loop: false, restart: true });
  u.currentActionId = 'knife'; m.update(1 / 60, u);
  assert.equal(weapons.at(-1), 'knife', 'stabs with the knife');
  // no knife order: standing up shows the carry pistol as before
  u.currentActionId = null; m.update(1 / 60, u); m.setAnim('idle');
  assert.equal(weapons.at(-1), 'colt1911', 'carry pistol when no knife order');
});
