/**
 * M3 fence switch station (user 2026-10-12: "in mission 3 there should be small station with a lever to deactivate the
 * electricity from the fence. Right now the spy pulls a lever in the void"; world/switch-station.js,
 * art/switch-station.js). In the running game, stepped deterministically (g.step(); G.render(1/60, 1)):
 *  - a station model stands at the fence switch's point (19.5, 68) against the admin house: in the scene, casting
 *    shadows, with a lever (up: on) and the roof blades closed; its cells are blocked;
 *  - the Spy ordered to the switch walks onto the stand spot in front of it, faces it, and her left fist is on the
 *    lever's crossbar while she throws it (≤ 3 cm); the lever ends at the off stop (down), the blades open, the fence
 *    dead; it stays down;
 *  - a quicksave / quickload keeps it down (the lever is drawn from the switch's state).
 * Shots: m03-switch-before.png, m03-switch-after.png, m03-switch-game.png.
 */
import { writeFileSync } from 'node:fs';

export const timeout = 300_000;

async function viewShot(page, t, name, o) {
  const url = await page.evaluate((o) => window.__swShot(o), o);
  writeFileSync(t.harness.shotPath(`${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
}

export default async function m03SwitchStation(page, t) {
  const r0 = await page.evaluate(async () => {
    const g = window.__game, G = g.game, THREE = await import('three');
    window.__swShot = ({ x, z, h, y = 1.1, dist = 12, half = 1.4, pitch = 0.25 }) => {
      const cam = G.renderer.camera, w = G.world;
      const keep = { p: cam.position.clone(), q: cam.quaternion.clone(), up: cam.up.clone(), l: cam.left, r: cam.right, t: cam.top, b: cam.bottom, n: cam.near, f: cam.far, z: cam.zoom };
      const c = new THREE.Vector3(x, (w.groundY?.(x, z) || 0) + y, z);
      cam.position.copy(c).add(new THREE.Vector3(Math.cos(h) * Math.cos(pitch), Math.sin(pitch), Math.sin(h) * Math.cos(pitch)).multiplyScalar(dist));
      cam.up.set(0, 1, 0); cam.lookAt(c);
      const asp = G.renderer.width / G.renderer.height;
      Object.assign(cam, { left: -half * asp, right: half * asp, top: half, bottom: -half, near: 0.5, far: dist + 30, zoom: 1 });
      cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      G.renderer.render(0);
      const url = G.renderer.renderer.domElement.toDataURL('image/png');
      cam.position.copy(keep.p); cam.quaternion.copy(keep.q); cam.up.copy(keep.up);
      Object.assign(cam, { left: keep.l, right: keep.r, top: keep.t, bottom: keep.b, near: keep.n, far: keep.f, zoom: keep.z });
      cam.updateProjectionMatrix(); G.render(0, 1);
      return url;
    };
    await g.loadMission('m03');
    const w = G.world;
    const spy = w.commandos.find((c) => c.role === 'spy');
    // the guards round the station look away (this test is about the lever, not about being seen)
    for (const e of w.enemies) if (Math.hypot(e.x - 20, e.z - 68) < 45 && e.brain) e.brain.update = () => {};
    spy.setPosition(26, 56.5, Math.PI / 2);
    spy.disguised = true;
    g.start();
    await G.mapHandle?.ready;
    await spy.model?.ready;
    G.input.select?.([]);
    for (let i = 0; i < 5; i++) { g.step(); G.render(1 / 60, 1); }
    const S = w.switchStations?.[0], sw = S?.sw;
    const { STATION } = await import('/src/world/switch-station.js');
    let inScene = false, meshes = 0, shadow = 0;
    S?.vis?.group.traverseAncestors((a) => { if (a === G.renderer.scene) inScene = true; });
    S?.vis?.group.traverse((o) => { if (o.isMesh) { meshes++; if (o.castShadow) shadow++; } });
    const bb = S?.vis ? new THREE.Box3().setFromObject(S.vis.group) : null;
    const c = w.grid.worldToCell(19.5, 68);
    return {
      n: w.switchStations?.length ?? 0, tag: sw?.tag, inScene, meshes, shadow, theta: S?.vis?.theta, on: STATION.on, off: STATION.off,
      lever: !!S?.vis?.lever?.parent, at: S ? [S.vis.group.position.x, S.vis.group.position.z] : null,
      bb: bb && { min: bb.min.toArray(), max: bb.max.toArray() }, block: w.grid.block[w.grid.idx(c.i, c.j)],
      jawY: S?.vis?.jaws().map((p) => p.y),
    };
  });
  t.log(`station: ${r0.meshes} meshes (${r0.shadow} cast shadows), bbox ${JSON.stringify(r0.bb)}`);
  t.equal(r0.n, 1, 'one switch station in M3');
  t.equal(r0.tag, 'fence_switch', 'for the fence switch');
  t(r0.inScene, 'the station model is in the scene');
  t(r0.meshes >= 5 && r0.shadow >= 4, 'a real model that casts shadows');
  t(r0.lever, 'with a lever');
  t.near(r0.at[0], 19.5, 0.01, 'at the switch point (x)'); t.near(r0.at[1], 68, 0.01, 'at the switch point (z)');
  t(r0.bb.min[0] > 19.0 && r0.bb.max[0] < 20.4, 'between the house wall and the stand spot');
  t(r0.bb.max[1] > 2.3 && r0.bb.max[1] < 3.2, 'a small kiosk (2–3 m tall with its roof gear)');
  t.near(r0.theta, r0.on, 1e-6, 'lever up (on)');
  t.equal(r0.block, 2, 'its cells are blocked (HIGH)');
  await viewShot(page, t, 'm03-switch-before', { x: 20.1, z: 68.2, h: 0.75, half: 1.4 });

  // the Spy throws it
  const r1 = await page.evaluate(async () => {
    const g = window.__game, G = g.game, w = G.world;
    const { stationMetrics } = await import('/src/art/switch-station.js');
    const spy = w.commandos.find((c) => c.role === 'spy'), S = w.switchStations[0], sw = S.sw;
    const ok = g.useAbility(spy.id, 'use', sw.id);
    const step = () => { g.step(); G.render(1 / 60, 1); };
    let n = 0;
    while (spy.currentActionId !== 'use' && n < 1800) { step(); n++; }
    const start = { x: spy.x, z: spy.z, h: spy.heading, stand: { ...sw.params.stand }, t: w.time };
    const samples = [];
    for (let k = 1; k <= 75; k++) {
      step();
      const m = stationMetrics(w, 'fence_switch');
      samples.push({ t: +(w.time - start.t).toFixed(3), theta: m.theta, d: m.fistToGrip, on: m.on });
    }
    return { ok, n, start, samples, power: w.fencePower.get('st_fence') };
  });
  t(r1.ok, 'use order accepted');
  t(r1.n < 1800, `the Spy got to the station (${r1.n} ticks)`);
  t(Math.hypot(r1.start.x - r1.start.stand.x, r1.start.z - r1.start.stand.z) < 0.06, `on the stand spot (${r1.start.x.toFixed(2)}, ${r1.start.z.toFixed(2)})`);
  t.near(Math.cos(r1.start.h), -1, 1e-3, 'facing the kiosk (west)');
  const during = r1.samples.filter((s) => s.t >= 0.36 && s.t <= 0.95);
  const worst = Math.max(...during.map((s) => s.d ?? 9));
  t.log(`fist to the crossbar during the throw: max ${(worst * 100).toFixed(1)} cm over ${during.length} frames`);
  t(during.length > 20 && worst < 0.03, `her left fist stays on the lever's crossbar (${(worst * 100).toFixed(1)} cm)`);
  const th = r1.samples.map((s) => s.theta);
  t(th.every((v, k) => k === 0 || v >= th[k - 1] - 1e-9), 'the lever only comes down');
  const end = r1.samples[r1.samples.length - 1];
  t.near(end.theta, r0.off, 1e-6, 'lever at the off stop (down)');
  t.equal(end.on, false, 'switch off');
  t.equal(r1.power, false, 'fence dead');
  // stays down
  const r2 = await page.evaluate(async () => {
    const g = window.__game, G = g.game, w = G.world;
    for (let i = 0; i < 120; i++) { g.step(); G.render(1 / 60, 1); }
    const S = w.switchStations[0];
    return { theta: S.vis.theta, jawY: S.vis.jaws().map((p) => p.y) };
  });
  t.near(r2.theta, r0.off, 1e-6, 'and stays down');
  t(r2.jawY.every((y, k) => y > r0.jawY[k] + 0.3), 'the roof blades stand open');
  await viewShot(page, t, 'm03-switch-after', { x: 20.1, z: 68.2, h: 0.75, half: 1.4 });
  await page.evaluate(() => { const g = window.__game; g.setZoom(2.5); g.centerOn(20.5, 68); g.game.render(1 / 60, 1); });
  await page.screenshot({ path: t.harness.shotPath('m03-switch-game.png') });

  // save / load keeps it down
  const r3 = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    G.quickSave();
    let w = G.world;
    w.switchStations[0].sw.interact(w.commandos.find((c) => c.role === 'spy')); // back on after the save
    G.render(1 / 60, 1);
    const flipped = w.switchStations[0].vis.theta;
    await G.quickLoad();
    G.pause(false);
    w = G.world;
    for (let i = 0; i < 3; i++) { g.step(); G.render(1 / 60, 1); }
    const S = w.switchStations[0];
    return { flipped, theta: S.vis.theta, on: S.sw.on, power: w.fencePower.get('st_fence') };
  });
  t.near(r3.flipped, r0.on, 1e-6, 'thrown back on before the load: lever up');
  t.equal(r3.on, false, 'loaded: switch off');
  t.equal(r3.power, false, 'loaded: fence dead');
  t.near(r3.theta, r0.off, 1e-6, 'loaded: the lever is drawn down');
}
