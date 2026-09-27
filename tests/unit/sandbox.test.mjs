/** Sandbox mission + stub modules (map-builder, props, terrain, cones, fx, vehicles, projectiles). Uses three.js from node_modules. */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { World } from '../../src/world/world.js';
import { B, T } from '../../src/world/grid.js';
import { buildMap } from '../../src/world/map-builder.js';
import { buildProp, PROP_TYPES } from '../../src/art/props.js';
import { MISSIONS, getMission } from '../../src/missions/index.js';
import { VisionCone } from '../../src/render/vision-cone.js';
import { FX } from '../../src/render/fx.js';
import { Vehicle } from '../../src/entities/vehicle.js';
import { Projectile } from '../../src/entities/projectile.js';
import { createAudio } from '../../src/audio/audio.js';
import { createHumanoid, ANIMS } from '../../src/art/humanoid.js';

function sandbox() {
  const def = getMission('m00');
  const scene = new THREE.Scene();
  const world = new World({ size: def.size, scene, mission: def });
  const handle = buildMap(world, def);
  world.rebuildSpatial();
  return { def, world, handle, scene };
}

test('missions list starts with the sandbox', () => {
  assert.equal(MISSIONS[0].id, 'm00');
  assert.deepEqual(MISSIONS[0].size, [60, 60]);
  assert.equal(MISSIONS[0].commandos.length, 3);
  assert.equal(MISSIONS[0].enemies.length, 5);
});

test('every catalogue prop builds with an Object3D', () => {
  for (const t of PROP_TYPES) {
    const r = buildProp(t, { x: 10, z: 10, rot: 0.4, points: [[2, 2], [9, 2], [9, 7]] });
    assert.ok(r.object3d?.isObject3D, t);
    assert.ok(Array.isArray(r.footprints), t);
  }
});

test('sandbox grid: river deep water, bridge walkable, fence/wall/sandbag blocks', () => {
  const { world } = sandbox();
  const g = world.grid;
  const at = (x, z) => g.idx(g.worldToCell(x, z).i, g.worldToCell(x, z).j);
  assert.equal(g.terrain[at(40, 10)], T.WATER);
  assert.equal(g.walkableAt(40, 10), false);
  assert.equal(g.bridge[at(40, 30)], 1);
  assert.equal(g.walkableAt(40, 30), true);
  assert.equal(g.block[at(26, 40)], B.FENCE);
  assert.equal(g.block[at(51, 4)], B.HIGH);
  assert.equal(g.block[at(47.5, 25.5)], B.LOW);
  assert.equal(g.block[at(52, 38)], B.HIGH); // fuel tank
  assert.equal(g.terrain[at(10, 30)], T.ROAD);
});

test('sandbox paths: start → across the bridge into the compound, and → extraction', () => {
  const { world, def } = sandbox();
  const c = def.commandos[0];
  const p = world.findPath(c.x, c.z, 50, 30);
  assert.ok(p && p.length > 1, 'path across the bridge');
  const e = world.findPath(c.x, c.z, def.extraction.x, def.extraction.z);
  assert.ok(e, 'path to extraction');
  for (const s of def.enemies) assert.ok(world.grid.walkableAt(s.x, s.z), `enemy ${s.id} on walkable cell`);
  for (const s of def.commandos) assert.ok(world.grid.walkableAt(s.x, s.z), `commando ${s.role} on walkable cell`);
});

test('fuel depot is a destructible interactable destroyed only by explosions', () => {
  const { world } = sandbox();
  const fuel = world.byId('fuel_depot');
  assert.ok(fuel && fuel.interactKind === 'explosiveTarget');
  fuel.takeDamage(500, null, 'pistol');
  assert.equal(fuel.destroyed, false);
  let boom = 0;
  world.events.on('explosion', () => boom++);
  world.damageRadius(fuel.x, fuel.z, 5, 1000, null, 'explosion');
  assert.equal(fuel.destroyed, true);
  assert.equal(fuel.alive, false);
  assert.ok(boom >= 1);
  assert.equal(world.grid.blockAt(52, 38), B.NONE);
});

test('vision cone fan clips on walls; fx spawns and expires; audio logs', () => {
  const { world } = sandbox();
  const enemy = { kind: 'enemy', world, x: 47, z: 30, heading: 0, alertLevel: 2, vision: { range: 20, nearRange: 10, fov: Math.PI / 2, elevated: false } };
  const cone = new VisionCone(enemy, world);
  cone.update();
  const pos = cone.farGeo.attributes.position.array;
  let maxX = 0;
  for (let k = 0; k < pos.length; k += 3) maxX = Math.max(maxX, pos[k]);
  assert.ok(maxX <= 58.5, `cone clipped by the east wall (maxX ${maxX})`);
  assert.equal(cone.nearMesh.material.depthWrite, false);
  const fx = new FX(world, world.scene);
  world.events.emit('explosion', { x: 10, z: 10, radius: 4, kind: 'grenade' });
  assert.ok(fx.items.some((r) => r.kind === 'grenade'), 'grenade blast → grenade VFX');
  for (let k = 0; k < 600; k++) fx.update(1 / 60); // headless: no GPU, the sim tick is still safe
  fx.dispose();
  const audio = createAudio(world.events);
  world.events.emit('explosion', { x: 0, z: 0, radius: 4 });
  assert.ok(audio.log.some((l) => l.event === 'explosion' && l.name === 'explosion_big')); // §9.3 id, tagged with its event
});

test('grenade projectile flies, lands, explodes; vehicle drives on land', () => {
  const { world } = sandbox();
  const target = { kind: 'enemy', x: 20, z: 20, hp: 100, alive: true, takeDamage(a) { this.hp -= a; if (this.hp <= 0) this.alive = false; } };
  world.add(target);
  const g = world.add(new Projectile('grenade', { from: { x: 14, z: 20 }, to: { x: 20, z: 20 } }));
  for (let k = 0; k < 180 && !world.entities.every((e) => e !== g) && g.alive; k++) { world.rebuildSpatial(); g.update(1 / 60); }
  assert.equal(g.alive, false);
  assert.equal(target.alive, false);
  const v = world.add(new Vehicle({ vehicleType: 'truck', x: 5, z: 30, heading: 0 }));
  assert.ok(v.moveTo(25, 30));
  for (let k = 0; k < 600; k++) v.update(1 / 60);
  assert.ok(Math.hypot(v.x - 25, v.z - 30) < 1.5, `truck arrived (${v.x.toFixed(1)}, ${v.z.toFixed(1)})`);
});

test('humanoid supports every contract animation', () => {
  const h = createHumanoid({ faction: 'enemy', soldierType: 'officer' });
  for (const a of ANIMS) { h.setAnim(a); h.update(0.1); assert.equal(h.anim, a); }
  h.setDisguise(true);
  assert.equal(h.disguised, true);
});
