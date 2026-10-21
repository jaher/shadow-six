#!/usr/bin/env node
/**
 * Mission asset packs + audio sprites (SHADOW SIX load performance).
 *
 *   node tools/packs/build-packs.mjs [--missions=m03,m01] [--presets=high,low] [--out=assets/packs] [--clean]
 *
 * Reads assets/mission-assets.json (written by tools/perf/measure-load.mjs --budget) and, per mission × preset,
 * writes into assets/packs/ (build artifacts, gitignored — the web build copies assets/ wholesale, so generating
 * the packs before `npm run build` ships them):
 *
 *   <preset>-<mission>-pN.zip store-only ZIP parts (entries uncompressed: ogg/jpg/webp/GLB are already compressed,
 *                             so there is no inflate cost) holding the mission's list, split into parts of at most
 *                             ~44 MB of entry data — the repo's GitHub Pages rule is no asset file over 50 MB
 *                             (tests/unit/loading-int2.test.mjs) and Pages itself refuses files over 100 MB — and
 *   <preset>-<mission>.json   its index: {parts, entries: [[siteRelativePath, part, dataOffset, size], …]} — the
 *                             runtime (src/engine/mission-pack.js) slices entries straight out of the fetched
 *                             part buffers without parsing ZIP structure; each part stays a valid archive.
 *   <preset>-<mission>-<group>.sprite + <preset>-<mission>-audio.json
 *                             the mission's audio clips concatenated per group (music | voice | sfx — narration
 *                             rides in voice) with an offset index the audio engine (src/audio/sprite-source.js)
 *                             serves clip bytes from: one fetch per group instead of one per clip.
 *
 * It also regenerates src/engine/pack-catalog.js, the deployment catalog the runtime reads to learn which
 * packs exist (the loader never probes for an unlisted pack — see writeCatalog below; --no-catalog skips).
 *
 * Source files are never modified. A file in the list that is missing on disk aborts the pack (the manifest is
 * stale: re-run measure-load --budget) — a half-built pack would silently serve placeholders at runtime.
 */
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const OUT = resolve(ROOT, arg('out', 'assets/packs'));
const onlyMissions = arg('missions', '') ? arg('missions', '').split(',') : null;
const onlyPresets = arg('presets', '') ? arg('presets', '').split(',') : null;

/**
 * The deployment catalog (src/engine/pack-catalog.js): the runtime's word for which packs exist. It is
 * REGENERATED from the per-mission indexes in OUT on every build (builds accumulate across missions), and
 * --clean resets it to the committed empty default — the loader never probes for a pack the catalog does
 * not list, so a tree without packs makes no pack requests at all (a probe 404 would fail browser tests).
 */
const CATALOG_JS = join(ROOT, 'src/engine/pack-catalog.js');
const CATALOG_HEADER = `/**
 * Which mission packs exist in this deployment (GENERATED — do not edit by hand).
 *
 * Written by tools/packs/build-packs.mjs when packs are built for a deployment; the committed default is
 * empty: no packs exist, and the loader (engine/mission-pack.js) never probes for one — a probe fetch of a
 * missing file would land a 404 in the console, which the test runner treats as a failure. The pack binaries
 * themselves are build artifacts under assets/packs/ (gitignored); this catalog is the deployment's word
 * that they are there. Regenerate with: node tools/packs/build-packs.mjs [--missions=…] [--presets=…]
 * (or reset to this empty default with --clean).
 */
`;
function writeCatalog(packs) {
  writeFileSync(CATALOG_JS, `${CATALOG_HEADER}export const PACK_CATALOG = ${JSON.stringify({ packs })};\n`);
}

if (process.argv.includes('--clean')) {
  rmSync(OUT, { recursive: true, force: true });
  writeCatalog({});
  console.log(`removed ${OUT}; catalog reset to empty`);
  process.exit(0);
}

// ---------------------------------------------------------------- CRC-32 (ZIP)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_DATE = ((d) => (((d.getFullYear() - 1980) << 25) | ((d.getMonth() + 1) << 21) | (d.getDate() << 16) | (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1))) (new Date(2026, 0, 1));

/** Entry-data bytes per ZIP part: under the repo's 50 MB per-file ceiling with room for ZIP overhead. */
export const PART_MAX = 44e6;

/**
 * Greedy part plan: groups of entry indexes whose summed sizes stay within maxBytes. An entry larger than
 * maxBytes goes in a part of its own (a single file is never split).
 * @param {number[]} sizes @param {number} maxBytes @returns {number[][]}
 */
export function planParts(sizes, maxBytes = PART_MAX) {
  const parts = [];
  let cur = [], curBytes = 0;
  sizes.forEach((s, i) => {
    if (cur.length && curBytes + s > maxBytes) { parts.push(cur); cur = []; curBytes = 0; }
    cur.push(i); curBytes += s;
  });
  if (cur.length) parts.push(cur);
  return parts;
}

/** Write one stored (method 0) ZIP from [{name, data:Buffer}] to `file`; returns index entries [name, dataOffset, size]. */
export async function writeZip(file, entries) {
  const ws = createWriteStream(file);
  let wsErr = null;
  ws.on('error', (e) => { wsErr = e; });
  const write = (b) => new Promise((ok, err) => { if (wsErr) return err(wsErr); if (ws.write(b)) ok(); else ws.once('drain', ok); });
  const index = [];
  const central = [];
  let off = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); // version, UTF-8 flag
    lh.writeUInt16LE(0, 8); // method: stored
    lh.writeUInt32LE(DOS_DATE, 10); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    await write(lh); await write(nameBuf);
    const dataOff = off + 30 + nameBuf.length;
    await write(data);
    index.push([name, dataOff, data.length]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10); ch.writeUInt32LE(DOS_DATE, 12); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(off, 42);
    central.push(ch, nameBuf);
    off = dataOff + data.length;
  }
  let cdSize = 0;
  for (const b of central) { await write(b); cdSize += b.length; }
  const eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(entries.length, 8); eo.writeUInt16LE(entries.length, 10);
  eo.writeUInt32LE(cdSize, 12); eo.writeUInt32LE(off, 16);
  await write(eo);
  await new Promise((ok) => ws.end(ok));
  return index;
}

const AUDIO_GROUPS = [
  ['music', (p) => p.startsWith('assets/audio/music/')],
  ['voice', (p) => p.startsWith('assets/audio/voice/') || p.startsWith('assets/audio/narration/')],
  ['sfx', (p) => p.startsWith('assets/audio/sfx/')],
];

async function main() {
  const lists = JSON.parse(readFileSync(join(ROOT, 'assets/mission-assets.json'), 'utf8'));
  mkdirSync(OUT, { recursive: true });
  const summary = [];
  for (const [preset, missions] of Object.entries(lists.presets || {})) {
    if (onlyPresets && !onlyPresets.includes(preset)) continue;
    for (const [mission, urls] of Object.entries(missions)) {
      if (onlyMissions && !onlyMissions.includes(mission)) continue;
      const files = [...new Set(urls)].sort();
      const entries = [];
      for (const rel of files) {
        const abs = join(ROOT, rel);
        if (!existsSync(abs)) throw new Error(`pack ${preset}-${mission}: missing file ${rel} (stale mission-assets.json — re-run measure-load --budget)`);
        entries.push({ name: rel, data: readFileSync(abs) });
      }
      const bytes = entries.reduce((a, e) => a + e.data.length, 0);
      const partNames = [];
      const index = [];
      const plan = planParts(entries.map((e) => e.data.length));
      for (let p = 0; p < plan.length; p++) {
        const zipName = `${preset}-${mission}-p${p}.zip`;
        const sub = await writeZip(join(OUT, zipName), plan[p].map((i) => entries[i]));
        for (const [name, off, size] of sub) index.push([name, p, off, size]);
        partNames.push(zipName);
      }
      index.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      writeFileSync(join(OUT, `${preset}-${mission}.json`), JSON.stringify({
        about: 'Mission asset pack index (tools/packs/build-packs.mjs): [site-relative path, part, data offset, size] into the store-only ZIP parts of the same stem. Read by src/engine/mission-pack.js.',
        mission, preset, parts: partNames, files: entries.length, bytes, entries: index,
      }));
      // audio sprites: the mission's clips concatenated per group; index keyed by audio-engine-relative URL
      const sprites = {};
      const audioEntries = {};
      for (const [group, match] of AUDIO_GROUPS) {
        const clips = entries.filter((e) => match(e.name));
        if (!clips.length) continue;
        const parts = [];
        let off = 0;
        for (const c of clips) {
          audioEntries[c.name.slice('assets/audio/'.length)] = [group, off, c.data.length];
          parts.push(c.data); off += c.data.length;
        }
        const sName = `${preset}-${mission}-${group}.sprite`;
        writeFileSync(join(OUT, sName), Buffer.concat(parts));
        sprites[group] = { file: sName, bytes: off, clips: clips.length };
      }
      if (Object.keys(sprites).length) {
        writeFileSync(join(OUT, `${preset}-${mission}-audio.json`), JSON.stringify({
          about: 'Audio sprite index (tools/packs/build-packs.mjs): audio-engine-relative clip URL → [group, offset, size] in the group sprite file. Read by src/audio/sprite-source.js.',
          mission, preset, sprites, entries: audioEntries,
        }));
      }
      summary.push(`${preset}-${mission}: ${entries.length} files, ${(bytes / 1e6).toFixed(1)} MB in ${partNames.length} part(s)` +
        (Object.keys(sprites).length ? `, sprites ${Object.entries(sprites).map(([g, s]) => `${g}:${s.clips}`).join(' ')}` : ', no audio'));
    }
  }
  // regenerate the deployment catalog from every per-mission index present in OUT (builds accumulate)
  const packs = {};
  for (const f of readdirSync(OUT)) {
    if (!f.endsWith('.json') || f.endsWith('-audio.json')) continue;
    const ix = JSON.parse(readFileSync(join(OUT, f), 'utf8'));
    if (ix.parts?.length) packs[`${ix.preset}-${ix.mission}`] = { mission: ix.mission, preset: ix.preset, parts: ix.parts, files: ix.files, bytes: ix.bytes, entries: ix.entries };
  }
  if (!process.argv.includes('--no-catalog')) { writeCatalog(packs); console.log(`catalog: ${Object.keys(packs).length} pack(s) in src/engine/pack-catalog.js`); }
  for (const s of summary) console.log(s);
  console.log(`packs in ${OUT}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((e) => { console.error(e.message); process.exit(1); });
