/**
 * AUDIO in the running game (design-spec §9, §4.9): locked until the first gesture, real WebAudio graph
 * after it, no music bed during the mission (start stinger only), theater ambience, siren envelope
 * following world.alarm, German barks with subtitle glosses. Screenshot: the audio debug overlay.
 */
export default async function audio(page, t) {
  const pre = await page.evaluate(() => {
    const a = window.__game.game.audio;
    return { has: !!a, unlocked: a?.unlocked, state: a?.gameState, track: a?.track };
  });
  t.ok(pre.has, 'game.audio exists');
  t.equal(pre.unlocked, false, 'locked before any user gesture');
  await page.keyboard.press('Shift'); // first gesture → unlock
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const a = g.game.audio;
    const unlocked = a.unlocked && !!a.engine?.ctx && typeof a.engine.ctx.createGain === 'function';
    await g.loadMission('m00');
    g.start();
    const w = g.game.world;
    const sentry = w.enemies.find((e) => e.tag === 'sentry_bridge') || w.enemies[0];
    const gb = w.commandos.find((c) => c.role === 'greenberet');
    g.centerOn(sentry.x, sentry.z);
    a.update(sentry.x, sentry.z, 40);
    const barks = [];
    w.events.on('bark', (e) => barks.push({ line: e.line, text: e.text, gloss: e.gloss, sub: e.subtitle, sup: !!e.suppressed }));
    w.events.emit('shot', { from: { x: sentry.x + 4, z: sentry.z }, to: gb, shooter: sentry, weapon: 'rifle', hit: false });
    w.events.emit('enemy:challenge', { enemy: sentry, target: gb });
    w.events.emit('unit:order', { unit: gb, order: { type: 'move', x: gb.x + 1, z: gb.z } });
    w.alarm.raise('global', 'test', sentry.x, sentry.z);
    g.advance(0.2);
    a.update(sentry.x, sentry.z, 40);
    const d0 = a.debug();
    g.advance(10);
    a.update(sentry.x, sentry.z, 40);
    const d1 = a.debug();
    const m = await import('/src/audio/debug-panel.js');
    window.__audioPanel = m.createAudioDebugPanel(a);
    return {
      unlocked, d0, sirenAfter10: d1.siren.gain, worldSiren: w.alarm.siren.gain, barks,
      musicLog: a.log.filter((l) => l.type === 'music').map((l) => `${l.name}${l.refused ? '!' : ''}${l.stinger ? '*' : ''}`),
      sfx: a.log.filter((l) => l.type === 'sfx').map((l) => l.name),
    };
  });
  t.log(JSON.stringify({ ...r, d0: { music: r.d0.music, ambience: r.d0.ambience, siren: r.d0.siren, active: r.d0.active, buses: r.d0.buses } }));
  t.ok(r.unlocked, 'AudioContext created on the first gesture');
  t.equal(r.d0.gameState, 'playing');
  t.equal(r.d0.music, null, '§9.1 no music bed during the mission');
  t.ok(r.musicLog.some((s) => /^start_\d\*$/.test(s)), 'start stinger at mission start');
  t.ok(r.d0.ambience.includes('wind'), '§9.2 theater ambience');
  t.ok(r.d0.siren.active && r.d0.siren.handles === 2, 'siren: positional + bed');
  t.near(r.sirenAfter10, r.worldSiren, 1e-6, 'siren follows world.alarm.siren.gain');
  t.near(r.sirenAfter10, 0.75 - 0.03 * 10.2, 0.02, '§4.9 fade 0.03/s');
  t.ok(r.sfx.includes('rifle_shot'), 'shot → rifle_shot');
  const halt = r.barks.find((b) => b.line === 'ger_halt');
  t.ok(halt && halt.text && halt.gloss && halt.sub, `German challenge with subtitle gloss (${halt?.text} / ${halt?.gloss})`);
  t.ok(r.d0.active >= 3, 'live WebAudio sources');
  await page.waitForTimeout(250);
  await t.shot('audio-mixer');
  const after = await page.evaluate(() => {
    const g = window.__game;
    g.game.pause(true);
    const s1 = g.game.audio.debug().music;
    g.game.pause(false);
    window.__audioPanel.dispose();
    return { pausedMusic: s1, errors: 0 };
  });
  t.equal(after.pausedMusic, null, 'no music while paused either');
}
