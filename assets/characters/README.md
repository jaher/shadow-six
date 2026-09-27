# Characters

Realistic SHADOW SIX characters: MPFB (CC0 MakeHuman assets) bodies skinned to the Quaternius UAL rig (CC0).
Game entry point: `src/art/humanoid-real.js` (`loadCharacterLibrary`, `createRealHumanoid`, `assignEnemyLooks`, `setCharacterView`).
Index: `manifest.json` (ids, roles and soldierTypes, LOD meshes, sockets, headgear fit, face variety, seeds, runtimes).

| Folder | Contents |
| --- | --- |
| `commandos/` | greenberet, sniper, marine + marine_diver, sapper, driver + driver_burns, spy + spy_disguise (`.glb`, `.sidecar.json`, `.spec.json`) |
| `enemies/` | 99 variants in 11 looks (`<type>_vNN.glb` + `.json`), `enemies_index.json` |
| `guests/` | McRae, Informer, Gilbert, 4 M17 prisoners, tram driver, colonel briefing bust |
| `dogs/` | 3 Alsatians with their own rig and clips |
| `anims/` | shared clip libraries on the UAL skeleton: `base_anims`, `commando_anims`, overlays `ca_anims`, `enemy_anims`, `guest_anims` (+ per-clip meta `.json`). The prone set (low crawl with the weapon in the hands, prone idle / aim / shoot, go_prone / get_up, prone death, turns) is in base, ca, commando and guest (`tools/characters/prone`, docs/crawl-animation.md) |
| `weapons/` | `weapons.glb` (15 props), `weapons_b.glb` (+ cigarette, wire cutters, Mills bomb); sockets grip_r, grip_l, butt, muzzle, sling_f, sling_b, tip, scope, bipod |
| `tex/` | weapon atlas sources. Every character GLB embeds its own 1-atlas (albedo, normal, ORM) + alpha material |
| `../../src/art/characters/` | (moved) the verified browser runtimes of each build group (ES modules, three r186), loaded by `src/art/humanoid-real.js` |

Each character GLB: meshes `LOD0` (+ `LOD0_alpha` brows/lashes, hideable `headgear`), `LOD1`, `LOD2`; about 11.9k / 5k / 2k tris,
2 materials, 0.7-1.1 MB. Regenerate with `tools/characters/` (see its README); do not hand-edit these files.

Every GLB here (characters, anims, weapons, dogs) carries lossless `EXT_meshopt_compression` (−23 % bodies, −33 % clip
libraries): after a pipeline re-export run `tools/perf/glb_meshopt.mjs` on the new files. Loaders need `MeshoptDecoder`.
