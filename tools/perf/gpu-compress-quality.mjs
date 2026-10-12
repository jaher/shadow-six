#!/usr/bin/env node
/**
 * Quality + speed of the load-time GPU texture compression (src/engine/gpu-compress.js) on real game textures.
 * Every texture is uploaded through three exactly as the game would (the reference: RGBA8 / SRGB8_A8 + generated
 * mips), encoded, uploaded as BC7 / ASTC, and both are read back level by level through the GPU's own decoder
 * (texelFetch → 8-bit values in the texture's encoding) → RGB PSNR, mean / max abs error, share of texels off by > 8
 * (alpha separately when the map has any).
 *
 *   node tools/perf/gpu-compress-quality.mjs [--codec=bc7|astc] [--swiftshader] [--files=a.jpg,b.png] [--json=out.json]
 *        [--dump=dir] [--channels] [--weights=1,1,3,1] [--tier=0|1|2]   (tier: encoder quality tier, default 2; dump: level-0 PNGs of reference / decoded / diff×8;
 *        channels: per-channel PSNR + threshold flips at 128; weights: per-channel error weights, default 1,1,1,2)
 * Default set: a spread of library maps (albedo sRGB, normal, ARM), pavement, water, a foliage strip with alpha.
 * ASTC needs --swiftshader on desktop GPUs without it (SwiftShader decodes ASTC in software).
 */
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const H = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(ROOT, 'tools/serve.mjs')).href);
const { chromium } = await import(pathToFileURL(join(ROOT, 'node_modules/playwright-core/index.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flag = (k) => process.argv.includes(`--${k}`);

const LIB = 'assets/textures/lib/1k/';
function defaultSet() {
  const lib = readdirSync(join(ROOT, LIB)).filter((f) => /\.(jpg|png)$/.test(f)).sort();
  // every 9th library map (a spread of families × diff / nor / arm), plus other kinds
  const pick = lib.filter((_, i) => i % 9 === 0).map((f) => LIB + f);
  return [...pick, 'assets/textures/pavement/1k/' + readdirSync(join(ROOT, 'assets/textures/pavement/1k'))[0],
    'assets/water/waternormals.jpg'].filter(Boolean);
}
const files = arg('files') ? arg('files').split(',') : defaultSet();
const codec = arg('codec', 'bc7');
const dump = arg('dump', null);
if (dump) mkdirSync(dump, { recursive: true });

const server = await startServer({ port: 0 });
const BASE = server.url.replace(/\/$/, '');
const browser = await chromium.launch({ executablePath: H.findChrome(), headless: true, args: flag('swiftshader') ? H.SWIFTSHADER_ARGS : H.GPU_ARGS });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.route(BASE + '/__gpuq.html', (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
<script type="importmap">{"imports":{"three":"./vendor/three.module.js","three/addons/":"./vendor/addons/"}}</script></head><body></body></html>` }));
await page.goto(BASE + '/__gpuq.html');

const res = await page.evaluate(async ({ files, codec, wantDump, weights, tier }) => {
  const THREE = await import('three');
  const GC = await import('/src/engine/gpu-compress.js');
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4; document.body.appendChild(canvas);
  const r = new THREE.WebGLRenderer({ canvas, antialias: false });
  const gl = r.getContext();
  const C = new GC.GpuCompressor(r, { codec, tier });
  if (!C.codec) return { error: `codec ${codec} not supported here`, exts: gl.getSupportedExtensions() };
  // decoder: texelFetch(level) of a 2D texture → 8-bit values in its own encoding
  const vs = `#version 300 es
  void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.0-1.0,0.0,1.0); }`;
  const fs = `#version 300 es
  precision highp float; uniform highp sampler2D t; uniform int lv; uniform bool srgb; out vec4 o;
  float s(float c){ c = clamp(c,0.0,1.0); return c <= 0.0031308 ? c*12.92 : 1.055*pow(c,1.0/2.4)-0.055; }
  void main(){ vec4 c = texelFetch(t, ivec2(gl_FragCoord.xy), lv); if (srgb) c.rgb = vec3(s(c.r), s(c.g), s(c.b)); o = c; }`;
  const sh = (ty, src) => { const x = gl.createShader(ty); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
  const fbo = gl.createFramebuffer(), vao = gl.createVertexArray();
  function readLevel(glTex, lv, w, h, srgb) {
    const rt = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, rt); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt, 0);
    gl.viewport(0, 0, w, h); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(prog); gl.bindVertexArray(vao); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.uniform1i(gl.getUniformLocation(prog, 't'), 0); gl.uniform1i(gl.getUniformLocation(prog, 'lv'), lv); gl.uniform1i(gl.getUniformLocation(prog, 'srgb'), srgb ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.deleteTexture(rt); r.resetState();
    return out;
  }
  const toPng = async (px, w, h) => { const c = new OffscreenCanvas(w, h); c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer.slice(0)), w, h), 0, 0); const b = await c.convertToBlob({ type: 'image/png' }); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const out = [];
  for (const f of files) {
    const blob = await (await fetch('/' + f)).blob();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const srgb = /(_diff|albedo|_col|basecolor|_alb)/i.test(f) || /terrain\/(foliage|needles)\.webp$/.test(f) || /pavement\/1k\/[^_]*\.jpg$/.test(f) && !/_nor|_arm|_rough|_disp/.test(f);
    const p = { srgb, colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace, flipY: false, premultiplyAlpha: false, unpackAlignment: 4, mips: true, weights: weights || null };
    const w = bmp.width, h = bmp.height;
    if (w % 4 || h % 4) { out.push({ f, skipped: `${w}x${h}` }); continue; }
    // reference: three's own upload
    const ref = new THREE.Texture(bmp); ref.colorSpace = p.colorSpace; ref.flipY = false; ref.generateMipmaps = true; ref.minFilter = THREE.LinearMipmapLinearFilter; ref.needsUpdate = true;
    r.initTexture(ref);
    const refGl = r.properties.get(ref).__webglTexture;
    const t0 = performance.now();
    const levels = await C.encodeImage(bmp, p);
    const ms = performance.now() - t0;
    const ct = new THREE.CompressedTexture(levels.map((d, l) => ({ data: d, width: Math.max(1, w >> l), height: Math.max(1, h >> l) })), w, h, C.format);
    ct.colorSpace = p.colorSpace; ct.minFilter = THREE.LinearMipmapLinearFilter; ct.magFilter = THREE.LinearFilter; ct.needsUpdate = true;
    r.initTexture(ct);
    const ctGl = r.properties.get(ct).__webglTexture;
    const perLevel = [];
    let dumped = null;
    for (let l = 0; l < Math.min(levels.length, 6); l++) {
      const lw = Math.max(1, w >> l), lh = Math.max(1, h >> l);
      const A = readLevel(refGl, l, lw, lh, srgb), B = readLevel(ctGl, l, lw, lh, srgb);
      let se = 0, sa = 0, mx = 0, over8 = 0, n = 0, alphaVar = 0, seA = 0, seV = 0, nV = 0, mxV = 0, seP = 0;
      const seC = [0, 0, 0, 0], flips = [0, 0, 0, 0], near = [0, 0, 0, 0];
      for (let i = 0; i < A.length; i += 4) for (let c = 0; c < 4; c++) {
        const d = A[i + c] - B[i + c]; seC[c] += d * d;
        if ((A[i + c] >= 128) !== (B[i + c] >= 128)) flips[c]++;
        if (Math.abs(A[i + c] - 128) < 32) near[c]++;
      }
      for (let i = 0; i < A.length; i += 4) {
        let pxMax = 0;
        for (let c = 0; c < 3; c++) { const d = Math.abs(A[i + c] - B[i + c]); se += d * d; sa += d; if (d > mx) mx = d; if (d > pxMax) pxMax = d; }
        const da = A[i + 3] - B[i + 3]; seA += da * da;
        { const pa = A[i + 3] / 255, pb = B[i + 3] / 255; for (let c = 0; c < 3; c++) { const d = A[i + c] * pa - B[i + c] * pb; seP += d * d; } }
        if (A[i + 3] >= 128) { nV++; for (let c = 0; c < 3; c++) { const d = Math.abs(A[i + c] - B[i + c]); seV += d * d; if (d > mxV) mxV = d; } }
        if (A[i + 3] !== 255) alphaVar++;
        if (pxMax > 8) over8++;
        n++;
      }
      const mse = se / (n * 3), ps = (m) => (m ? 10 * Math.log10(255 * 255 / m) : 99);
      perLevel.push({ l, psnr: ps(mse), mean: sa / (n * 3), max: mx, over8: over8 / n, alpha: alphaVar / n, psnrA: ps(seA / n), psnrVis: nV ? ps(seV / (nV * 3)) : 99, maxVis: mxV, psnrPre: ps(seP / (n * 3)), psnrC: seC.map((x) => ps(x / n)), flips: flips.map((x) => x / n), near: near.map((x) => x / n) });
      if (l === 0 && wantDump) {
        const D = new Uint8Array(A.length);
        for (let i = 0; i < A.length; i += 4) { for (let c = 0; c < 3; c++) D[i + c] = Math.min(255, Math.abs(A[i + c] - B[i + c]) * 8); D[i + 3] = 255; }
        const op = (X) => { const Y = X.slice(); for (let i = 3; i < Y.length; i += 4) Y[i] = 255; return Y; };
        dumped = { ref: await toPng(op(A), lw, lh), dec: await toPng(op(B), lw, lh), diff: await toPng(D, lw, lh) };
      }
    }
    ref.dispose(); ct.dispose(); bmp.close();
    out.push({ f, w, h, srgb, ms, bytes: levels.reduce((a, x) => a + x.byteLength, 0), perLevel, dumped });
  }
  return { codec: C.codec, renderer: gl.getParameter(gl.RENDERER), out, stats: C.stats };
}, { files, codec, wantDump: !!dump, weights: arg('weights') ? arg('weights').split(',').map(Number) : null, tier: Number(arg('tier', '2')) });

if (res.error) { console.log(res.error, res.exts); process.exit(1); }
console.log(`codec ${res.codec} on ${res.renderer}`);
console.log('| file | size | sRGB | ms | L0 RGB PSNR | L0 mean | L0 max | L0 >8 | L1 | L2 | L3 |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
const all = [];
for (const o of res.out) {
  if (o.skipped) { console.log(`| ${o.f} | ${o.skipped} | skipped |`); continue; }
  const L = o.perLevel;
  all.push(L[0].psnr);
  console.log(`| ${o.f.replace(/^assets\//, '')} | ${o.w}×${o.h} | ${o.srgb ? 'y' : ''} | ${o.ms.toFixed(1)} | ${L[0].psnr.toFixed(2)} | ${L[0].mean.toFixed(2)} | ${L[0].max} | ${(L[0].over8 * 100).toFixed(2)}% | ${L[1]?.psnr.toFixed(2)} | ${L[2]?.psnr.toFixed(2)} | ${L[3]?.psnr.toFixed(2)} |${L[0].alpha > 0 ? ` alpha ${(L[0].alpha * 100).toFixed(0)}% of texels: A ${L[0].psnrA.toFixed(2)} dB, RGB where A≥128 ${L[0].psnrVis.toFixed(2)} dB (max ${L[0].maxVis}), premultiplied RGB ${L[0].psnrPre.toFixed(2)} dB` : ''}`);
  if (flag('channels')) console.log(`|   channels R/G/B/A PSNR ${L[0].psnrC.map((x) => x.toFixed(1)).join(' / ')}; flips at 128: ${L[0].flips.map((x) => (x * 100).toFixed(3) + '%').join(' / ')} (texels within ±32 of 128: ${L[0].near.map((x) => (x * 100).toFixed(1) + '%').join(' / ')}) |`);
  if (dump && o.dumped) for (const k of ['ref', 'dec', 'diff']) writeFileSync(join(dump, `${basename(o.f).replace(/\.\w+$/, '')}-${res.codec}-${k}.png`), Buffer.from(o.dumped[k], 'base64'));
}
all.sort((a, b) => a - b);
console.log(`L0 PSNR: min ${all[0]?.toFixed(2)}, median ${all[Math.floor(all.length / 2)]?.toFixed(2)}, max ${all[all.length - 1]?.toFixed(2)} over ${all.length} maps; stats ${JSON.stringify(res.stats)}`);
if (arg('json')) writeFileSync(arg('json'), JSON.stringify(res, (k, v) => (k === 'dumped' ? undefined : v), 1));
await browser.close();
await server.close();
