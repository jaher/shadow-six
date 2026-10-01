/**
 * Vehicle ambient step (GPU): crews at the library seats — a truck's crew record at the wheel under the cab roof, enemy
 * riders seated in a Kübelwagen and gone when the driver steps out through his (left) door on a scripted exit; night:
 * lamp glare + the fixed real-light pool on the lit (crewed) vehicles only; a staff car's pennant flies in the wind.
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, out = {};
    const THREE = await import('three');
    const VM = await import('/src/art/vehicle-model.js');
    const base = (await import('/src/missions/m00_sandbox.js')).default;
    const settle = async (n = 90) => { for (let k = 0; k < n; k++) { g.step(); G.render(1 / 30, 1); if (k % 6 === 0) await new Promise((ok) => setTimeout(ok, 40)); } };
    await G.loadMission({ ...base, id: 'm00', enemies: [{ id: 'eK', soldierType: 'officer', x: 20, z: 36, heading: 0 }, { id: 'eK2', soldierType: 'soldier', x: 21, z: 36, heading: 0 }],
      weather: { wind: { preset: 'coast' } },
      vehicles: [
        { id: 'kub', vehicleType: 'kubelwagen', paint: 'grey', x: 22, z: 30, heading: 0, driveable: true },
        { id: 'tr', vehicleType: 'truck', x: 32, z: 22, heading: 0, crew: ['truckDriver'] },
        { id: 'hor', vehicleType: 'horch', x: 40, z: 34, heading: 0.3, crew: ['officer'], pennant: true },
      ] });
    g.start(); g.advance(0.2);
    const V = Object.fromEntries(G.world.vehicles.map((v) => [v.tag, v]));
    const eK = G.world.byId('eK'), eK2 = G.world.byId('eK2');
    V.kub.enter(eK); V.kub.enter(eK2);
    for (let i = 0; i < 40 && !(V.kub._crewFig?.occupants?.size === 2 && [...V.kub._crewFig.occupants.values()].every((f) => f.settled) && V.tr._crewFig?.figures?.[0]?.settled); i++) await settle(15);
    const occ = [...(V.kub._crewFig?.occupants?.values() || [])];
    out.kub = occ.map((f) => [f.k, f.settled, f.m.root.visible]);
    // the truck driver: seated, head under the cab roof
    const fT = V.tr._crewFig?.figures?.[0];
    const head = fT?.m.real.getSocket('head'), cab = V.tr.model.visual.object3d;
    if (head) {
      cab.updateMatrixWorld(true); fT.m.root.updateMatrixWorld(true);
      const hp = cab.worldToLocal(head.getWorldPosition(new THREE.Vector3()));
      const md = V.tr.model.meta?.dims || {};
      out.truck = { settled: fT.settled, vis: fT.m.root.visible, headY: +hp.y.toFixed(2), roof: md.height_cab, headX: +hp.x.toFixed(2) };
    }
    // scripted exit: the driver steps out on the LEFT at his door, walks to the point; his seated figure is gone
    const side = (veh, u) => (u.x - veh.x) * -Math.sin(veh.heading) + (u.z - veh.z) * Math.cos(veh.heading);
    V.kub.exit(eK, 22, 44, { force: true });
    await settle(6);
    out.exit = { side: +side(V.kub, eK).toFixed(2), door: +Math.abs(V.kub.model.visual.parts.door_fl.rotation.y).toFixed(2),
      seats: [...V.kub._crewFig.occupants.values()].map((f) => f.u.spawn?.id ?? f.u.tag), visible: eK.object3d?.visible };
    // pennant flies (cloth off its rest pose; off-screen cloths are not simulated)
    G.cameraController.centerOn(V.hor.x, V.hor.z);
    await settle(30);
    const { CLOTHS } = await import('/src/art/cloth.js');
    const pc = CLOTHS.find((c) => c.mesh.name === 'pennant_cloth' && c.mesh.parent?.name === 'pennant:staff');
    let dev = 0; if (pc) for (let i = 0; i < pc.cloth.x.length; i++) dev = Math.max(dev, Math.abs(pc.cloth.x[i] - pc.cloth.rest[i]));
    out.pennant = +dev.toFixed(2);
    // night: glare on lit (crewed) vehicles only, real lights assigned from the fixed pool
    await G.loadMission({ ...base, id: 'm00', theater: 'night', enemies: [], vehicles: [
      { id: 'tr', vehicleType: 'truck', x: 30, z: 26, heading: 0, crew: ['truckDriver'] },
      { id: 'car', vehicleType: 'car', x: 20, z: 30, heading: 0, crew: ['soldier'] },
      { id: 'dark', vehicleType: 'truck', x: 40, z: 40, heading: 1 }] });
    g.start();
    await settle(20);
    const W = Object.fromEntries(G.world.vehicles.map((v) => [v.tag, v]));
    const glare = (v) => { let n = 0; v.model.root.traverse((o) => { if (o.name === 'lamp-glare' && o.parent?.visible) n++; }); return n; };
    const pool = VM.vehicleLampPool();
    out.night = { glare: [glare(W.tr), glare(W.car), glare(W.dark)], beams: [W.tr.model.beam?.kind, W.car.model.beam?.kind],
      pool: pool && { ...pool.stats }, lit: pool?.lights.filter((L) => L.intensity > 0).length };
    return out;
  });
  t.log(JSON.stringify(r));
  t.ok(r.kub.length === 2 && r.kub.every((f) => f[1] && f[2]), `two riders seated in the Kübelwagen (${JSON.stringify(r.kub)})`);
  t.ok(r.truck?.settled && r.truck.vis, 'the lorry driver sits at the wheel');
  t.ok(r.truck.headY < r.truck.roof - 0.05, `…head under the cab roof (${r.truck.headY} < ${r.truck.roof} m)`);
  t.ok(r.truck.headX > 0.2, `…on the left (driver's) seat (x ${r.truck.headX})`);
  t.ok(r.exit.side < -0.8, `scripted exit: the driver steps out on the left (${r.exit.side})`);
  t.ok(r.exit.door > 0.2, `…through his opening door (${r.exit.door} rad)`);
  t.ok(r.exit.seats.length === 1 && r.exit.seats[0] === 'eK2' && r.exit.visible === true, 'his seated figure is gone, he stands outside');
  t.ok(r.pennant > 0.08, `staff-car pennant flies in the wind (${r.pennant} m off its rest pose)`);
  t.ok(r.night.glare[0] > 0 && r.night.glare[1] > 0 && r.night.glare[2] === 0, `night glare on crewed vehicles only (${r.night.glare})`);
  t.equal(r.night.beams[0], 'blackout', 'military lorry: blackout-covered headlamps');
  t.equal(r.night.beams[1], 'full', 'civilian car: full headlamps');
  t.ok(r.night.pool?.lights > 0 && r.night.lit === 2, `real headlamp lights on the two lit vehicles (${JSON.stringify(r.night.pool)})`);
}
