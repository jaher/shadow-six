#!/usr/bin/env node
/**
 * Duck review: stills / frame sequences of the ducks on the water (M1 eiders, mallards elsewhere), optionally
 * startled into flight halfway through, plus a per-frame trace and an optional cost measurement.
 *
 *   node tools/perf/duckclip.mjs --mission=m01 --zoom=1 --secs=8 --fps=30 --out=/tmp/ducks [--w=1280 --h=720]
 *     [--warm=8] [--startle=shot|walk|''] [--startleAt=0.5] [--hud=0] [--perf=1] [--follow=0.1] [--sp=eider] [--dpr=1]
 *     [--lineup=1 --zoom=4 --dpr=2] [--at=x:z] [--zoomTo=1@0.4] [--dive=2@0.05:4.5]
 *
 * Loads the mission in test mode, lets the life settle (`warm` s), centres the camera on the duck flock, then steps
 * the SIM at 60 Hz (rendering every sim step so the ambient-life director runs per displayed frame) and writes
 * <out>/f0000.jpg … plus <out>/trace.json. --startle=shot fires a rifle shot 25 m from the flock at `startleAt` of
 * the clip; --startle=walk walks a commando up the shore. --follow=k keeps the camera on the flock centroid (eased by k per frame, e.g. 0.1).
 * --perf=1 measures the director CPU and the frame time with the bird meshes shown / hidden / shown.
 * --lineup=1 freezes the duck sim and lines the ducks up in set poses (swim, flight up / down stroke, preen, rest,
 * alert, dive, up-end; drakes and hens alternating) for a model close-up.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = arg('out', 'duckclip'), fps = Number(arg('fps', 30)), secs = Number(arg('secs', 8)), sub = Math.max(1, Math.round(60 / fps));
mkdirSync(out, { recursive: true });
const h = await startHarness({});
const page = await h.newPage({ width: Number(arg('w', 1280)), height: Number(arg('h', 720)) }, { deviceScaleFactor: Number(arg('dpr', 1)) });
await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 90000 });
const info = await page.evaluate(async ({ m, zoom, sp, warm, hud, follow, lineup, at }) => {
  const g = window.__game, G = g.game;
  await g.loadMission(m); g.start();
  G.stop(); // (?test=1: the page's own rAF loop still draws, with real dt, while a frame is awaited — it ran the animations ~3x fast)
  g.advance(0.5); G.render(1 / 60, 1);
  const L = G.mapHandle.life;
  for (let k = 0; k < warm * 20; k++) { g.advance(1 / 20); G.render(1 / 20, 1); }
  const B = L.birds.birds.filter((q) => (sp ? q.sp === sp : q.kind === 'duck'));
  if (!B.length) return { err: 'no ducks', census: L.birds.census() };
  const c = at ? at.split(':').map(Number) : B.reduce((a, q) => [a[0] + q.x / B.length, a[1] + q.z / B.length], [0, 0]);
  G.cameraController.setZoom(zoom); G.cameraController.centerOn(c[0], c[1]);
  window.__clip = { sp: B[0].sp, x: c[0], z: c[1], follow, cx: c[0], cz: c[1] };
  if (lineup) { // frozen model line-up: set poses, the sim no longer steps
    L.birds.step = () => {};
    const lv = G.world.water.sample(c[0], c[1])?.level ?? -0.1, P = [
      { st: 'swim' }, { st: 'swim', hen: true }, { st: 'fly', amp: 1, fold: 0, ph: Math.PI / 2, y: 0.5, neckF: 0.07, neckU: -0.025 },
      { st: 'fly', hen: true, amp: 1, fold: 0, ph: 1.5 * Math.PI, y: 0.5, neckF: 0.07, neckU: -0.025 }, { st: 'swim', look: 2.55, peck: 0.3 },
      { st: 'swim', hen: true, look: -2.85, peck: 0.42, neckU: -0.03, neckF: -0.035 }, { st: 'swim', neckU: 0.075, neckF: 0.015, peck: -0.12 },
      { st: 'swim', hen: true, pitch: -0.9, cock: 0.4, y: -0.02 }, { st: 'swim', dab: 1 }, { st: 'final', wset: 0.42, amp: 0.15, fold: 0, ph: 1, y: 0.4, pitch: 0.12, hen: true },
      { st: 'skid', wset: 0.95, amp: 0, fold: 0, pitch: 0.22 }, { st: 'swim', hen: true, amp: 1, fold: 0, ph: Math.PI / 2, pitch: 0.6, y: 0.07, neckU: 0.05 }];
    const all = L.birds.birds.filter((q) => q.sp === B[0].sp);
    all.forEach((q, i) => {
      const p = P[i % P.length], row = Math.floor(i / 4), col = i % 4;
      Object.assign(q, { hidden: false, x: c[0] - 2.4 + col * 1.6, z: c[1] - 1.2 + row * 1.5, yaw: 0, look: 0, peck: 0, neckF: 0, neckU: 0, wset: 0, amp: 0, fold: 1, ph: 0, pitch: 0, dab: 0, cock: 0, wag: 0, roll: 0, wp: 0, bank: 0 }, p, { y: lv + (p.y || 0), hen: !!p.hen });
    });
  }
  if (!hud) { const el = document.getElementById('hud'); if (el) el.style.visibility = 'hidden'; }
  // the ducks' sound events, per captured frame (for a soundtrack): calls and take-offs
  window.__clipEv = []; window.__clipFrame = 0;
  for (const ev of ['ambient:call', 'ambient:flush']) G.world.events.on(ev, (e) => window.__clipEv.push([window.__clipFrame, ev, e.species, !!e.hen, e.kind || '']));
  g.advance(1 / 60); G.render(1 / 60, 1);
  return { x: c[0], z: c[1], census: L.birds.census(), n: B.length, sp: B[0].sp, birds: L.birds.birds.length,
    plum: B.map((q) => (q.hen ? 'hen' : 'drake')) };
}, { m: arg('mission', 'm01'), zoom: Number(arg('zoom', 1)), sp: arg('sp', ''), warm: Number(arg('warm', 8)), hud: arg('hud', '0') === '1', follow: Number(arg('follow', '0')), lineup: arg('lineup', '0') === '1', at: arg('at', '') });
console.log('clip', JSON.stringify(info));
if (info.err) { await page.close(); await h.close(); process.exit(1); }
if (arg('perf', '0') === '1') {
  const perf = await page.evaluate(async () => {
    const g = window.__game, G = g.game, L = G.mapHandle.life, R = G.renderer, gl = R.renderer.getContext(), px = new Uint8Array(4);
    // director CPU: 300 frame() calls at a 60 Hz sim step
    let ms = 0;
    for (let k = 0; k < 300; k++) { g.advance(1 / 60); const t0 = performance.now(); L.frame(1 / 60, R.camera); ms += performance.now() - t0; }
    const birdSim = (() => { const t0 = performance.now(); for (let k = 0; k < 600; k++) L.birds.step(1 / 60); return (performance.now() - t0) / 600; })();
    const frames = (n) => { const a = []; for (let k = 0; k < n; k++) { g.advance(1 / 60); const t0 = performance.now(); G.render(1 / 60, 1); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); a.push(performance.now() - t0); } a.sort((x, y) => x - y); return +a[a.length >> 1].toFixed(3); };
    const show = (v) => { for (const hh of L.birdH) hh.mesh.visible = v; if (L.wakes) L.wakes.mesh.material.visible = v; };
    frames(20);
    const on1 = frames(120); show(false); const off = frames(120); show(true); const on2 = frames(120);
    return { directorMs: +(ms / 300).toFixed(4), birdSimStepMs: +birdSim.toFixed(4), frameOn: on1, frameOff: off, frameOn2: on2, birds: L.birds.birds.length,
      ducks: L.birds.birds.filter((q) => q.kind === 'duck').length, drawnBirds: L.stats.drawnBirds,
      tris: L.birdH.map((hh) => [hh.sp, hh.mesh.geometry.index.count / 3, hh.cap]), wakeTris: L.stats.wakeTris ?? null };
  });
  console.log('perf', JSON.stringify(perf));
  writeFileSync(join(out, 'perf.json'), JSON.stringify(perf, null, 1));
}
const trace = [], N = Math.round(secs * fps), startle = arg('startle', ''), sAt = Math.floor(N * Number(arg('startleAt', 0.5)));
const [zTo, zAtF] = arg('zoomTo', '').split('@').map(Number), zAt = zTo ? Math.floor(N * (zAtF || 0)) : -1; // --zoomTo=1@0.4: zoom out at 40 %
// --dive=2@0.05:4.5 → duck 2 starts a dive at 5 % of the clip, staying under 4.5 s (a natural act, triggered on cue)
const [dvI, dvRest] = arg('dive', '').split('@'), [dvF, dvDur] = (dvRest || '').split(':').map(Number), dvAt = dvI ? Math.floor(N * dvF) : -1;
for (let i = 0; i < N; i++) {
  const fr = await page.evaluate(({ sub, i, sAt, startle, zAt, zTo, dvAt, dvI, dvDur }) => {
    const g = window.__game, G = g.game, L = G.mapHandle.life, C = window.__clip;
    window.__clipFrame = i;
    if (i === zAt) G.cameraController.setZoom(zTo, false); // eased zoom (0.25 s tween)
    if (i === dvAt) { const q = L.birds.birds.filter((o) => o.sp === C.sp)[dvI]; if (q && q.st === 'swim') Object.assign(q, { act: 'dive', at: 99, dv: 0, dt: 0, dur: dvDur || 5 }); }
    if (startle === 'shot' && i === sAt) G.world.events.emit('shot', { from: { x: C.x + 22, z: C.z + 12 }, to: { x: C.x + 30, z: C.z + 20 }, hit: false, weapon: 'rifle' });
    if (startle === 'walk' && i === sAt) { const c = G.world.commandos[0]; c.x = C.x - 16; c.z = C.z; }
    for (let k = 0; k < sub; k++) {
      if (startle === 'walk' && i >= sAt) { const c = G.world.commandos[0]; c.x += 2.2 / 60; }
      g.advance(1 / 60); G.render(1 / 60, 1);
    }
    const D = L.birds.birds.filter((q) => q.sp === C.sp);
    if (C.follow) {
      // the flock in the air when some are flying (they fly in formation), else everyone on the water
      const air = D.filter((q) => !q.hidden && q.st !== 'swim' && q.st !== 'skid'), W = air.length ? air : D.filter((q) => !q.hidden), n = Math.max(1, W.length);
      const cx = W.reduce((a, q) => a + q.x, 0) / n, cz = W.reduce((a, q) => a + q.z, 0) / n;
      C.cx += (cx - C.cx) * C.follow; C.cz += (cz - C.cz) * C.follow; G.cameraController.centerOn(C.cx, C.cz);
    }
    const cam = G.renderer.camera, cv = G.renderer.renderer.domElement, V = C.V || (C.V = new cam.position.constructor());
    return D.map((q) => {
      V.set(q.x, q.y, q.z).project(cam);
      return [+q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.yaw.toFixed(3), q.st, Math.round((V.x + 1) / 2 * cv.clientWidth), Math.round((1 - V.y) / 2 * cv.clientHeight), q.act || '', q.hidden ? 0 : +(1 - (q.sub || 0)).toFixed(3)];
    });
  }, { sub, i, sAt, startle, zAt, zTo, dvAt, dvI: Number(dvI), dvDur });
  trace.push(fr);
  await page.screenshot({ path: join(out, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 88 });
}
const events = await page.evaluate(() => window.__clipEv || []);
writeFileSync(join(out, 'trace.json'), JSON.stringify({ fps, info, trace, events, startleFrame: startle ? sAt : null }));
const errs = h.errors(page);
if (errs.length) console.log('ERRORS\n' + errs.slice(0, 8).join('\n'));
console.log('frames', N, out);
await page.close();
await h.close();
