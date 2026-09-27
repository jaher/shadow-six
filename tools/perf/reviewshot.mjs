#!/usr/bin/env node
/**
 * Art-direction review stills (art integration 2): one scene per call, 1920×1080 PNG.
 *
 *   node tools/perf/reviewshot.mjs --mission=m01 --scene=zoom|structure|lineup|xray --out=dir [--id=structureId] [--zoom=2]
 *
 *  zoom       commandos (or --at=x:z) at --zooms (default 0.5,1,2)
 *  structure  camera on a structure (--id), a commando + an enemy at its first door (scale check)
 *  lineup     the squad + 4 enemies in walk / run / crawl / stab / shoot / dead / carry poses next to a building
 *  xray       a commando and an enemy behind the nearest real building (X-ray silhouettes over the roof)
 */
import { mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const mission = arg('mission', 'm01'), scene = arg('scene', 'zoom'), out = arg('out', '.');
mkdirSync(out, { recursive: true });
const h = await startHarness({ viewport: { width: 1920, height: 1080 } });
const page = await h.newPage({ width: 1920, height: 1080 });
await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}${arg('query', '')}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
await page.evaluate(async (m) => { const g = window.__game; await g.loadMission(m); g.start(); for (let i = 0; i < 20; i++) g.step(); }, mission);
const snap = async (name) => { await page.waitForTimeout(200); await page.evaluate(() => window.__game.render()); await page.screenshot({ path: join(out, `${mission}-${name}.png`) }); console.log('saved', `${mission}-${name}.png`); };

if (scene === 'zoom') {
  for (const z of arg('zooms', '0.5,1,2').split(',').map(Number)) {
    await page.evaluate(({ z, at }) => { const g = window.__game, c = g.game.world.commandos[0]; const [x, y] = at ? at.split(':').map(Number) : [c.x, c.z]; g.setZoom(z); g.centerOn(x, y); for (let i = 0; i < 20; i++) g.step(); }, { z, at: arg('at', '') });
    await snap(`zoom${z}${arg('at', '') ? '@' + arg('at', '').replace(':', '_') : ''}`);
  }
} else if (scene === 'walk') {
  // footprints under the real feet: one commando walks, one crawls, zoom 2
  const r = await page.evaluate(() => {
    const g = window.__game, G = g.game, w = G.world, [a, b] = w.commandos;
    for (const e of w.enemies) if (e.brain) e.brain.update = () => {};
    a.moveTo(a.x + 9, a.z + 1); if (b) { b.setPosition(a.x, a.z + 3, 0); b.setStance('crawl'); b.moveTo(a.x + 5, a.z + 3); }
    for (let i = 0; i < 260; i++) { G.step(1 / 60); G.render(1 / 60, 1); }
    g.setZoom(2); g.centerOn(a.x - 2, a.z + 1.5); G.render(1 / 60, 1);
    return { a: [a.x, a.z, a.model.clip], b: b && [b.x, b.z, b.model.clip] };
  });
  console.log(JSON.stringify(r));
  await snap('walk');
} else {
  const info = await page.evaluate(async ({ scene, id, zoom, OFF }) => {
    const g = window.__game, G = g.game, w = G.world;
    const libs = [];
    G.renderer.scene.traverse((o) => { if (o.userData?.libraryAsset) libs.push(o); });
    const c0 = w.commandos[0];
    const near = (x, z) => libs.map((o) => ({ o, d: Math.hypot(o.position.x - x, o.position.z - z) })).sort((a, b) => a.d - b.d);
    let target = id ? libs.find((o) => o.name.endsWith(':' + id)) : near(c0.x, c0.z)[0]?.o;
    if (!target) return { err: 'no structure', names: libs.map((o) => o.name) };
    const T = target.position;
    // hold everyone still: no AI, no alarm
    for (const e of w.enemies) if (e.brain) e.brain.update = () => {};
    const { Enemy } = await import('/src/entities/enemy.js');
    const put = (u, x, z, hd, anim) => { u.stop?.(); u.setPosition(x, z, hd); if (anim) { u._animOverride = anim; u.model.setAnim(anim); } };
    const box = new (await import('three')).Box3().setFromObject(target);
    if (scene === 'structure' || scene === 'xray') {
      const e = new Enemy({ id: 'rvE', soldierType: 'soldier', x: T.x, z: T.z }); w.add(e); await e.model.ready;
      if (e.brain) e.brain.update = () => {};
      if (scene === 'structure') {
        // in front of the building (camera side = +z), one commando, one enemy
        put(c0, T.x - 1, box.max.z + 1.2, Math.PI / 2, 'idle'); put(e, T.x + 1, box.max.z + 1.2, Math.PI / 2, 'idle');
      } else {
        put(c0, T.x - 1, box.min.z + 1.5, 0, 'walk'); put(e, T.x + 1.5, (box.min.z + T.z) / 2, 0, 'idle');
      }
    } else if (scene === 'lineup') {
      const anims = ['idle', 'walk', 'run', 'crawl', 'stab', 'shoot', 'dead', 'carry_walk', 'aim', 'die'];
      const units = [...w.commandos];
      for (let k = 0; units.length < anims.length; k++) { const e = new Enemy({ id: 'rvL' + k, soldierType: ['soldier', 'officer', 'sentry', 'mg'][k % 4], x: T.x, z: T.z }); w.add(e); await e.model.ready; if (e.brain) e.brain.update = () => {}; units.push(e); }
      units.slice(0, anims.length).forEach((u, i) => put(u, box.min.x + 1 + i * 1.6, box.max.z + Number(OFF), Math.PI / 2 + (i % 2 ? 0.5 : -0.5), anims[i]));
    }
    g.setZoom(zoom); g.centerOn(T.x, scene === 'lineup' ? box.max.z + Number(OFF) - 2 : (box.max.z + T.z) / 2 + 1);
    for (let i = 0; i < 40; i++) { G.render(1 / 60, 1); }
    return { asset: target.userData.libraryAsset, name: target.name, size: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z].map((v) => +v.toFixed(1)) };
  }, { scene, id: arg('id', ''), zoom: Number(arg('zoom', 2)), OFF: arg('off', '2.5') });
  console.log(JSON.stringify(info));
  await snap(`${scene}${arg('id', '') ? '-' + arg('id', '') : ''}`);
}
const errs = h.errors(page);
if (errs.length) console.log(errs.slice(0, 5).join('\n'));
await h.close();
