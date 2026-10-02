/**
 * UI (design-spec §6.1–6.5, §5.3): the in-mission HUD renders every panel for an M1-like state — top bar with
 * portraits / health / skull / warnings / icons, talking portrait + speaker card, notebook minimap, hand and
 * knapsack (group intersection, Tab side swap), tooltips (0.8 s), message line, bark subtitles, software cursor.
 */
export default async function uiHud(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const G = g.game;
    await g.loadMission('m00');
    const briefingUp = !document.querySelector('.ui-briefing').hidden;
    g.start();
    g.render();
    const w = G.world, hud = G.hud;
    const q = (s) => document.querySelector(s);
    const vis = (s) => { const e = q(s); return !!e && !e.hidden && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; };
    const gb = w.commandos.find((c) => c.role === 'greenberet');
    const sa = w.commandos.find((c) => c.role === 'sapper');
    const out = { briefingUp, briefingAfterStart: vis('.ui-briefing') };
    out.panels = Object.fromEntries(['.hud-topbar', '.hud-portraits', '.hud-stance', '.hud-help', '.hud-camera', '.hud-eye', '.hud-lamp', '.hud-notebook', '.hud-hand', '.hud-knapsack'].map((s) => [s, vis(s)]));
    out.portraits = [...document.querySelectorAll('.hud-portrait')].map((p) => ({ role: p.dataset.role, sel: p.classList.contains('selected') }));
    out.barH = q('.hud-topbar').getBoundingClientRect().height;
    out.scale = hud.scale;
    // knapsack: one man, then a group (intersection), then Tab swap
    g.select([gb.id]);
    g.render();
    out.gbItems = [...document.querySelectorAll('.hud-knapsack .item')].map((b) => b.dataset.item);
    g.select([gb.id, sa.id]);
    g.render();
    out.groupItems = [...document.querySelectorAll('.hud-knapsack .item')].map((b) => b.dataset.item);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', bubbles: true }));
    out.packLeft = hud.root.classList.contains('pack-left');
    const kx = q('.hud-knapsack').getBoundingClientRect().left;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', bubbles: true }));
    out.packMoved = kx < innerWidth / 2 && q('.hud-knapsack').getBoundingClientRect().left > innerWidth / 2;
    g.select([gb.id]);
    // health drains, warnings, skull
    gb.hp = gb.maxHp / 2;
    w.events.emit('ui:warning', { unit: sa, kind: 'held' });
    w.events.emit('ui:warning', { unit: gb, kind: 'seen' });
    hud.update(0.01);
    const pgb = hud.topbar.portraitEl(gb.id), psa = hud.topbar.portraitEl(sa.id);
    out.hp = Number(pgb.dataset.hp);
    out.fillH = pgb.querySelector('.hp > i').getBoundingClientRect().height;
    out.warnHeld = psa.classList.contains('warn-held');
    out.warnSeen = pgb.classList.contains('warn-seen');
    // talking portrait + subtitle + message line
    // AUDIO (§9.4) owns the voice lines: it stamps the payload's text (or marks it suppressed); the UI shows that
    if (G.audio?.director) G.audio.director.commando = null; // the selection line just played: let him speak
    const ack = { unit: gb, line: 'ack_move', force: true };
    w.events.emit('bark', ack);
    out.ackText = ack.suppressed ? null : ack.text || 'On me way.';
    const sentry = w.enemies.find((e) => e.tag === 'sentry_bridge');
    w.events.emit('bark', { unit: sentry, line: 'halt' });
    w.events.emit('message', { text: 'Only the Sapper can handle explosives.', kind: 'warn' });
    hud.update(0.01);
    out.talking = pgb.classList.contains('talking');
    out.card = vis('.hud-speaker-card');
    out.subs = [...document.querySelectorAll('.hud-sub')].map((s) => s.textContent);
    out.german = { de: q('.hud-sub.german .txt')?.textContent, en: q('.hud-sub.german .gloss')?.textContent };
    out.msg = vis('.hud-message') && q('.hud-message').textContent;
    out.slotOk = hud.portraitSlot(gb.id) === pgb.querySelector('.hud-portrait-slot');
    // notebook open + overlays
    q('.hud-notebook').style.transition = 'none';
    hud.notebook.setOpen(true);
    hud.notebook.update();
    const nb = q('.hud-notebook').getBoundingClientRect();
    out.notebook = { w: Math.round(nb.width / hud.scale), h: Math.round(nb.height / hud.scale) };
    const px = hud.notebook.ov.getContext('2d').getImageData(0, 0, hud.notebook.ov.width, hud.notebook.ov.height).data;
    let blue = 0, red = 0;
    for (let i = 0; i < px.length; i += 4) { if (px[i + 2] > 180 && px[i] < 60) blue++; if (px[i] > 180 && px[i + 1] < 60) red++; }
    out.nbDots = { blue, red };
    // the eye tool: the cone of a clicked enemy toggles
    out.eyeTip = q('.hud-eye').dataset.tip;
    out.nbShot = hud.notebook.ov.toDataURL().length;
    hud.notebook.setOpen(false);
    G.cameraController.centerOn(sentry.x, sentry.z);
    g.render();
    const ep = G.cameraController.worldToScreen(sentry.x, 0.9, sentry.z);
    out.sentryScreen = { x: ep.x, y: ep.y };
    return out;
  });
  t.log(JSON.stringify(r));
  t(r.briefingUp, 'briefing opens on load');
  t(!r.briefingAfterStart, 'briefing closes when the mission starts');
  for (const [k, v] of Object.entries(r.panels)) t(v, `panel ${k} visible`);
  t.equal(r.portraits.length, 3, 'one portrait per commando');
  t.equal(r.portraits[0].role, 'greenberet', 'portraits packed in key order');
  t.near(r.barH, 47 * r.scale, 1.5, 'top bar is 45 ref px + 2 px shadow line');
  t.equal(JSON.stringify(r.gbItems), JSON.stringify(['knife', 'pistol', 'decoy', 'shovel']), 'GB knapsack');
  t.equal(JSON.stringify(r.groupItems), JSON.stringify(['pistol']), 'group knapsack = intersection');
  t(r.packLeft && r.packMoved, 'Tab mirrors the knapsack to the left and back');
  t.near(r.hp, 0.5, 1e-3, 'health fraction');
  t.near(r.fillH, 17 * r.scale, 1.5, 'health fill drains from the top (34 → 17 ref px)');
  t(r.warnHeld && r.warnSeen, 'warning flashes: red held, blue seen');
  t(r.talking && r.card, 'talking portrait + speaker card on a bark');
  t(r.ackText && r.subs.includes(r.ackText), 'commando subtitle (the line the audio director voiced)');
  t(r.german.de && r.german.en && r.german.de !== r.german.en, 'German subtitle with English gloss');
  t.equal(r.msg, 'Only the Sapper can handle explosives.', 'message line');
  t(r.slotOk, 'portraitSlot(unitId) returns the slot in the portrait');
  t.equal(JSON.stringify(r.notebook), JSON.stringify({ w: 183, h: 215 }), 'notebook unfolds to 183×215');
  t(r.nbDots.blue > 20 && r.nbDots.red > 20, `notebook dots drawn (${JSON.stringify(r.nbDots)})`);

  // Tooltips: HUD element (eye) and a world object (the sentry), after the 0.8 s delay.
  const eye = await page.locator('.hud-eye').boundingBox();
  await page.mouse.move(eye.x + eye.width / 2, eye.y + eye.height / 2);
  await page.waitForTimeout(1100);
  const tip1 = await page.evaluate(() => { const b = document.querySelector('.ui-tooltip'); return b.hidden ? '' : b.textContent; });
  t.equal(tip1, r.eyeTip, 'HUD tooltip after 0.8 s');
  await page.mouse.move(r.sentryScreen.x, r.sentryScreen.y);
  await page.waitForTimeout(1100);
  const tip2 = await page.evaluate(() => ({ tip: document.querySelector('.ui-tooltip').hidden ? '' : document.querySelector('.ui-tooltip').textContent, cursor: document.querySelector('.ui-cursor').dataset.cursor, soft: document.body.classList.contains('ui-softcursor') }));
  t.log(JSON.stringify(tip2));
  t.equal(tip2.tip, 'SENTRY', 'world tooltip names the enemy');
  t(tip2.soft && tip2.cursor === 'move', 'software move cursor over the view with a man selected');
  // Eye tool: click the sentry → its cone toggles on
  await page.evaluate(() => window.__game.game.hud.cursor.setMode('eye'));
  await page.mouse.click(r.sentryScreen.x, r.sentryScreen.y);
  const eyeRes = await page.evaluate(() => ({ cone: window.__game.game.world.enemies.find((e) => e.tag === 'sentry_bridge').coneVisible, cur: document.querySelector('.ui-cursor').dataset.cursor }));
  t(eyeRes.cone, 'eye tool click shows the enemy cone');
  // Shift+click probe (§4.2): a ground point inside the sentry's cone shows that cone
  const probeAt = await page.evaluate(() => {
    const G = window.__game.game, hud = G.hud;
    hud.cursor.setMode(null);
    hud.hideCones();
    const s = G.world.enemies.find((e) => e.tag === 'sentry_bridge');
    const p = G.cameraController.worldToScreen(s.x - 10, 0, s.z);
    return { x: p.x, y: p.y };
  });
  await page.keyboard.down('Shift');
  await page.mouse.click(probeAt.x, probeAt.y);
  await page.keyboard.up('Shift');
  t(await page.evaluate(() => window.__game.game.world.enemies.find((e) => e.tag === 'sentry_bridge').coneVisible), 'Shift+click probe shows the covering cone');
  // Notebook with a mouse (§6.4; unchanged by the touch tap toggle): hover opens it after 0.25 s, a click on the open
  // sketch jumps the view there, leaving closes it after 0.4 s
  const nbOpen = () => page.evaluate(() => window.__game.game.hud.notebook.open);
  const nbBox = await page.locator('.hud-notebook').boundingBox();
  await page.mouse.move(nbBox.x + nbBox.width / 2, nbBox.y + nbBox.height / 2);
  await page.waitForTimeout(80);
  const nbEarly = await nbOpen();
  await page.waitForTimeout(450);
  t(!nbEarly && (await nbOpen()), 'mouse: the notebook opens after the 0.25 s hover (not at once)');
  const pg = await page.locator('.hud-notebook .page').boundingBox();
  const at = { x: Math.round(pg.x + pg.width * 0.3), y: Math.round(pg.y + pg.height * 0.6) }; // whole px (a mouse event's clientX is)
  const want = await page.evaluate(({ x, y }) => {
    const nb = window.__game.game.hud.notebook, p = nb.toWorld({ clientX: x, clientY: y });
    return window.__game.game.cameraController.focusTarget(p.x, p.z);
  }, at);
  await page.mouse.click(at.x, at.y);
  const got = await page.evaluate(() => { const c = window.__game.game.cameraController.target; return { x: c.x, z: c.z }; });
  const gotOpen = await nbOpen();
  t(Math.hypot(got.x - want.x, got.z - want.z) < 0.01 && gotOpen, `mouse: a click on the open sketch jumps the view there and keeps it open (${JSON.stringify({ got, want, gotOpen, pg })})`);
  await page.mouse.move(r.sentryScreen.x, r.sentryScreen.y);
  await page.waitForTimeout(150);
  const nbStill = await nbOpen();
  await page.waitForTimeout(500);
  t(nbStill && !(await nbOpen()), 'mouse: the notebook folds back 0.4 s after the pointer leaves');
  // Showcase frame: notebook open, a bark with subtitle + talking portrait, a message, a group selection.
  await page.evaluate(() => {
    const G = window.__game.game, w = G.world, hud = G.hud;
    const gb = w.commandos.find((c) => c.role === 'greenberet'), sn = w.commandos.find((c) => c.role === 'sniper');
    window.__game.select([gb.id, sn.id]);
    G.cameraController.centerOn(20, 44);
    hud.notebook.setOpen(true);
    w.events.emit('bark', { unit: gb, line: 'ack_act' });
    w.events.emit('message', { text: 'All your men must escape.', kind: 'warn' });
    window.__game.render();
    hud.notebook.update();
  });
  await page.mouse.move(640, 400);
  await t.shot('ui-hud');
}
