/**
 * Art integration 2 — Opel Blitz trucks in the game: M1's truck is the grey GLB, a desert map gets the tan paint and
 * the tanker body, driving rolls the wheels, a destroyed truck turns into the burnt wreck, headlights come on at night
 * for a crewed truck, and `?trucks=0` keeps the placeholder boxes.
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const out = {};
    await g.loadMission('m01');
    const t1 = G.world.entities.find((e) => e.kind === 'vehicle' && e.tag === 'truck');
    out.m01 = t1?.model.root.userData.truck ?? null;
    // desert + tanker + night, on the sandbox map
    const base = (await import('/src/missions/m00_sandbox.js')).default;
    const def = (theater) => ({ ...base, id: 'm00', theater, enemies: [], vehicles: [
      { id: 'tA', vehicleType: 'opel_blitz', x: 14, z: 20, heading: 0, driveable: true },
      { id: 'tB', vehicleType: 'opel_blitz_tanker', x: 26, z: 14, heading: 1 },
      { id: 'tC', vehicleType: 'truck', x: 24, z: 30, heading: 2, crew: ['truckDriver'] },
    ] });
    await G.loadMission(def('desert'));
    g.start();
    const vs = () => Object.fromEntries(G.world.entities.filter((e) => e.kind === 'vehicle').map((v) => [v.tag, v]));
    let v = vs();
    out.desert = [v.tA.model.root.userData.truck, v.tB.model.root.userData.truck];
    // drive: wheels roll
    const wheel = v.tA.model.root.getObjectByName('wheel_RR');
    const q0 = wheel.quaternion.clone();
    v.tA.speed = 4; v.tA.model.update(0.25, v.tA); v.tA.speed = 0;
    out.rolled = q0.angleTo(wheel.quaternion);
    out.lightsDay = v.tC.model.root.getObjectByName('headlights').visible;
    // destroy the cargo truck → burnt wreck visible, intact body hidden
    v.tA.destroy();
    g.advance(0.2);
    const kids = v.tA.model.root.children;
    out.wreck = kids.length === 2 && !kids[0].visible && kids[1].visible;
    await G.loadMission(def('night'));
    g.start(); g.advance(0.2);
    v = vs();
    out.lightsNight = [v.tC.model.root.getObjectByName('headlights').visible, v.tA.model.root.getObjectByName('headlights').visible];
    const R = G.renderer.renderer; G.renderer.render?.(); out.calls = R.info.render.calls;
    return out;
  });
  t.log(JSON.stringify(r));
  t.equal(r.m01, 'truck_grey', 'M1 (snow) truck uses the panzer-grey Opel Blitz');
  t.equal(r.desert[0], 'truck_dak', 'desert cargo truck is Afrika Korps tan');
  t.equal(r.desert[1], 'truck_dak_tanker', 'tanker type gets the tank body');
  t.ok(r.rolled > 1, `wheels roll when driving (${r.rolled})`);
  t.equal(r.lightsDay, false, 'no headlights by day');
  t.ok(r.wreck, 'destroyed → burnt wreck model');
  t.equal(r.lightsNight[0], true, 'crewed truck at night → headlights on');
  t.equal(r.lightsNight[1], false, 'empty parked truck at night → lights off');

  const p2 = await t.harness.newPage();
  await t.harness.openGame(p2, '?test=1&trucks=0');
  const ph = await p2.evaluate(async () => {
    await window.__game.loadMission('m01');
    return window.__game.game.world.entities.filter((e) => e.kind === 'vehicle').map((v) => v.model.root.userData.truck ?? null);
  });
  await p2.close();
  t.ok(ph.length > 0 && ph.every((x) => x === null), 'trucks=0 → placeholders');
}
