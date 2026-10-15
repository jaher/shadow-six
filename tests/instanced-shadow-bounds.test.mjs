/**
 * Instanced shadow casters keep bounds over every instance (Game._warmFrame): the load's warm-up frame draws one
 * instance of each instanced mesh, and a box a cull computed then (the shadow reach test asks for it lazily) covered
 * that one instance and was kept — M10's scrub, trench pieces, wire pickets and hedgehogs lost their shadows whenever
 * it was off screen. After a load and a few frames, every cached box / sphere of an instanced mesh holds all of its
 * instances (M10: El Agheila, scrub + trenches + hedgehog batch; M14: beach obstacles).
 */
export const timeout = 400_000; // two mission loads on a shared GPU

export default async function instancedShadowBounds(page, t) {
  for (const id of ['m10', 'm14']) {
    const r = await page.evaluate(async (m) => {
      const THREE = await import('three');
      const g = window.__game, G = g.game;
      G.stop(); g.setPreset('high'); await g.loadMission(m); G.stop(); g.start(); G.focusSquad?.();
      for (let i = 0; i < 30; i++) g.advance(1 / 30);
      for (let i = 0; i < 8; i++) G.render(1 / 60, 1);
      const M = new THREE.Matrix4(), B = new THREE.Box3(), S = new THREE.Sphere();
      let checked = 0, casters = 0;
      const short = [];
      G.renderer.scene.traverse((o) => {
        if (!o.isInstancedMesh || o.count < 2) return;
        const geo = o.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        if (o.boundingBox) {
          checked++;
          if (o.castShadow) casters++;
          for (let i = 0; i < o.count; i++) {
            o.getMatrixAt(i, M);
            B.copy(geo.boundingBox).applyMatrix4(M).expandByScalar(-0.01);
            if (!o.boundingBox.containsBox(B)) { short.push(`${o.parent?.name}>${o.name || o.type} box (${o.count} instances)`); break; }
          }
        }
        if (o.boundingSphere) {
          for (let i = 0; i < o.count; i++) {
            o.getMatrixAt(i, M);
            S.copy(geo.boundingSphere).applyMatrix4(M);
            if (o.boundingSphere.center.distanceTo(S.center) + S.radius > o.boundingSphere.radius + 0.01) { short.push(`${o.parent?.name}>${o.name || o.type} sphere`); break; }
          }
        }
      });
      return { checked, casters, short };
    }, id);
    t.log(`${id}: ${r.checked} instanced boxes checked (${r.casters} shadow casters), ${r.short.length} short`);
    t.ok(r.checked > 0, `${id}: some instanced mesh had its box computed`);
    t.ok(r.short.length === 0, `${id}: bounds that miss instances: ${r.short.slice(0, 8).join('; ')}`);
  }
}
