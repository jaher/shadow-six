/** Asset budget: GLBs and HDRIs are stored gzip-wrapped (src/engine/glb-gzip.js, tools/perf/glb_gzip.mjs) and every loader inflates them. */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { test, assert } from './lib.mjs';
import { readGlb, readGlbArrayBuffer, glbJson, isGzip, isGlb } from '../../tools/glb-io.mjs';
import { GLTFLoader, isGzip as isGzipRt, gunzip, glbGzipStats } from '../../src/engine/glb-gzip.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const walk = (d, ext) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name), ext) : e.name.endsWith(ext) ? [join(d, e.name)] : []));
const GLBS = walk(join(ROOT, 'assets'), '.glb');

test('glb-gzip: every GLB and .hdr under assets/ is gzip-wrapped (run node tools/perf/glb_gzip.mjs after adding some)', () => {
  const plain = [...GLBS, ...walk(join(ROOT, 'assets'), '.hdr')].filter((f) => !isGzip(readFileSync(f))).map((f) => f.slice(ROOT.length + 1));
  assert.deepEqual(plain, [], `plain files — wrap them: node tools/perf/glb_gzip.mjs ${plain.slice(0, 4).join(' ')}`);
});

test('glb-gzip: each one inflates to a GLB whose external images resolve (texture aliases applied)', () => {
  const alias = JSON.parse(readFileSync(join(ROOT, 'assets/models/buildings/manifest.json'), 'utf8')).textures?.aliases || {};
  const bad = [];
  for (const f of GLBS) {
    const b = readGlb(f);
    if (!isGlb(b)) { bad.push(`${f}: not a GLB`); continue; }
    const j = glbJson(b);
    for (const x of [...(j.images || []), ...(j.buffers || [])]) {
      if (!x.uri || /^data:/.test(x.uri)) continue;
      const p = resolve(dirname(f), decodeURIComponent(x.uri));
      if (!existsSync(p) && !(alias[basename(p)] && existsSync(join(dirname(p), alias[basename(p)])))) bad.push(`${f.slice(ROOT.length + 1)} → ${x.uri}`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test('glb-gzip: every src module that builds a GLTFLoader takes it from engine/glb-gzip.js', () => {
  const offenders = walk(join(ROOT, 'src'), '.js').filter((f) => {
    const s = readFileSync(f, 'utf8');
    return /new GLTFLoader\b/.test(s) && !/import \{[^}]*\bGLTFLoader\b[^}]*\} from '[./]*(engine\/)?glb-gzip\.js'/.test(s);
  }).map((f) => f.slice(ROOT.length + 1));
  assert.deepEqual(offenders, []);
});

test('glb-gzip: the runtime hook inflates a wrapped GLB before parsing; plain GLBs and bad data behave as before', async () => {
  const f = join(ROOT, 'assets/characters/dogs/dog_a.glb');
  const raw = readGlbArrayBuffer(f);
  const gz = gzipSync(Buffer.from(raw));
  const ab = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
  assert.ok(isGzipRt(ab) && !isGzipRt(raw));
  assert.equal(Buffer.compare(Buffer.from(await gunzip(ab)), Buffer.from(raw)), 0, 'inflate is exact');
  const parse = (data) => {
    const L = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    L.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));
    return new Promise((res, rej) => L.parse(data, '', res, rej));
  };
  const n0 = glbGzipStats.files;
  const [a, b] = [await parse(ab), await parse(raw)];
  assert.equal(glbGzipStats.files, n0 + 1, 'only the wrapped buffer is inflated');
  const geo = (g) => { const out = []; g.scene.traverse((o) => { if (o.geometry) for (const [k, v] of Object.entries(o.geometry.attributes)) out.push([o.name, k, v.array.constructor.name, v.normalized, Buffer.from(v.array.buffer, v.array.byteOffset, v.array.byteLength).toString('base64')]); }); return out; };
  assert.deepEqual(geo(a), geo(b), 'same geometry, bit for bit');
  assert.equal(a.animations.length, b.animations.length);
  const bad = gzipSync(Buffer.from('not a glb')); // inflates fine, then the stock parser rejects it
  await assert.rejects(parse(bad.buffer.slice(bad.byteOffset, bad.byteOffset + bad.byteLength)));
});
