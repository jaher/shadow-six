/**
 * Mission films (tools/solutions/capture-video.mjs + mix-video.mjs, docs/mission-videos.md), end to end on M1 with a
 * short capture (--max-frames): the art opening (its title-card and place-name frames, ≤ 20 s), the first seconds of the
 * solution on a fresh load, the timeline the mix needs (mission data, the cue sheet, the camera of every frame), pass 1
 * winning, and the mix turning that truncated capture into an MP4 that decodes cleanly with video and audio.
 * The capture drives its own browser: this test only spawns it. About two minutes.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './harness.mjs';
import { findFfmpeg } from '../tools/solutions/film-ffmpeg.mjs';

export const timeout = 480_000;

export default async function filmCapture(page, t) {
  const FF = findFfmpeg();
  const dir = mkdtempSync(join(tmpdir(), 'film-capture-'));
  try {
    const cap = spawnSync(process.execPath, ['tools/solutions/capture-video.mjs', 'm01', '--out', dir, '--max-frames', '480'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
    t(cap.status === 0, `capture exited ${cap.status}: ${(cap.stderr || cap.stdout).slice(-400)}`);
    const T = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8'));
    t.equal(T.pass1.state, 'won', 'pass 1 wins');
    t.equal(T.frames.length, 480, 'the frames asked for');
    t.ok(existsSync(join(dir, 'frames', '000479.jpg')), 'the frames are on disk');
    // the art opening: the title card first, then the pan, then the solution
    t.ok(T.opening && T.opening.dur > 5 && T.opening.dur <= 19.5 + 1e-6, `opening ${T.opening?.dur}`);
    t.equal(T.frames[0].card, 'title', 'the opening starts on the title card');
    const open = T.frames.filter((f) => f.card === 'open').length, title = T.frames.filter((f) => f.card === 'title').length;
    t.ok(title >= 90 && open > 100, `title ${title}, pan ${open} frames`);
    t.equal(T.opening.stops[0].kind, 'objective', 'it opens on the objective');
    t.equal(T.opening.stops[T.opening.stops.length - 1].kind, 'start', 'it ends on the team\'s start');
    const play = T.frames.filter((f) => !f.card);
    t.ok(play.length > 10 && play[0].cx != null && play.every((f) => f.vw > 0), 'the solution frames carry the camera');
    // what the mix needs
    t.equal(T.mission.startCue, 'start_1', 'Norway\'s start stinger');
    t.equal(T.mission.theater, 'snow');
    t.ok(T.mission.ambience.some(([id]) => id === 'wind_snow'), 'the snow wind');
    t.ok(Array.isArray(T.audio.cues) && Array.isArray(T.audio.threat), 'the cue sheet');
    t.equal(T.errors.length, 0, `page errors: ${T.errors.join(' | ').slice(0, 300)}`);
    // the mix of the truncated capture
    const out = join(dir, 'film.mp4');
    const mix = spawnSync(process.execPath, ['tools/solutions/mix-video.mjs', dir, out, '--ffmpeg', FF, '--crf', '35'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
    t(mix.status === 0, `mix exited ${mix.status}: ${(mix.stderr || mix.stdout).slice(-400)}`);
    const dec = spawnSync(FF, ['-v', 'error', '-i', out, '-f', 'null', '-'], { encoding: 'utf8' });
    t(dec.status === 0 && !dec.stderr.trim(), `decodes: ${dec.stderr.slice(0, 200)}`);
    const info = spawnSync(FF, ['-hide_banner', '-i', out], { encoding: 'utf8' }).stderr;
    t(/Video: h264/.test(info) && /Audio: aac/.test(info), 'video and audio streams');
    const secs = (() => { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(info); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; })();
    t.near(secs, 480 / 30, 0.2, 'the film is the frames\' length');
    t.log(`opening ${T.opening.dur.toFixed(1)} s (${title} title + ${open} pan frames), ${T.audio.cues.length} cues, film ${secs.toFixed(1)} s`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
