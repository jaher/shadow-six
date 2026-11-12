/**
 * M20 flags (GPU; castle pass, user 2026-11-10: "Nazi flags no medieval flags and so on"): no medieval or heraldic banner
 * is left in the castle's scene; its flags and hanging banners are the flag system's (art/flags.js) and follow Options →
 * INSIGNIA — the historical national flag by default, the field-grey Balkenkreuz banner when NEUTRAL, live, and back.
 */
/** (M20's load — the castle's art, the library models, the warm-up — runs over a minute on a busy host) */
export const timeout = 300_000;

export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, out = {};
    await g.loadMission('m20');
    g.start();
    for (let k = 0; k < 5; k++) g.step();
    const flags = [], banners = [], heraldry = [];
    G.renderer.scene.traverse((o) => {
      if (!o.isMesh) return;
      const mn = Array.isArray(o.material) ? o.material.map((m) => m.name).join(',') : o.material?.name || '';
      // (a library building drawn as a measured proxy keeps its own flag hidden: invisible stand-in materials)
      const shown = !(Array.isArray(o.material) ? o.material : [o.material]).some((m) => m?.visible === false);
      if (o.name === 'flag_cloth' && shown) flags.push(o);
      if (o.name === 'flag_banner' && shown) banners.push(o);
      if (/m20:banner|baden|heraldic/i.test(mn) || /m20:banners/.test(o.name)) heraldry.push(`${o.name} (${mn})`);
    });
    out.heraldry = heraldry;
    out.flags = flags.length; out.banners = banners.length;
    const maps = () => [...new Set([...flags, ...banners].map((o) => o.material.map?.name))];
    out.hist = maps();
    // a banner's canvas: red cloth, the white disc high on its centre line, the black swastika in it
    const b0 = banners[0], img = b0?.material.map?.image;
    const px = (u, v) => Array.from(img.getContext('2d').getImageData(Math.round(u * img.width), Math.round(v * img.height), 1, 1).data);
    // (the disc: radius 0.4 of the width, centred 0.3 down; sampled at 0.92 of its radius straight above the centre)
    if (img) { out.cloth = px(0.5, 0.8); out.disc = px(0.5, 0.3 - (0.92 * 0.4 * img.width) / img.height); out.centre = px(0.5, 0.3); }
    // where they fly: by the keep, the gates, the guardhouse, the vehicle park, the church
    const at = (o) => { o.updateMatrixWorld(true); const e = o.matrixWorld.elements; return [e[12], e[14]]; };
    out.places = [...flags, ...banners].map(at).map(([x, z]) => [+x.toFixed(1), +z.toFixed(1)]);
    G.hud.setOption('insignia', 'neutral', { quiet: true });
    g.render();
    out.neutral = maps();
    G.hud.setOption('insignia', 'historical', { quiet: true });
    g.render();
    out.back = maps();
    return out;
  });
  t.ok(r.heraldry.length === 0, `no medieval banner left: ${r.heraldry.join(', ')}`);
  t.ok(r.flags >= 4, `period flags on poles (${r.flags})`);
  t.ok(r.banners >= 9, `hanging banners (${r.banners})`);
  t.ok(r.hist.length && r.hist.every((n) => /^(flag|banner)_historical:/.test(n)), `historical by default: ${r.hist}`);
  const red = (c) => c && c[0] > 130 && c[0] > c[1] * 2 && c[0] > c[2] * 2;
  const white = (c) => c && c[0] > 180 && c[1] > 175 && c[2] > 160;
  const black = (c) => c && c[0] < 70 && c[1] < 70 && c[2] < 70;
  t.ok(red(r.cloth), `the banner's red cloth ${r.cloth}`);
  t.ok(white(r.disc), `its white disc ${r.disc}`);
  t.ok(black(r.centre), `the black swastika at the disc's centre ${r.centre}`);
  const near = (x, z, d) => r.places.some(([a, b]) => Math.hypot(a - x, b - z) < d);
  t.ok(near(12, 45.5, 3), 'the keep\'s flag');
  t.ok(near(57, 114, 8) && near(116, 114, 8) && near(72, 66, 8), 'over the three gates');
  t.ok(near(84.5, 96.7, 1.5), 'the guardhouse\'s flag');
  t.ok(near(120.7, 56.3, 1.5), 'the vehicle park\'s flag');
  t.ok(r.neutral.every((n) => /^(flag|banner)_neutral:/.test(n)), `NEUTRAL repaints them live: ${r.neutral}`);
  t.ok(r.back.every((n) => /^(flag|banner)_historical:/.test(n)), 'back to HISTORICAL');
  await t.shot('m20-flags');
}
