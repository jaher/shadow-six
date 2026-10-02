/**
 * Prone animation set (docs/crawl-animation.md): the shipped clips on the UAL skeleton keep the elbows / forearms on
 * the ground while planted, the elbows do not skate, the weapon stays in the hands (grip frames of prone-grips.js),
 * the crawl plays at 0.9 m/s at x1, and every library that carries the crawl carries the whole set.
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { loadUAL } from '../../tools/characters/prone/rig.mjs';
import { proneGrip, GRIPS } from '../../src/art/characters/prone-grips.js';
import { mapAnim, weaponClass } from '../../src/art/unit-anim-map.js';

const ANIMS = new URL('../../assets/characters/anims/', import.meta.url).pathname;
const R = await loadUAL(ANIMS + 'base_anims.glb');
let meta = null; R.scene.traverse((o) => { if (!meta && o.userData.shadowSix) meta = o.userData.shadowSix.clips; });
const clipOf = (n) => R.animations.find((c) => c.name === n);
/** Pose the rig at time t of clip c (tracks evaluated directly; no mixer caching). */
function poseAt(c, t) {
  for (const tr of c.tracks) {
    const i = tr.name.lastIndexOf('.'), b = R.B[tr.name.slice(0, i)], p = tr.name.slice(i + 1);
    if (b && (p === 'quaternion' || p === 'position')) b[p].fromArray(tr.createInterpolant().evaluate(t));
  }
  R.update();
}
const wp = (n) => R.wp(n);
const fist = (s) => wp('hand_' + s).lerp(wp('middle_01_' + s), 0.55);
const SOCK = { sling_f: new THREE.Vector3(0, -0.04, 0.45), butt: new THREE.Vector3(0, -0.06, -0.34), muzzle: new THREE.Vector3(0, 0.028, 0.83),
  grip_r: new THREE.Vector3(0, 0, 0), grip_l: new THREE.Vector3(0, -0.012, 0.34) };
const sockets = Object.fromEntries(Object.entries(SOCK).map(([k, v]) => [k, { position: v }]));
const weaponWorld = (clip, name) => { const g = proneGrip(clip, name, sockets); return R.B['hand_' + g.hand].matrixWorld.clone().multiply(g.local); };
const ELBOW_R = 0.04;   // elbow joint centre above the ground when the sleeve touches (UAL forearm radius)
const planted = (m, key, f, n, s) => { const fr = m.contacts[key].split(' '); return fr[Math.round(f * (fr.length - 1) / (n - 1))][s === 'l' ? 0 : 1] === '1'; };

test('crawl clips: 0.9 s cycle, 0.9 m/s ground speed (plays at x1 at CONFIG crawl speed), two 0.405 m strokes', () => {
  for (const n of ['crawl', 'crawl_unarmed', 'crawl_knife']) {
    const c = clipOf(n), m = meta[n];
    assert.ok(c, n + ' present');
    assert.ok(Math.abs(c.duration - 0.9) < 1e-3, n + ' duration ' + c.duration);
    assert.ok(Math.abs(m.stroke - 0.405) < 1e-3 && m.strokesPerCycle === 2, n + ' stroke');
    assert.ok(Math.abs(m.groundSpeed - 0.9) < 0.02 && m.loco && m.loop && m.prone, n + ' meta ' + JSON.stringify(m).slice(0, 80));
  }
});

test('crawl: elbows / forearms within 3 cm of the ground while planted, no skate > 1.5 cm, palms never carry weight', () => {
  for (const n of ['crawl', 'crawl_unarmed', 'crawl_knife']) {
    const c = clipOf(n), m = meta[n], N = 31, v = m.groundSpeed;
    let prev = null, worst = 0, skate = 0; const anchor = {};
    for (let f = 0; f < N; f++) {
      const t = (f / (N - 1)) * c.duration; poseAt(c, Math.min(t, c.duration - 1e-4));
      const cur = {};
      for (const s of ['l', 'r']) {
        const e = wp('lowerarm_' + s), w = wp('hand_' + s);
        cur[s] = e.clone().add(new THREE.Vector3(0, 0, v * t));   // world position (the root moves at v)
        if (planted(m, 'el', f, N, s)) {
          worst = Math.max(worst, Math.abs(e.y - ELBOW_R), Math.abs((e.y + w.y) / 2 - ELBOW_R - 0.012));
          if (!(prev && prev.pl[s])) anchor[s] = cur[s].clone();   // a new plant: the elbow must stay where it landed
          skate = Math.max(skate, Math.hypot(cur[s].x - anchor[s].x, cur[s].z - anchor[s].z));
        }
        assert.ok(fist(s).y > 0.03, `${n} f${f} ${s} palm off the ground (${fist(s).y.toFixed(3)})`);
      }
      prev = { ...cur, pl: { l: planted(m, 'el', f, N, 'l'), r: planted(m, 'el', f, N, 'r') } };
    }
    assert.ok(worst <= 0.03, `${n}: elbow / forearm height error ${worst.toFixed(3)} m`);
    assert.ok(skate < 0.015, `${n}: planted elbow skate ${skate.toFixed(4)} m over a pull`);
  }
});

test('crawl: elbows ALTERNATE (contralateral leopard crawl) - forward peaks half a cycle apart, never pulling or reaching together', () => {
  // user: "when crawling alternate between left / right arm, don't use both arms". Per cycle, each elbow's forward
  // travel (relative to its shoulder) peaks once, the two peaks ~half a cycle apart; the planted (pulling) runs never
  // overlap; both forearms never swing forward at once; the knee drawn up at an elbow's catch is the opposite one;
  // and planted contacts (elbows, pushing boot) move with the ground (no slide).
  for (const n of ['crawl', 'crawl_unarmed', 'crawl_knife']) {
    const c = clipOf(n), m = meta[n], N = 91, T = c.duration, v = m.groundSpeed, dt = T / (N - 1);
    const fwd = { l: [], r: [] }, wz = { l: [], r: [] }, knee = { l: [], r: [] }, pl = { l: [], r: [] }, foot = { l: [], r: [] };
    for (let f = 0; f < N; f++) {
      const t = f * dt; poseAt(c, Math.min(t, T - 1e-4));
      for (const s of ['l', 'r']) {
        const e = wp('lowerarm_' + s);
        fwd[s].push(e.z - wp('upperarm_' + s).z); wz[s].push(e.z + v * t);
        knee[s].push(wp('calf_' + s).z - wp('pelvis').z);
        pl[s].push(planted(m, 'el', f, N, s));
        foot[s].push({ p: wp('foot_' + s).add(new THREE.Vector3(0, 0, v * t)), pl: planted(m, 'ft', f, N, s) });
      }
    }
    const peak = (a) => a.slice(0, N - 1).reduce((bi, x, i, arr) => (x > arr[bi] ? i : bi), 0);
    const pL = peak(fwd.l), pR = peak(fwd.r), off = Math.abs(pL - pR) / (N - 1), d = Math.min(off, 1 - off);
    assert.ok(Math.abs(d - 0.5) < 0.1, `${n}: L / R elbow forward peaks ${(pL * dt).toFixed(2)} / ${(pR * dt).toFixed(2)} s, offset ${d.toFixed(2)} cycle (want ~0.5)`);
    const span = (s) => Math.max(...fwd[s]) - Math.min(...fwd[s]);
    assert.ok(span('l') > 0.18 && span('r') > 0.18, `${n}: each elbow strokes (travel ${span('l').toFixed(2)} / ${span('r').toFixed(2)} m)`);
    let both = 0, swing = 0;
    for (let f = 0; f < N - 1; f++) {
      if (pl.l[f] && pl.r[f]) both++;
      const sl = (wz.l[f + 1] - wz.l[f]) / dt, sr = (wz.r[f + 1] - wz.r[f]) / dt;
      if (sl > 0.5 * v && sr > 0.5 * v) swing++;
    }
    assert.ok(both <= 0.08 * (N - 1), `${n}: both elbows planted (pulling) together in ${both} / ${N - 1} samples`);
    assert.equal(swing, 0, `${n}: both forearms swinging forward together in ${swing} samples`);
    assert.ok(pl.l.some(Boolean) && pl.r.some(Boolean) && pl.l.some((x) => !x) && pl.r.some((x) => !x), n + ': each elbow plants and lifts');
    // contralateral: at the left elbow's catch the RIGHT knee is the drawn-up one, and vice versa
    assert.ok(knee.r[pL] > knee.l[pL] + 0.1 && knee.l[pR] > knee.r[pR] + 0.1,
      `${n}: knee drawn opposite the reaching elbow (L catch: knees L ${knee.l[pL].toFixed(2)} R ${knee.r[pL].toFixed(2)})`);
    // the pushing boot does not slide while planted
    for (const s of ['l', 'r']) {
      let a = null, slide = 0;
      for (const { p, pl: on } of foot[s]) { if (!on) { a = null; continue; } if (!a) a = p.clone(); slide = Math.max(slide, Math.hypot(p.x - a.x, p.z - a.z)); }
      assert.ok(slide < 0.03, `${n}: planted ${s} boot slides ${slide.toFixed(3)} m`);
    }
  }
});

test('crawl: flat low crawl - chest low and steady, smooth body speed (no stop-and-go), forearms reach past the head', () => {
  // review: shoulders ran 0.22-0.35 m and bobbed 13 cm (upper arm near vertical, a sphinx / high crawl), the pelvis
  // stopped in the reach and lunged in the pull, and the fists ended at the chin at the catch
  const c = clipOf('crawl'), m = meta.crawl, N = 46, v = m.groundSpeed;
  const sh = { l: [], r: [] }, pz = [];
  let reach = 0, upright = 0; const rmax = { l: -1, r: -1 };
  for (let f = 0; f < N; f++) {
    const t = (f / (N - 1)) * c.duration; poseAt(c, Math.min(t, c.duration - 1e-4));
    for (const s of ['l', 'r']) {
      const S = wp('upperarm_' + s), E = wp('lowerarm_' + s); sh[s].push(S.y);
      upright = Math.max(upright, Math.asin(Math.min(1, (S.y - E.y) / S.distanceTo(E))) * 57.3);   // upper arm pitch below horizontal
    }
    pz.push(wp('pelvis').z + v * t);
    // alternating crawl: each fist reaches furthest at its own elbow's catch (half a cycle apart)
    for (const s of ['l', 'r']) rmax[s] = Math.max(rmax[s], fist(s).z - wp('upperarm_' + s).z);
  }
  reach = Math.min(rmax.l, rmax.r);
  for (const s of ['l', 'r']) {
    const lo = Math.min(...sh[s]), hi = Math.max(...sh[s]);
    assert.ok(hi < 0.28 && hi - lo < 0.065, `${s} shoulder ${lo.toFixed(3)}..${hi.toFixed(3)} m (flat, bob < 6.5 cm)`);
  }
  assert.ok(upright < 62, 'upper arm never near vertical: ' + upright.toFixed(0) + ' deg');
  const dt = c.duration / (N - 1), sp = pz.slice(1).map((z, i) => (z - pz[i]) / dt);
  const jump = Math.max(...sp.slice(1).map((x, i) => Math.abs(x - sp[i])));
  assert.ok(Math.min(...sp) > 0.45 * v && Math.max(...sp) < 1.6 * v, `body speed ${Math.min(...sp).toFixed(2)}..${Math.max(...sp).toFixed(2)} m/s`);
  assert.ok(jump < 0.25, 'body speed changes smoothly: max step ' + jump.toFixed(2) + ' m/s per frame');
  assert.ok(reach > 0.36, 'fists reach ' + reach.toFixed(2) + ' m ahead of the shoulders at the catch');
});

test('crawl: body flat, head looks along the ground, boot soles never face the sky', () => {
  const c = clipOf('crawl');
  for (let f = 0; f < 16; f++) {
    poseAt(c, (f / 16) * c.duration);
    const hip = wp('thigh_l').lerp(wp('thigh_r'), 0.5);
    assert.ok(hip.y > 0.11 && hip.y < 0.16, 'pelvis y ' + hip.y.toFixed(3));
    const face = new THREE.Vector3(0, 0, 1).applyQuaternion(R.wq('Head').multiply(R.restW.Head.q.clone().invert()));
    assert.ok(Math.abs(Math.asin(face.y)) < 20 * Math.PI / 180, 'head pitch ' + (Math.asin(face.y) * 57.3).toFixed(1));
    for (const s of ['l', 'r']) {
      const sole = new THREE.Vector3(0, -1, 0).applyQuaternion(R.wq('foot_' + s).multiply(R.restW['foot_' + s].q.clone().invert()));
      assert.ok(sole.y < 0.5, `foot_${s} sole normal y ${sole.y.toFixed(2)}`);
    }
  }
});

test('weapon in the hands: crawl rifle rides the right fist at the front swivel, muzzle up, butt dragging', () => {
  const c = clipOf('crawl');
  for (let f = 0; f < 16; f++) {
    poseAt(c, (f / 16) * c.duration);
    const W = weaponWorld('crawl', 'no4_sniper'), at = (k) => SOCK[k].clone().applyMatrix4(W);
    assert.ok(at('sling_f').distanceTo(fist('r')) < 0.06, 'swivel in the right fist ' + at('sling_f').distanceTo(fist('r')).toFixed(3));
    assert.ok(at('muzzle').y >= 0.08, 'muzzle off the ground ' + at('muzzle').y.toFixed(3));
    assert.ok(Math.abs(at('butt').y) <= 0.05, 'butt drags ' + at('butt').y.toFixed(3));
  }
  // prone aim: gun in the left hand (support), the right palm stays on the wrist of the stock
  const a = clipOf('prone_aim');
  for (let f = 0; f < 8; f++) {
    poseAt(a, (f / 8) * a.duration);
    const W = weaponWorld('prone_aim', 'no4_sniper');
    assert.ok(SOCK.grip_r.clone().applyMatrix4(W).distanceTo(fist('r')) < 0.04, 'right hand on the grip');
    for (const s of ['l', 'r']) assert.ok(wp('lowerarm_' + s).y < 0.08, 'aim: elbow planted ' + s);
  }
});

test('prone set present in every library that has the crawl; old procedural crawl gone', async () => {
  const want = ['crawl', 'crawl_unarmed', 'crawl_knife', 'crawl_idle', 'crawl_idle_unarmed', 'prone_aim', 'prone_shoot', 'prone_shoot_smg',
    'prone_pistol_aim', 'prone_pistol_shoot', 'go_prone', 'get_up', 'die_prone', 'dead_prone', 'prone_turn_l', 'prone_turn_r'];
  const { readFileSync } = await import('node:fs');
  for (const f of ['base_anims', 'ca_anims', 'commando_anims', 'guest_anims']) {
    const j = JSON.parse(readFileSync(ANIMS + f + '.json', 'utf8'));
    for (const n of want) assert.ok(j[n], `${f}: ${n}`);
    assert.ok(!/crawl\.js|crawlPlanted/.test(JSON.stringify(j.crawl)), f + ': crawl is the new authored clip');
  }
  assert.ok(GRIPS.crawl_long && GRIPS.crawl_smg && GRIPS.crawl_knife && GRIPS.aim_long && GRIPS.pistol);
});

test('mapAnim prone branch: carry class picks the crawl / idle / aim / shoot clip; pistol holstered while crawling', () => {
  const p = (name, weapon) => mapAnim(name, { stance: 'crawl', weapon });
  assert.deepEqual(p('crawl', 'no4_sniper'), ['crawl']);
  assert.deepEqual(p('crawl', 'mp40'), ['crawl']);
  assert.deepEqual(p('crawl', 'colt1911'), ['crawl_unarmed', 'crawl']);
  assert.deepEqual(p('crawl', 'knife'), ['crawl_knife', 'crawl_unarmed', 'crawl']);
  assert.deepEqual(p('crawl_idle', 'thompson'), ['crawl_idle']);
  assert.deepEqual(p('crawl_idle', null), ['crawl_idle_unarmed', 'crawl_idle']);
  assert.equal(p('shoot', 'kar98k')[0], 'prone_shoot');
  assert.equal(p('shoot', 'thompson')[0], 'prone_shoot_smg');
  assert.equal(p('shoot', 'walther_p38')[0], 'prone_pistol_shoot');
  assert.equal(p('aim', 'no4_sniper')[0], 'prone_aim');
  assert.deepEqual(mapAnim('die', { stance: 'crawl', faction: 'enemy', weapon: 'kar98k' }), ['die_prone', 'die']);
  assert.deepEqual(mapAnim('shoot', { role: 'sniper', actionId: 'sniper' }), ['kneel_shoot', 'shoot']);
  assert.equal(weaponClass('harpoon_gun'), 'long');
  assert.deepEqual(proneGrip('crawl', 'colt1911', sockets), { hide: true });
  assert.equal(proneGrip('walk', 'kar98k', sockets), null);
});
