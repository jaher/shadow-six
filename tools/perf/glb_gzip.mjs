#!/usr/bin/env node
/**
 * Gzip-wrap GLBs (and the .hdr HDRIs) in place (asset budget, src/engine/glb-gzip.js). EXT_meshopt_compression output
 * is meant to be entropy-coded on top and GitHub Pages serves binaries as stored, so wrapping each GLB in gzip takes
 * ~27 % off the GLB bytes (RLE RGBE HDRIs ~30 %) with nothing decoded differently: the runtime inflates them natively
 * before GLTFLoader / HDRLoader parse them.
 *
 *   node tools/perf/glb_gzip.mjs [paths…]              # wrap every plain GLB / .hdr under the paths (default: assets/)
 *   node tools/perf/glb_gzip.mjs --check [paths…]      # list plain ones, exit 1 if any (tests/unit/glb-gzip.test.mjs)
 *   node tools/perf/glb_gzip.mjs --unwrap <paths…>     # back to plain files (gltf-transform inspect, viewers, Blender)
 *   node tools/perf/glb_gzip.mjs --recompress [paths…] # re-encode wrapped files too (keeps the smaller stream)
 *   --fast: zlib -9 instead of zopfli          --jobs=N: worker threads (default: half the cores)
 *
 * Character bodies (assets/characters/{enemies,commandos,guests}/*.glb) are TIERED first, in wrap and --check modes
 * (tools/perf/char_tex_tiers.py, perf/download-speed-2; needs python3 with Pillow + numpy): the GLB embeds half-size
 * atlases and the original images move byte for byte to <dir>/hd/<name>.jpg, which the game streams in once the
 * mission's loading screen has closed (src/engine/hd-textures.js). So after a character re-export, this one command
 * still does everything: `node tools/perf/glb_meshopt.mjs <new files>` (meshopt), then `node tools/perf/glb_gzip.mjs
 * <new files>`; `--check` fails on a body GLB that is not tiered or whose hd/ files are missing.
 * Vegetation strips: when the paths include assets/terrain (or default to assets/), the half-size tree strips are
 * remade where their source changed (tools/perf/strip_tiers.py; `--check` verifies them).
 *
 * The deflate stream comes from zopfli (devDependency @gfx/zopfli, 5 iterations: ~2 % smaller than zlib -9, any
 * inflater reads it) — about 1 s per MB of GLB on one core, run in parallel. Run it after adding or re-exporting GLBs
 * (art passes): new exports are plain and load as they are, but count in full against the asset budget
 * (tests/unit/loading-int2.test.mjs). Each file is verified (inflate === input) before it replaces the original;
 * output is deterministic (no name or mtime in the gzip header).
 */
import { readdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
import { createRequire } from 'node:module';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { gzipSync, gunzipSync, constants } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { isGzip, isGlb } from '../glb-io.mjs';

/** Wrapped kinds: extension → magic check of the plain file. */
const KINDS = { '.glb': isGlb, '.hdr': (b) => b.length > 2 && b[0] === 0x23 && b[1] === 0x3f }; // '#?RADIANCE'
const kindOf = (f) => KINDS[f.slice(f.lastIndexOf('.'))];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** A character body GLB whose atlases get texture tiers (tools/perf/char_tex_tiers.py is_body). */
const isCharacterBody = (f) => /[\\/]characters[\\/](enemies|commandos|guests)[\\/][^\\/]+\.glb$/.test(f) && !/[\\/]colonel_bust\.glb$/.test(f);

/** The vegetation strips' half-size copies (tools/perf/strip_tiers.py) when `paths` cover assets/terrain. @returns {boolean} ok */
function tierStrips(paths, check) {
  const terrain = join(ROOT, 'assets/terrain');
  if (!paths.some((p) => { const a = resolve(p); return terrain.startsWith(a) || a.startsWith(terrain); })) return true;
  const r = spawnSync('python3', [join(ROOT, 'tools/perf/strip_tiers.py'), ...(check ? ['--check'] : [])], { stdio: 'inherit' });
  if (r.error || r.status == null) { console.warn(`strip_tiers.py did not run (python3 with Pillow + numpy needed): ${r.error?.message || r.signal}`); return false; }
  return r.status === 0;
}

/** Run the texture-tier step on the character bodies among `files` (check: verify only). @returns {boolean} ok */
function tierCharacters(files, check) {
  const bodies = files.filter(isCharacterBody);
  if (!bodies.length) return true;
  const r = spawnSync('python3', [join(ROOT, 'tools/perf/char_tex_tiers.py'), ...(check ? ['--check'] : []), ...bodies], { stdio: 'inherit' });
  if (r.error || r.status == null) { console.warn(`char_tex_tiers.py did not run (python3 with Pillow + numpy needed): ${r.error?.message || r.signal}`); return false; }
  return r.status === 0;
}

/** zopfli (when installed) or zlib -9; both emit a plain gzip member. @returns {Promise<Buffer>} */
async function deflate(buf, fast) {
  if (!fast) {
    let zopfli = null;
    try { zopfli = createRequire(import.meta.url)('@gfx/zopfli'); } catch { /* not installed: zlib */ }
    if (zopfli) return Buffer.from(await zopfli.gzipAsync(buf, { numiterations: 5 }));
  }
  return gzipSync(buf, { level: constants.Z_BEST_COMPRESSION, memLevel: 9 });
}

/** Wrap (or re-wrap) one file; returns [bytes before, bytes after] or null when left alone. */
async function wrapFile(f, { fast, recompress }) {
  const buf = readFileSync(f);
  let glb;
  if (isGzip(buf)) { if (!recompress) return null; glb = gunzipSync(buf); } else glb = buf;
  if (!kindOf(f)?.(glb)) { console.warn(`skip (not a ${f.slice(f.lastIndexOf('.'))} file): ${relative(ROOT, f)}`); return null; }
  const gz = await deflate(glb, fast);
  if (!gunzipSync(gz).equals(glb)) throw new Error(`${f}: round trip failed`);
  if (isGzip(buf) && gz.length >= buf.length) return [buf.length, buf.length];
  writeFileSync(f + '.tmp', gz); renameSync(f + '.tmp', f);
  return [buf.length, gz.length];
}

if (!isMainThread) {
  let a = 0, b = 0, n = 0;
  for (const f of workerData.files) {
    const r = await wrapFile(f, workerData.opts);
    if (r) { a += r[0]; b += r[1]; n++; }
  }
  parentPort.postMessage({ a, b, n });
} else {
  const args = process.argv.slice(2);
  const flag = (k) => args.includes(`--${k}`);
  const jobsArg = args.find((x) => x.startsWith('--jobs='));
  const paths = args.filter((x) => !x.startsWith('--'));
  if (!paths.length) paths.push(join(ROOT, 'assets'));
  const walk = (p) => {
    const s = statSync(p);
    if (s.isFile()) return kindOf(p) ? [p] : [];
    return readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() || kindOf(e.name) ? walk(join(p, e.name)) : []));
  };
  const files = paths.flatMap((p) => walk(resolve(p)));

  if (flag('check')) {
    const tiers = tierCharacters(files, true) && tierStrips(paths, true);
    const plain = files.filter((f) => !isGzip(readFileSync(f))).map((f) => relative(ROOT, f));
    if (!tiers) {
      console.log('character body GLB(s) / vegetation strips not tiered — run: node tools/perf/glb_gzip.mjs <paths>');
      process.exit(1);
    }
    if (plain.length) {
      console.log(`${plain.length} plain file(s) — wrap them with: node tools/perf/glb_gzip.mjs ${plain.length < 6 ? plain.join(' ') : '<paths>'}`);
      for (const p of plain.slice(0, 40)) console.log('  ' + p);
      process.exit(1);
    }
    console.log(`all ${files.length} GLB / HDR files gzip-wrapped`);
  } else if (flag('unwrap')) {
    let n = 0, a = 0, b = 0;
    for (const f of files) {
      const buf = readFileSync(f);
      if (!isGzip(buf)) continue;
      const out = gunzipSync(buf);
      if (!kindOf(f)(out)) throw new Error(`${f}: gzip payload is not a plain ${f.slice(f.lastIndexOf('.'))} file`);
      writeFileSync(f + '.tmp', out); renameSync(f + '.tmp', f);
      n++; a += buf.length; b += out.length;
    }
    console.log(`unwrapped ${n} of ${files.length} files: ${(a / 1e6).toFixed(1)} MB → ${(b / 1e6).toFixed(1)} MB`);
  } else {
    tierCharacters(files, false); // (writes the tiered bodies plain: wrapped below)
    tierStrips(paths, false);
    const opts = { fast: flag('fast'), recompress: flag('recompress') };
    const todo = files.filter((f) => opts.recompress || !isGzip(readFileSync(f)));
    const jobs = Math.max(1, Math.min(todo.length, jobsArg ? +jobsArg.slice(7) : Math.ceil(availableParallelism() / 2)));
    // largest files first, dealt round-robin, so the workers finish together
    const bySize = todo.map((f) => [f, statSync(f).size]).sort((x, y) => y[1] - x[1]).map(([f]) => f);
    const t0 = Date.now();
    let a = 0, b = 0, n = 0;
    await Promise.all(Array.from({ length: jobs }, (_, k) => new Promise((ok, fail) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { files: bySize.filter((_, i) => i % jobs === k), opts } });
      w.on('message', (m) => { a += m.a; b += m.b; n += m.n; });
      w.on('error', fail);
      w.on('exit', ok);
    })));
    console.log(`${opts.recompress ? 're-encoded' : 'wrapped'} ${n} of ${files.length} files (${opts.fast ? 'zlib -9' : 'zopfli'}, ${jobs} jobs, ${((Date.now() - t0) / 1e3).toFixed(0)} s): ${(a / 1e6).toFixed(1)} MB → ${(b / 1e6).toFixed(1)} MB`);
  }
}
