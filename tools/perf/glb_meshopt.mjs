#!/usr/bin/env node
/**
 * Lossless EXT_meshopt_compression for GLBs that lack it (art integration 2, step 4 — asset size). The meshopt codec
 * is lossless in this mode (EncoderMethod.QUANTIZE: no filters, no re-quantisation), so vertex, skin and animation
 * data decode bit-identical; three's MeshoptDecoder must be registered on the GLTFLoader (all character loaders do).
 *
 *   # deps live outside the repo (no build step): npm i @gltf-transform/core@4 @gltf-transform/extensions@4 meshoptimizer
 *   NODE_PATH=<that dir>/node_modules node tools/perf/glb_meshopt.mjs assets/characters/{anims,commandos,enemies,guests,dogs,weapons}/*.glb
 *
 * Re-run after re-exporting characters from the Blender pipeline (its GLBs come out uncompressed).
 * Files are replaced in place only when smaller.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { statSync, renameSync } from 'node:fs';
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
let a = 0, b = 0;
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression')) continue;
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const s0 = statSync(f).size;
  await io.write(f + '.tmp.glb', doc);
  const s1 = statSync(f + '.tmp.glb').size;
  if (s1 < s0) renameSync(f + '.tmp.glb', f); else renameSync(f + '.tmp.glb', f + '.skip');
  a += s0; b += Math.min(s0, s1);
}
console.log(`meshopt: ${(a / 1e6).toFixed(1)} MB -> ${(b / 1e6).toFixed(1)} MB`);
