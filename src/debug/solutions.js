/**
 * Saved mission solutions the debug SOLUTION replay (debug/solution-replay.js) and VIDEO MODE (debug/walkthrough.js)
 * can play. A solution is a module tools/solutions/<id>.solution.mjs (the same file the regression test
 * tests/<id>-solution.test.mjs plays) that exports `solve(D, ctx)` and `STAGES` ([id, title, fn] in order) — see
 * tools/solutions/driver.mjs for the driver D. Its walkthrough (captions, chapters, camera cues) is the optional
 * tools/solutions/<id>.walkthrough.mjs next to it (docs/walkthrough-format.md).
 *
 * Nothing to register: the catalog is the folder itself. The web build (tools/build/build.mjs) lists the folder into
 * `globalThis.__SS_SOLUTIONS__` and bundles every file the template-literal import()s below can reach as a lazy chunk
 * (esbuild glob imports); the dev server lists it on request (tools/serve.mjs `?ls`). Nothing loads until debug mode
 * asks for it.
 * @module debug/solutions
 */

/** Catalog entries from the folder's file names: [{id, walkthrough}] for every <id>.solution.mjs, sorted by id. */
export function catalogFromFiles(names) {
  const files = new Set((names || []).map(String));
  const out = [];
  for (const f of files) {
    const m = /^([a-z]\d{2}[a-z0-9_-]*)\.solution\.mjs$/.exec(f);
    if (m) out.push({ id: m[1], walkthrough: files.has(`${m[1]}.walkthrough.mjs`) });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The web build's catalog (esbuild define), or null in the dev tree. */
const BUILT = globalThis.__SS_SOLUTIONS__ ?? null;

let catalog = Array.isArray(BUILT) ? BUILT.map((e) => ({ ...e })) : null;
let catalogP = null;

/**
 * The catalog: [{id, walkthrough}] (cached). Dev tree: the dev server's listing of tools/solutions/; a server that
 * cannot list it gives an empty catalog (no SOLUTION / walkthrough offered, nothing else breaks).
 */
export function loadCatalog() {
  if (catalog) return Promise.resolve(catalog);
  if (!catalogP) {
    catalogP = fetch(new URL('../../tools/solutions/?ls', import.meta.url), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((names) => (catalog = catalogFromFiles(Array.isArray(names) ? names : [])));
  }
  return catalogP;
}

/** The catalog if it is loaded yet (else null): sync callers (buttons, keys) after loadCatalog() resolved. */
export function catalogNow() {
  return catalog;
}

/** Test hook: set the catalog (null = list the folder again). */
export function _setCatalog(c) {
  catalog = c ? c.map((e) => ({ ...e })) : null;
  catalogP = null;
}

/** Does mission `id` have a saved solution? (false until the catalog is loaded) */
export function hasSolution(id) {
  return !!id && !!catalog?.some((e) => e.id === id);
}

/** Does mission `id` have a walkthrough file? */
export function hasWalkthrough(id) {
  return !!id && !!catalog?.some((e) => e.id === id && e.walkthrough);
}

/** Mission ids with a saved solution. */
export function solutionIds() {
  return (catalog || []).map((e) => e.id);
}

const validId = (id) => typeof id === 'string' && /^[a-z]\d{2}[a-z0-9_-]*$/.test(id);

/** Load the solution module of `id` plus the driver (both lazy). */
export async function loadSolution(id) {
  await loadCatalog();
  if (!hasSolution(id) || !validId(id)) throw new Error(`no saved solution for ${id}`);
  const [mod, driver, drive] = await Promise.all([
    import(`../../tools/solutions/${id}.solution.mjs`), import('../../tools/solutions/driver.mjs'), import('../abilities/drive.js'),
  ]);
  if (typeof mod.solve !== 'function') throw new Error(`${id}.solution.mjs exports no solve()`);
  return { id, solve: mod.solve, stages: (mod.STAGES || []).map(([sid, title]) => ({ id: sid, title })), makeDriver: driver.makeDriver,
    SolutionAborted: driver.SolutionAborted, ctx: { boardPoint: drive.boardPoint } };
}

/** Load the walkthrough file of `id` (its WALKTHROUGH object), or null when it has none. */
export async function loadWalkthrough(id) {
  await loadCatalog();
  if (!hasWalkthrough(id) || !validId(id)) return null;
  const mod = await import(`../../tools/solutions/${id}.walkthrough.mjs`);
  return mod.WALKTHROUGH || null;
}
