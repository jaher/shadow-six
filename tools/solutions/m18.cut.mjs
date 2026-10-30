/**
 * The cut for the M18 solution film (tools/solutions/capture-video.mjs): stage titles, step captions, title / end
 * cards, fixed camera shots and real-time windows. Times come from a logic-only pass of the same run (cp(k) = time of
 * checkpoint k, objT(o) = time objective o was done).
 */
export const TITLES = {
  A: 'A · Off the start: down to the SE corner of the fields',
  B: 'B · Two by two along the last metre of the south edge',
  C: 'C · The Marine away up the river, the others into the lorry',
  D: 'D · The Marine fetches the boat from the north island',
  E: 'E · The charges from the bridge island, by boat',
  F: 'F · The lorry takes the Sapper up to the bridge: three charges on the deck',
  G: 'G · Back by the south road: the bridge comes down (objectives 1 and 2)',
};

export const CAPTIONS = {
  A1: 'The Marine and the Sapper crawl down to the S edge behind the field walls, out of every beat',
  B0: 'While they wait for their moment, the Green Beret follows them down; the first pair edges west',
  B0b: '… then the Driver, and the second pair edges west behind them',
  B1: 'Eighty metres of edge past a walker, two patrols and the armoured car’s turn: the first pair goes',
  B2: 'The Green Beret and the Driver follow at their own moment',
  B3: 'The first pair in the lorry’s lee, east of the railway',
  B4: 'The second pair by the lorry too',
  C0: 'The Marine crosses the railway to the beach corner and dives',
  C1: 'Meanwhile the Green Beret climbs into the lorry',
  C2: 'The Driver crawls round the tail to the cab door and climbs in',
  D2: 'Under the bridge to the north island: e20 harpooned in a quiet moment',
  D3: 'The boat packed; the island’s cries reach nobody on the banks',
  D4: 'Back down the river under water, the boat on his back',
  E0: 'The island’s MG gunner e54 harpooned from the shallows behind him',
  E0b: '… and its walker e57, from the water off the west shore',
  E1: 'Patrol 46 turns north: the Sapper to the corner, the boat inflated',
  E2: 'The Sapper gets in',
  E3: 'Out of every reach across the open water to the bridge island',
  E4: 'The Sapper takes the three German charges from the green case',
  E5: 'The boat comes back for him',
  E6: 'Back at the corner as the patrol turns north again; the boat packed',
  F1: 'The Sapper climbs into the lorry with the charges, by the cab’s right door',
  F2: 'The Marine climbs in too',
  F3: 'Up the road and round to the end of the deck, nose south: to the Germans a lorry of their own',
  F4: 'The Sapper slips out on the deck side, the hull between him and the road, and crawls onto the deck',
  F5: 'A charge on C',
  F6: 'A charge on B, above the main span',
  F7: 'A charge on A, over the water at the island’s north shore',
  F8: 'Back along the deck and into the lorry by the same door',
  G1: 'The lorry drives back down to the south road',
  G2: 'At the lorry\u2019s door: three presses of the detonator, C, B, A — the span falls',
  G3: 'Every head turns to the bridge, but everyone is aboard: mission complete',
};

export const TITLE_CARD = `
  <div style="font-size:22px;letter-spacing:6px;opacity:.85">SHADOW SIX</div>
  <div style="font-size:52px;margin:10px 0 6px">Mission 18 · The Force of Circumstance</div>
  <div style="font-size:22px;font-style:italic;opacity:.9">The Maas bridge near Liège, December 1944 — bring the bridge down, escape in the lorry</div>
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

/** fixed shots (game time): the bridge going down, and the lorry's drives to the bridgehead and back */
export function shots(cp, objT) {
  const s = [];
  // the span: the blasts on C, B, A and the truss falling, then the lorry by the S road
  const o1 = objT('o1') ?? cp('G2');
  if (o1) {
    s.push({ t0: o1 - 2, t1: o1 + 6, x: 66, y: 0, z: 90, zoom: 0.55, prio: 2 }); // the span: the blasts, the truss falling
    s.push({ t0: o1 + 6, t1: o1 + 40, x: 92, y: 0, z: 142, zoom: 0.9, prio: 2 }); // the lorry away by the S road
  }
  const f3 = cp('F3'); if (f3) s.push({ t0: f3 - 14, t1: f3 + 1, x: 95, y: 0, z: 124, zoom: 0.6, prio: 1 }); // up the road to the bridge
  const g1 = cp('G1'); if (g1) s.push({ t0: g1 - 20, t1: g1 + 1, x: 95, y: 0, z: 128, zoom: 0.6, prio: 1 }); // back down
  return s;
}

/** real-time windows around the moments that matter */
export function windows(cp, objT) {
  const w = [];
  const o1 = objT('o1') ?? cp('G2');
  if (o1) w.push({ t0: o1 - 3, t1: o1 + 8, speed: 1 });
  for (const [k, a, b, sp] of [['D2', -3, 2, 1], ['E0', -3, 2, 1], ['E0b', -3, 2, 1], ['F3', -14, 1, 1.5], ['F4', -8, 1, 1.5], ['G1', -20, 1, 2]]) {
    const t = cp(k);
    if (t) w.push({ t0: t + a, t1: t + b, speed: sp });
  }
  return w;
}
