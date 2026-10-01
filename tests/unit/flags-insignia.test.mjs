/** Enemy flag insignia: historical default (user decision 2026-09-30), NEUTRAL option, 3:5 cloth, 1935 disc geometry. */
import { test, assert, near } from './lib.mjs';
import { getInsignia, setInsignia, onInsignia, INSIGNIA_MODES } from '../../src/art/insignia.js';
import { DISC, FLAG_W, FLAG_H, flagWeather } from '../../src/art/flag-textures.js';
import { makeFlag, flagClothMaterial, flagMaterial, FLAG_ASPECT } from '../../src/art/flags.js';
import { OPTION_ROWS, OPTION_HELP, formatOption } from '../../src/ui/options-panel.js';
import { OPTION_DEFAULTS, loadOptions } from '../../src/ui/ui-config.js';

test('insignia: historical by default, NEUTRAL toggles, unknown values fall back, listeners fire on change only', () => {
  assert.deepEqual([...INSIGNIA_MODES], ['historical', 'neutral']);
  assert.equal(getInsignia(), 'historical');
  const seen = [];
  const off = onInsignia((m) => seen.push(m));
  try {
    setInsignia('neutral'); setInsignia('neutral'); setInsignia('bogus'); setInsignia(undefined);
    assert.deepEqual(seen, ['neutral', 'historical']);
  } finally { off(); setInsignia('historical'); }
});

test('insignia: Options → GAME PREFERENCES row, default HISTORICAL, help text, saved like every option', () => {
  const rows = OPTION_ROWS.map((r) => r[0]);
  const row = OPTION_ROWS.find((r) => r[0] === 'insignia');
  assert.ok(row && row[1] === 'INSIGNIA' && row[2].join() === 'historical,neutral');
  assert.ok(rows.indexOf('insignia') > rows.lastIndexOf('h', rows.indexOf('insignia')) && OPTION_ROWS[rows.lastIndexOf('h', rows.indexOf('insignia'))][1] === 'GAME PREFERENCES');
  assert.equal(OPTION_DEFAULTS.insignia, 'historical');
  assert.ok(/HISTORICAL/.test(OPTION_HELP.insignia) && /NEUTRAL/.test(OPTION_HELP.insignia));
  assert.equal(formatOption('insignia', 'neutral'), 'NEUTRAL');
  const store = { v: JSON.stringify({ insignia: 'neutral' }), getItem() { return this.v; }, setItem(k, v) { this.v = v; } };
  assert.equal(loadOptions(store).insignia, 'neutral');
});

test('flags: 3:5 cloth, disc 3/4 of the height centred 1/20 of the length toward the hoist, theater weathering', () => {
  near(FLAG_H / FLAG_W, 0.6, 1e-9);
  assert.equal(FLAG_ASPECT, 0.6);
  near(DISC.u, 0.45, 1e-9); near(DISC.v, 0.5, 1e-9);
  near(DISC.rv * 2, 0.75, 1e-9); near(DISC.ru * FLAG_W, DISC.rv * FLAG_H, 1e-9); // a circle on the 5:3 canvas
  const c = makeFlag({ pole: true, h: 6 }).getObjectByName('flag_cloth').geometry.parameters;
  near(c.height / c.width, 0.6, 1e-9);
  assert.ok(flagWeather('desert').fade > flagWeather('temperate').fade, 'desert sun-bleach');
  assert.ok(flagWeather('snow').damp > 0 && flagWeather('snow').frost > 0, 'snow damp + frost');
  assert.equal(flagWeather('nowhere'), flagWeather('temperate'));
  // one shared material per theater; cloth and shader-wave variants compile to different programs
  assert.equal(flagClothMaterial('desert'), flagClothMaterial('desert'));
  assert.notEqual(flagClothMaterial('desert'), flagClothMaterial('snow'));
  assert.equal(flagClothMaterial('snow').userData.flagTheater, 'snow');
  assert.notEqual(flagClothMaterial().customProgramCacheKey(), flagMaterial().customProgramCacheKey());
  assert.ok(flagClothMaterial().alphaTest > 0, 'frayed fly edge cuts out');
});

test('flags: every garrison marker gets a cloth — extra-prop houses (flat_roof_house) and free-standing flag_pole signs', async () => {
  const { buildExtraProp } = await import('../../src/art/props-extra.js');
  const { buildProp } = await import('../../src/art/props.js');
  const cloth = (o) => { let n = 0; o.traverse((c) => { if (c.name === 'flag_cloth') n++; }); return n; };
  assert.equal(cloth(buildExtraProp('flat_roof_house', { id: 'cp', x: 0, z: 0, flag: true }, { theater: 'desert' }).object3d), 1);
  assert.equal(cloth(buildExtraProp('flat_roof_house', { id: 'h', x: 0, z: 0 }, {}).object3d), 0);
  const pole = buildProp('sign', { id: 'fp', variant: 'flag_pole', x: 0, z: 0, h: 7 }, { theater: 'desert', library: false });
  assert.equal(cloth(pole.object3d), 1);
  assert.equal(cloth(buildProp('sign', { id: 's', x: 0, z: 0 }, { library: false }).object3d), 0);
});

test('flags: a staff car command flag wears the insignia-aware enemy flag cloth (theater weathering, 5:3), boat pennant stays plain', async () => {
  const THREE = await import('three');
  const { addPennants } = await import('../../src/art/vehicle-pennants.js');
  const vis = { emitters: [{ kind: 'pennant', pos: [0, 3, 0] }], meta: { lights: [] }, object3d: new THREE.Group() };
  const p = addPennants(vis, { pennant: true }, 'desert');
  try {
    const staff = vis.object3d.getObjectByName('pennant:staff').getObjectByName('pennant_cloth');
    assert.equal(staff.material, flagClothMaterial('desert'));
    near(staff.geometry.parameters.height / staff.geometry.parameters.width, 0.6, 1e-9);
    const mast = vis.object3d.children.find((g) => g.name === 'pennant').getObjectByName('pennant_cloth');
    assert.notEqual(mast.material.name, 'flag_cloth');
  } finally { p.dispose(); }
});
