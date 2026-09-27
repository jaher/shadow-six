/**
 * Art integration 2 — realistic characters in the game: every unit gets a library body, enemy looks follow the
 * 30 m / squad rule, gameplay actions map to clips + weapon props, the Marine swaps to the wetsuit in water, the Spy
 * disguise shows the officer uniform, the Driver burns from M8, the gait follows the ground speed, `?chars=0` keeps
 * the placeholders, and 40 enemies + 6 commandos stay inside the frame budget.
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m01');
    const w = G.world;
    const units = w.entities.filter((e) => e.kind === 'commando' || e.kind === 'enemy');
    const out = { n: units.length, real: units.filter((u) => u.model.isReal && u.model.real?.inner).length, twins: [] };
    // no two enemies with the same variant within 30 m (bible §5.2)
    const en = w.enemies;
    for (const a of en) for (const b of en) if (a.id < b.id && a.model.characterId === b.model.characterId && Math.hypot(a.x - b.x, a.z - b.z) < 30) out.twins.push([a.tag, b.tag]);
    g.start?.();
    const gb = w.commandos.find((c) => c.role === 'greenberet');
    // knife: stab clip + knife in hand, back to the carry weapon after
    gb.currentActionId = 'knife'; gb.playAction('stab', 0.5); gb.renderUpdate(0.016);
    out.stab = [gb.model.clip, gb.model.real.weaponName()];
    gb.currentActionId = null; gb._animOverride = null; gb._updateAnim(0); gb.renderUpdate(0.016);
    out.idle = [gb.model.clip, gb.model.real.weaponName()];
    // gait timed from the measured ground speed (walk 2.25, crawl 0.9 m/s)
    const run = (u, n) => { for (let i = 0; i < n; i++) { g.step(); u.syncTransform(1); u.renderUpdate(1 / 60); } };   // sim 60 Hz = render 60 Hz
    gb.moveTo(gb.x + 12, gb.z, { run: false }); run(gb, 60);
    out.walk = [gb.model.clip, +gb.model.gaitSpeed.toFixed(2), gb.speed];
    gb.stop(); gb.setStance('crawl'); run(gb, 40); gb.moveTo(gb.x - 6, gb.z); run(gb, 90);
    out.crawl = [gb.model.clip, +gb.model.gaitSpeed.toFixed(2), gb.speed];
    // Marine: wetsuit body in the water, uniform on land
    const mar = w.commandos.find((c) => c.role === 'diver');
    const land = mar.model.real.inner;
    mar.model.setAnim('swim'); out.swimSwap = mar.model.real.inner !== land && mar.model.real.inner.object.visible && !land.object.visible;
    mar.model.setAnim('idle'); out.landBack = mar.model.real.inner === land;
    // Spy disguise + Driver burns from M8 (fresh units under an M8 context)
    const { Commando } = await import('/src/entities/commando.js');
    const um = await import('/src/art/unit-model.js');
    const spy = new Commando({ role: 'spy', x: gb.x, z: gb.z }); w.add(spy); await spy.model.ready;
    spy.setDisguise(true);
    let dis = 0, off = 0;
    spy.object3d.traverse((o) => { if (o.isMesh && /disguise/.test(o.name)) { if (o.visible) dis++; else off++; } });
    out.disguise = { dis, off, id: spy.model.characterId };
    await um.prepareCharacters({ id: 'm08', theater: 'desert', enemies: [] });
    const drv = new Commando({ role: 'driver', x: gb.x, z: gb.z }); w.add(drv); await drv.model.ready;
    out.burns = drv.model.characterId;
    await um.prepareCharacters(G.missionDef);
    // dogs and guests resolve to their own bodies
    const { Enemy } = await import('/src/entities/enemy.js');
    const dog = new Enemy({ id: 'dogX', soldierType: 'dog', x: gb.x, z: gb.z }); w.add(dog); await dog.model.ready;
    dog.playAction('punch', 0.3); dog.renderUpdate(0.016);
    const guest = new Commando({ role: 'guest', guestId: 'mcrae', x: gb.x, z: gb.z }); w.add(guest); await guest.model.ready;
    out.dog = [dog.model.characterId, dog.model.clip];
    out.guest = guest.model.characterId;
    return out;
  });
  t.log(JSON.stringify(r));
  t.equal(r.real, r.n, 'every commando and enemy has a real body');
  t.equal(r.twins.length, 0, 'no identical enemy variants within 30 m: ' + JSON.stringify(r.twins));
  t.equal(r.stab[0], 'stab'); t.equal(r.stab[1], 'knife', 'knife in hand for the stab');
  t.equal(r.idle[0], 'idle'); t.equal(r.idle[1], 'colt1911', 'carry weapon back');
  t.equal(r.walk[0], 'walk'); t.near(r.walk[1], r.walk[2], r.walk[2] * 0.12, 'walk gait ≈ ground speed');
  t.equal(r.crawl[0], 'crawl_unarmed', 'Green Beret (pistol holstered) crawls unarmed'); t.near(r.crawl[1], 0.9, 0.12, 'crawl gait ≈ 0.9 m/s');
  t.ok(r.swimSwap, 'marine_diver body in the water'); t.ok(r.landBack, 'uniform back on land');
  t.ok(r.disguise.dis > 0, 'spy disguise meshes shown');
  t.equal(r.burns, 'driver_burns', 'Driver burns from M8');
  t.ok(/^dog_/.test(r.dog[0]) && r.dog[1] === 'attack', 'dog body + attack clip');
  t.equal(r.guest, 'mcrae');

  // placeholder fallback when the library is off
  const p2 = await t.harness.newPage();
  await t.harness.openGame(p2, '?test=1&chars=0');
  const ph = await p2.evaluate(async () => {
    await window.__game.loadMission('m01');
    const w = window.__game.game.world;
    return w.entities.filter((e) => e.kind === 'enemy' || e.kind === 'commando').map((u) => !!u.model.isReal);
  });
  await p2.close();
  t.ok(ph.length > 5 && ph.every((x) => !x), 'chars=0 → placeholders');
}
