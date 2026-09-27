/**
 * Menu layout on real pixels (review fixes, docs/menus-art-direction.md §1.9, A7, S06b, S10, S11/S12):
 *  - focus lands inside the card after every kit.open (screen readers, focus ring);
 *  - MAIN: every enabled row reads ≥ 4.5:1 against the pixels actually under it (list scrim + camo + emboss);
 *  - A7: the camo frame stays within ±8 L* of olive-800 and the diorama opening keeps the frame dark (≤ 36 L*);
 *  - S06b: the campaign tabs never sit under the map sheet (1280×720 and 400×860); on a phone the mission card
 *    never covers the (B)RIEFING / (S)TART footer, which stays on screen;
 *  - phone rows are ≥ 44 CSS px; SOUND's detail pane never covers its rows.
 */
const HUD = 'window.__game.game.hud';

/** Mean colour of the page pixels inside each rect (CSS px) → [{r,g,b}], from a real screenshot. */
async function pixels(page, rects) {
  const png = (await page.screenshot({ type: 'png' })).toString('base64');
  return page.evaluate(async ([b64, rs]) => {
    const im = new Image();
    im.src = `data:image/png;base64,${b64}`;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = im.width;
    c.height = im.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    const k = im.width / innerWidth;
    return rs.map(([x, y, w, h]) => {
      const d = g.getImageData(Math.round(x * k), Math.round(y * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))).data;
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      return { r: r / n, g: gg / n, b: b / n };
    });
  }, [png, rects]);
}

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const Lstar = (c) => { const Y = lum(c); return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y; };
const rgb = (s) => { const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(s); return { r: +m[1], g: +m[2], b: +m[3] }; };
const hit = (a, b) => a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export default async function uiLayout(page, t) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(`${HUD}.screens.openMain()`);
  await page.waitForFunction(() => window.__game.game.hud.backdrop.embossReady, null, { timeout: 8000 });
  await page.waitForTimeout(400);

  // ---- focus inside the card after every open
  const openers = {
    main: `${HUD}.screens.openMain()`, newgame: `${HUD}.screens.openNewGame()`, single: `${HUD}.screens.openSinglePlayer()`,
    tutorials: `${HUD}.screens.openTutorials()`, password: `${HUD}.screens.openPassword()`, options: `${HUD}.menus.showOptions()`,
    load: `${HUD}.menus.showSlots('load')`, help: `${HUD}.help.open('controls', 0)`, credits: `${HUD}.screens.showCredits()`,
    quit: `void ${HUD}.screens.quit()`,
  };
  for (const [name, js] of Object.entries(openers)) {
    const inside = await page.evaluate((code) => {
      window.__game.game.hud.kit.close();
      window.__game.game.hud.screens.openMain();
      (0, eval)(code);
      const card = document.querySelector('.mk-host .mk-card');
      return !!card && card.contains(document.activeElement) && !document.activeElement.closest('.leaving');
    }, js);
    t(inside, `focus is inside the live card after opening ${name}`);
  }
  const help = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.mk-host .mk-card .mk-indextab')];
    window.__game.game.hud.kit.close();
    window.__game.game.hud.help.open('commandos', 0);
    const a = document.activeElement;
    return { role: a.getAttribute('role'), selected: a.getAttribute('aria-selected'), text: a.textContent, list: a.parentElement.getAttribute('role'), n: tabs.length };
  });
  t(help.role === 'tab' && help.selected === 'true' && help.text === 'COMMANDOS' && help.list === 'tablist', 'HELP focuses its active index tab (roving tablist)');

  // ---- MAIN: contrast on the real pixels under each enabled row (labels hidden, the scrim kept)
  await page.evaluate(`${HUD}.kit.close(); ${HUD}.screens.openMain()`);
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.mk-host .mk-card .mk-list .mk-row')].map((b) => {
    const r = b.querySelector('.mk-label').getBoundingClientRect();
    return { label: b.textContent, off: b.getAttribute('aria-disabled') === 'true', color: getComputedStyle(b).color, rect: [r.x, r.y, r.width, r.height] };
  }));
  await page.evaluate(() => document.querySelectorAll('.mk-host .mk-card .mk-list .mk-label, .mk-host .mk-card .mk-tab').forEach((l) => { l.style.visibility = 'hidden'; }));
  const under = await pixels(page, rows.map((r) => r.rect));
  await page.evaluate(() => document.querySelectorAll('.mk-host .mk-card .mk-list .mk-label, .mk-host .mk-card .mk-tab').forEach((l) => { l.style.visibility = ''; }));
  rows.forEach((r, i) => {
    const cr = contrast(rgb(r.color), under[i]);
    if (!r.off) t(cr >= 4.5, `MAIN "${r.label}" ${cr.toFixed(2)}:1 on its real background (≥ 4.5)`);
  });

  // ---- A7: the backdrop alone (no card) sits within ±8 L* of olive-800
  await page.evaluate(() => { document.querySelector('.mk-layer').style.visibility = 'hidden'; document.querySelector('.bd-emblem').style.visibility = 'hidden'; });
  // polish (art integration 2): the diorama now shows through an opening in the camo net, so A7 holds for the
  // blanket that frames it (the outer bands), and the whole frame stays dark enough for the badge and the text scrim
  const [bg, top, left, right] = await pixels(page, [[0, 0, 1280, 720], [0, 0, 1280, 50], [0, 0, 60, 720], [1220, 0, 60, 720]]);
  await page.evaluate(() => { document.querySelector('.mk-layer').style.visibility = ''; document.querySelector('.bd-emblem').style.visibility = ''; });
  const L = Lstar(bg), L800 = Lstar({ r: 0x20, g: 0x21, b: 0x13 });
  const Le = [top, left, right].map(Lstar);
  const viewing = await page.evaluate(() => document.querySelector('.bd').classList.contains('viewing'));
  t.log(`backdrop L* ${L.toFixed(1)} (frame ${Le.map((x) => x.toFixed(1))}) vs olive-800 ${L800.toFixed(1)}; mean rgb ${[bg.r, bg.g, bg.b].map(Math.round)}; diorama view ${viewing}`);
  t(Le.every((x) => Math.abs(x - L800) <= 8), 'A7: the camo frame within ±8 L* of olive-800');
  t(L <= 36, 'the diorama opening keeps the frame dark (mean L* ≤ 36)');
  t(viewing, 'the diorama still shows through the net opening');
  t(bg.g > bg.b + 6, 'the camo reads olive/moss (green over blue), not grey');

  // ---- S06b: tabs clear of the map sheet
  const rect = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
  const mapTable = async () => {
    await page.evaluate(`${HUD}.kit.close(); ${HUD}.screens.openMain(); ${HUD}.screens.openBEL(); ${HUD}.kit.activate(${HUD}.kit.top.rows.findIndex((r) => /MISSION SELECT/.test(r.label)))`);
    await page.waitForTimeout(450);
    // wait for the screen's slide-in transition to settle (it runs longer when the diorama frame is slow)
    for (let i = 0, prev = ''; i < 20; i++) {
      const cur = JSON.stringify([await rect('.mk-maptable .mk-mapsheet'), await rect('.mk-maptable .mk-footer')]);
      if (cur === prev) break;
      prev = cur; await page.waitForTimeout(120);
    }
    return { tabs: await rect('.mk-maptable .mk-tabs'), sheet: await rect('.mk-maptable .mk-mapsheet'), card: await rect('.mk-maptable .mk-mapcard'), foot: await rect('.mk-maptable .mk-footer') };
  };
  let m = await mapTable();
  t(m.tabs && m.tabs.h < 40, `campaign tabs are one line (${m.tabs?.h}px)`);
  t(!hit(m.tabs, m.sheet), 'tabs do not sit under the map sheet at 1280×720');
  const roles = await page.evaluate(() => [...document.querySelectorAll('.mk-maptable .mk-tabs [role=tab]')].map((b) => b.getAttribute('aria-selected')));
  t.equal(roles.join(','), 'true,false', 'campaign tabs are role=tab with aria-selected');
  const ys = await page.evaluate(() => [...document.querySelectorAll('.mk-mapcard .medals .mk-medal')].map((d) => d.getBoundingClientRect().y));
  t(ys.length === 9 && Math.max(...ys) - Math.min(...ys) < 6, `BEST discs stay on one line (${ys.map(Math.round)})`);

  // ---- phones
  await page.setViewportSize({ width: 400, height: 860 });
  await page.waitForTimeout(250);
  m = await mapTable();
  t(!hit(m.tabs, m.sheet), 'tabs do not sit under the map sheet at 400×860');
  t(!hit(m.card, m.foot), 'the mission card never covers the footer on a phone');
  t(m.foot && m.foot.y + m.foot.h <= 860 + 1 && m.foot.y >= 0, 'the (B)RIEFING / (S)TART footer is on screen');
  t(m.sheet && m.sheet.x >= 15 && m.sheet.x + m.sheet.w <= 385, 'the map sheet keeps the 16 px gutter');
  await page.evaluate(`${HUD}.kit.close(); ${HUD}.screens.openMain()`);
  await page.waitForTimeout(200);
  const hs = await page.evaluate(() => [...document.querySelectorAll('.mk-host .mk-card .mk-list .mk-row')].map((b) => b.getBoundingClientRect().height));
  t(hs.every((h) => h >= 44), `phone rows ≥ 44 px (${Math.min(...hs)})`);
  await page.evaluate(`import('./src/ui/options-panel.js').then((m) => m.openGroup(${HUD}, 'SOUND'))`);
  await page.waitForTimeout(300);
  for (let i = 0; i < 4; i++) await page.evaluate(`${HUD}.kit.key({ code: 'ArrowDown', key: 'ArrowDown', preventDefault() {} })`);
  const snd = await page.evaluate(() => {
    const d = document.querySelector('.mk-host .mk-card .mk-detail.on')?.getBoundingClientRect();
    const list = document.querySelector('.mk-host .mk-card .mk-list').getBoundingClientRect();
    return { d: d && { x: d.x, y: d.y, w: d.width, h: d.height }, list: { x: list.x, y: list.y, w: list.width, h: list.height } };
  });
  t(snd.d && !hit(snd.d, snd.list), 'SOUND detail pane docks clear of the rows on a phone');
  await t.shot('ui-layout-phone-sound');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(`${HUD}.kit.close()`);
}
