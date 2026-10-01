/**
 * Tree generation worker (must-fix 11): builds per-chunk bark/leaf vertex arrays off the main thread.
 * msg {init: {threeUrl, treegenUrl}} then {job, q, chunks: [{key, trees: [{species, seed, x, y, z, scale, burnt, leafless}]}]}
 * → {job, chunks: [{key, bark, leaf, needle, info: [...]}]} with transferable typed arrays (needle: conifer needle
 * sprays, drawn with their own material).
 * @module terrain-final/treegen.worker
 */
let TG = null;
self.onmessage = async (e) => {
  const m = e.data;
  if (m.init) {
    const T = await import(m.init.threeUrl);
    TG = await import(m.init.treegenUrl);
    TG.useThree(T);
    self.postMessage({ ready: true });
    return;
  }
  const out = [], transfer = [];
  for (const c of m.chunks) {
    const bark = new TG.GeoAcc(), leaf = new TG.GeoAcc(), needle = new TG.GeoAcc(), info = [];
    for (const t of c.trees) info.push(TG.generateTree(t.species, t.seed, m.q, bark, leaf, t, needle));
    const b = bark.count ? bark.toArrays() : null, l = leaf.count ? leaf.toArrays() : null, n = needle.count ? needle.toArrays() : null;
    for (const a of [b, l, n]) if (a) transfer.push(...Object.values(a).map((x) => x.buffer));
    out.push({ key: c.key, bark: b, leaf: l, needle: n, info });
  }
  self.postMessage({ job: m.job, chunks: out }, transfer);
};
