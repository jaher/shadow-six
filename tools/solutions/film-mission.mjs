#!/usr/bin/env node
/**
 * Film a mission's solution end to end: the art opening and the full solution captured in the real game, the soundtrack
 * mixed from the game's own audio, one MP4, checked.
 *   node tools/solutions/film-mission.mjs <mission id> [--videos <dir>] [--mp4 <file>] [--ffmpeg <bin>]
 *     [--bitrate 1400k (default) | --crf 26] [--no-opening] [--opening-sec 17] [--frame-waits] [--keep-frames] [--mix-only] [--sheet]
 * Needs tools/solutions/<id>.solution.mjs (the walkthrough / cut files are optional). Run it from a checkout that is not
 * the one other agents drive (it uses the GPU for minutes), in the background: it prints progress lines as it goes.
 *   work dir   <videos>/work/<id>/   frames/, timeline.json (kept; the frames go once the film is good, unless --keep-frames)
 *   film       <videos>/<id>.mp4     (--mp4 for another name)
 * Steps: capture-video.mjs (pass 1 logic only, pass 2 drawn) → checks (both passes won, the checkpoints of the two passes
 * identical, no detections or exposures noted) → mix-video.mjs → checks (the file decodes cleanly, has video and audio,
 * its length is the frames') → a contact sheet (--sheet). Prints one `FILM_RESULT {json}` line; the exit code is 0 only when
 * every check passed. --mix-only redoes the mix and the checks on an existing capture (its frames must have been kept: --keep-frames).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, createWriteStream } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { findFfmpeg } from './film-ffmpeg.mjs';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const argv = process.argv.slice(2);
const FLAGS_WITH_VALUE = new Set(['--videos', '--mp4', '--ffmpeg', '--bitrate', '--crf', '--opening-sec', '--abitrate']);
const id = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && FLAGS_WITH_VALUE.has(argv[i - 1])));
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);
if (!id || !/^[a-z]\d+$/i.test(id)) { console.error('usage: film-mission.mjs <mission id, e.g. m01> [options]  (see the header)'); process.exit(2); }

const VIDEOS = resolve(opt('--videos', process.env.FILM_VIDEOS || join(ROOT, '..', 'commandos-shots', 'videos')));
const WORK = join(VIDEOS, 'work', id);
const MP4 = resolve(opt('--mp4', join(VIDEOS, `${id}.mp4`)));
const FF = findFfmpeg(opt('--ffmpeg', null)); // (an ffmpeg with libx264: --ffmpeg, $FFMPEG, the PATH, the imageio_ffmpeg builds)
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail: String(detail) }); console.log(`${ok ? 'CHECK ok  ' : 'CHECK FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); return !!ok; };
let child = null;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { child?.kill('SIGTERM'); } catch { /* gone */ } process.exit(130); }); // (stopping the film stops its capture too)
const run = (cmd, args, logFile) => new Promise((ok) => {
  const log = logFile ? createWriteStream(logFile) : null;
  const p = child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const pipe = (s) => { process.stdout.write(s); log?.write(s); };
  p.stdout.on('data', pipe); p.stderr.on('data', pipe);
  p.on('close', (code) => { log?.end(); ok(code); });
});
const finish = (extra = {}) => {
  const ok = checks.every((c) => c.ok);
  console.log(`FILM_RESULT ${JSON.stringify({ id, ok, mp4: existsSync(MP4) ? MP4 : null, work: WORK, checks, ...extra })}`);
  process.exit(ok ? 0 : 1);
};
if (!existsSync(join(ROOT, 'tools/solutions', `${id}.solution.mjs`))) { check('solution script exists', false, `tools/solutions/${id}.solution.mjs`); finish(); }
mkdirSync(WORK, { recursive: true });
mkdirSync(dirname(MP4), { recursive: true });

// ---------------------------------------------------------------- 1. capture
if (!has('--mix-only')) {
  console.log(`== capturing ${id} -> ${WORK}`);
  const args = ['tools/solutions/capture-video.mjs', id, '--out', WORK];
  if (has('--no-opening')) args.push('--no-opening');
  if (has('--frame-waits')) args.push('--frame-waits');
  if (opt('--opening-sec')) args.push('--opening-sec', opt('--opening-sec'));
  const code = await run('node', args, join(VIDEOS, 'work', `${id}.capture.log`));
  if (!check('capture exited cleanly', code === 0, `exit ${code}`)) finish();
}

// ---------------------------------------------------------------- 2. the run itself
let T;
try { T = JSON.parse(readFileSync(join(WORK, 'timeline.json'), 'utf8')); } catch (e) { check('timeline.json readable', false, e.message); finish(); }
const p1 = T.pass1, p2 = T.pass2;
check('pass 1 (logic only) won', p1.state === 'won' && !p1.error, `${p1.state} t=${p1.time?.toFixed(1)} ${p1.error || ''}`);
check('pass 2 (drawn) won', p2.state === 'won' && !p2.error, `${p2.state} t=${p2.time?.toFixed(1)} ${p2.error || ''}`);
const same = p1.checkpoints.length === p2.checkpoints.length && p1.checkpoints.every((c, i) => c.name === p2.checkpoints[i].name && Math.abs(c.t - p2.checkpoints[i].t) < 1e-6);
check('both passes\' checkpoints match', same, `${p1.checkpoints.length} / ${p2.checkpoints.length} checkpoints`);
console.log(`NOTE detections ${p2.detections}, cone exposures ${p1.exposures.length}/${p2.exposures.length} (pass 1 / pass 2; informational: a solution may fight)`);
if (T.worlds?.length) console.log(`NOTE the two passes' worlds start from different gameplay data (${T.worlds.length} fields: ${T.worlds.slice(0, 8).map((x) => x.field).join(', ')}): the drawn run may part from pass 1 (capture-video.mjs --trace finds where)`);
if (T.errors?.length) console.log(`NOTE ${T.errors.length} page error(s) while filming, first: ${String(T.errors[0]).slice(0, 200)}`);
const frames = T.frames.length, secs = frames / T.fps;
check('frames captured', frames > T.fps * 20 && existsSync(join(WORK, 'frames', '000000.jpg')), `${frames} frames = ${secs.toFixed(1)} s`);
// (a run that failed a check is still mixed, so the problem can be seen; the result says it failed)

// ---------------------------------------------------------------- 3. mix
if (existsSync(join(WORK, 'frames', '000000.jpg'))) {
  console.log(`== mixing -> ${MP4}`);
  rmSync(MP4, { force: true }); // (an old film must not pass the checks for a mix that failed)
  const args = ['tools/solutions/mix-video.mjs', WORK, MP4, '--ffmpeg', FF];
  if (opt('--crf')) args.push('--crf', opt('--crf')); // (default: two-pass at 1.4 Mb/s, the size of the M3 film)
  else args.push('--bitrate', opt('--bitrate', '1400k'));
  if (opt('--abitrate')) args.push('--abitrate', opt('--abitrate'));
  const code = await run('node', args, join(VIDEOS, 'work', `${id}.mix.log`));
  check('mix exited cleanly', code === 0, `exit ${code}`);
} else check('frames present for the mix', false, WORK);

// ---------------------------------------------------------------- 4. the file
let size = 0, dur = 0, audio = false, video = false;
if (existsSync(MP4)) {
  size = statSync(MP4).size;
  const dec = spawnSync(FF, ['-v', 'error', '-i', MP4, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  check('decodes cleanly (ffmpeg -v error)', dec.status === 0 && !String(dec.stderr).trim(), String(dec.stderr).trim().split('\n')[0] || '');
  const info = spawnSync(FF, ['-hide_banner', '-i', MP4], { encoding: 'utf8' }).stderr;
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
  dur = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0;
  video = /Stream #\d+:\d+.*Video: h264/.test(info);
  audio = /Stream #\d+:\d+.*Audio: aac/.test(info);
  check('has an H.264 video stream and an AAC audio stream', video && audio, `${video ? 'video' : 'no video'}, ${audio ? 'audio' : 'no audio'}`);
  check('length matches the frames', Math.abs(dur - secs) < 0.6, `${dur.toFixed(2)} s vs ${secs.toFixed(2)} s`);
  const vol = spawnSync(FF, ['-hide_banner', '-nostats', '-i', MP4, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stderr || '';
  const lufs = /\bI:\s+(-?[\d.]+) LUFS/.exec(vol.split('Summary:').pop() || '')?.[1], peak = /Peak:\s+(-?[\d.]+) dBFS/.exec(vol.split('Summary:').pop() || '')?.[1];
  check('audible, not clipping', lufs != null && +lufs > -24 && +lufs < -12 && (peak == null || +peak < -0.1), `integrated ${lufs} LUFS, peak ${peak} dBFS`);
  if (has('--sheet')) await run('node', ['tools/solutions/contact-sheet.mjs', WORK, MP4.replace(/\.mp4$/, '-sheet.jpg'), '--ffmpeg', FF], null);
}
const good = checks.every((c) => c.ok);
if (good && !has('--keep-frames')) { rmSync(join(WORK, 'frames'), { recursive: true, force: true }); console.log('frames removed (timeline.json kept; --keep-frames to keep them)'); }
finish({ seconds: +dur.toFixed(2), bytes: size, megabytes: +(size / 1048576).toFixed(1), frames, gameTime: +p2.time.toFixed(1), checkpoints: p2.checkpoints.length, opening: T.opening?.dur ?? 0 });
