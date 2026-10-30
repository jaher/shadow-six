/**
 * The cut for the M16 solution film (tools/solutions/capture-video.mjs). The generic director does the film — the walkthrough's
 * chapters and step captions, the Sniper's scope before each of his five shots (real time round the kills), the train's three
 * kills, the cards, the art opening from the game's briefing tour — and this file adds what the generic film cannot know:
 *
 *  - FRAME_WAITS: M16 is 20 game minutes of stealth and most of them are waits (the team in the wood for the train to go by, the
 *    Spy lying in the field for a patrol to turn, the lorry held back for e15's beat, the Sniper and the Spy waiting for the
 *    moment of the strike). The speed director runs those at 16× and more, and the camera, staying on the man who lies still,
 *    would show a bare patch of field; with the wait framing the camera shows him together with the guards the walkthrough step
 *    names, pacing (docs/mission-videos.md).
 *  - the Spy's wait at the east edge of the map (A3 to A4, 276 game seconds): he lies in the field's corner until Patrol 11 (the
 *    loop round the village green and the clothesline) and the walker e10 are both away from the clothesline. The walkthrough step
 *    names neither guard, so the wait framing finds nobody near him and the film shows 8 s of a wide, almost still picture with the
 *    walkers at its edges (film 0:56 to 1:04 of the first capture). Here the camera takes one fixed shot (the green, the patrol's
 *    loop, e10's beat, the clothesline, the Spy in the corner of the picture), at 32×, with a note that says what he waits for.
 *  - captions the generic rule leaves out: a step's text goes up in its first sentences while they fit 160 characters, and A3's
 *    second sentence (the Spy crawls on alone) is the one the picture is about; the note puts both in the box.
 *  - the one siren of the run, by design: the fifth round (E5, objective 1) kills e15, whose whole beat is in plain view of five
 *    more guards, so the last sapper's fall is seen and the siren sounds as the objective is done, with the Sniper not yet back in the
 *    lorry. The title card says "never spotted" — true, no commando is ever seen — but a siren needs its reason on screen, and the
 *    step captions of the moment are about the Sniper's crawl to the lorry. The note is the walkthrough's own wording of that beat
 *    (`m16.walkthrough.mjs`, the `alarm` beat of E5); it is held for 10 game seconds (the film is at 1× to 4× here).
 * Times (game seconds) come from the logic-only pass of the same run: cp(k) = the time of checkpoint k.
 */

export const FRAME_WAITS = true;

const EDGE = 38;  // the Spy is in the field's corner (199, 123.5) 34 s after A3 and the wait goes on from there
const DASH = 30;  // the dash up to the line (a 16 m crawl, standing up, taking the uniform) is the last ~28 s before A4: the director's own camera takes over
const SPEED = 32; // the long-wait cruise of the generic director (it reaches 24× here)

/** timed captions: A3's two sentences, what the Spy waits for at the clothesline, the siren after the last sapper (E5 is the moment of his fall, the objective and the alarm) */
export function notes(cp) {
  const a2 = cp('A2'), a3 = cp('A3'), a4 = cp('A4'), e5 = cp('E5');
  const n = [];
  if (a2 != null && a3 != null) n.push({ t0: a2, t1: a3 - 0.01, text: 'The Sniper and the Marine wait on the bank. The Spy crawls on alone, through a gap in the belt, over the railway and into the empty field.' });
  if (a3 != null && a4 != null && a4 - DASH > a3 + EDGE) n.push({ t0: a3 + EDGE, t1: a4 - DASH, text: 'He lies at the edge of the field until the patrol and the walker by the houses are both away from the clothesline.' });
  if (e5 != null) n.push({ t0: e5, t1: e5 + 10, text: 'The last sapper\'s fall is seen and the siren sounds, but all four are dead and the bridge is safe. Nobody has seen any of the team.' });
  return n;
}

/** the wait at the clothesline: one fixed shot, zoom 0.6 (53 m across) over the village green's patrol loop (173-199, 92-104), e10's beat (182-186, 97-111) and the clothesline, the Spy at the bottom right */
export function shots(cp) {
  const a3 = cp('A3'), a4 = cp('A4');
  if (a3 == null || a4 == null || a4 - DASH <= a3 + EDGE - 2) return [];
  return [{ t0: a3 + EDGE - 2, t1: a4 - DASH, x: 188, y: 0, z: 108, zoom: 0.6, prio: 1 }];
}

/** the same wait at 32× (the director's 16× to 24× left it 11 s of film) */
export function windows(cp) {
  const a3 = cp('A3'), a4 = cp('A4');
  if (a3 == null || a4 == null || a4 - DASH <= a3 + EDGE) return [];
  return [{ t0: a3 + EDGE, t1: a4 - DASH, speed: SPEED }];
}
