/** The living HUD eye (tools/blender/hud/eye → assets/ui/icons/tool/eye.*, src/ui/eye-anim.js): renders and sheets
 * at every tier, HiDPI sheet selection, blink / saccade / dilation / look-at timing, and the static fallbacks. */
import { test, assert } from './lib.mjs';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ICON_MANIFEST } from '../../src/ui/icon-manifest.js';
import { iconURL, tierDensity, pickTier, needDensity } from '../../src/ui/icon-art.js';
import { EYE_ANIM } from '../../src/ui/eye-anim-data.js';
import {
  EyeAnimator, eyeSheetTier, eyeSheetURL, gazeFrame, frameIndex, framePos, lookAt, blinkFrame,
  BLINK_SEQ, BLINK_MS, BLINK_GAP, DILATE_DELAY, DILATE_MS, CONSTRICT_MS,
} from '../../src/ui/eye-anim.js';

const file = (url) => fileURLToPath(url);
const SCALES = [1, 1.5, 2, 2.25, 2.5, 3, 4.5];
const DPRS = [1, 1.25, 1.5, 2, 3];

test('eye renders: open / closed / every tool state and the eye cursor ship at every tier', () => {
  for (const id of ['tool/eye.open', 'tool/eye.closed', 'tool/eye.open.hover', 'tool/eye.open.pressed', 'tool/eye.open.active',
    'tool/eye.open.disabled', 'cursor/eye.open', 'cursor/eye.closed']) {
    const e = ICON_MANIFEST[id];
    assert.ok(e, `${id} in the manifest`);
    for (const k of Object.keys(e.t)) assert.ok(existsSync(file(iconURL(id, k))), `${id}@${k}.webp`);
    for (const s of SCALES) for (const d of DPRS) {
      const p = pickTier(id, needDensity(id.startsWith('cursor/') ? 1 : s, d), true);
      assert.ok(existsSync(file(iconURL(id, p, 'png'))), `${id} PNG fallback ${p}`);
    }
  }
  assert.deepEqual(ICON_MANIFEST['tool/eye.open'].b, [52, 41], 'same 52×41 slot: hit area and layout unchanged');
  assert.deepEqual(EYE_ANIM.box, ICON_MANIFEST['tool/eye.open'].b, 'sheet cells are laid out on the tool box');
});

test('eye sheets: one per tool tier, grid × cell sized exactly, cell inside the porthole box, small', () => {
  const [x0, y0, x1, y1] = EYE_ANIM.cell, [bw, bh] = EYE_ANIM.box;
  assert.ok(x0 >= 0 && y0 >= 0 && x1 <= bw && y1 <= bh && x1 - x0 > bw * 0.5 && y1 - y0 > bh * 0.5, `cell ${EYE_ANIM.cell}`);
  assert.deepEqual(Object.keys(EYE_ANIM.tiers).sort(), Object.keys(ICON_MANIFEST['tool/eye.closed'].t).sort(), 'tiers mirror the tool tiers');
  assert.equal(EYE_ANIM.cols * EYE_ANIM.rows >= EYE_ANIM.frames.length, true);
  let bytes = 0;
  for (const [k, [w, h]] of Object.entries(EYE_ANIM.tiers)) {
    const f = file(eyeSheetURL(k));
    assert.ok(existsSync(f), f);
    const buf = readFileSync(f);
    assert.equal(buf.toString('ascii', 8, 12), 'WEBP', `${k} is WebP`);
    const d = tierDensity(k);
    assert.equal(w, EYE_ANIM.cols * Math.round((x1 - x0) * d), `${k} width`);
    assert.equal(h, EYE_ANIM.rows * Math.round((y1 - y0) * d), `${k} height`);
    bytes += statSync(f).size;
  }
  assert.ok(bytes < 1.5e6, `sheets ${(bytes / 1e6).toFixed(2)} MB`);
});

test('eye frames: centre + 16 gaze directions at both pupil sizes, and blink stages over every gaze', () => {
  const g = EYE_ANIM.frames.filter((f) => f.name.startsWith('g'));
  assert.equal(g.filter((f) => f.p === 'n').length, 17);
  assert.equal(g.filter((f) => f.p === 'd').length, 17);
  assert.ok(frameIndex('blink3') >= 0 && EYE_ANIM.frames[frameIndex('blink3')].blink === 1, 'shut lid');
  for (const f of g) {
    const i = EYE_ANIM.frames.indexOf(f);
    const b1 = EYE_ANIM.frames[blinkFrame('b1', i)], b2 = EYE_ANIM.frames[blinkFrame('b2', i)];
    assert.equal(b1.name, `b1${f.name}`, 'half-closed lid over the same gaze and pupil');
    assert.equal(b2.name, `b2${f.name.slice(0, 3)}n`, 'nearly shut over the same gaze');
    for (const b of [b1, b2]) assert.ok(b.gx === f.gx && b.gy === f.gy, `${b.name} keeps the gaze of ${f.name}`);
    assert.equal(b1.p, f.p, `${b1.name} keeps the pupil`);
    assert.ok(f.blink < b1.blink && b1.blink < b2.blink && b2.blink < 1, `closure rises ${f.blink} ${b1.blink} ${b2.blink}`);
    assert.equal(blinkFrame('b3', i), frameIndex('blink3'));
  }
  assert.equal(EYE_ANIM.frames[gazeFrame(0, 0)].name, 'g00n');
  assert.equal(EYE_ANIM.frames[gazeFrame(0, 0, true)].p, 'd');
  const r = EYE_ANIM.frames[gazeFrame(1, 0)];
  assert.ok(r.gx === 1 && r.gy === 0, 'full right');
  assert.equal(framePos(0), '0% 0%');
  const last = EYE_ANIM.cols * EYE_ANIM.rows - 1;
  assert.equal(framePos(last), '100% 100%');
});

test('HiDPI sheet selection: the smallest tier that covers UI scale × DPR, else the largest', () => {
  assert.equal(eyeSheetTier(1, 1), '2x');
  assert.equal(eyeSheetTier(2, 1), '2x', '1080p');
  assert.equal(eyeSheetTier(2.25, 1), '3x');
  assert.equal(eyeSheetTier(3, 1), '3x', '1440p');
  assert.equal(eyeSheetTier(2, 2), '4x', '4K at DPR 2');
  assert.equal(eyeSheetTier(4.5, 1), '6x', '4K at DPR 1');
  assert.equal(eyeSheetTier(4, 3), '6x', 'beyond: the largest');
  for (const s of SCALES) for (const d of DPRS) {
    const k = eyeSheetTier(s, d), need = needDensity(s, d);
    assert.ok(tierDensity(k) >= Math.min(need, 6) - 1e-6, `${s}×${d} → ${k}`);
  }
});

const seq = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const fakeBtn = () => {
  const cls = new Set(), on = {};
  return {
    cls, on, rect: { left: 1800, top: 0, width: 104, height: 82 },
    classList: { contains: (c) => cls.has(c), toggle: (c, v) => (v ? cls.add(c) : cls.delete(c)) },
    addEventListener: (k, f) => { on[k] = f; }, appendChild() {}, getBoundingClientRect() { return this.rect; },
  };
};

test('blinks every 3-6 s for ~150-250 ms (half, shut, back); idle saccades stay small and the pupil normal', () => {
  const a = new EyeAnimator(fakeBtn(), { random: seq(7) });
  const names = [];
  for (let t = 16; t < 120000; t += 4) names.push([t, EYE_ANIM.frames[a.pick(t)].name]);
  const starts = [], ends = [];
  const lids = [];
  for (let i = 1; i < names.length; i++) {
    const was = names[i - 1][1].startsWith('b'), is = names[i][1].startsWith('b');
    if (is && !was) lids.push([names[i - 1][1], names[i][1]]);
    if (is && !was) starts.push(names[i][0]);
    if (was && !is) ends.push(names[i][0]);
  }
  assert.ok(starts.length >= 18 && starts.length <= 40, `${starts.length} blinks in 2 min`);
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1];
    assert.ok(gap >= BLINK_GAP[0] && gap <= BLINK_GAP[1] + BLINK_MS + 8, `blink gap ${gap} ms`);
  }
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    const d = ends[i] - starts[i];
    assert.ok(d >= 150 && d <= 250, `blink lasts ${d} ms`);
  }
  assert.ok(BLINK_MS >= 150 && BLINK_MS <= 250);
  assert.deepEqual(BLINK_SEQ.map(([n]) => n), ['b1', 'b2', 'b3', 'b2', 'b1'], 'closes then opens');
  for (const [before, first] of lids) assert.equal(first, `b1${before}`, 'the lid closes over the current gaze (no snap to centre)');
  assert.ok(lids.some(([b]) => b !== 'g00n'), 'some blinks start while looking aside');
  const gaze = new Set(names.filter(([, n]) => n.startsWith('g')).map(([, n]) => n));
  assert.ok(gaze.size >= 5, `looks around (${gaze.size} gaze frames)`);
  assert.ok([...gaze].every((n) => n.endsWith('n')), 'pupil normal while not hovered');
});

test('hover dilates the pupil after a short latency; the armed eye looks towards the cursor', () => {
  const btn = fakeBtn();
  const a = new EyeAnimator(btn, { random: seq(3) });
  a.blinkAt = 1e9; a.saccadeAt = 1e9; a.hoverSince = 1000;
  assert.ok(DILATE_DELAY >= 200 && DILATE_DELAY <= 300, 'physiological latency');
  assert.ok(DILATE_MS >= 500 && DILATE_MS <= 1000 && CONSTRICT_MS >= 300, 'eased, not a snap');
  const mixes = [];
  for (let t = 1000; t <= 1000 + DILATE_DELAY + DILATE_MS + 50; t += 16) {
    const p = EYE_ANIM.frames[a.pick(t)].p;
    if (t < 1000 + DILATE_DELAY) assert.equal(a.view.mix, 0, 'not yet');
    if (t < 1000 + DILATE_DELAY) assert.equal(p, 'n');
    mixes.push(a.view.mix);
  }
  for (let i = 1; i < mixes.length; i++) assert.ok(mixes[i] >= mixes[i - 1], 'opens monotonically');
  assert.ok(mixes.filter((m) => m > 0.05 && m < 0.95).length >= 15, 'many intermediate sizes (crossfade over ~0.7 s)');
  assert.equal(mixes[mixes.length - 1], 1);
  const v = a.view;
  assert.ok(EYE_ANIM.frames[v.n].p === 'n' && EYE_ANIM.frames[v.d].p === 'd' && EYE_ANIM.frames[v.n].gx === EYE_ANIM.frames[v.d].gx, 'same gaze, both pupils');
  // a blink while dilated keeps the dilated pupil
  a.blinkAt = 2000;
  assert.equal(EYE_ANIM.frames[a.pick(2000)].name, 'b1g00d', 'blink over the dilated eye');
  a.blinkAt = 1e9; a.blinkStart = -1;
  a.hoverSince = -1;
  let t = 2010, m = 1;
  for (; m > 0 && t < 4000; t += 16) { a.pick(t); m = a.view.mix; }
  assert.ok(t - 2010 >= CONSTRICT_MS * 0.9 && t - 2010 <= CONSTRICT_MS + 300, `constricts over ${t - 2010} ms`);
  let armed = true;
  const b = new EyeAnimator(btn, { random: seq(5), armed: () => armed });
  b.blinkAt = 1e9; b.pointer = [600, 700];            // lower-left of the top-right eye
  const f = EYE_ANIM.frames[b.pick(10)];
  assert.ok(f.gx < 0 && f.gy < 0, `looks down-left (${f.name})`);
  b.pointer = [1852, 41];                               // on the eye itself: straight ahead
  assert.equal(EYE_ANIM.frames[b.pick(20)].name, 'g00n');
  armed = false;
  const [gx, gy] = lookAt(0, 0, 100, 0, 200);
  assert.ok(Math.abs(gx - 0.5) < 1e-9 && gy === 0, 'reach scales with distance');
});

test('fallbacks: no DOM, a failed sheet or reduced motion leave the static renders (nothing animates)', () => {
  const none = new EyeAnimator(fakeBtn());
  assert.equal(none.tick(0), -1, 'no document: inert');
  assert.equal(none.refresh(2), null);
  const g = globalThis, saved = { document: g.document, Image: g.Image };
  const mk = () => ({ style: {}, dataset: {}, setAttribute() {}, remove() {} });
  let img = null;
  g.document = { createElement: mk };
  g.Image = class { set src(v) { this._src = v; img = this; } };
  try {
    let rm = false;
    const btn = fakeBtn();
    const a = new EyeAnimator(btn, { reducedMotion: () => rm, dpr: () => 1 });
    assert.ok(a.el, 'overlay element created');
    assert.equal(a.refresh(2), '2x');
    assert.ok(img._src.endsWith('tool/eye.anim@2x.webp'), img._src);
    assert.equal(a.tick(0), -1, 'waits for the sheet');
    img.onerror();
    assert.equal(btn.cls.has('eye-live'), false, 'failed sheet → static');
    assert.equal(a.refresh(2.25), '3x');
    img.onload();
    assert.ok(a.tick(5) >= 0 && btn.cls.has('eye-live'), 'sheet loaded → live');
    assert.ok(a.el.style.backgroundImage.includes('eye.anim@3x.webp'));
    assert.ok(/%/.test(a.el.style.backgroundPosition));
    rm = true;
    assert.equal(a.tick(10), -1, 'reduced motion → static');
    assert.ok(!btn.cls.has('eye-live') && btn.cls.has('eye-rm'));
  } finally {
    g.document = saved.document; g.Image = saved.Image;
  }
});

test('fallback CSS blink stays calm: no hover / armed rule speeds the static lid up', () => {
  const css = readFileSync(new URL('../../styles/ui.css', import.meta.url), 'utf8');
  const rules = [...css.matchAll(/([^{}]*\.hud-eye[^{}]*\.lid[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 1, 'lid rules found');
  for (const [, sel, body] of rules) {
    const d = body.match(/animation(?:-duration)?:[^;]*?([\d.]+)s/);
    if (d) assert.ok(+d[1] >= 3, `${sel.trim()} blinks every ${d[1]} s`);
  }
});
