/**
 * LIGHTS OUT mission 3 "Winter Quarters" (docs/expansion/e03.md): the circus winter quarters' set dressing (data) and
 * the mission's own art (buildE03Visuals, browser only), kept out of the mission file so the gameplay data stays
 * readable. What blocks is drawn and what is drawn blocks: every piece below with a `block` is drawn by
 * art/e03-kit.js on its own footprint; the trees are the treegen species (willow, poplar, apple, horse chestnut).
 * @module art/e03-dressing
 */
import * as THREE from 'three';
import { E03 } from '../missions/expansion/e03-layout.js';
import { Geo, localFrame } from './castle-kit.js';
import { rng, seedOf } from './dressing.js';
import { buildRidingHall, buildBigTop, addLivingWagon, addCageWagon, addRidgeTent, buildVilla, buildVeranda, buildWaterTower,
  buildLandingStage, buildFerryPunt, buildFerryCable, addSmallProp, posterMeshes, buildMastWires, addWashingLine, clothMarks, liftClothNormals, addTrainerKit,
  strawify, waterify, buildPuddles, puddleOutlines } from './e03-kit.js';

const deg = (d) => (d * Math.PI) / 180;

// ------------------------------------------------------------------ trees (3D treegen species, never billboards)
const tree = (species, x, z, h, k) => ({ id: `${species}_${k}`, type: 'tree', species, x, z, r: species === 'poplar' ? 0.45 : 0.55, h, seed: 3000 + k });
export const E03_TREES = [
  // willows on the bank (the start among them, SW)
  ...[[2.5, 89], [13.5, 97.3], [21, 91.5], [29.5, 97.2], [57.5, 97.6], [70, 92.2], [83, 97.4], [96, 92], [110, 97.2], [139.5, 96.8]]
    .map(([x, z], k) => tree('willow', x, z, 9 + (k % 3), k)),
  // poplars along the north road and the villa drive
  ...[[53.2, 14], [53.2, 26], [53.2, 37], [58.8, 46], [64, 50.6], [74, 50.6], [92, 50.6], [100.2, 50.6], [114.5, 49.2], [134.5, 49.2],
    [146.5, 46], [146.5, 54], [146.5, 62], [146.5, 70], [101.6, 3.2], [146, 3.5]].map(([x, z], k) => tree('poplar', x, z, 17 + (k % 4), 20 + k)),
  // the villa's orchard (apples), SE of the villa (apple_42, once at (126, 74), stood at the foot of the barn's ramp)
  ...[[114, 74], [120, 74.5], [126, 74], [132, 74.6], [138, 74], [140.5, 80], [140.5, 86], [140.5, 92], [114, 80], [108.6, 74.5], [134, 80.5], [146, 82]]
    .map(([x, z], k) => tree('apple', x, z, 5.5 + (k % 3) * 0.5, 40 + k)).filter((t) => t.id !== 'apple_42'),
  // horse chestnuts on the lawn's edges
  ...[[96.5, 74], [104.5, 70.5], [146, 92.5]].map(([x, z], k) => tree('horse_chestnut', x, z, 14 + (k % 2) * 2, 60 + k)),
];

// the osier scrub round the start: a thicket of willow whips along the bank (hides a man standing in it), the SW pocket
// where the team lands open only to the river and, by a gap at its NW end, to the camp's W lane
const scrub = (x, z, k, h = 2.6) => ({ id: `scrub_${k}`, type: 'bush', species: 'shrub', x, z, r: 1.25, h, block: 2, seed: 3200 + k });
export const E03_SCRUB = [
  ...[[7.5, 88.3], [10, 88.6], [12.5, 88.4], [15, 88.8], [17.2, 89.6], [17.6, 92.0], [17.4, 94.4], [17.7, 96.8], [17.3, 98.95]].map(([x, z], k) => scrub(x, z, k)), // (the last a metre off the river's edge)
];

// ------------------------------------------------------------------ props that block (drawn by art/e03-kit.js)
const prop = (id, variant, label, x, z, rot, w, d, h, block, o = {}) => ({ id, type: 'crates', variant, label, x, z, rot: deg(rot), w, d, h, block, fixed: true, visual: false, ...o });
export const E03_DRESSING = [
  ...E03_SCRUB,
  // the lions' cage wagon backed up to the ring's W gap (its barred door on the kerb: the lions come and go by it)
  prop('cage_wagon', 'lion_cage_wagon', 'Cage wagon', 55.2, 74, 0, 6.2, 2.5, 3.0, 2),
  // the hens' coop between the stable tent and the road
  prop('hen_coop', 'hen_coop', 'Hen coop', 51.6, 26.6, 0, 2.2, 1.6, 1.6, 2),
  // a water trough and hay bales by the stable tent (the trainer's feed buckets and whip by the ring: buildE03Visuals)
  prop('trough_stable', 'water_trough', 'Water trough', 35.6, 28.6, 90, 2.4, 0.8, 0.7, 1),
  prop('bales_stable', 'hay_bales', 'Hay bales', 48.3, 25.8, 90, 2.6, 1.3, 1.2, 1),
  prop('bales_ring', 'hay_bales', 'Hay bales', 48.6, 82.4, 0, 2.6, 1.3, 1.1, 1),
  // the practice trapeze rig (two posts and a bar) in the camp's middle lane
  prop('trapeze', 'practice_trapeze', 'Practice trapeze', 44.8, 46.4, 0, 3.4, 0.5, 4.2, 2),
  // the manager's bicycle against his wagon; a hand cart by the menagerie tent
  prop('bicycle', 'bicycle', 'Bicycle', 35.2, 82.1, 0, 1.8, 0.5, 1.0, 1),
  prop('cart_men', 'handcart', 'Hand cart', 14.6, 63.6, 90, 2.0, 1.2, 1.0, 1, { asset: 'handcart_wood', visual: undefined }),
  // log pile for the wagons' stoves, behind row C
  prop('logs_camp', 'log_pile', 'Firewood', 27, 75.6, 0, 3, 1.5, 1, 1, { asset: 'log_pile_stack', visual: undefined }),
  // the owner's parked Horch at the villa's N door (no driver: scenery)
  prop('horch', 'parked_car', 'Staff car', 128.6, 49.2, 0, 4.9, 1.9, 1.6, 2, { vehicleArt: 'horch', visual: undefined }),
  // the generator's fuel drums by its hut
  prop('drums_gen', 'fuel_drums', 'Fuel drums', 123.2, 36.6, 0, 2.2, 1.2, 1.2, 1, { visual: undefined }),
  // stores in the hall's NE corner (radio spares)
  prop('hall_stores', 'radio_spares', 'Spares', 97.2, 11.4, 0, 2.6, 1.2, 1.2, 1),
];

// ------------------------------------------------------------------ standing water (render only: art/e03-kit.js buildPuddles)
// [x, z, half-length, half-width, rotation°]: the paddock gate poached by the birds and the trainer's boots, a few
// hollows in the paddock, the kennel gate, and the slop round the stable trough
export const E03_PUDDLES = [
  [29.25, 24.45, 1.05, 0.55, 12], [30.75, 23.45, 0.68, 0.4, -22], [28.25, 25.4, 0.45, 0.3, 38], [31.65, 24.95, 0.4, 0.26, 70], // the paddock gate
  [14.4, 30.3, 0.8, 0.42, 28], [22.6, 17.6, 0.62, 0.36, -40], [9.6, 21.2, 0.5, 0.3, 75],                                         // hollows in the paddock
  [49.3, 10.35, 0.75, 0.42, 8], [48.55, 8.75, 0.52, 0.3, -16],                                                                    // the kennel gate
  [36.7, 28.35, 0.6, 0.34, 84], [34.5, 29.25, 0.44, 0.27, 96],                                                                    // the stable trough's slop
];
/** The puddles' footprints (the water and its rim of soaked mud, a hand grown): the mission's render-only `bareGround`
 *  keeps grass tufts and litter out of them. */
export const E03_PUDDLE_BARE = puddleOutlines(E03_PUDDLES);

// ------------------------------------------------------------------ ground
export const E03_TERRAIN = [
  { type: 'circle', terrain: 'sand', x: E03.RING[0], z: E03.RING[1], r: E03.RING_R }, // the ring's sawdust
  // the riding hall's floor: trodden tan and earth (not loose sand: a man's boots leave no trail across it)
  { type: 'rect', terrain: 'ground', x: E03.HALL.x0 + 0.4, z: E03.HALL.z0 + 0.4, w: E03.HALL.x1 - E03.HALL.x0 - 0.8, d: E03.HALL.z1 - E03.HALL.z0 - 0.8 },
  // the paddock's, the kennel yard's and the hens' run's trodden earth (gameplay ground; the look — spring mud, a broken
  // strip of grass along the rails, the gates and the trough poached wet — is world/line-extras-expansion.js `e03`,
  // visual only)
  { type: 'rect', terrain: 'ground', x: E03.PADDOCK.x0, z: E03.PADDOCK.z0, w: E03.PADDOCK.x1 - E03.PADDOCK.x0, d: E03.PADDOCK.z1 - E03.PADDOCK.z0 },
  { type: 'rect', terrain: 'ground', x: E03.KENNEL.x0, z: E03.KENNEL.z0, w: E03.KENNEL.x1 - E03.KENNEL.x0, d: E03.KENNEL.z1 - E03.KENNEL.z0 },
  { type: 'rect', terrain: 'ground', x: 48.6, z: 25.4, w: 5.4, d: 12 }, // the hens' run
];

export const E03_ROADS = [
  // the north road from the gate down past the hall, then E along the lawn to the villa and the barn
  { id: 'road_n', surface: 'gravel', points: [[56, -2], [56, 30], [56.5, 47], [59.5, 52.6], [70, 53.4], [100, 53.4], [107.5, 54.6]], width: 4, wear: 0.6 },
  // (it ends by the barn's NE corner, E of its ramp: the passage under the bridge deck leads on to the byre doors)
  { id: 'drive', surface: 'gravel', points: [[107.5, 54.6], [114, 51.2], [130, 51.2], [138, 55], [138, 76], [132, 82.5], [128.6, 83.4]], width: 3.2, wear: 0.5 },
  // the towpath along the bank
  // (it ends in the osier scrub W of the landing: the SW bank is overgrown)
  { id: 'towpath', surface: 'dirt', points: [[21, E03.TOWPATH_Z + 0.4], [40, E03.TOWPATH_Z + 0.3], [80, E03.TOWPATH_Z - 0.2], [152, E03.TOWPATH_Z]], width: 2.6, wear: 0.7 },
  // the wagon park's lanes: spring mud (footprints, docs/expansion/e03.md §9)
  { id: 'lane_n', surface: 'mud', points: [[6, 49.5], [46, 49.5]], width: 3, wear: 0.8 },
  { id: 'lane_m', surface: 'mud', points: [[6, 66.5], [46, 66.5]], width: 3, wear: 0.8 },
  { id: 'lane_s', points: [[6, 75.6], [46, 75.6]], width: 2.6, wear: 0.8 }, // (trodden dry: the manager's round)
  { id: 'lane_e', surface: 'mud', points: [[41, 42], [41, 86]], width: 3, wear: 0.7 },
  // the lawn's path from the hall's S door to the veranda
  { id: 'lawn_path', surface: 'gravel', points: [[80, 33], [80, 38], [93, 50], [100, 58], [107.5, 62]], width: 1.8, wear: 0.4 },
  // the landing's path from the towpath
];

export const E03_PAVEMENTS = [
  // the hall's S forecourt (setts)
  { id: 'hall_forecourt', surface: 'belgian', points: [[73, 32.4], [87, 32.4], [87, 36.4], [73, 36.4]], wear: 0.6, weeds: 0.5, cracks: 0.3, edge: 'ragged', grid: false },
];

export const E03_FURNITURE = [];

/**
 * The mission's own art (browser only, idempotent; art/e03-kit.js): the riding hall, the big top and the ring, the
 * living wagons, the cage wagon, the menagerie and stable tents, the villa and its veranda, the water tower, the
 * landing stage, the ferry's cable and punt, the small props and the posters. Everything is drawn on the gameplay
 * structures' own boxes (read from the mission), added under one root ('e03:art'); the ferry's punt goes into the
 * vehicle's model. `world._e03Art` keeps the hall roof and the big top's canvas for the roof fade (fadeE03Roofs).
 */
export function buildE03Visuals(world) {
  if (!world?.scene || world._spMeshes === false || world._e03Art) return world?._e03Art ?? null;
  const ms = world.mission?.structures || [];
  const byVar = (v) => ms.filter((s) => s.variant === v);
  const root = new THREE.Group(); root.name = 'e03:art';
  const hall = buildRidingHall(E03.HALL, { W: E03.DOOR_W, S: E03.DOOR_S, E: E03.DOOR_E },
    { operators: E03.OPERATORS, table: E03.TABLE, jumps: E03.JUMPS });
  root.add(hall.group);
  const top = buildBigTop({ ...E03.TOP, poles: E03.KING_POLES, sidePoles: E03.SIDE_POLES, ring: E03.RING, ringR: E03.RING_R + 0.1, bandstand: { x: 66, z: 87.5 } });
  root.add(top);
  const villa = ms.find((s) => s.id === 'villa');
  if (villa) root.add(buildVilla(villa));
  root.add(buildVeranda(E03.VERANDA, E03.VERANDA_RAILS, { wallX: villa ? villa.x - villa.w / 2 : 114 }));
  root.add(buildWaterTower(E03.TOWER[0], E03.TOWER[1], E03.TOWER_DECK));
  const landing = ms.find((s) => s.id === 'landing');
  if (landing) root.add(buildLandingStage(landing));
  root.add(buildFerryCable([E03.CABLE[0][0], E03.TOWPATH_Z + 1.2], [E03.CABLE[1][0], 119.6]));
  // the masts' guys and antenna spans (the guys' bearings keep their anchors inside the fenced field)
  const GUY_AZ = { mast_a: 0.35, mast_c: Math.PI / 2 + 0.2, mast_b: Math.PI / 3 }; // (mast_b stands 6 m off the E fence: two guys at ±60° from E, one W)
  const rig = buildMastWires(ms.filter((s) => s.type === 'radio_mast').map((s) => ({ id: s.id, x: s.x, z: s.z, h: s.h, guyAz: GUY_AZ[s.id] })));
  root.add(rig.group);
  // the camp: living wagons, the cage wagon, the tents and the small props in one merged build
  const G = new Geo('e03:camp'), R = rng(seedOf('e03:camp')), posters = [];
  let pk = 0;
  for (const s of byVar('circus_wagon')) {
    const { F } = addLivingWagon(G, s, R);
    // a poster on each side, on one of the two solid panels between the windows (addLivingWagon: windows at bu - 1.9,
    // bu, bu + 1.9 with their shutters folded back to ±0.68 m: panels 0.54 m wide centred at bu ± 0.95), pasted on the
    // body panel (its face at d/2 - 0.1) below the roof moulding and above the waist moulding — never over a window
    for (const sw of [-1, 1]) {
      const u = -0.25 + (R() < 0.5 ? -0.95 : 0.95), w = sw * (s.d / 2 - 0.1 + 0.006), y0 = 1.74, y1 = 2.46, h = 0.24; // (2:3, the print's own aspect)
      const P = (du, dy) => { const [x, z] = F.at(u + du, w); return [x, dy, z]; };
      posters.push({ k: pk++, c: sw > 0 ? [P(-h, y0), P(h, y0), P(h, y1), P(-h, y1)] : [P(h, y0), P(-h, y0), P(-h, y1), P(h, y1)] });
    }
  }
  for (const s of byVar('lion_cage_wagon')) addCageWagon(G, s);
  const gy = (x, z) => (typeof world.groundY === 'function' ? world.groundY(x, z) || 0 : 0);
  for (const s of byVar('menagerie_tent')) {
    // the menagerie tent: its doorways open on its inside (no black backing), where the lions' three empty cage
    // wagons stand in a row along its north side, doors slid open, old straw on the floor of the walkway
    addRidgeTent(G, s, { eave: 2.6, interior: true });
    const F = localFrame(s.x, s.z, s.rot ?? 0), RT = rng(seedOf('e03:menagerie'));
    for (const [u, dr] of [[-6.9, 0.03], [0.1, -0.02], [6.9, 0.025]]) {
      const [x, z] = F.at(u, -1.95);
      addCageWagon(G, { x, z, rot: (s.rot ?? 0) + dr, w: 6.2, d: 2.5 }, { open: true, R: RT });
    }
    for (let k = 0; k < 16; k++) { // the walkway's straw, trodden thin
      const [x, z] = F.at(-s.w / 2 + 1 + RT() * (s.w - 2), 0.4 + RT() * (s.d / 2 - 1.4));
      addSmallProp(G, { variant: 'straw_litter', x, z, rot: RT() * 6.28, w: 0.8, d: 0.6, y: gy(x, z) }, RT);
    }
  }
  for (const s of byVar('stable_tent')) addRidgeTent(G, s, { roofMat: 'e03_canvas', wallMat: 'e03_canvas', eave: 2.4 });
  for (const s of ms) if (s.type === 'crates' && s.visual === false) addSmallProp(G, s, R);
  // washing hung between the wagons of rows C and D, high on lines from roof corner to roof corner (a man walks under it)
  const wag = (id) => ms.find((q) => q.id === id), cloth0 = clothMarks(G);
  for (const [w0, w1] of [['wagon_c1', 'wagon_c2'], ['wagon_c2', 'wagon_c3'], ['wagon_d2', 'wagon_d3']]) {
    const A = wag(w0), B = wag(w1);
    if (!A || !B) continue;
    const ya = (A.h ?? 3.4) - 0.42, yb = (B.h ?? 3.4) - 0.46;
    addWashingLine(G, [A.x + A.w / 2 - 0.62, ya, A.z - 0.35], [B.x - B.w / 2 + 0.05, yb, B.z - 0.3], R);
  }
  const cloth1 = clothMarks(G);
  // the trainer's feed buckets and whip at the ring kerb, in front of his stand (E03.KERB) on his right
  const RC = E03.RING, rr = (a, r) => [RC[0] + Math.cos((a * Math.PI) / 180) * r, RC[1] + Math.sin((a * Math.PI) / 180) * r];
  const kTop = 0.6 + 0.05 + 0.019, k0 = rr(140.6, 6.84), k1 = rr(145.2, 6.8);
  addTrainerKit(G, { buckets: [[...rr(147, 7.38), true], [...rr(151.5, 7.42), false]], whip: rr(139.5, 7.62),
    kerb: [[k0[0], kTop, k0[1]], [k1[0], kTop, k1[1]]] }, gy);
  const camp = G.build('e03:camp', { damp: 0.5, moss: 0.2 });
  liftClothNormals(camp, 'e03:camp', cloth0, cloth1); // (the washing takes the light on both faces)
  root.add(camp);
  const pm = posterMeshes(posters);
  if (pm) root.add(pm);
  strawify(root); // (the hay, the bales, the straw: the straw material, not the kit's thatch)
  waterify(root); // (the trough's water: the still-water shader — dark, the sky and its clouds in it)
  // the puddles, draped on the drawn ground (the trail field's berms never poke through them)
  const surf = typeof world.terrain?.surfaceAt === 'function' ? (x, z) => world.terrain.surfaceAt(x, z) : gy;
  const puddles = buildPuddles(E03_PUDDLES, surf);
  if (puddles) root.add(puddles);
  root.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.matrixAutoUpdate = false; o.updateMatrix(); } });
  world.scene.add(root);
  // the rope ferry's punt replaces the vehicle's placeholder model
  const ferry = world.vehicles?.find((v) => v.tag === 'ferry');
  if (ferry?.object3d && !ferry.object3d.userData.e03Punt) {
    for (const c of ferry.object3d.children) c.visible = false;
    const punt = buildFerryPunt();
    punt.name = 'e03:ferry_punt';
    ferry.object3d.add(punt);
    ferry.object3d.userData.e03Punt = true;
  }
  world._e03Art = { root, hallRoof: hall.roof, canvas: top.getObjectByName('e03:bigtop_canvas'), mainWires: rig.main };
  return world._e03Art;
}

/**
 * The roof fade (visual only): the riding hall's roof and lantern hide while a commando is inside the hall, the big
 * top's canvas while one is under it, so the man and what he does read from the game camera. Called every 20 Hz tick.
 */
export function fadeE03Roofs(world) {
  const art = world?._e03Art;
  if (!art) return;
  const H = E03.HALL, T = E03.TOP;
  let inHall = false, underCanvas = false;
  for (const c of world.commandos || []) {
    if (c.alive === false || c.removed || c.state === 'inVehicle') continue;
    if (c.x > H.x0 - 0.2 && c.x < H.x1 + 0.2 && c.z > H.z0 - 0.2 && c.z < H.z1 + 0.2) inHall = true;
    const r = Math.hypot(c.x - T.x, c.z - T.z);
    if (c.z < T.z + 1 && r > 9.0 && r < T.r + 1.2) underCanvas = true;
  }
  if (art.hallRoof && art.hallRoof.visible === inHall) art.hallRoof.visible = !inHall;
  if (art.canvas && art.canvas.visible === underCanvas) art.canvas.visible = !underCanvas;
  // the main mast's guys and antenna spans go down with it
  if (art.mainWires?.visible) {
    art.mainMast ??= (world.interactables || []).find((i) => i.tag === 'mast_c' || i.structure?.id === 'mast_c') || null;
    if (art.mainMast?.destroyed) art.mainWires.visible = false;
  }
}
