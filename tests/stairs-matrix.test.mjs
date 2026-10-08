/**
 * Stairs matrix (user requests 2026-10-07: "animate the commandos climbing and going down stairs properly", "All
 * commandos in all clothing and all situations walk/run climb and go down stairs well", "Both commandos and enemy
 * soldiers"): every commando (Green Beret, Sniper, Marine, Sapper, Driver, Spy) — the Spy also in his officer's
 * uniform, the Driver also burnt (M8 on) — with his own weapon in hand, the Green Beret also with the knife out and with
 * a man on his shoulder; every German look (11) patrolling (walk) and alerted (run); the guests (McRae, the Informer,
 * a prisoner) — up and down the M3 dam's W stair, walking and running; a Green Beret and a German on M2's plat_sw
 * stair and on an M20 stone flight (a stair link). Per run, on the flight's treads (art/stair-gait.js):
 *  - the stair gait is on (weight 1) and a stepping clip plays (no idle glide, no T-pose);
 *  - the feet step from tread to tread: each foot's new foothold on another tread the way he goes (≥ 70 % of them,
 *    never more than one back — not the flat-ground walk on a slope);
 *  - flat on a tread, the sole is within 3 cm of it (p95; never more than 2 cm into it); a planted foot is never over its
 *    tread (> 4 cm) for more than 0.2 s (coming down, settling); a swinging foot never goes into a tread (sole ≥ −2 cm);
 *  - the body rises / sinks tread by tread (its height over the nosing line varies by > 8 cm: a glide keeps it within
 *    the clip's own bob);
 *  - a dragged man is not taken up the stairs (the order is refused).
 * Logic + model updates only (no frames drawn): the units' models are stepped like Game.render does.
 */
export const timeout = 900_000;

export default async function stairsMatrix(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const um = await import('/src/art/unit-model.js');
    const { Commando } = await import('/src/entities/commando.js');
    const { Enemy } = await import('/src/entities/enemy.js');
    const ST = await import('/src/world/stairs.js');
    const stub = () => ({ update() {}, attach() {}, hear() {}, onDeath() {}, isAware: () => false, state: 'IDLE', serialize: () => null, deserialize() {}, notifyKill() {}, onBodyFound() {}, distractBy: () => false, releaseDistraction() {} });
    const out = [];
    const clear = (w) => { for (const e of [...w.entities]) if (e.kind === 'enemy' || e.kind === 'commando') w.remove(e); w.flushRemovals?.(); };
    /** Walk / run unit u from flight coordinate s0 to s1 and back; per-frame checks. */
    const climb = async (w, f, u, { s0, s1, run, name, v = 0 }) => {
      const at = (s) => ST.flightWorld(f, s, v);
      const res = { name, ok: true, why: [] };
      for (const [from, to, dir] of [[s0, s1, 1], [s1, s0, -1]]) {
        const a = at(from), b = at(to);
        if (dir > 0) { u.setPosition(a.x, a.z, Math.atan2(f.uz, f.ux)); u.y = ST.lineAt(f, from); for (let i = 0; i < 30; i++) frame(w); }
        const okMove = u.faction === 'enemy' ? u.moveTo(b.x, b.z, { run }) : u.issue({ type: 'move', x: b.x, z: b.z, run });
        const L = { leg: dir > 0 ? 'up' : 'down', frames: 0, on: 0, loco: 0, gaps: [], swingMin: 9, plants: [], tpose: 0, clips: {}, rise: [], lastPlant: { l: null, r: null }, hang: { l: 0, r: 0 }, hangMax: 0 };
        if (!okMove) { res.ok = false; res.why.push(`${L.leg}: no path`); continue; }
        for (let k = 0; k < 60 * 30 && u.path; k++) {
          frame(w);
          const m = u.model, S = m._sg, B = m.real?.inner?.bones;
          const { s } = ST.flightLocal(f, u.x, u.z);
          const short = f.sTop - f.sFoot < 5, m0 = short ? 0.1 : 0.8;
          if (s < f.sFoot + m0 || s > f.sTop - m0) continue; // (the treads, off both ends)
          L.frames++;
          L.clips[m.clip] = (L.clips[m.clip] || 0) + 1;
          if (/walk|run|jog/.test(m.clip || '')) L.loco++;
          if (!S || S.w < 0.999) continue;
          L.on++;
          // (debugging aid: window.__stairDump = { name, rows: [] } set before the test records this combination's frames)
          if (window.__stairDump?.name === name) {
            const SG = window.__stairDump.SG, geo = m.real.inner._sgGeo;
            const sole = (sd) => SG && geo ? SG.solePoints(B, sd, geo).map((p) => { const q = ST.flightLocal(f, p.x, p.z); return [+q.s.toFixed(3), +(p.y - f.levels[ST.levelIndex(f, q.s)]).toFixed(3)]; }) : null;
            const ft = (F, sd) => ({ pl: F.planted, e: F.early, st: !!F.settle, fl: F.flat, f: !!F.force, gap: F.gap, k: F.plant?.k ?? null, ps: F.plant ? +ST.flightLocal(f, F.plant.x, F.plant.z).s.toFixed(3) : null, sole: sole(sd), sw: F.sw ? [F.sw.from?.k, F.sw.to?.k, F.sw.u] : null });
            window.__stairDump.rows.push({ leg: L.leg, k, s, ts: m.real?.inner?.mixer?.timeScale, dy: S.dy, dyT: S.dyT, n: S.n, l: ft(S.feet.l, 'l'), r: ft(S.feet.r, 'r') });
          }
          for (const sd of ['l', 'r']) {
            const F = S.feet[sd];
            if (F.flat && F.gap != null) L.gaps.push(F.gap);
            // (a planted foot over its tread — coming down onto it, settling — for no longer than a moment)
            L.hang[sd] = F.planted && !F.early && F.gap > 0.04 ? L.hang[sd] + 1 : 0;
            L.hangMax = Math.max(L.hangMax, L.hang[sd]);
            if (!F.planted && F.gap != null) L.swingMin = Math.min(L.swingMin, F.gap);
            // (a foothold on a tread — not the floor before the flight or its landing, where steps stay on one level)
            if (F.plant && F.plant !== L.lastPlant[sd]) { L.lastPlant[sd] = F.plant; if (F.plant.k > 0 && F.plant.k < f.risers.length) L.plants.push([sd, F.plant.k]); }
          }
          // the body over the nosing line (pelvis height − line height)
          if (B?.pelvis) { const p = B.pelvis.getWorldPosition(new (B.pelvis.position.constructor)()); L.rise.push(p.y - ST.lineAt(f, ST.flightLocal(f, p.x, p.z).s)); }
          // T-pose: both elbows at shoulder height and both hands far out to the sides
          if (B?.upperarm_l && B.lowerarm_l && B.hand_l && B.upperarm_r && B.lowerarm_r && B.hand_r) {
            const P = (n) => B[n].getWorldPosition(new (B.pelvis.position.constructor)());
            const tp = ['l', 'r'].every((sd) => { const sh = P('upperarm_' + sd), el = P('lowerarm_' + sd), ha = P('hand_' + sd); return Math.abs(el.y - sh.y) < 0.1 && Math.abs(ha.y - sh.y) < 0.15 && Math.hypot(ha.x - sh.x, ha.z - sh.z) > 0.5; });
            if (tp) L.tpose++;
          }
        }
        // per-leg verdicts
        const gs = L.gaps.slice().sort((x, y) => x - y), p95 = gs.length ? gs[Math.floor(gs.length * 0.95)] : null;
        const steps = []; for (let i = 1; i < L.plants.length; i++) steps.push((L.plants[i][1] - L.plants[i - 1][1]) * dir);
        const sameFoot = []; for (const sd of ['l', 'r']) { const p = L.plants.filter((q) => q[0] === sd); for (let i = 1; i < p.length; i++) sameFoot.push((p[i][1] - p[i - 1][1]) * dir); }
        const span = L.rise.length ? Math.max(...L.rise) - Math.min(...L.rise) : 0;
        Object.assign(L, { p95: p95 == null ? null : +p95.toFixed(3), minGap: gs.length ? +gs[0].toFixed(3) : null, nPlants: L.plants.length, steps, sameFoot, span: +span.toFixed(3), swingMin: +L.swingMin.toFixed(3) });
        const bad = [];
        if (L.frames < 20) bad.push(`only ${L.frames} frames on the treads`);
        if (L.on < L.frames * 0.95) bad.push(`stair gait off (${L.on}/${L.frames})`);
        if (L.loco < L.frames * 0.95) bad.push(`no stepping clip (${JSON.stringify(L.clips)})`);
        if (L.tpose > 0) bad.push(`T-pose ${L.tpose} frames`);
        if ((p95 == null && f.sTop - f.sFoot >= 5) || p95 > 0.03 || gs[0] < -0.02) bad.push(`sole on the tread p95 ${p95} min ${gs[0]}`);
        if (L.swingMin < -0.02) bad.push(`a swinging foot into a tread (${L.swingMin})`);
        if (L.hangMax > 12) bad.push(`a planted foot over its tread for ${L.hangMax} frames`);
        if (L.nPlants < (f.sTop - f.sFoot < 5 ? 2 : 3)) bad.push(`only ${L.nPlants} footholds`);
        // (each foot steps on to another tread the way he goes — a re-plant on its own tread now and then aside: a
        // turn on the stairs, a stride catching up with the cadence; the flat-ground walk on a slope steps on no tread)
        const fwd = sameFoot.filter((d) => d >= 1).length, back = sameFoot.filter((d) => d < 0).length;
        if (back > 1 || fwd < (f.sTop - f.sFoot < 5 ? 1 : sameFoot.length * 0.7)) bad.push(`the feet do not step up / down the treads (${sameFoot})`);
        if (span < 0.08) bad.push(`the body glides (rise span ${span})`);
        if (bad.length) { res.ok = false; res.why.push(`${L.leg}: ${bad.join('; ')}`); }
        delete L.lastPlant; delete L.gaps; delete L.rise; delete L.plants;
        res[L.leg] = L;
      }
      return res;
    };
    let frameW = null;
    /** One 60 Hz frame: a sim tick, then the units' models as Game.render steps them (no culling: nothing is drawn). */
    function frame(w) {
      g.step();
      um.charactersFrame(false);
      for (const e of w.entities) if (e.kind === 'commando' || e.kind === 'enemy') { e.syncTransform?.(1); e.renderUpdate?.(1 / 60); }
      um.transportFrame();
      frameW = w;
    }
    const ready = async (u) => { await u.model.ready; return u; };

    // ---------------------------------------------------------------- M3: the dam's W stair
    await g.loadMission('m03'); g.start();
    let w = G.world;
    if (G._raf) { cancelAnimationFrame(G._raf); G._raf = null; }
    clear(w);
    let f = w.stairs.flights[0];
    const runs = [];
    for (const role of ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy']) for (const run of [false, true]) runs.push({ name: `${role} ${run ? 'run' : 'walk'}`, run, mk: () => new Commando({ role, x: 0, z: 0 }) });
    runs.push({ name: 'spy in uniform walk', run: false, mk: () => new Commando({ role: 'spy', x: 0, z: 0 }), set: (u) => u.setDisguise(true) });
    runs.push({ name: 'spy in uniform run', run: true, mk: () => new Commando({ role: 'spy', x: 0, z: 0 }), set: (u) => u.setDisguise(true) });
    runs.push({ name: 'greenberet knife out walk', run: false, mk: () => new Commando({ role: 'greenberet', x: 0, z: 0 }), set: (u) => { u.knifeShow = 1e9; } });
    runs.push({ name: 'greenberet carrying a man', run: false, mk: () => new Commando({ role: 'greenberet', x: 0, z: 0 }), carry: 'shoulder' });
    runs.push({ name: 'spy carrying a man', run: false, mk: () => new Commando({ role: 'spy', x: 0, z: 0 }), carry: 'shoulder' });
    for (const st of ['afrika', 'crew', 'engineer', 'general', 'mg', 'officer', 'rifleman', 'sentry', 'sergeant', 'trooper', 'winter']) for (const run of [false, true]) {
      runs.push({ name: `German ${st} ${run ? 'run' : 'walk'}`, run, mk: () => { const e = new Enemy({ id: `stair_${st}`, soldierType: st, x: 0, z: 0 }); e.brain = stub(); return e; } });
    }
    for (const gid of ['mcrae', 'informer', 'prisoner_worker']) runs.push({ name: `guest ${gid} walk`, run: false, mk: () => new Commando({ role: 'guest', guestId: gid, x: 0, z: 0 }) });
    for (const R of runs) {
      clear(w);
      const u = await ready(w.add(R.mk()));
      if (u.brain && u.faction === 'enemy') u.brain = stub();
      R.set?.(u);
      if (R.carry) {
        const p = ST.flightWorld(f, 1.2, 0.35), body = await ready(w.add(new Enemy({ id: 'stair_body', soldierType: 'rifleman', x: p.x, z: p.z })));
        body.brain = stub(); body.y = ST.lineAt(f, 1.2);
        const a = ST.flightWorld(f, 1.2, -0.3); u.setPosition(a.x, a.z); u.y = ST.lineAt(f, 1.2);
        body.die('knife', null);
        for (let i = 0; i < 90; i++) frame(w);
        u.issue({ type: 'ability', id: 'hand', target: body });
        for (let i = 0; i < 60 * 4 && !(u.carrying === body && !u.carryTransition && !u.pendingAbility); i++) frame(w);
        if (u.carrying !== body) { out.push({ name: R.name, ok: false, why: ['could not take the body'] }); continue; }
        // up from where he picked him up, then back down
        out.push(await climb(w, f, u, { s0: 1.2, s1: f.sTop - 1.5, run: false, name: R.name }));
        continue;
      }
      out.push(await climb(w, f, u, { s0: 0.6, s1: f.sTop - 1.2, run: R.run, name: R.name }));
    }
    // dragging a man up a flight is refused (bodies-design §C.2; entities/stair-walk.js pathOnStairs)
    {
      clear(w);
      const u = await ready(w.add(new Commando({ role: 'sniper', x: 0, z: 0 })));
      const p = ST.flightWorld(f, -1.5, 0.9), body = await ready(w.add(new Enemy({ id: 'stair_body2', soldierType: 'rifleman', x: p.x, z: p.z })));
      body.brain = stub();
      const a = ST.flightWorld(f, -1.5, 0); u.setPosition(a.x, a.z);
      body.die('knife', null);
      for (let i = 0; i < 60; i++) frame(w);
      u.issue({ type: 'ability', id: 'hand', target: body });
      for (let i = 0; i < 60 * 4 && !(u.carrying === body && !u.carryTransition && !u.pendingAbility); i++) frame(w);
      const top = ST.flightWorld(f, f.sTop + 1, 0);
      out.push({ name: 'sniper dragging a man: up the stair refused', ok: u.carryMode === 'drag' && u.issue({ type: 'move', x: top.x, z: top.z }) === false, why: [`mode ${u.carryMode}`] });
    }
    // the Driver from M8 on (burnt)
    {
      clear(w);
      await um.prepareCharacters({ id: 'm08', theater: 'desert', enemies: [] });
      const u = await ready(w.add(new Commando({ role: 'driver', x: 0, z: 0 })));
      const id = u.model.characterId;
      const res = await climb(w, f, u, { s0: 0.6, s1: f.sTop - 1.2, run: false, name: `driver (${id}) walk` });
      out.push(res);
      await um.prepareCharacters(G.missionDef);
    }

    // ---------------------------------------------------------------- M2 plat_sw, an M20 stone flight
    for (const [mid, pick, s0f, s1f] of [['m02', (fl) => fl[0], (f) => f.sFoot - 0.2, (f) => f.sTop + 0.4], ['m20', (fl) => fl.find((q) => q.kind === 'link' && q.risers.length >= 15 && q.tread > 0.3), (f) => -0.6, (f) => f.sTop + 0.6]]) {
      await g.loadMission(mid); g.start();
      w = G.world;
      if (G._raf) { cancelAnimationFrame(G._raf); G._raf = null; }
      for (let i = 0; i < 60; i++) g.step(); // (M20's opening puts every standing commando on his belly in its first half second)
      f = pick(w.stairs.flights);
      for (const [nm, mk] of [['greenberet', () => new Commando({ role: 'greenberet', x: 0, z: 0 })], ['German rifleman', () => { const e = new Enemy({ id: 'stair_x', soldierType: 'rifleman', x: 0, z: 0 }); e.brain = stub(); return e; }]]) {
        for (const run of [false, true]) {
          clear(w);
          const u = await ready(w.add(mk()));
          if (u.faction === 'enemy') u.brain = stub(); else if (u.stance !== 'stand') u.issue({ type: 'stance', stance: 'stand' });
          for (let i = 0; i < 40; i++) frame(w);
          out.push(await climb(w, f, u, { s0: s0f(f), s1: s1f(f), run, name: `${mid} ${f.id ?? f.kind}: ${nm} ${run ? 'run' : 'walk'}` }));
        }
      }
    }
    void frameW;
    return out;
  });
  for (const x of r) {
    const brief = (L) => L ? `${L.leg} frames ${L.frames} on ${L.on} plants ${L.nPlants} p95 ${L.p95} min ${L.minGap} swing ${L.swingMin} hang ${L.hangMax} rise ${L.span}` : '';
    t.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.name}: ${brief(x.up)} | ${brief(x.down)}${x.ok ? '' : ' — ' + x.why.join(' / ')}`);
  }
  const bad = r.filter((x) => !x.ok);
  t.log(`${r.length - bad.length} / ${r.length} combinations ok`);
  t(r.length >= 50, `the whole matrix ran (${r.length})`);
  t(!bad.length, `failing: ${bad.map((x) => `${x.name}: ${x.why.join(' / ')}`).join(' || ')}`);
}
