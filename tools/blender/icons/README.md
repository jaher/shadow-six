# tools/blender/icons: photoreal HUD icon studio

This folder rebuilds every knapsack item, top-right tool, context cursor and portrait stamp as a studio render of a real
3D prop. The object icons are Blender 4.2 Cycles renders. The pure graphics are drawn with PIL.

| File | What |
|---|---|
| `studio.py` | Scene reset (Cycles GPU, AgX Medium High Contrast, transparent film, 16-bit PNG), a CC0 studio HDRI, one light rig for every icon (key upper-left, cool fill, warm rim, sheen softbox at the mirror angle), camera presets (`item`: the ONE inventory view, 32° up / 14° left, 200 mm, enforced for every knapsack item; `tool` 85 mm, `badge`, `front`, `flat`), per-icon framing, two-pass render (object, then shadow catcher), hotspot export, `@S.shot` registry |
| `mats.py` | Materials: `metal` (edge wear from the Bevel node, texture-driven roughness), `gunmetal` (Parkerized / blued conversion coat: mottling, specular breakup, bare steel on handled edges), `paint` (chipped to metal), `wood`, `textured` (Poly Haven sets), `solid` (bakelite, enamel, rubber), `glass`, `emission`, `image` (UV labels) |
| `mdl.py` | Modelling helpers: `slab` (extruded 2D profile + bevel + weighted normals), `cut` (boolean cutters: ejection ports, serrations, finger holes), `lathe`, `cyl`, `box`, `tube`, `chaikin`, `decal`, `group`, `hot`, `squash`, `deform` |
| `models/*.py` | One module per family: `guns` (Colt M1911A1, Walther P38, Beretta M1935, No.4 Mk I (T) and No.4, Thompson M1928A1, speargun, .303 round), `blades`, `tools`, `boxes`, `misc`, `human` (hands, raw eyes, the stance figures on their brass-rimmed plaque), `hudtools` (movie camera, lamp, "?" plaque, notebook coil + page, the eye's brass porthole), `cursors`, `pack` (the rucksack face and the brass count tag) |
| `labels/gen_labels.py` | Printed textures: watch dial, a generic cigarette pack of our own design, chloroform label |
| `post.py` | Masters → shipped files: grade (saturation −10 %, warm mids, black point 14, white point 245), contact shadow extracted from the catcher pass, a thin inner edge light on the key-light side, a crisp dark keyline (cursors: dark keyline inside a light one), autocrop, the knapsack visual-mass rule (`MASS`/`CAP`: every item the same opaque area, long guns span two slots), Lanczos downscale in linear light on premultiplied alpha, unsharp mask, tool state variants (hover, pressed, active, disabled), lamp glow, WebP plus PNG fallback, `manifest.json` (`slot` → `s`) |
| `vector.py` | The graphic cursors as brass / vitreous-enamel badges finished with post.compose (one family with the rendered cursors): arrow, crosshair, target, tracking arrows, forbidden overlay, sparkle (2 frames); No.32 scope reticle over the rendered eyepiece with a tinted, reflecting lens (ok/bad); black-ink stamps (vehicle, house, shovel, bubbles, skull, bars) |
| `gen-manifest.mjs` | `assets/ui/icons/manifest.json` → `src/ui/icon-manifest.js` (the compact table the HUD imports; run after copying `out/` to `assets/ui/icons/`) |
| `sheet.py`, `mock.py` | Contact sheets on the real pack and top-bar backgrounds with a 32 px silhouette row; before/after mock on 1080p screenshots |

## Running
```bash
B=<scratch>/realism/characters/blender-4.2.9-linux-x64/blender
$B -b --factory-startup -P tools/blender/icons/shoot.py -- guns all          # or: <module> <shot[,shot]> ; modules listed above
# stance button: `human stance` (STANCE_SAMPLES / STANCE_ONLY=crawl|stand for quick looks), then post.py 'stance.*'
# order matters once: `human eye` writes masters/raw/eye.*.png, which `hudtools eyeport` mounts in the porthole
python3 labels/gen_labels.py <scratch>/icons/labels                          # once, before boxes.py
python3 tools/blender/icons/post.py ['glob' ...]                             # masters -> out/<class>/<id>@<tier>.webp|png + manifest
python3 tools/blender/icons/vector.py                                        # vector cursors + stamps (after post.py)
python3 tools/blender/icons/sheet.py out.png item=2x,tool=2x,cursor=1x,stamp=2x --sil
rsync -a --delete <scratch>/icons/out/ assets/ui/icons/ && node tools/blender/icons/gen-manifest.mjs   # ship
```
Paths: `ICON_SCRATCH` (default `~/.cache/shadow-six/icons`) holds `tex/`, `hdri/`, `labels/`, `dec/`, `masters/` and `out/`.

`human.py` needs `realism/characters/out/mh_beret.blend` (MPFB, CC0) and its MPFB user data for the hands and the eye. It also needs
`dec/greenberet.glb` for the stance figures. That file is the game's commando with the meshopt compression removed; make it with `scratch/gt/decode.mjs`.

## Conventions
- A master is the ref box × 8 (cursors: 256 px, scope: 704 px). Tiers are ref × 2/3/4/6 for items, tools and stamps, and 32 ref px × 1/1.5/2/3/4
  for cursors (cursors are sized in ref px and scale with the HUD). Knapsack items get their final ref box from post.py's visual-mass rule.
- Every knapsack item uses the one `item` camera; pose the prop instead (stand guns and tools upright, tilt flat kit towards the camera,
  yaw for a diagonal). The top-bar tools share one 41-ref-px slot height. `masters/raw/` holds intermediate renders post.py skips.
  PNG fallbacks are written only for the two smallest tiers. The larger tiers are WebP only.
- Long props are built along +X, muzzle or tip at +X, with the side profile in XZ. `D.group(rot=(-90, 0, 0))` lays a prop flat with its right side up.
- Don't give a group a studio rig name (`cam`, `key`, `fill`, `rim`, `top`, `shadow_catcher`). The rig cleanup deletes objects with those names.
- Mix nodes are wired by socket index (6/7 → 2). Procedural meshes have no UVs, so detail comes from bump maps, never tangent-space normal maps.
- Scene exposure makes albedo read about 2× brighter than its value, so give cloth and wood darker colours than the target look.

## Credits (all CC0)
Poly Haven textures: fine_grained_wood, dark_wood, brown_leather, fabric_leather_02, rusty_metal_02, metal_plate,
wool_boucle, leather_red_02, rock_face_03, hessian_230. Poly Haven HDRI: studio_small_09. ambientCG Fabric030 (from the realism texture set).
MakeHuman/MPFB assets (CC0): skins, high-poly eyes, eyelashes, eyebrows, expression targets. All models and printed labels are
our own work, with no real brands and no insignia eagles.
