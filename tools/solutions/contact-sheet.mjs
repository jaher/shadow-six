#!/usr/bin/env node
/**
 * Contact sheet of a captured solution film (tools/solutions/capture-video.mjs): a 4x4 grid of its key frames —
 * the title card, each kill, each stage, the blasts, the escape and the end card — picked from the capture's timeline.
 *   node tools/solutions/contact-sheet.mjs <capture dir> <out.jpg> [--ffmpeg <bin>] [--cols 4] [--tile 480x270] [--no-fill]
 * (--tile 320x180 makes a 4x4 sheet 1280 px wide; a grid the key frames do not fill is topped up with evenly spaced frames unless --no-fill)
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { findFfmpeg } from './film-ffmpeg.mjs';

const argv = process.argv.slice(2);
const [dir, out] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const opt = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FF = findFfmpeg(opt('--ffmpeg', null)); // (an ffmpeg with libx264: --ffmpeg, $FFMPEG, the PATH, the imageio_ffmpeg builds)
const COLS = +opt('--cols', 4), [TW, TH] = opt('--tile', '480x270').split('x').map(Number);
const T = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8'));
const frames = T.frames, ev = T.pass2.events;

const play = frames.map((f, i) => (f.card ? -1 : i)).filter((i) => i >= 0);
/** the first gameplay frame at or after game time t */
const at = (t) => play.find((i) => frames[i].t >= t - 1e-3) ?? play[play.length - 1];
const stageT = ev.filter((e) => e.kind === 'stage').map((e) => e.t);
const stageEnd = (t) => stageT.find((s) => s > t + 1e-3) ?? frames[play[play.length - 1]].t;

const picks = new Set([frames.findIndex((f) => f.card === 'title')]);
const open = frames.map((f, i) => (f.card === 'open' ? i : -1)).filter((i) => i >= 0); // (the art opening's pan: one frame from its middle)
if (open.length) picks.add(open[Math.floor(open.length * 0.55)]);
const must = [], kills = [];
const objs = ev.filter((e) => e.kind === 'objective');
for (const e of ev) {
  if (e.kind === 'kill') kills.push(e.t + 0.3);
  else if (e.kind === 'objective' && e !== objs[objs.length - 1]) must.push(e.t + 1.2); // (a blast: its aftermath)
  else if (e.kind === 'stage') must.push((e.t + stageEnd(e.t)) / 2);
}
const lastObj = objs[objs.length - 1]; // (the escape, or the last blast)
if (lastObj) must.push(lastObj.t - 3);
const endCard = frames.findIndex((f) => f.card === 'end');
const slots = COLS * COLS - picks.size - (endCard >= 0 ? 1 : 0);
// every stage, blast and the escape first; kills fill the remaining slots, spread evenly through the run
const uniq = (a) => [...new Set(a.map(at))].sort((x, y) => x - y);
const mustI = uniq(must).slice(0, slots), killI = uniq(kills).filter((i) => !mustI.includes(i));
const room = slots - mustI.length;
const killPick = killI.length <= room ? killI : Array.from({ length: room }, (_, k) => killI[Math.round(room > 1 ? (k * (killI.length - 1)) / (room - 1) : 0)]);
const chosen = [...mustI, ...killPick];
chosen.forEach((i) => picks.add(i));
if (endCard >= 0) picks.add(endCard);
// a mission with few kills and stages leaves the grid part empty: top it up with evenly spaced frames, each into the widest gap between the picks
if (!process.argv.includes('--no-fill')) {
  while (picks.size < COLS * COLS) {
    const s = [...picks].sort((x, y) => x - y);
    let best = [0, -1];
    for (let k = 0; k + 1 < s.length; k++) if (s[k + 1] - s[k] > best[0]) best = [s[k + 1] - s[k], k];
    if (best[1] < 0 || best[0] < 4) break; // (no gap worth a frame)
    picks.add(Math.round((s[best[1]] + s[best[1] + 1]) / 2));
  }
}
const list = [...picks].sort((a, b) => a - b).map((i) => join(dir, 'frames', String(i).padStart(6, '0') + '.jpg')).filter(existsSync);

const rows = Math.ceil(list.length / COLS);
const args = ['-y', '-loglevel', 'error'];
list.forEach((f) => args.push('-i', f));
const parts = list.map((_, i) => `[${i}:v]scale=${TW}:${TH}:flags=lanczos,setsar=1[t${i}]`);
const layout = list.map((_, i) => `${(i % COLS) * TW}_${Math.floor(i / COLS) * TH}`).join('|');
parts.push(`${list.map((_, i) => `[t${i}]`).join('')}xstack=inputs=${list.length}:layout=${layout}:fill=black[v]`);
args.push('-filter_complex', parts.join(';'), '-map', '[v]', '-frames:v', '1', '-q:v', '3', out);
execFileSync(FF, args, { stdio: 'inherit' });
console.log(`${list.length} frames, ${COLS}x${rows} -> ${out}`);
