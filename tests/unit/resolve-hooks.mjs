/**
 * Node ESM resolve hook mirroring the browser import map (index.html): 'three' →
 * vendor/three.module.js, 'three/addons/*' → vendor/addons/*. Lets the unit suite run in a git
 * worktree / clean checkout without node_modules/three. Registered by tests/unit/run.mjs.
 */
const ROOT = new URL('../../', import.meta.url);

export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('vendor/three.module.js', ROOT).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) {
    return { url: new URL('vendor/addons/' + specifier.slice('three/addons/'.length), ROOT).href, shortCircuit: true };
  }
  return next(specifier, context);
}
