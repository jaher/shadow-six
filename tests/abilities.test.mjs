/**
 * ABILITIES behaviour tests #8–#12 (design-spec §10.5) in the real game (sandbox map, placeholder brains):
 *   #8 time bomb explodes at 10.0 s · #9 first aid +34 per dose, 6 doses · #10 three pistol hits kill, two do not ·
 *   #11 knife from behind is silent: a guard 2 m away with his back turned does not react ·
 *   #12 a disguised Spy walks past a guard unchallenged; injecting in view unmasks him.
 */
async function load(page, commandos, enemies, extra = {}) {
  await page.evaluate(async ({ commandos, enemies, extra }) => {
    const g = window.__game;
    const { MISSIONS } = await import('./src/missions/index.js');
    const base = MISSIONS.find((m) => m.id === 'm00');
    await g.loadMission({ ...base, id: 'm00_abil', commandos, enemies, ...extra });
    g.start();
    const w = g.game.world;
    window.__ev = [];
    for (const n of ['noise', 'bomb:armed', 'bomb:exploded', 'enemy:spotted', 'enemy:unmasked-spy', 'unit:killed']) {
      w.listen(n, (p) => window.__ev.push({ n, t: w.time, kind: p.kind, level: p.level, src: p.source?.kind ?? null }));
    }
  }, { commandos, enemies, extra });
}

export default async function abilities(page, t) {
  const H = Math.PI / 2;
  // ---- #8 time bomb + #9 first aid
  await load(page, [{ role: 'sapper', x: 10, z: 20, heading: 0, inventory: { timeBomb: 1 } }, { role: 'driver', x: 12, z: 22 }], [],
    { interactables: [{ kind: 'barrel', id: 'b1', x: 13, z: 20 }, { kind: 'barrel', id: 'b2', x: 18, z: 20 }] });
  const r8 = await page.evaluate(() => {
    const g = window.__game, w = g.game.world;
    const sp = w.commandos.find((c) => c.role === 'sapper'), dr = w.commandos.find((c) => c.role === 'driver');
    g.useAbility(sp.id, 'timeBomb', sp.id);
    g.advance(1.2);
    g.order(sp.id, { type: 'move', x: 10, z: 34, run: true });
    g.order(dr.id, { type: 'move', x: 12, z: 36, run: true });
    g.advance(9.5);
    g.centerOn(10, 26); g.setZoom(0.45); g.render();
    const before = window.__ev.filter((e) => e.n === 'bomb:exploded').length;
    g.advance(0.7);
    g.render();
    const armed = window.__ev.find((e) => e.n === 'bomb:armed'), boom = window.__ev.find((e) => e.n === 'bomb:exploded');
    return { fuse: boom && armed ? boom.t - armed.t : null, before, barrels: ['b1', 'b2'].map((id) => !w.byId(id) || !!w.byId(id).exploded) };
  });
  await t.shot('abilities-timebomb-chain');
  const r9 = await page.evaluate(() => {
    const g = window.__game, w = g.game.world;
    const sp = w.commandos.find((c) => c.role === 'sapper'), dr = w.commandos.find((c) => c.role === 'driver');
    sp.hp = 30;
    const hp = [];
    for (let k = 0; k < 7; k++) { g.useAbility(dr.id, 'firstAid', sp.id); g.advance(2.5); hp.push(sp.hp); sp.hp = Math.min(sp.hp, 30); }
    return { hp, doses: dr.inventory.get('firstAid') ?? 0 };
  });
  t.log(JSON.stringify(r8), JSON.stringify(r9));
  t(r8.barrels.every(Boolean), '§3.6 the bomb set off both barrels (chain)');
  t(r8.fuse != null && Math.abs(r8.fuse - 10) <= 1e-6, `#8 time bomb exploded ${r8.fuse?.toFixed(3)} s after release`);
  t.equal(r8.before, 0, '#8 not before 10 s');
  t.equal(JSON.stringify(r9.hp.slice(0, 6)), JSON.stringify([64, 64, 64, 64, 64, 64]), '#9 +34 HP per dose');
  t.equal(r9.hp[6], 30, '#9 no 7th dose');
  t.equal(r9.doses, 0, '#9 six doses');

  // ---- #10 pistol
  await load(page, [{ role: 'greenberet', x: 10, z: 20, heading: 0 }], [{ id: 'g1', soldierType: 'soldier', x: 20, z: 20, heading: 0 }]);
  const r10 = await page.evaluate(() => {
    const g = window.__game, w = g.game.world;
    const gb = w.commandos[0], e = w.byId('g1');
    const hp = [];
    for (let k = 0; k < 3; k++) { g.useAbility(gb.id, 'pistol', 'g1'); g.advance(0.6); hp.push(e.alive ? e.hp : 0); }
    return { hp, noise: window.__ev.filter((x) => x.n === 'noise' && x.kind === 'pistol' && x.src === 'commando').length };
  });
  t.log(JSON.stringify(r10));
  t(r10.hp[1] > 0, '#10 two hits do not kill');
  t.equal(r10.hp[2], 0, '#10 three hits kill');
  t.equal(r10.noise, 3, '#10 each shot is a pistol noise');

  // ---- #11 knife from behind
  await load(page, [{ role: 'greenberet', x: 8, z: 20, heading: 0 }], [
    { id: 'victim', soldierType: 'soldier', x: 14, z: 20, heading: 0, post: { heading: 0, sweep: 0 } },
    { id: 'buddy', soldierType: 'soldier', x: 16, z: 20, heading: 0, post: { heading: 0, sweep: 0 } },
  ]);
  const r11 = await page.evaluate(() => {
    const g = window.__game, w = g.game.world;
    const gb = w.commandos[0], v = w.byId('victim'), b = w.byId('buddy');
    const st0 = b.brainState;
    g.useAbility(gb.id, 'knife', 'victim');
    let maxAlert = 0;
    for (let k = 0; k < 60 && v.alive; k++) { g.advance(0.1); maxAlert = Math.max(maxAlert, b.alertLevel || 0); }
    for (let k = 0; k < 30; k++) { g.advance(0.1); maxAlert = Math.max(maxAlert, b.alertLevel || 0); }
    return { dead: !v.alive, cause: v.deathCause, noises: window.__ev.filter((e) => e.n === 'noise').length, maxAlert, st0, st1: b.brainState, spotted: window.__ev.filter((e) => e.n === 'enemy:spotted').length, gap: Math.hypot(b.x - v.x, b.z - v.z) };
  });
  t.log(JSON.stringify(r11));
  t(r11.dead && r11.cause === 'knife', '#11 knifed');
  t.equal(r11.noises, 0, '#11 silent (no noise event)');
  t.equal(r11.maxAlert, 0, '#11 guard 2 m away never alerted');
  t.equal(r11.st1, r11.st0, '#11 guard keeps his state');
  t.equal(r11.spotted, 0, '#11 nobody spotted the Green Beret');

  // ---- #12 disguised Spy
  await load(page, [{ role: 'spy', x: 6, z: 20, heading: 0 }], [
    { id: 'watch', soldierType: 'soldier', x: 28, z: 19, heading: Math.PI, post: { heading: Math.PI, sweep: 0 } },
    { id: 'mark', soldierType: 'soldier', x: 17, z: 20, heading: H, post: { heading: H, sweep: 0 } },
  ], { startDisguised: ['spy'] });
  const r12 = await page.evaluate(() => {
    const g = window.__game, w = g.game.world;
    const spy = w.commandos[0], watch = w.byId('watch');
    g.setCone(watch.id, true);
    const disguised0 = spy.disguised;
    g.order(spy.id, { type: 'move', x: 14, z: 21 });
    let maxAlert = 0;
    for (let k = 0; k < 60; k++) { g.advance(0.1); maxAlert = Math.max(maxAlert, watch.alertLevel || 0); }
    const pass = { maxAlert, spotted: window.__ev.filter((e) => e.n === 'enemy:spotted').length, disguised: spy.disguised };
    g.centerOn(20, 20); g.setZoom(0.35); g.render();
    g.useAbility(spy.id, 'syringe', 'mark');
    for (let k = 0; k < 40 && w.byId('mark').alive; k++) g.advance(0.1);
    g.advance(0.2);
    return { disguised0, pass, markDead: !w.byId('mark').alive, after: spy.disguised, uniform: spy.inventory.get('uniform') ?? 0, unmasked: window.__ev.filter((e) => e.n === 'enemy:unmasked-spy').length, nerv: watch.nervousness };
  });
  t.log(JSON.stringify(r12));
  t(r12.disguised0, '#12 Spy starts disguised (startDisguised)');
  t.equal(r12.pass.maxAlert, 0, '#12 walks past unchallenged');
  t.equal(r12.pass.spotted, 0, '#12 not spotted');
  t(r12.pass.disguised, '#12 still disguised after walking past');
  t(r12.markDead, '#12 injected');
  t(!r12.after && r12.uniform === 1, '#12 injecting in view unmasks him (uniform back in the knapsack)');
  t(r12.unmasked >= 1, '#12 enemy:unmasked-spy');
  await t.shot('abilities-spy-unmasked');
}
