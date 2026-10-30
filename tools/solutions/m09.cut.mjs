/**
 * The cut for the M09 solution film (tools/solutions/capture-video.mjs). The generic director does the film — the walkthrough's
 * chapters and step captions, real time round the 18 kills (the Green Beret's knife through the two patrols and the forecourt's
 * west opening, the Sniper's five shots, the Spy's needle in the north yard and at the east gate), the Sniper's scope before each of
 * his shots, the two remote bombs and the Panzers' bay going up, the cards, the art opening from the game's briefing tour — and this
 * file only switches on what a stealth mission needs:
 *
 *  - FRAME_WAITS: M09 is 13 game minutes of waiting for a guard to turn his back or walk off (the Green Beret behind the wall for
 *    the south-east patrol's file, the Sniper along the forecourt's south fence for e2's halt, the Spy in the north yard for
 *    e9, e4, e8 and e5 in turn, the courtyard patrol's three men for the Spy's talk). The speed director runs those at 8x to 16x and
 *    the camera, staying on the man who lies still, would show a bare patch of sand with the guards the wait is for pacing at its
 *    edge; with the wait framing the camera shows him together with the guards the walkthrough step names (docs/mission-videos.md).
 *
 * The run is never seen. Its one alarm is the first blast (step H1: the barracks bomb, then the radio hut's): the siren sounds with it,
 * and the walkthrough's own step text (the alarm sounds, but nobody is left to answer it) goes up with it, so the film needs no note.
 * The film of 2026-10-30 (4:21, 7827 frames) has no still fast-forward stretch of 3 s or more, so nothing was time-lapsed after the capture.
 */

export const FRAME_WAITS = true;
