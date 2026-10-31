/**
 * The cut for the M17 solution film (tools/solutions/capture-video.mjs). The generic director does the film — the walkthrough's
 * chapters and step captions, real time round the 27 kills (the Spy's needle from behind in the west strip, at Patrol 17 and on the
 * north bank, the Green Beret's knife, the Marine's harpoon from the river), the cards, the art opening from the game's briefing
 * tour — and this file only switches on what a stealth mission needs:
 *
 *  - FRAME_WAITS: M17 is 54 game minutes of waiting for a guard to turn his back, walk off or stare at a decoy (the Spy holding a
 *    patrol in talk, the Green Beret's decoys for e5 and the bunker gunner, the five guards round the cage that watch each other,
 *    the eleven men of the north bank). The speed director runs those at 8x to 16x and the camera, staying on the man who lies still,
 *    would show a bare patch of ground with the guards the wait is for pacing at its edge; with the wait framing the camera shows
 *    him together with the guards the walkthrough step names (docs/mission-videos.md).
 *
 * The run is never seen and raises no alarm (the walkthrough's outro: "never seen, no alarm"), so it needs no note. The film of
 * 2026-10-30 (9:27, 17,002 frames) has no still fast-forward stretch of 3 s or more, so nothing was time-lapsed after the capture.
 */

export const FRAME_WAITS = true;
