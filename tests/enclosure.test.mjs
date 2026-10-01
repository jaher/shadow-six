/**
 * Closed enclosures on the real visuals (user report "Level 2 the fence is not fully closed"): for every wall /
 * fence / wire line of every mission, the drawn pieces (placement visual runs, cut at the browser's visual body
 * shapes) cover the whole authored line except where a structure really stands on it, and the nav grid blocks the
 * same line everywhere (visual coverage == nav blocking: no see-through hole that still blocks, no drawn wall one
 * can walk through). Unit side: tests/unit/enclosure.test.mjs.
 */
/** Every mission (M1–M20 + sandboxes) loads in turn: more than the runner's default 90 s. */
export const timeout = 480_000;

export default async function enclosure(page, t) {
  const r = await page.evaluate(async () => {
    const { MISSIONS } = await import('./src/missions/index.js');
    const { enclosureGaps, runsOf } = await import('./src/world/placement.js');
    const out = [];
    for (const m of MISSIONS) {
      await window.__game.loadMission(m.id);
      const W = window.__game.game.world, recs = W.placement.records, grid = W.grid;
      const gaps = enclosureGaps(recs);
      // nav: every 0.25 m along each authored run (ends excluded), a straight walk across the line (±0.8 m, at
      // the ground level of its start: a wall walk on top does not count) never gets through
      let n = 0;
      const open = [];
      for (const lin of recs.filter((x) => x.linear && !x.ignored)) {
        for (const run of runsOf(lin.def)) for (let k = 0; k + 1 < run.length; k++) {
          const [ax, az] = run[k], [bx, bz] = run[k + 1], L = Math.hypot(bx - ax, bz - az), s = Math.max(1, Math.round(L / 0.25));
          for (let i = 1; i < s; i++) {
            const x = ax + ((bx - ax) * i) / s, z = az + ((bz - az) * i) / s, nx = (-(bz - az) / L) * 0.8, nz = ((bx - ax) / L) * 0.8;
            n++;
            if (grid.walkableLine(x - nx, z - nz, x + nx, z + nz, { elevRef: grid.elevAt(x - nx, z - nz) })) open.push(`${lin.id}@${x.toFixed(1)},${z.toFixed(1)}`);
          }
        }
      }
      // gates in a run (verifier, M2 gate_se): the drawn run meets the gate's REAL mesh (posts included) on both
      // sides — a cut at a cell-padded body left 0.5–1.1 m see-through slots beside the posts
      const slots = [], scene = W.scene || window.__game.game.scene;
      for (const g of recs.filter((x) => x.cat === 'gate' && !x.extra && x.def.x != null)) {
        const obj = scene.getObjectByName(`prop:gate:${g.id}`);
        if (!obj) continue;
        const d = g.def, u = [Math.cos(d.rot ?? 0), Math.sin(d.rot ?? 0)];
        const al = (x, z) => (x - d.x) * u[0] + (z - d.z) * u[1], pe = (x, z) => -(x - d.x) * u[1] + (z - d.z) * u[0];
        let lo = Infinity, hi = -Infinity;
        obj.updateMatrixWorld(true);
        const v = obj.position.clone();
        obj.traverse((o) => {
          if (!o.isMesh || !o.geometry?.attributes?.position) return;
          const P = o.geometry.attributes.position;
          for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); if (Math.abs(pe(v.x, v.z)) < 0.5) { lo = Math.min(lo, al(v.x, v.z)); hi = Math.max(hi, al(v.x, v.z)); } }
        });
        if (!(hi > lo)) continue;
        for (const lin of recs.filter((x) => x.linear && !x.ignored)) {
          for (const run of lin.def.visualRuns || runsOf(lin.def)) for (const [x, z] of [run[0], run[run.length - 1]]) {
            const a = al(x, z);
            if (Math.abs(pe(x, z)) > 0.3 || a < lo - 1.5 || a > hi + 1.5 || (a > lo && a < hi)) continue;
            const gap = a <= lo ? lo - a : a - hi;
            if (gap > 0.15) slots.push(`${lin.id}|${g.id}: ${gap.toFixed(2)} m`);
          }
        }
      }
      const cuts = W.placement.log.filter((l) => /^run /.test(l));
      out.push({ id: m.id, runs: recs.filter((x) => x.linear).length, gaps, n, open, cuts, slots });
    }
    return out;
  });
  for (const m of r) {
    t.log(`${m.id}: ${m.runs} run(s), ${m.n} nav samples; ${m.cuts.join(' | ') || 'no cuts'}`);
    t(m.gaps.length === 0, `${m.id}: every wall / fence drawn closed except at declared openings and structures on the line${m.gaps.length ? ` — gaps ${JSON.stringify(m.gaps)}` : ''}`);
    t(m.slots.length === 0, `${m.id}: every gate in a wall / fence meets the drawn run post-to-post (≤ 0.15 m)${m.slots.length ? ` — slots ${m.slots.join(', ')}` : ''}`);
    t(m.open.length === 0, `${m.id}: nav blocks every authored wall / fence line${m.open.length ? ` — walkable at ${m.open.slice(0, 8).join(' ')}` : ''}`);
  }
  const m2 = r.find((m) => m.id === 'm02');
  // the sentry box stands 0.7 m off the SE edge (only its ground skirt reached the line): it no longer cuts the
  // palisade; barr_out's body really straddles the E corner, so the palisade still ends at its gable walls
  t(m2 && m2.cuts.some((l) => /run camp_wall: .*cut .* at gate_se/.test(l)) && !m2.cuts.some((l) => /sbox_se/.test(l)),
    'm02: the camp palisade is not cut at the sentry box beside the SE gate');
}
