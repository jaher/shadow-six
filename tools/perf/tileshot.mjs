#!/usr/bin/env node
/**
 * Anti-tiling look-dev frames: the same framings before / after a ground-material change, HUD hidden, plus the
 * screen-space projection of one world metre (x and z) at each view centre so repetition can be measured offline
 * (tools/perf/tilemetric.py) at the textures' own world periods.
 *
 *   node tools/perf/tileshot.mjs --mission=m13 --views=1:40:60,0.5:40:60 --out=dir/m13 [--preset=high]
 *     [--units=0] (hide characters / vehicles) [--ground=1] (hide every shadow caster: ground and paving only) [--w=1280 --h=720] [--gallery=1] (src/missions/dev/pavement-gallery.js)
 *
 * Writes <out>-v<i>.png and <out>.json ({views: [{zoom, x, z, px: {x:[dx,dy], z:[dx,dy]}}]}).
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = arg('out', 'tileshot');
const W = Number(arg('w', 1280)), H = Number(arg('h', 720));
const h = await startHarness({ viewport: { width: W, height: H } });
const page = await h.newPage({ width: W, height: H });
await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
await page.evaluate(async ({ m, gallery, units, ground }) => {
  const g = window.__game, G = g.game;
  if (gallery) await G.loadMission((await import('/src/missions/dev/pavement-gallery.js')).default);
  else await g.loadMission(m);
  g.start();
  g.advance(0.5); G.render(1 / 60, 1);
  await G.mapHandle?.ready;
  for (const e of G.world.enemies) if (e.brain) e.brain.update = () => {};
  if (!units) {
    for (const u of [...G.world.commandos, ...G.world.enemies]) { const o = u.model?.root || u.model?.object3d || u.object3d || u.mesh; if (o) o.visible = false; }
  }
  if (ground) { // ground only: hide everything that casts a shadow (props, furniture, buildings, trees, grass), and the selection ring
    G.renderer.scene.traverse((o) => { if ((o.isMesh || o.isLine || o.isPoints) && (o.castShadow || o.isLine || o.isPoints)) o.visible = false; });
    for (const o of G.renderer.scene.children) if (/selection|ring/i.test(o.name)) o.visible = false;
  }
  const s = document.createElement('style');
  s.textContent = '#hud, .screen, #hud * { display: none !important; }';
  document.head.appendChild(s);
}, { m: arg('mission', 'm01'), gallery: arg('gallery', '') === '1', units: arg('units', '1') !== '0', ground: arg('ground', '') === '1' });
await page.waitForTimeout(1500);
const meta = { mission: arg('mission', 'gallery'), preset: arg('preset', 'high'), views: [] };
for (const [i, v] of arg('views', '1:30:30').split(',').entries()) {
  const [zm, vx, vz] = v.split(':').map(Number);
  const px = await page.evaluate(async ({ zm, vx, vz }) => {
    const g = window.__game, G = g.game;
    G.cameraController.setZoom(zm, true); G.cameraController.centerOn(vx, vz);
    for (let k = 0; k < 4; k++) G.render(1 / 60, 1);
    const THREE = await import('three');
    const cam = G.cameraController.camera || G.renderer.camera, y = G.world.terrain?.heightAt?.(vx, vz) ?? 0;
    const pr = (x, z) => { const p = new THREE.Vector3(x, y, z).project(cam); return [(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight]; };
    const c = pr(vx, vz), ax = pr(vx + 1, vz), az = pr(vx, vz + 1);
    return { c, x: [ax[0] - c[0], ax[1] - c[1]], z: [az[0] - c[0], az[1] - c[1]] };
  }, { zm, vx, vz });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const G = window.__game.game; G.render(1 / 60, 1); });
  const file = `${out}-v${i}.png`;
  await page.screenshot({ path: file });
  meta.views.push({ zoom: zm, x: vx, z: vz, file, px });
  console.log('saved', file, JSON.stringify(px));
}
const errs = h.errors(page);
if (errs.length) console.log(errs.slice(0, 6).join('\n'));
writeFileSync(`${out}.json`, JSON.stringify(meta, null, 1));
await h.close();
