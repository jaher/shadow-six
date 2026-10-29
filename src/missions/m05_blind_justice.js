/**
 * BEL Mission 5 — "Blind Justice" (buildable layout: docs/missions/m05.md). Owned by MISSIONS.
 * Radar station above Herdla airfield, Askøy, near Bergen, Norway, 2 May 1941. Snow. The Green Beret and the
 * Spy start behind the NW log house of the village at the foot of a granite massif. The Würzburg radar stands
 * on the summit, a 16 m plateau reached only by the cable car (from the lower station S of the village) or by
 * the Green Beret's climb up the east face. The whole map is one alarm zone; three garrisons (log HQ, SE
 * concrete bunker, summit barracks). The Spy's uniform dries on a clothesline guarded by e8; the south field
 * phone rings the north one and pulls e8 away. The south approaches are mined (14 invisible mines, all ≥ 3 m
 * off Patrol 19's beaten track). Three fuel drums on the summit are the only explosives: one next to the
 * barracks razes it (one officer gets out), one carried to the dish destroys it. Escape in the autogyro.
 *
 * Conventions: headings/rot in DEGREES in the dossier, converted with deg(); route `look` and `post.sweep`
 * stay in degrees (0 = E, 90 = S, 180 = W, 270 = N). Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (grid fit / engine, see the commit message):
 *  - the plateau is raised with `walkways` strips (the dossier's fallback; map-builder has no area elev) and
 *    rendered by the mission script (extruded plateau/massif, summit props lifted to y 16);
 *  - g3_barracks is 11 m long at x 100.5 (12 m at x 102 left the map); its door faces SW (95.5,53), b1 sits
 *    1.5 m off that wall at (94.7,51.9), e16 at (93.5,48) and p18's S end at (93,53) stay inside its 5 m kill
 *    radius; the rim scrub is omitted (it sat on the rim line);
 *  - the autogyro takes off northwards (a scripted climb): the valley W of the summit is a blocked drop;
 *  - the cable car has 6 seats (the registered `cable_car` type) instead of 2;
 *  - route-avoidance nudges (trees and props kept off the patrol lines and the scatter's avoid list): logs_h4
 *    (35.3,61.8) not (33.5,56); s_single pines (64,124)/(85,124) not (64,118)/(85,120); se_clump (102,124) not
 *    (99,118); the foot pines filtered to 4; e1 starts at (14.5,30) not (15,29.5); the g1 exit route and G1_LOOP
 *    go (24,90)/(24,72)/(34,66)/(44,66) instead of the dossier's (24,72)/(36,58)/(44,69) (they skirt h4/h6);
 *  - pm's N end is (35,49), S of h2 (not (37,42)): the E end of h1 and e3's beat must stay outside its 18 m
 *    near band, as in Kildread's lure behind h1 (fix round, dossier §8.3 updated);
 *  - beat ends kept clear of the drawn cabins (the game's nav keeps a man off a model's walls): e3's W end (19.6,34.4)
 *    not (19,33) (h1's S corner), pm's middle point (35.5,55.5) not (34,56) (h4's N corner) and its S end (45.6,68.4)
 *    not (44,69) (h6's N corner) — at the old points both patrols stood stuck, turning on the spot (tests/m05-routes);
 *  - the cable car keeps its riders aboard at the far station (set-piece keepAboard) and a disguised Spy may
 *    board it in view (`rules.spyMayBoard`), so Route B (§12) plays; mines use the 3 m `mine` blast class.
 */

import { plateauWalkways, holesOf, spawnSurvivor, m05Script, SUMMIT_Y } from './scripts/m05.js';
import { joinStructures } from './schema.js';
import { M05_DRESSING, M05_SUMMIT } from '../art/m05-dressing.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (§4.1)
const Y = SUMMIT_Y;

// ---------------------------------------------------------------- terrain shapes (dossier §4)
/** T1 the valley drop NW of the summit (a forest canopy far below: impassable). */
const VALLEY = [[33, 0], [60, 0], [60, 40], [56, 42], [52, 26], [44, 22], [38, 20], [34, 14]];
/** T2 the summit plateau (elev 16). */
const PLATEAU = [[60, 0], [107, 0], [107, 73], [96, 68], [88, 61], [78, 58], [66, 55], [62, 50], [60, 40]];
/** T3 the granite massif between the rim and its foot (not walkable, blocks ground sight). */
const MASSIF = [[60, 40], [62, 50], [66, 55], [78, 58], [88, 61], [96, 68], [107, 73],
  [107, 89], [95, 88], [86, 85], [76, 78], [74, 70], [70, 63], [64, 58], [60, 56], [59, 48], [58, 40]];

// ---------------------------------------------------------------- art pass (visual only: scripts/m05-art.js)
/** The valley drop is cut 14 m into the terrain (`carves`; its rim spares the rim_rock outcrop) and wooded far below. */
const VALLEY_DEPTH = 14;
const VALLEY_CARVE = [[33, 0], [60, 0], [60, 40], [56, 42], [52, 26], [44, 22], [38.8, 18.6], [37.6, 13], [34.3, 11], [33.6, 6]];
// (the wood keeps ~4.5 m off the village rim: the bare rock bank shows between the rim and the canopy)
const VALLEY_WOOD = [[37.5, 1], [57, 1], [57, 31], [55.8, 23], [46.3, 18.1], [43, 15.7], [41.6, 10.2], [38.5, 8.2], [38.1, 5.5]];
/** The massif's rim (plateau edge, y 16) and foot (y 0), W → E, carried on 21 m past the E map edge. */
const MASSIF_RIM = [[60, 40], [62, 50], [66, 55], [78, 58], [88, 61], [96, 68], [107, 73], [128, 81]];
const MASSIF_FOOT = [[58, 40], [59, 48], [60, 56], [64, 58], [70, 63], [74, 70], [76, 78], [86, 85], [95, 88], [107, 89], [128, 93]];
/** The plateau as drawn: carried on past the N and E edges (no void), down to the valley floor on its W face. */
const PLATEAU_ART = [[60, -25], [132, -25], [132, 81], [128, 81], [107, 73], [96, 68], [88, 61], [78, 58], [66, 55], [62, 50], [60, 40]];
/** The valley's village-side rim (on the carve outline): its rock lip is drawn by scripts/m05-art.js `rimLip`. */
const VALLEY_LIP = [[56, 42], [52, 26], [44, 22], [38.8, 18.6], [37.6, 13], [34.3, 11], [33.6, 6], [33, 0]];
const VALLEY_CARVES = [{ id: 'valley', points: VALLEY_CARVE, depth: VALLEY_DEPTH, bank: 5, inset: 0.5 }];
export const ART = { plateau: PLATEAU_ART, rim: MASSIF_RIM, foot: MASSIF_FOOT, valleyDepth: VALLEY_DEPTH, gully: [100.6, 2.2, 1.3], privies: ['outhouse'],
  valley: { carves: VALLEY_CARVES, lip: VALLEY_LIP, size: [107, 131], avoid: null } }; // avoid: the rim trees (set below TREES)

// ---------------------------------------------------------------- the summit (y 16; +19 m z shift applied, §3)
const SUMMIT = [
  { id: 'top_station', type: 'cable_car_station', variant: 'upper_blockhouse', x: 72, z: 44, rot: deg(45), w: 16, d: 9, h: 9 },
  { id: 'radar', type: 'radio_mast', variant: 'wurzburg_dish', label: 'Radar', x: 94, z: 31, rot: deg(20), w: 3, d: 3, h: 8, r: 3.75,
    destructible: true, destroyedBy: ['explosion'], hp: 100, fixed: true },
  { id: 'radar_hut', type: 'hut', variant: 'guard_hut', x: 101, z: 30, rot: 0, w: 4, d: 4, h: 3.5, snowRoof: true, asset: 'shed_tarred_be' },
  { id: 'g3_barracks', type: 'barracks', variant: 'timber_long', label: 'Summit barracks', x: 100.5, z: 51, rot: deg(50), w: 11, d: 7, h: 5,
    flag: true, garrison: true, destructible: true, destroyedBy: ['explosion'], hp: 100 }, // door: the SW long side (default +90°)
  { id: 'pole_top', type: 'telegraph_pole', x: 82, z: 49, r: 0.15, h: 7, wireTo: 'top_station', fixed: true },
  ...[[100, 36], [101, 41], [106, 46]].map(([x, z], k) => ({ id: `pine_top_${k + 1}`, type: 'pine', x, z, r: 0.45, h: 10 + k, seed: 5300 + k, fixed: true })),
  ...M05_SUMMIT, // art pass 2 (art/m05-dressing.js): the autogyro's windsock, granite outcrops on the N / W rims and the NE corner
];
// (summit points carry `fixed`: they stand on the raised plateau, so the ground placement rules (world/placement.js),
// which can only ever keep them where they are, skip the futile relocation search: a faster load)
/** Summit structures without a footprint (lifted visually only). */
const SUMMIT_FLAT = [
  { id: 'top_deck', type: 'pier', variant: 'timber_deck', x: 64, z: 50, rot: deg(45), w: 6, d: 5, h: 0.4 },
];
/** Summit dressing without a footprint (lifted visually only; nobody walks there): the dish's generator E of the
 *  operators' hut, a crate stack by the top station, firewood by the barracks. */
const SUMMIT_DRESS = [ // (fixed: placement keeps them where authored; the plateau is no ground obstacle for them)
  { id: 'gen_radar', type: 'generator', variant: 'genset_field', x: 104.5, z: 30, rot: deg(90), w: 2, d: 1.4, h: 1.2, block: 0, fixed: true },
  { id: 'crates_top', type: 'crates', x: 76, z: 36.5, rot: deg(45), w: 2.2, d: 1.6, h: 1.2, block: 0, fixed: true },
  { id: 'logs_barr', type: 'crates', variant: 'log_pile', asset: 'log_pile_stack', x: 104.5, z: 45, rot: deg(50), w: 3, d: 1.5, h: 1, block: 0, fixed: true },
];
const DRUMS = [['b1', 94.7, 51.9], ['b2', 84, 55], ['b3', 86, 55.5]]
  .map(([id, x, z]) => ({ id, type: 'barrels', variant: 'fuel_explosive', explosive: 'barrel', carriable: true, x, z, r: 0.3, h: 0.9, fixed: true }));

/** The plateau as walkway strips, the summit footprints cut out (they keep their block). */
const PLATEAU_WALKS = plateauWalkways(PLATEAU, holesOf(SUMMIT));

// ---------------------------------------------------------------- trees (dossier §5.6)
/** Deterministic scatter in a polygon, rejecting points near `avoid` segments/points and inside blocked areas. */
function scatter(poly, n, seed, avoid = []) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const inside = (x, z, pts) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, zi] = pts[i], [xj, zj] = pts[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  const out = [];
  for (let tries = 0; out.length < n && tries < n * 60; tries++) {
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
    if (!inside(x, z, poly) || inside(x, z, VALLEY) || inside(x, z, MASSIF) || inside(x, z, PLATEAU)) continue;
    if (out.some(([a, b]) => Math.hypot(a - x, b - z) < 2.6)) continue;
    if (avoid.some(([a, b]) => Math.hypot(a - x, b - z) < 3)) continue;
    out.push([+x.toFixed(1), +z.toFixed(1)]);
  }
  return out;
}
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

// ---------------------------------------------------------------- routes (dossier §8, §9)
/** Patrol 19's beaten track (T7): the only mine-free line east (Prima's "wide turn" at (82,117)–(90,110)). */
const P19_TRACK = [[44, 99], [48, 114], [66, 118], [82, 117], [90, 110], [95, 100], [98, 94]];
/** g1 squad / pm alarm loop through the village and the lower station. */
const G1_LOOP = [P(40, 97), P(31, 97), P(24, 90), P(24, 72), P(34, 66), P(44, 66), P(48, 72), P(47, 85), P(40, 97)];
/** g3 squad / p18 alarm loop around the summit. */
const G3_LOOP = [P(84, 10), P(84, 30), P(93, 52), P(84, 48), P(74, 55), P(64.5, 51.5), P(74, 55), P(84, 48), P(84, 30)];
const P18_LOOP = [P(64.5, 51.5), P(74, 55), P(84, 48), P(84, 30), P(93, 52), P(84, 48), P(74, 55)];
/** g2 bunker squad: out of the door onto Patrol 19's track. */
const G2_EXIT = [P(94, 113.5), P(90, 110), P(82, 117)];
const G2_LOOP = [P(82, 117), P(66, 118), P(48, 114), P(44, 99), P(48, 114), P(66, 118)];

const walker = (id, prima, x, z, h, pts, extra = {}) => ({
  id, prima, soldierType: 'soldier', x, z, heading: deg(h), flags: { investigates: true, followsTracks: !!extra.tracks },
  route: { type: 'PINGPONG', vel: 1.0, points: pts }, ...(extra.y ? { y: extra.y } : {}),
});
const sentry = (id, prima, x, z, h, sweep, inv, extra = {}) => ({
  id, prima, soldierType: 'sentry', x, z, heading: deg(h), flags: { investigates: inv, holdsPost: !inv },
  post: { heading: deg(h), sweep, ...(extra.period ? { period: extra.period } : {}) }, ...(extra.y ? { y: extra.y } : {}),
});
/** A patrol squad: leader (sergeant) + troopers in single file behind him. */
const patrol = (sq, prima, pts, lead, route, extra = {}) => pts.map(([x, z], k) => ({
  id: `${sq}${'abcd'[k]}`, ...(k ? {} : { prima }), soldierType: k ? 'trooper' : 'sergeant', x, z, heading: deg(lead),
  flags: { investigates: true, followsTracks: true }, squad: { id: sq, leader: `${sq}a`, columns: 1 },
  route: { type: 'PINGPONG', vel: 1.0, points: route }, ...extra,
}));

const ENEMIES = [
  // ===== the village (Prima 1–7)
  walker('e1', 1, 14.5, 30, 90, [P(14.5, 30, 4, 180), P(17, 37.5, 4, 90)], { tracks: true }),
  walker('e2', 2, 15, 38.5, 150, [P(15, 38.5, 3, 270), P(5, 46, 3, 180)]),
  walker('e3', 3, 19.6, 34.4, 0, [P(19.6, 34.4, 3, 90), P(32, 31, 3, 0)]),
  sentry('e4', 4, 29.5, 24.5, 0, 40, false, { period: 5 }),
  walker('e5', 5, 5, 55, 0, [P(5, 55, 3, 270), P(19, 55, 3, 0)], { tracks: true }),
  walker('e6', 6, 3, 60, 90, [P(3, 60, 3, 0), P(3, 74, 3, 0)]),
  walker('e7', 7, 4, 79, 0, [P(4, 79, 3, 180), P(19.5, 79), P(22, 74, 3, 270)], { tracks: true }),
  // ===== the uniform and the lower station (Prima 8–13)
  sentry('e8', 8, 48, 46.5, 135, 40, true), // guards the clothesline 5 m NE of him; the N phone pulls him
  sentry('e9', 9, 25, 75.5, 45, 35, true),
  sentry('e10', 10, 24, 66.5, 100, 40, true),
  sentry('e11', 11, 36, 92, 0, 35, false),
  sentry('e12', 12, 41, 96.5, 90, 35, false),
  sentry('e13', 13, 47, 82, 110, 40, true),
  // ===== patrols in the lower field. pm (2): near the uniform, never within the phone's 13.5 m. Its N end sits
  // S of h2 (Kildread's map shows the pair at (41,53)): the E end of h1 and e3's beat stay beyond its 18 m
  // near band, so tracks there are safe ("behind the house near the right end... no danger" [Kild])
  ...patrol('pm', null, [[35, 49], [35, 47.8]], 90, [P(35, 49, 3, 270), P(35.5, 55.5), P(45.6, 68.4, 3, 90)], {
    reactEvents: ['RINT'], alarmRoute: { run: { x: 40, z: 97, vel: 2.7 }, loop: { type: 'LOOP', vel: 1.8, points: G1_LOOP } } }),
  // Patrol 19 (4): along the beaten track to the cliff foot; keeps its beat on the alarm
  ...patrol('p19', 19, [[44, 99], [43.8, 97.8], [43.6, 96.6], [43.4, 95.4]], 75,
    [P(44, 99, 4, 270), ...P19_TRACK.slice(1, -1).map(([x, z]) => P(x, z)), P(98, 94, 5, 270)]),
  // ===== the summit (y 16; Prima 14–18)
  walker('e14', 14, 63.5, 48, 35, [P(63.5, 48, 4, 180), P(74, 55, 4, 90)], { y: Y }),
  sentry('e15', 15, 97, 66, 90, 40, false, { y: Y }), // watches the east cliff: the climb lands in his cone
  sentry('e16', 16, 93.5, 48, 180, 40, false, { y: Y }), // W of the barracks, inside b1's kill radius
  walker('e17', 17, 87, 21, 0, [P(87, 21, 3, 270), P(105, 23, 3, 90)], { y: Y }),
  ...patrol('p18', 18, [[84, 8], [84, 6.8], [84, 5.6]], 90, [P(84, 8, 4, 270), P(84, 30), P(90, 47), P(93, 53, 4, 90)], {
    y: Y, reactEvents: ['RINT'], alarmRoute: { run: { x: 64.5, z: 51.5, vel: 2.7 }, loop: { type: 'LOOP', vel: 1.8, points: P18_LOOP } } }),
];

// ---------------------------------------------------------------- tree scatter (avoids every route and post)
const AVOID = (() => {
  const out = [[18, 21.5], [22, 19.5], [8.5, 32.5], [4, 22], [19.5, 83.5], [50, 38], [52, 42], [36.5, 112.8], [50.5, 51.8], [100, 90.5]];
  const line = (pts) => { for (let k = 1; k < pts.length; k++) { const [a, b] = [pts[k - 1], pts[k]]; const L = Math.hypot(b.x - a.x, b.z - a.z); for (let t = 0; t <= L; t += 1) out.push([a.x + ((b.x - a.x) * t) / L, a.z + ((b.z - a.z) * t) / L]); } };
  for (const e of ENEMIES) { out.push([e.x, e.z]); if (e.route) line([{ x: e.x, z: e.z }, ...e.route.points]); }
  for (const r of [G1_LOOP, G2_EXIT, G2_LOOP, P19_TRACK.map(([x, z]) => P(x, z)), [P(56, 61), P(55, 68), P(48, 72)]]) line(r);
  return out;
})();
const pines = (id, pts, h0 = 9, seed0 = 5000) => pts.map(([x, z], k) => ({ id: `${id}_${k + 1}`, type: 'pine', x, z, r: 0.45, h: h0 + ((k * 7) % 6), seed: seed0 + k }));
const TREES = [
  ...pines('nw_forest', scatter([[0, 0], [22, 0], [22, 12], [14, 18], [0, 20]], 14, 51, AVOID), 10, 5000),
  ...pines('n_single', [[25, 4], [31, 10], [39, 33]], 11, 5020),
  ...pines('rim_grove', scatter(rect(38, 24, 54, 40), 10, 52, AVOID), 9, 5030),
  ...pines('sw_forest', scatter([[0, 98], [8, 92], [30, 92], [30, 104], [22, 116], [12, 124], [0, 124]], 26, 53, AVOID), 10, 5050),
  ...pines('e_grove1', scatter(rect(52, 86, 70, 104), 15, 54, AVOID), 10, 5080),
  ...pines('e_grove2', scatter(rect(77, 82, 92, 98), 11, 55, AVOID), 9, 5100),
  ...pines('foot', [[72, 71.5], [80, 80], [93, 89.5], [101, 89]].filter(([x, z]) => AVOID.every(([a, b]) => Math.hypot(a - x, b - z) >= 3)), 9, 5120),
  ...pines('s_single', [[64, 124], [85, 124], [3, 89], [21, 87]], 10, 5130),
  ...pines('se_clump', [[100, 108], [104, 113], [102, 124], [105, 120]], 9, 5140),
];

// the valley's rock lip keeps clear of the trunks standing on or near the rim (scripts/m05-art.js rimLip)
ART.valley.avoid = TREES.filter((t) => t.x > 30 && t.x < 60 && t.z < 45).map((t) => [t.x, t.z, 0.8]);

// ---------------------------------------------------------------- the mines (dossier §6.2)
const MINES = [[86, 109], [58, 110], [70, 112], [64, 106], [76, 124], [60, 126], [88, 122], [95, 108],
  [91, 99], [103, 97], [104, 104], [94, 91], [40, 128], [52, 127]];

/** Structures lifted onto the plateau by the mission script (meshes + drum entities). */
const LIFT = [...SUMMIT, ...SUMMIT_FLAT, ...SUMMIT_DRESS, ...DRUMS].map((s) => s.id);

const cabin = (id, x, z, w, d, extra = {}) => ({ id, type: 'house', variant: 'log_cabin', x, z, rot: deg(328), w, d, h: 5.5, snowRoof: true, ...extra });
const drums = (id, x, z, w = 2.4, d = 2) => ({ id, type: 'barrels', variant: 'inert_stack', x, z, rot: 0, w, d, h: 1, block: 1 }); // not explosive
const crates = (id, x, z, w, d, h = 1.2, rot = 0, variant) => ({ id, type: 'crates', ...(variant ? { variant } : {}), x, z, rot: deg(rot), w, d, h, block: 1 });
const tent = (id, x, z) => ({ id, type: 'tent', variant: 'ridge_small', x, z, rot: deg(40), w: 3, d: 4, h: 2.2, asset: 'tent_ridge_field' });

// ---------------------------------------------------------------- art pass: set dressing (visual; low cover, ≥ 4.5 m off every
// route, post and start; furniture never touches the walk grid: block false)
/** Firewood stacks by the cabins, handcarts, the HQ despatch rider's BMW combination (fixed: authored on spots that already
 *  clear the placement rules, so the load runs no relocation search). */
const DRESSING = [
  { id: 'logs_h1', type: 'crates', variant: 'log_pile', asset: 'log_pile_stack', x: 12.2, z: 19.5, rot: deg(328), w: 3, d: 1.5, h: 1, block: 1, fixed: true },
  { id: 'cart_h1', type: 'crates', variant: 'handcart', asset: 'handcart_wood', x: 28.8, z: 17.9, rot: deg(15), w: 1.9, d: 1.4, h: 1, block: 1, fixed: true },
  { id: 'logs_h3', type: 'crates', variant: 'log_pile', asset: 'log_pile_stack', x: 21.7, z: 44.3, rot: deg(328), w: 3, d: 1.5, h: 1, block: 1, fixed: true },
  { id: 'logs_h4b', type: 'crates', variant: 'log_pile', asset: 'log_pile_stack', x: 25.1, z: 57.4, rot: deg(328), w: 3, d: 1.5, h: 1, block: 1, fixed: true },
  { id: 'logs_h5', type: 'crates', variant: 'log_pile', asset: 'log_pile_stack', x: 14.3, z: 62.5, rot: deg(328), w: 3, d: 1.5, h: 1, block: 1, fixed: true },
  { id: 'cart_h6', type: 'crates', variant: 'handcart', asset: 'handcart_wood', x: 31.6, z: 77.7, rot: deg(240), w: 1.9, d: 1.4, h: 1, block: 1, fixed: true },
  { id: 'logs_shed', type: 'crates', variant: 'log_pile', asset: 'log_pile_stack', x: 46.5, z: 54, rot: deg(328), w: 4, d: 2, h: 1.3, block: 1, fixed: true }, // cordwood under the woodshed's roof
  { id: 'logs_h8', type: 'crates', variant: 'log_pile', asset: 'log_pile_stack', x: 33.1, z: 110.7, rot: deg(335), w: 3, d: 1.5, h: 1, block: 1, fixed: true },
  { id: 'moto_hq', type: 'crates', variant: 'vehicle_parked', label: 'Motorcycle', x: 54.1, z: 50.1, rot: deg(328), w: 2.4, d: 1.7, h: 1.1, block: 1, fixed: true, vehicleArt: 'r75_sidecar' },
];
/** Wooden lamp posts by the stone house, the lift and the south hut (and two on the summit, y 16), a fingerpost at the
 *  village's W edge, a no-entry board at the lower station, mine boards on the S field's edge, a round-pole fence N of
 *  the start house. */
const FURNITURE = [
  { type: 'lamp', variant: 'norway_wood', x: 27, z: 52, rot: deg(0), block: false },
  { type: 'lamp', variant: 'norway_wood', x: 26.5, z: 89.4, rot: deg(45), block: false },
  { type: 'lamp', variant: 'norway_wood', x: 43.2, z: 109.3, rot: deg(-90), block: false },
  { type: 'lamp', variant: 'norway_wood', x: 79, z: 47.5, y: Y, rot: deg(45), block: false },
  { type: 'lamp', variant: 'norway_wood', x: 97.5, z: 34, y: Y, rot: deg(180), block: false },
  { type: 'sign', variant: 'fingerpost', x: 2, z: 43, rot: deg(-45), text: 'HERDLA 3 km', block: false },
  { type: 'sign', variant: 'wehrmacht', x: 26.1, z: 81, rot: deg(-30), text: 'SEILBAHN\nZUTRITT VERBOTEN', block: false },
  { type: 'sign', variant: 'wehrmacht', x: 50, z: 104, rot: deg(-60), text: 'ACHTUNG\nMINEN!', block: false },
  { type: 'sign', variant: 'wehrmacht', x: 74, z: 106.5, rot: deg(-90), text: 'ACHTUNG\nMINEN!', block: false },
  { type: 'fence', variant: 'rail', points: [[23, 12], [28, 11.5], [32.5, 12.8]], h: 1.2, block: false },
];

const STRUCTURES = [
  // --- terrain structures: the valley drop, the summit plateau (raised by walkways), the massif
  { id: 'valley_rim', type: 'cliff', variant: 'drop', points: VALLEY, h: 1, block: 2 },
  { id: 'summit', type: 'cliff', variant: 'plateau_top', points: PLATEAU, h: Y, block: 2, walkways: PLATEAU_WALKS },
  { id: 'massif', type: 'cliff', variant: 'granite_massif', points: MASSIF, h: Y, block: 2, climbable: false },
  { id: 'rim_rock', type: 'rocks', x: 36, z: 16, rot: 0, w: 5, d: 4, h: 5 },
  // --- the village (NW and W)
  cabin('h1', 21.5, 26.5, 14, 7, { asset: 'log_cabin_b' }),
  { id: 'h1_annex', type: 'hut', variant: 'log_shed', x: 13.5, z: 24, rot: deg(328), w: 3.5, d: 3, h: 3, asset: 'shed_tarred_be' },
  { id: 'h1_kennel', type: 'tent', variant: 'canvas_shed', x: 25, z: 17.5, rot: deg(328), w: 3, d: 2.5, h: 2, block: 1 },
  crates('h1_crates', 28.5, 22.5, 2, 2),
  { id: 'rocks_w1', type: 'rocks', x: 9, z: 29, rot: 0, w: 5, d: 4, h: 3 },
  { id: 'rocks_w2', type: 'rocks', x: 3, z: 36, rot: 0, w: 6, d: 7, h: 3 },
  { id: 'rocks_w3', type: 'rocks', x: 12, z: 35, rot: 0, w: 4, d: 3, h: 2.5 },
  drums('drums_w', 4.5, 26, 2.2, 2.2),
  { id: 'h2', type: 'flat_roof_house', variant: 'stone_bunkhouse', x: 30, z: 43, rot: deg(335), w: 10, d: 6, h: 4.5, mat: 'stone', roofWalk: false, enterable: true },
  drums('drums_h2a', 27.5, 48, 2.5, 2), drums('drums_h2b', 34.5, 33.5, 2.5, 2),
  { id: 'outhouse', type: 'hut', variant: 'outhouse_plank', x: 3.15, z: 52.36, rot: deg(328), w: 1.6, d: 1.6, h: 2.4, chimney: false }, // by h3's W gable, clear of its eaves; no fx stack on a privy
  cabin('h3', 11.5, 49.5, 12, 7, { asset: 'log_cabin_b' }),
  drums('drums_h3', 18.5, 51),
  crates('crates_h3', 8, 57.5, 3, 2.5, 1.2, 20),
  cabin('h4', 29.5, 62.5, 12, 7, { asset: 'log_cabin_b' }),
  { ...crates('logs_h4', 35.3, 61.8, 3, 2, 1.2, 328, 'log_pile'), asset: 'log_pile_stack' }, // the logs stacked on h4's E gable (§5.2)
  cabin('h5', 12, 72, 13, 7, { asset: 'log_cabin_b' }),
  cabin('h5_wing', 9, 66, 5, 6, { asset: 'log_cabin_a' }),
  crates('crates_h5', 21, 69, 2, 3, 1.5),
  crates('crate_pile', 15.5, 82, 7, 4, 1.8, 0, 'stack_large'), // the lure corner behind it: (19.5, 83.5)
  cabin('h6', 39.5, 75, 11, 7, { asset: 'log_cabin_b' }),
  { id: 'pole_c', type: 'telegraph_pole', variant: 'lamp_crossbar', x: 44, z: 64, r: 0.15, h: 7, wireTo: 'pole_n' },
  // --- the lower camp (centre)
  { id: 'woodshed', type: 'hut', variant: 'woodshed_open', x: 46.5, z: 54, rot: deg(328), w: 6, d: 4, h: 3, asset: 'lean_to_canopy' },
  { id: 'pole_n', type: 'telegraph_pole', variant: 'wall_telephone', x: 50.5, z: 51, r: 0.15, h: 7, wireTo: 'lower_station' },
  // (art pass 2: the smaller log house at its true scale, not the village cabin shrunk to 75 % of its length)
  { id: 'g1_hq', type: 'barracks', variant: 'log_hq_flag', asset: 'log_cabin_a', x: 54, z: 57, rot: deg(328), w: 8, d: 6, h: 4, flag: true, garrison: true },
  tent('tent_1', 51, 64), tent('tent_2', 62, 62), tent('tent_3', 68, 68),
  { id: 'lower_station', type: 'cable_car_station', variant: 'lower', x: 33, z: 86, rot: deg(335), w: 9, d: 8, h: 8 },
  { id: 'lower_deck', type: 'pier', variant: 'timber_deck', x: 41, z: 93, rot: deg(335), w: 10, d: 6, h: 0.4 },
  crates('crates_ls', 28, 79, 2, 2),
  // --- the south field (mined)
  { id: 'h8', type: 'flat_roof_house', variant: 'stone_hut', x: 38, z: 105.5, rot: deg(335), w: 9, d: 6, h: 4, mat: 'stone', roofWalk: false, enterable: true },
  { id: 'pole_s', type: 'telegraph_pole', variant: 'wall_telephone', x: 36, z: 113.5, r: 0.15, h: 7 },
  tent('tent_4', 37, 120), tent('tent_5', 42, 116.5), tent('tent_6', 43, 125),
  // (art pass 2: `hideMats` — the snow twin's garnished net on poles drew as a shredded white sheet; the bunker stands bare.
  // The twin's baked AO atlas still holds the net's shadow (the roof's E half, its E lip, the berm under the net's skirt
  // rendered near-black wherever the sun does not reach): `dropAo` switches the baked AO off the snow, earth and roof slab,
  // and `keepSnowOn` leaves the berm its own snow where the net's snow is stripped, so the E side matches the W and N)
  { id: 'g2_bunker', type: 'bunker', variant: 'concrete_flag', x: 94, z: 118, rot: 0, w: 8, d: 6, h: 3, flag: true, garrison: true,
    hideMats: 'hessian|camo_netting|timber_grey', keepSnowOn: 'kit:mud', dropAo: 'kit:snow|kit:mud|kit:concrete_slab' },
  { id: 'rock_sw', type: 'rocks', x: 1.5, z: 124, rot: 0, w: 3, d: 3, h: 2 },
  // --- the summit (y 16)
  ...SUMMIT, ...SUMMIT_FLAT, ...SUMMIT_DRESS, ...DRUMS,
  ...TREES,
  ...DRESSING,
  ...M05_DRESSING, // art pass 2 (art/m05-dressing.js): the stabbur behind the start house, the village well
];

export default {
  id: 'm05',
  campaign: 'BEL',
  title: 'Blind Justice',
  subtitle: 'Radar station above Herdla, Askøy, Norway · 2 May 1941',
  date: '1941-05-02',
  place: 'Radar station on the mountain above Herdla airfield, Askøy, near Bergen',
  theater: 'snow',
  coneColors: 'green',
  size: [107, 131],
  seed: 1941_0502,
  briefing: {
    historical: 'May 1941. Greece has fallen, and the bombing of Britain goes on night after night. London wants Berlin looking north, convinced that Norway is next, and nothing alarms them more than losing their eyes on the coast: the radar on the hill above Herdla airfield.',
    text: 'Only two of you tonight, officer, but the right two. You come in through the village at the foot of the mountain. The radar sits on the summit, and there are only two ways up: the cable car, or the east rock face, which only the Green Beret can scale. A field telephone line runs through the lower camp, and a ringing phone will pull a sentry off his post. We believe the southern approaches are mined: watch where their patrols walk, and walk there. Wreck the radar, then fly out in the little autogyro parked by the dish. I want both of you home.',
    objectivesSummary: 'Destroy the radar on the summit. Escape in the autogyro.',
    hints: [
      'The Spy needs a German uniform. One is drying on a line in the lower camp.',
      'Ring the southern telephone and the northern one answers, taking its guard with it. Use it again to hang up.',
      'Two ways to the top: the cable car, or the east cliff (Green Beret only).',
      'Mines south of the camp. The garrison knows where they are, so their footprints are safe ground.',
      'The Green Beret\'s shovel lets him dig into the snow and vanish.',
      'Taking out the barracks on the summit would make the rest a lot easier.',
      'Every guard on this map is wired to the alarm. Whatever they see or hear brings out the garrisons.',
      'Your ride home is the autogyro near the dish. Anyone can climb in.',
      'The big patrol by the lift walks all the way east and back. Work on the lower deck only while it is away.',
      'An officer riding the lift raises no eyebrows. Whoever rides it stays aboard until you get him out.',
    ],
  },
  lighting: { sunElevDeg: 28, sunAzimuthDeg: 315, kelvin: 6000, hdri: 'spring_broken_cloud', fog: 180, lut: 'norway' },
  water: null,
  baseTerrain: 'snow',
  // art pass: the valley drop cut into the terrain (visual: its cells stay the blocked `valley_rim` cliff) and the pine
  // canopy far below it (a visual wood: no sight blockers added)
  carves: VALLEY_CARVES,
  vegetation: { woods: [{ id: 'valley_wood', type: 'pine', points: VALLEY_WOOD, h: 9, spacing: 6.5, seed: 5401 }] }, // open, lower stand: the floor and banks show
  terrain: [
    { type: 'poly', terrain: 'ground', points: [[22, 38], [37, 37], [37, 50], [22, 51]] }, // T4 yard of h2
    { type: 'poly', terrain: 'ground', points: [[30, 99], [46, 99], [46, 113], [30, 113]] }, // T5 around h8
    { type: 'path', terrain: 'ground', points: [[20, 33], [30, 50], [38, 72], [40, 97], [44, 99]], width: 3 }, // T6 village footpath
    { type: 'path', terrain: 'ground', points: P19_TRACK, width: 2 }, // T7 Patrol 19's beaten track (the safe line)
  ],
  // placement rule (c): deliberate compound joins (wings, towers, party walls) — joinStructures
  structures: joinStructures(STRUCTURES, [['h1', 'h1_kennel'], ['h5', 'h5_wing'], ['h6', 'lower_station'], ['g1_hq', 'tent_1'], ['woodshed', 'logs_shed']]),
  // §3.4 the uniform hangs on a clothesline (use, 1.5 s: dressed at once); e8 stands 5 m SW of it
  furniture: FURNITURE,
  interactables: [
    { id: 'uniform_line', interactKind: 'clothesline', x: 52, z: 42 },
  ],
  items: [],
  vehicles: [
    // on-demand cabin (script): parked at the lower berth; boarding starts the ~20 s trip to the top
    { id: 'cablecar', vehicleType: 'cable_car', x: 41, z: 91, heading: deg(297), friendly: true,
      track: [{ x: 41, z: 91, y: 0.5 }, { x: 62.5, z: 49, y: Y + 0.5 }], schedule: { mode: 'pingpong', speed: 2.5, endWait: 1e9, delay: 1e9 } },
    // the escape: present from the start, parked N of the dish (2 seats)
    { id: 'autogyro', vehicleType: 'autogyro', x: 79, z: 25, y: Y, heading: deg(180), friendly: true, suspicious: false },
  ],
  commandos: [
    { role: 'greenberet', x: 18, z: 21.5, heading: deg(90), inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
    { role: 'spy', x: 22, z: 19.5, heading: deg(90), inventory: { pistol: 1, lethalInjection: 1, firstAid: 6 } },
  ],
  startDisguised: [], // the uniform is on the clothesline
  enemies: ENEMIES,
  // "anything suspect or seen in the ENTIRE map will immediately sound the alarm" [Kild]
  zones: [
    { id: 'z_all', poly: [[0, 0], [107, 0], [107, 131], [0, 131]], onSeen: 'RINT', onHeard: 'RINT', siren: true },
  ],
  jails: [],
  barracks: {
    g1_hq: { pool: 8, squads: [{ event: 'RINT', size: 4, exitVel: 2.7, exitRoute: [P(56, 61), P(55, 68), P(48, 72), P(47, 85), P(40, 97)], loopVel: 1.8, loop: G1_LOOP }] },
    g2_bunker: { pool: 6, squads: [{ event: 'RINT', size: 3, exitVel: 2.7, exitRoute: G2_EXIT, loopVel: 1.8, loop: G2_LOOP }] },
    g3_barracks: { pool: 8, squads: [{ event: 'RINT', size: 4, exitVel: 2.7, exitRoute: [P(95.5, 53), P(90, 40), P(84, 30)], loopVel: 1.8, loop: G3_LOOP }] },
  },
  // the Green Beret's climb up the east face; it tops out ~4.5 m SE of e15, inside his cone
  climbLinks: [
    { id: 'climb_e', a: [100, 90.5, 0], b: [101, 69.5, Y], roles: ['greenberet'] },
  ],
  ladders: [],
  triplines: [],
  setpieces: [
    // keepAboard: riders stay in the parked cabin at the far station (§12 5A: the Spy rides down and waits inside)
    { type: 'cable_car', id: 'cablecar_line', vehicle: 'cablecar', keepAboard: true,
      stations: [{ at: [41, 91], y: 0.5, exit: [39.5, 95] }, { at: [62.5, 49], y: Y + 0.5, exit: [64.5, 51.5] }] },
    { type: 'phones', id: 'phones',
      phones: [{ id: 'phone_s', at: [36.5, 112.8] }, { id: 'phone_n', at: [50.5, 51.8] }],
      links: { phone_s: 'phone_n', phone_n: 'phone_s' } },
    { type: 'minefield', id: 'mines', r: 0.7, cls: 'mine', vehicles: false, mines: MINES }, // 3 m lethal blast (§6.2)
  ],
  triggers: [
    // the barracks blast leaves one officer standing ([DE] "ein Unteroffizier schafft es noch raus")
    { on: 'structure:destroyed', match: { id: 'g3_barracks' }, once: true, delay: 1.5,
      do: [{ run: (world) => spawnSurvivor(world, { x: 95.5, z: 53, investigate: [94.7, 51.9], loop: G3_LOOP.map((p) => [p.x, p.z]) }) }] },
    { on: 'objective', match: { id: 'o1', status: 'done' }, once: true,
      do: [{ message: 'The radar is down. Get to the autogyro.', kind: 'objective' }] },
    { on: 'area', area: { poly: PLATEAU }, who: 'commando', once: true,
      do: [{ message: 'The summit. Three fuel drums by the barracks and the rim.', kind: 'info' }] },
  ],
  script: m05Script({ plateau: PLATEAU, massif: MASSIF, valley: VALLEY, hide: ['summit', 'massif', 'valley_rim'], lift: LIFT, art: ART }),
  objectives: [
    { id: 'o1', text: 'Destroy the radar on the summit', type: 'destroy', targets: ['radar'], required: true },
    { id: 'o2', text: 'Destroy the barracks on the summit', type: 'destroy', targets: ['g3_barracks'], required: false },
    { id: 'o3', text: 'Escape in the autogyro', type: 'escape', required: true, vehicleId: 'autogyro' },
  ],
  // the autogyro is adopted as the escape vehicle (present from the start); the script flies it out N once
  // o1 is done and every living commando is aboard (drivenOff completes o3)
  extraction: { vehicleId: 'autogyro', vehicleType: 'autogyro', friendly: true, spawnWhen: ['o1'], spawnAt: { x: 79, z: 25, heading: deg(180) }, leave: { x: 79, z: -12 } },
  // §3.4 exemption: an officer riding the lift is routine, so the disguised Spy may board the cable car in view
  // (dossier §12 Route B: he rides up past the living lift guards)
  rules: { spyMayBoard: ['cablecar'] },
  alarmFail: null,
  par: { time: 600 },
  cameraStart: { x: 22, z: 24, zoom: 1 },
};
