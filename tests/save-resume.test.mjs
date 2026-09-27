/**
 * §8.4 × §6.8: the state a load comes back in. A quickload (F9) or a named-slot load from the Esc menu
 * resumes play, so the next ground click is obeyed; only a save made while the player had paused (P)
 * comes back paused (with the GAME PAUSED card). Menu/notes pauses are never carried into a save.
 */
export default async function saveResume(page, t) {
  await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    g.start();
    g.advance(1);
    window.__loaded = 0;
    g.game.events.on('message', (m) => { if (m.text === 'Game loaded.') window.__loaded++; });
    g.game.renderer.domElement.focus();
  });
  const waitLoad = async (n) => page.waitForFunction((k) => window.__loaded >= k, n, { timeout: 20000 });
  /** Click the ground 4 m from the GB through the real input path; did he get a move order? */
  const clickMove = () => page.evaluate(() => {
    const G = window.__game.game, inp = G.input, gb = G.world.commandos[0];
    inp.select([gb]);
    inp._lastClick = null;
    const orders = [];
    const off = G.events.on('unit:order', ({ unit, order }) => { if (unit === gb) orders.push(order.type); });
    const p = G.cameraController.worldToScreen(gb.x + 4, 0, gb.z - 3);
    inp.click(p.x, p.y);
    G.step();
    off?.();
    return { state: G.state, orders, card: !G.hud.menus.pauseCard.hidden };
  });

  // 1) F8, move, F9 (real keys): the load resumes play and the next click moves the GB
  await page.keyboard.press('F8');
  await page.evaluate(() => { const G = window.__game.game, gb = G.world.commandos[0]; gb.issue({ type: 'move', x: gb.x + 5, z: gb.z }); window.__game.advance(2); });
  await page.keyboard.press('F9');
  await waitLoad(1);
  const quick = await clickMove();
  t.log(JSON.stringify(quick));
  t.equal(quick.state, 'playing', 'F9 quickload resumes play (not left paused)');
  t(!quick.card, 'no GAME PAUSED card after the quickload');
  t(quick.orders.includes('move'), 'the first ground click after a quickload is obeyed');

  // 2) Esc menu SAVE GAME (the menu pauses) → slot load from the Esc menu: resumes play
  const slot = await page.evaluate(async () => {
    const G = window.__game.game, menus = G.hud.menus;
    menus.showEsc();
    const pausedInMenu = G.state;
    menus.saveSlot(4, 'resume test');
    menus.close(true);
    window.__game.advance(1);
    menus.showEsc();
    const ok = await menus.loadSlot(4);
    return { pausedInMenu, ok, state: G.state, card: !menus.pauseCard.hidden };
  });
  t.log(JSON.stringify(slot));
  t.equal(slot.pausedInMenu, 'paused', 'the Esc menu pauses while saving');
  t(slot.ok, 'slot loads');
  t.equal(slot.state, 'playing', 'a slot saved from the Esc menu loads into play (the menu pause is not saved)');
  t(!slot.card, 'no GAME PAUSED card after the slot load');
  const afterSlot = await clickMove();
  t(afterSlot.orders.includes('move'), 'the first ground click after a slot load is obeyed');

  // 3) P, F8, P, F9: saved while the player had paused → comes back paused (card shown); P resumes
  await page.keyboard.press('KeyP');
  await page.keyboard.press('F8');
  await page.keyboard.press('KeyP');
  const beforeLoad = await page.evaluate(() => window.__game.game.state);
  const n = await page.evaluate(() => window.__loaded);
  await page.keyboard.press('F9');
  await waitLoad(n + 1);
  const pz = await page.evaluate(() => { const G = window.__game.game; return { state: G.state, card: !G.hud.menus.pauseCard.hidden, player: G.playerPaused }; });
  t.log(JSON.stringify({ beforeLoad, pz }));
  t.equal(beforeLoad, 'playing', 'P toggled back to play before the load');
  t.equal(pz.state, 'paused', 'a save made while P-paused loads paused');
  t(pz.card, 'the GAME PAUSED card shows after loading a paused save');
  await page.keyboard.press('KeyP');
  t.equal(await page.evaluate(() => window.__game.game.state), 'playing', 'P resumes after loading a paused save');
}
