/** Fuel tanks, M17 defs in the dev tank yard (temperate): the oil valve, see tests/fuel-tanks-yard.lib.mjs. */
import { load, shotAt, ZONE_SHOT, ZONES } from './fuel-tanks-yard.lib.mjs';

export default async function fuelTanksYardTemperate(page, t) {
  // ---------------------------------------------------------------- M17 (temperate): the oil valve
  const temp = await load(page, 'temperate');
  t.equal(temp.fuel_tank, 'fuel_tank_elevated', 'M17 elevated twin tanks');
  const v = await page.evaluate(async () => {
    const g = window.__game, w = g.game.world, P = window.__ty.props();
    const { VALVE } = await import('./src/missions/dev/tank-yard.js');
    const o = P.fuel_tank, h = o.userData.fuelValve;
    const wheel = () => { let a = null; o.traverse((n) => { if (n.name === 'valve' && a == null) a = n.rotation.z - (n.userData.baseRotZ ?? n.rotation.z); }); return a; };
    const spoutD = h ? Math.hypot(h.spout.x - VALVE.x, h.spout.z - VALVE.z) : null;
    g.pause(false);
    const turns = [];
    const frames = (n) => { for (let i = 0; i < n; i++) g.game.render(0.1, 1); };    // the wheel / pour animate per frame
    for (let k = 0; k < 3; k++) { w.events.emit('device', { id: 'valve', sfx: 'valve_turn', x: VALVE.x, z: VALVE.z, on: true }); frames(15); turns.push(+wheel().toFixed(2)); }
    frames(40);
    let pour = null; g.game.renderer.scene.traverse((n) => { if (n.name === 'oil_pour') pour = n; });
    return { spoutD, turns, pour: !!pour, pool: pour ? +pour.children[1].scale.x.toFixed(2) : 0 };
  });
  t.log('valve', JSON.stringify(v));
  t.ok(v.spoutD != null && v.spoutD <= 0.5, `M17 spout within 0.5 m of the mission's VALVE point (${v.spoutD?.toFixed(2)})`);
  t.ok(v.turns[0] > 1.9 && v.turns[2] > 6.0, `the handwheel turns a third of a turn per use: ${v.turns}`);
  t.ok(v.pour && v.pool > 0.5, `the spout pours and the pool spreads after the third use (${v.pool})`);
  for (const z of [1, 2]) { await shotAt(page, ...ZONES.m17, z); await ZONE_SHOT(page, t, `tanks-yard-m17-intact-z${z}`); }
  const e2 = await page.evaluate(() => {
    const g = window.__game, w = g.game.world;
    w.interactables.find((i) => i.tag === 'fuel_tank')?.destroy(null, 'explosion');
    g.advance(6);
    let pour = null; g.game.renderer.scene.traverse((n) => { if (n.name === 'oil_pour') pour = n; });
    return { a: window.__ty.props().fuel_tank?.userData.libraryAsset, pour: !!pour, block: w.grid.blockAt(26, 66) };
  });
  t.equal(e2.a, 'fuel_tank_elevated_destroyed', 'elevated wreck');
  t.equal(e2.pour, false, 'the pour stops with the tank');
  t.ok(e2.block >= 2, 'elevated wreck keeps blocking');
  for (const z of [1, 2]) { await shotAt(page, ...ZONES.m17, z); await ZONE_SHOT(page, t, `tanks-yard-m17-destroyed-z${z}`); }
}
