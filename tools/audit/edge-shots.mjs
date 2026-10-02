#!/usr/bin/env node
/**
 * Fixed camera spots at the map edge, saved as JPEG (before / after comparisons for the map-boundary work; see
 * tools/audit/edge-sweep.mjs for the measured sweep). Each spot: mission, view size, yaw, zoom and a screen push
 * (sx, sy in -1..1) driven into the camera clamp from the map centre, plus an optional pan along the edge (m).
 *   node tools/audit/edge-shots.mjs <outDir> <id>:<W>x<H>:<yaw>:<zoom>:<sx>,<sy>[:<ax>,<az>] ...
 * Saves <outDir>/<id>-<W>x<H>-y<yaw>-z<zoom>-<sx>_<sy>.jpg (the camera's real clamp, scene as the player sees it).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const [out, ...specs] = process.argv.slice(2);
if (!out || !specs.length) { console.log('node tools/audit/edge-shots.mjs <outDir> <id>:<W>x<H>:<yaw>:<zoom>:<sx>,<sy>[:<ax>,<az>] ...'); process.exit(1); }
mkdirSync(out, { recursive: true });
const byMission = new Map();
for (const s of specs) {
  const [id, size, yaw, zoom, push, along = '0,0'] = s.split(':');
  const [w, h] = size.split('x').map(Number), [sx, sy] = push.split(',').map(Number), [ax, az] = along.split(',').map(Number);
  if (!byMission.has(id)) byMission.set(id, []);
  byMission.get(id).push({ id, w, h, yaw: Number(yaw), zoom: zoom === 'min' ? 0 : Number(zoom), sx, sy, ax, az, name: `${id}-${size}-y${yaw}-z${zoom}-${sx}_${sy}` });
}
const H = await startHarness();
try {
  for (const [id, list] of byMission) {
    const page = await H.newPage({ width: list[0].w, height: list[0].h });
    await H.openGame(page);
    await page.evaluate(async (id) => { const g = window.__game; await g.loadMission(id); g.start(); await g.game.mapHandle?.terrain?.apronReady; }, id);
    for (const s of list) {
      await page.setViewportSize({ width: s.w, height: s.h });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const url = await page.evaluate(async (s) => {
        const g = window.__game, G = g.game, cc = G.cameraController;
        G.cameraRig.setYaw(s.yaw); g.setZoom(s.zoom || 0.01);
        cc.centerOn(G.world.width / 2 + s.ax, G.world.depth / 2 + s.az);
        for (let i = 0; i < 400; i++) cc._panScreenMetres(s.sx * 2, s.sy * 2);
        g.render(); g.render();
        return G.renderer.domElement.toDataURL('image/jpeg', 0.85);
      }, s);
      writeFileSync(join(out, `${s.name}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
      console.log('saved', s.name);
    }
    const errs = H.errors(page);
    if (errs.length) console.log(id, 'page errors:', errs.slice(0, 3).join(' | '));
    await page.close();
  }
} finally {
  await H.close();
}
