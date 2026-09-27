/**
 * Wind-driven effects director (step 4w), one per mission, run per displayed frame on SIM time (frozen while paused):
 *  - wind-borne debris (render/wind-particles.js: leaves / sand / spindrift / spray per preset `blow`),
 *  - desert dust devils (the WindField vortex) as a swirling dust column (VFX 'dust_devil'),
 *  - snow shaken off conifer branches by strong gusts (VFX 'snow_puff'),
 *  - 'wind:gust' events at the view centre for the audio gust whooshes.
 * @module render/wind-fx
 */
import { createWindParticles } from './wind-particles.js';
import { SPECIES } from '../art/terrain/treegen.js';

/**
 * @param {import('../world/world.js').World} world @param {object} [renderer] engine Renderer (null → no particles)
 * @returns {{frame:(dt:number, camera?:object)=>void, dispose:()=>void, particles:object|null, stats:object}|null}
 */
export function createWindFx(world, renderer = null) {
  if (!world?.wind?.sample) return null;
  let W = world.wind;
  const def = world.mission || {};
  const snowy = def.theater === 'snow' || (def.lighting?.snow ?? 0) > 0.3;
  const parts = renderer && world.scene ? createWindParticles(world.scene, W.p.blow, renderer.presetName || 'high') : null;
  const stats = { puffs: 0, devils: 0, gusts: 0 };
  const s = {};
  let lastT = null, puffT = 0, devilT = 0, near = [], nearT = -99, gustOn = false;
  let rs = 987654321;
  const rnd = () => ((rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296);
  const ground = (x, z) => world.terrain?.heightAt?.(x, z) ?? 0;
  return {
    particles: parts, stats,
    frame(dt, camera) {
      if (world.wind?.sample) W = world.wind; // tools/tests may swap the mission wind
      const t = W.t, step = lastT == null ? 0 : t - lastT;
      lastT = t;
      const c = world.game?.cameraController?.target || { x: world.width / 2, z: world.depth / 2 };
      parts?.update(camera, ground(c.x, c.z));
      if (!(step > 0) || step > 0.5) return;
      // gust arriving at the view centre → audio whoosh
      W.sample(c.x, c.z, t, s);
      const on = s.gust > 0.38 && s.speed > 3;
      if (on && !gustOn) { stats.gusts++; world.events?.emit?.('wind:gust', { x: c.x, z: c.z, gust: s.gust, speed: s.speed }); }
      gustOn = on ? true : s.gust > 0.25 && gustOn;
      // dust devil column
      const d = W.devil(t);
      if (d && d.s > 0.12 && world.fx) {
        devilT += step;
        while (devilT > 0.1) { devilT -= 0.1; stats.devils++; world.fx.spawn('dust_devil', d.x, d.z, { strength: d.s, radius: d.r }); }
      }
      // snow shaken off conifers in strong gusts (trees near the view only)
      if (!snowy || !world.fx) return;
      puffT += step;
      if (puffT < 0.25) return;
      puffT = 0;
      if (t - nearT > 1.5) {
        nearT = t;
        const trees = world.terrain?.vegetation?.trees || [];
        near = trees.filter((tr) => SPECIES[tr.species]?.kind === 'conifer' && Math.abs(tr.x - c.x) < 45 && Math.abs(tr.z - c.z) < 32);
      }
      for (let k = 0; k < 3 && near.length; k++) {
        const tr = near[(rnd() * near.length) | 0];
        W.sample(tr.x, tr.z, t, s);
        if (s.speed < 6.5 || s.gust < 0.3 || rnd() > s.gust * 0.6) continue;
        const h = tr.height || 8, y = (tr.y ?? ground(tr.x, tr.z)) + h * (0.45 + 0.4 * rnd());
        stats.puffs++;
        world.fx.spawn('snow_puff', tr.x + (rnd() - 0.5) * 1.5, tr.z + (rnd() - 0.5) * 1.5, { y, wind: { x: s.x, z: s.z }, size: 0.6 + h * 0.06 });
      }
    },
    dispose() { parts?.dispose(); },
  };
}
