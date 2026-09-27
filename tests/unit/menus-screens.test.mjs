import { test, assert } from './lib.mjs';
import { personalBest, failureText } from '../../src/ui/debrief.js';
import { Profiles } from '../../src/ui/profiles.js';
import { COAST } from '../../src/ui/europe-coast.js';
import { project, VIEW } from '../../src/ui/europe.js';
import { BEL_CATALOGUE } from '../../src/ui/catalogue.js';

const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('debrief: ghost personal best comes from earlier wins only (B11)', () => {
  const r = [
    { missionId: 'm01', won: true, stars: { time: 1, damage: 3 }, merit: 1 },
    { missionId: 'm01', won: false, stars: { time: 3, damage: 3 }, merit: 3 },
    { missionId: 'm02', won: true, stars: { time: 3, damage: 3 }, merit: 3 },
    { missionId: 'm01', won: true, stars: { time: 2, damage: 2 }, merit: 2 }, // the result just recorded
  ];
  assert.deepEqual(personalBest(r, 'm01'), { time: 1, damage: 3, merit: 1 });
  assert.equal(personalBest(r.slice(0, 1), 'm01'), null, 'first win: no ghost discs');
  assert.equal(personalBest([], 'm01'), null);
});

test('debrief: §8.1 failure strings', () => {
  assert.equal(failureText('all commandos dead'), 'ALL YOUR MEN HAVE DIED OR HAVE BEEN CAPTURED.');
  assert.equal(failureText('one commando died'), 'ONE OR MORE OF YOUR MEN DIED…');
  assert.equal(failureText('You destroyed the truck, but you needed it to escape'), 'YOU DESTROYED THE TRUCK, BUT YOU NEEDED IT TO ESCAPE.');
  assert.equal(failureText(''), 'MISSION FAILED.');
});

test('profiles: create, duplicate, max 8, rename, remove, last operation (S04, B5)', () => {
  const st = memStore();
  const p = new Profiles(st);
  assert.ok(p.needsNew);
  assert.equal(p.create('  tiny '), true);
  assert.equal(p.current, 'TINY');
  assert.equal(p.create('Tiny'), 'exists');
  assert.equal(p.create(''), 'empty');
  for (let i = 0; i < 7; i++) assert.equal(p.create(`M${i}`), true);
  assert.equal(p.create('NINTH'), 'full', 'eight soldiers max');
  p.select('TINY');
  p.setLast({ missionId: 'm01', title: 'Baptism of Fire', n: 1 });
  const q = new Profiles(st); // persisted
  assert.equal(q.current, 'TINY');
  assert.equal(q.last.missionId, 'm01');
  assert.equal(q.rename('DUKE'), true);
  assert.equal(q.current, 'DUKE');
  q.remove('DUKE');
  assert.notEqual(q.current, 'DUKE');
  assert.equal(q.list.length, 7);
});

test('europe map: Natural Earth coast rings cover every BEL mission location (S06b, S15)', () => {
  assert.ok(COAST.length >= 8, 'several land rings');
  for (const r of COAST) assert.equal(r.length % 2, 0);
  // every mission pin lies on the map sheet, and on (or next to) land
  const onLand = (lon, lat) => COAST.some((r) => {
    let inside = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const [xi, yi, xj, yj] = [r[i], r[i + 1], r[j], r[j + 1]];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
  for (const c of BEL_CATALOGUE) {
    const [x, y] = project(c.lon, c.lat, 1000, 1000, VIEW);
    assert.ok(x > 0 && x < 1000 && y > 0 && y < 1000, `${c.id} on the sheet`);
    const near = [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4], [0.7, 0], [0, 0.7]].some(([dx, dy]) => onLand(c.lon + dx, c.lat + dy));
    assert.ok(near, `${c.id} (${c.place}) is on land`);
  }
});

test('map table: pin numbers dodge each other (Norway / France clusters, review fix)', async () => {
  const { layoutPins, TABLE_VIEW } = await import('../../src/ui/map-table.js');
  const pts = BEL_CATALOGUE.map((c) => project(c.lon, c.lat, 1000, 1000, TABLE_VIEW));
  const out = layoutPins(pts);
  assert.equal(out.length, pts.length);
  const OFF = { r: [16, -54], l: [-54, -54], b: [-19, 2], t: [-19, -76] };
  const boxes = out.map((p) => ({ x: p.x + OFF[p.side][0], y: p.y + OFF[p.side][1], w: 38, h: 22 }));
  let clashes = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = 0; j < i; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) clashes++;
  }
  assert.ok(clashes <= 1, `label overlaps: ${clashes}`);
});

test('debrief: the figure is the rendered Green Beret with rank decals (review fix)', async () => {
  const { figureHTML } = await import('../../src/ui/debrief.js');
  assert.match(figureHTML(0), /tiny-portrait\.webp/);
  assert.doesNotMatch(figureHTML(0), /db-rankdecal/, 'a private wears no chevrons');
  assert.equal((figureHTML(2).match(/<path d="M4 /g) || []).length, 2, 'two chevrons for a corporal');
  assert.match(figureHTML(5), /circle/, 'officer pips');
});

test('menu kit: browser keys pass through; only handled keys are consumed (WCAG 1.4.4)', async () => {
  const { MenuKit } = await import('../../src/ui/menu-kit.js');
  let picked = 0;
  const fake = {
    top: { spec: {}, rows: [{ label: '(Y)ES', hotkey: 'Y', onSelect: () => { picked++; } }], focus: 0, els: [] },
    _setDevice() {}, _holding: null, focus() {}, activate() { picked++; }, back() {},
  };
  const k = (code, x = {}) => MenuKit.prototype.key.call(fake, { code, key: code, preventDefault() {}, ...x });
  assert.equal(k('Equal', { ctrlKey: true }), false, 'Ctrl+= (zoom) is the browser\'s');
  assert.equal(k('Minus', { metaKey: true }), false, 'Cmd+- (zoom) is the browser\'s');
  assert.equal(k('KeyR', { ctrlKey: true }), false, 'Ctrl+R (reload) is the browser\'s');
  assert.equal(k('F5'), false, 'F5 is the browser\'s');
  assert.equal(k('KeyQ'), false, 'an unbound letter is not consumed');
  assert.equal(k('KeyY'), true, 'a row hotkey is consumed');
  assert.equal(picked, 1);
  assert.equal(k('ArrowDown'), true, 'navigation is consumed');
  fake.top.spec.ctrlKeys = ['KeyV'];
  fake.top.spec.onKey = (e) => e.code === 'KeyV';
  assert.equal(k('KeyV', { ctrlKey: true }), true, 'a card may bind a chord explicitly');
});
