/** §3.0 canonical names: the US-manual set is the default roster; EU variants live in an optional `names.eu` table. */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { CONFIG } from '../../src/config.js';
import { COMMANDO_LINES as BARKS } from '../../src/ui/bark-lines.js';

const CANON = {
  greenberet: ['Jerry McHale', 'Tiny'], sniper: ['Sir Francis T. Woolridge', 'Duke'], diver: ['James Blackwood', 'Fins'],
  sapper: ['Thomas Hancock', 'Inferno'], driver: ['Sid Perkins', 'Tread'], spy: ['René Duchamp', 'Spooky'],
};

test('§3.0 default roster is the canonical US-manual set (Green Beret = Jerry McHale "Tiny")', () => {
  for (const [role, [name, nickname]] of Object.entries(CANON)) {
    assert.deepEqual({ ...CONFIG.units.roster[role] }, { name, nickname }, role);
  }
  assert.equal(CONFIG.units.nameLocale, null, 'EU locale is off by default');
});

test('§3.0 EU variants live only in the optional names.eu table', () => {
  const eu = CONFIG.units.names.eu;
  assert.deepEqual({ ...eu.greenberet }, { name: "Jack O'Hara", nickname: 'Butcher' });
  assert.equal(eu.sapper.nickname, 'Fireman');
  assert.equal(eu.spy.nickname, 'Frenchy');
  const flat = JSON.stringify(CONFIG.units.roster);
  for (const w of ["O'Hara", 'Butcher', 'Fireman', 'Frenchy']) assert.ok(!flat.includes(w), `${w} not in default roster`);
});

test('§3.0 spawned commandos carry canonical names; nameLocale "eu" swaps in the variants', () => {
  const spawn = () => makeSim({ commandos: [{ role: 'greenberet', x: 5, z: 5 }, { role: 'sapper', x: 7, z: 5 }, { role: 'spy', x: 9, z: 5 }] });
  let s = spawn();
  assert.equal(s.cmd('greenberet').name, 'Jerry McHale');
  assert.equal(s.cmd('greenberet').nickname, 'Tiny');
  assert.equal(s.cmd('sapper').nickname, 'Inferno');
  const prev = CONFIG.units.nameLocale;
  try {
    CONFIG.units.nameLocale = 'eu';
    s = spawn();
    assert.equal(s.cmd('greenberet').name, "Jack O'Hara");
    assert.equal(s.cmd('greenberet').nickname, 'Butcher');
    assert.equal(s.cmd('sapper').name, 'Thomas Hancock', 'EU table only overrides the nickname');
    assert.equal(s.cmd('sapper').nickname, 'Fireman');
    assert.equal(s.cmd('spy').nickname, 'Frenchy');
  } finally { CONFIG.units.nameLocale = prev; }
});

test('§3.0 roster name agrees with the Green Beret select bark ("McHale.")', () => {
  const surname = CONFIG.units.roster.greenberet.name.split(' ').pop();
  assert.ok(JSON.stringify(BARKS.greenberet.select).includes(`${surname}.`), 'bark names the roster surname');
});
