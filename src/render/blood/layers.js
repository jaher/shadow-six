/**
 * The drawn side of the blood system (browser only): pools, spatter/drip/print decals, drag smears and clothing
 * stains, sharing one uniform block (time + colour curve). index.js talks to it through this small facade only.
 * @module render/blood/layers
 */
import { bloodUniforms, trailFollow } from './glsl.js';
import { PoolLayer } from './pools.js';
import { DecalLayer } from './decals.js';
import { SmearLayer } from './smears.js';
import { StainLayer } from './stains.js';
import { BloodMask } from './mask.js';

export function createBloodLayers(sys, scene) {
  const U = bloodUniforms();
  const follow = trailFollow(sys.world); // lie in footprints / furrows / craters like the terrain does
  const pools = new PoolLayer(sys, scene, U, follow), decals = new DecalLayer(sys, scene, U, follow), smears = new SmearLayer(sys, scene, U, follow), stains = new StainLayer(sys, U);
  const mask = new BloodMask(sys); // grass blades soak red where blood lies under them
  const gl = () => sys.world.game?.renderer?.renderer || null;
  let lastT = 0;
  let visible = true;
  const fresh = new Set();
  return {
    uniforms: U, pools, decals, smears, stains, mask,
    addPool(p) { pools.add(p); fresh.add(p); },
    removePool(p) { pools.remove(p); fresh.delete(p); },
    poolChanged(p) { pools.upload(p, gl()); if (p.sim && (p.sim.frozen || p.sim.steps % 5 === 0)) mask.pool(p); },
    addDecal(d) { decals.add(d); if (!d.n) mask.disc(d.x, d.z, d.s * 0.3, d.op * 0.8); },
    dropDecals() { decals.rebuild(sys.decals); const d = sys.decals[sys.decals.length - 1]; if (d && !d.n) mask.disc(d.x, d.z, d.s * 0.3, d.op * 0.8); },
    addSmear(s) { smears.add(s); mask.line(s.x0, s.z0, s.x1, s.z1, s.w * 0.8, s.i); },
    dropSmears(list) { smears.drop(list); },
    stainsChanged(u, list) { stains.changed(u, list); },
    setVisible(v) {
      if (v === visible) return;
      visible = v; pools.visible = v; decals.visible = v; smears.visible = v;
      for (const e of stains.units.values()) e.n = 0;
    },
    /** Rebuild everything from the records (first frame after the layers load asynchronously). */
    rebuild() {
      for (const p of sys.pools) { pools.add(p); fresh.add(p); }
      decals.rebuild(sys.decals);
      smears.clear(); for (const s of sys.smears) smears.add(s);
      for (const [id, list] of sys.stains) { const u = sys.world.byId?.(id); if (u) stains.changed(u, list); }
    },
    frame(time) {
      U.uBloodTime.value = time;
      const px = sys.world.game?.cameraController?.pxPerMeter?.();
      if (px > 0) U.uBloodPx.value = px;
      if (pools.dirty) {
        pools.rebuild((x, z) => sys._floorY(x, z));
        for (const p of fresh) pools.upload(p, gl());   // new slots start clean (zeros until the first step)
        fresh.clear();
      }
      if (visible) stains.frame(time);
      mask.flush(gl(), Math.max(0, time - lastT)); lastT = time;
    },
    clear() { mask.clear(); decals.clear(); smears.clear(); stains.clear(); for (const p of [...pools.slot.keys()]) pools.remove(p); fresh.clear(); },
    dispose() { mask.dispose(); pools.dispose(); decals.dispose(); smears.dispose(); stains.dispose(); },
  };
}
