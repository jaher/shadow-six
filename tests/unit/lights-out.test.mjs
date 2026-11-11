/**
 * LIGHTS OUT shell (docs/expansion/STATUS.md "Mission registration contract"): our own expansion campaign (code id
 * 'BCD') fills eight slots e01 … e08 through src/missions/expansion/registry.js. A registered def reaches MISSIONS /
 * CAMPAIGNS.BCD, the ?debug grouping, the menus (catalogue, map-table slots, the LIGHTS OUT card) and the career; a
 * slot nobody filled stays IN PREPARATION. The BCD career starts at Major (+24 max), keeps its Skill, and the active
 * flow follows the campaign of the mission started last.
 */
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { CONFIG } from '../../src/config.js';
import { EventBus } from '../../src/core/events.js';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import {
  EXPANSION_SLOTS, slotId, expansionDefErrors, registerExpansionMission, unregisterExpansionMission, expansionMissions,
  expansionMission, expansionSlots,
} from '../../src/missions/expansion/registry.js';
import { validateMission, normalizeMission } from '../../src/missions/schema.js';
import { groupMissions, levelOrder, neighbourLevel, GROUPS } from '../../src/debug/debug-options.js';
import { CAMPAIGN_TABS, catalogueEntry, catalogueFor, expansionCatalogue } from '../../src/ui/catalogue.js';
import { briefingHeadline, briefingParagraphs } from '../../src/ui/briefing-text.js';
import { MapTable, missingSlots, prepList } from '../../src/ui/map-table.js';
import { Screens } from '../../src/ui/screens.js';
import { Flow } from '../../src/core/flow.js';
import { rankIndex, partialStars } from '../../src/core/scoring.js';
import { encodePassword } from '../../src/core/passwords.js';
import { Game } from '../../src/game.js';

/** A small, valid LIGHTS OUT def for slot n (never shipped: the tests register and unregister it). */
function fakeDef(n, extra = {}) {
  return {
    id: slotId(n), campaign: 'BCD', number: n, title: `Test Drop ${n}`, subtitle: 'Registry test', place: 'A test quay, Italy',
    date: `1944-0${Math.min(9, n)}-1${n % 10}`, pin: { lat: 42 + n, lon: 9 + n }, context: 'A test mission that proves the registry.',
    theater: 'temperate', size: [40, 40], seed: 900 + n, baseTerrain: 'grass',
    briefing: { text: 'Walk to the extraction point.', objectivesSummary: 'Reach the extraction point.' },
    commandos: [{ role: 'greenberet', x: 6, z: 34, heading: 0 }],
    enemies: [{ id: 'sentry_a', soldierType: 'sentry', x: 34, z: 6, heading: Math.PI, post: { heading: Math.PI, sweep: 0 } }],
    objectives: [{ id: 'escape', text: 'Reach the extraction point with every commando', type: 'escape', required: true }],
    extraction: { x: 6, z: 6, r: 3 },
    par: { time: 300 },
    variants: { easy: { par: { time: 360 }, routeSpeedMul: 0.8, pauseMul: 2.5 }, hard: { par: { time: 300 } } },
    ...extra,
  };
}

/** Register fake defs in the given free slots for the length of `fn`, then take them out again. */
async function withRegistered(slots, fn) {
  const defs = slots.map((n) => fakeDef(n));
  for (const d of defs) registerExpansionMission(d);
  try {
    return await fn(defs);
  } finally {
    for (const d of defs) unregisterExpansionMission(d.id);
  }
}

const freeSlots = () => expansionSlots().filter((s) => !s.ready).map((s) => s.n);

test('LIGHTS OUT: eight slots e01 … e08; a slot is ready exactly when a def is registered in it', () => {
  assert.equal(EXPANSION_SLOTS, 8);
  const slots = expansionSlots();
  assert.deepEqual(slots.map((s) => s.id), ['e01', 'e02', 'e03', 'e04', 'e05', 'e06', 'e07', 'e08']);
  for (const s of slots) assert.equal(s.ready, !!expansionMission(s.n), s.id);
  assert.deepEqual(expansionMissions().map((d) => d.number), [...expansionMissions().map((d) => d.number)].sort((a, b) => a - b), 'number order');
});

test('LIGHTS OUT: every registered mission keeps the contract and passes validateMission strictly (Easy and Hard)', () => {
  for (const d of expansionMissions()) {
    assert.deepEqual(expansionDefErrors(d, expansionMissions().filter((x) => x !== d)), [], d.id);
    for (const difficulty of ['easy', 'hard']) {
      const v = normalizeMission(d, { strict: true, difficulty }); // throws on any error or warning
      assert.equal(v.campaign, 'BCD');
      const { errors, warnings } = validateMission(d);
      assert.deepEqual([...errors, ...warnings], [], `${d.id} ${difficulty}`);
    }
  }
});

test('LIGHTS OUT registry: the contract refuses a bad id, campaign, number, menu info, variants and a taken slot', () => {
  const ok = fakeDef(3);
  assert.deepEqual(expansionDefErrors(ok, []), []);
  const bad = (patch) => expansionDefErrors({ ...ok, ...patch }, []);
  assert.ok(bad({ id: 'e09' }).some((e) => /e01 … e08/.test(e)));
  assert.ok(bad({ id: 'm03' }).some((e) => /e01 … e08/.test(e)));
  assert.ok(bad({ campaign: 'BEL' }).some((e) => /campaign must be 'BCD'/.test(e)));
  assert.ok(bad({ number: 4 }).some((e) => /does not match number 4/.test(e)));
  assert.ok(bad({ number: 9 }).some((e) => /number must be/.test(e)));
  assert.ok(bad({ dev: true }).some((e) => /dev/.test(e)));
  assert.ok(bad({ title: '' }).some((e) => /title/.test(e)));
  assert.ok(bad({ place: undefined }).some((e) => /place/.test(e)));
  assert.ok(bad({ context: ' ' }).some((e) => /context/.test(e)));
  assert.ok(bad({ date: 'Jul 9, 1943' }).some((e) => /ISO/.test(e)));
  assert.ok(bad({ pin: { lat: 45 } }).some((e) => /pin/.test(e)));
  assert.ok(bad({ variants: { easy: {} } }).some((e) => /variants/.test(e)));
  assert.ok(expansionDefErrors(fakeDef(3), [ok]).some((e) => /already taken/.test(e)), 'a slot holds one mission');
  assert.throws(() => registerExpansionMission({ ...ok, id: 'e3' }), /cannot register mission e3/);
});

test('LIGHTS OUT registry: a registered def joins MISSIONS and CAMPAIGNS.BCD in number order; unregistering removes it', async () => {
  const free = freeSlots();
  if (free.length < 2) return; // every slot built: the shipped missions above prove the same path
  const pick = [free[free.length - 1], free[0]]; // registered out of order on purpose
  const before = MISSIONS.length;
  await withRegistered(pick, (defs) => {
    assert.equal(MISSIONS.length, before + 2);
    for (const d of defs) {
      assert.equal(getMission(d.id), d);
      assert.ok(CAMPAIGNS.BCD.includes(d), `${d.id} in CAMPAIGNS.BCD`);
    }
    const nums = CAMPAIGNS.BCD.map((d) => d.number);
    assert.deepEqual(nums, [...nums].sort((a, b) => a - b), 'CAMPAIGNS.BCD in number order');
    assert.deepEqual(MISSIONS.slice(-CAMPAIGNS.BCD.length), CAMPAIGNS.BCD, 'after the base maps, in number order');
    assert.ok(!CAMPAIGNS.BEL.some((d) => d.campaign === 'BCD'));
    assert.ok(!CAMPAIGNS.BCD.includes(getMission('b00')), 'the BCD sandbox stays dev-only');
  });
  assert.equal(MISSIONS.length, before);
  for (const n of pick) assert.equal(getMission(slotId(n)), null);
});

test('LIGHTS OUT in the ?debug level select: registered missions under the Lights Out group, numbered, after BEL', async () => {
  const free = freeSlots();
  if (!free.length) return;
  assert.equal(GROUPS.find((g) => g.id === 'BCD').label, 'Lights Out');
  assert.ok(!GROUPS.some((g) => /call of duty/i.test(g.label)));
  await withRegistered([free[0]], ([d]) => {
    const groups = groupMissions(MISSIONS);
    const lo = groups.find((g) => g.id === 'BCD');
    assert.ok(lo, 'the Lights Out group');
    const row = lo.missions.find((m) => m.id === d.id);
    assert.equal(row.n, d.number, 'numbered by its slot');
    assert.equal(row.title, d.title);
    assert.ok(groups.find((g) => g.id === 'TEST').missions.some((m) => m.id === 'b00'), 'b00 stays a test map');
    const order = levelOrder(MISSIONS);
    assert.ok(order.indexOf(d.id) > order.indexOf('m20') && order.indexOf(d.id) < order.indexOf('m00'), 'PageDown: BEL, then LIGHTS OUT, then test maps');
    assert.equal(neighbourLevel(MISSIONS, CAMPAIGNS.BCD.at(-1).id, 1), 'm00');
  });
  assert.ok(!groupMissions(MISSIONS).find((g) => g.id === 'BCD')?.missions.some((m) => m.id === slotId(free[0])));
});

test('LIGHTS OUT menus: the tab is open and named; the catalogue, map-table slots and briefing text come from the def', async () => {
  assert.deepEqual(CAMPAIGN_TABS.map((t) => [t.id, t.label, t.locked]), [['BEL', 'Behind Enemy Lines', false], ['BCD', 'Lights Out', false]]);
  assert.equal(catalogueFor('BEL').length, 20);
  const free = freeSlots();
  if (!free.length) return;
  const n = free[0];
  const missingBefore = missingSlots(catalogueFor('BCD').map((c) => ({ c })));
  assert.ok(missingBefore.includes(n));
  await withRegistered([n], ([d]) => {
    const c = expansionCatalogue().find((x) => x.id === d.id);
    assert.deepEqual({ ...c }, { n, id: d.id, title: d.title, place: d.place, date: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'][+d.date.slice(5, 7) - 1]} ${+d.date.slice(8)}, 1944`,
      lat: d.pin.lat, lon: d.pin.lon, context: d.context, campaign: 'BCD', theater: 'temperate' });
    assert.equal(catalogueEntry(d.id)?.title, d.title);
    assert.equal(catalogueEntry(d)?.n, n);
    const pins = catalogueFor('BCD').map((x) => ({ c: x }));
    const missing = missingSlots(pins);
    assert.ok(!missing.includes(n), 'its slot is no longer in preparation');
    assert.deepEqual(missing, missingBefore.filter((k) => k !== n), 'every other empty slot stays IN PREPARATION');
    assert.equal(briefingHeadline(d), `Mission ${n}. ${d.title}. ${d.place}. ${c.date.replace(/^(\w+)/, (m) => ({ Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September' })[m])}.`);
    assert.equal(briefingParagraphs(d)[0], d.context, 'the context opens the briefing');
  });
  assert.equal(catalogueEntry(slotId(n)), null);
  assert.equal(prepList([1, 2, 3, 4, 5, 6, 7, 8]), 'MISSIONS 1–8');
  assert.equal(prepList([3]), 'MISSION 3');
  assert.equal(prepList([2, 5]), 'MISSIONS 2 · 5');
});

/** A stub of the front end around real Screens / MapTable methods: kit.open records the card specs. */
function menuStub(game) {
  const opened = [];
  const s = Object.create(Screens.prototype);
  Object.assign(s, {
    hud: { game, devUnlock: false, profiles: null, kit: { open: (spec) => opened.push(spec), sound: { play() {} } }, menus: { showSkill: () => true } },
  });
  s.map = new MapTable(s);
  return { s, opened };
}

/** A stub game with both real campaign flows and the real Game campaign methods. */
function stubGame(bcdMissions = CAMPAIGNS.BCD) {
  const events = new EventBus();
  const g = {
    events, state: 'title', world: null, missionDef: null,
    flowFor: Game.prototype.flowFor, useFlow: Game.prototype.useFlow, flowForMission: Game.prototype.flowForMission,
    async loadMission(id) {
      const def = [...MISSIONS, ...bcdMissions].find((m) => m.id === id);
      this.useFlow(def.campaign || 'BEL');
      this.missionDef = def;
      this.world = { id };
      this.state = 'briefing';
      events.emit('game:state', { from: 'title', to: 'briefing' });
      return this.world;
    },
    start() { this.state = 'playing'; events.emit('game:state', { from: 'briefing', to: 'playing' }); },
    quitToTitle() { this.world = null; this.state = 'title'; events.emit('game:state', { from: 'x', to: 'title' }); },
  };
  g.flows = { BEL: new Flow(g, CAMPAIGNS.BEL, 'BEL') };
  g.flow = g.flows.BEL;
  g.flows.BCD = new Flow(g, bcdMissions, 'BCD');
  return g;
}

test('LIGHTS OUT card: START CAMPAIGN is IN PREPARATION until mission 1 is registered; then it opens the Skill screen', async () => {
  const card = (s, opened) => {
    opened.length = 0;
    s.openLightsOut();
    return opened[0];
  };
  const g = stubGame();
  const { s, opened } = menuStub(g);
  const has1 = !!expansionMission(1);
  let spec = card(s, opened);
  assert.equal(spec.title, 'LIGHTS OUT');
  const start = spec.rows.find((r) => r.label === 'START CAMPAIGN');
  assert.equal(!!start.disabled, !has1);
  if (!has1) assert.equal(start.reason, 'IN PREPARATION');
  assert.ok(spec.rows.some((r) => r.label === 'MISSION SELECT' && !r.disabled));
  assert.ok(spec.rows.find((r) => /^CONTINUE/.test(r.label)).hidden, 'no CONTINUE on a fresh Major');
  assert.equal(s.lightsOutInfo().ready, expansionMissions().length);
  assert.equal(s.lightsOutInfo().total, 8);
  assert.equal(s.lightsOutInfo().start, 'Major');
  if (has1) return;
  await withRegistered([1], async ([d]) => {
    spec = card(s, opened);
    assert.ok(!spec.rows.find((r) => r.label === 'START CAMPAIGN').disabled, 'mission 1 registered: START CAMPAIGN opens');
    let skill = null;
    s.hud.menus.showSkill = (flow, onPick) => { skill = { flow, onPick }; return true; };
    const started = [];
    s.hud.startMission = (id) => started.push(id);
    assert.equal(await s.startLightsOut(), true);
    assert.equal(skill.flow, g.flows.BCD, 'the Skill screen sets the LIGHTS OUT career');
    skill.onPick('easy');
    assert.deepEqual(started, [d.id], '… then mission 1 starts');
    // the map table's LIGHTS OUT tab: its pin, open (mission 1 of a fresh career), the empty slots in preparation
    opened.length = 0;
    s.map.open('BCD');
    const mt = opened[0];
    assert.deepEqual(mt.rows.map((r) => r.id), CAMPAIGNS.BCD.map((m) => m.id));
    assert.ok(!mt.rows[0].disabled && /next/.test(mt.rows[0].cls), 'mission 1 is the next pin');
    assert.ok(!mt.footer[0].disabled, '(B)RIEFING works with a pin');
  });
  opened.length = 0;
  s.map.open('BCD');
  assert.equal(opened[0].rows.length, expansionMissions().length, 'LIGHTS OUT tab: registered pins only');
  if (!expansionMissions().length) assert.ok(opened[0].footer[0].disabled && opened[0].footer[0].reason === 'IN PREPARATION');
  opened.length = 0;
  s.map.open('BEL');
  assert.equal(opened[0].rows.length, 20, 'the BEL tab still pins the twenty');
});

test('LIGHTS OUT career: a separate flow that starts at Major (36) and stops at Field Marshal (60); Skill kept', () => {
  const g = stubGame([fakeDef(1), fakeDef(2), fakeDef(3)]);
  const f = g.flows.BCD;
  assert.equal(f.gold, 36);
  assert.equal(rankIndex(f.gold), 6, 'Major');
  assert.equal(CONFIG.rulesets.BCD.careerStartGold + CONFIG.rulesets.BCD.maxGold, 60);
  assert.equal(g.flows.BEL.gold, 0, 'the BEL career is untouched');
  assert.notEqual(f, g.flows.BEL);
  const perfect = { clock: 1, commandos: [{ role: 'greenberet', hp: 200, maxHp: 200 }], stats: {} };
  for (let i = 0; i < 12; i++) f.onMissionEnd(true, perfect, f.missions[i % 3]);
  assert.equal(f.gold, 60, 'capped at Field Marshal');
  assert.equal(rankIndex(f.gold), 10);
  assert.equal(f.serialize().campaign, 'BCD');
  assert.equal(f.serialize().difficulty, 'hard');
  f.setDifficulty('easy');
  assert.equal(f.serialize().difficulty, 'easy', 'the Skill choice is stored in the career');
});

test('LIGHTS OUT flow: numbers come from the slots (gaps allowed); mission 1 opens the campaign; passwords replay a slot', () => {
  const g = stubGame([fakeDef(2), fakeDef(3), fakeDef(5)]);
  const f = g.flows.BCD;
  assert.equal(f.byNumber(1), null);
  assert.ok(!f.unlocked('e02'), 'mission 2 waits for mission 1');
  assert.equal(f.numberOf('e05'), 5);
  assert.equal(f.nextMissionId('e02'), 'e03');
  assert.equal(f.nextMissionId('e03'), null, 'slot 4 is in preparation: no next mission');
  assert.equal(f.enterPassword(encodePassword('BCD', 4, 0, 6)), null, 'a code for an empty slot opens nothing');
  assert.equal(f.enterPassword(encodePassword('BCD', 5, 1, 7, 'easy')), 'e05');
  assert.ok(f.unlocked('e02') && f.unlocked('e03') && f.unlocked('e05'));
  assert.equal(f.difficulty, 'easy');
  assert.equal(g.flows.BEL.enterPassword(encodePassword('BCD', 5, 1, 7)), null, 'the BEL career refuses a LIGHTS OUT code');
  const one = stubGame([fakeDef(1), fakeDef(2)]).flows.BCD;
  assert.ok(one.unlocked('e01') && !one.unlocked('e02'));
  const won = one.onMissionEnd(true, { clock: 1, commandos: [{ role: 'greenberet', hp: 1, maxHp: 1 }], stats: {} }, one.missions[0]);
  assert.ok(one.unlocked('e02'));
  assert.equal(won.password, encodePassword('BCD', 2, partialStars(one.gold), rankIndex(one.gold), 'hard'), 'the password opens slot 2');
});

test('LIGHTS OUT flow switch: starting a mission makes its campaign\'s flow game.flow; only that flow follows the game', async () => {
  const g = stubGame([fakeDef(1), fakeDef(2)]);
  const states = [];
  g.events.on('flow:state', (e) => states.push(`${e.from}>${e.to}`));
  g.flows.BCD.setDifficulty('easy');
  assert.equal(g.difficulty, undefined, 'a Skill pick for the inactive LIGHTS OUT career waits for its next mission');
  g.flow.openSelect(); // the map table is open (on the BEL flow)
  const flowForMission = g.flowForMission; // the real lookup reads MISSIONS; these fakes are not registered
  g.flowForMission = (id) => (/^e0/.test(id) ? g.flows.BCD : flowForMission.call(g, id));
  await g.flow.startMission('e01'); // asked of the BEL flow: LIGHTS OUT's own flow runs it
  assert.equal(g.flow, g.flows.BCD);
  assert.equal(g.flows.BCD.current, 'e01');
  assert.equal(g.flows.BEL.current, null);
  assert.equal(g.flows.BCD.state, 'briefing');
  assert.equal(g.flows.BEL.state, 'title');
  assert.equal(g.difficulty, 'easy', 'the career\'s Skill builds the load');
  g.flow.begin();
  assert.equal(g.flows.BCD.state, 'playing');
  assert.equal(g.flows.BEL.state, 'title', 'the inactive flow does not follow the game');
  assert.deepEqual(states, ['title>select', 'select>briefing', 'briefing>playing'], 'one state machine, no duplicate events');
  await g.flow.retry();
  assert.equal(g.flow, g.flows.BCD);
  await g.flow.startMission('m01'); // a BEL mission: back to the BEL career, no Skill
  assert.equal(g.flow, g.flows.BEL);
  assert.equal(g.difficulty, null);
  assert.equal(g.flows.BEL.current, 'm01');
  assert.equal(Game.prototype.flowFor.call(g, 'BCD'), g.flows.BCD);
  assert.equal(Game.prototype.flowFor.call(g, 'XYZ'), g.flows.BEL);
  assert.equal(Game.prototype.flowForMission.call(g, 'b00'), g.flows.BCD, 'the BCD sandbox runs under the LIGHTS OUT ruleset flow');
  assert.equal(Game.prototype.flowForMission.call(g, 'nope'), null);
});

test('LIGHTS OUT: the 1999 expansion\'s title appears in no player-facing text', () => {
  const ROOT = new URL('../../', import.meta.url);
  for (const f of ['src/ui/screens.js', 'src/ui/catalogue.js', 'src/ui/help.js', 'src/ui/map-table.js', 'src/ui/lights-out-art.js', 'src/debug/debug-options.js', 'README.md']) {
    assert.ok(!/call of duty/i.test(readFileSync(new URL(f, ROOT), 'utf8')), f);
  }
});
