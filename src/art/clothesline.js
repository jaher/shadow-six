/**
 * Clothesline (M3 §3.4: the Spy's German uniform hangs on a line at the east camp) — two weathered T-posts, a sagging
 * hemp line, wooden pegs and Verlet-cloth laundry that moves with the mission wind (step 4w): the M36 field tunic and
 * trousers (child 'clothesline_uniform', hidden once taken) plus a shirt and a towel.
 * @module art/clothesline
 */
import * as THREE from 'three';
import { VerletCloth, registerCloth } from './cloth.js';

const C = {};
const HAS_DOM = typeof document !== 'undefined';

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

const GARMENTS = {
  tunic: { w: 0.62, h: 0.78, col: '#565c4e', density: 0.35, draw(g, W, H) {
    g.fillStyle = '#565c4e';
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
  trousers: { w: 0.5, h: 0.95, col: '#595e50', density: 0.35, draw(g, W, H) {
    g.fillStyle = '#595e50';
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

function garmentMaterial(kind) {
  const key = 'mat_' + kind;
  if (C[key]) return C[key];
  const G = GARMENTS[kind], map = canvasTex(kind, 128, Math.round(128 * G.h / G.w), G.draw);
  const m = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : G.col, map, roughness: 0.95, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false });
  m.name = 'laundry_' + kind;
  m.userData.snowCover = true;
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
  return (C[key] = { m, d });
}

/** One pegged garment, top edge at local y = 0, centred on x. */
function garment(kind, x, sag) {
  const G = GARMENTS[kind], nx = 7, ny = 9;
  const geo = new THREE.PlaneGeometry(G.w, G.h, nx - 1, ny - 1);
  geo.translate(x, -G.h / 2 - sag, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, -G.h / 2, 0), Math.hypot(G.w, G.h) + 0.3);
  const { m, d } = garmentMaterial(kind);
  const mesh = new THREE.Mesh(geo, m);
  mesh.customDepthMaterial = d;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.name = 'laundry_' + kind;
  const pegs = new Set([0, 3, nx - 1]);
  const cloth = new VerletCloth(geo.attributes, { nx, ny, pinned: (i, j) => j === 0 && pegs.has(i), density: G.density, damping: 0.02, flutter: 0.5 });
  registerCloth(mesh, cloth);
  return mesh;
}

const _wood = () => (C.wood ??= new THREE.MeshStandardMaterial({ color: 0x5b4a38, roughness: 0.9 }));
const _rope = () => (C.rope ??= new THREE.MeshStandardMaterial({ color: 0x8a7d62, roughness: 1 }));

/**
 * @param {{uniform?:boolean, span?:number, seed?:number}} [o] span: post spacing (m)
 * @returns {THREE.Group} line along local X, posts at ±span/2; child 'clothesline_uniform' holds the uniform
 */
export function makeClothesline(o = {}) {
  const span = o.span ?? 4.2, H = 1.85, g = new THREE.Group();
  g.name = 'clothesline';
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, H + 0.1, 6), _wood());
    post.position.set((sx * span) / 2, (H + 0.1) / 2, 0); post.castShadow = true;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5), _wood());
    bar.position.set((sx * span) / 2, H - 0.05, 0); bar.castShadow = true;
    g.add(post, bar);
  }
  const sagAt = (x) => 0.12 * (1 - Math.pow((2 * x) / span, 2)); // parabolic sag of the loaded line
  const pts = [];
  for (let k = 0; k <= 12; k++) { const x = -span / 2 + (span * k) / 12; pts.push(new THREE.Vector3(x, H - 0.05 - sagAt(x), 0)); }
  const line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.006, 4), _rope());
  g.add(line);
  const hang = (kind, x, parent) => {
    const m = garment(kind, x, 0);
    m.position.y = H - 0.05 - sagAt(x);
    parent.add(m);
  };
  const uni = new THREE.Group(); uni.name = 'clothesline_uniform';
  if (o.uniform !== false) { hang('tunic', -1.15, uni); hang('trousers', -0.35, uni); }
  g.add(uni);
  hang('shirt', 0.5, g); hang('towel', 1.3, g);
  return g;
}
