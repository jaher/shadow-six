// Kit review renderer. node render.mjs <asset.glb> [outdir] [--theater temperate] [--views game1,game2,close,front,top,detail]
// Starts its own static server, renders the views in headless Chromium (GPU), writes PNGs + <name>_sheet.jpg.
import { chromium } from '<repo>/node_modules/playwright-core/index.mjs';
import { spawn, execFileSync } from 'child_process'; import path from 'path'; import fs from 'fs';
const HERE = path.dirname(new URL(import.meta.url).pathname), KIT = '<claude-tmp>';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const glb = path.resolve(args[0]);
const name = path.basename(glb, '.glb');
const out = path.resolve(args[1] && !args[1].startsWith('--') ? args[1] : path.join(path.dirname(glb), 'review'));
fs.mkdirSync(out, { recursive: true });
const side = path.join(out, name + '.kit.json');
const port = 18960 + Math.floor(Math.random() * 900);
const srv = spawn('node', [path.join(HERE, 'server.mjs'), String(port)], { stdio: 'ignore' });
const kill = setTimeout(() => { srv.kill(); process.exit(3); }, 150000);
await new Promise(r => setTimeout(r, 400));
const VIEWS = {
  game1: ['game', { w: 960, h: 640, zoom: 1 }], game2: ['game', { w: 960, h: 640, zoom: 2 }],
  game05: ['game', { w: 960, h: 640, zoom: 0.5 }], close: ['close', { w: 960, h: 640 }],
  close_se: ['close_se', { w: 960, h: 640 }], detail: ['detail', { w: 960, h: 640 }],
  front: ['front', { w: 960, h: 520 }], top: ['top', { w: 760, h: 760, ao: false }],
  side_e: ['side_e', { w: 960, h: 640 }], side_w: ['side_w', { w: 960, h: 640 }],
  game1s: ['game', { w: 960, h: 640, zoom: 1, dz: 0.3 }], game2s: ['game', { w: 960, h: 640, zoom: 2, dz: 0.3 }],
};
const list = opt('views', 'game1,game2,close,front,top').split(',');
const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) console.log('page:', m.text()); });
  page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) console.log('HTTP', r.status(), r.url()); });
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto(`http://localhost:${port}/review.html?kit=${encodeURIComponent(KIT)}`);
  await page.waitForFunction(() => window.ready && window.setup);
  const info = await page.evaluate(a => window.setup(a), { glb: '/fs' + glb, sidecar: fs.existsSync(side) ? '/fs' + side : null,
    theater: opt('theater', 'temperate'), tone: opt('tone', 'agx'), sunEl: +opt('sun', 42), variant: opt('variant', null),
    fig: opt('fig', null) ? '/fs' + path.resolve(opt('fig', null)) : null, pose: opt('pose', null) ? JSON.parse(opt('pose', null)) : null });
  console.log('loaded', name, JSON.stringify(info));
  if (!fs.existsSync(side)) {                            // not a kit asset: derive and write a fallback sidecar
    const m = await page.evaluate(() => window.autoMeta());
    fs.writeFileSync(side, JSON.stringify(m, null, 1));
    await page.evaluate(m => { window.__K.S.meta = m; }, m);
    console.log('wrote fallback sidecar', side);
  }
  await page.waitForTimeout(1500);                       // textures
  const files = [];
  for (const v of list) {
    const [nm, o] = VIEWS[v];
    await page.setViewportSize({ width: o.w, height: o.h });
    await page.evaluate(([n, oo]) => window.view(n, oo), [nm, o]);
    const f = path.join(out, `${name}${opt('tag', '')}_${v}.png`);
    await page.locator('canvas').screenshot({ path: f });
    files.push(f);
  }
  if (args.includes('--lod')) {                         // LOD1/LOD2 at the zoom they are meant for (0.5x)
    for (const lv of [1, 2]) {
      const lg = glb.replace(/\.glb$/, `_lod${lv}.glb`);
      if (!fs.existsSync(lg)) continue;
      const p2 = await browser.newPage({ viewport: { width: 960, height: 640 } });
      await p2.goto(`http://localhost:${port}/review.html?kit=${encodeURIComponent(KIT)}`);
      await p2.waitForFunction(() => window.ready && window.setup);
      await p2.evaluate(a => window.setup(a), { glb: '/fs' + lg, sidecar: fs.existsSync(side) ? '/fs' + side : null, theater: opt('theater', 'temperate') });
      await p2.waitForTimeout(1200);
      await p2.evaluate(() => window.view('game', { w: 960, h: 640, zoom: 0.5 }));
      const f = path.join(out, `${name}_lod${lv}@05x.png`);
      await p2.locator('canvas').screenshot({ path: f });
      files.push(f);
      await p2.close();
    }
  }
  execFileSync('python3', [path.join(HERE, 'sheet.py'), path.join(out, `${name}${opt('tag', '')}_sheet.jpg`), name + opt('tag', '') + '  ' + JSON.stringify({ tris: info.tris, size: info.size.map(x => +x.toFixed(2)) }), ...files]);
  console.log('sheet', path.join(out, `${name}${opt('tag', '')}_sheet.jpg`));
} finally { await browser.close(); srv.kill(); clearTimeout(kill); }
