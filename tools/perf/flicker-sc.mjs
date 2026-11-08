#!/usr/bin/env node
/**
 * The flicker detector (tools/perf/flicker-detect.mjs) on the composited page: the screencast frames that
 * tools/perf/flicker.mjs --sc saved (JPEG, DOM layers and anything presented between two game frames included),
 * decoded small by ffmpeg.
 *
 *   node tools/perf/flicker-sc.mjs <scdir> [--T=16] [--from=<s>] [--to=<s>] [--ffmpeg=<bin>] [--json=out.json]
 * @module tools/perf/flicker-sc
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectFlicker, describe } from './flicker-detect.mjs';

export const FFMPEG = process.env.FFMPEG || '~/.cache/uv/archive-v0/NjIDgtZZCyFfXtLTbMcoa/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2';

/** Decoded screencast frames {i, t (page ms), w, h, px (RGB)} of `dir` (index.json + NNNNN.jpg). */
export function loadScreencast(dir, { w = 80, h = 45, from = -Infinity, to = Infinity, ffmpeg = FFMPEG } = {}) {
  const ix = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  const list = ix.frames.map(([k, ts]) => ({ k, t: ts * 1000 - ix.origin })).filter((f) => f.t >= from * 1000 && f.t <= to * 1000 && existsSync(join(dir, `${String(f.k).padStart(5, '0')}.jpg`)));
  if (!list.length) return [];
  // (frames are consecutive files: ffmpeg's image2 demuxer from the first one, as many as listed)
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-start_number', String(list[0].k), '-i', join(dir, '%05d.jpg'), '-frames:v', String(list.at(-1).k - list[0].k + 1),
    '-vf', `scale=${w}:${h}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  const sz = w * h * 3, byK = new Map(list.map((f) => [f.k, f]));
  const out = [];
  for (let j = 0; (j + 1) * sz <= r.stdout.length; j++) {
    const k = list[0].k + j, f = byK.get(k);
    if (!f) continue;
    // rows top-down (JPEG): flip to the probe's bottom-up order, so cells and boxes read the same way
    const px = new Uint8Array(sz);
    for (let y = 0; y < h; y++) px.set(r.stdout.subarray(j * sz + (h - 1 - y) * w * 3, j * sz + (h - y) * w * 3), y * w * 3);
    out.push({ i: k, t: +f.t.toFixed(1), w, h, px, m: {} });
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
  const dir = argv.find((a) => !a.startsWith('--'));
  const frames = loadScreencast(dir, { from: +arg('from', -1e9), to: +arg('to', 1e9) });
  const det = detectFlicker(frames, { T: +arg('T', 16), rgb: 3 });
  console.log(`${dir}: ${frames.length} screencast frames, ${det.events.length} flicker events, alternating ${JSON.stringify(det.alternating)}`);
  for (const e of det.events.slice(0, 60)) console.log('  ' + describe(e).replace(/ \| st .*$/, ''));
  if (arg('json')) writeFileSync(arg('json'), JSON.stringify({ events: det.events.map(({ m, mA, ...e }) => e), stats: det.stats }));
}
