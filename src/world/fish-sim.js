/**
 * Fish schools (PROGRESS step 4f, "make sure the sea has some fish"): pure, deterministic boids simulation on SIM
 * time (frozen while paused, no gameplay effect, never saved). Rendering lives in src/art/fish-model.js and the
 * per-mission director in src/render/ambient-life.js.
 *
 *  - Species per theatre and body (`fishPlan`): Norway fjords herring / saithe (pollock) schools + cod near the bed +
 *    sprat shoals in the shallows; temperate / Channel harbours and coasts thick-lipped grey mullet under piers +
 *    European sea bass + sand smelt; the Mediterranean (North Africa) mullet, gilthead bream, sand smelt; Norway rivers
 *    brown trout and grayling holding station head-upstream (rheotaxis) + salmon in the pools + minnows; lowland
 *    rivers chub, roach, pike, trout, minnows; lakes perch, roach, carp, pike, minnows (Norway: perch, trout, pike).
 *    User 2026-10-11 "You can add some fish in the water too": shoals of small fish in the shallows where they show,
 *    big single fish cruising near the surface, leaps with a splash (salmon, trout, mullet, carp, chub), rises.
 *  - Behaviour: each school has a goal that wanders through its habitat (depth preference, shore / pier seeking via
 *    the water bake's shore distance, which counts piers and rocks), members steer with cohesion / alignment /
 *    separation, keep to their depth band, never leave the wet mask or go under shore ice.
 *  - Fright: threats (diver, swimmer, boat: continuous) and impulses (splash, shot into water, explosion) make fish
 *    burst away (C-start, schools flash-expand, then regroup); underwater blasts stun a few that roll belly-up and
 *    float at the surface for a few seconds before they recover and dive.
 * @module world/fish-sim
 */

/**
 * Species: body length range (m), group size, cruise / burst speed (m/s), depth band as a fraction of the water
 * column [top, bottom] with a minimum clearance, shore preference (0 open water … 1 hugs banks / piers, `shoreD`
 * = preferred distance m), rheotaxis (hold station against the current), cohesion, colours (sRGB hex:
 * back, flank, belly), pattern (0 plain, 1 perch bars, 2 trout spots, 3 cod mottle, 4 saithe lateral line,
 * 5 bass/mullet stripes, 6 salmon x-spots, 7 pike pale spots, 8 carp / chub scales), body depth / width ratios, tail
 * fork, flank mirror metalness; `dPref` = the water depth a shoal / lurker prefers (m: the shallows); `small` = a
 * shoal fish drawn with a lighter body; `lurk` = waits motionless at a lie, darts; `jump` = leaps per fish per minute;
 * `flash` = feeding flank flashes per fish per minute (a roll that turns the silver flank to the sky), `rise` = surface rises per fish per
 * minute (trout / grayling taking flies, mullet and herring dimpling the surface: "nervous water").
 */
export const FISH_SPECIES = {
  herring: { len: [0.29, 0.37], group: [45, 75], cruise: 0.42, burst: 2.4, band: [0.15, 0.6], shore: 0.05, shoreD: 8,
    coh: 1.2, align: 1.1, sepK: 1.1, back: 0x33525e, flank: 0xb9c6cc, belly: 0xeef2f2, pattern: 0, depthR: 0.2, widthR: 0.11, fork: 0.9, metal: 0.75, flash: 10, rise: 0.25 },
  pollock: { len: [0.5, 0.75], group: [10, 16], cruise: 0.5, burst: 2.6, band: [0.2, 0.65], shore: 0.35, shoreD: 4,
    coh: 1, align: 1, sepK: 1.3, back: 0x1c2420, flank: 0x6d7a70, belly: 0xc9cdc4, pattern: 4, depthR: 0.2, widthR: 0.11, fork: 0.55, metal: 0.4, flash: 5, rise: 0 },
  cod: { len: [0.55, 0.9], group: [2, 4], cruise: 0.28, burst: 1.9, band: [0.72, 0.95], shore: 0.25, shoreD: 4,
    coh: 0.5, align: 0.4, sepK: 1.6, back: 0x453d2a, flank: 0x8b8258, belly: 0xd8d6c4, pattern: 3, depthR: 0.19, widthR: 0.13, fork: 0.05, metal: 0.1, flash: 1, rise: 0 },
  mullet: { len: [0.32, 0.46], group: [14, 24], cruise: 0.4, burst: 2.2, band: [0.1, 0.4], shore: 0.8, shoreD: 2,
    coh: 1, align: 1, sepK: 1.3, back: 0x3a4850, flank: 0x9aa4a6, belly: 0xe2e4e0, pattern: 5, depthR: 0.19, widthR: 0.13, fork: 0.45, metal: 0.5, flash: 8, rise: 0.6 },
  seabass: { len: [0.4, 0.6], group: [4, 7], cruise: 0.45, burst: 2.6, band: [0.3, 0.8], shore: 0.6, shoreD: 3,
    coh: 0.9, align: 0.9, sepK: 1.4, back: 0x28333b, flank: 0xaab4bb, belly: 0xeceeec, pattern: 0, depthR: 0.22, widthR: 0.11, fork: 0.3, metal: 0.6, flash: 6, rise: 0.1 },
  trout: { len: [0.28, 0.42], group: [1, 2], cruise: 0.35, burst: 2.2, band: [0.45, 0.85], shore: 0.55, shoreD: 2.5, rheo: true,
    coh: 0.3, align: 0.2, sepK: 2, back: 0x33321e, flank: 0xa39a6a, belly: 0xe4dcc0, pattern: 2, depthR: 0.21, widthR: 0.11, fork: 0.1, metal: 0.2, flash: 3, rise: 1.6 },
  grayling: { len: [0.28, 0.4], group: [4, 8], cruise: 0.4, burst: 2.3, band: [0.4, 0.8], shore: 0.3, shoreD: 4, rheo: true,
    coh: 0.6, align: 0.5, sepK: 1.8, back: 0x2a3032, flank: 0x9aa2a6, belly: 0xe2e4e0, pattern: 0, depthR: 0.2, widthR: 0.11, fork: 0.5, metal: 0.45, flash: 5, rise: 1 },
  perch: { len: [0.18, 0.28], group: [8, 14], cruise: 0.3, burst: 1.8, band: [0.25, 0.75], shore: 0.7, shoreD: 2,
    coh: 1, align: 0.8, sepK: 1.3, back: 0x27301c, flank: 0x9ea24e, belly: 0xe4e2c8, pattern: 1, depthR: 0.27, widthR: 0.11, fork: 0.25, metal: 0.15, flash: 2, rise: 0.3 },
  // shoals of small fish in the shallows near the banks (sprat in the fjords, sand smelt on the sea coasts, minnows
  // in rivers and lakes): dark clouds that wheel together over the light shallow bed, where they are easiest to see
  sprat: { len: [0.08, 0.13], group: [35, 60], cruise: 0.35, burst: 2, band: [0.06, 0.45], shore: 0.6, shoreD: 3, dPref: 0.7,
    coh: 1.4, align: 1.3, sepK: 1.2, back: 0x3a5a66, flank: 0xc2ccd0, belly: 0xf2f4f4, pattern: 0, depthR: 0.2, widthR: 0.1, fork: 0.8, metal: 0.8, flash: 10, rise: 0.35, small: true },
  sandsmelt: { len: [0.07, 0.12], group: [30, 55], cruise: 0.3, burst: 1.9, band: [0.05, 0.4], shore: 0.8, shoreD: 1.5, dPref: 0.5,
    coh: 1.4, align: 1.3, sepK: 1.2, back: 0x3a4a44, flank: 0xb6c2bc, belly: 0xeef0ec, pattern: 4, depthR: 0.17, widthR: 0.1, fork: 0.6, metal: 0.6, flash: 6, rise: 0.3, small: true },
  minnow: { len: [0.05, 0.09], group: [25, 45], cruise: 0.25, burst: 1.6, band: [0.05, 0.5], shore: 0.9, shoreD: 1.2, dPref: 0.45,
    coh: 1.4, align: 1.2, sepK: 1.2, back: 0x3c3a26, flank: 0x9c9468, belly: 0xdcd6b8, pattern: 1, depthR: 0.2, widthR: 0.12, fork: 0.35, metal: 0.25, flash: 4, rise: 0.25, small: true },
  // big fish, alone or in twos and threes: the salmon in the Norway rivers' pools (leaping now and then), pike lurking
  // still at the margins of lowland lakes and rivers (and darting), carp cruising and basking just under the surface,
  // chub under the banks, roach shoals, gilthead bream round the Mediterranean quays
  salmon: { len: [0.6, 0.9], group: [1, 2], cruise: 0.4, burst: 3, band: [0.45, 0.85], shore: 0.3, shoreD: 4, rheo: true,
    coh: 0.3, align: 0.2, sepK: 2, back: 0x2a383c, flank: 0xb4bcbe, belly: 0xeceeea, pattern: 6, depthR: 0.21, widthR: 0.11, fork: 0.15, metal: 0.6, flash: 1, rise: 0.1, jump: 0.35 },
  pike: { len: [0.6, 1.0], group: [1, 1], cruise: 0.12, burst: 3.6, band: [0.12, 0.45], shore: 0.85, shoreD: 1.5, dPref: 0.8, lurk: true,
    coh: 0, align: 0, sepK: 2, back: 0x2a3418, flank: 0x66723a, belly: 0xd8d4b4, pattern: 7, depthR: 0.15, widthR: 0.1, fork: 0.1, metal: 0.08, flash: 0, rise: 0 },
  carp: { len: [0.5, 0.8], group: [2, 4], cruise: 0.22, burst: 1.9, band: [0.06, 0.45], shore: 0.5, shoreD: 3,
    coh: 0.8, align: 0.7, sepK: 1.6, back: 0x3a2c16, flank: 0x96743a, belly: 0xdac48e, pattern: 8, depthR: 0.3, widthR: 0.15, fork: 0.3, metal: 0.3, flash: 1, rise: 1.5, jump: 0.08 },
  roach: { len: [0.15, 0.25], group: [10, 20], cruise: 0.32, burst: 2, band: [0.2, 0.6], shore: 0.5, shoreD: 3,
    coh: 1.1, align: 1, sepK: 1.3, back: 0x2c3430, flank: 0xb8c0bc, belly: 0xeae8e2, pattern: 0, depthR: 0.3, widthR: 0.1, fork: 0.5, metal: 0.6, flash: 5, rise: 0.5 },
  chub: { len: [0.3, 0.5], group: [3, 6], cruise: 0.3, burst: 2.4, band: [0.08, 0.4], shore: 0.8, shoreD: 1.5,
    coh: 0.9, align: 0.8, sepK: 1.5, back: 0x2c3022, flank: 0xa8a68c, belly: 0xe2e0d0, pattern: 8, depthR: 0.24, widthR: 0.13, fork: 0.35, metal: 0.35, flash: 2, rise: 1.2, jump: 0.03 },
  // sea trout (sjøørret) hunt the fjord shores all winter, leaping now and then
  seatrout: { len: [0.4, 0.7], group: [1, 2], cruise: 0.38, burst: 2.8, band: [0.15, 0.55], shore: 0.6, shoreD: 4,
    coh: 0.3, align: 0.3, sepK: 2, back: 0x2c3438, flank: 0xb4bcbe, belly: 0xeceeea, pattern: 6, depthR: 0.21, widthR: 0.11, fork: 0.15, metal: 0.65, flash: 2, rise: 0.15, jump: 0.3 },
  bream: { len: [0.25, 0.45], group: [4, 9], cruise: 0.38, burst: 2.4, band: [0.25, 0.7], shore: 0.6, shoreD: 3,
    coh: 1, align: 0.9, sepK: 1.4, back: 0x3a4a52, flank: 0xb6c0c4, belly: 0xecece8, pattern: 0, depthR: 0.38, widthR: 0.11, fork: 0.5, metal: 0.6, flash: 4, rise: 0 },
};
// leapers: mullet skip out of the water a lot, trout now and then
FISH_SPECIES.mullet.jump = 0.08; FISH_SPECIES.trout.jump = 0.08;
// herring shoals ride high (dimpling the surface: "nervous water"); their steel-blue backs (lighter than the old
// navy: seen from above they read against the dark fjord, as real herring backs do in daylight)
FISH_SPECIES.herring.band = [0.05, 0.35]; FISH_SPECIES.herring.rise = 0.35;
// one object shape for every species (all the optional keys, same order): the per-fish hot loops read S.* of a dozen
// species in a mixed lake, and one shape keeps those reads fast (≈ 3× faster than mixed shapes)
const SPECIES_KEYS = ['len', 'group', 'cruise', 'burst', 'band', 'shore', 'shoreD', 'dPref', 'rheo', 'lurk', 'small', 'jump', 'coh', 'align', 'sepK',
  'back', 'flank', 'belly', 'pattern', 'depthR', 'widthR', 'fork', 'metal', 'flash', 'rise'];
for (const k of Object.keys(FISH_SPECIES)) {
  const S = FISH_SPECIES[k], D = { dPref: 0, rheo: false, lurk: false, small: false, jump: 0, rise: 0, flash: 0 };
  FISH_SPECIES[k] = Object.fromEntries(SPECIES_KEYS.map((q) => [q, S[q] ?? D[q]]));
}

/**
 * Habitat → [species, number of groups per 1000 m² of water, max groups]. Norway (snow): fjords, rivers, lakes;
 * temperate Europe: lowland rivers and lakes, Atlantic / Channel seas; North Africa (desert): the Mediterranean.
 */
export const FISH_HABITATS = {
  fjord: [['herring', 1.3, 4], ['pollock', 0.9, 3], ['cod', 1.4, 4], ['sprat', 2.2, 5], ['seatrout', 1.2, 3]],
  sea: [['mullet', 1.1, 4], ['seabass', 1, 3], ['sandsmelt', 2, 5]],
  medsea: [['mullet', 1.3, 4], ['bream', 1.1, 3], ['sandsmelt', 2, 5]],
  river: [['trout', 10, 18], ['grayling', 3, 5], ['salmon', 1.2, 3], ['minnow', 4, 6]],
  lowriver: [['chub', 3, 5], ['roach', 3, 5], ['pike', 1, 2], ['trout', 3, 5], ['minnow', 4, 6]],
  lake: [['perch', 3, 6], ['trout', 1.2, 3], ['pike', 0.8, 2], ['minnow', 3, 5]],
  lowlake: [['perch', 3, 6], ['roach', 3, 5], ['carp', 1.5, 4], ['pike', 1.3, 2], ['minnow', 3, 5]],
};

/** Leaps per species: take-off speeds up (vy) and along (vh), m/s, and the twist in the air (rad). */
const JUMP = {
  salmon: { vy: 3.1, vh: 2.2, twist: 0.5 }, seatrout: { vy: 2.4, vh: 1.9, twist: 0.5 }, trout: { vy: 2.1, vh: 1.6, twist: 0.4 }, mullet: { vy: 1.7, vh: 2.6, twist: 0.2 },
  carp: { vy: 1.6, vh: 0.9, twist: 0.9 }, chub: { vy: 1.5, vh: 1.3, twist: 0.3 },
};

/**
 * Habitat of a water body: fjord preset / snow seas → fjord; other seas + harbours → sea (the Mediterranean in the
 * desert theatre); rivers (Norway or lowland); lakes and ponds (Norway or lowland); a raised reservoir is a lake.
 */
export function fishHabitat(body, theater) {
  if (body.frozen) return null;
  if (body.habitat && FISH_HABITATS[body.habitat]) return body.habitat;
  const north = theater === 'snow', med = theater === 'desert';
  if (body.type === 'river') return med ? 'medsea' : north ? 'river' : 'lowriver';
  if (body.raised) return north ? 'lake' : 'lowlake';
  if (body.preset === 'fjord' || (body.type === 'sea' && north)) return 'fjord'; // Norway: still fjords are sea arms
  if (body.type === 'sea' || body.preset === 'harbor' || body.preset === 'sea') return med ? 'medsea' : 'sea';
  return med ? 'medsea' : north ? 'lake' : 'lowlake'; // Tunis harbour (M12) is a "lake" cell body by the sea
}

/** Deterministic LCG in [0, 1). */
export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Quality → population scale (low keeps a few so every preset has fish). */
export const FISH_DENSITY = { low: 0.45, medium: 0.7, high: 1, ultra: 1.25 };

/**
 * Plan the schools of a map: one entry per group {sp, habitat, body, n, x, z}.
 * @param {{type:string, preset?:string, frozen?:boolean, spots:number[][], area:number}[]} bodies spots = [x, z] of
 *   open-water cells (enough depth), area in m²
 * @param {string} theater @param {number} [seed] @param {string} [quality] @param {number} [density] mission scale 0..2
 */
export function fishPlan(bodies, theater, seed = 7, quality = 'high', density = 1) {
  const rnd = makeRng(seed ^ 0x5f3759df), out = [], dens = (FISH_DENSITY[quality] ?? 1) * Math.max(0, Math.min(2, density ?? 1));
  bodies.forEach((b, bi) => {
    const hab = fishHabitat(b, theater);
    if (!hab || !b.spots?.length) return;
    FISH_HABITATS[hab].forEach(([sp, per1k, max], k) => {
      const S = FISH_SPECIES[sp];
      // a pond (> 300 m²) is sure of its first two species; the rest by area; puddles (≤ 150 m²) get none
      const want = b.area <= 150 ? 0 : Math.max(b.area > 300 && k < 2 ? 1 : 0, Math.min(max, Math.round((b.area / 1000) * per1k * dens)));
      for (let k = 0; k < want; k++) {
        const [x, z] = b.spots[(rnd() * b.spots.length) | 0];
        const n = Math.max(1, Math.round((S.group[0] + rnd() * (S.group[1] - S.group[0])) * (S.group[1] > 8 ? Math.max(0.6, dens) : 1)));
        out.push({ sp, habitat: hab, body: bi, n, x, z });
      }
    });
  });
  return out;
}

const TAU = Math.PI * 2;
const FR = [0, 0, 0];
const wrapA = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * The schools of one mission. `water.sample(x, z)` → {depth, shore, flow:[vx,vz], level, ice} | null (the water
 * system's gameplay query). All motion runs on the time passed to `step` (sim time deltas).
 */
export class FishSim {
  /** @param {object[]} plan fishPlan() output @param {{sample:Function}} water @param {number} [seed] */
  constructor(plan, water, seed = 11) {
    this.water = water;
    this.rnd = makeRng(seed);
    this.schools = []; this.fish = [];
    this.threats = []; this.impulses = [];
    /** Surface rings to hand to the water ripples (rises, dimples): [{x, z, s}] — drained by the director. */
    this.rings = [];
    /** Leaps out of the water / back in: [{x, z, s, fish, out}] — drained by the director (splash, sound). */
    this.splashes = [];
    this.stats = { stunned: 0, scared: 0, blasts: 0, jumps: 0 };
    this.t = 0;
    for (const p of plan) this._spawn(p);
  }

  _spawn(p) {
    const S = FISH_SPECIES[p.sp], r = this.rnd;
    const s0 = this.water.sample(p.x, p.z);
    if (!s0 || s0.ice) return;
    const sch = { sp: p.sp, S, gx: p.x, gz: p.z, gh: r() * TAU, eval: r() * 0.5, alarm: 0, members: [], relie: 4 + r() * 10,
      lx: p.x, lz: p.z, cx: p.x, cz: p.z, mvx: 0, mvz: 0, dimT: r(), lag: 0, rot: 0 };
    this.schools.push(sch);
    const spread = Math.sqrt(p.n) * S.len[1] * 0.9;
    for (let i = 0; i < p.n; i++) {
      const len = S.len[0] + r() * (S.len[1] - S.len[0]);
      const a = r() * TAU, d = spread * Math.sqrt(r());
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      const f = { sp: p.sp, S, sch, len, x, z, y: s0.level - this._bandY(S, s0.depth, len, r()), vx: Math.cos(sch.gh) * S.cruise * 0.5,
        vy: 0, vz: Math.sin(sch.gh) * S.cruise * 0.5, yaw: sch.gh, pitch: 0, roll: 0, bend: 0, phase: r() * TAU, amp: 0.1, beat: 1,
        fright: 0, stun: 0, rec: 0, pref: r(), chk: r() * 0.2, depth: s0.depth, shore: s0.shore, level: s0.level, fx: 0, fz: 0, bad: 0,
        ox: (r() - 0.5) * spread, oz: (r() - 0.5) * spread, flashT: r() * 8, fl: 0, flA: 0, riseT: 5 + r() * 60 / Math.max(0.05, S.rise || 0.05), rise: 0,
        jumpT: S.jump ? 8 + r() * 60 / S.jump : Infinity, jump: null, dry: 0, gone: false, dashT: 6 + r() * 20, dash: -1, ax: 0, az: 0 }; // every field up front: one shape for every fish (fast)
      sch.members.push(f); this.fish.push(f);
    }
  }

  /** Target depth below the surface (m) for a fraction `u` inside the species band. */
  _bandY(S, depth, len, u) {
    const lo = Math.min(0.1 + len * 0.25, depth * 0.5), hi = Math.max(lo, depth - 0.08 - len * S.depthR * 0.6);
    return clamp(depth * (S.band[0] + (S.band[1] - S.band[0]) * u), lo, hi);
  }

  /** Habitat score of a point for a species (−1 = unusable). */
  _score(S, x, z) {
    const s = this.water.sample(x, z);
    if (!s || s.ice || s.depth < 0.22) return -1;
    const dz = S.dPref ? Math.exp(-(((s.depth - S.dPref) / (0.5 * S.dPref + 0.15)) ** 2)) : Math.min(1, s.depth / (S.band[1] > 0.7 ? 0.9 : 0.5));
    const sh = S.shore * Math.exp(-((s.shore - S.shoreD) ** 2) / (2 * (S.shoreD * 0.8 + 1) ** 2)) + (1 - S.shore) * Math.min(1, s.shore / S.shoreD);
    return 0.5 * dz + sh;
  }

  /**
   * A shoal turning together shows its flanks all at once (the silver wave that gives a shoal away from above):
   * every member's next flash comes within 0.35 s, sooner the nearer it is to the leading edge.
   */
  _flashWave(sch) {
    if (sch.S.flash < 2 || sch.members.length < 6) return;
    const c = Math.cos(sch.gh), s = Math.sin(sch.gh);
    for (const f of sch.members) f.flashT = Math.min(f.flashT, 0.05 + 0.3 * (0.5 - Math.max(-0.5, Math.min(0.5, ((f.x - sch.cx) * c + (f.z - sch.cz) * s) / 3))));
  }

  /** Continuous threats this frame: [{x, z, r, s}] (divers, swimmers, boats). */
  setThreats(list) { this.threats = list || []; }

  /**
   * A one-off disturbance: splash, bullet, grenade. `blast` = underwater explosion → up to `stun` fish inside
   * 0.6 r roll belly-up and float for a few seconds.
   */
  impulse(x, z, r, s = 1, o = {}) {
    this.impulses.push({ x, z, r, s, life: 1.2 });
    if (!o.blast) return 0;
    this.stats.blasts++;
    let left = o.stun ?? 3;
    const near = this.fish.filter((f) => !f.stun && (f.x - x) ** 2 + (f.z - z) ** 2 < (r * 0.6) ** 2)
      .sort((a, b) => ((a.x - x) ** 2 + (a.z - z) ** 2) - ((b.x - x) ** 2 + (b.z - z) ** 2));
    for (const f of near) {
      if (left-- <= 0) break;
      f.stun = 4 + this.rnd() * 5; f.rec = 0; this.stats.stunned++;
    }
    return Math.min(near.length, o.stun ?? 3);
  }

  /** Advance by dt seconds of sim time (sub-stepped). `drift(x, z)` → [vx, vz] surface wind drift for floaters. */
  step(dt, drift = null) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.5);
    const n = Math.ceil(dt / 0.05), h = dt / n;
    for (let k = 0; k < n; k++) this._step(h, drift);
  }

  _schoolStep(sch, h) {
    const S = sch.S, r = this.rnd;
    // centroid + mean velocity of the members that swim
    let cx = 0, cz = 0, vx = 0, vz = 0, m = 0;
    for (const f of sch.members) if (!f.stun) { cx += f.x; cz += f.z; vx += f.vx; vz += f.vz; m++; }
    if (m) { sch.cx = cx / m; sch.cz = cz / m; sch.mvx = vx / m; sch.mvz = vz / m; }
    sch.alarm = Math.max(0, sch.alarm - h * 0.35);
    if (S.rheo || S.lurk) { // trout, salmon: hold a lie head-upstream; pike: lie in wait at the margin; now and then move
      sch.relie -= h;
      if (sch.relie <= 0) {
        sch.relie = S.lurk ? 40 + r() * 50 : 8 + r() * 16;
        let best = -1, bx = sch.lx, bz = sch.lz;
        for (let k = 0; k < 6; k++) {
          const a = r() * TAU, d = S.lurk ? 1.5 + r() * 2.5 : 1 + r() * 4, x = sch.lx + Math.cos(a) * d, z = sch.lz + Math.sin(a) * d, sc = this._score(S, x, z);
          if (sc > best) { best = sc; bx = x; bz = z; }
        }
        if (best > 0) { sch.lx = bx; sch.lz = bz; }
      }
      sch.gx = sch.lx; sch.gz = sch.lz;
      return;
    }
    // a shoal riding high dimples the surface above it ("nervous water"): small rings over it, a few a second
    if (S.rise >= 0.25 && m > 4) {
      sch.dimT -= h;
      if (sch.dimT <= 0) {
        sch.dimT = 0.25 + r() * 0.5;
        const f = sch.members[(r() * sch.members.length) | 0];
        if (!f.stun && !f.jump && f.level - f.y < 0.4) this.rings.push({ x: f.x, z: f.z, s: 0.25 + f.len, dimple: true });
      }
    }
    // everyone else: the school goal wanders through the habitat, turning away from poor water
    const sp = S.cruise * (0.75 + 0.6 * sch.alarm);
    sch.gh = wrapA(sch.gh + (r() - 0.5) * 1.4 * h);
    sch.eval -= h;
    if (sch.eval <= 0) {
      sch.eval = 0.6 + r() * 0.4;
      const look = 2.5 + S.len[1] * 4;
      const here = this._score(S, sch.gx + Math.cos(sch.gh) * look, sch.gz + Math.sin(sch.gh) * look);
      if (here < 0.55) {
        let best = here, bh = sch.gh;
        for (let k = 1; k <= 8; k++) {
          const a = sch.gh + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.55;
          const sc = this._score(S, sch.gx + Math.cos(a) * look, sch.gz + Math.sin(a) * look);
          if (sc > best + 0.02) { best = sc; bh = a; }
        }
        const g0 = sch.gh;
        sch.gh = best < 0 ? wrapA(sch.gh + Math.PI * (0.6 + 0.4 * r())) : bh;
        if (Math.abs(wrapA(sch.gh - g0)) > 0.8) this._flashWave(sch); // the shoal wheels: a wave of silver flanks
      }
    }
    // the goal never runs away from the school
    const lag = Math.hypot(sch.gx - sch.cx, sch.gz - sch.cz), slow = lag > 3 ? 0.2 : 1;
    const ng = this.water.sample(sch.gx + Math.cos(sch.gh) * sp * h * slow, sch.gz + Math.sin(sch.gh) * sp * h * slow);
    if (ng && !ng.ice && ng.depth > 0.22) { sch.gx += Math.cos(sch.gh) * sp * h * slow; sch.gz += Math.sin(sch.gh) * sp * h * slow; }
    else sch.gh = wrapA(sch.gh + Math.PI * 0.5 + r());
  }

  /**
   * Level of detail for the simulation: `near(x, z)` → true for schools worth stepping every frame (in or close to
   * the view; the director passes its view rectangle grown by 12 m). Schools far from it are stepped at 5 Hz with the
   * time they missed; nothing is seen of them meanwhile, and they are back to full rate before they come into view.
   */
  setFocus(near) { this.near = near || null; }

  _step(h, drift) {
    this.t += h;
    for (const im of this.impulses) im.life -= h;
    if (this.impulses.length) { let k = 0; for (const im of this.impulses) if (im.life > 0) this.impulses[k++] = im; this.impulses.length = k; }
    let scared = 0;
    for (const sch of this.schools) {
      let hh = h;
      if (this.near && sch.members.length > 1 && !this.near(sch.cx, sch.cz) && !sch.alarm) {
        sch.lag += h;
        if (sch.lag < 0.2) continue;
        hh = sch.lag;
      }
      sch.lag = 0;
      this._schoolStep(sch, hh);
      for (const f of sch.members) {
        if (f.gone) continue;
        if (f.stun > 0 || f.rec > 0) { this._stunStep(f, hh, drift); continue; }
        if (f.jump) { this._jumpStep(f, hh); continue; }
        scared += this._fishStep(f, hh) ? 1 : 0;
      }
    }
    this.stats.scared = scared;
  }

  /** Fright vector from threats + impulses → the shared FR = [ax, az, strength] (no allocation: hot path). */
  _fright(f) {
    let ax = 0, az = 0, fr = 0;
    for (let i = 0, n = this.threats.length + this.impulses.length; i < n; i++) {
      const im = i >= this.threats.length, T = im ? this.impulses[i - this.threats.length] : this.threats[i];
      if (im && T.pike === f) continue;
      const ex = f.x - T.x, ez = f.z - T.z, d2 = ex * ex + ez * ez;
      if (d2 >= T.r * T.r) continue;
      const d = Math.sqrt(d2) + 0.01, w = (1 - d / T.r) * T.s * (im ? Math.min(1, T.life * 2) : 1);
      ax += (ex / d) * w; az += (ez / d) * w; if (w > fr) fr = w;
    }
    FR[0] = ax; FR[1] = az; FR[2] = fr;
    return FR;
  }

  _fishStep(f, h) {
    const S = f.S, sch = f.sch, W = this.water;
    f.chk -= h;
    if (f.chk <= 0) { // 5 Hz water query: current, depth band, and a look-ahead for banks / ice / shallows
      f.chk = 0.2;
      const here = W.sample(f.x, f.z);
      if (here) { f.depth = here.depth; f.shore = here.shore; f.level = here.level; f.fx = here.flow[0]; f.fz = here.flow[1]; f.dry = 0; }
      else if ((f.dry += 0.2) > 2) { f.gone = true; return false; } // stranded (a drained reservoir): out of the sim
      const la = 0.5 + f.len, sp = Math.hypot(f.vx, f.vz) + 1e-3;
      const s = W.sample(f.x + (f.vx / sp) * la, f.z + (f.vz / sp) * la);
      f.bad = !s || s.ice || s.depth < 0.2 + S.depthR * f.len ? 1 : 0;
      if (f.bad || !here) {
        const e = 0.7, sh = (x, z) => { const q = W.sample(x, z); return q && !q.ice ? q.shore + q.depth : -1; };
        const gx = sh(f.x + e, f.z) - sh(f.x - e, f.z), gz = sh(f.x, f.z + e) - sh(f.x, f.z - e), g = Math.hypot(gx, gz);
        if (g > 1e-4) { f.ax = gx / g; f.az = gz / g; } else { f.ax = -f.vx / sp; f.az = -f.vz / sp; }
        f.bad = 1;
      }
    }
    let dx, dz;
    const cr = S.cruise * (0.8 + 0.4 * f.pref);
    if (S.rheo || S.lurk) { // hold the lie head-upstream: ground velocity towards the lie (the current is stemmed by swimming)
      const t = this.t * (S.lurk ? 0.15 : 0.4) + f.pref * 9, wob = S.lurk ? 0.08 : 0.25;
      dx = (sch.gx + f.ox * 0.8 + Math.sin(t) * wob - f.x) * 0.5; dz = (sch.gz + f.oz * 0.8 + Math.cos(t * 1.3) * wob - f.z) * 0.5;
      if (S.lurk) { // a pike: motionless for long spells, then a sudden dart (the small fish round it scatter)
        f.dashT -= h;
        if (f.dashT <= 0) {
          f.dashT = 12 + this.rnd() * 25;
          const q = this.water.sample(f.x + Math.cos(f.yaw) * 1.6, f.z + Math.sin(f.yaw) * 1.6);
          if (q && !q.ice && q.depth > 0.4) f.dash = 0.35; // never into the bank
        }
        const sl = Math.hypot(dx, dz); if (sl > 0.3) { dx *= 0.3 / sl; dz *= 0.3 / sl; } // moving to a new lie: a slow glide
        if (f.dash > -0.6) f.dash -= h; // a dart (0.35 s), then a hard stop (0.6 s, braking on its fins)
        if (f.dash > 0) {
          dx = Math.cos(f.yaw) * S.burst; dz = Math.sin(f.yaw) * S.burst;
          if (f.dash - h <= 0) { sch.lx = f.x + Math.cos(f.yaw) * 0.3; sch.lz = f.z + Math.sin(f.yaw) * 0.3; this.impulses.push({ x: f.x, z: f.z, r: 2.2, s: 0.7, life: 0.6, pike: f }); }
        }
      }
    } else {
      dx = (sch.gx + f.ox * 0.45 - f.x) * 0.35 + (sch.cx - f.x) * 0.25 * S.coh + sch.mvx * 0.8 * S.align;
      dz = (sch.gz + f.oz * 0.45 - f.z) * 0.35 + (sch.cz - f.z) * 0.25 * S.coh + sch.mvz * 0.8 * S.align;
      // separation: big shoals look at 14 members a step (a different stretch each step), not all of them
      const sep = f.len * S.sepK, M = sch.members, nM = M.length, look = Math.min(nM, 14);
      sch.rot = (sch.rot + 5) % 1009;
      for (let j = 0; j < look; j++) {
        const o = M[nM > 14 ? (sch.rot + j * 3 + (f.pref * nM | 0)) % nM : j];
        if (o === f || o.stun) continue;
        const ex = f.x - o.x, ez = f.z - o.z, d2 = ex * ex + ez * ez;
        if (d2 > sep * sep || d2 < 1e-8) continue;
        const d = Math.sqrt(d2), w = ((sep - d) / sep) * 2 * cr;
        dx += (ex / d) * w; dz += (ez / d) * w;
      }
      const L = Math.hypot(dx, dz);
      if (L > 1e-4) { const k = Math.min(1.5, Math.max(0.35, L / cr)) * cr / L; dx *= k; dz *= k; }
    }
    const F3 = this._fright(f), ax = F3[0], az = F3[1], fr = F3[2];
    if (fr > 0.02) {
      f.fright = Math.max(f.fright, Math.min(1, fr * 1.6));
      sch.alarm = Math.max(sch.alarm, f.fright * 0.8);
      if (fr > 0.3 && !S.rheo) { if (sch.alarm < 0.3) this._flashWave(sch); sch.gh = Math.atan2(az, ax); }
    }
    f.fright = Math.max(0, f.fright - h * 0.55);
    if (f.fright > 0.05) {
      const L = Math.hypot(ax, az);
      if (L > 1e-4) { const k = f.fright; dx = dx * (1 - k) + (ax / L) * S.burst * k; dz = dz * (1 - k) + (az / L) * S.burst * k; }
      else { dx *= 1 + f.fright; dz *= 1 + f.fright; }
    }
    if (f.bad) { dx = dx * 0.25 + f.ax * cr * 1.6; dz = dz * 0.25 + f.az * cr * 1.6; }
    // ground velocity = swimming + current (trout already aim at a ground target)
    const tgx = S.rheo || S.lurk ? dx : dx + f.fx * 0.85, tgz = S.rheo || S.lurk ? dz : dz + f.fz * 0.85;
    const acc = Math.min(1, (f.fright > 0.3 || f.dash > -0.6 ? 7 : 1.6) * h);
    f.vx += (tgx - f.vx) * acc; f.vz += (tgz - f.vz) * acc;
    const nx = f.x + f.vx * h, nz = f.z + f.vz * h;
    if (!f.bad || W.sample(nx, nz)) { f.x = nx; f.z = nz; }
    // depth band (scared fish sound a little deeper), never through the bed or the surface
    const bedY = f.level - f.depth;
    let ty = f.level - this._bandY(S, f.depth, f.len, f.pref) - (f.fright > 0.3 ? 0.12 : 0);
    if (S.rise && f.fright < 0.1) { // surface rise: up to the film, a ring, back down
      f.riseT -= h;
      if (f.riseT <= 0) { f.riseT = (40 + this.rnd() * 80) / S.rise; f.rise = 0.9; }
      if (f.rise > 0) {
        const was = f.rise; f.rise -= h;
        if (was > 0.35) ty = f.level - 0.05;
        if (was > 0.35 && f.rise <= 0.35) this.rings.push({ x: f.x + Math.cos(f.yaw) * f.len * 0.4, z: f.z + Math.sin(f.yaw) * f.len * 0.4, s: 0.5 + f.len });
      }
    }
    if (S.jump && f.fright < 0.1 && f.rise <= 0) { // a leap: up through the water and out (checked over water both ways)
      f.jumpT -= h;
      if (f.jumpT <= 0) {
        f.jumpT = (40 + this.rnd() * 80) / S.jump;
        const L = JUMP[f.sp] || JUMP.trout, d = L.vh * 2 * L.vy / 9.81 + 0.5, q = W.sample(f.x + Math.cos(f.yaw) * d, f.z + Math.sin(f.yaw) * d);
        if (f.depth > 0.45 && q && !q.ice && q.depth > 0.35) f.jump = { ph: 'up', t: 0, L };
      }
    }
    ty = clamp(ty, bedY + 0.04 + f.len * S.depthR * 0.5, f.level - 0.07);
    f.vy += ((ty - f.y) * (f.rise > 0.35 ? 4 : 0.9) - f.vy) * Math.min(1, (f.rise > 0 ? 8 : 2.5) * h);
    f.y = clamp(f.y + f.vy * h, bedY + 0.03, f.level - 0.05);
    this._orient(f, h, f.vx - f.fx, f.vz - f.fz);
    return f.fright > 0.2;
  }

  /** Heading from the WATER-relative velocity (trout in a current face upstream), body bend, tail beat. */
  _orient(f, h, rx, rz) {
    const rs = Math.hypot(rx, rz), S = f.S;
    const ty = rs > 0.04 ? Math.atan2(rz, rx) : f.yaw;
    const mt = (f.fright > 0.3 ? 14 : 3.2) * h, turn = clamp(wrapA(ty - f.yaw), -mt, mt);
    f.yaw = wrapA(f.yaw + turn);
    f.bend += (clamp(turn / h / 10, -1, 1) - f.bend) * Math.min(1, 5 * h);
    f.pitch = clamp(Math.atan2(f.vy, Math.max(rs, 0.1)) * 0.8, -0.5, 0.5);
    // feeding flashes: a quick roll turns the guanine-mirror flank up to the sky (the glint that gives a school away)
    f.flashT -= h;
    if (f.flashT <= 0) { f.flashT = (30 + this.rnd() * 60) / Math.max(0.2, S.flash); f.fl = 0.35; f.flA = (this.rnd() < 0.5 ? -1 : 1) * (0.6 + 0.4 * this.rnd()); }
    let flr = 0;
    if (f.fl > 0) { f.fl -= h; flr = f.flA * Math.sin(Math.PI * Math.max(0, f.fl) / 0.35); }
    f.roll += (-f.bend * 0.3 + flr - f.roll) * Math.min(1, 14 * h);
    f.beat = clamp(rs / (0.62 * f.len), 0.7, 14);
    f.phase = (f.phase + TAU * f.beat * h) % TAU;
    f.amp = clamp(0.035 + 0.05 * rs / S.cruise, 0.035, 0.12) * (1 + 0.4 * f.fright); // tail tip ≈ 0.1–0.2 L peak to peak
  }

  /**
   * A leap: a fast swim up to the film, out of the water on a ballistic arc (nose up, then over and down), back in
   * nose first, a short dive back to its depth. Splashes out and in (this.splashes) and a ring at the entry.
   */
  _jumpStep(f, h) {
    const J = f.jump, L = J.L, W = this.water, c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    J.t += h;
    if (J.ph === 'up') { // drive up through the water column
      f.vx += (c * L.vh * 0.6 - f.vx) * Math.min(1, 6 * h); f.vz += (s * L.vh * 0.6 - f.vz) * Math.min(1, 6 * h);
      f.vy += (L.vy * 0.8 - f.vy) * Math.min(1, 8 * h);
      f.x += f.vx * h; f.z += f.vz * h; f.y += f.vy * h;
      f.pitch = Math.atan2(f.vy, Math.hypot(f.vx, f.vz)) * 0.9; f.beat = 12; f.amp = 0.16; f.phase = (f.phase + TAU * f.beat * h) % TAU;
      if (f.y >= f.level - 0.03 || J.t > 1.2) {
        J.ph = 'air'; J.t = 0; const k = 0.85 + 0.3 * this.rnd();
        f.vy = L.vy * k; f.vx = c * L.vh * k; f.vz = s * L.vh * k; f.y = Math.max(f.y, f.level - 0.03);
        this.splashes.push({ x: f.x, z: f.z, s: 0.1 + f.len * 0.25, fish: f, out: true }); this.stats.jumps++;
      }
      return;
    }
    if (J.ph === 'air') { // ballistic, the body following the arc, a twist and a flick of the tail
      f.vy -= 9.81 * h; f.x += f.vx * h; f.z += f.vz * h; f.y += f.vy * h;
      f.pitch = clamp(Math.atan2(f.vy, Math.hypot(f.vx, f.vz)), -1.3, 1.3); f.roll = L.twist * Math.sin(J.t * 9);
      f.beat = 9; f.amp = 0.1; f.phase = (f.phase + TAU * f.beat * h) % TAU;
      if (f.y < f.level - 0.02 && f.vy < 0) {
        J.ph = 'down'; J.t = 0;
        this.splashes.push({ x: f.x, z: f.z, s: 0.14 + f.len * 0.45, fish: f, out: false });
        this.rings.push({ x: f.x, z: f.z, s: 1 + f.len * 2 });
        const q = W.sample(f.x, f.z); if (q) { f.depth = q.depth; f.level = q.level; }
      }
      return;
    }
    // back under: braking, swimming down to its depth band
    f.vx *= 1 - Math.min(1, 3 * h); f.vz *= 1 - Math.min(1, 3 * h); f.vy += (-0.8 - f.vy) * Math.min(1, 6 * h);
    f.x += f.vx * h; f.z += f.vz * h; f.y = Math.max(f.level - f.depth + 0.05, f.y + f.vy * h);
    f.pitch += (-0.5 - f.pitch) * Math.min(1, 8 * h); f.roll *= 1 - Math.min(1, 8 * h);
    if (J.t > 0.45) { f.jump = null; f.chk = 0; f.vy = 0; }
  }

  /** Stunned: roll belly-up, float to just under the surface, drift with current + wind, twitch; then recover. */
  _stunStep(f, h, drift) {
    if (f.stun > 0) {
      f.stun -= h;
      f.roll += (Math.PI - f.roll) * Math.min(1, 2.5 * h);
      f.y += (f.level - 0.035 - f.y) * Math.min(1, 0.9 * h);
      const d = drift ? drift(f.x, f.z) : null;
      f.vx += (f.fx + (d ? d[0] : 0) - f.vx) * Math.min(1, h); f.vz += (f.fz + (d ? d[1] : 0) - f.vz) * Math.min(1, h);
      if (this.water.sample(f.x + f.vx * h, f.z + f.vz * h)) { f.x += f.vx * h; f.z += f.vz * h; }
      f.bend *= 1 - Math.min(1, 3 * h); f.pitch *= 1 - Math.min(1, 2 * h);
      const tw = Math.sin(this.t * 1.7 + f.pref * 20) > 0.93; // weak twitches
      f.beat = tw ? 7 : 0.3; f.amp = tw ? 0.2 : 0.04;
      f.phase = (f.phase + TAU * f.beat * h) % TAU;
      if (f.stun <= 0) f.rec = 1.2;
      return;
    }
    f.rec -= h;
    f.roll += (0 - f.roll) * Math.min(1, 5 * h);
    f.vy = -0.35; f.y = Math.max(f.level - f.depth + 0.05, f.y + f.vy * h);
    f.beat = 10; f.amp = 0.2; f.phase = (f.phase + TAU * f.beat * h) % TAU;
    if (f.rec <= 0) { f.rec = 0; f.fright = 0.9; f.chk = 0; }
  }

  /** Number of fish currently floating stunned. */
  get stunned() { let n = 0; for (const f of this.fish) if (f.stun > 0) n++; return n; }
}
