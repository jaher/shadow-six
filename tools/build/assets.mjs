/**
 * Runtime asset selection for the web build.
 *
 * Everything under assets/ is loaded by URL patterns built at runtime (manifests, per-preset variants, per-browser
 * audio/video formats), so the build ships the tree minus files the game never requests:
 *  - authoring sidecars: *.kit.json (Blender kit specs), *.credits.json (per-asset source lists, summarised in
 *    CREDITS.md and the in-game credits), *.spec.json (character build specs);
 *  - authoring sources / masters: *.blend, *.wav, *.flac, *.psd, *.xcf, *.kra, *.exr, *.tif(f), *.fbx, *.obj, *.py;
 *  - README.md files.
 * Licence texts that must travel with the assets (font OFL/Apache texts, LICENSE*.md, CREDITS.md, LICENSES.json)
 * are kept. Every GLB's external image/buffer URIs are checked against the shipped set (warnings only: the dev tree
 * is the reference and the loaders fall back to placeholders).
 */
import { copyFile, mkdir, readdir, stat, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const SKIP_SUFFIX = ['.kit.json', '.credits.json', '.spec.json', '.blend', '.blend1', '.wav', '.flac', '.psd', '.xcf',
  '.kra', '.exr', '.tif', '.tiff', '.fbx', '.obj', '.py', '.bak'];
const SKIP_NAME = /^(README\.md|\.DS_Store|Thumbs\.db)$/i;

/** @returns {boolean} true when `rel` (path under assets/) is shipped. */
export function isRuntimeAsset(rel) {
  const name = rel.split('/').pop();
  if (SKIP_NAME.test(name) || name.startsWith('.')) return false;
  const lower = name.toLowerCase();
  if (SKIP_SUFFIX.some((s) => lower.endsWith(s))) return false;
  if (/\.bak/.test(lower)) return false;
  return true;
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else if (e.isFile()) out.push(p);
  }
  return out;
}

/** External URIs referenced by a GLB's JSON chunk. */
async function glbUris(file) {
  const b = await readFile(file);
  if (b.readUInt32LE(0) !== 0x46546c67) return [];
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
  return [...(j.images || []), ...(j.buffers || [])].map((x) => x.uri).filter((u) => u && !/^data:/.test(u));
}

/**
 * Copy runtime assets from root/assets to out/assets.
 * @returns {Promise<{copied: number, skipped: number, skippedBytes: number, missingRefs: number}>}
 */
export async function copyRuntimeAssets(root, out) {
  const src = join(root, 'assets');
  const files = await walk(src);
  let copied = 0, skipped = 0, skippedBytes = 0;
  const shipped = new Set();
  const made = new Set();
  const queue = [];
  for (const f of files) {
    const rel = relative(src, f).split('\\').join('/');
    if (!isRuntimeAsset(rel)) { skipped++; skippedBytes += (await stat(f)).size; continue; }
    shipped.add(resolve(f));
    const dst = join(out, 'assets', rel);
    const d = dirname(dst);
    if (!made.has(d)) { await mkdir(d, { recursive: true }); made.add(d); }
    queue.push([f, dst]);
  }
  for (let i = 0; i < queue.length; i += 64) {
    await Promise.all(queue.slice(i, i + 64).map(([a, b]) => copyFile(a, b)));
    copied += Math.min(64, queue.length - i);
  }
  let missingRefs = 0;
  const missingExamples = [];
  for (const f of files.filter((x) => x.endsWith('.glb') && shipped.has(resolve(x)))) {
    for (const u of await glbUris(f)) {
      if (!shipped.has(resolve(dirname(f), decodeURIComponent(u)))) {
        missingRefs++;
        if (missingExamples.length < 3) missingExamples.push(`${relative(root, f)} → ${u}`);
      }
    }
  }
  if (missingRefs) console.warn(`[build] warning: ${missingRefs} GLB texture/buffer URIs point at files not in the tree (same as dev; loaders fall back), e.g.\n  ${missingExamples.join('\n  ')}`);
  return { copied, skipped, skippedBytes, missingRefs };
}
