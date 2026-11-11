/**
 * LIGHTS OUT shell (docs/expansion/STATUS.md "Mission registration contract"; our own expansion campaign, code id
 * 'BCD'), in the real front end. First with the missions registered so far (none until the builders land theirs):
 * NEW GAME → SINGLE PLAYER → the campaign choice with LIGHTS OUT's night print and typed card; the LIGHTS OUT card
 * (START CAMPAIGN IN PREPARATION without mission 1); MISSION SELECT on the LIGHTS OUT tab (registered pins only, the
 * empty slots on a typed slip; [ and a click switch tabs in place); a fresh LIGHTS OUT career at Major beside the BEL
 * one. Then fake missions registered in the page (slots 1 and 2, where no real mission is): START CAMPAIGN → SKILL
 * (Easy) → mission 1's briefing → playing for 20 s under the BCD ruleset and its Easy data, game.flow the LIGHTS OUT
 * career; a win unlocks mission 2 (next / continue follow the campaign); the PASSWORD screen takes a LIGHTS OUT code,
 * a BEL code, and names a LIGHTS OUT slot still in preparation.
 * LIGHTS_OUT_SHOTS=<dir> also saves the menu shots there.
 */
const SHOTS = process.env.LIGHTS_OUT_SHOTS || '';

/** A small mission for the in-page registration (never shipped). */
const FAKE = {
  id: 'e01', campaign: 'BCD', number: 1, title: 'Test Drop', subtitle: 'Registry test map', place: 'A test quay, Liguria, Italy',
  date: '1943-10-02', pin: { lat: 44.4, lon: 8.9 }, context: 'A test mission that proves the registry: a quay, a hut and one sentry far off.',
  theater: 'temperate', size: [48, 48], seed: 4401, baseTerrain: 'grass',
  briefing: { historical: 'October 1943. A quiet quay, a hut and one sentry: the registry test.', text: 'Walk the team to the extraction point.', objectivesSummary: 'Reach the extraction point.' },
  structures: [{ type: 'hut', id: 'hut_a', x: 30, z: 30, rot: 0 }],
  commandos: [{ role: 'greenberet', x: 8, z: 40, heading: 0 }, { role: 'sniper', x: 10, z: 42, heading: 0 }],
  enemies: [{ id: 'sentry_a', soldierType: 'sentry', x: 42, z: 8, heading: 0, post: { heading: 0, sweep: 0 } }],
  objectives: [{ id: 'escape', text: 'Reach the extraction point with every commando', type: 'escape', required: true }],
  extraction: { x: 6, z: 6, r: 3 },
  cameraStart: { x: 10, z: 38 },
  par: { time: 300 },
  variants: { easy: { par: { time: 360 }, routeSpeedMul: 0.8, pauseMul: 2.5 }, hard: { par: { time: 300 } } },
};

const key = (page, code) => page.evaluate((c) => {
  const named = { Escape: 'Escape', Enter: 'Enter', BracketLeft: '[', BracketRight: ']' };
  const k = named[c] || (c.startsWith('Arrow') ? c : c.replace(/^(Key|Digit)/, '').toLowerCase());
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: k, bubbles: true, cancelable: true }));
  window.__game.render();
}, code);

const card = (page) => page.evaluate(() => {
  const c = document.querySelector('.mk-host .mk-card');
  const kit = window.__game.game.hud.kit;
  return c && {
    id: c.dataset.card,
    title: c.querySelector('.mk-title')?.textContent || '',
    rows: [...c.querySelectorAll('.mk-list .mk-row')].map((b) => ({ label: b.querySelector('.mk-label').textContent, off: b.getAttribute('aria-disabled') === 'true' })),
    focus: kit.top?.focus,
    note: c.querySelector('.mk-note')?.textContent || '',
    detail: c.querySelector('.mk-detail.on')?.textContent || '',
    art: !!c.querySelector('.mk-detail.on .mk-lo-print svg'),
  };
});

/** Activate the top card's row labelled `label` (a click / Enter on it). */
const pick = (page, label) => page.evaluate((l) => {
  const kit = window.__game.game.hud.kit;
  const i = kit.top.rows.findIndex((r) => r.label === l);
  kit.focus(i);
  kit.activate(i);
  window.__game.render();
  return i;
}, label);

const table = (page) => page.evaluate(() => {
  const cc = document.querySelector('.mk-host .mk-card.mk-maptable');
  return cc && {
    on: cc.querySelector('.mk-tabbtn.on')?.dataset.campaign, tabs: [...cc.querySelectorAll('.mk-tabbtn')].map((b) => b.textContent),
    pins: [...cc.querySelectorAll('.mk-mapsheet .mk-pin')].map((b) => b.dataset.id), slip: cc.querySelector('.mk-prepslip')?.textContent || '',
    card: cc.querySelector('.mk-mapcard')?.textContent || '', depth: window.__game.game.hud.kit.stack.length,
  };
});

const registry = (page) => page.evaluate(async () => {
  const R = await import('/src/missions/expansion/registry.js');
  return { ready: R.expansionMissions().length, slot1: !!R.expansionMission(1), ids: R.expansionMissions().map((d) => d.id) };
});

export const timeout = 240_000;

export default async function lightsOutShell(page, t) {
  const shot = async (name) => {
    await t.shot(name);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  };
  const ready = (n) => new RegExp(`${n} OF 8\\s*READY`);
  let reg = await registry(page);
  t.log(`registered LIGHTS OUT missions: ${reg.ids.join(', ') || 'none'}`);

  // ---- MAIN → NEW GAME → SINGLE PLAYER (keys, as a player)
  await page.evaluate(() => window.__game.game.hud.screens.openMain());
  await page.waitForFunction(() => window.__game.game.hud.backdrop.embossReady, null, { timeout: 15000 }).catch(() => {});
  await key(page, 'Enter'); // NEW GAME
  await key(page, 'Enter'); // SINGLE PLAYER
  let c = await card(page);
  t.equal(c.title, 'SINGLE PLAYER');
  t.equal(c.rows.map((r) => r.label).join('|'), 'BEHIND ENEMY LINES|LIGHTS OUT|EXIT', 'the campaign choice');
  t(c.rows.every((r) => !r.off), 'both campaigns open');
  t.equal(c.focus, 0, 'BEHIND ENEMY LINES focused first');
  t(!c.art, 'no print beside BEHIND ENEMY LINES');
  await key(page, 'ArrowDown');
  c = await card(page);
  t(c.art, 'LIGHTS OUT focused: its night print in the detail pane');
  t(/8 MISSIONS · 1943–1945/.test(c.detail) && /CAREER STARTS AT MAJOR/.test(c.detail) && ready(reg.ready).test(c.detail), `the typed card: ${c.detail}`);
  t(!/call of duty/i.test(await page.evaluate(() => document.body.textContent)), 'the 1999 title is nowhere on the page');
  await page.waitForTimeout(450); // the pane's fade-in
  await shot('menu-campaign-choice');

  // ---- the LIGHTS OUT card
  await key(page, 'Enter');
  c = await card(page);
  t.equal(c.title, 'LIGHTS OUT');
  const start = c.rows.find((r) => r.label === 'START CAMPAIGN');
  t(start && start.off === !reg.slot1, `START CAMPAIGN ${reg.slot1 ? 'open: mission 1 is registered' : 'in preparation: mission 1 is not registered yet'}`);
  t(c.rows.some((r) => r.label === 'MISSION SELECT' && !r.off) && c.rows.at(-1).label === 'EXIT', 'MISSION SELECT, EXIT');
  t(!c.rows.some((r) => /^CONTINUE/.test(r.label)), 'no CONTINUE on a fresh career');
  t(c.art && ready(reg.ready).test(c.detail), `the print and ${reg.ready} OF 8 READY`);
  if (!reg.slot1) {
    await pick(page, 'START CAMPAIGN');
    c = await card(page);
    t.equal(c.note, 'IN PREPARATION', 'START CAMPAIGN says IN PREPARATION');
    t.equal(c.title, 'LIGHTS OUT', '… and opens nothing');
  }
  await page.waitForTimeout(450);
  await shot('menu-lights-out-card');

  // ---- MISSION SELECT: the map table on the LIGHTS OUT tab
  await pick(page, 'MISSION SELECT');
  await page.waitForTimeout(150);
  let mt = await table(page);
  t.equal(mt?.on, 'BCD', 'the map table opens on the LIGHTS OUT tab');
  t.equal(mt.tabs.join('|'), 'BEHIND ENEMY LINES|LIGHTS OUT', 'tabs');
  t.equal(mt.pins.join(), reg.ids.join(), 'registered pins only');
  if (reg.ready < 8) t(/IN PREPARATION/.test(mt.slip) && new RegExp(`${reg.ready} OF 8 READY`).test(mt.slip), `the slip: ${mt.slip}`);
  if (!reg.ready) t(/0 OF 8 READY/.test(mt.card) && /MISSIONS 1–8/.test(mt.card), `the typed card: ${mt.card}`);
  await page.waitForTimeout(500); // the sheet's slide-in
  await shot('menu-maptable-lights-out');
  const depth = mt.depth;
  await key(page, 'BracketLeft');
  await page.waitForTimeout(150);
  mt = await table(page);
  t.equal(mt.on, 'BEL', '[ switches to BEHIND ENEMY LINES');
  t.equal(mt.pins.length, 20, 'the twenty BEL pins');
  t.equal(mt.depth, depth, 'a tab switch swaps the card in place');
  await page.evaluate(() => document.querySelector('.mk-host .mk-card.mk-maptable .mk-tabbtn[data-campaign="BCD"]').click());
  await page.waitForTimeout(150);
  mt = await table(page);
  t.equal(mt.on, 'BCD', 'a click on the LIGHTS OUT tab switches back');
  t.equal(mt.pins.join(), reg.ids.join());
  await key(page, 'Escape');
  t.equal((await card(page)).title, 'LIGHTS OUT', 'Esc: back to the LIGHTS OUT card');

  // ---- two careers: LIGHTS OUT a fresh Major beside the untouched BEL one; the menus do not switch the active one
  const career = await page.evaluate(() => {
    const G = window.__game.game, f = G.flows.BCD;
    return { gold: f.gold, rank: f.rankName, diff: f.difficulty, bel: G.flows.BEL.gold, active: G.flow.campaign, same: G.flows.BEL === f };
  });
  t.log(JSON.stringify(career));
  t(career.gold === 36 && career.rank === 'Major' && career.diff === 'hard', 'a fresh LIGHTS OUT career: Major, 36 gold, Hard until a Skill is picked');
  t(career.bel === 0 && career.active === 'BEL' && !career.same, 'the BEL career beside it, still the active one');

  // ---- fake missions registered in the page (slots 1 and 2 when free): Skill → briefing → playing
  const fake = await page.evaluate(async (def) => {
    const R = await import('/src/missions/expansion/registry.js');
    const added = [];
    if (!R.expansionMission(1)) { R.registerExpansionMission({ ...def }); added.push('e01'); }
    if (!R.expansionMission(2)) { R.registerExpansionMission({ ...def, id: 'e02', number: 2, title: 'Test Drop Two', date: '1943-11-20', pin: { lat: 46.5, lon: 11.3 } }); added.push('e02'); }
    const { MISSIONS, CAMPAIGNS } = await import('/src/missions/index.js');
    const { normalizeMission } = await import('/src/missions/schema.js');
    const [m1, m2] = [R.expansionMission(1), R.expansionMission(2)]; // the fakes, or real missions already in those slots
    return { added, inMissions: MISSIONS.some((m) => m.id === 'e01'), bcd: CAMPAIGNS.BCD.map((m) => m.id), flow: window.__game.game.flows.BCD.missions.map((m) => m.id),
      context1: m1.context, easyPar1: normalizeMission(m1, { difficulty: 'easy', quiet: true }).par.time, title2: m2.title };
  }, FAKE);
  t.log(JSON.stringify(fake));
  t(fake.inMissions && fake.bcd.includes('e01') && fake.flow.join() === fake.bcd.join(), 'a registered mission reaches MISSIONS, CAMPAIGNS.BCD and the LIGHTS OUT career');
  reg = await registry(page);
  await page.evaluate(() => { const s = window.__game.game.hud.screens; s.kit.close(); s.openMain(); s.openNewGame(); s.openSinglePlayer(); s.openLightsOut(); });
  c = await card(page);
  t(c.rows.some((r) => r.label === 'START CAMPAIGN' && !r.off), 'mission 1 registered: START CAMPAIGN opens');
  t(ready(reg.ready).test(c.detail), `${reg.ready} OF 8 READY`);
  await pick(page, 'START CAMPAIGN');
  c = await card(page);
  t.equal(c.title, 'SKILL', 'START CAMPAIGN → the Skill screen');
  t.equal(c.rows.map((r) => r.label).join('|'), 'EASY — FOR ROOKIES|DIFFICULT — FOR VETERANS', 'Easy / Difficult');
  await page.waitForTimeout(400);
  await shot('menu-skill');
  await pick(page, 'EASY — FOR ROOKIES');
  await page.waitForFunction(() => window.__game.game.state === 'briefing' && window.__game.game.missionDef?.id === 'e01', null, { timeout: 60000 });
  await page.waitForFunction(() => /part1/.test(document.querySelector('.ui-briefing')?.className || '') && !!document.querySelector('.ui-briefing .text p'), null, { timeout: 30000 });
  const br = await page.evaluate(() => {
    const G = window.__game.game, b = document.querySelector('.ui-briefing');
    return { title: b?.querySelector('.title')?.getAttribute('aria-label'), active: G.flow.campaign, bcd: G.flow === G.flows.BCD, diff: G.difficulty, defDiff: G.missionDef.difficulty,
      par: G.missionDef.par.time, rules: G.world.rules.id, skill: G.flows.BCD.difficulty, paras: [...(b?.querySelectorAll('.text p') || [])].map((p) => p.textContent) };
  });
  t.log(JSON.stringify(br));
  t(br.bcd && br.active === 'BCD', 'starting a LIGHTS OUT mission makes its career game.flow');
  t(br.skill === 'easy' && br.diff === 'easy' && br.defDiff === 'easy' && br.par === fake.easyPar1, 'the Skill pick is stored and builds the Easy data');
  t.equal(br.rules, 'BCD', 'the BCD ruleset');
  t(br.paras.some((p) => p === fake.context1), 'the briefing opens with the def\'s context');
  await key(page, 'Escape');
  await key(page, 'Escape');
  t.equal(await page.evaluate(() => window.__game.game.state), 'playing', 'briefing → playing');
  const run = await page.evaluate(() => { const g = window.__game; g.advance(20); g.render(); return g.state(); });
  t(run.state === 'playing' && run.time >= 19.9, `20 s of play (state ${run.state}, t ${run.time})`);

  // ---- a win: mission 2 unlocks; next / continue / LAST OPERATION follow the LIGHTS OUT career
  const win = await page.evaluate(() => {
    const G = window.__game.game, hud = G.hud;
    const out = G.flow.onMissionEnd(true, G.world, G.missionDef);
    const next = hud.nextMissionId();
    hud.quitToTitle();
    return { password: out.password, next, cont: hud.screens.nextMission()?.id, gold: G.flows.BCD.gold, bel: G.flows.BEL.gold };
  });
  t.log(JSON.stringify(win));
  t(win.next === 'e02' && win.cont === 'e02', 'next mission and CONTINUE: LIGHTS OUT mission 2');
  t(win.gold > 36 && win.bel === 0, 'the gold goes to the LIGHTS OUT career only');
  await page.evaluate(() => { const s = window.__game.game.hud.screens; s.openMain(); s.openLightsOut(); });
  c = await card(page);
  t((c.rows[0]?.label || '').startsWith(`CONTINUE — MISSION 2: ${fake.title2.toUpperCase()}`), `CONTINUE on the LIGHTS OUT card (${c.rows[0]?.label})`);

  // ---- PASSWORD: a LIGHTS OUT code, a BEL code, a LIGHTS OUT slot in preparation
  const typed = async (code) => {
    const r = await page.evaluate(async (k) => {
      const hud = window.__game.game.hud;
      const started = [];
      hud.startMission = (id) => { started.push(id); return Promise.resolve(); };
      hud.kit.close();
      hud.screens.openPassword();
      hud.screens.pw.set(k);
      hud.kit.top.spec.onKey({ code: 'Enter' });
      const note = document.querySelector('.mk-host .mk-card .mk-note').textContent;
      await new Promise((res) => setTimeout(res, 700));
      delete hud.startMission; // the prototype's again
      return { note, started };
    }, code);
    return r;
  };
  let r = await typed(win.password);
  t(/^LIGHTS OUT · MISSION 2 — /.test(r.note) && r.started.join() === 'e02', `a LIGHTS OUT code opens LIGHTS OUT mission 2 (${r.note})`);
  const codes = await page.evaluate(async () => {
    const { encodePassword } = await import('/src/core/passwords.js');
    const R = await import('/src/missions/expansion/registry.js');
    const empty = [3, 4, 5, 6, 7, 8].find((n) => !R.expansionMission(n));
    return { bel: encodePassword('BEL', 5, 2, 1), empty, lo: empty ? encodePassword('BCD', empty, 0, 6) : null };
  });
  r = await typed(codes.bel);
  t(/^MISSION 5 — /.test(r.note) && r.started.join() === 'm05', `a BEL code opens BEL mission 5 (${r.note})`);
  t.equal(await page.evaluate(() => window.__game.game.flows.BEL.unlocked('m05')), true, 'the BEL career took it');
  if (codes.lo) {
    r = await typed(codes.lo);
    t(r.note === `LIGHTS OUT MISSION ${codes.empty} — IN PREPARATION` && !r.started.length, `a LIGHTS OUT code for an empty slot (${r.note})`);
  }

  // ---- clean up the page's fakes
  await page.evaluate(async (ids) => {
    const R = await import('/src/missions/expansion/registry.js');
    for (const id of ids) R.unregisterExpansionMission(id);
    window.__game.game.hud.kit.close();
  }, fake.added);
}
