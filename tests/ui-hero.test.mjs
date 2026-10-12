/**
 * Title splash hero (S03, src/ui/hero-art.js): on real screens the menu loads the hero variant at least as tall as the
 * viewport in device pixels (capped at the 2700 px master) — 720p, 1080p, 1440p, 4K, 1080p at 2x, a phone in portrait
 * and in landscape — and the wordmark, the tagline and the PRESS ANY KEY / TAP prompt never cover his face.
 */
import { HERO_FACE } from '../src/ui/hero-art.js';

export const timeout = 240_000;

const SCREENS = [
  ['720p', { width: 1280, height: 720 }, 1, false],
  ['1080p', { width: 1920, height: 1080 }, 1, false],
  ['1440p', { width: 2560, height: 1440 }, 1, false],
  ['4k', { width: 3840, height: 2160 }, 1, false],
  ['1080p@2x', { width: 1920, height: 1080 }, 2, false],
  ['phone-portrait', { width: 412, height: 915 }, 2.625, true],
  ['phone-landscape', { width: 915, height: 412 }, 2.625, true],
];

const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

export default async function uiHero(page, t) {
  for (const [name, viewport, dpr, touch] of SCREENS) {
    const ctx = await t.harness.browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: touch, hasTouch: touch });
    try {
      const p = await ctx.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      p.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
      await t.harness.openGame(p);
      await p.evaluate(() => window.shadowSix.hud.boot.showSplash({ ready: true }));
      await p.waitForFunction(() => { const i = document.querySelector('.bt-l.hero'); return i && i.complete && i.naturalHeight > 0; }, null, { timeout: 30000 });
      await p.waitForTimeout(700);
      const r = await p.evaluate((F) => {
        const i = document.querySelector('.bt-l.hero');
        const b = i.getBoundingClientRect();
        const s = Math.min(b.width / i.naturalWidth, b.height / i.naturalHeight);    // object-fit: contain
        const w = i.naturalWidth * s, h = i.naturalHeight * s;
        const x = b.x + (b.width - w) / 2, y = b.y + (b.height - h);                // object-position: 50% 100%
        const face = { x0: x + F.x0 * w, x1: x + F.x1 * w, y0: y + F.y0 * h, y1: y + F.y1 * h };
        const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const q = e.getBoundingClientRect(); return { x0: q.x, x1: q.right, y0: q.y, y1: q.bottom, sel }; };
        return { src: i.currentSrc, nat: i.naturalHeight, innerH: innerHeight, dpr: devicePixelRatio, face,
          texts: [box('.bt-wordmark'), box('.bt-tagline'), box('.bt-prompt span')].filter(Boolean),
          svg: i.classList.contains('svg') };
      }, HERO_FACE);
      const need = Math.min(2700, Math.round(r.innerH * r.dpr));
      const m = /hero-(\d+)\.(avif|webp)/.exec(r.src);
      t(!r.svg && m, `${name}: a raster hero variant loaded (${r.src})`);
      t.equal(+m[1], r.nat, `${name}: the file name matches its pixel height`);
      t(r.nat >= need, `${name}: hero ${r.nat} px >= screen ${need} px (${r.innerH} css x ${r.dpr})`);
      t(r.nat < need * 1.6 || r.nat === 900, `${name}: no needlessly large variant (${r.nat} for ${need})`);
      const pad = 4;
      const face = { x0: r.face.x0 - pad, x1: r.face.x1 + pad, y0: r.face.y0 - pad, y1: r.face.y1 + pad };
      for (const b of r.texts) t(!overlap(face, b), `${name}: ${b.sel} clears the face (${JSON.stringify(b)} vs ${JSON.stringify(face)})`);
      t.log(name, `${r.nat}px ${m[2]}`, `face y ${r.face.y0.toFixed(0)}-${r.face.y1.toFixed(0)}`);
      await p.screenshot({ path: t.harness.shotPath(`ui-hero-${name.replace('@', '-')}.png`) });
      t(errs.length === 0, `${name}: no page errors ${errs.join('; ')}`);
    } finally {
      await ctx.close().catch(() => {});
    }
  }
}
