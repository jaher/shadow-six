/**
 * Stair gait in the running game (user request 2026-10-07: "Also make sure to animate the commandos climbing and going
 * down stairs properly"): the Green Beret and a German walk up and down the M3 dam's W stair and M2's plat_sw stair,
 * drawn from the side (frames saved: tests/out/stairs-gait-*.png). Measured on the drawn skeletons (art/stair-gait.js):
 *  - each foot flat on a tread has its sole within 3 cm of it (p95; never more than 2 cm into it) — the boot mesh's own
 *    heel, ball and toe vertices against the tread under each;
 *  - footholds go up / down the treads one or two at a time; the body rises and sinks with them;
 *  - on the treads the unit's height follows the flight's nosing line (no cell-by-cell snaps) at the stair pace.
 */
export const timeout = 300_000;

export default async function stairsGait(page, t) {
  const shots = [];
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const ST = await import('/src/world/stairs.js');
    const { Enemy } = await import('/src/entities/enemy.js');
    const stub = () => ({ update() {}, attach() {}, hear() {}, onDeath() {}, isAware: () => false, state: 'IDLE', serialize: () => null, deserialize() {}, notifyKill() {}, onBodyFound() {}, distractBy: () => false, releaseDistraction() {} });
    window.__sg = { ST, Enemy, stub };
    return true;
  });
  t(r, 'set up');
  const out = [];
  for (const [mid, fIdx] of [['m03', 0], ['m02', 0]]) {
    for (const who of ['greenberet', 'rifleman']) {
      await page.evaluate(async ({ mid, fIdx, who }) => {
        const g = window.__game, G = g.game, { ST, Enemy, stub } = window.__sg;
        await g.loadMission(mid); g.start();
        if (G._raf) { cancelAnimationFrame(G._raf); G._raf = null; }
        const w = G.world, f = w.stairs.flights[fIdx];
        for (const e of [...w.entities]) if ((e.kind === 'enemy' || e.kind === 'commando') && !(who === 'greenberet' && e.role === 'greenberet')) w.remove(e);
        w.flushRemovals?.();
        let u = w.commandos.find((c) => c.role === 'greenberet');
        if (who !== 'greenberet') { u = w.add(new Enemy({ id: 'stair_g', soldierType: who, x: 0, z: 0 })); u.brain = stub(); await u.model.ready; }
        const short = f.sTop - f.sFoot < 5, s0 = short ? f.sFoot - 0.3 : 0.6, s1 = short ? f.sTop + 0.5 : f.sTop - 1.2;
        const a = ST.flightWorld(f, s0, 0);
        u.setPosition(a.x, a.z, Math.atan2(f.uz, f.ux)); u.y = ST.lineAt(f, s0);
        const c = G.cameraController;
        c.azimuth = Math.atan2(-f.uz, f.ux); c.elevation = 12 * Math.PI / 180;
        window.__sg.cur = { u, f, s0, s1, look: () => {
          const o = u.object3d.position;
          c.target.set(o.x, o.y + 0.8, o.z); c._applyTransform(); c.target.set(o.x, o.y + 0.8, o.z);
          const cam = c.camera; cam.position.copy(c.target).addScaledVector(c.viewOffset(), c.distance); cam.lookAt(c.target);
          cam.zoom = 5; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
        } };
        for (let i = 0; i < 30; i++) { g.step(); G.render(1 / 60, 1); }
      }, { mid, fIdx, who });
      const res = { name: `${mid} ${who}` };
      for (const leg of ['up', 'down']) {
        await page.evaluate((leg) => {
          const { u, f, s0, s1 } = window.__sg.cur, { ST } = window.__sg;
          const p = ST.flightWorld(f, leg === 'up' ? s1 : s0, 0);
          if (u.faction === 'enemy') u.moveTo(p.x, p.z); else window.__game.order(u.id, { type: 'move', x: p.x, z: p.z });
          window.__sg.L = { gaps: [], plants: [], jump: 0, py: u.y, last: {}, frames: 0, n: 0 };
        }, leg);
        for (let k = 0; k < 60 * 25; k++) {
          const st = await page.evaluate(() => {
            const g = window.__game, G = g.game, { u, f, look } = window.__sg.cur, { ST } = window.__sg, L = window.__sg.L;
            g.step(); G.render(1 / 60, 1); look(); G.render(0, 1);
            const S = u.model._sg, { s } = ST.flightLocal(f, u.x, u.z);
            L.jump = Math.max(L.jump, Math.abs(u.y - L.py)); L.py = u.y;
            if (S && S.w > 0.999 && s > f.sFoot && s < f.sTop) {
              L.frames++;
              for (const sd of ['l', 'r']) {
                const F = S.feet[sd];
                if (F.flat && F.gap != null) L.gaps.push(F.gap);
                if (F.plant && F.plant !== L.last[sd] && F.plant.k > 0 && F.plant.k < f.risers.length) { L.last[sd] = F.plant; L.plants.push([sd, F.plant.k]); }
              }
            }
            return { moving: !!u.path, flat: !!(S && (S.feet.l.flat || S.feet.r.flat)), on: !!(S && S.w > 0.999 && s > f.sFoot + 0.3 && s < f.sTop - 0.3) };
          });
          // a few frames per leg, with a foot flat on its tread
          if (st.on && st.flat && k % 24 === 0 && shots.filter((n) => n.startsWith(`${mid}-${who}-${leg}`)).length < 3) {
            const n = `${mid}-${who}-${leg}-${k}`;
            shots.push(n);
            await t.shot(`stairs-gait-${n}`);
          }
          if (!st.moving && k > 20) break;
        }
        const L = await page.evaluate(() => { const L = window.__sg.L; const gs = L.gaps.sort((a, b) => a - b); return { frames: L.frames, n: gs.length, p95: gs.length ? gs[Math.floor(gs.length * 0.95)] : null, min: gs[0] ?? null, plants: L.plants, jump: L.jump }; });
        res[leg] = L;
      }
      out.push(res);
    }
  }
  for (const x of out) {
    for (const leg of ['up', 'down']) {
      const L = x[leg], dir = leg === 'up' ? 1 : -1;
      t.log(`${x.name} ${leg}: ${L.frames} frames on the treads, sole over the tread p95 ${L.p95?.toFixed(3)} m (min ${L.min?.toFixed(3)}), footholds ${L.plants.map((p) => p[1]).join(',')}, largest height step ${L.jump.toFixed(3)} m`);
      t(L.frames > 20 && L.n > 10, `${x.name} ${leg}: on the treads with feet flat on them (${L.frames} frames, ${L.n} samples)`);
      t(L.p95 <= 0.03 && L.min >= -0.02, `${x.name} ${leg}: feet on the treads (p95 ${L.p95}, min ${L.min})`);
      const steps = []; for (const sd of ['l', 'r']) { const p = L.plants.filter((q) => q[0] === sd); for (let i = 1; i < p.length; i++) steps.push((p[i][1] - p[i - 1][1]) * dir); }
      t(steps.length >= 1 && steps.filter((d) => d >= 1).length >= steps.length * 0.7, `${x.name} ${leg}: each foot steps ${leg} the treads (${steps})`);
      t(L.jump < 0.08, `${x.name} ${leg}: no height snap (${L.jump.toFixed(3)} m)`);
    }
  }
  t(shots.length >= 8, `side views saved (${shots.length})`);
}
