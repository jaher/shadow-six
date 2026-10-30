#!/usr/bin/env node
/**
 * Encode a captured mission film (tools/solutions/capture-video.mjs) to MP4 with the mission's own soundtrack, built
 * from the game's audio assets and tables — nothing here is written for one mission:
 *   node tools/solutions/mix-video.mjs <capture dir> <out.mp4> [--ffmpeg <bin>] [--crf 26]
 *     [--bitrate 1400k] [--abitrate 192k] [--scale 1280x720] [--lufs -16]
 *     [--audio-only <out.wav|.m4a>] [--plan <plan.json>] [--keep-wav]
 * Music: the mission's start stinger (src/audio/music-cues.js startCueFor: Norway start_1 … Final Assault start_5, covert
 * start_6), then the tension chain as the game's MusicDirector chains it, with the alert layer in while the game's own
 * ThreatTracker says guards are in combat or searching or the alarm runs (the alarm music), and the success cue at the win.
 * Ambience: the theatre's beds from the game's AMBIENCE / MISSION_AMBIENCE tables (snow and fjord wind, desert wind,
 * surf, birds, crickets, town, the M2 / M3 / M19 rivers, M3's waterfall following the camera).
 * Effects: the cue sheet the capture recorded by running the game's own audio handlers over the filmed run — shots by
 * weapon, knives, harpoons, traps, blasts, bombs and their ticking, vehicles, doors, the raft, digging, footsteps in the
 * real-time stretches, the siren — each with the game's gain and distance model from the view centre, recorded takes
 * where the game has them and its own synth recipes where it has not (film-audio.mjs, film-mixer.mjs).
 * The sum is loudness-normalised (two-pass linear, −16 LUFS, true peak −2 dBTP) and peak-limited.
 * --bitrate switches to a two-pass x264 encode at that average video bitrate (a size budget, e.g. a phone copy).
 * The AAC bitrate is checked first (film-aac.mjs): the soundtrack is encoded alone, decoded and measured, and a bitrate whose decode
 * has a burst of full-scale samples (a native-encoder glitch at a sharp transient) is passed over for the next one; --no-aac-check skips it.
 * --audio-only renders just the soundtrack (to compare mixes without frames); --plan dumps the plan as JSON.
 */
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planSoundtrack, LAYERS } from './film-audio.mjs';
import { SoundBank, renderPlan, writeWav, readJson } from './film-mixer.mjs';
import { findFfmpeg } from './film-ffmpeg.mjs';
import { chooseAudioBitrate } from './film-aac.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const FLAGS_WITH_VALUE = new Set(['--ffmpeg', '--crf', '--bitrate', '--abitrate', '--scale', '--lufs', '--audio-only', '--plan']);
const [dir, out] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && FLAGS_WITH_VALUE.has(argv[i - 1])));
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const FF = findFfmpeg(opt('--ffmpeg', null)); // (an ffmpeg with libx264: --ffmpeg, $FFMPEG, the PATH, the imageio_ffmpeg builds)
const CRF = +opt('--crf', 26), VBR = opt('--bitrate', null), ABR = opt('--abitrate', '192k'), SCALE = opt('--scale', null), LUFS = +opt('--lufs', -16);
const AUDIO_ONLY = opt('--audio-only', null), PLAN_OUT = opt('--plan', null);
if (!dir || (!out && !AUDIO_ONLY)) { console.error('usage: mix-video.mjs <capture dir> <out.mp4> [options]  (see the header)'); process.exit(2); }

const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const T = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8'));
const log = (m) => console.log(m);

// ---------------------------------------------------------------- the game's own tables
const { SFX, ambienceFor } = await imp('src/audio/manifest.js');
const { spatialize } = await imp('src/audio/engine.js');
const { MISSION_CHAIN, nextSegment, ThreatTracker, CALM_HOLD } = await imp('src/audio/music-director.js');
const { startCueFor, missionNumber } = await imp('src/audio/music-cues.js');
const { synth, RECIPE_NAMES } = await imp('src/audio/synth.js');
const musicManifest = readJson(join(ROOT, 'assets/audio/music/manifest.json'));
const sfxManifest = readJson(join(ROOT, 'assets/audio/sfx/manifest.json'));

// a timeline from before the cue sheet (the M3 films of October): the mission's own data from its definition; no effects
if (!T.mission) {
  let def = { id: T.id, theater: 'snow' };
  try { def = (await imp('src/missions/index.js')).getMission(T.id) || def; } catch { /* the id alone */ }
  T.mission = { id: T.id, n: missionNumber(def), title: def.title, theater: def.theater, night: !!def.night || (def.lighting?.sunElevDeg ?? 30) < 0, startCue: startCueFor(def), ambience: ambienceFor(def), yaw: 0.26 };
  log(`(no cue sheet in this timeline: ${T.id} music and ambience only)`);
}

// ---------------------------------------------------------------- sources: recorded takes by round robin, else the game's synth recipe
const takes = new Map(); // sfx category → absolute .ogg files
for (const s of sfxManifest.sounds) {
  const f = (s.files || []).find((x) => x.endsWith('.ogg'));
  if (!f) continue;
  if (!takes.has(s.category)) takes.set(s.category, []);
  takes.get(s.category).push(join(ROOT, 'assets/audio/sfx', f));
}
const rr = new Map();
const pick = (cat) => { const l = takes.get(cat); if (!l?.length) return null; const n = rr.get(cat) ?? 0; rr.set(cat, n + 1); return l[n % l.length]; };
const source = (id) => {
  if (LAYERS[id]) { const l = LAYERS[id].map((cat) => ({ src: `file:${pick(cat)}`, category: cat })).filter((s) => !s.src.endsWith(':null')); if (l.length) return l; }
  const def = SFX[id];
  if (!def) return null;
  for (const cat of def.alias || []) { const f = pick(cat); if (f) return { src: `file:${f}`, category: cat }; }
  return RECIPE_NAMES.includes(def.recipe) ? { src: `synth:${def.recipe}`, category: 'synth' } : null;
};
const music = (cue) => (musicManifest.cues[cue] ? musicManifest.meta?.[cue] || {} : null);
const env = { SFX, spatialize, music, nextSegment: (cur, has) => nextSegment(cur, has, MISSION_CHAIN), ThreatTracker, CALM_HOLD, source };

// ---------------------------------------------------------------- plan, render, normalise
const plan = planSoundtrack(T, env);
if (PLAN_OUT) writeFileSync(PLAN_OUT, JSON.stringify(plan));
const V = plan.V;
log(`film ${V.toFixed(1)} s (opening ${plan.openEnd.toFixed(1)} s) · ${T.mission.title || T.id} · stinger ${plan.music.startCue} · theatre ${T.mission.theater}`);
const bank = new SoundBank({ ff: FF, root: ROOT, synth, musicManifest });
const mix = renderPlan(plan, bank, { log });
const wav = join(dirname(resolve(AUDIO_ONLY || out)), `.mix-${process.pid}.wav`);
writeWav(wav, mix);

/**
 * Loudness: a peak limiter first (a shot or a blast is ten dB over the score: without it they would hold the whole mix
 * down at the true-peak limit), then two-pass linear normalisation to the target — one gain for the film, its dynamics
 * kept — or, when the peaks do not let that gain through, the dynamic one-pass loudnorm the M3 film used.
 */
const PRE = 'alimiter=limit=0.4:attack=3:release=40:level=false';
function normaliser() {
  const base = `loudnorm=I=${LUFS}:TP=-2:LRA=20`;
  const r = spawnSync(FF, ['-hide_banner', '-nostats', '-i', wav, '-af', `${PRE},${base}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(r.stderr || '');
  if (!m) return `${PRE},${base}`; // (single pass, dynamic)
  const j = JSON.parse(m[0]);
  const gain = LUFS - +j.input_i; // the one gain that lands the film on the target
  const feasible = +j.input_tp + gain <= -2 && +j.input_lra <= 20; // (and its peaks stay under the true-peak limit)
  log(`loudness before: ${j.input_i} LUFS, true peak ${j.input_tp} dBTP, range ${j.input_lra} LU; the linear gain would be ${gain.toFixed(1)} dB${feasible ? '' : ' — too much for the peaks: dynamic loudnorm instead'}`);
  if (!feasible) return `${PRE},loudnorm=I=${LUFS}:TP=-2:LRA=11`;
  return `${PRE},${base}:measured_I=${j.input_i}:measured_LRA=${j.input_lra}:measured_TP=${j.input_tp}:measured_thresh=${j.input_thresh}:offset=${gain.toFixed(2)}:linear=true`;
}
const chain = `${normaliser()},aresample=48000,alimiter=limit=0.79:level=false,afade=t=out:st=${(V - 2).toFixed(2)}:d=2,atrim=0:${V.toFixed(3)}`;
// (the encoder's glitch is bitrate-specific: the bitrate is chosen by a trial encode of the soundtrack alone, before the film's own)
const aacBitrate = (aac) => (!aac || argv.includes('--no-aac-check') ? ABR : chooseAudioBitrate({ ff: FF, input: wav, chain, bitrate: ABR, tmp: join(dirname(resolve(AUDIO_ONLY || out)), `.aac-${process.pid}`), log }));
try {
  if (AUDIO_ONLY) {
    const aac = /\.m4a$/i.test(AUDIO_ONLY), codec = aac ? ['-c:a', 'aac', '-b:a', aacBitrate(true)] : ['-c:a', 'pcm_s16le'];
    execFileSync(FF, ['-y', '-loglevel', 'error', '-i', wav, '-af', chain, ...codec, AUDIO_ONLY], { stdio: 'inherit' });
    log(`soundtrack -> ${AUDIO_ONLY}`);
  } else {
    const fps = T.fps, frames = join(dir, 'frames/%06d.jpg');
    const vf = SCALE ? ['-vf', `scale=${SCALE.replace('x', ':')}:flags=lanczos`] : [];
    const venc = VBR ? ['-c:v', 'libx264', '-preset', 'slow', '-b:v', VBR, '-maxrate', `${Math.round(parseInt(VBR) * 2)}k`, '-bufsize', `${Math.round(parseInt(VBR) * 4)}k`]
      : ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(CRF)];
    const passlog = join(dirname(resolve(out)), `.x264pass-${process.pid}`);
    if (VBR) {
      log(`pass 1 (${VBR}) ...`);
      execFileSync(FF, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', frames, ...vf, ...venc, '-pass', '1', '-passlogfile', passlog, '-pix_fmt', 'yuv420p', '-an', '-f', 'null', '/dev/null'], { stdio: 'inherit' });
    }
    const abr = aacBitrate(true);
    log(`encoding -> ${out}${abr !== ABR ? ` (audio ${abr})` : ''}`);
    const m = T.mission, title = `SHADOW SIX${m.n ? ` · Mission ${m.n}` : ''} · ${m.title || T.id}`;
    execFileSync(FF, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', frames, '-i', wav, '-af', chain, '-map', '0:v', '-map', '1:a', ...vf, ...venc,
      ...(VBR ? ['-pass', '2', '-passlogfile', passlog] : []), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', abr,
      '-metadata', `title=${title}`, '-metadata', `comment=${m.subtitle || ''} — the full solution, player orders only`, '-shortest', out], { stdio: 'inherit' });
    if (VBR) for (const f of [`${passlog}-0.log`, `${passlog}-0.log.mbtree`]) try { rmSync(f, { force: true }); } catch { /* ignore */ }
  }
} finally {
  if (!argv.includes('--keep-wav') && existsSync(wav)) rmSync(wav, { force: true });
}
log('done');
