/**
 * §6.8 pause × §5.2 cone inspection: in faithful mode (activePause off, the default) P forbids cone
 * inspection — Shift+click an enemy (real mouse + keyboard), plain click an enemy with no selection,
 * the eye tool and the Shift+click ground probe all leave every cone hidden. ⚑ Active pause allows them.
 */
export default async function pauseCone(page, t) {
  await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m01');
    g.start();
    g.setZoom(1);
    const G = g.game, w = G.world;
    const c = w.commandos[0];
    let best = null, bd = Infinity;
    for (const e of w.enemies) { const d = Math.hypot(e.x - c.x, e.z - c.z); if (e.alive && d < bd) { bd = d; best = e; } }
    window.__pc = best;
    G.renderer.domElement.focus();
  });

  /** Put the nearest enemy under the screen centre, hide all cones, then run one inspection path. */
  const prep = () => page.evaluate(() => {
    const g = window.__game, G = g.game, en = window.__pc;
    G.world.enemies.forEach((e) => { e.coneVisible = false; });
    G.input.select([]);
    G.hud?.cursor?.setMode?.(null);
    g.centerOn(en.x, en.z);
    G.render(0, 1);
    const s = G.cameraController.worldToScreen(en.x, 0.9, en.z);
    G.input._lastClick = null;
    return { x: s.x, y: s.y };
  });
  const cones = () => page.evaluate(() => window.__game.game.world.enemies.filter((e) => e.coneVisible).length);

  async function tryInspect() {
    const out = {};
    // real Shift+click on the enemy
    let s = await prep();
    await page.keyboard.down('Shift');
    await page.mouse.click(s.x, s.y);
    await page.keyboard.up('Shift');
    out.shiftMouse = await cones();
    // Input.click with Shift (enemy), plain click (no selection), Shift+ground probe
    s = await prep();
    out.shiftRes = await page.evaluate((p) => window.__game.game.input.click(p.x, p.y, { shift: true }), s);
    out.shift = await cones();
    s = await prep();
    out.plainRes = await page.evaluate((p) => window.__game.game.input.click(p.x, p.y), s);
    out.plain = await cones();
    s = await prep();
    out.probe = await page.evaluate(() => {
      const G = window.__game.game, en = window.__pc;
      const p = G.cameraController.worldToScreen(en.x + Math.cos(en.heading) * 6, 0, en.z + Math.sin(en.heading) * 6);
      let probed = 0;
      const off = G.events?.on?.('ui:probe', () => { probed++; });
      const r = G.input.click(p.x, p.y, { shift: true });
      off?.();
      return { r, probed };
    });
    // eye tool (HUD cursor layer) then a real click on the enemy
    s = await prep();
    const hasEye = await page.evaluate(() => { const c = window.__game.game.hud?.cursor; if (!c) return false; c.setMode('eye'); return c.mode === 'eye'; });
    if (hasEye) {
      await page.mouse.click(s.x, s.y);
      out.eye = await cones();
      await page.evaluate(() => window.__game.game.hud.cursor.setMode(null));
    }
    out.hasEye = hasEye;
    return out;
  }

  await page.keyboard.press('KeyP');
  const st1 = await page.evaluate(() => window.__game.game.state);
  const faithful = await tryInspect();
  await page.keyboard.press('KeyP');
  const st2 = await page.evaluate(() => window.__game.game.state);
  const playing = await tryInspect();
  await page.evaluate(() => { window.__game.game.options.activePause = true; });
  await page.keyboard.press('KeyP');
  const st3 = await page.evaluate(() => window.__game.game.state);
  const active = await tryInspect();
  await page.keyboard.press('KeyP');
  await page.evaluate(() => { window.__game.game.options.activePause = false; });
  t.log(JSON.stringify({ st1, st2, st3, faithful, playing, active }));

  t.equal(st1, 'paused', 'P pauses');
  t.equal(st2, 'playing', 'P resumes');
  t.equal(st3, 'paused', 'P pauses (active pause)');
  t.equal(faithful.shiftMouse, 0, 'faithful pause: real Shift+click enemy shows no cone');
  t.equal(faithful.shiftRes, 'refused', 'faithful pause: Shift+click enemy refused');
  t.equal(faithful.shift, 0, 'faithful pause: Shift+click keeps cones hidden');
  t.equal(faithful.plainRes, 'refused', 'faithful pause: plain click enemy (no selection) refused');
  t.equal(faithful.plain, 0, 'faithful pause: plain click keeps cones hidden');
  t.equal(faithful.probe.r, 'refused', 'faithful pause: Shift+click ground probe refused');
  t.equal(faithful.probe.probed, 0, 'faithful pause: no probe event');
  t(faithful.hasEye, 'eye tool available');
  t.equal(faithful.eye, 0, 'faithful pause: eye tool shows no cone');
  t(playing.shiftMouse >= 1 && playing.shift >= 1 && playing.plain >= 1 && playing.eye >= 1, 'playing: every inspection path shows a cone');
  t.equal(playing.shiftRes, 'cone', 'playing: Shift+click enemy → cone');
  t.equal(playing.probe.r, 'probe', 'playing: Shift+click ground → probe');
  t(playing.probe.probed >= 1, 'playing: probe event emitted');
  t(active.shiftMouse >= 1 && active.shift >= 1 && active.plain >= 1 && active.eye >= 1, 'active pause: every inspection path shows a cone');
  t.equal(active.probe.r, 'probe', 'active pause: probe allowed');
}
