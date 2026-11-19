/** No void past the map edges on e01 "Dry Stone" (tests/edges-void-lib.mjs; docs/expansion/STATUS.md §5). */
import { voidCheck } from './edges-void-lib.mjs';
export { TIMEOUT as timeout } from './edges-void-lib.mjs';

export default (page, t) => voidCheck(page, t, 'e01');
