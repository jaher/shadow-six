// Node preload: resolve 'three' / 'three/addons/*' to vendor/ like the browser import map (same hook as the unit tests).
//   node --import ./tools/characters/prone/node-three.mjs tools/characters/prone/bake_prone.mjs
import { register } from 'node:module';
register('../../../tests/unit/resolve-hooks.mjs', import.meta.url);
