// The title splash's plate transform on every form factor (src/ui/splash-plate.js; user, on a foldable phone: "the
// first in the intro screen is shifted away from the tank", and "I dont see the bombs on the phone but I do on the
// computer. The coordinates should adjust to form factor"): the plate is cover-fitted exactly as CSS fits
// `.bt-l.sky`, its crop slides so the burning deck stands clear of the hero, and the fire, the tank and the bomb line
// all map through that one transform.
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { PLATE_ASPECT, PLATE_FOCUS, DECK, TANK_BOX, TANK_POLY, HORIZON_V, plateRect, plateToStage, stageToPlate, plateUniform, plateFocusX, heroLayout } from '../../src/ui/splash-plate.js';
import { HERO_ROWS } from '../../src/ui/hero-art.js';
import { FIRE } from '../../src/ui/splash-fx.js';
import { openSpans } from '../../src/ui/splash-planes.js';

/** Stages (CSS px): foldables folded and unfolded, phones both ways, a tablet, 1:1, 21:9, 9:21, desktops. */
const STAGES = [[884, 1104], [1104, 884], [344, 882], [841, 701], [701, 841], [390, 844], [360, 800], [844, 390], [412, 915],
  [915, 412], [820, 1180], [1180, 820], [900, 900], [2520, 1080], [412, 961], [1080, 2520], [1280, 720], [1920, 1080], [3840, 2160], [1366, 1024]];

/** CSS object-fit: cover + object-position, independently: an image iw x ih in a box (bx, by, bw, bh). */
function cssCover(iw, ih, bx, by, bw, bh, [px, py]) {
  const k = Math.max(bw / iw, bh / ih), w = iw * k, h = ih * k;
  return { x: bx + (bw - w) * px, y: by + (bh - h) * py, w, h };
}

test('splash plate: the transform is CSS object-fit cover of the 16:9 plate in the 106 % box, for any focus', () => {
  for (const [W, H] of STAGES) {
    for (const f of [PLATE_FOCUS, [0.6, 0.5], [0.75, 0.5]]) {
      const r = plateRect(W, H, f), c = cssCover(3200, 1800, -0.03 * W, -0.03 * H, 1.06 * W, 1.06 * H, f);
      for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(r[k] - c[k]) < 1e-6, `${W}x${H} focus ${f}: ${k} ${r[k]} vs ${c[k]}`);
      assert.ok(Math.abs(r.w / r.h - PLATE_ASPECT) < 1e-9, 'keeps the plate aspect');
      assert.ok(r.x <= 1e-6 && r.y <= 1e-6 && r.x + r.w >= W - 1e-6 && r.y + r.h >= H - 1e-6, `${W}x${H}: the plate covers the stage`);
    }
  }
});

test('splash plate: plate <-> stage round trip, and the fx uniform turns stage uv into plate uv', () => {
  for (const [W, H] of STAGES) {
    const r = plateRect(W, H, [plateFocusX(W, H), 0.5]), [ox, oy, sx, sy] = plateUniform(W, H, r);
    for (const [u, v] of [[0, 0], [1, 1], DECK, [0.3, 0.8]]) {
      const [x, y] = plateToStage(u, v, W, H, r), [u2, v2] = stageToPlate(x, y, W, H, r);
      assert.ok(Math.abs(u - u2) < 1e-9 && Math.abs(v - v2) < 1e-9, `${W}x${H}: round trip ${u},${v}`);
      const uvx = x / W, uvy = 1 - y / H;                       // the shader's stage uv (y from the bottom)
      assert.ok(Math.abs((uvx - ox) / sx - u) < 1e-9 && Math.abs((uvy - oy) / sy - (1 - v)) < 1e-9, `${W}x${H}: shader mapping ${u},${v}`);
    }
  }
});

test('splash plate: the fire burns on the tank — its sources lie in TANK_BOX, the deck is the first source', () => {
  const [u0, v0, u1, v1] = TANK_BOX;
  for (const [x, y] of FIRE.src.slice(0, 3)) {          // deck, turret, driver (the fourth burns under the hull)
    const u = (x + 0.03) / 1.06, v = 1 - (y + 0.03) / 1.06;
    assert.ok(u > u0 && u < u1 && v > v0 && v < v1, `fire source ${x},${y} -> plate ${u.toFixed(3)},${v.toFixed(3)} inside the tank`);
  }
  assert.ok(Math.abs(DECK[0] - (FIRE.src[0][0] + 0.03) / 1.06) < 1e-9 && Math.abs(DECK[1] - (1 - (FIRE.src[0][1] + 0.03) / 1.06)) < 1e-9, 'DECK = FIRE.src[0]');
  for (const [u, v] of TANK_POLY) assert.ok(u >= u0 - 1e-9 && u <= u1 + 1e-9 && v >= v0 - 1e-9 && v <= v1 + 1e-9, `tank outline point ${u},${v} in its box`);
  assert.ok(HORIZON_V > v0 && HORIZON_V < v1, 'the far field line crosses the tank (the bursts behind it are clipped by it)');
});

test('splash plate: on every stage the burning deck is on screen and, where the plate is cropped, clear of the hero', () => {
  for (const [W, H] of STAGES) {
    const hero = heroLayout(W, H), p = plateFocusX(W, H, hero), r = plateRect(W, H, [p, 0.5]);
    const [x, y] = plateToStage(DECK[0], DECK[1], W, H, r);
    assert.ok(p >= 0.5 && p <= 0.75, `${W}x${H}: focus ${p}`);
    assert.ok(x > 0 && x < W && y > 0 && y < H, `${W}x${H}: the deck (${x.toFixed(0)}, ${y.toFixed(0)}) is on screen`);
    const cropped = r.w > 1.06 * W + 1;
    const row = HERO_ROWS[Math.floor(((y - hero.y) / hero.h) * HERO_ROWS.length)];
    if (cropped && row) assert.ok(x >= hero.x + row[1] * hero.w - 1, `${W}x${H}: the deck (x ${x.toFixed(0)}) clears the hero (right edge ${(hero.x + row[1] * hero.w).toFixed(0)})`);
    if (!cropped) assert.equal(p, 0.5, `${W}x${H}: no slide when the plate is not cropped sideways`);
  }
});

test('splash plate: the hero layout is styles/menus.css .bt-l.hero, and the plate CSS reads --plate-x', () => {
  const css = readFileSync(new URL('../../styles/menus.css', import.meta.url), 'utf8');
  assert.match(css, /\.bt-l \{ position: absolute; inset: -3%; width: 106%; height: 106%; object-fit: cover;/, '.bt-l: the 106 % box, cover');
  assert.match(css, /\.bt-l\.sky \{ object-position: calc\(var\(--plate-x, 0\.5\) \* 100%\) 50%;/, '.bt-l.sky: x from --plate-x, y centred');
  assert.match(css, /\.bt-l\.hero \{ left: 50%;[^}]*bottom: -12%;[^}]*height: 100%; max-width: 92vw; object-fit: contain; object-position: 50% 100%;/, '.bt-l.hero as heroLayout assumes');
  const h = heroLayout(390, 844);
  assert.ok(Math.abs(h.w - 358.8) < 0.1 && Math.abs(h.y + h.h - 1.12 * 844) < 1e-9 && Math.abs(h.x + h.w / 2 - 195) < 1e-9, 'phone portrait: 92vw wide, centred, feet 12 % below');
  assert.equal(HERO_ROWS.length, 24, 'silhouette rows');
  for (const r of HERO_ROWS) if (r) assert.ok(r[0] >= 0 && r[0] < r[1] && r[1] <= 1, `row ${r}`);
});

test('splash planes: open stretches of the bomb line', () => {
  assert.deepEqual(openSpans(0, 100, []), [[0, 100]]);
  assert.deepEqual(openSpans(0, 100, [[20, 40]]), [[0, 20], [40, 100]]);
  assert.deepEqual(openSpans(0, 100, [[-10, 30], [60, 200]]), [[30, 60]]);
  assert.deepEqual(openSpans(0, 100, [[-10, 200]]), []);
});
