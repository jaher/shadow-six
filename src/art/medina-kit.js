/**
 * Tunis medina dressing for the kit houses (M12 art pass, "Up on the Roof"): the walkable flat-roofed houses keep the
 * kit body (art/kit-buildings.js: the roof walkers' heights stay the mission's), and this module adds the North
 * African facade detail on top of it, all in the facade's own plane or projecting at most 0.3 m below 2.4 m
 * (doors, grilles, dados) so nobody walking along a wall clips into it:
 *   - medinaDoor     horseshoe-arch street door: sandstone voussoir ring (alternating ochre / white), a studded door
 *                    painted Tunis blue, green or yellow, a green glazed-tile hood on timber brackets
 *   - medinaFacade   bowed iron grilles on the ground-floor windows, arched heads, timber mashrabiya boxes on upper
 *                    windows, gargoyle spouts with rain streaks, fallen render showing the rubble, painted dados,
 *                    laundry lines strung across upper floors, striped canvas awnings and arched shopfronts (souk),
 *                    a zellige tile dado, a green-tiled pent roof and a green iron balcony (the palace)
 * Variants opt in by name (/medina|palace|souk|mosque|qubba|rooftop|prayer/); other theaters never reach this code.
 * @module art/medina-kit
 */
import * as THREE from 'three';
import { dressingMaterial, boxUV, rng } from './dressing.js';
import { paintedMaterial } from './kit-props.js';

export const MEDINA_RX = /medina|palace|souk|mosque|qubba|rooftop|prayer/;
export const TILE_GREEN = 0x4f8f6c;
const DOOR_PAINT = [0x2f5f86, 0x2f6b4f, 0xb08a3a, 0x2f5f86, 0x5a3a26];

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
function tbox(w, h, d, mat, x = 0, y = h / 2, z = 0, tile = 1.2) {
  const m = mesh(boxUV(new THREE.BoxGeometry(w, h, d).toNonIndexed(), tile), mat);
  m.position.set(x, y, z);
  return m;
}

const M = {};
let GLAZE = null;
/** Green glazed tiles (domes, door hoods, pent roofs): the terracotta relief without its brown albedo, a glaze sheen. */
export function glazedTile() {
  if (GLAZE) return GLAZE;
  GLAZE = dressingMaterial('roofTerracotta').clone();
  GLAZE.map = null; GLAZE.color.set(TILE_GREEN); GLAZE.roughness = 0.38; GLAZE.name = 'medina:glazed_tile';
  return GLAZE;
}
/** Shared materials (one instance each → the consolidate pass merges every house's parts per material). */
function mats() {
  if (M.ok) return M;
  M.ok = true;
  M.stone = dressingMaterial('sandstone');
  M.white = dressingMaterial('limewash');
  M.rubble = dressingMaterial('fieldstone');
  M.iron = paintedMaterial('steel', 0x2a2724, { metalness: 0.6, roughness: 0.55 });
  M.stud = paintedMaterial('steel', 0x6a6258, { metalness: 0.85, roughness: 0.38 });
  M.ironGreen = paintedMaterial('steel', 0x2f5a46, { metalness: 0.4, roughness: 0.6 });
  M.tile = glazedTile();
  M.beam = dressingMaterial('beam');
  M.lattice = paintedMaterial('weatherboard', 0x4a3a2a);
  M.recess = new THREE.MeshStandardMaterial({ color: 0x1d1813, roughness: 1, name: 'medina:recess' });
  M.streak = new THREE.MeshBasicMaterial({ color: 0x4a4034, transparent: true, opacity: 0.22, depthWrite: false, name: 'medina:streak' });
  M.lime = stainMaterial(0xfbf8f1, 0.62, 'medina:roof_lime', 3);
  M.tar = stainMaterial(0x7f7768, 0.34, 'medina:roof_screed', 7);
  M.doors = DOOR_PAINT.map((c) => paintedMaterial('weatherboard', c));
  M.dados = [0x3c6f86, 0xb08a52, 0x6f8a6a].map((c) => paintedMaterial('limewash', c));
  M.cloth = [0xd8d2c4, 0x8a3a2a, 0x3a5a7a, 0xc8b070, 0xe8e4da].map((c) => paintedMaterial('canvas', c));
  M.awning = stripedMaterial(0xd8cfb8, 0x9a3a2a);
  M.zellige = zelligeMaterial();
  return M;
}

/** Canvas texture helper (browser only; Node / unit tests get a flat colour). */
function canvasTex(w, h, draw, repeat = [1, 1]) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** A soft stain (roof repairs): flat colour through a blotchy radial alpha; no shadows on it (it lies 2.5 cm over the
 * slab, the low March sun would draw acne), transparent, no depth write, so it only tints what it lies on. */
function stainMaterial(color, opacity, name, seed) {
  const R = rng(seed);
  const alphaMap = canvasTex(64, 64, (g, w) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, w);
    for (let k = 0; k < 7; k++) {
      const cx = w / 2 + (R() - 0.5) * w * 0.3, cy = w / 2 + (R() - 0.5) * w * 0.3, r = w * (0.2 + R() * 0.16);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    }
  });
  if (alphaMap) { alphaMap.wrapS = alphaMap.wrapT = THREE.ClampToEdgeWrapping; alphaMap.colorSpace = THREE.NoColorSpace; }
  return new THREE.MeshStandardMaterial({ color, alphaMap, transparent: true, opacity, depthWrite: false, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, name, userData: { noRecv: true } });
}
function stripedMaterial(a, b) {
  const map = canvasTex(64, 8, (g, w, h) => { for (let k = 0; k < 8; k++) { g.fillStyle = `#${(k % 2 ? b : a).toString(16).padStart(6, '0')}`; g.fillRect(k * 8, 0, 8, h); } });
  return new THREE.MeshStandardMaterial({ color: map ? 0xffffff : a, map, roughness: 0.9, side: THREE.DoubleSide, name: 'medina:awning' });
}
/** Zellige: an eight-point star field in green, ochre, white and blue on a 32 cm repeat. */
function zelligeMaterial() {
  const map = canvasTex(128, 128, (g, w) => {
    g.fillStyle = '#e6e0d0'; g.fillRect(0, 0, w, w);
    const star = (cx, cy, r, col) => {
      g.fillStyle = col; g.beginPath();
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, rr = k % 2 ? r * 0.62 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      g.closePath(); g.fill();
    };
    for (const [x, y] of [[0, 0], [w, 0], [0, w], [w, w]]) star(x, y, 30, '#2f6b4f');
    star(w / 2, w / 2, 30, '#b08a3a'); star(w / 2, w / 2, 12, '#2f5f86');
    for (const [x, y] of [[w / 2, 0], [0, w / 2], [w, w / 2], [w / 2, w]]) star(x, y, 10, '#1f2a36');
    g.strokeStyle = 'rgba(60,50,40,0.5)'; g.lineWidth = 2; g.strokeRect(0, 0, w, w);
  }, [1, 1]);
  return new THREE.MeshStandardMaterial({ color: map ? 0xd6d0c2 : 0x6f8a6a, map, roughness: 0.35, metalness: 0.0, name: 'medina:zellige' });
}

let STUD = null;
/** A door nail's domed head (3.5 cm across, 1.6 cm proud), shared. */
function studGeo() {
  if (!STUD) { STUD = new THREE.SphereGeometry(0.035, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2); STUD.rotateX(Math.PI / 2); STUD.scale(1, 1, 0.45); STUD = boxUV(STUD.toNonIndexed(), 0.2); }
  return STUD;
}
/** Horseshoe arch ring (outer radius r, ring width t) as an extruded shape, spring line at y = 0. */
function archRing(r, t, depth) {
  const s = new THREE.Shape(), a0 = -0.35, a1 = Math.PI + 0.35;
  // (moveTo first: a Shape's first lineTo starts at (0, 0), which drew a sliver from the arch centre to the ring's
  // right foot — the stray diagonal 'stick' across every door, window head and shopfront)
  for (let k = 0; k <= 20; k++) { const a = a0 + ((a1 - a0) * k) / 20; s[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
  for (let k = 20; k >= 0; k--) { const a = a0 + ((a1 - a0) * k) / 20; s.lineTo(Math.cos(a) * (r - t), Math.sin(a) * (r - t)); }
  return boxUV(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 4 }), 0.6);
}
/** Horseshoe arch filled panel (for the door leaf / recess heads), spring line at y = 0. */
function archFill(r, depth) {
  const s = new THREE.Shape(), a0 = -0.3, a1 = Math.PI + 0.3;
  s.moveTo(Math.cos(a0) * r, 0);
  for (let k = 0; k <= 20; k++) { const a = a0 + ((a1 - a0) * k) / 20; s.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  s.lineTo(Math.cos(a1) * r, 0);
  return boxUV(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 4 }), 0.6);
}

/**
 * Tunis street door at facade x (place() maps facade coords → house coords; +z out of the wall).
 * @param {THREE.Group} g @param {(m: THREE.Object3D) => void} place @param {number} x @param {number} w @param {number} h
 * @param {number} seed
 */
export function medinaDoor(g, place, x, w, h, seed) {
  const m = mats(), R = rng(seed + 5), paint = m.doors[Math.floor(R() * m.doors.length)];
  const r = w / 2 + 0.04, spring = Math.max(1.5, h - r * 0.9);
  const parts = [];
  parts.push(tbox(w, spring, 0.06, paint, 0, spring / 2, -0.02, 0.8)); // leaf
  const head = mesh(archFill(w / 2, 0.06), paint); head.position.set(0, spring, -0.05); parts.push(head);
  // the studs: three columns of nail heads + a border row
  // (domed wrought-iron heads catching the light, not flat black squares that read as holes)
  for (let row = 0; row < 7; row++) for (const sx of [-0.3, 0, 0.3]) {
    const st = mesh(studGeo(), m.stud, false); st.position.set(sx * w, 0.35 + row * (spring - 0.5) / 6, 0.01); parts.push(st);
  }
  // sandstone voussoir ring with white keystones, jambs, threshold
  const ring = mesh(archRing(r + 0.26, 0.26, 0.1), m.stone); ring.position.set(0, spring, -0.02); parts.push(ring);
  for (const a of [Math.PI / 2, Math.PI / 2 + 0.55, Math.PI / 2 - 0.55, Math.PI / 2 + 1.1, Math.PI / 2 - 1.1]) {
    // (proud of the ring's face, z 0.08: they sat inside the ring and never showed)
    const k = tbox(0.13, 0.27, 0.06, m.white, Math.cos(a) * (r + 0.13), spring + Math.sin(a) * (r + 0.13), 0.085, 0.4);
    k.rotation.z = a - Math.PI / 2; parts.push(k);
  }
  for (const s of [-1, 1]) parts.push(tbox(0.26, spring, 0.1, m.stone, s * (r + 0.13), spring / 2, 0.0, 0.8));
  parts.push(tbox(w + 0.7, 0.12, 0.3, m.stone, 0, 0.06, 0.12, 0.8));
  // green glazed-tile hood on two timber brackets (above head height: 2.5 m+)
  const hy = Math.max(2.5, spring + r + 0.42);
  const hood = tbox(w + 0.9, 0.08, 0.62, m.tile, 0, hy, 0.31, 0.5); hood.rotation.x = 0.32; parts.push(hood);
  for (const s of [-1, 1]) { const b = tbox(0.07, 0.07, 0.5, m.beam, s * (w / 2 + 0.35), hy - 0.25, 0.24, 0.5); b.rotation.x = -0.55; parts.push(b); }
  for (const p of parts) { p.position.x += x; place(p); g.add(p); }
}

/**
 * Window extras at facade (x, y) for a w × h window: ground floor → a bowed iron grille (≤ 0.16 m proud);
 * upper floors → a horseshoe head in sandstone, now and then a timber mashrabiya box (above 2.4 m).
 */
export function medinaWindow(g, place, x, y, w, h, floor, R) {
  const m = mats(), parts = [];
  if (floor === 0) {
    const n = Math.max(3, Math.round(w / 0.14));
    for (let k = 0; k <= n; k++) parts.push(tbox(0.025, h + 0.1, 0.025, m.iron, -w / 2 + (w * k) / n, y, 0.14, 0.2));
    for (const dy of [-h / 2, 0, h / 2]) parts.push(tbox(w + 0.06, 0.03, 0.03, m.iron, 0, y + dy, 0.14, 0.2));
    for (const s of [-1, 1]) for (const dy of [-h / 2, h / 2]) parts.push(tbox(0.03, 0.03, 0.14, m.iron, s * (w / 2 + 0.02), y + dy, 0.07, 0.2));
  } else if (y - h / 2 > 2.4 && R() < 0.22) {
    const bw = w + 0.3, bh = h + 0.35, bd = 0.32, by = y + 0.05; // mashrabiya: lattice box on corbels
    parts.push(tbox(bw, 0.08, bd + 0.06, m.beam, 0, by - bh / 2, bd / 2, 0.5), tbox(bw + 0.1, 0.07, bd + 0.12, m.beam, 0, by + bh / 2, bd / 2, 0.5));
    for (let k = 0; k <= 6; k++) parts.push(tbox(0.03, bh, 0.03, m.lattice, -bw / 2 + (bw * k) / 6, by, bd, 0.2));
    for (let k = 0; k <= 5; k++) parts.push(tbox(bw, 0.03, 0.03, m.lattice, 0, by - bh / 2 + (bh * k) / 5, bd, 0.2));
    for (const s of [-1, 1]) parts.push(tbox(0.03, bh, bd, m.lattice, s * bw / 2, by, bd / 2, 0.3));
    for (const s of [-1, 1]) { const c = tbox(0.08, 0.3, 0.3, m.beam, s * (bw / 2 - 0.12), by - bh / 2 - 0.15, 0.15, 0.4); c.rotation.x = 0.6; parts.push(c); }
  } else {
    const head = mesh(archRing(w / 2 + 0.16, 0.13, 0.05), m.stone); head.position.set(0, y + h / 2 + 0.05, 0.0); parts.push(head);
  }
  for (const p of parts) { p.position.x += x; place(p); g.add(p); }
}

/**
 * Facade-wide medina dressing on a kit house box (w × d × h; facades F from kit-buildings).
 * @param {{front, back, east, west}} F facade frames {len, place}
 * @param {{w:number, d:number, h:number, floors:number, fh:number, variant:string, walkable:boolean, seed:number, roofY?:number,
 *   openings?:Record<string, {x:number, hw:number, y0:number, y1:number}[]>}} o facade openings keep the fallen render off them
 */
export function medinaFacade(g, F, o) {
  // (roof patches lie 2.5 cm over the shadow-casting slab: their materials carry userData.noRecv, and the kit house turns
  // off receiveShadow on the consolidated mesh, or they would self-shadow (acne) at the low March sun)
  const m = mats(), R = rng(o.seed + 11), v = o.variant;
  const add = (f, p) => { f.place(p); g.add(p); };
  for (const [name, f] of Object.entries(F)) {
    // gargoyle spouts just under the parapet, each with a rain streak down the render
    for (let x = -f.len / 2 + 1.6; x < f.len / 2 - 1.0; x += 3.6 + R() * 1.4) {
      const s = tbox(0.16, 0.14, 0.42, m.stone, x, o.h - 0.12, 0.2, 0.3); add(f, s);
      const sh = Math.min(o.h - 0.6, 1.4 + R() * 1.6), st = mesh(new THREE.PlaneGeometry(0.3 + R() * 0.2, sh), m.streak, false);
      st.position.set(x, o.h - 0.3 - sh / 2, 0.02); add(f, st);
    }
    // fallen render: rubble showing through an irregular patch (1–2 per facade)
    // (kept clear of the facade's doors, windows, shopfronts and tiled dados: o.openings[name], else skipped)
    const holes = o.openings?.[name] || [];
    const clear = (x, y, pw, ph) => holes.every((q) => Math.abs(x - q.x) > q.hw + pw / 2 + 0.12 || y + ph / 2 < q.y0 - 0.12 || y - ph / 2 > q.y1 + 0.12);
    for (let k = 0; k < 1 + (R() < 0.5 ? 1 : 0); k++) {
      const pw = 0.6 + R() * 0.9, ph = 0.35 + R() * 0.5, s = new THREE.Shape();
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, rr = 0.75 + R() * 0.3; s[i ? 'lineTo' : 'moveTo'](Math.cos(a) * pw * rr / 2, Math.sin(a) * ph * rr / 2); }
      let at = null;
      for (let t = 0; t < 12 && !at; t++) {
        const x = (R() - 0.5) * Math.max(0, f.len - 1.2 - pw), y = R() < 0.6 ? 0.55 + R() * 0.7 : 1.5 + R() * Math.max(0, o.h - 2.5);
        if (y + ph / 2 < o.h - 0.5 && clear(x, y, pw, ph)) at = [x, y];
      }
      if (!at) continue;
      const sp = mesh(boxUV(new THREE.ShapeGeometry(s).toNonIndexed(), 0.9), m.rubble, false);
      sp.position.set(at[0], at[1], 0.02); add(f, sp);
    }
    // a painted dado on some houses (front and one side)
    if (!/palace|mosque|prayer/.test(v) && (name === 'front' || name === 'east') && (o.seed % 3 === 0)) {
      add(f, tbox(f.len - 0.02, 1.0, 0.01, m.dados[o.seed % m.dados.length], 0, 0.9, 0.003, 1.2));
    }
    // laundry across an upper floor (backs and sides of the taller houses)
    if (o.floors > 1 && name !== 'front' && R() < 0.4 && f.len > 4) {
      const y = o.fh * (o.floors - 1) + 0.6 + R() * 0.4, x0 = -f.len / 2 + 0.8 + R() * 0.8, x1 = x0 + 2.2 + R() * Math.min(2, f.len - 4);
      add(f, tbox(x1 - x0, 0.012, 0.012, m.iron, (x0 + x1) / 2, y, 0.45, 0.2));
      for (const x of [x0, x1]) add(f, tbox(0.04, 0.04, 0.45, m.iron, x, y, 0.22, 0.2));
      for (let x = x0 + 0.3; x < x1 - 0.3; x += 0.45 + R() * 0.3) {
        const ch = 0.4 + R() * 0.35, c = tbox(0.32 + R() * 0.25, ch, 0.01, m.cloth[Math.floor(R() * m.cloth.length)], x, y - ch / 2, 0.45, 0.5);
        c.rotation.z = (R() - 0.5) * 0.1; add(f, c);
      }
    }
  }
  // roof screed repairs: broad, soft-edged lime-wash and screed stains flush on the roof, low contrast, no relief and no
  // hard outline (as stones they read as boulders on the walked roofs: verifier round 1)
  if (o.roofY != null) {
    const n = Math.max(1, Math.round((o.w * o.d) / 70));
    for (let k = 0; k < n; k++) {
      const pw = Math.min(o.w - 1.5, 2.2 + R() * 2.2), pd = Math.min(o.d - 1.5, 1.6 + R() * 1.6);
      if (pw < 1 || pd < 1) continue;
      const geo = new THREE.PlaneGeometry(pw, pd); geo.rotateX(-Math.PI / 2);
      const pm = mesh(geo, R() < 0.65 ? m.lime : m.tar, false);
      pm.position.set((R() - 0.5) * (o.w - 1.2 - pw), o.roofY + 0.025 + k * 0.002, (R() - 0.5) * (o.d - 1.2 - pd)); pm.rotation.y = (R() - 0.5) * 0.6;
      pm.renderOrder = 1; g.add(pm);
    }
  }
  return m;
}

/** Striped canvas awning over a shopfront at facade x (w wide, its high edge at y, `reach` m out). */
export function medinaAwning(g, place, x, w, y, reach = 1.3) {
  const m = mats();
  const a = mesh(new THREE.PlaneGeometry(w, reach), m.awning); a.rotation.x = -Math.PI / 2 + 0.3; a.position.set(x, y - Math.sin(0.3) * reach / 2, reach / 2);
  const parts = [a];
  for (const s of [-1, 1]) { const b = tbox(0.03, 0.03, reach, m.iron, x + s * (w / 2 - 0.05), y - 0.25, reach / 2, 0.2); b.rotation.x = 0.35; parts.push(b); }
  for (const p of parts) { place(p); g.add(p); }
}

/** Arched shopfront (dark recess + horseshoe sandstone frame) at facade x, w wide, spring height hs. */
export function medinaShop(g, place, x, w, hs) {
  const m = mats(), parts = [];
  parts.push(tbox(w, hs, 0.04, m.recess, x, hs / 2, 0.005, 1));
  const head = mesh(archFill(w / 2, 0.04), m.recess); head.position.set(x, hs, -0.015); parts.push(head);
  const ring = mesh(archRing(w / 2 + 0.2, 0.2, 0.08), m.stone); ring.position.set(x, hs, 0.0); parts.push(ring);
  for (const s of [-1, 1]) parts.push(tbox(0.2, hs, 0.08, m.stone, x + s * (w / 2 + 0.1), hs / 2, 0.04, 0.8));
  for (const p of parts) { place(p); g.add(p); }
}

/** Palace front: zellige dado, green-tiled pent roof at mid height, a shallow green iron balcony at y bal. */
export function palaceFront(g, place, len, h, bal) {
  const m = mats(), parts = [];
  for (const sd of [-1, 1]) parts.push(tbox(len / 2 - 1.15, 1.3, 0.012, m.zellige, sd * (len / 4 + 0.475), 1.05, 0.006, 0.32)); // the door keeps its gap
  const pent = tbox(len - 0.6, 0.08, 0.55, m.tile, 0, Math.min(h - 0.6, bal + 2.6), 0.27, 0.5); pent.rotation.x = 0.3; parts.push(pent);
  parts.push(tbox(len * 0.6, 0.12, 0.5, m.stone, 0, bal, 0.25, 0.6));
  parts.push(tbox(len * 0.6, 0.05, 0.05, m.ironGreen, 0, bal + 0.95, 0.48, 0.2));
  for (let x = -len * 0.3; x <= len * 0.3 + 1e-6; x += 0.16) parts.push(tbox(0.025, 0.9, 0.025, m.ironGreen, x, bal + 0.5, 0.48, 0.2));
  for (let x = -len * 0.28; x <= len * 0.28; x += 1.4) { const c = tbox(0.1, 0.35, 0.3, m.stone, x, bal - 0.2, 0.15, 0.4); parts.push(c); }
  for (const p of parts) { place(p); g.add(p); }
}

/** M12 market / quay goods on a crates footprint (w × d × h, local +X = heading): carts, sacks, baskets, tarps, rugs. */
export const MEDINA_GOODS_RX = /^(bale_cart|barrel_cart|crates_sacks|basket|tarp_stack|bales|cushions_rugs)$/;
export function buildMedinaGoods(p) {
  const m = mats(), v = String(p.variant), w = p.w ?? 2, d = p.d ?? 1.4, h = p.h ?? 1.2, R = rng(Math.floor((p.x ?? 0) * 131 + (p.z ?? 0) * 17));
  const g = new THREE.Group(); g.name = `medina:goods:${v}`;
  const wood = dressingMaterial('planks'), burlap = dressingMaterial('burlap'), canvas = dressingMaterial('canvas');
  const sack = (x, y, z, s = 1, rot = 0) => {
    const k = mesh(new THREE.SphereGeometry(0.3 * s, 10, 7), burlap); k.scale.set(1.25, 0.62, 0.85); k.position.set(x, y + 0.18 * s, z); k.rotation.y = rot; g.add(k);
  };
  const bale = (x, y, z, rot = 0) => { const b = tbox(0.9, 0.42, 0.5, paintedMaterial('burlap', 0xc9b27a), x, y + 0.21, z, 0.5); b.rotation.y = rot; g.add(b); };
  const barrel = (x, y, z, r = 0.3, hh = 0.8) => {
    const b = mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, hh, 12), wood); b.position.set(x, y + hh / 2, z); g.add(b);
    for (const t of [0.15, 0.85]) { const hp = mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.05, 12), m.iron); hp.position.set(x, y + hh * t, z); g.add(hp); }
  };
  if (/cart/.test(v)) {
    // two-wheeled Tunisian karrossa: plank bed on an axle, big spoked wheels, shafts resting on a prop
    const bedL = w * 0.6, bedY = 0.85, wr = 0.62, bx = -w * 0.19;
    g.add(tbox(bedL, 0.08, d * 0.8, wood, bx, bedY, 0, 0.8));
    for (const s of [-1, 1]) g.add(tbox(bedL, 0.25, 0.05, wood, bx, bedY + 0.16, s * d * 0.4, 0.8));
    for (const s of [-1, 1]) {
      const z = s * (d * 0.4 + 0.12);
      const rim = mesh(new THREE.TorusGeometry(wr, 0.045, 5, 18), dressingMaterial('beam')); rim.position.set(bx + 0.1, wr, z); g.add(rim);
      for (let k = 0; k < 6; k++) { const sp = tbox(0.04, wr * 2, 0.04, dressingMaterial('beam'), bx + 0.1, wr, z, 0.3); sp.rotation.z = (k / 6) * Math.PI; g.add(sp); }
    }
    g.add(tbox(0.08, 0.08, d + 0.3, m.iron, bx + 0.1, wr, 0, 0.3));
    for (const s of [-1, 1]) { const sh = tbox(w * 0.42, 0.07, 0.07, dressingMaterial('beam'), w * 0.28, 0.6, s * d * 0.28, 0.5); sh.rotation.z = -0.4; g.add(sh); }
    g.add(tbox(0.07, 0.4, 0.07, dressingMaterial('beam'), w * 0.44, 0.2, 0, 0.3));
    if (/barrel/.test(v)) for (const [x, z] of [[-0.45, -0.3], [-0.45, 0.32], [0.2, 0]]) barrel(x * w * 0.4 + bx, bedY + 0.04, z * d * 0.7, 0.26, 0.7);
    else for (const [x, z, y] of [[-0.3, -0.25, 0], [-0.3, 0.27, 0], [0.25, 0, 0], [0, 0, 0.42]]) bale(x * w * 0.4 + bx, bedY + 0.04 + y, z * d * 0.8, R() * 0.2);
  } else if (v === 'crates_sacks') {
    for (const [x, z] of [[-0.3, -0.2], [0.05, 0.25]]) { const c = tbox(0.75, 0.6, 0.6, wood, x * w, 0.3, z * d, 0.9); c.rotation.y = (R() - 0.5) * 0.4; g.add(c); }
    for (let k = 0; k < 6; k++) sack((R() - 0.35) * w * 0.5, k > 3 ? 0.36 : 0, (R() - 0.5) * d * 0.7, 0.9 + R() * 0.25, R() * 3);
  } else if (v === 'basket') {
    const pts = [[0.2, 0], [0.3, 0.05], [0.36, 0.35], [0.38, 0.5], [0.34, 0.5]].map(([r, y]) => new THREE.Vector2(r, y));
    const b = mesh(new THREE.LatheGeometry(pts, 14), paintedMaterial('beam', 0xb8935a)); g.add(b);
    const fill = mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.06, 14), paintedMaterial('canvas', R() < 0.5 ? 0xb8452a : 0xd0a040)); fill.position.y = 0.45; g.add(fill);
  } else if (v === 'tarp_stack') {
    g.add(tbox(w * 0.85, h * 0.8, d * 0.8, wood, 0, h * 0.4, 0, 0.9));
    const t = tbox(w * 0.92, 0.05, d * 0.9, paintedMaterial('canvas', 0x8a8466), 0, h * 0.82, 0, 0.8); g.add(t);
    for (const s of [-1, 1]) { const f = tbox(w * 0.92, h * 0.55, 0.04, paintedMaterial('canvas', 0x8a8466), 0, h * 0.55, s * d * 0.45, 0.8); f.rotation.x = s * 0.12; g.add(f); }
  } else if (v === 'bales') {
    bale(-0.2, 0, -0.15, 0.1); bale(0.15, 0, 0.25, -0.15); bale(0, 0.42, 0.05, 0.3);
  } else { // cushions_rugs: rolled rugs and a stack of cushions on a reed mat
    g.add(tbox(w, 0.03, d, paintedMaterial('canvas', 0xa88a5a), 0, 0.015, 0, 0.6));
    const cols = [0x8a2a22, 0x2f4f6a, 0xb08a3a, 0x6a3a5a];
    for (let k = 0; k < 3; k++) { const r = mesh(new THREE.CylinderGeometry(0.16, 0.16, d * 0.9, 10), paintedMaterial('canvas', cols[k % 4])); r.rotation.x = Math.PI / 2; r.position.set(-w * 0.3 + k * 0.34, 0.17 + (k === 2 ? 0.28 : 0), 0); if (k === 2) r.position.x = -w * 0.13; g.add(r); }
    for (let k = 0; k < 3; k++) g.add(tbox(0.55, 0.16, 0.55, paintedMaterial('canvas', cols[(k + 1) % 4]), w * 0.25, 0.1 + k * 0.16, 0, 0.5));
  }
  return g;
}
