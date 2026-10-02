/**
 * Touch only, landscape (the orientation the game recommends): an emulated Pixel 7 goes title → new user → main menu
 * (rows ≥ 44 px, HELP and its EXIT) → new game → campaign → briefing → mission start purely by taps, opens and closes
 * the in-mission menu, then reloads as a returning player and taps the title where OPTIONS will appear (no ghost
 * click) (tests/touch-flow.mjs; portrait: touch-pixel7).
 */
import { phoneFlow } from './touch-flow.mjs';

export default async function touchpixel7land(page, t) {
  await phoneFlow(t, 'Pixel 7', { landscape: true, ghost: true });
}
