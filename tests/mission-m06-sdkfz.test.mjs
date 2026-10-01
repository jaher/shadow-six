/**
 * BEL M6 in the running game (replay m06 F2, dossier §11 test hook): with every guard on the map, a remote bomb
 * under the armoured car at its W turn-round (outside the zone) destroys it and raises no alarm. The map-wide blast
 * draws the investigators, who stop at the edge of the burning wreck; e14 stands clear of its 9 m blast.
 */
export default async function missionM06Sdkfz(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m06');
    g.start();
    const w = g.game.world;
    const { applyExplosion } = await import('/src/abilities/explosions.js');
    const car = w.byId('sdkfz');
    const died = [];
    w.events.on('unit:killed', (p) => died.push(p.unit?.tag || p.unit?.id));
    g.advance(20); // it leaves the turn-round, then comes back
    const clear = () => w.enemies.every((e) => !e.alive || e.vehicle || e.state === 'inVehicle' || Math.hypot(e.x - car.x, e.z - car.z) > 10);
    for (let k = 0; k < 2000 && !(Math.hypot(car.x - 24, car.z - 52.5) < 1.5 && clear()); k++) g.advance(0.1);
    const at = { x: car.x, z: car.z, t: w.time };
    applyExplosion(w, car.x + 0.5, car.z + 1, 'bomb', w.commandos.find((c) => c.role === 'sapper'));
    const enemies = w.enemies.filter((e) => e.alive).length;
    g.advance(60);
    return { at, destroyed: car.destroyed, died, zones: g.state().zonesFired, alarm: !!w.alarm?.active, e14: w.byId('e14')?.alive, enemies, state: g.game.state };
  });
  t.log(JSON.stringify(r));
  t(Math.hypot(r.at.x - 24, r.at.z - 52.5) < 1.5, 'the car is at its W turn-round');
  t(r.destroyed, 'armoured car destroyed');
  t(r.e14, 'e14 survives (clear of the blast)');
  t(r.died.filter((id) => id !== 'e38').length === 0, `no guard dies (${r.died})`);
  t(r.zones.length === 0, `no zone event (${JSON.stringify(r.zones)})`);
  t(!r.alarm, 'no siren');
  t(r.state === 'playing', 'still playing');
}
