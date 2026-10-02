/** Fuel tanks, M13 defs in the dev tank yard (coast): see tests/fuel-tanks-yard.lib.mjs. */
import { load, shotAt, ZONE_SHOT, ZONES } from './fuel-tanks-yard.lib.mjs';

export default async function fuelTanksYardCoast(page, t) {
  // ---------------------------------------------------------------- M13 (coast)
  const coast = await load(page, 'coast');
  t.equal(coast.fuel_1, 'fuel_tank_quay_12', 'M13 fuel_1: 12 m quay tank');
  t.equal(coast.fuel_2, 'fuel_tank_quay_11', 'M13 fuel_2: 11 m quay tank');
  for (const z of [1, 2]) { await shotAt(page, ...ZONES.m13, z); await ZONE_SHOT(page, t, `tanks-yard-m13-intact-z${z}`); }
  const c2 = await page.evaluate(() => {
    const g = window.__game, w = g.game.world;
    g.pause(false);
    for (const id of ['fuel_1', 'fuel_2']) w.interactables.find((i) => i.tag === id)?.destroy(null, 'explosion');
    g.advance(6);
    const P = window.__ty.props();
    return { a: P.fuel_1?.userData.libraryAsset, b: P.fuel_2?.userData.libraryAsset, block: w.grid.blockAt(76, 18.5) };
  });
  t.equal(c2.a, 'fuel_tank_quay_12_destroyed', 'fuel_1 wreck');
  t.equal(c2.b, 'fuel_tank_quay_11_destroyed', 'fuel_2 wreck');
  t.ok(c2.block >= 2, 'quay wreck keeps blocking');
  for (const z of [1, 2]) { await shotAt(page, ...ZONES.m13, z); await ZONE_SHOT(page, t, `tanks-yard-m13-destroyed-z${z}`); }
}
