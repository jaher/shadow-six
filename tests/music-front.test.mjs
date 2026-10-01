/**
 * FULL SOUNDTRACK in the running game (assets/audio/music, src/audio/music-cues.js): the briefing plays its own loop and
 * ducks under a voice; Classic 1998 = the theater's start stinger then silence (+ ambience); success / unsuccessful
 * stingers on the end screens; the campaign map plays the focused theater's theme; the music folder stays in budget.
 */
import { readdirSync, statSync } from 'node:fs';

export default async function musicFront(page, t) {
  await page.keyboard.press('Shift'); // first gesture → AudioContext
  const poll = async (fn, ms = 20000, arg = null) => {
    const t0 = Date.now();
    let v = null;
    while (Date.now() - t0 < ms) { v = await page.evaluate(fn, arg); if (v?.ok) return v; await page.waitForTimeout(200); }
    return v;
  };

  // ---- audio assets budget (node side) ----
  const dir = new URL('../assets/audio/music/', import.meta.url);
  let total = 0;
  for (const f of readdirSync(dir)) total += statSync(new URL(f, dir)).size;
  t.ok(total < 80e6, `music folder ${(total / 1e6).toFixed(1)} MB < 80 MB`);
  t.ok(!readdirSync(dir).some((f) => /\.wav$/i.test(f)), 'no WAV masters shipped');

  // ---- campaign map theme by theater ----
  const map = await poll(async () => {
    const a = window.__game.game.audio;
    await a.engine?.ready;
    a.music('campaign_africa');
    const d = a.musicDir.debug();
    const buf = a.musicDir.ready?.get('campaign_africa')?.buffer;
    return { ok: d.bed === 'campaign_africa' && d.playing.includes('campaign_africa') && !!buf, bed: d.bed, playing: d.playing, dur: buf?.duration };
  });
  t.log(JSON.stringify(map));
  t.ok(map.ok, 'campaign map plays the North Africa theme');
  t.ok(map.dur > 70, `recorded theme (${map.dur?.toFixed(1)} s)`);

  // ---- briefing loop + duck ----
  const mark = await page.evaluate(async () => {
    const a = window.__game.game.audio, n = a.log.length;
    await window.__game.game.flow.startMission('m01');
    return n;
  });
  const brief = await poll((mark) => {
    const g = window.__game.game, a = g.audio, d = a.musicDir.debug();
    const src = [...a.musicDir.handles].find((h) => h.id === 'briefing_1' && !h.ended)?.src;
    return { ok: g.flow.state === 'briefing' && d.bed === 'briefing_1' && d.playing.includes('briefing_1') && !!src?.loop,
      state: g.flow.state, bed: d.bed, playing: d.playing, loop: src && [src.loopStart, src.loopEnd],
      asked: a.log.slice(mark).filter((l) => l.type === 'music').map((l) => l.name) };
  }, 20000, mark);
  t.log(JSON.stringify(brief));
  t.ok(brief.ok, 'M1 briefing plays briefing_1 (looping, STYLE §2.5 rotation)');
  t.ok(brief.loop && brief.loop[1] > brief.loop[0] + 60, `loop points ${brief.loop}`);
  t.ok(!brief.asked.some((n) => /^briefing_[23]$/.test(n)), `no other briefing loop flashes first (${brief.asked})`);
  const duck = await poll(() => {
    const a = window.__game.game.audio;
    if (!a.musicDir.ducked) a.playSfx('dog_bark', null, { bus: 'voice' }); // any voice-bus line ducks the bed
    a._musicTick();
    const d = a.musicDir;
    return { ok: d.ducked && Math.abs(d.duckNode.gain.value - 0.4) < 0.02, ducked: d.ducked, gain: d.duckNode.gain.value };
  }, 8000);
  t.log(JSON.stringify(duck));
  t.ok(duck.ok, 'briefing music ducks −8 dB under the voice');

  // ---- Classic 1998: start stinger, then silence ----
  await page.evaluate(() => {
    const g = window.__game.game;
    g.audio.setOption('missionMusic', false);
    g.flow.begin();
  });
  const start = await poll(() => {
    const a = window.__game.game.audio, d = a.musicDir.debug();
    const names = a.log.filter((l) => l.type === 'music').map((l) => l.name);
    return { ok: names.includes('start_1') && d.playing.includes('start_1'), state: d.state, bed: d.bed, playing: d.playing, names: names.slice(-6) };
  });
  t.log(JSON.stringify(start));
  t.ok(start.ok, 'Norway start stinger (start_1) plays at mission start');
  t.equal(start.bed, null, 'no bed in the mission');
  t.ok(!start.playing.some((id) => /^(mission_|briefing|menu|campaign)/.test(id)), `only the stinger (${start.playing})`);
  const quiet = await poll(() => {
    const a = window.__game.game.audio, d = a.musicDir.debug();
    return { ok: d.playing.length === 0, playing: d.playing, state: d.state };
  }, 30000);
  t.log(JSON.stringify(quiet));
  t.ok(quiet.ok, 'after the stinger: silence (Classic 1998)');

  // ---- success stinger ----
  const won = await poll(async () => {
    const g = window.__game.game, a = g.audio;
    if (g.state === 'playing') g._endMission(true, 'objectives complete');
    const d = a.musicDir.debug();
    return { ok: d.playing.some((id) => /^success_\d$/.test(id)), playing: d.playing, state: g.state };
  });
  t.log(JSON.stringify(won));
  t.ok(won.ok, 'success stinger on the win');
  await t.shot('music-front');

  // ---- unsuccessful stinger ----
  await page.evaluate(async () => {
    const G = window.__game;
    G.game.audio.setOption('missionMusic', true);
    await G.loadMission('m02'); G.start();
  });
  const lost = await poll(async () => {
    const g = window.__game.game, a = g.audio;
    if (g.state === 'playing') g._endMission(false, 'all commandos dead');
    const d = a.musicDir.debug();
    return { ok: d.playing.some((id) => /^fail_\d$/.test(id)) && d.state === 'ended', playing: d.playing, state: d.state };
  });
  t.log(JSON.stringify(lost));
  t.ok(lost.ok, 'unsuccessful stinger on the loss (the score stops under it)');
}
