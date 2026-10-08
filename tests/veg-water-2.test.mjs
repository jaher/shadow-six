/**
 * Nothing planted stands in the water (GPU), second half: M11–M20 and the BCD sandbox. See veg-water.test.mjs.
 */
import { checkMissions, assertClean } from './veg-water-lib.mjs';

export const timeout = 900_000;

export default async function vegWater2(page, t) {
  assertClean(t, await checkMissions(page, t, ['m11', 'm12', 'm13', 'm14', 'm15', 'm16', 'm17', 'm18', 'm19', 'm20', 'b00']));
}
