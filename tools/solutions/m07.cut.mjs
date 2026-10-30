/**
 * The cut for the M07 solution film (tools/solutions/capture-video.mjs). The generic director does the film — the walkthrough's
 * chapters and step captions, real time round the 8 kills (the Spy's needle for gun 23's gunner and the dock yard's two walkers,
 * the Green Beret's knife on e4, e6 and patrol 10's rear man, the Marine's harpoon on patrol 10's sergeant and on e11), the two
 * U-boats' time bombs and blasts, the cards, the art opening from the game's briefing tour — and this file only switches on what a
 * stealth mission needs:
 *
 *  - FRAME_WAITS: M07 is 37 game minutes of waiting for a guard to turn his back, walk off or stare at a decoy (the Green Beret's
 *    decoy on the heights, the Marine under the village wall, the Spy in the dock yard's walled corner and at patrol 14's halt, the
 *    Sapper and the Driver lying at the quay's edge, the rowboat in open water for patrol 12's turn at the lighthouse). The speed
 *    director runs those at 8x to 16x and the camera, staying on the man who lies still, would show a bare patch of ground with the
 *    guards the wait is for pacing at its edge; with the wait framing the camera shows him together with the guards the walkthrough
 *    step names (docs/mission-videos.md).
 *
 * The run is never seen. Its one alarm is the blast of U-boat 1 (step C3: "the blast raises the alarm, the one this plan cannot
 * avoid", which the walkthrough's own step text says), so the film needs no note. In stage A the solution works two parties at once
 * (`D.parallel`, driver.mjs: the world steps once every flow waits on a tick, so the drawn pass ticks the flows in the logic-only
 * pass's order whatever its step awaits) and the camera follows the man last ordered, so the film cuts between the heights and the dock
 * yard as the parties take turns. The film of 2026-10-30 (6:06, 10,989 frames) has no still fast-forward stretch of 3 s or more, so
 * nothing was time-lapsed after the capture.
 */

export const FRAME_WAITS = true;
