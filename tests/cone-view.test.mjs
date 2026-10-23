/**
 * Cones off the screen wait, cones on it are drawn as their guard stands — in the frame the camera brings them there.
 * (M11 perf: VisionCones.update(camera) rebuilds no sector for a guard whose cone is out of the view.) The view it judges
 * by is the rig's camera as CameraRig.update has just set it: renderer.camera is the copy the LAST draw made, a frame
 * behind, so a cone scrolling into view was refreshed (and drawn) a frame late.
 * The M0 bridge sentry (60 x 60 m map), his cone shown, facing east; the camera goes to the west edge, he turns to the
 * south-east, the camera comes back: ONE render.
 */
export const timeout = 120_000;

export default async function coneView(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m00');
    const w = G.world;
    for (const e of [...w.enemies]) if (e.tag !== 'sentry_bridge') w.remove(e);
    for (const c of [...w.commandos]) if (c.role !== 'greenberet') w.remove(c);
    const s = w.enemies.find((e) => e.tag === 'sentry_bridge');
    s.setPosition(s.x, s.z, 0);
    Object.assign(s.post, { heading: 0, sweep: 0, scan: null });
    g.start();
    G.cameraController.setZoom(1.6, true);
    G.toggleCone(s, true);
    const { coneAt } = await import('/src/ai/perception.js');
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const cam = G.cameraController;
    const at = (x, z) => { cam.centerOn(x, z); };
    const vc = () => G.cones.cones.get(s);
    const lag = () => { const d = vc()?.drawnWindow(); return d ? Math.abs(wrap(d.heading - coneAt(s).heading)) : null; };
    const out = {};
    at(s.x, s.z); G.render(1 / 60, 1);
    out.shown = !!vc()?.group.visible;
    out.lag0 = lag();
    out.rebuilds0 = vc()?.rebuilds;
    // the view goes to the west edge (his 36 m cone, east of x 47, is nowhere near it); he turns to the south-east
    at(6, s.z);
    G.render(1 / 60, 1);
    s.setPosition(s.x, s.z, Math.PI / 4);
    for (let i = 0; i < 5; i++) { G.render(1 / 60, 1); }
    out.rebuildsAway = vc()?.rebuilds;
    out.lagAway = lag();
    // and back: the one frame that brings it into view draws it as he stands
    at(s.x, s.z);
    G.render(1 / 60, 1);
    out.lagBack = lag();
    out.visible = !!vc()?.group.visible;
    const d = vc()?.drawnWindow();
    out.apexOk = !!d && d.x === s.x && d.z === s.z;
    return out;
  });
  t.log('cone view:', JSON.stringify(r));
  t(r.shown && r.lag0 === 0, `his cone is drawn as he stands (${r.lag0})`);
  t(r.rebuildsAway === r.rebuilds0, `no sector rebuilt while the cone is off the screen (${r.rebuilds0} -> ${r.rebuildsAway})`);
  t(r.lagAway > 0.5, `and it is left as it was (${r.lagAway?.toFixed(2)} rad behind him)`);
  t(r.lagBack === 0 && r.apexOk && r.visible, `the frame that brings it into view draws it as he stands (${r.lagBack} rad off)`);
}
