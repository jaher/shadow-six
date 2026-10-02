/**
 * MISSION SELECT → MISSION LOAD MUSIC (STYLE §2.5): choosing a pin on the campaign map never passes through the menu
 * theme (the table closing for a launch must not send the flow back to 'title'); the theater theme fades on the load,
 * the briefing loop follows. '(S)TART WITHOUT BRIEFING' goes the same way, with no briefing loop, then the stinger:
 * cold (the loading card waits on PRESS ANY KEY) and warm (feat/instant-restart: a mission still in the session asset
 * cache skips the card — a short fade, straight into play).
 */
const HUD = 'window.__game.game.hud';

export default async function musicSelect(page, t) {
  await page.keyboard.press('Shift'); // first gesture → AudioContext
  const poll = async (fn, ms = 20000, arg = null) => {
    const t0 = Date.now();
    let v = null;
    while (Date.now() - t0 < ms) { v = await page.evaluate(fn, arg); if (v?.ok) return v; await page.waitForTimeout(150); }
    return v;
  };
  // flow trace + every music-bus voice sampled every 100 ms (beds that start and fade between two polls count too)
  await page.evaluate(async () => {
    const g = window.__game.game;
    await g.audio.engine?.ready;
    window.__mt = { flow: [], heard: new Set(), timer: 0 };
    g.events.on('flow:state', (e) => window.__mt.flow.push(e.to));
    window.__mt.timer = setInterval(() => { for (const id of g.audio.musicDir?.debug().playing || []) window.__mt.heard.add(id); }, 100);
  });
  const openMap = async () => {
    await page.evaluate(`${HUD}.kit.close(); ${HUD}.screens.openMain(); ${HUD}.screens.openBEL(); ${HUD}.kit.activate(${HUD}.kit.top.rows.findIndex((r) => /MISSION SELECT/.test(r.label)))`);
    const v = await poll(() => {
      const g = window.__game.game, d = g.audio.musicDir.debug();
      return { ok: g.flow.state === 'select' && d.bed === 'campaign_norway' && d.playing.includes('campaign_norway'), state: g.flow.state, bed: d.bed, playing: d.playing };
    });
    t.ok(v.ok, `the campaign map plays the Norway theme (${JSON.stringify(v)})`);
    return page.evaluate(() => { window.__mt.flow = []; window.__mt.heard = new Set(); return window.__game.game.audio.log.length; });
  };
  const after = (mark) => page.evaluate((mark) => ({
    asked: window.__game.game.audio.log.slice(mark).filter((l) => l.type === 'music').map((l) => l.name),
    flow: [...window.__mt.flow], heard: [...window.__mt.heard],
  }), mark);

  // ---- pin → (B)RIEFING: Norway fades on the load, briefing_1 follows; never the menu ----
  let mark = await openMap();
  await page.keyboard.press('Enter'); // the focused pin (M1, 'next')
  const fade = await poll(() => {
    const a = window.__game.game.audio, d = a.musicDir.debug();
    return { ok: a.track === null || d.bed === 'briefing_1', track: a.track, bed: d.bed };
  }, 8000);
  t.ok(fade.ok, `the theater theme is released for the load (${JSON.stringify(fade)})`);
  const brief = await poll(() => {
    const g = window.__game.game, d = g.audio.musicDir.debug();
    return { ok: g.flow.state === 'briefing' && !g.hud.loading.active && d.bed === 'briefing_1' && d.playing.includes('briefing_1'), state: g.flow.state, bed: d.bed, playing: d.playing };
  }, 40000);
  t.ok(brief.ok, `M1 briefing loop after the load (${JSON.stringify(brief)})`);
  let tr = await after(mark);
  t.log(JSON.stringify(tr));
  t.ok(!tr.flow.includes('title'), `flow select → briefing without 'title' (${tr.flow})`);
  t.ok(!tr.asked.includes('menu'), `no 'menu' cue between select and briefing (${tr.asked})`);
  t.ok(!tr.heard.includes('menu'), `the menu theme is never heard on the way (${tr.heard})`);

  // ---- (S)TART WITHOUT BRIEFING, cold: no menu, no briefing loop, then the start stinger ----
  // M1 is still in the session asset cache from the leg above (a warm load skips the card, see the warm leg below):
  // Options → CLEAR CACHED GAME DATA at the title makes this one a cold load again
  await page.evaluate(`${HUD}.quitToTitle()`);
  const cleared = await page.evaluate(async () => {
    const g = window.__game.game;
    await window.__game.cache.clear({ keepMission: g.hud.world ? g.missionDef?.id ?? null : null });
    return { world: !!g.hud.world, missions: window.__game.cache.stats().missions };
  });
  t.ok(!cleared.missions.includes('m01'), `cache cleared: M1 loads cold (${JSON.stringify(cleared)})`);
  mark = await openMap();
  await page.keyboard.press('KeyS');
  const loaded = await poll(() => {
    const g = window.__game.game;
    const prompt = [...document.querySelectorAll('.mk-press')].some((e) => /PRESS ANY KEY/.test(e.textContent));
    return { ok: g.flow.state === 'briefing' && g.hud.loading.active && prompt, state: g.flow.state, active: g.hud.loading.active, prompt,
      gs: g.state, flow: window.__mt.flow.join(',') };
  }, 40000);
  t.ok(loaded.ok, `direct start: loaded, waiting on the loading screen (${JSON.stringify(loaded)})`);
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  const started = await poll(() => {
    const g = window.__game.game, d = g.audio.musicDir.debug();
    return { ok: g.state === 'playing' && d.playing.some((id) => /^start_/.test(id)), state: g.state, playing: d.playing };
  }, 15000);
  t.ok(started.ok, `direct start: the start stinger plays (${JSON.stringify(started)})`);
  tr = await after(mark);
  t.log(JSON.stringify(tr));
  t.ok(!tr.flow.includes('title'), `direct start: flow never visits 'title' (${tr.flow})`);
  t.ok(!tr.asked.includes('menu') && !tr.heard.includes('menu'), `direct start: no menu theme (${tr.asked} / ${tr.heard})`);
  t.ok(!tr.heard.some((id) => /^briefing_/.test(id)), `direct start: no briefing loop is heard (${tr.heard})`);

  // ---- (S)TART WITHOUT BRIEFING, warm (M1 in the session cache): no card, no key prompt, straight to the stinger ----
  await page.evaluate(`${HUD}.quitToTitle()`);
  mark = await openMap();
  await page.keyboard.press('KeyS');
  const warm = await poll(() => {
    const g = window.__game.game, d = g.audio.musicDir.debug();
    return { ok: g.state === 'playing' && !g.hud.loading.active && d.playing.some((id) => /^start_/.test(id)), state: g.state,
      active: g.hud.loading.active, last: g.hud.loading.lastRun, playing: d.playing };
  }, 20000);
  t.ok(warm.ok, `warm direct start: straight into play with the start stinger (${JSON.stringify(warm)})`);
  t.ok(warm.last?.warm && !warm.last?.card, `warm direct start: no loading card (${JSON.stringify(warm.last)})`);
  tr = await after(mark);
  t.log(JSON.stringify(tr));
  t.ok(!tr.flow.includes('title'), `warm direct start: flow never visits 'title' (${tr.flow})`);
  t.ok(!tr.asked.includes('menu') && !tr.heard.includes('menu'), `warm direct start: no menu theme (${tr.asked} / ${tr.heard})`);
  t.ok(!tr.heard.some((id) => /^briefing_/.test(id)), `warm direct start: no briefing loop is heard (${tr.heard})`);
  await page.evaluate(() => clearInterval(window.__mt.timer));
}
