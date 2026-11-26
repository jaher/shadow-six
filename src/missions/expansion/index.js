/**
 * LIGHTS OUT mission slots (docs/expansion/STATUS.md, "Mission registration contract"). Each mission module registers
 * itself (registry.js) when it is imported here. To add your mission, add exactly ONE line directly under your own
 * slot's marker:
 *
 *   import './eNN_<slug>.js';
 *
 * Touch no other line. The blank line under each marker keeps two missions landing at the same time from touching
 * the same lines, so their merges never conflict.
 * @module missions/expansion/index
 */

// e01
import './e01_dry_stone.js';

// e02
import './e02_curfew.js';

// e03
import './e03_winter_quarters.js';

// e04
import './e04_black_rain.js';

// e05
import './e05_cold_iron.js';

// e06
import './e06_thin_ice.js';

// e07

// e08
