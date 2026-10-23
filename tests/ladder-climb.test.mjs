/**
 * Ladder climbing (user feedback 2026-10-08: "Commando still too close to vertical ladder when climbing"). Every
 * climbed ladder of every mission that leads somewhere (steep ladder links whose top is walkable ground at its height
 * and which a path takes; M2's raised camp ladder lowered) is climbed up and down by the Green Beret; one ladder (M8's
 * fuel tank) also by every commando — the Spy also in his officer's uniform — and by a German of every look. Per frame
 * (art/ladder-climb.js state, the ladder's frame from art/ladder-frame.js, rays against the scene's static geometry):
 *  - on the rungs (both feet on rungs): the chest 0.30–0.40 m out of the rung line (median; p5 ≥ 0.27, p95 ≤ 0.43), the
 *    pelvis further out than the chest (median) and ≤ 0.7 m, the head ≥ 0.13 m (p5), the knees never behind the rung
 *    line (above the ladder's top the distances are off the plumb line up from it: ladder-frame.js outOf);
 *  - a hand holding a rung or a stile has its knuckles within about 3 cm of the grip (median ≤ 1.5 cm, p95 ≤ 3.5 cm)
 *    with geometry under / beside them (≤ 8 cm); a foot on a rung has the ball as near its spot (same bounds) with the
 *    rung under it;
 *  - nothing goes into the ladder or the wall, getting on and off included: the chest, pelvis, head and knees keep
 *    their radius from the first surface ahead (rays towards the ladder; rubble round the foot of a ruin's ladder,
 *    knee-high and well out of it while he stands there, is listed, not counted);
 *  - the climb happens (he gets to the top end and back down to the foot end; a way down round on foot is fine).
 * The mission's own end (its men are cleared away) is held off: it stays 'playing'.
 * Logic + model updates per frame (no frames drawn but one per mission, which measures the late scenery).
 */
export const timeout = 2_400_000;

/**
 * Where the scenery leaves no clear way up (the art, not the climb): what touches it there — from `from` of the way
 * up, for `who` (every climber when not given) — is listed, not counted, and so is a knee kept closer to the rungs
 * than their line by the room behind him. Everything else is checked as everywhere.
 */
const ART = {
  'm17:1': { from: 0.6, why: "a roof's eave hangs low over the wall top he climbs over (head / chest brush it)" },
  'm08:6': { from: 0, who: 'greenberet', why: "the tank's cage is 0.56 m deep: the tallest man's back clears its hoops only with his knees by the rungs" },
  'm08:7': { from: 0, who: 'greenberet', why: "the tank's cage is 0.56 m deep: the tallest man's back clears its hoops only with his knees by the rungs" },
};

export default async function ladderClimb(page, t) {
  const only = process.env.LADDER_ONLY || ''; // e.g. "m08:6,m12" — a subset while working on it
  // every mission (user 2026-10-15: every ladder in the game climbed both ways — no dead ladders left)
  const missions = ['m00', 'm01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm09', 'm10', 'm11', 'm12', 'm13', 'm14', 'm15', 'm16', 'm17', 'm18', 'm19', 'm20', 'b00'];
  const out = [];
  for (const mis of missions) {
    if (only && !only.split(',').some((s) => s.split(':')[0] === mis)) continue;
    const r = await page.evaluate(async ({ mis, only, ART }) => {
      const g = window.__game, G = g.game, THREE = await import('three');
      const um = await import('/src/art/unit-model.js');
      const LF = await import('/src/art/ladder-frame.js');
      const LC = await import('/src/art/ladder-climb.js');
      const { Commando } = await import('/src/entities/commando.js');
      const { Enemy } = await import('/src/entities/enemy.js');
      const { steepLadder } = await import('/src/entities/stair-walk.js');
      const stub = () => ({ update() {}, attach() {}, hear() {}, onDeath() {}, isAware: () => false, state: 'IDLE', serialize: () => null, deserialize() {}, notifyKill() {}, onBodyFound() {}, distractBy: () => false, releaseDistraction() {} });
      await g.loadMission(mis); g.start();
      if (G._raf) { cancelAnimationFrame(G._raf); G._raf = null; }
      for (let i = 0; i < 3; i++) g.step();
      G.render(1 / 60, 1); // (a mission script's scenery is in: the ladders measured again)
      const w = G.world, grid = w.grid;
      // every ladder a library model draws (its sidecar's ladders, 1.5 m up or more) has its walk-grid link at it — foot and
      // top within 1.2 m: a tank's (the fuel family's, M11's process tanks) fails without one; any other is listed
      const drawn = [];
      {
        const BL = await import('/src/art/building-library.js');
        const objs = [];
        G.renderer.scene.traverse((o) => { if (o.userData?.libraryAsset) objs.push(o); });
        const v = new THREE.Vector3();
        for (const outer of objs) {
          const asset = outer.userData.libraryAsset, meta = BL.buildingMeta(asset);
          const inner = outer.getObjectByName('fit')?.children[0]?.children[0];
          if (!meta?.ladders?.some((l) => l.y >= 1.5) || !inner) continue;
          outer.updateMatrixWorld(true);
          const pt = (q) => { v.set(q[0], 0, q[1]).applyMatrix4(inner.matrixWorld); return [v.x, v.z]; };
          const tank = (meta.types || [meta.type]).some((ty) => /^(fueltank|oil_tank_ms)$/.test(ty));
          for (const l of meta.ladders) {
            if (!(l.y >= 1.5)) continue;
            const a = pt(l.a), b = pt(l.b);
            const at = (p) => (L) => [L.a, L.b].some((e) => Math.hypot(e.x - p[0], e.z - p[1]) < 1.2);
            const L = grid.links.find((q) => q.kind === 'ladder' && at(a)(q) && at(b)(q));
            drawn.push({ asset, id: outer.name.replace(/^prop:/, ''), tank, link: L?.id ?? null, at: `(${a[0].toFixed(1)}, ${a[1].toFixed(1)}) → (${b[0].toFixed(1)}, ${b[1].toFixed(1)}, ${l.y} m)` });
          }
        }
      }
      const clear = () => { for (const e of [...w.entities]) if (e.kind === 'enemy' || e.kind === 'commando' || e.kind === 'vehicle') w.remove(e); w.flushRemovals?.(); };
      clear();
      function frame() {
        // (the men the mission needs are cleared away: its loss — M11 — is no end of this test)
        if (G.state !== 'playing') G.state = 'playing';
        g.step();
        um.charactersFrame(false);
        for (const e of w.entities) if (e.kind === 'commando' || e.kind === 'enemy') { e.syncTransform?.(1); e.renderUpdate?.(1 / 60); }
        um.transportFrame();
      }
      // every climbed ladder: each end on walkable ground at its height (a dead ladder — a top nobody can stand on — fails)
      const ladders = [], dead = [];
      for (const L of grid.links.filter((l) => l.kind === 'ladder' && !l.walk && steepLadder(l))) {
        const def = (w.ladders || []).find((q) => q.linkId === L.id);
        if (def?.raised) grid.setLinkEnabled(L.id, true); // (M2's camp ladder: lowered)
        const [foot, top] = L.a.y <= L.b.y ? [L.a, L.b] : [L.b, L.a];
        if (only && !only.split(',').some((e) => e === mis || e === `${mis}:${L.id}`)) continue;
        const endOk = (p) => grid.walkableAt(p.x, p.z) && Math.abs(grid.elevAt(p.x, p.z) - p.y) < 0.35;
        if (!L.enabled || !endOk(top) || !endOk(foot)) {
          dead.push({ name: '-', lad: `${mis}:${L.id}${def ? ` (${def.id})` : ''}`, src: '-', ok: false, why: [`a dead ladder: ${!L.enabled ? 'disabled' : !endOk(top) ? `its top (${top.y.toFixed(2)} m) is no walkable ground` : `its foot (${foot.y.toFixed(2)} m) is no walkable ground`}`], sum: {}, rung: 0, frames: 0 });
          continue;
        }
        ladders.push({ L, foot, top, def: def?.id ?? null });
      }
      G.render(1 / 60, 1); // (the lowered camp ladder drawn)
      const res = [...dead];
      if (!only || only.split(',').includes(mis)) {
        for (const d of drawn) {
          if (d.link != null) res.push({ drawnInfo: `drawn ${mis} ${d.id} (${d.asset}) ${d.at}: link ${d.link}` });
          else if (d.tank) res.push({ name: '-', lad: `${mis} ${d.id}`, src: 'drawn', ok: false, why: [`a tank's ladder drawn with no link (${d.asset} ${d.at})`], sum: {}, rung: 0, frames: 0 });
          else res.push({ drawnInfo: `drawn ${mis} ${d.id} (${d.asset}) ${d.at}: no link (not a tank: listed)` });
        }
      }
      const climbers = (lad) => {
        const list = [['greenberet', () => new Commando({ role: 'greenberet', x: 0, z: 0 })]];
        if (mis === 'm08' && lad.L.id === 6) {
          for (const role of ['sniper', 'diver', 'sapper', 'driver', 'spy']) list.push([role, () => new Commando({ role, x: 0, z: 0 })]);
          list.push(['spy in uniform', () => new Commando({ role: 'spy', x: 0, z: 0 }), (u) => u.setDisguise(true)]);
          for (const st of ['afrika', 'crew', 'engineer', 'general', 'mg', 'officer', 'rifleman', 'sentry', 'sergeant', 'trooper', 'winter']) {
            list.push([`German ${st}`, () => { const e = new Enemy({ id: `lad_${st}`, soldierType: st, x: 0, z: 0 }); e.brain = stub(); return e; }]);
          }
        }
        return list;
      };
      for (const lad of ladders) {
        const F = LF.ladderFrame(w, lad.L);
        // (inside a building — walls all round, a floor over the way up: no ladder is drawn there and the climb is out of
        // sight — he still gets up and back down; the pose checks need a drawn ladder and are not run)
        const inside = F.source === 'inside';
        // the static geometry round the ladder (rays)
        const box = new THREE.Box3(new THREE.Vector3(Math.min(lad.foot.x, lad.top.x) - 2.5, lad.foot.y - 0.5, Math.min(lad.foot.z, lad.top.z) - 2.5),
          new THREE.Vector3(Math.max(lad.foot.x, lad.top.x) + 2.5, lad.top.y + 2.5, Math.max(lad.foot.z, lad.top.z) + 2.5));
        const skip = new Set(); for (const e of w.entities) if (e.object3d && /^(commando|enemy|vehicle|dog)$/.test(e.kind)) skip.add(e.object3d);
        G.renderer.scene.updateMatrixWorld(true);
        const geo = LF._debug.collectParts(G.renderer.scene, box, skip);
        const ray = (o, d, far) => LF._debug.castFirst(geo, o, d, far);
        const fdir = new THREE.Vector3(F.fx, 0, F.fz), wdir = new THREE.Vector3(F.lx, 0, F.lz), down = new THREE.Vector3(0, -1, 0);
        for (const [name, mk, set] of climbers(lad)) {
          clear();
          const u = w.add(mk());
          await u.model.ready;
          if (u.faction === 'enemy') u.brain = stub();
          set?.(u);
          // (from the ladder's foot end — the walkable spot nearest it — back to it)
          let back = { x: lad.foot.x, z: lad.foot.z };
          if (!grid.walkableAt(back.x, back.z)) for (let r = 0.25; r <= 1.5 && !grid.walkableAt(back.x, back.z); r += 0.25) for (let a = 0; a < 16; a++) { const x = lad.foot.x + Math.cos(a * Math.PI / 8) * r, z = lad.foot.z + Math.sin(a * Math.PI / 8) * r; if (grid.walkableAt(x, z) && Math.abs(grid.elevAt(x, z) - lad.foot.y) < 0.3) { back = { x, z }; break; } }
          u.setPosition(back.x, back.z, Math.atan2(F.fz, F.fx)); u.y = lad.foot.y;
          for (let i = 0; i < 20; i++) frame();
          const M = { name, lad: `${mis}:${lad.L.id}${lad.def ? ` (${lad.def})` : ''}`, src: F.source, frames: 0, onLad: 0, rung: 0, chest: [], pelvis: [], head: [], knee: [], hand: [], foot: [], handGeo: [0, 0], footGeo: [0, 0], pen: [], clutter: [], art: [], airH: [], airF: [], offH: [], offF: [], top: false, back: false };
          const B = u.model.real.inner.bones, wp = (b) => b.getWorldPosition(new THREE.Vector3());
          for (const [leg, goal] of [['up', lad.top], ['down', back]]) {
            const ok = u.faction === 'enemy' ? u.moveTo(goal.x, goal.z, {}) : u.issue({ type: 'move', x: goal.x, z: goal.z });
            if (!ok) { M.err = `${leg}: no path`; break; }
            // (a way round on foot is shorter: this ladder is not the way, nothing to measure)
            if (leg === 'up' && !u.path?.some((q) => q.link?.id === lad.L.id)) { M.skip = 'not the way up (a way round)'; break; }
            // (down by a way round on foot: the climb down is not this ladder's — the way up was)
            const round = leg === 'down' && !u.path?.some((q) => q.link?.id === lad.L.id);
            let usedLadder = false, pMin = 1, pMax = 0;
            for (let k = 0; k < 60 * 40 && u.path; k++) {
              frame(); M.frames++;
              const S = u.model._lc?.state;
              if (!u._ladder && !(u.model._lc?.w > 0)) continue;
              usedLadder ||= !!u._ladder;
              if (!S) continue;
              M.onLad++;
              if (u._ladder) { pMin = Math.min(pMin, S.P); pMax = Math.max(pMax, S.P); }
              const lo = (p) => LF.outOf(F, p); // (above the ladder's top: off the plumb line up from it)
              const chest = LC.chestPoint(B), pel = wp(B.pelvis), head = wp(B.Head || B.head), kl = wp(B.calf_l), kr = wp(B.calf_r);
              const full = u.model._lc.w >= 0.999;
              // (the walk between the link's end and the ladder's own foot is walking, not climbing: not checked)
              const walking = S.lead != null && S.lead < 0.7, A = ART[`${mis}:${lad.L.id}`];
              const art = A && (!A.who || A.who === name) && (S.Pc ?? S.P) >= A.from; // (Pc: the way up the rungs; P runs on over the move onto the deck)
              if (full && S.onRungs >= 0.999) {
                M.rung++;
                M.chest.push(lo(chest)); M.pelvis.push(lo(pel)); M.head.push(lo(head));
                // (a knee over the top — stepping onto the deck — is over the deck: only the ones below it count)
                const vTop = Math.max(F.H, F.over ?? F.H), kn = [kl, kr].filter((p) => p.y - lad.foot.y <= vTop).map((p) => LF.local(F, p).o);
                if (kn.length) { if (art && Math.min(...kn) < 0) { if (M.art.length < 3) M.art.push(`knee ${Math.min(...kn).toFixed(3)} behind the rungs at ${S.P.toFixed(2)}`); } else M.knee.push(Math.min(...kn)); }
              }
              if (full && k % 3 === 0 && !walking) {
                // nothing in the ladder: the first surface ahead keeps each part's radius
                // (rubble round the foot of a ruin's ladder — well out of the ladder, knee-high, while he stands on the
                // ground there — is no part of the ladder or its wall: listed, not counted)
                const atFoot = ['l', 'r'].some((s) => S.feet[s].zone === 'ground' || S.feet[s].from === 'ground' || S.feet[s].to === 'ground');
                for (const [nm, p, rad] of [['chest', chest, 0.08], ['pelvis', pel, 0.08], ['head', head, 0.07], ['knee L', kl, 0.04], ['knee R', kr, 0.04]]) {
                  for (const dw of [-rad, 0, rad]) {
                    const o = p.clone().addScaledVector(wdir, dw), d = ray(o, fdir, 1);
                    if (d != null && d < rad) {
                      const hp = o.clone().addScaledVector(fdir, d);
                      if (atFoot && lo(hp) >= 0.25 && hp.y - lad.foot.y < 1) { if (M.clutter.length < 3) M.clutter.push(`${nm} ${d.toFixed(3)} at ${S.P.toFixed(2)}`); break; }
                      if (art) { if (M.art.length < 3) M.art.push(`${nm} ${d.toFixed(3)} at ${S.P.toFixed(2)}`); break; }
                      M.pen.push(`${nm} ${d.toFixed(3)} at ${S.P.toFixed(2)}${S.vault != null ? ` (onto the deck ${S.vault.toFixed(2)}, ${leg})` : ''}`); break;
                    }
                  }
                }
                for (const s of ['l', 'r']) {
                  const H = S.hands[s];
                  if ((H.kind === 'rung' || H.kind === 'stile') && H.w >= 0.999) {
                    const kn = wp(B['middle_01_' + s] || B['hand_' + s]);
                    M.hand.push(kn.distanceTo(H.grip));
                    let near = false;
                    for (const d of [down, fdir, wdir, wdir.clone().negate(), new THREE.Vector3(0, 1, 0)]) { const x = ray(kn.clone().addScaledVector(d, -0.04), d, 0.12); if (x != null) { near = true; break; } }
                    M.handGeo[0]++; if (near) M.handGeo[1]++; else if (M.airH.length < 6) M.airH.push(`${s}${H.kind[0]}@${(H.grip.y - lad.foot.y).toFixed(2)}`);
                    if (kn.distanceTo(H.grip) > 0.03 && M.offH.length < 6) M.offH.push(`${s}${H.kind[0]}@${(H.grip.y - lad.foot.y).toFixed(2)}:${kn.distanceTo(H.grip).toFixed(2)} P${S.P.toFixed(2)}`);
                  }
                  const Fo = S.feet[s];
                  if (Fo.zone === 'rung') {
                    const bl = wp(B['ball_' + s]);
                    M.foot.push(bl.distanceTo(Fo.ball));
                    if (bl.distanceTo(Fo.ball) > 0.03 && M.offF.length < 6) M.offF.push(`${s}@${(Fo.ball.y - lad.foot.y).toFixed(2)}:${bl.distanceTo(Fo.ball).toFixed(2)} P${S.P.toFixed(2)}`);
                    // (the sole under the ball: the rung somewhere under its length)
                    let d = null;
                    for (const df of [0, -0.035, 0.035]) { const x = ray(bl.clone().add(new THREE.Vector3(0, 0.08, 0)).addScaledVector(fdir, df), down, 0.25); if (x != null && (d == null || x < d)) d = x; }
                    M.footGeo[0]++; if (d != null && d < 0.08 + 0.09) M.footGeo[1]++; else if (M.airF.length < 6) M.airF.push(`${s}@${(Fo.ball.y - lad.foot.y).toFixed(2)}${d == null ? '' : `:${d.toFixed(2)}`}`);
                  }
                }
              }
            }
            // (all the way: up to the top end and down to the foot end — where the walk grid then puts him is its own)
            if (leg === 'up') M.top = usedLadder && pMax >= 0.98;
            else M.back = round ? 'round' : usedLadder && pMin <= 0.02;
          }
          const q = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(3); };
          M.sum = { chest: [q(M.chest, 0.05), q(M.chest, 0.5), q(M.chest, 0.95)], pelvis: [q(M.pelvis, 0.05), q(M.pelvis, 0.5), q(M.pelvis, 0.95)], head: q(M.head, 0.05), knee: q(M.knee, 0), hand95: q(M.hand, 0.95), foot95: q(M.foot, 0.95), hand50: q(M.hand, 0.5), foot50: q(M.foot, 0.5) };
          if (M.skip) { res.push({ name: M.name, lad: M.lad, src: M.src, ok: true, skip: M.skip, why: [], sum: {}, rung: 0, frames: M.frames }); continue; }
          const bad = [];
          if (M.err) bad.push(M.err);
          if (!M.top || !M.back) bad.push(`climb not done (top ${M.top}, back ${M.back})`);
          if (inside) { res.push({ name: M.name, lad: M.lad, src: M.src, ok: !bad.length, why: bad, sum: {}, rung: M.rung, frames: M.frames, inside: true }); continue; }
          if (M.rung < 20) bad.push(`only ${M.rung} frames on the rungs`);
          const c = M.sum.chest;
          if (c[1] == null || c[1] < 0.3 || c[1] > 0.4 || c[0] < 0.27 || c[2] > 0.43) bad.push(`chest out ${c}`);
          const pv = M.sum.pelvis;
          if (pv[1] == null || pv[1] < c[1] || pv[2] > 0.7 || pv[0] < 0.27) bad.push(`pelvis out ${pv}`);
          if (M.sum.head == null || M.sum.head < 0.13) bad.push(`head ${M.sum.head}`);
          if (M.sum.knee == null || M.sum.knee < 0) bad.push(`knee behind the rung line (${M.sum.knee})`);
          if (M.sum.hand95 == null || M.sum.hand95 > 0.035 || M.sum.hand50 > 0.015) bad.push(`hands off their grips (median ${M.sum.hand50}, p95 ${M.sum.hand95})`);
          if (M.sum.hand95 > 0.035) bad.push(`(off: ${M.offH.join(' ')})`);
          if (M.handGeo[0] && M.handGeo[1] < M.handGeo[0] * 0.97) bad.push(`grips in the air (${M.handGeo}: ${M.airH.join(' ')})`);
          if (M.sum.foot95 == null || M.sum.foot95 > 0.035 || M.sum.foot50 > 0.015) bad.push(`feet off their rungs (median ${M.sum.foot50}, p95 ${M.sum.foot95}: ${M.offF.join(' ')})`);
          if (M.footGeo[0] && M.footGeo[1] < M.footGeo[0] * 0.97) bad.push(`feet on air (${M.footGeo}: ${M.airF.join(' ')})`);
          if (M.pen.length) bad.push(`into the ladder / wall ×${M.pen.length}: ${M.pen.slice(0, 3).join('; ')}`);
          res.push({ name: M.name, lad: M.lad, src: M.src, ok: !bad.length, why: bad, sum: M.sum, rung: M.rung, frames: M.frames, clutter: M.clutter, art: M.art.length ? `${ART[`${mis}:${lad.L.id}`].why}: ${M.art.join('; ')}` : null });
        }
      }
      return res;
    }, { mis, only, ART });
    for (const x of r) {
      if (x.drawnInfo) { t.log(x.drawnInfo); continue; }
      if (x.skip) { t.log(`skip ${x.lad} [${x.src}] ${x.name}: ${x.skip}`); out.push(x); continue; }
      t.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.lad} [${x.src}] ${x.name}: chest ${x.sum.chest} pelvis ${x.sum.pelvis} head ${x.sum.head} knee ${x.sum.knee} hand ${x.sum.hand95} foot ${x.sum.foot95} (${x.rung} on rungs)${x.clutter?.length ? ` (rubble at the foot: ${x.clutter.join('; ')})` : ''}${x.art ? ` (art: ${x.art})` : ''}${x.ok ? '' : ' — ' + x.why.join(' / ')}`);
      out.push(x);
    }
  }
  const bad = out.filter((x) => !x.ok), done = out.filter((x) => !x.skip);
  t.log(`${done.length - bad.length} / ${done.length} climbs ok (${out.filter((x) => x.inside).length} inside buildings: climbed, pose unchecked; ${out.length - done.length} skipped: not the way)`);
  t(done.length >= (process.env.LADDER_ONLY ? 1 : 45), `climbs run (${done.length})`);
  t(!bad.length, `failing: ${bad.map((x) => `${x.lad} ${x.name}: ${x.why.join(' / ')}`).join(' || ')}`);
}
