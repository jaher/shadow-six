/**
 * M3 "Reverse Engineering" (Sysendam dam): a full stealth solution, played only with player orders.
 * Driver API: tools/solutions/driver.mjs. Reference run, in the real game: node tools/solutions/run-browser.mjs m03
 * (also tests/m03-solution.test.mjs). run-headless.mjs is a quick approximation only: the headless grid lacks the
 * library meshes' nav clearance, so timings there drift from the game's.
 *
 * Outline (design-spec §7.6 "Intended solution", adapted to the re-authored dam that faces the camera):
 *   A  plateau: the Sapper's bear trap takes the p1 sergeant (e1); the GB's decoy freezes e2/e3 for the Marine's harpoon
 *   B  gully: the GB knifes e5 and e4 from behind and carries both bodies up onto the plateau
 *   C  the Marine and the Spy crawl to the raft; the raft takes the Spy to the clothesline: she puts on the uniform
 *   D  the Spy walks over the dam crest (out of every cone 7 m up), through the N gate, cuts the fence power at the
 *      admin-block switch and chats up e17 (from his W side: he turns his back on the river and the shed)
 *   E  the GB's decoy at the gully mouth turns e6 away from the river; GB + Sapper cross; the Sapper cuts the fence,
 *      takes both charges from the shed and comes back; the GB fetches his decoy
 *   F  the Spy switches to e18 at the N gate; the raft drops the GB on the S shore (37 m from e6) as p5 walks off west:
 *      he wades to the snow (no boot prints), crawls to the N gate, drops the decoy and digs himself in beside it
 *   G  decoy on: the bunker gunner turns to it and p5 come to stare at it; the Sapper lands from the raft and plants
 *      charge one on the bunker's blind NE side — the bunker goes up (o1)
 *   H  after the alarm dies down the GB carries the decoy 9 m W of e18 along the N fence (digging in whenever a
 *      cone would sweep over him), crawls round the bunker ruin and up the W stair, and switches it on from there:
 *      e18 turns his back on the dam, p5 / e19 / the new squad gather at it, far from the dam's foot. The Spy
 *      crawls (no prints to follow) to the W stair; both cross the crest to the truck road
 *   I  the raft lands Marine and Sapper by the dam; the Sapper walks out on the toe ledge and plants charge two (o2)
 *   J  the truck comes for them north of the dam; all four get in (o3)
 * Orders only (move / run / crawl / stance / ability / leave & board vehicles); timing reads what a player sees.
 */

// p5 (the 5-man squad circling the bunker): on its W leg, west of x
const p5West = (D, x) => { const e = D.get('e29'); return e.x < x && Math.cos(e.heading) < -0.5; };
// p5 has just left its E-end halt at (30,54) and walks west — all five of them, the rear men included
const P5 = ['e29', 'e30', 'e31', 'e32', 'e33'];
const p5Departed = (D) => P5.every((t) => { const e = D.get(t); return !e.alive || (e.x < 29.3 && e.x > 18 && Math.cos(e.heading) < -0.5); });
const objective = (D, id) => D.world.objectives.find((q) => q.id === id).done;
const deg = (h) => ((h * 180) / Math.PI + 360) % 360;

/** wait (up to maxSec) until nobody will see a standing man at any of `pts` for the next `dur` s */
async function clearWindow(D, pts, dur = 4, maxSec = 150, label = 'clear window', extra = null) {
  await D.until(() => (!extra || extra()) && pts.every(([x, z]) => D.clearAhead(x, z, dur)), maxSec, label);
}
// p5 on the far (west) half of its loop: 35 m+ from the river strip below the station's NE fence
const p5FarWest = (D) => D.get('e29').x < 19;
/** step off the raft when no cone will cover the bank point, then drop prone at once */
async function landProne(D, role, x, z) {
  const u = D.c(role), raft = D.raft();
  await clearWindow(D, [[x, z], [raft.x, raft.z]], 3, 150, `${role} lands`);
  D.ability(role, 'leaveVehicle');
  await D.wait(0.05);
  if (D.world.groundAt(u.x, u.z).shallow) await D.go(role, x, z, { tol: 0.4 });
  await D.stance(role, 'crawl');
}
/** board the raft from the bank when no cone will cover him getting up and climbing in */
async function boardRaft(D, role, boardPoint, extra = null, margin = 0.8) {
  const u = D.c(role), raft = D.raft();
  let bp = boardPoint(raft, u);
  const d0 = Math.hypot(bp.x - u.x, bp.z - u.z);
  if (d0 > 0.8 && !D.world.groundAt(bp.x, bp.z).shallow) { // creep up to the hull first (prone, unseen)
    await D.go(role, bp.x + ((u.x - bp.x) / d0) * 0.4, bp.z + ((u.z - bp.z) / d0) * 0.4, { tol: 0.3 });
    bp = boardPoint(raft, u);
  }
  const dur = (u.stance === 'crawl' ? 0.6 : 0) + Math.hypot(bp.x - u.x, bp.z - u.z) / 1.5 + 0.55 + margin; // get up, walk to the hull, climb in (+ margin)
  await clearWindow(D, [[u.x, u.z], [bp.x, bp.z]], dur, 150, `${role} boards`, extra);
  D.ability(role, 'enterVehicle', raft);
  await D.until(() => u.vehicle === raft, 15, `${role} aboard`);
}

/**
 * The cautious crawl: before each leg the GB checks that nobody will see it; if someone would, he digs in where he
 * is (snow) and waits under it until the leg is clear, then digs out and goes on. `finalPause` = time spent at the end.
 */
async function crawlCautiously(D, pts, { finalPause = 0, maxWait = 900 } = {}) {
  const gb = D.c('greenberet');
  for (let k = 0; k < pts.length; k++) {
    const leg = [[pts[k][0], pts[k][1], k === pts.length - 1 ? finalPause : 0.5]];
    if (!D.routeClear('greenberet', leg, { delay: gb.buried ? 1.5 : 0.3 })) {
      if (!gb.buried) { D.ability('greenberet', 'shovel'); await D.until(() => gb.buried, 5, 'GB digs in to wait'); }
      await D.until(() => D.routeClear('greenberet', leg, { delay: 1.5 }), maxWait, `clear leg to (${pts[k]})`);
    }
    if (gb.buried) {
      D.order('greenberet', { type: 'move', x: gb.x, z: gb.z }); // digs himself out
      await D.until(() => !gb.buried && !gb.currentAction, 5, 'GB out of the snow');
      await D.stance('greenberet', 'crawl');
    }
    await D.go('greenberet', pts[k][0], pts[k][1], { tol: 0.35 });
  }
}

export const CREST_PATH = [[29.8, 29.7], [40, 22.4], [52.5, 23.6], [59.35, 34.3]]; // W end → middle → E end → E stair foot

export const STAGES = [
  ['A', 'Plateau: trap the sergeant, decoy + harpoon the troopers', async (D) => {
    const e1 = D.get('e1'), e2 = D.get('e2'), e3 = D.get('e3'), gb = D.c('greenberet'), dv = D.c('diver');
    for (const r of ['greenberet', 'diver', 'spy']) await D.stance(r, 'crawl');
    D.order('greenberet', { type: 'move', x: 108, z: 2.5 });
    D.order('diver', { type: 'move', x: 110, z: 2.5 });
    D.order('spy', { type: 'move', x: 112, z: 3.5 });
    await D.until(() => e1.x > 124, 120, 'p1 walks off east');
    // Sapper sets the bear trap on the patrol path west of the wall; the GB drops the decoy (off) beside the path
    await D.stance('sapper', 'crawl');
    D.order('sapper', { type: 'move', x: 97, z: 12.2 });
    await D.go('greenberet', 102, 15.1, { tol: 0.3 });
    await D.face('greenberet', 102, 17);
    D.ability('greenberet', 'decoyDrop');
    await D.until(() => Math.hypot(D.c('sapper').x - 97, D.c('sapper').z - 12.2) < 0.3, 60, 'Sapper at the trap spot');
    D.ability('sapper', 'trap', { x: 97, z: 13 });
    await D.wait(1.5);
    D.order('greenberet', { type: 'move', x: 107, z: 3 });
    await D.go('sapper', 109, 4.2);
    D.checkpoint('A1 trap and decoy set');
    await D.until(() => !e1.alive, 150, 'e1 steps in the trap');
    D.checkpoint('A2 sergeant e1 trapped');
    await D.until(() => e2.brain.state === 'IDLE' && e3.brain.state === 'IDLE' && e2.x < 70, 120, 'p1 calm again');
    await D.until(() => e2.x > 89, 200, 'p1 back near the decoy');
    D.ability('greenberet', 'decoyToggle');
    await D.until(() => e2.brain.state === 'DECOY' && !e2.isMoving && !e3.isMoving, 30, 'p1 staring at the decoy');
    D.checkpoint('A3 e2/e3 frozen by the decoy');
    await D.go('diver', 99.3, 6.4, { tol: 0.3 });
    D.ability('diver', 'harpoon', e3);
    await D.until(() => !e3.alive, 10, 'e3 harpooned');
    await D.until(() => D.world.time >= (dv._harpoonT ?? 0) + 0.05, 5, 'reload');
    D.ability('diver', 'harpoon', e2);
    await D.until(() => !e2.alive, 10, 'e2 harpooned');
    D.ability('greenberet', 'decoyToggle');
    D.checkpoint('A4 patrol p1 gone');
    D.order('diver', { type: 'move', x: 104, z: 2.5 }); // out of the gap at the wall's end
    await D.wait(2);
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'hand', gb.decoy);
    await D.until(() => gb.has('decoy'), 30, 'decoy picked up');
  }],
  ['B', 'Gully: knife e5 and e4, hide the bodies', async (D) => {
    const e4 = D.get('e4'), e5 = D.get('e5'), gb = D.c('greenberet');
    await D.go('greenberet', 89, 16);
    await D.go('greenberet', 83, 19, { stance: 'crawl', tol: 0.4 });
    await D.path('greenberet', [[82.5, 30], [80, 34]], { tol: 0.4 });
    D.ability('greenberet', 'knife', e5);
    await D.until(() => !e5.alive, 15, 'e5 knifed');
    D.checkpoint('B1 e5 knifed');
    await D.stance('greenberet', 'crawl');
    await D.go('greenberet', 80.5, 24.5, { tol: 0.4 });
    D.ability('greenberet', 'knife', e4);
    await D.until(() => !e4.alive, 15, 'e4 knifed');
    D.checkpoint('B2 e4 knifed');
    for (const [e, x, z] of [[e5, 84, 16], [e4, 82, 15]]) { // up on the plateau, out of e6's sight
      await D.idle('greenberet');
      await D.stance('greenberet', 'stand');
      D.ability('greenberet', 'hand', e);
      await D.until(() => gb.carrying === e || e.carriedBy === gb, 30, `lift ${e.tag}`);
      await D.go('greenberet', x, z, { tol: 0.5 });
      D.ability('greenberet', 'drop');
      await D.until(() => !gb.carrying, 5, 'drop');
      await D.wait(0.5);
    }
    D.checkpoint('B3 bodies hidden on the plateau');
  }],
  ['C', 'Raft: the Spy fetches the uniform', async (D, { boardPoint }) => {
    const dv = D.c('diver'), spy = D.c('spy'), raft = D.raft();
    await D.stance('diver', 'stand'); await D.stance('spy', 'stand');
    D.order('diver', { type: 'move', x: 85, z: 17, run: true });
    await D.go('spy', 86, 16, { run: true });
    await D.until(() => !dv.isMoving, 20, 'Marine at the gully head');
    await D.stance('diver', 'crawl'); await D.stance('spy', 'crawl');
    D.order('diver', { type: 'move', x: 82, z: 32 });
    await D.go('spy', 82.5, 30.5, { tol: 0.5 });
    await D.until(() => !dv.isMoving, 30, 'Marine down the gully');
    D.order('diver', { type: 'move', x: 65.4, z: 43.2 });
    await D.go('spy', 66.6, 42.5, { tol: 0.4 });
    await D.until(() => !dv.isMoving, 60, 'Marine by the raft');
    D.checkpoint('C1 Marine and Spy by the raft');
    await boardRaft(D, 'diver', boardPoint, null, 0); // the Marine takes the oars first (e17's sweep leaves 2 s gaps)
    await boardRaft(D, 'spy', boardPoint, null, 0);
    D.checkpoint('C2 Marine and Spy aboard');
    await D.row(62, 52); await D.row(84, 70); await D.row(109.5, 85);
    D.ability('spy', 'leaveVehicle');
    await D.wait(0.5);
    D.ability('spy', 'use', D.item('uniform_line'));
    await D.until(() => spy.disguised, 20, 'uniform on');
    D.checkpoint('C3 Spy in uniform');
    D.ability('spy', 'enterVehicle', raft);
    await D.until(() => spy.vehicle === raft, 15, 'Spy aboard');
  }],
  ['D', 'Spy over the dam crest: fence power off, chat up e17', async (D) => {
    const spy = D.c('spy'), e17 = D.get('e17');
    await D.row(84, 68); await D.row(62, 48); await D.row(56.3, 37.6);
    D.ability('spy', 'leaveVehicle');
    await D.wait(0.5);
    await D.path('spy', [[59.35, 34.3], [52.5, 23.6]], { tol: 0.5 });
    D.checkpoint('D1 Spy on the dam crest');
    await D.path('spy', [[40, 22.4], [29.8, 29.7], [22.85, 40.3], [26, 56.5]], { tol: 0.5 });
    D.ability('spy', 'use', D.item('fence_switch'));
    await D.until(() => D.world.fencePower?.get?.('st_fence') === false, 40, 'fence power off');
    D.checkpoint('D2 fence switched off');
    await D.go('spy', 48.5, 74.0, { tol: 0.4 }); // e17's W side: he turns his back on the river and the shed
    D.ability('spy', 'distract', e17);
    await D.until(() => e17.brain.state === 'DISTRACTED', 10, 'e17 distracted');
    D.checkpoint('D3 e17 distracted');
  }],
  ['E', 'Sapper cuts in and takes the charges', async (D, { boardPoint }) => {
    const gb = D.c('greenberet'), sap = D.c('sapper'), raft = D.raft(), e6 = D.get('e6');
    D.order('diver', { type: 'move', x: 64, z: 45.2 });
    await D.stance('sapper', 'stand');
    D.order('sapper', { type: 'move', x: 86, z: 17 });
    await D.stance('greenberet', 'crawl');
    await D.go('greenberet', 84, 45.4, { tol: 0.3, max: 120 });
    await D.face('greenberet', 84, 47);
    D.ability('greenberet', 'decoyDrop'); // at the gully mouth: e6 will turn to it, away from the river
    await D.until(() => !gb.has('decoy'), 5, 'decoy down');
    await D.go('greenberet', 66.6, 42.6, { tol: 0.4, max: 120 });
    await D.until(() => !sap.isMoving, 120, 'Sapper at the gully head');
    await D.stance('sapper', 'crawl');
    await D.go('sapper', 82, 32, { tol: 0.5, max: 120 });
    await D.go('sapper', 65.3, 43.3, { tol: 0.4, max: 120 });
    D.checkpoint('E1 GB and Sapper at the raft');
    D.ability('greenberet', 'decoyToggle');
    await D.until(() => Math.abs(deg(e6.heading) - 290) < 25, 8, 'e6 faces the decoy');
    await D.wait(1);
    await boardRaft(D, 'sapper', boardPoint);
    await boardRaft(D, 'greenberet', boardPoint);
    await D.row(60, 56); await D.row(58, 64.3);
    await clearWindow(D, [[56.25, 63.75], [54.8, 64.2]], 3, 150, 'Sapper lands', () => p5FarWest(D));
    D.ability('sapper', 'leaveVehicle');
    await D.wait(0.3);
    await D.go('sapper', 54.8, 64.2, { tol: 0.4 });
    await D.stance('sapper', 'crawl');
    await D.go('sapper', 59.3, 78.0, { tol: 0.3 });
    D.ability('sapper', 'cutters', { x: 57.6, z: 79.0 });
    await D.until(() => !sap.currentAction && !sap.pendingAbility, 10, 'fence cut');
    D.checkpoint('E2 fence cut');
    await D.path('sapper', [[55.5, 80.6], [47, 86.5]], { tol: 0.4 });
    D.ability('sapper', 'hand', D.world.interactables.find((i) => i.spawn?.id === 'bombs_shed' || i.tag === 'bombs_shed')); // he crawls up to them
    await D.until(() => (sap.inventory.get('timeBomb') ?? 0) >= 2, 30, 'charges taken');
    D.checkpoint('E3 Sapper has both charges');
    await D.path('sapper', [[47, 86.5], [55.5, 80.6], [59.3, 77.6], [54.6, 64.5]], { tol: 0.4 });
    await boardRaft(D, 'sapper', boardPoint, () => p5FarWest(D));
    D.checkpoint('E4 Sapper back aboard');
    // the GB fetches his decoy back (off: e6 gives up and turns back to the river)
    await D.row(60, 56); await D.row(64, 45.2);
    await landProne(D, 'greenberet', 65.3, 43.4);
    D.ability('greenberet', 'decoyToggle');
    await D.go('greenberet', 82.5, 45.6, { tol: 0.4 });
    D.ability('greenberet', 'hand', gb.decoy);
    await D.until(() => gb.has('decoy'), 15, 'decoy picked up');
    await D.go('greenberet', 65.3, 43.4, { tol: 0.4 });
    await boardRaft(D, 'greenberet', boardPoint);
    D.checkpoint('E5 GB has the decoy and is aboard');
  }],
  ['F', 'GB plants the decoy by the N gate and digs in', async (D) => {
    const gb = D.c('greenberet'), e18 = D.get('e18');
    await D.go('spy', 24.6, 61.0, { tol: 0.4 }); // e18's W side
    D.ability('spy', 'distract', e18);
    await D.until(() => e18.brain.state === 'DISTRACTED', 10, 'e18 distracted');
    D.checkpoint('F1 Spy holds e18 at the N gate');
    await D.row(58, 60); await D.row(44.5, 48.2); // 37 m+ from e6: out of his sight even at the centre of his sweep
    const raft = D.raft();
    const ex = raft._exitPoint(undefined, undefined, false, gb, raft.occupants.indexOf(gb)) || { x: 42.8, z: 48.1 };
    const LAND = [41.2, 48.1];
    const clear = () => D.clearAhead(ex.x, ex.z, 2) && D.clearAhead(...LAND, 3) && D.routeClear('greenberet', [LAND, [40.6, 51.5, 3]], { delay: 2.5, minDist: 4 });
    for (let k = 0; ; k++) { // each time p5 sets off west, look for a clear moment in the next half-minute
      await D.until(() => p5Departed(D), 150, 'p5 leaves its E-end halt');
      let ok = false;
      for (let i = 0; i < 30 * 60 && !ok; i++) { if (clear()) ok = true; else await D.wait(D.dt); }
      if (ok) break;
      if (k >= 6) throw new Error('no quiet moment at the S shore');
      await D.until(() => !p5Departed(D), 150, 'p5 moves on');
    }
    D.ability('greenberet', 'leaveVehicle');
    await D.wait(0.05);
    // wade to the first snow cell only (no boot prints on the bank), then down on the belly (crawling leaves none)
    if (D.world.groundAt(gb.x, gb.z).shallow) await D.go('greenberet', ...LAND, { tol: 0.15 });
    await D.stance('greenberet', 'crawl');
    await crawlCautiously(D, [[40.6, 51.5], [40, 55.4], [34.5, 55.3], [28.9, 55.0]], { finalPause: 4.5 });
    await D.face('greenberet', 27, 55.0);
    D.ability('greenberet', 'decoyDrop'); // 13 m from the bunker: the gunner will hear it
    await D.until(() => !gb.has('decoy'), 5, 'decoy down');
    D.ability('greenberet', 'shovel');
    await D.until(() => gb.buried, 5, 'GB dug in');
    D.checkpoint('F2 decoy by the N gate, GB dug in beside it');
  }],
  ['G', 'Bunker: decoy on, charge one behind the gunner', async (D, { boardPoint }) => {
    const sap = D.c('sapper'), e29 = D.get('e29'), e19 = D.get('e19'), e34 = D.get('e34'), decoy = D.c('greenberet').decoy;
    await D.row(40, 42); await D.row(36, 36.5);
    await D.until(() => Math.hypot(e29.x - decoy.x, e29.z - decoy.z) < 10 && e19.z > 72, 200, 'p5 by the decoy, e19 down south');
    D.ability('greenberet', 'decoyToggle'); // by radio, from under the snow
    await D.until(() => Math.abs(deg(e34.heading) - 45) < 30, 10, 'gunner turns to the decoy');
    await D.wait(3);
    D.checkpoint('G1 decoy on: the gunner and p5 face it');
    D.ability('sapper', 'leaveVehicle');
    await D.wait(0.3);
    await D.go('sapper', 22.3, 43.2, { tol: 1.2 }); // as close to the bunker's NE corner as the ruin lets him
    if (Math.hypot(sap.x - 19, sap.z - 46) > 5.7) throw new Error(`Sapper too far from the bunker (${sap.x.toFixed(2)},${sap.z.toFixed(2)})`);
    try { await D.face('sapper', 19, 46); } catch { /* the ruin's wall is right there: he already faces it */ }
    D.ability('sapper', 'timeBomb');
    await D.until(() => (sap.inventory.get('timeBomb') ?? 0) === 1, 5, 'charge one planted');
    D.checkpoint('G2 charge one planted behind the bunker gunner');
    await boardRaft(D, 'sapper', boardPoint);
    await D.row(45, 34);
    await D.until(() => objective(D, 'o1'), 20, 'o1');
    D.ability('greenberet', 'decoyToggle');
    D.checkpoint('G3 bunker destroyed (o1)');
    await D.until(() => !D.world.alarm.active, 120, 'siren over');
    await D.wait(60);
    D.checkpoint('G4 alarm over, searches called off');
  }],
  ['H', 'Decoy W of the N gate; GB and Spy over the crest', async (D) => {
    const gb = D.c('greenberet'), e18 = D.get('e18');
    await D.go('spy', 26.2, 62.5, { tol: 0.3 }); // e18's S side: he looks into the yard, away from the fence and the dam
    D.ability('spy', 'distract', e18);
    await D.until(() => e18.brain.state === 'DISTRACTED', 10, 'e18 distracted');
    // 1) along the N fence to the west in two hops (dug in between): the decoy (off) goes down 12 m W of e18
    const rise = async () => {
      D.order('greenberet', { type: 'move', x: gb.x, z: gb.z }); // digs himself out
      await D.until(() => !gb.buried && !gb.currentAction, 5, 'GB out of the snow');
      await D.stance('greenberet', 'crawl');
    };
    const digIn = async () => { D.ability('greenberet', 'shovel'); await D.until(() => gb.buried, 5, 'GB dug in'); };
    await D.until(() => D.routeClear('greenberet', [[25.5, 55.8, 0.5]], { delay: 3.5 }), 1200, 'nobody along the N fence');
    await rise();
    D.ability('greenberet', 'hand', gb.decoy); // he picks his decoy up again (it lies beside him)
    await D.until(() => gb.has('decoy'), 10, 'decoy in hand');
    await crawlCautiously(D, [[25.5, 55.8], [22.5, 56.6], [19.5, 57.0], [17.0, 57.2]], { finalPause: 4.5 });
    try { await D.face('greenberet', 13, 57.2); } catch { /* facing west already */ }
    D.ability('greenberet', 'decoyDrop'); // when it calls, e18 turns west — his back to the dam — and p5 gathers here
    await D.until(() => !gb.has('decoy'), 5, 'decoy down');
    await D.go('greenberet', 17.4, 56.5, { tol: 0.3 });
    await digIn();
    D.checkpoint('H1 decoy W of the N gate, GB dug in beside it');
    // 2) round the bunker ruin to the W stair and up it, out of sight; the decoy is switched on from up there
    await crawlCautiously(D, [[14, 50], [14.5, 44.5], [14.5, 41], [19, 39.2], [23.4, 41.0], [25.9, 35.0]]);
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'decoyToggle'); // on, to the end: p5, e19 and the squad gather at it, e18 turns to it
    D.checkpoint('H2 GB on the W stair, decoy switched on');
    await D.path('greenberet', [...CREST_PATH, [61, 14]], { run: true });
    D.checkpoint('H3 GB at the truck road');
    // the Spy leaves e18 and crawls (no boot prints for anyone to follow) to the W stair, then walks over the crest
    D.order('spy', { type: 'stop' });
    await D.stance('spy', 'crawl');
    await D.path('spy', [[26.5, 58.0], [25.2, 50], [23.4, 41.0], [25.9, 35.6]], { tol: 0.5 });
    await D.stance('spy', 'stand');
    await D.path('spy', [...CREST_PATH, [59.5, 14.5]]);
    D.checkpoint('H4 Spy at the truck road');
  }],
  ['I', 'Dam: charge two on the toe ledge', async (D) => {
    const sap = D.c('sapper');
    await D.row(51.2, 31.6);
    const raft = D.raft();
    const exits = ['sapper', 'diver'].map((r) => raft._exitPoint(undefined, undefined, false, D.c(r), raft.occupants.indexOf(D.c(r))) || { x: 52.8, z: 32.5 });
    await clearWindow(D, [...exits.map((p) => [p.x, p.z]), [55, 30], [58, 24]], 4, 300, 'landing by the dam unseen');
    for (const r of ['sapper', 'diver']) { D.ability(r, 'leaveVehicle'); await D.wait(0.3); }
    D.order('diver', { type: 'move', x: 58.5, z: 13.5 });
    D.checkpoint('I1 Marine and Sapper ashore by the dam');
    await D.go('sapper', 48, 27, { tol: 0.6 });
    await D.until(() => D.routeClear('sapper', [[38.0, 28.6, 3.0], [48, 27]], { speed: 1.4, low: false }), 600, 'nobody watching the toe ledge');
    await D.go('sapper', 38.0, 28.6, { tol: 0.25 });
    try { await D.face('sapper', 35.82, 29.59); } catch { /* already facing the spot */ }
    D.ability('sapper', 'timeBomb');
    await D.until(() => (sap.inventory.get('timeBomb') ?? 0) === 0, 5, 'charge two planted');
    D.checkpoint('I2 charge two planted at the foot of the dam');
    await D.path('sapper', [[48, 27], [58, 15]], { run: true });
    await D.until(() => objective(D, 'o2'), 20, 'o2');
    D.checkpoint('I3 the dam is down (o2)');
  }],
  ['J', 'The truck north of the dam', async (D) => {
    const truck = () => D.world.vehicles.find((v) => v.tag === 'evac_truck' || v.spawn?.id === 'evac_truck' || v.id === 'evac_truck');
    await D.until(() => truck() && Math.hypot(truck().x - 60, truck().z - 10) < 1.5 && (truck().speed || 0) < 0.2, 60, 'truck waiting');
    D.checkpoint('J1 truck at the pickup');
    for (const r of ['spy', 'greenberet', 'diver', 'sapper']) D.ability(r, 'enterVehicle', truck());
    await D.until(() => objective(D, 'o3'), 60, 'o3');
    D.checkpoint('J2 everyone aboard: mission complete');
  }],
];

/**
 * Play the whole mission. `ctx.boardPoint` = src/abilities/drive.js boardPoint (passed in so the module loads both in
 * node and in the page). `ctx.only` / `ctx.until`: run a slice of the stages (debugging).
 */
export async function solve(D, ctx) {
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
