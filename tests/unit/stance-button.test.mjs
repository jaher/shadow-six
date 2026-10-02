/** Stance button (bottom HUD, left of the hand): which figure it shows and when it is disabled (stance-button.js). */
import { test, assert } from './lib.mjs';
import { fileURLToPath } from 'node:url';
import { stanceButtonState, canTakeStance, STANCE_TIP } from '../../src/ui/stance-button.js';
import { ICON_MANIFEST } from '../../src/ui/icon-manifest.js';
import { toolHTML } from '../../src/ui/icon-art.js';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const man = (o = {}) => ({ alive: true, stance: 'stand', state: 'idle', ...o });

test('stance button shows the posture a click switches TO: crawling figure while upright, standing while crawling', () => {
  assert.deepEqual(stanceButtonState([man()]), { to: 'crawl', icon: 'tool/stance.crawl', disabled: false });
  assert.deepEqual(stanceButtonState([man({ stance: 'crawl' })]), { to: 'stand', icon: 'tool/stance.stand', disabled: false });
  // group: everyone crawling -> stand; anyone upright -> crawl (same rule as HUD.togglePosture)
  assert.equal(stanceButtonState([man({ stance: 'crawl' }), man({ stance: 'crawl' })]).to, 'stand');
  assert.equal(stanceButtonState([man({ stance: 'crawl' }), man()]).to, 'crawl');
  assert.equal(stanceButtonState([man({ stance: 'crawl' }), man()]).disabled, false);
  // dead men in the list do not count
  assert.equal(stanceButtonState([man({ stance: 'crawl' }), man({ alive: false })]).to, 'stand');
  assert.match(STANCE_TIP, /LIE DOWN \/ STAND UP \(C \/ S\)/);
});

test('stance button is disabled with no selection or when nobody selected can change stance', () => {
  assert.equal(stanceButtonState([]).disabled, true);
  assert.equal(stanceButtonState(null).disabled, true);
  assert.equal(stanceButtonState([man()]).icon, 'tool/stance.crawl', 'empty-ish state still shows a figure');
  for (const o of [{ state: 'inVehicle' }, { vehicle: {} }, { hidden: true }, { buried: true }, { downed: true },
    { carrying: { kind: 'body' } }, { noCrawl: true }, { diving: true }, { currentAction: { interruptible: false } }, { state: 'jailed' }]) {
    assert.equal(stanceButtonState([man(o)]).disabled, true, JSON.stringify(o));
  }
  // a man carrying a body cannot lie down, but a crawler... is never carrying; standing up is fine for a downed-free crawler
  assert.equal(canTakeStance(man({ stance: 'crawl' }), 'stand'), true);
  assert.equal(canTakeStance(man({ carrying: { kind: 'interactable' } }), 'crawl'), false);
  // in water (Unit.setStance refuses crawl)
  const wet = man({ x: 1, z: 2, world: { groundAt: () => ({ water: true }) } });
  assert.equal(stanceButtonState([wet]).disabled, true);
  // one able man in a group keeps it enabled
  assert.equal(stanceButtonState([man({ state: 'inVehicle' }), man()]).disabled, false);
});

test('stance icons ship with every tool state in one shared box (no shift on toggle), larger than the old figurines', () => {
  for (const t of ['stance.crawl', 'stance.stand']) {
    const h = toolHTML(`tool/${t}`);
    for (const v of ['base', 'hover', 'pressed', 'active', 'disabled']) assert.ok(h.includes(`data-v="${v}"`), `${t} ${v}`);
  }
  const a = ICON_MANIFEST['tool/stance.crawl'].b, b = ICON_MANIFEST['tool/stance.stand'].b;
  assert.deepEqual(a, b, 'both stance renders share one box');
  assert.ok(a[0] >= 56 && a[1] >= 44, `box ${a} big enough to read and to tap at uiScale 1`);
  assert.equal(ICON_MANIFEST['tool/posture.prone'], undefined, 'old top-bar posture art is retired');
});

/** Minimal PNG reader (8-bit RGBA, non-interlaced, as post.py writes them) -> {w, h, alpha(x, y)}. */
function readPNG(path) {
  const b = readFileSync(path); let o = 8, w = 0, h = 0, ct = 0, bd = 0; const idat = [];
  while (o < b.length) {
    const n = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + n);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; }
    if (type === 'IDAT') idat.push(d);
    o += 12 + n;
  }
  assert.ok(bd === 8 && ct === 6, `${path}: 8-bit RGBA`);
  const raw = inflateSync(Buffer.concat(idat)), st = w * 4, px = Buffer.alloc(st * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (st + 1)], src = raw.subarray(y * (st + 1) + 1, (y + 1) * (st + 1));
    for (let x = 0; x < st; x++) {
      const a = x >= 4 ? px[y * st + x - 4] : 0, up = y ? px[(y - 1) * st + x] : 0, c = x >= 4 && y ? px[(y - 1) * st + x - 4] : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      const pr = f === 0 ? 0 : f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
      px[y * st + x] = (src[x] + pr) & 255;
    }
  }
  return { w, h, alpha: (x, y) => px[y * st + x * 4 + 3] };
}

test('stance icons are just the man (user: "Without the enclosing ellipse", "Just the man"): no plaque, frame or ground', () => {
  for (const t of ['crawl', 'stand']) {
    const im = readPNG(fileURLToPath(new URL(`../../assets/ui/icons/tool/stance.${t}@2x.png`, import.meta.url)));
    let cover = 0, edge = 0, x0 = im.w, x1 = -1, y0 = im.h, y1 = -1;
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
      const a = im.alpha(x, y);
      if (a > 128) { cover++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if ((x < 2 || y < 2 || x >= im.w - 2 || y >= im.h - 2) && a > 16) edge++;
    }
    // the brass plaque covered ~60 % of the box and touched its border on every side
    assert.equal(edge, 0, `${t}: transparent all round the box edge (no frame / plaque rim), ${edge} px`);
    assert.ok(cover / (im.w * im.h) < 0.3, `${t}: only the figure is opaque (${(100 * cover / (im.w * im.h)).toFixed(1)} % of the box)`);
    // big enough to read: the crawler spans the box width, the stander its height
    const span = t === 'crawl' ? (x1 - x0 + 1) / im.w : (y1 - y0 + 1) / im.h;
    assert.ok(span > 0.75, `${t}: figure fills the box ${t === 'crawl' ? 'width' : 'height'} (${span.toFixed(2)})`);
  }
});
