/**
 * The cut for the M14 solution film (tools/solutions/capture-video.mjs). The generic director does the film — the walkthrough's
 * chapters and step captions, real time round the 22 kills, the Sniper's scope before each of his shots, the guns going up in real
 * time, the cards, the art opening from the game's briefing tour — and this file adds two things the generic film cannot know:
 *
 *  - FRAME_WAITS: M14 is a stealth mission and most of its 46 game minutes are waits (the Marine at the waterline for Patrol 12 to
 *    halt, the Green Beret and the Sniper behind the turret block while the decoy holds e38 and Patrol 43, the boat under the ridge
 *    until gun 4 can be shot at). The speed director runs them at 16× and more, and the camera would stay on the man who lies still;
 *    with the wait framing the camera shows him together with the guards the walkthrough step names, pacing (docs/mission-videos.md).
 *  - the one alarm of the run (F2, gun 4: the bodies of the posts by the fuel barrels are found by e41 and e45). The title card says
 *    "never spotted" — true, no commando is ever seen — but a siren, the guards' cries and a red lamp in the HUD need their reason on
 *    screen; the step caption of the moment is about the Sapper's ladder, and the film is at 3× to 15× here, so the note is held for
 *    45 game seconds (6 s of film);
 *  - the two waits the wait framing cannot fill. The Sapper lies on the turret block's roof from E6 to G2 and
 *    twice the film waits for the garrison there: F5 → F7 (the decoy holds e38 and Patrol 43, the Green Beret and the Sniper lie
 *    behind the block for the boat) and G1 → G2 (the blast and the decoy have drawn the garrison; they stand staring, out at the
 *    picture's edge). Everything that could move in the picture is already in it, standing, and the generic director's 16× (up to
 *    29×) was a still picture for 8 s and 11 s with a clock racing: here they are time-lapsed (48×, as in M12's wait) and captioned.
 * Times (game seconds) come from the logic-only pass of the same run: cp(k) = the time of checkpoint k.
 */

export const FRAME_WAITS = true;

const WAIT_SPEED = 48;

/** the two long waits, in game time: [from, to] inside F5 → F7 and G1 → G2 (null when pass 1 did not run as expected) */
function waits(cp) {
  const f5 = cp('F5'), f7 = cp('F7'), g1 = cp('G1'), g2 = cp('G2');
  return {
    decoy: f5 != null && f7 != null && f7 - f5 > 200 ? { t0: f5 + 100, t1: f7 - 30, f5, f7 } : null, // (after the barrel is stood at the pit; before the boat takes the two men)
    blast: g1 != null && g2 != null && g2 - g1 > 250 ? { t0: g1 + 62, t1: g2 - 60, g1, g2 } : null,    // (after the blast's own seconds, in real time; before the Sapper's climb down)
  };
}

/** timed captions: the alarm at gun 4 (checkpoint F2 is the moment the bodies are found), and the two time-lapsed waits */
export function notes(cp) {
  const out = [], f2 = cp('F2'), { decoy, blast } = waits(cp);
  if (f2 != null) out.push({
    t0: f2 - 1, t1: f2 + 45,
    text: 'The alarm, here at gun 4 and nowhere else: the guards find the bodies of the barrel posts, which had to die. Nobody sees a commando.',
  });
  if (decoy) out.push({
    t0: decoy.f5 + 60, t1: decoy.f7 - 15,
    text: 'Time-lapse: the decoy holds e38 and Patrol 43 on the beach while the Sapper lies on the turret roof, out of every eye, and the others wait for the boat.',
  });
  if (blast) out.push({
    t0: blast.g1 + 30, t1: blast.g2 - 20,
    text: 'Time-lapse: after the blast the guards gather at the decoy and stare at it; the Sapper lies on the roof until nobody can see the ladder.',
  });
  return out;
}

/** time-lapse while the garrison is held at the decoy */
export function windows(cp) {
  const { decoy, blast } = waits(cp);
  return [decoy, blast].filter(Boolean).map((w) => ({ t0: w.t0, t1: w.t1, speed: WAIT_SPEED }));
}
