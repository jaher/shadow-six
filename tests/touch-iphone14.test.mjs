/**
 * Touch only: an emulated iPhone 14 (no keyboard events), portrait then landscape, goes title → new user → main menu →
 * new game → campaign → briefing → mission start purely by taps, then opens the in-mission menu with the MENU
 * button, resumes with BACK, and (portrait) taps through the win card, debrief and PLAY AGAIN (tests/touch-flow.mjs).
 */
import { phoneFlow } from './touch-flow.mjs';

export default async function touchiphone14(page, t) {
  await phoneFlow(t, 'iPhone 14', { endScreens: true });
  await phoneFlow(t, 'iPhone 14', { landscape: true });
}
