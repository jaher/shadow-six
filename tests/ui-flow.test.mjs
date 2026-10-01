/**
 * UI flow (design-spec §6.6–6.8; docs/menus-art-direction.md S04–S20 and the §0 recognisability contract):
 * front end MAIN → NEW GAME in BEL order, SINGLE PLAYER (BCD locked), mission select map table (BCD "coming later",
 * 20 pins), password cells, credits (fonts + fan-tribute disclaimer), help folder, options (+ the three original
 * game preferences), QUIT confirmation with (N)O default; briefing part 1 → part 2 → playing; P pause card;
 * in-mission Esc = MAIN on the oxblood frame → resume; notebook; 10 save slots; win card → debrief → (P)LAY AGAIN;
 * fail card with A8 grammar; loading screen with a tip.
 */
const key = (page, code, extra = {}) => page.evaluate(([c, x]) => {
  // dispatched on body like a real key press (window capture listeners run before Input's bubble listener)
  const k = c === 'Escape' ? 'Escape' : c === 'Enter' ? 'Enter' : c.startsWith('Arrow') ? c : c.replace(/^(Key|Digit)/, '').toLowerCase();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: k, bubbles: true, cancelable: true, ...x }));
  window.__game.render();
}, [code, extra]);

const card = (page) => page.evaluate(() => {
  const c = document.querySelector('.mk-host .mk-card');
  const kit = window.__game.game.hud.kit;
  return c && {
    id: c.dataset.card,
    title: c.querySelector('.mk-title')?.textContent || '',
    rows: [...c.querySelectorAll('.mk-list .mk-row')].map((b) => ({ label: b.querySelector('.mk-label').textContent, off: b.getAttribute('aria-disabled') === 'true', id: b.dataset.id || '' })),
    footer: [...c.querySelectorAll('.mk-footer .mk-row')].map((b) => b.textContent),
    focus: kit.top?.focus,
    note: c.querySelector('.mk-note')?.textContent || '',
    active: kit.active,
  };
});

export default async function uiFlow(page, t) {
  // ---- S05 MAIN (front end): BEL order, SAVE GAME dimmed in place outside a mission (contract 3, 8)
  await page.evaluate(() => window.__game.game.hud.screens.openMain());
  let c = await card(page);
  t.equal(c.title, 'MAIN MENU');
  t.equal(c.rows.map((r) => r.label).join('|'), 'NEW GAME|SAVE GAME|LOAD GAME|OPTIONS|CREDITS|HELP|QUIT GAME', 'MAIN in BEL order');
  t(c.rows.find((r) => r.label === 'SAVE GAME').off, 'SAVE GAME dimmed outside a mission');
  await t.shot('ui-main');
  await key(page, 'Enter');
  c = await card(page);
  t.equal(c.rows.map((r) => r.label).join('|'), 'SINGLE PLAYER|MULTIPLAYER GAME|TUTORIALS|RESTART MISSION|LOAD QUICK SAVED GAME|PASSWORD|EXIT', 'NEW GAME in BEL order');
  await key(page, 'Escape');
  c = await card(page);
  t.equal(c.title, 'MAIN MENU', 'Esc goes back one level (contract 5)');
  // B4: queued ↓ presses land on the right row
  for (let i = 0; i < 3; i++) await key(page, 'ArrowDown');
  t.equal((await card(page)).focus, 3, '↓ ×3 → OPTIONS (disabled rows stay focusable)');

  // ---- SINGLE PLAYER, the map table (S06b)
  const sp = await page.evaluate(() => {
    const s = window.__game.game.hud.screens;
    s.openCampaigns();
    const rows = [...document.querySelectorAll('.mk-host .mk-card:not(.leaving) .mk-list .mk-row')].map((b) => ({ t: b.textContent, off: b.getAttribute('aria-disabled') === 'true' }));
    s.kit.pop();
    s.openSinglePlayer(); // BCD locked: SINGLE PLAYER goes straight to BEHIND ENEMY LINES (Enter, Enter → briefing)
    return rows;
  });
  t(sp.some((r) => /BEYOND THE CALL OF DUTY/.test(r.t) && r.off), 'BCD locked on the campaign choice');
  c = await card(page);
  t.equal(c.title, 'BEHIND ENEMY LINES', 'SINGLE PLAYER opens BEHIND ENEMY LINES directly while BCD is locked');
  t.equal(c.rows[0]?.label, 'START CAMPAIGN');
  const mt = await page.evaluate(() => {
    const kit = window.__game.game.hud.kit;
    kit.activate(1); // MISSION SELECT
    const cc = document.querySelector('.mk-maptable');
    const tabs = [...cc.querySelectorAll('.mk-tabbtn')].map((b) => ({ id: b.dataset.campaign, locked: b.classList.contains('locked'), text: b.textContent }));
    return { pins: cc.querySelectorAll('.mk-mapsheet .mk-pin').length, tabs, card: cc.querySelector('.mk-mapcard')?.textContent || '', footer: [...cc.querySelectorAll('.mk-footer .mk-row')].map((b) => b.textContent) };
  });
  t.log(JSON.stringify(mt).slice(0, 400));
  t.equal(mt.pins, 20, 'mission select pins the 20 BEL missions');
  const bcd = mt.tabs.find((x) => x.id === 'BCD');
  t(bcd?.locked && /coming later/i.test(bcd.text), 'BCD tab locked, "coming later"');
  t(/MISSION 1/.test(mt.card), 'typed card for the focused pin');
  t(mt.footer.includes('(B)RIEFING') && mt.footer.includes('(S)TART WITHOUT BRIEFING'), 'map table hotkeys');
  await t.shot('ui-maptable');
  await key(page, 'Escape');

  // ---- S08 PASSWORD: five cells, wrong code refused
  await page.evaluate(() => window.__game.game.hud.screens.openPassword());
  for (const k of ['KeyZ', 'KeyZ', 'KeyZ', 'KeyZ', 'KeyZ']) await key(page, k);
  const cells = await page.evaluate(() => [...document.querySelectorAll('.mk-cell')].map((x) => x.textContent).join(''));
  t.equal(cells, 'ZZZZZ', 'typed into the 5 cells');
  await key(page, 'Enter');
  t.equal((await card(page)).note, 'WRONG PASSWORD', 'bad password is refused');
  await key(page, 'Escape');

  // ---- S12 CREDITS, S11 HELP
  const cr = await page.evaluate(() => {
    window.__game.game.hud.screens.showCredits();
    return document.querySelector('.mk-credits').textContent;
  });
  t(/Anton/.test(cr) && /OFL|Open Font License/.test(cr) && /not affiliated/i.test(cr) && /fan tribute/i.test(cr), 'credits: fonts + fan-tribute disclaimer');
  t(/Natural Earth/.test(cr) && /ambientCG/.test(cr), 'credits: CC0 / public-domain sources');
  await key(page, 'Escape');
  t((await card(page))?.id !== 'credits', 'Esc leaves credits');
  const help = await page.evaluate(() => {
    const h = window.__game.game.hud.help;
    h.open('commandos', 0);
    const f = document.querySelector('.mk-folder');
    return { tabs: [...f.querySelectorAll('.mk-indextab')].map((b) => b.textContent), page: f.querySelector('.mk-pageno').textContent, file: f.querySelector('.mk-letterhead').textContent };
  });
  t.equal(help.tabs.join('|'), 'CONTROLS|COMMANDOS|ENEMIES', 'help folder tabs');
  t(/PERSONNEL FILE/.test(help.file) && /^1 \/ 6$/.test(help.page), 'commando dossiers, 6 pages');
  await key(page, 'BracketRight');
  t(/^2 \/ 6$/.test(await page.evaluate(() => document.querySelector('.mk-pageno').textContent)), '] turns the page');
  await key(page, 'Escape');

  // ---- S10 OPTIONS: the three original game preferences, a toggle flips and persists into game.options
  const o = await page.evaluate(() => {
    const hud = window.__game.game.hud;
    hud.menus.showOptions();
    const top = [...document.querySelectorAll('.mk-host .mk-list .mk-row .mk-label')].map((e) => e.textContent);
    const kit = hud.kit;
    kit.activate(top.indexOf('GAME PREFERENCES'));
    const ids = [...document.querySelectorAll('.mk-host .mk-list .mk-row')].map((b) => b.dataset.id);
    const i = ids.indexOf('voice');
    kit.focus(i);
    kit.change(kit.top.rows[i], 1);
    const after = hud.options.voice;
    kit.change(kit.top.rows[i], 1);
    return { top, ids, after, back: hud.options.voice, same: window.__game.game.options === hud.options };
  });
  t.log(JSON.stringify(o).slice(0, 300));
  t(['SOUND VOLUME', 'VIDEO OPTIONS', 'GAME PREFERENCES', 'CONTROLS', 'ACCESSIBILITY'].every((k) => o.top.includes(k)), 'options top level');
  t(['halt', 'voice', 'warnings'].every((k) => o.ids.includes(k)), 'the original three game preferences');
  t.equal(o.after, 'laconic', 'COMMANDOS: verbose → laconic');
  t.equal(o.back, 'verbose');
  t(o.same, 'game.options is the HUD options object');
  await t.shot('ui-options');
  await key(page, 'Escape');
  await key(page, 'Escape');

  // ---- S13 QUIT GAME: default focus on (N)O; N closes it
  await page.evaluate(() => { window.__game.game.hud.screens.openMain(); window.__game.game.hud.screens.quit(); });
  c = await card(page);
  t.equal(c.title, 'QUIT GAME');
  t.equal(c.footer.join('|'), '(Y)ES|(N)O', 'bottom-pinned (Y)ES (N)O (A1)');
  t.equal(c.focus, 1, 'default focus on (N)O');
  await key(page, 'KeyN');
  t.equal((await card(page)).title, 'MAIN MENU', '(N)O returns to MAIN');
  await page.evaluate(() => window.__game.game.hud.kit.close());

  await rest(page, t);
}

async function rest(page, t) {
  // ---- S15 / S16 briefing → play
  const b1 = await page.evaluate(async () => {
    await window.__game.game.hud.startMission('m00');
    window.__game.render();
    const b = document.querySelector('.ui-briefing');
    return { state: window.__game.game.state, part: b.className, title: b.querySelector('.title')?.getAttribute('aria-label'), slides: b.querySelectorAll('.slides .slide').length, pips: b.querySelectorAll('.pips i').length, paras: b.querySelectorAll('.text p').length, skip: b.querySelector('.skip')?.textContent };
  });
  t.log(JSON.stringify(b1));
  t.equal(b1.state, 'briefing');
  t(/part1/.test(b1.part), 'briefing part 1 (slideshow)');
  t.equal(b1.title, 'Sandbox');
  t.equal(b1.slides, 4, '4 slides');
  t.equal(b1.pips, 4, 'slide pips');
  t(b1.paras >= 2 && b1.paras <= 3, '2–3 paragraphs of context');
  t.equal(b1.skip, 'Press Escape to skip', '"Press Escape to skip" [orig wording]');
  await t.shot('ui-briefing1');
  await key(page, 'Escape');
  const b2 = await page.evaluate(() => {
    const hud = window.__game.game.hud;
    const b = document.querySelector('.ui-briefing');
    return { part: b.className, stops: hud.briefing.stops.map((s) => s.kind), sub: b.querySelector('.sub').textContent, pips: b.querySelectorAll('.stoppips i').length };
  });
  t(/part2/.test(b2.part), 'Esc → part 2 (the Colonel)');
  t.equal(JSON.stringify(b2.stops), JSON.stringify(['start', 'objective', 'danger', 'extraction']), 'tour stops');
  t(/officer/i.test(b2.sub), 'Colonel subtitle');
  t.equal(b2.pips, 4, 'stop pips');
  await key(page, 'Escape');
  t.equal(await page.evaluate(() => window.__game.game.state), 'playing', 'Esc in part 2 starts the mission');

  // ---- S18 P pause card
  const p = await page.evaluate(() => {
    const G = window.__game.game;
    G.pause(true);
    window.__game.render();
    const el = document.querySelector('.ui-paused');
    const out = { shown: !el.hidden, title: el.querySelector('.mk-title').textContent, hint: el.querySelector('.hint').textContent };
    G.pause(false);
    return out;
  });
  t(p.shown && p.title === 'GAME PAUSED' && /^P\s*\(R\)ESUME/.test(p.hint), 'P shows "GAME PAUSED" + [P] (R)ESUME');
  // S18 on the live frame: the steel title must read ≥ 3:1 against the pixels under it (the shade band)
  const pr = await page.evaluate(() => {
    window.__game.game.pause(true);
    window.__game.render();
    const h = document.querySelector('.ui-paused .mk-title > span');
    const r = h.getBoundingClientRect();
    h.style.visibility = 'hidden';
    return [r.x, r.y, r.width, r.height];
  });
  await page.waitForTimeout(260); // the band's 150 ms fade-in
  const png = (await page.screenshot({ type: 'png' })).toString('base64');
  const under = await page.evaluate(async ([b64, [x, y, w, h]]) => {
    const im = new Image();
    im.src = `data:image/png;base64,${b64}`;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0);
    const k = im.width / innerWidth;
    const d = g.getImageData(Math.round(x * k), Math.round(y * k), Math.round(w * k), Math.round(h * k)).data;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    let Y = 0;
    for (let i = 0; i < d.length; i += 4) Y += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    document.querySelector('.ui-paused .mk-title > span').style.visibility = '';
    window.__game.game.pause(false);
    return Y / (d.length / 4);
  }, [png, pr]);
  const steelY = 0.2126 * 0.33 + 0.7152 * 0.33 + 0.0722 * 0.31; // #9d9d96, the mid-bevel of the title gradient
  const ratio = (steelY + 0.05) / (under + 0.05);
  t(ratio >= 3, `GAME PAUSED title ${ratio.toFixed(2)}:1 on the live frame (≥ 3)`);

  // ---- in-mission Esc: MAIN on the oxblood frozen frame (contract 7); SAVE GAME enabled; Esc resumes
  await key(page, 'Escape');
  let c = await card(page);
  const bd = await page.evaluate(() => ({ state: window.__game.game.state, mode: window.__game.game.hud.backdrop.mode }));
  t.equal(bd.state, 'paused', 'Esc menu pauses');
  t.equal(bd.mode, 'mission', 'B2 oxblood frozen frame');
  t.equal(c.title, 'MAIN MENU');
  t(!c.rows.find((r) => r.label === 'SAVE GAME').off, 'SAVE GAME enabled in a mission');
  await key(page, 'Escape');
  t.equal(await page.evaluate(() => window.__game.game.state), 'playing', 'Esc on the top card resumes (contract 5)');

  // ---- S17 notebook
  const nb = await page.evaluate(() => {
    const hud = window.__game.game.hud;
    hud.notebook.showNotes();
    const n = document.querySelector('.ui-notes');
    return { open: !n.hidden, labels: [...n.querySelectorAll('dt')].map((d) => d.textContent), bullets: n.querySelectorAll('.obj li').length, spiral: !!n.querySelector('.nb-spiral') };
  });
  t(nb.open && nb.spiral, 'spiral notebook open');
  t.equal(nb.labels.join('|'), 'DATE:|LOCATION:|MISSION:', 'red labels (contract 10)');
  t(nb.bullets >= 1, 'objective bullets');
  await key(page, 'KeyX');
  t(await page.evaluate(() => document.querySelector('.ui-notes').hidden), 'any key closes the notebook');

  // ---- S09 ten slots
  const sl = await page.evaluate(() => {
    window.__game.game.hud.menus.showSlots('save');
    return [...document.querySelectorAll('.mk-host .mk-list .mk-row')].map((b) => b.textContent);
  });
  t.equal(sl.length, 10, 'ten save slots (contract 12)');
  t(sl.every((s) => s.length > 0), 'slot labels');
  await key(page, 'Escape');
  t.equal(await page.evaluate(() => window.__game.game.state), 'playing', 'Esc out of the slots resumes');

  // ---- S19 win card → S20 debrief → (P)LAY AGAIN
  const w = await page.evaluate(() => {
    const G = window.__game.game;
    G.world.events.emit('unit:killed', { unit: G.world.enemies[0], killer: null, cause: 'knife' });
    G.world.clock = 120;
    G._endMission(true, 'objectives complete');
    window.__game.render();
    const e = document.querySelector('.ui-end');
    return { state: G.state, cls: e.className, h: e.querySelector('.mk-title')?.textContent, line: e.querySelector('.mk-lines')?.textContent, press: e.querySelector('.press')?.textContent };
  });
  t.equal(w.state, 'won');
  t.equal(w.h, 'MISSION COMPLETED', 'win card');
  t(/SUCCESSFULLY COMPLETED/.test(w.line), 'win line');
  t(/press any key/i.test(w.press), '"PRESS ANY KEY TO CONTINUE"');
  await key(page, 'Space');
  const d = await page.evaluate(() => {
    const e = document.querySelector('.ui-end');
    return {
      cls: e.className,
      labels: [...e.querySelectorAll('.db-lab')].map((h) => h.textContent),
      discs: [...e.querySelectorAll('.db-medals .discs')].map((s) => `${s.querySelector('.mk-medal.gold') ? 'g' : 's'}:${s.querySelectorAll('.slot').length}`),
      soldiers: e.querySelector('.db-loss.soldiers .v')?.textContent,
      rank: e.querySelector('.db-rank .name')?.textContent,
      slots: e.querySelectorAll('.db-merit .mk-medal').length,
      pw: [...e.querySelectorAll('.db-panel .db-left .db-pw .mk-cell')].map((x) => x.textContent || '?').join(''),
      pwOutside: !!e.querySelector('.db-tag'),
      figure: e.querySelector('.db-figure img')?.getAttribute('src') || '',
      buttons: [...e.querySelectorAll('.mk-footer .mk-row')].map((b) => b.textContent),
      black: getComputedStyle(e).backgroundColor,
    };
  });
  t.log(JSON.stringify(d));
  t(/debrief/.test(d.cls), 'any key → debrief');
  t(['ENEMY LOSSES', 'MISSION TIME', 'SUSTAINED DAMAGE', 'MISSION MERIT', 'MERIT', 'PASSWORD'].every((k) => d.labels.includes(k)), 'debrief labels');
  t.equal(d.labels[d.labels.length - 1], 'PASSWORD', 'PASSWORD is the last red-label row inside the panel (BEL)');
  t(!d.pwOutside, 'no luggage tag outside the panel');
  t(/tiny-portrait/.test(d.figure), 'the debrief figure is the rendered Green Beret');
  t.equal(d.discs.join(','), 's:3,s:3,g:3', 'silver, silver, gold disc rows of 3');
  t(Number(d.soldiers) >= 1, 'enemy losses counted');
  t(d.rank.length > 3, 'rank shown');
  t.equal(d.slots, 6, 'merit bar has 6 slots');
  t.equal(d.pw.length, 5, 'five-character password (contract 12)');
  t(d.buttons.includes('(P)LAY AGAIN'), '(P)LAY AGAIN');
  t.equal(d.black, 'rgb(0, 0, 0)', 'the debrief floats on black (A3)');
  await t.shot('ui-debrief');
  await key(page, 'KeyP');
  await page.waitForFunction(() => window.__game.game.state === 'briefing' && document.querySelector('.ui-end').hidden, null, { timeout: 5000 });

  // ---- S19 fail card (A8 grammar)
  const l = await page.evaluate(() => {
    const G = window.__game.game;
    G.start();
    G._endMission(false, 'all commandos dead');
    const e = document.querySelector('.ui-end');
    return { h: e.querySelector('.mk-title').textContent, line: e.querySelector('.mk-lines').textContent, buttons: [...e.querySelectorAll('.mk-footer .mk-row')].map((b) => b.textContent) };
  });
  t.equal(l.h, 'MISSION FAILED');
  t.equal(l.line, 'ALL YOUR MEN HAVE DIED OR HAVE BEEN CAPTURED.', '§8.1 failure text');
  t(l.buttons[0] === '(P)LAY AGAIN' && l.buttons[l.buttons.length - 1] === '(L)OAD GAME', 'fail: (P)LAY AGAIN … (L)OAD GAME');
  await key(page, 'KeyP');
  await page.waitForFunction(() => window.__game.game.state === 'briefing', null, { timeout: 5000 });
}
