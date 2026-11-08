#!/usr/bin/env node
/**
 * A library vehicle (gzip-wrapped, gltfpack'd: EXT_meshopt_compression + KHR_mesh_quantization) as a plain GLB that
 * Blender's importer reads, for the key-art renders (backdrop.py imports the burnt Panzer IV). Buffer views are
 * decoded with the vendored three.js meshopt decoder; quantized attributes stay (Blender reads KHR_mesh_quantization);
 * texture URIs become absolute, so the output can live anywhere.
 *   node tools/ui/keyart/herohd/glb_plain.mjs assets/models/vehicles/armour/panzer4_g_burnt.glb /tmp/pz4.glb
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const { MeshoptDecoder } = await import(pathToFileURL(join(ROOT, 'vendor/addons/libs/meshopt_decoder.module.js')).href);
await MeshoptDecoder.ready;

const [src, out] = process.argv.slice(2);
let buf = readFileSync(src);
if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));

const parts = [];
let offset = 0;
for (const bv of json.bufferViews) {
  const ext = bv.extensions?.EXT_meshopt_compression;
  let data;
  if (ext) {
    const source = new Uint8Array(bin.buffer, bin.byteOffset + (ext.byteOffset || 0), ext.byteLength);
    data = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(data, ext.count, ext.byteStride, source, ext.mode, ext.filter || 'NONE');
    if (ext.byteStride && bv.target === 34962) bv.byteStride = ext.byteStride;
    delete bv.extensions.EXT_meshopt_compression;
    if (!Object.keys(bv.extensions).length) delete bv.extensions;
  } else {
    data = new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength);
  }
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { parts.push(new Uint8Array(pad)); offset += pad; }
  bv.buffer = 0; bv.byteOffset = offset; bv.byteLength = data.length;
  parts.push(data); offset += data.length;
}
const tail = (4 - (offset % 4)) % 4;
if (tail) { parts.push(new Uint8Array(tail)); offset += tail; }
json.buffers = [{ byteLength: offset }];
for (const k of ['extensionsUsed', 'extensionsRequired']) {
  if (json[k]) json[k] = json[k].filter((e) => e !== 'EXT_meshopt_compression');
  if (json[k] && !json[k].length) delete json[k];
}
for (const im of json.images || []) if (im.uri && !/^data:/.test(im.uri)) im.uri = resolve(dirname(src), im.uri);

let js = Buffer.from(JSON.stringify(json), 'utf8');
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const binOut = Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength)));
const header = Buffer.alloc(12);
header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + binOut.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.write('JSON', 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(binOut.length, 0); bh.write('BIN\0', 4);
writeFileSync(out, Buffer.concat([header, jh, js, bh, binOut]));
console.log(`${out}: ${json.bufferViews.length} views, ${binOut.length} bytes`);
