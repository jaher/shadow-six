/**
 * Hover eye (user 2026-10-07 "there should be an eye icon, when mouse is positioned over a soldier (the same way there
 * is for knife, gun, etc)"): with no item armed, the mouse over an enemy soldier shows the EYE cursor — with or without
 * men selected — and a click there shows his vision cone (a second click hides it) instead of walking the selected man
 * onto him. Over the ground the move arrow is back; an armed item (the knife) keeps its own cursor over the soldier;
 * paused (faithful §6.8) the eye carries the forbidden mark. A touch tap with men selected still walks them.
 */
export default async function hoverEye(page, t) {
  await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m01');
    g.start();
    g.setZoom(1);
    const G = g.game, w = G.world;
    const c = w.commandos.find((q) => q.role === 'greenberet') || w.commandos[0];
    let best = null, bd = Infinity;
    for (const e of w.enemies) { const d = Math.hypot(e.x - c.x, e.z - c.z); if (e.alive && d < bd) { bd = d; best = e; } }
    window.__he = { en: best, c };
    G.renderer.domElement.focus();
  });
  /** enemy under the screen centre, cones hidden; returns his screen point and a ground point 5 m off */
  const prep = (select) => page.evaluate((select) => {
    const g = window.__game, G = g.game, { en, c } = window.__he;
    G.world.enemies.forEach((e) => { e.coneVisible = false; });
    G.input.cancelTargeting?.();
    G.input.select(select ? [c] : []);
    g.centerOn(en.x, en.z);
    G.render(0, 1);
    const s = G.cameraController.worldToScreen(en.x, 0.9, en.z);
    const gp = G.cameraController.worldToScreen(en.x + 5, 0, en.z + 5);
    G.input._lastClick = null;
    return { s: { x: s.x, y: s.y }, gp: { x: gp.x, y: gp.y } };
  }, select);
  const cursorNow = () => page.evaluate(() => {
    const G = window.__game.game;
    G.render(0, 1);
    const r = G.hud.cursor.resolve();
    return { id: r.id, forbidden: !!r.forbidden, native: !!r.native, engine: G.input.cursor };
  });
  const cones = () => page.evaluate(() => window.__game.game.world.enemies.filter((e) => e.coneVisible).map((e) => e.id));

  const out = {};
  // nobody selected
  let p = await prep(false);
  await page.mouse.move(p.s.x, p.s.y, { steps: 2 });
  out.noSel = await cursorNow();
  await page.mouse.move(p.gp.x, p.gp.y, { steps: 2 });
  out.noSelGround = await cursorNow();
  // a man selected: eye over the soldier, move arrow over the ground
  p = await prep(true);
  await page.mouse.move(p.s.x, p.s.y, { steps: 2 });
  out.sel = await cursorNow();
  await page.mouse.move(p.gp.x, p.gp.y, { steps: 2 });
  out.selGround = await cursorNow();
  // click on the soldier (real mouse) with the man selected: his cone, no walk
  p = await prep(true);
  const before = await page.evaluate(() => { const c = window.__he.c; return { x: c.x, z: c.z }; });
  await page.mouse.click(p.s.x, p.s.y);
  out.clickCones = await cones();
  await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 30; i++) g.game.step(g.CONFIG.sim.dt); });
  out.moved = await page.evaluate((b) => { const c = window.__he.c; return Math.hypot(c.x - b.x, c.z - b.z); }, before);
  out.stillSelected = await page.evaluate(() => window.__he.c.selected);
  out.enId = await page.evaluate(() => window.__he.en.id);
  await page.evaluate(() => { window.__game.game.input._lastClick = null; });
  await page.waitForTimeout(450); // no double click
  await page.mouse.click(p.s.x, p.s.y);
  out.clickAgain = await cones();
  // a touch tap with the man selected still walks him (the long-press shows the cone on touch)
  p = await prep(true);
  out.touch = await page.evaluate((s) => window.__game.game.input.click(s.x, s.y, { touch: true }), p.s);
  // an armed item keeps its cursor over the soldier
  p = await prep(true);
  out.armed = await page.evaluate(() => { const G = window.__game.game; G.input.beginTargeting('knife'); return !!G.input.targeting; });
  await page.mouse.move(p.s.x + 1, p.s.y, { steps: 2 });
  out.knife = await cursorNow();
  await page.evaluate(() => window.__game.game.input.cancelTargeting());
  // faithful pause: the eye is refused
  p = await prep(true);
  await page.keyboard.press('KeyP');
  await page.mouse.move(p.s.x, p.s.y + 1, { steps: 2 });
  out.paused = await cursorNow();
  await page.keyboard.press('KeyP');
  t.log(JSON.stringify(out));

  t.equal(out.noSel.id, 'eye', 'no selection: eye over the soldier');
  t(!out.noSel.native && !out.noSel.forbidden, 'drawn eye, not refused');
  t.equal(out.noSel.engine, 'eye', 'input cursor state: eye');
  t.equal(out.noSelGround.id, 'arrow', 'no selection: plain arrow over the ground');
  t.equal(out.sel.id, 'eye', 'man selected: eye over the soldier');
  t.equal(out.sel.engine, 'eye', 'man selected: input cursor state eye');
  t.equal(out.selGround.id, 'move', 'man selected: move cursor over the ground');
  t.equal(out.clickCones.join(), String(out.enId), 'click on the soldier shows his cone');
  t(out.moved < 0.05, `the selected man does not walk (moved ${out.moved.toFixed(3)} m)`);
  t(out.stillSelected, 'selection kept');
  t.equal(out.clickAgain.length, 0, 'a second click hides the cone');
  t.equal(out.touch, 'move', 'touch tap with a man selected still walks');
  t(out.armed, 'knife armed');
  t.equal(out.knife.id, 'knife', 'armed knife keeps the knife cursor over the soldier');
  t.equal(out.paused.id, 'eye', 'paused: eye');
  t(out.paused.forbidden, 'paused (faithful): eye refused');
}
