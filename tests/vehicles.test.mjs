/**
 * VEHICLES in the running game (m00 sandbox): the Driver boards a truck through the enterVehicle ability,
 * drives it in a straight line (double-click = fast) and runs a soldier over; a crewed patrol boat
 * patrols the river; Ctrl+click fire from a manned MG nest; a fuel tanker blows up from one bullet.
 */
export default async function vehicles(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    g.start();
    const w = g.game.world;
    const { Commando } = await import('/src/entities/commando.js');
    const { Enemy } = await import('/src/entities/enemy.js');
    // (beside the cab's right door — boarding is at a door since 2026-10-07: he climbs in there and slides across the
    // bench to the wheel; the truck hides him from the patrol boat's MG, which covers its left side)
    const dr = w.add(new Commando({ role: 'driver', x: 13.5, z: 29.2, heading: 0 }));
    const truck = w.spawnVehicle('truck', { x: 18, z: 27, heading: 0 });
    const boat = w.spawnVehicle('patrolboat', {
      x: 40, z: 8, heading: Math.PI / 2, crew: ['mg'],
      route: { type: 'PINGPONG', speed: 2.5, points: [{ x: 40, z: 8 }, { x: 40, z: 24 }] },
    });
    const tank = w.spawnVehicle('panzer2', { x: 24, z: 44, heading: -Math.PI / 2 });
    const nest = w.spawnVehicle('mgNest', { x: 10, z: 48, heading: 0 });
    // board through the ability (walks to the hull, 0.5 s)
    const ok = dr.issue({ type: 'ability', id: 'enterVehicle', target: truck });
    const ran = g.advance(4);
    const boatMoved = Math.abs(boat.z - 8) > 3;
    const inside = dr.vehicle === truck && truck.operator === dr;
    // a soldier on the road, looking away; drive fast through him
    const victim = w.add(new Enemy({ soldierType: 'soldier', x: 28, z: 27, heading: Math.PI / 2 }));
    const runs = [];
    w.events.on('vehicle:runover', (p) => runs.push(p.victim.id));
    dr.issue({ type: 'move', x: 33, z: 27, run: true });
    g.advance(3);
    g.advance(2);
    const res = {
      ok, inside, fast: truck.fast, truckX: truck.x, truckZ: truck.z, victimDead: !victim.alive, runs: runs.length,
      boatMoved, boatKind: boat.vehicleKind, occl: w.grid.dynamicAt(truck.x, truck.z),
      tankHits: tank.hits, nestKind: nest.vehicleKind, ran,
    };
    g.centerOn(26, 30);
    g.setZoom(0.45);
    g.advance(0.05);
    return res;
  });
  t.log(JSON.stringify(r));
  t(r.ok, 'enterVehicle accepted');
  t(r.inside, 'the Driver is at the wheel');
  t.equal(r.fast, true, 'double-click = fast');
  t.near(r.truckZ, 27, 1e-6, 'straight line');
  t(r.truckX > 30, `drove east (${r.truckX})`);
  t(r.victimDead, 'soldier run over at fast speed');
  t.equal(r.runs, 1, 'vehicle:runover emitted');
  t(r.boatMoved, 'patrol boat follows its route');
  t.equal(r.occl, 2, 'truck hull occludes (OCLU)');
  t.equal(r.nestKind, 'emplacement');
  await t.shot('vehicles-drive');

  const r2 = await page.evaluate(async () => {
    const g = window.__game;
    const w = g.game.world;
    const dr = w.commandos.find((c) => c.role === 'driver');
    const truck = dr.vehicle;
    dr.issue({ type: 'ability', id: 'leaveVehicle', target: dr });
    const out = !dr.vehicle && dr.state === 'active';
    const tanker = w.spawnVehicle('opel_blitz_tanker', { x: 20, z: 12, heading: 0.3 });
    const booms = [];
    w.events.on('explosion', (e) => booms.push(e.kind));
    tanker.takeDamage(80, dr, 'pistol');
    g.centerOn(20, 14);
    g.setZoom(0.45);
    g.advance(0.4);
    return { out, destroyed: tanker.destroyed, booms, burning: tanker.burning, truckOk: !truck.destroyed };
  });
  t.log(JSON.stringify(r2));
  t(r2.out, 'left the truck (knapsack photo → leaveVehicle)');
  t(r2.destroyed, 'tanker: one bullet');
  t(r2.booms.includes('vehicle') && r2.booms.includes('barrel'), 'vehicle + barrel blast');
  t(r2.burning, 'the wreck burns');
  await t.shot('vehicles-tanker');
}
