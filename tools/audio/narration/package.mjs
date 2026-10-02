// Newsreel narrator, stage 5: encode the processed clips (Opus/OGG + MP3) and write the manifest the briefing reads.
// usage: node package.mjs WORK_DIR OUT_DIR   (WORK_DIR/proc/<mission>_<id>.{wav,json}, WORK_DIR/qa.json; env FFMPEG)
// A clip whose speech-recognition check fails (more than 1 word wrong and WER > 0.10) is refused unless qa-accept.json
// lists it with the reason (proper names the recogniser cannot spell; reviewed from its transcript).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [W, OUT] = process.argv.slice(2);
const FF = process.env.FFMPEG || 'ffmpeg';
const PAD_IN = 0.12; // period.py pad_in used by build.sh: word times shift by the film run-in
const qa = JSON.parse(readFileSync(join(W, 'qa.json'), 'utf8'));
const accept = JSON.parse(readFileSync(join(HERE, 'qa-accept.json'), 'utf8'));
const lines = JSON.parse(readFileSync(join(W, 'lines.json'), 'utf8'));
export const passes = (q) => !!q && (q.errors <= 1 || q.wer <= 0.1);

function wavSeconds(f) {
  const b = readFileSync(f);
  let o = 12;
  let fmt = null;
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') return n / (fmt.sr * fmt.ch * (fmt.bits / 8));
    o += 8 + n + (n & 1);
  }
  throw new Error(`no data chunk in ${f}`);
}

// True peak: period.py soft-limits the samples, but the codecs overshoot between them (Opus by up to ~1.5 dB). Each
// file goes through a 4x-oversampled limiter at CEIL dBTP before encoding, is measured after encoding, and is encoded
// again 1 dB lower while it still reads above MAX_TP (docs/narration.md: the shipped files peak at or below -1 dBTP).
const CEIL = -2.5, MAX_TP = -1.0;
const ff = (args) => {
  const r = spawnSync(FF, ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}: ${r.stderr}`);
  return r.stderr;
};
/** Integrated loudness (LUFS) and true peak (dBTP) of an encoded file (EBU R128 meter). */
function measure(file) {
  const out = ff(['-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = out.slice(out.lastIndexOf('Summary:'));
  return { lufs: +summary.match(/I:\s+(-?[\d.]+) LUFS/)[1], tp: +summary.match(/Peak:\s+(-?[\d.]+) dBFS/)[1] };
}
const enc = (src, dst, sr, codec) => {
  for (let ceil = CEIL; ; ceil -= 1) {
    const lim = `aresample=${sr * 4},alimiter=limit=${(10 ** (ceil / 20)).toFixed(4)}:attack=1:release=60:level=0:latency=1,aresample=${sr}`;
    ff(['-loglevel', 'error', '-y', '-i', src, '-ac', '1', '-af', lim, ...codec, dst]);
    const m = measure(dst);
    if (m.tp <= MAX_TP || ceil <= CEIL - 3) return m;
  }
};

const manifest = {
  format: 'newsreel narration: missions[id].lines[] = {id, text (exactly the on-screen words), files:[ogg,mp3] (relative to assets/audio/), duration s, wer + asrErrors (speech-recognition check), words:[{w,s,e}] s from clip start}; tour.lines[] = the same for every distinct caption of the Colonel\'s map tour (all missions), found by its text',
  voice: 'original synthetic narrator: Kokoro-82M blend am_onyx .4 + bm_lewis .3 + am_eric .3 (British G2P, speed 1.20), Praat PSOLA cadence x1.6 +1.5 st, 1940s period chain (docs/narration.md)',
  license: 'Kokoro-82M Apache-2.0; AI-generated speech',
  missions: {},
};
let refused = 0, bytes = 0;
const levels = { tp: -Infinity, lufs: [Infinity, -Infinity] };
for (const [mid, rows] of Object.entries(lines)) {
  const out = [];
  for (const row of rows) {
    const name = `${mid}_${row.id}`;
    const meta = JSON.parse(readFileSync(join(W, 'proc', `${name}.json`), 'utf8'));
    if (meta.text !== row.text) throw new Error(`${name}: rendered text differs from the screen text — re-render`);
    const q = qa[name];
    if (!passes(q) && !accept[name]) { refused++; console.error(`REFUSED ${name} wer ${q?.wer} hyp: ${q?.hyp}`); continue; }
    mkdirSync(join(OUT, mid), { recursive: true });
    const wav = join(W, 'proc', `${name}.wav`);
    for (const m of [enc(wav, join(OUT, mid, `${row.id}.ogg`), 48000, ['-c:a', 'libopus', '-b:a', '40k', '-application', 'voip']),
      enc(wav, join(OUT, mid, `${row.id}.mp3`), 44100, ['-c:a', 'libmp3lame', '-b:a', '64k'])]) {
      levels.tp = Math.max(levels.tp, m.tp);
      levels.lufs = [Math.min(levels.lufs[0], m.lufs), Math.max(levels.lufs[1], m.lufs)];
    }
    for (const x of ['ogg', 'mp3']) bytes += statSync(join(OUT, mid, `${row.id}.${x}`)).size;
    out.push({
      id: row.id, text: row.text, files: [`narration/${mid}/${row.id}.ogg`, `narration/${mid}/${row.id}.mp3`],
      duration: +wavSeconds(wav).toFixed(3), wer: q?.wer ?? null, asrErrors: q?.errors ?? null,
      words: meta.words.map((w) => ({ w: w.w, s: +(w.s + PAD_IN).toFixed(3), e: +(w.e + PAD_IN).toFixed(3) })),
    });
  }
  if (mid === 'tour') manifest.tour = { lines: out }; // the Colonel's captions, looked up by text (dump-text.mjs)
  else manifest.missions[mid] = { lines: out };
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest) + '\n');
const n = Object.values(manifest.missions).reduce((a, m) => a + m.lines.length, 0) + (manifest.tour?.lines.length || 0);
console.log(`${n} clips, ${(bytes / 1048576).toFixed(1)} MB, ${refused} refused; dirs: ${readdirSync(OUT).length}; `
  + `${levels.lufs[0]} to ${levels.lufs[1]} LUFS, true peak max ${levels.tp} dBTP`);
if (levels.tp > MAX_TP) { console.error(`true peak ${levels.tp} dBTP above ${MAX_TP}`); process.exit(1); }
if (refused) process.exit(1);
