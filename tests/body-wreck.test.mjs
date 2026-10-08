/**
 * Wrecks, fuel drums and rocks are solid too (user: "neither soldiers not commandos can cross cars or any other object
 * which could be climbed on"; docs/clipping-audit.md "Characters and solid objects"). M1: the parked truck is blown up
 * and its wreck baked into the grid; a commando crawls at it from 4 directions — the body capsule never gets under the
 * hull and the posed meshes don't overlap it. A soldier walks at the fuel drums b1–b3 from their open sides and out of
 * the barracks alley right past them (never brushing through) and the commando crawls at the rocks by the road.
 * Saves tests/out/body-wreck.png.
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
    // the drums' own spot: b1–b3 stand in the corner by barr_L_a's SE end, just N of the alley between the barracks
    // (moved there so the alley is walkable end to end): walked at from the open sides (E, SE, N, NE), and one walk
    // out of the alley straight past them (he goes by, never brushing them)
    const D = w.interactables.filter((it) => ['b1', 'b2', 'b3'].includes(it.tag));
    const T = { x: D.reduce((a, it) => a + it.x, 0) / D.length, z: D.reduce((a, it) => a + it.z, 0) / D.length, r: 1 };
    out.drums = D.length;
    for (const R of approachRuns(g, w, e, T, { ks: [0, 1, 6, 7], stance: 'stand' })) out.runs.push({ id: 'drums', ...R });
    const by = D.reduce((a, it) => (it.z > a.z ? it : a), D[0]); // the drum nearest the alley
    for (const R of approachRuns(g, w, e, { x: by.x, z: 24.15, r: 0.5 }, { ks: [4], stance: 'stand', through: true })) out.runs.push({ id: 'alley past the drums', ...R });
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
  t.ok(r.drums === 3, `the three drums b1–b3 found (${r.drums})`);
  t.ok(r.runs.length === 7, `7 runs at drums / rocks (${r.runs.length})`);
  for (const R of r.runs) {
    const tag = `${R.id} from ${R.k * 45}°`;
    if (R.skip) { t.ok(false, `${tag}: no free start`); continue; }
    t.ok(R.took && R.arrived, `${tag}: order taken and finished (${JSON.stringify(R)})`);
    t.ok(R.minGap >= 0, `${tag}: body never in a solid on the way (min gap ${R.minGap})`);
    t.ok(R.worst <= 0.05, `${tag}: posed meshes never overlap a solid by more than 5 cm (${R.worst} m ${R.hit} at ${R.at})`);
  }
}
