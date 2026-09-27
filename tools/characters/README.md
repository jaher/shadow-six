# Character pipeline (regenerable)

Sources of everything in `assets/characters/`. The scripts were developed in a scratch workspace; paths inside them
(`$S`, `/tmp/.../scratchpad/chars`) point at that workspace, so set them to a working copy before re-running.

| Folder | What |
| --- | --- |
| `pipeline/` | shared Blender 4.2 + MPFB 2.0.8 builder (`blender/build_char.py`), weapons, first animation library, original runtime (`web/charkit.js`). README = spec format and headgear-fit guarantee |
| `commandos_a/` | greenberet, sniper, marine, marine_diver specs + `web/ca_*.js` (shoulder rig, go_prone/get_up, crouch_walk, swim) and `web/jobs/build_ca_anims.js`, `check.js` |
| `commandos_b/` | sapper, driver(+burns), spy(+disguise) builder copy, `web/charkit.js` rework, `synth.js` gait re-synthesis, `squadkit.js` enemy squad variety, `rw/` verification jobs |
| `enemies/` | enemy variant specs (16 face archetypes), `blender/enemy_*.py`, `web/enemy_*.js`, `tools/final_sheets.py`, `rework2/` fit checks |
| `guests/` | guest specs, dog builder, `guestkit.js`, `guest_synth.js`, `guest_board.js`, `rw/` checks |
| `prone/` | the prone set (low crawl with the weapon in the hands, prone idle / aim / shoot / pistol, go_prone, get_up, prone death, turns): authored keyframes on the UAL rig, `bake_prone.mjs` + `write_anims.mjs` (docs/crawl-animation.md §8); also writes `src/art/characters/prone-grips.js` |
| `verify/anim_check2/` | reviewer animation metrics (foot slip, steps/min, pops, ground penetration) |
| `consolidate/` | `copy_assets.py`, `copy_runtime.py` (copies runtimes into `src/art/characters/`, rewriting imports), `make_manifest.py` |

Rebuild order: build GLBs per group, then `tools/characters/prone` (bake + write_anims, replaces the prone clips in the
anim libraries), then `python3 consolidate/copy_assets.py`, `python3 consolidate/copy_runtime.py`,
`python3 consolidate/make_manifest.py`.

The prone runtime (`src/art/characters/prone-fit.js`, `prone-grips.js`, `weapon-handover.js` (called from the three charkit
`update`s), the prone holds in the four weapon codes and the PRONE sets in the runtimes) was written directly in `src/art/characters/`; the runtime copies under `tools/` predate it,
so do not re-run `consolidate/copy_runtime.py` over it without porting those changes.
