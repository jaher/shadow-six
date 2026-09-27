/**
 * CORE2 input (design-spec §5): right-drag red box select, double-click run, click/Ctrl-click selection,
 * 0/1–7 keys, Shift cone/probe, Alt track, Esc menu/pause refusal, P, Ctrl+S, action hotkeys → registry.
 */
export default async function core2Input(page, t) {
  const pos = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    g.start();
    const G = g.game;
    g.setZoom(1);
    const [gb, sn, sa] = G.world.commandos;
    g.centerOn(sn.x, sn.z);
    const cam = G.cameraController;
    const s = (c) => cam.worldToScreen(c.x, 0.5, c.z);
    return { gb: s(gb), sn: s(sn), sa: s(sa) };
  });
  // --- right-button drag: red box enclosing GB + Sniper replaces the selection
  const x0 = Math.min(pos.gb.x, pos.sn.x) - 20, y0 = Math.min(pos.gb.y, pos.sn.y) - 30;
  const x1 = Math.max(pos.gb.x, pos.sn.x) + 20, y1 = Math.max(pos.gb.y, pos.sn.y) + 20;
  const insideSa = pos.sa.x >= x0 && pos.sa.x <= x1 && pos.sa.y >= y0 && pos.sa.y <= y1;
  await page.mouse.move(x0, y0);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 3 });
  await page.mouse.move(x1, y1, { steps: 3 });
  const box = await page.evaluate(() => {
    const b = document.querySelector('.select-box');
    const cs = getComputedStyle(b);
    return { display: cs.display, border: cs.borderTopWidth, color: cs.borderTopColor, bg: cs.backgroundColor };
  });
  await t.shot('core2-box-select');
  await page.mouse.up({ button: 'right' });
  const sel1 = await page.evaluate(() => window.__game.state().commandos.filter((c) => c.selected).map((c) => c.role));
  t.log(JSON.stringify({ box, sel1, insideSa }));
  t.equal(box.display, 'block', 'box drawn while right-dragging');
  t.equal(box.border, '2px', '2 px frame');
  t.equal(box.color, 'rgb(220, 0, 0)', 'red frame');
  t.equal(box.bg, 'rgba(220, 0, 0, 0.25)', '25% red fill');
  t.equal(sel1.sort().join(), insideSa ? 'greenberet,sapper,sniper' : 'greenberet,sniper', 'box replaces the selection');

  const r = await page.evaluate(() => {
    const g = window.__game;
    const G = g.game;
    const inp = G.input;
    const w = G.world;
    const cam = G.cameraController;
    const [gb, sn, sa] = w.commandos;
    const out = {};
    const orders = [];
    const off = G.events.on('unit:order', ({ unit, order }) => orders.push({ id: unit.id, type: order.type, run: !!order.run }));
    const scr = (x, z) => cam.worldToScreen(x, 0, z);
    // right-click without a drag never deselects
    out.rightClick = inp.rightClick();
    out.selAfterRight = inp.selection.length;
    // single click on the ground walks, double click (≤350 ms, ≤6 px) runs
    inp.select([gb]);
    const p = scr(gb.x + 4, gb.z - 3);
    out.c1 = inp.click(p.x, p.y);
    out.c2 = inp.click(p.x + 3, p.y + 2);
    inp._lastClick = null;
    out.c3 = inp.click(p.x, p.y);
    inp._lastClick.t -= 400; // too late for a double click
    out.c4 = inp.click(p.x, p.y);
    inp._lastClick = null;
    out.c5 = inp.click(p.x, p.y);
    out.c6 = inp.click(p.x + 10, p.y); // too far apart
    inp._lastClick = null;
    G.step();
    out.orders = orders.slice();
    // group move: formation offsets 1.2 m around the click point
    inp.select([gb, sn, sa]);
    const mv = inp.orderMove(30, 40);
    out.formation = mv.map((o) => +Math.hypot(o.x - 30, o.z - 40).toFixed(3));
    // clicking a selected man deselects him; Ctrl+click adds / removes
    inp.select([gb]);
    const sgb = cam.worldToScreen(gb.x, 0.9, gb.z), ssn = cam.worldToScreen(sn.x, 0.9, sn.z);
    out.ctrlAdd = inp.click(ssn.x, ssn.y, { ctrl: true }); inp._lastClick = null;
    out.afterCtrl = inp.selection.map((c) => c.role).sort().join();
    out.clickSel = inp.click(sgb.x, sgb.y); inp._lastClick = null;
    out.afterClickSel = inp.selection.map((c) => c.role).join();
    // keys: 0 deselects, 1 selects the Green Beret, 7 = guest (none in m00)
    const key = (code, extra = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: extra.key || '', bubbles: true, cancelable: true, ...extra }));
    key('Digit0');
    out.after0 = inp.selection.length;
    key('Digit1');
    out.after1 = inp.selection.map((c) => c.role).join();
    key('Digit7');
    out.after7 = inp.selection.map((c) => c.role).join();
    // Shift+click an enemy shows its cone only; Shift+click ground places the probe
    const en = w.enemies[0], en2 = w.enemies[1];
    w.enemies.forEach((e) => { e.coneVisible = false; });
    en2.coneVisible = true;
    const se = cam.worldToScreen(en.x, 0.9, en.z);
    g.centerOn(en.x, en.z);
    const se2 = cam.worldToScreen(en.x, 0.9, en.z);
    out.shiftEnemy = inp.click(se2.x, se2.y, { shift: true }); inp._lastClick = null;
    out.cones = w.enemies.filter((e) => e.coneVisible).map((e) => e.id);
    out.enId = en.id;
    let probed = null;
    const offP = G.events.on('ui:probe', (e) => { probed = e; });
    const pg = scr(en.x + Math.cos(en.heading) * 6, en.z + Math.sin(en.heading) * 6);
    out.shiftGround = inp.click(pg.x, pg.y, { shift: true }); inp._lastClick = null;
    out.probe = probed && { x: +probed.x.toFixed(1), enemy: probed.enemy?.id ?? null };
    offP();
    // Alt+click a unit tracks it; Alt+click ground releases
    out.altUnit = inp.click(se2.x, se2.y, { alt: true }); inp._lastClick = null;
    out.tracking = cam.tracking?.id ?? null;
    out.altGround = inp.click(se2.x + 200, se2.y + 100, { alt: true }); inp._lastClick = null;
    out.trackingAfter = cam.tracking;
    // X → knife (registry hotkey) for the selected GB; right-click cancels the item cursor
    inp.select([gb]);
    key('KeyX', { key: 'x' });
    out.xTarget = inp.targeting?.abilityId ?? null;
    out.xCursor = inp.cursor;
    out.cancelRight = inp.rightClick();
    out.targetingAfter = inp.targeting;
    // Esc opens the menu (pauses); orders are refused while paused (faithful)
    const cmds = [];
    const offC = G.events.on('ui:command', (c) => cmds.push(c));
    key('Escape', { key: 'Escape' });
    out.escState = G.state;
    orders.length = 0;
    out.pausedClick = inp.click(p.x, p.y); inp._lastClick = null;
    key('Escape', { key: 'Escape' });
    out.escState2 = G.state;
    key('KeyP', { key: 'p' });
    out.pState = G.state;
    key('KeyP', { key: 'p' });
    key('F1', { key: 'F1' });
    key('Tab', { key: 'Tab' });
    key('KeyB', { key: 'b', ctrlKey: true });
    out.cmds = cmds.map((c) => c.command + (c.open === undefined ? '' : `:${c.open}`));
    offC();
    // Ctrl+S quicksaves (and its default is prevented)
    let msg = null;
    const offM = G.events.on('message', (m) => { msg = m.text; });
    const ev = new KeyboardEvent('keydown', { code: 'KeyS', key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    out.ctrlS = { msg, prevented: ev.defaultPrevented };
    offM();
    // numpad + / − / * use event.key
    key('NumpadAdd', { key: '+' });
    out.zoomKey = cam.zoomTarget;
    key('Backspace', { key: 'Backspace' });
    out.zoomBack = cam.zoomTarget;
    off();
    return out;
  });
  t.log(JSON.stringify(r));
  t.equal(r.rightClick, 'none', 'right-click with nothing to cancel does nothing');
  t.equal(r.selAfterRight, 2, 'right-click never deselects');
  t.equal(r.c1, 'move', 'single click walks');
  t.equal(r.c2, 'run', 'double click within 6 px runs');
  t.equal(r.c4, 'move', 'clicks > 350 ms apart do not run');
  t.equal(r.c6, 'move', 'clicks > 6 px apart do not run');
  t(r.orders.some((o) => o.type === 'move' && o.run) && r.orders.some((o) => o.type === 'move' && !o.run), 'run and walk orders reach the unit');
  t.equal(r.formation.join(), '0,1.2,1.2', 'formation offsets of 1.2 m around the click point');
  t.equal(r.afterCtrl, 'greenberet,sniper', 'Ctrl+click adds to the group');
  t.equal(r.clickSel, 'deselect', 'clicking a selected man deselects him');
  t.equal(r.afterClickSel, 'sniper', '…and keeps the others');
  t.equal(r.after0, 0, 'key 0 deselects all');
  t.equal(r.after1, 'greenberet', 'key 1 selects the Green Beret');
  t.equal(r.after7, 'greenberet', 'key 7 with no guest keeps the selection');
  t.equal(r.shiftEnemy, 'cone', 'Shift+click an enemy');
  t.equal(r.cones.join(), String(r.enId), 'only that cone shows (one at a time)');
  t.equal(r.shiftGround, 'probe', 'Shift+click ground places the probe');
  t(r.probe && r.probe.enemy !== undefined, 'ui:probe emitted');
  t.equal(r.altUnit, 'track', 'Alt+click a unit tracks it');
  t.equal(r.tracking, r.enId, 'view tracks the enemy');
  t.equal(r.altGround, 'untrack', 'Alt+click ground releases');
  t.equal(r.trackingAfter, null, 'tracking released');
  t.equal(r.xTarget, 'knife', 'X arms the knife (ability registry hotkey)');
  t.equal(r.cancelRight, 'cancel', 'right-click cancels the item cursor');
  t.equal(r.targetingAfter, null, 'cursor disarmed');
  t.equal(r.escState, 'paused', 'Esc opens the menu and pauses');
  t.equal(r.pausedClick, 'refused', 'no orders while paused (faithful)');
  t.equal(r.escState2, 'playing', 'Esc closes the menu');
  t.equal(r.pState, 'paused', 'P pauses');
  t.equal(r.cmds.join(), 'menu:true,menu:false,help,knapsack-side,notes', 'Esc/F1/Tab/Ctrl+B → ui:command');
  t.equal(r.ctrlS.msg, 'Game saved.', 'Ctrl+S quicksaves');
  t(r.ctrlS.prevented, 'Ctrl+S default prevented');
  t.equal(r.zoomKey, 2, 'numpad + zooms in');
  t.equal(r.zoomBack, 1, 'Backspace = normal zoom');
}
