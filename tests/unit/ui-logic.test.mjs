import { test, assert } from './lib.mjs';
import { tourStops } from '../../src/ui/tour.js';
import { barkText, ACK_KEYS } from '../../src/ui/bark-lines.js';
import { failureText } from '../../src/ui/debrief.js';
import { spriteFor, CURSORS } from '../../src/ui/cursor-sprites.js';
import { entityLabel } from '../../src/ui/tooltip.js';
import { portraitGlyph } from '../../src/ui/topbar.js';
import { OPTION_ROWS } from '../../src/ui/options-panel.js';
import { OPTION_DEFAULTS } from '../../src/ui/ui-config.js';

const def = {
  size: [60, 60],
  structures: [{ type: 'fueltank', id: 'fuel_depot', x: 52, z: 38 }],
  objectives: [{ id: 'd', text: 'Destroy the fuel depot', type: 'destroy', targets: ['fuel_depot'] }, { id: 'e', text: 'Escape', type: 'escape' }],
  extraction: { x: 6, z: 7, r: 3 },
};

test('ui: Colonel tour stops on start, objective, danger, extraction (§6.6)', () => {
  const world = {
    commandos: [{ x: 6, z: 52, alive: true }, { x: 10, z: 52, alive: true }],
    enemies: [{ x: 47, z: 30, alive: true, soldierType: 'sentry' }, { x: 50, z: 32, alive: true, soldierType: 'mg' }, { x: 5, z: 5, alive: false }],
    objectives: def.objectives,
    extraction: def.extraction,
  };
  const s = tourStops(world, def);
  assert.deepEqual(s.map((k) => k.kind), ['start', 'objective', 'danger', 'extraction']);
  assert.equal(s[0].x, 8);
  assert.equal(s[1].x, 52);
  assert.ok(/fuel depot/.test(s[1].text));
  assert.ok(s[2].x > 45, 'danger centred on the guarded spot');
  assert.equal(s[3].z, 7);
  const custom = tourStops(world, { ...def, briefing: { tour: [{ x: 1, z: 2, text: 'Here.' }] } });
  assert.deepEqual(custom, [{ kind: 'objective', x: 1, z: 2, text: 'Here.' }]);
});

test('ui: bark subtitles resolve commando keys, German lines with gloss, laconic set', () => {
  const gb = { role: 'greenberet', faction: 'player' };
  assert.equal(barkText({ unit: gb, line: 'ack_move' }).text, 'On me way.');
  const h = barkText({ unit: { soldierType: 'sentry', faction: 'enemy' }, line: 'halt' });
  assert.equal(h.text, 'Halt!');
  assert.equal(h.gloss, 'Stop!');
  assert.equal(h.german, true);
  assert.equal(barkText({ unit: gb, text: 'Custom line' }).text, 'Custom line');
  assert.equal(barkText({ unit: gb, line: { text: 'Obj', gloss: 'g' } }).gloss, 'g');
  assert.equal(barkText({ unit: gb, line: 'unknownkey' }), null);
  for (const k of ['select', 'ack_move', 'ack_act']) assert.ok(ACK_KEYS.has(k));
  assert.ok(!ACK_KEYS.has('hurt'));
});

test('ui: failure reasons map to §8.1 strings', () => {
  assert.equal(failureText('all commandos dead'), 'ALL YOUR MEN HAVE DIED OR HAVE BEEN CAPTURED.');
  assert.equal(failureText('a commando died'), 'ONE OR MORE OF YOUR MEN DIED…');
  assert.equal(failureText('The general escaped'), 'THE GENERAL ESCAPED.');
  assert.equal(failureText(''), 'MISSION FAILED.');
});

test('ui: cursor sprites cover §5.3 and map ability cursors by name', () => {
  for (const id of ['move', 'activate', 'hand', 'grab', 'climb', 'barrel', 'knife', 'pistol', 'scope', 'crosshair', 'syringe', 'cap', 'harpoon', 'grenade', 'pliers', 'trap', 'bomb', 'eye', 'track', 'arrow']) {
    assert.ok(CURSORS[id]?.svg.startsWith('<svg'), `sprite ${id}`);
  }
  assert.equal(CURSORS.scope.size, 88);
  assert.equal(spriteFor('knife'), 'knife');
  assert.equal(spriteFor('sniperRifle'), 'scope');
  assert.equal(spriteFor('lethalInjection'), 'syringe');
  assert.equal(spriteFor('distract'), 'cap');
  assert.equal(spriteFor('wireCutters'), 'pliers');
  assert.equal(spriteFor('timeBomb'), 'bomb');
  assert.equal(spriteFor('smg'), 'crosshair');
  assert.equal(spriteFor('zzz'), 'target');
  assert.equal(spriteFor(''), null);
});

test('ui: tooltip labels for enemies, things and the escape vehicle (§6.4)', () => {
  assert.equal(entityLabel({ kind: 'enemy', soldierType: 'mg' }), 'MACHINE GUNNER');
  assert.equal(entityLabel({ kind: 'enemy', soldierType: 'officer' }), 'SERGEANT');
  assert.equal(entityLabel({ kind: 'interactable', type: 'barrel' }), 'EXPLOSIVE BARREL');
  assert.equal(entityLabel({ kind: 'interactable', type: 'barracks' }), 'GARRISON');
  assert.equal(entityLabel({ kind: 'vehicle', id: 9, vehicleType: 'truck' }, { extraction: { vehicleId: 9 } }), 'ESCAPE: TRUCK');
  assert.equal(entityLabel(null), null);
});

test('ui: portrait state glyphs (§6.1 table) and options cover every default', () => {
  assert.equal(portraitGlyph({ state: 'jailed' }), 'bars');
  assert.equal(portraitGlyph({ state: 'inVehicle' }), 'vehicle');
  assert.equal(portraitGlyph({ state: 'active', hidden: true }), 'house');
  assert.equal(portraitGlyph({ state: 'active', buried: true }), 'shovel');
  assert.equal(portraitGlyph({ state: 'active', underwater: true }), 'bubbles');
  assert.equal(portraitGlyph({ state: 'active' }), '');
  const keys = OPTION_ROWS.filter((r) => r[0] !== 'h' && r[0] !== 'rule').map((r) => r[0]);
  for (const k of keys) assert.ok(k in OPTION_DEFAULTS, `option ${k} has a default`);
  for (const k of Object.keys(OPTION_DEFAULTS)) assert.ok(keys.includes(k), `option ${k} is in the panel`);
});

test('§6.6 mission dates display as "Feb 20, 1941" in the briefing and Briefing Notes (regression: showed ISO)', async () => {
  const { formatMissionDate, BEL_CATALOGUE } = await import('../../src/ui/catalogue.js');
  assert.equal(formatMissionDate('1941-02-20'), 'Feb 20, 1941');
  assert.equal(formatMissionDate('1944-12-05'), 'Dec 5, 1944');
  assert.equal(formatMissionDate('Feb 20, 1941'), 'Feb 20, 1941');
  assert.equal(formatMissionDate(''), '');
  assert.equal(formatMissionDate(undefined), '');
  for (const c of BEL_CATALOGUE) assert.ok(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(formatMissionDate(c.date)), `${c.id}: ${c.date}`);
  const fs = await import('node:fs');
  for (const f of ['briefing.js', 'notebook.js']) {
    const src = fs.readFileSync(new URL(`../../src/ui/${f}`, import.meta.url), 'utf8');
    assert.ok(/formatMissionDate\(/.test(src), `${f} must format the mission date for display`);
  }
});
