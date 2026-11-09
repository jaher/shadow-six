/**
 * Banded GPU encodes (src/engine/gpu-compress.js, the HD upgrades while the game is played / on still screens), on a
 * recording fake WebGL2 context: a band's draws and read-backs are the unbanded encode's own, in the same order (the
 * same blocks: tests/gpu-compress.test.mjs checks the bytes on the GPU); a band holds at most a play band's worth of
 * draw + read-back pairs (each read waits for its draw: M5's 48-layer foliage strip had ~290 of them in one band, 100-
 * 130 ms of GPU); each band leaves a fence and the pump issues the next one only once the GPU has passed it.
 */
import { test, assert } from './lib.mjs';
import { GpuCompressor } from '../../src/engine/gpu-compress.js';

const TIMEOUT_EXPIRED = 0x911B, ALREADY_SIGNALED = 0x911A;

/** A WebGL2 stand-in: every call recorded, objects as tokens, `status` what clientWaitSync answers. */
function fakeGl() {
  const calls = [], live = new Set();
  const st = { status: TIMEOUT_EXPIRED, calls, live };
  const base = {
    TIMEOUT_EXPIRED, ALREADY_SIGNALED, CONDITION_SATISFIED: 0x911C, WAIT_FAILED: 0x911D, LINK_STATUS: 0x8B82,
    isContextLost: () => false, getExtension: () => null, getProgramParameter: () => true,
    getUniformLocation: (p, n) => ({ n }),
    fenceSync: () => { const s = { sync: calls.length }; live.add(s); calls.push(['fenceSync']); return s; },
    deleteSync: (s) => { live.delete(s); calls.push(['deleteSync']); },
    clientWaitSync: () => st.status,
  };
  const gl = new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return k; // GL enums as their names
      return (...a) => { calls.push([k, ...a]); return /^create/.test(k) ? { obj: k } : undefined; };
    },
  });
  st.gl = gl;
  return st;
}

function compressor(st) {
  const renderer = { getContext: () => st.gl, resetState: () => {}, domElement: null };
  const C = new GpuCompressor(renderer, { tier: 1 });
  C.codec = 'bc7'; // (the fake has no extensions: pick the codec by hand)
  return C;
}

test('banded encode of a 48-layer array: the same draws and read-backs as one go, at most 8 pairs a play band', () => {
  const W = 512, LAYERS = 48, LEVELS = 10, opts = { w: W, h: W, levels: LEVELS, layers: LAYERS, srgb: true, timed: false };
  const record = (bandTexels) => {
    const st = fakeGl(), C = compressor(st);
    const g = C._encodeGlG({ tex: 1 }, { ...opts, bandTexels });
    const bands = [];
    let cur = [], n0 = 0;
    const take = () => { for (const c of st.calls.slice(n0)) if (c[0] === 'readPixels') cur.push(c.slice(1).join(',')); n0 = st.calls.length; };
    let r = g.next();
    while (!r.done) { take(); bands.push(cur); cur = []; r = g.next(); }
    take(); bands.push(cur);
    return { bands, st, C };
  };
  const one = record(0), banded = record(1 << 18);
  assert.equal(one.bands.length, 1, 'unbanded: one go');
  const all = banded.bands.flat();
  assert.deepEqual(all, one.bands[0], 'the banded reads are the unbanded ones, in order');
  const draws = all.length;
  assert.ok(draws > 400, `every level of every layer read back (${draws})`);
  const maxPairs = Math.max(...banded.bands.map((b) => b.length));
  assert.ok(maxPairs <= 8, `no band holds more than 8 draw + read pairs (${maxPairs})`);
  // a fence after every band but the last, the job's own fence at the end
  const fences = banded.st.calls.filter((c) => c[0] === 'fenceSync').length;
  assert.equal(fences, banded.bands.length, `one fence per band (${fences} for ${banded.bands.length} bands)`);
});

test('the pump holds the next band until the GPU passed the last one (BAND_WAIT_MS at most)', () => {
  const st = fakeGl(), C = compressor(st), gl = st.gl;
  assert.equal(C._bandDone(gl, false), true, 'no band pending: go');
  C._fenceBand(gl);
  st.status = TIMEOUT_EXPIRED;
  assert.equal(C._bandDone(gl, false), false, 'its fence not passed: wait');
  assert.equal(C._bandDone(gl, true), true, 'a hidden page (timers crawl): go');
  C._fenceBand(gl);
  C._bandT0 -= 5000;
  assert.equal(C._bandDone(gl, false), true, 'a fence that never passes does not hold the encode');
  C._fenceBand(gl);
  st.status = ALREADY_SIGNALED;
  assert.equal(C._bandDone(gl, false), true, 'passed: go');
  assert.equal(C._bandSync, null, 'and the fence is dropped');
  C._fenceBand(gl); C._fenceBand(gl);
  assert.equal(st.live.size, 1, 'a new band fence drops the previous one');
});
