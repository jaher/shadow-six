/**
 * The cut for the M04 solution film (tools/solutions/capture-video.mjs). The generic director does the film — the walkthrough's
 * chapters and step captions, real time round the 16 kills (the Marine's harpoon and the Green Beret's knife in the yard south and at
 * the wire gap, the Sniper's shots and the Green Beret's knives at the bridge's foot, the Driver running the gunner down, the
 * Sniper's pier guard), the Sniper's scope before each of his shots, the charge on the villa's steps and the blast, the cards, the art
 * opening from the game's briefing tour — and this file only switches on what a stealth mission needs:
 *
 *  - FRAME_WAITS: M04 is 35 game minutes of waiting for a guard to turn his back, walk off or look at a decoy (the Green Beret behind
 *    e12 in the centre grove for the train, the file at the bridge's foot, the courier at its far end, e59 and e57 by the pier shed).
 *    The speed director runs those at 8x to 16x and the camera, staying on the man who lies still, would show a bare patch of ground
 *    with the guards the wait is for pacing at its edge; with the wait framing the camera shows him together with the guards the
 *    walkthrough step names (docs/mission-videos.md).
 *
 * The run is never seen. Its one alarm is the blast of the headquarters (step J3: the siren sounds with it, and the walkthrough's own
 * step text — the siren sends e53 off to the blast, the statue guard turns to the lorry driver's body — goes up with it), so the film
 * needs no note. The film of 2026-10-30 (6:25, 11,550 frames) has no still fast-forward stretch of 3 s or more, so nothing was
 * time-lapsed after the capture.
 *
 * One jump: the Sniper's third shot at the bridge's foot (e25) is the stretch in which two flows of the solution step the world at
 * once (`D.unpaced`, driver.mjs), which the drawn pass ticks at once and draws no frame inside (capture-video.mjs: it keeps the run
 * tick for tick the logic-only one's), so the film jumps over 1.2 s of game time at 916 s, inside the scope's slow motion.
 */

export const FRAME_WAITS = true;
