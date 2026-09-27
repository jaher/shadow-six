import { THREE, ROSTER, REQ_CORE, REQ_EXTRA, ENEMY_CLIPS, GUEST_CLIPS } from '/chars/anim_check/common.js';
import { loadCharacter } from '/chars/pipeline/web/charkit.js'; import { loadWeapons } from '/chars/pipeline/web/weapons.js';
import { loadCALib, createCommando, equipCA, eyeElev } from '../ca_runtime.js';
const loadLib = async (o) => { const l = await loadCALib(); if (!l.clips.has('crawl_idle')) {} return l; };
const equip = equipCA;
async function makeChar(R, lib, W) { const tpl = await loadCharacter(R.url); const h = createCommando(tpl, lib); if (W && R.weapon) equipCA(h, W, R.weapon); return h; }
import { snap, run, start, slide, jitter, poseDiff, weaponAim, minVertY, r2, local } from '/chars/anim_check/metrics.js';
const LOCO = { walk: 'walk', walk_formal: 'walk', run: 'run', sprint: 'run', crouch_walk: 'walk', carry_walk: 'carry', carry_barrel: 'carry', drag: 'carry', crawl: 'crawl', swim: 'swim', tied_walk: 'walk', walk_hands_back: 'walk' };
const AIMS = ['aim', 'shoot', 'rifle_shoot', 'kneel_shoot', 'reload'];
export default async function (canvas, W, H, args) {
  const lib = await loadLib({ fix: !args.asShipped }); const Wp = await loadWeapons('/chars/out/weapons.glb');
  const scene = new THREE.Scene(); const res = {};
  const ids = args.ids || ROSTER.map(r => r.id);
  for (const R of ROSTER.filter(r => ids.includes(r.id))) {
    const t0 = performance.now();
    const h = await makeChar(R, lib, null); scene.add(h.object);
    const ratio = h.info.pelvisRatio || 1; const out = { ratio: r2(ratio), clips: {}, loco: {}, aim: {}, death: {}, carry: {}, trans: {} };
    let list = R.group === 'enemy' ? ENEMY_CLIPS : R.group === 'guest' ? GUEST_CLIPS : [...REQ_CORE, ...REQ_EXTRA];
    out.missing = list.filter(c => !lib.clips.has(c));
    // 1) every clip: vertical range, ground penetration, loop seam, frame jitter
    for (const c of list.filter(c => lib.clips.has(c))) {
      const m = lib.meta[c] || {}; const loop = m.loop !== false; const d = h.clip(c).duration;
      h.object.position.set(0, 0, 0); start(h, c, { loop });
      const fr = run(h, loop ? d * 1.25 : d + 0.25, 0, { verts: 5 });
      const vy = fr.filter(f => f.vy).map(f => f.vy);
      const nd = Math.round(d * 60);
      out.clips[c] = { dur: r2(d, 2), loop, minVertY: r2(Math.min(...vy.map(v => v[0])), 3), lowBone: vy.reduce((a, b) => b[0] < a[0] ? b : a)[2], maxVertY: r2(Math.max(...vy.map(v => v[1])), 2),
        pelvisY: [r2(Math.min(...fr.map(f => f.pelvis.y)), 2), r2(Math.max(...fr.map(f => f.pelvis.y)), 2)],
        headYend: r2(fr[fr.length - 1].Head.y, 2), jitter: jitter(fr).max,
        seam: loop && fr.length > nd + 1 ? jitter(fr, nd - 1, nd + 2).max : null,
        drift: r2(Math.hypot(fr[fr.length - 1].pelvis.x - fr[0].pelvis.x, fr[fr.length - 1].pelvis.z - fr[0].pelvis.z), 2) };
    }
    // 2) locomotion: foot slide + cadence at native and game speed
    for (const [c, kind] of Object.entries(LOCO)) {
      if (!list.includes(c) && !['sprint', 'crouch_walk', 'swim'].includes(c)) continue;
      const m = lib.meta[c]; if (!m || !m.groundSpeed || !lib.clips.has(c)) continue;
      const native = m.groundSpeed * ratio; const game = R[kind] || (kind === 'carry' ? R.walk * 0.7 : kind === 'swim' ? 1.8 : null);
      const eff = kind === 'crawl' ? ['hand_l', 'hand_r', 'calf_l', 'calf_r'] : kind === 'swim' ? ['hand_l', 'hand_r'] : ['ball_l', 'ball_r', 'foot_l', 'foot_r'];
      const rec = { native: r2(native, 2) };
      for (const [k, v] of [['atNative', native], ['atGame', game], ...(R.walk2 && kind === 'walk' ? [['atGame2', R.walk2]] : [])]) {
        if (!v) continue;
        h.object.position.set(0, 0, 0); const a = start(h, c, { speed: v });
        const ts = a.getEffectiveTimeScale(); const cyc = h.clip(c).duration / ts;
        const fr = run(h, cyc * 2, m.reverse ? -v : v); const s = slide(fr, eff); if (m.reverse) for (const q of Object.values(s)) q.fwd = -q.fwd;
        rec[k] = { v, timeScale: r2(ts, 2), cycleS: r2(cyc, 2), stepsPerMin: Math.round(120 / cyc), slide: s };
      }
      out.loco[c] = rec;
    }
    // 3) aim / shoot: realistic flow idle -> clip, 0.6 s later; then re-solve to show the solve-at-setAnim-time error
    if (R.weapon) {
      equip(h, Wp, R.weapon);
      for (const c of AIMS.filter(c => lib.clips.has(c) && list.includes(c))) {
        h.object.position.set(0, 0, 0); start(h, 'idle'); h.setAnim('idle'); run(h, 0.6); h._restHeadPitch = r2(eyeElev(h), 1);
        h.setAnim(c, { loop: c === 'kneel_shoot' || c === 'aim' ? true : false }); run(h, 0.45);
        const flow = weaponAim(h); flow.blade = h.blade == null ? null : r2(h.blade, 1); flow.eyeToSight = h.eyeToSight == null ? null : r2(h.eyeToSight, 3); flow.buttLift = r2(h.buttLift || 0, 3); flow.headPitch = h.headPitch == null ? null : r2(h.headPitch, 1); flow.restHeadPitch = h._restHeadPitch; flow.eyeErr = h.eyeErr == null ? null : r2(h.eyeErr, 3); flow.ikErrR = h.ikErrR == null ? null : r2(h.ikErrR, 3); h.solveWeapon(c); run(h, 0.05); const resolved = weaponAim(h);
        out.aim[c] = { flow, resolved, pelvisY: r2(snap(h).pelvis.y, 2) };
      }
      h.weapon && h.weapon.removeFromParent(); h.weapon = null;
    }
    // 4) deaths: from idle, run, crawl; end pose, die->dead continuity
    for (const from of ['idle', 'run', 'crawl']) {
      if (!lib.clips.has('die') || !list.includes(from)) continue;
      h.object.position.set(0, 0, 0); start(h, from); run(h, 0.5);
      const s0 = snap(h); h.setAnim('die', { loop: false }); const fr = run(h, h.clip('die').duration + 0.2, 0, { verts: 10 });
      const end = fr[fr.length - 1]; const vy = minVertY(h);
      h.setAnim('dead', { loop: true }); const fr2 = run(h, 0.5);
      out.death[from] = { maxPelvisY: r2(Math.max(...fr.map(f => f.pelvis.y)), 2), startPelvisY: r2(s0.pelvis.y, 2), endPelvisY: r2(end.pelvis.y, 2), endHeadY: r2(end.Head.y, 2),
        endMinVertY: r2(vy[0], 3), endLowBone: vy[2], endMaxVertY: r2(vy[1], 2), pelvisTravel: r2(Math.hypot(end.pelvis.x - s0.pelvis.x, end.pelvis.z - s0.pelvis.z), 2),
        dieToDeadPop: poseDiff(end, fr2[fr2.length - 1]), deadMinVertY: r2(minVertY(h)[0], 3) };
    }
    // 5) carry poses: hands relative to shoulder
    for (const c of ['carry_idle', 'carry_walk', 'carry_barrel', 'drag'].filter(c => lib.clips.has(c) && list.includes(c))) {
      h.object.position.set(0, 0, 0); start(h, c); run(h, 0.7); const s = snap(h);
      const L = (p) => local(h, p).toArray().map(x => r2(x, 2));
      out.carry[c] = { handL: L(s.hand_l), handR: L(s.hand_r), shoulderR: L(s.upperarm_r), head: L(s.Head) };
    }
    // 6) transitions: max per-frame joint jump over the whole transition window (2.2 s covers go_prone/get_up + hand-over)
    for (const [a, b] of [['idle', 'walk'], ['walk', 'run'], ['run', 'idle'], ['idle', 'crawl_idle'], ['crawl', 'idle'], ['walk', 'crawl'], ['crawl_idle', 'idle'], ['idle', 'aim'], ['aim', 'shoot'], ['run', 'die'], ['idle', 'carry_idle'], ['crawl_idle', 'die']]) {
      if (!lib.clips.has(a) || !lib.clips.has(b) || !list.includes(a) || !list.includes(b)) continue;
      h.object.position.set(0, 0, 0); start(h, a); run(h, 0.5); const fr = [];
      for (let i = 0; i <= 132; i++) { if (i) { h.setAnim(b, { loop: (lib.meta[b] || {}).loop !== false }); h.update(1 / 60); } else h.setAnim(b, { loop: (lib.meta[b] || {}).loop !== false }); fr.push(snap(h)); }
      out.trans[a + '>' + b] = { via: h._queued ? h._queued.tr : null, fadeJump: jitter(fr, 1, 14).max, maxJump: jitter(fr).max, maxJumpAt: jitter(fr).at, afterJump: jitter(fr, 100).max,
        pelvisDropPerFrame: r2(Math.max(...fr.slice(1).map((f, i) => Math.abs(f.pelvis.y - fr[i].pelvis.y))), 3), pelvisEnd: r2(fr[fr.length - 1].pelvis.y, 2), clipEnd: h._clipName };
    }
    // 7) aim in / out with the gun: per-frame jump of the muzzle, butt and left hand (world, root still)
    if (R.weapon) {
      equip(h, Wp, R.weapon);
      for (const [a, b] of [['idle', 'aim'], ['aim', 'idle'], ['idle', 'kneel_shoot'], ['walk', 'aim'], ['idle', 'crawl_idle'], ['crawl_idle', 'idle']]) {
        if (!lib.clips.has(a) || !lib.clips.has(b)) continue;
        h.object.position.set(0, 0, 0); start(h, a); h.setAnim(a); run(h, 0.8);
        const S = h.weapon.userData.sockets, P = [];
        const rec = () => { h.object.updateMatrixWorld(true); const g = (o) => o.getWorldPosition(new THREE.Vector3()); P.push({ m: g(S.muzzle || h.weapon), b: g(S.butt || h.weapon), hl: g(h.bones.hand_l), hr: g(h.bones.hand_r), w: h.aimW ?? 0 }); };
        rec(); h.setAnim(b, { loop: true });   // last rendered frame, then setAnim + update per frame (game order)
        for (let i = 0; i < 110; i++) { h.update(1 / 60); rec(); }
        let mx = { m: 0, b: 0, hl: 0, hr: 0 }, at = {};
        for (let i = 1; i < P.length; i++) for (const k of Object.keys(mx)) { const d = P[i][k].distanceTo(P[i - 1][k]); if (d > mx[k]) { mx[k] = d; at[k] = i; } }
        out.trans['gun:' + a + '>' + b] = { muzzle: r2(mx.m, 3), butt: r2(mx.b, 3), handL: r2(mx.hl, 3), handR: r2(mx.hr, 3), at, w1: r2(P[1].w, 2), wEnd: r2(P[P.length - 1].w, 2), aimEnd: weaponAim(h) };
      }
      h.weapon && h.weapon.removeFromParent(); h.weapon = null;
    }
    out.groundLift = h._tpl._groundLift; scene.remove(h.object); out.ms = Math.round(performance.now() - t0);
    res[R.id] = out; console.log('done', R.id, out.ms);
  }
  return { count: 0, result: () => res };
}
