/**
 * The cut for the M10 solution film (tools/solutions/capture-video.mjs). The generic director does the film — the walkthrough's
 * chapters and step captions, real time round the 23 kills (the Green Beret's knife through the ruins and the compound, the Sniper's
 * two shots at the machine-gunners, the Sapper's time bomb at the store and his grenades at the ramp head), the blasts, the cards, the
 * art opening from the game's briefing tour — and this file only switches on what a stealth mission needs:
 *
 *  - FRAME_WAITS: M10 is 21 game minutes of waiting for a guard to turn his back or walk to a decoy (the Green Beret behind a ruined
 *    wall for e2's halt, the team lying short of e5's sight, the compound's four guards each watching another's ground, the wire
 *    field's machine-gun nests). The speed director runs those at 8× to 16× and the camera, staying on the man who lies still, would
 *    show a bare patch of sand with the guards the wait is for pacing at its edge; with the wait framing the camera shows him together
 *    with the guards the walkthrough step names (docs/mission-videos.md).
 *
 * The run is never seen and never raises the alarm (the spare tank, which would sound the siren, is left alone), so it needs no note.
 */

export const FRAME_WAITS = true;
