/**
 * MUSIC in the running game (src/audio/music-director.js, assets/audio/music): the menu plays the recorded menu theme
 * (never a synth placeholder); M1 start → start stinger + the tension bed; the alarm brings the alert layer in;
 * Options "Classic 1998" removes in-mission music. Screenshot: music-score (audio debug overlay).
 * Memory (audio footprint pass): the score is streamed — chunk by chunk (audio/music-stream.js), never a whole cue
 * decoded: a few MB of PCM for the bed, the tension chain and the alert layer together.
 */
/** Decoded music PCM right now (bytes) and the longest decoded music buffer (s): every cached cue's chunks. */
const musicPcm = () => {
  const d = window.__game.game.audio.musicDir;
  let bytes = 0, longest = 0;
  const cues = new Set([...(d.ready?.values() || [])].map((r) => r.stream).filter(Boolean));
  for (const h of d.handles) if (h.stream) cues.add(h.stream.cue);
  for (const c of cues) for (const b of c.decoded.values()) { bytes += b.length * b.numberOfChannels * 4; longest = Math.max(longest, b.duration); }
  const whole = [...(d.ready?.values() || [])].filter((r) => r.buffer).map((r) => r.id);
  return { bytes, longest, whole };
};
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
    const h = [...a.musicDir.handles].find((x) => x.id === 'menu' && !x.ended);
    const cue = h?.stream?.cue;
    const chunk = cue && [...cue.decoded.values()][0];
    return { ok: !!d && d.playing.includes('menu') && !!cue && !!chunk && h.stream.live.size > 0, playing: d?.playing, dur: cue?.duration,
      sr: chunk?.sampleRate, chunks: cue?.chunks.length, files: a.engine?.files.get('menu'), meta: a.engine?.musicMeta.get('menu') };
  });
  t.log(JSON.stringify(menu));
  t.ok(menu.ok, `menu bed streaming (${menu.playing})`);
  t.ok(menu.dur > 150, `menu is the recorded theme (${menu.dur?.toFixed(1)} s in ${menu.chunks} chunks @ ${menu.sr} Hz), not a synth placeholder`);
  t.equal(menu.sr, menu.meta?.decodeRate, 'chunks decode at the cue\'s decodeRate');
  t.ok(menu.meta?.loopEnd > menu.meta?.loopStart, 'loop points from the manifest');
  const pcm0 = await page.evaluate(musicPcm);
  t.log(`menu PCM ${JSON.stringify(pcm0)}`);
  t.ok(pcm0.bytes < 8e6 && pcm0.longest < 13 && !pcm0.whole.length, `menu streamed: ${(pcm0.bytes / 1e6).toFixed(1)} MB decoded, longest buffer ${pcm0.longest.toFixed(1)} s`);

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
  await page.waitForTimeout(1500);
  const pcm1 = await page.evaluate(musicPcm);
  t.log(`mission PCM ${JSON.stringify(pcm1)}`);
  t.ok(pcm1.bytes < 20e6 && pcm1.longest < 13 && !pcm1.whole.length,
    `score streamed (tension + alert + next segment): ${(pcm1.bytes / 1e6).toFixed(1)} MB decoded, longest buffer ${pcm1.longest.toFixed(1)} s`);
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
