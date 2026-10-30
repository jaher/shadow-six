/**
 * M4's supply lorry makes its rounds in the real game (drawn grid): from its yard out through the outer gate to the
 * villa (errand stop B), back over the level crossing (stop C, the crossing shack) and home, then stop A, and again —
 * the driver walks to each door and back to the cab (src/missions/scripts/m04.js TRUCK_STOPS).
 * Found by the M4 solution (2026-10-29): three things on the drawn grid kept the lorry standing for good —
 *  - the gate passage between the two drawn gatehouses (4.5 m) left its hull no plan with the walkers' clearance
 *    (fixed: the mission's `hullDrawn`, as M20);
 *  - the rear gate guard e47's post lay inside the drawn gatehouse, so he spawned out into that passage, a man of
 *    its own side the hull plans round (fixed: his post beside the gatehouse's north-east wall);
 *  - stop C's door spot lay inside the crossing shack moved off the rails: the driver never reached it and the lorry
 *    waited for him at the crossing (fixed: the spot by the shack as drawn).
 * Logic only (Game.step, no frames).
 */
export const timeout = 300_000;

export default async function m04LorryRound(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m04');
    G.start();
    const w = G.game.world, truck = w.vehicles.find((v) => v.vehicleType === 'truck' && !v.removed);
    const { TRUCK_STOPS } = await import('/src/missions/scripts/m04.js');
    const home = { x: 198, z: 110.3 }, gate = { x: 101, z: 54.5 };
    const stops = [];
    let at = null, gateT = [], homeT = [], awayFromHome = false, wasAtGate = false, stuck = 0, still = 0, last = { x: truck.x, z: truck.z };
    for (let i = 0; i * dt < 330; i++) {
      G.game.step(dt);
      const k = Object.keys(TRUCK_STOPS).find((s) => Math.hypot(truck.x - TRUCK_STOPS[s].x, truck.z - TRUCK_STOPS[s].z) < 2.5);
      if (k && at !== k) { at = k; stops.push({ k, t: +w.time.toFixed(1) }); }
      if (!k && at && Math.hypot(truck.x - TRUCK_STOPS[at].x, truck.z - TRUCK_STOPS[at].z) > 15) { stops.at(-1).left = +w.time.toFixed(1); at = null; }
      const g = Math.hypot(truck.x - gate.x, truck.z - gate.z) < 4;
      if (g && !wasAtGate) gateT.push(+w.time.toFixed(1));
      wasAtGate = g;
      const h = Math.hypot(truck.x - home.x, truck.z - home.z) < 3;
      if (!h && Math.hypot(truck.x - home.x, truck.z - home.z) > 20) awayFromHome = true;
      if (h && awayFromHome) { homeT.push(+w.time.toFixed(1)); awayFromHome = false; }
      // the longest the lorry stands in one place (its errand stops and the home halt are 15–25 s)
      if (Math.hypot(truck.x - last.x, truck.z - last.z) < 0.05) { still += dt; stuck = Math.max(stuck, still); } else still = 0;
      last = { x: truck.x, z: truck.z };
    }
    const e47 = w.enemies.find((e) => e.tag === 'e47');
    return { stops, gateT, homeT, stuck: +stuck.toFixed(1), e47: [+e47.x.toFixed(2), +e47.z.toFixed(2)], hullDrawn: w.grid.hullDrawn, end: [+truck.x.toFixed(1), +truck.z.toFixed(1)] };
  });
  t.log(`m04 lorry: stops ${JSON.stringify(r.stops)}, gate passes ${r.gateT}, home again at ${r.homeT}, longest stand ${r.stuck} s, e47 at ${r.e47}, end (${r.end})`);
  t(r.hullDrawn, 'M4 hulls clear what is drawn (hullDrawn)');
  // (the passage between the gatehouses runs x 99.5–105 at z 56: he stands east of it, by his post)
  t(r.e47[0] > 106.5 && Math.hypot(r.e47[0] - 108.4, r.e47[1] - 55.6) < 0.8, `e47 stands by his post beside the gatehouse, out of the gate passage (${r.e47})`);
  t(r.gateT.length >= 4, `the lorry goes through the outer gate out and back, twice over (${r.gateT})`);
  for (const k of ['A', 'B', 'C']) t(r.stops.some((s) => s.k === k && s.left != null), `it stops at ${k} and drives on after the driver's errand (${JSON.stringify(r.stops.filter((s) => s.k === k))})`);
  t(r.homeT.length >= 2, `it comes home and sets off again (${r.homeT})`);
  t(r.stuck < 40, `it never stands anywhere for long (longest ${r.stuck} s)`);
}
