#!/usr/bin/env node
/**
 * Fish review: stills / frame sequences of the fish at game zoom, optionally scared halfway through, with a per-frame
 * trace (leaps, rises, scared fish) and a visibility measure.
 *
 *   node tools/perf/fishclip.mjs --mission=m01 --zoom=1 --secs=8 --fps=30 --out=/tmp/fish [--w=1280 --h=720]
 *     [--at=x:z | --sp=sprat] [--warm=6] [--startle=blast|swim] [--startleAt=0.5] [--hud=0] [--vis=1] [--zoomTo=2@0.5]
 *     [--leap=salmon@0.4] [--follow=0.05] [--calm=1]
 *
 * Loads the mission in test mode, lets the life settle (`warm` s), centres the camera on the biggest shoal of `sp`
 * (or the biggest shoal, or x:z), then steps the SIM at 60 Hz, rendering every step, and writes <out>/f0000.jpg … and
 * <out>/trace.json. --startle=blast sets off a grenade in the water by the shoal; --startle=swim swims the Marine
 * through it. --vis=1 measures, every 2 s, the pixels the fish change (frame with the fish meshes and their bed
 * shadows shown vs hidden: by > 18 and, plainly visible, by > 45 of 765) and prints the medians.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = arg('out', 'fishclip'), fps = Number(arg('fps', 30)), secs = Number(arg('secs', 8)), sub = Math.max(1, Math.round(60 / fps));
mkdirSync(out, { recursive: true });
const h = await startHarness({});
const page = await h.newPage({ width: Number(arg('w', 1280)), height: Number(arg('h', 720)) });
await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 90000 });
const info = await page.evaluate(async ({ m, zoom, sp, warm, at, hud, calm }) => {
  const g = window.__game, G = g.game;
  await g.loadMission(m); g.start();
  G.stop(); // (?test=1: the page's own rAF loop still draws, with real dt, while a frame is awaited — it ran the animations ~3x fast)
  g.advance(0.5); G.render(1 / 60, 1);
  const L = G.mapHandle.life;
  for (let k = 0; k < warm * 20; k++) { g.advance(1 / 20); G.render(1 / 20, 1); }
  if (!L?.fish) return { err: 'no fish' };
  const S = [...L.fish.schools].filter((q) => !sp || q.sp === sp).sort((a, b) => b.members.length - a.members.length)[0];
  const c = at ? at.split(':').map(Number) : [S.cx, S.cz];
  G.cameraController.setZoom(zoom); G.cameraController.centerOn(c[0], c[1]);
  if (!hud) { const el = document.getElementById('hud'); if (el) el.style.visibility = 'hidden'; }
  window.__fc = { x: c[0], z: c[1], ev: [], frame: 0, school: S, cx: c[0], cz: c[1] };
  if (calm) for (const e of G.world.enemies) if (e.brain) e.brain.update = () => {}; // --calm=1: the guards stand by (a staged swim past)
  G.world.events.on('ambient:fishjump', (e) => window.__fc.ev.push([window.__fc.frame, 'jump', e.species]));
  g.advance(1 / 60); G.render(1 / 60, 1);
  const by = {}; for (const f of L.fish.fish) by[f.sp] = (by[f.sp] || 0) + 1;
  return { x: c[0], z: c[1], shoal: S && `${S.sp}:${S.members.length}`, fish: L.fish.fish.length, by, schools: L.fish.schools.length };
}, { m: arg('mission', 'm01'), zoom: Number(arg('zoom', 1)), sp: arg('sp', ''), warm: Number(arg('warm', 6)), at: arg('at', ''), hud: arg('hud', '0') === '1', calm: arg('calm', '0') === '1' });
console.log('clip', JSON.stringify(info));
if (info.err) { await page.close(); await h.close(); process.exit(1); }
const follow = Number(arg('follow', 0)), N = Math.round(secs * fps), startle = arg('startle', ''), sAt = Math.floor(N * Number(arg('startleAt', 0.5))), vis = arg('vis', '0') === '1';
const [zTo, zAtF] = arg('zoomTo', '').split('@').map(Number), zAt = zTo ? Math.floor(N * (zAtF || 0)) : -1;
// --leap=salmon@0.4 → at 40 % of the clip the fish of that species nearest the view centre leaps (a natural act on cue)
const [lpSp, lpF] = arg('leap', '').split('@'), lpAt = lpSp ? Math.floor(N * Number(lpF || 0.5)) : -1;
const trace = [], visPx = [];
for (let i = 0; i < N; i++) {
  const fr = await page.evaluate(({ sub, i, sAt, startle, zAt, zTo, measure, lpAt, lpSp, follow }) => {
    const g = window.__game, G = g.game, L = G.mapHandle.life, C = window.__fc;
    C.frame = i;
    if (i === zAt) G.cameraController.setZoom(zTo, false);
    if (i === sAt && startle === 'blast') G.world.events.emit('explosion', { x: C.x + 1, z: C.z, radius: 3, kind: 'grenade' });
    if (i === lpAt) {
      const q = L.fish.fish.filter((f) => f.sp === lpSp && !f.jump && !f.gone).sort((a, b) => Math.hypot(a.x - C.x, a.z - C.z) - Math.hypot(b.x - C.x, b.z - C.z))[0];
      if (q) q.jumpT = 0.001; // its next step decides the leap (open water ahead checked as usual)
    }
    const M = G.world.commandos.find((u) => u.role === 'diver') || G.world.commandos[0];
    if (startle === 'swim' && i === sAt) { M.x = C.school.cx - 9.5; M.z = C.school.cz; M.stance = 'swim'; } // swims in from off screen
    for (let k = 0; k < sub; k++) {
      if (startle === 'swim' && i >= sAt && i < sAt + 300) { M.x += 2 / 60; M.stance = 'swim'; }
      g.advance(1 / 60); G.render(1 / 60, 1);
    }
    if (follow && C.school) { C.cx += (C.school.cx - C.cx) * follow; C.cz += (C.school.cz - C.cz) * follow; G.cameraController.centerOn(C.cx, C.cz); }
    let px = null;
    if (measure) { // pixels the fish change: the frame with the fish (and their bed shadows) vs without
      const R = G.renderer, gl = R.renderer.getContext(), W = R.renderer.domElement.width, H = R.renderer.domElement.height;
      const grab = () => { G.render(0, 1); const a = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; };
      const ms = []; L.meshes[0]?.traverse((o) => { if (/^fish/.test(o.userData?.ambientLife || '')) ms.push(o); });
      const a = grab(); for (const m of ms) m.visible = false; const b = grab(); for (const m of ms) m.visible = true; G.render(0, 1);
      px = [0, 0]; // pixels the fish change by > 18 and by > 45 (sum of |ΔR| + |ΔG| + |ΔB|, 0–255 each)
      for (let k = 0; k < a.length; k += 4) { const d = Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]); if (d > 18) px[0]++; if (d > 45) px[1]++; }
    }
    const up = L.fish.fish.filter((f) => f.y > f.level), cam = G.renderer.camera, cv = G.renderer.renderer.domElement, V = C.V || (C.V = new cam.position.constructor());
    const airAt = up.map((f) => { V.set(f.x, f.y, f.z).project(cam); return [f.sp, Math.round((V.x + 1) / 2 * cv.clientWidth), Math.round((1 - V.y) / 2 * cv.clientHeight)]; });
    return { scared: L.fish.stats.scared, jumps: L.fish.stats.jumps ?? 0, air: up.length, airAt, drawn: L.stats.drawnFish, px };
  }, { sub, i, sAt, startle, zAt, zTo, measure: vis && i % (2 * fps) === fps, lpAt, lpSp, follow });
  trace.push(fr); if (fr.px != null) visPx.push(fr.px);
  await page.screenshot({ path: join(out, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 88 });
}
const events = await page.evaluate(() => window.__fc.ev);
const med = (k) => { const v = visPx.map((q) => q[k]).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
const res = { fps, info, trace, events, startleFrame: startle ? sAt : null, visMedian: med(0), visStrong: med(1), visPx };
writeFileSync(join(out, 'trace.json'), JSON.stringify(res));
console.log('result', JSON.stringify({ frames: N, jumps: trace[trace.length - 1]?.jumps, maxScared: Math.max(...trace.map((q) => q.scared)), visMedian: res.visMedian, visStrong: res.visStrong, visPx }));
const errs = h.errors(page);
if (errs.length) console.log('ERRORS\n' + errs.slice(0, 8).join('\n'));
await page.close();
await h.close();
