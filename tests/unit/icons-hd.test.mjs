/**
 * HUD icons stay sharp at every screen density (user 2026-10-08: "also make the icons better quality / resolution, they
 * look pixelated"). Every rendered icon (knapsack items, top-bar tools and their states, cursors, stamps, the pack, the
 * notebook page, the living eye's sprite sheet) has a file with at least as many pixels as it covers on screen at every
 * UI scale × DPR a player meets: desktops at uiScale 1–3 and DPR 1–2 (720p … 5K / 6K at 200 %), 2.5–3× laptops,
 * and phones (Pixel 7 2.625, iPhone 14 3) at the touch HUD scales --u / --ut / --ub. No CSS or canvas code asks for
 * nearest-neighbour scaling. The browser-side check (what each <img> really draws) is tests/ui-icons-hd.test.mjs.
 */
import { test, assert } from './lib.mjs';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_MANIFEST } from '../../src/ui/icon-manifest.js';
import { pickTier, needDensity, tierDensity, iconURL } from '../../src/ui/icon-art.js';
import { EYE_ANIM } from '../../src/ui/eye-anim-data.js';
import { eyeSheetTier } from '../../src/ui/eye-anim.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** UI scale (CSS px per ref px of the HUD) × devicePixelRatio pairs. */
const TARGETS = [
  { name: 'desktop', scales: [1, 1.5, 2, 2.5, 3], dprs: [1, 1.25, 1.5, 2] },
  { name: '3x laptop', scales: [1, 1.5, 2], dprs: [2.5, 3] },
  { name: 'phone', scales: [0.69, 0.93, 1, 1.15, 1.2], dprs: [2, 2.625, 3] }, // Pixel 7 / iPhone 14: --u, --ut, --ub
];
/** How large an icon is drawn over its ref box × the UI scale: knapsack items sit in smaller slots (~0.65), a 16-px
 *  stamp covers a 40-px portrait (the dead man's skull, the cell bars: 2.5). */
const MULTS = (id) => (id.startsWith('stamp/') ? [0.65, 1, 2.5] : [0.65, 1]);
/** Pixel rounding: a tier is round(box × density) px (a 49.5-px box ships as 49 or 50). */
const ROUND = 0.98;

/** RIFF chunk ids of a WebP file ('VP8L' = lossless; 'VP8 ' = lossy, 4:2:0 colour). */
function webpChunks(b) {
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return [];
  const out = [];
  for (let o = 12; o + 8 <= b.length;) {
    const n = b.readUInt32LE(o + 4);
    out.push(b.toString('ascii', o, o + 4));
    o += 8 + n + (n & 1);
  }
  return out;
}
const lossless = (f) => { const c = webpChunks(readFileSync(f)); return c.includes('VP8L') && !c.includes('VP8 '); };

test('every icon at every UI scale × DPR: the tier picked has at least the device pixels the icon covers', () => {
  const short = [];
  for (const [id, e] of Object.entries(ICON_MANIFEST)) {
    for (const T of TARGETS) for (const u of T.scales) for (const d of T.dprs) for (const m of MULTS(id)) {
      const k = u * m, t = pickTier(id, needDensity(k, d));
      const [w, h] = e.t[t], cw = e.b[0] * k * d, ch = e.b[1] * k * d;
      if (w < cw * ROUND || h < ch * ROUND) short.push(`${id} ${T.name} ${k.toFixed(2)}×${d}: @${t} ${w}×${h} for ${cw.toFixed(0)}×${ch.toFixed(0)}`);
    }
  }
  assert.ok(!short.length, `${short.length} icon draws upscaled (pixelated), e.g.\n  ${short.slice(0, 12).join('\n  ')}`);
});

test('the tier ladder: every icon has 1×–6× files (stamps to 16×), each file exists at its manifest size', () => {
  for (const [id, e] of Object.entries(ICON_MANIFEST)) {
    const ks = Object.keys(e.t).map(tierDensity);
    assert.ok(Math.min(...ks) <= 1, `${id} has a 1× tier (720p, 768p laptops: prefiltered, not browser-downscaled)`);
    assert.ok(Math.max(...ks) >= (id.startsWith('stamp/') ? 16 : 6), `${id} reaches ${id.startsWith('stamp/') ? 16 : 6}× (has ${Math.max(...ks)}×)`);
    for (const [k, [w, h]] of Object.entries(e.t)) {
      const f = fileURLToPath(iconURL(id, k));
      assert.ok(existsSync(f), `${id}@${k}.webp`);
      // lossless WebP ('VP8L'): lossy WebP is 4:2:0 and halves the colour resolution of an icon drawn 1:1
      assert.ok(lossless(f), `${id}@${k} is lossless WebP (${webpChunks(readFileSync(f)).join(' ')})`);
      assert.ok(Math.abs(w - Math.round(e.b[0] * tierDensity(k))) <= 1 && Math.abs(h - Math.round(e.b[1] * tierDensity(k))) <= 1, `${id}@${k} ${w}×${h}`);
    }
  }
});

test('the living eye sheet covers the eye button at every UI scale × DPR', () => {
  for (const T of TARGETS) for (const u of T.scales) for (const d of T.dprs) {
    const t = eyeSheetTier(u, d), need = needDensity(u, d);
    assert.ok(EYE_ANIM.tiers[t], `${t} sheet listed`);
    assert.ok(tierDensity(t) >= need * ROUND, `eye ${u}×${d}: sheet @${t} for ${need.toFixed(2)}`);
  }
  for (const k of Object.keys(EYE_ANIM.tiers)) {
    const f = join(ROOT, 'assets/ui/icons/tool', `eye.anim@${k}.webp`);
    assert.ok(statSync(f).size > 0 && lossless(f), `eye.anim@${k} lossless`);
  }
});

test('no nearest-neighbour scaling anywhere in the UI (image-rendering: pixelated / crisp-edges, canvas smoothing off)', () => {
  const css = readdirSync(join(ROOT, 'styles')).filter((f) => f.endsWith('.css'));
  for (const f of css) {
    const s = readFileSync(join(ROOT, 'styles', f), 'utf8');
    assert.ok(!/image-rendering\s*:\s*(pixelated|crisp-edges|optimizeSpeed|-moz-crisp-edges|-webkit-optimize-contrast)/i.test(s), `styles/${f}`);
  }
  for (const d of ['src/ui', 'src/art']) {
    for (const f of readdirSync(join(ROOT, d)).filter((x) => x.endsWith('.js'))) {
      const s = readFileSync(join(ROOT, d, f), 'utf8');
      assert.ok(!/imageRendering\s*=\s*['"](pixelated|crisp-edges)/.test(s) && !/image-rendering\s*:\s*(pixelated|crisp-edges)/.test(s), `${d}/${f}: no pixelated rendering`);
      assert.ok(!/imageSmoothingEnabled\s*=\s*false/.test(s), `${d}/${f}: canvas smoothing stays on`);
    }
  }
});
