/**
 * Boats at rest on the ground (GPU; art/boat-rest.js). The user (M1): "the raft is crossing the land, make it stand on
 * top of the land". Every boat's hull, as drawn (every LOD of the model shown: intact or the deflated wreck), is
 * measured against the drawn terrain — the terrain mesh's own triangles, read from its geometry — and the water:
 *  - no hull vertex is under the ground by more than PEN (the soft tubes may flatten a few mm) — on dry land, on the
 *    bank, and for the light craft (raft, rowboat) on the shallow bed too; a keel at a mooring under the water is not
 *    counted (deep-keeled boats float over their bed);
 *  - the raft's paddles left in their rowlocks never go into the ground either;
 *  - the hull is not perched: its contacts (underside samples on the ground within CONTACT, or in the water) surround
 *    its centre of mass, and wherever it lies over land it touches it (no hovering above its contact points).
 * Scenes: every mission's boats at the start (M1 raft on the peninsula's west shore, M3, M18 rafts on their banks,
 * M13's raft by the quay, the others afloat); M1: the raft paddled off and run back into the bank (beached by the
 * player); the Marine inflating a raft at the water's edge facing the shore (bow on the bank); the raft shot until it
 * deflates on the bank (the wreck lies on the ground). Before the fix the M1 raft's stern was 22 cm into the snow.
 * BOATREST_SHOTS=<dir> saves a frame of each scene.
 */
export const timeout = 900_000;

const PEN = 0.015, CONTACT = 0.03;
const SHOTS = process.env.BOATREST_SHOTS || '';

function install([CONTACT]) {
  const g = window.__game, G = g.game;
  const R = window.__rest = { g, G };
  R.idle = async (n) => { for (let k = 0; k < n; k++) { g.step(); if (k % 3 === 0) G.render(1 / 60, 1); if (k % 30 === 29) await new Promise((r) => setTimeout(r, 0)); } G.render(1 / 60, 1); };
  R.load = async (id) => {
    await g.loadMission(id); g.start();
    const w = G.world;
    for (let i = 0; i < 150 && !w.vehicles.filter((v) => v.isBoat).every((v) => v.model?.isReady !== false); i++) { await new Promise((r) => setTimeout(r, 100)); g.step(); G.render(1 / 60, 1); }
    await R.idle(60);
    return w;
  };
  /** Height of the drawn terrain under (x, z): the mesh triangle (PlaneGeometry: quads split along (i, j+1)–(i+1, j)), or null off the map. */
  R.meshY = (x, z) => {
    const mesh = G.world.terrain?.terrain?.mesh, geo = mesh?.geometry, P = geo?.parameters;
    if (!P) return null;
    const W = P.width, D = P.height, sx = P.widthSegments, sz = P.heightSegments, pos = geo.attributes.position;
    if (x < 0 || z < 0 || x > W || z > D) return null;
    const fx = Math.min(sx - 1e-3, (x / W) * sx), fz = Math.min(sz - 1e-3, (z / D) * sz), i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, r = sx + 1;
    const a = pos.getY(j * r + i), b = pos.getY(j * r + i + 1), c = pos.getY((j + 1) * r + i), d = pos.getY((j + 1) * r + i + 1);
    return mesh.position.y + (tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz));
  };
  R.level = (x, z) => { const s = G.world.water?.sample?.(x, z); return s ? s.level : null; };
  /** Measure a boat as drawn now. */
  R.measure = async (v) => {
    const THREE = await import('three');
    const m = v.model, o = m?.visual?.object3d;
    if (!o || !m.isReady) return { ready: false };
    o.updateWorldMatrix(true, true);
    const inst = o.children.find((c) => c.visible && c.children.some((q) => /_lod\d+$/.test(q.name)));
    if (!inst) return { ready: false };
    const lods = inst.children.filter((q) => /_lod\d+$/.test(q.name)).sort((a, b) => a.name.localeCompare(b.name));
    const beach = /raft|rowboat/.test(m.libType), loose = (q, top) => { for (let a = q; a && a !== top; a = a.parent) if (/paddle|oar|splash/i.test(a.name)) return a.name; return null; };
    const p = new THREE.Vector3(), inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
    let pen = -Infinity, penAt = null, padPen = -Infinity, n = 0;
    const local = [];
    lods.forEach((lod, li) => lod.traverse((q) => {
      if (!q.isMesh || !q.geometry?.attributes?.position) return;
      const part = loose(q, lod);
      if (part && !q.visible) return;
      let shown = true; for (let a = q; a && a !== lod; a = a.parent) if (!a.visible) shown = false;
      if (!shown) return;
      const pos = q.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(q.matrixWorld);
        if (li === 0 && !part) local.push(p.clone().applyMatrix4(inv));
        const gnd = R.meshY(p.x, p.z);
        if (gnd == null) continue;
        const L = R.level(p.x, p.z);
        if (!beach && L != null && gnd < L) continue; // a keel over its bed under the water
        const d = gnd - p.y;
        if (part) { if (d > padPen) padPen = d; continue; }
        n++;
        if (d > pen) { pen = d; penAt = [p.x, p.y, p.z].map((t) => +t.toFixed(2)); }
      }
    }));
    // underside samples (0.2 m cells, lowest vertex) → contacts
    const cells = new Map();
    for (const q of local) { const k = `${Math.floor(q.x / 0.2)},${Math.floor(q.z / 0.2)}`; const c = cells.get(k); if (!c || q.y < c.y) cells.set(k, q); }
    const L0 = m.dims?.l || 3, contacts = [];
    let land = 0, landGap = Infinity;
    for (const q of cells.values()) {
      const wp = o.localToWorld(q.clone()), gnd = R.meshY(wp.x, wp.z), L = R.level(wp.x, wp.z);
      if (gnd == null) continue;
      const overLand = L == null || gnd >= L;
      if (overLand) { land++; landGap = Math.min(landGap, wp.y - gnd); }
      const onGround = (beach || overLand) && wp.y - gnd <= CONTACT, inWater = L != null && wp.y <= L + 0.015;
      if (onGround || inWater) contacts.push([q.x, q.z]);
    }
    const encloses = (P, c) => {
      P = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], hi = [];
      for (const q of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
      for (const q of P.slice().reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
      const H = lo.slice(0, -1).concat(hi.slice(0, -1));
      return H.length >= 3 && H.every((a, i) => cr(a, H[(i + 1) % H.length], c) >= -1e-9);
    };
    const com = [0, -0.03 * L0];
    return { ready: true, id: v.tag ?? v.id, lib: m.libType, destroyed: !!v.destroyed, verts: n, pen: n ? +pen.toFixed(3) : -1, penAt, paddles: +padPen.toFixed(3),
      samples: cells.size, land, landGap: land ? +landGap.toFixed(3) : null, contacts: contacts.length, resting: encloses(contacts, com) };
  };
  R.boats = () => G.world.vehicles.filter((v) => v.isBoat && !v.removed);
}

export default async function (page, t) {
  const shot = async (n, x, z, zoom = 3) => {
    if (!SHOTS) return;
    await page.evaluate(([x, z, zoom]) => { const R = window.__rest; R.G.cameraController.setZoom(zoom, true); R.G.cameraController.centerOn(x, z); R.G.render(1 / 60, 1); R.G.render(1 / 60, 1); }, [x, z, zoom]);
    await page.screenshot({ path: `${SHOTS}/${n}.jpg`, type: 'jpeg', quality: 85 });
  };
  const check = (scene, r) => {
    t.log(scene, JSON.stringify(r));
    t.ok(r.ready, `${scene}: model drawn`);
    t.ok(r.pen <= PEN, `${scene}: no part of the hull under the ground (deepest ${(r.pen * 100).toFixed(1)} cm at ${JSON.stringify(r.penAt)})`);
    if (r.lib === 'raft' && !r.destroyed) t.ok(r.paddles <= PEN, `${scene}: paddles clear of the ground (${(r.paddles * 100).toFixed(1)} cm)`);
    t.ok(r.resting, `${scene}: resting on contacts round its centre (${r.contacts} contacts), not perched on one`);
    if (r.land && r.lib === 'raft') t.ok(r.landGap <= CONTACT, `${scene}: lying on the land it is over (gap ${r.landGap})`);
  };
  await page.evaluate(install, [CONTACT]);

  // ---- every mission's boats at the start (the M1 raft on the shore first: the user's report)
  const missions = ['m01', 'm03', 'm18', 'm13', 'm02', 'm04', 'm07', 'm14', 'm17', 'm19', 'b00'];
  const onLand = [];
  for (const id of missions) {
    const res = await page.evaluate(async (id) => {
      const R = window.__rest, w = await R.load(id);
      const out = [];
      for (const v of R.boats()) out.push({ ...(await R.measure(v)), x: +v.x.toFixed(1), z: +v.z.toFixed(1) });
      return out;
    }, id);
    t.ok(res.length > 0, `${id}: has boats`);
    for (const r of res) {
      check(`${id} ${r.id}`, r);
      if (r.land) onLand.push(`${id}:${r.id}`);
    }
    if (id === 'm01') {
      const raft = res.find((r) => r.id === 'raft');
      t.ok(raft?.land > 3, `M1: the raft lies partly over the peninsula's shore (${raft?.land} samples over land)`);
      await shot('m01-start', 37.2, 60.5);
    }
  }
  t.log('boats over land at the start:', onLand.join(' '));
  t.ok(['m01:raft', 'm03:raft', 'm18:raft'].every((k) => onLand.includes(k)), 'the M1, M3 and M18 rafts start on their banks');

  // ---- M1: paddled off the bank and run back into it (beached by the player), then the Marine steps out
  const beached = await page.evaluate(async () => {
    const R = window.__rest, w = await R.load('m01'), out = {};
    for (const e of [...w.enemies]) w.remove(e);
    w.flushRemovals?.();
    const raft = w.vehicles.find((v) => v.vehicleType === 'raft'), ma = w.commandos.find((c) => c.role === 'diver');
    ma.setPosition(38.6, 60.5, Math.PI);
    await R.idle(10);
    raft.enter(ma);
    await R.idle(40);
    const drive = async (x, z) => { ma.issue({ type: 'move', x, z }); for (let s = 0; s < 60; s++) { await R.idle(15); if (!raft.goal && s > 2) break; } };
    await drive(33, 59);      // off the bank
    out.off = await R.measure(raft);
    await drive(41, 61.5);    // straight back into the bank: it stops with its bow on the shore line
    await R.idle(60);
    out.beached = { ...(await R.measure(raft)), x: +raft.x.toFixed(2), z: +raft.z.toFixed(2) };
    raft.exit(ma);
    await R.idle(120);
    out.left = await R.measure(raft);
    return out;
  });
  check('M1 raft paddled off', beached.off);
  check('M1 raft run back into the bank', beached.beached);
  check('M1 raft beached, Marine out', beached.left);
  await shot('m01-beached', beached.beached.x, beached.beached.z);

  // ---- the Marine inflates a raft at the water's edge, facing the shore: its bow lies on the bank
  const inflated = await page.evaluate(async () => {
    const R = window.__rest, w = await R.load('m01');
    for (const e of [...w.enemies]) w.remove(e);
    const old = w.vehicles.find((v) => v.vehicleType === 'raft'); w.remove(old);
    w.flushRemovals?.();
    const ma = w.commandos.find((c) => c.role === 'diver');
    // the shallow rim off the peninsula's west shore, the last wet cell before the snow (east of it)
    let spot = null;
    for (let x = 34; x < 38 && !spot; x += 0.1) {
      const t0 = w.grid.terrainAt(x, 70), t1 = w.grid.terrainAt(x + 0.5, 70);
      if (t0 === 6 && t1 !== 6 && t1 !== 5) spot = { x: x - 0.1, z: 70 };
    }
    ma.setPosition(spot.x, spot.z, 0); // facing east, at the shore
    ma.gainItem('inflatableBoat', 1);
    await R.idle(10);
    const ok = ma.issue({ type: 'ability', id: 'raft', target: ma });
    await R.idle(200);
    const raft = w.vehicles.find((v) => v.vehicleType === 'raft');
    for (let i = 0; i < 60 && !raft?.model?.isReady; i++) { await new Promise((r) => setTimeout(r, 100)); await R.idle(3); }
    await R.idle(30);
    const aboard = raft?.occupants?.length;
    const m1 = raft ? await R.measure(raft) : { ready: false };
    raft?.exit(ma);
    await R.idle(120);
    const m2 = raft ? await R.measure(raft) : { ready: false };
    return { spot, ok, aboard, aboardM: m1, empty: m2, x: raft?.x, z: raft?.z };
  });
  t.log('inflated at', JSON.stringify(inflated.spot), 'order', inflated.ok, 'aboard', inflated.aboard);
  t.ok(inflated.ok && inflated.aboard === 1, 'the Marine inflated the raft at the shore and got in');
  check('raft inflated at the shore, Marine aboard', inflated.aboardM);
  check('raft inflated at the shore, empty', inflated.empty);
  t.ok(inflated.empty.land > 3, `the inflated raft's bow lies over the bank (${inflated.empty.land} samples)`);
  await shot('m01-inflated', inflated.x, inflated.z);

  // ---- the raft shot until it deflates on the bank: the wreck lies on the ground
  const deflated = await page.evaluate(async () => {
    const R = window.__rest, w = await R.load('m01');
    const raft = w.vehicles.find((v) => v.vehicleType === 'raft');
    raft.destroy(null, 'deflated');
    for (let i = 0; i < 80 && !raft.model.visual?.object3d?.children.some((c) => c.visible && /deflated/.test(c.name)); i++) { await new Promise((r) => setTimeout(r, 100)); await R.idle(3); }
    await R.idle(60);
    return await R.measure(raft);
  });
  check('M1 raft deflated on the bank', deflated);
  t.ok(deflated.destroyed && deflated.land > 3, 'the deflated raft lies over the bank');
  await shot('m01-deflated', 37.2, 60.5);
}
