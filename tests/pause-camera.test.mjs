/**
 * §6.8 pause × §2.3 scrolling, driven with real key/mouse input: in faithful mode (activePause off,
 * the default) P freezes arrow-key, edge and middle-drag scrolling; the ⚑ "active pause" option allows them.
 */
export default async function pauseCamera(page, t) {
  await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    g.start();
    g.setZoom(1);
    g.centerOn(30, 30);
    window.__game.game.renderer.domElement.focus();
  });
  const target = () => page.evaluate(() => { const c = window.__game.game.cameraController.target; return { x: c.x, z: c.z }; });
  const moved = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
  const render = (dt) => page.evaluate((d) => window.__game.game.render(d, 1), dt);

  /** Hold ArrowRight (real key), render 0.5 s; then park the pointer on the left edge and render 0.5 s; then middle-drag. */
  async function tryScroll() {
    const out = {};
    let a = await target();
    await page.keyboard.down('ArrowRight');
    await render(0.5);
    await page.keyboard.up('ArrowRight');
    out.arrow = moved(a, await target());
    a = await target();
    await page.evaluate(() => { const r = window.__game.game.cameraRig; r.setPointer(2, 360, true, true); });
    await render(0.5);
    await page.evaluate(() => { const r = window.__game.game.cameraRig; r.setPointer(640, 360, false, false); });
    out.edge = moved(a, await target());
    a = await target();
    await page.mouse.move(640, 360);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(540, 300, { steps: 4 });
    await page.mouse.up({ button: 'middle' });
    await page.evaluate(() => window.__game.game.cameraRig.setPointer(640, 360, false, false));
    await render(0);
    out.drag = moved(a, await target());
    return out;
  }

  // faithful: pause with the real P key
  await page.keyboard.press('KeyP');
  const st1 = await page.evaluate(() => window.__game.game.state);
  const faithful = await tryScroll();
  await page.keyboard.press('KeyP');
  const st2 = await page.evaluate(() => window.__game.game.state);
  // unpaused: scrolling works
  const playing = await tryScroll();
  // ⚑ active pause: scrolling allowed while paused
  await page.evaluate(() => { window.__game.game.options.activePause = true; });
  await page.keyboard.press('KeyP');
  const st3 = await page.evaluate(() => window.__game.game.state);
  const active = await tryScroll();
  await page.keyboard.press('KeyP');
  await page.evaluate(() => { window.__game.game.options.activePause = false; });
  t.log(JSON.stringify({ st1, st2, st3, faithful, playing, active }));

  t.equal(st1, 'paused', 'P pauses');
  t.equal(st2, 'playing', 'P resumes');
  t.equal(st3, 'paused', 'P pauses (active pause)');
  t(faithful.arrow < 1e-6, `faithful pause: arrows do not scroll (${faithful.arrow})`);
  t(faithful.edge < 1e-6, `faithful pause: edge scroll frozen (${faithful.edge})`);
  t(faithful.drag < 1e-6, `faithful pause: middle-drag does not scroll (${faithful.drag})`);
  t(playing.arrow > 10 && playing.edge > 10 && playing.drag > 1, 'scrolling works while playing');
  t(active.arrow > 10, `active pause: arrows scroll (${active.arrow})`);
  t(active.edge > 10, `active pause: edge scroll works (${active.edge})`);
  t(active.drag > 1, `active pause: middle-drag scrolls (${active.drag})`);
}
