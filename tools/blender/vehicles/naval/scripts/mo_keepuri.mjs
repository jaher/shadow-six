// mo_keepuri.mjs in.glb out.glb : lossless-ish meshopt (EXT_meshopt_compression, QUANTIZE) for a GLB whose kit textures
// are EXTERNAL uris (shared library). External images are fed as 1-byte placeholders and restored to their uris by
// mo_fix.py afterwards, so nothing gets embedded. Used only where a GLB exceeds the 2 MB budget (battleship).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import fs from 'fs';
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const [,, inp, out] = process.argv;
const buf = fs.readFileSync(inp);
const jl = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jl).toString('utf8'));
const bl = buf.readUInt32LE(20 + jl);
const bin = new Uint8Array(buf.slice(28 + jl, 28 + jl + bl));
const resources = { '@glb.bin': bin };
for (const im of json.images || []) if (im.uri) resources[im.uri] = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
json.buffers[0].uri = '@glb.bin';
const doc = await io.readJSON({ json, resources });
// KHR_mesh_quantization for NORMAL (int8) and unit-range TEXCOORDs (uint16, the AO set); POSITION and COLOR_0 are left
// alone so node transforms / rig pivots are untouched; tiling TEXCOORD_0 outside [0,1] stays float.
const done = new Set();
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  for (const sem of prim.listSemantics()) {
    const acc = prim.getAttribute(sem);
    if (done.has(acc) || acc.getComponentSize() < 4) continue;
    const a = acc.getArray();
    if (sem === 'NORMAL') {
      const q = new Int8Array(a.length);
      for (let i = 0; i < a.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(a[i] * 127)));
      acc.setArray(q).setNormalized(true); done.add(acc);
    } else if (sem.startsWith('TEXCOORD_')) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < a.length; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
      if (lo < 0 || hi > 1) continue;
      const q = new Uint16Array(a.length);
      for (let i = 0; i < a.length; i++) q[i] = Math.round(a[i] * 65535);
      acc.setArray(q).setNormalized(true); done.add(acc);
    }
  }
}
doc.createExtension(KHRMeshQuantization).setRequired(true);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(out, doc);
