/**
 * M20's own art (scripts/m20-art.js swapVisual) draws the castle masonry over the raised levels' placeholder rock as the
 * load ends, after the map's stamps; the standing visuals (placement rule (e): what a body is laid clear of, the raised
 * walks' clearance) are measured again on that art (map-builder restampStandingG, Game.loadMission). Before, the hidden
 * rock — bulging a metre past the second forecourt screen — shoved e38's body 0.4 m off the screen's lee into the turret
 * guard's sweep (sol/m20: the browser run's B3, the body found).
 * Every other rule (e) stamp is made again on the art too (the visual nav, the overhangs and the head room under them):
 * the kit placeholder of the SW and SE gatehouses has its leaves shut across the arch and a low arch roof, so both
 * gates were closed to walkers in the game (a path through the SW arch went 171 m round the castle; open headless),
 * and Patrol 26, whose round goes through both, walked round outside instead. And every route point is one its guard
 * can walk to (Patrol 26's halt by the barracks was not, in the game: the four stood there for ever).
 */
export const timeout = 240_000;

export default async function m20StandingRestamp(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game;
    await G.loadMission('m20');
    G.start();
    const w = G.game.world, g = w.grid;
    // the screen's lee (z 69.25–70, between the screen t_par_hq_b2 at z 68.5–69 and the strip): nothing standing there
    let lee = 0;
    for (let z = 69.3; z <= 70.4; z += 0.1) for (let x = 34; x <= 37.2; x += 0.1) if (g.solidAt(x, z)) lee++;
    // the screen itself still stands (its masonry, measured on what is drawn)
    let screen = 0;
    for (let x = 34; x <= 37.2; x += 0.1) if (g.solidAt(x, 68.3) || g.solidAt(x, 69.05)) screen++;
    const swapped = [...w.structures.values()].filter((s) => s.object3d?.userData?.artSwapped).length;
    // e38 dies at his post (37, 70) — a classic stab from the strip — and lies where he stood
    const e38 = w.enemies.find((e) => e.tag === 'e38');
    e38.die('damage', null);
    // through each gatehouse's arch, outside to inside along its axis (a man on his feet, as the game plans him), and the
    // inner gate's tunnel N to S
    const sp = w.commandos.find((c) => c.role === 'sapper'), len = (p, x, z) => p ? p.reduce((a, q, k) => a + Math.hypot(q.x - (k ? p[k - 1].x : x), q.z - (k ? p[k - 1].z : z)), 0) : Infinity;
    sp.stance = 'stand';
    const gates = { gh_sw: [[55.7, 118.83], [58.29, 109.17]], gh_se: [[119.54, 117.54], [112.46, 110.46]], gh_in: [[72.4, 72.8], [72.4, 59.5]] };
    const ways = Object.fromEntries(Object.entries(gates).map(([id, [[ax, az], [bx, bz]]]) => [id, +len(sp.planFrom(ax, az, bx, bz), ax, az).toFixed(1)]));
    // every route point a walker or a patrol halts at or walks through is one his planner can end on (within the brain's
    // WP_NEAR, 1 m): Patrol 26's halt by the barracks lay 1.3 m inside what the game draws, and the four stood there for ever
    const short = [];
    for (const e of w.enemies) {
      const rt = e.route;
      if (!rt || rt.length < 2) continue;
      for (let i = 0; i < rt.length; i++) {
        const a = rt[i], b = rt[(i + 1) % rt.length], p = e.planFrom(a.x, a.z, b.x, b.z), end = p?.[p.length - 1];
        if (!end || Math.hypot(end.x - b.x, end.z - b.z) > 1.0) short.push(`${e.tag} →(${b.x},${b.z})`);
      }
    }
    return { lee, screen, swapped, body: [e38.x, e38.z], ways, short };
  });
  t.log(`m20: ${r.swapped} structures drawn by the mission art; lee solids ${r.lee}, screen solids ${r.screen}; e38 lies at (${r.body.map((v) => v.toFixed(2))})`);
  t(r.swapped > 10, 'the mission art replaced the levels\' placeholders');
  t.equal(r.lee, 0, 'nothing standing in the second screen\'s lee (the hidden placeholder rock is not measured)');
  t(r.screen > 10, 'the screen\'s own masonry is still a standing visual');
  t(Math.hypot(r.body[0] - 37, r.body[1] - 70) < 0.05, `a body at e38's post stays in the lee (${r.body.map((v) => v.toFixed(2))})`);
  t.log(`ways through the gates: ${JSON.stringify(r.ways)}`);
  for (const [id, L] of Object.entries(r.ways)) t(L < 16, `${id}: a walker goes straight through its arch (${L} m, not round the castle)`);
  t.equal(r.short.join(' '), '', 'every guard\'s route point is one he can walk to');
}
