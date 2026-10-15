/**
 * Node-side GLB reading for tools and unit tests. GLBs under assets/ are stored gzip-wrapped (src/engine/glb-gzip.js,
 * tools/perf/glb_gzip.mjs); these helpers return the plain GLB bytes whether or not a file is wrapped.
 *
 *   import { readGlb, readGlbArrayBuffer, glbJson } from '../../tools/glb-io.mjs';
 *   const json = glbJson('assets/models/buildings/military/v2_pad.glb');   // the JSON chunk, parsed
 *   loader.parse(readGlbArrayBuffer(path), '', onLoad, onError);           // three's GLTFLoader in node
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

/** Does this buffer start with the gzip magic (1f 8b)? @param {Uint8Array} b */
export const isGzip = (b) => !!b && b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Does this buffer start with the GLB magic ('glTF')? @param {Uint8Array} b */
export const isGlb = (b) => !!b && b.length >= 12 && b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46;

/** Plain GLB bytes of a file or buffer (inflated when gzip-wrapped). @param {string|URL|Buffer} src @returns {Buffer} */
export function readGlb(src) {
  const b = Buffer.isBuffer(src) ? src : readFileSync(src);
  return isGzip(b) ? gunzipSync(b) : b;
}

/** Plain GLB bytes as an ArrayBuffer of their own (what GLTFLoader.parse wants). @param {string|URL|Buffer} src */
export function readGlbArrayBuffer(src) {
  const b = readGlb(src);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

/** The GLB's JSON chunk, parsed. @param {string|URL|Buffer} src */
export function glbJson(src) {
  const b = readGlb(src);
  if (!isGlb(b)) throw new Error(`not a GLB: ${src}`);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
}
