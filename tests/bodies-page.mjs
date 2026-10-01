/**
 * Page-side helpers for the bodies browser tests (imported inside page.evaluate as '/tests/bodies-page.mjs').
 * Frame strips are composed in the page (2D canvas over the WebGL canvas right after a render) and returned as a JPEG
 * data URL, so the node side needs no image library.
 */

/** Open ground spot: every cell within R m has terrain `code` (3 = snow), no blocker, no raised surface, no bridge. */
export function openSpot(W, cx, cz, R = 7, code = 3) {
  const g = W.grid; let best = null, bd = 1e9;
  const r = Math.ceil(R / g.cell);
  for (let j = r; j < g.rows - r; j += 4) {
    for (let i = r; i < g.cols - r; i += 4) {
      const x = (i + 0.5) * g.cell, z = (j + 0.5) * g.cell, d = Math.hypot(x - cx, z - cz);
      if (d >= bd) continue;
      let ok = true;
      for (let dj = -r; dj <= r && ok; dj += 2) for (let di = -r; di <= r && ok; di += 2) { const k = g.idx(i + di, j + dj); if (g.terrain[k] !== code || g.block[k] || g.elev[k] > 0 || g.bridge[k]) ok = false; }
      if (ok) { best = { x, z }; bd = d; }
    }
  }
  return best;
}

/** Move every unit within r of (x, z) out of the way (commandos north, enemies east); freeze the enemies' brains. */
export function clearArea(W, x, z, r = 20) {
  for (const c of W.commandos) if (Math.hypot(c.x - x, c.z - z) < r) c.setPosition(Math.min(W.width - 2, c.x + r * 0.7), Math.min(W.depth - 2, c.z + r));
  for (const e of W.enemies) if (Math.hypot(e.x - x, e.z - z) < r) e.setPosition(Math.min(W.width - 2, e.x + r * 1.5), e.z);
}

/** Stop a guard from walking off (test staging only). */
export function freeze(e) { if (e.brain) { e.brain.update = () => {}; e.brain.frozen = true; } e.stop?.(); }

/** Tiled frame strip grabbed from the GL canvas (centre crop). */
export class Strip {
  constructor(G, { cols = 3, rows = 2, tileW = 420, tileH = 280, cropW = 640, cropH = 427 } = {}) {
    Object.assign(this, { G, cols, rows, tileW, tileH, cropW, cropH, n: 0 });
    this.cv = document.createElement('canvas'); this.cv.width = cols * tileW; this.cv.height = rows * tileH;
    this.ctx = this.cv.getContext('2d');
  }
  /** Render now and copy the centre crop into the next tile (label in the corner). */
  grab(label = '') {
    this.G.render(0, 1);
    const src = this.G.renderer.renderer.domElement, W = src.width, H = src.height;
    const k = W / (src.clientWidth || W), cw = this.cropW * k, ch = this.cropH * k;
    const x = (this.n % this.cols) * this.tileW, y = Math.floor(this.n / this.cols) * this.tileH;
    this.ctx.drawImage(src, (W - cw) / 2, (H - ch) / 2, cw, ch, x, y, this.tileW, this.tileH);
    if (label) { this.ctx.font = '600 15px sans-serif'; this.ctx.fillStyle = 'rgba(0,0,0,0.55)'; this.ctx.fillRect(x + 6, y + 6, this.ctx.measureText(label).width + 12, 22); this.ctx.fillStyle = '#fff'; this.ctx.fillText(label, x + 12, y + 22); }
    this.n++;
  }
  jpeg(q = 0.84) { return this.cv.toDataURL('image/jpeg', q); }
}

/** Advance the sim n ticks, rendering every `every`-th one (keeps the real models animating). */
export function run(g, G, n, every = 2, each = null) {
  for (let i = 1; i <= n; i++) { g.advance(1 / 60); if (i % every === 0) G.render(1 / 60, 1); each?.(i); }
}

/** p95 of a list. */
export const p95 = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * 0.95))] : 0; };
