/**
 * Shared helpers of the fuel-tanks-yard-*.test.mjs browser tests. Fuel tanks with the feat/missions defs of M8 / M11 / M13 / M17 (src/missions/dev/tank-yard.js, one zone per mission,
 * each loaded in its own theater): the right family asset per structure, visuals inside their footprints, the M8 deck
 * walkable at 4.5 m with a guard on it, the M11 pipe runs and quarry columns, the M17 spout at the mission's VALVE
 * point with the wheel turning on each valve use and the pour starting on the third; then each zone is blown up
 * (bomb / shot / destroy) and checked: wrecks swapped, footprints still blocked, the M8 deck and its guard gone.
 * Review shots at the default camera, zoom 1 and 2, intact and destroyed (tests/out/tanks-yard-*.png).
 */
export const ZONE_SHOT = (page, t, name) => t.shot(name);
export const ZONES = { m08: [24, 22], m13: [78, 22], m17: [26, 66], m11: [78, 58], m11q: [95, 72] };

export async function load(page, theater) {
  await page.addStyleTag({ content: '.ui-paused{display:none!important}' });   // review shots: no pause banner
  return page.evaluate(async (theater) => {
    const g = window.__game, G = g.game;
    const { tankYard } = await import('./src/missions/dev/tank-yard.js');
    await g.loadMission(tankYard(theater));
    g.start(); g.pause(true);
    for (const e of G.world.enemies) if (e.brain) e.brain.frozen = true;
    const props = () => { const m = {}; G.renderer.scene.traverse((o) => { if (/^prop:/.test(o.name) && o.userData.libraryAsset) m[o.name.split(':')[2]] = o; }); return m; };
    for (let i = 0; i < 80 && Object.values(props()).some((o) => { let n = 0; o.traverse((m) => { if (m.isMesh) n++; }); return n < 3; }); i++) await new Promise((r) => setTimeout(r, 100));
    window.__ty = { props };
    return Object.fromEntries(Object.entries(props()).map(([k, o]) => [k, o.userData.libraryAsset]));
  }, theater);
}

export const shotAt = (page, x, z, zoom) => page.evaluate(({ x, z, zoom }) => { const g = window.__game; g.setZoom(zoom); g.centerOn(x, z); g.render(); }, { x, z, zoom });

