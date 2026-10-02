/**
 * Touch only, landscape: an emulated iPhone 14 goes title → new user → main menu (rows ≥ 44 px, HELP and its EXIT)
 * → new game → campaign → briefing → mission start purely by taps, opens and closes the in-mission menu, then reloads
 * as a returning player and taps the title where OPTIONS will appear (no ghost click) (tests/touch-flow.mjs).
 */
import { phoneFlow } from './touch-flow.mjs';

export default async function touchiphone14land(page, t) {
  await phoneFlow(t, 'iPhone 14', { landscape: true, ghost: true });
}
