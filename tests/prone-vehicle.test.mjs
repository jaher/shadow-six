/**
 * Crawling next to vehicles (user: "characters when crawling can end up under a vehicle, fix that";
 * docs/clipping-audit.md "Characters and vehicles"). On M1, a parked truck, Kübelwagen and Panzer II in turn:
 * commandos crawl at its centre from all 8 directions. The body capsule (head to toes along the heading) never gets
 * under the hull on the way, the stop keeps ≥ 0.09 m, the posed meshes don't overlap, and each stops on his own side of it.
 * Saves tests/out/prone-vehicle.png. Walkers and moving vehicles: vehicle-block.test.mjs.
 */
export default async function proneVehicle(page, t) {
  const r = await page.evaluate(async () => {
    const { setup, BC } = await import('/tests/vehicle-clear-page.mjs');
    const { g, G, w, spots, tick, mesh } = await setup('m01', { n: 1, R: 8.5 });
    const out = { spots: spots.length, crawl: [] };
    if (!spots.length) return out;
    const p = spots[0], men = w.commandos.filter((c) => c.alive).slice(0, 3);
    for (const [i, type] of ['truck', 'kubelwagen', 'panzer2'].entries()) {
      const v = w.spawnVehicle(type, { x: p.x, z: p.z, heading: 0.3 + i * 0.5, friendly: true });
      tick(2);
      for (const ks of [[0, 3, 6], [1, 4, 7], [2, 5]]) { // up to three crawlers at once from different sides
        const run = ks.map((k, n) => {
          const c = men[n], a = k * Math.PI / 4;
          c.stop?.(); c.setPosition(p.x + Math.cos(a) * 5.5, p.z + Math.sin(a) * 5.5, a + Math.PI);
          c.setStance('crawl'); return { c, k, a, minGap: Infinity };
        });
        tick(20);
        for (const R of run) R.ok = R.c.moveTo(p.x, p.z);
        for (let s = 0; s < 540 && run.some((R) => R.c.path); s += 3) {
          tick(3);
          for (const R of run) R.minGap = Math.min(R.minGap, BC.unitGap(R.c));
        }
        for (const R of run) {
          const c = R.c;
          out.crawl.push({ type, k: R.k, ok: R.ok, arrived: !c.path, stance: c.stance, minGap: +R.minGap.toFixed(3),
            endGap: +BC.unitGap(c).toFixed(3), mesh: +mesh(c).toFixed(3), dist: +Math.hypot(c.x - p.x, c.z - p.z).toFixed(2),
            side: +(((c.x - p.x) * Math.cos(R.a) + (c.z - p.z) * Math.sin(R.a))).toFixed(2) });
        }
      }
      if (type !== 'panzer2') { w.remove(v); tick(2); }
    }
    const c = men[0];
    g.setZoom(2.4); g.centerOn(c.x, c.z); G.render(0, 1);
    return out;
  });
  await t.shot('prone-vehicle');
  t.ok(r.spots === 1, `a free spot on M1 (${r.spots})`);
  t.ok(r.crawl.length === 24, `24 crawls (${r.crawl.length})`);
  for (const c of r.crawl) {
    const tag = `${c.type} crawl from ${c.k * 45}°`;
    t.ok(c.ok && c.arrived && c.stance === 'crawl', `${tag}: order taken and finished (${JSON.stringify(c)})`);
    t.ok(c.minGap >= 0, `${tag}: body never under the hull on the way (min gap ${c.minGap})`);
    t.ok(c.endGap >= 0.09, `${tag}: stops ≥ 0.1 m clear (gap ${c.endGap})`);
    t.ok(c.mesh <= 0.02, `${tag}: posed meshes don't overlap (${c.mesh} m)`);
    t.ok(c.dist <= 4.8 && c.side > 0, `${tag}: stops next to the vehicle on his side (${c.dist} m from its centre, side ${c.side})`);
  }
}
