import { test, assert } from './lib.mjs';
import {
  parseDebugParams, normalizeOptions, loadOptions, saveOptions, cycleOption, groupMissions, levelOrder, neighbourLevel,
  transformDef, DEFAULT_OPTIONS, STORAGE_KEY,
} from '../../src/debug/debug-options.js';
import { MISSIONS } from '../../src/missions/index.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

test('debug: ?debug / ?debug=1 / ?debug=cones enable; absent / 0 / off do not', () => {
  for (const q of ['?debug', '?debug=1', '?debug=cones', '?debug=', '?mission=m01&debug', '?debug=true']) assert.equal(parseDebugParams(q).enabled, true, q);
  for (const q of ['', '?test=1', '?debug=0', '?debug=off', '?debug=false', '?debugx=1']) assert.equal(parseDebugParams(q).enabled, false, q);
  assert.equal(parseDebugParams('?debug=cones').cones, true);
  assert.equal(parseDebugParams('?debug=1').cones, false);
  assert.equal(parseDebugParams('?debug&mission=m05').mission, 'm05');
  assert.equal(parseDebugParams(new URLSearchParams('debug=cones,x')).cones, true);
});

test('debug: options normalize, persist, survive bad storage', () => {
  assert.deepEqual(normalizeOptions(null), { ...DEFAULT_OPTIONS });
  const o = normalizeOptions({ invulnerable: 1, timeScale: '4', timeOfDay: 'dusk', weather: 'desert', junk: 5 });
  assert.equal(o.invulnerable, true);
  assert.equal(o.timeScale, 4);
  assert.equal(o.timeOfDay, 'dusk');
  assert.equal(o.weather, 'desert');
  assert.equal('junk' in o, false);
  assert.equal(normalizeOptions({ timeScale: 3, timeOfDay: 'midnight', weather: 'hail' }).timeScale, 1);
  assert.equal(normalizeOptions({ timeOfDay: 'midnight' }).timeOfDay, 'mission');
  const s = mem();
  assert.equal(saveOptions(s, { ...DEFAULT_OPTIONS, noDetect: true }), true);
  assert.equal(loadOptions(s).noDetect, true);
  assert.equal(loadOptions(s, { cones: true }).cones, true, 'forced (?debug=cones) wins');
  s.setItem(STORAGE_KEY, '{not json');
  assert.deepEqual(loadOptions(s), { ...DEFAULT_OPTIONS });
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadOptions(broken), { ...DEFAULT_OPTIONS });
  assert.equal(saveOptions(broken, DEFAULT_OPTIONS), false);
  assert.equal(DEFAULT_OPTIONS.skipBriefing, true, 'skip briefing defaults on');
});

test('debug: cycling options wrap', () => {
  assert.equal(cycleOption({ timeScale: 1 }, 'timeScale'), 2);
  assert.equal(cycleOption({ timeScale: 4 }, 'timeScale'), 0.5);
  assert.equal(cycleOption({ timeScale: 0.5 }, 'timeScale', -1), 4);
  assert.equal(cycleOption({ timeOfDay: 'mission' }, 'timeOfDay'), 'dawn');
  assert.equal(cycleOption({ weather: 'mission' }, 'weather', -1), 'urban');
});

test('debug: level select lists every mission, BEL by number whatever the list order', () => {
  const defs = [{ id: 'm00', campaign: 'BEL' }, { id: 'm05', campaign: 'BEL', theater: 'snow' }, { id: 'm02' }, { id: 'm10', campaign: 'BEL' },
    { id: 'b00', campaign: 'BCD', dev: true }, { id: 'b01', campaign: 'BCD' }, { id: 'm04', campaign: 'BEL' }];
  const g = groupMissions(defs);
  assert.deepEqual(g.map((x) => x.id), ['BEL', 'BCD', 'TEST']);
  assert.deepEqual(g[0].missions.map((m) => m.id), ['m02', 'm04', 'm05', 'm10']);
  assert.deepEqual(g[0].missions.map((m) => m.n), [2, 4, 5, 10]);
  assert.deepEqual(g[2].missions.map((m) => m.id), ['m00', 'b00']);
  assert.equal(g[0].missions[2].theater, 'snow');
  assert.deepEqual(levelOrder(defs), ['m02', 'm04', 'm05', 'm10', 'b01', 'm00', 'b00']);
  assert.equal(neighbourLevel(defs, 'm05', 1), 'm10');
  assert.equal(neighbourLevel(defs, 'm02', -1), 'b00', 'wraps backwards');
  assert.equal(neighbourLevel(defs, 'b00', 1), 'm02', 'wraps forwards');
  assert.equal(neighbourLevel(defs, null, 1), 'm02');
  assert.equal(neighbourLevel([], 'm01', 1), null);
  // the real list: every def appears exactly once
  const real = levelOrder(MISSIONS);
  assert.equal(real.length, MISSIONS.length);
  assert.deepEqual([...real].sort(), MISSIONS.map((m) => m.id).sort());
});

test('debug: transformDef adds missing commandos and overrides light / wind without mutating the def', () => {
  const def = Object.freeze({ id: 'm01', campaign: 'BEL', size: [100, 100], commandos: Object.freeze([{ role: 'greenberet', x: 10, z: 20 }]), lighting: { kelvin: 6000, fog: 150 } });
  assert.equal(transformDef(def, DEFAULT_OPTIONS), def, 'no-op returns the same def');
  const out = transformDef(def, { ...DEFAULT_OPTIONS, allCommandos: true, timeOfDay: 'dusk', weather: 'calm' });
  assert.notEqual(out, def);
  assert.deepEqual(out.commandos.map((c) => c.role), ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy']);
  for (const c of out.commandos.slice(1)) assert.ok(Math.hypot(c.x - 10, c.z - 20) < 2, 'beside the first commando');
  assert.equal(out.lighting.fog, 150);
  assert.equal(out.lighting.kelvin, 3100);
  assert.equal(out.weather.wind.preset, 'calm');
  assert.equal(def.commandos.length, 1);
  const bcd = transformDef({ id: 'b00', campaign: 'BCD', commandos: [] , size: [40, 40] }, { allCommandos: true });
  assert.ok(bcd.commandos.some((c) => c.role === 'natasha'));
});

test('debug: inspection mode — enemies blind and deaf while world.debug.noDetect', async () => {
  const { makeWorld } = await import('./ai-harness.mjs');
  const { canSee, hears } = await import('../../src/ai/perception.js');
  const w = makeWorld({ enemies: [{ id: 'g', soldierType: 'sentry', x: 20, z: 40, heading: 0, post: { heading: 0, sweep: 0 } }] });
  const g = w.enemies[0];
  const T = { x: 45, z: 40, isLow: false, isVisibleToEnemies: true };
  const noise = { x: 22, z: 40, radius: 10, source: null };
  assert.equal(canSee(g, T, w), 'far');
  assert.equal(hears(g, noise), true);
  w.debug = { noDetect: true, invulnerable: false };
  assert.equal(canSee(g, T, w), 'none');
  assert.equal(hears(g, noise), false);
  w.debug.noDetect = false;
  assert.equal(canSee(g, T, w), 'far', 'live flag: back on');
});
