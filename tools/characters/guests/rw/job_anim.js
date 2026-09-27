import { THREE, ROSTER, REQ_CORE, REQ_EXTRA, ENEMY_CLIPS, GUEST_CLIPS, loadLib, makeChar, loadWeapons, equip } from './common.js';
import { snap, run, start, slide, jitter, poseDiff, weaponAim, minVertY, r2, local } from './metrics.js';
const LOCO = { walk: 'walk', walk_formal: 'walk', run: 'run', sprint: 'run', crouch_walk: 'walk', carry_walk: 'carry', carry_barrel: 'carry', drag: 'carry', crawl: 'crawl', swim: 'swim', tied_walk: 'walk', walk_hands_back: 'walk', follow_walk: 'walk' };
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
        headYend: r2(fr[fr.length - 1].Head.y, 2), jitter: jitter(fr).max, jitterAt: jitter(fr).at,
        seam: loop && fr.length > nd + 1 ? jitter(fr, nd - 1, nd + 2).max : null,
        drift: r2(Math.hypot(fr[fr.length - 1].pelvis.x - fr[0].pelvis.x, fr[fr.length - 1].pelvis.z - fr[0].pelvis.z), 2) };
    }
    // 2) locomotion: foot slide + cadence at native and game speed
    for (const [c, kind] of Object.entries(LOCO)) {
      if (!list.includes(c) && !['sprint', 'crouch_walk'].includes(c)) continue;
      const m = lib.meta[c]; if (!m || !m.groundSpeed || !lib.clips.has(c)) continue;
      if (kind === 'crawl' && h.guest && !h.guest.canCrawl) { out.loco[c] = { mapped: 'crouch_walk (cannot crawl)' }; continue; }
      const native = m.groundSpeed * ratio; const game = R[kind] || (kind === 'carry' ? R.walk * 0.7 : null);
      const eff = kind === 'crawl' ? ['hand_l', 'hand_r', 'ball_l', 'ball_r', 'calf_l', 'calf_r'] : kind === 'swim' ? ['hand_l', 'hand_r'] : ['ball_l', 'ball_r', 'foot_l', 'foot_r'];
      const rec = { native: r2(native, 2) };
      for (const [k, v] of [['atNative', native], ['atGame', game], ...(R.walk2 && kind === 'walk' ? [['atGame2', R.walk2]] : [])]) {
        if (!v) continue;
        h.object.position.set(0, 0, 0); const a = start(h, c, { speed: v });
        const ts = a.getEffectiveTimeScale(); const cyc = h.clip(h.animClip || c).duration / ts; rec.clip = h.animClip;
        const fr = run(h, cyc * 2, v); const s = slide(fr, eff);
        rec[k] = { v, timeScale: r2(ts, 2), cycleS: r2(cyc, 2), stepsPerMin: Math.round(120 / cyc), slide: s };
      }
      out.loco[c] = rec;
    }
    // 3) aim / shoot: realistic flow idle -> clip, 0.6 s later; then re-solve to show the solve-at-setAnim-time error
    if (R.weapon) {
      equip(h, Wp, R.weapon);
      for (const c of AIMS.filter(c => lib.clips.has(c) && list.includes(c))) {
        h.object.position.set(0, 0, 0); start(h, 'idle'); h.setAnim('idle'); run(h, 0.6);
        h.setAnim(c, { loop: c === 'kneel_shoot' || c === 'aim' ? true : false }); run(h, 0.45);
        const flow = weaponAim(h); h.solveWeapon(c); run(h, 0.05); const resolved = weaponAim(h);
        out.aim[c] = { flow, resolved, pelvisY: r2(snap(h).pelvis.y, 2) };
      }
      h.weapon && h.weapon.removeFromParent(); h.weapon = null;
    }
    // 4) deaths: from idle, run, crawl; end pose, die->dead continuity
    for (const from of ['idle', 'run', 'crawl']) {
      if (!lib.clips.has('die') || !list.includes(from)) continue;
      if (from === 'crawl' && h.guest && !h.guest.canCrawl) continue;
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
    // 6) transitions (0.2 s cross-fade): max per-frame joint jump in the fade vs the destination clip's own max
    for (const [a, b] of [['idle', 'walk'], ['walk', 'run'], ['run', 'idle'], ['idle', 'crawl_idle'], ['crawl', 'idle'], ['walk', 'crawl'], ['idle', 'aim'], ['aim', 'shoot'], ['run', 'die'], ['idle', 'carry_idle'], ['crawl_idle', 'die'], ['crawl_idle', 'idle'], ['walk', 'die'], ['tied_walk', 'freed'], ['follow_walk', 'follow_idle']]) {
      if (!lib.clips.has(a) || !lib.clips.has(b) || !list.includes(a) || !list.includes(b)) continue;
      h.object.position.set(0, 0, 0); start(h, a); run(h, 0.5); h.setAnim(b, { loop: (lib.meta[b] || {}).loop !== false });
      const fr = run(h, 0.6); out.trans[a + '>' + b] = { fadeJump: jitter(fr, 1, 14).max, afterJump: jitter(fr, 14).max, pelvisDropPerFrame: r2(Math.max(...fr.slice(1, 14).map((f, i) => Math.abs(f.pelvis.y - fr[i].pelvis.y))), 3) };
    }
    scene.remove(h.object); out.ms = Math.round(performance.now() - t0);
    res[R.id] = out; console.log('done', R.id, out.ms);
  }
  return { count: 0, result: () => res };
}
