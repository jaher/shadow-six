/**
 * Vehicle integration — the realistic vehicle library in the game (art/vehicle-model.js): M1's truck is the Opel Blitz
 * in winter paint, a desert map gets the tan paint + tanker body, driving rolls the wheels and scrolls tank tracks, the
 * driver of a left-hand-drive car gets out on the LEFT (his door opens), the R75's sidecar passenger on the RIGHT,
 * trails come from every wheel contact, a destroyed truck shows the burnt wreck + scorch, lamps come on at night only
 * for crewed vehicles, parked wagons use the library, and `?vehicles=0` keeps the placeholders.
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const out = {};
    await g.loadMission('m01');
    const t1 = G.world.entities.find((e) => e.kind === 'vehicle' && e.tag === 'truck');
    out.m01 = [t1?.model.root.userData.library ?? null, t1?.model.root.userData.paint ?? null];
    const base = (await import('/src/missions/m00_sandbox.js')).default;
    const def = (theater) => ({ ...base, id: 'm00', theater, enemies: [],
      structures: [...(base.structures || []), { id: 'wag', type: 'train_car', variant: 'covered_goods', x: 50, z: 8, rot: 0, w: 10, d: 3, h: 3.5, block: 2 }],
      vehicles: [
        { id: 'tA', vehicleType: 'opel_blitz', x: 14, z: 20, heading: 0, driveable: true },
        { id: 'tB', vehicleType: 'opel_blitz_tanker', x: 26, z: 14, heading: 1 },
        { id: 'tC', vehicleType: 'truck', x: 24, z: 30, heading: 2, crew: ['truckDriver'] },
        { id: 'kub', vehicleType: 'kubelwagen', x: 8, z: 44, heading: 0, driveable: true },
        { id: 'moto', vehicleType: 'motorcycle', x: 40, z: 44, heading: 0, driveable: true },
        { id: 'pz', vehicleType: 'panzer4', x: 44, z: 22, heading: 0, crew: ['tankcrew'] },
        { id: 'van', vehicleType: 'van', x: 50, z: 50, heading: 0 },
      ] });
    await G.loadMission(def('desert'));
    g.start();
    const vs = () => Object.fromEntries(G.world.vehicles.map((v) => [v.tag, v]));
    let v = vs();
    out.desert = [v.tA.model.root.userData.paint, v.tB.model.root.userData.library, v.van.model.library === true];
    // wheels roll, tracks scroll
    const wheel = v.tA.model.visual.parts.wheel_rr, q0 = wheel.quaternion.clone();
    v.tA.speed = 4; v.tA.model.update(0.25, v.tA); v.tA.speed = 0;
    out.rolled = q0.angleTo(wheel.quaternion);
    out.contacts = [v.tA.model.trailContacts(v.tA).length, v.moto.model.trailContacts(v.moto).length, v.pz.model.trailContacts(v.pz).length];
    // left-hand drive: the Driver gets out on the left, his door opens; the sidecar passenger gets out on the right
    const d = G.world.commandos.find((c) => c.role === 'driver') || G.world.commandos[0];
    const side = (veh, u) => (u.x - veh.x) * -Math.sin(veh.heading) + (u.z - veh.z) * Math.cos(veh.heading); // + = right
    d.setPosition(v.kub.x - 2, v.kub.z); v.kub.enter(d);
    for (let k = 0; k < 30; k++) g.step();
    v.kub.exit(d);
    for (let k = 0; k < 12; k++) g.step();
    out.kubExit = side(v.kub, d);
    out.door = Math.abs(v.kub.model.visual.parts.door_fl.rotation.y);
    const other = G.world.commandos.find((c) => c !== d);
    d.setPosition(v.moto.x - 2, v.moto.z - 2); v.moto.enter(d);
    other.setPosition(v.moto.x - 2, v.moto.z + 2); v.moto.enter(other);
    const pass = v.moto.occupants[1];
    if (pass) { v.moto.exit(pass); out.sidecarExit = side(v.moto, pass); }
    out.theater = G.missionDef.theater;
    out.wagon = [...G.world.structures.values()].find((s) => s.def.id === 'wag')?.object3d.children.some((c) => /static-vehicle:wagon_covered/.test(c.name));
    // destroy → wreck + scorch
    v.tA.destroy();
    g.advance(0.3);
    out.wreck = [v.tA.model.visual.destroyed, !!v.tA.model.scorch?.visible && !!v.tA.model.scorch.parent];
    const lampsOn = (veh) => (veh.model.visual.object3d.children.filter((c) => /^lamp/.test(c.name)).some((c) => c.visible));
    out.lightsDay = lampsOn(v.tC);
    await G.loadMission(def('night'));
    g.start(); g.advance(0.2);
    v = vs();
    out.lightsNight = [lampsOn(v.tC), lampsOn(v.tA)];
    return out;
  });
  t.log(JSON.stringify(r));
  t.equal(r.m01[0], 'opel_blitz_cargo', 'M1 truck is the library Opel Blitz');
  t.equal(r.m01[1], 'winter', 'M1 (snow) truck wears the winter whitewash');
  t.equal(r.desert[0], 'dak', 'desert truck is Afrika Korps tan');
  t.equal(r.desert[1], 'opel_blitz_tanker', 'tanker type gets the tank body');
  t.equal(r.desert[2], false, 'van (no library model) keeps the placeholder');
  t.ok(r.rolled > 1, `wheels roll when driving (${r.rolled})`);
  t.ok(r.contacts[0] === 4 && r.contacts[1] === 3 && r.contacts[2] >= 4, `trail contacts per wheel / track (${r.contacts})`);
  t.ok(r.kubExit < -0.5, `LHD: the driver steps out on the left (${r.kubExit?.toFixed(2)})`);
  t.ok(r.door > 0.2, `the driver's door swings open (${r.door?.toFixed(2)} rad)`);
  t.ok(r.sidecarExit > 0.5, `R75: the sidecar passenger steps out on the right (${r.sidecarExit?.toFixed(2)})`);
  t.ok(r.wagon, 'parked wagon structure drawn by the library');
  t.ok(r.wreck[0] && r.wreck[1], 'destroyed → burnt wreck + scorch decal');
  t.equal(r.lightsDay, false, 'no lamps by day');
  t.equal(r.lightsNight[0], true, 'crewed truck at night → lamps on');
  t.equal(r.lightsNight[1], false, 'empty parked truck at night → lamps off');

  const p2 = await t.harness.newPage();
  await t.harness.openGame(p2, '?test=1&vehicles=0');
  const ph = await p2.evaluate(async () => {
    await window.__game.loadMission('m01');
    return window.__game.game.world.vehicles.map((v) => v.model.library === true);
  });
  await p2.close();
  t.ok(ph.length > 0 && ph.every((x) => x === false), 'vehicles=0 → placeholders');
}
