/**
 * Knapsack layout in the browser (user 2026-10-08: "The bullets of sniper rifle overlap gun?"): on a 1080p and a 768p
 * desktop (DPR 1), a 1440×900 laptop at DPR 2, a 3× laptop, and an emulated Pixel 7 (DPR 2.625) and iPhone 14 (DPR 3)
 * held both ways, every commando's knapsack in every mission kit (tests/knapsack-kits.mjs, single men and some pairs)
 * is drawn and measured: the drawn box of each item (the visible pixels of its render, read back from the image), each
 * count tag with the rounds / minis standing in it, and the DIG OUT tag never intersect each other (an item and its own
 * tag included) and stay on the pack. Close-ups of a few kits go to tests/out/knapsack-layout-<device>-*.png.
 */
import { join } from 'node:path';
import { TESTS_DIR } from './harness.mjs';
import { DEVICES } from './touch-flow.mjs';
import { knapsackKits } from './knapsack-kits.mjs';

export const timeout = 600_000;

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
];
const IGNORED = [/GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i];
const SHOTS = ['m14 sniper', 'm10 sapper', 'm00 sapper', 'm01 driver', 'b00 spy', 'm03 spy + uniform'];

/** In the page: show `kit` in the knapsack and return the drawn boxes (CSS px) of everything on the pack. */
async function measure(kit) {
  const g = window.__game, G = g.game, w = G.world, hud = G.hud;
  const men = w.commandos.slice(0, kit.units.length);
  w.commandos.forEach((c) => { c.selected = false; });
  kit.units.forEach((u, i) => {
    const c = men[i];
    Object.assign(c, { role: u.role, inventory: new Map(Object.entries(u.inv)), disguised: false, remoteArmed: 0, bombsPlaced: [], decoyPlaced: false,
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
  // visible pixels of a render (alpha > 0.02), as fractions of the image: read back once per file
  const cache = (window.__alphaBox ||= new Map());
  const alphaBox = async (url) => {
    if (cache.has(url)) return cache.get(url);
    const im = new Image();
    im.src = url;
    await im.decode();
    const cv = document.createElement('canvas');
    cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    const ctx = cv.getContext('2d');
    ctx.drawImage(im, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let x0 = cv.width, y0 = cv.height, x1 = 0, y1 = 0;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      if (d[(y * cv.width + x) * 4 + 3] > 5) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const f = x1 >= x0 ? [x0 / cv.width, y0 / cv.height, (x1 + 1) / cv.width, (y1 + 1) / cv.height] : [0, 0, 1, 1];
    cache.set(url, f);
    return f;
  };
  const drawn = async (el) => {
    const r = el.getBoundingClientRect();
    if (el.tagName !== 'IMG') return { x: r.left, y: r.top, w: r.width, h: r.height };
    const [a, b, c, d] = await alphaBox(el.currentSrc || el.src);
    return { x: r.left + a * r.width, y: r.top + b * r.height, w: (c - a) * r.width, h: (d - b) * r.height };
  };
  const union = (rs) => {
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
    return { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 };
  };
  const out = [];
  const items = [...document.querySelectorAll('.hud-knapsack .item')];
  for (const [i, b] of items.entries()) {
    const art = b.querySelector(':scope > img.ico, :scope > svg');
    if (art) out.push({ what: b.dataset.item, owner: i, r: await drawn(art) });
    const tag = b.querySelector(':scope > .count');
    if (tag) {
      const parts = [await drawn(tag)];
      for (const gl of tag.querySelectorAll('img, svg, i')) parts.push(await drawn(gl));
      out.push({ what: `${b.dataset.item} tag`, owner: i, r: union(parts) });
    }
    const rise = b.querySelector(':scope > .rise-tag');
    if (rise) out.push({ what: `${b.dataset.item} DIG OUT`, owner: i, r: await drawn(rise) });
  }
  const p = document.querySelector('.hud-knapsack').getBoundingClientRect();
  return { mode: hud.knapsack.view?.mode, n: items.length, things: out, pack: { x: p.left, y: p.top, w: p.width, h: p.height } };
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
        // the kit's men need not be the m00 crew: two commandos are enough (pairs)
        const w = g.game.world;
        w.commandos.forEach((m) => { m.hidden = false; m.state = m.state === 'inVehicle' ? 'idle' : m.state; });
      });
      const bad = [];
      let n = 0;
      for (const kit of kits) {
        const r = await page.evaluate(measure, kit);
        if (r.mode !== 'items') continue;
        n++;
        const T = r.things;
        for (const x of T) {
          const q = x.r, P = r.pack;
          if (q.x < P.x - 0.5 || q.y < P.y - 0.5 || q.x + q.w > P.x + P.w + 0.5 || q.y + q.h > P.y + P.h + 0.5) bad.push(`${kit.name}: ${x.what} off the pack`);
        }
        for (let a = 0; a < T.length; a++) for (let b = a + 1; b < T.length; b++) {
          if (hit(T[a].r, T[b].r)) bad.push(`${kit.name}: ${T[a].what} overlaps ${T[b].what}`);
        }
        if (SHOTS.includes(kit.name)) {
          const b = await page.locator('.hud-knapsack').boundingBox();
          await page.screenshot({ path: join(TESTS_DIR, 'out', `knapsack-layout-${c.name}-${kit.name.replace(/[^a-z0-9]+/gi, '-')}.png`), clip: b, scale: 'device' });
        }
      }
      t(n >= 50, `${c.name}: ${n} knapsacks measured`);
      t(!bad.length, `${c.name}: nothing on the pack overlaps (${bad.length}: ${bad.slice(0, 8).join(' | ')})`);
    } finally {
      await ctx.close();
      t(!errs.length, `${c.name}: page clean (${errs.slice(0, 3).join(' | ')})`);
    }
  }
}
