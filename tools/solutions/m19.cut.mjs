/**
 * The cut for the M19 solution film (tools/solutions/capture-video.mjs). The generic director does the film — the walkthrough's
 * chapters and step captions, real time round the five kills, the Sniper's scope before each of his six rounds, the three rockets
 * going up in real time, the siren, the cards, the art opening from the game's briefing tour — and this file adds two things the
 * generic film cannot know:
 *
 *  - FRAME_WAITS: M19 is 34 game minutes of stealth and most of the film is waiting (the four lying at the bank's tip for a walker
 *    to turn his back, the Green Beret in the hollow below the conveyor switch and in the gap behind the drums). The speed
 *    director runs those at 16× and more, and the camera, staying on the man who lies still, would show a bare patch of ground;
 *    with the wait framing it shows him together with the guards the walkthrough step names, pacing (docs/mission-videos.md).
 *  - the two waits for the climb. The Green Beret goes over the palisade on his feet, in view of e27 and e28 across the base, and
 *    that is possible only while the base's lorry stands by e27, e28's head is between two swings and e20 and e25 are down their
 *    beats: a conjunction that comes round only every few minutes. He lies in the hollow below the switch from E4 for 326 game
 *    seconds until it does (F1), and again in the gap behind the drums from H1 for 146 (H2). With the wait framing the camera
 *    shows the yard — the lorry, e27, e28, e20, e25 and the mine cart on its rails — from one place, and at 16× to 30× the first
 *    capture (2026-10-30) was a picture in which nothing much moved for 10 s (film 2:33 to 2:43) and again for 5 s (3:51 to 3:55),
 *    with the clock racing: here both waits are time-lapsed (48×), the first one captioned (the second is the step caption's own:
 *    "back over the palisade on his feet, again while the lorry stands by e27"). Both stop well before the man moves: the director
 *    is back at 4× to 8× for the crawl to the foot of the wall and the climb.
 * Times (game seconds) come from the logic-only pass of the same run: cp(k) = the time of checkpoint k.
 */

export const FRAME_WAITS = true;

const WAIT_SPEED = 48;

/** the two long waits for the climb window, in game time (null when pass 1 did not run as expected) */
function waits(cp) {
  const e4 = cp('E4'), f1 = cp('F1'), h1 = cp('H1'), h2 = cp('H2');
  return {
    climbIn: e4 != null && f1 != null && f1 - e4 > 150 ? { t0: e4 + 30, t1: f1 - 35, e4, f1 } : null,  // (after the crawl into the hollow; before the crawl on to the climb)
    climbOut: h1 != null && h2 != null && h2 - h1 > 90 ? { t0: h1 + 25, t1: h2 - 35, h1, h2 } : null, // (after the crawl into the gap; before the crawl to the foot of the wall)
  };
}

/** a timed caption for the first time-lapse (the step caption only changes at checkpoints, and says what he will do, not that he waits) */
export function notes(cp) {
  const { climbIn } = waits(cp);
  return climbIn ? [{
    t0: climbIn.t0 - 8, t1: climbIn.t1 + 8,
    text: 'Time-lapse: the Green Beret lies in the hollow until the lorry stands by e27, e28\'s head swings away and e20 and e25 are down their beats.',
  }] : [];
}

/** time-lapse while the Green Beret waits for the lorry */
export function windows(cp) {
  const { climbIn, climbOut } = waits(cp);
  return [climbIn, climbOut].filter(Boolean).map((w) => ({ t0: w.t0, t1: w.t1, speed: WAIT_SPEED }));
}
