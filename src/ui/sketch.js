/**
 * Hand-drawn ink sketch of a mission for the notebook minimap (design-spec §6.4), generated from mission data:
 * buildings as rectangles, rocks/trees as circles, walls as double lines, wire as XXXX, water as hatching,
 * roads as double lines. Pure canvas drawing (no game state) so it can be cached per mission.
 * @module ui/sketch
 */

const INK = 'rgba(38,34,26,0.85)';
const FAINT = 'rgba(38,34,26,0.45)';
const WATER = 'rgba(40,62,96,0.55)';
const BUILDINGS = new Set(['house', 'barracks', 'hut', 'bunker', 'garrison', 'jail', 'prison', 'tower', 'shed', 'hangar', 'church', 'villa', 'station', 'warehouse']);
const ROUND = new Set(['rocks', 'rock', 'tree', 'pine', 'bush', 'fueltank', 'fuel_tank', 'barrels', 'crates']);
const DEFAULT_SIZE = { house: [8, 6], barracks: [10, 6], hut: [4, 4], bunker: [6, 5], fueltank: [3, 3], rocks: [3, 3], tree: [3, 3], pine: [2.5, 2.5], bush: [1.6, 1.6], barrels: [1.4, 1.4], crates: [1.4, 1.4] };

/** Small deterministic jitter so lines look hand drawn. */
function jit(seed) {
  let s = seed | 0 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s / 2147483647 - 0.5) * 0.9;
  };
}

function polyline(ctx, pts, map, j, offset = 0) {
  ctx.beginPath();
  pts.forEach(([x, z], i) => {
    const [px, py] = map(x, z);
    ctx[i ? 'lineTo' : 'moveTo'](px + j() + offset, py + j() + offset);
  });
  ctx.stroke();
}

/** Parallel double line along a path (walls, roads). */
function doubleLine(ctx, pts, map, gap, j) {
  for (const s of [-gap / 2, gap / 2]) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      const [px, py] = map(pts[i][0], pts[i][1]);
      const nx = (-dz / L) * s, ny = (dx / L) * s;
      ctx[i ? 'lineTo' : 'moveTo'](px + nx + j() * 0.4, py + ny + j() * 0.4);
    }
    ctx.stroke();
  }
}

/** Hatching clipped to a thick path (water). */
function hatchPath(ctx, pts, map, widthPx, size) {
  ctx.save();
  const wAt = (i) => (Array.isArray(widthPx) ? widthPx[i] : widthPx); // per-point widths (natural banks)
  ctx.lineWidth = Array.isArray(widthPx) ? widthPx.reduce((a, b) => a + b, 0) / widthPx.length : widthPx;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(40,62,96,0.12)';
  polyline(ctx, pts, map, () => 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  // clip region: expand the path into a polygon ribbon
  const ribbon = [];
  const back = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    const [px, py] = map(pts[i][0], pts[i][1]);
    const nx = (-dz / L) * wAt(i) / 2, ny = (dx / L) * wAt(i) / 2;
    ribbon.push([px + nx, py + ny]);
    back.unshift([px - nx, py - ny]);
  }
  [...ribbon, ...back].forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y));
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = WATER;
  ctx.lineWidth = 1;
  for (let k = -size[1]; k < size[0] + size[1]; k += 4) {
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k + size[1], size[1]);
    ctx.stroke();
  }
  ctx.restore();
}

function wire(ctx, pts, map, stepPx) {
  ctx.save();
  ctx.fillStyle = INK;
  ctx.font = `${Math.max(6, stepPx)}px Oswald, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = map(...pts[i - 1]), [bx, by] = map(...pts[i]);
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / stepPx));
    for (let k = 0; k <= n; k++) ctx.fillText('x', ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
  }
  ctx.restore();
}

/**
 * Draw the whole mission sketch into ctx over [0,w]×[0,h] canvas px.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} def normalized mission def
 * @param {number} w
 * @param {number} h
 */
export function drawSketch(ctx, def, w, h) {
  const [W, D] = def?.size || [60, 60];
  const sx = w / W, sz = h / D;
  const map = (x, z) => [x * sx, z * sz];
  const j = jit(def?.seed || 7);
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  for (const t of def?.terrain || []) {
    if (t.type === 'path' && (t.terrain === 'shallow' || t.terrain === 'water')) hatchPath(ctx, t.points, map, t.widths ? t.widths.map((v) => v * sx) : (t.width || 4) * sx, [w, h]);
    else if (t.type === 'path' && t.terrain === 'road') {
      ctx.strokeStyle = FAINT;
      doubleLine(ctx, t.points, map, Math.max(2, (t.width || 3) * sx), j);
      ctx.strokeStyle = INK;
    } else if (t.type === 'rect' && (t.terrain === 'water' || t.terrain === 'shallow')) {
      hatchPath(ctx, [[t.x, t.z + t.d / 2], [t.x + t.w, t.z + t.d / 2]], map, t.d * sz, [w, h]);
    }
  }
  for (const s of def?.structures || []) {
    const type = s.type;
    if (type === 'river' || type === 'lake' || type === 'water') {
      if (s.points) hatchPath(ctx, s.points, map, (s.width || 5) * sx, [w, h]);
      continue;
    }
    if (s.points && (type === 'wall' || type === 'fence' || type === 'wire')) {
      if (type === 'wire') wire(ctx, s.points, map, 5);
      else if (type === 'fence') {
        ctx.setLineDash([2, 2]);
        polyline(ctx, s.points, map, j);
        ctx.setLineDash([]);
      } else doubleLine(ctx, s.points, map, 2.2, j);
      continue;
    }
    if (s.x == null) continue;
    const [dw, dd] = DEFAULT_SIZE[type] || [3, 3];
    const bw = (s.w || dw) * sx, bd = (s.d || dd) * sz;
    const [cx, cy] = map(s.x, s.z);
    if (BUILDINGS.has(type) || type === 'bridge') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-(s.rot || 0));
      ctx.strokeRect(-bw / 2 + j(), -bd / 2 + j(), bw, bd);
      if (type !== 'bridge') {
        ctx.beginPath(); // roof ridge
        ctx.moveTo(-bw / 2, 0);
        ctx.lineTo(bw / 2, 0);
        ctx.strokeStyle = FAINT;
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = INK;
    } else if (ROUND.has(type)) {
      ctx.beginPath();
      ctx.arc(cx + j(), cy + j(), Math.max(1.5, Math.min(bw, bd) / 2), 0, Math.PI * 2);
      ctx.stroke();
    } else if (type === 'sandbags') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-(s.rot || 0));
      ctx.beginPath();
      ctx.moveTo(-bw / 2, 0);
      ctx.quadraticCurveTo(0, -3, bw / 2, 0);
      ctx.stroke();
      ctx.restore();
    }
  }
}
