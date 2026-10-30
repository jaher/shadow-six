import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { keepUnpackCache } from '../../src/engine/renderer.js';

// three's WebGLState pixel-store cache as vendor/three.module.js (r186) has it: getParameter answers from the cache, else
// asks GL; pixelStorei skips a value already cached; reset() zeroes the unpack rows with gl.pixelStorei and empties it
const ROWS = { UNPACK_ROW_LENGTH: 0x0CF2, UNPACK_IMAGE_HEIGHT: 0x806E, UNPACK_SKIP_PIXELS: 0x0CF4, UNPACK_SKIP_ROWS: 0x0CF3, UNPACK_SKIP_IMAGES: 0x806D };
function fakeRenderer() {
  const gl = { ...ROWS, gets: 0, stores: 0, v: new Map(), isContextLost: () => false };
  gl.getParameter = (p) => { gl.gets++; return gl.v.get(p) ?? 0; };
  gl.pixelStorei = (p, x) => { gl.stores++; gl.v.set(p, x); };
  const state = () => {
    let params = {};
    return {
      getParameter: (n) => (params[n] !== undefined ? params[n] : gl.getParameter(n)),
      pixelStorei: (n, x) => { if (params[n] !== x) { gl.pixelStorei(n, x); params[n] = x; } },
      reset: () => { for (const p of Object.values(ROWS)) gl.pixelStorei(p, 0); params = {}; },
    };
  };
  const r = { gl, state: state(), makeState: state, getContext: () => gl, resetState() { this.state.reset(); } };
  // a sub-image upload (WebGLTextures updateTexture with updateRanges): save the rows, set its own, restore them
  r.upload = (w) => {
    const s = r.state, saved = [ROWS.UNPACK_ROW_LENGTH, ROWS.UNPACK_SKIP_PIXELS, ROWS.UNPACK_SKIP_ROWS].map((p) => [p, s.getParameter(p)]);
    s.pixelStorei(ROWS.UNPACK_ROW_LENGTH, w); s.pixelStorei(ROWS.UNPACK_SKIP_PIXELS, 3); s.pixelStorei(ROWS.UNPACK_SKIP_ROWS, 2);
    for (const [p, x] of saved) s.pixelStorei(p, x);
  };
  return r;
}

test('a sub-image upload after resetState reads three\'s pixel-store cache, never gl.getParameter (a GPU round trip)', () => {
  const plain = fakeRenderer(), kept = fakeRenderer();
  keepUnpackCache(kept);
  for (const r of [plain, kept]) { r.upload(64); r.resetState(); r.upload(32); r.resetState(); r.upload(16); }
  assert.ok(plain.gl.gets > 0, 'without it three asks GL after every reset');
  assert.equal(kept.gl.gets, 0, 'with it never');
  // the same GL state either way: the rows are back at 0 after each upload and after each reset
  for (const r of [plain, kept]) for (const p of Object.values(ROWS)) assert.equal(r.gl.v.get(p) ?? 0, 0);
  // installed once; a restored context's new WebGLState (empty cache) is primed by the next reset
  keepUnpackCache(kept);
  kept.state = kept.makeState(); kept.resetState(); kept.upload(8);
  assert.equal(kept.gl.gets, 0, 'after a restored context too');
});

test('three still caches pixelStorei and empties the cache on reset (keepUnpackCache relies on both)', () => {
  const src = readFileSync(new URL('../../vendor/three.module.js', import.meta.url), 'utf8');
  assert.match(src, /function getParameter\( name \) \{\s*if \( parameters\[ name \] !== undefined \) \{\s*return parameters\[ name \];/);
  assert.match(src, /function pixelStorei\( name, value \) \{\s*if \( parameters\[ name \] !== value \) \{\s*gl\.pixelStorei\( name, value \);\s*parameters\[ name \] = value;/);
  assert.match(src, /gl\.pixelStorei\( gl\.UNPACK_ROW_LENGTH, 0 \);[\s\S]{0,400}parameters = \{\};/);
  assert.match(src, /const currentUnpackRowLen = state\.getParameter\( _gl\.UNPACK_ROW_LENGTH \);/);
});
