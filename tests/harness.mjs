/**
 * Browser test harness for SHADOW SIX (see ARCHITECTURE.md § Test API).
 *
 *   const h = await startHarness({ swiftshader: false });
 *   const page = await h.newPage();          // collects page errors / console.error / HTTP >= 400
 *   await h.openGame(page);                  // index.html?test=1, waits for body[data-ready="1"]
 *   ... page.evaluate(() => window.__game.loadMission('m00')) ...
 *   h.errors(page)                           // -> string[]
 *   await h.close();
 *
 * playwright-core falls back to the main checkout so the harness also works in git worktrees without node_modules.
 */
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(TESTS_DIR, '..');
export const OUT_DIR = join(TESTS_DIR, 'out');

const PW_LOCAL = join(ROOT, 'node_modules/playwright-core/index.mjs');
/** Fallback for git worktrees without node_modules: $PLAYWRIGHT_CORE, else the main checkout's copy. */
const PW_ABS = process.env.PLAYWRIGHT_CORE || (() => {
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(join(ROOT, '.git'), 'utf8')); // worktree: .git is a file
    if (m) return join(resolve(ROOT, m[1].trim()), '..', '..', '..', 'node_modules/playwright-core/index.mjs');
  } catch { /* not a worktree */ }
  return PW_LOCAL;
})();

/** Real GPU (RTX 5090 via ANGLE/OpenGL; the Vulkan flags lose the context on this driver). */
export const GPU_ARGS = ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'];
/** Software rendering fallback. */
export const SWIFTSHADER_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/** Locate a Chromium binary: $CHROME, else the newest cached playwright chromium. */
export function findChrome() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const base = join(os.homedir(), '.cache/ms-playwright');
  for (const v of ['chromium-1223', 'chromium-1148', 'chromium-1155']) {
    const p = join(base, v, 'chrome-linux64/chrome');
    if (existsSync(p)) return p;
  }
  return undefined; // let playwright decide
}

async function loadPlaywright() {
  const p = existsSync(PW_LOCAL) ? PW_LOCAL : PW_ABS;
  return import(pathToFileURL(p).href);
}

/** Console messages that are harmless noise (browser/driver chatter, not our code). */
const IGNORED = [/GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i];

/**
 * Start static server + headless Chromium.
 * @param {{swiftshader?: boolean, headless?: boolean, viewport?: {width:number,height:number}}} [opts]
 */
export async function startHarness(opts = {}) {
  const { startServer } = await import(pathToFileURL(join(ROOT, 'tools/serve.mjs')).href);
  const { chromium } = await loadPlaywright();
  const server = await startServer({ port: 0 });
  const args = opts.swiftshader ? SWIFTSHADER_ARGS : GPU_ARGS;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: findChrome(), headless: opts.headless !== false, args });
  } catch (e) {
    await server.close();
    throw e;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const viewport = opts.viewport || { width: 1280, height: 720 };
  const errMap = new WeakMap();
  const baseUrl = server.url.replace(/\/$/, '');

  const h = {
    url: baseUrl,
    browser,
    mode: opts.swiftshader ? 'swiftshader' : 'gpu',
    async newPage(vp = viewport, extra = {}) { // extra: more Playwright page options (deviceScaleFactor, …)
      const page = await browser.newPage({ viewport: vp, ...extra });
      const errs = [];
      errMap.set(page, errs);
      page.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e.message).slice(0, 600)));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (IGNORED.some((r) => r.test(t))) return;
        errs.push('console.error: ' + t.slice(0, 600));
      });
      page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
      page.on('crash', () => errs.push('page crashed'));
      return page;
    },
    errors(page) { return errMap.get(page) || []; },
    /** Open the game page (default test mode) and wait until main.js marks it ready. */
    async openGame(page, query = '?test=1') {
      await page.goto(`${baseUrl}/index.html${query}`);
      await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
      const lost = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
        return gl ? gl.isContextLost() : null;
      });
      if (lost) throw new Error('WebGL context lost (try --swiftshader)');
    },
    shotPath(name) { return join(OUT_DIR, name); },
    async close() {
      await browser.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
  return h;
}

/** Minimal assertion helper passed to tests as the 2nd argument. */
export function makeAssert(name) {
  const fail = (msg) => { throw new Error(`[${name}] ${msg}`); };
  const t = (cond, msg = 'assertion failed') => { if (!cond) fail(msg); };
  t.ok = t;
  t.equal = (a, b, msg) => { if (a !== b) fail(`${msg || 'equal'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
  t.near = (a, b, eps, msg) => { if (!(Math.abs(a - b) <= eps)) fail(`${msg || 'near'}: ${a} vs ${b} (±${eps})`); };
  t.log = (...a) => console.log(`    [${name}]`, ...a);
  return t;
}
