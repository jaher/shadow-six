/**
 * Debug SOLUTION replay of LIGHTS OUT e05 (src/debug/solution-replay.js): in ?debug the level select's "play the
 * solution" loads Cold Iron fresh and plays tools/solutions/e05.solution.mjs live in the real game loop; fast-forwarded
 * to its last stage and then played at 8×, it ends in the win with every checkpoint passed and nobody seen.
 */
export const timeout = 900_000;

export default async function debugSolutionE05(page, t) {
  page.setDefaultTimeout(600_000);
  await page.goto(`${t.harness.url}/?debug`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.shadowSix?.debug?.mode, null, { timeout: 120_000 });
  const res = await page.evaluate(async () => {
    const g = window.shadowSix, m = g.debug.mode;
    const end = new Promise((resolve) => g.events?.on?.('debug:replay-end', (r) => resolve(r)));
    const r = await m.startReplay('e05', { toStage: 'G', speed: 8 });
    if (!r) return { started: false };
    const out = await Promise.race([end, new Promise((resolve) => setTimeout(() => resolve({ outcome: 'timeout' }), 800_000))]);
    const w = g.world;
    return { started: true, outcome: out?.outcome ?? null, error: out?.error ?? null, state: g.state, time: w?.time ?? 0,
      objectives: w ? Object.fromEntries(w.objectives.map((o) => [o.id, o.done])) : null,
      detections: r.driver?.detections?.() ?? null, checkpoints: r.driver?.checkpoints?.map((c) => c.name.split(' ')[0]) ?? [] };
  });
  t.log(`e05 replay: started ${res.started}, outcome ${res.outcome} ${res.error ?? ''}, state ${res.state}, t=${res.time?.toFixed?.(1)}, objectives ${JSON.stringify(res.objectives)}, detections ${res.detections}, checkpoints ${res.checkpoints?.join(',')}`);
  t(res.started, 'the replay starts');
  t.equal(res.state, 'won', 'the replay ends in the win');
  t.equal(res.detections, 0, 'nobody seen');
  for (const k of ['A4', 'C2', 'D3', 'F3', 'G4']) t(res.checkpoints.includes(k), `checkpoint ${k}`);
}
