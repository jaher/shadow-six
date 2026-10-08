/**
 * Shared by tests/veg-water*.test.mjs (GPU): load a mission and check every live plant instance against the drawn
 * shore field (terrain.shore: the field the ground is carved with and the water drawn over). See veg-water.test.mjs.
 */

/** Load mission `id` in the page and return its report {n, nBad, bad[], mapMed, apronMed, spot?}. */
export async function checkMission(page, id) {
  return page.evaluate(async (m) => {
    const g = window.__game, G = g.game;
    const VS = await import('/src/world/veg-shore.js').catch(() => ({}));
    const SHORE = VS.SHORE_MARGIN ?? 1, APRON = VS.APRON_SHORE_MARGIN ?? 2.5, GROUND = VS.GROUND_SHORE_MARGIN ?? 0.5;
    await g.loadMission(m); g.start();
    const T = G.world.terrain;
    await T.ready; await T.apronReady;
    const wet = T.shore?.wetAt;
    if (!wet) return { id: m, noShore: true };
    const out = { id: m, n: 0, nBad: 0, bad: [], mapH: [], apronH: [] };
    const check = (src, x, z, margin, what) => {
      out.n++;
      const w = wet(x, z);
      if (w > -margin && out.nBad++ < 20) out.bad.push(`${src} ${what} (${x.toFixed(2)}, ${z.toFixed(2)}) ${w.toFixed(2)} m`);
    };
    const SPECIES = (await import('/src/art/terrain/treegen.js')).SPECIES;
    for (const p of T.vegetation?.trees || []) {
      check('map', p.x, p.z, SHORE, p.species);
      if (!p.visual && SPECIES[p.species]?.kind !== 'bush') out.mapH.push(p.height ?? 0);
    }
    for (const p of T.apron?.vegetation?.trees || []) {
      const bush = SPECIES[p.species]?.kind === 'bush';
      check('apron', p.x, p.z, bush ? SHORE : APRON, p.species);
      if (!bush) out.apronH.push(p.height ?? 0);
    }
    // instanced ground plants: desert scrub (trunk margin), wildflowers / weed rosettes, grass and crop tufts (the
    // reeds stand in the shallows on purpose)
    const P = [0, 0, 0];
    T.ground.traverse((o) => {
      if (o.name.startsWith('grass:') && o.userData.archetype !== 'reed') {
        const a = o.geometry.attributes.iOff?.array;
        for (let i = 0; a && i < a.length / 4; i++) check('grass', a[i * 4], a[i * 4 + 2], GROUND, o.name);
        return;
      }
      if (!o.isInstancedMesh) return;
      const scrub = o.name.startsWith('scrub:'), small = o.name.startsWith('clutterFlowers_') || o.name === 'clutterWeeds';
      if (!scrub && !small) return;
      const a = o.instanceMatrix.array;
      for (let i = 0; i < o.count; i++) {
        P[0] = a[i * 16 + 12]; P[2] = a[i * 16 + 14];
        check(scrub ? 'scrub' : 'ground', P[0], P[2], scrub ? SHORE : GROUND, o.name);
      }
    });
    if (m === 'm01') out.spot = (T.apron?.vegetation?.trees || []).filter((p) => Math.hypot(p.x - 70.98, p.z - 36.9) < 1).map((p) => [p.species, p.height]);
    const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0);
    out.mapMed = med(out.mapH); out.apronMed = med(out.apronH); delete out.mapH; delete out.apronH;
    return out;
  }, id);
}

/** Check `ids` one by one, logging each report; returns {id: report}. */
export async function checkMissions(page, t, ids) {
  const report = {};
  for (const id of ids) {
    const r = report[id] = await checkMission(page, id);
    t.log(id, r.noShore ? 'no shore field' : `${r.n} plants, ${r.nBad} at / in the water; median tree height map ${r.mapMed.toFixed(1)} m, apron ${r.apronMed.toFixed(1)} m`);
    if (r.bad?.length) t.log('   ', r.bad.slice(0, 12).join('\n     '));
  }
  return report;
}

/** Every mission's assertions. */
export function assertClean(t, report) {
  for (const [id, r] of Object.entries(report)) {
    t.ok(!r.noShore, `${id}: the shore field is built`);
    t.equal(r.nBad, 0, `${id}: no plant at / in the water (${r.bad.slice(0, 3).join('; ')})`);
  }
}
