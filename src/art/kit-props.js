/**
 * Placeholder-art pass (user: "extremely realistic and faithful"; the audit tools/audit/placeholder-audit.mjs found
 * grey cylinders and boxes standing in for small props): procedural kit models with the shared PBR texture library
 * (art/dressing.js sets, lib/1k) for the catalogue props the building library does not model —
 *   - fuel drums / casks (`barrels` variants, the explosive Barrel entity), steel 200 l drums with rolling hoops,
 *     chimes and bungs, or wooden casks with iron hoops
 *   - lamp posts (the period street lamps of art/furniture/lamps.js), a ground searchlight on its pedestal
 *   - signs (minefield boards, unit boards, quay bollards, level-crossing booms, tram stops, hydrants, parachutes)
 *   - wells, fountains, monuments, a Morris column, a caged water tank
 *   - detonators, lever boxes
 * Every builder returns an Object3D in the prop's local frame (origin on the ground at the prop centre, local +X =
 * heading); footprints stay the catalogue's (gameplay) ones. Plain colours in node (unit tests).
 * @module art/kit-props
 */
import * as THREE from 'three';
import { dressingMaterial, consolidate, rng, seedOf, boxUV, buildWall, boulderGeometry } from './dressing.js';
import { lampParts } from './furniture/lamps.js';
import { propParts, signTexture, fenceParts } from './furniture/street-props.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HAS_DOM = typeof document !== 'undefined';
const V2 = (r, y) => new THREE.Vector2(r, y);
const lathe = (pts, seg = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), seg);

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
/** Box with world-scale UVs (tile m per texture repeat), centred at (x, y, z). */
function tbox(w, h, d, mat, x = 0, y = h / 2, z = 0, tile = 1.2) {
  const g = boxUV(new THREE.BoxGeometry(w, h, d).toNonIndexed(), tile);
  const m = mesh(g, mat); m.position.set(x, y, z);
  return m;
}
/** Cylinder (axis y, base at y0) with world-scale UVs around the circumference. */
function tcyl(rt, rb, h, mat, x = 0, y0 = 0, z = 0, seg = 16, tile = 1.2) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  const uv = g.attributes.uv, k = (2 * Math.PI * Math.max(rt, rb)) / tile;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * (h / tile));
  const m = mesh(g, mat); m.position.set(x, y0 + h / 2, z);
  return m;
}

// ------------------------------------------------------------------------------------------ painted finishes

const PAINT = new Map();
/** A dressing set re-tinted (painted steel drums, enamel boards): textures shared, colour own. Cached. */
export function paintedMaterial(set, color, extra = {}) {
  const key = `${set}|${color}|${JSON.stringify(extra)}|${HAS_DOM ? dressingMaterial(set).uuid : 'node'}`;
  if (PAINT.has(key)) return PAINT.get(key);
  const m = dressingMaterial(set).clone();
  m.color.set(color);
  Object.assign(m, extra);
  m.name = `kit:${set}:${color.toString(16)}`;
  PAINT.set(key, m);
  return m;
}

// ------------------------------------------------------------------------------------------ drums and casks

let DRUM = null;
/** 200 l steel drum: chimes, two rolling hoops, slightly domed lid (r 0.29, h 0.88), base at y = 0. */
function drumGeometry() {
  if (DRUM) return DRUM;
  const r = 0.29, P = [[0, 0.004], [0.26, 0], [0.288, 0.006], [0.292, 0.022], [0.281, 0.034], [0.281, 0.27], [0.292, 0.285], [0.292, 0.3], [0.281, 0.315],
    [0.281, 0.565], [0.292, 0.58], [0.292, 0.595], [0.281, 0.61], [0.281, 0.846], [0.292, 0.858], [0.288, 0.876], [0.27, 0.88], [0.262, 0.872], [0.15, 0.876], [0, 0.878]];
  const body = lathe(P.map(([a, y]) => [a * r / 0.29, y]), 24);
  const bung = (x, z, rr) => new THREE.CylinderGeometry(rr, rr, 0.022, 10).translate(x, 0.887, z);
  DRUM = mergeGeometries([body.toNonIndexed(), bung(0.17, 0.05, 0.035).toNonIndexed(), bung(-0.15, -0.08, 0.022).toNonIndexed()], false);
  DRUM.computeVertexNormals();
  return DRUM;
}
let CASK = null;
/** Wooden cask (bulged staves, h 0.9) and its iron hoops, base at y = 0. */
function caskGeometry() {
  if (CASK) return CASK;
  const staves = [], hoops = [];
  const n = 14;
  for (let k = 0; k <= n; k++) { const t = k / n, y = 0.02 + t * 0.86; staves.push([0.25 + 0.06 * Math.sin(Math.PI * t), y]); }
  const st = lathe([[0, 0.03], [0.24, 0.03], ...staves, [0.235, 0.88], [0, 0.875]], 20);
  for (const t of [0.08, 0.3, 0.7, 0.92]) {
    const y = 0.02 + t * 0.86, r = 0.25 + 0.06 * Math.sin(Math.PI * t) + 0.006;
    hoops.push(lathe([[r, y - 0.022], [r + 0.004, y], [r, y + 0.022]], 20).toNonIndexed());
  }
  CASK = { staves: st, hoops: mergeGeometries(hoops, false) };
  return CASK;
}

/** Drum paint per `barrels` variant (fuel = Wehrmacht dark grey / olive, inert = rust, yellow, black oil). */
function drumPaints(variant) {
  const v = String(variant || '');
  if (/yellow/.test(v)) return [0xb8942c, 0xa9852a, 0xc29d34];
  if (/oil|black/.test(v)) return [0x2d2b28, 0x34312c, 0x3a3630];
  if (/inert|rust|empty/.test(v)) return [0x6a4a34, 0x5e5650, 0x725038];
  if (/fuel|petrol|jerry|explosive/.test(v)) return [0x4a5038, 0x55574a, 0x4d5340];
  return [0x4a5038, 0x6a4a34, 0x55574a];
}

/** One steel drum Mesh (base on the ground), painted. */
export function fuelDrum(color = 0x7a2a1a, rustOnly = false) {
  const m = mesh(drumGeometry(), rustOnly ? dressingMaterial('steel') : paintedMaterial('steel', color));
  m.name = 'kit:drum';
  return m;
}

/** Explosive fuel drum of the Barrel entity: a red-painted 200 l drum (the original's red barrels). */
export function buildExplosiveDrum(variant = '') {
  const g = new THREE.Group(); g.name = 'kit:explosive_drum';
  const v = String(variant || '');
  const d = fuelDrum(/blue/.test(v) ? 0x2c4a6e : /yellow/.test(v) ? 0xb8942c : /green|olive/.test(v) ? 0x4a5038 : 0x8a2c1c);
  d.scale.set(1.1, 1.02, 1.1);   // r 0.32, h 0.9 like the gameplay barrel
  d.rotation.y = 0.6;
  g.add(d);
  return g;
}

/** `barrels` cluster: three drums (or casks) inside the 1.2 × 1.1 footprint, seeded tilt / turn. */
export function buildDrumCluster(p) {
  const g = new THREE.Group(); g.name = 'kit:barrels';
  const R = rng(seedOf(p.id ?? `${p.x},${p.z}`));
  const wood = /wood|cask|wine|beer/.test(String(p.variant || ''));
  const offs = [[-0.3, -0.2], [0.3, -0.2], [0, 0.32]];
  const paints = drumPaints(p.variant);
  offs.forEach(([ox, oz], k) => {
    if (wood) {
      const c = caskGeometry();
      const s = mesh(c.staves, dressingMaterial('planks')), h = mesh(c.hoops, dressingMaterial('castIron'));
      for (const o of [s, h]) { o.position.set(ox, 0, oz); o.rotation.y = R() * 6.28; g.add(o); }
    } else {
      const d = fuelDrum(paints[k % paints.length]);
      d.position.set(ox, 0, oz); d.rotation.set((R() - 0.5) * 0.03, R() * 6.28, (R() - 0.5) * 0.03);
      g.add(d);
    }
  });
  return consolidate(g);
}

// ------------------------------------------------------------------------------------------ lamps, searchlight

/** furniture part key → kit material (textured iron / creosoted timber; lantern glass keeps its emissive shader). */
function partMaterial(key) {
  switch (key) {
    case 'iron': case 'hood': return dressingMaterial('castIron');
    case 'wood': case 'timber': return dressingMaterial('creosote');
    case 'planks': return dressingMaterial('planks');
    case 'stone': return dressingMaterial('ashlar');
    case 'glass': return new THREE.MeshStandardMaterial({ color: 0x1a1a16, roughness: 0.2, metalness: 0.1, emissive: 0xffb060, emissiveIntensity: 0.05, name: 'kit:lamp_glass' });
    case 'enamel': return new THREE.MeshStandardMaterial({ color: 0xe2ded2, roughness: 0.35, side: THREE.DoubleSide, name: 'kit:enamel' });
    case 'wire': return new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.55, metalness: 0.4, name: 'kit:wire' });
    case 'white': return paintedMaterial('planks', 0xe6e3da);
    case 'red': return paintedMaterial('planks', 0xa3261e);
    case 'poster': return new THREE.MeshStandardMaterial({ color: 0xffffff, map: signTexture('poster'), roughness: 0.85, name: 'kit:poster' });
    default: return dressingMaterial('steel');
  }
}
/** Furniture part lists ({key: BufferGeometry[]}) → one merged mesh per material. */
export function partsToGroup(P, name, signMat = null) {
  const g = new THREE.Group(); g.name = name;
  for (const [k, list] of Object.entries(P)) {
    if (!Array.isArray(list) || !list.length) continue;
    const geo = mergeGeometries(list.map((q) => (q.index ? q.toNonIndexed() : q)).map((q) => { for (const a of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(a)) q.deleteAttribute(a); if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); return q; }), false);
    const m = mesh(geo, k === 'sign' && signMat ? signMat : partMaterial(k), k !== 'glass' && k !== 'wire');
    m.name = `${name}:${k}`;
    g.add(m);
  }
  return g;
}

/** Lamp variant for a `lamp_post` structure (mission variant, else by theater). */
export function lampVariantOf(variant, theater) {
  const v = String(variant || '');
  if (/flood|loudspeaker/.test(v)) return 'floodlight';
  if (/harbour|quay/.test(v)) return 'harbour';
  if (/platform|station/.test(v)) return 'platform';
  if (/double/.test(v)) return 'paris_double';
  if (/wood|norway|pole/.test(v)) return 'norway_wood';
  if (/cast_iron|paris|street|town/.test(v)) return 'paris_single';
  return theater === 'snow' ? 'norway_wood' : theater === 'desert' ? 'platform' : 'paris_single';
}

/** A `lamp_post` structure: the period street lamp of art/furniture/lamps.js, arm towards local +X. */
export function buildLampPost(p, theater) {
  const variant = lampVariantOf(p.variant, theater);
  const { parts } = lampParts(variant, { hooded: true });
  const g = partsToGroup(parts, `kit:lamp:${variant}`);
  // the floodlight's loudspeaker (M17 "floodlight_loudspeaker"): a horn under the floods
  if (/loudspeaker/.test(String(p.variant || ''))) {
    const horn = mesh(lathe([[0.05, 0], [0.07, 0.08], [0.16, 0.34], [0.2, 0.42]], 14), dressingMaterial('steel'));
    horn.rotation.z = -Math.PI / 2 + 0.35; horn.position.set(0.15, 5.9, 0);
    g.add(horn);
  }
  return g;
}

/** Ground searchlight (60 cm Flakscheinwerfer style): cross base, pedestal, yoke, drum with louvred lens, cable. */
export function buildGroundSearchlight(p) {
  const g = new THREE.Group(); g.name = 'kit:searchlight';
  const steel = paintedMaterial('steel', 0x5a5e52), iron = dressingMaterial('castIron');
  for (const a of [0, Math.PI / 2]) { const leg = tbox(1.1, 0.08, 0.12, iron, 0, 0.04); leg.rotation.y = a; g.add(leg); }
  g.add(tcyl(0.14, 0.2, 0.62, steel, 0, 0.08, 0, 14, 0.8));
  g.add(tcyl(0.22, 0.22, 0.06, iron, 0, 0.7, 0, 18, 0.8));
  for (const s of [-1, 1]) g.add(tbox(0.06, 0.55, 0.08, steel, 0, 0.98, s * 0.36));
  const drum = new THREE.Group(); drum.position.y = 1.2; drum.rotation.z = 0.18;
  const body = mesh(lathe([[0, -0.32], [0.24, -0.34], [0.33, -0.25], [0.34, 0.2], [0.35, 0.26], [0.33, 0.28]], 22), steel);
  body.rotation.z = -Math.PI / 2; drum.add(body);
  const lens = mesh(new THREE.CircleGeometry(0.31, 22), new THREE.MeshStandardMaterial({ color: 0x9fb2bc, roughness: 0.05, metalness: 0.6, emissive: 0x334455, emissiveIntensity: 0.15, name: 'kit:lens' }), false);
  lens.rotation.y = Math.PI / 2; lens.position.x = 0.282; drum.add(lens);
  for (let k = -2; k <= 2; k++) { const l = tbox(0.02, 0.6, 0.012, iron, 0.29, 0, k * 0.1, 0.5); drum.add(l); }
  const vent = tcyl(0.08, 0.1, 0.12, iron, -0.05, 0.3, 0, 10, 0.5); drum.add(vent);
  g.add(drum);
  const cable = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.3, 0.12), new THREE.Vector3(0.1, 0.05, 0.5), new THREE.Vector3(0.6, 0.02, 1.2)]), 10, 0.018, 5, false), iron);
  g.add(cable);
  return g;
}

// ------------------------------------------------------------------------------------------ signs and street props

/** Text board material (canvas sign texture, plain in node). */
function boardMaterial(kind, text) {
  const t = signTexture(kind, text);
  return new THREE.MeshStandardMaterial({ color: 0xffffff, map: t, roughness: 0.6, name: `kit:sign:${kind}:${text.replace(/\W+/g, '_')}` });
}
/** A board on one or two posts, its face towards local +Z. */
function postBoard(g, { w = 0.7, h = 0.45, y = 1.6, posts = 1, kind = 'wehrmacht', text = '' }) {
  const post = dressingMaterial('creosote');
  if (posts === 1) g.add(tbox(0.08, y + h / 2, 0.08, post, 0, (y + h / 2) / 2, -0.03, 0.8));
  else for (const s of [-1, 1]) g.add(tbox(0.08, y + h / 2, 0.08, post, s * (w / 2 - 0.08), (y + h / 2) / 2, -0.03, 0.8));
  g.add(tbox(w + 0.04, h + 0.04, 0.03, dressingMaterial('planks'), 0, y, 0.0, 0.6));
  const face = mesh(new THREE.PlaneGeometry(w, h), boardMaterial(kind, text), false);
  face.position.set(0, y, 0.017); g.add(face);
  const back = face.clone(); back.rotation.y = Math.PI; back.position.z = -0.017; g.add(back);
}

/** Granite quay bollard (mooring post): turned body with a cap lip. */
function bollard(g) {
  g.add(mesh(lathe([[0, 0], [0.24, 0], [0.24, 0.08], [0.19, 0.12], [0.17, 0.45], [0.2, 0.52], [0.22, 0.6], [0.15, 0.66], [0, 0.68]], 18), dressingMaterial('granite')));
}
/** Fire hydrant (pillar type): iron pillar, cap, two side outlets, painted red. */
function hydrant(g) {
  const red = paintedMaterial('castIron', 0x9a2a1e);
  g.add(mesh(lathe([[0, 0], [0.16, 0], [0.16, 0.06], [0.11, 0.1], [0.1, 0.62], [0.13, 0.66], [0.12, 0.72], [0.07, 0.8], [0.03, 0.86], [0, 0.87]], 16), red));
  for (const s of [-1, 1]) { const o = tcyl(0.045, 0.045, 0.16, red, 0, 0, 0, 10, 0.4); o.rotation.z = Math.PI / 2; o.position.set(s * 0.15, 0.48, 0); g.add(o); }
}
/** Level-crossing boom: striped arm on a post with a counterweight, lowered across the road (local +X). */
function crossingBoom(g, p) {
  const L = Math.max(3, (p.w ?? 0) > 1 ? p.w : 5.5);
  const white = paintedMaterial('planks', 0xe6e3da), red = paintedMaterial('planks', 0xa3261e);
  g.add(tbox(0.3, 1.05, 0.3, white, 0, 0.525, 0, 0.8));
  g.add(tbox(0.36, 0.36, 0.36, dressingMaterial('castIron'), -0.3, 1.0, 0, 0.6));
  const n = 8;
  for (let k = 0; k < n; k++) g.add(tbox(L / n, 0.1, 0.1, k % 2 ? white : red, 0.2 + (k + 0.5) * (L / n), 1.0, 0, 0.6));
  g.add(tbox(0.1, 0.9, 0.1, dressingMaterial('creosote'), 0.2 + L - 0.1, 0.45, 0, 0.6)); // rest post
}
/** Tram stop: enamel stop sign on an iron post with a timetable box. */
function tramStop(g) {
  const iron = dressingMaterial('castIron');
  g.add(tcyl(0.045, 0.06, 2.7, iron, 0, 0, 0, 10, 0.8));
  const face = mesh(new THREE.CircleGeometry(0.28, 24), boardMaterial('plate', 'TRAM'), false);
  face.position.set(0, 2.45, 0.05); g.add(face);
  g.add(tcyl(0.3, 0.3, 0.04, iron, 0, 2.45, 0.02, 24, 0.6).rotateX(Math.PI / 2));
  g.add(tbox(0.4, 0.55, 0.08, paintedMaterial('steel', 0x2f4a3a), 0, 1.5, 0.06, 0.6));
}
/** A collapsed parachute: a crumpled silk heap (draped variant over a crate: taller), shroud lines. */
function parachute(g, p, R) {
  const draped = /drape/.test(String(p.variant || ''));
  const silk = new THREE.MeshStandardMaterial({ color: 0xd9d3bf, roughness: 0.85, side: THREE.DoubleSide, name: 'kit:silk' });
  if (HAS_DOM) { silk.map = dressingMaterial('canvas').map; silk.normalMap = dressingMaterial('canvas').normalMap; }
  const geo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), a = Math.atan2(z, x);
    const fold = 1 + 0.18 * Math.sin(a * 7 + R() * 0.3) + 0.08 * (R() - 0.5);
    P.setXYZ(i, x * 1.4 * fold, y * (draped ? 1.1 : 0.35) * (0.75 + 0.25 * Math.cos(a * 3)), z * 1.1 * fold);
  }
  geo.computeVertexNormals();
  const heap = mesh(geo, silk); heap.position.y = draped ? 0.05 : 0.02; g.add(heap);
  if (draped) g.add(tbox(0.9, 0.7, 0.7, dressingMaterial('planks'), 0, 0.35, 0, 0.6));
  const cord = paintedMaterial('canvas', 0xbdb59c);
  for (let k = 0; k < 5; k++) {
    const a = R() * 6.28, r = 1.3 + R() * 0.6;
    g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(Math.cos(a) * 0.8, 0.05, Math.sin(a) * 0.6), new THREE.Vector3(Math.cos(a) * r, 0.02, Math.sin(a) * r * 0.8), new THREE.Vector3(Math.cos(a + 0.4) * (r + 0.7), 0.01, Math.sin(a + 0.4) * (r + 0.4))]), 8, 0.008, 3, false), cord, false));
  }
}
/** Target frame with a soldier silhouette (rifle range). */
function targetFrame(g) {
  const wood = dressingMaterial('planks');
  for (const s of [-1, 1]) g.add(tbox(0.07, 1.9, 0.07, dressingMaterial('creosote'), s * 0.48, 0.95, 0, 0.6));
  g.add(tbox(1.0, 0.06, 0.06, wood, 0, 1.86, 0, 0.6));
  const shape = new THREE.Shape();
  shape.moveTo(-0.32, 0.2); shape.lineTo(-0.32, 0.9); shape.quadraticCurveTo(-0.3, 1.1, -0.14, 1.12); shape.lineTo(-0.1, 1.25);
  shape.absarc(0, 1.38, 0.13, -Math.PI * 0.75, Math.PI * 1.75, false); shape.lineTo(0.14, 1.12); shape.quadraticCurveTo(0.3, 1.1, 0.32, 0.9); shape.lineTo(0.32, 0.2); shape.lineTo(-0.32, 0.2);
  const sil = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false }), paintedMaterial('planks', 0x3d4a30));
  sil.position.z = -0.01; g.add(sil);
}

/** `sign` structures by variant (flagpoles stay with props.js / art/flags.js). */
export function buildSignVariant(p) {
  const v = String(p.variant || ''), g = new THREE.Group(); g.name = `kit:sign:${v || 'board'}`;
  const R = rng(seedOf(p.id ?? `${p.x},${p.z}`));
  if (/bollard/.test(v)) bollard(g);
  else if (/hydrant/.test(v)) hydrant(g);
  else if (/crossing_boom|boom/.test(v)) crossingBoom(g, p);
  else if (/tram_stop/.test(v)) tramStop(g);
  else if (/parachute/.test(v)) parachute(g, p, R);
  else if (/target/.test(v)) targetFrame(g);
  else if (/mine/.test(v)) postBoard(g, { w: 0.62, h: 0.42, y: 0.95, kind: 'wehrmacht', text: 'ACHTUNG\nMINEN' });
  else if (/kommandantur/.test(v)) postBoard(g, { w: 1.0, h: 0.5, y: 1.55, posts: 2, kind: 'wehrmacht', text: 'KOMMANDANTUR' });
  else if (/verboten|sperr/.test(v)) postBoard(g, { w: 0.9, h: 0.5, y: 1.4, posts: 2, kind: 'wehrmacht', text: 'SPERRGEBIET' });
  else if (/plate|street|town/.test(v)) postBoard(g, { w: 0.7, h: 0.35, y: 2.0, kind: 'plate', text: p.text || '' });
  else if (p.text) postBoard(g, { w: Math.min(1.6, 0.3 + 0.075 * String(p.text).length), h: 0.4, y: Math.max(1.0, (p.h ?? 2) - 0.3), posts: 2, kind: 'plate', text: p.text });
  else postBoard(g, { w: 0.75, h: 0.42, y: Math.max(1.0, (p.h ?? 2) - 0.3), kind: 'wehrmacht', text: 'HALT!' });
  return consolidate(g);
}

// ------------------------------------------------------------------------------------------ wells, fountains, monuments

/** Village well: fieldstone drum with a coping, timber frame and pent roof, windlass and bucket. */
function well(g, p, theater) {
  const r = Math.max(0.6, p.r ?? 0.8), desert = theater === 'desert';
  const stone = dressingMaterial(desert ? 'mudRender' : 'fieldstone');
  g.add(mesh(lathe([[r * 0.78, 0.0], [r, 0], [r, 0.82], [r * 1.04, 0.84], [r * 1.04, 0.92], [r * 0.78, 0.92], [r * 0.78, 0.1]], 22), stone));
  g.add(mesh(new THREE.CircleGeometry(r * 0.78, 18).rotateX(-Math.PI / 2).translate(0, 0.25, 0), new THREE.MeshStandardMaterial({ color: 0x0c0d0c, roughness: 1, name: 'kit:well_dark' }), false));
  if (desert) return;
  const beam = dressingMaterial('beam');
  for (const s of [-1, 1]) g.add(tbox(0.12, 2.1, 0.12, beam, s * (r + 0.02), 1.05, 0, 0.8));
  const ax = tcyl(0.06, 0.06, 2 * r + 0.3, beam, 0, 1.45, 0, 8, 0.6); ax.rotation.z = Math.PI / 2; ax.position.set(0, 1.45, 0); g.add(ax);
  for (const s of [-1, 1]) { const roof = tbox(2 * r + 0.6, 0.05, r * 0.9, dressingMaterial('roofShingle'), 0, 2.25, s * r * 0.38, 0.8); roof.rotation.x = s * 0.55; g.add(roof); }
  g.add(tcyl(0.12, 0.1, 0.22, dressingMaterial('planks'), 0.15, 0.95, 0, 10, 0.5));
}
/** Town fountain: a stepped stone basin with water, a central column / statue pedestal. */
function fountain(g, p) {
  const r = Math.max(1.2, Math.min(p.w ?? 4, p.d ?? 4) / 2 - 0.1), stone = dressingMaterial('ashlar');
  g.add(mesh(lathe([[r + 0.25, 0], [r + 0.25, 0.12], [r, 0.14], [r, 0.62], [r - 0.18, 0.62], [r - 0.18, 0.2], [0, 0.2]], 32), stone));
  const water = mesh(new THREE.CircleGeometry(r - 0.18, 32).rotateX(-Math.PI / 2).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x2c3a3a, roughness: 0.08, metalness: 0.3, name: 'kit:water' }), false);
  g.add(water);
  const H = Math.max(1.6, Math.min(3.2, (p.h ?? 1.5) + 1.2));
  g.add(mesh(lathe([[0.42, 0.2], [0.42, 0.45], [0.3, 0.55], [0.22, 0.6], [0.2, H * 0.62], [0.55, H * 0.66], [0.6, H * 0.7], [0.18, H * 0.74], [0.16, H * 0.92], [0.24, H], [0, H]], 20), stone));
}
/** Monument / statue: a stepped plinth, a dado with its inscription panel and a bronze figure on top. */
function monument(g, p) {
  const w = Math.min(p.w ?? 2.6, 3.2), stone = dressingMaterial('ashlar'), H = Math.max(2.5, p.h ?? 3);
  g.add(tbox(w, 0.3, w, stone, 0, 0.15, 0, 1.2));
  g.add(tbox(w * 0.78, 0.3, w * 0.78, stone, 0, 0.45, 0, 1.2));
  const dh = H * 0.42;
  g.add(tbox(w * 0.5, dh, w * 0.5, stone, 0, 0.6 + dh / 2, 0, 1.0));
  g.add(tbox(w * 0.58, 0.16, w * 0.58, stone, 0, 0.6 + dh + 0.08, 0, 1.0));
  const bronze = new THREE.MeshStandardMaterial({ color: 0x3e4a3c, roughness: 0.45, metalness: 0.75, name: 'kit:bronze' });
  if (HAS_DOM) { bronze.map = dressingMaterial('castIron').map; bronze.normalMap = dressingMaterial('castIron').normalMap; }
  const y0 = 0.6 + dh + 0.16, fh = Math.max(1.1, H - y0 + 0.4);
  // standing figure: legs, coat, torso, head, an arm raised
  const fig = new THREE.Group(); fig.position.y = y0;
  fig.add(mesh(lathe([[0.3, 0], [0.28, fh * 0.45], [0.22, fh * 0.55], [0.2, fh * 0.72], [0.24, fh * 0.78], [0.14, fh * 0.82], [0, fh * 0.83]], 12), bronze));
  const head = mesh(new THREE.SphereGeometry(fh * 0.07, 12, 9), bronze); head.position.y = fh * 0.89; fig.add(head);
  const arm = tbox(0.08, fh * 0.32, 0.08, bronze, 0.22, fh * 0.86, 0, 0.5); arm.rotation.z = -0.5; fig.add(arm);
  g.add(fig);
}
/** Riveted water tank on a steel trestle with a ladder (caged variant: a mesh guard round the ladder). */
function waterTank(g, p) {
  const w = Math.min(p.w ?? 2.3, 2.6), H = p.h ?? 3, steel = paintedMaterial('steel', 0x5a5e52), legH = H * 0.5;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(tbox(0.1, legH, 0.1, steel, sx * (w / 2 - 0.1), legH / 2, sz * (w / 2 - 0.1), 0.6));
  for (const s of [-1, 1]) { const b = tbox(w * 1.25, 0.05, 0.05, steel, 0, legH * 0.5, s * (w / 2 - 0.1), 0.6); b.rotation.z = 0.7 * s; g.add(b); }
  g.add(tcyl(w / 2, w / 2, H - legH, dressingMaterial('corrRust'), 0, legH, 0, 20, 1.2));
  g.add(mesh(lathe([[w / 2 + 0.02, 0], [w * 0.2, 0.2], [0, 0.24]], 20).translate(0, H, 0), steel));
  for (const s of [-1, 1]) g.add(tbox(0.04, H, 0.04, steel, w / 2 + 0.12, H / 2, s * 0.2, 0.5));
  for (let y = 0.3; y < H; y += 0.3) g.add(tbox(0.03, 0.03, 0.4, steel, w / 2 + 0.12, y, 0, 0.5));
}

/** `well` structures by variant. */
export function buildWellVariant(p, theater) {
  const v = String(p.variant || ''), g = new THREE.Group(); g.name = `kit:well:${v || 'well'}`;
  if (/fountain/.test(v)) fountain(g, p);
  else if (/morris/.test(v)) return partsToGroup(propParts('morris_column'), 'kit:morris');
  else if (/monument|statue|memorial/.test(v)) monument(g, p);
  else if (/tank/.test(v)) waterTank(g, p);
  else well(g, p, theater);
  return consolidate(g);
}

// ------------------------------------------------------------------------------------------ small devices

/** Plunger detonator box with its T handle and a cable reel. */
export function buildDetonator() {
  const g = new THREE.Group(); g.name = 'kit:detonator';
  g.add(tbox(0.36, 0.28, 0.24, dressingMaterial('planks'), 0, 0.14, 0, 0.4));
  g.add(tcyl(0.012, 0.012, 0.3, dressingMaterial('steel'), 0, 0.28, 0, 6, 0.3));
  g.add(tbox(0.26, 0.035, 0.035, dressingMaterial('castIron'), 0, 0.58, 0, 0.3));
  for (const s of [-1, 1]) g.add(tcyl(0.018, 0.018, 0.03, paintedMaterial('steel', 0x9a7a2a), s * 0.1, 0.28, 0.06, 8, 0.2));
  const reel = tcyl(0.12, 0.12, 0.12, dressingMaterial('planks'), 0.42, 0.0, 0.1, 14, 0.4); reel.rotation.x = Math.PI / 2; reel.position.y = 0.13; g.add(reel);
  return consolidate(g);
}
/** Switch / lever box on a post with a red signal lamp (water-gate and fuel-valve controls). */
export function buildLeverBox(p) {
  const g = new THREE.Group(); g.name = 'kit:lever_box';
  const steel = paintedMaterial('steel', 0x4b5440);
  g.add(tbox(0.12, 1.0, 0.12, dressingMaterial('creosote'), 0, 0.5, -0.08, 0.6));
  g.add(tbox(0.34, 0.42, 0.2, steel, 0, 1.0, 0.03, 0.5));
  const lev = tbox(0.04, 0.42, 0.04, dressingMaterial('castIron'), 0.12, 1.22, 0.16, 0.3); lev.rotation.z = -0.35; g.add(lev);
  if (/lamp|red/.test(String(p?.variant || ''))) {
    const lamp = mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshStandardMaterial({ color: 0x6a0f0a, emissive: 0xff2010, emissiveIntensity: 0.6, roughness: 0.3, name: 'kit:red_lamp' }), false);
    lamp.position.set(0, 1.3, 0.03); g.add(lamp);
  }
  return g;
}

/**
 * Interactable marker props (entities/interactables.js markerMesh; were flat-colour 0.4 × 0.8 m boxes): a gate-lock
 * post with its hasp and padlock (`jail`), a plank supply crate with rope beckets (`crate`, `ammo` olive-painted),
 * a field telephone in its wooden case on a post (`phone`), a pipe riser with a handwheel (`valve`), else the lever box.
 */
export function buildMarkerProp(kind) {
  const g = new THREE.Group(); g.name = `kit:marker:${kind}`;
  const iron = dressingMaterial('castIron'), brass = paintedMaterial('steel', 0x9a7a2a);
  if (kind === 'jail') {
    g.add(tbox(0.14, 1.25, 0.14, paintedMaterial('steel', 0x3e443a), 0, 0.625, 0, 0.6));
    g.add(tbox(0.24, 0.3, 0.12, iron, 0, 0.95, 0.1, 0.3));
    g.add(tbox(0.3, 0.05, 0.04, iron, 0.08, 1.02, 0.17, 0.3));
    g.add(tbox(0.09, 0.1, 0.04, brass, 0.02, 0.84, 0.18, 0.2));
    const sh = mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 12, Math.PI), iron); sh.position.set(0.02, 0.89, 0.18); g.add(sh);
    for (let k = 0; k < 4; k++) g.add(tbox(0.035, 0.05, 0.02, iron, 0.06, 0.78 - k * 0.055, 0.18, 0.2)); // hanging chain
    return consolidate(g);
  }
  if (kind === 'crate' || kind === 'ammo') {
    const wood = kind === 'ammo' ? paintedMaterial('planks', 0x5d6440) : dressingMaterial('planks');
    g.add(tbox(0.7, 0.5, 0.5, wood, 0, 0.25, 0, 0.5));
    for (const x of [-0.33, 0.33]) g.add(tbox(0.05, 0.52, 0.52, dressingMaterial('beam'), x, 0.25, 0, 0.4));
    for (const z of [-0.26, 0.26]) g.add(tbox(0.18, 0.04, 0.03, dressingMaterial('burlap'), 0, 0.38, z, 0.2));
    return consolidate(g);
  }
  if (kind === 'phone') {
    g.add(tbox(0.12, 1.2, 0.12, dressingMaterial('creosote'), 0, 0.6, -0.08, 0.6));
    g.add(tbox(0.26, 0.3, 0.16, paintedMaterial('planks', 0x4a3a28), 0, 1.15, 0.05, 0.3));
    g.add(tbox(0.2, 0.05, 0.05, dressingMaterial('castIron'), 0, 1.33, 0.12, 0.2));
    g.add(tcyl(0.012, 0.012, 0.1, iron, 0.15, 1.1, 0.06, 6, 0.2));
    return consolidate(g);
  }
  if (kind === 'valve') {
    g.add(tcyl(0.08, 0.08, 0.9, paintedMaterial('steel', 0x4a5048), 0, 0, 0, 12, 0.5));
    g.add(tcyl(0.12, 0.12, 0.08, iron, 0, 0.55, 0, 12, 0.3));
    const wheel = mesh(new THREE.TorusGeometry(0.18, 0.02, 6, 18), paintedMaterial('steel', 0x8a2a1e)); wheel.rotation.x = Math.PI / 2; wheel.position.y = 0.95; g.add(wheel);
    g.add(tcyl(0.02, 0.02, 0.12, iron, 0, 0.88, 0, 6, 0.2));
    return consolidate(g);
  }
  return buildLeverBox({});
}

// ------------------------------------------------------------------------------------------ fences

/**
 * Linear `fence` runs by variant (world coords, like props.js buildLinear): brick dwarf wall + iron railing, a stone
 * kerb + railing, a plank palisade, a rock rim along a cliff edge, else a rustic post-and-rail fence.
 * Barbed-wire fences stay with the wire layer (art/wire-obstacles.js).
 */
export function buildFenceKit(points, { variant = '', h = 1.8, width = 0.3, id = 'fence' } = {}) {
  const v = String(variant || ''), g = new THREE.Group(); g.name = `kit:fence:${v || 'rail'}`;
  const R = rng(seedOf(id));
  if (/palisade|stockade/.test(v)) return buildWall(points, { variant: 'palisade', h, width, id });
  if (/rock|rim|boulder/.test(v)) {
    for (let k = 0; k + 1 < points.length; k++) {
      const [ax, az] = points[k], [bx, bz] = points[k + 1], L = Math.hypot(bx - ax, bz - az);
      for (let t = 0; t < L; t += 0.9 + R() * 0.6) {
        const s = 0.35 + R() * 0.45, x = ax + (bx - ax) * (t / L), z = az + (bz - az) * (t / L);
        const b = mesh(boulderGeometry(s, s * (0.7 + R() * 0.6), s * 0.8, Math.floor(R() * 1e9), 2), dressingMaterial(R() < 0.5 ? 'rock' : 'rockDark'));
        b.position.set(x + (R() - 0.5) * 0.4, 0, z + (R() - 0.5) * 0.4); b.rotation.y = R() * 6.3; g.add(b);
      }
    }
    return consolidate(g);
  }
  const railing = /railing|iron/.test(v);
  if (railing) {
    const base = /brick|wall/.test(v) ? Math.min(0.9, h * 0.45) : 0.25;
    const wall = buildWall(points, { variant: /brick/.test(v) ? 'brick' : 'stone_kerb', mat: /brick/.test(v) ? 'brick' : 'stone', h: base, width: Math.max(0.3, width), id });
    g.add(wall);
    const P = fenceParts(points, 'railing', Math.max(0.8, h - base), () => base);
    g.add(partsToGroup(P, 'kit:railing'));
    return g;
  }
  return partsToGroup(fenceParts(points, 'rail', Math.min(1.3, h)), 'kit:fence_rail');
}
