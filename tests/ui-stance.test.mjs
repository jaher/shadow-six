/**
 * Stance button (user request: "an icon at the bottom left to the hand with the man crawling when upright and with the
 * man standing when crawling; click it to toggle standing and crawling"). M1 at 1080p: the button sits immediately
 * left of the hand on the hand's baseline, overlaps nothing in the bottom cluster, shows the crawling figure while the
 * Green Beret stands; a real mouse click lays him down (icon flips to the standing figure), a second click stands him
 * up; disabled with nothing selected; the old top-bar posture icon is gone. Then 1440p / 4K boxes, and an emulated
 * iPhone in landscape: a >= 44 CSS px target, and a real tap toggles stance without issuing a move order.
 */
const SHOTS = 'ui-stance';

async function boot(page) {
  await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m01'); g.start(); await G.mapHandle?.ready; await G.hud.portraitsReady;
    const gb = G.world.commandos.find((c) => c.role === 'greenberet');
    g.select([gb.id]);
    g.render();
  });
}

/** Button / hand / pack / notebook boxes + the Green Beret's stance and what the button shows. */
function probe(page) {
  return page.evaluate(() => {
    const G = window.__game.game;
    G.render(0, 1);
    const box = (s) => { const e = document.querySelector(s); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const gb = G.world.commandos.find((c) => c.role === 'greenberet');
    const b = document.querySelector('.hud-stance');
    const img = b?.querySelector(':scope > img.ico:not([hidden])');
    return {
      stance: gb.stance, x: gb.x, z: gb.z, moving: !!(gb.path && gb.path.length) || !!gb.moveTarget,
      to: b?.dataset.to, icon: img?.dataset.icon || img?.getAttribute('src') || '', state: b?.dataset.state, disabled: b?.getAttribute('aria-disabled'),
      tip: b?.dataset.tip || b?.getAttribute('title') || '',
      stanceBox: box('.hud-stance'), hand: box('.hud-hand'), pack: box('.hud-knapsack'), notebook: box('.hud-notebook'), transport: box('.hud-transport'),
      topPosture: !!document.querySelector('.hud-posture'), inTopbar: !!document.querySelector('.hud-topbar .hud-stance'),
      firstInCluster: document.querySelector('.hud-right-bottom').firstElementChild === b,
      vw: innerWidth, vh: innerHeight, scale: G.hud.scale,
    };
  });
}

const overlap = (a, b) => !!(a && b) && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;

function layout(t, p, tag) {
  t(p.stanceBox && p.hand, `${tag}: stance button and hand are on screen`);
  t(p.stanceBox.r <= p.hand.l + 1 && p.hand.l - p.stanceBox.r < 12 * p.scale, `${tag}: button is immediately left of the hand (${p.stanceBox.r} vs ${p.hand.l})`);
  t(Math.abs(p.stanceBox.b - p.hand.b) <= 8 * p.scale, `${tag}: button shares the hand's bottom baseline`);
  t(p.stanceBox.l >= 0 && p.stanceBox.b <= p.vh + 0.5 && p.stanceBox.r <= p.vw, `${tag}: inside the viewport`);
  for (const k of ['hand', 'pack', 'notebook', 'transport']) t(!overlap(p.stanceBox, p[k]), `${tag}: does not overlap ${k}`);
  t(p.stanceBox.h >= 0.6 * p.hand.h && p.stanceBox.w >= 0.9 * p.hand.w, `${tag}: about the hand's size (${p.stanceBox.w}x${p.stanceBox.h} vs ${p.hand.w}x${p.hand.h})`);
}

/** Advance the sim until the Green Beret's stance is `want` (stance change takes 0.5-0.6 s). */
async function settle(page, want) {
  return page.evaluate(async (want) => {
    const g = window.__game, G = g.game;
    const gb = G.world.commandos.find((c) => c.role === 'greenberet');
    for (let i = 0; i < 40 && gb.stance !== want; i++) g.advance(0.05);
    g.advance(0.7); // let the 0.5/0.6 s transition finish
    g.render();
    return gb.stance;
  }, want);
}

export default async function uiStance(page, t) {
  // ---------------------------------------------------------------- 1080p, mouse
  await page.setViewportSize({ width: 1920, height: 1080 });
  await boot(page);
  let p = await probe(page);
  layout(t, p, '1080p');
  t(!p.topPosture && !p.inTopbar, 'no posture/stance button left in the top bar');
  t(p.firstInCluster, 'stance button is first in the bottom-right cluster (left of the hand)');
  t(/LIE DOWN \/ STAND UP \(C \/ S\)/.test(p.tip), `tooltip "${p.tip}"`);
  t(p.stance === 'stand' && p.to === 'crawl' && /stance\.crawl/.test(p.icon), `standing: shows the crawling figure (${p.stance}, ${p.to}, ${p.icon})`);
  t(p.disabled === 'false', 'enabled with a man selected');
  await t.shot(`${SHOTS}-1080p-standing`);
  const c1 = p.stanceBox;
  await page.mouse.click(c1.l + c1.w / 2, c1.t + c1.h / 2);
  t((await settle(page, 'crawl')) === 'crawl', 'click: the Green Beret crawls');
  p = await probe(page);
  t(p.to === 'stand' && /stance\.stand/.test(p.icon), `crawling: shows the standing figure (${p.to}, ${p.icon})`);
  t(Math.abs(p.stanceBox.w - c1.w) < 0.5 && Math.abs(p.stanceBox.l - c1.l) < 0.5, 'toggle does not shift the layout');
  t(!p.moving, 'the click issued no move order');
  await page.mouse.move(5, 500); // hover off, so the shot shows the base state
  await t.shot(`${SHOTS}-1080p-crawling`);
  await page.mouse.click(c1.l + c1.w / 2, c1.t + c1.h / 2);
  t((await settle(page, 'stand')) === 'stand', 'second click: he stands up again');
  p = await probe(page);
  t(p.to === 'crawl' && /stance\.crawl/.test(p.icon), 'standing again: crawling figure back');
  // keyboard C / S still drive the same stance and the icon follows
  await page.keyboard.press('KeyC');
  t((await settle(page, 'crawl')) === 'crawl', 'C still lays him down');
  t((await probe(page)).to === 'stand', 'icon follows the keyboard');
  await page.keyboard.press('KeyS');
  t((await settle(page, 'stand')) === 'stand', 'S still stands him up');
  // nothing selected: disabled, a click does nothing
  await page.evaluate(() => { window.__game.select([]); window.__game.render(); });
  p = await probe(page);
  t(p.disabled === 'true' && p.state === 'disabled', `disabled with no selection (${p.disabled}, ${p.state})`);

  // ---------------------------------------------------------------- 1440p / 4K boxes
  for (const [w, h] of [[2560, 1440], [3840, 2160]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => { const G = window.__game.game; const gb = G.world.commandos.find((c) => c.role === 'greenberet'); window.__game.select([gb.id]); dispatchEvent(new Event('resize')); window.__game.render(); });
    layout(t, await probe(page), `${w}x${h}`);
  }

  // ---------------------------------------------------------------- phone landscape, touch
  const ctx = await t.harness.browser.newContext({
    viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  });
  const errs = [];
  try {
    const ph = await ctx.newPage();
    ph.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await ph.goto(`${t.harness.url}/index.html?test=1`);
    await ph.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
    await boot(ph);
    let q = await probe(ph);
    layout(t, q, 'phone');
    t(q.stanceBox.w >= 44 && q.stanceBox.h >= 44, `phone: tap target >= 44 CSS px (${q.stanceBox.w}x${q.stanceBox.h})`);
    const x0 = q.x, z0 = q.z;
    await ph.touchscreen.tap(q.stanceBox.l + q.stanceBox.w / 2, q.stanceBox.t + q.stanceBox.h / 2);
    t((await settle(ph, 'crawl')) === 'crawl', 'phone: a tap lays him down');
    q = await probe(ph);
    t(q.to === 'stand' && /stance\.stand/.test(q.icon), 'phone: icon flips to the standing figure');
    t(!q.moving && Math.hypot(q.x - x0, q.z - z0) < 0.05, 'phone: the tap issued no move order');
    await ph.screenshot({ path: t.harness.shotPath(`${SHOTS}-phone-crawling.png`) });
    await ph.touchscreen.tap(q.stanceBox.l + q.stanceBox.w / 2, q.stanceBox.t + q.stanceBox.h / 2);
    t((await settle(ph, 'stand')) === 'stand', 'phone: a second tap stands him up');
  } finally {
    await ctx.close();
  }
  t(!errs.length, `phone page errors: ${errs.join(' | ')}`);
}
