/**
 * Nothing planted stands in the water, in the running game (GPU; user report 2026-10-08: "mission 1 there is  giant
 * tree standing on the water, remove it"). Every mission is loaded (M0–M10 here, M11–M20 and B00 in veg-water-2) and
 * every live plant instance is checked against the drawn shore field (terrain.shore: the field the ground is carved
 * with and the water drawn over; tests/veg-water-lib.mjs):
 *  - the map's trees and bushes (unique and impostor; the mission's own, forest fill, understorey, hedgerows,
 *    orchards): trunk base >= SHORE_MARGIN m ashore;
 *  - the apron's scenery forest and bocage hedges: >= APRON_SHORE_MARGIN m (trees) / SHORE_MARGIN m (hedge plants);
 *  - desert scrub instances: >= SHORE_MARGIN m; wildflowers, weed rosettes, grass and crop tufts: >= GROUND_SHORE_MARGIN
 *    m (the lake and river beds' mud / dry-grass splat planted them under the water in the temperate maps; the reeds
 *    stand in the shallows on purpose);
 *  - M1: the 18 m impostor spruce on the fjord's E waterline (70.98, 36.9) is gone, and the apron trees are the map
 *    trees' size (median height within 20 %); review frames of the spot (zoom 1 and 0.5) go to tests/out/veg-water-m01-*.png.
 */
import { checkMissions, assertClean } from './veg-water-lib.mjs';

export const timeout = 900_000;

export default async function vegWater(page, t) {
  const report = await checkMissions(page, t, ['m00', 'm01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm09', 'm10']);

  // review frames of the M1 spot (the fjord's E mouth beside the camp pier), the normal game zoom and zoomed out
  await page.evaluate(async () => { const g = window.__game; await g.loadMission('m01'); g.start(); await g.game.world.terrain.ready; await g.game.world.terrain.apronReady; });
  for (const [z, x, zz] of [[1, 70, 37], [0.5, 65, 45]]) {
    await page.evaluate(([zoom, x, z]) => { const g = window.__game, G = g.game; G.cameraRig.setYaw(15); G.cameraController.setZoom(zoom, true); G.cameraController.centerOn(x, z); g.step(); G.render(1 / 60, 1); }, [z, x, zz]);
    await t.shot(`veg-water-m01-z${z}`);
  }

  assertClean(t, report);
  const m1 = report.m01;
  t.equal(m1.spot.length, 0, `M1: the waterline spruce at (70.98, 36.9) is gone (${JSON.stringify(m1.spot)})`);
  // the scenery forest is the map's own carried on: the same size (its trees copy their neighbours' height ±15 %; the
  // species' full natural height made it ~1.7x the map's in M1)
  t.ok(m1.apronMed <= m1.mapMed * 1.2, `M1: apron trees the size of the map's (median ${m1.apronMed.toFixed(1)} vs ${m1.mapMed.toFixed(1)} m)`);
}
