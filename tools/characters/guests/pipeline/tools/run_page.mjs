// node run_page.mjs <job.js> <outPrefix> [W H]   job default export: async (canvas, W, H) => ({count, render(i)->label})
import { chromium } from '<repo>/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const [,, job, outPrefix, W = '1600', H = '900'] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
page.on('console', m => { const t = m.text(); if (!/GPU stall|too many errors/.test(t)) console.log('[page]', t.slice(0, 600)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
const PORT = process.env.PORT || 8793;
await page.goto(`http://localhost:${PORT}/chars/guests/pipeline/web/page.html`);
await page.waitForFunction(() => window.__ready);
const url = `/chars/guests/pipeline/${job}?t=${Date.now()}`;
const ARGS = process.env.JOB_ARGS ? JSON.parse(process.env.JOB_ARGS) : {};
const n = await page.evaluate(async ({ url, W, H, ARGS }) => { window.__args = ARGS; const mod = await import(url); window.__job = await mod.default(document.getElementById('c'), +W, +H); return window.__job.count; }, { url, W, H, ARGS });
for (let i = 0; i < n; i++) {
  const label = await page.evaluate(async (i) => await window.__job.render(i), i);
  if (label === null) continue;
  const out = `${outPrefix}_${label ?? i}.png`;
  await page.locator('#c').screenshot({ path: out });
  console.log('wrote', out);
}
await browser.close();
