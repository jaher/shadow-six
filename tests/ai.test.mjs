/**
 * AI in the real game (GPU): design-spec §10.2 / §10.5 #13 on the sandbox grid — the cone the renderer draws
 * (VisionCones' fan: house + truck occluders) is the detection geometry — plus the §4.2 display rules
 * (single cone, BEL flat colours, probe ring, spotter highlight) and a "Halt!" → HOLD → COMBAT run.
 * Screenshots: tests/out/ai-cone-occlusion.png, tests/out/ai-spotter.png.
 */
export default async function ai(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    const G = g.game;
    const w = G.world;
    g.start();
    const { canSee } = await import('./src/ai/perception.js');
    const e = w.enemies.find((q) => q.tag === 'guard_fuel');
    for (const q of [...w.enemies]) if (q !== e) w.remove(q);
    for (const c of w.commandos) c.hidden = true;
    e.setPosition(30, 17, Math.PI);
    Object.assign(e.post, { x: 30, z: 17, heading: Math.PI });
    e.vision.sweep = 0; // hold the head still for the picture
    w.spawnVehicle('truck', { x: 22, z: 21, heading: 0.3 });
    g.advance(0.2);
    g.setCone(e.id, true);
    G.cones.setProbe(25, 15.5);
    g.setZoom(1);
    g.centerOn(22, 18);
    G.render(0, 1);
    const vc = G.cones.cones.get(e);
    const fan = vc.fan;
    // what the cone shader draws (its sector mesh under this frame's window: drawnAt), clearly inside / outside (the 8
    // points 0.25 m round it agree; else null)
    const drawn = (x, z) => vc.drawnAt(x, z) != null;
    const clearly = (x, z) => { const at = drawn(x, z); for (let k = 0; k < 8; k++) if (drawn(x + 0.25 * Math.cos(k * Math.PI / 4), z + 0.25 * Math.sin(k * Math.PI / 4)) !== at) return null; return at; };
    let checked = 0, bad = 0, occluded = 0;
    const gr = w.grid;
    for (let k = 0; k < 3000; k++) {
      const x = e.x - 38 + w.rng.next() * 76, z = e.z - 38 + w.rng.next() * 76;
      const i = Math.floor(x / gr.cell), j = Math.floor(z / gr.cell);
      if (!gr.inBounds(i, j) || gr.block[gr.idx(i, j)] === 2 || gr.dynamicBlock[gr.idx(i, j)] === 2) continue;
      const inPoly = clearly(x, z);
      if (inPoly == null) continue;
      const seen = canSee(e, { x, z, y: gr.elev[gr.idx(i, j)], isLow: false, isVisibleToEnemies: true }, w) !== 'none';
      if (seen !== inPoly) bad++;
      if (!inPoly && Math.hypot(x - e.x, z - e.z) < fan.cone.far - 1 && Math.abs(Math.atan2(z - e.z, x - e.x) - Math.PI) < 0.5) occluded++;
      checked++;
    }
    return {
      checked, bad, occluded, rays: vc.rayCount, shown: G.cones.cones.size, probe: G.cones.probe?.triggered && G.cones.probe.enemy === e,
      near: vc.nearMesh.material.color.getHexString(), far: vc.farMesh.material.color.getHexString(), alpha: vc.nearMesh.material.opacity,
    };
  });
  t.log(JSON.stringify(r));
  t(r.checked > 1000, 'sampled points');
  t.equal(r.bad, 0, 'drawn cone (stand region) == standing detection (house + truck occlusion)');
  t(r.occluded > 20, 'occluders cut the cone');
  t(r.rays >= 96, 'at least 96 rays');
  t.equal(r.shown, 1, 'one cone shown');
  t(r.probe, 'probe ring triggered on the guard');
  t.equal(r.near, '02bc6f', 'BEL green near'); t.equal(r.far, '07675a', 'BEL green far'); t.equal(r.alpha, 0.5, '50% alpha');
  await t.shot('ai-cone-occlusion');

  // Halt! → HOLD → COMBAT, with the spotter highlight (75% for 1 s)
  const s = await page.evaluate(async () => {
    const g = window.__game;
    const G = g.game;
    const w = G.world;
    const e = w.enemies[0];
    G.cones.clearProbe();
    const gb = w.commandos.find((c) => c.role === 'greenberet');
    gb.hidden = false;
    gb.setPosition(20, 12, 0);
    const log = [];
    w.events.on('enemy:state', (p) => log.push(p.to));
    let halt = false;
    w.events.on('bark', (p) => { if (p.line === 'ger_halt') halt = true; });
    w.events.on('enemy:challenge', () => gb.stop());
    g.order(gb.id, { type: 'move', x: 20, z: 22 });
    g.advance(1.0);
    G.render(0, 1);
    const vc = G.cones.cones.get(e);
    const out = { state: e.brainState, held: gb.held, alpha: vc?.nearMesh.material.opacity, halt };
    g.centerOn(24, 16);
    return out;
  });
  t.log(JSON.stringify(s));
  t(s.halt, '"Halt!" shouted');
  t.equal(s.held, true, 'commando held');
  t.equal(s.state, 'HOLD', 'sentry holds at gunpoint');
  t.equal(s.alpha, 0.75, 'spotter cone brightened to 75%');
  await t.shot('ai-spotter');
  const c = await page.evaluate(() => {
    const g = window.__game;
    const w = g.game.world;
    const gb = w.commandos.find((q) => q.role === 'greenberet');
    g.order(gb.id, { type: 'move', x: 20, z: 5 });
    g.advance(2);
    return { state: w.enemies[0].brainState, hp: gb.hp, max: gb.maxHp };
  });
  t.log(JSON.stringify(c));
  t.equal(c.state, 'COMBAT', 'moving away while held → COMBAT');
  t(c.hp < c.max, 'deterministic hits');
}
