import { existsSync, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert } from './lib.mjs';
import { HERO_HEIGHTS, HERO_FACE, heroHeight, heroUrl, heroHeightOf, SKY_WIDTHS, skyWidth, skyUrl } from '../../src/ui/hero-art.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** [width, height] from a WebP (VP8X / VP8 / VP8L) or AVIF ('ispe' box) header. */
function imageSize(buf) {
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
    if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
  }
  const i = buf.indexOf('ispe');
  if (i > 0) return [buf.readUInt32BE(i + 8), buf.readUInt32BE(i + 12)];
  return null;
}

test('hero variant: the smallest height >= the viewport in device pixels, capped at 2700', () => {
  const cases = [
    [600, 1, 900], [720, 1, 900], [900, 1, 900], [901, 1, 1350], [1080, 1, 1350], [1200, 1, 1350], [1440, 1, 1800],
    [1600, 1, 1800], [2160, 1, 2700], [1080, 2, 2700], [720, 2, 1800], [768, 1.25, 1350], [1080, 1.5, 1800],
    [915, 2.625, 2700], [412, 2.625, 1350], [844, 3, 2700], [390, 3, 1350], [3000, 1, 2700], [4320, 2, 2700],
  ];
  for (const [h, dpr, want] of cases) {
    const got = heroHeight(h, dpr);
    assert.equal(got, want, `${h} css px @${dpr}x`);
    assert.ok(got >= Math.min(2700, Math.round(h * dpr)), `${h}@${dpr}: ${got} covers the screen`);
  }
  assert.equal(heroHeight(1080, 0), 1350, 'a missing devicePixelRatio counts as 1');
  assert.equal(heroHeight(1080), 1350);
});

test('hero variants: every height ships as WebP and AVIF, 2:3, a few hundred KB at most', () => {
  for (const h of HERO_HEIGHTS) {
    for (const fmt of ['webp', 'avif']) {
      const url = heroUrl(h, fmt);
      assert.equal(heroHeightOf(url), h);
      const p = join(ROOT, url);
      assert.ok(existsSync(p), `${url} exists`);
      const kb = statSync(p).size / 1024;
      assert.ok(kb > 20 && kb < 700, `${url}: ${kb.toFixed(0)} KB`);
      assert.deepEqual(imageSize(readFileSync(p)), [h * 2 / 3, h], `${url} is ${h * 2 / 3}x${h}`);
    }
  }
  assert.ok(existsSync(join(ROOT, 'assets/ui/keyart/hero.svg')), 'the SVG fallback stays');
});

test('hero face box is a sane fraction of the art', () => {
  const f = HERO_FACE;
  assert.ok(f.x0 >= 0 && f.x1 <= 1 && f.y0 >= 0 && f.y1 <= 1 && f.x1 - f.x0 > 0.05 && f.y1 - f.y0 > 0.05);
  assert.equal(heroHeightOf('assets/ui/keyart/hero-1800.avif?v=3'), 1800);
  assert.equal(heroHeightOf('assets/ui/keyart/hero.svg'), 0);
});

test('background plate: 1600 up to ~1440 device px wide screens, else 3200; both formats ship, 16:9', () => {
  assert.equal(skyWidth(1280, 720, 1), 1600);
  assert.equal(skyWidth(1440, 810, 1), 1600);
  assert.equal(skyWidth(1920, 1080, 1), 3200);
  assert.equal(skyWidth(412, 915, 2.625), 3200, 'portrait phone: cover scales by the height');
  assert.equal(skyWidth(915, 412, 2.625), 3200);
  assert.equal(skyWidth(800, 450, 1), 1600);
  for (const w of SKY_WIDTHS) {
    for (const fmt of ['webp', 'avif']) {
      const p = join(ROOT, skyUrl(w, fmt));
      assert.ok(existsSync(p), `${skyUrl(w, fmt)} exists`);
      assert.deepEqual(imageSize(readFileSync(p)), [w, w * 9 / 16], `${skyUrl(w, fmt)} is 16:9`);
      assert.ok(statSync(p).size < 400 * 1024, `${skyUrl(w, fmt)} stays small`);
    }
  }
});
