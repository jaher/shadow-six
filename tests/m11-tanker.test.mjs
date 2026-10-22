/**
 * M11: the fuel truck shuttles in the quarry in the running game (sol/m11). With the library meshes loaded the rigs'
 * drawn derricks block a little more than their data footprints, and the truck's lane at x 85.7 grazed rig_ne: it
 * stopped for good at (84.9, 37.4) on its first run, never reaching its halt between the two rigs (W_mid) — so the
 * dossier's shot (hull gun or rifle at W_mid) could never be made. The lane now runs at x 85, its middle: the truck
 * shuttles its first runs. (Known, not fixed here: the lane is 3 m wide for a 2.4 m hull with a 5.6 m turning circle,
 * and a later run that cuts the corner into it can still wedge the truck for good — between the two rigs, where its
 * blast still reaches both, so the shot stays on: the M11 solution fires wherever it stops there.) Logic only.
 */
export const timeout = 300_000;

export default async function m11Tanker(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m11');
    G.start();
    const w = G.game.world, tk = w.vehicles.find((v) => v.tag === 'tanker');
    const halts = [];
    let still = 0, maxStill = 0, lastHalt = null;
    for (let i = 0; i < Math.round(150 / dt); i++) {
      G.game.step(dt);
      const stopped = (tk.speed || 0) < 0.05;
      if (stopped && (tk.waitT || 0) > 0) {
        const key = `${tk.x.toFixed(0)},${tk.z.toFixed(0)}`;
        if (lastHalt !== key) { halts.push({ t: +w.time.toFixed(1), x: +tk.x.toFixed(1), z: +tk.z.toFixed(1) }); lastHalt = key; }
        still = 0;
      } else if (stopped) { still += dt; maxStill = Math.max(maxStill, still); } else { still = 0; lastHalt = null; }
    }
    return { halts, maxStill, destroyed: !!tk.destroyed };
  });
  t.log(`tanker halts: ${r.halts.map((h) => `t${h.t} (${h.x},${h.z})`).join(' ')}; longest stop outside a halt ${r.maxStill.toFixed(1)} s`);
  const mid = r.halts.filter((h) => Math.hypot(h.x - 88.5, h.z - 33.8) < 2);
  t(mid.length >= 2, `the truck halts between the quarry rigs (W_mid) on its way east and back west (${mid.length})`);
  t(r.halts.some((h) => Math.hypot(h.x - 96, h.z - 32) < 2), 'it reaches its east stop');
  t(r.maxStill < 15, `it never stands stuck outside a halt (${r.maxStill.toFixed(1)} s)`);
}
