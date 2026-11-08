// The main menu's dogfight choreographies and their seat on every form factor (src/ui/dogfight-plan.js; user: "Can
// we have a dog fight between airplanes after planes pass by in the main menu"): each seeded fight is deterministic,
// 15-25 s, Bf 109s and Spitfires banking through real turns, short bursts, one 109 hit and diving away; and on every
// captured screen (tests/unit/fixtures/menu-regions.mjs) and theatre it is placed in the open sky — no plane ever over
// the card's text, none under the skyline but the hit 109 going down behind it, every plane flying in from off the
// screen and out of it, the hit itself in open sky, most of the fight not behind the badge.
import { test, assert } from './lib.mjs';
import { FIGHTS, DT, FADE, LEN, PRE, plan, place, regionOf, sample, skyline, view, attitude } from '../../src/ui/dogfight-plan.js';
import { STILL_SCENES, STILL_THEATERS } from '../../src/ui/menu-model.js';
import { MENU_REGIONS, badgeGrid } from './fixtures/menu-regions.mjs';

const NAMES = Object.keys(FIGHTS);
const SEEDS = [1, 2, 3];
const DEG = 180 / Math.PI;
const pxmOf = (S) => S.zones.reduce((a, z) => a + z.pxm, 0) / S.zones.length;

test('dogfight: a few choreographies, each 15-25 s, deterministic for a seed, different between seeds', () => {
  assert.ok(NAMES.length >= 3, `three or more choreographies (${NAMES})`);
  for (const name of NAMES) {
    const a = plan(5, name), b = plan(5, name), c = plan(6, name);
    assert.ok(a.dur >= 15 && a.dur <= 25, `${name}: ${a.dur} s`);
    for (let i = 0; i < a.cast.planes.length; i++) {
      assert.deepEqual([...a.cast.planes[i].x], [...b.cast.planes[i].x], `${name}: plane ${i} flies the same path for the same seed`);
    }
    const moved = a.cast.planes.some((p, i) => p.x.some((v, k) => Math.abs(v - c.cast.planes[i].x[k]) > 1));
    assert.ok(moved, `${name}: another seed flies it a little differently`);
  }
  assert.deepEqual(NAMES.map((_, i) => plan(i).name).sort(), [...NAMES].sort(), 'the seed alternates the choreographies');
});

test('dogfight: Bf 109s and Spitfires, bursts, one 109 hit by a Spitfire that dives away and down', () => {
  for (const name of NAMES) {
    for (const seed of SEEDS) {
      const { cast, dur } = plan(seed, name), real = cast.planes.filter((p) => !p.ghost);
      const kinds = real.map((p) => p.kind);
      assert.ok(kinds.filter((k) => k === 'spit').length >= 2 && kinds.filter((k) => k === 'bf109').length >= 2, `${name}/${seed}: ${kinds}`);
      assert.ok(cast.bursts.length >= 4 && cast.bursts.every((b) => b.dur >= 0.25 && b.dur <= 0.6), `${name}/${seed}: short bursts`);
      assert.ok(cast.bursts.some((b) => cast.planes[b.s].kind === 'bf109') && cast.bursts.some((b) => cast.planes[b.s].kind === 'spit'), 'both sides fire');
      const k = cast.kill, g = cast.planes[k.g];
      assert.ok(g.kind === 'bf109' && cast.planes[k.s].kind === 'spit' && k.t > 4 && k.t < dur - 6, `${name}/${seed}: the hit ${JSON.stringify(k)}`);
      assert.ok(cast.bursts.some((b) => b.s === k.s && b.g === k.g && b.t0 < k.t && b.t0 + b.dur > k.t - 1), 'the Spitfire fires just before the hit');
      const q0 = sample(g, k.t), q1 = sample(g, k.t + 3);
      assert.ok(q0.y - q1.y > 25, `${name}/${seed}: it goes down (${(q0.y - q1.y).toFixed(0)} m in 3 s)`);
      assert.ok(Math.sin(sample(g, k.t + 2).hd) > 0.3, `${name}/${seed}: away from the viewer`);
    }
  }
});

test('dogfight: banking reads — every plane rolls into real turns (bank from the turn rate) and changes heading', () => {
  for (const name of NAMES) {
    const { cast, dur } = plan(2, name);
    for (const [i, p] of cast.planes.entries()) {
      if (p.ghost) continue;
      let bank = 0, h0 = null, swing = 0;
      for (let t = 2.5; t < dur - 3.5; t += DT) {
        const q = sample(p, t);
        bank = Math.max(bank, Math.abs(q.bk));
        if (h0 !== null) swing += Math.abs(Math.atan2(Math.sin(q.hd - h0), Math.cos(q.hd - h0)));
        h0 = q.hd;
      }
      assert.ok(bank * DEG > 40, `${name}: plane ${i} banks ${(bank * DEG).toFixed(0)} deg`);
      assert.ok(swing * DEG > 120, `${name}: plane ${i} turns ${(swing * DEG).toFixed(0)} deg in all`);
    }
  }
});

test('dogfight: view() picks the turntable cell the way the planes fly (mirrored leftward, yaw toward the viewer)', () => {
  const n = 12, mk = (dx, dy, dz) => {
    const p = { kind: 'spit', x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n) };
    for (let k = 0; k < n; k++) { p.x[k] = dx * k * DT; p.y[k] = dy * k * DT; p.z[k] = dz * k * DT; }
    return p;
  };
  const c = attitude({ n, planes: [mk(50, 0, 0), mk(-50, 0, 0), mk(0, 0, -50), mk(0, 0, 50), mk(50, 20, 0)] });
  const at = { mirror: 1, rot: 0, q: 1, c: 1, s: 2, cx: 500, cy: 100 }, v = c.planes.map((p) => view(p, at, 0.15));
  assert.ok(Math.abs(v[0].yaw) < 1 && !v[0].flip && Math.abs(v[1].yaw) < 1 && v[1].flip, 'side on: right as drawn, left mirrored');
  assert.ok(v[2].yaw > 89 && v[3].yaw < -89, 'head-on toward the viewer +90, going away -90');
  assert.ok(Math.abs(v[4].pitch - Math.atan2(20, 50) * DEG) < 0.5, `climbing: the cell turns nose up (${v[4].pitch})`);
  const m = view(c.planes[0], { ...at, mirror: -1 }, 0.15);
  assert.ok(m.flip && m.x < at.cx, 'the mirrored stage flies it leftward');
  assert.equal(v[0].len, LEN.spit * at.s, 'its length at the stage depth');
});

test('dogfight: the skyline maps the still\'s fractions onto the covered screen', () => {
  const sky = new Array(65).fill(0).map((_, i) => 0.2 + 0.001 * i), w = 390, k = 0.78148, ox = -555.22;
  const s = skyline(sky, w, k, ox, 64);
  for (const j of [0, 32, 64]) {
    const u = (j * w / 64 - ox) / (1920 * k);
    assert.ok(Math.abs(s[j] - (0.2 + 0.064 * u) * 1080 * k) < 0.05, `column ${j}`);
  }
});

/** A placed fight's planes checked every 0.1 s against the raw (unpadded) text box and the skyline. */
function audit(p, at, R, region, tag) {
  const cw = R.w / R.cols, sky = region.sky;
  const skyAt = (x) => { const u = Math.max(0, Math.min(R.cols - 1e-6, x / cw)), i = Math.floor(u); return sky[i] + (sky[i + 1] - sky[i]) * (u - i); };
  const [tl, tt, tr, tb] = R.text, k = p.cast.kill;
  for (const [i, q] of p.cast.planes.entries()) {
    if (q.ghost) continue;
    for (let j = 0, t = at.t0; t <= p.dur + 1e-6; t = at.t0 + ++j * 0.1) {
      const v = view(q, at, t), e = 0.5 * v.len;
      const on = v.x > -e && v.x < R.w + e && v.y > -e && v.y < R.h + e && v.r >= FADE[0];
      if (!on) continue;
      assert.ok(!(v.x + e > tl && v.x - e < tr && v.y + e > tt && v.y - e < tb), `${tag}: plane ${i} over the card's text at ${t.toFixed(1)} s`);
      const diving = i === k.g && t > k.t + 0.6;
      if (diving && v.y - 0.2 * e > skyAt(v.x)) continue; // gone down behind the far ground (drawn clipped to the sky)
      assert.ok(diving || v.y + 0.4 * e <= skyAt(v.x), `${tag}: plane ${i} under the skyline at ${t.toFixed(1)} s`);
      assert.ok(t > at.t0 + 1e-6 && t < p.dur - 1e-6, `${tag}: plane ${i} on screen at the start or the end (${t.toFixed(1)} s)`);
    }
  }
}

test('dogfight: every choreography is seated on every form factor and theatre — open sky, never over the text', () => {
  for (const [ff, R] of Object.entries(MENU_REGIONS)) {
    const badge = badgeGrid(R);
    assert.equal(R.badge.split(',').reduce((a, n) => a + +n, 0), R.cols * R.rows, `${ff}: the fixture's grid is whole`);
    for (const th of STILL_THEATERS) {
      const S = STILL_SCENES[th], region = regionOf({ ...R, sky: S.sky, pxm: pxmOf(S), badge });
      let best = 0;
      for (const name of NAMES) {
        const p = plan(1, name), at = place(p, region), tag = `${ff}/${th}/${name}`;
        assert.ok(at, `${tag}: seated`);
        assert.ok(at.s >= region.sMin - 1e-6 && at.s <= region.sMax + 1e-6 && at.t0 >= -PRE && at.t0 <= 0, `${tag}: ${JSON.stringify(at)}`);
        assert.ok(at.open >= 0.4, `${tag}: ${(at.open * 100).toFixed(0)} % of the fight in open sky`);
        audit(p, at, R, region, tag);
        best = Math.max(best, at.open);
      }
      // menu-dogfight.js flies the next in turn unless it shows < 70 %: then the best one (the narrowest phone, a
      // foldable's 360 px outer screen under its enlarged badge, keeps a little less in the open)
      assert.ok(best >= (R.w < 380 ? 0.6 : 0.7), `${ff}/${th}: the best seat shows ${(best * 100).toFixed(0)} % of its fight`);
    }
  }
});

test('dogfight: seated the same way every time (the GPU test and the media depend on it)', () => {
  const R = MENU_REGIONS.desktop, S = STILL_SCENES.temperate, region = regionOf({ ...R, sky: S.sky, pxm: pxmOf(S), badge: badgeGrid(R) });
  for (const name of NAMES) assert.deepEqual(place(plan(3, name), region), place(plan(3, name), region), name);
});
