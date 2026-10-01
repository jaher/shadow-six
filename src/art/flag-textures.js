/**
 * Flag cloth textures (canvas 2D, no three.js). Two layouts (art/insignia.js):
 *  - 'historical': the German national flag 1935–45 (Reichsflaggengesetz 15 Sep 1935): red field, 3:5; white disc
 *    3/4 of the height, its centre set 1/20 of the length toward the hoist; black swastika standing on a point (45°),
 *    arms of one uniform width. Enemy flagpoles only — user decision 2026-09-30.
 *  - 'neutral': the field-grey banner with a black-and-white Balkenkreuz (the former stand-in).
 * Both are wool bunting: thread weave, dye mottling, storage creases, a linen heading with two grommets at the hoist,
 * stitched hems and appliqué seam, wind-frayed fly edge (alpha), and theater weathering (desert sun-bleach, snow damp
 * and frost, coast salt, urban soot). Hoist at canvas x = 0 (uv.x = 0 in art/flags.js).
 * @module art/flag-textures
 */

export const FLAG_W = 640, FLAG_H = 384; // 5:3
/** Disc centre (uv) and radii (uv units) of the historical layout — the back-face shader mirrors this region. */
export const DISC = Object.freeze({ u: 0.5 - 1 / 20, v: 0.5, ru: (0.375 * FLAG_H) / FLAG_W, rv: 0.375 });

const WEATHER = {
  temperate: { fade: 0.10, grime: 0.18, damp: 0, frost: 0, salt: 0, soot: 0 },
  calm: { fade: 0.10, grime: 0.18, damp: 0, frost: 0, salt: 0, soot: 0 },
  urban: { fade: 0.08, grime: 0.22, damp: 0, frost: 0, salt: 0, soot: 0.35 },
  coast: { fade: 0.22, grime: 0.14, damp: 0.15, frost: 0, salt: 0.5, soot: 0 },
  desert: { fade: 0.55, grime: 0.10, damp: 0, frost: 0, salt: 0, soot: 0, sand: 1 },
  snow: { fade: 0.05, grime: 0.12, damp: 0.55, frost: 0.8, salt: 0, soot: 0 },
  fjord: { fade: 0.08, grime: 0.12, damp: 0.6, frost: 0.6, salt: 0.3, soot: 0 },
};
export function flagWeather(theater) { return WEATHER[theater] || WEATHER.temperate; }

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); }

/** The swastika (卐 seen from the obverse, hoist left) as six rects in a centred frame, y down; span 2S, arm a. */
function swastika(g, cx, cy, S, a) {
  g.save();
  g.translate(cx, cy);
  g.rotate(Math.PI / 4);
  const h = a / 2;
  g.beginPath();
  g.rect(-h, -S, a, 2 * S); // vertical bar
  g.rect(-S, -h, 2 * S, a); // horizontal bar
  g.rect(-h, -S, S + h, a); // top arm turns toward +x
  g.rect(S - a, -h, a, S + h); // right arm turns down
  g.rect(-S, S - a, S + h, a); // bottom arm turns toward -x
  g.rect(-S, -S, a, S + h); // left arm turns up
  g.fill('nonzero');
  g.restore();
}

function balkenkreuz(g, W, H) {
  const cx = W / 2, cy = H / 2, L = H * 0.36, A = H * 0.075, E = H * 0.035;
  const cross = (half, arm, col) => { g.fillStyle = col; g.fillRect(cx - half, cy - arm, half * 2, arm * 2); g.fillRect(cx - arm, cy - half, arm * 2, half * 2); };
  cross(L + E, A + E, '#e9e6dc');
  cross(L, A, '#121212');
}

/** Dashed stitch line. */
function stitch(g, pts, col, closed = false) {
  g.save(); g.strokeStyle = col; g.lineWidth = 1.2; g.setLineDash([3, 2.5]);
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (closed) g.closePath(); g.stroke(); g.restore();
}

/**
 * Paint a flag into a 2D context of FLAG_W × FLAG_H.
 * @param {CanvasRenderingContext2D} g
 * @param {{mode?: 'historical'|'neutral', theater?: string}} [o]
 */
export function paintFlag(g, o = {}) {
  const W = FLAG_W, H = FLAG_H, hist = o.mode !== 'neutral', wx = flagWeather(o.theater);
  g.clearRect(0, 0, W, H);
  const heading = 16; // linen heading strip at the hoist
  if (hist) {
    g.fillStyle = '#b5141c'; g.fillRect(0, 0, W, H); // bunting red
    const cx = DISC.u * W, cy = H / 2, R = 0.375 * H;
    g.fillStyle = '#ebe7dc'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#151413'; swastika(g, cx, cy, R * 0.6, R * 0.6 * 2 * 0.19);
    stitch(g, Array.from({ length: 96 }, (_, i) => [cx + Math.cos(i / 96 * 6.2832) * (R - 3), cy + Math.sin(i / 96 * 6.2832) * (R - 3)]), 'rgba(150,140,120,0.55)', true);
  } else {
    g.fillStyle = '#5e6456'; g.fillRect(0, 0, W, H); // Feldgrau
    balkenkreuz(g, W, H);
  }
  // heading (hoist sleeve) with two brass grommets
  g.fillStyle = '#d8d1bf'; g.fillRect(0, 0, heading, H);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(heading, 0, 1.5, H);
  for (const y of [14, H - 14]) {
    g.fillStyle = '#8a6a32'; g.beginPath(); g.arc(heading / 2, y, 5.5, 0, 6.2832); g.fill();
    g.fillStyle = '#2a2418'; g.beginPath(); g.arc(heading / 2, y, 2.6, 0, 6.2832); g.fill();
  }
  // hems: top, bottom, fly — double stitch
  const hc = hist ? 'rgba(70,6,8,0.6)' : 'rgba(30,32,26,0.6)';
  for (const d of [5, 8]) {
    stitch(g, [[heading + 2, d], [W - d, d], [W - d, H - d], [heading + 2, H - d]], hc);
  }
  weatherPass(g, W, H, hist, wx, heading);
}

/** Pixel pass: weave, mottling, creases, fade toward the fly, theater weathering, frayed fly edge (alpha). */
function weatherPass(g, W, H, hist, wx, heading) {
  const img = g.getImageData(0, 0, W, H), px = img.data, rnd = rng(hist ? 1935 : 1234567);
  const fray = new Float32Array(H);
  for (let y = 0, f = 0; y < H; y++) { f = Math.max(0, Math.min(9, f + (rnd() - 0.5) * 3)); fray[y] = f + (rnd() < 0.04 ? 6 * rnd() : 0); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4, u = x / W, v = y / H;
    let r = px[k], gg = px[k + 1], b = px[k + 2];
    // plain weave: warp/weft alternate + thread-to-thread variation; slow dye mottling
    const weave = ((x + y) & 1 ? 4 : -4) + ((y % 3) === 0 ? -3 : 0) + (rnd() - 0.5) * 12;
    const mott = Math.sin(x * 0.019 + y * 0.011) * 4 + Math.sin(x * 0.051 - y * 0.037) * 3;
    // storage creases (folded in thirds lengthwise and once across)
    const crease = (Math.exp(-(((u - 1 / 3) * W) ** 2) / 6) + Math.exp(-(((u - 2 / 3) * W) ** 2) / 6) + Math.exp(-(((v - 0.5) * H) ** 2) / 5)) * 10;
    const n = weave + mott + crease;
    r += n; gg += n; b += n * 0.9;
    // sun fade toward the fly (UV bleaches the red dye first: toward a salmon-pink; black goes brown-grey)
    const fade = wx.fade * (0.45 + 0.55 * u) * (x > heading ? 1 : 0.3);
    r += (232 - r) * fade * 0.55; gg += (176 - gg) * fade * 0.6; b += (160 - b) * fade * 0.55;
    if (wx.sand) { const s = wx.sand * 0.12 * (0.4 + 0.6 * v); r += (196 - r) * s; gg += (170 - gg) * s; b += (128 - b) * s; }
    // grime: fly end and lower edge
    const grime = wx.grime * (Math.max(0, u - 0.55) / 0.45 * 0.7 + Math.max(0, v - 0.8) * 1.5);
    const soot = wx.soot * (0.3 + 0.7 * Math.max(0, u - 0.4)) * 0.35;
    const dark = 1 - Math.min(0.6, grime + soot);
    r *= dark; gg *= dark; b *= dark * 0.97;
    // damp: wet wool reads darker and more saturated, lower part (wicking)
    if (wx.damp) { const d = wx.damp * (0.35 + 0.65 * v) * 0.3; r *= 1 - d * 0.7; gg *= 1 - d; b *= 1 - d * 0.9; }
    // frost/salt: pale speckle crust along hems and fly
    const edge = Math.min(y, H - 1 - y, W - 1 - x);
    const crust = (wx.frost * 0.55 + wx.salt * 0.35) * Math.max(0, 1 - edge / 18) * (rnd() < 0.5 ? 1 : 0.3);
    if (crust > 0) { r += (236 - r) * crust; gg += (240 - gg) * crust; b += (244 - b) * crust; }
    px[k] = r; px[k + 1] = gg; px[k + 2] = b;
    // wind-frayed fly edge: loose threads (alpha cut)
    if (W - 1 - x < fray[y]) px[k + 3] = (W - 1 - x) < fray[y] * 0.5 || ((y + x) & 1) ? 0 : 255;
  }
  g.putImageData(img, 0, 0);
}
