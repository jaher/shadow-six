/**
 * The cut for the M3 solution film (tools/solutions/capture-video.mjs): stage titles, step captions, title / end
 * cards, fixed camera shots and real-time windows. Times come from a logic-only pass of the same run (cp(k) = time of
 * checkpoint k, objT(o) = time objective o was done).
 */
export const TITLES = {
  A: 'A · The plateau: trap the sergeant, harpoon the troopers',
  B: 'B · The gully: knife the two sentries, hide the bodies',
  C: 'C · The raft: the Spy fetches a uniform',
  D: 'D · Over the dam crest: fence power off, chat up the guard',
  E: 'E · The Sapper cuts in and takes the charges',
  F: 'F · A decoy by the north gate',
  G: 'G · The bunker (objective 1)',
  H: 'H · Move the decoy, cross back over the crest',
  I: 'I · The dam (objective 2)',
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
  C1: 'The Marine and the Spy crawl down the gully to the raft',
  C2: 'Both aboard in a gap in e17’s sweep',
  C3: 'The Spy takes a uniform from the clothesline',
  D1: 'Disguised, he walks over the crest: nobody below can see up there',
  D2: 'Fence power off at the admin-block switch',
  D3: 'He chats up e17 from his west side: his back is to the river and the shed',
  E1: 'Decoy at the gully mouth: e6 turns away from the river',
  E2: 'The Sapper cuts the dead fence',
  E3: 'Both time bombs taken from the shed',
  E4: 'Back the same way and aboard, unseen',
  E5: 'The Green Beret fetches his decoy',
  F1: 'The Spy now holds e18 at the north gate',
  F2: 'Ashore unseen; decoy 13 m from the bunker; the Green Beret digs into the snow',
  G1: 'Decoy on, by radio: the gunner and the five-man patrol turn to it',
  G2: 'Charge one on the bunker’s blind side',
  G3: 'Bunker destroyed (objective 1); the alarm from the blast is expected',
  G4: 'The alarm dies down',
  H1: 'Decoy moved 9 m west of e18; the Green Beret digs in beside it',
  H2: 'From the west stair he switches the decoy on for good',
  H3: 'Green Beret over the crest to the truck road',
  H4: 'The Spy crawls to the stair (no footprints to follow) and crosses too',
  I1: 'Marine and Sapper land by the east stair in a clear moment',
  I2: 'Charge two at the spillway gates in the middle of the crest; then off the crest before it blows',
  I3: 'The dam is down (objective 2)',
  J1: 'The truck arrives north of the dam',
  J2: 'All four aboard: mission complete',
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
  if (o1) s.push({ t0: o1 - 6, t1: o1 + 7, x: 22, y: 0, z: 46, zoom: 0.6, prio: 2 });
  if (o2) { // the blast and the burst, then the escape: the truck at the pickup north of the dam, the men climbing in
    s.push({ t0: o2 - 4, t1: o2 + 2, x: 47, y: 0, z: 25, zoom: 0.55, prio: 2 });
    s.push({ t0: o2 + 2, t1: o2 + 60, x: 59.5, z: 10.5, zoom: 0.85, prio: 2 }); // the truck stops at (60, 9.2)
  }
  const f1 = cp('F1'); if (f1) s.push({ t0: f1 - 2, t1: f1 + 3, x: 24.6, y: 0, z: 62, zoom: 0.8, prio: 1 }); // the Spy and e18
  const a3 = cp('A3'); if (a3) s.push({ t0: a3 - 4, t1: a3 + 4, x: 101, y: 0, z: 11, zoom: 0.7, prio: 1 }); // p1 stare at the decoy
  const g1 = cp('G1'); if (g1) s.push({ t0: g1 - 3.5, t1: g1 + 0.5, x: 25, y: 0, z: 52, zoom: 0.6, prio: 1 });
  const h2 = cp('H2'); if (h2) s.push({ t0: h2, t1: h2 + 6, x: 19, y: 0, z: 52, zoom: 0.6, prio: 1 });
  return s;
}

/** real-time (or slow fast-forward) windows around the moments that matter */
export function windows(cp, objT) {
  const w = [];
  const o1 = objT('o1'), o2 = objT('o2');
  if (o1) w.push({ t0: o1 - 3, t1: o1 + 5, speed: 1 });
  if (o2) w.push({ t0: o2 - 3, t1: o2, speed: 1 }, { t0: o2, t1: o2 + 60, speed: 0.5 }); // the blast and the escape at half speed
  for (const [k, a, b, sp] of [['A3', -4, 1, 2], ['C3', -5, 1, 1.5], ['D2', -3, 1, 1.5], ['D3', -2, 2, 2], ['E2', -4, 1, 1.5],
    ['E3', -3, 1, 1.5], ['F1', -2, 3, 2], ['F2', -4, 1, 2], ['G1', -4, 1, 1.5], ['G2', -3, 1, 1.5], ['H2', -1, 6, 2], ['I2', -3, 1, 1.5]]) {
    const t = cp(k);
    if (t) w.push({ t0: t + a, t1: t + b, speed: sp });
  }
  return w;
}
