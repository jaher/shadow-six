/**
 * The knapsack kit in the browser (user 2026-11-08: "Items should be in 3d hanging from backpack"; orchestrator: "a test
 * that items may overlap but each one's topmost visible region is clickable"). On a 1080p and a 768p desktop (DPR 1), a
 * 1440x900 laptop at DPR 2, a 3x laptop, and an emulated Pixel 7 (DPR 2.625) and iPhone 14 (DPR 3) held both ways, every
 * commando's knapsack in every mission kit (tests/knapsack-kits.mjs, single men and some pairs) is drawn: every item's
 * layer decodes, and every item has a region of its silhouette where the browser's own hit test (elementFromPoint, the
 * clip-path of its .hit) lands on it: overlapping kit never buries an item. The brass tags stay on the knapsack box and
 * apart. Tucked into the corner (user 2026-11-08: "If backpack can be a bit lower in the right bottom corner do so (in a
 * way no items goes out of screen at all)", then "Backpack itself should be in the same position for all commandos."):
 * the pack's rect on screen is the same for every kit and the occupant view (and, mirrored, after Tab); the union of
 * everything the knapsack draws (pack, every item and unit layer with its shadow, stencils, tags) is inside the viewport
 * for every kit, and the lowest kit comes within a few ref px of the bottom (the pack is as low as the worst kit allows);
 * also on a tablet. Close-ups go to tests/out/knapsack-layout-<device>-*.png.
 */
import { join } from 'node:path';
import { TESTS_DIR } from './harness.mjs';
import { DEVICES } from './touch-flow.mjs';
import { knapsackKits } from './knapsack-kits.mjs';

export const timeout = 900_000;

const land = (d) => ({ ...d, viewport: { width: d.viewport.height, height: d.viewport.width } });
const CASES = [
  { name: 'desktop-1080p', ctx: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 } },
  { name: 'desktop-768p', ctx: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 } },
  { name: 'laptop-dpr2', ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  { name: 'laptop-dpr3', ctx: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 3 } },
  { name: 'pixel7-land', ctx: land(DEVICES['Pixel 7']) },
  { name: 'pixel7-port', ctx: DEVICES['Pixel 7'] },
  { name: 'iphone14-land', ctx: land(DEVICES['iPhone 14']) },
  { name: 'iphone14-port', ctx: DEVICES['iPhone 14'] },
  { name: 'tablet-land', ctx: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' } },
];
const IGNORED = [/GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i];
const SHOTS = ['m14 sniper', 'm10 sapper', 'm00 greenberet', 'm01 driver', 'b00 spy', 'm03 spy + uniform', 'm02 diver'];

/** In the page: show `kit` in the knapsack; per item: decoded?, how many CSS px² of its silhouette hit-test to it; tags. */
async function measure(kit) {
  const g = window.__game, G = g.game, w = G.world, hud = G.hud;
  const { iconEntry } = await import('./src/ui/icon-art.js');
  const { inPolygon } = await import('./src/ui/knapsack-model.js');
  const men = w.commandos.slice(0, kit.units.length);
  w.commandos.forEach((c) => { c.selected = false; });
  kit.units.forEach((u, i) => {
    Object.assign(men[i], { role: u.role, inventory: new Map(Object.entries(u.inv)), disguised: false, remoteArmed: 0, bombsPlaced: [], decoyPlaced: false,
      buried: false, currentActionId: null, ...(u.state || {}) });
  });
  g.select(men.map((c) => c.id));
  hud.knapsack.sig = '';
  hud.update(0.01);
  for (let k = 0; k < 6; k++) {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const imgs = [...document.querySelectorAll('.hud-knapsack img')];
    await Promise.all(imgs.map((i) => (i.decode ? i.decode().catch(() => null) : null)));
    if (imgs.every((i) => i.complete && i.naturalWidth)) break;
  }
  const items = [...document.querySelectorAll('.hud-knapsack .pack > .item')];
  const out = [];
  for (const b of items) {
    const img = b.querySelector(':scope > img.ico'), e = iconEntry(b.dataset.icon), r = b.getBoundingClientRect(), p = e?.p || [];
    const poly = [];
    for (let i = 0; i + 1 < p.length; i += 2) poly.push([r.left + p[i] * r.width, r.top + p[i + 1] * r.height]);
    const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
    let own = 0, n = 0;
    const step = 1.5;
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) {
        if (!inPolygon(poly, x, y) || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        n++;
        if (document.elementFromPoint(x, y)?.closest?.('.hud-knapsack .item') === b) own++;
      }
    }
    out.push({ what: b.dataset.item, ok: !!img && img.complete && img.naturalWidth > 0, own: own * step * step, area: n * step * step });
  }
  const tags = [...document.querySelectorAll('.hud-knapsack .count, .hud-knapsack .rise-tag')].map((t) => {
    const q = t.getBoundingClientRect();
    return { what: t.closest('.item')?.dataset.item, r: { x: q.left, y: q.top, w: q.width, h: q.height } };
  });
  /** In the page: the union (client px) of everything the knapsack draws: each layer's content box (shadow included),
   *  the stencils and tags; and the viewport. */
  async function drawnBounds() {
    const { iconEntry: ie } = await import('./src/ui/icon-art.js');
    let b = null;
    const add = (x0, y0, x1, y1) => { b = b ? [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)] : [x0, y0, x1, y1]; };
    for (const img of document.querySelectorAll('.hud-knapsack img.ico')) {
      const e = ie(img.dataset.icon), r = img.getBoundingClientRect(), c = e?.c || [0, 0, 1, 1];
      if (!e?.o || !r.width) continue;
      add(r.left + c[0] * r.width, r.top + c[1] * r.height, r.left + c[2] * r.width, r.top + c[3] * r.height);
    }
    for (const t of document.querySelectorAll('.hud-knapsack .count, .hud-knapsack .rise-tag')) {
      const r = t.getBoundingClientRect();
      add(r.left, r.top, r.right, r.bottom);
    }
    const pa = document.querySelector('.hud-knapsack > .packart')?.getBoundingClientRect();
    return { b, vw: innerWidth, vh: innerHeight, pack: pa ? [pa.left, pa.top, pa.width, pa.height].map((v) => Math.round(v * 10) / 10) : null };
  }
  const p = document.querySelector('.hud-knapsack').getBoundingClientRect();
  return { mode: hud.knapsack.view?.mode, items: out, tags, pack: { x: p.left, y: p.top, w: p.width, h: p.height }, u: p.width / 112, drawn: await drawnBounds() };
}


const hit = (a, b) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;

export default async function knapsackLayoutTest(page0, t) {
  const h = t.harness;
  const all = knapsackKits();
  const singles = all.filter((k) => k.units.length === 1);
  const kits = [...singles, ...all.filter((k) => k.units.length > 1).filter((_, i) => i % 6 === 0)];
  for (const c of CASES) {
    const ctx = await h.browser.newContext(c.ctx);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.stack || e.message).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errs.push('console.error: ' + m.text().slice(0, 300)); });
    try {
      await page.goto(`${h.url}/index.html?test=1`);
      await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
      await page.evaluate(async () => {
        const g = window.__game;
        await g.loadMission('m00');
        g.start();
        g.render();
        await g.game.hud.iconsReady;
        document.querySelector('.rot-hint')?.setAttribute('hidden', ''); // portrait phones: the rotate hint dims the close-ups
        const st = document.createElement('style'); // measure the tucked kit where it settles, not mid-transition
        st.textContent = '.hud-knapsack, .hud-knapsack * { transition: none !important; }';
        document.head.appendChild(st);
        const w = g.game.world;
        w.commandos.forEach((m) => { m.hidden = false; m.state = m.state === 'inVehicle' ? 'idle' : m.state; });
      });
      const bad = [];
      let n = 0, tucked = 0, mirrored = 0;
      const { TUCK_MARGIN } = await page.evaluate(async () => ({ TUCK_MARGIN: (await import('./src/ui/knapsack.js')).TUCK_MARGIN }));
      const packAt = { right: null, left: null };
      let lowest = Infinity;
      const corner = (r, left, what) => { // the drawn kit on screen; the pack itself where it is for every other kit
        const { b, vw, vh, pack } = r.drawn;
        if (!b) return bad.push(`${what}: nothing drawn`);
        if (b[0] < -0.5 || b[1] < -0.5 || b[2] > vw + 0.5 || b[3] > vh + 0.5) bad.push(`${what}: kit off screen ${b.map((v) => v.toFixed(1))} in ${vw}x${vh}`);
        const k = left ? 'left' : 'right';
        packAt[k] ||= pack;
        if (JSON.stringify(pack) !== JSON.stringify(packAt[k])) bad.push(`${what}: the pack moved (${pack} vs ${packAt[k]})`);
        if (!left) lowest = Math.min(lowest, vh - b[3]);
      };
      for (const kit of kits) {
        const r = await page.evaluate(measure, kit);
        if (r.mode !== 'items') continue;
        n++;
        corner(r, false, kit.name);
        tucked++;
        const need = 12 * r.u * r.u; // at least ~12 ref px² of every item is its own (topmost) to click / tap
        for (const it of r.items) {
          if (!it.ok) bad.push(`${kit.name}: ${it.what} layer not decoded`);
          if (it.own < need) bad.push(`${kit.name}: ${it.what} clickable on ${(it.own / r.u / r.u).toFixed(1)} of ${(it.area / r.u / r.u).toFixed(0)} ref px²`);
        }
        const P = r.pack;
        for (const tg of r.tags) {
          const q = tg.r;
          if (q.x < P.x - 0.5 || q.y < P.y - 0.5 || q.x + q.w > P.x + P.w + 0.5 || q.y + q.h > P.y + P.h + 0.5) bad.push(`${kit.name}: ${tg.what} tag off the knapsack`);
        }
        for (let a = 0; a < r.tags.length; a++) for (let b = a + 1; b < r.tags.length; b++) {
          if (hit(r.tags[a].r, r.tags[b].r)) bad.push(`${kit.name}: ${r.tags[a].what} tag overlaps ${r.tags[b].what} tag`);
        }
        if (SHOTS.includes(kit.name)) { // Tab: the mirrored kit tucked into the bottom-left corner
          await page.evaluate(() => window.__game.game.hud.knapsack.swapSide());
          corner(await page.evaluate(measure, kit), true, `${kit.name} (Tab)`);
          await page.evaluate(() => window.__game.game.hud.knapsack.swapSide());
          await page.evaluate(measure, kit);
          mirrored++;
        }
        if (SHOTS.includes(kit.name)) {
          const b = await page.locator('.hud-knapsack').boundingBox();
          const x = Math.max(0, b.x - 40 * r.u), y = Math.max(0, b.y - 20 * r.u);
          await page.screenshot({ path: join(TESTS_DIR, 'out', `knapsack-layout-${c.name}-${kit.name.replace(/[^a-z0-9]+/gi, '-')}.png`),
            clip: { x, y, width: Math.min(page.viewportSize().width - x, b.x + b.width - x), height: Math.min(page.viewportSize().height - y, b.y + b.height - y) }, scale: 'device' });
        }
      }
      // the occupant view: only his photo, the pack where it always is
      const occ = await page.evaluate(async () => {
        const g = window.__game, G = g.game, c = G.world.commandos[0];
        G.world.commandos.forEach((m) => { m.selected = false; });
        c.hidden = false; c.state = 'idle';
        g.select([c.id]);
        c.hidden = true; c.state = 'hidden';
        G.hud.knapsack.sig = ''; G.hud.update(0.01);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const pa = document.querySelector('.hud-knapsack > .packart').getBoundingClientRect();
        c.hidden = false; c.state = 'idle';
        return { mode: G.hud.knapsack.view?.mode, pack: [pa.left, pa.top, pa.width, pa.height].map((v) => Math.round(v * 10) / 10) };
      });
      t(occ.mode === 'occupant' && JSON.stringify(occ.pack) === JSON.stringify(packAt.right), `${c.name}: occupant view, the pack where it always is (${occ.pack} vs ${packAt.right})`);
      const u = (await page.locator('.hud-knapsack').boundingBox()).width / 112;
      t(lowest <= (TUCK_MARGIN + 3) * u, `${c.name}: the pack is tucked as low as its lowest kit allows (that kit ${lowest.toFixed(1)} px off the bottom)`);
      t(n >= 50 && tucked === n && mirrored >= 5, `${c.name}: ${n} knapsacks measured (${mirrored} mirrored)`);
      t(!bad.length, `${c.name}: every item decodes and keeps a clickable region; tags on the box and apart; every kit on screen; the pack in one place (${bad.length}: ${bad.slice(0, 8).join(' | ')})`);
    } finally {
      await ctx.close();
      t(!errs.length, `${c.name}: page clean (${errs.slice(0, 3).join(' | ')})`);
    }
  }
}
