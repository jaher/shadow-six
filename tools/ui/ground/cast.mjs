/**
 * The menu ground fight's cast per theatre (user: "Make the soldiers in the main menu look very polished and in
 * different poses, xont just replicate the same model"), as tools/ui/ground/bake_ground.mjs renders it through the
 * theatre's still camera (ground-bake.js sprites): every man of a fight has his own LOOK — one of the game's six
 * commandos in his own kit and weapon, or one German variant (face, headgear, uniform for the theatre, his gun) — and
 * each look is rendered in the ACTS the theatre's fights give him (src/ui/ground-plan.js STAGES), in the headings
 * they turn him to (derived from the plans: `needs`), plus the theatre's vehicle, posed where it stops.
 * Headings: 0 = away from the camera, 90 = to the screen's right, 180 = toward it (degrees around the camera's own
 * ground heading). An act's frames are [clip, phase (a fraction of the clip)] read by the menu by index: a gait's
 * cycle; a fire pose's [aim, shot, aim2]; a held pose's [a, b]; a once-through act's progress; dead's one frame.
 * @module tools/ui/ground/cast
 */
import { STAGES, groundPlan, ACTS } from '../../../src/ui/ground-plan.js';

export const HEADINGS = [0, 45, 90, 135, 180, 225, 270, 315];
const cyc = (clip, n, o = 0) => Array.from({ length: n }, (_, i) => [clip, (o + i / n) % 1]);
const at = (clip, ps) => ps.map((p) => [clip, p]);

/** Each act's frames by the look's weapon class (long gun, sub-machine gun, pistol, MG) — or one set for all. */
const FRAMES = {
  run: cyc('run', 8),
  sprint: cyc('run_fast', 8),
  crouch: cyc('crouch_walk', 6),
  kneel: { long: at('kneel_shoot', [0.2, 0.42, 0.3]), smg: at('kneel_shoot', [0.2, 0.42, 0.3]), pistol: at('kneel_shoot', [0.2, 0.42, 0.3]) },
  // (aim / shoot: a commando's shouldered gun — his rifle_* clips leave it slung; a German's long gun aliases them to
  // rifle_aim / rifle_fire, an officer's pistol plays them as they are)
  stand: [['aim', 0.35], ['shoot', 0.25], ['aim', 0.8]],
  prone: { long: at('prone_shoot', [0.2, 0.5, 0.8]), smg: at('prone_shoot_smg', [0.2, 0.5, 0.8]), mg: at('prone_shoot', [0.2, 0.5, 0.8]),
    pistol: at('prone_pistol_shoot', [0.2, 0.5, 0.8]) },
  mg: at('prone_shoot', [0.2, 0.5, 0.8]),
  cover: at('crouch_idle', [0.15, 0.6]),
  watch: at('look_around', [0.2, 0.6]),
  reload: { long: at('rifle_reload', [0.12, 0.38, 0.62, 0.86]), smg: at('reload', [0.12, 0.38, 0.62, 0.86]), pistol: at('reload', [0.12, 0.38, 0.62, 0.86]) },
  throw: at('throw', [0.12, 0.3, 0.45, 0.62, 0.82]),
  point: at('point', [0.15, 0.4, 0.65]),
  down: at('go_prone', [0.15, 0.4, 0.65, 0.9]),
  die: at('die', [0.08, 0.2, 0.34, 0.5, 0.68, 0.88]),
  hit: at('knockback', [0.1, 0.3, 0.5, 0.75]),
  dead: at('dead', [0.5]),
};
/** Acts that loop (a phase is a point of the cycle) vs. play once (a phase is a point of the one pass). */
const ONCE = new Set(['reload', 'throw', 'point', 'down', 'die', 'hit']);
/** An act's sprites also need another's in the same heading: a hit man falls (`down`) before he lies `dead`. */
const ALSO = { die: ['dead'], hit: ['dead'] };
/** A commando's death clip is a prone one (die_prone): he pitches forward ('down') first; a German's own die falls. */
const FALLS = (look) => !!look?.fall;

export function framesOf(look, act) {
  const F = FRAMES[act];
  if (!F) throw new Error(`no frames for act ${act}`);
  const fr = Array.isArray(F) ? F : F[look.w] || F.long;
  return (look.frames?.[act] || fr).map(([clip, phase]) => ({ clip: look.clips?.[clip] || clip, phase, loop: !ONCE.has(act) }));
}

// the commandos (the game's six, each in his own kit and with his own weapon)
const C = {
  gb: { side: 'ally', name: 'Green Beret "Tiny" (beret, Thompson)', make: { faction: 'player', role: 'greenberet', weapon: 'thompson' }, w: 'smg', fall: true },
  sn: { side: 'ally', name: 'Sniper "Duke" (scoped No. 4 rifle)', make: { faction: 'player', role: 'sniper' }, w: 'long', fall: true },
  sp: { side: 'ally', name: 'Sapper "Inferno" (Mk III helmet, pack, Mills bombs, Thompson)', make: { faction: 'player', role: 'sapper', weapon: 'thompson' }, w: 'smg', prop: 'mills_bomb', fall: true },
  dr: { side: 'ally', name: 'Driver "Tread" (camo cap, Thompson)', make: { faction: 'player', role: 'driver' }, w: 'smg', fall: true },
  mr: { side: 'ally', name: 'Marine "Fins" (watch cap, Thompson)', make: { faction: 'player', role: 'diver', weapon: 'thompson' }, w: 'smg', fall: true },
  spy: { side: 'ally', name: 'Spy "Spooky" (civilian suit and flat cap, Walther)', make: { faction: 'player', role: 'spy', weapon: 'walther_p38' }, w: 'pistol', fall: true },
};
// a German of a variant (enemy looks: variantId), his gun (`arm`: re-armed from weapons.glb) and its class
// (a long gun or an MP40 aliases kneel_shoot to the standing rifle_aim in enemykit: unaliased, he kneels)
const G = (name, variantId, w = 'long', o = {}) => ({ side: 'axis', name, make: { faction: 'enemy', soldierType: variantId.replace(/_v\d+$/, ''), variantId }, w,
  unalias: w === 'pistol' ? null : ['kneel_shoot'], ...o });

/**
 * The theatres' casts: looks (id -> { side, name, make, w, prop?, arm? , at? }) and where each side is rendered (`at`:
 * a representative spot of the fight, [x, z]; the light, fog and scale there), and the vehicle.
 */
export const CAST = {
  // m07's quay: the commandos come along it from the W end, the Germans in winter whites and greatcoats face them
  snow: {
    at: { ally: [22, 110], axis: [38, 116.5] },
    looks: {
      gb: C.gb, sn: C.sn, dr: C.dr, sp: C.sp,
      w_hel: G('Rifleman, snow smock and whitewashed helmet', 'winter_v00'),
      w_cap: G('Rifleman, snow smock and field cap', 'winter_v05'),
      w_cap2: G('Rifleman, snow smock, field cap and glasses', 'winter_v03'),
      gc_nco: G('NCO in a greatcoat (MP40)', 'sentry_v06', 'smg', { arm: 'mp40' }),
      gc_rf: G('Rifleman in a greatcoat', 'sentry_v02'),
    },
  },
  // m11's oil field: over the sand at the wire; the Afrika Korps behind it
  desert: {
    at: { ally: [-2, 96], axis: [24, 92] },
    looks: {
      gb: C.gb, sn: C.sn, sp: C.sp, mr: C.mr,
      ak_cap: G('Afrika Korps rifleman, field cap', 'afrika_v00'),
      ak_hel: G('Afrika Korps rifleman, sand helmet', 'afrika_v02'),
      ak_pith: G('Afrika Korps rifleman, pith helmet', 'afrika_v11'),
      ak_nco: G('Afrika Korps NCO, field cap (MP40)', 'afrika_v07', 'smg', { arm: 'mp40' }),
      off: G('Officer, peaked cap (Walther)', 'officer_v03', 'pistol'),
    },
  },
  // m13's harbour: the commandos on the NW jetty face across the channel, the dock's Germans back at them
  coast: {
    at: { ally: [11, 47], axis: [31.5, 42] },
    looks: {
      gb: C.gb, dr: C.dr, mr: C.mr, spy: C.spy,
      rf1: G('Rifleman, M35 helmet', 'rifleman_v18'),
      rf2: G('Rifleman, M35 helmet', 'rifleman_v06'),
      tr: G('Trooper, M35 helmet (MP40)', 'trooper_v07', 'smg'),
      sg: G('Feldwebel, peaked cap (Luger)', 'sergeant_v02', 'pistol'),
    },
  },
  temperate: {
    at: { ally: [12, 92], axis: [22.5, 78.6] },
    looks: {
      gb: C.gb, sn: C.sn, sp: C.sp, dr: C.dr, mr: C.mr,
      rf1: G('Rifleman, M35 helmet', 'rifleman_v04'),
      rf2: G('Rifleman, M35 helmet', 'rifleman_v15'),
      tr: G('NCO, M35 helmet (MP40)', 'trooper_v01', 'smg'),
      off: G('Leutnant, peaked cap (Walther)', 'officer_v00', 'pistol'),
      mg: G('MG34 gunner', 'mg_v02', 'mg'),
      mg2: G('MG34 loader, M35 helmet', 'rifleman_v29'),
    },
    // the Panzer IV G where it stops, in the sun on the deck's E end (past the pillbox, short of the truss), heading
    // west: driving (tracks), traversing its turret toward the W bank, firing; and driving again at the deck's W end,
    // seen from there (the far side of the frame looks at it 35 degrees round), from 70 m along its road
    vehicle: { make: { type: 'panzer4', theater: 'temperate' }, at: [88.42, 105.95], y: 1.0, heading: Math.atan2(-65.8, -54.5),
      turret: [0, 6, 12, 18, 24, 29], travel: [0, 0.12, 0.24, 0.36],
      also: { key: 'w', at: [27.5, 55.6], y: 1.0, from: 70 } },
  },
};

/**
 * What a theatre's fights ask of each look: act -> the headings (cast HEADINGS, relative to the camera's `away`) its
 * men are in, over every variant and many seeds (the jitter turns them a little). @returns {Record<string, Record<string, Set<number>>>}
 */
export function needs(theatre, away, seeds = 24) {
  const out = {}, D = 180 / Math.PI;
  const rel = (h) => { const r = ((((away - h) * D) % 360) + 360) % 360; return HEADINGS.reduce((b, x) => (Math.abs(((x - r + 540) % 360) - 180) < Math.abs(((b - r + 540) % 360) - 180) ? x : b)); };
  const add = (look, act, hd) => {
    ((out[look] ||= {})[act] ||= new Set()).add(hd);
    for (const a of ALSO[act] || []) add(look, a, hd);
    if (act === 'die' && FALLS(CAST[theatre].looks[look])) add(look, 'down', hd);
  };
  for (let v = 0; v < (STAGES[theatre] || []).length; v++) {
    for (let seed = 1; seed <= seeds; seed++) {
      const p = groundPlan(theatre, seed, v);
      for (const s of p.soldiers) {
        if (!s.look) throw new Error(`${theatre} variant ${v}: a ${s.side} man without a look`);
        for (const g of s.segs) {
          if (!ACTS.includes(g.act)) throw new Error(`${theatre} variant ${v}: unknown act ${g.act}`);
          add(s.look, g.act, rel(g.h));
        }
      }
    }
  }
  return out;
}
