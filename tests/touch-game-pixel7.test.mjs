/** In-mission touch controls on an emulated Pixel 7 in landscape (tests/touch-game-flow.mjs, src/input/touch-game.js). */
import { playFlow } from './touch-game-flow.mjs';

export const timeout = 150_000;
export default async function touchGamePixel7(page, t) {
  await playFlow(t, 'Pixel 7');
}
