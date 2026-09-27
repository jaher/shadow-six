/**
 * STUB — owned by ART (see docs/ARCHITECTURE.md). Placeholder soldier: capsule body + head + nose
 * (nose points along +Z = model forward) + a role/type hat so silhouettes are distinguishable.
 * Animations are procedural poses (bob, lie down for crawl/dead, lean for aim) — the realism pipeline
 * replaces this with rigged glTF soldiers behind the same interface.
 * @module art/humanoid
 */

import * as THREE from 'three';

/** Animation names the contract requires (missing ones fall back to idle). */
export const ANIMS = ['idle', 'walk', 'run', 'crawl_idle', 'crawl', 'swim', 'dive', 'aim', 'shoot', 'stab',
  'throw', 'punch', 'plant', 'climb', 'carry_idle', 'carry_walk', 'die', 'dead', 'surrender', 'salute',
  'look_around', 'use'];

const ROLE_COLORS = {
  greenberet: { body: 0x4f5a34, hat: 0x2f6b2f },
  sniper: { body: 0x5e5a3e, hat: 0x6b5a3a },
  diver: { body: 0x2a2f33, hat: 0x1c1c1c },
  sapper: { body: 0x55553d, hat: 0x4a4f3a },
  driver: { body: 0x6a5a42, hat: 0x3f3a30 },
  spy: { body: 0x3e3f44, hat: 0x2a2a2e },
};
const ENEMY_COLORS = {
  soldier: { body: 0x5d6258, hat: 0x4b5049 },
  officer: { body: 0x6a6e66, hat: 0x3a3d3a },
  sentry: { body: 0x5d6258, hat: 0x4b5049 },
  sniper: { body: 0x566050, hat: 0x4b5049 },
  mg: { body: 0x5d6258, hat: 0x4b5049 },
  tankcrew: { body: 0x2e2e2e, hat: 0x1e1e1e },
};
const SKIN = 0xc79a7a;
const DISGUISE = { body: 0x6a6e66, hat: 0x3a3d3a }; // spy in a German officer uniform

/** Build the hat mesh for a role / soldier type (distinct silhouettes at isometric zoom). */
function makeHat(kind, mat) {
  let geo;
  switch (kind) {
    case 'greenberet': geo = new THREE.CylinderGeometry(0.15, 0.15, 0.06, 12); break; // beret
    case 'sniper': geo = new THREE.CylinderGeometry(0.14, 0.16, 0.08, 12); break; // field cap
    case 'diver': geo = new THREE.SphereGeometry(0.16, 12, 8); break; // diving hood
    case 'sapper': case 'soldier': case 'sentry': case 'mg': case 'sniper_e':
      geo = new THREE.SphereGeometry(0.18, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); break; // helmet
    case 'driver': geo = new THREE.CylinderGeometry(0.15, 0.15, 0.07, 12); break;
    case 'spy': case 'officer': geo = new THREE.CylinderGeometry(0.17, 0.13, 0.1, 12); break; // peaked cap
    default: geo = new THREE.CylinderGeometry(0.14, 0.14, 0.06, 12);
  }
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

/**
 * @param {{faction?:'player'|'enemy', role?:string, soldierType?:string, colors?:{body?:number,hat?:number}}} opts
 * @returns {{root:THREE.Group, setAnim:Function, update:Function, setColors:Function, setDisguise:Function, anim:string}}
 */
export function createHumanoid(opts = {}) {
  const { faction = 'player', role = null, soldierType = 'soldier', colors = {} } = opts;
  const base = faction === 'enemy' ? ENEMY_COLORS[soldierType] || ENEMY_COLORS.soldier : ROLE_COLORS[role] || ROLE_COLORS.greenberet;
  const bodyMat = new THREE.MeshStandardMaterial({ color: colors.body ?? base.body, roughness: 0.85 });
  const hatMat = new THREE.MeshStandardMaterial({ color: colors.hat ?? base.hat, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7 });

  const root = new THREE.Group();
  root.name = `humanoid:${faction}:${role || soldierType}`;
  const pivot = new THREE.Group(); // rotated to lie down (crawl/dead)
  root.add(pivot);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.95, 4, 10), bodyMat);
  body.position.y = 0.7;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), skinMat);
  head.position.y = 1.52;
  head.castShadow = true;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.1), skinMat);
  nose.position.set(0, 1.52, 0.15);
  const hatKind = faction === 'enemy' ? (soldierType === 'sniper' ? 'sniper_e' : soldierType) : role;
  const hat = makeHat(hatKind, hatMat);
  hat.position.y = 1.62;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.5), bodyMat); // weapon arm, raised when aiming
  arm.position.set(0.2, 1.05, 0.1);
  arm.visible = false;
  pivot.add(body, head, nose, hat, arm);

  const model = {
    root,
    anim: 'idle',
    animTime: 0,
    speed: 1,
    loop: true,
    parts: { pivot, body, head, nose, hat, arm },
    setAnim(name, o = {}) {
      const n = ANIMS.includes(name) ? name : 'idle';
      if (n === this.anim && o.restart !== true) return;
      this.anim = n;
      this.animTime = 0;
      this.loop = o.loop !== false;
      this.speed = o.speed ?? 1;
    },
    update(dt) {
      this.animTime += dt * this.speed;
      const t = this.animTime, a = this.anim;
      const lying = a === 'crawl' || a === 'crawl_idle' || a === 'dead' || a === 'swim' || a === 'dive';
      let tilt = 0;
      if (lying) tilt = Math.PI / 2 - 0.05;
      else if (a === 'die') tilt = Math.min(1, t / 0.8) * (Math.PI / 2 - 0.05);
      pivot.rotation.x = tilt; // fall forward (+Z)
      pivot.position.y = lying || a === 'die' ? 0.22 * Math.min(1, tilt) : 0;
      if (a === 'swim' || a === 'dive') pivot.position.y = a === 'dive' ? -0.6 : -0.05;
      const bob = a === 'run' ? Math.abs(Math.sin(t * 11)) * 0.08 : a === 'walk' || a === 'carry_walk' ? Math.abs(Math.sin(t * 7)) * 0.04
        : a === 'crawl' ? Math.abs(Math.sin(t * 5)) * 0.03 : 0;
      body.position.y = 0.7 + bob;
      arm.visible = a === 'aim' || a === 'shoot' || a === 'stab' || a === 'throw' || a === 'punch';
      arm.rotation.x = a === 'shoot' ? -0.1 * Math.sin(t * 40) : a === 'stab' || a === 'punch' ? -0.5 * Math.sin(t * 12) : 0;
      head.rotation.y = a === 'look_around' ? Math.sin(t * 1.5) * 0.8 : 0;
      nose.position.x = head.rotation.y * 0.12;
      if (a === 'surrender') arm.visible = true, arm.rotation.x = -Math.PI / 2;
    },
    setColors(c = {}) {
      if (c.body != null) bodyMat.color.set(c.body);
      if (c.hat != null) hatMat.color.set(c.hat);
      if (c.skin != null) skinMat.color.set(c.skin);
    },
    disguised: false,
    setDisguise(on) {
      this.disguised = !!on;
      this.setColors(on ? DISGUISE : { body: colors.body ?? base.body, hat: colors.hat ?? base.hat });
    },
    dispose() {
      root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      bodyMat.dispose(); hatMat.dispose(); skinMat.dispose();
    },
  };
  model.update(0);
  return model;
}

export default createHumanoid;
