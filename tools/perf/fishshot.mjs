#!/usr/bin/env node
/**
 * Ambient life frame sequences + perf (step 4f: fish, gulls, crows, ducks).
 *
 *   node tools/perf/fishshot.mjs --mission=m01 --out=docs/screenshots/p3-fish-m01 [--frames=4] [--gap=0.5]
 *     [--preset=high] [--zoom=2.5] [--at=x:z | --at=school:herring | --at=bird:gull] [--blast=1|<x offset m>] [--shoot=1]
 *     [--wind=coast] [--perf=1] [--w=1280 --h=720] [--demo=coast|temperate|desert]
 *
 * Loads the mission in test mode, centres the camera (optionally on the first school of a species / a bird),
 * advances the SIM by `gap` s between PNG frames (<out>-N.png). --blast sets off an explosion in the water at the
 * view centre after frame 0 (stun + scatter); --shoot fires a shot event there (bird flush). --perf prints the
 * ambient-life CPU ms per frame (director frame(): sims + instance upload) and the GPU-inclusive frame time with
 * the life meshes shown vs hidden. --demo loads the sandbox re-themed with a sea strip + pier along the south edge
 * (coast: grey mullet / sea bass under the pier, gulls) and a pond (temperate: perch, mallards).
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = arg('out', 'fishshot');
const h = await startHarness({});
const page = await h.newPage({ width: Number(arg('w', 1280)), height: Number(arg('h', 720)) });
page.on('console', (m) => { if (/^life /.test(m.text())) console.log(m.text()); });
await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
const at = await page.evaluate(async ({ m, zoom, at, wind, demo }) => {
  const g = window.__game, G = g.game;
  if (demo) {
    const base = (await import('/src/missions/m00_sandbox.js')).default;
    await G.loadMission({ ...base, id: 'm00', theater: demo,
      terrain: [...base.terrain, { type: 'rect', terrain: 'water', x: 0, z: 47, w: 60, d: 13 }, { type: 'rect', terrain: 'water', x: 6, z: 6, w: 12, d: 9 }],
      structures: [...(base.structures || []), { id: 'demo_pier', type: 'pier', x: 24, z: 50.5, rot: Math.PI / 2, w: 8, d: 2.5 }] });
  } else await g.loadMission(m);
  g.start();
  if (wind) {
    const W = await import('/src/world/wind.js');
    const ev = G.world.wind.events;
    G.world.wind = new W.WindField(W.resolveWind({ theater: G.missionDef.theater, weather: { wind: { preset: wind } } }), { W: G.world.width, D: G.world.depth });
    G.world.wind.events = ev;
  }
  g.advance(0.5); G.render(1 / 60, 1);
  const L = G.mapHandle.life;
  let [x, z] = [G.world.commandos[0].x, G.world.commandos[0].z];
  if (at?.startsWith('school:')) { g.advance(4); const s = L.fish.schools.find((q) => q.sp === at.slice(7)); if (s) { x = s.cx; z = s.cz; } }
  else if (at?.startsWith('fly:')) { // a bird on the wing: frame its ground point shifted along the view ray (ortho, 40° pitch)
    const b = L.birds.birds.find((q) => q.sp === at.slice(4) && q.st === 'soar') || L.birds.birds.find((q) => q.sp === at.slice(4));
    if (b) { const T = await import('three'), d = G.renderer.camera.getWorldDirection(new T.Vector3()), t = (-0.5 - b.y) / d.y; x = b.x + d.x * t; z = b.z + d.z * t; }
  } else if (at?.startsWith('bird:')) { const b = L.birds.birds.find((q) => q.sp === at.slice(5) && q.st !== 'soar') || L.birds.birds.find((q) => q.sp === at.slice(5)); if (b) { x = b.x; z = b.z; } }
  else if (at) [x, z] = at.split(':').map(Number);
  G.cameraController.setZoom(zoom);
  G.cameraController.centerOn(x, z);
  g.advance(1); g.render();
  console.log('life', JSON.stringify({ ...L.stats, schools: L.fish?.schools.map((s) => `${s.sp}:${s.members.length}@${s.cx.toFixed(0)},${s.cz.toFixed(0)}`),
    birds: L.birds.census(), at: [+x.toFixed(1), +z.toFixed(1)] }));
  return [x, z];
}, { m: arg('mission', 'm01'), zoom: Number(arg('zoom', 2.5)), at: arg('at', ''), wind: arg('wind', ''), demo: arg('demo', '') });
await page.waitForTimeout(400);
const frames = Number(arg('frames', 4)), gap = Number(arg('gap', 0.5));
for (let i = 0; i < frames; i++) {
  if (i) await page.evaluate(({ s, i, blast, shoot, at }) => {
    const G = window.__game.game;
    if (i === 1 && blast) G.world.events.emit('explosion', { x: at[0] + Number(blast === '1' ? 0 : blast), z: at[1], radius: 3, kind: 'grenade' });
    if (i === 1 && shoot) G.world.events.emit('shot', { from: { x: at[0], z: at[1] }, to: { x: at[0] + 5, z: at[1] }, hit: false, weapon: 'rifle' });
    window.__game.advance(s);
  }, { s: gap, i, blast: arg('blast', ''), shoot: arg('shoot', ''), at });
  await page.evaluate(() => window.__game.render());
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__game.render());
  await page.screenshot({ path: `${out}-${i}.png` });
  const st = await page.evaluate(() => { const L = window.__game.game.mapHandle.life; return { ...L.stats, stunned: L.fish?.stunned ?? 0, scared: L.fish?.stats.scared ?? 0, birds: L.birds.census() }; });
  console.log('saved', `${out}-${i}.png`, JSON.stringify(st));
}
if (arg('perf', '')) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, L = G.mapHandle.life;
    const run = async (show) => {
      for (const m of L.meshes) m.visible = show;
      const ms = [], life = [];
      for (let k = 0; k < 60; k++) {
        g.advance(1 / 60);
        const t0 = performance.now();
        G.render(1 / 60, 1);
        G.renderer.renderer.getContext().finish();
        ms.push(performance.now() - t0); life.push(L.stats.ms);
        await new Promise((ok) => requestAnimationFrame(ok));
      }
      ms.sort((a, b) => a - b); life.sort((a, b) => a - b);
      return { frame: +ms[30].toFixed(2), lifeCpu: +life[30].toFixed(3) };
    };
    const on1 = await run(true), off = await run(false), on2 = await run(true);
    // director CPU (sims + threats + culling + instance upload), 300 frames at 60 Hz sim time (timer is coarse)
    const W = G.world.wind, t0w = W.t, cam = G.renderer.camera, t0 = performance.now();
    for (let k = 0; k < 300; k++) { W.t += 1 / 60; L.frame(1 / 60, cam); }
    const cpu = (performance.now() - t0) / 300;
    W.t = t0w; L.frame(0, cam);
    return { cpuMs: +cpu.toFixed(3), on: on1, off, on2, fish: L.stats.fish, birds: L.stats.birds, drawn: [L.stats.drawnFish, L.stats.drawnBirds], preset: G.renderer.presetName };
  });
  console.log('perf', JSON.stringify(r));
}
const errs = h.errors(page);
if (errs.length) console.log('ERRORS\n' + errs.slice(0, 8).join('\n'));
await page.close();
await h.close();
