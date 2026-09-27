#!/usr/bin/env node
/**
 * Bake the B1s front-end stills (docs/menus-art-direction.md §1.10): one engine render per theatre of the
 * diorama the live backdrop shows, at the game's standard angle, saved as assets/ui/diorama/<theater>.webp.
 * The olive grade, camo scrim and emblem are applied on top by backdrop.js (_compose: blurred grey soft-light over the camo), exactly as for
 * the live canvas, so still and live match.
 *
 *   node tools/ui/bake_dioramas.mjs            (GPU headless Chromium through tests/harness.mjs)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startHarness, ROOT } from '../../tests/harness.mjs';

/** theatre → mission whose map stands for it (the first mission of that theatre in campaign order). */
const PICKS = { temperate: 'm00', snow: 'm01' };
const OUT = join(ROOT, 'assets/ui/diorama');
mkdirSync(OUT, { recursive: true });

const H = await startHarness({ viewport: { width: 1920, height: 1080 } });
try {
  const page = await H.newPage();
  await H.openGame(page);
  for (const [theater, id] of Object.entries(PICKS)) {
    const url = await page.evaluate(async ({ id }) => {
      const { MISSIONS } = await import('./src/missions/index.js');
      const hud = window.__game.game.hud;
      const bd = hud.backdrop;
      bd._release();
      bd.mode = 'frontend';
      bd.dioramaMission = () => MISSIONS.find((m) => m.id === id);
      await bd._build();
      const r = window.__game.game.renderer;
      r.preset = { ...r.preset, pixelRatio: 1 };
      r.resize();
      bd._place(bd.dio.path.period * 0.02);
      for (let i = 0; i < 4; i++) {
        bd._frameT = 0;
        window.__game.render();
        await new Promise((res) => setTimeout(res, 120));
      }
      bd._frameT = 0;
      window.__game.render();
      const url = r.domElement.toDataURL('image/webp', 0.72);
      bd._release();
      return url;
    }, { id });
    const buf = Buffer.from(url.split(',')[1], 'base64');
    writeFileSync(join(OUT, `${theater}.webp`), buf);
    console.log(`${theater}.webp ${(buf.length / 1024).toFixed(0)} KB (${id})`);
  }
  const errs = H.errors(page);
  if (errs.length) console.warn('page errors:', errs);
} finally {
  await H.close();
}
