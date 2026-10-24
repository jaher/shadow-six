/**
 * A drum flanked by two others (M1's b1 between b2/b3, 0.75 m to each side): from the south, body-clearance's
 * substituted approach goal — the nearest mask-free cell, the flanking drums' inflated discs (r 0.42 + 0.4
 * inflation + cell slack = 1.174 m) blanketing every cell within reach — sat 1.251 m from its centre, 0.051 m
 * beyond the hand's 1.2 m reach, so the pick-up order idled at the plan's end until the 30 s approach timeout
 * dropped it. The approach now re-plans that leg on the bare grid once re-planning provably returns the same
 * end (Commando._updatePending); the step guard still keeps his body out of the drums themselves.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';

// M1's cluster at its own coordinates (the grid phase is part of the defect).
const DRUMS = [
  { kind: 'barrel', id: 'b1', x: 42.8, z: 22.0 },
  { kind: 'barrel', id: 'b2', x: 43.46, z: 22.31 },
  { kind: 'barrel', id: 'b3', x: 42.05, z: 22.29 },
];
const clusterSim = (gx, gz) => makeSim(
  { size: [60, 60], commandos: [{ role: 'greenberet', x: gx, z: gz, heading: 0 }], interactables: DRUMS.map((d) => ({ ...d })) },
  { brains: false });

test('barrel cluster: a flanked drum is picked up from the south (its blind side)', () => {
  const s = clusterSim(42.8, 28), gb = s.cmd('greenberet'), b = s.get('b1');
  assert.ok(gb.issue({ type: 'ability', id: 'hand', target: b }));
  const done = s.run(15, () => gb.carrying === b);
  assert.ok(done, `he takes the drum (t=${s.world.time.toFixed(1)}, d=${Math.hypot(b.x - gb.x, b.z - gb.z).toFixed(3)})`);
  assert.equal(gb.carrying, b);
});

test('barrel cluster: the same drum from the north and east still picks up as before', () => {
  for (const [gx, gz] of [[42.8, 16], [48.8, 22.0]]) {
    const s = clusterSim(gx, gz), gb = s.cmd('greenberet'), b = s.get('b1');
    assert.ok(gb.issue({ type: 'ability', id: 'hand', target: b }));
    assert.ok(s.run(15, () => gb.carrying === b), `from (${gx},${gz})`);
    assert.equal(gb.carrying, b);
  }
});
