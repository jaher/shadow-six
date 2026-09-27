/**
 * Save/load has no gameplay side effects: loading a save must not re-run destructions (explosion,
 * alarm, noise, messages) nor let guards re-report bodies they already found.
 */
export default async function saveload(page, t) {
  const destroyed = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    const G = g.game;
    let w = G.world;
    g.start();
    const tgt = w.interactables.find((i) => i.destructible && i.owner);
    if (!tgt) return null;
    tgt.takeDamage(1e6, null, 'explosion');
    g.advance(200); // alarm expires
    const before = { alarms: w.stats.alarms, active: !!w.alarm.active };
    G.quickSave();
    const ev = [];
    for (const k of ['explosion', 'alarm:start', 'noise']) G.events.on(k, () => ev.push(k));
    await G.quickLoad();
    w = G.world;
    const t2 = w.interactables.find((i) => i.tag === tgt.tag);
    return { before, after: { alarms: w.stats.alarms, active: !!w.alarm.active }, ev, destroyed: !!t2?.destroyed };
  });
  t(destroyed, 'mission has a destructible target');
  t.log(JSON.stringify(destroyed));
  t.equal(destroyed.after.alarms, destroyed.before.alarms, 'load keeps stats.alarms');
  t.equal(destroyed.after.active, false, 'load does not raise the alarm');
  t.equal(destroyed.ev.length, 0, 'no explosion/alarm/noise events during load');
  t(destroyed.destroyed, 'target is still destroyed after load');

  const body = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    const G = g.game;
    let w = G.world;
    g.start();
    const gb = w.commandos.find((c) => c.role === 'greenberet');
    const en0 = w.enemies.find((e) => !e.route);
    const en1 = w.enemies.find((e) => e !== en0);
    const id0 = en0.id;
    const id1 = en1.id;
    // out of every cone (in a building): guards whose N still lingers after the kill would otherwise fight them (§4.5)
    for (const c of w.commandos) { c.setPosition(2 + c.id, 2, 0); c.hidden = true; }
    en1.route = null;
    en1.brain.state = 'guard';
    en1.post = { x: en0.x + Math.cos(en0.heading) * 3, z: en0.z + Math.sin(en0.heading) * 3, heading: 0, scan: null, scanPeriod: 3 };
    en1.setPosition(en1.post.x, en1.post.z, 0);
    en1.die('knife', gb);
    g.advance(1);
    const found = w.stats.alarms;
    g.advance(60);
    G.quickSave();
    const saved = w.stats.alarms;
    await G.quickLoad();
    G.pause(false);
    w = G.world;
    const noticed = !!w.byId(id1)?.bodyNoticed;
    g.advance(10);
    return { found, saved, after: w.stats.alarms, active: !!w.alarm.active, st: w.byId(id0).brainState, noticed };
  });
  t.log(JSON.stringify(body));
  t(body.found >= 1, 'guard found the body');
  t(body.noticed, 'bodyNoticed survives the load');
  t.equal(body.after, body.saved, 'reloading next to a reported body adds no alarm');
  t.equal(body.active, false, 'no alarm after reload');
}
