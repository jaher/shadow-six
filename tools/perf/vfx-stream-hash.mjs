#!/usr/bin/env node
/**
 * Explosion identity check (art/realistic-flames): hashes every blast's own output (particles, light and haze
 * samples, decals, debris, shake) with the sustained fire it leaves hashed apart (tests/unit/vfx-stream.mjs).
 *   node tools/perf/vfx-stream-hash.mjs [--root=<tree, e.g. a base worktree>] [--sec=3] [--json]
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const root = resolve(arg('root', HERE)), sec = Number(arg('sec', 3));
const { RECIPES } = await import(pathToFileURL(join(root, 'src/render/vfx/effects.js')).href);
const { makeMock, STREAM_CASES, caseKey } = await import(pathToFileURL(join(HERE, 'tests/unit/vfx-stream.mjs')).href);
const res = {};
for (const [k, o] of STREAM_CASES) { const r = makeMock(RECIPES).run(k, o, sec); res[caseKey(k, o)] = { blast: r.blast, flame: r.flame, fire: r.fire, n: r.n }; }
if (process.argv.includes('--json')) console.log(JSON.stringify(res, null, 1));
else for (const [k, r] of Object.entries(res)) console.log(`${r.blast}  ${r.flame}  ${r.fire}  blast ${r.n.blast} / flame ${r.n.flame} / fire ${r.n.fire}  ${k}`);
