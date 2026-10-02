# tools/blender/hud/eye: the living HUD eye

The top-right vision-cone tool is a photoreal eye behind the brass porthole. It is rendered in Blender 4.2 (Cycles)
from scripts only and animated in the HUD from one sprite sheet per pixel tier.

| File | What |
|---|---|
| `eyeball.py` | Procedural globe at real scale. The sclera has meandering veins (denser towards the canthi), ivory/pink variation, translucent limbal blue-grey, contact AO under the lids, SSS and a wet coat. The layered iris has radial fibre bundles, fine trabeculae, a zig-zag hazel collarette around the pupil, crypts, contraction furrows, a limbal ring and a pupillary ruff, with bump relief. The pupil size is a material value, and the stroma compresses as it dilates. The cornea is a 7.8 mm curvature cap (IOR 1.376) that refracts and lets shadow rays through, so the iris is lit without caustics. |
| `face.py` | The game's MakeHuman head (MPFB, CC0) cropped round the right eye. MakeHuman expression targets become shape keys (blink, wide, squint). The visible lid margin is found by ray casting from the camera. About 225 strand eyelashes are bound to the lid skin (barycentric weights solved in double precision relative to the triangle, since single precision on ~0.1 mm triangles 1.7 m from the origin moved roots by millimetres and grew a second row under the lid fold). Each root sits just outside the margin as the camera sees it (never on the inner margin, where it would show over the white), in view of the camera and, on the upper lid, within 0.8 mm of the margin, so there is one row; upper roots must also close onto the lower lid. They are clumped per lid, curled, and sparse at the canthi, so they ride the blink. The upper lashes (~185) curl up and out and are denser and longer towards the outer corner; the ~40 lower ones are finer, point out and down, are pushed back out wherever they would dip into the skin, are kept only when most of each hair is in view, and thin out towards the inner corner. About 1700 brow hairs grow from the MPFB brow card's density and lie almost flat along a smooth flow: rising at the head, running laterally through the body in a soft herringbone, dropping along the tail. There is also a wet caruncle and a tear meniscus along both lids. The skin is placed in the rest pose through baked attributes (`restp`, distances `mup` / `mlo` to the lid margins, `brow` density), so only a narrow margin band is wet and pink. A shut lid keeps dry skin with pores, micro-relief, crinkles running with the margin, a soft crease and faint veins. There are also crow's-feet, under-eye arcs, blotches, a faint brow shadow, SSS and oily/rough specular breakup, and the MPFB albedo is desaturated to a natural tone. |
| `frames.py` | The frame table (86 frames): centre plus 8 directions at half and full reach (yaw 14°, pitch 9.5°) × normal/dilated pupil (`gNNn` / `gNNd`). Blinks close over whatever the eye is looking at: the half-closed stage `b1gNN{n,d}` exists for every gaze and both pupils, the nearly shut stage `b2gNNn` for every gaze, and `blink3` is the shut lid. The upper lid follows the gaze. |
| `render_eye.py` | Scene, lights and render loop. The key/fill/rim lights shape the skin. The catchlight is a soft studio window: brightest at its centre, falling off to its frame, with faint mullions. The 7.8 mm cornea curves it, and it slides against the pupil as the globe turns. A faint round fill and a dim room show in the wet surfaces too. Uses AgX Medium High Contrast and Cycles GPU (falls back to the CPU per frame when the shared GPU is full). |
| `frame.py` | The brass porthole from `icons/models/hudtools.py`, rendered without its eye in three passes per class (tool 52×41 at 12×, cursor 32×26 at 8×): the open frame, the dome's reflections over black, and the window mask. |
| `compose.py` | Mounts each eye frame in the window: bezel lip shadow, dome highlights added, frame over. Writes the `eye.open` / `eye.closed` masters for the tool and the cursor (then `icons/post.py` builds the tiers and the hover/pressed/active/disabled variants), the sprite sheets `out/tool/eye.anim@{2,3,4,6}x.webp` (the window cell of every frame, framed exactly like the static render) and `src/ui/eye-anim-data.js`. |
| `hud-crops.mjs` | Real-game crops of the top-right HUD at DPR 1 and 2 for the before/after sheet. |
| `before_after.py` | `docs/screenshots/hud-eye-before-after.jpg`: the HUD crops, an enlarged @6x old/new eye and @6x cell strips (blinks included) of the new sheet and, optionally, the old one. |

## Running
```bash
SP=<scratch>; B=$SP/realism/characters/blender-4.2.9-linux-x64/blender; export ICON_SCRATCH=$SP/icons
EYE_WIDE=0.4 $B -b --factory-startup -P tools/blender/hud/eye/render_eye.py -- $SP/eye/frames all 192 600x462   # 86 frames, ~20-45 s each (GPU)
$B -b --factory-startup -P tools/blender/hud/eye/frame.py                                                      # porthole passes
python3 tools/blender/hud/eye/compose.py $SP/eye/frames --repo .                                               # masters + sheets + data module
python3 tools/blender/icons/post.py 'eye.*'                                                                    # static tiers + state variants
cp $ICON_SCRATCH/out/tool/eye.* assets/ui/icons/tool/ && cp $ICON_SCRATCH/out/cursor/eye.* assets/ui/icons/cursor/
# merge the eye entries of $ICON_SCRATCH/out/manifest.json into assets/ui/icons/manifest.json, then:
node tools/blender/icons/gen-manifest.mjs
```
`render_eye.py` arguments: `<out_dir> [still|all|name,name] [samples] [WxH]`. Environment: `EYE_WIDE` (base lid opening),
`EYE_FOV` / `EYE_AIMZ` (framing in globe radii), `EYE_LIMBUS` (iris radius in 12 mm globe units), `EYE_LIGHT`, `EYE_EV`,
`EYE_WINDOW`, `EYE_DEVICE=CPU`. It needs `realism/characters/out/mh_beret.blend` and the MPFB user data, as `icons/models/human.py` does.

## Runtime (src/ui/eye-anim.js)
`EyeAnimator` adds a `.eye-anim` span over the porthole window of the `.hud-eye` button. The span is placed in percent
of the 52×41 tool box and shows the sheet for the current UI scale × DPR (same tier rule as the icons).
- It blinks every 3–6 s: half, nearly shut, shut, back, about 210 ms in all. The lid closes over the current gaze and
  pupil, so a blink never snaps the iris to the centre.
- When idle, it makes saccades every 0.9–3.2 s, mostly back to the front, sometimes aside.
- Under the pointer, the pupil starts to dilate after 250 ms and eases open over 0.7 s. A second span with the
  dilated-pupil cell of the same gaze crossfades over the normal one. It constricts over 0.45 s when the pointer leaves.
- While the vision tool is armed, the eye looks towards the cursor, with its reach set by the cursor's distance.

The static renders stay underneath and are the fallback. They show when the sheet is missing or fails to load, under
reduced motion (option or OS setting, which also stops the old CSS lid blink), and in the pressed and disabled states.
Before the sheet loads, the static eye blinks with a calm CSS fade every 4 s, also under hover and while armed.
In the hover and active states, the cells are tinted like their renders.
