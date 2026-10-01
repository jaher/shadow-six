/**
 * Recorded audio in the running game (realism-pipeline v2 §1.5; tools/audio/build_assets.py): manifests load,
 * each mission decodes only its own set (evicting the last), ambience beds stream through media elements,
 * German barks and commando acks play recorded takes (not the babble placeholder) with subtitles, the
 * suspense score in missions. Screenshots int-audio-m1..m3 (audio debug overlay + bark subtitle); frame cost per preset.
 */
export default async function audioAssets(page, t) {
  await page.keyboard.press('Shift'); // first gesture → AudioContext
  const rows = [];
  for (const id of ['m01', 'm02', 'm03']) {
    const r = await page.evaluate(async (mid) => {
      const g = window.__game, G = g.game, a = G.audio;
      await g.loadMission(mid);
      g.start();
      await G.mapHandle?.ready;
      await a.engine.ready;
      const t0 = performance.now();
      await a.preloading;
      const preloadMs = performance.now() - t0;
      const w = G.world;
      const guard = w.enemies.find((e) => e.alive !== false && e.soldierType !== 'dog') || w.enemies[0];
      const cmd = w.commandos[0];
      g.centerOn(guard.x, guard.z);
      g.advance(0.05);
      w.events.emit('bark', { unit: guard, line: 'ger_halt', force: true });
      const voice = [...a.engine.active].find((h) => h.bus === 'voice');
      a.say(cmd, 'ack_move', { force: true });
      const ack = [...a.engine.active].filter((h) => h.bus === 'voice').at(-1);
      w.events.emit('shot', { from: { x: guard.x + 3, z: guard.z }, shooter: guard, weapon: 'rifle', hit: false });
      const shot = [...a.engine.active].filter((h) => h.id === 'rifle_shot').at(-1);
      if (!window.__audioPanel) window.__audioPanel = (await import('/src/audio/debug-panel.js')).createAudioDebugPanel(a);
      for (let i = 0; i < 6; i++) { g.advance(1 / 60); G.render(1 / 60, 1); }
      const sr = a.engine.ctx.sampleRate;
      const rec = (h) => !!h && h.src?.buffer?.sampleRate === sr && h.src.buffer.sampleRate !== 22050;
      return { mid, preloadMs: Math.round(preloadMs), mem: a.memory, files: a.engine.files.size, theater: G.missionDef?.theater,
        guardVoice: rec(voice), guardDur: voice?.duration, ackVoice: rec(ack), shotRec: rec(shot), music: a.debug().music,
        ambience: a.debug().ambience };
    }, id);
    await page.waitForTimeout(900); // media elements buffer + start
    const s = await page.evaluate(() => {
      const a = window.__game.game.audio, d = a.debug();
      window.__audioPanel.render();
      return { streams: d.streams, active: d.active };
    });
    await t.shot(`int-audio-${id}`);
    rows.push({ ...r, ...s });
    t.log(JSON.stringify({ ...r, ...s }));
    t.ok(r.files > 60, `${id}: sfx manifest indexed (${r.files} ids)`);
    t.ok(r.mem && r.mem.buffers > 40, `${id}: per-mission decode (${r.mem?.buffers} buffers)`);
    t.ok(r.mem.bytes < 160 * 1048576, `${id}: decoded PCM ${(r.mem.bytes / 1048576).toFixed(1)} MB under budget`);
    t.ok(r.guardVoice, `${id}: German bark is a recorded take`);
    t.ok(r.ackVoice, `${id}: commando ack is a recorded take`);
    t.ok(r.shotRec, `${id}: rifle shot is a recorded file`);
    t.equal(r.music, 'mission', `${id}: suspense score during the mission`);
    t.ok(s.streams.length >= 1 && s.streams.every((x) => x.playing), `${id}: ambience beds streaming (${s.streams.map((x) => x.file)})`);
  }
  t.ok(rows[1].ambience.includes('river') && rows[1].streams.some((x) => /river/.test(x.file)), 'M2 river bed');
  // frame cost with live audio, per render preset (audio.update is per-frame JS work)
  const perf = await page.evaluate(() => {
    const g = window.__game, G = g.game, a = G.audio, gl = G.renderer.renderer.getContext();
    const out = {};
    for (const q of ['low', 'medium', 'high', 'ultra']) {
      g.setPreset(q);
      for (let i = 0; i < 5; i++) { g.advance(1 / 60); G.render(1 / 60, 1); }
      gl.finish();
      let t0 = performance.now();
      for (let i = 0; i < 30; i++) { g.advance(1 / 60); G.render(1 / 60, 1); }
      gl.finish();
      const frame = (performance.now() - t0) / 30;
      t0 = performance.now();
      for (let i = 0; i < 1000; i++) a.update(a.listener.x + (i % 3) * 0.1, a.listener.z, 60);
      out[q] = { frameMs: +frame.toFixed(2), audioUpdateUs: +((performance.now() - t0)).toFixed(1) };
    }
    g.setPreset('high');
    window.__audioPanel.dispose();
    window.__audioPanel = null;
    return out;
  });
  t.log('perf', JSON.stringify(perf));
  for (const [q, v] of Object.entries(perf)) t.ok(v.audioUpdateUs < 200, `${q}: audio.update ${v.audioUpdateUs} µs/frame`);
}
