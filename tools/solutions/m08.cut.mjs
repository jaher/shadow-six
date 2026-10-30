/**
 * The cut for the M8 solution film (tools/solutions/capture-video.mjs). The generic director does the rest — the
 * walkthrough's chapter titles and step captions, the scope show before every rifle shot, real time round the kills and
 * the blast, the cards — and this file mends the two stretches it leaves quiet (a run of 5 s or more in which nothing on
 * the screen moves):
 *
 *  - Stage Q's wait, 16 minutes of game time (Q2 → Q3, 975 s). The Sniper lies on the road above the store and waits for
 *    the one moment when each of the roof guard e19 and the tank guards e26 / e27 can be shot with the kneel, the fall and
 *    the body unseen, while the Green Beret's decoy draws the store's walkers e24 and e25 out again and again. Filmed on the
 *    Sniper that is 30 s of a man lying still (the director's 32x does not help: nothing moves). Here the camera pulls out
 *    to the whole north side of the store (the road and the Sniper at the top, the decoy, e24 and e25 going out to it and
 *    back, the barracks roof, the tank decks) at 36x, so the wait reads as what it is: guards pacing, walkers drawn out.
 *    It ends 20 s before the first shot, where the generic director takes over (the camera glides to the Sniper, the scope
 *    show, the three kills in real time).
 *  - The start yard (A0 → A1): the Sniper has crawled into place at the west gap and waits ~100 s of game time for e1 to turn
 *    away (the director's 16x leaves 5 s of a still picture right after the opening): the same stretch at 36x.
 * Times (game seconds) come from the logic-only pass of the same run: cp(k) = the time of checkpoint k.
 */

const LEAD = 24;  // the wait's windows end this long before Q3: the first kill is ~7 s before Q3, its scope show a few seconds before that
const SPEED = 36; // the waits' fast-forward (the director's own idle cruise is 16x, 32x after a long wait)

/** timed captions: what the wide shot shows, whose step captions (Q2's) run out */
export function notes(cp) {
  const q2 = cp('Q2'), q3 = cp('Q3');
  if (!q2 || !q3) return [];
  return [
    { t0: q2 + 2, t1: q2 + 218, text: 'e24 and e25 are out at the decoy: they stare at it, their backs to the road where the Sniper lies.' },
    { t0: q2 + 218, t1: q2 + 542, text: 'The Sniper waits, 40 m from the roof guard e19 and the tank guards e26 and e27: he fires only when his kneel, the fall and the body will all go unseen.' },
    { t0: q2 + 542, t1: q3 - LEAD + 4, text: 'Time-lapse: the decoy draws the two walkers out again and again while the Sniper waits for that moment.' },
  ];
}

/** fixed shots (game time): the store's north side, the whole of the wait's action in one picture */
export function shots(cp) {
  const q2 = cp('Q2'), q3 = cp('Q3');
  if (!q2 || !q3) return [];
  // (zoom 0.5: 64 m across. From the road at the top — the Sniper's hide — past the decoy and the walkers' beats to the
  // roof of the barracks on the left and the two tank decks at the bottom right)
  return [{ t0: q2 + 2, t1: q3 - LEAD + 4, x: 46, z: 50, zoom: 0.5, prio: 1 }];
}

/** fast-forward windows: the two waits at 36x */
export function windows(cp) {
  const q2 = cp('Q2'), q3 = cp('Q3'), a1 = cp('A1');
  const w = [];
  if (a1 > 60) w.push({ t0: 30, t1: a1 - 12, speed: SPEED }); // the Sniper in place at the west gap, waiting for e1 (the scope show starts ~5 s before the shot)
  if (q2 && q3) w.push({ t0: q2 + 2, t1: q3 - LEAD, speed: SPEED });
  return w;
}
