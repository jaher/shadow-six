// withMirrors (tools/solutions/ghost.mjs): one look at a world standing still refreshes each unit's mirror once — the
// first mirrorOf of him in it — and reads it as it is after that; outside a look every mirrorOf refreshes, as before.
import { test, assert } from './lib.mjs';
import { mirrorOf, ghostOn, ghost, withMirrors } from '../../tools/solutions/ghost.mjs';

const world = () => { const units = new Map(); return { units, byId: (id) => units.get(id) ?? null }; };
class Man { constructor(w, id) { this.id = id; this.world = w; this.x = 1; this.z = 2; this.heading = 0; w.units.set(id, this); } }

test('withMirrors: a look refreshes each mirror once (the first mirrorOf), the same answers as a refresh per ghost', () => {
  const w = world(), a = new Man(w, 1), b = new Man(w, 2);
  let copies = 0;
  const assign = Object.assign;
  Object.assign = function (t, ...s) { if (s[0] === a || s[0] === b) copies++; return assign.call(this, t, ...s); };
  try {
    // outside a look: every mirrorOf refreshes (two ghosts of a, one of b: three copies)
    ghost(a); ghost(a); ghost(b);
    assert.equal(copies, 3, 'a refresh per mirrorOf outside a look');
    copies = 0;
    const seen = withMirrors(() => {
      const out = [];
      for (let k = 0; k < 5; k++) { out.push(ghost(a).x); out.push(ghostOn(mirrorOf(b)).z); }
      // a look inside a look is part of it
      withMirrors(() => { out.push(ghost(a).x); });
      return out;
    });
    assert.equal(copies, 2, 'one refresh per unit in a look (a and b)');
    assert.deepEqual(seen, [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1], 'the same reads as a refresh per ghost');
    // after the look: refreshed again at each mirrorOf — a unit that moved meanwhile reads as he is now
    copies = 0;
    a.x = 7;
    assert.equal(ghost(a).x, 7);
    assert.equal(ghost(a).x, 7);
    assert.equal(copies, 2, 'a refresh per mirrorOf again once the look is over');
    // a new look reads him as he is when it starts
    a.x = 8;
    assert.equal(withMirrors(() => ghost(a).x), 8);
  } finally { Object.assign = assign; }
});

test('withMirrors: a ghost\'s own pose stays its own; the scope closes on a throw', () => {
  const w = world(), a = new Man(w, 1);
  withMirrors(() => {
    const g1 = ghost(a), g2 = ghost(a);
    g1.x = 5; g2.heading = 3;
    assert.equal(g1.x, 5); assert.equal(g2.x, 1); assert.equal(g1.heading, 0); assert.equal(g2.heading, 3);
    assert.equal(a.x, 1, 'never written through to him');
  });
  assert.throws(() => withMirrors(() => { ghost(a); throw new Error('boom'); }), /boom/);
  a.x = 4;
  assert.equal(ghost(a).x, 4, 'no look left open by the throw: refreshed again');
  // (negative control: inside a look a unit changed after his first mirrorOf is NOT seen — why nothing in a look may
  // change a unit)
  const stale = withMirrors(() => { ghost(a); a.x = 9; return ghost(a).x; });
  assert.equal(stale, 4);
  assert.equal(ghost(a).x, 9);
});
