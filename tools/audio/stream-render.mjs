#!/usr/bin/env node
/**
 * Render streamed music cues exactly as the game plays them (audio/music-stream.js ChunkCue + StreamVoice, chunks
 * decoded at the cue's decodeRate) through an OfflineAudioContext in headless Chromium, and write 32-bit float WAVs —
 * the input of tools/audio/stream_check.py (seam check against the WAV masters, listening A/B clips).
 *
 *   node tools/audio/stream-render.mjs --cues=menu,mission_alert --out=DIR [--ext=.ogg|.m4a] [--old=DIR] [--passes=2]
 *
 * A looped cue renders its intro, the loop body `passes` times and 6 s more (so every seam is crossed); a one-shot
 * renders whole. `--old=DIR`: also render DIR/<cue>.ogg (a whole file, e.g. the previous release) with an
 * AudioBufferSourceNode and the same loop points — the old player, for comparison.
 */
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHarness } from '../../tests/harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const cues = arg('cues', 'menu').split(',');
const out = resolve(arg('out', join(ROOT, 'tests/out/stream-render')));
const ext = arg('ext', '.ogg');
const passes = +arg('passes', 2);
const old = arg('old', '');
mkdirSync(out, { recursive: true });

// old whole files are served from tests/out (the harness serves the repo root)
const oldDir = join(ROOT, 'tests/out/stream-render-old');
if (old) {
  mkdirSync(oldDir, { recursive: true });
  for (const c of cues) if (existsSync(join(old, `${c}.ogg`))) copyFileSync(join(old, `${c}.ogg`), join(oldDir, `${c}.ogg`));
}
writeFileSync(join(ROOT, 'tests/out/blank.html'), '<!doctype html><meta charset="utf-8"><title>render</title>');

function wav(path, chans, rate) {
  const n = chans[0].length, C = chans.length;
  const b = Buffer.alloc(44 + n * C * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * C * 4, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(C, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * C * 4, 28); b.writeUInt16LE(C * 4, 32); b.writeUInt16LE(32, 34); b.write('data', 36); b.writeUInt32LE(n * C * 4, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < C; c++) { b.writeFloatLE(chans[c][i], o); o += 4; }
  writeFileSync(path, b);
}

const h = await startHarness({ headless: true });
try {
  const page = await h.newPage();
  await page.goto(`${h.url}/tests/out/blank.html`);
  for (const id of cues) {
    const info = await page.evaluate(async ({ id, ext, passes, withOld }) => {
      const { ChunkCue, StreamVoice } = await import('/src/audio/music-stream.js');
      const man = await (await fetch('/assets/audio/music/manifest.json')).json();
      const st = man.cues[id], meta = man.meta[id];
      const rate = meta.decodeRate || 48000;
      const dec = async (url) => new OfflineAudioContext(2, 1, rate).decodeAudioData(await (await fetch(url)).arrayBuffer());
      const cue = new ChunkCue({ id, chunks: st.chunks, wrap: st.wrap, meta, load: (f) => dec(`/assets/audio/music/${f}${ext}`) });
      const files = [...st.chunks.map((c) => c.f), ...(st.wrap ? [st.wrap.f] : [])];
      await Promise.all(files.map((f) => cue.get(f)));
      files.forEach((f) => cue.pins.add(f));
      const looped = meta.loopEnd > meta.loopStart && !!st.wrap;
      const len = looped ? meta.loopStart + passes * (meta.loopEnd - meta.loopStart) + 6 : meta.lengthSec;
      const N = Math.ceil(len * rate);
      const oc = new OfflineAudioContext(2, N, rate);
      const v = new StreamVoice(oc, cue, { at: 0, offset: 0, loop: looped });
      v.out.connect(oc.destination);
      for (let now = 0; now < len; now += 0.5) v.pump(now);
      v.next = null; // everything is scheduled
      const r = await oc.startRendering();
      window.__r = { neu: [r.getChannelData(0), r.getChannelData(1)] };
      if (withOld) {
        const b = await dec(`/tests/out/stream-render-old/${id}.ogg`);
        const oc2 = new OfflineAudioContext(2, N, rate);
        const s = oc2.createBufferSource();
        s.buffer = b;
        if (looped) { s.loop = true; s.loopStart = meta.loopStart; s.loopEnd = meta.loopEnd; }
        s.connect(oc2.destination); s.start(0);
        const r2 = await oc2.startRendering();
        window.__r.old = [r2.getChannelData(0), r2.getChannelData(1)];
      }
      return { rate, N, looped, loopStart: meta.loopStart, loopEnd: meta.loopEnd, chunks: st.chunks.map((c) => c.t), seam: st.wrap || null };
    }, { id, ext, passes, withOld: !!old && existsSync(join(oldDir, `${id}.ogg`)) });
    const grab = async (which) => {
      const chans = [];
      for (let c = 0; c < 2; c++) {
        const parts = [];
        for (let i = 0; i < info.N; i += 1 << 20) {
          const b64 = await page.evaluate(({ which, c, i }) => {
            const a = window.__r[which][c].subarray(i, i + (1 << 20));
            const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
            let s = '';
            for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000));
            return btoa(s);
          }, { which, c, i });
          const buf = Buffer.from(b64, 'base64');
          parts.push(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
        }
        const all = new Float32Array(info.N);
        let o = 0;
        for (const p of parts) { all.set(p, o); o += p.length; }
        chans.push(all);
      }
      return chans;
    };
    wav(join(out, `${id}${ext.replace('.', '_')}_stream.wav`), await grab('neu'), info.rate);
    if (old && existsSync(join(oldDir, `${id}.ogg`))) wav(join(out, `${id}_old_whole.wav`), await grab('old'), info.rate);
    writeFileSync(join(out, `${id}${ext.replace('.', '_')}.json`), JSON.stringify(info));
    console.log(`${id} ${ext}: ${(info.N / info.rate).toFixed(1)} s @ ${info.rate} Hz${info.looped ? ` (loop ${info.loopStart}–${info.loopEnd}, ${passes} passes)` : ''}`);
  }
  const errs = h.errors(page);
  if (errs.length) console.log('page errors:', errs.slice(0, 5));
} finally {
  await h.close();
}
