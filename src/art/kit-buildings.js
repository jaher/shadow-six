/**
 * Placeholder-art pass: procedural kit buildings with the shared PBR texture library (art/dressing.js sets) for the
 * mission structures the building library has no fitting asset for, or whose walkable roof height must stay the
 * mission's (M12 "Up on the Roof", M6 ruins, M9/M11 compounds …). Each builder draws exactly the gameplay box
 * (w × d × h, local +X = heading, front = local +Z), so footprints, `elev` roofs and doors are unchanged:
 *   - buildKitHouse    walls in the theater's material (limewash / adobe / mudbrick in the desert, logs or fieldstone
 *                      in Norway, brick or render in Europe), plinth, cornice, framed windows with shutters on every
 *                      floor, a door, a flat roof with parapet (walkable roofs) or a pitched roof; variant accents
 *                      (domes, awnings, balconies, arcades, ruined tops filled with rubble)
 *   - buildKitTower    round / octagonal towers: log watchtowers, stone towers with crenels, a brick chimney, a minaret
 *   - buildKitShed     open-fronted sheds and garages (pen kind): walls on three sides, roof, posts
 * @module art/kit-buildings
 */
import * as THREE from 'three';
import { dressingMaterial, boxUV, consolidate, rng, seedOf, boulderGeometry } from './dressing.js';
import { paintedMaterial } from './kit-props.js';
import { MEDINA_RX, glazedTile, medinaDoor, medinaWindow, medinaFacade, medinaAwning, medinaShop, palaceFront } from './medina-kit.js';

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
/** Box with world-scale UVs centred at (x, y, z). */
function tbox(w, h, d, mat, x = 0, y = h / 2, z = 0, tile = 2.2) {
  const m = mesh(boxUV(new THREE.BoxGeometry(w, h, d).toNonIndexed(), tile), mat);
  m.position.set(x, y, z);
  return m;
}
const V2 = (r, y) => new THREE.Vector2(r, y);
/** Lathe with world-scale UVs (u around the circumference in metres / tile, v = height / tile). */
function tlathe(pts, seg, mat, tile = 2.2) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), seg);
  const uv = g.attributes.uv, P = g.attributes.position;
  const rmax = Math.max(...pts.map((q) => q[0]));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (2 * Math.PI * rmax) / tile, P.getY(i) / tile);
  return mesh(g, mat);
}

// ------------------------------------------------------------------------------------------ style

/** Wall / trim / roof / shutter materials for a theater + variant. */
export function houseStyle(theater, variant = '', seed = 0) {
  const v = String(variant), R = rng(seed + 17);
  const pick = (a) => a[Math.floor(R() * a.length)];
  if (/sandbag/.test(v)) return { wall: 'burlap', trim: 'beam', roof: 'beam', pitched: 'tarPaper', door: 'door', shutter: 0x5a5040, frame: 0x5b4632 };
  if (theater === 'desert') {
    const wall = /whitewash|white/.test(v) ? 'plasterWhite' : /mud|lean_to|dugout/.test(v) ? 'mudbrick' : /ochre|adobe|souk|ruin/.test(v) ? 'adobe' : pick(['limewash', 'plasterWhite', 'adobe', 'limewash']);
    return { wall, trim: 'sandstone', roof: 'screed', pitched: 'roofTerracotta', door: 'door', shutter: pick([0x3c6f86, 0x4d7a5a, 0x7a5a3a, 0x2f5f7f]), frame: 0x5b4632 };
  }
  if (theater === 'snow') {
    const wall = /stone|bunker|block/.test(v) ? 'fieldstone' : 'logHewn';
    return { wall, trim: 'fieldstone', roof: 'tarPaper', pitched: 'roofShingle', door: 'door', shutter: pick([0x7a2c22, 0x3a4a3a, 0x8a7a5a]), frame: 0xd8d2c2 };
  }
  // temperate / coast / night: brick or rendered walls, slate / tile roofs
  const wall = /brick|mine|garage|chimney/.test(v) ? 'brick' : /stone|castle|mill/.test(v) ? 'fieldstone' : /render|plaster|townhouse|corner|mansion/.test(v) ? 'plasterRough' : pick(['brick', 'plasterRough', 'brick']);
  return { wall, trim: wall === 'brick' ? 'ashlar' : 'ashlar', roof: 'tarPaper', pitched: pick(['roofSlate', 'roofTerracotta', 'roofSlate']), door: 'door', shutter: pick([0x4d5a46, 0x6a4a34, 0x3d4d5a, 0x5a5a52]), frame: 0xd8d2c2 };
}

// ------------------------------------------------------------------------------------------ facades

let GLASS = null;
/** Window panes: dark, slightly reflective glass with a faint interior glow (reads as glass, not a hole). */
export function windowGlass() {
  if (!GLASS) {
    GLASS = new THREE.MeshStandardMaterial({ color: 0x3a464c, roughness: 0.18, metalness: 0.25, emissive: 0x1a1612, emissiveIntensity: 0.6, name: 'kit:window_glass' });
    if (typeof document !== 'undefined') GLASS.map = dressingMaterial('glassDirty').map;
  }
  return GLASS;
}

/** Window (frame, dark glass, sill, shutters) on a facade: centre (x, y) in the facade plane, normal n. */
function windowAt(g, S, place, x, y, w = 0.9, h = 1.25, shutters = true) {
  const frame = paintedMaterial('weatherboard', S.frame), glass = windowGlass();
  const parts = [
    [tbox(w + 0.12, 0.08, 0.1, frame, 0, h / 2 + 0.04, 0, 0.6)], [tbox(w + 0.12, 0.08, 0.1, frame, 0, -h / 2 - 0.04, 0, 0.6)],
    [tbox(0.08, h, 0.1, frame, -w / 2 - 0.02, 0, 0, 0.6)], [tbox(0.08, h, 0.1, frame, w / 2 + 0.02, 0, 0, 0.6)],
    [tbox(0.05, h, 0.06, frame, 0, 0, 0.0, 0.6)], [tbox(w, 0.05, 0.06, frame, 0, h * 0.12, 0.0, 0.6)],
    [tbox(w + 0.25, 0.06, 0.16, dressingMaterial(S.trim), 0, -h / 2 - 0.1, 0.04, 0.6)],
    [mesh(new THREE.PlaneGeometry(w, h), glass, false)],
  ];
  if (shutters) for (const s of [-1, 1]) parts.push([tbox(w / 2, h, 0.04, paintedMaterial('weatherboard', S.shutter), s * (w * 0.75 + 0.06), 0, 0.02, 0.5)]);
  for (const [m] of parts) { m.position.x += x; m.position.y += y; place(m); g.add(m); }
}
/** Door (planks, frame, step) at facade x, ground. */
function doorAt(g, S, place, x, w = 1.15, h = 2.15) {
  const frame = dressingMaterial(S.trim);
  const parts = [tbox(w, h, 0.06, dressingMaterial(S.door), 0, h / 2, -0.02, 0.8), tbox(w + 0.3, 0.18, 0.14, frame, 0, h + 0.09, 0.02, 0.6),
    tbox(0.15, h, 0.12, frame, -w / 2 - 0.07, h / 2, 0.01, 0.6), tbox(0.15, h, 0.12, frame, w / 2 + 0.07, h / 2, 0.01, 0.6),
    tbox(w + 0.5, 0.16, 0.5, frame, 0, 0.08, 0.25, 0.6)];
  for (const m of parts) { m.position.x += x; place(m); g.add(m); }
}

/** Facade frames: each places a mesh built in facade coords (x along, y up, +z out) onto one side of the box. */
function facades(w, d) {
  const mk = (len, rotY, ox, oz) => ({ len, place: (m) => { const p = m.position.clone(); m.position.set(ox + p.x * Math.cos(rotY) + p.z * Math.sin(rotY), p.y, oz - p.x * Math.sin(rotY) + p.z * Math.cos(rotY)); m.rotation.y += rotY; } });
  return { front: mk(w, 0, 0, d / 2 + 0.01), back: mk(w, Math.PI, 0, -d / 2 - 0.01), east: mk(d, Math.PI / 2, w / 2 + 0.01, 0), west: mk(d, -Math.PI / 2, -w / 2 - 0.01, 0) };
}

// ------------------------------------------------------------------------------------------ houses

/**
 * Kit house on the gameplay box (local origin at the ground centre).
 * @param {{w:number, d:number, h:number, variant?:string, id?:string, roofWalk?:boolean, roofY?:number, ruined?:boolean,
 *   dome?:boolean, door?:boolean}} p @param {string} theater
 */
export function buildKitHouse(p, theater = 'temperate') {
  const w = p.w ?? 8, d = p.d ?? 8, h = Math.max(1.6, p.h ?? 4), v = String(p.variant || '');
  const seed = seedOf(p.id ?? `${p.x},${p.z}`), R = rng(seed), S = houseStyle(theater, v, seed);
  const g = new THREE.Group(); g.name = `kit:house:${v || 'house'}`;
  const ruined = p.ruined ?? /ruin|bombed/.test(v);
  const wallMat = dressingMaterial(S.wall), trim = dressingMaterial(S.trim);
  const top = p.roofWalk ? (p.roofY ?? h) : h;
  if (ruined) {
    // broken shell: jagged wall tops, rubble heaped inside up to the walkable top
    for (const [len, x, z, alongX] of [[w, 0, d / 2 - 0.2, true], [w, 0, -d / 2 + 0.2, true], [d, w / 2 - 0.2, 0, false], [d, -w / 2 + 0.2, 0, false]]) {
      const segs = Math.max(4, Math.round(len / 0.8));
      const geo = new THREE.BoxGeometry(alongX ? len : 0.4, top + 0.6, alongX ? 0.4 : len, alongX ? segs : 1, 1, alongX ? 1 : segs);
      const P = geo.attributes.position, drop = Array.from({ length: segs + 1 }, () => (R() < 0.35 ? R() * 0.55 : R() * 0.18));
      for (let i = 0; i < P.count; i++) if (P.getY(i) > 0) { const t = alongX ? P.getX(i) / len + 0.5 : P.getZ(i) / len + 0.5; P.setY(i, (top + 0.6) / 2 - (top + 0.6) * drop[Math.round(t * segs)]); }
      geo.computeVertexNormals();
      const m = mesh(boxUV(geo.toNonIndexed(), 2.2), wallMat); m.position.set(x, (top + 0.6) / 2, z); g.add(m);
    }
    const fill = tbox(w - 0.8, top - 0.05, d - 0.8, dressingMaterial('rubble'), 0, (top - 0.05) / 2, 0, 2.5); g.add(fill);
    for (let k = 0; k < Math.round(w * d * 0.12); k++) {
      const s = 0.2 + R() * 0.35;
      const b = mesh(boulderGeometry(s, s * 0.5, s * 0.8, Math.floor(R() * 1e9), 2), dressingMaterial(R() < 0.5 ? 'rubble' : S.wall));
      b.position.set((R() - 0.5) * (w + 1.5), R() < 0.5 ? top - 0.05 : 0, (R() - 0.5) * (d + 1.5)); b.rotation.y = R() * 6.3; g.add(b);
    }
    return consolidate(g);
  }
  // body, plinth, cornice
  g.add(tbox(w, h, d, wallMat, 0, h / 2, 0, 2.2));
  g.add(tbox(w + 0.12, 0.4, d + 0.12, trim, 0, 0.2, 0, 1.5));
  const floors = Math.max(1, Math.round(h / 3.1));
  if (floors > 1) for (let f = 1; f < floors; f++) g.add(tbox(w + 0.1, 0.14, d + 0.1, trim, 0, (h / floors) * f, 0, 1.5));
  // windows and the door
  const F = facades(w, d), fh = h / floors;
  // M12 art pass: Tunis medina facades (art/medina-kit.js) on the desert kit houses that ask for it by variant
  const medina = theater === 'desert' && MEDINA_RX.test(v), shops = medina && /souk|shop/.test(v);
  // facade openings (x centre, half width, y span incl. frames / grilles / hoods): medinaFacade keeps its patches off them
  const holes = { front: [], back: [], east: [], west: [] };
  for (const [name, f] of Object.entries(F)) {
    const n = Math.max(1, Math.floor((f.len - 1.2) / 2.8));
    for (let fl = 0; fl < floors; fl++) {
      for (let k = 0; k < n; k++) {
        const x = -f.len / 2 + (f.len / n) * (k + 0.5);
        if (fl === 0 && name === 'front' && p.door !== false && Math.abs(x) < (n % 2 ? 1.6 : 0.8) + 0.2) continue;
        if (R() < 0.12 && name !== 'front') continue;
        const wh = Math.min(1.3, fh * 0.42), y = fh * fl + Math.max(1.0, fh * 0.5);
        if (y + wh / 2 > h - 0.25) continue;
        if (medina && fl === 0 && name === 'front' && shops) continue; // the souk's ground floor is shopfronts
        windowAt(g, S, f.place, x, y, theater === 'desert' ? 0.7 : 0.95, theater === 'desert' ? wh * 0.85 : wh, theater !== 'snow' || R() < 0.7);
        if (medina) { medinaWindow(g, f.place, x, y, 0.7, wh * 0.85, fl, R); holes[name].push({ x, hw: 0.75, y0: y - wh / 2 - 0.4, y1: y + wh / 2 + 0.5 }); }
      }
    }
    if (name === 'front' && p.door !== false) (medina ? (gg, _S, pl, x, dw, dh) => medinaDoor(gg, pl, x, dw, dh, seed) : doorAt)(g, S, f.place, (n % 2 ? 0 : 0), Math.min(1.2, w * 0.25), Math.min(2.2, h - 0.4));
  }
  if (medina) {
    if (p.door !== false) holes.front.push({ x: 0, hw: Math.min(1.2, w * 0.25) / 2 + 0.85, y0: 0, y1: 3.4 });
    const shopN = Math.max(2, Math.floor(w / 3.4)), shopW = (w - 1.2) / shopN, shopH = Math.min(2.3, h * 0.4);
    if (shops) for (let k = 0; k < shopN; k++) holes.front.push({ x: -w / 2 + 0.6 + shopW * (k + 0.5), hw: shopW * 0.45 + 0.3, y0: 0, y1: shopH + shopW * 0.31 + 0.9 });
    if (/palace/.test(v) && h >= 6) holes.front.push({ x: 0, hw: w / 2, y0: 0, y1: 1.9 }, { x: 0, hw: w * 0.3 + 0.3, y0: 3.4, y1: h });
    medinaFacade(g, F, { w, d, h, floors, fh, variant: v, walkable: !!p.roofWalk, seed, roofY: top, openings: holes });
    if (shops) {
      const n = shopN, sw = shopW, hs = shopH;
      for (let k = 0; k < n; k++) {
        const x = -w / 2 + 0.6 + sw * (k + 0.5);
        if (p.door !== false && Math.abs(x) < 1.0) continue;
        medinaShop(g, F.front.place, x, sw * 0.62, hs);
        medinaAwning(g, F.front.place, x, sw * 0.9, hs + sw * 0.31 + 0.55, 1.2);
      }
    }
    if (/palace/.test(v) && h >= 6) palaceFront(g, F.front.place, w, h, 4);
  }
  // roof
  if (p.roofWalk || /flat|terrace|medina|souk|whitewash|bunkhouse|block|hq_domed|stepped|jail|palace|pavilion|corner/.test(v) || theater === 'desert') {
    g.add(tbox(w - 0.1, 0.08, d - 0.1, dressingMaterial(S.roof), 0, top - 0.03, 0, 2.5));
    const ph = theater === 'desert' ? 0.45 : 0.35, pt = 0.22;
    for (const [len, x, z, ax] of [[w, 0, d / 2 - pt / 2, true], [w, 0, -d / 2 + pt / 2, true], [d - 2 * pt, w / 2 - pt / 2, 0, false], [d - 2 * pt, -w / 2 + pt / 2, 0, false]]) {
      g.add(tbox(ax ? len : pt, ph, ax ? pt : len, wallMat, x, h + ph / 2, z, 2.2));
      g.add(tbox(ax ? len + 0.04 : pt + 0.08, 0.06, ax ? pt + 0.08 : len + 0.04, trim, x, h + ph + 0.03, z, 1.5));
    }
    // (nothing stands on a walkable roof: roof walkers must not walk through domes, stairheads or chimneys)
    if (!p.roofWalk && (p.dome || /dome|qubba/.test(v))) {
      const r = Math.min(w, d) * 0.22;
      g.add(tbox(r * 2.1, 0.5, r * 2.1, wallMat, w * 0.18, h + 0.25, -d * 0.15, 2));
      const dome = tlathe(Array.from({ length: 9 }, (_, k) => { const a = (k / 8) * Math.PI / 2; return [Math.cos(a) * r, h + 0.5 + Math.sin(a) * r * 0.95]; }), 20, /green/.test(v) ? glazedTile() : dressingMaterial(S.wall));
      dome.position.set(w * 0.18, 0, -d * 0.15); g.add(dome);
    }
    // a stairhead / water tank on desert roofs, a chimney in Europe
    if (p.roofWalk) { /* clear roof */ } else if (theater === 'desert' && w * d > 50 && R() < 0.6) g.add(tbox(1.8, 1.9, 1.6, wallMat, -w / 2 + 1.3, h + 0.95, -d / 2 + 1.2, 2.2));
    else if (theater !== 'desert') g.add(tbox(0.6, 1.2, 0.6, dressingMaterial('brick'), w * 0.3, h + 0.6, -d * 0.25, 1.2));
  } else {
    // pitched roof along the longer side, 0.35 m overhang
    const along = w >= d, L = (along ? w : d) + 0.6, span = (along ? d : w) + 0.6, rise = Math.min(4, span * 0.38);
    const shape = new THREE.Shape([V2(-span / 2, 0), V2(span / 2, 0), V2(0, rise)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false });
    geo.translate(0, 0, -L / 2);
    if (along) geo.rotateY(Math.PI / 2);
    const roof = mesh(boxUV(geo, 2), dressingMaterial(S.pitched)); roof.position.y = h; g.add(roof);
    g.add(tbox(0.5, 1.0, 0.5, dressingMaterial(theater === 'snow' ? 'fieldstone' : 'brick'), (along ? 1 : 0) * w * 0.25, h + rise * 0.6, (along ? 0 : 1) * d * 0.25, 1.2));
  }
  // variant accents
  if (/awning|souk|shop/.test(v) && !medina) {
    const aw = tbox(Math.min(w * 0.6, 4), 0.05, 1.3, paintedMaterial('canvas', 0xb8865a), 0, Math.min(2.8, h * 0.6), d / 2 + 0.65, 1.5);
    aw.rotation.x = 0.25; g.add(aw);
  }
  if (/balcon/.test(v) && floors > 1) for (let fl = 1; fl < floors; fl++) {
    g.add(tbox(w * 0.6, 0.12, 0.9, dressingMaterial('beam'), 0, fh * fl + 0.05, d / 2 + 0.45, 1.2));
    for (let x = -w * 0.3; x <= w * 0.3 + 1e-6; x += 0.35) g.add(tbox(0.05, 0.9, 0.05, dressingMaterial('beam'), x, fh * fl + 0.5, d / 2 + 0.88, 0.6));
    g.add(tbox(w * 0.6, 0.07, 0.07, dressingMaterial('beam'), 0, fh * fl + 0.95, d / 2 + 0.88, 0.6));
  }
  if (/arcade|souk/.test(v) && !medina) {
    const n = Math.max(2, Math.floor(w / 3.2)), aw2 = (w - 0.8) / n;
    for (let k = 0; k < n; k++) g.add(tbox(aw2 * 0.7, Math.min(2.8, h * 0.55), 0.05, new THREE.MeshStandardMaterial({ color: 0x15120e, roughness: 1, name: 'kit:recess' }), -w / 2 + 0.4 + aw2 * (k + 0.5), Math.min(2.8, h * 0.55) / 2 + 0.4, d / 2 + 0.03, 1));
  }
  const out = consolidate(g);
  if (medina) out.traverse((o) => { if (o.material?.userData?.noRecv) o.receiveShadow = false; });
  return out;
}

// ------------------------------------------------------------------------------------------ towers

/** Round / octagonal tower on a circle r (or the w × d box), height h, by variant. */
export function buildKitTower(p, theater = 'temperate') {
  const v = String(p.variant || ''), h = p.h ?? 8;
  const r = p.r ?? Math.min(p.w ?? 4, p.d ?? 4) / 2;
  const g = new THREE.Group(); g.name = `kit:tower:${v || 'tower'}`;
  if (/chimney/.test(v)) {
    g.add(tlathe([[r * 1.05, 0], [r * 1.05, 1.2], [r * 0.95, 1.4], [r * 0.62, h - 0.8], [r * 0.7, h - 0.6], [r * 0.7, h], [r * 0.5, h], [r * 0.5, h - 0.4]], 16, dressingMaterial('brick'), 1.2));
    g.add(tlathe([[r * 1.12, 0], [r * 1.12, 0.6], [0, 0.6]], 16, dressingMaterial('ashlar'), 1.2));
    return consolidate(g);
  }
  if (/minaret|octag/.test(v)) {
    const mat = dressingMaterial(theater === 'desert' ? 'plasterWhite' : 'ashlar'), trim = dressingMaterial('sandstone');
    g.add(tlathe([[r, 0], [r, h * 0.72], [0, h * 0.72]], 8, mat));
    g.add(tlathe([[r * 1.35, h * 0.72], [r * 1.35, h * 0.75], [r * 0.7, h * 0.75]], 8, trim));
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; g.add(tbox(0.1, 0.8, 0.1, trim, Math.cos(a) * r * 1.28, h * 0.75 + 0.4, Math.sin(a) * r * 1.28, 0.6)); }
    g.add(tlathe([[r * 0.7, h * 0.75], [r * 0.7, h * 0.9], [0, h * 0.9]], 8, mat));
    g.add(tlathe([[r * 0.78, h * 0.9], [r * 0.6, h * 0.95], [r * 0.35, h * 0.99], [0.05, h], [0.03, h + 0.6], [0, h + 0.6]], 12, dressingMaterial('roofTerracotta'), 1.2));
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2; const wdw = tbox(0.35, 0.9, 0.1, new THREE.MeshStandardMaterial({ color: 0x15120e, roughness: 1, name: 'kit:recess' }), Math.cos(a) * r * 0.98, h * 0.5, Math.sin(a) * r * 0.98, 1); wdw.rotation.y = -a + Math.PI / 2; g.add(wdw); }
    return consolidate(g);
  }
  const log = /log|timber|wood/.test(v);
  const mat = dressingMaterial(log ? 'logHewn' : theater === 'desert' ? 'sandstone' : 'fieldstone');
  g.add(tlathe([[r * 1.06, 0], [r * 1.06, 0.6], [r, 0.8], [r * 0.96, h], [0, h]], 18, mat, 2.2));
  // slit windows round the drum
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2, y = h * (0.35 + 0.3 * (k % 2));
    const sl = tbox(0.18, 0.9, 0.12, new THREE.MeshStandardMaterial({ color: 0x100e0c, roughness: 1, name: 'kit:slit' }), Math.cos(a) * r * 0.97, y, Math.sin(a) * r * 0.97, 1);
    sl.rotation.y = -a + Math.PI / 2; g.add(sl);
  }
  if (log) { // conical shingle roof with an overhang
    g.add(tlathe([[r * 1.25, h], [r * 1.2, h + 0.1], [0.08, h + r * 1.1], [0, h + r * 1.15]], 18, dressingMaterial(theater === 'snow' ? 'roofShingle' : 'roofShingle'), 1.5));
  } else { // crenellated parapet
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 1.1));
    for (let k = 0; k < n; k += 1) if (k % 2 === 0) { const a = (k / n) * Math.PI * 2; const m = tbox(0.7, 0.8, 0.5, mat, Math.cos(a) * r * 0.92, h + 0.4, Math.sin(a) * r * 0.92, 1.2); m.rotation.y = -a; g.add(m); }
    g.add(tlathe([[r * 1.04, h - 0.4], [r * 1.08, h - 0.3], [r * 1.04, h], [0, h + 0.02]], 18, dressingMaterial('ashlar'), 1.5));
  }
  return consolidate(g);
}

// ------------------------------------------------------------------------------------------ sheds

/** Open-fronted shed / garage (pen kind): three walls, open side `open` ('N'|'S'|'E'|'W'), roof, corner posts. */
export function buildKitShed(p, theater = 'temperate') {
  const w = p.w ?? 10, d = p.d ?? 8, h = p.h ?? 4, v = String(p.variant || ''), open = p.open ?? 'S';
  const S = houseStyle(theater, v, seedOf(p.id ?? 'shed'));
  const brick = /brick|garage/.test(v);
  const wallMat = dressingMaterial(brick ? 'brick' : theater === 'desert' ? 'corrRust' : /timber|plank/.test(v) ? 'planks' : 'corrGalv');
  const g = new THREE.Group(); g.name = `kit:shed:${v || 'shed'}`;
  const t = 0.3;
  const sides = { N: [w, 0, -d / 2 + t / 2, true], S: [w, 0, d / 2 - t / 2, true], E: [d, w / 2 - t / 2, 0, false], W: [d, -w / 2 + t / 2, 0, false] };
  for (const [k, [len, x, z, ax]] of Object.entries(sides)) {
    if (k === open) continue;
    g.add(tbox(ax ? len : t, h, ax ? t : len, wallMat, x, h / 2, z, 2.2));
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(tbox(0.35, h, 0.35, dressingMaterial(brick ? 'ashlar' : 'beam'), sx * (w / 2 - 0.17), h / 2, sz * (d / 2 - 0.17), 1.2));
  if (p.roofed !== false) {
    const roof = tbox(w + 0.6, 0.12, d + 0.6, dressingMaterial(brick ? 'tarPaper' : 'corrGalv'), 0, h + 0.06, 0, 2.2);
    roof.rotation.x = 0.04; g.add(roof);
  }
  g.add(tbox(w - 0.2, 0.05, d - 0.2, dressingMaterial('concrete'), 0, 0.025, 0, 2.5));
  // the open side's lintel beam
  const o = sides[open];
  if (o) g.add(tbox(o[3] ? o[0] : 0.3, 0.45, o[3] ? 0.3 : o[0], dressingMaterial(brick ? 'ashlar' : 'beam'), o[1], h - 0.22, o[2], 1.2));
  return consolidate(g);
}

// ------------------------------------------------------------------------------------------ special structures

/** Nissen hut: a corrugated-iron half cylinder along the longer side, brick / timber end walls with a door. */
export function buildNissenHut(p, theater = 'temperate') {
  const w = p.w ?? 12, d = p.d ?? 8, along = w >= d, L = along ? w : d, span = along ? d : w;
  const r = span / 2, hgt = Math.min(p.h ?? r, r * 1.05);
  const g = new THREE.Group(); g.name = 'kit:nissen';
  const shell = new THREE.CylinderGeometry(r, r, L, 28, 1, true, -Math.PI / 2, Math.PI);
  const uv = shell.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (Math.PI * r) / 1.2, uv.getY(i) * L / 1.2);
  shell.rotateX(Math.PI / 2); shell.rotateY(Math.PI / 2); shell.scale(1, hgt / r, 1);  // axis along local X, arch over the top
  if (!along) shell.rotateY(Math.PI / 2);
  const m = mesh(shell, dressingMaterial('corrGalv')); m.material.side = THREE.DoubleSide; g.add(m);
  const endMat = dressingMaterial(theater === 'snow' ? 'logHewn' : 'brick');
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape(); shape.moveTo(-r, 0);
    for (let k = 0; k <= 16; k++) { const a = Math.PI - (k / 16) * Math.PI; shape.lineTo(Math.cos(a) * r, Math.sin(a) * hgt); }
    shape.lineTo(-r, 0);
    const eg = boxUV(new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: false }), 1.5);
    eg.translate(0, 0, -0.125); eg.rotateY(Math.PI / 2);
    const e = mesh(eg, endMat); e.position.x = s * (L / 2 - 0.12);
    if (!along) { e.position.set(0, 0, s * (L / 2 - 0.12)); e.rotation.y = Math.PI / 2; }
    g.add(e);
    // door + two windows on each end
    const ex = along ? s * (L / 2 + 0.02) : 0, ez = along ? 0 : s * (L / 2 + 0.02);
    const door = tbox(along ? 0.08 : 1.2, 2.1, along ? 1.2 : 0.08, dressingMaterial('door'), ex, 1.05, ez, 0.8); g.add(door);
    for (const t of [-1, 1]) g.add(tbox(along ? 0.06 : 0.8, 0.8, along ? 0.8 : 0.06, windowGlass(), ex, 1.6, ez + (along ? t * r * 0.55 : 0) + 0, 0.8));
  }
  g.add(tbox(along ? L : span, 0.25, along ? span : L, dressingMaterial('concrete'), 0, 0.12, 0, 2.5));
  return consolidate(g);
}

/** Dock portal crane: lattice tower on a portal base, cab, slewing jib with its hook line. */
export function buildDockCrane(p) {
  const h = p.h ?? 18, g = new THREE.Group(); g.name = 'kit:dock_crane';
  const steel = paintedMaterial('steel', 0x6e5a3a), base = Math.max(1.0, Math.min(p.w ?? 1.2, 2.4));
  const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const strut = (a, b, t) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
    const m = mesh(boxUV(new THREE.BoxGeometry(t, L, t).toNonIndexed(), 0.8), steel);
    m.position.copy(A.clone().add(B).multiplyScalar(0.5));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    g.add(m);
  };
  const top = h - 2.5, half = base / 2;
  for (const [sx, sz] of legs) strut([sx * half, 0, sz * half], [sx * half * 0.8, top, sz * half * 0.8], 0.16);
  for (let y = 0; y < top; y += 2.2) for (let k = 0; k < 4; k++) {
    const [ax, az] = legs[k], [bx, bz] = legs[(k + 1) % 4], f0 = 1 - 0.2 * (y / top), f1 = 1 - 0.2 * Math.min(1, (y + 2.2) / top);
    strut([ax * half * f0, y, az * half * f0], [bx * half * f1, Math.min(top, y + 2.2), bz * half * f1], 0.07);
  }
  g.add(tbox(2.6, 2.0, 2.0, paintedMaterial('steel', 0x7a6a4a), 0, top + 1.0, 0, 1.2));      // cab
  g.add(tbox(2.8, 0.15, 2.2, dressingMaterial('tarPaper'), 0, top + 2.08, 0, 1.2));
  const jibL = Math.max(8, h * 0.7);
  for (const s of [-1, 1]) strut([0.6, top + 1.2, s * 0.35], [0.6 + jibL, top + 3.2, s * 0.15], 0.12);
  for (let x = 1.5; x < jibL; x += 1.6) strut([0.6 + x, top + 1.2 + (2 * x) / jibL, -0.33], [0.6 + x + 0.8, top + 1.2 + (2 * (x + 0.8)) / jibL, 0.33], 0.05);
  strut([-1.2, top + 2.0, 0], [-1.2, top + 0.4, 0], 0.5);    // counterweight
  const line = mesh(new THREE.CylinderGeometry(0.015, 0.015, top - 1, 4), dressingMaterial('castIron'), false);
  line.position.set(0.6 + jibL - 0.5, (top + 3) / 2 + 0.6, 0); g.add(line);
  g.add(tbox(0.3, 0.3, 0.3, dressingMaterial('castIron'), 0.6 + jibL - 0.5, 2.2, 0, 0.5));
  return consolidate(g);
}

/** Lighthouse tower: white rendered taper, red band, gallery with railing, glazed lantern and a copper cap. */
export function buildLighthouseTower(p) {
  const r = p.r ?? 2.5, h = p.h ?? 16, g = new THREE.Group(); g.name = 'kit:lighthouse';
  g.add(tlathe([[r * 1.25, 0], [r * 1.25, 1.2], [r, 1.4], [r * 0.72, h], [0, h]], 24, dressingMaterial('plasterWhite'), 2));
  g.add(tlathe([[r * 0.86, h * 0.55], [r * 0.79, h * 0.7], [0, h * 0.7]], 24, paintedMaterial('plasterWhite', 0xa83a2a), 2));
  g.add(tlathe([[r * 1.0, h], [r * 1.0, h + 0.2], [0, h + 0.2]], 24, dressingMaterial('ashlar'), 1.5));
  for (let k = 0; k < 20; k++) { const a = (k / 20) * Math.PI * 2; g.add(tbox(0.04, 0.9, 0.04, dressingMaterial('castIron'), Math.cos(a) * r * 0.97, h + 0.65, Math.sin(a) * r * 0.97, 0.5)); }
  g.add(tlathe([[r * 0.98, h + 1.1], [r * 0.98, h + 1.15], [0, h + 1.15]], 24, dressingMaterial('castIron'), 1));
  const lantern = mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 1.8, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a3438, roughness: 0.05, metalness: 0.4, emissive: 0xffd28a, emissiveIntensity: 0.12, side: THREE.DoubleSide, name: 'kit:lantern_glass' }), false);
  lantern.position.y = h + 1.1; g.add(lantern);
  g.add(tlathe([[r * 0.58, h + 2.0], [r * 0.4, h + 2.6], [0.06, h + 3.0], [0, h + 3.1]], 16, paintedMaterial('castIron', 0x3d6a58), 1));
  for (const y of [0.35, 0.6]) { const wdw = tbox(0.5, 0.9, 0.2, windowGlass(), 0, h * y, r * (1 - 0.28 * y) - 0.02, 0.6); g.add(wdw); }
  g.add(tbox(1.1, 2.1, 0.2, dressingMaterial('door'), 0, 1.05 + 0.2, r * 1.0, 0.8));
  return consolidate(g);
}

/** A4 (V-2) rocket standing on its firing table: ogive nose, tapered tail, four fins; splinter-camo olive paint. */
export function buildV2Rocket(p) {
  const r = Math.min(0.83, (p.r ?? 0.85)), h = Math.max(10, p.h ?? 14), g = new THREE.Group(); g.name = 'kit:v2';
  const body = paintedMaterial('steel', 0x56603f), dark = paintedMaterial('steel', 0x2e3326);
  const prof = [[0, 0], [r * 0.82, 0], [r * 0.9, h * 0.08], [r, h * 0.3], [r, h * 0.62], [r * 0.88, h * 0.75], [r * 0.62, h * 0.86], [r * 0.32, h * 0.95], [0.04, h], [0, h]];
  g.add(tlathe(prof, 24, body, 1.5));
  g.add(tlathe([[r * 1.01, h * 0.45], [r * 1.01, h * 0.47], [0, h * 0.47]], 24, dark, 1.5));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = new THREE.Shape([V2(0, 0), V2(r * 1.05, 0), V2(r * 0.4, h * 0.2), V2(0, h * 0.24)]);
    const fg = boxUV(new THREE.ExtrudeGeometry(fin, { depth: 0.06, bevelEnabled: false }), 1);
    fg.translate(r * 0.75, 0, -0.03);
    const f = mesh(fg, k % 2 ? body : dark); f.rotation.y = a; g.add(f);
  }
  return consolidate(g);
}

/** V-2 firing table (Brennstand): a square table on four legs with the blast deflector cone. */
export function buildFiringTable(p) {
  const w = Math.min(p.w ?? 6, 6), g = new THREE.Group(); g.name = 'kit:firing_table';
  const steel = paintedMaterial('steel', 0x4b5440);
  g.add(tbox(w, 0.25, w, dressingMaterial('concrete'), 0, 0.12, 0, 2));
  const t = 3.2;
  g.add(tbox(t, 0.12, t, steel, 0, 0.9, 0, 1));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(tbox(0.25, 0.7, 0.25, steel, sx * (t / 2 - 0.15), 0.6, sz * (t / 2 - 0.15), 0.6));
  g.add(tlathe([[0.05, 0.25], [1.1, 0.25], [0.2, 0.8], [0, 0.8]], 18, dressingMaterial('castIron'), 1));
  return consolidate(g);
}

/** Timber pithead over a mine adit: plank shed, A-frame headgear with its sheave wheel. */
export function buildMineHeadframe(p, theater = 'temperate') {
  const w = p.w ?? 7, d = p.d ?? 10, h = p.h ?? 4.5, g = new THREE.Group(); g.name = 'kit:headframe';
  g.add(buildKitHouse({ ...p, w, d, h: Math.min(h, 4), variant: 'timber_shed', roofWalk: false }, theater));
  const beam = dressingMaterial('beam'), top = h + 6;
  const strut = (a, b, t) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
    const m = mesh(boxUV(new THREE.BoxGeometry(t, L, t).toNonIndexed(), 1), beam);
    m.position.copy(A.clone().add(B).multiplyScalar(0.5));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    g.add(m);
  };
  for (const s of [-1, 1]) { strut([s * 1.6, 0, -d / 2 + 1], [s * 0.5, top, -d / 2 + 1.5], 0.3); strut([s * 1.6, 0, -d / 2 + 4], [s * 0.5, top, -d / 2 + 1.5], 0.25); }
  for (let y = 2; y < top; y += 2.5) strut([-1.4, y, -d / 2 + 1.2], [1.4, y, -d / 2 + 1.2], 0.15);
  const wheel = mesh(new THREE.TorusGeometry(1.0, 0.08, 6, 20), dressingMaterial('castIron'));
  wheel.position.set(0, top + 0.6, -d / 2 + 1.5); wheel.rotation.y = Math.PI / 2; g.add(wheel);
  return g;
}

/** Inclined coal conveyor: lattice gallery on trestles rising along local +X to `h`, belt and rollers. */
export function buildConveyor(p) {
  const w = p.w ?? 18, d = p.d ?? 1.6, h = p.h ?? 3, g = new THREE.Group(); g.name = 'kit:conveyor';
  const steel = paintedMaterial('steel', 0x5a4a3a), slope = Math.atan2(h - 0.8, w);
  const deck = tbox(Math.hypot(w, h - 0.8), 0.12, d, dressingMaterial('planks'), 0, 0.4 + (h - 0.8) / 2, 0, 1);
  deck.rotation.z = slope; g.add(deck);
  const belt = tbox(Math.hypot(w, h - 0.8), 0.05, d * 0.6, paintedMaterial('tarPaper', 0x2a2826), 0, 0.5 + (h - 0.8) / 2, 0, 1);
  belt.rotation.z = slope; g.add(belt);
  for (const s of [-1, 1]) { const rail = tbox(Math.hypot(w, h - 0.8), 0.08, 0.08, steel, 0, 1.3 + (h - 0.8) / 2, s * d / 2, 1); rail.rotation.z = slope; g.add(rail); }
  for (let x = -w / 2 + 1; x < w / 2; x += 3) {
    const y = 0.4 + (h - 0.8) * ((x + w / 2) / w);
    for (const s of [-1, 1]) g.add(tbox(0.15, y, 0.15, steel, x, y / 2, s * (d / 2 - 0.05), 0.6));
  }
  return consolidate(g);
}
