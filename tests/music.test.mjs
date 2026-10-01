/**
 * MUSIC in the running game (src/audio/music-director.js, assets/audio/music): the menu plays the recorded menu theme
 * (never a synth placeholder); M1 start → start stinger + the tension bed; the alarm brings the alert layer in;
 * Options "Classic 1998" removes in-mission music. Screenshot: music-score (audio debug overlay).
 */
export default async function music(page, t) {
  await page.keyboard.press('Shift'); // first gesture → AudioContext
  const poll = async (fn, ms = 15000) => {
    const t0 = Date.now();
    let v = null;
    while (Date.now() - t0 < ms) { v = await page.evaluate(fn); if (v?.ok) return v; await page.waitForTimeout(200); }
    return v;
  };
  const menu = await poll(async () => {
    const a = window.__game.game.audio;
    await a.engine?.ready;
    a.music('menu');
    const d = a.musicDir?.debug();
    const buf = a.musicDir?.ready?.get('menu')?.buffer;
    return { ok: !!d && d.playing.includes('menu') && !!buf, playing: d?.playing, dur: buf?.duration, sr: buf?.sampleRate,
      files: a.engine?.files.get('menu'), meta: a.engine?.musicMeta.get('menu') };
  });
  t.log(JSON.stringify(menu));
  t.ok(menu.ok, `menu bed playing (${menu.playing})`);
  t.ok(menu.dur > 150, `menu is the recorded theme (${menu.dur?.toFixed(1)} s @ ${menu.sr} Hz), not a synth placeholder`);
  t.ok(menu.meta?.loopEnd > menu.meta?.loopStart, 'loop points from the manifest');

  // menu → briefing: game:state 'briefing' picks briefing_N; briefing.js then asks for 'theme' — that must keep the
  // briefing bed (it used to map to 'menu', which was dropped, re-decoded and restarted, and the briefing never played)
  const brief = await poll(async () => {
    const g = window.__game, a = g.game.audio;
    if (a.gameState !== 'briefing') { g.game.events.emit('game:state', { from: a.gameState, to: 'briefing' }); a.music('theme'); }
    const d = a.musicDir.debug();
    return { ok: /^briefing_\d$/.test(d.bed) && d.playing.some((id) => /^briefing_\d$/.test(id)), bed: d.bed, track: a.track,
      playing: d.playing, refused: a.log.filter((l) => l.type === 'music').slice(-4).map((l) => l.name) };
  });
  t.log(JSON.stringify(brief));
  t.ok(brief.ok, `briefing bed plays after the briefing's music('theme') (bed ${brief.bed}, playing ${brief.playing})`);

  await page.evaluate(async () => { const g = window.__game; await g.loadMission('m01'); g.start(); });
  const start = await poll(() => {
    const a = window.__game.game.audio, d = a.musicDir.debug();
    return { ok: d.state === 'mission' && d.playing.includes('mission_tension_a'), state: d.state, playing: d.playing,
      history: d.history, music: a.debug().music, log: a.log.filter((l) => l.type === 'music').slice(-6).map((l) => l.name) };
  }, 20000);
  t.log(JSON.stringify(start));
  t.ok(start.ok, 'M1 start → tension bed scheduled/playing');
  t.equal(start.music, 'mission');
  t.ok(start.log.some((n) => /^start_\d$/.test(n)), 'start stinger requested');

  const alert = await poll(() => {
    const g = window.__game, w = g.game.world, a = g.game.audio;
    if (!w.alarm.active) { const e = w.enemies[0]; w.alarm.raise('global', 'test', e.x, e.z); g.advance(0.1); a.update(); }
    a.update();
    const d = a.musicDir.debug();
    return { ok: d.alert && d.playing.includes('mission_alert'), alert: d.alert, threat: d.threat, playing: d.playing, gains: d.gains };
  }, 20000);
  t.log(JSON.stringify(alert));
  t.ok(alert.ok, 'alarm → alert layer');
  await page.evaluate(async () => {
    const a = window.__game.game.audio;
    window.__audioPanel = (await import('/src/audio/debug-panel.js')).createAudioDebugPanel(a);
  });
  await page.waitForTimeout(300);
  await t.shot('music-score');

  const classic = await page.evaluate(async () => {
    const a = window.__game.game.audio;
    a.setOption('missionMusic', false);
    await new Promise((r) => setTimeout(r, 2200));
    const d = a.musicDir.debug();
    const res = { state: d.state, music: a.debug().music, playing: d.playing };
    a.setOption('missionMusic', true);
    const back = a.musicDir.debug().state;
    window.__audioPanel?.dispose();
    return { ...res, back };
  });
  t.log(JSON.stringify(classic));
  t.equal(classic.state, 'idle', 'Classic 1998 → no mission music');
  t.equal(classic.music, null);
  t.ok(!classic.playing.some((id) => /^mission_/.test(id)), `no score sources left (${classic.playing})`);
  t.equal(classic.back, 'mission', 'Suspense again resumes the score');
}
