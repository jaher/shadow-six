/**
 * Wrecks, fuel drums and rocks are solid too (user: "neither soldiers not commandos can cross cars or any other object
 * which could be climbed on"; docs/clipping-audit.md "Characters and solid objects"). M1: the parked truck is blown up
 * and its wreck baked into the grid; a commando crawls at it from 4 directions — the body capsule never gets under the
 * hull and the posed meshes don't overlap it. A soldier walks straight across the fuel drums b1–b3 (he goes round
 * them, never brushing through) and the commando crawls at the rocks by the road. Saves tests/out/body-wreck.png.
 */
export default async function bodyWreck(page, t) {
  const r = await page.evaluate(async () => {
    const { setup, approachRuns, BC } = await import('/tests/vehicle-clear-page.mjs');
    const { g, G, w, tick, mesh } = await setup('m01', { n: 0 });
    const out = { wreck: [], runs: [] };
    const v = w.vehicles.find((x) => x.def.type === 'truck');
    v.destroy(null, 'explosive'); tick(5); v.burning = false; v._bakeWreck?.(); tick(5);
    out.baked = !!v.wreckBaked;
    const H = BC.hullRect(v), c = w.commandos.find((u) => u.alive);
    for (const R of approachRuns(g, w, c, { x: H.x, z: H.z, r: Math.hypot(H.hl, H.hw) }, { ks: [0, 2, 4, 6], dist: 2 })) {
      out.wreck.push({ ...R, hullGap: +BC.capsuleRectGap(BC.bodyCapsule(c.x, c.z, c.heading, 'crawl'), H).toFixed(3), mesh: +mesh(c).toFixed(3) });
    }
    const e = w.enemies.find((x) => x.alive && !x.vehicle && x.state === 'active');
    for (const R of approachRuns(g, w, e, { x: 41.8, z: 23.7, r: 1 }, { ks: [0, 1, 4, 7], stance: 'stand', through: true })) out.runs.push({ id: 'drums', ...R });
    for (const R of approachRuns(g, w, c, { x: 57, z: 150, r: 4 }, { ks: [2, 6] })) out.runs.push({ id: 'rocks_drv', ...R });
    g.setZoom(2.4); g.centerOn(H.x, H.z); G.render(0, 1);
    return out;
  });
  await t.shot('body-wreck');
  t.ok(r.baked, 'the truck wreck is baked');
  t.ok(r.wreck.length === 4, `4 crawls at the wreck (${r.wreck.length})`);
  for (const R of r.wreck) {
    const tag = `wreck crawl from ${R.k * 45}°`;
    if (R.skip) { t.ok(false, `${tag}: no free start`); continue; }
    t.ok(R.took && R.arrived, `${tag}: order taken and finished (${JSON.stringify(R)})`);
    t.ok(R.minGap >= 0 && R.hullGap >= 0.09, `${tag}: never under the wreck, stops clear (min ${R.minGap}, stop ${R.hullGap})`);
    t.ok(R.mesh <= 0.02, `${tag}: posed meshes don't overlap the wreck (${R.mesh} m)`);
  }
  t.ok(r.runs.length === 6, `6 runs at drums / rocks (${r.runs.length})`);
  for (const R of r.runs) {
    const tag = `${R.id} from ${R.k * 45}°`;
    if (R.skip) { t.ok(false, `${tag}: no free start`); continue; }
    t.ok(R.took && R.arrived, `${tag}: order taken and finished (${JSON.stringify(R)})`);
    t.ok(R.minGap >= 0, `${tag}: body never in a solid on the way (min gap ${R.minGap})`);
    t.ok(R.worst <= 0.05, `${tag}: posed meshes never overlap a solid by more than 5 cm (${R.worst} m ${R.hit} at ${R.at})`);
  }
}
