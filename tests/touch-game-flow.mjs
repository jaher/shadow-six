/**
 * Shared in-mission touch flow (touch-game-pixel7 / touch-game-iphone14): an emulated phone in landscape plays M00
 * with fingers only. TAP selects a commando and walks, DOUBLE TAP runs, ONE-FINGER DRAG pans (with momentum) and
 * never orders, TWO-FINGER PINCH zooms about the fingers' midpoint, the knife from the bag + a tap on a guard
 * orders the kill, LONG PRESS on a guard shows his cone, CANCEL and MENU work by tap; the mobile preset holds an
 * acceptable frame time; the notebook map is a tap toggle (tap opens, it stays open, tap closes; drag moves the view,
 * pinch zooms the sketch; never an order; nothing covers the open map); HELP fits a phone (every row on screen or
 * scrolled into view, EXIT by tap) in landscape and upright. Multi-touch goes through CDP Input.dispatchTouchEvent (src/input/touch-game.js).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEVICES } from './touch-flow.mjs';
import { ROOT } from './harness.mjs';

const IGNORED = [/GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i];

/** Open ?test=1 on an emulated phone (landscape) and return helpers. */
export async function openPhone(t, name) {
  const dev = { ...DEVICES[name] };
  dev.viewport = { width: dev.viewport.height, height: dev.viewport.width };
  const ctx = await t.harness.browser.newContext(dev);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e.message).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errs.push('console.error: ' + m.text().slice(0, 400)); });
  page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`${t.harness.url}/index.html?test=1`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  /** One finger from a to b in `steps` moves, `ms` apart; `hold` ms still before lifting. */
  const drag = async (a, b, steps = 8, ms = 16, hold = 0) => {
    await touch('touchStart', [a]);
    for (let k = 1; k <= steps; k++) {
      await touch('touchMove', [[a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]]);
      if (ms) await page.waitForTimeout(ms);
    }
    if (hold) await page.waitForTimeout(hold);
    await touch('touchEnd', []);
  };
  /** Two fingers: from distance d0 to d1 about midpoint m (horizontal pair), midpoint moving by mv. */
  const pinch = async (m, d0, d1, steps = 8, mv = [0, 0]) => {
    const pts = (d, k) => [[m[0] + mv[0] * k - d / 2, m[1] + mv[1] * k], [m[0] + mv[0] * k + d / 2, m[1] + mv[1] * k]];
    await touch('touchStart', [pts(d0, 0)[0]]);
    await touch('touchStart', pts(d0, 0));
    for (let k = 1; k <= steps; k++) {
      await touch('touchMove', pts(d0 + ((d1 - d0) * k) / steps, k / steps));
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', []);
  };
  const tapEl = async (sel) => {
    const box = await page.evaluate((s) => {
      const e = [...document.querySelectorAll(s)].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !x.closest('[hidden]'); });
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, sel);
    t(box, `${name}: "${sel}" is on screen`);
    await page.touchscreen.tap(box.x, box.y);
  };
  /** docs/screenshots/touch-game-<n>.jpg at CSS-pixel size (≤ 1000 px wide). */
  const shot = (n) => page.screenshot({ path: join(ROOT, 'docs', 'screenshots', `touch-game-${n}.jpg`), type: 'jpeg', quality: 72, scale: 'css' });
  return { ctx, page, errs, touch, drag, pinch, tapEl, shot, vp: dev.viewport };
}

/** Stage 1: phone + M00, tap select / tap walk / double-tap run. @returns the shared context for the next stages */
async function tapStage(t, name) {
  const tag = name.replace(/\s+/g, '').toLowerCase();
  const P = await openPhone(t, name);
  const { page, drag, pinch, tapEl, shot } = P;
  try {
    // M00 with the fuel guard on open ground west of the Green Beret (as tests/knife.test.mjs)
    const boot = await page.evaluate(async () => {
      const g = window.__game, G = g.game;
      await g.loadMission('m00');
      const w = G.world;
      for (const e of [...w.enemies]) if (e.tag !== 'guard_fuel') w.remove(e);
      const guard = w.enemies[0];
      guard.setPosition(16, 46, Math.PI);
      Object.assign(guard.post, { x: 16, z: 46, heading: Math.PI, scan: null });
      const gb = w.commandos.find((c) => c.role === 'greenberet');
      gb.setPosition(24, 46, Math.PI);
      g.start();
      g.setZoom(1);
      g.centerOn(24, 46);
      G.input.deselectAll();
      window.__orders = [];
      G.events.on('unit:order', ({ unit, order }) => window.__orders.push({ id: unit.id, role: unit.role, type: order.type, id2: order.id || null, run: !!order.run }));
      g.render();
      return { touch: document.documentElement.classList.contains('mk-touch'), preset: G.renderer.presetName, dpr: G.renderer.renderer.getPixelRatio(), devDpr: devicePixelRatio, gpu: G.renderer.stats?.()?.gpu || null };
    });
    t.log(tag, JSON.stringify(boot));
    t(boot.touch, `${tag}: touch mode`);
    t(boot.preset === 'medium' || boot.preset === 'low', `${tag}: a phone boots on a mobile preset (${boot.preset})`);
    t(boot.dpr <= 2 && boot.dpr < boot.devDpr, `${tag}: DPR capped (${boot.dpr} of ${boot.devDpr})`);
    const S = () => page.evaluate(() => {
      const G = window.__game.game, cam = G.cameraController, w = G.world;
      const gb = w.commandos.find((c) => c.role === 'greenberet'), guard = w.enemies[0];
      const scr = (e, y = 0.5) => cam.worldToScreen(e.x, y, e.z);
      return { gb: scr(gb), guard: scr(guard, 0.9), sel: G.input.selection.map((c) => c.role), orders: window.__orders.slice(), target: { x: cam.target.x, z: cam.target.z }, zoom: cam.zoom, targeting: G.input.targeting?.abilityId || null, state: G.state, cone: !!guard.coneVisible };
    });
    const tick = (s = 0.05) => page.evaluate((d) => { window.__game.advance(d); window.__game.render(); }, s);

    // --- TAP a commando selects him
    let s = await S();
    await page.touchscreen.tap(s.gb.x, s.gb.y);
    await tick();
    s = await S();
    t.equal(s.sel.join(), 'greenberet', `${tag}: tap on the Green Beret selects him`);
    await page.waitForTimeout(450); // past the double-tap window
    // --- TAP the ground walks (east of him, away from the guard)
    const ground = { x: s.gb.x + 70, y: s.gb.y + 20 };
    await page.touchscreen.tap(ground.x, ground.y);
    await tick();
    s = await S();
    const walk = s.orders.filter((o) => o.type === 'move');
    t(walk.length === 1 && !walk[0].run, `${tag}: tap on the ground walks (${JSON.stringify(s.orders)})`);
    await page.waitForTimeout(450);
    // --- DOUBLE TAP runs
    await page.touchscreen.tap(ground.x + 40, ground.y);
    await page.waitForTimeout(60);
    await page.touchscreen.tap(ground.x + 46, ground.y + 4); // a finger lands a few px off: still a double tap
    await tick();
    s = await S();
    const mv = s.orders.filter((o) => o.type === 'move');
    t(mv.length === 3 && !mv[1].run && mv[2].run, `${tag}: double tap runs (${JSON.stringify(mv)})`);
    await shot(`${tag}-tap-walk`);
    await page.waitForTimeout(450);
    return { t, P, S, tick, tag, page, drag, pinch, tapEl, shot };
  } catch (e) {
    await P.ctx.close().catch(() => {});
    throw e;
  }
}

const groundAt = (page, x, y) => page.evaluate(([px, py]) => {
  const g = window.__game.game.cameraController.screenToGround(px, py);
  return g && { x: g.x, z: g.z };
}, [x, y]);

/** Wait (≤ 3.6 s) until the element's box stops moving: a loaded machine can starve the frames of a CSS transition. */
async function settle(page, sel) {
  for (let i = 0, prev = ''; i < 30; i++) {
    const cur = await page.evaluate((q) => { const r = document.querySelector(q)?.getBoundingClientRect(); return r ? [r.left, r.top, r.width, r.height].map(Math.round).join() : ''; }, sel);
    if (cur === prev) return;
    prev = cur;
    await page.waitForTimeout(120);
  }
}

/**
 * The open notebook's map on a phone: no HUD chrome intersects its page rect, and a grid of points over the page
 * hits the notebook itself (nothing drawn over it); the page is on screen. @returns {{covered: string[], hidden: number, page: object, inView: boolean}}
 */
const notebookClear = (page) => page.evaluate(() => {
  const nb = window.__game.game.hud.notebook, p = nb.page.getBoundingClientRect();
  const covered = [];
  for (const e of document.querySelectorAll('.hud-right-bottom > *, .hud-topbar, .hud-speaker-card, .touch-menu, .touch-cancel')) {
    if (e.closest('[hidden]')) continue;
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || !r.width || !r.height) continue;
    const ix = Math.min(r.right, p.right) - Math.max(r.left, p.left), iy = Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top);
    if (ix > 0.5 && iy > 0.5) covered.push(`${e.className.split(' ')[0]} ${Math.round(ix)}×${Math.round(iy)}`);
  }
  let hidden = 0;
  const over = new Set();
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
    const x = p.left + 2 + ((p.width - 4) * i) / 8, y = p.top + 2 + ((p.height - 4) * j) / 8, h = document.elementFromPoint(x, y);
    if (!h || !nb.root.contains(h)) { hidden++; over.add(`${h ? h.className || h.tagName : 'none'}@${Math.round(x)},${Math.round(y)}`); }
  }
  return { covered, hidden, over: [...over].slice(0, 6), page: { w: Math.round(p.width), h: Math.round(p.height), top: Math.round(p.top), bottom: Math.round(p.bottom) },
    inView: p.left >= 0 && p.top >= 0 && p.right <= innerWidth && p.bottom <= innerHeight };
});

/**
 * HELP on a phone (src/ui/help.js, styles/menus-screens.css html.mk-touch .mk-help): on both CONTROLS pages every row
 * is on screen, or scrolls into view inside its paper, uncovered; a finger drag scrolls the paper; the index tabs,
 * PREV / NEXT and EXIT are on screen and finger-sized; NEXT turns the page; EXIT (a tap) closes it and the game resumes.
 */
async function helpFits(c, where) {
  const { t, tag, page, tapEl } = c;
  const L = `${tag} ${where}`;
  if (!(await page.evaluate(() => !!document.querySelector('.mk-host .mk-card.mk-help:not(.leaving)')))) {
    await tapEl('.hud-help');
    await page.waitForFunction(() => !!document.querySelector('.mk-host .mk-card:not(.leaving) .mk-keys'), null, { timeout: 5000 });
    await page.waitForTimeout(450);
  }
  await settle(page, '.mk-host .mk-card.mk-help:not(.leaving) .mk-spread');
  const audit = () => page.evaluate(() => {
    const card = document.querySelector('.mk-host .mk-card.mk-help:not(.leaving)'), W = innerWidth, H = innerHeight;
    const scroller = (e) => {
      for (let q = e.parentElement; q && q !== card; q = q.parentElement) if (/auto|scroll/.test(getComputedStyle(q).overflowY)) return q;
      return null;
    };
    const bad = [];
    let n = 0, scrolled = 0;
    for (const e of card.querySelectorAll('.mk-spread :is(.mk-letterhead, h4, dt, dd)')) {
      n++;
      const sc = scroller(e);
      if (sc) { // scroll the paper the way a finger would until the row shows
        const r0 = e.getBoundingClientRect(), v0 = sc.getBoundingClientRect();
        if (r0.bottom > v0.bottom) sc.scrollTop += r0.bottom - v0.bottom + 2;
        else if (r0.top < v0.top) sc.scrollTop -= v0.top - r0.top + 2;
        if (sc.scrollTop > 0) scrolled++;
      }
      const r = e.getBoundingClientRect(), v = sc ? sc.getBoundingClientRect() : { left: 0, top: 0, right: W, bottom: H };
      const inside = r.width > 0 && r.left >= Math.max(0, v.left) - 0.5 && r.right <= Math.min(W, v.right) + 0.5 && r.top >= Math.max(0, v.top) - 0.5 && r.bottom <= Math.min(H, v.bottom) + 0.5;
      const hit = document.elementFromPoint(r.left + Math.min(6, r.width / 2), r.top + r.height / 2);
      if (!inside || !(hit === e || e.contains(hit))) bad.push(`${e.tagName}:${e.textContent.trim().slice(0, 16)} ${inside ? `covered by ${hit?.className || hit?.tagName}` : 'cut off'} @${Math.round(r.top)}`);
    }
    for (const q of card.querySelectorAll('*')) if (q.scrollTop) q.scrollTop = 0;
    const btn = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { w: Math.round(r.width), h: Math.round(r.height), on: r.left >= 0 && r.top >= 0 && r.right <= W && r.bottom <= H && (hit === e || e.contains(hit)) };
    };
    const ctl = [['exit', card.querySelector('.mk-hints .mk-touchbtn.back')], ['prev', card.querySelector('.mk-pagenav .prev')], ['next', card.querySelector('.mk-pagenav .next')],
      ...[...card.querySelectorAll('.mk-indextab')].map((e) => [e.textContent, e])].map(([k, e]) => [k, btn(e)]);
    return { n, bad, scrolled, pageNo: card.querySelector('.mk-pageno')?.textContent, ctl: Object.fromEntries(ctl), html: document.documentElement.scrollTop + document.body.scrollTop };
  });
  for (const pg of ['1 / 2', '2 / 2']) {
    const a = await audit();
    t.log(L, 'help', pg, JSON.stringify({ n: a.n, scrolled: a.scrolled, ctl: a.ctl }));
    t.equal(a.pageNo, pg, `${L}: HELP CONTROLS page ${pg}`);
    t(a.n >= 12 && !a.bad.length, `${L}: HELP ${pg}: all ${a.n} rows are on screen or scroll into view, uncovered (${a.bad.slice(0, 6).join(' | ')})`);
    const small = Object.entries(a.ctl).filter(([, v]) => !v || !v.on || v.w < 44 || v.h < 44);
    t(Object.keys(a.ctl).length === 6 && !small.length, `${L}: HELP ${pg}: tabs, PREV, NEXT and EXIT on screen and ≥ 44 px (${JSON.stringify(small)})`);
    t.equal(a.html, 0, `${L}: the page itself never scrolls`);
    if (pg === '1 / 2') {
      // a finger drag up on the paper that holds the last row scrolls it (native, with momentum)
      const sc = await page.evaluate(() => {
        const card = document.querySelector('.mk-host .mk-card.mk-help:not(.leaving)');
        const last = [...card.querySelectorAll('.mk-spread dd')].at(-1);
        let q = last.parentElement;
        while (q && q !== card && !/auto|scroll/.test(getComputedStyle(q).overflowY)) q = q.parentElement;
        if (!q || q === card) return null;
        q.dataset.probe = '1';
        const r = q.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height * 0.7, room: q.scrollHeight - q.clientHeight };
      });
      if (sc && sc.room > 4) {
        await c.drag([sc.x, sc.y], [sc.x, sc.y - Math.min(140, sc.room + 20)], 8, 16, 120);
        await page.waitForTimeout(300);
        const top = await page.evaluate(() => document.querySelector('[data-probe="1"]').scrollTop);
        t(top > Math.min(30, sc.room - 1), `${L}: a finger drag scrolls the HELP paper (scrollTop ${top} of ${sc.room})`);
        t.equal(await page.evaluate(() => document.querySelector('.mk-host .mk-pageno')?.textContent), '1 / 2', `${L}: scrolling does not turn the page`);
        await page.evaluate(() => { const q = document.querySelector('[data-probe="1"]'); q.scrollTop = 0; delete q.dataset.probe; });
      }
      await tapEl('.mk-host .mk-card.mk-help:not(.leaving) .mk-pagenav .next');
      await page.waitForFunction(() => document.querySelector('.mk-host .mk-card.mk-help:not(.leaving) .mk-pageno')?.textContent === '2 / 2', null, { timeout: 5000 });
      await page.waitForTimeout(450);
      await settle(page, '.mk-host .mk-card.mk-help:not(.leaving) .mk-spread');
    }
  }
  await tapEl('.mk-host .mk-card.mk-help:not(.leaving) .mk-hints .mk-touchbtn.back');
  await page.waitForFunction(() => window.__game.game.state === 'playing' && !window.__game.game.hud.kit.active, null, { timeout: 5000 });
  t(true, `${L}: EXIT (a tap) closes HELP and the mission resumes`);
}

/** Stage 2: one-finger drag pans 1:1 (no order), a flick coasts, two fingers pinch-zoom about their midpoint. */
async function panZoomStage(c) {
  const { t, P, S, tag, page, drag, pinch, shot } = c;
  const { width: W, height: H } = P.vp;
  let s = await S();
  const n0 = s.orders.length, sel0 = s.sel.join();
  // --- slow drag (held still before lifting: no coast): the ground under the finger follows it
  const A = [W * 0.5, H * 0.55], B = [W * 0.5 - 120, H * 0.55 - 60];
  const g0 = await groundAt(page, ...A);
  await drag(A, B, 10, 16, 160);
  const g1 = await groundAt(page, ...B);
  s = await S();
  const d = Math.hypot(g1.x - g0.x, g1.z - g0.z);
  t.log(tag, 'pan', JSON.stringify({ g0, g1, d }));
  t(d < 0.35, `${tag}: one-finger drag moves the map with the finger (${d.toFixed(2)} m off)`);
  t.equal(s.orders.length, n0, `${tag}: dragging the map gives no order`);
  t.equal(s.sel.join(), sel0, `${tag}: dragging keeps the selection`);
  // --- flick: the map coasts after the finger lifts, then stops
  await drag([W * 0.7, H * 0.5], [W * 0.7 - 160, H * 0.5], 6, 12, 0);
  const coast = await page.evaluate(() => {
    const G = window.__game.game, cam = G.cameraController, out = [];
    for (let i = 0; i < 90; i++) { G.render(1 / 60, 1); out.push(cam.target.x); }
    return { a: out[0], b: out[20], end: out[89], prevEnd: out[80], v: { ...G.input.touch.velocity }, log: G.input.touch.log.slice(-3).map((e) => `${e.type}:${e.result}`) };
  });
  t.log(tag, 'coast', JSON.stringify(coast));
  t(Math.abs(coast.b - coast.a) > 0.2, `${tag}: a flick coasts (${(coast.b - coast.a).toFixed(2)} m in 20 frames)`);
  t(coast.v.x === 0 && Math.abs(coast.end - coast.prevEnd) < 1e-6, `${tag}: the coast stops`);
  s = await S();
  t.equal(s.orders.length, n0, `${tag}: a flick gives no order`);
  // --- a tap 80 ms after a flick only stops the coasting map (no walk into a guard's view)
  await drag([W * 0.7, H * 0.5], [W * 0.7 - 160, H * 0.5], 6, 12, 0);
  await page.waitForTimeout(80);
  await page.touchscreen.tap(W * 0.55, H * 0.6);
  await c.tick();
  s = await S();
  const stopLog = await page.evaluate(() => window.__game.game.input.touch.log.slice(-3).map((e) => `${e.type}:${e.result}`));
  t.log(tag, 'stop tap', JSON.stringify(stopLog));
  t.equal(s.orders.length, n0, `${tag}: the tap that stops a coast gives no order (${stopLog.join(', ')})`);
  t(stopLog.at(-1) === 'tap:stop', `${tag}: that tap is used up stopping the map`);
  await page.waitForTimeout(450);
  // --- pinch out (spread = zoom in) about a midpoint: the ground under it stays put
  await page.evaluate(() => { window.__game.setZoom(1); window.__game.centerOn(30, 46); });
  const M = [W * 0.42, H * 0.5];
  const m0 = await groundAt(page, ...M);
  await pinch(M, 100, 160);
  s = await S();
  const m1 = await groundAt(page, ...M);
  const dm = Math.hypot(m1.x - m0.x, m1.z - m0.z);
  t.log(tag, 'pinch out', JSON.stringify({ zoom: s.zoom, dm }));
  t(Math.abs(s.zoom - 1.6) < 0.06, `${tag}: spreading two fingers zooms in (zoom ${s.zoom.toFixed(3)}, want 1.6)`);
  t(dm < 0.3, `${tag}: pinch zoom keeps the ground under the fingers' midpoint (${dm.toFixed(2)} m)`);
  await shot(`${tag}-pinch-in`);
  // --- pinch in (fingers closer = zoom out)
  await pinch(M, 200, 100);
  s = await S();
  const m2 = await groundAt(page, ...M);
  t(Math.abs(s.zoom - 0.8) < 0.05, `${tag}: pinching zooms out (zoom ${s.zoom.toFixed(3)}, want 0.8)`);
  t(Math.hypot(m2.x - m0.x, m2.z - m0.z) < 0.3, `${tag}: zoom out about the midpoint too`);
  await shot(`${tag}-pinch-out`);
  // --- two fingers moving together pan
  const k0 = await groundAt(page, ...M);
  await pinch(M, 120, 120, 8, [80, 0]);
  const k1 = await groundAt(page, M[0] + 80, M[1]);
  t(Math.hypot(k1.x - k0.x, k1.z - k0.z) < 0.35, `${tag}: a two-finger drag pans with the fingers`);
  s = await S();
  t.equal(s.orders.length, n0, `${tag}: pinching gives no order`);
  t.equal(s.sel.join(), sel0, `${tag}: pinching keeps the selection`);
  await page.evaluate(() => { window.__game.setZoom(1); window.__game.centerOn(22, 46); window.__game.render(); });
}

/** Stage 2b: a pinch with one finger resting on the bag (either finger first) zooms; the bag finger presses nothing. */
async function hudPinchStage(c) {
  const { t, S, tag, page } = c;
  const reset = () => page.evaluate(() => { window.__game.setZoom(1); window.__game.centerOn(22, 46); window.__game.render(); });
  await reset();
  const bag = await page.evaluate(() => {
    const r = document.querySelector('.hud-knapsack .item[data-item="knife"]').getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  });
  const n0 = (await S()).orders.length;
  for (const mapFirst of [false, true]) {
    const z0 = (await S()).zoom;
    const B = (k) => [bag[0] - 200 - 12 * k, bag[1] - 40 - 4 * k];
    const pts = (k) => (mapFirst ? [B(k), bag] : [bag, B(k)]);
    await c.P.touch('touchStart', [pts(0)[0]]);
    await page.waitForTimeout(30);
    await c.P.touch('touchStart', pts(0));
    for (let k = 1; k <= 8; k++) { await c.P.touch('touchMove', pts(k)); await page.waitForTimeout(16); }
    await c.P.touch('touchEnd', []);
    await page.waitForTimeout(80);
    await c.tick();
    const s = await S();
    const how = mapFirst ? 'map finger first' : 'bag finger first';
    t(s.zoom > z0 * 1.3, `${tag}: a pinch with one finger on the bag zooms (${how}: zoom ${z0} → ${s.zoom.toFixed(3)})`);
    t.equal(s.targeting, null, `${tag}: the finger on the bag arms nothing (${how})`);
    t.equal(s.orders.length, n0, `${tag}: a pinch over the HUD gives no order (${how})`);
    await reset();
    await page.waitForTimeout(400);
  }
  // iOS Safari ignores user-scalable=no: the in-mission chrome must take no browser pinch (page zoom)
  const ta = await page.evaluate(() => ['.hud-topbar', '.hud-right-bottom', '.hud-knapsack', '.touch-menu'].map((q) => `${q}:${getComputedStyle(document.querySelector(q)).touchAction}`));
  t(ta.every((v) => v.endsWith(':none')), `${tag}: the HUD chrome takes no browser gestures (${ta.join(', ')})`);
  t(await page.evaluate(() => visualViewport.scale === 1 && scrollX === 0 && scrollY === 0), `${tag}: the page itself never zoomed or scrolled`);
}

/**
 * Stage 2c: the notebook minimap with a finger (src/ui/notebook-touch.js). A tap opens it and it stays open after the
 * finger lifts; a tap on it closes it again; a drag on the open map moves the view; a pinch zooms the sketch (never
 * the page); the dog-ear opens BRIEFING NOTES with one tap; none of it reaches the game map (no orders).
 * Pixel 7 writes docs/screenshots/notebook-tap-toggle.jpg (closed | open after the tap, finger lifted | closed again).
 */
async function notebookStage(c) {
  const { t, S, tag, page, tick } = c;
  await page.evaluate(() => { window.__game.setZoom(1); window.__game.centerOn(22, 46); window.__game.render(); });
  await page.waitForTimeout(400);
  const s0 = await S();
  const NB = () => page.evaluate(() => {
    const nb = window.__game.game.hud.notebook, r = nb.root.getBoundingClientRect(), p = nb.page.getBoundingClientRect();
    const cam = window.__game.game.cameraController;
    return { open: nb.open, cls: nb.root.classList.contains('open'), w: Math.round(r.width), page: { x: p.left + p.width / 2, y: p.top + p.height / 2, w: p.width, h: p.height },
      zoom: nb.zoom, notes: nb.notesOpen, cam: { x: cam.target.x, z: cam.target.z, zoom: cam.zoom }, fingers: nb.fingers.count, vv: visualViewport.scale };
  });
  const frames = [];
  const grab = async () => { if (/pixel/.test(tag)) frames.push((await page.screenshot({ type: 'png', scale: 'css' })).toString('base64')); };
  let n = await NB();
  t(!n.open && !n.cls, `${tag}: the notebook starts closed`);
  await grab();
  // --- TAP opens it, and it stays open after the finger lifts (> 2 s)
  await page.touchscreen.tap(n.page.x, n.page.y);
  await page.waitForTimeout(2200);
  await tick();
  n = await NB();
  t(n.open && n.cls && n.fingers === 0, `${tag}: a tap opens the notebook and it stays open 2.2 s after the finger lifted (${JSON.stringify({ open: n.open, w: n.w, fingers: n.fingers })})`);
  await page.evaluate(() => { const nb = window.__game.game.hud.notebook; nb.root.style.transition = 'none'; nb.update(); });
  await grab();
  // --- nothing covers the open map (the bag / hand / stance cluster sits below it on a phone in landscape)
  await settle(page, '.hud-notebook .page');
  const clear = await notebookClear(page);
  t.log(tag, 'open notebook', JSON.stringify(clear));
  t(!clear.covered.length && !clear.hidden && clear.inView, `${tag}: no HUD control covers the open notebook map (${JSON.stringify(clear)})`);
  t(clear.page.w >= 100 && clear.page.h >= 120, `${tag}: the open notebook map stays readable (${clear.page.w} × ${clear.page.h} px)`);
  await page.evaluate(() => { window.__game.game.hud.notebook.root.style.transition = ''; });
  // --- ONE-FINGER DRAG on the open map moves the view (the rectangle follows the finger); it stays open
  n = await NB();
  const cam0 = n.cam;
  await c.drag([n.page.x - 20, n.page.y], [n.page.x + 20, n.page.y + 10], 8, 16);
  await page.waitForTimeout(100);
  await tick();
  n = await NB();
  t(n.open && n.cam.x > cam0.x + 1 && n.cam.z > cam0.z, `${tag}: a drag on the open notebook moves the view east / south and keeps it open (${cam0.x.toFixed(1)},${cam0.z.toFixed(1)} → ${n.cam.x.toFixed(1)},${n.cam.z.toFixed(1)})`);
  // --- PINCH on the open notebook zooms the sketch, not the page or the game view
  const z0 = n.zoom, gz = n.cam.zoom;
  await c.pinch([n.page.x, n.page.y], 30, 70);
  await page.waitForTimeout(100);
  await tick();
  n = await NB();
  t(n.open && n.zoom > z0 * 1.5, `${tag}: a pinch on the open notebook zooms the sketch (${z0} → ${n.zoom.toFixed(2)}) and keeps it open`);
  t(n.cam.zoom === gz && n.vv === 1, `${tag}: the pinch zooms neither the game view (${gz} → ${n.cam.zoom}) nor the page (${n.vv})`);
  await page.evaluate(() => { window.__game.game.hud.notebook.setZoom(1); window.__game.centerOn(22, 46); window.__game.render(); });
  await page.waitForTimeout(450);
  // --- TAP again closes it, and it stays closed
  await page.touchscreen.tap(n.page.x, n.page.y);
  await page.waitForTimeout(800);
  await settle(page, '.hud-notebook .page'); // aim the next tap at the folded strip, not at a page still closing
  await tick();
  n = await NB();
  t(!n.open && !n.cls, `${tag}: a second tap on the open notebook closes it`);
  await page.waitForTimeout(400);
  await grab();
  // --- the dog-ear: one tap opens BRIEFING NOTES (the notebook opened by a tap first), a tap closes them
  await page.touchscreen.tap(n.page.x, n.page.y);
  await page.waitForTimeout(500);
  // (a loaded machine can starve frames: let the open transition finish before aiming at the dog-ear)
  const cornerAt = () => page.evaluate(() => { const r = window.__game.game.hud.notebook.corner.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  let corner = await cornerAt();
  for (let i = 0, prev = ''; i < 30 && JSON.stringify(corner) !== prev; i++) { prev = JSON.stringify(corner); await page.waitForTimeout(120); corner = await cornerAt(); }
  await page.touchscreen.tap(corner[0] + 2, corner[1] + 4);
  await page.waitForTimeout(300);
  n = await NB();
  t(n.notes, `${tag}: one tap on the dog-ear opens BRIEFING NOTES`);
  await page.touchscreen.tap(c.P.vp.width / 2, c.P.vp.height / 2);
  await page.waitForTimeout(300);
  n = await NB();
  t(!n.notes && (await page.evaluate(() => window.__game.game.state)) === 'playing', `${tag}: a tap closes the notes and the game resumes`);
  if (n.open) { await page.touchscreen.tap(n.page.x, n.page.y); await page.waitForTimeout(400); }
  // --- none of it reached the game map
  const s1 = await S();
  t.equal(s1.orders.length, s0.orders.length, `${tag}: taps / drags / pinches on the notebook give no order`);
  t.equal(s1.sel.join(), s0.sel.join(), `${tag}: the notebook leaves the selection alone`);
  t.equal(s1.targeting, null, `${tag}: the notebook arms nothing`);
  // --- the field manual (HELP) lists the touch gestures, the notebook tap toggle included, inside the card
  await c.tapEl('.hud-help');
  await page.waitForFunction(() => !!document.querySelector('.mk-host .mk-card:not(.leaving) .mk-keys'), null, { timeout: 5000 });
  await page.waitForTimeout(450);
  const help = await page.evaluate(() => {
    const card = document.querySelector('.mk-host .mk-card:not(.leaving)');
    const dd = [...card.querySelectorAll('.mk-keys dd')].find((d) => /TAP AGAIN CLOSES/.test(d.textContent));
    const h4 = [...card.querySelectorAll('h4')].map((h) => h.textContent);
    if (!dd) return { h4 };
    const r = dd.getBoundingClientRect(), hit = document.elementFromPoint(r.left + 4, r.top + r.height / 2);
    return { h4, text: dd.textContent, inView: r.bottom <= innerHeight && r.right <= innerWidth && r.width > 0, visible: dd === hit || dd.contains(hit) };
  });
  if (/pixel/.test(tag)) await c.shot(`${tag}-help-touch`);
  t(help.h4.includes('TOUCH') && !help.h4.includes('MOUSE') && help.inView && help.visible, `${tag}: HELP lists the TOUCH gestures and the notebook tap toggle, on screen (${JSON.stringify(help)})`);
  await helpFits(c, 'landscape');
  if (frames.length === 3) {
    const url = await page.evaluate(async (bs) => {
      const imgs = await Promise.all(bs.map((b) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = `data:image/png;base64,${b}`; })));
      // the right half of each frame (the notebook column), side by side, ≤ 1280 px wide
      const sw = Math.round(imgs[0].width * 0.5), sx = imgs[0].width - sw, sh = imgs[0].height;
      const k = Math.min(1, (1280 - 16) / (sw * 3)), w = Math.floor(sw * k), h = Math.round(sh * k);
      const cv = document.createElement('canvas');
      cv.width = w * 3 + 16;
      cv.height = h + 22;
      const g = cv.getContext('2d');
      g.fillStyle = '#111';
      g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = '#eee';
      g.font = 'bold 13px sans-serif';
      ['1. CLOSED', '2. TAP: OPEN (FINGER LIFTED 2 S AGO)', '3. TAP AGAIN: CLOSED'].forEach((s, i) => {
        g.drawImage(imgs[i], sx, 0, sw, sh, i * (w + 8), 22, w, h);
        g.fillText(s, i * (w + 8) + 4, 15);
      });
      return cv.toDataURL('image/jpeg', 0.8);
    }, frames);
    writeFileSync(join(ROOT, 'docs', 'screenshots', 'notebook-tap-toggle.jpg'), Buffer.from(url.split(',')[1], 'base64'));
  }
}

/** Stage 3b: phone upright: every HUD control a finger uses covers ≥ 44 × 44 CSS px (own box + touch pad); the open
 * notebook map is clear of the HUD; HELP fits (helpFits). */
async function portraitStage(c) {
  const { t, tag, page, tapEl, shot } = c;
  const { width: W, height: H } = c.P.vp;
  await page.setViewportSize({ width: H, height: W });
  await page.waitForTimeout(300);
  if (await page.evaluate(() => !document.querySelector('.rot-hint')?.hidden)) await tapEl('.rot-hint .rot-ok');
  await page.evaluate(() => window.__game.render());
  const m = await page.evaluate(async () => {
    const { nearestSlot } = await import('/src/ui/knapsack.js');
    const vis = (q) => [...document.querySelectorAll(q)].filter((e) => e.getBoundingClientRect().width > 0);
    // the area a tap reaches each control through: elementFromPoint (own box + ::after pads) or the bag's nearest slot
    const span = (e, test) => {
      const r = e.getBoundingClientRect();
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let y = Math.max(0, r.top - 30); y < r.bottom + 30; y++) for (let x = Math.max(0, r.left - 30); x < r.right + 30; x++) {
        if (test(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      }
      return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
    };
    const out = {};
    for (const e of vis('.hud-portrait, .hud-icon:not(.hud-lamp), .hud-hand, .touch-menu')) {
      out[e.dataset.role || e.className.split(' ').find((k) => k !== 'hud-icon') || e.className] = span(e, (x, y) => { const h = document.elementFromPoint(x, y); return h === e || e.contains(h); });
    }
    const kn = document.querySelector('.hud-knapsack'), kr = kn.getBoundingClientRect();
    const boxes = vis('.hud-knapsack button').map((b) => { const r = b.getBoundingClientRect(); return { el: b, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
    for (const b of boxes) {
      out[`item:${b.el.dataset.item}`] = span(b.el, (x, y) => x >= kr.left && x < kr.right && y >= kr.top && y < kr.bottom && nearestSlot(boxes, x, y) === b.el);
    }
    const k = boxes.find((b) => b.el.dataset.item === 'knife');
    return { out, gap: k && { x: (k.left + k.right) / 2, y: k.bottom + 4 } };
  });
  t.log(tag, 'portrait hit areas', JSON.stringify(m.out));
  const small = Object.entries(m.out).filter(([, v]) => v.w < 44 || v.h < 44);
  t(Object.keys(m.out).length >= 10 && !small.length, `${tag} portrait: every HUD control ≥ 44 × 44 px for a finger (${JSON.stringify(small)})`);
  await shot(`${tag}-portrait`);
  // a fingertip just off the knife slot (on the bag canvas) still takes the knife
  await page.touchscreen.tap(m.gap.x, m.gap.y);
  await page.evaluate(() => window.__game.render());
  t.equal(await page.evaluate(() => window.__game.game.input.targeting?.abilityId || null), 'knife', `${tag} portrait: a tap beside the knife slot arms the knife`);
  await tapEl('.touch-cancel');
  await page.waitForTimeout(450);
  // the notebook upright: a tap opens it clear of every control, a tap closes it
  const nbAt = await page.evaluate(() => { const r = window.__game.game.hud.notebook.page.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.touchscreen.tap(...nbAt);
  await page.waitForTimeout(600);
  await settle(page, '.hud-notebook .page');
  await page.evaluate(() => window.__game.render());
  const clear = await notebookClear(page);
  t.log(tag, 'portrait notebook', JSON.stringify(clear));
  t(await page.evaluate(() => window.__game.game.hud.notebook.open), `${tag} portrait: a tap opens the notebook`);
  t(!clear.covered.length && !clear.hidden && clear.inView, `${tag} portrait: no HUD control covers the open notebook map (${JSON.stringify(clear)})`);
  await page.touchscreen.tap(...nbAt);
  await page.waitForTimeout(600);
  t(await page.evaluate(() => !window.__game.game.hud.notebook.open), `${tag} portrait: a second tap closes it`);
  await page.waitForTimeout(400);
  await helpFits(c, 'portrait');
  await page.setViewportSize({ width: W, height: H });
  await page.waitForTimeout(300);
}

/** Stage 3: portraits, long press (cone), the eye tool, the knife from the bag + CANCEL, then knife the guard, MENU. */
async function hudStage(c) {
  const { t, S, tick, tag, page, tapEl, shot } = c;
  const flush = () => page.evaluate(() => window.__game.render());
  // --- portraits select by tap
  await tapEl('.hud-portrait[data-role="sniper"]');
  await tick();
  t.equal((await S()).sel.join(), 'sniper', `${tag}: tap on a portrait selects that man`);
  await page.waitForTimeout(400);
  await tapEl('.hud-portrait[data-role="greenberet"]');
  await tick();
  t.equal((await S()).sel.join(), 'greenberet', `${tag}: tap on the Green Beret's portrait`);
  await page.evaluate(() => { window.__game.centerOn(20, 46); window.__game.render(); });
  // --- long press on the guard: his vision cone (no order, no deselect)
  let s = await S();
  const n0 = s.orders.length;
  await c.P.touch('touchStart', [[s.guard.x, s.guard.y]]);
  await page.waitForTimeout(650);
  await flush(); // the per-frame touch update fires the long press
  await c.P.touch('touchEnd', []);
  await tick();
  s = await S();
  t(s.cone, `${tag}: long press on a guard shows his vision cone`);
  t.equal(s.orders.length, n0, `${tag}: a long press gives no order`);
  t.equal(s.sel.join(), 'greenberet', `${tag}: a long press keeps the selection`);
  await shot(`${tag}-longpress-cone`);
  // --- the eye tool by tap: tap the eye, tap the guard → cone off; CANCEL leaves the tool
  await tapEl('.hud-eye');
  await flush();
  t(await page.evaluate(() => window.__game.game.hud.cursor.mode === 'eye'), `${tag}: the eye tool arms by tap`);
  await page.waitForTimeout(400);
  await page.touchscreen.tap(s.guard.x, s.guard.y);
  await tick();
  t(!(await S()).cone, `${tag}: eye tool + tap on the guard toggles his cone`);
  await flush();
  await tapEl('.touch-cancel');
  t(await page.evaluate(() => !window.__game.game.hud.cursor.mode), `${tag}: CANCEL puts the eye tool away`);
  // --- knife from the bag; CANCEL puts it away; knife again + tap on the guard = the knife order
  await tapEl('.item[data-item="knife"]');
  await flush();
  t.equal((await S()).targeting, 'knife', `${tag}: the knife arms from the bag by tap`);
  t(await page.evaluate(() => !document.querySelector('.touch-cancel').hidden), `${tag}: CANCEL shows while an item is armed`);
  await shot(`${tag}-knife-armed`);
  await tapEl('.touch-cancel');
  await flush();
  t.equal((await S()).targeting, null, `${tag}: CANCEL disarms the knife`);
  await page.waitForTimeout(400);
  await tapEl('.item[data-item="knife"]');
  await flush();
  // a drag with the knife armed still only pans
  const { width: W, height: H } = c.P.vp;
  await c.drag([W * 0.3, H * 0.75], [W * 0.3 + 40, H * 0.75], 6, 12, 120);
  s = await S();
  t.equal(s.targeting, 'knife', `${tag}: panning keeps the knife armed`);
  t.equal(s.orders.length, n0, `${tag}: panning with the knife armed gives no order`);
  await page.waitForTimeout(400);
  await page.touchscreen.tap(s.guard.x, s.guard.y);
  await tick();
  s = await S();
  const kn = s.orders.filter((o) => o.type === 'ability' && o.id2 === 'knife');
  t(kn.length === 1, `${tag}: knife + tap on the guard orders the kill (${JSON.stringify(s.orders.slice(n0))})`);
  const kill = await page.evaluate(() => {
    const g = window.__game, guard = g.game.world.enemies[0];
    for (let i = 0; i < 200 && guard.alive; i++) g.advance(0.1);
    g.render();
    return { dead: !guard.alive };
  });
  t.log(tag, 'knife', JSON.stringify(kill));
  t(kill.dead, `${tag}: the Green Beret knifes the guard`);
  await shot(`${tag}-knifed`);
  // --- MENU by tap pauses; BACK resumes
  await flush();
  await tapEl('.touch-menu');
  await page.waitForFunction(() => document.querySelector('.mk-host .mk-card:not(.leaving)')?.dataset.card === 'main', null, { timeout: 5000 });
  t.equal((await S()).state, 'paused', `${tag}: MENU pauses the mission`);
  await page.waitForTimeout(300);
  await tapEl('.mk-host .mk-card:not(.leaving) .mk-touchbtn.back');
  await page.waitForFunction(() => window.__game.game.state === 'playing' && !window.__game.game.hud.kit.active, null, { timeout: 5000 });
}

/** Stage 4: the frame time at the mobile preset. */
async function perfStage(c) {
  const { t, tag, page } = c;
  const b = await page.evaluate(() => window.__game.bench(60));
  t.log(tag, 'bench', JSON.stringify({ preset: b.preset, wall: b.wallMedian, p95: b.wallP95, gpu: b.gpuMedian, size: b.size, pr: b.pixelRatio }));
  t(b.wallMedian < 33, `${tag}: ≥ 30 fps at the ${b.preset} preset (median ${b.wallMedian} ms)`);
}

/** The whole in-mission touch flow on one device (landscape). */
export async function playFlow(t, name) {
  const c = await tapStage(t, name);
  try {
    await panZoomStage(c);
    await hudPinchStage(c);
    await notebookStage(c);
    await hudStage(c);
    await portraitStage(c);
    await perfStage(c);
    t(!c.P.errs.length, `${c.tag}: no page errors (${c.P.errs.slice(0, 3).join(' | ')})`);
  } finally {
    await c.P.ctx.close().catch(() => {});
  }
}
