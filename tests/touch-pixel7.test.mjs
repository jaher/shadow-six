/**
 * Touch only: an emulated Pixel 7 (no keyboard events), portrait then landscape, goes title → new user → main menu →
 * new game → campaign → briefing → mission start purely by taps, then opens the in-mission menu with the MENU
 * button, resumes with BACK, and (portrait) taps through the win card, debrief and PLAY AGAIN (tests/touch-flow.mjs).
 */
import { phoneFlow } from './touch-flow.mjs';

export default async function touchpixel7(page, t) {
  await phoneFlow(t, 'Pixel 7', { endScreens: true });
  await phoneFlow(t, 'Pixel 7', { landscape: true });
}
