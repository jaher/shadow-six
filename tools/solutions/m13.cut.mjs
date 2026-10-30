/**
 * The cut for the M13 solution film (tools/solutions/capture-video.mjs). The generic director does nearly all of it — the
 * walkthrough's chapters and step captions, real time round the 22 kills, the torpedo's hit, the patrol boat's end, the scope
 * show before the Sniper's four shots, the cards — and this file mends what it passes over or shows badly:
 *
 *  - FRAME_WAITS. M13 is nearly all waiting: the Marine, the Green Beret, the Sapper and the Sniper each lie still — under
 *    water, behind a crate, inside the garage — for the moment a guard walks away, turns his back or looks the other way (A6,
 *    C3, C5, E2, G1…G6, I2, J2, J6, K2…). The director runs those at 16x and more, and the camera, staying on the man who lies
 *    still, showed a garage roof for 8 s at a time with the guards the wait is for pacing at the edge of the picture.
 *    With the wait framing the camera shows the waiting man and the guards the walkthrough step names (e6 and e7 at C3, e7 and
 *    e8 at C5, the patrol at G6…), each by his whole beat, so every wait reads as what it is: a man hiding while those guards
 *    walk (film-camera.mjs waitFrame; the game's own always-action rule for its walkthrough).
 *  - The Sapper's remote charge (J3), set while the film runs at 8x with the man crawling (a dot, flat on the quay): filmed in
 *    real time, from before his hand goes down until he crawls on, with a caption that says what is being done.
 *  - The finale. The torpedo's hit on the bow and the Sapper's charge under the fuel tanks go off 0.2 s apart, 52 m from one
 *    another: the director's one blast shot stays at the bow (it skips a blast within 4 s of the one before), so the film never
 *    showed the second of the two objectives, the fuel tanks, go up. After the director's shot of the ship the camera visits the
 *    tanks, in real time with a caption.
 * Times (game seconds) come from the logic-only pass of the same run: cp(k) = the time of checkpoint k, objT(id) = the time an
 * objective was done, ev = that pass's events (`plant` = a charge set, with where).
 */

export const FRAME_WAITS = true;

const PLANT_LEAD = 3;   // the Sapper's hand goes down for 1 s before the charge is there: the shot starts as he comes to a stop
const PLANT_TAIL = 2.5; // and stays while he turns to crawl back
const PLANT_TEXT = 'Under the fuel tanks\' cradle, flat on the quay, the Sapper sets the remote charge.';

/** the two fuel tanks (76, 33.5) and (77.5, 38.2) and the quay round them, as the opening's second stop shows them */
const FUEL = { x: 76.8, y: 2, z: 37, zoom: 0.62 };
const FUEL_AFTER = 5; // the director's shot of the torpedo's blast runs to 5 s after it
const FUEL_LEN = 5;
const FUEL_TEXT = 'At the same moment the Sapper fires the charge by radio: both fuel tanks beside her berth go up.';

const plantsOf = (ev) => (ev || []).filter((e) => e.kind === 'plant').sort((a, b) => a.t - b.t);
/** the visit to the fuel tanks, in game time: after the shot of the ship, once both objectives are done */
function visitOf(objT) {
  const ship = objT('o_ship'), fuel = objT('o_fuel');
  if (ship == null || fuel == null) return null;
  const t0 = Math.max(ship, fuel) + FUEL_AFTER;
  return { t0, t1: t0 + FUEL_LEN };
}

/** timed captions: what the camera is looking at (the step captions only change at checkpoints) */
export function notes(cp, objT, ev) {
  const out = plantsOf(ev).map((e) => ({ t0: e.t - PLANT_LEAD, t1: e.t + PLANT_TAIL, text: PLANT_TEXT }));
  const v = visitOf(objT);
  if (v) out.push({ ...v, text: FUEL_TEXT });
  return out;
}

/** fixed shots (game time): each charge from a little above, then the fuel tanks burning */
export function shots(cp, objT, ev) {
  const out = plantsOf(ev).map((e) => ({ t0: e.t - PLANT_LEAD - 0.5, t1: e.t + PLANT_TAIL, x: e.x, y: e.y, z: e.z, zoom: 0.8 }));
  const v = visitOf(objT);
  if (v) out.push({ ...v, ...FUEL, prio: 1 });
  return out;
}

/** real time (the generic 1x windows round the kills and the blasts stay): the charge, then the visit */
export function windows(cp, objT, ev) {
  const out = plantsOf(ev).map((e) => ({ t0: e.t - PLANT_LEAD, t1: e.t + PLANT_TAIL, speed: 1 }));
  const v = visitOf(objT);
  if (v) out.push({ ...v, speed: 1 });
  return out;
}
