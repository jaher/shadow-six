#!/usr/bin/env node
/**
 * Camera motion probe of debug VIDEO MODE (user 2026-11-09: "Debug solutions dont need the camera to be moving around so
 * much, it used to be more static before"): plays a mission's walkthrough in AUTO (the default) and logs the camera every
 * displayed frame — target x/z, zoom, yaw, pitch, the director's aim (where it is told to go), its yaw offset, the shot's
 * subject (the unit at the shot's first point) — then sums the motion per minute of game time and per minute watched:
 *   pan      m of camera target travel (frame-to-frame cuts > CUT_M apart)
 *   cuts     frames where the camera target jumped more than CUT_M
 *   retarget frames where the director's aim jumped more than RETARGET_M (a new subject, a new framing)
 *   zoom     Σ|Δ ln zoom|
 *   yaw      swings (changes of the director's yaw offset) and Σ|Δ yaw| in degrees
 *   focus    switches of the shot's subject (one held at least FOCUS_MIN_MS), and ping-pongs (back to the one before
 *            within PINGPONG_MS)
 * Chapter cards are let go at once (their still camera is not the play's); the intro card is clicked through.
 *
 *   CHROME=... node tools/perf/camera-motion.mjs m03 [--root=<checkout>] [--out=trace.json] [--max-game=<s>] [--max-wall=<s>]
 *     [--width=1280 --height=720] [--preset=low] [--video=<dir> --label=<text>]
 * --sol plays the SOLUTION replay (its smart camera: the same director) at --speed=4 instead of video mode.
 * --video=<dir> saves the page's frames (CDP screencast, JPEG) under a corner label (--label); the JSON lists them with
 * their wall time (`shots`: [file, epoch ms]) and the trace's frames carry Date.now() (index 12), so the frames of a
 * game-time span can be picked and encoded (ffmpeg concat).
 *   node tools/perf/camera-motion.mjs --metrics trace.json [more.json …]   (the table again from saved traces)
 * Any checkout can be probed (--root): the page is driven from outside, only the walkthrough's composeShot is wrapped.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CUT_M = 6;
export const RETARGET_M = 6;
export const FOCUS_MIN_MS = 250;
export const PINGPONG_MS = 5000;

/** Motion sums of a trace's frames (see the header); `rec`: [wall ms, game s, x, z, zoom, az, el, aimX, aimZ, yawWant, subject, flags, Date.now(), director ms]. */
export function metrics(frames) {
  let pan = 0, cuts = 0, retarget = 0, zoom = 0, yawDeg = 0, yawSwings = 0, focus = 0, pingpong = 0, pitchDeg = 0;
  let prev = null, lastYawWant = null;
  // (focus: a subject counts once it has been on FOCUS_MIN_MS)
  let cand = null, candAt = 0, cur = null, before = null, curAt = 0;
  const gameT0 = frames[0]?.[1] ?? 0, wallT0 = frames[0]?.[0] ?? 0;
  let gameT1 = gameT0, wallT1 = wallT0;
  for (const f of frames) {
    const [wall, t, x, z, zm, az, el, ax, az2, yw, subj] = f;
    gameT1 = t; wallT1 = wall;
    if (prev) {
      const d = Math.hypot(x - prev[2], z - prev[3]);
      if (d > CUT_M) cuts++; else pan += d;
      if (Number.isFinite(ax) && Number.isFinite(prev[7]) && Math.hypot(ax - prev[7], az2 - prev[8]) > RETARGET_M) retarget++;
      if (zm > 0 && prev[4] > 0) zoom += Math.abs(Math.log(zm / prev[4]));
      let da = az - prev[5];
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      yawDeg += Math.abs(da) * 180 / Math.PI;
      pitchDeg += Math.abs(el - prev[6]) * 180 / Math.PI;
    }
    if (lastYawWant != null && yw !== lastYawWant) yawSwings++;
    lastYawWant = yw;
    if (subj !== cand) { cand = subj; candAt = wall; }
    if (cand !== cur && cand != null && wall - candAt >= FOCUS_MIN_MS) {
      if (cur != null) { focus++; if (cand === before && candAt - curAt < PINGPONG_MS) pingpong++; }
      before = cur; cur = cand; curAt = candAt;
    }
    prev = f;
  }
  const gameMin = Math.max(1e-6, (gameT1 - gameT0) / 60), wallMin = Math.max(1e-6, (wallT1 - wallT0) / 60000);
  const sums = { pan, cuts, retarget, zoom, yawSwings, yawDeg, focus, pingpong, pitchDeg };
  const per = (m) => Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, +(v / m).toFixed(3)]));
  return { frames: frames.length, gameMin: +gameMin.toFixed(2), wallMin: +wallMin.toFixed(2), sums, perGameMin: per(gameMin), perWallMin: per(wallMin) };
}

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();

function table(rows) {
  const keys = ['pan', 'cuts', 'retarget', 'zoom', 'yawSwings', 'yawDeg', 'focus', 'pingpong', 'pitchDeg'];
  console.log(`${'trace'.padEnd(34)} ${'gameMin'.padStart(7)} ${'wallMin'.padStart(7)}  per game min: ${keys.map((k) => k.padStart(8)).join(' ')}   | per wall min: ${keys.map((k) => k.padStart(8)).join(' ')}`);
  for (const [name, m] of rows) {
    console.log(`${name.padEnd(34)} ${String(m.gameMin).padStart(7)} ${String(m.wallMin).padStart(7)}                ${keys.map((k) => String(m.perGameMin[k]).padStart(8)).join(' ')}   |               ${keys.map((k) => String(m.perWallMin[k]).padStart(8)).join(' ')}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
  if (args[0] === '--metrics') {
    table(args.slice(1).map((f) => [f.split('/').pop(), metrics(JSON.parse(readFileSync(f, 'utf8')).frames)]));
    return;
  }
  const id = args.find((x) => !x.startsWith('--')) || 'm03';
  const ROOT = resolve(arg('root', HERE));
  const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
  const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
  const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
  const server = await startServer({ port: 0, root: ROOT });
  const browser = await PW.chromium.launch({ executablePath: H.findChrome(), headless: true, args: H.GPU_ARGS });
  const W = +arg('width', 1280), Ht = +arg('height', 720);
  const vdir = arg('video', '');
  const ctx = await browser.newContext({ viewport: { width: W, height: Ht } });
  const page = await ctx.newPage();
  // --video: the compositor's frames (CDP screencast, JPEG) as they come, each with its wall time (epoch ms)
  const shots = [];
  if (vdir) {
    mkdirSync(vdir, { recursive: true });
    const cdp = await ctx.newCDPSession(page);
    cdp.on('Page.screencastFrame', (f) => {
      const n = shots.length, file = join(vdir, `f${String(n).padStart(6, '0')}.jpg`);
      writeFileSync(file, Buffer.from(f.data, 'base64'));
      shots.push([file, Math.round(f.metadata.timestamp * 1000)]);
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: W, maxHeight: Ht, everyNthFrame: 1 });
  }
  page.setDefaultTimeout(0);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  const T0 = Date.now();
  const log = (s) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)} s] ${s}`);
  const sol = args.includes('--sol');
  if (sol) {
    await page.goto(`${server.url.replace(/\/$/, '')}/index.html?debug&preset=${arg('preset', 'low')}`);
    await page.evaluate(() => localStorage.removeItem('shadowsix.debug.options'));
    await page.waitForFunction(() => document.body.dataset.ready === '1' && !!document.querySelector('#dbg-select .dbg-tile'), null, { timeout: 120000 });
    await page.locator(`#dbg-select .dbg-sol[data-solution="${id}"]`).click();
    await page.waitForFunction(() => window.shadowSix.debug.mode.replay?.director && window.shadowSix.state === 'playing', null, { timeout: 300000 });
  } else {
    await page.goto(`${server.url.replace(/\/$/, '')}/index.html?debug&preset=${arg('preset', 'low')}&walkthrough=${id}`);
    await page.evaluate(() => localStorage.removeItem('shadowsix.debug.options'));
    await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]') && window.shadowSix?.debug?.mode?.replay, null, { timeout: 300000 });
  }
  log(`${id} loaded from ${ROOT}`);
  if (arg('label', '')) {
    await page.evaluate((txt) => {
      const d = document.createElement('div');
      d.textContent = txt;
      d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;padding:4px 10px;background:rgba(0,0,0,.72);color:#ffcf4a;font:700 22px/1.2 system-ui,sans-serif;border-radius:6px;pointer-events:none';
      document.body.appendChild(d);
    }, arg('label', ''));
  }
  await page.evaluate(async () => {
    const g = window.shadowSix, r = g.debug.mode.replay, w = g.world;
    const D = await import('/src/debug/walkthrough-director.js');
    const P = window.__cam = { frames: [], names: [], shots: 0 };
    const nameOf = (u) => { if (!u) return null; const n = (u.kind === 'commando' ? u.role : u.tag || u.id || u.role) || '?'; let i = P.names.indexOf(n); if (i < 0) { i = P.names.length; P.names.push(n); } return i; };
    let shot = null, dirMs = 0;
    // (the director's own cost a frame: its update, composeShot and the yaw rays inside it)
    const wrapDir = () => { const d = r.director; if (!d || d.__timed) return; d.__timed = true; const ou = d.update.bind(d); d.update = (dt) => { const t0 = performance.now(); ou(dt); dirMs = performance.now() - t0; }; };
    wrapDir();
    const oc = r.composeShot.bind(r);
    r.composeShot = () => { shot = oc(); P.shots++; return shot; };
    const subjectOf = (sh) => {
      const p = sh?.pts?.[0];
      if (!p) return null;
      let best = null, bd = 1.6;
      for (const u of [...w.commandos, ...w.enemies, ...(w.vehicles || [])]) {
        if (!u || u.removed) continue;
        const e = u.vehicle && !u.vehicle.removed ? u.vehicle : u;
        const d = Math.hypot(e.x - p.x, e.z - p.z);
        if (d < bd) { bd = d; best = u.kind === 'vehicle' || u.vehicleType ? (w.commandos.find((c) => c.vehicle === u) || u) : u; }
      }
      return best ? nameOf(best) : nameOf({ role: `pt${Math.round(p.x / 10)},${Math.round(p.z / 10)}` });
    };
    const f = () => {
      if (r.stopped) return;
      requestAnimationFrame(f);
      // (chapter cards let go at once: the still camera of a card is not the play's)
      if (r.hold && r.hold.kind !== 'intro') r.hold = null;
      wrapDir();
      const cc = g.cameraController, dir = r.director;
      if (!cc || r._introOn || r.paused || !shot || !dir?.on) { shot = null; return; }
      // the director's aim this frame: its own (a director that holds its framing exposes `aim`), else what it was told
      let ax = NaN, az = NaN;
      if (dir.aim && Number.isFinite(dir.aim.x)) { ax = dir.aim.x; az = dir.aim.z; }
      else if (shot.pts?.length) {
        const rect = r.safeRect();
        const view = { az: cc.azimuth, el: cc.elevation, width: cc.width, height: cc.height, ppm1: cc.cfg?.pxPerMeterAt1x };
        const fr = shot.holdZoom && dir.cam ? { ...shot.frame, minZoom: dir.cam.zoom, maxZoom: dir.cam.zoom } : shot.frame;
        const a = D.frameWithPriority(shot.pts, shot.must ?? 1, view, rect, fr);
        if (a) { ax = a.x; az = a.z; }
      }
      const flags = (r._skip ? 1 : 0) | (r.pacer?.turbo ? 2 : 0) | (shot.cut ? 4 : 0) | (shot.hold ? 8 : 0) | (shot.live ? 16 : 0) | (shot.stiff ? 32 : 0);
      const subj = subjectOf(shot);
      P.frames.push([performance.now(), w.time, cc.target.x, cc.target.z, cc.zoom, cc.azimuth, cc.elevation, ax, az, dir.yaw?.want ?? 0, subj, flags, Date.now(), dirMs]);
      shot = null;
    };
    requestAnimationFrame(f);
  });
  if (sol) await page.locator(`#dbg-sol-bar [data-act="speed-${arg('speed', '4')}"]`).click();
  else await page.locator('#wt-card [data-act=start]').click().catch(async () => { await page.evaluate(() => window.shadowSix.debug.mode.replay._endIntro?.()); });
  log('started');
  const maxGame = +arg('max-game', 1e9), maxWall = +arg('max-wall', 3600) * 1000;
  const t1 = Date.now();
  for (;;) {
    const s = await page.evaluate(() => { const g = window.shadowSix, r = g.debug.mode.replay; return { t: g.world?.time ?? 0, end: !r || r.stopped || r.finished || g.state === 'won' || g.state === 'lost' || !!document.querySelector('#wt-card[data-kind=end]'), n: window.__cam?.frames.length ?? 0 }; });
    if (s.end || s.t >= maxGame || Date.now() - t1 > maxWall) { log(`stop: game t=${s.t.toFixed(1)} end=${s.end} frames=${s.n}`); break; }
    if ((Date.now() - t1) % 60000 < 2000) log(`t=${s.t.toFixed(1)} frames=${s.n}`);
    await new Promise((res) => setTimeout(res, 2000));
  }
  const out = await page.evaluate(() => { const P = window.__cam; return { names: P.names, frames: P.frames.filter((f) => f[1] <= (window.__camMax ?? Infinity)) }; });
  // (frames up to the game-time cap only)
  out.frames = out.frames.filter((f) => f[1] <= maxGame);
  out.id = id; out.root = ROOT; out.errors = errs.slice(0, 5); out.viewport = [W, Ht];
  if (vdir) out.shots = shots;
  await page.close();
  if (vdir) log(`${shots.length} screencast frames in ${vdir}`);
  await ctx.close(); await browser.close(); await server.close();
  const m = metrics(out.frames);
  out.metrics = m;
  if (arg('out', '')) writeFileSync(arg('out'), JSON.stringify(out));
  table([[`${id} ${ROOT.split('/').pop()}`, m]]);
  if (errs.length) console.log(`page errors: ${errs.slice(0, 3).join(' | ')}`);
}
