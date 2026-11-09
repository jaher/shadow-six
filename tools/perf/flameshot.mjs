#!/usr/bin/env node
/**
 * Sustained-fire look-dev captures at the game camera (art/realistic-flames):
 *   node tools/perf/flameshot.mjs --scene=truck --out=dir [--tag=after] [--times=3,8,15] [--zooms=1,2]
 *     [--preset=high] [--root=<tree to serve, e.g. a base worktree>] [--clip=10 --fps=30 --clipZoom=2]
 *     [--size=1280x720] [--eval="G.world.fx.vfx.u.uFlameGain.value=2"] [--stats]
 * Loads the scene's mission, sets the fire going THROUGH THE GAME (a vehicle / structure destroyed, a drum
 * ignited, an explosion event), keeps the default camera (pitch 40°, yaw 15°) centred on it, renders every
 * sim tick and saves <tag>-<scene>-z<zoom>-t<t>.png at each time and zoom (and a JPEG frame sequence for --clip).
 * Scenes: truck (M1 Opel), store (M10 bomb store), rack (M8 oil-barrel rack), tank (M8 fuel tank), gun (M6 Leopold),
 * tanker (M15 fuel tanker), bomb / shell / grenade / barrel (explosions on M1's open snow).
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = resolve(arg('out', '.')), tag = arg('tag', 'after'), scene = arg('scene', 'truck');
const times = arg('times', '3,8').split(',').map(Number), zooms = arg('zooms', '1,2').split(',').map(Number);
const [W, H] = arg('size', '1280x720').split('x').map(Number);
mkdirSync(out, { recursive: true });
const h = await startHarness({ viewport: { width: W, height: H } });
if (arg('root')) h.server.setRoot(resolve(arg('root')));
const page = await h.newPage({ width: W, height: H });
await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}`);
try { await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 90000 }); }
catch (e) { console.log('[flameshot] page not ready:', h.errors(page).slice(0, 8).join('\n')); await h.close(); process.exit(1); }

const SCENES = {
  truck: { m: 'm01', fn: 'const v=W.vehicles.find((v)=>v.id==="truck"||v.spawn?.id==="truck")||W.vehicles.find((v)=>v.def?.kind==="land"&&!v.def.raft); v.destroy(null,"test"); return {x:v.x,z:v.z};' },
  store: { m: 'm10', fn: 'const s=W.byId("store"); s.destroy(null,"explosion"); return {x:s.x,z:s.z};' },
  rack: { m: 'm08', fn: 'const s=W.byId("rack_1"); (s.ignite? s.ignite(0) : s.destroy(null,"explosion")); return {x:s.x,z:s.z};' },
  tank: { m: 'm08', fn: 'const s=W.byId("tank_a"); s.destroy(null,"explosion"); return {x:s.x,z:s.z};' },
  gun: { m: 'm06', fn: 'const s=W.byId("leopold"); s.destroy(null,"explosion"); return {x:s.x,z:s.z};' },
  tanker: { m: 'm15', fn: 'const v=W.vehicles.find((v)=>v.def?.tanker); v.destroy(null,"test"); return {x:v.x,z:v.z};' },
  bomb: { m: 'm01', fn: 'const p={x:46,z:128}; W.events.emit("explosion",{x:p.x,z:p.z,radius:9,kind:"bomb"}); return p;' },
  shell: { m: 'm01', fn: 'const p={x:46,z:128}; W.events.emit("explosion",{x:p.x,z:p.z,radius:5,kind:"shell"}); return p;' },
  grenade: { m: 'm01', fn: 'const p={x:46,z:128}; W.events.emit("explosion",{x:p.x,z:p.z,radius:6.75,kind:"grenade"}); return p;' },
  barrel: { m: 'm01', fn: 'const d=W.interactables.find((b)=>b.interactKind==="barrel"&&!b.exploded); d.ignite(0); return {x:d.x,z:d.z};' },
  // a chimney (the reference look for smooth smoke): the busiest lit stack of --cm (default M1; M6's reads best, over its
  // dark roofs — on snow the ambient layer keeps it faint by design)
  // (the camera aims at the ground point behind the stack top along the view — the stack mid-frame — 4 m downwind:
  // room for its plume)
  chimney: { m: arg('cm', 'm01'), fn: 'const C=G.world.fx._chimneys.filter((c)=>c.activity>0).sort((a,b)=>b.activity-a.activity); const c=C[0]; const cam=G.cameraController.camera, f=cam.position.clone(); cam.getWorldDirection(f); const h=c.pos.y-(W.groundY?W.groundY(c.pos.x,c.pos.z):0), k=h/Math.max(0.2,-f.y), w=G.world.fx.vfx.u.uWind.value, wl=Math.hypot(w.x,w.z)||1; return {x:c.pos.x+f.x*k+4*w.x/wl,z:c.pos.z+f.z*k+4*w.z/wl};' },
  // a bomb's lingering smoke (its column after the blast) on M8's desert
  bombsmoke: { m: 'm08', fn: 'const c=W.commandos[0], p={x:c.x+12,z:c.z+4}; W.events.emit("explosion",{x:p.x,z:p.z,radius:9,kind:"bomb"}); return p;' },
  // the same blasts on M8's desert (no falling snow: frames reproducible across loads, for the identity check)
  bombd: { m: 'm08', fn: 'const c=W.commandos[0], p={x:c.x+9,z:c.z+5}; W.events.emit("explosion",{x:p.x,z:p.z,radius:9,kind:"bomb"}); return p;' },
  shelld: { m: 'm08', fn: 'const c=W.commandos[0], p={x:c.x+9,z:c.z+5}; W.events.emit("explosion",{x:p.x,z:p.z,radius:5,kind:"shell"}); return p;' },
  grenaded: { m: 'm08', fn: 'const c=W.commandos[0], p={x:c.x+9,z:c.z+5}; W.events.emit("explosion",{x:p.x,z:p.z,radius:6.75,kind:"grenade"}); return p;' },
};
const S = SCENES[scene];
if (!S) throw new Error(`unknown scene ${scene}`);
const at = await page.evaluate(async ({ m, fn, ev }) => {
  const g = window.__game, G = g.game;
  await g.loadMission(m);
  g.start(); G.stop?.(); G._checkEnd = () => {}; // (a capture never ends the mission: M6's evac truck gets shot up)
  await G.mapHandle?.ready;
  const W = G.world;
  for (let k = 0; k < 30; k++) { g.step(); }
  G.render(1 / 60, 1);
  if (ev) new Function('G', ev)(G);
  // (no HUD messages over the media: objective lines, M6's evac-truck warning)
  { const E = W.events, em = E.emit.bind(E); E.emit = (e, ...a) => (e === 'message' ? undefined : em(e, ...a)); }
  const p = new Function('W', 'G', fn)(W, G);
  G.cameraController.setZoom(1, true); G.cameraController.centerOn(p.x, p.z); G.render(1 / 60, 1);
  window.__flameAt = p;
  return p;
}, { m: S.m, fn: S.fn, ev: arg('eval', '') });
console.log(`[flameshot] ${scene} at ${at.x.toFixed(1)},${at.z.toFixed(1)} (${tag})`);

/** Advance dt seconds in sim ticks, drawing every `--every` ticks (default 4: the effects are analytic in time). */
const EVERY = Number(arg('every', 4));
const run = (dt) => page.evaluate(({ dt, every }) => {
  const g = window.__game, G = g.game, n = Math.round(dt * 60);
  for (let i = 0; i < n; i += every) { const k = Math.min(every, n - i); g.advance(k / 60); G.render(k / 60, 1); }
}, { dt, every: EVERY });
const YAWS = arg('yaws', '').split(',').filter(Boolean).map(Number); // e.g. --yaws=15,60: each still at every yaw (-yNN)
// --look=h: frame the smoke h m above the fire instead of the fire (the ground point behind it along the view):
// close-ups of a plume; --lookOff=dx,dz shifts that (m)
const LOOK = Number(arg('look', 0)), LOFF = arg('lookOff', '0,0').split(',').map(Number);
const shoot = async (name, z, type = 'png', yaw = null) => {
  await page.evaluate(({ z, yaw, look, loff }) => { const G = window.__game.game, p = window.__flameAt, C = G.cameraController;
    if (yaw != null) C.setYaw(yaw); C.setZoom(z, true);
    let cx = p.x, cz = p.z;
    if (look) { const cam = C.camera, f = cam.position.clone(); cam.getWorldDirection(f); const k = look / Math.max(0.2, -f.y);
      cx += f.x * k + loff[0]; cz += f.z * k + loff[1]; }
    C.centerOn(cx, cz); G.render(0, 1); }, { z, yaw, look: LOOK, loff: LOFF });
  await page.screenshot({ path: join(out, name), ...(type === 'jpeg' ? { type: 'jpeg', quality: 92 } : {}) });
};
const stats = [];
let t0 = 0;
for (const t of times) {
  await run(t - t0); t0 = t;
  if (YAWS.length) { for (const y of YAWS) for (const z of zooms) await shoot(`${tag}-${scene}-y${y}-z${z}-t${t}.png`, z, 'png', y); }
  else for (const z of zooms) await shoot(`${tag}-${scene}-z${z}-t${t}.png`, z);
  if (process.argv.includes('--stats')) stats.push({ t, ...(await page.evaluate(() => window.__game.game.world.fx.stats())) });
}
const clip = Number(arg('clip', 0));
if (clip > 0) {
  const fps = Number(arg('fps', 30)), cz = Number(arg('clipZoom', 2)), dir = join(out, `${tag}-${scene}-clip`);
  mkdirSync(dir, { recursive: true });
  for (let f = 0; f < Math.round(clip * fps); f++) {
    await run(1 / fps);
    await shoot(`${tag}-${scene}-clip/f${String(f).padStart(4, '0')}.jpg`, cz, 'jpeg');
  }
}
if (stats.length) { writeFileSync(join(out, `${tag}-${scene}-stats.json`), JSON.stringify(stats, null, 1)); console.log(JSON.stringify(stats)); }
const errs = h.errors(page);
if (errs.length) console.log(errs.slice(0, 5).join('\n'));
await h.close();
console.log('[flameshot] done');
