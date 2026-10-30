/**
 * The cut for the M12 solution film (tools/solutions/capture-video.mjs). The generic director does the film — the walkthrough's
 * chapters and step captions, real time round the 24 kills, the Sniper's scope before each of his five shots, the cards — and
 * this file mends the two things the generic film cannot know about this mission:
 *
 *  - the art opening. The game's briefing tour of M12 has only two stops (the guards' densest cluster, on the jail ledge, and the
 *    team's start), because the mission's objectives name no building (the cell is a script objective, the car an escape vehicle)
 *    and its extraction is a vehicle, not a zone: the generic opening was a 6 s hop between two corners of the courtyard. M12 is a
 *    town of levels — the courtyard, the roofs over it, the mosque platform below them, the quay — and the solution crosses all of
 *    it in that order, so the opening names those places the way the Colonel would and flies the same way, ending at the car
 *    (the film then cuts to the courtyard, where the Spy begins);
 *  - the Spy's wait on the palace's raised roof (D1 → D2, 183 s of game time): he lies a few metres behind e6 until e6 halts at
 *    the west end of his beat, looking west, with the souk's posts looking elsewhere. Nobody on the roofs moves, so the generic
 *    director's 16× showed ten seconds of a still picture; here the stretch is time-lapsed (48×) and its caption says what the
 *    Spy is waiting for (the step caption of the moment only names e6's beat).
 * Times (game seconds) come from the logic-only pass of the same run: cp(k) = the time of checkpoint k, ev = that pass's events.
 */

/** where the opening goes, in order (world metres; src/missions/m12_up_on_the_roof.js: the jail door, the souk and palace, the mosque platform's east walk, the car `kubel`) */
export function openingStops() {
  return [
    { kind: 'objective', x: 27.5, z: 37.5, label: 'Objective 1: free the Informer from this cell', dwell: 3.6 }, // (the title card sits over this close-up)
    { kind: 'danger', x: 52, z: 28, label: 'Eleven guards hold the roofs: the only way out is over them', dwell: 1.4 },
    { kind: 'danger', x: 51, z: 87, label: 'The mosque platform: one alarm here and the HQ ends the mission', dwell: 1.4 },
    { kind: 'extraction', x: 62, z: 108, label: 'Objective 2: all four men into the car on the quay', dwell: 2 },
  ];
}

const WAIT_LEAD = 22; // s after D1 that the Spy has climbed the ladder and walked to his place behind e6 (his own walk is filmed at 4×)
const WAIT_TAIL = 9;  // s before the kill that the wait ends: the director's own ramp down to the injection's real time takes the last six
const WAIT_SPEED = 48;
const killT = (ev, tag) => (ev || []).find((e) => e.kind === 'kill' && e.tag === tag)?.t;
/** the Spy's wait for e6: [t0, t1] in game time, or null when pass 1 did not run as expected */
function waitD2(cp, ev) {
  const a = cp('D1'), b = killT(ev, 'e6');
  return a != null && b != null && b - WAIT_TAIL > a + WAIT_LEAD + 10 ? { t0: a + WAIT_LEAD, t1: b - WAIT_TAIL, kill: b } : null;
}

/** timed captions: from the Spy's climb to e6's fall (the step caption names only e6's beat) */
export function notes(cp, objT, ev) {
  const w = waitD2(cp, ev);
  return w ? [{ t0: cp('D1') + 8, t1: w.kill + 2, text: 'The Spy lies in wait behind e6: he strikes when e6 halts at the west end of his beat, looking west, with the souk’s posts looking away.' }] : [];
}

/** time-lapse while he waits */
export function windows(cp, objT, ev) {
  const w = waitD2(cp, ev);
  return w ? [{ t0: w.t0, t1: w.t1, speed: WAIT_SPEED }] : [];
}
