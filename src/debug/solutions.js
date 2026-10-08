/**
 * Saved mission solutions the debug SOLUTION replay can play (debug/solution-replay.js). A solution is a module in
 * tools/solutions/<id>.solution.mjs (the same file the regression test tests/<id>-solution.test.mjs plays) that
 * exports `solve(D, ctx)` and `STAGES` ([id, title, fn] in order) — see tools/solutions/driver.mjs for the driver D.
 *
 * To plug in a new solution add one line below: the literal import() path lets the web build (tools/build, esbuild
 * with code splitting) bundle the file as a lazy chunk, so it works on the live site and costs nothing until used.
 * tests/unit/solution-replay.test.mjs fails if a tools/solutions/*.solution.mjs file is missing here.
 * @module debug/solutions
 */

/** @type {Record<string, {load: () => Promise<{solve: Function, STAGES: Array}>}>} */
export const SOLUTIONS = Object.freeze({
  m03: { load: () => import('../../tools/solutions/m03.solution.mjs') },
});

/** Does mission `id` have a saved solution? */
export function hasSolution(id) {
  return !!id && Object.prototype.hasOwnProperty.call(SOLUTIONS, id);
}

/** Mission ids with a saved solution. */
export function solutionIds() {
  return Object.keys(SOLUTIONS);
}

/** Load the solution module of `id` plus the driver (both lazy). */
export async function loadSolution(id) {
  if (!hasSolution(id)) throw new Error(`no saved solution for ${id}`);
  const [mod, driver, drive] = await Promise.all([
    SOLUTIONS[id].load(), import('../../tools/solutions/driver.mjs'), import('../abilities/drive.js'),
  ]);
  if (typeof mod.solve !== 'function') throw new Error(`${id}.solution.mjs exports no solve()`);
  return { id, solve: mod.solve, stages: (mod.STAGES || []).map(([sid, title]) => ({ id: sid, title })), makeDriver: driver.makeDriver,
    SolutionAborted: driver.SolutionAborted, ctx: { boardPoint: drive.boardPoint } };
}
