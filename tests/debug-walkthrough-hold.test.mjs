/**
 * Video mode presentation (user, M3 2026-10-14: "When the spy grabs the clothes there is no time to see how he grabs
 * them and we transition straight to another commando. When a commando is chosen the power right bag should reflect the
 * items from the corresponding commando. Every time a commando is manipulated we should see the circle around that
 * commando."):
 *  1. every order of the solution selects the man it goes to, as a portrait click would: the knapsack shows his items,
 *     the selection ring is drawn under him (two men ordered together: two rings);
 *  2. the Spy's clothesline take (M3 step C3) is watched until it has visibly finished — the action, the rest of its
 *     clip, then a beat (debug/action-hold.js) — the camera on her, her step's caption, AUTO at 1×; only then the
 *     chapter D card and the Marine;
 *  3. the plain SOLUTION replay (▶ SOL / F9) selects the ordered man too;
 *  and a true wait (the solution waiting for p1 to walk off, nobody acting) is skipped like a jump in AUTO under a
 *  "⏩ waiting: <what for>" tag (user 2026-10-14: "fix those periods of idleness"), and the camera never rests on a man
 *  standing idle while another acts (2026-10-15: "Also no long quiet periods, always action in the walkthrough").
 */
export const timeout = 600_000;

export default async function debugWalkthroughHold(page, t) {
  const url = t.harness.url;
  const T0 = Date.now();
  const step = (n) => t.log(`${n} @${((Date.now() - T0) / 1000).toFixed(1)} s`);
  page.setDefaultTimeout(300000);
  const click = (sel) => page.locator(sel).click();
  /** after the next two frames: the last order, who is selected, the knapsack's units and items, the rings */
  const look = (arr = '__ord') => page.evaluate(async (arr) => {
    const g = window.shadowSix, w = g.world, ord = window[arr];
    const last = ord[ord.length - 1], sel0 = w.commandos.filter((c) => c.selected).map((c) => c.role).join();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
    const sel = w.commandos.filter((c) => c.selected && c.alive);
    // (stable: no order and no change of selection over the frames looked at — the rings are drawn a frame later)
    const last2 = sel.map((c) => c.role).join() === sel0 ? ord[ord.length - 1] : null;
    const { knapsackView } = await import('/src/ui/knapsack-model.js');
    const want = knapsackView(sel, w).items.map((i) => i.id).join(',');
    const dom = [...document.querySelectorAll('.hud-knapsack .pack [data-item]')].map((b) => b.dataset.item).join(',');
    const rings = (g.selection?.rings || []).filter((r) => r.visible).map((r) => [r.position.x, r.position.z]);
    const ringed = sel.every((c) => rings.some(([x, z]) => Math.hypot(x - (c.object3d?.position.x ?? c.x), z - (c.object3d?.position.z ?? c.z)) < 0.6));
    const detail = sel.map((c) => `${c.role}:${Math.min(...rings.map(([x, z]) => Math.hypot(x - (c.object3d?.position.x ?? c.x), z - (c.object3d?.position.z ?? c.z)))).toFixed(2)}${c.buried ? ' buried' : ''}${c.underwater ? ' under' : ''}${c.state}`).join(' ');
    const held = g.debug.mode.replay?.holdNow?.()?.unit?.role ?? null;
    // (a skipped wait draws the view only now and then: the rings follow at the next drawn frame)
    if (g.debug.mode.replay?.pacer.turbo) return { stable: false };
    return { stable: last === last2, last: last?.role ?? null, sel: sel.map((c) => c.role), want, dom, rings: rings.length, ringed, t: w.time, detail, all: (g.selection?.rings || []).length, held };
  }, arr);

  step('1. M3 in AUTO: every order selects the man it goes to (knapsack, ring)');
  await page.goto(`${url}/index.html?debug&preset=low&walkthrough=m03&speed=auto`);
  await page.evaluate(() => localStorage.removeItem('shadowsix.debug.options'));
  await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]') && window.shadowSix?.debug?.mode?.replay, null, { timeout: 240000 });
  await page.evaluate(() => {
    const g = window.shadowSix, w = g.world, inp = g.input, os = inp.select.bind(inp);
    window.__ord = []; window.__sel = [];
    w.events.on('unit:order', (p) => window.__ord.push({ role: p.unit.role, t: w.time }));
    inp.select = (units, o) => { window.__sel.push(`${w.time.toFixed(2)}:[${units.map((u) => u.role)}]`); return os(units, o); };
    // a true wait (p1 walking off east, ~2–75 s) is skipped like a jump under a "waiting" tag; and to t=200 the camera
    // never rests on a man standing idle while another acts (user 2026-10-15: "always action in the walkthrough")
    const r = g.debug.mode.replay;
    window.__wait = { tags: [] };
    window.__act = { n: 0, idleWhileBusy: 0, ex: [] };
    const acting = (u) => !!u && u.alive !== false && (!!u.path || !!u.pendingAbility || (!!u.currentAction && !['distract', 'shovel'].includes(u.currentActionId)) || !!u.vehicle?.path);
    const oc = r.composeShot.bind(r);
    r.composeShot = () => { const sh = oc(); window.__shotA = sh; return sh; };
    const f = () => {
      if (r.stopped || w.time > 200) return;
      const tag = document.getElementById('wt-skip')?.textContent || '';
      if (tag && !window.__wait.tags.includes(tag)) window.__wait.tags.push(tag);
      const sh = window.__shotA, p = sh?.pts?.[0];
      if (p && !r.pacer.turbo && !r._held() && !r.paused && !sh.hold && !sh.stiff) {
        // (the men the shot frames: any commando at one of its points — the action is on screen if one of them acts)
        const near = (c) => sh.pts.some((q) => Math.hypot((c.vehicle || c).x - q.x, (c.vehicle || c).z - q.z) < 1.2);
        const inShot = w.commandos.filter((c) => c.alive && near(c));
        const framed = inShot[0];
        const other = w.commandos.find((c) => !inShot.includes(c) && acting(c));
        window.__act.n++;
        if (framed && !inShot.some(acting) && other) { window.__act.idleWhileBusy++; if (window.__act.ex.length < 5) window.__act.ex.push(`t=${w.time.toFixed(1)} ${framed.role} idle, ${other.role} acting`); }
      }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await click('#wt-card [data-act=start]');
  await page.waitForFunction(() => new Set(window.__ord.map((o) => o.role)).size >= 2 && window.shadowSix.world.time > 25, null, { timeout: 180000 });
  const samples = [];
  for (let i = 0; i < 160 && (samples.length < 12 || new Set(samples.map((x) => x.last)).size < 2); i++) {
    let s = await look();
    if (s.stable && !(s.rings === s.sel.length && s.ringed)) s = await look(); // (a selection changing as we look: look again)
    if (s.stable && s.last) samples.push(s);
    await page.waitForTimeout(250);
  }
  const roles = new Set(samples.map((s) => s.last));
  t.log(`orders: ${(await page.evaluate(() => window.__ord.slice(0, 14).map((o) => `${o.role}@${o.t.toFixed(2)}`).join(' ')))}`);
  t.log(`samples: ${samples.map((s) => `${s.last}:[${s.sel}] ${s.rings} ring(s)`).join(' | ')}`);
  t(samples.length >= 6, `sampled the play (${samples.length})`);
  t(samples.every((s) => s.sel.includes(s.last) || (s.held && s.sel.includes(s.held))), 'the man the last order went to is always selected (or, while another man\'s action is watched to its end, still that man)');
  t(samples.every((s) => s.dom === s.want && s.dom.length > 0), `the knapsack shows the selected man's items (${samples[0]?.dom})${samples.filter((s) => !(s.dom === s.want && s.dom.length > 0)).slice(0, 4).map((s) => ` [t=${s.t.toFixed(1)} [${s.sel}] shows "${s.dom}" want "${s.want}"]`).join('')}`);
  if (!samples.every((s) => s.rings === s.sel.length && s.ringed)) t.log(`selects: ${(await page.evaluate(() => window.__sel.join(' ')))}`);
  t(samples.every((s) => s.rings === s.sel.length && s.ringed), `a selection ring under every selected man${samples.filter((s) => !(s.rings === s.sel.length && s.ringed)).map((s) => ` [t=${s.t.toFixed(1)} ${s.detail} rings ${s.rings}/${s.all}]`).join('')}`);
  t(roles.size >= 2, `the knapsack and the ring moved from man to man (${[...roles]})`);
  await t.shot('debug-walkthrough-hold-bag');
  await page.waitForFunction(() => window.shadowSix.world.time > 200, null, { timeout: 300000 });
  const wt = await page.evaluate(() => ({ ...window.__wait, skips: window.shadowSix.debug.mode.replay.skips || [] }));
  const sk = wt.skips.find((x) => /p1 walks off east/.test(x.label));
  t.log(`skipped waits: ${wt.skips.map((x) => `${x.label} ${x.game.toFixed(1)} s in ${x.wall.toFixed(2)} s`).join(' | ')}`);
  t(sk && sk.game > 30 && sk.wall < 3 && wt.tags.some((x) => /⏩ waiting: p1 walks off east/.test(x)), `a true wait is skipped like a jump, under a "waiting" tag (${sk?.game.toFixed(1)} s of game in ${sk?.wall.toFixed(2)} s; tags ${wt.tags.map((x) => `"${x}"`).join(', ')})`);
  const act = await page.evaluate(() => window.__act);
  t(act.n > 100 && act.idleWhileBusy / act.n < 0.03, `the camera does not rest on an idle man while another acts (${act.idleWhileBusy}/${act.n} frames${act.ex.length ? ': ' + act.ex.join('; ') : ''})`);

  step('2. the clothesline take (C3): watched to its end, then a beat, before the Marine');
  await page.evaluate(() => {
    const g = window.shadowSix, w = g.world, r = g.debug.mode.replay, spy = w.commandos.find((c) => c.role === 'spy');
    const P = window.__take = { start: null, end: null, clip: null, card: null, f: [] };
    w.events.on('ability:start', (p) => { if (p.unit === spy && p.id === 'use' && P.start == null) P.start = w.time; });
    w.events.on('ability:end', (p) => { if (p.unit === spy && p.id === 'use' && P.end == null) { P.end = w.time; P.clip = spy._animOverride?.t > 0 ? spy._animOverride.t : 0; } });
    const oc = r.composeShot.bind(r);
    r.composeShot = () => { const s = oc(); window.__shot = s; return s; };
    const f = () => {
      if (r.stopped) return;
      const s = window.__shot, p = s?.pts?.[0];
      const onSpy = !!p && Math.hypot(p.x - spy.x, p.z - spy.z) < 1.5;
      if (r.hold?.kind === 'chapter' && r.chapterId === 'D' && P.card == null && r._held()) P.card = w.time;
      P.f.push([w.time, onSpy ? 1 : 0, s?.hold?.id || '', document.getElementById('wt-cap')?.dataset.step || '', r.rate, w.commandos.filter((c) => c.selected).map((c) => c.role).join('+')]);
      if (P.card == null || w.time < P.card + 1) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await click('#wt-bar [data-act=chapters]');
  await click('#wt-menu [data-step="C3"]');
  await page.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay; return r && r.doneCps.includes('C2') && !r.pacer.turbo; }, null, { timeout: 300000 });
  await page.waitForFunction(() => window.__take.card != null, null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  const P = await page.evaluate(() => window.__take);
  const { HOLD_BEAT } = await import('../src/debug/action-hold.js');
  const visEnd = P.end + P.clip;
  const during = P.f.filter((x) => x[0] >= P.start + 0.05 && x[0] <= visEnd + HOLD_BEAT - 0.05);
  t.log(`take: start ${P.start?.toFixed(2)}, end ${P.end?.toFixed(2)} (+${P.clip?.toFixed(2)} s of clip), chapter D card at ${P.card?.toFixed(2)}; ${during.length} frames held`);
  t(P.start != null && P.end != null && P.end - P.start >= 1, `the take ran (${(P.end - P.start).toFixed(2)} s)`);
  t(during.length > 10 && during.every((x) => x[1] === 1), `the camera stays on the Spy for the take, the rest of its clip and a ${HOLD_BEAT} s beat (${during.filter((x) => !x[1]).length} frames off her)`);
  // (the caption is redrawn ten times a second: from half a second in)
  const capped = during.filter((x) => x[0] >= P.start + 0.5);
  t(capped.every((x) => x[3] === 'C3'), `her step (C3) stays on the caption meanwhile (${[...new Set(capped.map((x) => x[3]))]})`);
  t(P.card >= visEnd + HOLD_BEAT - 0.05, `the chapter D card only after that (${P.card.toFixed(2)} ≥ ${(visEnd + HOLD_BEAT).toFixed(2)})`);
  t(during.every((x) => x[5].split('+').includes('spy')), `the knapsack and the ring stay on the Spy meanwhile (${[...new Set(during.map((x) => x[5]))]})`);
  const lastSel = P.f[P.f.length - 1][5];
  t(/diver/.test(lastSel), `then they go to the Marine, as his orders come (${lastSel})`);
  const take = P.f.filter((x) => x[0] >= P.start && x[0] <= P.end);
  const busy = take.filter((x) => x[0] >= P.start + 0.7);
  t(take.length > 5 && take.every((x) => x[4] <= 1.6) && busy.every((x) => x[4] <= 1.15), `AUTO plays the take at about 1× (≤ ${Math.max(...take.map((x) => x[4])).toFixed(2)}× from its start, ≤ ${Math.max(...busy.map((x) => x[4])).toFixed(2)}× after 0.7 s)`);
  await t.shot('debug-walkthrough-hold-take');

  step('3. ▶ SOL: the plain solution replay selects the ordered man too');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('dbg-select'), null, { timeout: 60000 });
  // (game.events is every world's bus: listening before the launch hears the first orders)
  // (a list of its own: the walkthrough's listeners are still on the game's bus)
  await page.evaluate(() => { window.__ordS = []; window.shadowSix.events.on('unit:order', (p) => window.__ordS.push({ role: p.unit.role, t: p.unit.world?.time ?? 0 })); });
  await page.evaluate(async () => { await window.shadowSix.debug.mode.startReplay('m03'); return true; });
  await page.waitForFunction(() => window.shadowSix.debug.mode.replay && !window.shadowSix.debug.mode.replay.isWalkthrough && window.__ordS.length >= 2, null, { timeout: 240000 });
  let s = null;
  for (let i = 0; i < 20 && !s; i++) { const x = await look('__ordS'); if (x.stable && x.last && x.rings === x.sel.length) s = x; }
  t(s && s.sel.includes(s.last) && s.dom === s.want && s.ringed, `▶ SOL: ${s?.last} selected, his knapsack and ring (${JSON.stringify(s)})`);
}
