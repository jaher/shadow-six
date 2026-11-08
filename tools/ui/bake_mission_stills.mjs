#!/usr/bin/env node
/**
 * Bake the loading-card stills (docs/menus-art-direction.md S14: one per mission, assets/ui/loading/<id>.webp) and the
 * B1s theatre backdrops (§1.10: assets/ui/diorama/<theater>.webp) from the real engine: each mission loaded at the
 * ultra preset in headless GPU Chromium (?test=1), settled, then framed on its signature spot by a low three-quarter
 * perspective camera (tools/ui/still-camera.js; the shots are in tools/ui/loading-shots.mjs). Rendered at 2× the
 * output size, then graded to the briefing's photo-print look and downsampled by tools/ui/grade_stills.py.
 * Re-run after art changes:
 *
 *   node tools/ui/bake_mission_stills.mjs                  every mission + every theatre backdrop
 *   node tools/ui/bake_mission_stills.mjs m03 m06 desert   just these (mission ids / theatre names)
 *   node tools/ui/bake_mission_stills.mjs --grade-only     regrade the raw renders kept in --raw
 *   node tools/ui/bake_mission_stills.mjs --probe=m03 --try='{"yaw":30}' --try='{"yaw":60,"dist":90}'
 *       framing trials: the mission's shot with each override, saved as <raw>/probe-<id>-<n>.jpg (no grade, no assets)
 *   node tools/ui/bake_mission_stills.mjs --plan=trials.json     the same for several: { "m03": [{...}, ...], ... }
 *
 * Options: --raw=<dir> (raw renders, default <tmp>/shadow-six-stills), --scale=<n> (supersampling, default 2),
 * --no-grade (renders only). Needs python3 with Pillow + numpy (the grade). One GPU capture at a time; the browser is
 * tests/harness.mjs's (CHROME overrides it, e.g. a wrapper for a host whose GL path needs other flags).
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { startHarness, ROOT } from '../../tests/harness.mjs';
import { SHOTS, THEATRES, MISSION_SIZE, BACKDROP_SIZE } from './loading-shots.mjs';

const args = process.argv.slice(2);
const opt = (k, d = null) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flag = (k) => args.includes(`--${k}`);
const RAW = opt('raw', join(tmpdir(), 'shadow-six-stills'));
const SCALE = Number(opt('scale', 2)) || 2;
const probe = opt('probe');
const tries = args.filter((x) => x.startsWith('--try=')).map((x) => JSON.parse(x.slice(6)));
const names = args.filter((x) => !x.startsWith('--'));
mkdirSync(RAW, { recursive: true });

/** jobs: { key, mission (the map loaded), shot, size:[w,h] (output px), kind:'mission'|'backdrop'|'probe', out } */
const jobs = [];
const want = (k) => !names.length || names.includes(k);
const plan = opt('plan'); // framing trials for several missions: a JSON file { "<id or theatre>": [override, ...] }
const trials = plan ? JSON.parse(readFileSync(plan, 'utf8')) : probe ? { [probe]: tries.length ? tries : [{}] } : null;
if (trials) {
  for (const [id, list] of Object.entries(trials)) {
    const base = SHOTS[id] || THEATRES[id] || {};
    const size = THEATRES[id] ? BACKDROP_SIZE : MISSION_SIZE;
    list.forEach((t, i) => {
      const shot = { ...base, ...t };
      jobs.push({ key: `probe-${id}-${i}`, mission: shot.mission || id, shot, size, kind: 'probe' });
    });
  }
} else {
  for (const [id, shot] of Object.entries(SHOTS)) if (want(id)) jobs.push({ key: id, mission: id, shot, size: MISSION_SIZE, kind: 'mission', out: join(ROOT, 'assets/ui/loading', `${id}.webp`) });
  for (const [th, shot] of Object.entries(THEATRES)) if (want(th)) jobs.push({ key: `theatre-${th}`, mission: shot.mission, shot, size: BACKDROP_SIZE, kind: 'backdrop', out: join(ROOT, 'assets/ui/diorama', `${th}.webp`) });
}
if (!jobs.length) { console.log('nothing to bake (unknown ids?)', names); process.exit(1); }

function grade(job) {
  const raw = join(RAW, `${job.key}.png`);
  if (!existsSync(raw)) { console.warn(`no raw render for ${job.key} (${raw})`); return; }
  mkdirSync(join(job.out, '..'), { recursive: true });
  const g = job.shot.grade || {};
  const r = spawnSync('python3', [join(ROOT, 'tools/ui/grade_stills.py'), raw, job.out, `--size=${job.size.join('x')}`, `--kind=${job.kind}`, `--grade=${JSON.stringify(g)}`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`grade ${job.key}: ${r.stderr || r.stdout}`);
  console.log(r.stdout.trim());
}

if (!flag('grade-only')) {
  // one page per mission (a clean world each time); the shots of a mission share its load
  const byMission = new Map();
  for (const j of jobs) { if (!byMission.has(j.mission)) byMission.set(j.mission, []); byMission.get(j.mission).push(j); }
  const H = await startHarness({ viewport: { width: 1280, height: 720 } });
  try {
    for (const [mission, list] of byMission) {
      const t0 = Date.now();
      const vp = (j) => ({ width: j.size[0] * SCALE, height: j.size[1] * SCALE });
      // boots at a normal size (resized per shot); the GPU is shared, so a failed context creation is retried
      let page = null;
      for (let attempt = 1; !page; attempt++) {
        const p = await H.newPage({ width: 1280, height: 720 });
        try { await H.openGame(page = p); } catch (e) {
          console.warn(`${mission}: boot failed (attempt ${attempt})`, H.errors(p).slice(0, 2).join(' | ').slice(0, 300));
          await p.close();
          page = null;
          if (attempt >= 4) throw e;
          await new Promise((r) => setTimeout(r, 8000 * attempt));
        }
      }
      await page.evaluate(async ({ mission, advance }) => {
        const m = await import('/tools/ui/still-camera.js');
        await m.loadForStill(mission, { advance });
      }, { mission, advance: list[0].shot.advance ?? 4 });
      for (const j of list) {
        await page.setViewportSize(vp(j));
        const url = await page.evaluate(async ({ shot, w, h }) => {
          const m = await import('/tools/ui/still-camera.js');
          window.__game.game.renderer.resize();
          return m.renderStill(shot, w, h);
        }, { shot: j.shot, w: vp(j).width, h: vp(j).height });
        const buf = Buffer.from(url.split(',')[1], 'base64');
        const raw = join(RAW, `${j.key}.png`);
        writeFileSync(raw, buf);
        if (j.kind === 'probe') {
          spawnSync('python3', ['-c', 'import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert("RGB");im.thumbnail((1000,1000));im.save(sys.argv[2],quality=86)', raw, raw.replace(/\.png$/, '.jpg')]);
        }
        console.log(`${j.key}: ${(buf.length / 1e6).toFixed(1)} MB raw (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      }
      const errs = H.errors(page);
      if (errs.length) console.warn(`${mission} page errors:`, errs.slice(0, 4).join(' | '));
      await page.close();
    }
  } finally {
    await H.close();
  }
}
if (!trials && !flag('no-grade')) for (const j of jobs) grade(j);
