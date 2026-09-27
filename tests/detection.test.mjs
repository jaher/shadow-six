/**
 * Detection (BEL cone rules): the bridge sentry (47,30) looks west over the bridge.
 *  A) A commando walking upright into the cone is spotted: the sentry alerts and opens fire.
 *  B) A commando crawling inside the FAR zone (beyond nearRange) is never spotted.
 * Every other enemy is removed so only the sentry can react.
 */
async function setup(page, stance, from, to) {
  return page.evaluate(async ({ stance, from, to }) => {
    const g = window.__game;
    await g.loadMission('m00');
    const w = g.game.world;
    for (const e of [...w.enemies]) if (e.tag !== 'sentry_bridge') w.remove(e);
    for (const c of [...w.commandos]) if (c.role !== 'greenberet') w.remove(c);
    const gb = w.commandos[0];
    gb.setPosition(from.x, from.z, 0);
    g.start();
    if (stance !== 'stand') { g.order(gb.id, { type: 'stance', stance }); g.advance(0.5); }
    g.order(gb.id, { type: 'move', x: to.x, z: to.z, run: false });
    g.setCone('sentry_bridge', true);
    return { gbId: gb.id, hp0: gb.hp };
  }, { stance, from, to });
}

async function watch(page, seconds) {
  return page.evaluate(async (seconds) => {
    const g = window.__game;
    const w = g.game.world;
    const { coneZone } = await import('./src/ai/perception.js');
    const s = w.enemies.find((e) => e.tag === 'sentry_bridge');
    const gb = w.commandos[0];
    const zones = { near: 0, far: 0, none: 0 };
    let shots = 0;
    const off = w.events.on('shot', () => shots++);
    let maxAlert = 0;
    const states = new Set();
    for (let i = 0; i < seconds * 10; i++) {
      g.advance(0.1);
      if (gb.alive) zones[coneZone(s, gb.x, gb.z) || 'none']++;
      maxAlert = Math.max(maxAlert, s.alertLevel || 0);
      states.add(s.brainState);
    }
    off?.();
    g.centerOn(s.x - 8, s.z);
    return { zones, shots, maxAlert, states: [...states], alarm: !!w.alarm?.active, hp: gb.hp, alive: gb.alive, stance: gb.stance, x: gb.x, z: gb.z };
  }, seconds);
}

export default async function detection(page, t) {
  // A) upright walk from out of range into the cone
  const a0 = await setup(page, 'stand', { x: 22, z: 30 }, { x: 38, z: 30 });
  const a = await watch(page, 12);
  t.log('walk:', JSON.stringify(a));
  t(a.zones.far + a.zones.near > 0, 'walker entered the cone');
  t(a.maxAlert > 0, 'sentry alerted');
  t(a.states.some((s) => s !== 'post' && s !== 'patrol' && s !== 'idle'), `sentry left its idle state (${a.states})`);
  t(a.shots > 0 || a.hp < a0.hp0, `sentry opened fire (shots ${a.shots}, hp ${a.hp})`);
  await t.shot('detection-walk');

  // B) crawl inside the far band only (design-spec §4.2 soldier profile: near 18 m, far 36 m)
  const b0 = await setup(page, 'crawl', { x: 25, z: 30 }, { x: 28, z: 30 });
  const b = await watch(page, 12);
  t.log('crawl:', JSON.stringify(b));
  t.equal(b.stance, 'crawl', 'commando is crawling');
  t(b.zones.far > 0 && b.zones.near === 0, `crawler stayed in far zone (${JSON.stringify(b.zones)})`);
  t.equal(b.maxAlert, 0, 'sentry never alerted');
  t.equal(b.shots, 0, 'no shots fired');
  t.equal(b.hp, b0.hp0, 'crawler unharmed');
  t(!b.alarm, 'no alarm');
  await t.shot('detection-crawl');
}
