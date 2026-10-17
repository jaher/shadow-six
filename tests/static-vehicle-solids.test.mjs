/**
 * A prop drawn as a library vehicle is solid as its drawn model (body clearance, world/body-clearance.js: what men
 * path and stand clear of), the same on every load. The map's own body-solid re-stamp ran when the library buildings
 * were in — before or after a static vehicle's model: M14's parked Opel Blitz (van_g4) was a 2.3 m or a 6.2 m solid
 * by load path, and the M14 solution run went another way. Game.loadMission now measures the static vehicles again at
 * a fixed point, once their models are in (map handle restampBodySolidsG). M14's lorry, M8's tanker and M12's lorry
 * (a map with no library re-stamp at all), each loaded three times: cold, cold in a second page, and reloaded.
 */
export const timeout = 900_000;

const CASES = [['m14', 'van_g4'], ['m08', 'tanker_e'], ['m12', 'truck_q']];

/** Load `id` in `page` and read `sid`'s body solid and its library model's size. */
function measure(page, id, sid) {
  return page.evaluate(async ({ id, sid }) => {
    const G = window.__game, THREE = await import('three');
    await G.loadMission(id);
    G.start();
    G.advance(0.1);
    const w = G.game.world, s = w.structures.get(sid);
    const R = w.bodySolids?.list.filter((o) => o.owner === s.owner).map((o) => o.R) || [];
    const holder = s.object3d.children.find((c) => /^static-vehicle:/.test(c.name));
    let meshes = 0;
    holder?.traverse((o) => { if (o.isMesh) meshes++; });
    const box = holder ? new THREE.Box3().setFromObject(holder) : null;
    const gy = w.groundY?.(s.def.x, s.def.z) ?? 0;
    return { R, meshes, lib: box && { l: Math.max(box.max.x - box.min.x, box.max.z - box.min.z), top: box.max.y - gy } };
  }, { id, sid });
}

export default async function staticVehicleSolids(page, t) {
  const h = t.harness;
  for (const [id, sid] of CASES) {
    const a = await measure(page, id, sid);
    const page2 = await h.newPage();
    let b;
    try { await h.openGame(page2); b = await measure(page2, id, sid); } finally { t.equal(h.errors(page2).length, 0, `second page errors: ${h.errors(page2).join(' | ')}`); await page2.close(); }
    const c = await measure(page, id, sid);
    const R = a.R[0];
    t.log(`${id} ${sid}: solid ${JSON.stringify(R)}, library model ${JSON.stringify(a.lib)} (${a.meshes} meshes)`);
    t(a.meshes > 0, `${id} ${sid} is drawn with its library model`);
    t(a.R.length === 1, `${id} ${sid} has one body solid (${a.R.length})`);
    // the drawn model's: its length at body height, and its top (not the placeholder's)
    const len = 2 * Math.max(R.hl, R.hw);
    t(len > a.lib.l - 0.5 && len < a.lib.l + 0.1, `${id} ${sid}: the solid is the model's length (${len.toFixed(2)} m, model ${a.lib.l.toFixed(2)} m)`);
    t(R.top > a.lib.top - 0.1, `${id} ${sid}: and its height (${R.top.toFixed(2)} m, model ${a.lib.top.toFixed(2)} m)`);
    t.equal(JSON.stringify(b.R), JSON.stringify(a.R), `${id} ${sid}: the same solid in a second page`);
    t.equal(JSON.stringify(c.R), JSON.stringify(a.R), `${id} ${sid}: the same solid reloaded`);
  }
}
