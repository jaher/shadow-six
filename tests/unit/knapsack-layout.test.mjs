/**
 * The knapsack kit (user 2026-11-08: "Backpack doesn't look nice, look at original", "Items should be in 3d hanging from
 * backpack"): a closed rucksack render with each item rendered in place on it, one pre-lit layer per item. In every kit a
 * player can see (tests/knapsack-kits.mjs: every commando in every mission, BEL and BCD, the kits that change in play,
 * the largest counts, two men selected together) every item has its layer, its hit polygon and its place in the stack;
 * counts are physical units (a round per round, a Mills bomb per grenade, a charge per bomb) or the brass tag; items may
 * overlap, but each one keeps a clickable region where it is the topmost (pickKit). The browser check on desktop and
 * phones is tests/knapsack-layout.test.mjs.
 */
import { test, assert } from './lib.mjs';
import { knapsackView, knapsackKit, pickKit, inPolygon, polygonDistance, KIT_UNITS } from '../../src/ui/knapsack-model.js';
import { ICON_MANIFEST } from '../../src/ui/icon-manifest.js';
import { knapsackKits } from '../knapsack-kits.mjs';

const has = (id) => !!ICON_MANIFEST[id];

/** The knapsack.js render's input for a kit: its view and kit layers. */
export function kitOf(kit, left = false) {
  const units = kit.units.map((u, i) => ({ id: i + 1, role: u.role, alive: true, selected: true, x: 0, z: 0, inventory: new Map(Object.entries(u.inv)), ...(u.state || {}) }));
  const world = { campaign: kit.campaign, rules: kit.campaign === 'BCD' ? { id: 'BCD' } : undefined, groundAt: () => ({}) };
  const view = knapsackView(units, world);
  return { view, kit: knapsackKit(view, { left, has }) };
}

/** An item's silhouette in knapsack ref px (its layer's offset + polygon fractions of its box). */
export function polyOf(art) {
  const e = ICON_MANIFEST[art], p = e.p || [], o = e.o || [0, 0];
  const out = [];
  for (let i = 0; i + 1 < p.length; i += 2) out.push([o[0] + p[i] * e.b[0], o[1] + p[i + 1] * e.b[1]]);
  return out;
}

test('the rucksack and every item any kit shows ship as kit layers: a box on the knapsack, a hit polygon, a place in the stack', () => {
  for (const side of ['', '.left']) {
    if (side && !has('kit/pack.left')) continue;
    assert.ok(has(`kit/pack${side}`), `kit/pack${side} ships`);
    const seen = new Set();
    for (const k of knapsackKits()) {
      const { view, kit } = kitOf(k, !!side);
      if (view.mode !== 'items') continue;
      for (const { it, art, units } of kit) {
        assert.ok(art, `${k.name}: ${it.id} has a kit layer`);
        if (side) assert.ok(art.endsWith('.left'), `${k.name}: ${it.id} uses the mirrored layer (${art})`);
        for (const id of [art, ...units]) seen.add(id);
      }
    }
    for (const id of seen) {
      const e = ICON_MANIFEST[id];
      assert.ok(Array.isArray(e.o) && e.o.length === 2 && e.b[0] > 2 && e.b[1] > 2, `${id}: placed (${JSON.stringify(e.o)} ${e.b})`);
      // kit hangs off the pack but stays within the rendered frame: it may spill left / up (into the screen), not past the
      // box's right or bottom edge (the screen's edge); the mirrored set spills right instead
      const [x, y] = e.o, [w, h] = e.b;
      if (side) assert.ok(x >= -1 && x + w <= 112 + 45 && y >= -20 && y + h <= 149, `${id}: within the mirrored frame`);
      else assert.ok(x >= -45 && x + w <= 113 && y >= -20 && y + h <= 149, `${id}: within the frame (${x},${y} ${w}x${h})`);
      assert.ok(Number.isFinite(e.z), `${id}: z`);
      if (!/\/(round|grenade|charge)\.\d/.test(id)) {
        const poly = polyOf(id);
        assert.ok(poly.length >= 4, `${id}: hit polygon (${poly.length} points)`);
      }
    }
    assert.ok(seen.size > 30, `${seen.size} layers in use`);
  }
});

test('counts are physical: a round per sniper round, a Mills bomb per grenade, a charge per bomb; the rest on the brass tag', () => {
  const k = (role, inv, state) => kitOf({ name: role, campaign: 'BEL', units: [{ role, inv, state }] }).kit;
  const sn = k('sniper', { pistol: 1, sniperRifle: 7, firstAid: 4 });
  const rifle = sn.find((x) => x.it.id === 'sniperRifle');
  assert.equal(rifle.units.length, 7, 'seven rounds in the bandolier');
  assert.ok(rifle.units.every((u, i) => u === `kit/round.${i + 1}`) && !rifle.tag, 'rounds 1..7, no tag');
  assert.equal(sn.find((x) => x.it.id === 'firstAid').tag.kind, 'ticks', 'first-aid doses on the tag');
  const many = k('sniper', { pistol: 1, sniperRifle: 14 }).find((x) => x.it.id === 'sniperRifle');
  assert.ok(many.units.length === KIT_UNITS.cartridges.max && many.tag?.n === 14, 'more rounds than loops: the loops full, the number on the tag');
  const sp = k('sapper', { pistol: 1, grenade: 3, timeBomb: 2 });
  assert.deepEqual(sp.find((x) => x.it.id === 'grenade').units, ['kit/grenade.2', 'kit/grenade.3'], 'three Mills bombs (the item + two)');
  assert.deepEqual(sp.find((x) => x.it.id === 'timeBomb').units, ['kit/charge.2'], 'two charges strapped on');
  assert.equal(k('driver', { pistol: 1, smg: 40 }).find((x) => x.it.id === 'smg').tag.n, 40, 'SMG bursts on the tag');
  const spy = k('spy', { pistol: 1, lethalInjection: 1 });
  assert.equal(spy.find((x) => x.it.id === 'pistol').art, 'kit/pistol.p38', "the Spy's P38");
  const armed = k('sapper', { pistol: 1, remoteBomb: 2, detonator: 1 }, { remoteArmed: 1 });
  assert.ok(armed.some((x) => x.art === 'kit/detonator@charge'), 'the detonator hangs where the charges were once they are out');
  const gb = k('greenberet', { knife: 1, pistol: 1, decoy: 1 }, { decoyPlaced: true });
  assert.ok(gb.some((x) => x.art === 'kit/decoyActivator'), 'the activator replaces the decoy');
});

test('pickKit: the topmost silhouette under the pointer wins; off every silhouette, the nearest within the slop', () => {
  const sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
  const A = { el: 'A', z: 1, poly: sq(0, 0, 10) }, B = { el: 'B', z: 5, poly: sq(5, 5, 10) };
  assert.equal(pickKit([A, B], 7, 7), 'B', 'overlap: the higher one');
  assert.equal(pickKit([A, B], 2, 2), 'A', 'only A');
  assert.equal(pickKit([A, B], 30, 30), null, 'nothing there');
  assert.equal(pickKit([A, B], 17, 9, 3), 'B', 'within the slop of B');
  assert.ok(inPolygon(sq(0, 0, 4), 2, 2) && !inPolygon(sq(0, 0, 4), 5, 2) && Math.abs(polygonDistance(sq(0, 0, 4), 7, 2) - 3) < 1e-9, 'polygon helpers');
});

test('items may overlap, but each one keeps a clickable region where it is the topmost (every kit)', () => {
  const bad = [];
  let kits = 0;
  for (const k of knapsackKits()) {
    for (const left of [false, true]) {
      if (left && !has('kit/pack.left')) continue;
      const { view, kit } = kitOf(k, left);
      if (view.mode !== 'items') continue;
      kits++;
      const items = kit.map(({ it, art }, i) => ({ el: `${i}:${it.id}`, z: ICON_MANIFEST[art].z, poly: polyOf(art) }));
      for (const me of items) {
        const xs = me.poly.map((p) => p[0]), ys = me.poly.map((p) => p[1]);
        let mine = 0;
        for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5) {
          for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.5) {
            if (inPolygon(me.poly, x, y) && pickKit(items, x, y) === me.el) mine++;
          }
        }
        // at least ~4 x 4 ref px (8 x 8 CSS px at 1080p) of the item is its own, topmost
        if (mine * 0.25 < 16) bad.push(`${k.name}${left ? ' (left)' : ''}: ${me.el} only ${(mine * 0.25).toFixed(1)} ref px² clickable`);
      }
    }
  }
  assert.ok(kits > 60, `${kits} kits`);
  assert.ok(!bad.length, `${bad.length} items hidden under others, e.g.\n  ${bad.slice(0, 10).join('\n  ')}`);
});
