/**
 * Vehicle GPU warm-up (art/vehicle-model.js warmVehicleArt): the loading screen compiles the vehicle shaders and uploads
 * their textures + vertex buffers (intact and wreck), so the first pan onto a group of vehicles and the first wreck swap
 * cost about what the same pan costs with no vehicles. Sandbox: Pz IV, Horch, Opel Blitz, R75 parked far from the start
 * view; the camera jumps onto them; the first two synced frames are timed against a control load with no vehicles.
 * Then the truck and the Horch are destroyed: the first frame after the wreck swap (burnt instance, scorch decal, the
 * wreck's explosion + fire VFX, VFX shaders already compiled by an earlier blast in both runs) against the control.
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const gl = G.renderer.renderer.getContext(), px = new Uint8Array(4);
    const frame = () => { const t0 = performance.now(); G.render(1 / 60, 1); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return performance.now() - t0; };
    const base = (await import('/src/missions/m00_sandbox.js')).default;
    const VEH = [
      { id: 'pz', vehicleType: 'panzer4', x: 44, z: 10, heading: 0 },
      { id: 'horch', vehicleType: 'horch', x: 52, z: 16, heading: 1 },
      { id: 'truck', vehicleType: 'truck', x: 52, z: 6, heading: 2 },
      { id: 'moto', vehicleType: 'motorcycle', x: 46, z: 18, heading: 0.5 },
    ];
    const run = async (withVeh) => {
      await G.loadMission({ ...base, id: 'm00', theater: 'temperate', enemies: [], vehicles: withVeh ? VEH : [], cameraStart: { x: 10, z: 50 } });
      g.start(); g.setZoom(1); g.centerOn(10, 50);
      for (let i = 0; i < 12; i++) frame();
      g.centerOn(49, 12);
      const pan = [frame(), frame()];
      // the VFX library's first explosion compiles its own particle / pass shaders (any first blast: a barrel, a
      // grenade): fire one in view in BOTH runs first, so the wreck frame below times the vehicle swap itself
      const THREE = await import('three');
      G.world.fx?.vfx?.spawn('explosion_small', new THREE.Vector3(48, 0, 22)); // visual only, in view
      for (let i = 0; i < 12; i++) frame();
      const vs = G.world.vehicles.filter((v) => v.tag === 'truck' || v.tag === 'horch');
      for (const v of vs) v.destroy();
      const wreck = [frame(), frame()];
      return { pan, wreck, warm: G.vehicleWarm || null, wrecks: vs.map((v) => v.model.visual?.destroyed === true) };
    };
    const out = { veh: [], ctl: [] };
    for (let rep = 0; rep < 2; rep++) { out.ctl.push(await run(false)); out.veh.push(await run(true)); }
    return out;
  });
  // the FIRST vehicle load is the cold one (programs / textures persist across loads): against the best control frame
  const cold = (k, i) => r.veh[0][k][i] - Math.min(...r.ctl.map((x) => x[k][i]));
  const pan = cold('pan', 0) + cold('pan', 1), wreck = cold('wreck', 0);
  t.log(JSON.stringify(r), `extra first-sight ${pan.toFixed(1)} ms, wreck swap ${wreck.toFixed(1)} ms`);
  t.ok(r.veh[0].warm && r.veh[0].warm.visuals >= 4 && r.veh[0].warm.wrecks >= 3, `vehicles + wrecks warmed at load (${JSON.stringify(r.veh[0].warm)})`);
  t.ok(r.veh.every((x) => x.wrecks.every(Boolean)), 'truck + Horch swapped to wrecks');
  t.ok(pan <= 60, `first pan onto 4 vehicles costs ${pan.toFixed(1)} ms over the empty pan (was ~200 ms unwarmed)`);
  t.ok(wreck <= 15, `first frame after a wreck swap costs ${wreck.toFixed(1)} ms over control (was ~30 ms; explosion + fire included)`);
}
