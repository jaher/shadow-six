/**
 * The cut for the M3 solution film (tools/solutions/capture-video.mjs): stage titles, step captions, title / end
 * cards, fixed camera shots and real-time windows. Times come from a logic-only pass of the same run (cp(k) = time of
 * checkpoint k, objT(o) = time objective o was done).
 */
export const TITLES = {
  A: 'A · The plateau: trap the sergeant, harpoon the troopers',
  B: 'B · The gully: knife the two sentries, hide the bodies',
  C: 'C · The Spy crawls round the camp to a uniform',
  D: 'D · The Marine, under water, harpoons the river post e14',
  E: 'E · Over the dam crest: fence power off, chat up the guard',
  F: 'F · A decoy turns e12; e6 knifed from behind, carried off',
  G: 'G · The raft crosses unseen; the Sapper takes the charges',
  H: 'H · The Sapper up on the crest, a decoy behind the bunker, the others to the truck road',
  I: 'I · Bunker and dam: one charge inside the bunker, one on top of the dam',
  J: 'J · Escape in the truck (objective 3)',
};

export const CAPTIONS = {
  A1: 'Bear trap on the patrol path; the decoy goes down beside it, switched off',
  A2: 'Sergeant e1 steps into the bear trap',
  A3: 'Decoy on: the two troopers stop and stare at it',
  A4: 'The Marine harpoons both of them; the Green Beret takes his decoy back',
  B1: 'The Green Beret knifes e5 from behind',
  B2: '… then e4',
  B3: 'Both bodies carried up onto the plateau, out of sight',
  C0: 'The Green Beret, dug in at the end of e8\u2019s beat, knifes him from behind',
  C1: 'e8 carried into the gap between the rocks under the cliff; the Green Beret digs in again',
  C2: 'The Spy crawls round the camp — behind e9, down its east side, along the strip outside the palisade',
  C3: 'Nobody looking: she takes a uniform from the clothesline',
  D1: 'Under water down the river; he surfaces on e14\u2019s blind side for one shot',
  E1: 'Disguised, she walks over the crest: nobody below can see up there',
  E2: 'Fence power off at the admin-block switch',
  E3: 'She chats up e17 from his west side: his back is to the river',
  F1: 'Decoy north of the camp: e12 turns his back on the west gate',
  F2: 'e6 knifed from behind',
  F3: '… and carried down the strip to e14, out of every cone',
  F4: 'Decoy off and fetched back',
  G1: 'Green Beret, Sapper and Marine by the raft',
  G2: 'Across in a gap in every cone (a boat on the water is seen in the light band too)',
  G3: 'The Marine packs the raft and dives (an empty raft in view is shot at); the Sapper cuts a man-sized hole in the dead fence',
  G4: 'The Spy leaves e17 and chats up e20, his back to the shed',
  G5: 'In through the hole on his belly; both time bombs taken from the shed',
  G5b: 'The Spy back with e17; nobody looking, the Sapper walks out through the hole upright',
  G6: 'Down on his belly again, back to the strip',
  H1: 'The raft, deployed again, fetches the Sapper back across and is packed; up the east stair he waits on the dam crest',
  H2: 'The Spy now holds e18 at the north gate, from his south side',
  H3: 'Decoy behind the bunker, by the patrol’s path; the Green Beret back on the strip, in the snow',
  H4: 'The raft takes the Green Beret over to the truck road and is packed away',
  H5: 'The Spy walks over the crest to the truck road',
  I1: 'Decoy on, by radio: the gunner, the gate sentry and the patrol turn to it, their backs to the stair',
  I2: 'Down the west stair, along its foot on his belly, in through the bunker\u2019s doorway: charge one set inside',
  I3: 'Charge two on top of the dam, at the spillway gates; then off the crest',
  I4: 'The bunker gutted, the dam breached (objectives 1 and 2)',
  J1: 'The truck backs in to the pickup north of the dam',
  J2: 'Each man to his own door, the door pulled shut behind him: mission complete',
};

export const TITLE_CARD = `
  <div style="font-size:22px;letter-spacing:6px;opacity:.85">SHADOW SIX</div>
  <div style="font-size:52px;margin:10px 0 6px">Mission 3 · Reverse Engineering</div>
  <div style="font-size:22px;font-style:italic;opacity:.9">Sysendam, Norway — destroy the bunker, demolish the dam, escape in the truck</div>
  <div style="font-size:18px;margin-top:26px;opacity:.85">Full stealth solution · player orders only · never spotted</div>`;

export function END_CARD(w, D) {
  const t = w.time, mm = Math.floor(t / 60), ss = Math.floor(t % 60);
  const kills = D.events.filter((e) => e.name === 'unit:killed').length;
  const obj = w.objectives.map((o) => `<div>${o.done ? '✔' : '✘'} ${o.text}</div>`).join('');
  return `
  <div style="font-size:50px;margin-bottom:12px">Mission complete</div>
  <div style="font-size:21px;line-height:1.6">${obj}</div>
  <div style="font-size:19px;margin-top:20px;opacity:.9">Game time ${mm}:${String(ss).padStart(2, '0')} · detections: ${D.detections()} · enemies killed: ${kills} · all four commandos alive</div>`;
}

/**
 * Film camera pitch (degrees) for a view centred on (x, z). The game's fixed 40° view cannot see the plateau strip
 * north of the 12 m east cliff (cliff_e, z 20–42): p1's beat (z 13–16), the trap, the decoy and the top of the gully
 * are behind it. Over the plateau and the gully the film looks down steeper; everywhere else it is the game's view.
 */
export const pitchAt = (x, z) => (x > 60 && z < 44 ? 64 : 40);

/** fixed shots (game time): the blasts and the decoy calls the camera should watch rather than the man ordering */
export function shots(cp, objT) {
  const s = [];
  const o1 = objT('o1'), o2 = objT('o2');
  if (o1) s.push({ t0: o1 - 6, t1: o1 + 7, x: 18, y: 0, z: 42, zoom: 0.6, prio: 2 }); // the bunker (10, 44) and the W stair
  if (o2) { // the blast and the burst, then the escape: the truck at the pickup north of the dam, the men climbing in
    s.push({ t0: o2 - 4, t1: o2 + 2, x: 47, y: 0, z: 25, zoom: 0.55, prio: 2 });
    s.push({ t0: o2 + 2, t1: o2 + 60, x: 59.5, z: 10.5, zoom: 0.85, prio: 2 }); // the truck stops at (60, 9.2)
  }
  const h2 = cp('H2'); if (h2) s.push({ t0: h2 - 2, t1: h2 + 3, x: 26, y: 0, z: 62, zoom: 0.8, prio: 1 }); // the Spy and e18
  const a3 = cp('A3'); if (a3) s.push({ t0: a3 - 4, t1: a3 + 4, x: 101, y: 0, z: 11, zoom: 0.7, prio: 1 }); // p1 stare at the decoy
  const i1 = cp('I1'); if (i1) s.push({ t0: i1 - 3.5, t1: i1 + 0.5, x: 15, y: 0, z: 50, zoom: 0.6, prio: 1 }); // the gunner turns, the decoy S of him
  const c0 = cp('C0'); if (c0) s.push({ t0: c0 - 3, t1: c0 + 2, x: 126, y: 0, z: 46, zoom: 0.7, prio: 1 }); // e8 knifed
  const d1 = cp('D1'); if (d1) s.push({ t0: d1 - 3, t1: d1 + 3, x: 101, y: 0, z: 75, zoom: 0.7, prio: 1 }); // e14 harpooned
  const f1 = cp('F1'); if (f1) s.push({ t0: f1 - 1, t1: f1 + 4, x: 95, y: 0, z: 52, zoom: 0.7, prio: 1 }); // e12 turns to the decoy
  return s;
}

/** real-time (or slow fast-forward) windows around the moments that matter */
export function windows(cp, objT) {
  const w = [];
  const o1 = objT('o1'), o2 = objT('o2');
  if (o1) w.push({ t0: o1 - 3, t1: o1 + 5, speed: 1 });
  if (o2) w.push({ t0: o2 - 3, t1: o2, speed: 1 }, { t0: o2, t1: o2 + 60, speed: 0.5 }); // the blast and the escape at half speed
  for (const [k, a, b, sp] of [['A3', -4, 1, 2], ['C0', -4, 2, 1], ['C3', -5, 1, 1.5], ['D1', -3, 2, 1], ['E2', -3, 1, 1.5],
    ['E3', -2, 2, 2], ['F2', -4, 2, 1], ['F3', -3, 1, 1.5], ['G2', -20, 1, 2], ['G3', -4, 1, 1.5], ['G5', -3, 1, 1.5],
    ['H2', -2, 3, 2], ['I1', -4, 1, 1.5], ['I2', -8, 1, 1.5], ['I3', -3, 1, 1.5]]) {
    const t = cp(k);
    if (t) w.push({ t0: t + a, t1: t + b, speed: sp });
  }
  return w;
}

/** the camera stays on one man (not the last one ordered): the Sapper at the fence — the cut, in through the hole, back out */
export function follows(cp) {
  const f = [];
  const g3 = cp('G3'), g4 = cp('G4'), g5 = cp('G5'), g6 = cp('G6');
  if (g3) f.push({ t0: g3 - 10, t1: g4 ? Math.min(g4, g3 + 40) : g3 + 15, role: 'sapper', zoom: 0.9 });
  if (g5 && g6) f.push({ t0: g6 - Math.min(40, g6 - g5), t1: g6 + 1, role: 'sapper', zoom: 0.85 });
  return f;
}
