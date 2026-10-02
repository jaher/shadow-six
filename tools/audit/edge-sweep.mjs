#!/usr/bin/env node
/**
 * Map-boundary sweep (user request 2026-10-01 "When i slide to the side I still can see the boundary of then the
 * terrain ends, extend it so I don't see the boundary at all"): drives the camera into every edge and corner of each
 * mission exactly the way a player can, and measures what shows past the map.
 *
 *  - views: Pixel 7 / iPhone 14 landscape (emulated phones, real one-finger drags + a fast fling with momentum and a
 *    pinch-out at the edge, via CDP touch events), 21:9, 16:9 1080p and 4:3 desktop (held arrow keys; corners also
 *    by mouse edge-scroll);
 *  - zoom: the player's minimum (0.5, or the map / apron floor) and the default (1); yaw: 0 / 15 / 45 (Options);
 *  - 8 pushes: 4 screen edges + 4 corners, each starting near that edge.
 *
 * Per frame: void % (scene background forced to magenta, read back), and from a grid of screen rays onto y = 0 the
 * share of the view past the apron (skirt %), inside the apron's outer settle band (fade %), and the farthest ground
 * reach past the map edge (m) against the apron width. Frames with void / skirt and the farthest-reaching frame per
 * mission × view are saved as JPEG (scene background restored), plus results.json / results.csv.
 *
 *   node tools/audit/edge-sweep.mjs [--missions m01,m02] [--views pixel7,iphone14,21x9,16x9,4x3] [--out DIR]
 *        [--yaws 0,15,45] [--zooms min,default] [--direct] [--outline]
 *   --direct   programmatic pushes straight into the clamp (no input; fast, same limit); with the `phones` / `desktops`
 *              view groups one load per mission covers several sizes (phone landscape / portrait, 32:9 … 5:4)
 *   --outline  saved frames carry the map edge as a dashed red line (where does the map end?)
 * Each mission gets a fresh page (several big maps in one emulated phone page lost its GPU process).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('node tools/audit/edge-sweep.mjs [--missions m01,..] [--views pixel7,iphone14,21x9,16x9,4x3 | phones,desktops] [--yaws 0,15,45] [--zooms min,default] [--direct] [--outline] [--out DIR]');
  process.exit(0);
}
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const { DEVICES } = await import(pathToFileURL(join(ROOT, 'tests/touch-flow.mjs')).href);

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const MISSIONS = arg('missions', Array.from({ length: 20 }, (_, i) => `m${String(i + 1).padStart(2, '0')}`).join(',')).split(',');
const VIEWS = {
  pixel7: { touch: 'Pixel 7', width: 863, height: 360 },
  iphone14: { touch: 'iPhone 14', width: 844, height: 390 },
  '21x9': { width: 2560, height: 1080 },
  '16x9': { width: 1920, height: 1080 },
  '4x3': { width: 1024, height: 768 },
  // --direct groups: one load per mission, several sizes (phones in a touch context: the phone HUD / top bar)
  phones: { touch: 'Pixel 7', width: 863, height: 360, sizes: [[932, 430], [863, 360], [390, 844]] },
  desktops: { width: 1920, height: 1080, sizes: [[3840, 1080], [1280, 1024]] },
};
const VIEW_KEYS = arg('views', Object.keys(VIEWS).join(',')).split(',');
const YAWS = arg('yaws', '0,15,45').split(',').map(Number);
const ZOOMS = arg('zooms', 'min,default').split(',');
const OUTLINE = process.argv.includes('--outline'); // saved frames: the map edge drawn as a dashed red line
const DIRECT = process.argv.includes('--direct'); // programmatic pushes straight into the clamp (fast; same limit)
const OUT = resolve(arg('out', join(ROOT, 'tests/out/edge-sweep')));
mkdirSync(OUT, { recursive: true });
// screen pushes: [sx, sy] (+x = toward screen-right, +y = toward screen-bottom)
const PUSHES = { L: [-1, 0], R: [1, 0], U: [0, -1], D: [0, 1], UL: [-1, -1], UR: [1, -1], DL: [-1, 1], DR: [1, 1] };

const IGNORED = [/GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i];
const results = [];
const saveJpeg = (name, url) => { writeFileSync(join(OUT, name), Buffer.from(url.split(',')[1], 'base64')); return name; };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** In-page: measure the current view (void, skirt, fade, reach); `img` → also return a JPEG of the real frame. */
async function measure(page, img) {
  return page.evaluate(async ({ img, outline }) => {
    const THREE = await import('three');
    const g = window.__game, G = g.game, cc = G.cameraController, R = G.renderer, scene = R.scene;
    const W = G.world.width, D = G.world.depth, A = cc.apron || 0, fade = 24;
    const bg0 = scene.background;
    scene.background = new THREE.Color(1, 0, 1);
    g.render();
    const cv = R.domElement, sw = 320, sh = Math.max(16, Math.round(320 * cv.height / cv.width));
    const c2 = document.createElement('canvas'); c2.width = sw; c2.height = sh;
    const ctx = c2.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(cv, 0, 0, sw, sh);
    const px = ctx.getImageData(0, 0, sw, sh).data;
    let nVoid = 0;
    // void rows/cols: where the magenta sits (screen side)
    const side = { l: 0, r: 0, t: 0, b: 0 };
    for (let k = 0, i = 0; k < px.length; k += 4, i++) {
      if (px[k] - px[k + 1] > 40 && px[k + 2] - px[k + 1] > 40 && px[k] > 150 && px[k + 2] > 150) {
        nVoid++;
        const x = i % sw, y = (i / sw) | 0;
        if (x < sw / 4) side.l++; if (x > sw * 3 / 4) side.r++; if (y < sh / 4) side.t++; if (y > sh * 3 / 4) side.b++;
      }
    }
    scene.background = bg0;
    let url = null;
    if (img) {
      g.render();
      if (outline) {
        const o = document.createElement('canvas'); o.width = cv.width; o.height = cv.height;
        const x2 = o.getContext('2d');
        x2.drawImage(cv, 0, 0);
        const k = cv.width / cc.width, ter = G.mapHandle?.terrain;
        const pts = [];
        const edge = (x0, z0, x1, z1) => { for (let i = 0; i <= 40; i++) { const x = x0 + (x1 - x0) * i / 40, z = z0 + (z1 - z0) * i / 40; pts.push(cc.worldToView(x, ter?.heightAt?.(x, z) ?? 0, z)); } };
        edge(0, 0, W, 0); edge(W, 0, W, D); edge(W, D, 0, D); edge(0, D, 0, 0);
        x2.strokeStyle = '#ff2020'; x2.lineWidth = 3; x2.setLineDash([12, 8]);
        x2.beginPath(); pts.forEach((p, i) => (i ? x2.lineTo(p.x * k, p.y * k) : x2.moveTo(p.x * k, p.y * k))); x2.stroke();
        url = o.toDataURL('image/jpeg', 0.72);
      } else url = cv.toDataURL('image/jpeg', 0.72);
    }
    // ground classification by screen rays (y = 0)
    const vw = cc.width, vh = cc.height, N = 48, M = Math.max(8, Math.round(N * vh / vw));
    let nSk = 0, nFade = 0, nApr = 0, reach = 0, tot = 0;
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < N; i++) {
        const p = cc.screenToGround(((i + 0.5) / N) * vw, ((j + 0.5) / M) * vh);
        if (!p) continue;
        tot++;
        const qx = Math.min(W, Math.max(0, p.x)), qz = Math.min(D, Math.max(0, p.z));
        const d = Math.hypot(p.x - qx, p.z - qz);
        reach = Math.max(reach, d);
        // the apron is a square ring: its outer edge is max(|dx|,|dz|) = A
        const dc = Math.max(Math.abs(p.x - qx), Math.abs(p.z - qz));
        if (dc > A) nSk++; else if (dc > A - fade) nFade++; else if (d > 0) nApr++;
      }
    }
    // is the camera at the clamp in the pushed direction? (sanity: the push really reached the limit)
    return {
      voidPct: +(100 * nVoid / (sw * sh)).toFixed(3), side,
      skirtPct: +(100 * nSk / tot).toFixed(2), fadePct: +(100 * nFade / tot).toFixed(2), apronPct: +(100 * nApr / tot).toFixed(2),
      reach: +reach.toFixed(1), A, zoom: +cc.zoom.toFixed(3), yaw: Math.round(cc.yawDeg), target: [+cc.target.x.toFixed(1), +cc.target.z.toFixed(1)],
      map: [W, D], vw, vh, hudTop: cc.hudTop, url,
    };
  }, { img, outline: OUTLINE });
}

/**
 * In-page: how far (m) the target could still move toward the pushed side along each world axis the push leans on
 * (|component| > 0.3); 0 = the push reached the clamp (a slanted push slides along the edge, so only these count).
 */
const slack = (page, sx, sy) => page.evaluate(({ sx, sy }) => {
  const cc = window.__game.game.cameraController;
  const ca = Math.cos(cc.azimuth), sa = Math.sin(cc.azimuth);
  const n = Math.hypot(sx, sy), wx = (sx * ca + sy * sa) / n, wz = (-sx * sa + sy * ca) / n;
  const f = cc._looseFit(cc.target.x + Math.sign(wx) * 1000, cc.target.z + Math.sign(wz) * 1000);
  let s = 0;
  if (Math.abs(wx) > 0.3) s = Math.max(s, Math.sign(wx) * (f.x - cc.target.x));
  if (Math.abs(wz) > 0.3) s = Math.max(s, Math.sign(wz) * (f.z - cc.target.z));
  return +s.toFixed(2);
}, { sx, sy });

/** In-page: set yaw / zoom, stop motion, aim near the edge in screen direction (sx, sy) (a player scrolls there). */
const prepare = (page, yaw, zoomKind, sx, sy) => page.evaluate(({ yaw, zoomKind, sx, sy }) => {
  const g = window.__game, G = g.game, cc = G.cameraController, L = cc.cfg.zoomLevels;
  G.input?.touch && (G.input.touch.velocity.x = G.input.touch.velocity.y = 0);
  if (cc.tracking) cc.untrack?.();
  G.cameraRig.setYaw(yaw);
  g.setZoom(zoomKind === 'min' ? L[0] : cc.cfg.defaultZoom);
  const W = G.world.width, D = G.world.depth;
  const ca = Math.cos(cc.azimuth), sa = Math.sin(cc.azimuth);
  // screen dir → world dir; start 75 % of the way from the centre to the map edge along it
  const wx = sx * ca + sy * sa, wz = -sx * sa + sy * ca;
  const tx = Math.abs(wx) > 1e-6 ? (W / 2) / Math.abs(wx) : Infinity, tz = Math.abs(wz) > 1e-6 ? (D / 2) / Math.abs(wz) : Infinity;
  const s = 0.75 * Math.min(tx, tz);
  cc.centerOn(W / 2 + wx * s, D / 2 + wz * s);
  cc._panTween = null; cc._zoomTween = null;
  return cc.zoom;
}, { yaw, zoomKind, sx, sy });

async function openTouchPage(h, v) {
  const dev = { ...DEVICES[v.touch], viewport: { width: v.width, height: v.height } };
  const ctx = await h.browser.newContext(dev);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp };
}

async function sweepView(h, vk) {
  const v = VIEWS[vk];
  let ctx = null, page, cdp = null;
  const errs = [];
  // a fresh page per mission: several big maps loaded into one emulated phone page lost the GPU / renderer process
  const open = async () => {
    if (ctx) await ctx.close().catch(() => {}); else if (page) await page.close().catch(() => {});
    ctx = null;
    if (v.touch) ({ ctx, page, cdp } = await openTouchPage(h, v));
    else page = await h.newPage({ width: v.width, height: v.height });
    page.on('pageerror', (e) => errs.push('pageerror: ' + (e.message || '').slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errs.push('console.error: ' + m.text().slice(0, 300)); });
    page.on('crash', () => { errs.push('page crashed'); log(`${vk}: PAGE CRASHED`); });
    await page.goto(`${h.url}/index.html?test=1`, { timeout: 120000 }); // shared-load machines: the first load can take > 30 s
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
  };
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const drag = async (a, b, steps, ms) => {
    await touch('touchStart', [a]);
    for (let k = 1; k <= steps; k++) {
      await touch('touchMove', [[a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]]);
      if (ms) await page.waitForTimeout(ms);
    }
    await touch('touchEnd', []);
  };
  const pinch = async (m, d0, d1, steps = 8) => {
    m = [Math.min(W - d0 / 2 - 6, Math.max(d0 / 2 + 6, m[0])), Math.min(H - 6, Math.max(6, m[1]))];
    const pts = (d) => [[m[0] - d / 2, m[1]], [m[0] + d / 2, m[1]]];
    await touch('touchStart', [pts(d0)[0]]);
    await touch('touchStart', pts(d0));
    for (let k = 1; k <= steps; k++) { await touch('touchMove', pts(d0 + ((d1 - d0) * k) / steps)); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
  };
  let W = v.width, H = v.height;
  const SIZES = v.sizes || [[W, H]];
  for (const id of MISSIONS) {
    const t0 = Date.now();
    let timer;
    try {
      await open();
      const budget = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('mission budget (25 min) exceeded: renderer hung or lost')), 25 * 60_000); });
      await Promise.race([budget, (async () => {
        const info = await page.evaluate(async (id) => {
          const g = window.__game; await g.loadMission(id); g.start();
          const G = g.game; await G.mapHandle?.terrain?.apronReady;
          return { A: G.cameraController.apron, W: G.world.width, D: G.world.depth };
        }, id);
        log(`${vk} ${id}: map ${info.W}x${info.D}, apron ${info.A} m (load ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
        for (const [sw, sh] of SIZES) {
          W = sw; H = sh;
          const vn = v.sizes ? `${vk}-${W}x${H}` : vk;
          if (v.sizes) { await page.setViewportSize({ width: W, height: H }); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); }
          let best = null;
          for (const yaw of YAWS) {
            for (const zk of ZOOMS) {
              for (const [pk, [sx, sy]] of Object.entries(PUSHES)) {
                await prepare(page, yaw, zk, sx, sy);
                await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
                const methods = [];
                if (DIRECT) {
                  await page.evaluate(({ sx, sy }) => { const cc = window.__game.game.cameraController; for (let i = 0; i < 400; i++) cc._panScreenMetres(sx * 2, sy * 2); }, { sx, sy });
                  methods.push('clamp');
                } else if (v.touch) {
                  // three long drags from mid-screen (finger opposite to the wanted view motion), then a fast fling; let momentum coast
                  const a = [W / 2 + sx * W * 0.08, H / 2 + sy * H * 0.08], b = [W / 2 - sx * W * 0.42, H / 2 - sy * H * 0.42]; // start mid-screen (the HUD sits at the sides)
                  await drag(a, b, 10, 12);
                  await drag(a, b, 10, 12);
                  await drag(a, b, 10, 12);
                  await drag(a, b, 4, 4); // fling
                  await page.waitForTimeout(900);
                  methods.push('drag+fling');
                } else {
                  const keys = [sx < 0 ? 'ArrowLeft' : sx > 0 ? 'ArrowRight' : null, sy < 0 ? 'ArrowUp' : sy > 0 ? 'ArrowDown' : null].filter(Boolean);
                  for (const k of keys) await page.keyboard.down(k);
                  await page.waitForTimeout(1300);
                  for (const k of keys) await page.keyboard.up(k);
                  methods.push('keys');
                  if (sx && sy) {
                    await page.mouse.move(sx < 0 ? 1 : W - 2, sy < 0 ? 1 : H - 2);
                    await page.waitForTimeout(900);
                    await page.mouse.move(W / 2, H / 2);
                    methods[0] = 'keys+edge-scroll';
                  }
                }
                const rec = async (method) => {
                  const sl = await slack(page, sx, sy);
                  const m = await measure(page, false);
                  const r = { mission: id, view: vn, vp: `${W}x${H}`, zoomKind: zk, zoom: m.zoom, yaw: m.yaw, push: pk, kind: sx && sy ? 'corner' : 'edge', method,
                    voidPct: m.voidPct, skirtPct: m.skirtPct, fadePct: m.fadePct, apronPct: m.apronPct, reach: m.reach, A: m.A, slack: sl,
                    target: m.target, map: m.map, hudTop: m.hudTop, side: m.side, frame: null };
                  const bad = m.voidPct > 0 || m.skirtPct > 0;
                  if (bad || !best || r.reach > best.r.reach) {
                    const mm = await measure(page, true);
                    if (bad) r.frame = saveJpeg(`bad-${id}-${vn}-y${yaw}-${zk}-${pk}-${method}.jpg`, mm.url);
                    if (!best || r.reach > best.r.reach) best = { r, url: mm.url };
                  }
                  results.push(r);
                  return r;
                };
                await rec(methods[0]);
                if (!DIRECT && v.touch && zk === 'default') {
                  // pinch-out (zoom out to the minimum) with the fingers near the pushed edge, then one more drag
                  await pinch([W / 2 + sx * W * 0.1, H / 2 + sy * H * 0.1], Math.min(W, H) * 0.6, 40);
                  await page.waitForTimeout(100);
                  const a = [W / 2 + sx * W * 0.08, H / 2 + sy * H * 0.08], b = [W / 2 - sx * W * 0.42, H / 2 - sy * H * 0.42]; // start mid-screen (the HUD sits at the sides)
                  await drag(a, b, 4, 4);
                  await page.waitForTimeout(900);
                  await rec('pinch-out+fling');
                }
              }
            }
          }
          // the farthest-reaching frame of this mission × view, saved for a look
          if (best) best.r.worstFrame = saveJpeg(`worst-${id}-${vn}.jpg`, best.url);
        }
        const mine = results.filter((r) => r.mission === id && r.view.startsWith(vk));
        const maxVoid = Math.max(...mine.map((r) => r.voidPct)), maxSk = Math.max(...mine.map((r) => r.skirtPct)), maxR = Math.max(...mine.map((r) => r.reach));
        log(`${vk} ${id}: ${mine.length} frames, max void ${maxVoid}%, max skirt ${maxSk}%, max reach ${maxR} m / apron ${info.A} m, ${((Date.now() - t0) / 1000).toFixed(0)} s${errs.length ? ', errors: ' + errs.slice(0, 2).join(' | ') : ''}`);
        errs.length = 0;
      })()]);
    } catch (e) {
      log(`${vk} ${id}: FAILED ${e.message.slice(0, 300)}`);
      results.push({ mission: id, view: vk, error: e.message.slice(0, 300) });
    } finally {
      clearTimeout(timer);
    }
    writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  }
  if (ctx) await ctx.close().catch(() => {}); else await page?.close().catch(() => {});
}

const h = await startHarness();
try {
  for (const vk of VIEW_KEYS) await sweepView(h, vk);
} finally {
  await h.close();
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const cols = ['mission', 'view', 'vp', 'zoomKind', 'zoom', 'yaw', 'push', 'kind', 'method', 'voidPct', 'skirtPct', 'fadePct', 'apronPct', 'reach', 'A', 'slack', 'hudTop', 'frame', 'worstFrame'];
  writeFileSync(join(OUT, 'results.csv'), [cols.join(','), ...results.map((r) => cols.map((c) => r[c] ?? '').join(','))].join('\n') + '\n');
  log(`done: ${results.length} frames → ${OUT}`);
}
