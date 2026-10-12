/**
 * Load-time GPU texture compression (src/engine/gpu-compress.js):
 *  - each codec this browser can sample (BC7 on the GPU runner; BC7 + ASTC under --swiftshader) encodes real maps
 *    within quality floors, read back through the GPU's own decoder against three's uncompressed upload (RGB PSNR,
 *    alpha separately): albedo, normal, ORM, a cut-out with alpha;
 *  - the game's compressor calibrates its encoder tier (SwiftShader, ~100× slower than a GPU: compression off);
 *  - after M1 loads, every material map of the scene (≥ 256 px) is on the GPU compressed, except the maps kept as they
 *    are on purpose (water foam / detail normals, foliage leaf ids, stone ids, canvases, render targets).
 * tools/perf/gpu-compress-quality.mjs measures the same on any set of files.
 */
export const timeout = 600_000;

const FILES = [
  // [file, sRGB, RGB floor BC7 (dB), RGB floor ASTC, alpha floor]
  ['assets/textures/lib/1k/brick_dark_diff.jpg', true, 44, 45, 0],
  ['assets/textures/lib/1k/brick_dark_nor.jpg', false, 35, 36, 0],
  ['assets/textures/lib/1k/brick_dark_arm.jpg', false, 40, 42, 0],
  ['assets/textures/lib/1k/foliage_atlas_diff.png', true, 33, 33, 36],
];

export default async function (page, t) {
  const res = await page.evaluate(async (FILES) => {
    const THREE = await import('three');
    const GC = await import('/src/engine/gpu-compress.js');
    const R = window.__game.game.renderer.renderer, gl = R.getContext();
    const vs = '#version 300 es\nvoid main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.0-1.0,0.0,1.0); }';
    const fs = `#version 300 es
    precision highp float; uniform highp sampler2D t; uniform bool srgb; out vec4 o;
    float s(float c){ c = clamp(c,0.0,1.0); return c <= 0.0031308 ? c*12.92 : 1.055*pow(c,1.0/2.4)-0.055; }
    void main(){ vec4 c = texelFetch(t, ivec2(gl_FragCoord.xy), 0); if (srgb) c.rgb = vec3(s(c.r), s(c.g), s(c.b)); o = c; }`;
    const sh = (ty, src) => { const x = gl.createShader(ty); gl.shaderSource(x, src); gl.compileShader(x); return x; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
    const fbo = gl.createFramebuffer(), vao = gl.createVertexArray();
    const read = (tex, w, h, srgb) => {
      const rt = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, rt); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt, 0);
      gl.viewport(0, 0, w, h); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST);
      gl.useProgram(prog); gl.bindVertexArray(vao); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(prog, 't'), 0); gl.uniform1i(gl.getUniformLocation(prog, 'srgb'), srgb ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const out = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
      gl.deleteTexture(rt); R.resetState();
      return out;
    };
    const codecs = ['bc7', 'astc'].filter((c) => GC.detectCodec(gl, c));
    const out = { codecs, game: (await GC.gpuCompressorReady())?.codec ?? null, calibration: GC.gpuCompressorCalibration(), rows: [] };
    for (const codec of codecs) {
      const C = new GC.GpuCompressor(R, { codec, tier: 2 });
      for (const [f, srgb] of FILES) {
        const bmp = await createImageBitmap(await (await fetch('/' + f)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        const p = { srgb, colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace, flipY: false, premultiplyAlpha: false, unpackAlignment: 4, mips: true };
        const w = bmp.width, h = bmp.height;
        const ref = new THREE.Texture(bmp); ref.colorSpace = p.colorSpace; ref.flipY = false; ref.needsUpdate = true;
        R.initTexture(ref);
        const levels = await C.encodeImage(bmp, p);
        const ct = new THREE.CompressedTexture(levels.map((d, l) => ({ data: d, width: Math.max(1, w >> l), height: Math.max(1, h >> l) })), w, h, C.format);
        ct.colorSpace = p.colorSpace; ct.minFilter = THREE.LinearMipmapLinearFilter; ct.needsUpdate = true;
        R.initTexture(ct);
        const A = read(R.properties.get(ref).__webglTexture, w, h, srgb), B = read(R.properties.get(ct).__webglTexture, w, h, srgb);
        let se = 0, sa = 0, n = 0;
        for (let i = 0; i < A.length; i += 4) { for (let c = 0; c < 3; c++) { const d = A[i + c] - B[i + c]; se += d * d; } const da = A[i + 3] - B[i + 3]; sa += da * da; n++; }
        const ps = (m) => (m ? 10 * Math.log10(255 * 255 / m) : 99);
        out.rows.push({ codec, f, rgb: ps(se / (n * 3)), a: ps(sa / n), bytes: levels.reduce((x, d) => x + d.byteLength, 0), mips: levels.length });
        ref.dispose(); ct.dispose(); bmp.close();
      }
      C.dispose();
    }
    return out;
  }, FILES);
  const swift = t.harness?.mode === 'swiftshader';
  t.log(`codecs here: ${res.codecs.join(', ') || 'none'}; the game uses ${res.game}; calibration ${JSON.stringify(res.calibration)}`);
  t.ok(res.codecs.length > 0, 'the GPU runner samples BC7 (EXT_texture_compression_bptc)');
  if (swift) {
    // a CPU renderer encodes ~100× slower than a GPU: the calibration turns compression off (a mission loads as it
    // would without this module)
    t.ok(res.calibration && res.calibration.tier === null && res.game === null, 'SwiftShader: compression off after the calibration');
  } else {
    t.ok(res.game === res.codecs[0], 'the game installed its compressor with the preferred codec');
    t.ok(res.calibration && res.calibration.tier !== null, `the calibration picked an encoder tier (${res.calibration?.tier})`);
  }
  for (const r of res.rows) {
    const [, , fb, fa, falpha] = FILES.find((x) => x[0] === r.f);
    const floor = r.codec === 'bc7' ? fb : fa;
    t.log(`${r.codec} ${r.f.split('/').pop()}: RGB ${r.rgb.toFixed(2)} dB, alpha ${r.a.toFixed(2)} dB, ${r.mips} levels, ${(r.bytes / 1048576).toFixed(2)} MB`);
    t.ok(r.rgb >= floor, `${r.codec} ${r.f}: RGB ${r.rgb.toFixed(2)} dB ≥ ${floor}`);
    if (falpha) t.ok(r.a >= falpha, `${r.codec} ${r.f}: alpha ${r.a.toFixed(2)} dB ≥ ${falpha}`);
    t.equal(r.mips, 11, 'full mip chain');
  }

  // the game: every material map of a loaded mission is compressed (or deliberately kept)
  const scan = await page.evaluate(async () => {
    await window.__game.loadMission('m01');
    const G = window.__game.game;
    for (let i = 0; i < 3; i++) G.render(0.016, 1);
    const KEEP = /waternormals|foam2|foliage_n|_sid\.png/;
    const seen = new Set(), plain = [];
    let comp = 0, compBytes = 0;
    G.renderer.scene.traverse((o) => {
      for (const m of o.material ? [].concat(o.material) : []) {
        const texs = [];
        for (const k in m) if (m[k]?.isTexture) texs.push(m[k]);
        for (const u of Object.values(m.uniforms || {})) if (u?.value?.isTexture) texs.push(u.value);
        for (const t of texs) {
          if (seen.has(t)) continue; seen.add(t);
          if (t.isCompressedTexture) { comp++; compBytes += (t.mipmaps || []).reduce((a, x) => a + Math.ceil(x.width / 4) * Math.ceil(x.height / 4) * 16, 0) * (t.image?.depth || 1); continue; }
          const im = t.image, w = im?.width || 0, src = im?.currentSrc || im?.src || t.name || '';
          if (w < 256 || t.isRenderTargetTexture || t.isCanvasTexture || t.isDataTexture || im instanceof HTMLCanvasElement || KEEP.test(src)) continue;
          if (t.isDataArrayTexture && /foliage_n/.test(t.userData?.url || '')) continue;
          plain.push(`${t.constructor.name} ${w}×${im?.height} ${String(src).slice(-60)}`);
        }
      }
    });
    return { comp, compMB: compBytes / 1048576, plain };
  });
  t.log(`M1: ${scan.comp} compressed maps (${scan.compMB.toFixed(0)} MB on the GPU); left uncompressed: ${scan.plain.length} ${JSON.stringify(scan.plain.slice(0, 8))}`);
  if (swift) { t.equal(scan.comp, 0, 'SwiftShader: M1 loads uncompressed'); return; }
  t.ok(scan.comp > 200, `M1 draws its material maps compressed (${scan.comp})`);
  t.ok(scan.plain.length <= 2, `no material map left uncompressed by accident (${scan.plain.length})`);
}
