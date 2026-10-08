/**
 * window.__game — deterministic test hooks (installed with ?test=1). See ARCHITECTURE.md § Test API.
 * In test mode the Game runs with manualTick: the simulation only advances through advance()/step().
 * @module debug/test-api
 */

import { CONFIG } from '../config.js';
import { ABILITIES } from '../abilities/index.js';
import { probe as probeCone } from '../ai/perception.js';
import { sessionCache } from '../engine/asset-cache.js';
import * as Offline from '../engine/offline-cache.js';

/** Resolve a unit reference: numeric id, mission tag or role name. */
function unit(game, ref) {
  const w = game.world;
  if (!w || ref == null) return null;
  if (typeof ref === 'object') return ref;
  return w.byId(ref) || w.commandos.find((c) => c.role === ref) || null;
}

/** Resolve an ability target: {x,z} point, entity ref (id/tag), or the entity itself. */
function target(game, t) {
  if (t == null) return null;
  if (typeof t === 'object' && ('id' in t || !('x' in t))) return t;
  if (typeof t === 'object') return { x: t.x, z: t.z };
  return game.world.byId(t);
}

/**
 * Install the test API on window.__game.
 * @param {import('../game.js').Game} game
 */
export function installTestApi(game) {
  const api = {
    game,
    CONFIG,
    async loadMission(id) {
      await game.loadMission(id);
      game.render(0, 1);
      return api.state();
    },
    start() {
      game.start();
      return game.state;
    },
    pause(on = true) {
      game.pause(on);
      return game.state;
    },
    advance(seconds) {
      return game.advance(seconds);
    },
    /** One sim tick; does nothing unless state === 'playing'. @returns {boolean} whether a tick ran */
    step() {
      return game.advance(CONFIG.sim.dt) > 0;
    },
    render() {
      game.render(0, 1);
    },
    state() {
      const w = game.world;
      if (!w) return { state: game.state, time: 0, commandos: [], enemies: [], alarm: false, objectives: [], stats: {} };
      return {
        state: game.state,
        mission: game.missionDef?.id,
        time: +w.time.toFixed(4),
        tick: w.tick,
        commandos: w.commandos.map((c) => ({
          id: c.id, tag: c.tag, role: c.role, x: c.x, z: c.z, y: c.y, hp: c.hp, stance: c.stance, state: c.state,
          held: !!c.held, buried: !!c.buried, disguised: !!c.disguised, underwater: !!c.underwater, hidden: !!c.hidden,
          alive: c.alive, selected: c.selected, action: c.currentActionId, inventory: Object.fromEntries(c.inventory),
        })),
        enemies: w.enemies.map((e) => ({
          id: e.id, tag: e.tag, soldierType: e.soldierType, x: e.x, z: e.z, hp: e.hp, state: e.state, alive: e.alive,
          brainState: e.brainState, alertLevel: e.alertLevel, y: e.y,
          nervousness: e.nervousness ?? 0, sawBody: !!e.sawBody, sawKill: !!e.sawKill, target: e.target ? e.target.id : null,
        })),
        alarm: !!w.alarm?.active,
        lamp: !!(w.alarm?.lamp ?? w.alarm?.active),
        zonesFired: (w.alarm?.zonesFired || []).map((f) => ({ ...f })),
        siren: w.alarm?.siren ? { ...w.alarm.siren } : { active: false, gain: 0, t: 0 },
        clock: +(w.clock ?? w.time).toFixed(4),
        belTick: w.belTick ?? 0,
        objectives: w.objectives.map((o) => ({ id: o.id, done: !!o.done, failed: !!o.failed })),
        stats: { ...w.stats },
      };
    },
    select(ids) {
      const us = (Array.isArray(ids) ? ids : [ids]).map((r) => unit(game, r)).filter(Boolean);
      game.input.select(us);
      return us.map((u) => u.id);
    },
    order(id, order) {
      const u = unit(game, id);
      if (!u?.issue) return false;
      return u.issue(order);
    },
    useAbility(id, abilityId, t) {
      const u = unit(game, id);
      if (!u?.issue || !ABILITIES[abilityId]) return false;
      return u.issue({ type: 'ability', id: abilityId, target: target(game, t) ?? u });
    },
    /** Why the unit's last order was refused ({id, text, t}) — issue()/useAbility() only return false. */
    lastRefusal(id) {
      return unit(game, id)?.lastRefusal ?? null;
    },
    setCone(enemyId, on = true) {
      const e = unit(game, enemyId);
      if (!e) return false;
      game.toggleCone(e, on);
      game.render(0, 1);
      return true;
    },
    centerOn(x, z) {
      game.cameraController.centerOn(x, z);
      game.render(0, 1);
    },
    setZoom(z) {
      game.cameraController.setZoom(z, true);
      game.render(0, 1);
    },
    setPreset(name) {
      game.renderer.setPreset(name);
      game.render(0, 1);
    },
    /**
     * §4.2 probe marker (Shift+click): the first enemy whose current cone (standing test) contains
     * (x, z) gets its cone shown. Uses game.probe when the UI implements it. @returns enemy id | null
     */
    probe(x, z) {
      if (game.probe) return game.probe(x, z);
      const e = game.world ? probeCone(game.world, x, z) : null;
      if (e) api.setCone(e.id, true);
      return e ? e.id : null;
    },
    /**
     * Emit a §4.4 noise of `kind` (CONFIG.stealth.noise: pistol, decoy, halt, explosion…) at (x, z).
     * @returns {{x, z, radius, kind, level}|null}
     */
    noise(x, z, kind = 'pistol', source = null) {
      const w = game.world;
      const n = CONFIG.stealth.noise[kind];
      if (!w || !n) return null;
      w.emitNoise(x, z, n.radius, kind, source ? unit(game, source) : null);
      return { x, z, radius: n.radius, kind, level: n.level };
    },
    quickSave: () => game.quickSave(),
    quickLoad: () => game.quickLoad(),
    /** Asset caches: in-memory session cache stats + the page side of the service worker cache (engine/offline-cache.js). */
    cache: {
      stats: () => sessionCache.stats(),
      cacheLoadedAssets: () => Offline.cacheLoadedAssets(),
      status: () => Offline.cacheStatus(),
      prefetch: (id, preset) => Offline.prefetchMission(id, preset),
      clear: (o) => Offline.clearCachedGameData(o),
    },
    renderStats: () => game.renderer.stats?.(),
    /** Render one frame and read it back: mean/std RGB, saturation, contextLost (NaN/black-frame guard). */
    frameStats() {
      game.render(0, 1);
      return game.renderer.frameStats?.() || null;
    },
    /**
     * Frame-time benchmark (realism §3.9): n frames of the full pipeline, each synced with a 1-px readPixels;
     * GPU time from EXT_disjoint_timer_query_webgl2 when exposed. @returns {Promise<object>}
     */
    async bench(n = 120) {
      const R = game.renderer;
      const gl = R.renderer.getContext();
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const px = new Uint8Array(4);
      const wall = [];
      const qs = [];
      for (let i = 0; i < 5; i++) game.render(0, 1); // warm-up (shader compile, shadow maps)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < n; i++) {
        const q = ext ? gl.createQuery() : null;
        if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        const t0 = performance.now();
        game.render(1 / 60, 1);
        if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        wall.push(performance.now() - t0);
      }
      const gpu = [];
      for (let tries = 0; tries < 40 && qs.length; tries++) {
        await new Promise((res) => setTimeout(res, 25));
        for (let i = qs.length - 1; i >= 0; i--) {
          if (!gl.getQueryParameter(qs[i], gl.QUERY_RESULT_AVAILABLE)) continue;
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(qs[i], gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(qs[i]);
          qs.splice(i, 1);
        }
      }
      const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? +b[Math.floor(b.length / 2)].toFixed(3) : null; };
      const p95 = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? +b[Math.min(b.length - 1, Math.floor(b.length * 0.95))].toFixed(3) : null; };
      return { preset: R.presetName, frames: n, wallMedian: med(wall), wallP95: p95(wall), gpuMedian: med(gpu), gpuP95: p95(gpu), gpuSamples: gpu.length, size: [R.width, R.height], pixelRatio: R.renderer.getPixelRatio(), ...R.stats() };
    },
    abilities: () => Object.keys(ABILITIES),
    /** Clipping / interpenetration audit (debug/clip-audit.js, loaded on first use): `const c = await __game.clipAudit()`. */
    async clipAudit() {
      if (!api.clip) api.clip = (await import('./clip-audit.js')).createClipApi(game);
      return true;
    },
  };
  window.__game = api;
  return api;
}
