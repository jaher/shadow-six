/**
 * The cut for the M15 solution film (tools/solutions/capture-video.mjs). The generic director does the film — the walkthrough's
 * chapters and step captions, real time round the nine kills (the Spy's injections, the Marine's spear and the Sniper's shot at the
 * general), the Sniper's scope before that shot, the tram's hit on the tanker and the HQ going up, the cards, the art opening from
 * the game's briefing tour — and this file only switches on what a stealth mission needs:
 *
 *  - FRAME_WAITS: M15 is 92 game minutes of waiting for a guard to turn his back — the Spy in the burned-out house, behind the
 *    sentry box and in the lawn's corner, the Driver and the Sniper lying still between two crawls, the Spy holding e19 in talk
 *    while the tram and the cemetery patrol keep time. The speed director runs those at 16× and more, and the camera, staying on
 *    the man who lies still, would show a bare patch of street with the guards the wait is for pacing at its edge; with the wait
 *    framing the camera shows him together with the guards the walkthrough step names (docs/mission-videos.md).
 *
 * What it does not mend: the Spy's talk with e19 at the cemetery gate (H3 to H4, 288 game seconds, 38 s of film at 4× to 13×, the
 * director slowing to 4× whenever the tram carrying the Driver moves) leaves two stretches of about 6 s in which nothing but two
 * small figures stands in the picture (film 6:58 and 7:11 of the 9:23 capture). The film of 2026-10-29 has them cut out after the
 * capture; a window at 16× over that step, and a wide shot with the tram's stop, the patrol's corner and the two men in it, is
 * the way to mend them in the cut (it needs a new capture to look at).
 */

export const FRAME_WAITS = true;
