/** CORE2: scoring (§8.2), password codec (§8.3), campaign flow state machine. */
import { test, assert } from './lib.mjs';
import { CONFIG } from '../../src/config.js';
import { EventBus } from '../../src/core/events.js';
import {
  timeStars, damageLoss, damageStars, merit, rankIndex, rankName, partialStars, goldFrom, meetsM20Gate, scoreMission,
} from '../../src/core/scoring.js';
import { encodePassword, decodePassword, whiten, unwhiten, packValue, checksum, normalizeCode } from '../../src/core/passwords.js';
import { Flow, encodePassword as flowEncode } from '../../src/core/flow.js';

test('§8.2 time stars at the par boundaries', () => {
  assert.equal(timeStars(100, 100), 3);
  assert.equal(timeStars(100.01, 100), 2);
  assert.equal(timeStars(150, 100), 2);
  assert.equal(timeStars(250, 100), 1);
  assert.equal(timeStars(251, 100), 0);
});

test('§8.2 damage loss: guests excluded, dead = full loss, stars thresholds', () => {
  const cs = [
    { role: 'greenberet', hp: 180, maxHp: 200 },
    { role: 'sniper', hp: 100, maxHp: 100 },
    { role: 'guest', hp: 0, maxHp: 100, alive: false },
  ];
  assert.equal(damageLoss(cs), 20 / 300);
  assert.equal(damageLoss([{ role: 'spy', hp: 50, maxHp: 160, alive: false }]), 1);
  assert.equal(damageStars(0.10), 3);
  assert.equal(damageStars(0.11), 2);
  assert.equal(damageStars(0.30), 2);
  assert.equal(damageStars(0.60), 1);
  assert.equal(damageStars(0.61), 0);
});

test('§8.2 merit, ranks, M20 gate', () => {
  assert.equal(merit(3, 3), 3);
  assert.equal(merit(3, 2), 2);
  assert.equal(merit(2, 2), 2);
  assert.equal(merit(1, 2), 1);
  assert.equal(merit(1, 0), 0);
  assert.equal(rankName(0), 'Lance-Corporal');
  assert.equal(rankName(29), 'Lieutenant');
  assert.equal(rankName(30), 'Captain');
  assert.equal(rankName(60), 'Field-Marshal');
  assert.equal(rankName(999), 'Field-Marshal');
  assert.equal(CONFIG.mission.ranks.length, 11);
  assert.equal(meetsM20Gate(29), false);
  assert.equal(meetsM20Gate(30), true);
  assert.equal(partialStars(31), 1);
  assert.equal(goldFrom(rankIndex(31), partialStars(31)), 31);
  assert.equal(goldFrom(rankIndex(70), partialStars(70)), 70);
});

test('§8.2 scoreMission uses the mission clock', () => {
  const w = { clock: 200, time: 999, commandos: [{ role: 'greenberet', hp: 200, maxHp: 200 }] };
  const s = scoreMission(w, { time: 300 });
  assert.deepEqual(s.stars, { time: 3, damage: 3 });
  assert.equal(s.merit, 3);
});

test('§8.3 whitening is invertible over every 19-bit value', () => {
  for (let v = 0; v < 1 << 19; v += 7) assert.equal(unwhiten(whiten(v)), v);
  const v = packValue(5, 3, 4);
  assert.equal(v & 15, checksum(v));
});

test('§8.3 password round-trip for every mission, rank and star value', () => {
  const seen = new Set();
  let n = 0;
  for (let mission = 2; mission <= 20; mission++) {
    for (let rank = 0; rank <= 10; rank++) {
      for (let stars = 0; stars <= 31; stars++) {
        const code = encodePassword('BEL', mission, stars, rank);
        assert.equal(code.length, 5);
        assert.ok(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ\-+*=]{5}$/.test(code), code);
        const d = decodePassword(code);
        assert.deepEqual(d, { campaign: 'BEL', mission, stars, rank }, code);
        assert.deepEqual(decodePassword(code.toLowerCase()), d, 'case-insensitive');
        seen.add(code);
        n++;
      }
    }
  }
  assert.equal(seen.size, n, 'codes are unique');
  for (let mission = 2; mission <= 8; mission++) assert.equal(decodePassword(encodePassword('BCD', mission, 0, 6)).campaign, 'BCD');
});

test('§8.3 no password for M1; corrupted codes are rejected', () => {
  assert.equal(encodePassword('BEL', 1, 0, 0), null);
  assert.equal(encodePassword('BEL', 21, 0, 0), null);
  assert.equal(encodePassword('BEL', 5, 0, 11), null);
  assert.equal(flowEncode, encodePassword);
  const code = encodePassword('BEL', 7, 2, 3);
  let rejected = 0, total = 0;
  const A = CONFIG.passwords.alphabet;
  for (let i = 0; i < 5; i++) {
    for (const ch of A) {
      if (ch === code[i]) continue;
      total++;
      const bad = code.slice(0, i) + ch + code.slice(i + 1);
      const d = decodePassword(bad);
      if (!d) rejected++;
    }
  }
  assert.ok(rejected / total > 0.9, `single-character typos rejected (${rejected}/${total})`);
  assert.equal(decodePassword(''), null);
  assert.equal(decodePassword('ABC'), null);
  assert.equal(normalizeCode(' oi2 '), '012');
});

function fakeGame(missions) {
  const events = new EventBus();
  const g = {
    events, state: 'title', world: null, missionDef: null,
    async loadMission(id) {
      this.missionDef = missions.find((m) => m.id === id);
      this.world = { id };
      this.state = 'briefing';
      events.emit('game:state', { from: 'title', to: 'briefing' });
      return this.world;
    },
    start() { this.state = 'playing'; events.emit('game:state', { from: 'briefing', to: 'playing' }); },
    quitToTitle() { this.world = null; this.state = 'title'; events.emit('game:state', { from: 'x', to: 'title' }); },
  };
  return g;
}

test('flow state machine: title → select → briefing → playing → debrief → next', async () => {
  const missions = Array.from({ length: 20 }, (_, i) => ({ id: `m${String(i + 1).padStart(2, '0')}`, par: { time: 100 } }));
  const g = fakeGame(missions);
  const f = new Flow(g, missions, 'BEL');
  const states = [];
  g.events.on('flow:state', ({ to }) => states.push(to));
  assert.ok(f.unlocked('m01') && !f.unlocked('m02'));
  f.openSelect();
  await f.startMission('m01');
  f.begin();
  const perfect = { clock: 50, commandos: [{ role: 'greenberet', hp: 200, maxHp: 200 }], stats: {} };
  const out = f.onMissionEnd(true, perfect, missions[0]);
  g.events.emit('game:state', { from: 'playing', to: 'won' });
  assert.equal(out.merit, 3);
  assert.equal(f.gold, 3);
  assert.ok(f.unlocked('m02'));
  assert.deepEqual(decodePassword(out.password), { campaign: 'BEL', mission: 2, stars: 3, rank: 0 });
  await f.next();
  assert.equal(f.current, 'm02');
  assert.deepEqual(states, ['select', 'briefing', 'playing', 'debrief', 'briefing']);
  // replay re-credits gold (BEL "Play Again")
  f.onMissionEnd(true, perfect, missions[1]);
  f.onMissionEnd(true, perfect, missions[1]);
  assert.equal(f.gold, 9);
  assert.equal(f.results.length, 3);
  // a loss credits nothing
  const lost = f.onMissionEnd(false, perfect, missions[2]);
  assert.equal(lost.merit, 0);
  assert.equal(f.gold, 9);
});

test('flow M20 gate + password restores career', async () => {
  const missions = Array.from({ length: 20 }, (_, i) => ({ id: `m${i + 1}`, par: { time: 100 } }));
  const g = fakeGame(missions);
  const f = new Flow(g, missions, 'BEL');
  const opened = f.enterPassword(encodePassword('BEL', 19, 5, 4)); // Lieutenant + 5
  assert.equal(opened, 'm19');
  assert.equal(f.gold, 29);
  assert.ok(f.unlocked('m1') && f.unlocked('m18') && f.unlocked('m19') && !f.unlocked('m20'));
  const poor = { clock: 999, commandos: [{ role: 'greenberet', hp: 1, maxHp: 200 }], stats: {} };
  const out = f.onMissionEnd(true, poor, missions[18]); // 0 merit → still Lieutenant
  assert.equal(out.epilogue, true);
  assert.equal(out.password, null);
  assert.ok(!f.unlocked('m20'));
  f.current = 'm19';
  assert.equal(await f.next(), null);
  assert.equal(f.state, 'epilogue');
  // Captain after M19 → M20 opens
  const f2 = new Flow(fakeGame(missions), missions, 'BEL');
  f2.enterPassword(encodePassword('BEL', 19, 5, 4));
  const good = { clock: 50, commandos: [{ role: 'greenberet', hp: 200, maxHp: 200 }], stats: {} };
  const o2 = f2.onMissionEnd(true, good, missions[18]);
  assert.ok(f2.unlocked('m20'));
  assert.equal(decodePassword(o2.password).mission, 20);
  // the M20 password always opens it
  const f3 = new Flow(fakeGame(missions), missions, 'BEL');
  assert.equal(f3.enterPassword(encodePassword('BEL', 20, 0, 0)), 'm20');
  assert.equal(f3.enterPassword('ZZZZZ'), null);
  assert.equal(f3.enterPassword(encodePassword('BCD', 3, 0, 6)), null, 'BCD code under BEL');
});

test('flow serialize/deserialize', () => {
  const missions = [{ id: 'a' }, { id: 'b' }];
  const f = new Flow(fakeGame(missions), missions);
  f.gold = 14;
  f._unlocked.add('b');
  const f2 = new Flow(fakeGame(missions), missions);
  f2.deserialize(JSON.parse(JSON.stringify(f.serialize())));
  assert.equal(f2.gold, 14);
  assert.ok(f2.unlocked('b'));
});
