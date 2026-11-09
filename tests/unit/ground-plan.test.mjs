// The main menu's ground fight (src/ui/ground-plan.js; user: "Can we have rhe soldiers fighting and maybe a tank
// crossing the bridge shooting"): each theatre's seeded fights are deterministic and 20-32 s long; every soldier
// stays on dry ground (never in the river), the tank on the bridge deck and its roads; shells land by the men they
// are fired at; and on every captured screen (tests/unit/fixtures/menu-regions.mjs) a fight either sits clear of the
// card's text with at least 70% of its actors in view and clear of the badge (the desert's third variant sits in the open
// sand under the badge on the tall screens), or is not played there at all (a portrait phone's badge over the river's bank).
import { test, assert } from './lib.mjs';
import { STAGES, GROUND_OF, SEAT_MIN, behindBadge, groundPlan, projector, soldierAt, tankAt, seatGround, variantOrder } from '../../src/ui/ground-plan.js';
import { MENU_REGIONS, badgeGrid } from './fixtures/menu-regions.mjs';

const THEATRES = Object.keys(STAGES);
const DATA = {};
for (const th of THEATRES) DATA[th] = (await import(`../../src/ui/ground-data/${th}.js`)).default;
const SEEDS = [1, 2, 3, 4];

const inPoly = (poly, x, z) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[2] - a[2], L = dx * dx + dz * dz || 1;
  const f = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / L));
  return Math.hypot(p[0] - a[0] - f * dx, p[2] - a[2] - f * dz);
};

test('ground fight: a theatre\'s fights are deterministic for a seed, 20-32 s, with both sides firing', () => {
  for (const th of THEATRES) {
    for (const seed of SEEDS) {
      const a = groundPlan(th, seed), b = groundPlan(th, seed);
      assert.ok(a.dur >= 20 && a.dur <= 32, `${th}/${seed}: ${a.dur} s`);
      assert.deepEqual(JSON.stringify(a.soldiers.map((s) => s.segs)), JSON.stringify(b.soldiers.map((s) => s.segs)), `${th}/${seed}: the same fight`);
      for (const side of ['ally', 'axis']) assert.ok(a.soldiers.some((s) => s.side === side && s.shots.length >= 2), `${th}/${seed}: the ${side} fire`);
    }
    assert.notDeepEqual(JSON.stringify(groundPlan(th, 1).soldiers[0].segs), JSON.stringify(groundPlan(th, 5).soldiers[0].segs), `${th}: seeds vary it`);
  }
});

test('ground fight: soldiers stay on dry ground, the tank on the bridge deck and its roads, shells by their men', () => {
  for (const th of THEATRES) {
    const G = GROUND_OF[th];
    for (const seed of SEEDS) {
      const p = groundPlan(th, seed);
      for (let t = 0; t <= p.dur; t += 0.25) {
        for (const [i, s] of p.soldiers.entries()) {
          const a = soldierAt(s, t, p.dur);
          if (a && G.water?.length) assert.ok(!inPoly(G.water, a.p[0], a.p[2]), `${th}/${seed}: soldier ${i} in the water at ${t} s (${a.p})`);
          if (a && G.land) assert.ok(G.land.some((L) => inPoly(L, a.p[0], a.p[2])), `${th}/${seed}: soldier ${i} off the quays at ${t} s (${a.p})`);
        }
        const k = p.tank && tankAt(p.tank, t);
        if (k) {
          const L = G.tank.line, d = Math.min(...L.slice(1).map((b, j) => segDist(k.p, L[j], b)));
          assert.ok(d <= G.tank.half, `${th}/${seed}: the tank ${d.toFixed(1)} m off its road at ${t} s`);
        }
      }
      for (const sh of p.shells || []) {
        const near = Math.min(...p.soldiers.filter((s) => s.side === 'ally').map((s) => {
          const a = soldierAt(s, sh.t + sh.flight, p.dur);
          return a ? Math.hypot(a.p[0] - sh.target[0], a.p[2] - sh.target[2]) : Infinity;
        }));
        assert.ok(near < 9, `${th}/${seed}: a shell lands ${near.toFixed(1)} m from the nearest man it was fired at`);
      }
    }
  }
});

test('ground fight: a commando falls just after the first shell bursts by him (cause, then effect)', () => {
  const p = groundPlan('temperate', 2), sh = p.shells[0], burst = sh.t + sh.flight;
  const fallen = p.soldiers.filter((s) => s.side === 'ally' && s.segs.some((g) => g.act === 'die'));
  assert.ok(fallen.length === 1, 'one commando falls');
  const t0 = fallen[0].segs.find((g) => g.act === 'die').t0;
  assert.ok(t0 > burst && t0 < burst + 0.5, `he falls ${(t0 - burst).toFixed(2)} s after the burst`);
});

test('ground fight: on every screen it either sits clear of the card\'s text with most of it in view, or is not played', () => {
  const played = {};
  for (const [ff, R] of Object.entries(MENU_REGIONS)) {
    const region = { ...R, badge: badgeGrid(R) };
    for (const th of THEATRES) {
      for (const seed of SEEDS) {
        // as menu-ground: the seed's variant, else the next that sits on this screen (the fallbacks last)
        let st = null, plan = null;
        for (const vi of variantOrder(th, seed)) {
          plan = groundPlan(th, seed, vi);
          const s2 = seatGround(plan, DATA[th], region);
          if (s2.why) { assert.match(s2.why, /over the text/); continue; }
          if (s2.seen >= SEAT_MIN) { st = s2; break; }
        }
        if (!st) continue;
        played[`${ff}/${th}`] = (played[`${ff}/${th}`] || 0) + 1;
        assert.ok(st.box.w > 0 && st.box.h > 0 && st.box.x >= 0 && st.box.y >= 0, `${ff}/${th}/${seed}: ${JSON.stringify(st.box)}`);
        // checked on its own, by the actors' screen boxes (a man 2 m wide and 2.1 m tall at his feet, the tank 7.2 by 2.8):
        // at least 70% of them are on the screen and not wholly behind the badge
        const P = projector(DATA[th], R.k, R.ox), pxm = (z) => DATA[th].p11 * 540 / z * R.k;
        let n = 0, clear = 0;
        const box = (x, y, z, hm, wm) => {
          const sc = pxm(z), l = x - wm * sc, r = x + wm * sc, t = y - hm * sc, b = y + 0.4 * sc;
          n++;
          if (r < 0 || l > R.w || b < 0 || t > R.h || behindBadge(region, l, t, r, b)) return;
          clear++;
        };
        for (let t = 0; t <= plan.end; t += 0.5) {
          for (const so of plan.soldiers) { const a = soldierAt(so, t, plan.end); if (a) box(...P(a.p[0], a.p[1], a.p[2]), 2.1, 1.0); }
          const tk = plan.tank && tankAt(plan.tank, t);
          if (tk) box(...P(tk.p[0], tk.p[1], tk.p[2]), 2.8, 3.6);
        }
        assert.ok(clear / n >= SEAT_MIN, `${ff}/${th}/${seed}: ${(100 * clear / n).toFixed(0)}% of the actors' boxes are in view and clear of the badge (at least ${100 * SEAT_MIN}%)`);
      }
    }
  }
  // (a tablet held landscape plays the river's close assault on the pit: its W bank is a strip at the screen's edge there)
  for (const ff of ['desktop', 'laptop', 'ultrawide', 'phone-land', 'tablet-land']) {
    assert.ok(played[`${ff}/temperate`] === SEEDS.length, `the river fight plays on ${ff} (${played[`${ff}/temperate`] || 0}/${SEEDS.length})`);
  }
  // the portrait and tall screens (the badge over the river's bank): the desert's open-sand variant plays on every one of them
  for (const ff of Object.keys(MENU_REGIONS)) {
    assert.ok(played[`${ff}/desert`] === SEEDS.length, `the desert fight plays on ${ff} (${played[`${ff}/desert`] || 0}/${SEEDS.length})`);
  }
});

// "Make the soldiers in the main menu look very polished and in different poses, xont just replicate the same model"
// (2026-11-08): every man of a fight has his own look (one of the game's commandos in his own kit, or a German variant),
// at least 3 per side; men side by side never show the same sprite (look, act and frame) at once; every act a fight
// gives a man was rendered for his look (ground-data's looks), and no two looks of a theatre's cast are the same model.
const { CAST } = await import('../../tools/ui/ground/cast.mjs');
const frameOf = (a) => `${a.act}:${a.frame ?? (a.act === 'run' || a.act === 'sprint' || a.act === 'crouch' ? Math.round(a.phase * 8) % 8 : Math.floor(a.phase * 4))}`;

test('ground fight: every man has his own look, at least 3 per side, and no two men side by side show the same sprite', () => {
  for (const th of THEATRES) {
    for (let v = 0; v < STAGES[th].length; v++) {
      for (const seed of SEEDS) {
        const p = groundPlan(th, seed, v), tag = `${th}/${v}/${seed}`;
        const looks = p.soldiers.map((s) => s.look);
        assert.ok(looks.every(Boolean), `${tag}: every man has a look`);
        assert.equal(new Set(looks).size, looks.length, `${tag}: no two men share a look (${looks.join(' ')})`);
        for (const side of ['ally', 'axis']) {
          const n = new Set(p.soldiers.filter((s) => s.side === side).map((s) => s.look)).size;
          assert.ok(n >= 3, `${tag}: the ${side} side has ${n} looks (at least 3)`);
        }
        let pairs = 0;
        for (let t = 0; t <= p.dur; t += 0.2) {
          const st = p.soldiers.map((s) => soldierAt(s, t, p.dur));
          for (let i = 0; i < st.length; i++) {
            for (let j = i + 1; j < st.length; j++) {
              const a = st[i], b = st[j];
              if (!a || !b || p.soldiers[i].side !== p.soldiers[j].side || Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2]) > 8) continue;
              pairs++;
              assert.ok(!(a.look === b.look && frameOf(a) === frameOf(b)), `${tag}: men ${i} and ${j} side by side in the same sprite at ${t.toFixed(1)} s`);
            }
          }
        }
        assert.ok(pairs > 0, `${tag}: some men fight side by side`);
      }
    }
  }
});

test('ground fight: running men and men holding a pose side by side are never in step', () => {
  for (const th of THEATRES) {
    for (let v = 0; v < STAGES[th].length; v++) {
      const p = groundPlan(th, 3, v);
      const pos = p.soldiers.map((s) => s.po);
      assert.ok(pos.every((x) => x >= 0 && x < 1), `${th}/${v}: phase offsets in 0..1`);
      for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
        if (p.soldiers[i].side !== p.soldiers[j].side) continue;
        const d = Math.abs(pos[i] - pos[j]), dd = Math.min(d, 1 - d);
        assert.ok(dd > 0.02, `${th}/${v}: men ${i} and ${j} share a phase offset (${pos[i].toFixed(3)}, ${pos[j].toFixed(3)})`);
      }
    }
  }
});

test('ground fight: every act a fight gives a man was rendered for his look, and no two looks are the same model', () => {
  for (const th of THEATRES) {
    const D = DATA[th], cast = CAST[th].looks;
    const makes = Object.values(cast).map((L) => JSON.stringify([L.make.role || L.make.variantId, L.make.disguise || false]));
    assert.equal(new Set(makes).size, makes.length, `${th}: a look per model (${makes.join(' ')})`);
    for (let v = 0; v < STAGES[th].length; v++) {
      for (const seed of SEEDS) {
        for (const s of groundPlan(th, seed, v).soldiers) {
          const L = D.looks?.[s.look];
          assert.ok(L, `${th}/${v}: look ${s.look} is in the sprites`);
          assert.equal(L.side, s.side, `${th}/${v}: ${s.look} fights for his own side`);
          for (const g of s.segs) {
            const need = g.act === 'die' ? (L.fall ? ['die', 'down', 'dead'] : ['die', 'dead']) : g.act === 'hit' ? ['hit', 'dead'] : [g.act];
            for (const a of need) {
              assert.ok(L.acts[a]?.frames > 0, `${th}/${v}: ${s.look} has no '${a}' sprites`);
              const k = (L.acts[a].frames > 0 && L.acts[a].headings.length) ? 1 : 0;
              assert.ok(k, `${th}/${v}: ${s.look} '${a}' has headings`);
              for (let f = 0; f < L.acts[a].frames; f++) for (const h of L.acts[a].headings) {
                assert.ok(D.cells[`${s.look}_${h}_${a}_${f}`], `${th}: cell ${s.look}_${h}_${a}_${f}`);
              }
            }
          }
        }
      }
    }
  }
});

test('ground fight: the Sapper\'s Mills bomb bursts in the river pit just before the German there is knocked down', () => {
  for (let v = 0; v < STAGES.temperate.length; v++) {
    for (const seed of SEEDS) {
      const p = groundPlan('temperate', seed, v), g = p.nades[0];
      assert.ok(g, `variant ${v}: a grenade is thrown`);
      const burst = g.t + g.flight, hit = p.soldiers.filter((s) => s.side === 'axis' && s.segs.some((x) => x.act === 'hit'));
      const near = hit.filter((s) => Math.hypot(s.at[0] - g.to[0], s.at[2] - g.to[2]) < 2.5);
      assert.equal(near.length, 1, `variant ${v}/${seed}: one German by the burst is hit`);
      const t0 = near[0].segs.find((x) => x.act === 'hit').t0;
      assert.ok(t0 > burst && t0 < burst + 0.4, `variant ${v}/${seed}: he goes down ${(t0 - burst).toFixed(2)} s after the burst`);
      const thrower = p.soldiers.find((s) => s.nades.includes(g));
      assert.ok(thrower.side === 'ally' && thrower.look === 'sp', 'the Sapper throws it');
      assert.ok(Math.hypot(g.to[0] - g.from[0], g.to[2] - g.from[2]) < 12, 'a throw of under 12 m');
    }
  }
});

// "Tank should get offscreen not disappear mid screen" (2026-11-08), and so the men: nobody fades, nobody pops in or out
// in view. On every captured screen, for the variant it plays: a man who is not at his post from the first frame comes
// in from off the screen (or from wholly behind the badge); nobody leaves before the end (the dead stay down, the living
// at their posts); the tank is off the screen at the first frame and at its last one (off the screen: behind the badge
// is not enough), and the fight runs until it has gone.
test('ground fight: nobody fades or pops in the open; the tank comes on and goes off beyond the screen\'s edge', () => {
  let tanks = 0;
  for (const [ff, R] of Object.entries(MENU_REGIONS)) {
    const region = { ...R, badge: badgeGrid(R) };
    for (const th of THEATRES) {
      for (const seed of SEEDS) {
        let plan = null;
        for (const vi of variantOrder(th, seed)) {
          const p = groundPlan(th, seed, vi), st = seatGround(p, DATA[th], region);
          if (!st.why && st.seen >= SEAT_MIN) { plan = p; break; }
        }
        if (!plan) continue;
        const tag = `${ff}/${th}/${seed} (variant ${plan.variant})`;
        const P = projector(DATA[th], R.k, R.ox), pxm = (z) => DATA[th].p11 * 540 / z * R.k;
        const boxOf = (p, hm, wm) => { const [x, y, z] = P(p[0], p[1], p[2]), sc = pxm(z); return [x - wm * sc, y - hm * sc, x + wm * sc, y + 0.4 * sc]; };
        const off = (b) => b[2] < 0 || b[0] > R.w || b[3] < 0 || b[1] > R.h;
        const fmt = (b) => b.map((v) => v.toFixed(0)).join(',');
        assert.ok(plan.end >= plan.dur, `${tag}: the fight runs to its end`);
        for (const s of plan.soldiers) {
          let first = null, gone = null;
          for (let t = 0; t < plan.end; t += 0.1) {
            const a = soldierAt(s, t, plan.end);
            if (a) {
              assert.equal(a.alpha, 1, `${tag}: ${s.look} faded at ${t.toFixed(1)} s`);
              if (!first) first = { t, a };
              assert.ok(gone == null, `${tag}: ${s.look} back at ${t.toFixed(1)} s after he was gone`);
            } else if (first && gone == null) gone = t;
          }
          assert.ok(first, `${tag}: ${s.look} takes part`);
          if (first.t > 0.05) {
            const b = boxOf(first.a.p, 2.1, 1.0);
            assert.ok(off(b) || behindBadge(region, ...b), `${tag}: ${s.look} appears at ${first.t.toFixed(1)} s in view (${fmt(b)})`);
          }
          assert.ok(gone == null, `${tag}: ${s.look} is gone at ${gone?.toFixed(1)} s, before the end (${plan.end.toFixed(1)} s)`);
        }
        if (plan.tank) {
          tanks++;
          let last = null;
          for (let t = 0; t <= plan.end + 1; t += 0.05) { const k = tankAt(plan.tank, t); if (k) { assert.equal(k.alpha, 1, `${tag}: the tank faded`); last = { t, k }; } }
          const k0 = tankAt(plan.tank, 0);
          if (k0) assert.ok(off(boxOf(k0.p, 2.8, 3.6)), `${tag}: the tank is in view at the first frame (${fmt(boxOf(k0.p, 2.8, 3.6))})`);
          const lb = boxOf(last.k.p, 2.8, 3.6);
          assert.ok(off(lb), `${tag}: the tank's last frame (${last.t.toFixed(1)} s) is in view (${fmt(lb)})`);
          assert.ok(last.t <= plan.end + 0.05, `${tag}: the fight runs until the tank has gone (${last.t.toFixed(1)} > ${plan.end.toFixed(1)} s)`);
        }
      }
    }
  }
  assert.ok(tanks >= 20, `the tank's way in and out checked on ${tanks} screens and seeds`);
});
