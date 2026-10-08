/**
 * SHADOW SIX house rule recoverCharges in the real game (src/abilities/sapper.js takeCharge; tests/unit/charge-recover):
 *   desktop — with the Sapper selected the cursor over his placed time bomb is the grabbing hand; a left click sends him
 *             to take it back (the clock stops, it is back in the knapsack, nothing goes off); H + click does the same;
 *             with only the Green Beret selected the charge is no lever (move cursor) and his H on it is refused;
 *   touch    — on an emulated Pixel 7 a TAP on the charge (Sapper selected) takes it back too.
 */
import { openPhone } from './touch-game-flow.mjs';

/** Load the m00 sandbox with a Sapper (2 time bombs) and a Green Beret, both on open ground. */
const LOAD = async ({ x = 20, z = 40 } = {}) => {
  const g = window.__game, G = g.game;
  const { MISSIONS } = await import('./src/missions/index.js');
  const base = MISSIONS.find((m) => m.id === 'm00');
  await G.loadMission({ ...base, id: 'm00_takeback', enemies: [],
    commandos: [{ role: 'sapper', x, z, heading: 0, inventory: { timeBomb: 2 } }, { role: 'greenberet', x: x - 4, z: z + 3 }] });
  g.start();
  g.setZoom(1.5);
  const w = G.world;
  window.__dis = [];
  w.listen('bomb:disarmed', (p) => window.__dis.push({ kind: p.kind, fuse: p.fuse, t: w.time }));
  window.__ex = 0;
  w.listen('bomb:exploded', () => { window.__ex++; });
  window.__arm = [];
  w.listen('bomb:armed', (p) => window.__arm.push({ t: w.time, kind: p.kind }));
  window.__inv = [];
  w.listen('ability:start', (p) => window.__inv.push({ t: w.time, id: p.id, role: p.unit?.role }));
  return true;
};

/** Plant a time bomb at his feet, walk him 3 m away, centre the view on the charge. @returns its screen point */
const PLANT = () => {
  const g = window.__game, G = g.game, w = G.world;
  const sp = w.commandos.find((c) => c.role === 'sapper');
  if (!sp.has('timeBomb')) { sp.inventory.set('timeBomb', 1); sp.refreshAbilities(); }
  sp.issue({ type: 'ability', id: 'timeBomb', target: sp });
  g.advance(1.1);
  const b = w.interactables.find((i) => i.interactKind === 'bomb' && i.placed);
  sp.issue({ type: 'move', x: sp.x + 3, z: sp.z + 1 });
  g.advance(2);
  g.centerOn(b.x, b.z);
  g.render();
  const p = G.cameraController.worldToScreen(b.x, (b.y || 0) + 0.1, b.z);
  return { x: p.x, y: p.y, id: b.id, fuse: b.fuse, n: sp.inventory.get('timeBomb') ?? 0 };
};

const STATE = (id) => {
  const G = window.__game.game, w = G.world, sp = w.commandos.find((c) => c.role === 'sapper'), b = w.byId(id);
  return { arm: window.__arm.slice(), starts: window.__inv.slice(), n: sp.inventory.get('timeBomb') ?? 0, placed: !!b?.placed, taken: !b || !!b.taken, dis: window.__dis.slice(), ex: window.__ex,
    action: sp.currentActionId, cursor: document.body.dataset.cursor || '', soft: G.hud?.cursor?.current ?? null, alive: sp.alive };
};

export const timeout = 150_000;
export default async function chargeRecover(page, t) {
  // ---------------- desktop: hover hand, click → take back
  await page.evaluate(LOAD);
  let c = await page.evaluate(PLANT);
  t.log('planted', JSON.stringify(c));
  await page.evaluate(() => { const G = window.__game.game; G.input.select(G.world.commandos.filter((u) => u.role === 'sapper')); window.__game.render(); });
  await page.mouse.move(c.x + 30, c.y + 30);
  await page.mouse.move(c.x, c.y, { steps: 4 });
  await page.evaluate(() => window.__game.render());
  let s = await page.evaluate(STATE, c.id);
  t.log('hover', JSON.stringify(s));
  t.equal(s.cursor, 'hand', 'hover over his charge with the Sapper selected: the hand');
  t(s.soft === 'hand' || s.soft === 'grab', `the software cursor is the grabbing hand (${s.soft})`);
  await page.mouse.click(c.x, c.y);
  await page.evaluate(() => { window.__game.advance(0.05); window.__game.render(); });
  s = await page.evaluate(STATE, c.id);
  t.equal(s.action ?? 'pending', s.action ?? 'pending'); // (walking back to it, or already kneeling)
  await page.evaluate(() => { window.__game.advance(3.5); window.__game.render(); });
  s = await page.evaluate(STATE, c.id);
  await t.shot('charge-recover-desktop');
  t.log('after click', JSON.stringify(s));
  t(s.taken && !s.placed, 'the click took it back');
  t.equal(s.n, c.n + 1, 'back in the knapsack');
  t.equal(s.dis.length, 1, 'bomb:disarmed');
  t(s.dis[0].fuse > 0, 'the clock was stopped with time left');
  await page.evaluate(() => { window.__game.advance(10); window.__game.render(); });
  s = await page.evaluate(STATE, c.id);
  t.equal(s.ex, 0, 'nothing went off');

  // ---------------- desktop: H (hand tool) + click does the same
  c = await page.evaluate(PLANT);
  await page.evaluate(() => { const G = window.__game.game; G.input.select(G.world.commandos.filter((u) => u.role === 'sapper')); window.__game.render(); });
  await page.mouse.move(c.x + 40, c.y);
  await page.keyboard.press('KeyH');
  await page.mouse.move(c.x, c.y, { steps: 4 });
  await page.evaluate(() => window.__game.render());
  s = await page.evaluate(STATE, c.id);
  t.log('H hover', JSON.stringify(s));
  await page.mouse.click(c.x, c.y);
  await page.evaluate(() => { window.__game.advance(4); window.__game.render(); });
  s = await page.evaluate(STATE, c.id);
  t.log('H click', JSON.stringify(s));
  t(s.taken, 'H + click took it back');
  t.equal(s.n, c.n + 1);

  // ---------------- the charge is a real object (art/demolition-charge.js), in his hand while he plants it
  const model = await page.evaluate(async () => {
    const THREE = await import('three');
    const g = window.__game, G = g.game, w = G.world, sp = w.commandos.find((u) => u.role === 'sapper');
    sp.inventory.set('timeBomb', 1); sp.refreshAbilities();
    sp.issue({ type: 'ability', id: 'timeBomb', target: sp });
    g.advance(0.5); G.render(1 / 60, 1);
    const props = sp.model?.real?.inner?.props || [];
    const inHand = props.find((p) => p.name === 'time_bomb'), remoteInHand = props.find((p) => p.name === 'remote_bomb');
    const hand = { time: !!inHand?.obj.visible, remote: !!remoteInHand?.obj.visible, model: !!inHand?.obj.getObjectByName('time_charge') };
    g.advance(0.7); G.render(1 / 60, 1);
    const b = w.interactables.filter((i) => i.interactKind === 'bomb' && i.placed).at(-1);
    const s = new THREE.Box3().setFromObject(b.object3d).getSize(new THREE.Vector3());
    let tris = 0; b.object3d.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    const out = { name: b.object3d.name, size: [s.x, s.y, s.z].map((v) => +v.toFixed(3)), tris, inScene: !!b.object3d.parent, hand };
    b.take(sp); g.advance(0.1); // (off the ground again: nobody here is caught in a blast)
    return out;
  });
  t.log('model', JSON.stringify(model));
  t.equal(model.name, 'time_charge', 'the placed charge is the demolition-charge model');
  t(model.inScene, 'drawn');
  t(Math.max(model.size[0], model.size[2]) >= 0.25 && Math.max(model.size[0], model.size[2]) <= 0.36, `25–35 cm (${model.size})`);
  t(model.size[1] >= 0.09, `not a flat disc (${model.size[1]} m high)`);
  t(model.tris <= 600, `a few hundred triangles (${model.tris})`);
  t(model.hand.time && model.hand.model && !model.hand.remote, `the time charge in his hand mid-plant (${JSON.stringify(model.hand)})`);

  // ---------------- only the Sapper: the Green Beret alone gets no hand over it, and his H is refused
  c = await page.evaluate(PLANT);
  await page.evaluate(() => { const G = window.__game.game; G.input.select(G.world.commandos.filter((u) => u.role === 'greenberet')); window.__game.render(); });
  await page.mouse.move(c.x + 30, c.y + 30);
  await page.mouse.move(c.x, c.y, { steps: 4 });
  await page.evaluate(() => window.__game.render());
  s = await page.evaluate(STATE, c.id);
  t.equal(s.cursor, 'move', 'Green Beret alone: no take-back hand over the charge');
  const gbH = await page.evaluate((id) => {
    const G = window.__game.game, w = G.world, gb = w.commandos.find((u) => u.role === 'greenberet');
    const ok = gb.issue({ type: 'ability', id: 'hand', target: w.byId(id) });
    return { ok, why: gb.lastRefusal?.text };
  }, c.id);
  t.equal(gbH.ok, false);
  t.equal(gbH.why, 'Only the Sapper can handle explosives.');
  await page.evaluate(() => { window.__game.advance(10); window.__game.render(); });

  // ---------------- touch: a tap on the charge (Pixel 7, landscape)
  const P = await openPhone(t, 'Pixel 7');
  try {
    await P.page.evaluate(LOAD, { x: 24, z: 46 });
    c = await P.page.evaluate(PLANT);
    await P.page.evaluate(() => { const G = window.__game.game; G.input.select(G.world.commandos.filter((u) => u.role === 'sapper')); window.__game.render(); });
    t.log('touch planted', JSON.stringify(c));
    await P.page.touchscreen.tap(c.x, c.y);
    await P.page.evaluate(() => { window.__game.advance(4); window.__game.render(); });
    s = await P.page.evaluate(STATE, c.id);
    const log = await P.page.evaluate(() => window.__game.game.input.touch?.log?.slice(-3) ?? null);
    t.log('touch tap', JSON.stringify(s), JSON.stringify(log));
    await P.page.screenshot({ path: t.harness.shotPath('charge-recover-touch.png') });
    t(log?.some((e) => e.type === 'tap' && e.result === 'take'), 'the tap was a take order');
    t(s.taken && !s.placed, 'a tap on the charge took it back');
    t.equal(s.n, c.n + 1, 'back in the knapsack (touch)');
    t.equal(P.errs.length, 0, `phone page errors: ${P.errs.join(' | ')}`);
  } finally {
    await P.ctx.close();
  }
}
