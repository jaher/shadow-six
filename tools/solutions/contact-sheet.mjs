#!/usr/bin/env node
/**
 * Contact sheet of a captured solution film (tools/solutions/capture-video.mjs): a 4x4 grid of its key frames —
 * the title card, each kill, each stage, the blasts, the escape and the end card — picked from the capture's timeline.
 *   node tools/solutions/contact-sheet.mjs <capture dir> <out.jpg> [--ffmpeg <bin>] [--cols 4] [--tile 480x270]
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const [dir, out] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const opt = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FF = opt('--ffmpeg', process.env.FFMPEG || 'ffmpeg');
const COLS = +opt('--cols', 4), [TW, TH] = opt('--tile', '480x270').split('x').map(Number);
const T = JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8'));
const frames = T.frames, ev = T.pass2.events;

const play = frames.map((f, i) => (f.card ? -1 : i)).filter((i) => i >= 0);
/** the first gameplay frame at or after game time t */
const at = (t) => play.find((i) => frames[i].t >= t - 1e-3) ?? play[play.length - 1];
const stageT = ev.filter((e) => e.kind === 'stage').map((e) => e.t);
const stageEnd = (t) => stageT.find((s) => s > t + 1e-3) ?? frames[play[play.length - 1]].t;

const picks = new Set([frames.findIndex((f) => f.card === 'title')]);
const must = [], kills = [];
for (const e of ev) {
  if (e.kind === 'kill') kills.push(e.t + 0.3);
  else if (e.kind === 'objective' && e.id !== 'o3') must.push(e.t + 1.2);
  else if (e.kind === 'stage') must.push((e.t + stageEnd(e.t)) / 2);
}
const o3 = ev.find((e) => e.kind === 'objective' && e.id === 'o3');
if (o3) must.push(o3.t - 3);
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
