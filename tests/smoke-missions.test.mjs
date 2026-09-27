/**
 * Integration smoke (gp merge): each BEL mission M1–M3 runs 60 s of game time in the real game with scripted
 * player input — real mouse/keyboard (selection, move, box select, zoom, multi-view F-keys, Shift probe,
 * pause), orders and abilities through the order API (knife / pistol / sniper / stance / vehicles), a
 * quicksave + quickload and rendering every simulated second. Fails on any page error, console.error, a
 * `[game] … failed` warning from Game's safe() wrappers, or a non-finite unit position.
 */
const MISSIONS = ['m01', 'm02', 'm03'];

export default async function smokeMissions(page, t) {
  await page.evaluate(() => {
    window.__smokeWarn = [];
    const w0 = console.warn.bind(console);
    console.warn = (...a) => {
      const s = a.map((x) => (x && x.stack) || String(x)).join(' ');
      if (/\bfailed\b|TypeError|ReferenceError|RangeError/.test(s)) window.__smokeWarn.push(s.slice(0, 400));
      w0(...a);
    };
  });
  const report = {};
  for (const id of MISSIONS) {
    report[id] = await runMission(page, id);
    t.log(id, JSON.stringify(report[id]));
  }
  const warns = await page.evaluate(() => window.__smokeWarn);
  if (warns.length) t.log('warnings:', warns.slice(0, 6).join('\n'));
  t.equal(warns.length, 0, 'no safe()-wrapped system failed');
  for (const id of MISSIONS) {
    const r = report[id];
    t(r.simTime >= 60, `${id}: ran 60 s of game time`);
    t.equal(r.badPos, 0, `${id}: every unit position stays finite`);
    t(r.loaded, `${id}: quickload restored the mission`);
  }
}

async function runMission(page, id) {
  const pos = await page.evaluate(async (mid) => {
    const g = window.__game;
    await g.loadMission(mid);
    g.start();
    g.setZoom(1);
    const G = g.game;
    const [a, b] = G.world.commandos;
    g.centerOn(a.x, a.z);
    g.render();
    const cam = G.cameraController;
    const s = (x, z) => cam.worldToScreen(x, 0.5, z);
    return { a: s(a.x, a.z), b: s(b.x, b.z), ground: s(a.x + 3, a.z - 2), far: s(a.x - 4, a.z + 2) };
  }, id);
  // --- real mouse + keyboard (CORE2 input, UI capture handlers)
  await page.mouse.click(pos.a.x, pos.a.y);
  await page.mouse.click(pos.ground.x, pos.ground.y);
  await page.mouse.click(pos.far.x, pos.far.y, { clickCount: 1 });
  await page.mouse.click(pos.far.x, pos.far.y, { clickCount: 2 });
  const x0 = Math.min(pos.a.x, pos.b.x) - 30, y0 = Math.min(pos.a.y, pos.b.y) - 30;
  await page.mouse.move(x0, y0);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x0 + 60, y0 + 60, { steps: 3 });
  await page.mouse.up({ button: 'right' });
  await page.keyboard.down('Shift');
  await page.mouse.click(pos.ground.x, pos.ground.y);
  await page.keyboard.up('Shift');
  for (const k of ['Digit1', 'NumpadAdd', 'NumpadSubtract', 'F3', 'F3', 'F5', 'F2', 'KeyP', 'KeyP', 'Digit2', 'Digit0']) await page.keyboard.press(k);
  await page.mouse.move(pos.ground.x, pos.ground.y);
  await page.mouse.wheel(0, -120);
  // --- 60 s of game time with scripted orders, a quicksave at 20 s and a quickload at 30 s
  return page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const out = { simTime: 0, orders: 0, refused: 0, ended: null, badPos: 0, loaded: false, alarm: false, killed: 0, lost: 0 };
    let rng = 12345;
    const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const nearest = (c, list) => list.filter((e) => e.alive).sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z))[0];
    const issue = (c, o) => { out.orders++; if (!c.issue(o)) out.refused++; };
    const orders = (sec) => {
      const w = G.world;
      for (const c of w.commandos) {
        if (!c.alive || c.state === 'jailed') continue;
        const k = (sec / 5 + c.id) % 6;
        const en = nearest(c, w.enemies);
        const veh = nearest(c, w.vehicles.filter((v) => !v.destroyed));
        const [W, D] = w.mission?.size || [60, 60];
        const tx = Math.max(1, Math.min(W - 1, c.x + (rand() - 0.5) * 24)), tz = Math.max(1, Math.min(D - 1, c.z + (rand() - 0.5) * 24));
        if (k === 0) issue(c, { type: 'move', x: tx, z: tz, run: rand() < 0.3 });
        else if (k === 1) issue(c, { type: 'stance', stance: c.stance === 'crawl' ? 'stand' : 'crawl' });
        else if (k === 2 && en) {
          const ab = ['knife', 'sniper', 'smg', 'harpoon', 'pistol'].find((a) => c.abilities.includes(a));
          if (ab) issue(c, { type: 'ability', id: ab, target: en });
        } else if (k === 3 && veh && c.abilities.includes('enterVehicle')) issue(c, { type: 'ability', id: 'enterVehicle', target: veh });
        else if (k === 4) issue(c, c.vehicle ? { type: 'ability', id: 'leaveVehicle', target: c } : { type: 'cancel' });
        else issue(c, { type: 'move', x: tx, z: tz });
      }
    };
    for (let sec = 0; sec < 60; sec++) {
      if (G.state === 'paused' && !G.pendingEnd) G.pause(false); // escaped-early dialog etc.
      if (G.state !== 'playing') {
        // the rules ended it (random orders get men killed): note it, restart the mission, keep going
        (out.endings ||= []).push(`${G.state}@${sec}`);
        await g.loadMission(G.missionDef.id);
        g.start();
      }
      if (sec % 5 === 0) orders(sec);
      if (sec === 20) out.saved = G.quickSave();
      if (sec === 30) out.loaded = await G.quickLoad();
      if (sec === 30 && !out.loaded) out.loaded = false;
      g.advance(1);
      g.render();
      out.simTime += 1;
      for (const u of [...G.world.commandos, ...G.world.enemies, ...G.world.vehicles]) if (!Number.isFinite(u.x) || !Number.isFinite(u.z)) out.badPos++;
    }
    const w = G.world;
    out.alarm = !!w.alarm?.active;
    out.killed = w.enemies.filter((e) => !e.alive).length;
    out.lost = w.commandos.filter((c) => !c.alive).length;
    out.state = G.state;
    return out;
  });
}
