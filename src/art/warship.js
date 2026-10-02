/**
 * Placeholder-art pass (user: "extremely realistic and faithful"; the review found the M13 battleship still read as
 * stacked grey slabs): a detailed Bismarck-class battleship, modelled at real size (251 × 36 m) in ship metres and
 * scaled onto the mission footprint (bow at local +X, waterline y 0, main deck amidships at 0.5 × 9.9 m).
 *   - hull: lofted stations with flare, sheer and a raked Atlantic bow, the cruiser stern; a painted plating texture
 *     (strakes and butts, two rows of scuttles with eyebrows and rust runs, the dark boot topping, water staining),
 *     hawse pipes and anchors; teak main deck with steel waterways, breakwater, anchor cables, capstans, bollards,
 *     ventilators and guard rails with stanchions all round
 *   - main armament: four twin 38 cm turrets (Anton, Bruno forward, Caesar, Dora aft) with sloped faces, rear
 *     rangefinder ears, roof hoods, blast bags and tapered barrels on their barbettes (B and C superfiring)
 *   - six twin 15 cm turrets, eight twin 10.5 cm flak mounts with their shields, 3.7 cm twins on the platforms
 *   - superstructure tiers with their own painted texture (portholes, doors, seams), the armoured conning tower with
 *     its vision slits, bridge with glazing and wings, the foretop fire-control hood with rangefinder arms and the
 *     radar mattress, the raked funnel with its cap, searchlight platform and steam pipes, the hangar, the transverse
 *     catapult with an Arado 196 floatplane, boat cranes, motor launches, Carley floats, fore and main masts with
 *     yards, stays and aerials, the after fire-control station
 * Geometry is merged per material (art/dressing.js consolidate). Plain colours in node (unit tests).
 * @module art/warship
 */
import * as THREE from 'three';
import { dressingMaterial, boxUV, consolidate, rng } from './dressing.js';
import { paintedMaterial } from './kit-props.js';
import { windowGlass } from './kit-buildings.js';

const HAS_DOM = typeof document !== 'undefined';
/** Real ship: length, half beam, deck height amidships, the hull bottom drawn (m, waterline 0). */
export const SHIP_REAL = { L: 251, B: 18, deck: 9.9, keel: -3 };
const HL = SHIP_REAL.L / 2;

// ------------------------------------------------------------------------------------------ painted textures

const TEX = {};
/** Hull-side plating canvas: u = 24 m along the hull, v = 18 m from y −3 to 15. */
function hullTexture() {
  if (TEX.hull || !HAS_DOM) return TEX.hull || null;
  const W = 1024, H = 768, U = 24, V = 18, ppm = W / U, R = rng(9137);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const row = (h) => H - ((h + 3) / V) * H;                     // ship height → canvas row
  x.fillStyle = '#5c6064'; x.fillRect(0, 0, W, H);
  // grey plating above the boot topping, strake by strake with butts staggered
  const strakes = [1.9, 3.3, 5.3, 7.4, 9.9, 12.4, 15.2];
  for (let k = 0; k + 1 < strakes.length; k++) {
    const y0 = row(strakes[k + 1]), y1 = row(strakes[k]), off = (k % 2) * 3;
    for (let u = -off; u < U; u += 6) {
      const l = 50 + R() * 3 - 1.5;
      x.fillStyle = `hsl(205, 5%, ${l * 0.86}%)`;
      x.fillRect(u * ppm, y0, 6 * ppm, y1 - y0);
      x.fillStyle = 'rgba(30,32,34,0.35)'; x.fillRect(u * ppm, y0, 1.5, y1 - y0);              // butt seam
    }
    x.fillStyle = 'rgba(28,30,32,0.45)'; x.fillRect(0, y0, W, 1.5);                           // strake seam
    x.fillStyle = 'rgba(200,205,210,0.18)'; x.fillRect(0, y0 + 2, W, 1);
  }
  // boot topping (clear of the swell: a band above the water, its foot well under it) and the stain above it
  x.fillStyle = '#26282a'; x.fillRect(0, row(1.9), W, row(-3) - row(1.9));                  // boot topping
  const st = x.createLinearGradient(0, row(3.3), 0, row(1.9));
  st.addColorStop(0, 'rgba(70,72,60,0)'); st.addColorStop(1, 'rgba(58,60,48,0.3)');
  x.fillStyle = st; x.fillRect(0, row(3.3), W, row(1.9) - row(3.3));
  // weathering: faint vertical grime runs
  for (let k = 0; k < 120; k++) {
    const u = R() * W, t = row(9.8 - R() * 2), len = (1 + R() * 5) * ppm;
    const g = x.createLinearGradient(0, t, 0, t + len);
    g.addColorStop(0, `rgba(40,38,34,${0.08 + R() * 0.1})`); g.addColorStop(1, 'rgba(40,38,34,0)');
    x.fillStyle = g; x.fillRect(u, t, 1 + R() * 3, len);
  }
  // two rows of scuttles with eyebrows, rust runs under some
  const rx = 0.2 * ppm, ry = 0.2 * ppm * 0.88;
  for (const [h, gap] of [[6.4, 2.4], [8.3, 2.4]]) {
    for (let u = 0.8 + (h > 7 ? 1.2 : 0); u < U; u += gap) {
      if (R() < 0.12) continue;
      const cx = u * ppm, cy = row(h);
      if (R() < 0.35) {
        const g = x.createLinearGradient(0, cy, 0, cy + (1.2 + R() * 2.2) * ppm);
        g.addColorStop(0, 'rgba(110,60,30,0.45)'); g.addColorStop(1, 'rgba(110,60,30,0)');
        x.fillStyle = g; x.fillRect(cx - rx * 0.5, cy, rx * (0.6 + R() * 0.6), (1.2 + R() * 2.2) * ppm);
      }
      x.fillStyle = '#a3a8ac'; x.beginPath(); x.ellipse(cx, cy, rx * 1.35, ry * 1.35, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#16191c'; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(160,180,190,0.35)'; x.beginPath(); x.ellipse(cx - rx * 0.3, cy - ry * 0.3, rx * 0.35, ry * 0.3, 0, 0, Math.PI * 2); x.fill();
      x.strokeStyle = 'rgba(25,27,29,0.8)'; x.lineWidth = 2; x.beginPath(); x.ellipse(cx, cy, rx * 1.9, ry * 1.9, 0, Math.PI * 1.15, Math.PI * 1.85); x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 8;
  return (TEX.hull = t);
}

/** Superstructure canvas: u = 12 m, v = 13 m (five 2.6 m tiers from the main deck): seams, scuttles, doors. */
function wallTexture() {
  if (TEX.wall || !HAS_DOM) return TEX.wall || null;
  const W = 1024, H = 1024, U = 12, V = 13, ppm = W / U, R = rng(5521);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#8b9095'; x.fillRect(0, 0, W, H);
  for (let t = 0; t < 5; t++) {
    const top = H - ((t + 1) * 2.6 / V) * H, bot = H - (t * 2.6 / V) * H;
    for (let u = (t % 2) * 1.2; u < U; u += 2.4) {
      x.fillStyle = `hsl(208, 5%, ${55 + R() * 5}%)`; x.fillRect(u * ppm + 1, top + 1, 2.4 * ppm - 2, bot - top - 2);
    }
    x.fillStyle = 'rgba(40,42,45,0.7)'; x.fillRect(0, top, W, 2);                              // deck line
    x.fillStyle = 'rgba(30,30,30,0.22)'; x.fillRect(0, top + 2, W, 5);                           // shadow under the deck edge
    for (let u = 0.9 + R(); u < U; u += 1.7 + R() * 0.8) {
      if (R() < 0.18) { // watertight door with dogs and a frame
        const dx = u * ppm, dw = 0.8 * ppm, dh = 1.8 * ppm;
        x.fillStyle = '#6c7176'; x.fillRect(dx - 3, bot - dh - 3, dw + 6, dh + 3);
        x.fillStyle = '#7e8388'; x.fillRect(dx, bot - dh, dw, dh);
        x.fillStyle = '#3c4044'; for (const f of [0.2, 0.5, 0.8]) x.fillRect(dx + dw - 6, bot - dh * f, 5, 3);
        u += 0.8; continue;
      }
      const cx = u * ppm, cy = bot - 1.55 * ppm, r = 0.16 * ppm;
      x.fillStyle = '#b0b5b9'; x.beginPath(); x.arc(cx, cy, r * 1.35, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#15181b'; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
      if (R() < 0.3) { const g = x.createLinearGradient(0, cy, 0, cy + 1.2 * ppm); g.addColorStop(0, 'rgba(105,62,32,0.35)'); g.addColorStop(1, 'rgba(105,62,32,0)'); x.fillStyle = g; x.fillRect(cx - 2, cy + r, 4, 1.2 * ppm); }
    }
  }
  for (let k = 0; k < 60; k++) { const u = R() * W, t = R() * H; x.fillStyle = `rgba(45,42,38,${0.05 + R() * 0.08})`; x.fillRect(u, t, 1 + R() * 2, (0.5 + R() * 2) * ppm); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return (TEX.wall = t);
}

let MATS = null;
function materials() {
  if (MATS) return MATS;
  const hullT = hullTexture(), wallT = wallTexture();
  const hull = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.15, name: 'kit:warship_hull' });
  // (no bump map: its screen-space derivatives blow up on the grazing hull in the water's mirror pass and draw a black
  // dashed fringe along the waterline; seams and scuttles are painted in the colour map)
  if (hullT) hull.map = hullT; else hull.color.set(0x6d7276);
  const wall = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.15, name: 'kit:warship_wall' });
  if (wallT) wall.map = wallT; else wall.color.set(0x8e9398);
  MATS = {
    hull, wall,
    grey: paintedMaterial('steel', 0x8e9398), greyDk: paintedMaterial('steel', 0x6c7176), roof: paintedMaterial('steel', 0x55595d),
    deckSteel: paintedMaterial('steel', 0x5d6062), teak: paintedMaterial('planks', 0xc0a27c), black: paintedMaterial('steel', 0x1e1f20),
    gun: paintedMaterial('steel', 0x80858a), bag: paintedMaterial('canvas', 0x4a4a42), iron: dressingMaterial('castIron'),
    glass: windowGlass(), float: paintedMaterial('canvas', 0xc8c2ae), boat: paintedMaterial('steel', 0xb9bab4),
    plane: paintedMaterial('steel', 0x66705e), planeDk: paintedMaterial('steel', 0x4b5446), lens: paintedMaterial('steel', 0xd8d4c4, { emissive: new THREE.Color(0x3a382e) }),
  };
  return MATS;
}

// ------------------------------------------------------------------------------------------ mesh helpers

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
/** Box centred at (x, y, z), yaw ry, world-scale UVs. */
function box(g, mat, w, h, d, x, y, z, ry = 0, tile = 2) {
  const m = mesh(boxUV(new THREE.BoxGeometry(w, h, d).toNonIndexed(), tile), mat);
  m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m;
}
/** Cylinder: axis 'y' (base at y), 'x' or 'z' (centred); scale z for ellipses. */
function cyl(g, mat, r0, r1, h, x, y, z, axis = 'y', seg = 16, ez = 1, tile = 2) {
  const geo = new THREE.CylinderGeometry(r0, r1, h, seg);
  const uv = geo.attributes.uv, k = (2 * Math.PI * Math.max(r0, r1)) / tile;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * (h / tile));
  if (axis === 'y') geo.translate(0, h / 2, 0);
  else if (axis === 'x') geo.rotateZ(-Math.PI / 2);
  else geo.rotateX(Math.PI / 2);
  if (ez !== 1) geo.scale(1, 1, ez);
  const m = mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m;
}
/** Box-section strut a → b. */
function strut(g, mat, a, b, t, t2 = t) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
  const m = mesh(boxUV(new THREE.BoxGeometry(t, L, t2).toNonIndexed(), 1), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.add(m); return m;
}
function wire(g, mat, a, b, r = 0.04) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
  const m = mesh(new THREE.CylinderGeometry(r, r, L, 4, 1, true), mat, false);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.add(m); return m;
}

/** Triangle soup builder with per-triangle orientation (flips a triangle whose normal opposes `want`). */
class Soup {
  constructor() { this.p = []; this.uv = []; }
  tri(a, b, c, ua, ub, uc, want) {
    if (want) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * want[0] + ny * want[1] + nz * want[2] < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; }
    }
    this.p.push(...a, ...b, ...c); this.uv.push(...ua, ...ub, ...uc);
  }
  quad(a, b, c, d, ua, ub, uc, ud, want) { this.tri(a, b, c, ua, ub, uc, want); this.tri(a, c, d, ua, uc, ud, want); }
  mesh(mat, shadow = true) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.computeVertexNormals();
    return mesh(geo, mat, shadow);
  }
}

/**
 * Loft between a bottom outline at y0 and a top outline at y1 (same vertex count, plan [x, z], CCW or CW):
 * walls (u = perimeter metres / uS, v = (y − vRef) / vS) and a flat top cap.
 */
function loft(g, wallMat, topMat, bot, y0, top, y1, { uS = 12, vS = 13, vRef = SHIP_REAL.deck, capS = 3, cap = true, cx = null, cz = null } = {}) {
  const n = bot.length, S = new Soup();
  const mx = cx ?? bot.reduce((s, p) => s + p[0], 0) / n, mz = cz ?? bot.reduce((s, p) => s + p[1], 0) / n;
  let per = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = bot[i], b = bot[j], A = top[i], B = top[j];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ox = (a[0] + b[0]) / 2 - mx, oz = (a[1] + b[1]) / 2 - mz;
    const u0 = per / uS, u1 = (per + len) / uS; per += len;
    S.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [B[0], y1, B[1]], [A[0], y1, A[1]],
      [u0, (y0 - vRef) / vS], [u1, (y0 - vRef) / vS], [u1, (y1 - vRef) / vS], [u0, (y1 - vRef) / vS], [ox, 0, oz]);
  }
  g.add(S.mesh(wallMat));
  if (cap) {
    const T = new Soup(), idx = THREE.ShapeUtils.triangulateShape(top.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [i, j, k] of idx) T.tri([top[i][0], y1, top[i][1]], [top[j][0], y1, top[j][1]], [top[k][0], y1, top[k][1]],
      [top[i][0] / capS, top[i][1] / capS], [top[j][0] / capS, top[j][1] / capS], [top[k][0] / capS, top[k][1] / capS], [0, 1, 0]);
    g.add(T.mesh(topMat));
  }
}
/** Rounded / chamfered plan outline: rectangle x0..x1 × ±hw with corner chamfer c (and a pointed front `nose`). */
function plan(x0, x1, hw, c = 1, nose = 0, z0 = 0) {
  return [[x0 + c, z0 - hw], [x1 - c - nose, z0 - hw], [x1, z0 - hw + c + nose * 0.6], [x1, z0 + hw - c - nose * 0.6], [x1 - c - nose, z0 + hw], [x0 + c, z0 + hw], [x0, z0 + hw - c], [x0, z0 - hw + c]];
}
const ellipse = (cx, cz, rx, rz, n = 20) => Array.from({ length: n }, (_, k) => [cx + Math.cos((k / n) * Math.PI * 2) * rx, cz + Math.sin((k / n) * Math.PI * 2) * rz]);
/** Guard rail along a polyline at deck height(s): stanchions every `step` m and two wires. */
function rail(g, M, pts, step = 2.2, h = 1.1) {
  for (let k = 0; k + 1 < pts.length; k++) {
    const [a, b] = [pts[k], pts[k + 1]], L = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(1, Math.round(L / step));
    for (let i = 0; i < n; i++) { const t = i / n; box(g, M.greyDk, 0.08, h, 0.08, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + h / 2, a[2] + (b[2] - a[2]) * t); }
    for (const f of [0.5, 1]) wire(g, M.iron, [a[0], a[1] + h * f, a[2]], [b[0], b[1] + h * f, b[2]], 0.03);
  }
}

// ------------------------------------------------------------------------------------------ hull

/** Deck-edge half breadth (t = x / HL, +1 bow). */
function deckHB(t) {
  const B = SHIP_REAL.B;
  if (t > 0.42) return B * Math.max(0, 1 - Math.pow((t - 0.42) / 0.58, 2.1));
  if (t < -0.68) return B * Math.sqrt(Math.max(0, 1 - Math.pow((-0.68 - t) / 0.32, 2)));
  return B;
}
/** Main-deck height (sheer): 9.9 amidships, 14 m at the stem, 9.4 at the stern. */
export function deckY(t) {
  const D = SHIP_REAL.deck;
  return D + (t > 0.25 ? 4.1 * Math.pow((t - 0.25) / 0.75, 2) : 0) - (t < -0.6 ? 0.5 * ((-0.6 - t) / 0.4) : 0);
}
/** Section half breadth at height y of station t (flare above the boot topping: narrower at the waterline forward). */
function sectionHB(t, y) {
  const d = deckHB(t), yd = deckY(t);
  const fl = t > 0.3 ? 0.42 * Math.min(1, (t - 0.3) / 0.6) : t < -0.7 ? 0.2 * ((-0.7 - t) / 0.3) : 0.02;
  const wl = d * (1 - fl);
  if (y >= 0.8) { const f = Math.min(1, (y - 0.8) / (yd - 0.8)); return wl + (d - wl) * Math.pow(f, 1.6); }
  // wall-sided below the boot topping (the water's top-down bed capture, art/water.js, sees no hull under the surface)
  return wl;
}
/** Bow rake / stern undercut: x shift of a hull point at height y on station t. */
function rake(t, y) {
  const yd = deckY(t); y = Math.max(0.8, y); // the stem and stern run plumb below the waterline (see sectionHB)
  const s = (a, b, v) => { const q = Math.min(1, Math.max(0, (v - a) / (b - a))); return q * q * (3 - 2 * q); };
  return -(yd - y) * 0.42 * s(0.86, 1, t) + (yd - y) * 0.22 * s(-0.9, -1, t);
}

function buildHull(g, M) {
  const N = 72, LV = [SHIP_REAL.keel, 0.8, 3, 6, 8.5, 1], S = new Soup(), D = new Soup(), W = new Soup();
  const st = [];
  for (let i = 0; i <= N; i++) {
    const t = -1 + (2 * i) / N, x = t * HL, yd = deckY(t);
    st.push(LV.map((y0, k) => { const y = k === LV.length - 1 ? yd : Math.min(y0, yd - 0.3); return [x + rake(t, y), y, sectionHB(t, y)]; }));
  }
  const U = 24, V = 18;
  for (let i = 0; i < N; i++) for (let k = 0; k + 1 < LV.length; k++) for (const s of [-1, 1]) {
    const a = st[i][k], b = st[i + 1][k], c = st[i + 1][k + 1], d = st[i][k + 1];
    const P = (p) => [p[0], p[1], s * p[2]], uv = (p) => [(s > 0 ? p[0] : -p[0]) / U, (p[1] + 3) / V];
    S.quad(P(a), P(b), P(c), P(d), uv(a), uv(b), uv(c), uv(d), [0, (a[1] < -1 ? -0.3 : 0), s]);
  }
  // flat bottom (closes the hull below the waterline)
  for (let i = 0; i < N; i++) {
    const a = st[i][0], b = st[i + 1][0];
    S.quad([a[0], a[1], -a[2]], [b[0], b[1], -b[2]], [b[0], b[1], b[2]], [a[0], a[1], a[2]], [0, 0], [0, 0], [0, 0], [0, 0], [0, -1, 0]);
  }
  g.add(S.mesh(M.hull));
  // main deck: teak inside a steel waterway strip, planks running fore and aft (u across, v along)
  const way = 1.1;
  for (let i = 0; i < N; i++) {
    const a = st[i][LV.length - 1], b = st[i + 1][LV.length - 1];
    const ia = Math.max(0, a[2] - way), ib = Math.max(0, b[2] - way);
    D.quad([a[0], a[1], -ia], [b[0], b[1], -ib], [b[0], b[1], ib], [a[0], a[1], ia], [-ia / 3, a[0] / 3], [-ib / 3, b[0] / 3], [ib / 3, b[0] / 3], [ia / 3, a[0] / 3], [0, 1, 0]);
    for (const s of [-1, 1]) W.quad([a[0], a[1], s * ia], [b[0], b[1], s * ib], [b[0], b[1], s * b[2]], [a[0], a[1], s * a[2]], [a[0] / 2, ia / 2], [b[0] / 2, ib / 2], [b[0] / 2, b[2] / 2], [a[0] / 2, a[2] / 2], [0, 1, 0]);
  }
  g.add(D.mesh(M.teak), W.mesh(M.deckSteel));
  // guard rails round the deck edge (both sides, bow to stern)
  for (const s of [-1, 1]) rail(g, M, st.filter((_, i) => i % 2 === 0).map((q) => { const p = q[LV.length - 1]; return [p[0], p[1], s * (p[2] - 0.25)]; }), 2.6, 1.1);
  return st;
}

/** Anchors, hawse pipes, cables, capstans, breakwater, bollards, fairleads, ventilators. */
function deckFittings(g, M) {
  const at = (d) => { const x = HL - d, t = x / HL; return { x, y: deckY(t), hb: deckHB(t), t }; };
  for (const [d, s] of [[14, 1], [14, -1], [17, 1]]) { // hawse pipes and the stowed anchors on the hull side
    const p = at(d), y = p.y - 2.2, z = s * sectionHB(p.t, y) * 1.0 + s * 0.15;
    cyl(g, M.black, 0.75, 0.75, 0.3, p.x, y, z, 'z', 14);
    box(g, M.iron, 0.5, 2.6, 0.3, p.x, y - 1.2, z + s * 0.1);
    box(g, M.iron, 2.2, 0.4, 0.35, p.x, y - 2.5, z + s * 0.12);
    for (let k = 0; k < 6; k++) { const q = at(d + 1 + k * 1.1); box(g, M.iron, 0.9, 0.22, 0.4, q.x, q.y + 0.12, s * 2.6 * (1 - k / 7) + s * 0.5); } // anchor cable to the capstan
    const c = at(d + 8); cyl(g, M.greyDk, 0.9, 1.1, 0.9, c.x, c.y, s * 2.4, 'y', 14); cyl(g, M.iron, 0.5, 0.5, 0.2, c.x, c.y + 0.9, s * 2.4, 'y', 12);
  }
  const bw = at(43); // breakwater: a low V of plating ahead of Anton
  for (const s of [-1, 1]) {
    const a = [bw.x + 3.5, bw.y, 0], b = [bw.x - 1.5, bw.y, s * bw.hb * 0.8];
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]), m = box(g, M.grey, L, 1.3, 0.2, (a[0] + b[0]) / 2, bw.y + 0.65, (a[2] + b[2]) / 2);
    m.rotation.y = -Math.atan2(b[2] - a[2], b[0] - a[0]);
  }
  for (let d = 24; d < 240; d += 16) for (const s of [-1, 1]) { // bollard pairs and fairleads at the deck edge
    if (d > 100 && d < 170) continue;
    const p = at(d); if (p.hb < 3) continue;
    for (const o of [-0.5, 0.5]) cyl(g, M.black, 0.28, 0.32, 0.7, p.x + o, p.y, s * (p.hb - 1.8), 'y', 10);
    box(g, M.greyDk, 1.2, 0.35, 0.4, p.x, p.y + 0.18, s * (p.hb - 0.5));
  }
  for (const [d, z] of [[30, 4], [30, -4], [64, 7], [64, -7], [186, 8], [186, -8], [210, 5], [210, -5], [228, 3], [228, -3]]) { // mushroom ventilators
    const p = at(d); cyl(g, M.grey, 0.35, 0.35, 1.2, p.x, p.y, z, 'y', 10); cyl(g, M.grey, 0.75, 0.6, 0.35, p.x, p.y + 1.2, z, 'y', 12);
  }
}

// ------------------------------------------------------------------------------------------ guns

/** Twin turret group (local: +x = muzzles), base at y 0. `big`: 38 cm main; else 15 cm secondary. */
function turret(M, big = true) {
  const g = new THREE.Group(), s = big ? 1 : 0.5;
  const L0 = -7.5 * s, L1 = 6.0 * s, hw = 5.8 * s, H = (big ? 4.0 : 2.6);
  const bot = [[L0, -hw], [L1 - 2.2 * s, -hw], [L1, -hw + 2.3 * s], [L1, hw - 2.3 * s], [L1 - 2.2 * s, hw], [L0, hw], [L0 - 0.4 * s, hw - 1.2 * s], [L0 - 0.4 * s, -hw + 1.2 * s]];
  const top = bot.map(([x, z]) => [x > L1 - 2.5 * s ? x - 2.0 * s : x, z * (x > L1 - 2.5 * s ? 0.94 : 1)]);
  loft(g, M.grey, M.roof, bot, 0, top, H, { uS: 6, vS: 6, vRef: 0, capS: 4 });
  if (big) {
    cyl(g, M.grey, 0.75, 0.75, 13.5, L0 + 2.0, H - 0.9, 0, 'z', 14);                                    // rangefinder through the rear
    for (const z of [-6.75, 6.75]) { const h = cyl(g, M.grey, 1.0, 1.0, 1.6, L0 + 2.0, H - 0.9, z, 'z', 14); void h; }
    for (const z of [-2.8, 2.8]) box(g, M.greyDk, 1.4, 0.7, 1.0, L1 - 4.5, H + 0.3, z);               // periscope hoods
    box(g, M.greyDk, 2.2, 0.5, 1.6, L0 + 3.0, H + 0.25, 0);
  }
  const gz = big ? 2.2 : 1.05, len = big ? 19.5 : 9, r0 = big ? 0.55 : 0.26, r1 = big ? 0.32 : 0.15;
  for (const z of [-gz, gz]) {
    cyl(g, M.bag, r0 * 1.7, r0 * 1.5, 1.2 * s + 0.3, L1 - 0.6, H * 0.45, z, 'x', 12);                  // blast bag
    cyl(g, M.gun, r1, r0, len, L1 + 0.2 + len / 2, H * 0.45, z, 'x', 14);                             // barrel
    cyl(g, M.black, r1 * 1.1, r1 * 1.1, 0.5, L1 + 0.2 + len - 0.2, H * 0.45, z, 'x', 12);             // muzzle
  }
  return g;
}
/** 10.5 cm twin flak mount: pedestal, curved shield, two barrels elevated. */
function flakMount(M) {
  const g = new THREE.Group();
  cyl(g, M.greyDk, 1.6, 1.8, 0.6, 0, 0, 0, 'y', 16);
  const sh = new THREE.CylinderGeometry(2.0, 2.0, 2.2, 18, 1, true, -Math.PI * 0.62, Math.PI * 1.24);
  sh.rotateY(Math.PI / 2); sh.translate(0, 1.7, 0);
  g.add(mesh(boxUV(sh.toNonIndexed(), 2), M.grey));
  box(g, M.roof, 3.0, 0.15, 3.6, 0.3, 2.85, 0);
  for (const z of [-0.45, 0.45]) { const b = cyl(g, M.gun, 0.1, 0.15, 6.5, 3.0, 2.4, z, 'x', 10); b.rotation.z = 0.35; b.position.y += 1.0; }
  return g;
}
/** 3.7 cm twin: pedestal, little shield, two thin barrels. */
function lightFlak(M) {
  const g = new THREE.Group();
  cyl(g, M.greyDk, 0.5, 0.6, 0.9, 0, 0, 0, 'y', 10);
  box(g, M.grey, 0.2, 0.9, 1.6, 0.6, 1.25, 0);
  for (const z of [-0.3, 0.3]) { const b = cyl(g, M.gun, 0.05, 0.07, 2.8, 1.8, 1.1, z, 'x', 6); b.rotation.z = 0.3; b.position.y += 0.4; }
  return g;
}
function placeAt(g, child, x, y, z, ry = 0) { child.position.set(x, y, z); child.rotation.y = ry; g.add(child); return child; }

// ------------------------------------------------------------------------------------------ superstructure

function superstructure(g, M) {
  const X = (d) => HL - d, D0 = SHIP_REAL.deck, T = 2.6;
  // 01 level: the long deckhouse (secondaries on its sides), 02 level, hangar, after deckhouse
  const L01 = [[X(168), -9], [X(160), -14.5], [X(92), -14.5], [X(80), -9], [X(80), 9], [X(92), 14.5], [X(160), 14.5], [X(168), 9]];
  loft(g, M.wall, M.deckSteel, L01, D0 - 0.2, L01, D0 + T);
  const L02 = plan(X(158), X(84), 8.5, 2.5, 3);
  loft(g, M.wall, M.deckSteel, L02, D0 + T, L02, D0 + 2 * T);
  rail(g, M, [...L01, L01[0]].map(([x, z]) => [x, D0 + T, z * 0.985]), 2.4, 1.0);
  // armoured conning tower (vision slits near the top) and the forward command tower tiers
  const ct = ellipse(X(84.5), 0, 4.2, 4.6, 22), ctTop = D0 + 3 * T + 0.2;
  loft(g, M.greyDk, M.roof, ct, D0 + T, ct, ctTop, { uS: 6 });
  loft(g, M.black, M.black, ellipse(X(84.5), 0, 4.25, 4.65, 22), ctTop - 0.9, ellipse(X(84.5), 0, 4.25, 4.65, 22), ctTop - 0.5, { cap: false });
  cyl(g, M.grey, 1.6, 1.8, 1.6, X(84.5), ctTop, 0, 'y', 16);                                            // its rangefinder hood
  cyl(g, M.grey, 0.5, 0.5, 7.5, X(84.5), ctTop + 0.8, 0, 'z', 10);
  let y = D0 + 2 * T;
  for (const [x0, x1, hw] of [[X(98), X(86), 6], [X(97), X(88), 5.2], [X(96), X(89.5), 4.2]]) {
    const P = plan(x0, x1, hw, 1.2, 1.2); loft(g, M.wall, M.deckSteel, P, y, P, y + T); y += T;
  }
  // bridge: glazing along the front and sides of the second tier, open wings either side
  const by = D0 + 3 * T;
  for (let z = -3.0; z <= 3.01; z += 0.75) box(g, M.glass, 0.12, 0.85, 0.62, X(88) + 0.06, by + 1.45, z);
  for (const s of [-1, 1]) {
    for (let x = X(97) + 1.6; x < X(88) - 2.6; x += 0.85) box(g, M.glass, 0.7, 0.85, 0.12, x, by + 1.45, s * 5.26);
    box(g, M.deckSteel, 3.2, 0.2, 5.5, X(88.5), by + 0.1, s * 8.0);                                       // bridge wing
    rail(g, M, [[X(90), by + 0.2, s * 10.7], [X(87), by + 0.2, s * 10.7]], 1.2, 1.0);
    cyl(g, M.grey, 0.75, 0.75, 1.2, X(88.5), by + 0.2, s * 9.6, 'y', 12);                                  // searchlight
    cyl(g, M.lens, 0.6, 0.6, 0.1, X(88.5) + 0.75, by + 0.8, s * 9.6, 'x', 12);
  }
  // tower column and the foretop fire-control hood with its rangefinder arms and the radar mattress
  cyl(g, M.wall, 2.6, 3.0, 8.5, X(92.5), y, 0, 'y', 18);
  const ft = y + 8.5;
  cyl(g, M.grey, 3.4, 3.6, 3.0, X(92.5), ft, 0, 'y', 22);
  cyl(g, M.roof, 3.0, 3.4, 0.6, X(92.5), ft + 3.0, 0, 'y', 22);
  cyl(g, M.grey, 0.6, 0.6, 10.5, X(92.5) - 0.8, ft + 1.8, 0, 'z', 12);
  for (const z of [-5.25, 5.25]) cyl(g, M.grey, 0.85, 0.85, 1.4, X(92.5) - 0.8, ft + 1.8, z, 'z', 12);
  box(g, M.iron, 0.25, 2.0, 4.0, X(92.5) + 3.6, ft + 2.2, 0);                                            // radar mattress
  for (let z = -1.8; z <= 1.8; z += 0.45) box(g, M.greyDk, 0.3, 2.0, 0.05, X(92.5) + 3.75, ft + 2.2, z);
  // foremast (pole, yards, aerials), stays to the forecastle
  const mt = ft + 15;
  cyl(g, M.greyDk, 0.35, 0.55, mt - ft - 3.6, X(94.5), ft + 3.6, 0, 'y', 10);
  box(g, M.greyDk, 0.3, 0.3, 13, X(94.5), mt - 3.5, 0); box(g, M.greyDk, 0.25, 0.25, 8, X(94.5), mt - 7, 0);
  wire(g, M.iron, [X(94.5), mt - 1, 0], [X(40), deckY(X(40) / HL) + 0.5, 0], 0.05);
  for (const s of [-1, 1]) wire(g, M.iron, [X(94.5), mt - 3.5, s * 6.5], [X(108), D0 + T, s * 14], 0.04);
  // funnel: raked elliptic casing, black cap, searchlight platform with lamps, steam pipes, clinker screen
  const fx = X(118), fy0 = D0 + 2 * T, fH = 13.5, rake = 1.6;
  const fb = ellipse(fx, 0, 6.2, 4.2, 26), fT = ellipse(fx - rake, 0, 5.6, 3.8, 26);
  loft(g, M.grey, M.black, fb, fy0, fT, fy0 + fH, { uS: 6, vS: 6, vRef: 0, cap: false });
  loft(g, M.black, M.black, ellipse(fx - rake, 0, 5.75, 3.95, 26), fy0 + fH - 1.2, ellipse(fx - rake - 0.15, 0, 5.75, 3.95, 26), fy0 + fH + 0.3, { capS: 2 });
  for (let x = -4.5; x <= 4.5; x += 1.5) box(g, M.iron, 0.15, 0.15, 7.2, fx - rake + x, fy0 + fH + 0.35, 0);  // cap grille
  const pY = fy0 + 6.8, plat = ellipse(fx - 0.6, 0, 8.6, 6.6, 26);
  loft(g, M.greyDk, M.deckSteel, plat, pY - 0.3, plat, pY, { uS: 4 });
  rail(g, M, [...plat, plat[0]].map(([x, z]) => [x, pY, z]), 1.6, 0.9);
  for (const [a, s] of [[0.6, 1], [0.6, -1], [2.5, 1], [2.5, -1]]) {
    const lx = fx - 0.6 + Math.cos(a) * 7.2, lz = s * Math.sin(a) * 5.4;
    cyl(g, M.grey, 0.9, 0.9, 1.4, lx, pY, lz, 'y', 14); cyl(g, M.lens, 0.75, 0.75, 0.12, lx + Math.cos(a) * 0.9, pY + 0.7, lz + s * Math.sin(a) * 0.9 * 0.6, 'x', 12);
  }
  for (const z of [-1.2, 1.2]) cyl(g, M.greyDk, 0.25, 0.25, fH + 1.6, fx - 6.6, fy0, z, 'y', 8);           // steam pipes (aft face)
  // hangar, catapult and an Arado 196, boat cranes, launches, Carley floats
  const hg = plan(X(148), X(134), 10, 1.5);
  loft(g, M.wall, M.deckSteel, hg, D0 + T, hg, D0 + T + 4.4);
  box(g, M.greyDk, 0.2, 3.8, 12, X(134) + 0.1, D0 + T + 1.9, 0);                                         // hangar door
  const cy = D0 + T + 0.2, cx2 = X(127);
  cyl(g, M.greyDk, 1.6, 1.8, 1.0, cx2, cy, 0, 'y', 16);
  for (const s of [-1, 1]) strut(g, M.grey, [cx2 - 0.6, cy + 1.2, s * 0.1], [cx2 - 0.6, cy + 1.2, s * 16], 0.9, 1.2);
  for (let z = -15; z <= 15; z += 1.5) strut(g, M.greyDk, [cx2 - 1.0, cy + 1.6, z], [cx2 - 0.2, cy + 0.9, z + 1.5], 0.12);
  const plane = new THREE.Group(); arado(plane, M, 0, 0, 0); placeAt(g, plane, cx2 - 0.6, cy + 2.1, 3, -Math.PI / 2); // on the catapult, nose to starboard
  for (const s of [-1, 1]) {
    const kx = X(140), kz = s * 11.5;
    cyl(g, M.grey, 0.7, 0.85, 13.4, kx, D0 + T, kz, 'y', 12);
    strut(g, M.grey, [kx, D0 + T + 12.8, kz], [kx + 13, D0 + T + 6.0, kz + s * 3], 0.45, 0.6);
    wire(g, M.iron, [kx, D0 + T + 13.4, kz], [kx + 12.6, D0 + T + 6.4, kz + s * 2.9], 0.05);
    wire(g, M.iron, [kx + 12.8, D0 + T + 5.8, kz + s * 3], [kx + 12.8, D0 + T + 1.5, kz + s * 3], 0.04);
    launch(g, M, X(141), D0 + T + 4.4, s * 4, 9);                                                       // on the hangar roof
    for (const fy of [0.9, 1.9]) box(g, M.float, 3.2, 0.9, 0.35, X(102.5), D0 + T + fy, s * 8.72);         // Carley floats
  }
  // mainmast, the after deckhouse and the after fire-control station
  const mm = X(151);
  cyl(g, M.greyDk, 0.4, 0.65, 30.4, mm, D0 + T, 0, 'y', 10);
  box(g, M.deckSteel, 4.5, 0.3, 4.5, mm, D0 + T + 16, 0); box(g, M.greyDk, 0.3, 0.3, 11, mm, D0 + T + 22, 0);
  wire(g, M.iron, [mm, D0 + T + 29, 0], [X(94.5), ft + 14, 0], 0.035);                                    // aerials between the masts
  wire(g, M.iron, [mm, D0 + T + 27, 0], [X(232), deckY(X(232) / HL) + 0.6, 0], 0.05);
  const af = plan(X(166), X(152), 6.5, 1.5);
  loft(g, M.wall, M.deckSteel, af, D0 + T, af, D0 + 2 * T);
  cyl(g, M.wall, 2.2, 2.6, 5.5, X(160), D0 + 2 * T, 0, 'y', 16);
  cyl(g, M.grey, 3.0, 3.2, 2.6, X(160), D0 + 2 * T + 5.5, 0, 'y', 20);
  cyl(g, M.grey, 0.55, 0.55, 10.5, X(160) + 0.5, D0 + 2 * T + 6.8, 0, 'z', 12);
  for (const z of [-5.25, 5.25]) cyl(g, M.grey, 0.8, 0.8, 1.3, X(160) + 0.5, D0 + 2 * T + 6.8, z, 'z', 12);
  // secondary turrets (01 deck, both beams), heavy flak (02 deck), light flak on the tower and the after deckhouse
  for (const s of [-1, 1]) {
    for (const [d, dir] of [[96, 1], [110, 1], [150, -1]]) placeAt(g, turret(M, false), X(d), D0 + T, s * 11.6, dir > 0 ? 0 : Math.PI);
    for (const d of [104, 122, 136, 146]) placeAt(g, flakMount(M), X(d), d < 130 ? D0 + 2 * T : D0 + T + 4.4, s * (d < 130 ? 6.2 : 8.2), -s * 0.9);
    for (const [d, yy, zz] of [[91, D0 + 3 * T, 4.8], [165, D0 + 2 * T, 5.2], [147, D0 + T + 4.4, 4]]) placeAt(g, lightFlak(M), X(d), yy, s * zz, s * -1.2);
  }
}

/** Arado Ar 196 floatplane on the catapult (span 12.4 m), nose +x. */
function arado(g, M, x, y, z) {
  cyl(g, M.plane, 0.5, 0.75, 8.5, x + 0.5, y + 2.0, z, 'x', 12);                                         // fuselage
  cyl(g, M.planeDk, 0.75, 0.6, 1.2, x + 5.1, y + 2.0, z, 'x', 12);                                       // cowling
  box(g, M.glass, 2.4, 0.6, 0.9, x + 1.6, y + 2.75, z);                                                   // canopy
  box(g, M.plane, 2.0, 0.16, 12.4, x + 2.0, y + 2.45, z);                                                 // wing
  box(g, M.plane, 1.2, 0.12, 4.2, x - 3.4, y + 2.2, z); box(g, M.plane, 1.3, 1.5, 0.1, x - 3.6, y + 2.9, z); // tail
  for (const s of [-1, 1]) {
    cyl(g, M.planeDk, 0.32, 0.4, 7.2, x + 1.6, y + 0.45, z + s * 1.7, 'x', 10);                           // floats
    strut(g, M.planeDk, [x + 2.6, y + 0.8, z + s * 1.7], [x + 2.4, y + 2.4, z + s * 1.0], 0.1);
    strut(g, M.planeDk, [x + 0.6, y + 0.8, z + s * 1.7], [x + 0.9, y + 2.4, z + s * 1.0], 0.1);
  }
  box(g, M.planeDk, 0.1, 1.6, 0.1, x + 5.8, y + 2.0, z);                                                  // propeller
}
/** Motor launch on its chocks at (x, y, z), length L. */
function launch(g, M, x, y, z, L) {
  const s = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  s.scale(L / 2, 1.1, 1.25); s.translate(x, y + 1.6, z);
  g.add(mesh(boxUV(s.toNonIndexed(), 2), M.boat));
  box(g, M.teak, L * 0.9, 0.1, 2.2, x, y + 1.6, z);
  box(g, M.boat, L * 0.32, 0.8, 1.6, x + L * 0.08, y + 2.0, z);
  for (const o of [-L * 0.3, L * 0.3]) box(g, M.greyDk, 0.4, 0.6, 2.0, x + o, y + 0.3, z);
}

// ------------------------------------------------------------------------------------------ assembly

/**
 * Battleship visual on a prop footprint `p` (w × d m, bow +X). @returns {THREE.Group} in the prop's local frame.
 */
export function buildWarship(p = {}) {
  const M = materials(), g = new THREE.Group(); g.name = 'kit:warship';
  const inner = new THREE.Group();
  buildHull(inner, M);
  deckFittings(inner, M);
  const X = (d) => HL - d, D = (d) => deckY(X(d) / HL);
  // main turrets on their barbettes: Anton, Bruno (superfiring) forward, Caesar (superfiring), Dora aft
  for (const [d, lift, dir] of [[55, 1.2, 1], [71, 4.6, 1], [178, 4.6, -1], [196, 1.2, -1]]) {
    const x = X(d), y0 = D(d);
    cyl(inner, M.grey, 6.4, 6.6, lift + 0.2, x, y0 - 0.1, 0, 'y', 28);
    cyl(inner, M.greyDk, 6.9, 6.9, 0.2, x, y0 + lift - 0.1, 0, 'y', 28);
    placeAt(inner, turret(M, true), x, y0 + lift, 0, dir > 0 ? 0 : Math.PI);
  }
  superstructure(inner, M);
  consolidate(inner);
  const w = p.w ?? 110, d = p.d ?? 16;
  inner.scale.set(w / SHIP_REAL.L, 0.5, d / (2 * SHIP_REAL.B));
  inner.position.y = 0;
  g.add(inner);
  return g;
}
