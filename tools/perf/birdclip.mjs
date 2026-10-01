#!/usr/bin/env node
/**
 * Ground-bird motion review: frames + a per-frame trace of the crows (or gulls) walking, hopping, pecking.
 *
 *   node tools/perf/birdclip.mjs --mission=m01 --sp=crow --zoom=2 --secs=8 --fps=30 --out=/tmp/crows [--w=1280 --h=720]
 *     [--jpg=1] [--warm=6] [--startle=1] [--hud=0] [--at=x:z]
 *
 * Loads the mission in test mode, lets the life settle (`warm` s), centres the camera on the first grounded bird of
 * the species, then steps the SIM at 60 Hz (two 1/60 s steps per captured frame at fps 30), rendering every sim step
 * so the ambient-life director runs per displayed frame. Writes <out>/f0000.jpg … and <out>/trace.json (per frame:
 * x, y, z, yaw, state, screen x, screen y of each bird of the species). --startle walks a commando past the flock halfway through.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = arg('out', 'birdclip'), fps = Number(arg('fps', 30)), secs = Number(arg('secs', 8)), sub = Math.max(1, Math.round(60 / fps));
mkdirSync(out, { recursive: true });
const h = await startHarness({});
const page = await h.newPage({ width: Number(arg('w', 1280)), height: Number(arg('h', 720)) });
await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
const info = await page.evaluate(async ({ m, zoom, sp, warm, at, hud }) => {
  const g = window.__game, G = g.game;
  await g.loadMission(m); g.start();
  g.advance(0.5); G.render(1 / 60, 1);
  const L = G.mapHandle.life;
  for (let k = 0; k < warm * 20; k++) { g.advance(1 / 20); G.render(1 / 20, 1); }
  const B = L.birds.birds.filter((q) => q.sp === sp);
  const b = B.find((q) => q.st === 'ground' || q.st === 'perched') || B[0];
  if (!b) return { err: 'no ' + sp, census: L.birds.census() };
  let [x, z] = at ? at.split(':').map(Number) : [b.x, b.z];
  G.cameraController.setZoom(zoom); G.cameraController.centerOn(x, z);
  window.__clip = { sp, x, z };
  if (!hud) { const el = document.getElementById('hud'); if (el) el.style.visibility = 'hidden'; }
  g.advance(1 / 60); G.render(1 / 60, 1);
  // flock centroid on screen (px), to frame crops
  const T = await import('three'), cam = G.renderer.camera, gb = B.filter((q) => q.st === 'ground' || q.st === 'perched');
  const c = gb.reduce((a, q) => [a[0] + q.x / gb.length, a[1] + q.y / gb.length, a[2] + q.z / gb.length], [0, 0, 0]);
  const v = new T.Vector3(...c).project(cam), cv = G.renderer.renderer.domElement;
  return { x, z, census: L.birds.census(), n: B.length, screen: [Math.round((v.x + 1) / 2 * cv.clientWidth), Math.round((1 - v.y) / 2 * cv.clientHeight)] };
}, { m: arg('mission', 'm01'), zoom: Number(arg('zoom', 2)), sp: arg('sp', 'crow'), warm: Number(arg('warm', 6)), at: arg('at', ''), hud: arg('hud', '1') === '1' });
console.log('clip', JSON.stringify(info));
if (info.err) { await page.close(); await h.close(); process.exit(1); }
const trace = [], N = Math.round(secs * fps), startle = arg('startle', '');
for (let i = 0; i < N; i++) {
  const fr = await page.evaluate(({ sub, i, N, startle }) => {
    const g = window.__game, G = g.game, L = G.mapHandle.life, C = window.__clip;
    if (startle && i === Math.floor(N / 2)) { const c = G.world.commandos[0]; c.x = C.x - 14; c.z = C.z; }
    for (let k = 0; k < sub; k++) {
      if (startle && i >= N / 2) { const c = G.world.commandos[0]; c.x += 2.2 / 60; }
      g.advance(1 / 60); G.render(1 / 60, 1);
    }
    const cam = G.renderer.camera, cv = G.renderer.renderer.domElement, V = C.V || (C.V = new cam.position.constructor());
    return L.birds.birds.filter((q) => q.sp === C.sp).map((q) => {
      V.set(q.x, q.y, q.z).project(cam);
      return [+q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4), +q.yaw.toFixed(4), q.st, Math.round((V.x + 1) / 2 * cv.clientWidth), Math.round((1 - V.y) / 2 * cv.clientHeight)];
    });
  }, { sub, i, N, startle });
  trace.push(fr);
  await page.screenshot({ path: join(out, `f${String(i).padStart(4, '0')}.${arg('jpg', '1') === '1' ? 'jpg' : 'png'}`), ...(arg('jpg', '1') === '1' ? { type: 'jpeg', quality: 85 } : {}) });
}
writeFileSync(join(out, 'trace.json'), JSON.stringify({ fps, info, trace }));
const errs = h.errors(page);
if (errs.length) console.log('ERRORS\n' + errs.slice(0, 8).join('\n'));
console.log('frames', N, out);
await page.close();
await h.close();
