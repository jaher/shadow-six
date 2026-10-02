/**
 * Knife from a crawl (user request 2026-10-01: "When clicking a soldier to kill when using the knife and crawling we
 * should not stand up right away, only when we get close to the soldier it stands up before stabbing it"): M1, the
 * opening sentry e6 alone, facing north on his post; the Green Beret lies 7 m behind him and is given one knife click.
 * Every 0.1 s: he stays prone and plays the crawl until he is within reach + crawlStandLead, then stands up (0.6 s,
 * no movement), steps in and stabs — the guard dies, never aware, no alarm.
 */
export const timeout = 150_000; // 160 sampled 0.1 s steps with renders: slow under load

export default async function knifeCrawl(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m01');
    const w = G.world;
    const guard = w.enemies.find((e) => e.tag === 'e6' || e.id === 'e6' || e.spawn?.id === 'e6');
    for (const e of [...w.enemies]) if (e !== guard) w.remove(e);
    for (const v of [...w.vehicles]) if (v.crew?.some?.((c) => c.kind === 'enemy')) w.remove(v);
    const H = -Math.PI / 2; // faces -z (north)
    guard.setPosition(guard.x, guard.z, H);
    Object.assign(guard.post, { x: guard.x, z: guard.z, heading: H, sweep: 0, scan: null });
    if (guard.route) guard.route = null;
    const gb = w.commandos.find((c) => c.role === 'greenberet');
    for (const c of w.commandos) if (c !== gb) c.setPosition(c.x + 30, c.z, c.heading); // out of the shot
    gb.setPosition(guard.x, guard.z + 7, H);
    g.start();
    gb.setStance('crawl'); gb._stanceT = 0;
    G.input.select?.([gb]);
    g.setZoom(1.6);
    g.centerOn(guard.x, guard.z + 3);
    for (let i = 0; i < 30; i++) { g.advance(1 / 60); G.render(1 / 60, 1); }
    const C = window.__CONFIG || (await import('/src/config.js')).CONFIG;
    const standAt = C.abilities.knife.reach + C.abilities.crawlStandLead;
    const ok = g.useAbility(gb.id, 'knife', guard.id);
    const rows = [];
    let killedAt = null, maxAlert = 0;
    const t0 = w.time;
    for (let i = 0; i < 160 && killedAt == null; i++) {
      for (let k = 0; k < 6; k++) { g.advance(1 / 60); G.render(1 / 60, 1); }
      if (guard.alive) maxAlert = Math.max(maxAlert, guard.alertLevel || 0);
      rows.push({ t: +(w.time - t0).toFixed(2), d: +Math.hypot(guard.x - gb.x, guard.z - gb.z).toFixed(2), stance: gb.stance,
        up: gb._stanceT > 0, clip: gb.model?.clip ?? null, act: gb.currentActionId, x: +gb.x.toFixed(3), z: +gb.z.toFixed(3) });
      if (!guard.alive) killedAt = w.time - t0;
    }
    for (let i = 0; i < 30; i++) { g.advance(1 / 60); G.render(1 / 60, 1); }
    return { ok, standAt, killedAt, maxAlert, alarm: !!w.alarm?.active, cause: guard.deathCause, rows, stance0: rows[0]?.stance };
  });
  t.log(JSON.stringify({ ...r, rows: r.rows.map((q) => `${q.t}:${q.d}:${q.stance}${q.up ? '^' : ''}:${q.clip}:${q.act || ''}`).join(' ') }));
  t(r.ok !== false, 'knife order accepted from a crawl');
  t.equal(r.stance0, 'crawl', 'still prone right after the click');
  const firstUp = r.rows.findIndex((q) => q.stance !== 'crawl');
  t(firstUp > 5, `crawled for a while before standing (${firstUp} samples)`);
  const crawling = r.rows.slice(0, firstUp);
  t(crawling.every((q) => q.d > r.standAt - 0.15), 'never closer than the stand distance while prone');
  t(crawling.slice(2).every((q) => q.clip === 'crawl_knife'), 'crawls in knife in hand (crawl_knife): ' + [...new Set(crawling.map((q) => q.clip))].join(','));
  t(crawling[crawling.length - 1].x !== crawling[0].x || crawling[crawling.length - 1].z !== crawling[0].z, 'he moved while prone');
  const stood = r.rows[firstUp];
  t(stood.d <= r.standAt + 0.1 && stood.d > 1.2, `stood up close (${stood.d} m), outside reach`);
  const rising = r.rows.slice(firstUp, firstUp + 5);
  t(rising.every((q) => Math.hypot(q.x - stood.x, q.z - stood.z) < 1e-6), 'no step while getting up');
  t(r.rows.some((q) => q.act === 'knife'), 'the stab played');
  t(r.killedAt != null, 'guard killed');
  t.equal(r.cause, 'knife');
  t.equal(r.maxAlert, 0, 'guard never became aware');
  t(!r.alarm, 'no alarm');
  await t.shot('knife-crawl');
}
