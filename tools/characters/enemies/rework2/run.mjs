// node run.mjs <argsJson> <outJson> [W H]  -- enemies rework harness (port 8871); job = ARGS.job (path under /chars/enemies/rework2/)
import { chromium } from '<repo>/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const [,, argsF, outF, W = '1000', H = '400'] = process.argv;
const F = '<claude-tmp>';
const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
page.on('console', m => { const t = m.text(); if (!/GPU stall|too many errors/.test(t)) console.log('[page]', t.slice(0, 6000)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:8871/chars/pipeline/web/page.html`);
await page.waitForFunction(() => window.__ready);
const ARGS = JSON.parse(fs.readFileSync(argsF, 'utf8'));
const n = await page.evaluate(async ({ W, H, ARGS }) => { window.__args = ARGS; const mod = await import('/chars/enemies/rework2/' + ARGS.job + '?t=' + Date.now()); window.__job = await mod.default(document.getElementById('c'), +W, +H); return window.__job.count; }, { W, H, ARGS });
const all = fs.existsSync(outF) && !ARGS.fresh ? JSON.parse(fs.readFileSync(outF, 'utf8')) : {};
const tdir = F + '/' + (ARGS.tiles || 'tiles'); fs.mkdirSync(tdir, { recursive: true });
for (let i = 0; i < n; i++) {
  const t0 = Date.now();
  try {
    const { label, res } = await page.evaluate(async (i) => await window.__job.render(i), i);
    if (label) await page.locator('#c').screenshot({ path: `${tdir}/${label}.png` });
    all[label || i] = res; fs.writeFileSync(outF, JSON.stringify(all));
    console.log('done', label, ((Date.now() - t0) / 1000).toFixed(1) + 's');
  } catch (e) { console.log('ERR', i, e.message.slice(0, 400)); }
}
await browser.close();
