#!/usr/bin/env node
/**
 * Live look-dev loop for the sustained fire (art/realistic-flames): loads a mission ONCE, then executes commands
 * dropped as JSON into <dir>/cmd.json (result in <dir>/done.json), so shader / blaze.js edits are seen in seconds:
 *   node tools/perf/flamelab.mjs --mission=m01 --dir=/tmp/flamelab [--preset=high] [--size=1280x720]
 * Commands (one object, keys run in this order):
 *   {reload: true}                 re-import shaders.js + blaze.js (cache-busted) and swap the particle shaders
 *   {clear: true}                  stop the lab fires, clear the library
 *   {only: "p.mode === 3" | null}  draw only the particles matching (null: all)
 *   {eval: "js(G, lab)"}           run code in the page (lab.blaze = the fresh blaze(), lab.fires = handles)
 *   {fire: {x, z, y?, D, fuel, ...blaze opts, size:[w,d], yaw, h}}  spawn a lab fire (burning_wreck footprint)
 *   {center: [x, z]}, {advance: s}, {shoot: "name", zooms: [1, 2]} (PNGs into <dir>)
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const dir = resolve(arg('dir', '/tmp/flamelab')), [W, H] = arg('size', '1280x720').split('x').map(Number);
mkdirSync(dir, { recursive: true });
const h = await startHarness({ viewport: { width: W, height: H } });
const page = await h.newPage({ width: W, height: H });
await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
await page.evaluate(async ({ m }) => {
  const g = window.__game, G = g.game;
  await g.loadMission(m); g.start(); G.stop?.(); G._checkEnd = () => {}; // (no mission end over the look-dev) await G.mapHandle?.ready;
  for (let k = 0; k < 30; k++) g.step();
  const vfx = G.world.fx.vfx, lab = window.__lab = { fires: [], v: 0, only: null, emit0: vfx.emit };
  vfx.emit = function (p) { return lab.only && !lab.only(p) ? -1 : lab.emit0.call(this, p); }; // {only: "p.mode === 3"} filters
}, { m: arg('mission', 'm01') });
console.log('[flamelab] ready', dir);

const exec = (c) => page.evaluate(async (c) => {
  const g = window.__game, G = g.game, vfx = G.world.fx.vfx, lab = window.__lab, out = {};
  const step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) { g.advance(1 / 60); G.render(1 / 60, 1); } };
  if (c.reload) {
    lab.v++;
    const S = await import(`/src/render/vfx/shaders.js?v=${lab.v}`), B = await import(`/src/render/vfx/blaze.js?v=${lab.v}`);
    for (const m of [vfx.smoke.material, vfx.amb.material]) { m.vertexShader = S.SMOKE_VERT; m.fragmentShader = S.SMOKE_FRAG; m.needsUpdate = true; }
    lab.blaze = B.blaze; lab.B = B; out.reloaded = lab.v;
  }
  if ('only' in c) lab.only = c.only ? new Function('p', `return (${c.only});`) : null;
  if (c.clear) { for (const f of lab.fires) f.stop(); lab.fires = []; vfx.clear(); }
  if (c.eval) out.eval = new Function('G', 'lab', 'vfx', c.eval)(G, lab, vfx);
  if (c.fire) {
    const f = c.fire, THREE = await import('three'), B = lab.B || await import('/src/render/vfx/blaze.js');
    const y = f.y ?? G.world.groundY(f.x, f.z), [sx, sz] = f.size ?? [2.2, 5.5], yaw = f.yaw ?? 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const sampler = (r) => { const a = r() * 6.283, q = Math.sqrt(r()); const lx = Math.cos(a) * q * sx * 0.42, lz = Math.sin(a) * q * sz * 0.38; return [lx * cy + lz * sy, -lx * sy + lz * cy]; };
    const at = new THREE.Vector3(f.x, y + (f.h ?? 0), f.z);
    lab.fires.push(B.blaze(vfx, B.prng(f.seed ?? 7), { at, sampler, box: { rx: sx * 0.42, rz: sz * 0.38, yaw }, D: Math.sqrt(sx * sz), dur: 1e6, fuel: 'oil', ramp: 1.5, ...f }));
  }
  if (c.yaw != null) G.cameraController.setYaw(c.yaw);
  if (c.center) G.cameraController.centerOn(c.center[0], c.center[1]);
  if (c.advance) step(c.advance);
  out.stats = G.world.fx.stats();
  return out;
}, c);

let n = 0;
for (;;) {
  const f = join(dir, 'cmd.json');
  if (existsSync(f)) {
    const c = JSON.parse(readFileSync(f, 'utf8')); renameSync(f, join(dir, `cmd.${n++}.done`));
    let res;
    try {
      res = await exec(c);
      if (c.clip) { // {clip: {name, sec, fps, zoom}}: a JPEG frame sequence <dir>/<name>/fNNNN.jpg
        const { name, sec = 4, fps = 30, zoom = 2 } = c.clip, cd = join(dir, name); mkdirSync(cd, { recursive: true });
        await page.evaluate(({ zoom }) => { const G = window.__game.game; G.cameraController.setZoom(zoom, true); }, { zoom });
        for (let f = 0; f < Math.round(sec * fps); f++) {
          await page.evaluate(({ dt }) => { const g = window.__game, G = g.game; for (let i = 0; i < Math.round(dt * 60); i++) { g.advance(1 / 60); G.render(1 / 60, 1); } }, { dt: 1 / fps });
          await page.screenshot({ path: join(cd, `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 90 });
        }
        res.clip = Math.round(sec * fps);
      }
      if (c.shoot) for (const z of c.zooms ?? [1, 2]) {
        await page.evaluate(({ z }) => { const G = window.__game.game; G.cameraController.setZoom(z, true); G.render(0, 1); }, { z });
        await page.screenshot({ path: join(dir, `${c.shoot}-z${z}.png`) });
      }
    } catch (e) { res = { error: String(e.stack || e) }; }
    res.errors = h.errors(page).splice(0);
    writeFileSync(join(dir, 'done.json'), JSON.stringify(res));
    if (c.quit) break;
  }
  await new Promise((r) => setTimeout(r, 300));
}
await h.close();
