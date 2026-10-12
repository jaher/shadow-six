/**
 * Debug GPU memory counter (src/debug/gpu-mem-counter.js): byte rules (same as tools/perf/mem-probe.js) and the
 * running totals on a stand-in WebGL2 prototype — allocation, re-specification, deletion, mip generation, MSAA,
 * a lost context, calls on a lost context, the drawing-buffer estimate, install / uninstall.
 */
import { test, assert } from './lib.mjs';
import { installGpuMemCounter, levelBytes, storageBytes, bufferBytes, compressedBlock } from '../../src/debug/gpu-mem-counter.js';

const GL = {
  TEXTURE_2D: 0x0DE1, TEXTURE_CUBE_MAP: 0x8513, CUBE_X: 0x8515, TEXTURE_3D: 0x806F, TEXTURE_2D_ARRAY: 0x8C1A,
  RGBA8: 0x8058, RGBA16F: 0x881A, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, HALF_FLOAT: 0x140B, R8: 0x8229, DEPTH24_STENCIL8: 0x88F0,
  DEPTH_COMPONENT: 0x1902, UNSIGNED_INT: 0x1405, UNSIGNED_SHORT: 0x1403, BC7: 0x8E8C, ASTC4: 0x93B0, ASTC8: 0x93B7, DXT1: 0x83F0,
  ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, UNIFORM_BUFFER: 0x8A11, RENDERBUFFER: 0x8D41, STATIC_DRAW: 0x88E4,
};
const BIND = { 0x8069: [GL.TEXTURE_2D], 0x8514: [GL.TEXTURE_CUBE_MAP], 0x806A: [GL.TEXTURE_3D], 0x8C1D: [GL.TEXTURE_2D_ARRAY],
  0x8894: [GL.ARRAY_BUFFER], 0x8895: [GL.ELEMENT_ARRAY_BUFFER], 0x8A28: [GL.UNIFORM_BUFFER], 0x8CA7: [GL.RENDERBUFFER] };

/** A WebGL2 stand-in: bindings answered by getParameter, allocation calls recorded (so wrappers must pass them on). */
function fakeContextClass() {
  class FakeGL {
    constructor() {
      this.canvas = new EventTarget();
      this.bound = new Map();
      this.lost = false;
      this.log = [];
      this.drawingBufferWidth = 100;
      this.drawingBufferHeight = 50;
    }
    isContextLost() { return this.lost; }
    getParameter(p) { const t = BIND[p]; return t ? this.bound.get(t[0]) ?? null : null; }
    bindTexture(target, t) { this.bound.set(target, t); }
    bindBuffer(target, b) { this.bound.set(target, b); }
    bindRenderbuffer(target, rb) { this.bound.set(target, rb); }
    loseContext() { this.lost = true; this.canvas.dispatchEvent(new Event('webglcontextlost')); }
  }
  for (const m of ['texStorage2D', 'texStorage3D', 'texImage2D', 'texImage3D', 'compressedTexImage2D', 'compressedTexImage3D', 'copyTexImage2D',
    'generateMipmap', 'deleteTexture', 'bufferData', 'deleteBuffer', 'renderbufferStorage', 'renderbufferStorageMultisample', 'deleteRenderbuffer']) {
    FakeGL.prototype[m] = function (...a) { this.log.push(m); return `ret:${m}`; };
  }
  return FakeGL;
}

test('gpu mem: byte rules — sized, unsized, packed, compressed (BC7 / ASTC / DXT1)', () => {
  assert.equal(levelBytes(GL.RGBA8, 256, 256), 262144);
  assert.equal(levelBytes(GL.RGBA16F, 16, 16), 2048);
  assert.equal(levelBytes(GL.R8, 10, 10, 3), 300);
  assert.equal(levelBytes(GL.RGBA, 4, 4, 1, GL.RGBA, GL.UNSIGNED_BYTE), 64);
  assert.equal(levelBytes(GL.RGBA, 4, 4, 1, GL.RGBA, GL.HALF_FLOAT), 128);
  assert.equal(levelBytes(GL.DEPTH_COMPONENT, 8, 8, 1, GL.DEPTH_COMPONENT, GL.UNSIGNED_INT), 256);
  assert.equal(levelBytes(GL.DEPTH_COMPONENT, 8, 8, 1, GL.DEPTH_COMPONENT, GL.UNSIGNED_SHORT), 128);
  assert.equal(levelBytes(GL.DEPTH24_STENCIL8, 10, 10), 400);
  assert.equal(levelBytes(GL.BC7, 256, 256), 65536, 'BC7: 1 byte per texel');
  assert.equal(levelBytes(GL.BC7, 1, 1), 16, 'a partial block is a whole block');
  assert.equal(levelBytes(GL.ASTC4, 100, 100), 25 * 25 * 16);
  assert.equal(levelBytes(GL.ASTC8, 100, 100), 13 * 13 * 16);
  assert.equal(levelBytes(GL.DXT1, 8, 8), 32);
  assert.deepEqual(compressedBlock(GL.RGBA8), null);
});

test('gpu mem: storage chains — mips, cube faces, 3D depth halves, array layers stay', () => {
  assert.equal(storageBytes(GL.TEXTURE_2D, 4, GL.RGBA8, 8, 8), (64 + 16 + 4 + 1) * 4);
  assert.equal(storageBytes(GL.TEXTURE_CUBE_MAP, 1, GL.RGBA8, 8, 8), 64 * 4 * 6);
  assert.equal(storageBytes(GL.TEXTURE_3D, 2, GL.R8, 4, 4, 4), 64 + 8);
  assert.equal(storageBytes(GL.TEXTURE_2D_ARRAY, 2, GL.R8, 4, 4, 4), 64 + 16);
  assert.equal(bufferBytes(1000), 1000);
  assert.equal(bufferBytes(new Float32Array(10)), 40);
  assert.equal(bufferBytes(new Float32Array(10), 2), 32, 'srcOffset in elements');
  assert.equal(bufferBytes(new Float32Array(10), 2, 3), 12, 'length in elements');
  assert.equal(bufferBytes(null), 0);
});

test('gpu mem: running totals — textures, re-specified levels, generated mips, deletes', () => {
  const FakeGL = fakeContextClass();
  const c = installGpuMemCounter(FakeGL.prototype);
  try {
    assert.equal(installGpuMemCounter(FakeGL.prototype), c, 'installed once');
    const gl = new FakeGL();
    const a = {}, b = {}, cube = {}, comp = {};
    gl.bindTexture(GL.TEXTURE_2D, a);
    assert.equal(gl.texStorage2D(GL.TEXTURE_2D, 11, GL.RGBA8, 1024, 1024), 'ret:texStorage2D', 'the original runs and returns');
    const chain = storageBytes(GL.TEXTURE_2D, 11, GL.RGBA8, 1024, 1024);
    assert.equal(c.totals().tex, chain);
    gl.generateMipmap(GL.TEXTURE_2D); // immutable storage: the chain is there already
    assert.equal(c.totals().tex, chain);
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA8, 4, 4, 0, GL.RGBA, GL.UNSIGNED_BYTE, null); // a GL error on texStorage
    assert.equal(c.totals().tex, chain);
    // mutable texture: level 0 (8-argument form), re-specified, then the 6-argument image form and a mip chain
    gl.bindTexture(GL.TEXTURE_2D, b);
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA8, 8, 8, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA8, 8, 8, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    assert.equal(c.totals().tex, chain + 256, 'the same level again replaces it');
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, { width: 16, height: 16 });
    assert.equal(c.totals().tex, chain + 1024);
    gl.generateMipmap(GL.TEXTURE_2D);
    gl.generateMipmap(GL.TEXTURE_2D); // every frame for a mipmapped target: counted once
    assert.equal(c.totals().tex, chain + (256 + 64 + 16 + 4 + 1) * 4);
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA8, 2, 2, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    assert.equal(c.totals().tex, chain + 16, 'a new base drops the generated mips');
    // cube faces + compressed
    gl.bindTexture(GL.TEXTURE_CUBE_MAP, cube);
    for (let f = 0; f < 6; f++) gl.texImage2D(GL.CUBE_X + f, 0, GL.RGBA8, 4, 4, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    gl.bindTexture(GL.TEXTURE_2D, comp);
    gl.compressedTexImage2D(GL.TEXTURE_2D, 0, GL.BC7, 64, 64, 0, new Uint8Array(4096));
    assert.equal(c.totals().tex, chain + 16 + 6 * 64 + 4096);
    assert.equal(c.totals().ntex, 4);
    gl.deleteTexture(a); gl.deleteTexture(b); gl.deleteTexture(cube);
    gl.deleteTexture(null); gl.deleteTexture({});
    assert.equal(c.totals().tex, 4096);
    gl.deleteTexture(comp);
    assert.equal(c.totals().tex, 0);
    assert.equal(c.totals().ntex, 0);
  } finally { c.uninstall(); }
});

test('gpu mem: buffers (bound per target), renderbuffers × samples, drawing buffer estimate', () => {
  const FakeGL = fakeContextClass();
  const c = installGpuMemCounter(FakeGL.prototype);
  try {
    const gl = new FakeGL();
    const v = {}, i = {}, rb = {};
    gl.bindBuffer(GL.ARRAY_BUFFER, v);
    gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, i);
    gl.bufferData(GL.ARRAY_BUFFER, new Float32Array(250), GL.STATIC_DRAW);
    gl.bufferData(GL.ELEMENT_ARRAY_BUFFER, 600, GL.STATIC_DRAW);
    assert.equal(c.totals().buf, 1600);
    gl.bufferData(GL.ARRAY_BUFFER, 100, GL.STATIC_DRAW);
    assert.equal(c.totals().buf, 700, 'bufferData again replaces the store');
    gl.bindBuffer(GL.UNIFORM_BUFFER, null);
    gl.bufferData(GL.UNIFORM_BUFFER, 64, GL.STATIC_DRAW); // nothing bound: a GL error, nothing counted
    gl.deleteBuffer(v);
    assert.equal(c.totals().buf, 600);
    assert.equal(c.totals().nbuf, 1);
    gl.bindRenderbuffer(GL.RENDERBUFFER, rb);
    gl.renderbufferStorageMultisample(GL.RENDERBUFFER, 4, GL.DEPTH24_STENCIL8, 10, 10);
    assert.equal(c.totals().rb, 1600);
    gl.renderbufferStorage(GL.RENDERBUFFER, GL.DEPTH24_STENCIL8, 10, 10);
    assert.equal(c.totals().rb, 400);
    const t = c.totals();
    assert.equal(t.fb, 100 * 50 * 12, 'colour ×2 + depth, 4 bytes each (mem-probe canvas rule)');
    assert.equal(t.total, t.tex + t.buf + t.rb + t.fb);
    assert.equal(t.contexts, 1);
    gl.deleteRenderbuffer(rb);
    assert.equal(c.totals().rb, 0);
  } finally { c.uninstall(); }
});

test('gpu mem: a lost context drops its records; calls while lost are ignored; restore counts again', () => {
  const FakeGL = fakeContextClass();
  const c = installGpuMemCounter(FakeGL.prototype);
  try {
    const gl = new FakeGL(), other = new FakeGL();
    const t = {}, t2 = {};
    gl.bindTexture(GL.TEXTURE_2D, t);
    gl.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA8, 16, 16);
    other.bindTexture(GL.TEXTURE_2D, t2);
    other.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA8, 8, 8);
    assert.equal(c.totals().tex, 1024 + 256);
    assert.equal(c.totals().contexts, 2);
    gl.loseContext();
    assert.equal(c.totals().tex, 256, 'only the other context is left');
    assert.equal(c.totals().contexts, 1);
    assert.equal(c.totals().losses, 1);
    gl.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA8, 16, 16); // a no-op on a lost context
    gl.deleteTexture(t);
    gl.lost = false; // restored: three uploads again
    assert.equal(c.totals().tex, 256);
    gl.bindTexture(GL.TEXTURE_2D, {});
    gl.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA8, 16, 16);
    assert.equal(c.totals().tex, 1024 + 256);
  } finally { c.uninstall(); }
});

test('gpu mem: accounting never breaks a call; uninstall restores the methods', () => {
  const FakeGL = fakeContextClass();
  const orig = FakeGL.prototype.texStorage2D;
  const c = installGpuMemCounter(FakeGL.prototype);
  assert.notEqual(FakeGL.prototype.texStorage2D, orig);
  const gl = new FakeGL();
  gl.getParameter = () => { throw new Error('boom'); };
  assert.equal(gl.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA8, 4, 4), 'ret:texStorage2D');
  assert.deepEqual(gl.log, ['texStorage2D']);
  c.uninstall();
  assert.equal(FakeGL.prototype.texStorage2D, orig);
  assert.notEqual(installGpuMemCounter(FakeGL.prototype), c, 'a fresh install after uninstall');
  installGpuMemCounter(FakeGL.prototype).uninstall();
  assert.equal(installGpuMemCounter(null), null);
  assert.equal(installGpuMemCounter({}), null);
});
