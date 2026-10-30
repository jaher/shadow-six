/**
 * The cut for the M20 solution film (tools/solutions/capture-video.mjs). The generic director does the film — the walkthrough's
 * chapters and step captions, real time round the 21 kills (the Green Beret's knife along the terraces, the courts and the north
 * range roof, the Sniper's three shots, the tank's gun at the end), the Sniper's scope before each of his shots, the Sapper's remote
 * charge and the two V2 rockets going up, the cards, the art opening from the game's briefing tour — and this file only switches on
 * what a stealth mission needs:
 *
 *  - FRAME_WAITS: M20 is 97 game minutes of waiting for a sentry to turn his back (the Green Beret on the wall below the climb, on the
 *    terrace strip between two sweeps of the turret guard, in the south court behind the barracks' huts; the Sapper and the Driver
 *    crawling the long way round the castle; the team lying in the meadow while the gate's front pair look the other way). The speed
 *    director runs those at 16× and more (up to 32×) and the camera, staying on the man who lies still, would show a bare patch of
 *    terrace with the guards the wait is for pacing at its edge; with the wait framing the camera shows him together with the guards
 *    the walkthrough step names (docs/mission-videos.md).
 *
 * The run is never seen. Its one alarm is the charge itself (step M7, the remote charge fired from inside the Panzer III): the siren
 * sounds with the blast, and the walkthrough's own step text (the headquarters goes up and the whole castle wakes, the only alarm) goes up
 * with it, so the film needs no note of its own.
 *
 * What it does not mend: five waits in which the man lies in the lee of a hut or a wall and the guards he waits for are hidden under
 * roofs or tiny at the picture's edge, so the speed director's 16× to 32× leaves a still picture with the clock racing — the Green
 * Beret's wait at the hut for e24's beat (F2 to F3, 15.5 s of film), his wait for e22 (F3 to F5, 5 s), his wait in the pocket by the south
 * wall for the patrols to pass (J1, 10 s), the Sniper's on the west bastion terrace (J2, 7.5 s) and the Driver's in the same pocket (L2,
 * 12 s of tiny walkers). The film of 2026-10-30 has them time-lapsed after the capture (every 3rd to 6th frame of those stretches kept, 37.8 s of
 * film less: 11:38 instead of 12:16, and the speed badge there is the capture's, not the lapse's); windows at 64× or more over those steps and
 * a fixed wide shot in this cut are the way to mend them at the source (it needs a new capture, an hour). The step caption of E5 (the
 * Sniper's 40 s crawl round the south field) is the Green Beret's first sentence: the generic rule keeps the first sentences that fit
 * 160 characters, and a note with the Sniper's would mend it the same way.
 */

export const FRAME_WAITS = true;
