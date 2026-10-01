/**
 * esbuild plugin for the SHADOW SIX web build (tools/build/build.mjs).
 *
 * The dev tree is plain ES modules served from the repo root, so source files locate assets with
 * `new URL('../../assets/…', import.meta.url)`. In the bundle every JS file lives flat in `dist/js/`, so each
 * source file's `import.meta.url` is rewritten to the URL that file *would* have had in the dev tree:
 * `new URL("../src/art/terrain/terrain.js", import.meta.url).href`. Relative asset URLs then resolve exactly as in dev,
 * from any chunk, under any sub-path (GitHub Pages serves the site from /shadow-six/).
 *
 * Also: bare `three` / `three/addons/…` resolve to the vendored copies (the dev import map), CSS URLs get the
 * build's `?v=` cache-buster, and the tree-generation worker is wired to its own pre-built bundle.
 */
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

/**
 * @param {{root: string, version: string, workerFile?: string|null, worker?: boolean}} o
 *   root: repo root; version: cache-buster; workerFile: hashed file name of the pre-built treegen worker
 *   (main build); worker: true while building the worker itself.
 */
export function shadowSixPlugin({ root, version, workerFile = null, worker = false }) {
  const vendor = resolve(root, 'vendor');
  return {
    name: 'shadow-six',
    setup(build) {
      build.onResolve({ filter: /^three(\/addons\/.*)?$/ }, (args) => ({
        path: args.path === 'three' ? resolve(vendor, 'three.module.js') : resolve(vendor, 'addons', args.path.slice('three/addons/'.length)),
      }));
      build.onLoad({ filter: /\.m?js$/ }, async (args) => {
        const rel = relative(root, args.path).split(sep).join('/');
        if (rel.startsWith('..') || rel.startsWith('node_modules/')) return null;
        let src = await readFile(args.path, 'utf8');
        if (rel === 'src/art/terrain/treegen.worker.js' && worker) {
          // the dev worker receives module URLs to import; the bundled worker imports them statically
          src = src.replace('await import(m.init.threeUrl)', "await import('three')")
            .replace('await import(m.init.treegenUrl)', "await import('./treegen.js')");
          if (src.includes('m.init.threeUrl')) throw new Error('treegen.worker.js: import pattern changed, update the build plugin');
        }
        if (rel === 'src/art/terrain/vegetation.js' && !worker) {
          if (!workerFile) throw new Error('main build needs the pre-built worker file name');
          const a = "import.meta.resolve ? import.meta.resolve('three') : null";
          const b = "new URL('./treegen.worker.js', import.meta.url)";
          if (!src.includes(a) || !src.includes(b)) throw new Error('vegetation.js: worker wiring changed, update the build plugin');
          // both chunk and worker live in dist/js/, so the raw import.meta.url is right here
          src = src.replace(a, "'bundled'").replace(b, `new URL(${JSON.stringify('./' + workerFile)}, import.meta.url.replace(/[?#].*$/, ''))`)
            .replace('import.meta.url.replace', '__SS_RAW_META__.replace');
        }
        // CSS files injected by script (hud.js): cache-bust them like the <link>s in index.html
        src = src.replace(/(['"`])((?:\.\.\/)*styles\/[\w.-]+\.css)\1/g, (_, q, p) => `${q}${p}?v=${version}${q}`);
        src = src.replace(/\bimport\.meta\.url\b/g, `new URL(${JSON.stringify('../' + rel)}, import.meta.url).href`);
        src = src.replace(/__SS_RAW_META__/g, 'import.meta.url');
        if (/\bimport\.meta\.resolve\b/.test(src)) throw new Error(`${rel}: import.meta.resolve has no bundled equivalent`);
        return { contents: src, loader: 'js', resolveDir: resolve(args.path, '..') };
      });
    },
  };
}
