/**
 * Video mode: the Sniper's scope before every sniper shot (src/debug/walkthrough-scope.js; user 2026-10-22: "In the
 * walk-through we should see rhe sniper scope moving around before sniper hits target"). M2's two shots (D2 e4 in front
 * of the rocks, D3 e5 on the wall walk 1.1 s of game later), watched in AUTO:
 *  - the real scope lens (render/scope-magnifier.js) and its ring come up off the man, search round him, settle on him
 *    (the lens marks him) a beat before the shot, the recoil throws the view up, then — the bolt worked — the scope swings
 *    to e5 in the same sequence, the second shot, and it comes down; the camera keeps the man in view, the caption stays
 *    on the step; the lens programs were linked at the title card (none linked while the scope is up);
 *  - the shots fire at the scripted run's ticks (the logic-only run of tools/solutions/m02.solution.mjs in the same
 *    browser, as tests/m02-solution.test.mjs plays it): the scope's slow motion is wall time only;
 *  - at 4× (a jump back: reload and fast-forward) the sequence is shorter but still there;
 *  - then a jump to the last chapter and the run to its end: every checkpoint and the end time are the scripted run's;
 *  - on a phone (emulated Pixel 7, portrait, taps only) the scope shows too (the pointer's soft cursor is hidden on touch
 *    screens, the scripted scope is not), on the man in the free part of the screen, the bar and caption unchanged.
 */
import { DEVICES } from './touch-flow.mjs';

export const timeout = 1_800_000;
const IGNORED = [/GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i];

export default async function debugWalkthroughScope(page, t) {
  const url = t.harness.url;
  const T0 = Date.now();
  const step = (n) => t.log(`${n} @${((Date.now() - T0) / 1000).toFixed(1)} s`);
  page.setDefaultTimeout(600000);

  step('1. the scripted run, logic only (the reference)');
  const ref = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m02');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m02.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const w = G.game.world;
    const shots = [];
    w.events.on('shot', (p) => { if (p.weapon === 'sniper') shots.push({ t: w.time, tag: p.target?.tag ?? null }); });
    const D = makeDriver(w, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {}, skipEscape: () => G.game.skipExtraction() });
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e?.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    D.dispose?.();
    return { error, state: G.game.state, time: w.time, shots, marks: D.checkpoints.map((c) => ({ name: c.name.split(' ')[0], t: c.t })) };
  });
  t.log(`reference: ${ref.state} t=${ref.time.toFixed(2)}, sniper shots ${ref.shots.map((s) => `${s.tag}@${s.t.toFixed(3)}`).join(' ')}, ${ref.marks.length} checkpoints, error ${ref.error}`);
  t(!ref.error && ref.state === 'won', `the scripted run wins (${ref.state}, ${ref.error})`);
  t(ref.shots.length >= 2 && ref.shots[0].tag === 'e4' && ref.shots[1].tag === 'e5', `two sniper shots, e4 then e5 (${ref.shots.map((s) => s.tag)})`);

  step('2. the walkthrough: the scope lens linked at the title card');
  // (every program linked from here on, with where from: none may come from the scope while it is up)
  await page.addInitScript(() => {
    window.__links = [];
    const link = WebGL2RenderingContext.prototype.linkProgram;
    WebGL2RenderingContext.prototype.linkProgram = function (p) {
      window.__links.push({ wall: performance.now(), st: (new Error().stack || '').split('\n').slice(2, 9).join(' | ') });
      return link.call(this, p);
    };
  });
  await page.goto(`${url}/index.html?debug&preset=low&walkthrough=m02&speed=auto`);
  await page.evaluate(() => localStorage.removeItem('shadowsix.debug.options'));
  await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]') && window.shadowSix?.debug?.mode?.replay?.isWalkthrough, null, { timeout: 300000 });
  // (the warm-up result replaces its promise when it is done)
  await page.waitForFunction(() => { const x = window.shadowSix.debug.mode.replay.scopeWarm; return x != null && typeof x.then !== 'function'; }, null, { timeout: 60000 });
  const warm = await page.evaluate(() => window.shadowSix.debug.mode.replay.scopeWarm);
  t.log(`scope warm-up: ${JSON.stringify(warm)}`);
  t(warm && (warm.programs >= 1 || warm.skipped === true) && !warm.error && !warm.timedOut, `the lens's programs linked aside at the title card (${JSON.stringify(warm)})`);
  // the recorder: every displayed frame (the walkthrough on screen may be replaced by a jump back: it follows it)
  await page.evaluate(() => {
    window.__f = []; window.__ev = [];
    // (the game's bus is every world's: one hook hears the shots of the worlds a jump back builds; the clock read is
    // the world's playing now)
    const G = window.shadowSix, T = () => window.shadowSix.world?.time ?? NaN;
    G.events.on('shot', (p) => { if (p.weapon === 'sniper') window.__ev.push({ k: 'shot', t: T(), wall: performance.now(), tag: p.target?.tag ?? null }); });
    G.events.on('unit:killed', (p) => window.__ev.push({ k: 'kill', t: T(), wall: performance.now(), tag: p.unit?.tag ?? null }));
    const f = () => {
      const g = window.shadowSix, r = g.debug.mode.replay, w = g.world;
      if (r?.isWalkthrough && !r.pacer.turbo && w) {
        const cur = g.hud.cursor, L = cur._lens, M = g.scopeMagnifier, a = r.scope.aim;
        const ring = cur.lens?.root && !cur.lens.root.hidden && !cur.root.hidden && getComputedStyle(cur.root).display !== 'none';
        const cap = document.getElementById('wt-cap');
        const tg = a?.target ? w.enemies.find((e) => e.tag === a.target) : null;
        let inRect = null;
        if (tg) { const s = g.cameraController.worldToScreen(tg.x, tg.y || 0, tg.z), q = r.safeRect(); inRect = s.x >= q.x - 8 && s.x <= q.x + q.w + 8 && s.y >= q.y - 8 && s.y <= q.y + q.h + 8; }
        window.__f.push({ wall: performance.now(), t: w.time, rate: r.rate, on: r.scope.on, lens: !!(L?.scripted && M?.stats?.drawn), ring, aim: a && r.scope.on ? { dx: a.dx, dy: a.dy, R: a.R, locked: a.locked, tg: a.target } : null,
          hl: M?.stats?.target != null ? (w.enemies.find((e) => e.id === M.stats.target)?.tag ?? String(M.stats.target)) : null, ms: M?.stats?.ms ?? 0, cap: cap && !cap.hidden ? cap.dataset.step : null, inRect, speed: r.speedSetting });
      }
      if (window.__f.length > 200000) window.__f.splice(0, 100000);
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  const click = (sel) => page.locator(sel).click();
  // to step D2 (it starts at D1, the Sniper on the riverbank): the jump fast-forwards there
  const toD2 = async () => {
    await click('#wt-bar [data-act=chapters]');
    await click('#wt-menu [data-step="D2"]');
    await page.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay; return r?.isWalkthrough && r.doneCps.includes('D1') && !r.pacer.turbo; }, null, { timeout: 600000 });
  };
  await click('#wt-card [data-act=start]');
  await toD2();
  step('   D1 reached: the two shots in AUTO');
  const wall0 = await page.evaluate(() => performance.now());
  await page.waitForFunction(() => window.shadowSix.debug.mode.replay?.doneCps.includes('D3') && !window.shadowSix.debug.mode.replay.scope.on, null, { timeout: 600000 });
  await page.waitForTimeout(500);
  const A = await page.evaluate((w0) => ({ f: window.__f.filter((x) => x.wall >= w0), ev: window.__ev.filter((x) => x.wall >= w0), links: window.__links.filter((x) => x.wall >= w0),
    log: window.shadowSix.debug.mode.replay.scope.log }), wall0);

  /** The scope sequences in the frames: contiguous runs of frames with the scope up, with the shots fired in them. */
  const sequences = (F, ev) => {
    const out = [];
    let cur = null;
    for (const x of F) {
      if (x.on) { if (!cur) out.push((cur = { f: [] })); cur.f.push(x); } else cur = null;
    }
    for (const s of out) {
      s.w0 = s.f[0].wall; s.w1 = s.f[s.f.length - 1].wall;
      s.shots = ev.filter((e) => e.k === 'shot' && e.wall >= s.w0 - 1 && e.wall <= s.w1 + 20);
    }
    return out.filter((s) => s.shots.length);
  };
  const report = (tag, s) => {
    const sh = s.shots[0], pre = s.f.filter((x) => x.wall < sh.wall);
    const first = pre.filter((x) => x.aim);
    const R = first[0]?.aim.R || 36;
    let path = 0;
    for (let i = 1; i < first.length; i++) path += Math.hypot(first[i].aim.dx - first[i - 1].aim.dx, first[i].aim.dy - first[i - 1].aim.dy);
    const startOff = first.length ? Math.hypot(first[0].aim.dx, first[0].aim.dy) / R : 0;
    const atShot = pre[pre.length - 1];
    const locked = pre.filter((x) => x.aim?.locked);
    const lockedFor = locked.length ? (sh.wall - locked[0].wall) / 1000 : 0;
    const post = s.f.filter((x) => x.wall > sh.wall && x.wall < sh.wall + 300 && x.aim);
    const kick = post.length ? Math.min(...post.map((x) => x.aim.dy)) / R : 0;
    const lensShare = pre.length ? pre.filter((x) => x.lens && x.ring).length / pre.length : 0;
    const out = { preS: (sh.wall - s.w0) / 1000, totalS: (s.w1 - s.w0) / 1000, frames: s.f.length, startOff, pathR: path / R, lockedFor, atShot: atShot?.aim ? Math.hypot(atShot.aim.dx, atShot.aim.dy) / R : null,
      atShotLocked: !!atShot?.aim?.locked, hl: atShot?.hl ?? null, kick, lensShare, minRate: Math.min(...pre.map((x) => x.rate)), maxMs: Math.max(...s.f.map((x) => x.ms)),
      inRect: s.f.filter((x) => x.inRect === false).length, caps: [...new Set(s.f.map((x) => x.cap))], shots: s.shots.map((e) => e.tag) };
    t.log(`${tag}: ${JSON.stringify(out, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v))}`);
    return out;
  };

  step('3. what the scope did (AUTO)');
  t.log(`scope log: ${A.log.map((e) => `${e.kind}:${e.target}@${e.t.toFixed(2)}${e.why ? `(${e.why})` : ''}`).join(' ')}`);
  const seqA = sequences(A.f, A.ev);
  t(seqA.length === 1 && seqA[0].shots.length === 2, `one scope sequence for both shots (${seqA.length} sequence(s), shots ${seqA.map((s) => s.shots.map((e) => e.tag).join('+')).join(' | ')})`);
  const sA = seqA[0];
  if (sA) {
    const r1 = report('AUTO e4', sA);
    t(r1.preS >= 1.2 && r1.preS <= 2.6, `the scope is up ${r1.preS.toFixed(2)} s of wall time before the first shot (AUTO: ~1.5 s)`);
    t(r1.lensShare >= 0.9, `the real lens and its ring are drawn meanwhile (${(r1.lensShare * 100).toFixed(0)} % of the frames)`);
    t(r1.startOff >= 1.5 && r1.pathR >= 3, `it starts off the man (${r1.startOff.toFixed(1)} glass radii) and searches round him (a ${r1.pathR.toFixed(1)}-radius sweep)`);
    t(r1.atShotLocked && r1.atShot < 0.45 && r1.lockedFor >= 0.3, `settled on him a beat before the shot (${r1.lockedFor.toFixed(2)} s on him; ${r1.atShot?.toFixed(2)} radii off at the shot)`);
    t(r1.hl === 'e4', `the lens marks the man it is on, as a valid shot under the player's scope (${r1.hl})`);
    t(r1.kick <= -0.35, `the recoil throws the view up (${r1.kick.toFixed(2)} radii)`);
    t(r1.inRect === 0, `the man stays in the free part of the view (${r1.inRect} frames out)`);
    t(r1.caps.every((c) => c === 'D2' || c === 'D3' || c === 'D1'), `the caption stays on the steps (${r1.caps})`);
    // the second man: the scope swings to him from the first, settles, fires; then it comes down
    const sh2 = sA.shots[1];
    const between = sA.f.filter((x) => x.wall > sA.shots[0].wall && x.wall < sh2.wall);
    t(between.length > 10 && between.every((x) => x.on), 'the scope stays up between the two shots');
    const pre2 = between.filter((x) => x.aim?.tg === 'e5');
    const sw0 = pre2.length ? Math.hypot(pre2[0].aim.dx, pre2[0].aim.dy) / pre2[0].aim.R : 0;
    t(pre2.length > 5 && sw0 > 2 && pre2[pre2.length - 1].aim.locked, `then swings from e4 to e5 (${sw0.toFixed(1)} radii) and settles on him (${pre2.length} frames)`);
    t(sA.f[sA.f.length - 1].wall - sh2.wall > 300, `the scope comes down after the second shot (${((sA.f[sA.f.length - 1].wall - sh2.wall) / 1000).toFixed(2)} s on)`);
    t(r1.totalS < 7, `the whole sequence ${r1.totalS.toFixed(2)} s of wall time`);
  }
  const scopeLinks = A.links.filter((l) => /scope-magnifier|walkthrough-scope/.test(l.st));
  t.log(`programs linked from D1 to D3: ${A.links.length}${A.links.length ? ` (${A.links.slice(0, 4).map((l) => l.st.slice(0, 160)).join(' || ')})` : ''}`);
  t(scopeLinks.length === 0, `no scope program linked while it is up (${scopeLinks.length})`);
  const shotsA = A.ev.filter((e) => e.k === 'shot');
  const same = (got) => got.length === 2 && got.every((e, i) => e.tag === ref.shots[i].tag && Math.abs(e.t - ref.shots[i].t) < 1e-6);
  t(same(shotsA), `the shots at the scripted run's ticks (${shotsA.map((e, i) => `${e.tag} ${e.t.toFixed(4)} vs ${ref.shots[i]?.t.toFixed(4)}`).join(', ')})`);
  await t.shot('debug-walkthrough-scope-auto');

  step('4. 4× (a jump back: reload, fast-forward): shorter, still there');
  await click('#wt-bar [data-act="speed-4"]');
  const wall1 = await page.evaluate(() => performance.now());
  await page.evaluate(() => { window.__w0 = window.shadowSix.world; });
  await click('#wt-bar [data-act=chapters]');
  await click('#wt-menu [data-step="D2"]');
  await page.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay; return r?.isWalkthrough && window.shadowSix.world !== window.__w0 && r.doneCps.includes('D1') && !r.pacer.turbo; }, null, { timeout: 600000 });
  await page.waitForFunction(() => window.shadowSix.debug.mode.replay?.doneCps.includes('D3') && !window.shadowSix.debug.mode.replay.scope.on, null, { timeout: 600000 });
  await page.waitForTimeout(500);
  const B = await page.evaluate((w0) => ({ f: window.__f.filter((x) => x.wall >= w0), ev: window.__ev.filter((x) => x.wall >= w0) }), wall1);
  const seqB = sequences(B.f.filter((x) => x.speed === 4), B.ev);
  t.log(`4×: shots ${B.ev.filter((e) => e.k === 'shot').map((e) => `${e.tag}@${e.t.toFixed(3)}/${(e.wall - wall1).toFixed(0)}ms`).join(' ')}; sequences ${seqB.map((q) => `[${(q.w0 - wall1).toFixed(0)}-${(q.w1 - wall1).toFixed(0)} ms: ${q.shots.map((e) => e.tag)}]`).join(' ')}; frames ${B.f.length} (speeds ${[...new Set(B.f.map((x) => x.speed))]})`);
  t(seqB.length >= 1 && seqB.reduce((n, s) => n + s.shots.length, 0) === 2, `4×: the scope before both shots (${seqB.length} sequence(s))`);
  if (seqB[0]) {
    const r4 = report('4x e4', seqB[0]);
    t(r4.preS >= 0.6 && r4.preS <= 1.4, `4×: up ${r4.preS.toFixed(2)} s before the first shot (0.6 s of game at 4× would be 0.15 s)`);
    t(r4.lensShare >= 0.85 && r4.atShotLocked, `4×: the lens drawn (${(r4.lensShare * 100).toFixed(0)} %), on him at the shot`);
  }
  const shotsB = B.ev.filter((e) => e.k === 'shot');
  t(same(shotsB), `4×: the shots at the scripted run's ticks (${shotsB.map((e) => `${e.tag} ${e.t.toFixed(4)}`).join(', ')})`);

  step('4b. a scrub across both shots (back to D1, then ahead past them): no scope, the same ticks');
  await click('#wt-bar [data-act="speed-auto"]');
  await page.evaluate(() => { window.__w0 = window.shadowSix.world; });
  await click('#wt-bar [data-act=chapters]');
  await click('#wt-menu [data-step="D2"]');
  await page.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay; return r?.isWalkthrough && window.shadowSix.world !== window.__w0 && r.doneCps.includes('D1') && !r.pacer.turbo; }, null, { timeout: 600000 });
  const wall2 = await page.evaluate(() => performance.now());
  const t2 = ref.shots[1].t + 2;
  // (from D1 straight ahead to 2 s past the second shot: the wait and both shots fast-forwarded)
  const upEarly = await page.evaluate((tt) => { const r = window.shadowSix.debug.mode.replay, on = r.scope.on; r.seekTo(tt); return on; }, t2);
  await page.waitForFunction((tt) => { const r = window.shadowSix.debug.mode.replay; return r && r._seekT == null && !r.pacer.turbo && window.shadowSix.world.time >= tt - 0.05; }, t2, { timeout: 600000 });
  await page.waitForTimeout(800);
  const C = await page.evaluate((w0) => ({ f: window.__f.filter((x) => x.wall >= w0), ev: window.__ev.filter((x) => x.wall >= w0 && x.k === 'shot'), on: window.shadowSix.debug.mode.replay.scope.on,
    log: window.shadowSix.debug.mode.replay.scope.log.filter((e) => e.wall >= w0).map((e) => e.kind), ring: !!window.shadowSix.hud.cursor.root.classList.contains('scripted') }), wall2);
  t.log(`scrub: shots ${C.ev.map((e) => `${e.tag}@${e.t.toFixed(4)}`).join(' ')}; scope log ${C.log.join(',') || '(none)'}; up before the scrub ${upEarly}`);
  t(same(C.ev), 'scrubbed through: the shots at the scripted run\'s ticks');
  t(!upEarly && C.log.length === 0, `no scope while the scrub fast-forwards through the shots (${C.log.join(',') || 'none'})`);
  t(!C.on && !C.ring, 'nothing of it left on screen where the scrub lands');

  step('5. on to the end: the scripted run, checkpoint for checkpoint');
  await page.evaluate(() => { window.__end = null; window.shadowSix.events.on('debug:walkthrough-end', (r) => { if (r.outcome !== 'stopped') window.__end = r; }); });
  await click('#wt-bar [data-act=chapters]');
  await click('#wt-menu [data-chapter="L"]');
  await page.waitForFunction(() => !!window.__end, null, { timeout: 900000 });
  const run = await page.evaluate(() => window.__end);
  const marks = run.marks.map((m) => ({ name: m.name.split(' ')[0], t: m.t }));
  t.log(`walkthrough: ${run.outcome} ${run.state} t=${run.time.toFixed(2)} checkpoints=${marks.length}`);
  t.equal(run.state, 'won', 'M2 won');
  t.equal(marks.map((m) => m.name).join(' '), ref.marks.map((m) => m.name).join(' '), 'the same checkpoints, in the same order');
  const off = marks.filter((m, i) => !(Math.abs(m.t - (ref.marks[i]?.t ?? NaN)) < 1e-6));
  t(off.length === 0, `every checkpoint at the same game time (${off.slice(0, 5).map((m) => `${m.name} ${m.t.toFixed(3)}`).join(', ') || 'all equal'})`);
  t(Math.abs(run.time - ref.time) < 1e-6, `the same end time (${run.time.toFixed(3)} vs ${ref.time.toFixed(3)})`);

  step('6. a phone, portrait: the scope shows on a touch screen too');
  const ctx = await t.harness.browser.newContext({ ...DEVICES['Pixel 7'] });
  const errs = [];
  try {
    const ph = await ctx.newPage();
    ph.setDefaultTimeout(600000);
    ph.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e.message).slice(0, 300)));
    ph.on('console', (m) => { if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errs.push('console.error: ' + m.text().slice(0, 300)); });
    await ph.goto(`${url}/index.html?debug&preset=low&walkthrough=m02&speed=auto`);
    await ph.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]') && window.shadowSix?.debug?.mode?.replay?.isWalkthrough, null, { timeout: 300000 });
    await ph.locator('#wt-card [data-act=start]').tap();
    if (await ph.evaluate(() => !!document.querySelector('.rot-hint') && !document.querySelector('.rot-hint').hidden)) {
      await ph.locator('.rot-hint .rot-ok').tap();
      await ph.waitForFunction(() => document.querySelector('.rot-hint').hidden);
    }
    await ph.locator('#wt-bar [data-act=chapters]').tap();
    await ph.locator('#wt-menu [data-step="D2"]').tap();
    await ph.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay; return r?.isWalkthrough && r.doneCps.includes('D1') && !r.pacer.turbo; }, null, { timeout: 600000 });
    // the scope up and on the man (the reticle within half a glass radius of him), as the first shot nears
    await ph.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay, a = r?.scope.aim; return r?.scope.on && a?.locked && r.scope.seg?.fired == null; }, null, { timeout: 300000 });
    const m = await ph.evaluate(() => {
      const g = window.shadowSix, r = g.debug.mode.replay, cur = g.hud.cursor;
      const R = (n) => { if (!n) return null; const cs = getComputedStyle(n); if (n.hidden || cs.display === 'none' || cs.visibility === 'hidden') return null; const b = n.getBoundingClientRect(); return b.width && b.height ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
      const ring = R(cur.lens?.root), bar = R(document.getElementById('wt-bar')), cap = R(document.getElementById('wt-cap'));
      const q = r.safeRect();
      return { touch: document.documentElement.classList.contains('mk-touch'), ring, bar, cap, drawn: !!g.scopeMagnifier?.stats.drawn, rect: q, vw: innerWidth, vh: innerHeight,
        sw: document.documentElement.scrollWidth, minBtn: Math.min(...[...document.querySelectorAll('#wt-bar button')].filter((b) => !b.hidden).map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))) };
    });
    t.log(`phone: ${JSON.stringify(m)}`);
    const cx = m.ring ? (m.ring.l + m.ring.r) / 2 : -1, cy = m.ring ? (m.ring.t + m.ring.b) / 2 : -1;
    t(m.touch && m.ring && m.drawn, `phone: the scope's ring and lens are drawn on the touch screen (${JSON.stringify(m.ring)})`);
    t(cx >= m.rect.x && cx <= m.rect.x + m.rect.w && cy >= m.rect.y && cy <= m.rect.y + m.rect.h, `phone: on the man, in the free part of the screen (${cx.toFixed(0)}, ${cy.toFixed(0)} in ${JSON.stringify(m.rect)})`);
    t(m.bar && m.cap && m.bar.l >= 0 && m.bar.r <= m.vw && m.cap.b <= m.vh && m.sw <= m.vw && m.minBtn >= 44, 'phone: the bar and the caption still fit, finger-sized buttons, no sideways scroll');
    await ph.screenshot({ path: t.harness.shotPath('debug-walkthrough-scope-phone.png') });
    await ph.waitForFunction(() => window.shadowSix.debug.mode.replay?.doneCps.includes('D3') && !window.shadowSix.debug.mode.replay.scope.on, null, { timeout: 300000 });
    const after = await ph.evaluate(() => { const cur = window.shadowSix.hud.cursor; return { cls: cur.root.className, disp: getComputedStyle(cur.root).display }; });
    t(after.disp === 'none' && !/scripted/.test(after.cls), `phone: the scope gone after the shots, the soft cursor hidden again (${JSON.stringify(after)})`);
    t(errs.length === 0, `phone: no page errors${errs.length ? ':\n  ' + errs.slice(0, 5).join('\n  ') : ''}`);
  } finally {
    await ctx.close().catch(() => {});
  }
}
