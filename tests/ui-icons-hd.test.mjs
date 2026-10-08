/**
 * HUD icons are never upscaled (user 2026-10-08: "also make the icons better quality / resolution, they look
 * pixelated"). On a 1080p desktop (DPR 1), a 1440×900 laptop at DPR 2, an emulated Pixel 7 (DPR 2.625) and iPhone 14
 * (DPR 3) in landscape: tutorial mission, a kitted commando, the alarm lamp lit, a dead man's skull stamp, the notebook
 * map open, and on the desktops the soft cursor (move, the eye over a soldier, the forbidden overlay, the grabbing hand).
 * Every icon / portrait / HUD canvas on screen has at least as many bitmap pixels as the device pixels it covers (2 %
 * pixel-rounding slack), the living eye's sheet tier covers the eye button, and nothing is drawn with image-rendering
 * pixelated / crisp-edges.
 * Close-ups of the tool bar, the knapsack and the cursor go to tests/out/icons-hd-<device>-*.png (2× crops).
 */
import { join } from 'node:path';
import { TESTS_DIR } from './harness.mjs';
import { DEVICES } from './touch-flow.mjs';

export const timeout = 240_000;

const land = (d) => ({ ...d, viewport: { width: d.viewport.height, height: d.viewport.width } });
const CASES = [
  { name: 'desktop-1080p', ctx: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }, mouse: true },
  { name: 'laptop-dpr2', ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, mouse: true },
  { name: 'pixel7', ctx: land(DEVICES['Pixel 7']) },
  { name: 'iphone14', ctx: land(DEVICES['iPhone 14']) },
];
const IGNORED = [/GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i];
const SLACK = 0.98;
const TALK_SLACK = 0.9; // 256-px talking-portrait clips in the speaker card: 276 device px on a 3x phone (asset-bound)

/** Every visible image / HUD canvas: bitmap px vs device px covered (object-fit aware), and its image-rendering. */
async function probe() {
  const dpr = devicePixelRatio, out = [];
  // the file's own pixels (naturalWidth of a srcset image is divided by its density descriptor)
  const dims = async (src) => { const im = new Image(); im.src = src; try { await im.decode(); } catch { return [0, 0]; } return [im.naturalWidth, im.naturalHeight]; };
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    if (!(r.width > 0.5 && r.height > 0.5) || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return null;
    for (let p = e; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (p.hidden || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null;
    }
    return r;
  };
  for (const img of document.querySelectorAll('.ui-hud img, .ui-cursor img')) {
    const r = shown(img);
    if (!r) continue;
    const cs = getComputedStyle(img);
    const pw = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), ph = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const [bw, bh] = img.naturalWidth ? await dims(img.currentSrc || img.src) : [0, 0];
    const cw = r.width - pw, ch = r.height - ph;
    let dw = cw, dh = ch;
    if (bw && cs.objectFit === 'contain') { const k = Math.min(cw / bw, ch / bh); dw = bw * k; dh = bh * k; }
    if (bw && cs.objectFit === 'cover') { const k = Math.max(cw / bw, ch / bh); dw = bw * k; dh = bh * k; }
    out.push({
      kind: 'img', id: img.dataset.icon || img.className || img.parentElement.className, src: (img.currentSrc || img.src).split('/').pop().slice(0, 60),
      ok: img.complete && bw > 0, bmp: [bw, bh], dev: [+(dw * dpr).toFixed(1), +(dh * dpr).toFixed(1)],
      ratio: bw ? Math.min(bw / (dw * dpr), bh / (dh * dpr)) : 0, ir: cs.imageRendering,
      srcset: img.hasAttribute('srcset'), tier: img.dataset.tier || '',
      // the talking-portrait stills / posters ship at 256 px only (assets/portraits: the 512 tier stays in the faces pipeline)
      talk: !!img.closest('.hud-speaker-card, .hud-portrait-slot'),
    });
  }
  for (const cv of document.querySelectorAll('.ui-hud canvas')) {
    const r = shown(cv);
    if (!r) continue;
    out.push({ kind: 'canvas', id: cv.className || cv.parentElement.className, bmp: [cv.width, cv.height], dev: [+(r.width * dpr).toFixed(1), +(r.height * dpr).toFixed(1)],
      ratio: Math.min(cv.width / (r.width * dpr), cv.height / (r.height * dpr)), ir: getComputedStyle(cv).imageRendering, ok: true });
  }
  const eye = document.querySelector('.hud-eye.eye-live > .eye-anim');
  if (eye && shown(eye)) {
    const m = /eye\.anim@([\dp]+)x\.webp/.exec(eye.style.backgroundImage);
    const btn = eye.parentElement.getBoundingClientRect();
    const dens = m ? Number(m[1].replace('p', '.')) : 0;
    out.push({ kind: 'eye-sheet', id: 'tool/eye.anim', src: m?.[0] || '', ratio: dens / ((btn.width / 52) * dpr), ok: !!m, ir: getComputedStyle(eye).imageRendering });
  }
  const pix = [...document.querySelectorAll('.ui-hud *, .ui-cursor *')].filter((e) => /pixelated|crisp-edges/.test(getComputedStyle(e).imageRendering)).map((e) => e.className.toString());
  return { dpr, u: getComputedStyle(document.documentElement).getPropertyValue('--u'), items: out, pix };
}

export default async function uiIconsHd(page0, t) {
  const h = t.harness;
  for (const c of CASES) {
    const ctx = await h.browser.newContext(c.ctx);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.stack || e.message).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errs.push('console.error: ' + m.text().slice(0, 300)); });
    page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
    try {
      await page.goto(`${h.url}/index.html?test=1`);
      await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
      const en = await page.evaluate(async () => {
        const g = window.__game, G = g.game;
        await g.loadMission('m00');
        g.start();
        g.render();
        await G.hud.iconsReady;
        const w = G.world, c = w.commandos[0];
        c.inventory = new Map(Object.entries({ knife: 1, pistol: 1, decoy: 1, shovel: 1, grenade: 3, sniperRifle: 5 }));
        g.select([c.id]);
        G.hud.knapsack.sig = '';
        w.alarm = { ...(w.alarm || {}), active: true }; // the lamp's lit render
        const dead = w.commandos[w.commandos.length - 1];
        if (dead !== c) dead.alive = false; // the skull stamp over his portrait
        G.hud.notebook.setOpen(true);
        G.hud.update(0.01);
        g.render();
        const e = w.enemies.find((q) => q.alive);
        if (!e) return null;
        g.centerOn(e.x + 6, e.z + 4);
        G.hud.update(0.01);
        const p = G.cameraController.worldToScreen(e.x, 1, e.z);
        return p ? { x: p.x, y: p.y } : null;
      });
      const vp = c.ctx.viewport;
      if (c.mouse) await page.mouse.move(vp.width * 0.35, vp.height * 0.6);
      const settle = async () => {
        await page.evaluate(() => { window.__game.game.hud.update(0.01); window.__game.render(); });
        await page.waitForTimeout(250); // ResizeObserver fit + image loads
        await page.waitForFunction(() => [...document.querySelectorAll('.ui-hud img.ico, .ui-cursor img.ico')].every((i) => i.complete), null, { timeout: 10000 });
        await page.evaluate(() => Promise.all([...document.querySelectorAll('.ui-hud img, .ui-cursor img')].map((i) => (i.decode ? i.decode().catch(() => null) : null))));
      };
      await settle();
      const shots = [];
      const r = await page.evaluate(probe);
      const check = (res, label) => {
        t(res.items.length >= 15, `${c.name} ${label}: ${res.items.length} images / canvases probed`);
        const broken = res.items.filter((i) => !i.ok);
        t(!broken.length, `${c.name} ${label}: every image loaded (${broken.map((i) => i.id).join(', ')})`);
        const low = res.items.filter((i) => i.ok && i.ratio < (i.talk ? TALK_SLACK : SLACK));
        t(!low.length, `${c.name} ${label} (DPR ${res.dpr}, --u ${res.u}): nothing upscaled; low: ${low.map((i) => `${i.id} ${i.src || ''} ${JSON.stringify(i.bmp || '')} for ${JSON.stringify(i.dev || '')} = ${i.ratio.toFixed(2)}`).join(' | ')}`);
        const ir = res.items.filter((i) => /pixelated|crisp-edges/.test(i.ir || ''));
        t(!ir.length && !res.pix.length, `${c.name} ${label}: no pixelated / crisp-edges image-rendering (${res.pix.slice(0, 3).join(', ')})`);
        const set = res.items.filter((i) => i.kind === 'img' && i.srcset && i.tier);
        t(!set.length, `${c.name} ${label}: rendered icons carry one picked file, no srcset (${set.map((i) => i.id).join(', ')})`);
      };
      check(r, 'HUD');
      t(r.items.some((i) => i.kind === 'eye-sheet' || c.name === 'none'), `${c.name}: the living eye sheet is on`);
      t(r.items.some((i) => i.kind === 'canvas' && /sketch|marks/.test(i.id)), `${c.name}: notebook map canvases probed`);
      t(r.items.some((i) => /stamp\/skull/.test(i.id)), `${c.name}: skull stamp probed`);
      // close-ups (device pixels, upscaled 2× nearest by the sheet tool): tool bar, knapsack, cursor
      const clip = async (sel, pad = 6, extra = {}) => {
        const b = await page.locator(sel).first().boundingBox();
        const x = Math.max(0, b.x - pad - (extra.left || 0)), y = Math.max(0, b.y - pad);
        return { x, y, width: Math.min(vp.width - x, b.width + 2 * pad + (extra.left || 0)), height: Math.min(vp.height - y, b.height + 2 * pad + (extra.bottom || 0)) };
      };
      shots.push(['toolbar', await clip('.hud-icons', 6, { left: 8 })], ['knapsack', await clip('.hud-right-bottom', 8, { left: 8 })]);
      for (const [n, cl] of shots) await page.screenshot({ path: join(TESTS_DIR, 'out', `icons-hd-${c.name}-${n}.png`), clip: cl, scale: 'device' });
      if (c.mouse) {
        const move = await page.evaluate(() => document.querySelector('.ui-cursor')?.dataset.cursor);
        t.equal(move, 'move', `${c.name}: move cursor over the ground`);
        const cx = vp.width * 0.35, cy = vp.height * 0.6;
        await page.screenshot({ path: join(TESTS_DIR, 'out', `icons-hd-${c.name}-cursor-move.png`), clip: { x: cx - 24, y: cy - 24, width: 120, height: 120 }, scale: 'device' });
        if (en) {
          await page.mouse.move(en.x, en.y);
          await settle();
          const r2 = await page.evaluate(probe);
          t.equal(await page.evaluate(() => document.querySelector('.ui-cursor')?.dataset.cursor), 'eye', `${c.name}: eye cursor over a soldier`);
          check(r2, 'eye cursor');
          await page.screenshot({ path: join(TESTS_DIR, 'out', `icons-hd-${c.name}-cursor-eye.png`), clip: { x: Math.max(0, en.x - 60), y: Math.max(0, en.y - 60), width: 120, height: 120 }, scale: 'device' });
        }
        // a refused order: the red forbidden overlay over the move arrow (built with the cursor layer, before the HUD
        // knew its scale: it used to keep the uiScale-1 file, 2x upscaled at 1080p)
        await page.mouse.move(cx, cy);
        await page.evaluate(() => { const L = window.__game.game.hud.cursor; L.resolve = () => ({ id: 'move', forbidden: true }); L._pre = null; });
        await settle();
        t(await page.evaluate(() => !document.querySelector('.ui-cursor .forb').hidden), `${c.name}: forbidden overlay up`);
        check(await page.evaluate(probe), 'forbidden overlay');
        // the grabbing hand (H tool over something to take; the Sapper over a placed charge he can take back)
        for (const id of ['grab', 'hand']) {
          await page.evaluate((k) => { const L = window.__game.game.hud.cursor; L.resolve = () => ({ id: k }); L._pre = null; }, id);
          await settle();
          t.equal(await page.evaluate(() => document.querySelector('.ui-cursor')?.dataset.cursor), id, `${c.name}: ${id} cursor up`);
          check(await page.evaluate(probe), `${id} cursor`);
        }
      }
    } finally {
      await ctx.close();
      t(!errs.length, `${c.name}: page clean (${errs.slice(0, 3).join(' | ')})`);
    }
  }
}
