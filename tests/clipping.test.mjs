/**
 * Clipping / interpenetration guard (src/debug/clip-audit.js): for every audited mission, the static audit
 * (all static render items + parked vehicles + spawned characters) and the turret sweep must not find an unintended
 * overlap that is missing from tests/clip-baseline.json. Accepted overlaps live in the baseline; regenerate with
 *   node tools/audit/clipping.mjs --dynamic 0 --write-baseline
 * The dynamic audit (sim run) is tools-only: too long for the per-test timeout.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffBaseline } from '../src/debug/clip-rules.js';
import { TESTS_DIR } from './harness.mjs';

const MISSIONS = ['m00', 'm01', 'm02', 'm03', 'b00'];

export default async function (page, t) {
  const baseline = JSON.parse(readFileSync(join(TESTS_DIR, 'clip-baseline.json'), 'utf8'));
  const fresh = [];
  for (const id of MISSIONS) {
    await page.evaluate((m) => window.__game.loadMission(m), id);
    await page.evaluate(() => window.__game.clipAudit());
    const st = await page.evaluate(() => window.__game.clip.static());
    const tu = await page.evaluate(() => window.__game.clip.turrets());
    t(st.items > 10, `${id}: static items collected (${st.items})`);
    // placement rule (e): the visuals' reach beyond their footprints is in the nav (steps, legs, porches, wall caps)
    const nav = await page.evaluate(() => { const g = window.__game.game.world.grid; let n = 0; for (const v of g.navBlock) if (v) n++; return n; });
    t(nav > 0, `${id}: visual nav blocks stamped (${nav} cells)`);
    const d = diffBaseline([...st.findings, ...tu.findings], baseline, id);
    t.log(`${id}: ${st.items} items, ${st.findings.length} contacts, ${d.accepted.length} accepted, ${d.fresh.length} new, ${d.gone.length} fixed (${st.ms} ms)`);
    if (id === 'm01') {
      // detector sanity (user report: "turrets crossing a fence"): park the MG nest 0.7 m south of barracks barr_2
      // (x 8..20, z 29..35); its barrel must be caught crossing the wall when the sweep points it north. The gun stands
      // closer than its barrel reach (emplacement placeholder barrel 0.9 m → 0.5 m away; the library MG 34 on its tripod, 0.55 m → 0.3 m)
      const probe = await page.evaluate(() => {
        const v = window.__game.game.world.entities.find((e) => e.tag === 'mg1_gun');
        v.x = 14; v.z = 35 + Math.min(0.7, (v.model.gun?.len ?? 1.2) * 0.55); v.giro = null; v.syncTransform(1); v.object3d.updateMatrixWorld(true);
        const raw = window.__game.clip.turrets({ raw: true }), ruled = window.__game.clip.turrets();
        const arc = v.gunArc(), closed = arc.filter((a) => a === Infinity).length, lifted = arc.filter((a) => a > 0 && a !== Infinity).length;
        return { raw, ruled, closed, lifted };
      });
      const hit = probe.raw.findings.find((f) => f.b.id === 'barr_2');
      t(hit && hit.a.cat === 'turret' && !hit.allowed, 'turret sweep catches a gun barrel through a building wall');
      t.log(`turret probe: barrel × barr_2 depth ${hit.depth} m at ${hit.angleDeg}°`);
      // placement rule (d): the same gun in play never swings its barrel into the wall (arc closed / lifted)
      t(!probe.ruled.findings.some((f) => f.b.id === 'barr_2'), `rule (d): no barrel through barr_2 in play (${probe.closed} closed, ${probe.lifted} lifted of 72 steps)`);
      t.log(`turret rule: ${probe.closed} × 5° closed, ${probe.lifted} lifted`);
    }
    // rule (b) seating: no prop hangs over a dip or sinks into a bump (flat bottom vs the terrain under it)
    const fl = await page.evaluate(() => window.__game.clip.floating());
    t(!fl.findings.length, `${id}: no floating / buried props (${fl.tested} tested)${fl.findings.length ? ': ' + JSON.stringify(fl.findings.slice(0, 3)) : ''}`);
    // rule (d) for content the maps don't have yet: tanks / armoured cars parked wherever they can really drive beside
    // every wall, fence and building side (eaves, porch roofs, boughs included) never swing a barrel through them
    const tp = await page.evaluate(() => window.__game.clip.turretProbe({ maxSpots: 40 }));
    const deep = tp.findings.filter((f) => f.depth > 0.08);
    t(!deep.length, `${id}: turret probe (${tp.tests} parked guns) clear${deep.length ? ': ' + deep.slice(0, 3).map((f) => `${f.probe} × ${f.b.id} ${f.depth} m @${f.angleDeg}°`).join('; ') : ''}`);
    if (id === 'm02') {
      // rule (e) bodies: the wall-walk sentry e5 dies beside the palisade stakes (verifier: corpse draped through them)
      const body = await page.evaluate(() => {
        const G = window.__game.game, e = G.world.entities.find((x) => x.tag === 'e5');
        if (G.state !== 'playing') G.start();
        e.die('test');
        let worst = null;
        for (let k = 0; k < 8; k++) {
          G.advance(0.5);
          const f = window.__game.clip.entity('e5', { dt: 0.5, minDepth: 0.05 }).findings[0];
          if (f && (!worst || f.depth > worst.depth)) worst = { b: f.b.id, depth: f.depth };
        }
        return { worst, x: e.x, z: e.z };
      });
      t(!body.worst, `rule (e): e5's body lies clear of the palisade (${body.worst ? `${body.worst.b} ${body.worst.depth} m` : `at ${body.x.toFixed(2)}, ${body.z.toFixed(2)}`})`);
    }
    for (const f of d.fresh) fresh.push(`${f.key} depth ${f.depth} m contact ${f.contact} m at (${f.point.x}, ${f.point.y}, ${f.point.z})`);
  }
  t(!fresh.length, `new unintended overlaps (fix them, or accept via tools/audit/clipping.mjs --write-baseline):\n  ${fresh.join('\n  ')}`);
}
