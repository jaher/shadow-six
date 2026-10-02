#!/usr/bin/env node
/**
 * Encode a captured solution film (tools/solutions/capture-video.mjs) to MP4 with a soundtrack from the game's own
 * assets: the Norway start stinger, the mission music chain (mission_alert while the bunker's alarm runs, the success
 * cue at the end), a snow-wind bed and sound effects on the events of the run (knife, harpoon, trap, the two blasts,
 * fence switch, cutters, the truck).
 *   node tools/solutions/mix-video.mjs <capture dir> <out.mp4> [--ffmpeg <bin>] [--crf 26]
 *     [--bitrate 850k] [--abitrate 128k] [--scale 1280x720]
 * --bitrate switches to a two-pass encode at that average video bitrate (to fit a size budget, e.g. a phone copy).
 * The mix is loudness-normalised to -16 LUFS and peak-limited to -2 dBFS.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const [dir, out] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const fi = process.argv.indexOf('--ffmpeg');
const FF = fi > 0 ? process.argv[fi + 1] : process.env.FFMPEG || 'ffmpeg';
const ci = process.argv.indexOf('--crf');
const CRF = ci > 0 ? +process.argv[ci + 1] : 26;
const opt = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const VBR = opt('--bitrate', null), ABR = opt('--abitrate', '192k'), SCALE = opt('--scale', null);
const T = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8'));
const fps = T.fps, frames = T.frames, V = frames.length / fps;
const M = (n) => join(ROOT, 'assets/audio/music', n + '.ogg');
const S = (d, f) => join(ROOT, 'assets/audio/sfx', d, f);

const dur = (f) => {
  const r = spawnSync(FF, ['-i', f], { encoding: 'utf8' });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
};
/** a music file's length without its silent tail (the cues end on ~3.4 s of silence: chained raw they leave a gap) */
const audible = (f) => {
  const d = dur(f);
  const r = spawnSync(FF, ['-hide_banner', '-i', f, '-af', 'silencedetect=n=-40dB:d=0.5', '-f', 'null', '-'], { encoding: 'utf8' });
  const st = [...r.stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
  const en = [...r.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
  return st.length && en.length === st.length && en[en.length - 1] > d - 0.1 ? st[st.length - 1] + 0.3 : d;
};
// video time of game time t (the first non-card frame at or after it)
const firstPlay = frames.findIndex((f) => !f.card);
const lastPlay = frames.length - 1 - [...frames].reverse().findIndex((f) => !f.card);
const vt = (t) => { for (let i = firstPlay; i < frames.length; i++) if (!frames[i].card && frames[i].t >= t - 1e-3) return i / fps; return lastPlay / fps; };
const ev = T.pass2.events, dev = T.pass2.driverEvents;
const cpT = (k) => ev.find((e) => e.kind === 'checkpoint' && e.name.startsWith(k + ' '))?.t;
const objT = (o) => ev.find((e) => e.kind === 'objective' && e.id === o)?.t;
const endCard = frames.findIndex((f) => f.card === 'end') / fps;

/** clips: { file, at (video s), len, fin, fout, vol, loop } */
const clips = [];
const clip = (file, at, o = {}) => { if (existsSync(file) && at < V) clips.push({ file, at, fin: 0, fout: 0, vol: 1, ...o }); };

// --- music
const stinger = M('start_1');
clip(stinger, 0.2, { vol: 0.9, fout: 2 });
const chain = ['mission_tension_a', 'mission_bridge_1', 'mission_tension_b', 'mission_bridge_2', 'mission_tension_c', 'mission_bridge_3'];
const XF = 3;
const alarmOn = objT('o1') != null ? vt(objT('o1')) : null;
const alarmOff = cpT('G4') != null ? vt(cpT('G4') - 55) : null; // the siren stops ~60 s of game time before G4
const winAt = objT('o3') ?? ev.find((e) => e.kind === 'end')?.t;
const musicEnd = winAt != null ? vt(winAt) : endCard;
let k = 0;
const runChain = (from, to) => {
  let at = from;
  while (at < to - 1) {
    const f = M(chain[k++ % chain.length]), d = audible(f);
    const len = Math.min(d, to - at);
    clip(f, at, { len, fin: XF, fout: len < d ? 2 : XF, vol: 0.8 });
    at += d - XF;
  }
};
runChain(14, alarmOn ?? musicEnd);
if (alarmOn != null) {
  const al = M('mission_alert'), d = audible(al), end = Math.min(alarmOff ?? alarmOn + d, musicEnd);
  for (let at = alarmOn; at < end - 1; at += d - 2) clip(al, at, { len: Math.min(d, end - at + 2), fin: 0.5, fout: 3, vol: 0.6 });
  runChain(end, musicEnd);
}
clip(M('success_1'), musicEnd + 0.3, { vol: 0.9 });

// --- ambience: snow wind all through (looped; the soft procedural bed at −24 LUFS, ≈ 13 dB under the score as in the
// game, src/audio/manifest.js AMBIENCE), the river after the dam goes
clip(S('wind_cold', 'wind_cold_proc_0.ogg'), 0, { len: V, loop: true, vol: 0.22, fin: 2, fout: 3 });
if (objT('o2') != null) clip(S('river', 'river_proc_0.ogg'), vt(objT('o2')) + 1, { len: Math.max(1, endCard - vt(objT('o2')) - 1), loop: true, vol: 0.7, fin: 2, fout: 2 });

// --- effects on the run's events
const kills = ev.filter((e) => e.kind === 'kill');
for (const e of kills) {
  const at = vt(e.t), by = dev.find((d) => d.name === 'unit:killed' && d.line.startsWith(e.tag + ' '))?.line || '';
  if (e.tag === 'e1') { clip(S('k_metal_latch', 'metalLatch.ogg'), at - 0.05, { vol: 1 }); clip(S('k_hit_flesh', 'impactPunch_medium_001.ogg'), at, { vol: 0.8 }); }
  else if (/diver/.test(by)) clip(S('k_hit_flesh', 'impactPunch_medium_003.ogg'), at, { vol: 0.9 });
  else if (/greenberet/.test(by)) clip(S('knife_stab', 'knife_stab_344404_0.ogg'), at - 0.1, { vol: 1 });
}
for (const o of ['o1', 'o2']) {
  if (objT(o) == null) continue;
  clip(S('explosion_large', 'explosion_large_156500_0.ogg'), vt(objT(o)), { vol: 1.0 });
  clip(S('explosion_distant', 'explosion_distant_320788_1.ogg'), vt(objT(o)) + 0.15, { vol: 0.6 });
}
if (alarmOn != null) clip(S('siren_handcrank', 'siren_handcrank_239498_0.ogg'), alarmOn + 1.5, { len: Math.max(2, Math.min(20, (alarmOff ?? alarmOn + 20) - alarmOn - 1.5)), vol: 0.35, fin: 1, fout: 3 });
const at = (key, f, o) => { const t = cpT(key); if (t != null) clip(f, vt(t), o); };
at('C3', S('k_cloth', 'cloth2.ogg'), { vol: 1 });
at('D2', S('k_ui_switch', 'switch_004.ogg'), { vol: 1 });
at('E2', S('k_metal_click', 'metalClick.ogg'), { vol: 1 });
at('E3', S('k_cloth', 'cloth3.ogg'), { vol: 0.9 });
at('F2', S('k_dig', 'impactMining_001.ogg'), { vol: 0.8 });
at('H1', S('k_dig', 'impactMining_002.ogg'), { vol: 0.8 });
at('G2', S('bomb_tick1', 'bomb_tick1_487730_0.ogg'), { vol: 0.8 });
at('I2', S('bomb_tick1', 'bomb_tick1_487730_1.ogg'), { vol: 0.8 });
if (cpT('J1') != null) {
  const t0 = Math.max(0, vt(cpT('J1')) - 4), t1 = winAt != null ? vt(winAt) + 3 : t0 + 8;
  clip(S('truck_engine', 'truck_engine_405086_0.ogg'), t0, { len: t1 - t0, loop: true, vol: 0.6, fin: 2, fout: 2 });
}

// --- ffmpeg graph
const args = ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, 'frames/%06d.jpg')];
const parts = [];
clips.forEach((c, i) => {
  if (c.loop) args.push('-stream_loop', '-1');
  args.push('-i', c.file);
  const len = c.len ?? Math.max(0.1, dur(c.file));
  let f = `[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${len.toFixed(3)},asetpts=PTS-STARTPTS`;
  if (c.fin) f += `,afade=t=in:st=0:d=${c.fin}`;
  if (c.fout) f += `,afade=t=out:st=${Math.max(0, len - c.fout).toFixed(3)}:d=${c.fout}`;
  f += `,volume=${c.vol},adelay=${Math.round(Math.max(0, c.at) * 1000)}:all=1[a${i}]`;
  parts.push(f);
});
parts.push(`${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-2:LRA=11,aresample=48000,alimiter=limit=0.79:level=false,afade=t=out:st=${(V - 2).toFixed(2)}:d=2,atrim=0:${V.toFixed(3)}[aout]`);
const vf = SCALE ? ['-vf', `scale=${SCALE.replace('x', ':')}:flags=lanczos`] : [];
const venc = VBR ? ['-c:v', 'libx264', '-preset', 'slow', '-b:v', VBR, '-maxrate', String(Math.round(parseInt(VBR) * 2)) + 'k', '-bufsize', String(Math.round(parseInt(VBR) * 4)) + 'k']
  : ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(CRF)];
const passlog = join(dirname(resolve(out)), '.x264pass-' + process.pid);
if (VBR) { // pass 1: video only
  console.log(`pass 1 (${VBR}) ...`);
  execFileSync(FF, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, 'frames/%06d.jpg'), ...vf, ...venc,
    '-pass', '1', '-passlogfile', passlog, '-pix_fmt', 'yuv420p', '-an', '-f', 'null', '/dev/null'], { stdio: 'inherit' });
}
args.push('-filter_complex', parts.join(';'), '-map', '0:v', '-map', '[aout]', ...vf, ...venc,
  ...(VBR ? ['-pass', '2', '-passlogfile', passlog] : []), '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', ABR, '-shortest', out);
console.log(`video ${V.toFixed(1)} s, ${clips.length} audio clips -> ${out}`);
execFileSync(FF, args, { stdio: 'inherit' });
if (VBR) for (const f of [passlog + '-0.log', passlog + '-0.log.mbtree']) try { execFileSync('rm', ['-f', f]); } catch {}
console.log('done');
