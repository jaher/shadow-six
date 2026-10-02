/**
 * CORE2 saving + end conditions (design-spec §8.1, §8.2, §8.4): quicksave/quickload determinism,
 * named slots, camera views and mission clock in the save, 5 s grace countdown with re-check,
 * "escaped but targets not done" dialog + 15 s continue window, win payload + flow debrief.
 */
export default async function core2Save(page, t) {
  const det = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    g.start();
    const G = g.game;
    const snap = () => {
      const s = g.state();
      return JSON.stringify({ c: s.commandos.map((c) => [c.x, c.z, c.hp, c.state]), e: s.enemies.map((e) => [e.x, e.z, e.brainState, e.nervousness]), clock: s.clock, tick: G.world.tick, rng: G.world.rng.snapshot });
    };
    g.advance(3);
    const gb = G.world.commandos[0];
    gb.issue({ type: 'move', x: gb.x + 6, z: gb.z - 4, run: true });
    g.advance(1);
    G.cameraRig.setViews(2);
    G.cameraRig.views[1].centerOn(47, 30);
    const v1Saved = [G.cameraRig.views[1].target.x, G.cameraRig.views[1].target.z]; // (centerOn aims the play view below the HUD bar at 47,30)
    const saveClock = G.world.clock;
    G.quickSave();
    g.advance(8);
    const a = snap();
    G.cameraRig.setViews(1);
    await G.quickLoad();
    const loaded = { state: G.state, clock: G.world.clock, views: G.cameraRig.count, v1: [G.cameraRig.views[1]?.target.x, G.cameraRig.views[1]?.target.z] };
    G.pause(false);
    g.advance(8);
    const b = snap();
    // named slots
    G.saveSlot(3, 'before bridge');
    const { listSlots } = await import('./src/save.js');
    const slots = listSlots();
    g.advance(2);
    const okSlot = await G.loadSlot(3);
    return { v1Saved, same: a === b, a: a.slice(0, 200), b: b.slice(0, 200), saveClock, loaded, slot3: slots[3]?.name, empty0: slots[0], okSlot, clockAfterSlot: G.world.clock };
  });
  t.log(JSON.stringify(det));
  t(det.same, 'quickload + same ticks reproduces the exact same world (determinism)');
  t.equal(det.loaded.state, 'playing', 'a load during play resumes play (§8.4; only a P-pause is kept)');
  t.near(det.loaded.clock, det.saveClock, 1e-9, 'mission clock is saved');
  t.equal(det.loaded.views, 2, 'camera views are saved');
  t(Math.abs(det.v1Saved[0] - 47) < 1, `second view was looking at x 47 (${det.v1Saved[0]})`);
  t.near(det.loaded.v1[0], det.v1Saved[0], 0.01, 'second view target restored');
  t.near(det.loaded.v1[1], det.v1Saved[1], 0.01, 'second view target restored (z)');
  t.equal(det.slot3, 'before bridge', 'named slot listed');
  t(det.okSlot, 'named slot loads');

  // electric fence (§7.6 st_fence "powered until fence_switch is used"): the power survives a quickload
  const fence = await page.evaluate(async () => {
    const g = window.__game;
    const G = g.game;
    await g.loadMission('m03');
    g.start();
    let w = G.world;
    const sp = w.commandos.find((c) => c.role === 'sapper');
    const sw = w.interactables.find((i) => i.interactKind === 'switch' && i.tag === 'fence_switch');
    sw.interact(w.commandos.find((c) => c.role === 'spy') || sp);
    const before = { power: w.fencePower.get('st_fence'), on: sw.on };
    G.quickSave();
    sw.interact(sp); // power back on after the save: the load must bring the saved state back
    await G.quickLoad();
    G.pause(false);
    w = G.world;
    const sw2 = w.interactables.find((i) => i.interactKind === 'switch' && i.tag === 'fence_switch');
    const after = { power: w.fencePower.get('st_fence'), on: sw2.on };
    const sp2 = w.commandos.find((c) => c.role === 'sapper');
    sp2.setPosition(42, 64.2, 0);
    const hp0 = sp2.hp;
    let res = null;
    const off = G.events.on('ability:end', (e) => { if (e.id === 'cutters') res = e.result; });
    const issued = g.useAbility(sp2.id, 'cutters', { x: 42, z: 65.1 });
    g.advance(5);
    off();
    sw2.interact(sp2);
    return { before, after, issued, res, hp0, hp1: sp2.hp, reflip: { power: w.fencePower.get('st_fence'), on: sw2.on } };
  });
  t.log(JSON.stringify(fence));
  t.equal(fence.before.power, false, 'switch cuts the fence power');
  t.equal(fence.after.power, false, 'fence power is saved: still off after quickload');
  t.equal(fence.after.on, fence.before.on, 'switch state is saved');
  t(fence.issued, 'cutters issued at the fence after load');
  t(fence.res !== 'failed' && fence.res != null, `cutters succeed on the unpowered fence after load (${fence.res})`);
  t.equal(fence.hp1, fence.hp0, 'no electric shock after load');
  t.equal(fence.reflip.power, true, 'first flip after load restores the power (switch and fence stay in sync)');

  const end = await page.evaluate(async () => {
    const g = window.__game;
    const G = g.game;
    const ev = [];
    const offs = ['mission:countdown', 'mission:lost', 'mission:won', 'mission:escaped', 'mission:refused', 'flow:state'].map((k) =>
      G.events.on(k, (p) => ev.push({ k, reason: p?.reason ?? p?.to ?? null, t: +(G.world?.clock ?? 0).toFixed(2), stars: p?.stars, merit: p?.merit, rank: p?.rank })));
    const out = {};
    // --- grace countdown, condition cleared before it ends → no loss
    await g.loadMission('m00');
    g.start();
    let w = G.world;
    for (const c of w.commandos) c.state = 'jailed';
    g.advance(0.5);
    for (const c of w.commandos) c.state = 'active';
    g.advance(6);
    out.cleared = { state: G.state, ev: ev.map((e) => e.k + ':' + e.reason) };
    ev.length = 0;
    // --- a commando dies → loss after 5 s
    const t0 = w.clock;
    w.commandos[1].die('test');
    g.advance(4.9);
    out.at49 = G.state;
    g.advance(0.2);
    out.died = { state: G.state, after: +(w.clock - t0).toFixed(2), ev: ev.map((e) => e.k + ':' + e.reason), flow: G.flow.state };
    ev.length = 0;
    // --- escaped with the targets not done → dialog, pause, Continue → 15 s → loss
    await g.loadMission('m00');
    g.start();
    w = G.world;
    w.commandos.forEach((c, i) => c.setPosition(5 + i * 0.8, 7, 0));
    g.advance(0.2);
    out.escaped = { state: G.state, ev: ev.map((e) => e.k) };
    G.continueEscape();
    const tc = w.clock;
    g.advance(16);
    out.cont = { state: G.state, after: +(w.clock - tc).toFixed(1), last: ev[ev.length - 1]?.k + ':' + ev[ev.length - 1]?.reason };
    ev.length = 0;
    // --- win: target destroyed then everyone at the extraction
    await g.loadMission('m00');
    g.start();
    w = G.world;
    const fuel = w.interactables.find((i) => i.tag === 'fuel_depot') || w.byId('fuel_depot');
    fuel.takeDamage(1e6, null, 'explosion');
    w.clock = 100;
    w.commandos.forEach((c, i) => c.setPosition(5 + i * 0.8, 7, 0));
    g.advance(0.5);
    const won = ev.find((e) => e.k === 'mission:won');
    out.won = { state: G.state, flow: G.flow.state, won };
    offs.forEach((o) => o());
    return out;
  });
  t.log(JSON.stringify(end));
  t.equal(end.cleared.state, 'playing', 'grace countdown re-checks: a cleared condition does not end the mission');
  t(end.cleared.ev.includes('mission:countdown:ALL YOUR MEN HAVE DIED OR HAVE BEEN CAPTURED.'), 'countdown started for all men captured');
  t(end.cleared.ev.includes('mission:countdown:null'), 'countdown cancelled');
  t.equal(end.at49, 'playing', 'still playing 4.9 s after the death');
  t.equal(end.died.state, 'lost', 'loss after the 5 s countdown');
  t(end.died.ev.includes('mission:lost:ONE OR MORE OF YOUR MEN DIED…'), 'death message');
  t.equal(end.died.flow, 'debrief', 'flow → debrief');
  t.equal(end.escaped.state, 'paused', 'escaped with targets not done pauses for the dialog');
  t(end.escaped.ev.includes('mission:escaped'), 'mission:escaped dialog');
  t.equal(end.cont.state, 'lost', 'Continue: objectives not done within 15 s → loss');
  t(end.cont.after >= 15 && end.cont.after < 15.2, `loss at 15 s (${end.cont.after})`);
  t.equal(end.won.state, 'won', 'win when the objective is done and everyone escaped');
  t.equal(end.won.flow, 'debrief', 'flow → debrief on win');
  t(end.won.won && end.won.won.reason === 'MISSION COMPLETED', 'MISSION COMPLETED');
  t(end.won.won && end.won.won.stars && end.won.won.stars.time === 3, 'time stars in the payload (100 s ≤ par 300 s)');
  t(end.won.won && typeof end.won.won.rank === 'string', 'rank in the payload');
}
