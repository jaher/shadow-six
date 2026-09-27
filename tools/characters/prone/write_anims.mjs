#!/usr/bin/env node
// write_anims.mjs - put the baked prone set (bake_prone.mjs -> prone_clips.json) into the shared animation GLBs,
// replacing the old procedural crawl / prone clips, with keyframe reduction and lossless EXT_meshopt_compression.
//
//   # deps outside the repo (as tools/perf/glb_meshopt.mjs): npm i @gltf-transform/core@4 @gltf-transform/extensions@4 meshoptimizer
//   GLTF_DEPS=<that dir>/node_modules node tools/characters/prone/write_anims.mjs <prone_clips.json> [glb ...]
// Default targets: base_anims (enemies, commandos_a base), ca_anims (commandos_a overlay), commando_anims
// (commandos_b), guest_anims (guests). Per-clip meta goes to the 'Scene' node extras (shadowSix.clips) and the .json sidecar.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ESM entry of a package in GLTF_DEPS (ESM ignores NODE_PATH)
const DEPS = process.env.GLTF_DEPS || process.cwd() + '/node_modules';
const dep = (name) => {
  const dir = `${DEPS}/${name}/`, pj = JSON.parse(readFileSync(dir + 'package.json', 'utf8'));
  const ex = pj.exports && (pj.exports['.'] || pj.exports), e = typeof ex === 'string' ? ex : ex && (ex.import?.default || ex.import || ex.default);
  return import(pathToFileURL(dir + (typeof e === 'string' ? e : pj.module || pj.main)).href);
};
const { NodeIO } = await dep('@gltf-transform/core');
const { ALL_EXTENSIONS, EXTMeshoptCompression } = await dep('@gltf-transform/extensions');
const { MeshoptEncoder, MeshoptDecoder } = await dep('meshoptimizer');
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const [src, ...targets] = process.argv.slice(2);
const ANIMS = new URL('../../../assets/characters/anims/', import.meta.url).pathname;
const files = targets.length ? targets : ['base_anims', 'ca_anims', 'commando_anims', 'guest_anims'].map((n) => ANIMS + n + '.glb');
const J = JSON.parse(readFileSync(src, 'utf8'));
// old procedural prone clips removed from every library (replaced by the new set)
const OLD = new Set(['crawl', 'crawl_idle', 'die_prone', 'dead_prone', 'go_prone', 'get_up']);
const NEW = new Set(J.clips.map((c) => c.name));

// ---- keyframe reduction: drop samples that the neighbours' interpolation reproduces within tol ----
function slerpArr(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], s = 1; if (d < 0) { d = -d; s = -1; }
  if (d > 0.9995) { const r = a.map((x, i) => x + (s * b[i] - x) * t); const n = Math.hypot(...r); return r.map((x) => x / n); }
  const th = Math.acos(d), k0 = Math.sin((1 - t) * th) / Math.sin(th), k1 = s * Math.sin(t * th) / Math.sin(th);
  return a.map((x, i) => k0 * x + k1 * b[i]);
}
const angErr = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
function reduce(times, vals, dim, tol) {
  const n = times.length; if (n <= 2) return { t: times, v: vals };
  const at = (i) => vals.slice(i * dim, i * dim + dim);
  const keep = [0]; let last = 0;
  for (let i = 1; i < n - 1; i++) {
    // can we skip from `last` to i+1? check every sample in between
    let ok = true;
    for (let j = last + 1; j <= i && ok; j++) {
      const u = (times[j] - times[last]) / (times[i + 1] - times[last]);
      const p = dim === 4 ? slerpArr(at(last), at(i + 1), u) : at(last).map((x, k) => x + (at(i + 1)[k] - x) * u);
      const e = dim === 4 ? angErr(p, at(j)) : Math.hypot(...p.map((x, k) => x - at(j)[k]));
      if (e > tol) ok = false;
    }
    if (!ok) { keep.push(i); last = i; }
  }
  keep.push(n - 1);
  // a constant track keeps two keys
  return { t: keep.map((i) => times[i]), v: keep.flatMap((i) => at(i)) };
}

for (const f of files) {
  const doc = await io.read(f), root = doc.getRoot(), buf = root.listBuffers()[0];
  const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
  let removed = 0;
  for (const a of root.listAnimations()) if (OLD.has(a.getName()) || NEW.has(a.getName())) {
    for (const s of a.listSamplers()) { s.getInput()?.dispose(); s.getOutput()?.dispose(); }
    a.dispose(); removed++;
  }
  let keys = 0;
  for (const c of J.clips) {
    const anim = doc.createAnimation(c.name);
    const n = c.frames.length, times = Array.from({ length: n }, (_, i) => +(i * c.duration / (n - 1)).toFixed(5));
    const tracks = Object.keys(c.frames[0].q).map((b) => [b, 'rotation', 4, c.frames.flatMap((fr) => fr.q[b])]);
    tracks.push(['pelvis', 'translation', 3, c.frames.flatMap((fr) => fr.p)]);
    const inputs = new Map();   // identical key times share one input accessor (JSON size dominates these files)
    for (const [b, path, dim, vals] of tracks) {
      const node = nodes.get(b); if (!node) continue;
      const r = reduce(times, vals, dim, dim === 4 ? 0.002 : 0.0006);
      keys += r.t.length;
      const tk = r.t.join(',');
      if (!inputs.has(tk)) inputs.set(tk, doc.createAccessor().setType('SCALAR').setArray(new Float32Array(r.t)).setBuffer(buf));
      const inp = inputs.get(tk);
      const out = doc.createAccessor().setType(dim === 4 ? 'VEC4' : 'VEC3').setArray(new Float32Array(r.v)).setBuffer(buf);
      const smp = doc.createAnimationSampler().setInput(inp).setOutput(out).setInterpolation('LINEAR');
      anim.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(smp));
    }
  }
  // meta on the 'Scene' node (GLTFExporter layout the runtimes read) + the .json sidecar
  const sceneNode = nodes.get('Scene'), ex = sceneNode.getExtras() || {}, s6 = ex.shadowSix || (ex.shadowSix = { clips: {} });
  for (const k of Object.keys(s6.clips || {})) if (OLD.has(k)) delete s6.clips[k];
  for (const c of J.clips) {
    const m = { ...c.meta, duration: c.duration };
    if (c.perFrame) m.contacts = { el: c.perFrame.map((p) => p.el.join('')).join(' '), ft: c.perFrame.map((p) => p.ft.join('')).join(' ') };
    s6.clips[c.name] = m;
  }
  sceneNode.setExtras(ex);
  if (!root.listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression'))
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(f, doc);
  const side = f.replace(/\.glb$/, '.json');
  if (existsSync(side)) {
    const sj = JSON.parse(readFileSync(side, 'utf8'));
    for (const k of Object.keys(sj)) if (OLD.has(k)) delete sj[k];
    for (const c of J.clips) sj[c.name] = s6.clips[c.name];
    writeFileSync(side, JSON.stringify(sj, null, 1));
  }
  console.log(`${f.split('/').pop()}: -${removed} +${J.clips.length} clips, ${keys} keys`);
}
