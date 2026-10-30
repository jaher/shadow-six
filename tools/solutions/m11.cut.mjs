/**
 * The cut for the M11 solution film (tools/solutions/capture-video.mjs). The generic director does nearly all of it — the
 * walkthrough's chapters and step captions, real time round the five kills and the first blast, the cards — and this file
 * mends the two things it passes over:
 *  - the Sapper's three charges are set while the film runs at 4–8× (a dot, flat on the ground): each is filmed in real time,
 *    from before his hand goes down until he crawls on, with a caption that says what is being done (the step caption of the
 *    moment is about the Spy or the half-track);
 *  - the finale: the director's one blast shot stays in the quarry, where the half-track's burst takes the fuel truck and both
 *    quarry rigs. The Sapper's three charges go off in the same second, out of the picture, so the film never showed the yard
 *    rig, the tunnel or the valley rig burn. After the quarry the camera visits them, each in real time with its own caption.
 * Times (game seconds) come from the logic-only pass of the same run: cp(k) = the time of checkpoint k, ev = that pass's events
 * (`plant` = a charge set, with where).
 */

export const TITLES = {
  // (H starts the moment the fuel truck and the charges are gone: the title covers the visit to the three other rigs as well)
  H: 'H · Four rigs burning: out by the west road',
};

const PLANT_LEAD = 3;   // the Sapper's hand goes down for 1 s before the charge is there: the shot starts as he comes to a stop
const PLANT_TAIL = 2.5; // and stays while he turns to crawl back

/** the charges in the order the Sapper sets them (the yard rig, the tunnel mouth, the valley rig) and what is on the screen while he does */
const PLANT_TEXT = [
  'The Sapper, flat in the yard behind the patrol’s back, sets a remote bomb under the yard rig.',
  'At the tunnel mouth, out of the HQ guard’s sight, he sets the second remote bomb.',
  'Out of the half-track’s rear doors, flat, he sets the third bomb under the east rig.',
];

/** the visit after the quarry blast: where the camera goes (the three charges fired within a second of the burst), how long, what it says */
const TOUR_AFTER = 5; // the quarry shot (the director's) runs to 5 s after the burst
const TOUR = [
  { x: 30.5, z: 89, zoom: 0.65, len: 3.5, text: 'The Sapper presses the detonator three times. The yard rig burns.' },
  { x: 52.5, z: 31.5, zoom: 0.7, len: 3, text: 'The tunnel mouth is down: nothing from the north can follow.' },
  { x: 95, z: 81.5, zoom: 0.65, len: 3.5, text: 'The valley rig burns: all four rigs are down.' },
];

const plantsOf = (ev) => (ev || []).filter((e) => e.kind === 'plant').sort((a, b) => a.t - b.t);
/** the tour's stretches in game time: [{ t0, t1, ...stop }] */
function tourOf(cp) {
  const b = cp('G2');
  if (b == null) return [];
  let t = b + TOUR_AFTER;
  return TOUR.map((s) => { const o = { ...s, t0: t, t1: t + s.len }; t += s.len; return o; });
}

/** timed captions: what the camera is looking at */
export function notes(cp, objT, ev) {
  const plants = plantsOf(ev);
  const out = plants.length === PLANT_TEXT.length
    ? plants.map((e, i) => ({ t0: e.t - PLANT_LEAD, t1: e.t + PLANT_TAIL, text: PLANT_TEXT[i] }))
    : [];
  for (const s of tourOf(cp)) out.push({ t0: s.t0, t1: s.t1, text: s.text });
  return out;
}

/** fixed shots (game time): each charge from a little above, then the three rigs the quarry burst left out of the picture */
export function shots(cp, objT, ev) {
  const out = plantsOf(ev).map((e) => ({ t0: e.t - PLANT_LEAD - 0.5, t1: e.t + PLANT_TAIL, x: e.x, y: e.y, z: e.z, zoom: 0.8 }));
  for (const s of tourOf(cp)) out.push({ t0: s.t0, t1: s.t1, x: s.x, z: s.z, zoom: s.zoom, prio: 1 }); // (no y: the ground there)
  return out;
}

/** real time (the generic 1× windows round the kills and the first blast stay): the charges, then the visit */
export function windows(cp, objT, ev) {
  const out = plantsOf(ev).map((e) => ({ t0: e.t - PLANT_LEAD, t1: e.t + PLANT_TAIL, speed: 1 }));
  const tour = tourOf(cp);
  if (tour.length) out.push({ t0: tour[0].t0, t1: tour[tour.length - 1].t1, speed: 1 });
  return out;
}
