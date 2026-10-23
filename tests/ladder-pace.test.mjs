/**
 * Natural ladder pace (user 2026-10-22: "Make sure the ladder climbing looks natural"): every steep ladder in the game is
 * climbed by the sim in no less than its posed climb's natural time over PACE (art/ladder-climb.js ladderPace: the
 * walks between its link's ends and the drawn ladder, a foot's move every 0.36 s up its rungs, the step or the vault
 * onto its deck) — the view squeezes the climb into the sim's leg. M2's camp ladder over the palisade had 2.96 s for a
 * 6.1 s climb (twice too quick: hands and feet flicked up the rungs), M17's elevated fuel tank 3.4 s for 8.9, M19's
 * small water tower 2.8 s for 4.1; a ladder's leg takes `ladders[].climbTime` / structure `ladderTime` s when given.
 */
export const timeout = 900_000;

const PACE = 1.35;

export default async function ladderPace(page, t) {
  const rows = await page.evaluate(async () => {
    const G = window.__game, g = G.game;
    const { MISSIONS } = await import('/src/missions/index.js');
    const LC = await import('/src/art/ladder-climb.js');
    const { steepLadder } = await import('/src/entities/stair-walk.js');
    const out = [];
    for (const m of MISSIONS) {
      if (!/^m\d/.test(m.id)) continue;
      await G.loadMission(m);
      G.start(); g.stop();
      for (let i = 0; i < 3; i++) g.step(G.CONFIG.sim.dt);
      G.render(1 / 60, 1);
      const w = g.world, v = G.CONFIG.abilities.ladderSpeed;
      for (const L of w.grid.links) {
        if (L.kind !== 'ladder' || L.walk || !steepLadder(L)) continue;
        const p = LC.ladderPace(w, L, v);
        if (!p) continue;
        // (the sim's leg: its length at the ladder pace, or the link's own climb time)
        const sim = Math.max(p.sim, L.climbTime ?? 0);
        out.push({ mis: m.id, id: L.id, name: w.ladders?.find((q) => q.linkId === L.id)?.def?.id ?? null, nat: p.nat, sim });
      }
    }
    return out;
  });
  const bad = rows.filter((r) => r.nat / r.sim > PACE);
  for (const r of rows) t.log(`${r.nat / r.sim > PACE ? 'FAIL' : 'ok  '} ${r.mis}:${r.id}${r.name ? ` (${r.name})` : ''}: posed ${r.nat.toFixed(2)} s, sim ${r.sim.toFixed(2)} s (×${(r.nat / r.sim).toFixed(2)})`);
  t(rows.length >= 30, `ladders measured (${rows.length})`);
  t(!bad.length, `every ladder climbed at most ${PACE}× quicker than its posed pace: ${bad.map((r) => `${r.mis}:${r.id} ×${(r.nat / r.sim).toFixed(2)}`).join(', ')}`);
}
