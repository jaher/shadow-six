// fitjob2.js - round-2 headgear & kit fit check through each group's GAME runtime (rt.js).
// JOB_ARGS = {kind, chars:[{id,url,weapon,disguise?}], N}. Tile = 6 cols (neutral, idle, run, crawl, die, aim|die_prone) x front/side
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { setup, measure } from '/chars/fit/metrics.js';
import { bake, Grid } from '/chars/fit/geom.js';
import { makeRuntime } from '/chars/fit/rt.js';

let _W = null;
const wpos = (o) => o.isVector3 ? o.clone().applyMatrix4(_W.matrixWorld) : o.getWorldPosition(new THREE.Vector3());
const palm = (B, s) => wpos(B['hand_' + s]).lerp(wpos(B['middle_01_' + s]), 0.55);
const _T = new THREE.Triangle(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Vector3();
function triDist(w, p) { let d = 9; w.traverse(o => { if (!o.isMesh) return; const pa = o.geometry.attributes.position, ix = o.geometry.index; const n = ix ? ix.count : pa.count;
  for (let k = 0; k < n; k += 3) { const i0 = ix ? ix.getX(k) : k, i1 = ix ? ix.getX(k + 1) : k + 1, i2 = ix ? ix.getX(k + 2) : k + 2;
    _T.set(_a.fromBufferAttribute(pa, i0).applyMatrix4(o.matrixWorld), _b.fromBufferAttribute(pa, i1).applyMatrix4(o.matrixWorld), _c.fromBufferAttribute(pa, i2).applyMatrix4(o.matrixWorld));
    _T.closestPointToPoint(p, _q); d = Math.min(d, _q.distanceTo(p)); } }); return d; }
const ONCE = new Set(['die', 'dead', 'die_prone', 'dead_prone', 'kneel_shoot']);

export default async function (canvas, W, H) {
  const A = window.__args;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(W, H, false); r.toneMapping = THREE.ACESFilmicToneMapping; r.setScissorTest(true);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8a8f94);
  scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.5;
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.2); scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xcfd8e6, 0x5a5040, 0.7));
  const RT = await makeRuntime(A.kind); const lib = RT.lib;
  const N = A.N || 8;
  const pose = (h, clip, t) => {
    h.setAnim('idle', { fade: 0 }); if ('_prone' in h) h._prone = false;
    const a = h.setAnim(clip, { fade: 0, loop: !ONCE.has(clip) }); if (!a) return false;
    const act = a.isAnimationAction ? a : h.mixer.existingAction(h.clip ? h.clip(clip) : lib.clips.get(clip)) || a;
    if (!act || act.time === undefined) return false;
    act.time = t; h.update(0); h.object.updateMatrixWorld(true); return true;
  };
  let res_parts = null;
  async function one(i) {
    const c = A.chars[i];
    const { h } = await RT.make(c); scene.add(h.object); h.object.position.set(0, 0, 0); h.object.rotation.set(0, 0, 0);
    h.update(0);
    let hm = h; if (h._disg) { const dp = {}; for (const [k, v] of Object.entries(h.parts)) if (k.startsWith('disguise:')) dp[k.slice(9)] = v; hm = Object.assign(Object.create(h), { parts: dp }); }
    const ctx = setup(hm); res_parts = Object.keys(hm.parts); const armed = !!(c.weapon || h.weapon);
    const res = { parts: res_parts, id: c.id, kind: A.kind, headgear: (h.info.headgear || {}).type || null, eyeSanity: +ctx.eyeSanity.toFixed(4), glassIsl: ctx.glassIsl.size, islands: ctx.isl.count, poses: {}, weapon: c.weapon || (h.weapon && h.weapon.name) || null, grips: {}, missing: [] };
    const want = A.want || ['idle', 'run', 'crawl', 'die', 'die_prone', 'aim', 'kneel_shoot'];
    const plan = [['neutral', 'idle', [0]]];
    for (const cl of want) {
      const clip = lib.clips.get(cl); if (!clip) { res.missing.push(cl); continue; }
      if ((cl === 'aim' || cl === 'kneel_shoot') && !armed) continue;
      const ts = []; for (let k = 0; k < N; k++) ts.push(ONCE.has(cl) ? clip.duration * (k + 1) / N - 1e-3 : clip.duration * k / N); plan.push([cl, cl, ts]);
    }
    const pick = {};
    for (const [tag, clip, ts] of plan) {
      let best = null;
      for (const t of ts) {
        if (!pose(h, clip, t)) continue;
        const m = measure(ctx, h, { islandsCheck: true }); m.clip = h.animClip || null;
        const bad = (m.eyeBlocked || []).length * 100 + ((m.poke || {}).n2mm || 0) + ((m.sink || {}).n2mm || 0) + (m.floating || []).length * 5;
        const score = bad * 10 + m.neck;
        res.poses[`${tag}@${t.toFixed(2)}`] = m;
        if (!best || score > best.score) best = { t, score };
      }
      if (best) pick[tag] = best.t;
    }
    if (h.weapon) for (const cl of ['idle', 'walk', 'run', 'aim', 'shoot', 'kneel_shoot', 'crawl']) {
      const clip = lib.clips.get(cl); if (!clip) continue;
      for (const f of [0, 0.5]) {
        if (!pose(h, cl, clip.duration * f)) continue;
        const w = h.weapon, s = w.userData.sockets || {}; _W = w; const g = { vis: w.visible, two: !!h._twoHand, clip: h.animClip || null };
        if (w.visible && s.grip_r) g.r = +palm(h.bones, 'r').distanceTo(wpos(s.grip_r)).toFixed(3);
        if (w.visible && s.grip_l) { g.l = +palm(h.bones, 'l').distanceTo(wpos(s.grip_l)).toFixed(3); g.ik = h.ikError != null ? +h.ikError.toFixed(3) : null; }
        if (w.visible) { let dm = 9; const P = [], sp = new THREE.Vector3();
          w.traverse(o => { if (o.isMesh) { const pa = o.geometry.attributes.position; for (let k = 0; k < pa.count; k += 1) { sp.fromBufferAttribute(pa, k).applyMatrix4(o.matrixWorld); P.push(sp.clone()); } } });
          const pl = palm(h.bones, 'l'), pr = palm(h.bones, 'r'); g.lOnGun = +triDist(w, pl).toFixed(3); g.rOnGun = +triDist(w, pr).toFixed(3);
          const bg = new Grid(bake(hm.parts.LOD0), 0.03); for (const p of P) dm = Math.min(dm, bg.nearest(p.x, p.y, p.z, 0.12).d);
          if (s.butt) g.buttShoulder = +wpos(s.butt).distanceTo(wpos(h.bones.upperarm_r)).toFixed(3);
          g.toBody = +Math.min(dm, 0.2).toFixed(3); }
        res.grips[`${cl}@${f}`] = g;
      }
    }
    // ---- render: 6 columns x 2 rows (front, side), camera in the head frame
    const last = armed && 'aim' in pick ? 'aim' : 'die_prone';
    const cols = [['neutral', 'idle', 0], ...['idle', 'run', 'crawl', 'die', last].filter(k => k in pick).map(k => [k, k, pick[k]])];
    const NC = 6, tw = W / NC, th = H / 2; r.setScissor(0, 0, W, H); r.setViewport(0, 0, W, H); r.setClearColor(0x333333); r.clear();
    cols.forEach(([tag, clip, t], ci) => {
      pose(h, clip, t); const hb = h.bones.Head; const q = hb.getWorldQuaternion(new THREE.Quaternion()).multiply(ctx.Hq0.clone().invert());
      const p = ctx.eyeL.clone().add(ctx.eyeR).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.02, -0.05)).applyMatrix4(ctx.Hb0.clone().invert()).applyMatrix4(hb.matrixWorld);
      [[0, 0, 1], [1, 0, 0]].forEach((dir, ri) => {
        const cam = new THREE.OrthographicCamera(-0.15, 0.15, 0.15 * th / tw, -0.15 * th / tw, 0.01, 10);
        const dv = new THREE.Vector3(...dir).applyQuaternion(q); cam.position.copy(p).addScaledVector(dv, 1.5); cam.up.set(0, 1, 0).applyQuaternion(q); cam.lookAt(p);
        sun.position.copy(p).addScaledVector(dv, 3).add(new THREE.Vector3(0, 3, 0)); sun.target.position.copy(p);
        r.setViewport(ci * tw, (1 - ri) * th, tw, th); r.setScissor(ci * tw + 1, (1 - ri) * th + 1, tw - 2, th - 2); r.render(scene, cam);
      });
    });
    res.pick = pick; res.cols = cols.map(x => x[0]);
    scene.remove(h.object);
    return { label: c.id, res };
  }
  return { count: A.chars.length, render: one };
}
