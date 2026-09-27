import { chromium } from '../../../../node_modules/playwright-core/index.mjs';
const [,, query, out] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto('http://127.0.0.1:8765/_vehtest.html?' + query);
try { await page.waitForFunction(() => window.__done, null, { timeout: 90000 }); } catch (e) { logs.push('TIMEOUT'); }
const info = await page.evaluate(() => ({ info: window.__info, errors: window.__errors }));
await page.screenshot({ path: out, type: 'jpeg', quality: 80 });
console.log(JSON.stringify(info), '\n' + logs.slice(0, 15).join('\n'));
await browser.close();
