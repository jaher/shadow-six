#!/usr/bin/env node
/**
 * Bake what the main menu's ground fight needs from each theatre's still camera (tools/ui/ground/ground-bake.js in the
 * game page): the camera, a 16-bit depth map and the raw frame (alignment check) at 2x the still (3840 x 2160) —
 * then tools/ui/ground/*.py turn them into the per-lane occlusion masks and sprite sheets.
 *   node tools/ui/ground/bake_ground.mjs [theatre ...] [--out=<dir>] [--only=sprites|depth] [--looks=id,...]
 * (default: every theatre, <tmp>/ground-bake; --looks re-renders only those looks' sprites, keeping the rest)
 * One GPU capture at a time (CHROME as for the tests).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startHarness } from '../../../tests/harness.mjs';
import { THEATRES } from '../loading-shots.mjs';
import { CAST, HEADINGS, framesOf, needs } from './cast.mjs';

const args = process.argv.slice(2);
const OUT = (args.find((a) => a.startsWith('--out=')) || '').slice(6) || join(tmpdir(), 'ground-bake');
const names = args.filter((a) => !a.startsWith('--'));
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7);   // depth | sprites (default both)
const list = names.length ? names : Object.keys(THEATRES);
const W = 3840, H = 2160;
const png = (url) => Buffer.from(url.split(',')[1], 'base64');

/**
 * The cast's sprites (cast.mjs) through the posed camera: a WIN window around each man at ZOOM render px a still
 * px (packed down to the atlas's scale: crisp silhouettes, helmets, rifles and kit at 18-32 px), each look in the acts
 * and headings the theatre's fights give him (cast.mjs needs), his sun shadow baked under him (SHADOW: the still's
 * shadow darkness), and where his muzzle and right hand are per frame. Headings turn round the camera's own heading
 * on the ground (0 = away from it, 90 = to the screen's right).
 */
const ZOOM = 6, VZOOM = 3, WIN = [840, 520];
// the window covers ~6 m across at each theatre's scale (a man lying full length with his rifle, his sun shadow): the
// desert's men stand nearer (31-35 px/m), so it renders at 4x (still 3.6x the atlas's scale); he stands right of the
// window's middle, where his shadow falls left (the snow's low sun: furthest)
const ZOOM_OF = { desert: 4 }, ANCHOR_OF = { snow: 0.66 }, ANCHOR = 0.6;
const SHADOW = { temperate: 0.5, snow: 0.42, desert: 0.55, coast: 0.45 };
async function bakeSprites(page, th, cam, dir) {
  const C = CAST[th], sp = join(dir, 'sprites');
  mkdirSync(sp, { recursive: true });
  const m = cam.matrixWorld, away = Math.atan2(-m[8], -m[10]);   // the camera's forward (-Z column) on the ground
  await page.setViewportSize({ width: WIN[0], height: WIN[1] });
  await page.evaluate(() => window.__game.game.renderer.resize());
  const need = needs(th, away), Z = ZOOM_OF[th] ?? ZOOM;
  const meta = { headings: HEADINGS, away, looks: {}, vehicle: null };
  const run = async (spec) => page.evaluate(async (x) => (await import('/tools/ui/ground/ground-bake.js')).sprites(x), spec);
  const ONLYL = (args.find((a) => a.startsWith('--looks=')) || '').slice(8).split(',').filter(Boolean);
  for (const [id, L] of Object.entries(C.looks)) {
    const N = need[id];
    if (!N) { console.warn(`${th}: look ${id} is in no fight (not baked)`); continue; }
    meta.looks[id] = { side: L.side, name: L.name, w: L.w, fall: !!L.fall, acts: {} };
    for (const [act, hs] of Object.entries(N)) meta.looks[id].acts[act] = { frames: framesOf(L, act).length, headings: [...hs].sort((a, b) => a - b) };
    if (ONLYL.length && !ONLYL.includes(id)) continue;
    const t0 = Date.now();
    let n = 0;
    for (const hdg of HEADINGS) {
      const poses = [];
      for (const [act, hs] of Object.entries(N)) {
        if (!hs.has(hdg)) continue;
        framesOf(L, act).forEach((f, k) => poses.push({ key: `${id}_${hdg}_${act}_${k}`, heading: away - hdg * Math.PI / 180, clip: f.clip, phase: f.phase, loop: f.loop }));
      }
      if (!poses.length) continue;
      const res = await run({ kind: 'soldier', theatre: th, make: L.make, arm: L.arm || null, prop: L.prop || null, unalias: L.unalias || null,
        at: L.at || C.at[L.side], zoom: Z, anchor: ANCHOR_OF[th] ?? ANCHOR, poses, shadow: SHADOW[th] ?? 0.5 });
      for (const f of res.frames) {
        writeFileSync(join(sp, `${f.key}.png`), png(f.png));
        meta[f.key] = { ax: f.ax, ay: f.ay, pxm: res.pxm, zoom: Z, muzzle: f.muzzle || null, hand: f.hand || null };
      }
      n += res.frames.length;
    }
    console.log(`  ${th} ${id}: ${n} frames, ${Object.keys(N).join(' ')} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  if (C.vehicle && !ONLYL.length) {
    const V = C.vehicle, poses = [];
    V.travel.forEach((tr, k) => poses.push({ key: `veh_drive_${k}`, heading: V.heading, turret: 0, travel: tr }));
    V.turret.forEach((ty, k) => poses.push({ key: `veh_turret_${k}`, heading: V.heading, turret: ty * Math.PI / 180 }));
    [0.32, 0.16].forEach((rc, k) => poses.push({ key: `veh_fire_${k}`, heading: V.heading, turret: V.turret.at(-1) * Math.PI / 180, recoil: rc }));
    const res = await run({ kind: 'vehicle', theatre: th, make: V.make, at: V.at, y: V.y, zoom: VZOOM, poses });
    for (const f of res.frames) { writeFileSync(join(sp, `${f.key}.png`), png(f.png)); meta[f.key] = { ax: f.ax, ay: f.ay, pxm: res.pxm, zoom: VZOOM }; }
    const A = V.also;
    if (A) {   // the same drive seen from a second spot on its road (veh_<key>_drive_k), used from A.from m along it
      const p2 = V.travel.map((tr, k) => ({ key: `veh_${A.key}_drive_${k}`, heading: A.heading ?? V.heading, turret: 0, travel: tr }));
      const r2 = await run({ kind: 'vehicle', theatre: th, make: V.make, at: A.at, y: A.y ?? V.y, zoom: VZOOM, poses: p2 });
      for (const f of r2.frames) { writeFileSync(join(sp, `${f.key}.png`), png(f.png)); meta[f.key] = { ax: f.ax, ay: f.ay, pxm: r2.pxm, zoom: VZOOM }; }
    }
    meta.vehicle = { travel: V.travel, turret: V.turret, at: V.at, y: V.y, heading: V.heading, also: A ? { key: A.key, from: A.from } : null };
  }
  if (ONLYL.length && existsSync(join(dir, 'sprites.json'))) {   // a partial re-bake: the other looks' frames and the vehicle kept
    const old = JSON.parse(readFileSync(join(dir, 'sprites.json'), 'utf8'));
    for (const k of Object.keys(old)) if (ONLYL.some((id) => k.startsWith(`${id}_`)) && !(k in meta)) delete old[k];
    Object.assign(old, meta, { vehicle: old.vehicle });
    writeFileSync(join(dir, 'sprites.json'), JSON.stringify(old));
  } else writeFileSync(join(dir, 'sprites.json'), JSON.stringify(meta));
  console.log('sprites ->', sp);
}

const Hn = await startHarness({ viewport: { width: 1280, height: 720 } });
try {
  for (const th of list) {
    const dir = join(OUT, th);
    mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    const page = await Hn.newPage({ width: 1280, height: 720 });
    await Hn.openGame(page);
    await page.setViewportSize({ width: W, height: H });
    const cam = await page.evaluate(async ([t, w, h]) => (await import('/tools/ui/ground/ground-bake.js')).setup(t, w, h), [th, W, H]);
    writeFileSync(join(dir, 'camera.json'), JSON.stringify(cam));
    // (the still is always rendered: its warm-up is what the sprites' renders need — without it they come out black)
    const stillPng = png(await page.evaluate(async () => (await import('/tools/ui/ground/ground-bake.js')).still()));
    if (ONLY !== 'sprites') {
      writeFileSync(join(dir, 'still.png'), stillPng);
      writeFileSync(join(dir, 'depth.png'), png(await page.evaluate(async () => (await import('/tools/ui/ground/ground-bake.js')).depth())));
    }
    if (ONLY !== 'depth' && CAST[th]) await bakeSprites(page, th, cam, dir);
    await page.evaluate(async () => (await import('/tools/ui/ground/ground-bake.js')).done());
    const errs = Hn.errors(page);
    if (errs.length) console.warn(`${th} page errors:`, errs.slice(0, 3).join(' | ').slice(0, 400));
    await page.close();
    console.log(`${th}: camera, still, depth -> ${dir} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
} finally {
  await Hn.close();
}
