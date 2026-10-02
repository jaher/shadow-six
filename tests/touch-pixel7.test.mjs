/**
 * Touch only: an emulated Pixel 7 (no keyboard events), portrait (landscape: touch-pixel7-land, split to stay inside
 * the 90 s test budget), goes title → new user → main menu (HELP and its EXIT) → new game → campaign → briefing →
 * mission start purely by taps, then opens the in-mission menu with the MENU button, resumes with BACK, and taps
 * through the win card, debrief and PLAY AGAIN, then reloads as a returning player and taps the title where OPTIONS
 * will appear (no ghost click) (tests/touch-flow.mjs).
 */
import { phoneFlow } from './touch-flow.mjs';

export default async function touchpixel7(page, t) {
  await phoneFlow(t, 'Pixel 7', { endScreens: true, ghost: true });
}
