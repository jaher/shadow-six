/**
 * Grey stylised Europe map with the mission target circled in red (briefing slideshow, design-spec §6.6).
 * Coastlines from Natural Earth 1:50m (europe-coast.js), drawn in the period briefing-map style.
 * @module ui/europe
 */

import { COAST } from './europe-coast.js';

/** Land rings as [[lon, lat], …] (Natural Earth 1:50m, public domain; tools/ui/build_coast.mjs). */
const LAND = COAST.map((r) => {
  const out = [];
  for (let i = 0; i < r.length; i += 2) out.push([r[i], r[i + 1]]);
  return out;
});

export const VIEW = { lon0: -12, lon1: 36, lat0: 26, lat1: 72 };

const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** (lon, lat) → [x, y] in a w×h map of `view` (Mercator, as the briefing map). */
export function project(lon, lat, w, h, view = VIEW) {
  const y0 = merc(view.lat0), y1 = merc(view.lat1);
  return [((lon - view.lon0) / (view.lon1 - view.lon0)) * w, h - ((merc(lat) - y0) / (y1 - y0)) * h];
}

/**
 * The same map as inline SVG (docs/menus-art-direction.md S06b / S15: cream sea #efe9d7, land #605a53, thin borders),
 * vector so it stays crisp at any scale. Returns markup for a viewBox of 0 0 w h.
 */
export function europeSVG(w = 1000, h = 1000, view = VIEW) {
  const pt = (lon, lat) => project(lon, lat, w, h, view).map((v) => v.toFixed(1)).join(' ');
  let g = '';
  for (let lon = -10; lon <= 35; lon += 5) g += `M${pt(lon, view.lat0)} L${pt(lon, view.lat1)} `;
  for (let lat = 30; lat <= 70; lat += 5) g += `M${pt(view.lon0, lat)} L${pt(view.lon1, lat)} `;
  const land = LAND.map((poly) => `M${poly.map(([lo, la]) => pt(lo, la)).join(' L')} Z`).join(' ');
  return `<rect width="${w}" height="${h}" fill="#efe9d7"/>`
    + `<path d="${g}" stroke="#b9b2a0" stroke-width="1" fill="none" vector-effect="non-scaling-stroke" opacity=".6"/>`
    + `<path d="${land}" fill="#605a53" stroke="#2f2b27" stroke-width="1.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
}

/**
 * Draw the map with the target at (lat, lon).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {{lat:number, lon:number}} [target]
 */
export function drawEurope(ctx, w, h, target) {
  const px = (lon, lat) => project(lon, lat, w, h);
  ctx.fillStyle = '#efe9d7'; // S15 [orig, exact]: cream sea
  ctx.fillRect(0, 0, w, h);
  // graticule
  ctx.strokeStyle = 'rgba(120,110,90,0.3)';
  ctx.lineWidth = 1;
  for (let lon = -10; lon <= 35; lon += 10) {
    ctx.beginPath();
    ctx.moveTo(...px(lon, VIEW.lat0));
    ctx.lineTo(...px(lon, VIEW.lat1));
    ctx.stroke();
  }
  for (let lat = 30; lat <= 70; lat += 10) {
    ctx.beginPath();
    ctx.moveTo(...px(VIEW.lon0, lat));
    ctx.lineTo(...px(VIEW.lon1, lat));
    ctx.stroke();
  }
  ctx.fillStyle = '#605a53'; // land [orig, exact]
  ctx.strokeStyle = '#2f2b27';
  for (const poly of LAND) {
    ctx.beginPath();
    poly.forEach(([lon, lat], i) => ctx[i ? 'lineTo' : 'moveTo'](...px(lon, lat)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  if (target && Number.isFinite(target.lat)) {
    const [x, y] = px(target.lon, target.lat);
    ctx.strokeStyle = '#c21414';
    ctx.lineWidth = Math.max(2, w / 160);
    ctx.beginPath();
    ctx.ellipse(x, y, w / 22, w / 26, -0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#c21414';
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2, w / 150), 0, Math.PI * 2);
    ctx.fill();
  }
}
