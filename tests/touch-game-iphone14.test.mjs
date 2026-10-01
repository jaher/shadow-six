/** In-mission touch controls on an emulated iPhone 14 in landscape (tests/touch-game-flow.mjs, src/input/touch-game.js). */
import { playFlow } from './touch-game-flow.mjs';

export const timeout = 150_000;
export default async function touchGameIphone14(page, t) {
  await playFlow(t, 'iPhone 14');
}
