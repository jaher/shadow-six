/**
 * Clothesline (M3 §3.4: the Spy's German uniform hangs on a line at the east camp) — two weathered T-posts, a sagging
 * hemp line, wooden pegs and Verlet-cloth laundry that moves with the mission wind (step 4w): the officer's field tunic
 * and trousers with his peaked cap hung between them by its chin strap (children of 'clothesline_uniform', hidden once
 * taken; the Spy takes them one by one, art/spy-actions.js), plus a shirt and a towel either side that stay.
 * LAUNDRY is the layout the sim reads too (abilities/spy-actions.js: where she stands to take it, where she dresses).
 * @module art/clothesline
 */
import * as THREE from 'three';
import { VerletCloth, registerCloth } from './cloth.js';
import { dressingMaterial } from './dressing.js';

const C = {};
const HAS_DOM = typeof document !== 'undefined';

/**
 * Line layout (line-local x along the line, m): the uniform in the middle — tunic, cap, trousers — the household
 * laundry either side. standOff: the Spy takes the uniform standing this far off the line in front of the cap (the
 * near edges of the tunic and the trousers then hang a hand's breadth either side of her).
 */
export const LAUNDRY = Object.freeze({ span: 4.2, H: 1.85, towel: -1.22, tunic: -0.62, cap: -0.14, trousers: 0.3, shirt: 0.88, standOff: 0.42 });

/** Sag of the loaded line at line-local x (m below the post tops' line). */
export const sagAt = (x, span = LAUNDRY.span) => 0.12 * (1 - Math.pow((2 * x) / span, 2));
/** Height of the line (m, line-local y) at x. */
export const lineY = (x, span = LAUNDRY.span) => LAUNDRY.H - 0.05 - sagAt(x, span);

function canvasTex(key, W, H, draw) {
  if (C[key] !== undefined) return C[key];
  if (!HAS_DOM) return (C[key] = null);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  draw(g, W, H);
  // woven noise
  const img = g.getImageData(0, 0, W, H), px = img.data;
  let s = 99991;
  for (let k = 0; k < px.length; k += 4) {
    if (!px[k + 3]) continue;
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const n = ((s >>> 8) / 16777216 - 0.5) * 16;
    px[k] += n; px[k + 1] += n; px[k + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (C[key] = t);
}

/** Field grey of the officer's cloth (the disguise outfit's tunic and breeches). */
export const FIELD_GREY = '#6b6f5f';

export const GARMENTS = {
  tunic: { w: 0.62, h: 0.78, col: FIELD_GREY, density: 0.35, draw(g, W, H) {
    g.fillStyle = FIELD_GREY;
    g.beginPath(); // shoulders on the line, sleeves hanging, skirt below
    g.moveTo(W * 0.02, 0); g.lineTo(W * 0.98, 0); g.lineTo(W, H * 0.55); g.lineTo(W * 0.8, H * 0.56); g.lineTo(W * 0.8, H);
    g.lineTo(W * 0.2, H); g.lineTo(W * 0.2, H * 0.56); g.lineTo(0, H * 0.55); g.closePath(); g.fill();
    g.fillStyle = '#3f4a3a'; g.fillRect(W * 0.38, 0, W * 0.24, H * 0.06); // collar (bottle green)
    g.strokeStyle = 'rgba(25,28,22,0.6)'; g.lineWidth = 3;
    for (const [x, y, pw, ph] of [[0.26, 0.2, 0.18, 0.16], [0.56, 0.2, 0.18, 0.16], [0.24, 0.62, 0.2, 0.2], [0.56, 0.62, 0.2, 0.2]]) g.strokeRect(W * x, H * y, W * pw, H * ph);
    g.beginPath(); g.moveTo(W * 0.5, H * 0.06); g.lineTo(W * 0.5, H); g.stroke();
    g.fillStyle = '#8c8a7a';
    for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(W * 0.52, H * (0.12 + k * 0.17), 3.5, 0, 7); g.fill(); }
  } },
  trousers: { w: 0.5, h: 0.95, col: '#62665a', density: 0.35, draw(g, W, H) {
    g.fillStyle = '#62665a';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W * 0.96, H); g.lineTo(W * 0.56, H); g.lineTo(W * 0.5, H * 0.3);
    g.lineTo(W * 0.44, H); g.lineTo(W * 0.04, H); g.closePath(); g.fill();
    g.fillStyle = '#4a4f43'; g.fillRect(0, 0, W, H * 0.06);
  } },
  shirt: { w: 0.55, h: 0.7, col: '#d7d2c4', density: 0.3, draw(g, W, H) {
    g.fillStyle = '#d7d2c4';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, H * 0.45); g.lineTo(W * 0.82, H * 0.46); g.lineTo(W * 0.82, H);
    g.lineTo(W * 0.18, H); g.lineTo(W * 0.18, H * 0.46); g.lineTo(0, H * 0.45); g.closePath(); g.fill();
  } },
  towel: { w: 0.5, h: 0.8, col: '#cfc7b3', density: 0.45, draw(g, W, H) {
    g.fillStyle = '#cfc7b3'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#7a5040'; g.fillRect(0, H * 0.08, W, H * 0.04); g.fillRect(0, H * 0.88, W, H * 0.04);
  } },
};
/** Particle grid of a garment (columns × rows; PlaneGeometry order: row-major from the top row). */
export const GRID = Object.freeze({ nx: 7, ny: 9 });
/** Pegged top-row columns. */
export const PEGS = Object.freeze([0, 3, GRID.nx - 1]);

export function garmentMaterial(kind) {
  const key = 'mat_' + kind;
  if (C[key]) return C[key];
  const G = GARMENTS[kind], map = canvasTex(kind, 128, Math.round(128 * G.h / G.w), G.draw);
  const m = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : G.col, map, roughness: 0.95, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false });
  m.name = 'laundry_' + kind;
  m.userData.snowCover = true;
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
  return (C[key] = { m, d });
}

/**
 * One garment cloth, top edge at local y = 0, centred on x (a fresh Verlet cloth pinned at PEGS, not registered with
 * the wind tick). @returns {THREE.Mesh} mesh.userData: {cloth, kind, pegs (pinned particle indices)}
 */
export function makeGarment(kind, x = 0, sag = 0) {
  const G = GARMENTS[kind], { nx, ny } = GRID;
  const geo = new THREE.PlaneGeometry(G.w, G.h, nx - 1, ny - 1);
  geo.translate(x, -G.h / 2 - sag, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, -G.h / 2, 0), Math.hypot(G.w, G.h) + 0.6);
  const { m, d } = garmentMaterial(kind);
  const mesh = new THREE.Mesh(geo, m);
  mesh.customDepthMaterial = d;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.name = 'laundry_' + kind;
  const pegs = new Set(PEGS);
  const cloth = new VerletCloth(geo.attributes, { nx, ny, pinned: (i, j) => j === 0 && pegs.has(i), density: G.density, damping: 0.02, flutter: 0.5 });
  mesh.userData.cloth = cloth; mesh.userData.kind = kind; mesh.userData.pegs = PEGS.map((i) => i);
  return mesh;
}

/** One pegged garment on the line (registered with the wind tick). */
function garment(kind, x, sag) {
  const mesh = makeGarment(kind, x, sag);
  registerCloth(mesh, mesh.userData.cloth);
  return mesh;
}

const _wood = () => (C.wood ??= dressingMaterial('beam')); // weathered timber (placeholder-art pass: was a flat colour)
const _rope = () => (C.rope ??= dressingMaterial('burlap')); // hemp line (textured)
const _std = (key, o) => (C[key] ??= Object.assign(new THREE.MeshStandardMaterial(o), { name: key }));

/**
 * The officer's peaked cap (Schirmmütze) as hung up or carried: field-grey crown, bottle-green band with piping, black
 * visor and chin strap, silver cockade. Origin = the centre of the band's lower edge, +y up through the crown, +z the
 * visor's way. ~0.25 m across the crown.
 */
export function makeOfficerCap() {
  const g = new THREE.Group(); g.name = 'officer_cap';
  const grey = _std('cap_grey', { color: 0x6f7364, roughness: 0.9 }), band = _std('cap_band', { color: 0x2e3a2c, roughness: 0.85 });
  const black = _std('cap_visor', { color: 0x141414, roughness: 0.35, metalness: 0.1 }), silver = _std('cap_silver', { color: 0xc9c9c0, roughness: 0.3, metalness: 0.8 });
  const bandM = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.092, 0.045, 18, 1, true), band);
  bandM.position.y = 0.0225;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.097, 0.05, 20), grey); // the saddle: wider than the band
  crown.position.y = 0.068; crown.scale.set(1, 1, 1.08); crown.rotation.x = -0.12; // raised at the front
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.126, 0.128, 0.008, 20), grey);
  top.position.y = 0.096; top.scale.set(1, 1, 1.08); top.rotation.x = -0.12;
  const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.005, 16, 1, false, -Math.PI / 2.4, Math.PI / 1.2), black);
  visor.position.set(0, 0.004, 0.035); visor.rotation.x = 0.32; visor.scale.set(1, 1, 0.75);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.094, 0.004, 4, 16, Math.PI * 0.9), black);
  strap.rotation.x = Math.PI / 2 + 0.05; strap.rotation.z = Math.PI * 0.05; strap.position.y = 0.012;
  const cockade = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 10), silver);
  cockade.rotation.x = Math.PI / 2; cockade.position.set(0, 0.03, 0.095);
  const eagle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.003), silver);
  eagle.position.set(0, 0.075, 0.118); eagle.rotation.x = -0.25;
  g.add(bandM, crown, top, visor, strap, cockade, eagle);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Wooden pegs at the garments' pinned corners (one merged mesh). */
function pegMesh(list) {
  const parts = [];
  for (const [x, y] of list) {
    const b = new THREE.BoxGeometry(0.011, 0.055, 0.014);
    b.translate(x, y - 0.012, 0);
    parts.push(b);
  }
  const geo = mergeBoxes(parts);
  const m = new THREE.Mesh(geo, _wood());
  m.name = 'clothesline_pegs'; m.castShadow = false;
  return m;
}
function mergeBoxes(list) {
  let n = 0, ni = 0;
  for (const g of list) { n += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = new Uint16Array(ni);
  let o = 0, oi = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2);
    for (let k = 0; k < g.index.count; k++) idx[oi + k] = g.index.array[k] + o;
    o += g.attributes.position.count; oi += g.index.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

/** Local transform of the cap hung on the line by a peg through its strap: the visor down, the crown out to +z. */
export function hangCap(cap, x) {
  cap.position.set(x, lineY(x) - 0.158, -0.012);
  cap.rotation.set(Math.PI / 2 - 0.22, 0, 0); // the band's back edge up at the peg
  return cap;
}

/**
 * @param {{uniform?:boolean, span?:number, seed?:number}} [o] span: post spacing (m)
 * @returns {THREE.Group} line along local X, posts at ±span/2; child 'clothesline_uniform' holds the uniform
 *   ('laundry_tunic', 'laundry_trousers' cloths and 'laundry_cap')
 */
export function makeClothesline(o = {}) {
  const span = o.span ?? LAUNDRY.span, H = LAUNDRY.H, g = new THREE.Group();
  g.name = 'clothesline';
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, H + 0.1, 6), _wood());
    post.position.set((sx * span) / 2, (H + 0.1) / 2, 0); post.castShadow = true;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5), _wood());
    bar.position.set((sx * span) / 2, H - 0.05, 0); bar.castShadow = true;
    g.add(post, bar);
  }
  const pts = [];
  for (let k = 0; k <= 12; k++) { const x = -span / 2 + (span * k) / 12; pts.push(new THREE.Vector3(x, lineY(x, span), 0)); }
  const line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.006, 4), _rope());
  line.name = 'clothesline_rope';
  g.add(line);
  const pegAt = [];
  const hang = (kind, x, parent) => {
    const m = garment(kind, x, 0);
    m.position.y = lineY(x, span);
    parent.add(m);
    const G = GARMENTS[kind];
    for (const i of PEGS) { const px = x - G.w / 2 + (G.w * i) / (GRID.nx - 1); pegAt.push([px, lineY(px, span)]); }
    return m;
  };
  const uni = new THREE.Group(); uni.name = 'clothesline_uniform';
  if (o.uniform !== false) {
    hang('tunic', LAUNDRY.tunic, uni); hang('trousers', LAUNDRY.trousers, uni);
    const cap = hangCap(makeOfficerCap(), LAUNDRY.cap); cap.name = 'laundry_cap';
    uni.add(cap);
    pegAt.push([LAUNDRY.cap, lineY(LAUNDRY.cap, span)]);
  }
  g.add(uni);
  hang('towel', LAUNDRY.towel, g); hang('shirt', LAUNDRY.shirt, g);
  g.add(pegMesh(pegAt));
  return g;
}
