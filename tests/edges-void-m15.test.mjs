/** No void past the map edges on m15 (tests/edges-void-lib.mjs; user request 2026-09-30). */
import { voidCheck } from './edges-void-lib.mjs';
export { TIMEOUT as timeout } from './edges-void-lib.mjs';

export default (page, t) => voidCheck(page, t, 'm15');
