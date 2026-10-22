/**
 * M3 dam bunker berm (clipping audit, seed 11: e32 on a combat run walked up the bunker's earth berm and stood in it,
 * 0.6 m deep at torso height). The bunker's walkable roof is reached by its berm climb link and its `entry` path only,
 * so its crew's post, charge target, door approach and the link's roof end are not ways the visual nav ring round the
 * berm is relaxed open for (map-builder groundWays, `roofWays: false`). On the real meshes: no walkable ground cell
 * lets a man stand where the berm rises 1 m or more beside him, except the foot of the Green Beret's climb link and
 * the few metres of berm round it (the link's way is kept: it is a designed way up).
 */
export const timeout = 120_000;

export default async function m03BunkerBerm(page, t) {
  await page.evaluate(() => window.__game.loadMission('m03'));
  await page.evaluate(() => Promise.resolve(window.__game.game.mapHandle?.ready).then(() => true));
  const r = await page.evaluate(async () => {
    const THREE = await import('three');
    const w = window.__game.game.world, g = w.grid, o = w.structures.get('dam_bunker').object3d;
    o.updateMatrixWorld(true);
    const meshes = [];
    o.traverse((m) => { if (m.isMesh && m.visible) meshes.push(m); });
    const rc = new THREE.Raycaster();
    const top = (x, z) => { rc.set(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0)); const h = rc.intersectObjects(meshes, false); return h.length ? h[0].point.y : 0; };
    // the climb link of the bunker's berm: its ground end (a, y 0) and its roof end
    const link = (g.links || []).find((l) => l.kind === 'climb' && Math.hypot(l.a.x - 10, l.a.z - 44) < 8 && (l.b.y || 0) > 1);
    const bad = [];
    let walkable = 0;
    for (let j = Math.floor(34 / g.cell); j < Math.floor(56 / g.cell); j++) for (let i = Math.floor(0 / g.cell); i < Math.floor(20 / g.cell); i++) {
      const k = g.idx(i, j);
      if (!g.isWalkable(i, j) || g.elev[k] > 0.3) continue;
      walkable++;
      const c = g.cellCenter(i, j);
      let m = 0;
      for (const [dx, dz] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) m = Math.max(m, top(c.x + dx, c.z + dz));
      if (m < 1.0) continue;
      const nearFoot = link && Math.hypot(c.x - link.a.x, c.z - link.a.z) <= 3;
      if (!nearFoot) bad.push([+c.x.toFixed(2), +c.z.toFixed(2), +m.toFixed(2)]);
    }
    return { walkable, bad, link: link ? [link.a.x, link.a.z, link.b.x, link.b.z, link.b.y] : null, ways: null };
  });
  t(!!r.link, `the berm's climb link is on the grid (${JSON.stringify(r.link)})`);
  t(r.walkable > 500, `the ground round the bunker is walkable (${r.walkable} cells scanned)`);
  t(!r.bad.length, `no walkable cell stands where the berm is 1 m or more high, away from the climb link's foot (${r.bad.length}: ${JSON.stringify(r.bad.slice(0, 6))})`);
}
