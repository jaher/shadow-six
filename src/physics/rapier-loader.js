/**
 * Loads the vendored deterministic Rapier build (vendor/rapier, bodies-design §A.1): WASM inlined in the compat JS,
 * so node tests and the browser load it the same way (no fetch). Imported lazily: missions without physics never pay
 * the 4 MB parse. Resolves to the RAPIER namespace or null (the caller then installs the null object).
 * @module physics/rapier-loader
 */

let pending = null;
/** Test hook: force a failed load (bodies-design §E "a missing or failed physics init gives identical gameplay"). */
export const loaderHooks = { fail: false };

/** @returns {Promise<object|null>} */
export function loadRapier() {
  if (loaderHooks.fail) return Promise.resolve(null);
  pending ||= (async () => {
    try {
      const mod = await import('../../vendor/rapier/rapier.mjs');
      const R = mod.default || mod;
      await R.init();
      return R;
    } catch (e) {
      console.warn('[physics] Rapier failed to initialise; bodies use the canned death clip', e);
      return null;
    }
  })();
  return pending;
}
