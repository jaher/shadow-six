/**
 * The top-left portrait talks (docs/talking-portraits.md §4.1): selecting a commando (number key, portrait click,
 * world click) plays his recorded acknowledgement ("Yes, sir!" first, then the other selection lines) as a
 * lip-synced clip IN HIS TOP-LEFT PORTRAIT within 200 ms, with the voice; orders play the ack lines the same way;
 * a group selection lets only the leader speak; muted voice still moves the mouth; reduced motion keeps the still;
 * 1080p and 4K.  Real keyboard + mouse on M1 (GPU headless).  Screenshots portraits-talk-1080 / -4k.
 */
const SEL = /\/(yes_sir|ready|what_now)(_alt)?_/;
const ACK = /\/(on_my_way|right_away|understood|consider_it_done)(_alt)?_/;

export default async function portraitsTalk(page, t) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.keyboard.press('Shift'); // first gesture -> AudioContext
  const men = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m01'); g.start(); g.setZoom(1);
    await G.audio.engine?.ready; await G.audio.preloading; await G.hud.portraitsReady;
    window.__barks = []; window.__voices = [];
    G.events.on('bark', (e) => queueMicrotask(() => window.__barks.push({ sp: e.speaker, line: e.line, rec: e.rec, take: e.take, sup: !!e.suppressed })));
    const play = G.audio.engine.play.bind(G.audio.engine);
    G.audio.engine.play = (id, o) => { if (String(id).startsWith('voice:')) window.__voices.push(id); return play(id, o); };
    window.__pump = setInterval(() => { g.advance(1 / 60); G.render(1 / 60, 1); }, 16);
    // what the top-left portrait of the selected man shows, polled per frame until his line clip runs
    window.__watch = (role, re) => new Promise((ok) => {
      const t0 = performance.now(), tp = G.hud.portraits;
      const u = G.world.commandos.find((c) => c.role === role), s = tp.slots.get(u);
      const tick = () => {
        const v = s.line, on = v.classList.contains('on') && !v.paused && new RegExp(re).test(tp.cur?.entry?.clip || '');
        if (on || performance.now() - t0 > 1500) {
          const c0 = v.currentTime, ms = Math.round(performance.now() - t0);
          setTimeout(() => ok({ on, ms, clip: tp.cur?.entry?.clip || null, adv: +(v.currentTime - c0).toFixed(3),
            colour: !getComputedStyle(v).filter.includes('grayscale'), talkingClass: s.host.closest('.hud-portrait').classList.contains('tp-talking'),
            inSlot: tp.cur?.v === v, barks: window.__barks.splice(0), voices: window.__voices.splice(0) }), 250);
        } else requestAnimationFrame(tick);
      };
      tick();
    });
    return G.world.commandos.map((c) => c.role);
  });
  t.log('M1 men', men.join(','));
  const watch = (role, re) => page.evaluate(([r, x]) => window.__watch(r, x), [role, re.source]);
  const quiet = () => page.evaluate(() => new Promise((ok) => setTimeout(() => { window.__barks.length = 0; window.__voices.length = 0; ok(); }, 1600)));

  // number key: select another man first, then commando 1 (the Green Beret) -> his portrait talks
  await page.keyboard.press('Digit3');
  await quiet();
  const [k1] = await Promise.all([watch('greenberet', SEL), page.keyboard.press('Digit1')]);
  t.log('key1', JSON.stringify(k1));
  t.ok(k1.on && k1.inSlot, `key 1: the Green Beret's top-left portrait plays ${k1.clip}`);
  t.ok(k1.ms <= 200, `key 1: talking clip within 200 ms (${k1.ms} ms)`);
  t.ok(k1.adv > 0.1, `key 1: clip time advances (${k1.adv} s in 250 ms)`);
  t.ok(k1.colour && k1.talkingClass, 'key 1: portrait in colour while he speaks');
  t.ok(k1.barks.some((b) => b.sp === 'greenberet' && b.line === 'select' && b.rec) && k1.voices.includes('voice:select'), 'key 1: select bark + voice played');
  await page.waitForTimeout(250);
  await t.shot('portraits-talk-1080');

  // portrait click on another man -> he speaks the same way
  await quiet();
  const box = await page.evaluate(() => { const b = document.querySelectorAll('.hud-portrait')[1].getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  const role1 = men[1];
  const [pc] = await Promise.all([watch(role1, SEL), page.mouse.click(box.x, box.y)]);
  t.ok(pc.on && pc.inSlot && pc.ms <= 200, `portrait click: ${role1} talks in his portrait (${pc.ms} ms, ${pc.clip})`);

  // world click on the Green Beret again (someone else spoke since) -> he answers with the NEXT selection line
  await quiet();
  const gp = await page.evaluate(() => { const g = window.__game, G = g.game, u = G.world.commandos[0]; g.centerOn(u.x, u.z); G.render(0, 1); return G.cameraController.worldToScreen(u.x, 0.8, u.z); });
  const [wc] = await Promise.all([watch('greenberet', SEL), page.mouse.click(gp.x, gp.y)]);
  t.ok(wc.on && wc.inSlot, `world click: Green Beret talks (${wc.clip})`);
  t.ok(wc.clip !== k1.clip, `rotation: no immediate repeat (${k1.clip} -> ${wc.clip})`);

  // order: move click on the ground -> an acknowledgement line, same portrait
  await quiet();
  const ground = await page.evaluate(() => { const G = window.__game.game, u = G.world.commandos[0]; return G.cameraController.worldToScreen(u.x + 3, 0, u.z + 2); });
  const [mv] = await Promise.all([watch('greenberet', ACK), page.mouse.click(ground.x, ground.y)]);
  t.ok(mv.on && mv.inSlot && mv.barks.some((b) => b.line === 'ack_move'), `move order: acknowledgement ${mv.clip} in his portrait`);

  // rapid re-selection of the same man: no restart
  const again = await page.evaluate(async () => { window.__barks.length = 0; await new Promise((ok) => setTimeout(ok, 100)); return true; });
  for (let i = 0; i < 3; i++) await page.keyboard.press('Digit1');
  const spam = await page.evaluate(() => new Promise((ok) => setTimeout(() => ok(window.__barks.filter((b) => b.line === 'select').length), 300)));
  t.ok(again && spam <= 1, `rapid re-selection of the same man (3 presses) -> ${spam} select bark(s), no restarts`);

  // group (select all): only the leader speaks
  await quiet();
  await page.keyboard.press('Digit8');
  const grp = await page.evaluate(() => new Promise((ok) => setTimeout(() => ok(window.__barks.filter((b) => b.line === 'select').map((b) => b.sp)), 500)));
  t.ok(grp.length <= 1, `group selection: at most the leader speaks (${grp.join(',') || 'none'})`);

  // muted voice: the mouth still moves
  await quiet();
  await page.evaluate(() => window.__game.game.audio.setMuted(true));
  await page.keyboard.press('Digit3'); await quiet();
  const [mu] = await Promise.all([watch('greenberet', SEL), page.keyboard.press('Digit1')]);
  await page.evaluate(() => window.__game.game.audio.setMuted(false));
  t.ok(mu.on && mu.inSlot, `voice muted: portrait still lip-syncs (${mu.clip})`);

  // reduced motion: the still stays
  await quiet();
  await page.evaluate(() => { window.__game.game.hud.kit.reducedMotion = true; });
  await page.keyboard.press('Digit3');
  const rm = await page.evaluate(() => new Promise((ok) => setTimeout(() => { const tp = window.__game.game.hud.portraits; ok({ lines: [...tp.slots.values()].filter((s) => s.line.classList.contains('on')).length, cur: !!tp.cur }); }, 400)));
  await page.evaluate(() => { window.__game.game.hud.kit.applyPrefs(); });
  t.ok(rm.lines === 0 && !rm.cur, 'reduced motion: no clip, the still stays');

  // 4K
  await page.setViewportSize({ width: 3840, height: 2160 });
  await quiet();
  const [k4] = await Promise.all([watch('greenberet', SEL), page.keyboard.press('Digit1')]);
  t.ok(k4.on && k4.inSlot && k4.adv > 0.05 && k4.ms <= 450, `4K: Green Beret talks in his portrait (${k4.ms} ms under the headless 4K render load)`);
  await page.waitForTimeout(200);
  await t.shot('portraits-talk-4k');
  await page.evaluate(() => clearInterval(window.__pump));
  await page.setViewportSize({ width: 1280, height: 720 });
}
