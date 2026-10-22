/**
 * Gameplay never depends on the graphics preset (user 2026-10-22, the M3 walkthrough at preset=low timed out in stage I:
 * "Gameplay must never depend on the graphics preset (art LOD/detail may differ, but solids, nav, sight blockers,
 * placements and RNG consumption must be identical across presets)").
 *
 * Every mission is loaded COLD (a fresh page: nothing cached — a warm reload hides the bug, the LODs measured being
 * already in) at preset 'low' and at 'high', and its gameplay world fingerprinted (debug/gameplay-fingerprint.js: every
 * NavGrid layer, links, stairs, body solids, ground / lying heights, structures, interactables, entities, ladders,
 * water obstacles, mission registries, house rules, physics gameplay caps, RNG). Both must be identical, field by field.
 * What it caught: 'low' measured the library buildings on LOD1 (LOD0 not preloaded: visual nav, eaves / head room,
 * levelled bases, low surfaces, crawl steps, measured tops — M3's cabins) and the tree branches (gun arcs) on its own
 * coarser tree set; a smashed gate broke into fewer pieces at 'low'.
 *
 * SS_PRESETDET=m03,m05 restricts the missions (default: every mission of missions/index.js); SS_PRESETDET_PRESETS=
 * low,medium,high,ultra compares more presets (default low,high: 'low' differs from 'high' on every axis — library LOD
 * bias, tree budget and detail, water bake, physics tier), each against 'high'.
 * The loads of a mission run side by side (a page each); a mission at a time.
 */
export const timeout = 3_600_000;

const PRESETS = (process.env.SS_PRESETDET_PRESETS || 'low,high').split(',').map((s) => s.trim()).filter(Boolean);
const REF = PRESETS.includes('high') ? 'high' : PRESETS[0];

export default async function presetDeterminism(page, t) {
  const h = t.harness;
  const only = (process.env.SS_PRESETDET || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ids = only.length ? only : await page.evaluate(async () => (await import('/src/missions/index.js')).MISSIONS.map((m) => m.id));
  const bad = [];
  for (const id of ids) {
    const t0 = Date.now();
    const fp = {};
    await Promise.all(PRESETS.map(async (preset) => {
      const p = await h.newPage();
      try {
        p.setDefaultTimeout(0);
        await h.openGame(p, `?test=1&preset=${preset}`);
        fp[preset] = await p.evaluate(async (mid) => {
          const G = window.__game;
          await G.loadMission(mid);
          return { preset: G.game.renderer.presetName, fp: await G.gameplayFingerprint() };
        }, id);
        const errs = h.errors(p);
        if (errs.length) t.log(`${id} @${preset}: page errors: ${errs.slice(0, 3).join(' | ')}`);
      } finally { await p.close().catch(() => {}); }
    }));
    for (const preset of PRESETS) t.equal(fp[preset].preset, preset, `${id}: loaded at preset ${preset}`);
    const { diffFingerprints } = await import('../src/debug/gameplay-fingerprint.js');
    const n = Object.keys(fp[REF].fp.fields).length;
    for (const preset of PRESETS.filter((p) => p !== REF)) {
      const d = diffFingerprints(fp[preset].fp, fp[REF].fp);
      t.log(`${id}: ${d.length ? `${d.length} of ${n} gameplay fields DIFFER ${preset} vs ${REF}` : `${n} gameplay fields identical ${preset} / ${REF}`} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      for (const x of d) {
        const where = x.rows ? `rows ${x.rows.slice(0, 8).join(',')}${x.rows.length > 8 ? `… (${x.rows.length})` : ''}`
          : x.items ? `${x.items.length} items (${x.count.join(' / ')}), e.g. [${x.items[0]?.i}] ${preset} ${x.items[0]?.a} | ${REF} ${x.items[0]?.b}` : '';
        t.log(`    ${x.field}: ${where}`);
        bad.push(`${id} ${preset} ${x.field}`);
      }
    }
  }
  t.equal(bad.length, 0, `the gameplay world is the same at every preset${bad.length ? `: ${bad.slice(0, 12).join(', ')}` : ''}`);
}
