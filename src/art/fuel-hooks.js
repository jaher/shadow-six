/**
 * Runtime hooks of the fuel-tank family (docs/fuel-tanks.md §10.5), wired to the world by map-builder:
 *  - M17 `fuel_tank_elevated`: the mission's `fuel_valve` set-piece places its own valve device at VALVE, right at the
 *    model's spout. Each use of that device (`device` event within 1.5 m of the spout) turns the model's red handwheel
 *    (GLB node `valve`) a third of a turn; from the third use the spout pours: a dark oil stream to the ground and a
 *    spreading pool under it (the set-piece owns the big spill toward the gateway and its fire). The set-piece's
 *    placeholder post for the device is hidden (the model shows the valve).
 *  - destruction (the wreck swapped in) stops the pour; the wreck has its own torn valve.
 * @module art/fuel-hooks
 */
import * as THREE from 'three';

const live = new Set();
let wired = null;

/** Called by building-props for every library fuel tank (outer = placed group, anchors = world-space sidecar anchors). */
export function attachFuelHooks(outer, b, p, anchors = []) {
  if (!/^fuel_tank_elevated(?!_destroyed)/.test(b?.asset || '')) return;
  const spout = anchors.find((a) => a.name === 'spout');
  if (!spout) return;
  const h = { outer, def: p, spout: { x: spout.pos.x, y: spout.pos.y, z: spout.pos.z }, clicks: 0, angle: 0, target: 0, pour: 0, fx: null, destroyed: false };
  outer.userData.fuelValve = h;
  live.add(h);
}

/** Valve handwheel nodes currently attached under a tank (one per loaded LOD). */
function wheels(h) {
  const out = [];
  h.outer.traverse((o) => { if (o.name === 'valve' || /^valve(_\d+)?$/.test(o.name)) out.push(o); });
  return out;
}

/** World `device` events → valve turns; the device's placeholder post near the spout is hidden. */
export function wireFuelHooks(world) {
  unwireFuelHooks();
  if (!world?.events?.on) return;
  const off = world.events.on('device', (e) => {
    for (const h of live) {
      if (h.destroyed || e?.x == null) continue;
      if (Math.hypot(e.x - h.spout.x, e.z - h.spout.z) > 1.5) continue;
      h.clicks++;
      h.target += (Math.PI * 2) / 3;
      if (h.clicks >= 3 && !h.fx) startPour(h);
    }
  });
  wired = { world, off, hidden: false, t: 0 };
}

export function unwireFuelHooks() {
  if (wired?.off) wired.off();
  wired = null;
}

/** Mission unload. */
export function resetFuelHooks() {
  for (const h of live) stopPour(h);
  live.clear();
  unwireFuelHooks();
}

function startPour(h) {
  const g = new THREE.Group();
  g.name = 'oil_pour';
  const oil = new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.92 });
  const s = h.spout;
  // the stream leaves the spout heading -X (local), arcs out ~0.2 m and falls to the ground
  const outer = h.outer;
  outer.updateMatrixWorld(true);
  const dir = new THREE.Vector3(-1, 0, 0).transformDirection(outer.matrixWorld).setY(0).normalize();
  const p0 = new THREE.Vector3(s.x, s.y, s.z), p1 = p0.clone().addScaledVector(dir, 0.18).setY(s.y - 0.12);
  const p2 = p0.clone().addScaledVector(dir, 0.26).setY(0.02);
  const curve = new THREE.CatmullRomCurve3([p0, p1, p2]);
  const stream = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.03, 6, false), oil);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 28), oil.clone());
  pool.material.polygonOffset = true; pool.material.polygonOffsetFactor = -2; pool.material.depthWrite = false;
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(p2.x, 0.025, p2.z);
  pool.scale.setScalar(0.05);
  g.add(stream, pool);
  const root = outer.parent || outer;
  root.add(g);
  h.fx = { g, stream, pool, t: 0 };
}

function stopPour(h) {
  if (!h.fx) return;
  h.fx.g.removeFromParent();
  h.fx.g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  h.fx = null;
}

/** Per frame (building-props tickBuildings): wheel spin easing, pour growth + flicker, placeholder hiding. */
export function tickFuelHooks(dt) {
  if (wired && !wired.hidden && live.size && (wired.t += dt) > 0) {
    // the set-piece's own valve device (placeholder post) stands on our spout: hide its mesh
    for (const it of wired.world.interactables || []) {
      const tag = String(it.tag ?? it.id ?? '');
      if (!/valve/i.test(tag) && !/valve/i.test(it.params?.label || '')) continue;
      for (const h of live) if (it.object3d && Math.hypot(it.x - h.spout.x, it.z - h.spout.z) < 1.5) it.object3d.visible = false;
    }
    if (wired.t > 3) wired.hidden = true;                      // set-pieces may add the device after the map
  }
  for (const h of live) {
    if (!h.destroyed && /_destroyed/.test(h.outer.userData.libraryAsset || '')) { h.destroyed = true; stopPour(h); }   // wreck swapped in
    if (h.destroyed) continue;
    if (h.angle < h.target) {
      h.angle = Math.min(h.target, h.angle + dt * Math.PI * 1.6);
      for (const w of wheels(h)) {
        w.userData.baseRotZ ??= w.rotation.z;
        w.rotation.z = w.userData.baseRotZ + h.angle;          // the stem axis (Blender -Y → glTF +Z)
      }
    }
    if (h.fx) {
      const f = h.fx;
      f.t += dt;
      f.pool.scale.setScalar(Math.min(1.3, 0.05 + f.t * 0.16));
      f.stream.material.opacity = 0.8 + 0.12 * Math.sin(f.t * 23);    // glistening flow
    }
  }
}
