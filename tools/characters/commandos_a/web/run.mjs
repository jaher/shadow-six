// node run.mjs <job.js rel to anim_check> <outPrefix> [W H]  job: default async (canvas,W,H,args) => ({count, render(i)->label|null, result()->json})
import { chromium } from '<repo>/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const [,, job, outPrefix, W = '1600', H = '900'] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
page.on('console', m => { const t = m.text(); if (!/GPU stall|too many errors/.test(t)) console.log('[page]', t.slice(0, 400)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:8866/chars/commandos_a/web/page.html`);
await page.waitForFunction(() => window.__ready);
const url = `/chars/commandos_a/web/${job}?t=${Date.now()}`;
const ARGS = process.env.JOB_ARGS ? JSON.parse(process.env.JOB_ARGS) : {};
const n = await page.evaluate(async ({ url, W, H, ARGS }) => { const mod = await import(url); window.__job = await mod.default(document.getElementById('c'), +W, +H, ARGS); return window.__job.count || 0; }, { url, W, H, ARGS });
for (let i = 0; i < n; i++) {
  const label = await page.evaluate(async (i) => await window.__job.render(i), i);
  if (label === null) continue;
  const out = `${outPrefix}_${label ?? i}.png`;
  await page.locator('#c').screenshot({ path: out });
  console.log('wrote', out);
}
const res = await page.evaluate(async () => window.__job.result ? await window.__job.result() : null);
if (res) { fs.writeFileSync(outPrefix + '.json', JSON.stringify(res, null, 1)); console.log('wrote', outPrefix + '.json'); }
await browser.close();
