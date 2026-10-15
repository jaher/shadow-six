#!/usr/bin/env node
/**
 * Character GLBs: store Float32 vertex positions with meshopt's EXPONENTIAL filter (asset budget). The characters
 * were meshopt-compressed losslessly (tools/perf/glb_meshopt.mjs), which leaves full 24-bit-mantissa floats that
 * compress poorly; the filter keeps `--bits` (default 18) of mantissa per component with a shared exponent per
 * component (meshopt "SharedComponent"), so a 1.8 m character's vertices move by ≤ 0.015 mm. The decoded attribute
 * is still a Float32Array in the same bind space — skinning, morphs, bounds, raycasts and every tool that reads
 * positions see the same type and layout; accessor min/max are refreshed from the decoded values.
 * Only bufferViews that hold nothing but f32 VEC3 POSITION data (meshopt ATTRIBUTES, no filter yet) are touched;
 * every other stream and image is copied byte for byte.
 *
 *   node tools/perf/glb_posfilter.mjs [--bits=18] [--dry] <glb or dir…>    # then: node tools/perf/glb_gzip.mjs <same paths>
 *
 * Reads plain or gzip-wrapped GLBs, writes plain GLBs (wrap them again with glb_gzip.mjs).
 */
import { readdirSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { readGlb, isGlb } from '../glb-io.mjs';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const args = process.argv.slice(2);
const BITS = +(args.find((a) => a.startsWith('--bits='))?.slice(7) || 18);
const DRY = args.includes('--dry');
const walk = (p) => (statSync(p).isFile() ? (p.endsWith('.glb') ? [p] : [])
  : readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() || e.name.endsWith('.glb') ? walk(join(p, e.name)) : [])));
const files = args.filter((a) => !a.startsWith('--')).flatMap((p) => walk(resolve(p)));

const pad4 = (n) => (n + 3) & ~3;

/** @returns {{out: Buffer, views: number, before: number, after: number, maxErr: number}|null} */
export function filterPositions(glb, bits = BITS) {
  const jl = glb.readUInt32LE(12);
  const js = JSON.parse(glb.subarray(20, 20 + jl).toString('utf8'));
  const binOff = 20 + jl + 8, binLen = glb.readUInt32LE(20 + jl);
  const bin = glb.subarray(binOff, binOff + binLen);
  const views = js.bufferViews || [];
  // bufferViews used only by f32 VEC3 POSITION accessors
  const users = new Map();
  (js.accessors || []).forEach((a, i) => { if (a.bufferView != null) (users.get(a.bufferView) || users.set(a.bufferView, []).get(a.bufferView)).push(i); });
  const posAcc = new Set();
  for (const m of js.meshes || []) for (const p of m.primitives) if (p.attributes.POSITION != null) posAcc.add(p.attributes.POSITION);
  const targets = [];
  views.forEach((v, i) => {
    const e = v.extensions?.EXT_meshopt_compression;
    if (!e || e.mode !== 'ATTRIBUTES' || (e.filter && e.filter !== 'NONE') || e.byteStride !== 12) return;
    const us = users.get(i) || [];
    if (!us.length || !us.every((a) => posAcc.has(a) && js.accessors[a].componentType === 5126 && js.accessors[a].type === 'VEC3' && !js.accessors[a].sparse)) return;
    targets.push(i);
  });
  if (!targets.length) return null;
  const newData = new Map(); // view → [encoded bytes]
  let before = 0, after = 0, maxErr = 0;
  for (const i of targets) {
    const e = views[i].extensions.EXT_meshopt_compression;
    const src = bin.subarray(e.byteOffset || 0, (e.byteOffset || 0) + e.byteLength);
    const raw = new Uint8Array(e.count * e.byteStride);
    MeshoptDecoder.decodeGltfBuffer(raw, e.count, e.byteStride, src, 'ATTRIBUTES');
    const f32 = new Float32Array(raw.buffer);
    const filt = MeshoptEncoder.encodeFilterExp(f32, e.count, e.byteStride, bits, 'SharedComponent');
    const enc = MeshoptEncoder.encodeGltfBuffer(filt, e.count, e.byteStride, 'ATTRIBUTES');
    const dec = new Uint8Array(e.count * e.byteStride);
    MeshoptDecoder.decodeGltfBuffer(dec, e.count, e.byteStride, enc, 'ATTRIBUTES', 'EXPONENTIAL');
    const d32 = new Float32Array(dec.buffer);
    for (let k = 0; k < f32.length; k++) maxErr = Math.max(maxErr, Math.abs(d32[k] - f32[k]));
    if (enc.length >= src.length) continue; // no gain: keep the lossless stream
    newData.set(i, enc);
    e.filter = 'EXPONENTIAL';
    before += src.length; after += enc.length;
    // accessor bounds from the decoded positions
    for (const a of users.get(i)) {
      const A = js.accessors[a], o = (A.byteOffset || 0) / 4;
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < A.count; k++) for (let c = 0; c < 3; c++) { const x = d32[o + k * 3 + c]; if (x < mn[c]) mn[c] = x; if (x > mx[c]) mx[c] = x; }
      A.min = mn; A.max = mx;
    }
  }
  if (!newData.size) return null;
  // rebuild buffer 0 (the GLB BIN chunk): every range that lives in it, in its original order, re-packed
  const ranges = [];
  views.forEach((v, i) => {
    const e = v.extensions?.EXT_meshopt_compression;
    if (e && (e.buffer ?? 0) === 0) ranges.push({ off: e.byteOffset || 0, len: e.byteLength, set: (o, n) => { e.byteOffset = o; e.byteLength = n; }, data: newData.get(i) });
    else if (!e && (v.buffer ?? 0) === 0) ranges.push({ off: v.byteOffset || 0, len: v.byteLength, set: (o) => { v.byteOffset = o; } });
  });
  ranges.sort((a, b) => a.off - b.off);
  const parts = []; let pos = 0;
  for (const r of ranges) {
    const data = r.data || bin.subarray(r.off, r.off + r.len);
    const at = pad4(pos);
    if (at > pos) parts.push(Buffer.alloc(at - pos));
    parts.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    r.set(at, data.length);
    pos = at + data.length;
  }
  const newBin = Buffer.concat(parts, pos);
  js.buffers[0].byteLength = newBin.length;
  const binPadded = Buffer.concat([newBin, Buffer.alloc(pad4(newBin.length) - newBin.length)]);
  let json = Buffer.from(JSON.stringify(js), 'utf8');
  json = Buffer.concat([json, Buffer.alloc(pad4(json.length) - json.length, 0x20)]);
  const total = 12 + 8 + json.length + 8 + binPadded.length;
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binPadded.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return { out: Buffer.concat([head, jh, json, bh, binPadded]), views: newData.size, before, after, maxErr };
}

if (files.length) {
  let a = 0, b = 0, n = 0, err = 0, v = 0;
  for (const f of files) {
    const glb = readGlb(f);
    if (!isGlb(glb)) continue;
    const r = filterPositions(glb);
    if (!r) continue;
    // the rewritten file must decode to the same streams except the filtered positions
    n++; v += r.views; a += r.before; b += r.after; err = Math.max(err, r.maxErr);
    if (!DRY) { writeFileSync(f + '.tmp', r.out); renameSync(f + '.tmp', f); }
  }
  console.log(`${DRY ? '(dry) ' : ''}${n} GLBs, ${v} position streams: ${(a / 1e6).toFixed(2)} → ${(b / 1e6).toFixed(2)} MB meshopt bytes, max error ${(err * 1000).toFixed(4)} mm (${BITS}-bit mantissa)`);
}
