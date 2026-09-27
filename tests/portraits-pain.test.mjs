/**
 * Pain on the top-left portraits (docs/talking-portraits.md §9), real game on M1 (GPU headless): a hit commando's
 * OWN portrait plays a flinch clip within 150 ms (in colour, red edge pulse) with his grunt, repeated hits do not
 * restart it, "I'm hit!" follows the grunt without overlapping it, below 50 % hp his idle is the wounded loop,
 * at most 3 videos decode, muted voice still flinches, reduced motion shows the pain still.
 * Screenshots: portraits-pain-1080 (full frame), portraits-pain-hud (top-left crop at the wince).
 */
const FLINCH = /\/flinch_\d_/;

export default async function portraitsPain(page, t) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.keyboard.press('Shift'); // first gesture -> AudioContext
  const men = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m01'); g.start(); g.setZoom(1);
    await G.audio.engine?.ready; await G.audio.preloading; await G.hud.portraitsReady;
    window.__voices = [];
    const play = G.audio.engine.play.bind(G.audio.engine);
    G.audio.engine.play = (id, o) => {
      const h = play(id, o);
      if (String(id).startsWith('voice:')) window.__voices.push({ id, t: G.audio.engine.ctx.currentTime, dur: h?.duration ?? 0 });
      return h;
    };
    window.__pump = setInterval(() => { g.advance(1 / 60); G.render(1 / 60, 1); }, 16);
    window.__playing = () => [...document.querySelectorAll('video')].filter((v) => !v.paused && !v.ended).length;
    // hit `role` for `frac` of his max hp, then poll per frame until HIS portrait shows a flinch clip
    window.__hit = (role, frac) => new Promise((ok) => {
      const tp = G.hud.portraits, u = G.world.commandos.find((c) => c.role === role), s = tp.slots.get(u);
      const t0 = performance.now();
      u.takeDamage(u.maxHp * frac, null, 'shot');
      const tick = () => {
        const v = s.line, cur = tp.cur;
        const on = v.classList.contains('on') && !v.paused && cur?.unit === u && /\/flinch_\d_/.test(cur?.entry?.clip || '');
        if (on || performance.now() - t0 > 1000) {
          const c0 = v.currentTime, ms = Math.round(performance.now() - t0);
          const face = s.host.closest('.hud-portrait');
          const r = { on, ms, clip: cur?.entry?.clip || null, pulse: s.host.classList.contains('tp-hit'), hp: u.hp / u.maxHp,
            colour: face.classList.contains('tp-talking') && !getComputedStyle(v).filter.includes('grayscale'), inSlot: cur?.v === v };
          setTimeout(() => ok({ ...r, adv: +(v.currentTime - c0).toFixed(3), playing: window.__playing() }), 150);
        } else requestAnimationFrame(tick);
      };
      tick();
    });
    return G.world.commandos.map((c) => c.role);
  });
  t.log('M1 men', men.join(','));
  const hit = (role, frac) => page.evaluate(([r, f]) => window.__hit(r, f), [role, frac]);
  const settle = (ms = 1800) => page.evaluate((w) => new Promise((ok) => setTimeout(ok, w)), ms);

  // select the Green Beret (his idle loop runs), then hit ANOTHER man: HIS portrait flinches
  await page.keyboard.press('Digit1'); await settle(1600);
  const other = men[1];
  await page.evaluate(() => { window.__voices.length = 0; });
  const h1 = await hit(other, 0.2);
  t.log('hit', JSON.stringify(h1));
  t.ok(h1.on && h1.inSlot, `${other} hit: his top-left portrait plays ${h1.clip}`);
  t.ok(h1.ms <= 150, `flinch within 150 ms (${h1.ms} ms)`);
  t.ok(h1.adv > 0.05, `flinch clip time advances (${h1.adv} s in 150 ms)`);
  t.ok(h1.colour && h1.pulse, 'in colour while it plays, red edge pulse on the slot');
  t.ok(h1.playing <= 3, `at most 3 videos decoding (${h1.playing})`);
  // screenshots at the wince (docs sheet): hold his flinch clip on its current frame (~0.2 s in, the peak) for the capture
  const box = await page.evaluate((role) => {
    const G = window.__game.game, tp = G.hud.portraits, s = tp.slots.get(G.world.commandos.find((c) => c.role === role));
    s.line.pause(); window.__held = s.line;
    const r = [...document.querySelectorAll('.hud-portrait')].map((e) => e.getBoundingClientRect());
    const x0 = Math.min(...r.map((b) => b.x)), y0 = Math.min(...r.map((b) => b.y));
    return { x: Math.max(0, x0 - 8), y: Math.max(0, y0 - 8), width: Math.max(...r.map((b) => b.right)) - x0 + 16, height: Math.max(...r.map((b) => b.bottom)) - y0 + 16 };
  }, other);
  await page.screenshot({ path: t.harness.shotPath('portraits-pain-hud.png'), clip: box });
  await t.shot('portraits-pain-1080');
  await page.evaluate(() => window.__held.play());

  // repeated hits inside 0.4 s do not restart the flinch every frame
  const spam = await page.evaluate((role) => new Promise((ok) => {
    const G = window.__game.game, tp = G.hud.portraits, u = G.world.commandos.find((c) => c.role === role);
    u.takeDamage(0.5, null, 'shot');            // (the screenshots above took longer than 0.4 s: this one flinches anew)
    setTimeout(() => {
      const cur = tp.cur; let n = 0;
      const iv = setInterval(() => { u.takeDamage(0.5, null, 'shot'); if (++n === 5) { clearInterval(iv); ok({ same: !!cur && tp.cur === cur, flinch: /flinch_/.test(cur?.entry?.clip || '') }); } }, 45);
    }, 30);
  }), other);
  t.ok(spam.same && spam.flinch, 'five more hits within 0.3 s of a flinch: it is not restarted');

  // voice: the grunt first, "I'm hit!" only after it (never both at once); every voice start is logged, so any
  // overlap between consecutive commando voices would show up here
  await settle(2200);
  const vo = await page.evaluate(() => window.__voices.splice(0));
  const overlap = vo.some((v, i) => i > 0 && v.t < vo[i - 1].t + vo[i - 1].dur - 0.05 && !/^voice:pain$/.test(v.id));
  t.ok(!overlap, 'no commando voice starts over another one (a grunt may cut a line; nothing talks over a grunt)');
  t.log('voices', JSON.stringify(vo));
  const pain = vo.filter((v) => v.id === 'voice:pain'), hurt = vo.filter((v) => v.id === 'voice:hurt');
  t.ok(pain.length >= 1 && pain.length <= 2, `grunts for the two bursts, none per extra hit (${pain.length})`);
  t.ok(hurt.length <= 1 && (!hurt.length || hurt[0].t >= pain[0].t + pain[0].dur - 0.02), `"I'm hit!" follows the grunt without overlap (${hurt.map((h) => (h.t - pain[0].t).toFixed(2)).join(',') || 'none'})`);

  // wounded: the selected man below 50 % hp -> his idle is the wounded loop, still one idle decode
  const w = await page.evaluate(() => new Promise((ok) => {
    const G = window.__game.game, tp = G.hud.portraits, u = G.world.commandos[0], s = tp.slots.get(u);
    u.takeDamage(u.hp - u.maxHp * 0.4, null, 'shot');
    setTimeout(() => {
      const want = tp.clipURL(tp.man.characters[s.char].pain.wounded), c0 = s.idle.currentTime;
      setTimeout(() => ok({ state: s.state, wounded: s.idleSrc === want && s.idle.currentSrc === want, idlePlays: !s.idle.paused,
        adv: +(s.idle.currentTime - c0).toFixed(3), playing: window.__playing(), hp: u.hp / u.maxHp }), 300);
    }, 1800);   // after his flinch has faded back to the idle loop
  }));
  t.log('wounded', JSON.stringify(w));
  t.ok(w.state === 'wounded' && w.wounded, `below 50 % hp (${w.hp.toFixed(2)}): his idle is the wounded loop`);
  t.ok(w.idlePlays && w.adv > 0.1 && w.playing <= 3, `wounded loop plays (${w.adv} s in 300 ms), ${w.playing} video(s) decoding`);

  // muted voice: the face still reacts
  await page.evaluate(() => window.__game.game.audio.setMuted(true));
  const mu = await hit(men[2], 0.1);
  await page.evaluate(() => window.__game.game.audio.setMuted(false));
  t.ok(mu.on && mu.ms <= 150, `voice muted: ${men[2]} still flinches (${mu.ms} ms)`);

  // reduced motion: the pain still instead of video
  await settle(2600);   // his grunt, then his "I'm hit!" line, are over
  await page.evaluate(() => { window.__game.game.hud.kit.reducedMotion = true; });
  const rm = await page.evaluate((role) => new Promise((ok) => {
    const G = window.__game.game, tp = G.hud.portraits, u = G.world.commandos.find((c) => c.role === role), s = tp.slots.get(u);
    u.takeDamage(u.maxHp * 0.05, null, 'shot');
    setTimeout(() => ok({ still: s.still.classList.contains('on') && s.still.complete && s.still.naturalWidth > 0, cur: tp.cur?.entry?.clip || null,
      colour: s.host.closest('.hud-portrait').classList.contains('tp-talking') }), 120);
  }), men[0]);
  t.log('reduced', JSON.stringify(rm));
  await page.evaluate(() => { window.__game.game.hud.kit.applyPrefs(); });
  t.ok(rm.still && !rm.cur && rm.colour, 'reduced motion: the pain still shows (in colour), no clip');

  // 4K: the Green Beret (selected, wounded) is hit; crop of the HUD at his wince for the docs sheet
  await page.setViewportSize({ width: 3840, height: 2160 });
  await settle(1500);
  const k4 = await hit(men[0], 0.05);
  const box4 = await page.evaluate(() => {
    const G = window.__game.game, s = G.hud.portraits.slots.get(G.world.commandos[0]);
    s.line.pause(); window.__held = s.line;
    const r = [...document.querySelectorAll('.hud-portrait')].map((e) => e.getBoundingClientRect());
    const x0 = Math.min(...r.map((b) => b.x)), y0 = Math.min(...r.map((b) => b.y));
    return { x: Math.max(0, x0 - 12), y: Math.max(0, y0 - 12), width: Math.max(...r.map((b) => b.right)) - x0 + 24, height: Math.max(...r.map((b) => b.bottom)) - y0 + 24 };
  });
  await page.screenshot({ path: t.harness.shotPath('portraits-pain-hud-4k.png'), clip: box4 });
  await page.evaluate(() => window.__held.play());
  t.ok(k4.on && k4.inSlot && k4.ms <= 450, `4K: the Green Beret flinches in his portrait (${k4.ms} ms under the headless 4K render load)`);
  await page.evaluate(() => clearInterval(window.__pump));
  await page.setViewportSize({ width: 1280, height: 720 });
}
