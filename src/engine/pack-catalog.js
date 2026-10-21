/**
 * Which mission packs exist in this deployment (GENERATED — do not edit by hand).
 *
 * Written by tools/packs/build-packs.mjs when packs are built for a deployment; the committed default is
 * empty: no packs exist, and the loader (engine/mission-pack.js) never probes for one — a probe fetch of a
 * missing file would land a 404 in the console, which the test runner treats as a failure. The pack binaries
 * themselves are build artifacts under assets/packs/ (gitignored); this catalog is the deployment's word
 * that they are there. Regenerate with: node tools/packs/build-packs.mjs [--missions=…] [--presets=…]
 * (or reset to this empty default with --clean).
 */
export const PACK_CATALOG = { packs: {} };
