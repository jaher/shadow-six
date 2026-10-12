/**
 * Shared cone-vs-perception sampler (tests/unit/cone-fidelity, cone-height): random points round a viewer; a
 * standing / crawling dummy clearly inside the drawn region (coneRegions: stand = both shades, low = the dark near
 * kind) must be seen, clearly outside must not (0.25 m margin: the 8 points round it agree).
 */
import { B } from '../../src/world/grid.js';
import { canSee } from '../../src/ai/perception.js';
import { coneFan, coneRegions, inRegion } from '../../src/render/vision-cone.js';

/** A point clearly inside (true) / clearly outside (false) a drawn region, or null within `m` m of its edge. */
export function clearly(quads, x, z, m = 0.25) {
  const at = inRegion(quads, x, z);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    if (inRegion(quads, x + Math.cos(a) * m, z + Math.sin(a) * m) !== at) return null;
  }
  return at;
}

export function check(w, viewer, t, rng, n = 2000) {
  w.time = t;
  const fan = coneFan(viewer, w.grid, { t });
  const reg = coneRegions(fan);
  const R = fan.cone.far + 3;
  const st = { standIn: 0, standOut: 0, crawlIn: 0, crawlOut: 0, bad: [] };
  const g = w.grid;
  for (let k = 0; k < n; k++) {
    const x = viewer.x + rng.range(-R, R), z = viewer.z + rng.range(-R, R);
    const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
    if (!g.inBounds(i, j) || g.block[g.idx(i, j)] === B.HIGH || g.dynamicBlock[g.idx(i, j)] === B.HIGH) continue; // dummies stand on free ground
    const y = g.elev[g.idx(i, j)];
    const stand = canSee(viewer, { x, z, y, isLow: false, isVisibleToEnemies: true }, w);
    const crawl = canSee(viewer, { x, z, y, isLow: true, isVisibleToEnemies: true }, w);
    const inF = clearly(reg.stand, x, z);
    if (inF === true) { st.standIn++; if (stand === 'none') st.bad.push(['stand-in', x, z]); }
    else if (inF === false) { st.standOut++; if (stand !== 'none') st.bad.push(['stand-out', x, z]); }
    const inN = clearly(reg.low, x, z);
    if (inN === true) { st.crawlIn++; if (crawl !== 'near') st.bad.push(['crawl-in', x, z]); }
    else if (inN === false) { st.crawlOut++; if (crawl !== 'none') st.bad.push(['crawl-out', x, z]); }
  }
  return st;
}


/** The same sampling against what a VisionCone draws (its sector mesh under the shader's window: drawnAt). */
export function checkMesh(w, viewer, vc, t, rng, n = 1500) {
  w.time = t;
  vc.update(viewer);
  const at = (x, z) => vc.drawnAt(x, z);
  const clear = (x, z, test, m = 0.25) => {
    const v = test(at(x, z));
    for (let k = 0; k < 8; k++) if (test(at(x + Math.cos((k * Math.PI) / 4) * m, z + Math.sin((k * Math.PI) / 4) * m)) !== v) return null;
    return v;
  };
  const R = (viewer.vision.far ?? 36) + 3;
  const st = { standIn: 0, standOut: 0, crawlIn: 0, crawlOut: 0, bad: [] };
  const g = w.grid;
  for (let k = 0; k < n; k++) {
    const x = viewer.x + rng.range(-R, R), z = viewer.z + rng.range(-R, R);
    const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
    if (!g.inBounds(i, j) || g.block[g.idx(i, j)] === B.HIGH || g.dynamicBlock[g.idx(i, j)] === B.HIGH) continue;
    const y = g.elev[g.idx(i, j)];
    const stand = canSee(viewer, { x, z, y, isLow: false, isVisibleToEnemies: true }, w);
    const crawl = canSee(viewer, { x, z, y, isLow: true, isVisibleToEnemies: true }, w);
    const inF = clear(x, z, (r) => r != null);
    if (inF === true) { st.standIn++; if (stand === 'none') st.bad.push(['stand-in', x, z]); } else if (inF === false) { st.standOut++; if (stand !== 'none') st.bad.push(['stand-out', x, z]); }
    const inN = clear(x, z, (r) => r === 'near');
    if (inN === true) { st.crawlIn++; if (crawl !== 'near') st.bad.push(['crawl-in', x, z]); } else if (inN === false) { st.crawlOut++; if (crawl !== 'none') st.bad.push(['crawl-out', x, z]); }
  }
  return st;
}
