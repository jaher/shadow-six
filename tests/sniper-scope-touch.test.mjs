/**
 * Sniper scope on a touch screen. User 2026-11-09: "When i look at the sniper scope on the phone its just the lens
 * without the frame around it and the cross in the middle." The scope is a live 2x magnifier: render/scope-magnifier.js
 * draws the glass into the canvas, and the ring, the reticle (the cross) and the range read-out are DOM in the soft-cursor
 * layer (.ui-cursor, ui/cursor.js). Touch mode hides that layer (fingers do not hover: menus.css), which on a phone left
 * the glass bare. On three touch screens (a small phone, a Pixel-class phone, a foldable's inner screen: HUD scales
 * below 1, 1 and 1.5; real CDP touch events) with the Sniper's rifle armed:
 *  - a finger long-pressing a guard: the magnifier draws the glass under the finger and the ring and the reticle are
 *    rendered on it (not display:none, a real box, ring art loaded), centred on the finger within 1 px, 88 ref px × the
 *    HUD scale wide, the ring's outer edge 8 ref px past the glass radius; the range read-out is up; the opaque scope sprite
 *    and the forbidden overlay are not; the ring and the cross are really painted (the same screen with the layer hidden
 *    differs there); the long press fires nothing;
 *  - the Sniper out of the rifle's reach: the scope under the finger shows its no-shot state (mark, NO SHOT, no highlight),
 *    and the valid look again once the shot is possible (the armed cursor is refreshed each frame for a finger);
 *  - the finger lifts: the scope stays where it was; a finger dragging (the map pans under it) takes the scope along;
 *  - CANCEL (a tap) puts it away: no lens, no ring, no cross, the soft cursor hidden again;
 *  - after a normal tap (the selected Sniper walks) the plain cursor sprite is NOT shown on touch.
 * Saves tests/out/sniper-scope-touch-<phone|pixel|fold>.png (CSS px).
 */
import { stage } from './sniper-scope.test.mjs';
import { DEVICES } from './touch-flow.mjs';

export const timeout = 300_000;
const IGNORED = [/GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i];

/** [tag, emulated device (landscape)]: the HUD scale follows the viewport (ui-config computeUiScale, hud.js _applyScale). */
const SCREENS = [
  ['phone', { ...DEVICES['iPhone 14'], viewport: { width: 568, height: 320 }, deviceScaleFactor: 2 }], // narrow: scale < 1
  ['pixel', { ...DEVICES['Pixel 7'], viewport: { width: 915, height: 412 } }], // scale 1
  ['fold', { ...DEVICES['Pixel 7'], viewport: { width: 1104, height: 884 }, deviceScaleFactor: 2 }], // inner screen: scale 1.5
];

const rgb = (c) => (String(c).match(/[\d.]+/g) || [255, 255, 255]).slice(0, 3).map(Number);
const dark = (c) => { const [r, g, b] = rgb(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b < 40 && Math.max(r, g, b) - Math.min(r, g, b) < 24; };

async function onScreen(t, tag, dev) {
  const ctx = await t.harness.browser.newContext(dev);
  const errs = [];
  try {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e.message).slice(0, 400)));
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errs.push('console.error: ' + m.text().slice(0, 400)); });
    page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.goto(`${t.harness.url}/index.html?test=1`);
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    const frames = (n = 3) => page.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
    // (orders are queued and issued at the next sim step: the test game does not run its own clock)
    const tick = (d = 0.05) => page.evaluate((x) => { window.__game.advance(x); window.__game.render(); }, d);
    t(await page.evaluate(() => document.documentElement.classList.contains('mk-touch')), `${tag}: touch mode (html.mk-touch)`);

    // --- the Sniper, rifle armed, 14 m from a guard with a clear shot (the staging of sniper-scope.test.mjs)
    const { aim } = await stage(page, t);
    t(!aim.err, `${tag}: staged a valid sniper shot ${JSON.stringify(aim)}`);
    // (the stage centres the view between the two men: on a small screen the guard can fall off it. Put him in the middle.)
    const mid = await page.evaluate((id) => {
      const g = window.__game, G = g.game, en = G.world.entities.find((e) => e.id === id);
      g.centerOn(en.x, en.z);
      g.render();
      const p = G.cameraController.worldToScreen(en.x, (en.y || 0) + 0.9, en.z);
      G.input._updateTargetCursor(p.x, p.y);
      return { x: p.x, y: p.y, cursor: G.input.cursor };
    }, aim.id);
    t(mid.cursor !== 'forbidden' && mid.x > 60 && mid.x < dev.viewport.width - 60 && mid.y > 90 && mid.y < dev.viewport.height - 60, `${tag}: the guard is in the middle of the screen, a valid shot (${JSON.stringify(mid)})`);
    aim.x = mid.x;
    aim.y = mid.y;
    await page.evaluate(() => {
      const G = window.__game.game;
      window.__orders = [];
      G.events.on('unit:order', ({ unit, order }) => window.__orders.push({ id: unit.id, role: unit.role, type: order.type, ability: order.id || null }));
      G.events.on('shot', (p) => window.__orders.push({ type: 'shot', weapon: p.weapon }));
    });

    /** What the player sees of the scope layer right now (a box is all zero when the element is not rendered). */
    const ui = () => page.evaluate(() => {
      const G = window.__game.game, H = G.hud, cur = H.cursor, root = cur.root, L = cur.lens;
      const box = (e) => {
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, display: getComputedStyle(e).display };
      };
      const ringImg = L?.root.querySelector('img.ico[data-icon="cursor/scope.ring"]');
      const ret = L?.root.querySelector('.ret');
      return {
        scale: H.scale, cs: parseFloat(root.style.getPropertyValue('--cs')), cls: root.className, hidden: root.hidden, cursor: root.dataset.cursor,
        targeting: G.input.targeting?.abilityId || null, drawn: !!G.scopeMagnifier?.stats.drawn, orders: window.__orders.slice(),
        bad: root.classList.contains('bad'), target: G.scopeMagnifier?.stats.target ?? null,
        noShotMark: !!ret && getComputedStyle(ret.querySelector('.ns')).display !== 'none',
        gestures: G.input.touch.log.slice(-4).map((e) => `${e.type}:${e.result}`),
        glass: cur._lens ? { x: cur._lens.x, y: cur._lens.y, r: cur._lens.radius } : null,
        root: box(root), ring: box(ringImg), ringLoaded: !!ringImg && ringImg.complete && ringImg.naturalWidth > 0, ret: box(ret),
        rng: box(L?.rng), rngText: L?.rng.textContent || '', spr: box(cur.sprite), forb: box(cur.forb),
        ink: ret ? [...new Set([...ret.querySelectorAll('path, circle')].filter((n) => !n.closest('.ns')).flatMap((n) => { const cs = getComputedStyle(n); return [cs.stroke, cs.fill]; }).filter((c) => c && c !== 'none'))] : [],
      };
    });
    /** The scope's ring and cross, rendered, centred on (x, y) within 1 px. */
    const onPoint = (u, x, y, what) => {
      for (const [n, b] of [['ring', u.ring], ['reticle', u.ret]]) {
        t(b && b.display !== 'none' && b.w > 0 && b.h > 0, `${tag}: ${what}: the ${n} is rendered (${JSON.stringify(b)})`);
        t(Math.hypot(b.cx - x, b.cy - y) <= 1, `${tag}: ${what}: the ${n} is centred on the finger (${b.cx.toFixed(1)}, ${b.cy.toFixed(1)} vs ${x.toFixed(1)}, ${y.toFixed(1)})`);
      }
      t(u.drawn && /\blens\b/.test(u.cls) && u.glass && Math.hypot(u.glass.x - x, u.glass.y - y) <= 1, `${tag}: ${what}: the glass is drawn under it (${u.cls}, ${JSON.stringify(u.glass)})`);
    };

    // --- a finger long-presses the guard: down a few px off him, nudged onto him (the browser's pointermove), held past the
    // 550 ms long press (which does nothing with the rifle armed)
    await touch('touchStart', [[aim.x - 3, aim.y - 2]]);
    await touch('touchMove', [[aim.x, aim.y]]);
    await page.waitForTimeout(700);
    await frames(4);
    await tick();
    const u = await ui();
    const s = u.scale;
    t.log(`${tag}: ` + JSON.stringify({ scale: s, cs: u.cs, cls: u.cls, glass: u.glass, root: u.root?.display, ring: u.ring, ret: u.ret, rng: u.rngText, spr: u.spr?.display, gestures: u.gestures }));
    t.equal(u.targeting, 'sniper', `${tag}: the rifle is armed`);
    t(u.gestures.at(-1) === 'longpress:ignored', `${tag}: the finger is a long press, ignored with the rifle armed (${u.gestures})`);
    onPoint(u, aim.x, aim.y, 'long press');
    t(u.root.display !== 'none', `${tag}: the scope layer is not display:none on a touch screen (${u.root.display})`);
    t.near(u.glass.r, 36 * s, 0.01, `${tag}: the glass radius is 36 ref px × the HUD scale ${s}`);
    t.near(u.cs, s, 0.001, `${tag}: the cursor layer's --cs follows the HUD scale`);
    for (const [n, b] of [['ring', u.ring], ['reticle', u.ret]]) t(Math.abs(b.w - 88 * s) <= 1 && Math.abs(b.h - 88 * s) <= 1, `${tag}: the ${n} is 88 ref px × ${s} wide (${b.w.toFixed(1)} × ${b.h.toFixed(1)})`);
    t(u.ringLoaded, `${tag}: the ring art loaded`);
    t.near(u.ring.w / 2 - u.glass.r, 8 * s, 1, `${tag}: the ring frames the glass: outer edge 8 ref px past its radius (${(u.ring.w / 2).toFixed(1)} vs ${u.glass.r.toFixed(1)})`);
    t(u.ink.length > 0 && u.ink.every(dark), `${tag}: the reticle is near-black (${u.ink.join(' ')})`);
    t(u.rng && u.rng.w > 0 && /^\d+ m$/.test(u.rngText) && Math.abs(u.rng.cx - aim.x) <= 1, `${tag}: the range read-out "${u.rngText}" is up, over the glass`);
    t(u.spr.display === 'none' && u.spr.w === 0, `${tag}: the opaque scope sprite is not drawn over the glass (${u.spr.display})`);
    t(u.forb.display === 'none' && u.forb.w === 0, `${tag}: no forbidden overlay on a valid shot`);
    t.equal(u.orders.length, 0, `${tag}: the long press fires nothing (${JSON.stringify(u.orders)})`);

    // the ring and the cross are really painted: this region of the screen, then the same with the scope layer hidden (the
    // glass itself is the canvas's, so only the DOM ring and cross differ) — a bare lens would show no difference
    const R = 50 * s, vp = dev.viewport, x0 = Math.max(0, aim.x - R), y0 = Math.max(0, aim.y - R);
    const clip = { x: x0, y: y0, width: Math.min(vp.width, aim.x + R) - x0, height: Math.min(vp.height, aim.y + R) - y0 };
    const withDom = (await page.screenshot({ clip, scale: 'css' })).toString('base64');
    await page.screenshot({ path: t.harness.shotPath(`sniper-scope-touch-${tag}.png`), scale: 'css' });
    await page.evaluate(() => { window.__game.game.hud.cursor.root.style.visibility = 'hidden'; });
    await frames(2);
    const withoutDom = (await page.screenshot({ clip, scale: 'css' })).toString('base64');
    await page.evaluate(() => { window.__game.game.hud.cursor.root.style.visibility = ''; });
    const paint = await page.evaluate(async ({ a, b, cx, cy, s, w }) => {
      const load = async (x) => { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + x)).blob()); const c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d'); g.drawImage(bm, 0, 0); return g.getImageData(0, 0, bm.width, bm.height); };
      const A = await load(a), B = await load(b), k = A.width / w; // screenshot px per CSS px (1: scale 'css')
      const mean = (inside) => {
        let sum = 0, n = 0;
        for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
          const dx = (x + 0.5) / k - cx, dy = (y + 0.5) / k - cy, r = Math.hypot(dx, dy) / s; // ref px from the lens centre
          if (!inside(dx / s, dy / s, r)) continue;
          const i = (y * A.width + x) * 4;
          sum += (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2])) / 3;
          n++;
        }
        return n ? sum / n : 0;
      };
      return {
        ring: mean((x, y, r) => r >= 37.5 && r <= 42.5), // the ring's band (glass edge 36, ring edge 44)
        posts: mean((x, y, r) => r <= 36 && ((Math.abs(y) <= 1 && Math.abs(x) >= 15 && Math.abs(x) <= 34) || (Math.abs(x) <= 1 && y >= 15 && y <= 34))), // the reticle's heavy posts
        far: mean((x, y, r) => r >= 50), // far outside: the control (the same frame twice)
      };
    }, { a: withDom, b: withoutDom, cx: aim.x - clip.x, cy: aim.y - clip.y, s, w: clip.width });
    t.log(`${tag}: painted (mean |Δ| of the screen with / without the layer) ${JSON.stringify(paint, (k, v) => (typeof v === 'number' ? +v.toFixed(1) : v))}`);
    t(paint.ring > 25 && paint.ring > paint.far + 15, `${tag}: the ring is painted around the glass (Δ ${paint.ring.toFixed(1)} vs ${paint.far.toFixed(1)} outside)`);
    t(paint.posts > 25 && paint.posts > paint.far + 15, `${tag}: the reticle's posts are painted on the glass (Δ ${paint.posts.toFixed(1)} vs ${paint.far.toFixed(1)} outside)`);

    // --- the shot is refused (the Sniper 60 m from the guard, out of the rifle's reach): the scope under the finger shows
    // its no-shot state as it does under a mouse — the dark "no shot" mark, greyed NO SHOT range, no highlight, the glass told
    // to dim — and the valid look is back as soon as the shot is possible again (a finger does not hover: the layer reads it
    // each frame, where the scope is)
    const reach = (far) => page.evaluate(({ id, sx, sz, far }) => {
      const w = window.__game.game.world, sn = w.commandos.find((c) => c.role === 'sniper'), en = w.entities.find((e) => e.id === id);
      if (!far) { sn.x = sx; sn.z = sz; return; }
      const d = Math.hypot(sn.x - en.x, sn.z - en.z) || 1;
      sn.x = en.x + ((sn.x - en.x) / d) * 60;
      sn.z = en.z + ((sn.z - en.z) / d) * 60;
    }, { id: aim.id, sx: aim.sx, sz: aim.sz, far });
    await reach(true);
    await touch('touchMove', [[aim.x + 1, aim.y]]);
    await touch('touchMove', [[aim.x, aim.y]]);
    await frames(4);
    await tick();
    const nb = await ui();
    t.log(`${tag}: no shot ` + JSON.stringify({ cls: nb.cls, mark: nb.noShotMark, rng: nb.rngText, target: nb.target }));
    onPoint(nb, aim.x, aim.y, 'no shot');
    t(nb.bad && nb.noShotMark && nb.target === null, `${tag}: no shot: the no-shot state and the dark "no shot" mark in the glass, no highlight (${nb.cls}, mark ${nb.noShotMark}, target ${nb.target})`);
    t(/^NO SHOT · \d+ m$/.test(nb.rngText), `${tag}: no shot: the read-out says NO SHOT ("${nb.rngText}")`);
    await reach(false);
    await touch('touchMove', [[aim.x, aim.y + 1]]);
    await touch('touchMove', [[aim.x, aim.y]]);
    await frames(4);
    await tick();
    const again = await ui();
    t(!again.bad && !again.noShotMark && again.target === aim.id && /^\d+ m$/.test(again.rngText), `${tag}: a valid shot again: no mark, the guard highlighted, "${again.rngText}" (${again.cls})`);

    // --- the finger lifts: nothing fired, and the scope stays where the finger left it
    await touch('touchEnd', []);
    await frames(4);
    await tick();
    const up = await ui();
    t.equal(up.orders.length, 0, `${tag}: lifting the finger fires nothing (${JSON.stringify(up.orders)})`);
    t(up.targeting === 'sniper', `${tag}: the rifle is still armed`);
    onPoint(up, aim.x, aim.y, 'finger lifted');

    // --- a finger drags (the map pans under it, as always): the scope goes with it
    const A = [aim.x + 50 * s, aim.y + 25 * s], B = [aim.x - 35 * s, aim.y + 10 * s];
    await touch('touchStart', [A]);
    for (let k = 1; k <= 6; k++) {
      await touch('touchMove', [[A[0] + ((B[0] - A[0]) * k) / 6, A[1] + ((B[1] - A[1]) * k) / 6]]);
      await page.waitForTimeout(16);
    }
    await frames(4);
    const dr = await ui();
    t(dr.gestures.includes('pan:pan'), `${tag}: a one-finger drag pans the map (${dr.gestures})`);
    onPoint(dr, B[0], B[1], 'finger dragging');
    await page.waitForTimeout(200); // held still before lifting: no coast (a tap that lands on a coasting map only stops it)
    await touch('touchEnd', []);
    await page.waitForFunction(() => { const v = window.__game.game.input.touch.velocity; return !v.x && !v.y; }, null, { timeout: 5000 });
    await frames(2);
    t.equal((await ui()).orders.length, 0, `${tag}: the drag fires nothing`);

    // --- CANCEL (a tap) puts the rifle away: no lens, no ring, no cross, the soft cursor hidden again
    const cancel = await page.evaluate(() => { const b = document.querySelector('.touch-cancel'), r = b?.getBoundingClientRect(); return b && !b.hidden && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; });
    t(cancel, `${tag}: the CANCEL button is up while the rifle is armed`);
    await page.touchscreen.tap(cancel.x, cancel.y);
    await frames(4);
    const off = await ui();
    t(off.targeting === null && !off.drawn && !/\blens\b/.test(off.cls), `${tag}: CANCEL puts the scope away (${off.cls})`);
    t(off.root.display === 'none' && off.ring.w === 0 && off.ret.w === 0 && off.spr.w === 0, `${tag}: no ring, cross or sprite left on screen after it`);

    // --- a normal tap: the Sniper (selected) walks to the ground in front of him. The plain cursor sprite is never shown on a
    // touch screen. (On a small screen the Sniper can stand at the map's edge, under the HUD: he is selected, not tapped.)
    await page.waitForTimeout(450);
    const tp = await page.evaluate((id) => {
      const g = window.__game, G = g.game, sn = G.world.commandos.find((c) => c.role === 'sniper'), en = G.world.entities.find((e) => e.id === id);
      g.select([sn.id]);
      const gx = sn.x + (en.x - sn.x) * 0.35, gz = sn.z + (en.z - sn.z) * 0.35; // open ground between him and the guard
      g.centerOn(gx, gz);
      g.render();
      const b = G.cameraController.worldToScreen(gx, 0, gz);
      return { x: b.x, y: b.y };
    }, aim.id);
    t(tp.x > 20 && tp.x < dev.viewport.width - 20 && tp.y > 60 && tp.y < dev.viewport.height - 20, `${tag}: the ground in front of the Sniper is on screen (${JSON.stringify(tp)})`);
    await page.touchscreen.tap(tp.x, tp.y);
    await frames(2);
    await tick();
    await frames(2);
    const tap = await ui();
    const sel = await page.evaluate(() => window.__game.game.input.selection.map((c) => c.role).join());
    t.log(`${tag}: after the tap ` + JSON.stringify({ sel, gestures: tap.gestures, cursor: tap.cursor, cls: tap.cls, hidden: tap.hidden, root: tap.root.display, spr: tap.spr }));
    t(sel === 'sniper' && tap.gestures.at(-1) === 'tap:move', `${tag}: a tap on the ground walks the selected Sniper (${sel}, ${tap.gestures})`);
    t(!tap.hidden && tap.cursor && tap.cursor !== 'scope', `${tag}: the soft cursor layer is logically up with the plain "${tap.cursor}" cursor (so the touch rule is what hides it)`);
    t(tap.root.display === 'none' && tap.spr.w === 0 && tap.spr.h === 0 && tap.forb.w === 0 && !/\blens\b/.test(tap.cls), `${tag}: ... and the plain cursor sprite is not shown on a touch screen (${tap.root.display}, ${tap.cls})`);
    t.equal(errs.length, 0, `${tag}: no page errors ${errs.slice(0, 3).join(' | ')}`);
  } finally {
    await ctx.close().catch(() => {});
  }
}

export default async function sniperScopeTouch(page, t) {
  await page.evaluate(() => window.__game.game.stop()); // the desktop page is not the test: stop its loop so it does not compete
  for (const [tag, dev] of SCREENS) await onScreen(t, tag, dev);
}
