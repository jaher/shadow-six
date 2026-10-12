// node rasterize_svg.mjs <in.svg> <out.png> <W> <H> : render an SVG to PNG with the project's Playwright Chromium
// (the sky plate composite: sky.svg's gradient, turbulence clouds and smoke under the rendered ground plate)
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
const [src, out, W, H] = process.argv.slice(2);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const { chromium } = await import(pathToFileURL(join(repo, 'node_modules/playwright-core/index.mjs')).href);
const exe = process.env.CHROME || undefined;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
await page.goto(pathToFileURL(resolve(src)).href);
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
console.log('rasterized', out);
