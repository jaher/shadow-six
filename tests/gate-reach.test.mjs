/**
 * What is drawn matches what is walkable beside M2's boom footway and at b00's lift (clipping seed 11: M2 `e6 × gate_se`
 * 6.3 cm @34 s, b00 `diver × lift1` 5.7 cm @156 s; whichever pose the audit's 0.5 s samples caught decided pass or fail).
 * The deterministic version of that luck, measured the audit's way (mesh against mesh, src/debug/clip-geom.js measurePair):
 *   1. the fork rest's side of the 0.99 m footway (the post, its footing, the pole's tip): a guard in e6's gait at t = 34 s
 *      (moveMode 'run' shown with the walk clip, 3.8 m/s: his leading boot stepped 6.3 cm into the post at the lane's mouth,
 *      pelvis at gate-local u 2.46, v 0.625) and a commando crawling, each posed at every point from which the body
 *      clearance (world/body-clearance.js bodyGap) lets him reach the rest (no closer than the 5 cm move margin to the
 *      gate's solids, no farther than `rim` m from them) × headings × gait phases;
 *   2. b00 `lift1` (a placeholder cage with no nav block: any man may cross it): a crawling commando and a man walking,
 *      anywhere in and around it.
 * None may ever be 5 cm into it. Before (master 122eba364): the guard 6.8 cm (18 of 7488 poses over 5 cm), a crawler 6.8 cm
 * (23 of 1161), a crawler 7.7 cm into the lift's 10 cm floor block (156 of 2916). The far log gate post is not part of this
 * (a crawler's limbs reach it through the body solid's margin: a separate matter, art/breakable-gates.js FORK_HALF).
 */
export const timeout = 900_000;

/**
 * Page side: pose `tag` at `poses` ([x, z, heading°, stance, moveMode, anim, speed, y?], or a grid of walkable points × headings
 * in the gate-local frame) × gait phases and measure it against `itemId` (only its parts reaching the gate-local box `part`).
 */
async function sweep(page, o) {
  return page.evaluate(async (o) => {
    const g = window.__game, G = g.game;
    await g.loadMission(o.mission); await G.mapHandle?.ready;
    await g.clipAudit();
    const CA = await import('/src/debug/clip-audit.js'), GEOM = await import('/src/debug/clip-geom.js'), BC = await import('/src/world/body-clearance.js');
    const THREE = await import('three');
    if (G.state !== 'playing') G.start();
    G.stop?.();
    const W = G.world, grid = W.grid;
    CA.refreshPoses(G, 0);
    const S0 = CA.collectStatic(G, { clutter: false }).find((it) => String(it.id) === o.itemId);
    if (!S0) return { error: `no item ${o.itemId}` };
    const cx = S0.def?.x ?? o.cx, cz = S0.def?.z ?? o.cz, rot = S0.def?.rot ?? 0, c = Math.cos(rot), s = Math.sin(rot);
    const loc = (x, z) => ({ u: +((x - cx) * c + (z - cz) * s).toFixed(3), v: +(-(x - cx) * s + (z - cz) * c).toFixed(3) });
    // the parts of interest: those with a vertex inside the gate-local box (the fork rest's post, footing, saddle, pole tip)
    let S = S0;
    if (o.part) {
      const p3 = new THREE.Vector3(), keep = S0.parts.filter((p) => {
        const pos = p.geo.attributes.position;
        for (let i = 0; i < pos.count; i++) { p3.fromBufferAttribute(pos, i).applyMatrix4(p.matrix); const q = loc(p3.x, p3.z); if (q.u >= o.part[0] && q.u <= o.part[1] && Math.abs(q.v) <= o.part[2] && p3.y <= o.part[3]) return true; }
        return false;
      });
      S = { ...S0, parts: keep };
    }
    const e = W.entities.find((x) => x.tag === o.tag);
    e.alive = true; e.state = 'active';
    const poses = [];
    if (o.poses) poses.push(...o.poses);
    else for (let u = o.u[0]; u <= o.u[1] + 1e-9; u += o.step) for (let v = o.v[0]; v <= o.v[1] + 1e-9; v += o.step) {
      const x = cx + u * c - v * s, z = cz + u * s + v * c, { i, j } = grid.worldToCell(x, z);
      if (!grid.inBounds(i, j) || !grid.isWalkable(i, j)) continue;
      for (let k = 0; k < o.headings; k++) poses.push([x, z, (k / o.headings) * 360, o.stance, o.moveMode, o.anim, o.speed]);
    }
    let n = 0, over = 0, worst = { depth: 0 };
    for (const [x, z, hdDeg, stance, mode, anim, speed, y] of poses) {
      const hd = hdDeg * Math.PI / 180;
      // (a man keeps the body clearance to the gate's solids as he moves: poses outside [5 cm, rim] of them are not in play)
      if (o.rim != null) { const gap = BC.bodyGap(W, x, z, hd, stance); if (gap < BC.MOVE_MARGIN || gap > o.rim) continue; }
      e.stance = stance; e.moveMode = mode; e._moving = true; e.speed = speed;
      e.x = x; e.z = z; e.heading = hd; e.y = y ?? (W.groundY?.(x, z) || 0);
      e._anim = null; e._setAnim(anim, { loop: true, restart: true });
      for (let ph = 0; ph < o.phases; ph++) {
        e.syncTransform?.(1);
        CA.refreshPoses(G, ph === 0 ? 0.02 : o.dt);
        const D = CA.collectDynamic(G, { near: (q) => q === e });
        if (!D.length) continue;
        n++;
        const m = GEOM.measurePair(D[0], S, { maxDepth: 1.5 });
        if (m && m.depth > 0.05) over++;
        if (m && m.depth > worst.depth) worst = { depth: m.depth, ...loc(x, z), heading: Math.round(hdDeg), phase: ph, point: m.point };
      }
    }
    return { n, over, worst, parts: S.parts.length };
  }, o);
}

export default async function gateReach(page, t) {
  const FORK = [1.8, 2.5, 0.3, 1.3]; // gate-local u from / to, |v| ≤, y ≤: the fork rest, its footing, the pole's tip
  const walk = { stance: 'stand', moveMode: 'run', anim: 'walk', speed: 3.8 }; // e6's gait at t = 34 s
  const cases = [
    { name: 'M2 fork rest, guard walking at a run\'s pace', mission: 'm02', tag: 'e6', itemId: 'gate_se', part: FORK, phases: 12, dt: 0.1, rim: 0.15, ...walk,
      u: [1.9, 2.6], v: [-0.7, 0.7], step: 0.05, headings: 12, min: 200 },
    { name: 'M2 fork rest, commando crawling', mission: 'm02', tag: 'diver', itemId: 'gate_se', part: FORK, phases: 3, dt: 0.2, rim: 0.3, stance: 'crawl', moveMode: 'walk', anim: 'crawl', speed: 0.9,
      u: [1.9, 2.8], v: [-1.2, 1.2], step: 0.1, headings: 16, min: 40 },
    { name: 'b00 lift, commando crawling', mission: 'b00', tag: 'diver', itemId: 'lift1', cx: 82, cz: 66, phases: 3, dt: 0.2, stance: 'crawl', moveMode: 'walk', anim: 'crawl', speed: 0.9,
      u: [-1.2, 1.2], v: [-1.2, 1.2], step: 0.3, headings: 12, min: 200 },
    { name: 'b00 lift, man walking', mission: 'b00', tag: 'diver', itemId: 'lift1', cx: 82, cz: 66, phases: 3, dt: 0.2, stance: 'stand', moveMode: 'walk', anim: 'walk', speed: 1.6,
      u: [-1.2, 1.2], v: [-1.2, 1.2], step: 0.3, headings: 12, min: 200 },
  ];
  for (const k of cases) {
    const r = await sweep(page, k);
    t.ok(!r.error, `${k.name}: ${r.error || 'swept'}`);
    if (r.error) continue;
    t.log(`${k.name}: ${r.n} poses against ${r.parts ?? 'all'} parts, worst ${(r.worst.depth * 100).toFixed(1)} cm ${JSON.stringify(r.worst)}`);
    t.ok(r.n >= (k.min ?? 10), `${k.name}: ${r.n} poses measured`);
    const lim = k.max ?? 0.05;
    t.ok(r.worst.depth <= lim && r.over === 0, `${k.name}: at most ${(lim * 100).toFixed(0)} cm into it (worst ${(r.worst.depth * 100).toFixed(1)} cm at ${JSON.stringify({ u: r.worst.u, v: r.worst.v, heading: r.worst.heading, phase: r.worst.phase })}; ${r.over} of ${r.n} poses over 5 cm)`);
  }
}
