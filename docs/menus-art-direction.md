# SHADOW SIX: menus and full-screen screens, art direction

**Brief (user):** "Make sure all menus look similar to the game but much more polished than in 1998."

**What this document is.** A buildable spec for every menu and full-screen screen, plus the HUD pieces that share their look (portrait strip, speaker card, tooltips, message line). Every screen keeps the 1998 structure, item order, iconography and mood, so a fan recognises it in one glance. The upgrade comes from rendering, materials, motion, sound and accessibility.

**Inputs:**
- `docs/research-raw/menus.md`: what BEL's front end looked like, with measurements, colours and a polish brief.
- `docs/design-spec.md`: §6 (HUD and UI), §8 (scoring, passwords, saving), §9 (audio).
- `docs/character-bible.md`: commando looks and likeness rules.
- `src/ui/*`, `styles/ui.css`: the UI team's current build.

**Tags:**
- **[orig]**: faithful to BEL (from menus.md, seen or from the manual).
- **[up]**: a polish upgrade of an original element.
- **[new]**: a modern addition that has no BEL counterpart.
- ⚑: an option the player can switch off.

---

## 0. The recognisability contract

These twelve invariants are not negotiable. If a screen breaks one, it no longer reads as *Commandos*.

1. **One menu card everywhere.** A centred text column with a **bevelled silver title** and **khaki condensed-caps items**. There is no visible box around it.
2. **Selection is shown by brightness.** Khaki brightens to cream. All other focus cues are secondary (§1.6).
3. **Disabled rows stay in place, dimmed.** The list never reflows.
4. **Hotkeys are written `(Y)ES` and `(N)EXT MISSION`**, and the hotkeys work.
5. **Esc or a right-click goes back one level.** In mission, Esc on the top card resumes.
6. **The front end sits on dark olive camo with a large, low-contrast embossed badge.** SHADOW SIX uses its own emblem (§1.4.3).
7. **In mission, and on the end cards, the background is the frozen game frame graded to an oxblood/sepia duotone.**
8. **Item order is BEL's.** MAIN: NEW GAME, SAVE GAME, LOAD GAME, OPTIONS, CREDITS, HELP, QUIT GAME. NEW GAME: SINGLE PLAYER, MULTIPLAYER GAME, TUTORIALS, RESTART MISSION, LOAD QUICK SAVED GAME, PASSWORD, EXIT.
9. **The briefing comes in two parts.** Part 1 is a photo panel on the left and a pure-red condensed title with white body text on the right, on near-black. Part 2 is the Colonel's voiced camera tour.
10. **The spiral notebook** uses stained olive paper, red labels DATE / LOCATION / MISSION and "- " ink bullets.
11. **The debrief** is an olive panel with red labels, silver and gold medal discs, a rank name and a commando figure, with `(N)EXT MISSION (P)LAY AGAIN` underneath.
12. **Ten named save slots** ("-- UNUSED SLOT --") and a **five-character password**.

**Legal guard rails:**
- No Eidos or Pyro logos, flame marks or box art. The emblem, wordmark and key art are our own.
- Never use the original "COMMANDOS" plate or the real Combined Operations badge.
- No swastikas, SS runes or death's heads in menus, UI, stills or branding (spec §10.6). In-mission enemy flags are the historical flag by user decision (spec §10.6, Options → INSIGNIA); menus never show it.
- Assets are CC0 or made by us. The only licence exceptions are the fonts (SIL OFL / Apache-2.0), with licence files shipped in `assets/fonts/`.

---

## 1. Design system

### 1.1 Units, grid and responsive layout

**The reference box.** Every menu is designed on BEL's **640×480 reference grid**. All sizes in this document are in **reference px ("r")** unless marked CSS px.
- The box is centred and scaled uniformly: `--u = min(innerWidth / 640, innerHeight / 480)`. This is continuous, not stepped: menus are vector, so they stay crisp at any scale. The HUD keeps its stepped `uiScale` because its bitmap sprites need integer steps.
- Backgrounds always **bleed to the full viewport**. Only the card content lives in the 4:3 box.
- `--text-scale` (Accessibility → Text size, 90–150%) multiplies font sizes and row pitch, but not the box.

| Band | Viewport (CSS px) | `--u` | Layout rules |
|---|---|---|---|
| **Phone** | width 400–719 | fluid | Single column. Card width = viewport − 2×16 px. Row height ≥ 44 CSS px. Font base = 16 CSS px. Titles use `clamp(28px, 8vw, 40px)`. Split screens (briefing, save/load detail, debrief) **stack vertically**. The key-hint bar becomes touch buttons (BACK at bottom-left, SELECT at bottom-right). Hover states are replaced by press states. |
| **Compact** | 720–1279 wide, or height < 720 | ~1.1–1.5 | Same as desktop, with the badge scaled down to 50% of the height. Detail panes move under the list if they would be narrower than 180 r. |
| **Desktop** | 1280×720 → 2560×1440 | 1.5–3 | The reference layout. 1280×720 → `--u` 1.5, so an item cap height is ≈ 15 CSS px. |
| **4K** | ≥ 3840×2160 | 4.5 | Same layout. The 3× texture tier is loaded (§1.4.1). Hairlines stay at `max(1px, 0.5r)` so they never blur. |

**Ultrawide (> 16:9).** The 4:3 content box stays centred. The live background widens the diorama camera's field of view instead of stretching anything.

**Safe areas.** Pad the card by `env(safe-area-inset-*)`. The fixed bars (key hints, letterbox) add the insets to their own padding.

### 1.2 Colour tokens

These extend `styles/ui.css`, which already has `--web`, `--brass`, `--paper` and `--blood`. The new tokens go in a `:root` block in `styles/menus.css` (§6).

Where a value marked [orig] fails contrast, it is adjusted. The measured original value is kept as a `-orig` token for textures only.

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--olive-950` | #0d0e07 | Duotone shadow of the live diorama; emboss shadow | — |
| `--olive-900` | #151609 | Camo darks | — |
| `--olive-800` | #202113 | **Front-end ground** [orig] | — |
| `--olive-700` | #333426 | Camo mottles [orig] | — |
| `--olive-600` | #4a4c2e | Camo highlights; duotone highlight is #5b5c3a | — |
| `--khaki` | #9a8f5c | **Idle item** [orig] | 5.0:1 on olive-800 |
| `--khaki-hi` | #b3a76c | Idle item in High-contrast mode | 6.7:1 |
| `--cream` | #e8dca0 | **Selected / focused item** [orig] | 11.8:1 |
| `--dim` | #5a5638 | **Disabled item** [up]. BEL's #2c2d1c was 1.16:1, practically invisible; this is still clearly "off" | 2.2:1 (disabled text is exempt from WCAG); High contrast raises it to #8a8458 (4.3:1) |
| `--steel-hi` | #d6d6ce | Title bevel highlight | — |
| `--steel` | #83837d | Title fill mid-tone [orig] | 4.3:1 as large text |
| `--steel-lo` | #3a3a34 | Title lower bevel [orig] | — |
| `--brass` | #c9a24a | Focus hairline, rivets, slider knob rim, pins | 6.8:1 |
| `--brass-hi` | #ecd08a | Brass specular | — |
| `--oxblood-0` | #0e0707 | In-mission duotone shadows [orig ≈ #100909] | — |
| `--oxblood-1` | #3a2622 | In-mission duotone mid-tones [orig] | — |
| `--oxblood-2` | #6a4a40 | In-mission duotone highlights [up; orig ≈ #8a6a60 for snow] | — |
| `--brief-black` | #080808 | Briefing page [orig, exact] | — |
| `--brief-red` | #ff0100 | Briefing title [orig, exact] | 5.0:1 on brief-black |
| `--brief-white` | #f0f0f0 | Briefing body [orig, exact] | 17.6:1 |
| `--map-paper` | #efe9d7 | Europe map sea [orig, exact] | — |
| `--map-land` | #605a53 | Europe map land [orig, exact] | — |
| `--note-paper` | #b3b68a | Notebook paper base [up]. Lightened from #9da375 so red labels pass contrast; the #9da375 / #7d8155 stains stay in the texture | — |
| `--note-red` | #7a0f06 | Notebook labels [up; orig #c71a0b = 2.2:1] | 5.3:1 on note-paper |
| `--note-ink` | #1a1a12 | Notebook text | 8.3:1 |
| `--note-edge` | #262619 | Notebook backing [orig] | — |
| `--debrief-panel` | #231e0f | Debrief canvas [orig ≈] | — |
| `--debrief-red` | #e4574a | Debrief labels and rank [up; orig ≈ #b01e18 = 2.4:1] | 4.6:1 |
| `--medal-silver` | #b9bcc0 | Silver disc base | — |
| `--medal-gold` | #c9a13b | Gold disc base | — |
| `--slider-red` | #b3160f | Slider fill; equals the existing `--red-title` | — |
| `--seen-blue` | #3fa9ff | "Seen" glow on portraits (§3) | — |
| `--alert-red` | #ff2a2a | "Held / fired at" flash | — |
| `--scrim` | rgba(8,6,4,.55) | Soft pool of shade behind the text column | — |

**Rules:**
- Red is the only saturated colour on any menu, as in BEL. Blue appears only in HUD warnings.
- Never convey state with colour alone. Every toggle also shows its value as a word, and every warning also shows a glyph.
- **High-contrast mode** (Accessibility): swap khaki for khaki-hi and dim for #8a8458. Drop the scrim alpha to .8, turn off film grain, and add a 2 r cream outline to focused rows.

### 1.3 Typography

All fonts are subset to Latin-1 plus typographic punctuation, served as WOFF2 with `font-display: swap`, preloaded, and licensed under OFL or Apache-2.0. Licence files go in `assets/fonts/`, and each font gets a credit in `CREDITS.md`.

| Role | Font (exact) | Licence | Weights and features | Where |
|---|---|---|---|---|
| **Card titles** ("MAIN MENU", "MISSION COMPLETED") | **Staatliches** Regular | OFL 1.1 | 400; tracking +0.06em; stamped-metal treatment (§1.5.2) | Every menu card title, GAME PAUSED, Help and Credits section heads |
| **Menu items, hotkeys, values, HUD text** | **Oswald** (variable, already in `assets/fonts/Oswald-VF.ttf`) | OFL 1.1 | 500 idle, 600 focused (the weight change also cues focus without colour); uppercase; tracking +0.04em | Items, toggles, slot names, tooltips, message line, debrief counts |
| **Briefing title, big numbers** | **Anton** Regular (already shipped) | OFL 1.1 | 400; line-height 0.95 | Briefing part 1 title, debrief rank, loading-screen mission name |
| **Briefing body, captions, tip text** | **Archivo Narrow** (variable) | OFL 1.1 | 400 / 600; `tabular-nums` for the clock and counts | Briefing paragraphs, save-slot details, Colonel subtitles, credits names |
| **Typed documents** (dossiers, passwords, tip cards, labels) | **Special Elite** Regular | Apache-2.0 | 400; each glyph gets ±0.3 r vertical jitter and 0.9–1.0 random opacity, as with a real typewriter (per-glyph spans are built once and cached) | Help dossiers, password field, save names while typing, tip cards, debrief password tag |
| **Letterheads and period serif** | **IM FELL English SC** Regular | OFL 1.1 | 400 small caps | "MOST SECRET" letterheads, dossier headers, credits headings, the intro newsreel captions |
| **Wordmark** "SHADOW SIX" | **Alfa Slab One**, converted to outlines and hand-roughened | OFL 1.1 | Shipped **as an SVG**, not as a font | Title splash, boot ident, emblem plate |
| **Notebook ink caps** | Oswald 500 with a baked **ink-bleed** pass (§ S17) | OFL 1.1 | 8.5 r caps | Briefing Notes page |

**Type scale** (reference px, × `--u` × `--text-scale`):

| Style | Size / line | Notes |
|---|---|---|
| card-title | 22 / 26 | BEL measured letters 22 r tall |
| item | 11 / 16 row pitch | BEL: 10 r letters on a 16 r pitch. Min 44 CSS px pitch on phone |
| item-sub | 7 / 10 | Archivo Narrow; a helper line under an item, shown only on focus |
| brief-title | 34 / 32 | Anton, two lines |
| brief-body | 11 / 14 | Archivo Narrow 400 |
| hint | 7 / 10 | Key-hint bar |
| typed | 9 / 13 | Special Elite |

**Minimum rendered size** is 12 CSS px, whatever `--u` is. The smallest styles clamp to it.

### 1.4 Materials and rendering

#### 1.4.1 High-DPI rendering rules
- **Text is always live DOM text**, never baked into images. The only exceptions are the SVG wordmark and the notebook's ink texture, which is baked once per open at `devicePixelRatio`.
- **Vector first.** These are inline SVG, drawn with `vector-effect: non-scaling-stroke` for hairlines:
  - the emblem, the wire spiral, paper clips, rivets, key-cap glyphs, rules, medal-disc stars, the Europe map and all icons.
- **Raster textures** come in three tiers, chosen with `image-set()` and by the WebGL loader:

  | Tier | When | Size |
  |---|---|---|
  | `@1x` | `dpr × innerHeight < 1100` | 1024 px tiles |
  | `@2x` | the default | 2048 px tiles |
  | `@3x` | `dpr × innerHeight ≥ 2000`, i.e. 4K | 4096 px, lazy-loaded after first paint |

  Tiles are WebP for the DOM (quality 80) and KTX2/Basis for WebGL, with an sRGB-correct mip chain.
- **Film grain** is a 256 px tiling noise that is **animated in the WebGL pass**, not in CSS. It runs at 12 fps, like real film, not per frame. Opacity is 3.5%. It is static in Reduced motion and off in High contrast.
- **No CSS `filter: blur()` on full-screen layers.** Blur, duotone and vignette happen in the backdrop shader (§1.10). The DOM only composites.
- **Lighting is consistent everywhere:** the key light comes from the **upper left**, the same direction as the game's global key light (character-bible §4). Bevels, embosses, drop shadows and coin highlights all follow it.

#### 1.4.2 Material library (every item has a source; CC0 or made by us)

When downloading from ambientCG or Poly Haven, use the listed search terms and **record the exact asset ID, URL and date in `CREDITS.md`**. Where the licence page is not CC0, reject the asset. For Freesound, apply the provenance check in realism-pipeline §1.

| ID | Material | Look | Source (CC0) | Used on |
|---|---|---|---|---|
| M1 | **Army blanket / camo weave** | Dark olive wool twill, visible fibres, speckled mottles | ambientCG "Fabric" (wool/twill), recoloured to olive-800/700/600. Mottles come from our own procedural camo mask (3-octave Worley noise, baked) | Front-end scrim, debrief board edge |
| M2 | **Canvas webbing** | Brown-olive cotton webbing with stitched edges and brass eyelets | ambientCG "Fabric" (canvas), with our SVG stitching; eyelets are M6 | HUD top bar, portrait frames, speaker card |
| M3 | **Aged paper** | Off-white to khaki stock, fibres, foxing, fold creases | ambientCG "Paper" set, plus our procedural stain layer (§ S17) | Notebook, dossiers, tip cards, password tag, save details |
| M4 | **Photographic print** | Silver-gelatin grain, 1.5 r white deckled border, slight curl shadow | Made by us: border mask SVG plus a grain shader | Portraits, dossier photos, save thumbnails, loading photo |
| M5 | **Stamped steel** | Brushed grey plate with an anisotropic streak | ambientCG "Metal" (brushed) as a greyscale mask, gradient applied in CSS | Card titles, emblem plate |
| M6 | **Brass** | Warm, slightly worn edges | Poly Haven or ambientCG "Metal" (brass or bronze), roughness-mapped; SVG for the small parts | Rivets, eyelets, slider knob rim, map pins, focus hairline |
| M7 | **Leather** | Dark brown, pebbled, edge-burnished | ambientCG "Leather" | Debrief board, Help dossier folder, Options case |
| M8 | **Map-table wood** | Dark oak with scratches | Poly Haven "wood" texture set | Campaign map table (S06b) |
| M9 | **Red enamel** | Glossy deep red with a specular band | Procedural CSS gradient plus a highlight SVG | Health fill, slider fill, alarm lamp |
| M10 | **Black briefing paper** | #080808 with fine tooth | Procedural noise at 4% amplitude | Briefing page, loading screen |
| M11 | **Rubber stamp ink** | Red or black, uneven fill, broken edges | Made by us: SVG with a baked distress mask | "PROMOTED", "MOST SECRET", "UNUSED", "APPROVED" |

#### 1.4.3 The SHADOW SIX emblem (our own badge, replacing BEL's COMMANDOS badge)

It echoes BEL's structure (bird over a ring over a riveted plate) with our own motifs:
- **Top:** a **raven** with spread wings, the "shadow". It is deliberately not an eagle, to avoid national and real-unit symbols.
- **Centre:** a **ring** with the Roman numeral **VI** over a crossed **commando knife and anchor**. The ring edge is knurled.
- **Bottom:** a rectangular **riveted plate** reading **SHADOW SIX** (the roughened Alfa Slab outline), with **six rivets** along the lower edge, one per commando.
- **Delivery:** `assets/ui/emblem.svg` (the master), plus an 8-bit height map rasterised from it at 2048 and 4096 px. The height map feeds a normal map for the live emboss.
- **In the front-end background:** it is embossed into the camo weave (M1), **colourless**. The highlight is +12 L and the shadow is olive-950, as in BEL. It fills about 60% of the viewport height, with the wings reaching the title and the plate below the last item.
- **Raking light:** a **key light sweeps once every 20 s** (±25° azimuth, sine-eased), so the highlight glides across the relief. In Reduced motion the light is fixed at the upper left.

### 1.5 Components (one shared kit: `src/ui/menu-kit.js`, `styles/menus.css`)

#### 1.5.1 MenuCard
A centred column with **no border or box** [orig]. It has:
- `title` (CardTitle);
- a `list` of rows;
- an optional `note` line (khaki, Archivo Narrow, 8 r);
- an optional `detail` pane (right of the list on desktop, below it on phone);
- a `hints` key-hint bar anchored to the bottom-right of the viewport.

**Readability over a busy background:** a soft radial **scrim** pool sits behind the text column (`--scrim`, feathered 60 r, never a hard edge). It keeps the "text on texture" look while guaranteeing contrast over the live diorama.

**Geometry** [orig, measured]:
- title centred at y 70–95;
- the list is **left-aligned at x 300** (just right of centre) and starts at y 120, with a 16 r pitch.

On phone the list is centred and full width.

#### 1.5.2 CardTitle: stamped metal
- Staatliches at 22 r, filled with a vertical gradient from `--steel-hi` at 0% through `--steel` at 55% to `--steel-lo` at 100%, via `background-clip: text`.
- Plus a brushed-metal mask (M5) at 25%, clipped to the text with `mask-image`.
- Relief:
  - top highlight: `text-shadow: 0 -0.5r 0 rgba(255,255,255,.35)`;
  - press shadow: `0 1r 0 #1b1b17, 0 2r 2r rgba(0,0,0,.55)`.
- An "engraved line" rule under the title: 0.5 r, #000 at 40% with a 0.5 r highlight under it, 120 r wide.
- **Screen-reader output:** a real `<h1>` or `<h2>`. The decoration is CSS only.

#### 1.5.3 MenuItem (a button row)
- **Anatomy:**
  - label: Oswald, uppercase;
  - optional hotkey letter, underlined with a 0.5 r brass rule only in the `(X)` form;
  - optional inline value on the right after a colon, e.g. `USER PROFILE NAME : TINY`;
  - optional `item-sub` helper line shown on focus;
  - an optional left **brass tab**: a 3×7 r riveted tick, visible only on keyboard or gamepad focus.
- **Markup:** `<button>` in a `role="menu"` list with a roving tabindex. Disabled rows use `aria-disabled="true"` and stay focusable, so the reason can be read out, but they cannot be activated.

#### 1.5.4 HotkeyButton
The form `(N)EXT MISSION`, used for end cards and confirmations. It uses the same visual as MenuItem, laid out horizontally with 24 r gaps. The letter in parentheses is the hotkey, and a gamepad glyph is appended when a pad is active: `(N)EXT MISSION  Ⓐ`.

#### 1.5.5 ToggleRow [orig behaviour, up visuals]
- **Layout:** `LABEL` on the left, and the current `VALUE` in cream at a tabbed column (x 470 r).
- **On focus**, small brass chevrons ◂ ▸ fade in around the value.
- **Controls:** Left/Right, a click on the value, or the d-pad left/right flips it.
- **The flip:** the value slides 6 r out and in (140 ms), and a Bakelite switch click plays.
- Two-state values stay as words, e.g. SUBMISSIVE / INDIFFERENT, VERBOSE / LACONIC, ON / OFF, as in BEL.

#### 1.5.6 Slider [orig: red fill and knob]
- **Track:** 250 r wide, 3 r tall, engraved (inset shadow 1 r), olive-950.
- **Fill:** red enamel (M9).
- **Knob:** a 9 r disc with red enamel and a brass rim, and a specular dot at the upper left.
- **Value** shown as a number at the right in Oswald `tabular-nums`, e.g. `80`.
- **Input:** Left/Right steps 5%, Shift steps 1%, the mouse wheel steps 5%, drag, and click-to-jump.
- **Sound:** a detent tick at every 10%, and a sample of the channel itself on release (a gunshot for SFX, a bark for voice, a bar of music for music).
- **Markup:** `role="slider"` with `aria-valuetext` set to "80 percent".

#### 1.5.7 TypeField: the typewriter
- A Special Elite line on a **paper tape** (M3, 1 r torn edges), with a blinking block caret: 0.53 s on, 0.53 s off.
- Every key plays a **typewriter strike** (pitch ±4% random). Backspace plays a lighter tick. Enter plays the **carriage-return bell**.
- Each new glyph gets a 60 ms "strike" animation: `translateY(-0.6r)` to 0 with the ink going from 0.6 to 1.
- **Password mode:** 5 fixed cells, each a key-cap box. It auto-advances and accepts `O` as 0 and `I` as 1 (spec §8.3).

#### 1.5.8 SlotRow (save / load)
- **Text-only list row** [orig]: `-- UNUSED SLOT --` in `--dim`, or the save name in khaki.
- On focus, the **detail pane** (§ S09) populates. The row itself never grows, so the 10-row rhythm stays intact.

#### 1.5.9 KeyHintBar [new]
- A bottom-right row: `↵ SELECT   ESC BACK   ↑↓ MOVE`.
- Keycaps are drawn as small **typewriter keys**: a round cream cap with a black glyph and a chrome rim (SVG).
- **Glyphs follow the last input device** (keyboard, Xbox, PlayStation, Switch). Kenney **Input Prompts** (CC0) are recoloured to the palette.
- Each keycap is clickable, which makes this the phone's touch bar.

#### 1.5.10 PhotoPrint [new, shared with the HUD]
- An image inside the M4 border.
- It can carry `clip` (a brass paper clip SVG at the top-left, rotated −8°), `tape` (a yellowed tape strip), `caption` (Special Elite under the photo), and a grade: `gray` (BW) or `sepia`.
- It is used by the portrait strip, speaker card, dossiers, save thumbnails and the loading screen (§3).

#### 1.5.11 PaperSheet, Stamp, NameTape and MedalDisc
- **PaperSheet:** M3 paper with a 2 r soft shadow and a random rotation of ±0.8°, plus an optional letterhead (IM Fell SC) and punch holes.
- **Stamp:** an M11 SVG. It enters at scale 1.35 with opacity 0, then goes to 1 / 1 over 140 ms (ease-in), with a 2 r settle, a thump sound, and a 1-frame 1 r camera shake of the sheet only. Reduced motion: a fade.
- **NameTape:** khaki cotton tape (M2 recoloured to #8c8055) with the name in stencilled Oswald 600 black.
- **MedalDisc:** 14 r coins, pre-rendered from a three.js coin (a silver or gold PBR material with an embossed star) into a 2× and 4× sprite atlas: `assets/ui/medals@2x.webp`. States: empty (an engraved outline), filled, and "dropping" (§ S20).

### 1.6 Interaction states (all components)

| State | Visual | Sound |
|---|---|---|
| Idle | Khaki, Oswald 500 | — |
| **Hover or focus** | Tweens to **cream** (120 ms) and Oswald **600**; nudges +2 r to the right; a 0.5 r **brass hairline** fades in under the label (160 ms, growing from the left); the key-focus brass tab appears on keyboard or pad focus only | `ui.hover` (quiet metal tick, −24 dB, throttled to 1 per 60 ms) |
| **Press** | Holds cream, `translateY(0.5r)` and the hairline goes to full brass, for 80 ms | `ui.select` (rifle-bolt latch) on release |
| **Back** | — | `ui.back` (a lighter latch) |
| **Disabled** | `--dim`, no hover change. On focus, a note line shows the reason, e.g. "NO MISSION IN PROGRESS" | `ui.deny` (a muted thud) if activated |
| **Locked** (content coming later) | `--dim` plus a small padlock glyph after the label; the note says "COMING LATER" | `ui.deny` |
| **Error** | The row shakes horizontally 3 r three times (180 ms). The note line turns `--debrief-red` with the message | `ui.error` (a telegraph buzz) |
| **Focus-visible ring** | Keyboard or pad only: the brass tab plus the hairline. **High contrast:** a 2 r cream outline around the row, offset 3 r | — |

Brightness remains the primary cue, as in BEL. The hairline, weight and tab make focus visible to players who cannot tell the two khaki tones apart.

### 1.7 Motion tokens and transition catalogue

| Token | Value | Use |
|---|---|---|
| `--t-micro` | 80 ms | Press feedback |
| `--t-fast` | 120 ms | Colour and weight on hover or focus |
| `--t-med` | 220 ms | Card in and out, detail pane, toggles |
| `--t-slow` | 320 ms | Page turns, notebook open, stamp settle |
| `--t-screen` | 400 ms | Screen-to-screen fade through black |
| `--ease-out` | `cubic-bezier(.22,.8,.26,1)` | Entrances. No overshoot, anywhere |
| `--ease-in` | `cubic-bezier(.5,0,.75,0)` | Exits |
| `--ease-io` | `cubic-bezier(.65,0,.35,1)` | Camera moves, Ken Burns |

| Transition | Spec |
|---|---|
| **Card → sub-card** (e.g. MAIN → NEW GAME) | The outgoing card slides −12 r and fades out (160 ms, ease-in). The incoming card slides from +12 r and fades in (220 ms, ease-out), with rows **staggered 25 ms** apart. The title swaps with a 1-frame "stamp" (scale 1.04 → 1). Back plays the same in reverse. |
| **Screen change** (front end ↔ briefing ↔ mission) | A **film-grain fade**: 400 ms to black while the grain rises to 12%, a hold of ≥ 1 frame, then 400 ms up. |
| **Esc in mission** | Snapshot, then a duotone crossfade (180 ms) while the HUD fades (120 ms), then the card slides in. |
| **Mission end** | Time dilates to 0.25× over 600 ms, then the Esc-style duotone grade runs over 400 ms, then the card appears. |
| **Paper objects** (notebook, dossier, tip card) | 3D page turn: `rotateX` or `rotateY` about the binding, 320 ms with perspective 1200 r; a paper rustle; a shadow sweep across the page. |
| **Numbers** | Roll up over 600 ms (ease-out) and tick in sync with the value. |
| **Idle ambience** | Emblem light sweep (20 s), diorama camera (90 s loop), grain (12 fps), caret blink. |

**Reduced motion** (OS `prefers-reduced-motion`, or the option; the option wins):
- Every slide, stagger, page turn, Ken Burns, time dilation and camera move becomes a **plain opacity fade of 120 ms or less**.
- The diorama shows a **still frame**, and grain and light sweeps stop.
- Nothing flashes faster than 3 Hz. The HUD's 4 Hz red flash becomes steady red plus a "!" glyph.

### 1.8 UI audio (`src/ui/ui-sound.js`; the UI bus is routed under the SFX volume)

All sounds are CC0 or recorded by us. Sources:
- **Kenney "UI Audio"** and **"Interface Sounds"** packs (CC0);
- **Freesound, CC0 only**, with provenance checked as in realism-pipeline;
- or **our own foley** (preferred for typewriter, bolt and paper sounds).

Sounds are mastered to −18 LUFS short-term, with peaks at −6 dBFS, and delivered as Opus OGG with an MP3 fallback, as for the game's SFX.

| ID | Sound | Level | Where |
|---|---|---|---|
| `ui.hover` | Tiny metal tick (a rifle safety catch) | −24 dB | Focus change |
| `ui.select` | Rifle-bolt latch | −12 dB | Activate |
| `ui.back` | Lighter latch, pitch −3 semitones | −14 dB | Back or close |
| `ui.toggle` | Bakelite toggle switch | −14 dB | Toggle flip |
| `ui.detent` | Rotary detent click | −22 dB | Slider every 10% |
| `ui.type` / `ui.type.back` / `ui.bell` | Typewriter strike / soft tick / carriage bell | −16 dB | TypeField |
| `ui.paper` | Page rustle, 3 variants | −16 dB | Notebook, dossiers, tip cards |
| `ui.stamp` | Rubber-stamp thump | −10 dB | Stamps, PROMOTED |
| `ui.clink` | Coin on wood, silver and gold variants (pitch 1.0 / 0.94) | −12 dB | Medal drop |
| `ui.deny` | Muted wooden thud | −18 dB | Disabled or locked |
| `ui.error` | Short telegraph buzz, 120 ms | −16 dB | Bad password, save failed |
| `ui.projector` | 16 mm projector whirr, looped | −20 dB | Boot ident, briefing part 1 bed (under the music) |
| `ui.lamp` | Desk-lamp pull chain | −14 dB | Entering the campaign map table |

**Music** follows spec §9.1: the front-end loop, the briefing cues, the start / success / fail stingers, the credits cue and the "Exit Game" stinger. Rules:
- UI sounds **duck the music by 3 dB for 150 ms**.
- The menu loop **crossfades over 1.2 s** into the briefing music.

### 1.9 Input and accessibility

**Keyboard** [orig plus new]:
- ↑↓ move and wrap. Enter or Space activates. **Esc or a right-click goes back.**
- ←→ change toggles and sliders. Home and End jump to the first and last row. Hotkey letters and the underlined `(X)` letters activate directly.
- Tab and Shift+Tab also move, for browser convention.
- PgUp and PgDn page through long lists such as credits and key bindings.

**Gamepad** (Standard Gamepad API mapping):

| Input | Action |
|---|---|
| D-pad or left stick | Move. Repeat starts after 350 ms, then every 90 ms |
| A / × | Select |
| B / ○ | Back |
| X / □ | Context action: delete slot, reset binding |
| Y / △ | Details: slot info, dossier page 2 |
| LB / RB | Switch tabs or pages |
| LT / RT | Page up / down |
| Start | Esc menu in game |
| View / Select | Briefing Notes |

**Mouse:**
- Hover moves the highlight [inf orig]. Wheel scrolls lists and adjusts a focused slider.
- The right button is **back** everywhere [orig].

**Touch** (phone):
- A tap focuses and activates. Rows are ≥ 44 CSS px.
- A swipe right goes back. A swipe left or right turns dossier and notebook pages.
- There is no hover. The key-hint bar becomes touch buttons.

**Screen readers:**
- Each card is a `role="dialog"` with `aria-labelledby` pointing at its title, and a focus trap while open.
- Rows are buttons in a menu list; values, toggles and sliders use the ARIA roles above.
- State changes such as "Saved to slot 3" and "Wrong password" are read out through a polite live region.

**Focus management:**
- On open, focus goes to the first enabled row, or to the row that opened the sub-card when coming back. Focus is always restored on close.
- The cursor is hidden while navigating by pad or keyboard and reappears on mouse move.

**Settings** (Options → ACCESSIBILITY, §S10), each applied instantly:

| Setting | Values | Default |
|---|---|---|
| Text size | 90–150% | 100% |
| Reduced motion | System / On / Off | System |
| High contrast | On / Off | Off |
| Film grain and vignette | On / Off | On |
| Subtitles | On / Off. Size S / M / L; background band opacity 0–80% | On, M, 60% |
| Hold-to-confirm for destructive actions (quit, overwrite) | On / Off | Off |
| Menu background | Live / Still | Live |

**Contrast targets:**
- All body and item text ≥ 4.5:1 against its local background, measured over the **darkest-to-brightest diorama frame** with the scrim applied.
- Titles ≥ 3:1 as large text.
- The `tests/` UI suite samples 20 diorama frames and asserts these ratios.

### 1.10 Backgrounds

#### B1. Front end: live diorama under a camo scrim [up of the olive badge background]
The fan should still see **dark olive camo with an embossed badge**. Looked at longer, the olive turns out to be a *window* onto a living battlefield.

**Layers, back to front:**
1. **Live diorama** (WebGL, the game engine). It shows **the mission the profile last reached** (M1 *Baptism of Fire* on first run), loaded from the real mission data.
   - **Scene:** statics, terrain, water and weather only. No AI or sim ticks.
   - **Life:** a few **looped ambient actors**, i.e. 2 patrol walk cycles on fixed rails, smoke plumes, flags, water, snowfall and searchlight sweeps.
   - **Camera:** slowly dollies along a hand-authored **90 s looping spline** at 0.35× game zoom, at the game's standard isometric-ish angle, so it reads as a *Commandos map*. Moves use `--ease-io` between keys.
2. **Grade pass** (a single full-screen shader):
   - an **olive duotone** from olive-950 to #5b5c3a with 15% of the original chroma kept, so fires and lamps glow faintly warm;
   - a **vignette** of 35% at the edges;
   - a **2 r blur** outside the 4:3 box only;
   - grain.
3. **Camo scrim.** M1 wool-weave, multiplied at 55%. The emblem's normal map, lit by the sweeping key light (§1.4.3), perturbs the weave's shading. The scrim drifts **2 r every 10 s** in parallax against the diorama, for depth.
4. **Text scrim pool** and the MenuCard DOM.

**Cost budget:**
- The diorama renders at **50% internal resolution, capped at 30 fps**, with shadows baked once (static shadow map, no per-frame shadow pass) and no post except the grade.
- Target **≤ 3 ms GPU at 1080p** on a GTX 1060-class GPU, and ≤ 150 MB of VRAM.
- Rendering stops when the tab is hidden, and while an opaque screen (briefing, loading) covers it.
- The diorama loads **after** the first menu paint. Until it arrives, the static B1s is shown and crossfaded out over 1.2 s.

**Fallback, B1s (static):**
- Used for the Low preset, Reduced motion, "Menu background: Still", no WebGL2, or phones with `deviceMemory < 4`.
- A **pre-rendered still** of the same diorama, graded, is baked by `tools/` at build time (`assets/ui/diorama-mNN@2x.webp`, one per theatre: snow, temperate, desert, night). The static camo scrim and emblem go on top, in CSS.

#### B2. In mission: oxblood frozen frame [orig]
- Snapshot the game canvas at the moment of the Esc press or the mission end. **Hide the HUD first** by rendering one frame with the HUD hidden.
- Grade it in one shader pass:
  - luminance → the **oxblood duotone** `--oxblood-0` → `--oxblood-1` → `--oxblood-2`;
  - a 2 r blur;
  - a 45% vignette;
  - grain.
- A **Ken Burns drift of 1.02× over 30 s** keeps it from looking dead. Reduced motion: none.
- Crossfade in from the live frame over 180 ms.

#### B3. Black paper [orig]
- `--brief-black` with the M10 tooth.
- A faint embossed **SHADOW SIX wordmark watermark** at the lower right, 3–5 L above the ground [orig position, own mark].
- Used by the briefing, the loading screen, idents and the credits end card.

#### B4. Map table [new]
- The campaign map screen (S06b): a top-down **oak table** (M8) lit by a single warm desk lamp (a radial light falloff with a soft circular shadow edge).
- On it: the Europe map (the briefing SVG style on M3 paper), pins and string.
- Rendered in DOM and SVG over a CSS lighting overlay. No WebGL is required.

---

## 2. Screens

Every screen uses the same headings:
- **Orig:** what BEL had.
- **Wireframe:** on the 640×480 reference grid.
- **Components.**
- **States.**
- **Motion.**
- **Tokens.**
- **Assets.**
- **Code:** the owning file.

Assets listed as "generated" follow §5.

### S01. Boot: disclaimer and studio ident
**Orig:** the publisher's smoke logo, then the Pyro flame on black [orig]. **We ship neither.** In their place we show our own two short beats with the same pacing, "logo on black".

```
+----------------------------------------------------------------+
|                                                                |
|        A NON-COMMERCIAL FAN TRIBUTE TO                         |
|        COMMANDOS: BEHIND ENEMY LINES (1998)                    |
|        Pyro Studios / Eidos Interactive. Not affiliated.       |
|                                         (2.5 s, any key skips) |
+----------------------------------------------------------------+
+----------------------------------------------------------------+
|   [16 mm film leader: 3 . 2 . 1 sweep, projector whirr]        |
|              ...burns through to...                            |
|                   [ emblem, embossed ]                         |
|                     S H A D O W   S I X                        |
+----------------------------------------------------------------+
```

**Components:**
- the disclaimer text (Archivo Narrow, `--brief-white` at 70%, centred) on B3;
- the ident: an SVG film-leader countdown (circle sweep, crosshair, numerals in IM Fell), then the emblem and the wordmark.

**States:**
- On first run, the disclaimer must show for at least 1.5 s; after that, any key skips.
- On later runs the ident skips on any key at once.
- Setting: Video → "Intro: first run / always / never".

**Motion:**
- The leader sweep takes 1 s per numeral at 24 fps stepped frames, with gate weave (±0.6 r jitter at 24 Hz) and dust specks.
- The "burn-through" is a radial luminance wipe of 400 ms that reveals the emblem, with the key light sweeping once.
- Then the whole screen fades to black (400 ms).

**Assets:** `leader.svg` (ours), `emblem.svg`, `wordmark.svg`, `ui.projector`.

**Code:** new `src/ui/boot.js`.

### S02. Intro newsreel [up of the archival montage]
**Orig:** a B&W archival newsreel montage in a 4:3 letterbox with film judder.

**Ours:** a **60–75 s montage** in the same newsreel style. Nothing is taken from real archives.
- Shots come from **in-engine renders** of our missions (the Sola harbour, a U-boat pen, a desert airfield), graded to B&W newsreel.
- Plus **generated FLUX stills** (§5), such as crowds, a map room with officers and anti-aircraft guns at night, animated with 2.5D parallax pans.

**Layout:**
- 4:3 inside black (B3).
- IM Fell intertitles, e.g. "NORWAY — FEBRUARY 1941", in white on black cards.

**Grade (shader):**
- B&W with crushed blacks, flicker of ±4% luminance at 18 Hz, gate weave, vertical scratches (3–6 per second, random), and an iris-out at the end.
- Reduced motion: no flicker or weave, and cross-dissolves only.

**Audio:** the orchestral main theme (commissioned per spec §9) over the projector bed.

**Skip:** any key after 1 s, with a "HOLD ESC TO SKIP" prompt at the bottom-right. It auto-plays on first run only.

**Delivery:** WebM (VP9) at 1080p and 720p, captured with `tools/`. No subtitles are needed, since there is no speech.

**Code:** `boot.js`.

### S03. Title splash / "Press any key" [up of the box-art splash]
**Orig:** full-screen box art (a hero aiming a pistol, an explosion, a gun emplacement), with "COMMANDOS" in worn white slab capitals and a small red subtitle. It stays up while loading.

```
+----------------------------------------------------------------+
|  S H A D O W   S I X       <- worn white slab, dark outline     |
|  SIX SPECIALISTS. BEHIND ENEMY LINES.  <- small red caps       |
|                                                                |
|        [key art: Green Beret "Tiny" foreground, 3/4 view,      |
|         sidearm raised off-frame left, the other five in       |
|         silhouette behind; burning gun emplacement, searchlight]|
|                                                                |
|                  PRESS ANY KEY           (pulses)              |
|  fan-tribute disclaimer (small)                   v0.x         |
+----------------------------------------------------------------+
```

**Components:**
- the wordmark SVG across the top, white #f2eee4 with a 2 r dark outline and a worn texture mask;
- the tagline in **Anton at 11 r, `--brief-red`, tracking +0.3em** (the existing index.html tagline);
- the key art as a full-bleed WebP;
- the prompt "PRESS ANY KEY" (tap on phone);
- the disclaimer at 7 r.

**Motion** (2.5D parallax):
- The key art is split at build time into **3 depth layers** (sky and fire, the five silhouettes, the hero) using a monocular depth pass plus hand-cleaned masks.
- The layers drift ±6 r with the mouse, or ±3 r on a 12 s Lissajous path when there is no mouse.
- The emplacement fire is **animated**: a looped emissive flicker plus ember particles (≤ 60 CSS-animated sprites).
- The prompt pulses opacity 0.55 ↔ 1 over 1.6 s.
- Reduced motion: static art, with the prompt at 1.

**States:**
- **Loading:** the prompt reads "LOADING…" with a thin brass rule under it that fills left to right.
- **Ready:** the prompt changes to "PRESS ANY KEY" with a 220 ms crossfade.

**Assets:**
- Key art: generated (§5, prompt K1), composited and painted over by us. **The composition differs deliberately from the BEL box art:** the pistol is not aimed at the viewer, and the other five commandos are present.
- `wordmark.svg`.

**Code:** `screens.js` (`#title`).

### S04. New user and profile select [orig card, up]
**Orig:** on first run, a card "NEW USER / CREATE NEW USER? (Y)ES (N)O", then name entry.

```
             N E W   U S E R
             ───────────────
          CREATE NEW USER?

          (Y)ES        (N)O
```
Choosing **(Y)ES** opens name entry:
```
             N E W   U S E R
     .-------------------------------------.
     | SOLDIER'S SERVICE AND PAY BOOK      |  <- PaperSheet, IM Fell SC letterhead
     | NAME:  T I N Y _                    |  <- TypeField, Special Elite
     | RANK:  LANCE-CORPORAL               |
     '-------------------------------------'
          (ENTER) CONFIRM     (ESC) BACK
```

**Components:**
- a MenuCard;
- a PaperSheet styled as a **service book page** (our own design; no real form reproduced);
- a TypeField of up to 12 characters, A–Z, 0–9, space and "-".

**States:**
- **Empty name:** CONFIRM is dimmed.
- **Duplicate name:** an error row reading "THIS NAME ALREADY EXISTS".
- **(N)O** creates the profile "COMMANDO".

**Multiple profiles** [new]: when more than one profile exists, the boot goes to a **SELECT USER** card listing up to 8 profile names as SlotRows, followed by "NEW USER" and "DELETE USER".

**Motion:**
- The service-book sheet slides up from below the fold (320 ms) with a paper rustle.
- On confirm, a **red stamp "ENLISTED"** lands on the sheet (Stamp), and the screen goes to the Main menu with a 400 ms fade.

**Background:** B1.

**Code:** `screens.js`, plus the profile store in `save.js`.

### S05. MAIN MENU [orig structure]
```
+----------------------------------------------------------------+
|  [B1: live diorama, olive duotone, through camo weave]         |
|                   ,~~~~ raven wings (emboss) ~~~~,             |
|                        M A I N   M E N U                       |  y70-95, stamped steel
|                       ───────────────────                      |
|                          NEW GAME                              |  x300, y120, pitch 16
|                          SAVE GAME           (dim, holds slot) |
|                        ▸ LOAD GAME  ← cream, Oswald 600, +2r   |
|                          ═══════            brass hairline     |
|                          OPTIONS                               |
|                          CREDITS                               |
|                          HELP                                  |
|                          QUIT GAME                             |
|                  [==== SHADOW SIX plate, 6 rivets ====]        |
|  TINY · LANCE-CORPORAL            ↵ SELECT  ESC BACK  ↑↓ MOVE  |
+----------------------------------------------------------------+
```

**Components:**
- a MenuCard with 7 MenuItems in BEL order;
- a **profile tag** at the bottom-left: the NameTape with the name and rank. Clicking it opens Options → USER PROFILE;
- the KeyHintBar.

**States:**
- **SAVE GAME** is disabled outside a mission. Its note reads "NO MISSION IN PROGRESS".
- **In mission** (reached with Esc):
  - The background is **B2 oxblood**.
  - SAVE GAME is enabled.
  - Esc, R or a right-click on this card **resumes**, and the hint bar shows `ESC (R)ESUME` first (players read the word RESUME as an R hotkey; R is honoured).
  - **No RESUME row is added**, which keeps the list faithful. Players are pointed to Esc and right-click by the hint bar, and gamepad B resumes.
- **QUIT GAME:**
  - In mission, it goes to the quit card (S13) with the choice "QUIT MISSION".
  - In the front end, it goes to "ARE YOU SURE YOU WANT TO QUIT?". **(Y)ES** plays the Exit Game stinger and fades to the title splash, with the tongue-in-cheek line "RETURNING YOU TO MUNDANE REALITY…" [manual joke]. A browser tab cannot quit.

**Motion:**
- First entry: the rows stagger in (25 ms each) after the emblem's first light sweep, which starts 300 ms after the fade-in.
- The title is stamped in (scale 1.04 → 1, 120 ms, with `ui.stamp` at −20 dB).

**Tokens:** olive set, khaki / cream / dim, steel, brass.

**Assets:** M1, `emblem.svg` + normal maps, the diorama (engine), `ui.*` sounds, the menu music loop.

**Code:** `menus.js` (in mission), `screens.js` (front end). Both instantiate the **same** `MenuCard` from `menu-kit.js`.

### S06. NEW GAME [orig]
```
                     N E W   G A M E
                    ─────────────────
                       SINGLE PLAYER
                       MULTIPLAYER GAME        (dim · "NOT AVAILABLE")
                       TUTORIALS
                       RESTART MISSION         (dim unless in mission)
                       LOAD QUICK SAVED GAME   (dim unless a quicksave exists)
                       PASSWORD
                       EXIT
```
**Rules:**
- Rows keep their slots when dimmed [orig]. **MULTIPLAYER GAME** stays in place, dimmed, with the note "NOT AVAILABLE IN THIS TRIBUTE". This is pure fan recognition.
- When **LOAD QUICK SAVED GAME** is focused, the detail pane shows the quicksave's photo print and mission (S09 style).
- **RESTART MISSION** goes to a confirmation card: "RESTART THE CURRENT MISSION? PROGRESS SINCE YOUR LAST SAVE WILL BE LOST. (Y)ES (N)O".

**Code:** `screens.js` / `menus.js`, sharing the card definition.

#### S06a. SINGLE PLAYER: campaign [orig flow plus the spec's campaigns]
The card is titled **SINGLE PLAYER**, with these rows:
- `BEHIND ENEMY LINES`
- `BEYOND THE CALL OF DUTY`: locked, with a padlock and the note "COMING LATER"
- `EXIT`

Choosing BEL opens a second card titled **BEHIND ENEMY LINES**, with these rows:
- `CONTINUE — MISSION 4: …` (shown only when progress exists; its sub-line gives the rank)
- `START CAMPAIGN` (asks for confirmation if progress exists)
- `MISSION SELECT` [new]
- `EXIT`

**Skill** is BCD-only (Easy / Difficult) and is shown only for BCD later.

#### S06b. MISSION SELECT: the map table [new]
```
+----------------------------------------------------------------+
|   (lamp light pool)            M I S S I O N   S E L E C T      |
|  .--------------------------------------.  .-----------------. |
|  |  cream Europe map (briefing style)   |  | MISSION 3       | |
|  |   o Sola (M1)  o-----o  red string   |  | REVERSE         | |
|  |        o M2          • M3 (focused)  |  | ENGINEERING     | |  Anton red
|  |   ✕ locked pins grey                 |  | typed card:     | |
|  |                                      |  | date, place,    | |
|  '--------------------------------------'  | best medals ●●○ | |
|                                            '-----------------' |
|        (B)RIEFING   (S)TART WITHOUT BRIEFING   (ESC) EXIT       |
+----------------------------------------------------------------+
```

**The map:**
- **Pins:** reached missions are brass map pins; the next mission is a **red flag pin**; locked missions are a grey dot (focusable, shown as "LOCKED").
- **Red string** joins the missions in order.

**Navigation:** arrow keys or the pad move between pins in campaign order. The mouse selects by hover and click.

**Detail card:** the typed card (Special Elite) shows the mission number, name, date and place, and the best medals earned (MedalDiscs).

**Motion:**
- Entering: `ui.lamp`, then the light pool fades up (300 ms). The map sheet slides in from below (320 ms, rotated −1.5° → −0.8°).
- Focusing a pin: the pin lifts 2 r and its shadow grows. The card is replaced with a quick paper shuffle (160 ms).

**Assets:** M8, M3, `europe.svg` (shared with `src/ui/europe.js`), `pin-brass.svg`, `pin-flag.svg`.

**Phone:** the map sits above the card, and the pins' touch targets are enlarged to 44 px.

### S07. TUTORIALS [orig list, up]
The card is titled **TUTORIALS** and has two groups separated by an engraved rule:
- **THEORY SESSIONS** (7);
- **TRAINING MISSIONS** (6).

Until those exist, only **TRAINING: SANDBOX** (`m00`) is enabled. The rest are dimmed with the note "COMING LATER", which keeps BEL's 13-row rhythm.
- A focused theory session shows a PhotoPrint still and a 1-line typed synopsis in the detail pane.
- Music: "Theme Tutorials" (spec §9).
- Background: B1.

### S08. PASSWORD [orig]
```
                     P A S S W O R D
                    ─────────────────
                ENTER THE PASSWORD FOR YOUR MISSION

                 [ N ][ S ][ 2 ][ B ][ _ ]    <- 5 typewriter key-cap cells
                   WRONG PASSWORD             <- error (red), only after a bad code

                 (ENTER) ACCEPT        (ESC) EXIT
```

**Components:** the TypeField in password mode (5 cells) and a note line.

**States:**

| State | Look |
|---|---|
| Empty | Cells are idle cream caps |
| Typing | The strike animation plays per glyph |
| Complete | ACCEPT is enabled |
| Valid | The cells flash brass once (200 ms). The note reads "MISSION 7 — CAPTAIN" (the decoded mission and rank). A 600 ms hold, then the briefing |
| Invalid | Error shake, `ui.error`, the note "WRONG PASSWORD", and the cells clear after 400 ms |

**Input:**
- Paste is accepted: the text is trimmed and upper-cased, O is read as 0 and I as 1.
- A gamepad opens a **typewriter-style on-screen keyboard**: a 6×6 keycap grid of the alphabet.

**Background:** B1.

### S09. SAVE GAME / LOAD GAME [orig list, up detail]
```
+----------------------------------------------------------------+
|  [B2 oxblood in mission / B1 in front end]                     |
|                     S A V E   G A M E                          |
|        RAZEEN NATHA                  .----------------------.  |
|      ▸ BEFORE THE BRIDGE             | [photo print, sepia, |  |
|        -- UNUSED SLOT --             |  paper-clipped]      |  |
|        -- UNUSED SLOT --             | MISSION 3 · REVERSE  |  |
|        ... (10 rows total)           | ENGINEERING          |  |
|                                      | 26 SEP 2026 21:14    |  |
|                                      | MISSION TIME 00:14:32|  |
|                                      | TINY · CORPORAL      |  |
|                                      '----------------------'  |
|   (X) DELETE   (EXPORT…) (IMPORT…)     ↵ SAVE   ESC BACK       |
+----------------------------------------------------------------+
```

**The list [orig]:**
- 10 SlotRows, centred in the left column, **text only**.
- An empty slot reads `-- UNUSED SLOT --` in dim.

**The detail pane [new]:**
- It appears when a *used* slot is focused, sliding in from +16 r (220 ms). Contents:
  - a **PhotoPrint**: a sepia thumbnail captured at save time, 256×144 at 2×, with the HUD hidden;
  - a typed card: mission number and name, real date and time, mission clock, and profile rank.
- Empty slots show nothing, which keeps BEL's sparse look.

**Saving:**
- Choosing a slot turns the row into a **TypeField in place** [orig], prefilled with the mission name. **Enter** saves; `ui.bell` plays.
- **Saving over a used slot** first asks "OVERWRITE 'BEFORE THE BRIDGE'? (Y)ES (N)O".
- **Success:** the row flashes cream, a small red "SAVED" stamp lands on the detail print, and a live-region message is read out.

**Loading:**
- Choosing a used slot goes straight to the loading screen (S14). Unused slots are disabled on the LOAD card.

**Delete [new]:** X or Del, then a confirmation.

**Export / Import [new]:** JSON, per spec §8.4. These are small secondary text buttons in the hint bar.

**Failure:** if storage is full or blocked, an error row reads "COULD NOT SAVE — STORAGE UNAVAILABLE" and offers EXPORT.

**Storage:** save data follows spec §8.4. Thumbnails go in IndexedDB in try/catch; a missing thumbnail is replaced by an emblem placeholder print.

**Phone:** the detail pane appears under the list, compacted to a 72 r print plus 2 lines.

**Code:** `menus.js` (`showSlots`).

### S10. OPTIONS [orig top level, new submenus]
```
                       O P T I O N S
                      ───────────────
           USER PROFILE NAME : TINY
           SOUND VOLUME
           ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬○─────────   80     <- red slider row [orig]
           VIDEO OPTIONS
           GAME PREFERENCES
           CONTROLS                               [new]
           ACCESSIBILITY                          [new]
           EXIT
```

**Top level [orig order]:**
- **USER PROFILE NAME** opens the S04 profile card: rename, switch or new user.
- **SOUND VOLUME** is the **master** slider. The per-channel sliders are under it in the SOUND sub-card, reached with → or Y.

The submenus below use the same MenuCard, with ToggleRows and Sliders. Values sit at a tabbed column (x 470 r). A settings row shows a 1-line helper on focus (item-sub).

| Sub-card | Rows (value options; **default**) |
|---|---|
| **SOUND** | MASTER / MUSIC / EFFECTS / VOICES (sliders; 80 / 70 / 100 / 100) · NATURE SOUNDS (**ON**/OFF) · SUBTITLES (**ON**/OFF) · SUBTITLE SIZE (S/**M**/L) · EXIT |
| **VIDEO OPTIONS** | QUALITY (LOW/MEDIUM/**HIGH**/ULTRA) · RESOLUTION SCALE (50–100%, **auto**) · UI SCALE (**AUTO**/1×/1.5×/2×/3×) · MENU BACKGROUND (**LIVE**/STILL) · FILM GRAIN (**ON**/OFF) · BRIGHTNESS (slider, shows a calibration emblem that should be "barely visible") · FULL SCREEN (ON/**OFF**) · INTRO (**FIRST RUN**/ALWAYS/NEVER) · EXIT |
| **GAME PREFERENCES** [orig three first] | **SUBMISSIVE / INDIFFERENT** (default Indifferent) · **VERBOSE / LACONIC COMMANDOS** (Verbose) · **COMMANDOS WARNING ON/OFF** (ON) · then [new] BLOOD (**ON**/OFF) · CENSORED MODE (ON/**OFF**) · ACTIVE PAUSE ⚑ (ON/**OFF**) · CONE ALERT TINT (**ON**/OFF) · SELECTION RING (**ON**/OFF) · EDGE SCROLL (**ON**/OFF) · WHEEL ZOOM (**ON**/OFF) · SAVE REMINDER (ON/**OFF**) · EXIT |
| **CONTROLS** [new] | Tabs **KEYBOARD / GAMEPAD** (LB/RB). A list of `ACTION ........ [KEY]`, where the key is drawn as a typewriter keycap. Enter → "PRESS A KEY…" (a caret blinks inside the keycap) · X resets the row · "RESET ALL" at the bottom asks for confirmation. **Conflicts:** the other row is highlighted red, and the note reads "ALSO USED BY: QUICK SAVE — SWAP?" (Y)ES (N)O |
| **ACCESSIBILITY** [new] | The §1.9 settings table |

**Live preview:**
- Sliders play their channel sample.
- QUALITY and MENU BACKGROUND apply live to the diorama behind the card, a useful preview.
- UI SCALE and TEXT SIZE re-lay out instantly, with a 220 ms fade of the card.

**Persistence:** `ui-config.js` `saveOptions`. The option keys already exist and need extending with `textScale`, `reducedMotion`, `highContrast`, `grain`, `menuBg`, `intro`, `subSize`, `brightness` and `bindings`.

**Code:** `options-panel.js`, rebuilt on `menu-kit.js`.

### S11. HELP: field manual and dossiers [orig "quick guide + commando profiles", up]
**Orig:** a quick guide to the controls and the commando profiles [man; visuals not seen].

**Ours:** a **leather-bound field folder** (M7) opened on B1 or B2, with 3 tabbed sections (LB/RB, or clickable **card-stock index tabs** sticking out of the right edge).

```
+----------------------------------------------------------------+
|   .--leather folder------------------------------------------. |
|   | MOST SECRET (stamp)            | [photo print, clipped]  |[CONTROLS]
|   | PERSONNEL FILE  No. 2          |  "Duke"                 |[COMMANDOS]
|   | NAME:  SIR FRANCIS T. WOOLRIDGE|                         |[ENEMIES]
|   | CODENAME: DUKE                 | SPECIALITY: SNIPER      | |
|   | SPECIALITY: SNIPER             | KIT: [rifle][first aid] | |
|   | NOTES: typed paragraph...      |  (knapsack icons)       | |
|   '--------------------------------------------------------- ' |
|     ◂ PREV (LB)        2 / 6         NEXT (RB) ▸     ESC EXIT  |
+----------------------------------------------------------------+
```

**Sections:**

| Tab | Contents |
|---|---|
| **CONTROLS** | Typed sheets listing keys (keycap glyphs) by group: Selection, Movement, Camera, Tools, Saving. Built from the current bindings, so they always match. |
| **COMMANDOS** | One **dossier spread** per commando (6). |
| **ENEMIES** [new] | Typed sheets of enemy types, matching the tooltip names: SOLDIER, SERGEANT, MACHINE GUNNER and so on. Each has a silhouette print and behaviour notes ("sees 2 bands", "raises alarm"). |

**A commando dossier spread:**
- **Left page:** a typed PaperSheet. The letterhead is set in IM Fell SC, with the fields NAME, CODENAME, BORN, SPECIALITY and KIT, and 1–2 paragraphs of our own text from character-bible §1.
- **Right page:** a paper-clipped **PhotoPrint** portrait (generated per §5, prompt P1–P6) and a caption. The kit is shown as icons from `icons.js`.
- **Stamps:** a red "MOST SECRET" stamp at 12°, and the service number typed in.

**Motion:**
- The folder opens with a rotateY of 320 ms about the spine, with `ui.paper`.
- Pages turn with rotateY of 320 ms and a shadow sweep. The photo print lands with a 2° wobble settle.
- Reduced motion: fades.

**Phone:** one page at a time. Swipe to turn.

**Code:** new `src/ui/help.js`. It reuses `catalogue.js` and `icons.js`.

### S12. CREDITS [orig "view the team", up]
**Background:** B1, with the diorama switched to a **night lighting** grade.

**The scroll:**
- Section heads in a small CardTitle (14 r). Roles in khaki Oswald 500, names in cream Archivo Narrow 600.
- Groups, in order:
  1. SHADOW SIX team and tools
  2. "Original game by Pyro Studios", naming the original leads as a tribute credit
  3. Fonts (OFL / Apache, with names)
  4. CC0 assets (ambientCG, Poly Haven, Kenney, Freesound authors), listed from `CREDITS.md`
  5. Generated art (FLUX.1-schnell, Apache-2.0)
  6. The disclaimer

**Motion:**
- The scroll runs at **24 r per second**. ↓, RT or a held click speeds it ×4; ↑ reverses. Its end is a centred emblem held for 3 s, then back to MAIN.
- Reduced motion: **paged**, not scrolled. PgDn / A steps through pages.

**Music:** "Credits" (spec §9).

**Code:** `screens.js` (`showCredits`). The credits list is generated from `CREDITS.md` at build time.

### S13. Confirmation cards: QUIT and others [orig]
```
                      Q U I T   G A M E
                     ─────────────────
              ARE YOU SURE YOU WANT TO QUIT?

                   (Y)ES             (N)O
```

**The same card serves every confirmation:**
- QUIT GAME;
- QUIT MISSION ("ALL PROGRESS SINCE YOUR LAST SAVE WILL BE LOST");
- RESTART MISSION;
- OVERWRITE SLOT;
- DELETE SLOT or USER;
- START CAMPAIGN over existing progress;
- RESET ALL BINDINGS.

**Default focus is on (N)O**, the safe choice. Y and N hotkeys work.

**Optional "hold to confirm":** Y fills a brass underline over 800 ms before it commits.

**Background:** inherited (B1 or B2), plus 20% extra darkening.

**Code:** `menu-kit.js` `confirm()`.

### S14. LOADING screen with tips [orig had none; new]
Used whenever the briefing is skipped or unavailable: loading a save, quickload, restart, and Mission Select → "start without briefing". **In the normal flow, briefing part 1 is itself the loading screen** (S15).

```
+----------------------------------------------------------------+
| Mission 3                                        Sep 26, 1941  |  B3 black paper
| .---------------------------.   REVERSE                        |  Anton red
| | [photo print: engine      |   ENGINEERING                    |
| |  render of the mission    |                                  |
| |  target, B&W grade,       |   .-------------------------.    |
| |  slow Ken Burns]          |   | FIELD TIP  (clip)       |    |  typed index card
| |                           |   | The Spy can walk past   |    |
| |                           |   | soldiers while in       |    |
| '---------------------------'   | uniform, but officers   |    |
|                                 | will see through it.    |    |
|                                 '-------------------------'    |
| ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬─────────────  LOADING 64%     |
|                                  → NEXT TIP                    |
+----------------------------------------------------------------+
```

**Layout:** the briefing geometry is reused, so the loading → briefing transition does not move anything: the photo sits at **x 12–390, y 29–462**, the text column at x 407–632.

**Tip cards:**
- A typed index card on M3 paper, clipped, rotated −1°, 1–3 lines in Special Elite.
- Tips are drawn from `src/ui/tips.js`, about 60 entries. Each is tagged by theatre and mission so the tip is relevant, e.g. snow footprints on snow missions. Unseen tips are shown first.
- Tips cycle every 8 s with a card-swap (the new card slides over the old at 220 ms, with `ui.paper`). → or RB forces the next tip.

**Progress:**
- A thin 1.5 r **brass rule** fills left to right, with `LOADING NN%` in Oswald `tabular-nums` at 8 r.
- At 100% it reads "PRESS ANY KEY" in the pulse style (loading a save continues automatically after 400 ms).
- The bar never jumps backwards, and it eases toward the next real progress value.

**Performance:** this screen is DOM only. It must render at 60 fps while the engine loads, so the Ken Burns is a CSS transform on a pre-decoded image.

**Code:** new `src/ui/loading.js`.

### S15. BRIEFING part 1: the historical slideshow [orig layout, exact]
```
+----------------------------------------------------------------+  B3 #080808
| Mission 1                              Feb 20, 1941 |          |  y8-24, 11r white
| .-------------------------------------------------. | Baptism  |  Anton 34r #ff0100
| |                                                 | | of Fire  |
| |   PHOTO FRAME x12-390, y29-462 (379x434)        | |          |
| |   hard edge, no border [orig]                   | | body 11/14 Archivo
| |   1 archival-style B&W still (generated)        | | Narrow, #f0f0f0,
| |   2 hand-tinted still (generated + tint pass)   | | 2-3 paragraphs,
| |   3 Europe map (SVG, animated)                  | | ragged right.
| |   4 3D render of the target (our engine)        | |          |
| |                                                 | | ● ● ○ ○  slide pips [new]
| '-------------------------------------------------' |          |
|                                      Press Escape to skip      |  bold white, y455
+----------------------------------------------------------------+
     SHADOW SIX watermark embossed at the lower right (3-5 L)
```

**Components:**
- the photo frame with 4 slides;
- the text column: "Mission N", the date, the title and the body;
- **slide pips** [new]: 4 small 3 r rings that fill as the slides advance;
- the footer "Press Escape to skip" [orig wording];
- **[new]** a loading indicator in the footer: while loading, the footer reads "Press Escape to skip" in 40% white plus a tiny brass rule; once loaded it goes to full white. Pressing Esc before loading finishes goes to S14 with the same image.

**Slides:**
- Slides change every **6 s** (spec §6.6) with a **film-gate dissolve**: 500 ms, with a 2-frame luminance flicker. (The gate-weave jitter it also had was dropped: players read it as the screen shaking.) The photo going out holds its last Ken Burns frame while it fades.
- Each photo gets a **Ken Burns** move: 3% zoom over 6.5 s, the direction alternating per slide, `--ease-io`.
- **Map slide** (SVG, from `europe.js`):
  - cream sea `--map-paper`, land `--map-land`, thin borders;
  - the **dashed range arc** draws on over 1.2 s (stroke-dashoffset);
  - aircraft silhouettes glide 8 r along their routes;
  - the **red bordered target label** pulses (opacity 0.7 ↔ 1, 1.2 s) and the red curved arrow draws on;
  - city dots have rings.
- **Target render slide:** a real-time **orbit** of the mission's target building, rendered by the engine into the frame at a low resolution (379×434 r × DPR). It is graded to cold grey with fog [orig: CGI render, foggy relay station]. If the engine is still loading, a pre-baked still is used.

**Title and body:**
- The title types in by **line reveal**: each line wipes left to right over 300 ms, the second line 150 ms after the first.
- The body fades up paragraph by paragraph, 200 ms apart.
- Not letter-by-letter: this is a film, not a terminal.

**Input:**
- Esc skips to part 2. Space or → advances a slide. Click also advances.
- With a gamepad, A advances and B skips; the footer shows the correct glyph.

**Audio:** the briefing music cue plus a quiet `ui.projector` bed.

**Phone:** the photo is on top, full width at 4:3; the title and body sit under it and scroll; the footer is fixed.

**Assets per mission:** 2 generated stills (§5 prompts B-series), 1 map configuration (JSON), 1 target camera path, and our own text.

**Code:** `briefing.js`.

### S16. BRIEFING part 2: the Colonel's tour [orig structure; overlay new]
**Orig:** the live map, the HUD hidden, the camera auto-panning while the Colonel's voice explains; no subtitles; Esc starts the mission.

```
+----------------------------------------------------------------+
|▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ letterbox 8% (black paper) ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀|
| COLONEL'S ORDERS · MISSION 1                  ● ● ● ○ ○ ○  3/6  |
|                                                                |
|                [LIVE MAP, camera tour, 0.5x zoom]              |
|                     (  red ink circle  )  <- draws on          |
|                     [OBJECTIVE] typed label tape              |
|                                                                |
| .------.                                                       |
| |silh- |  THE COLONEL: "The relay station is guarded by two    |  subtitles
| |ouette|  sentries. Take them out quietly."                    |
| '------'                                                       |
|▄▄▄▄▄▄▄▄▄▄▄  ← PREV   SPACE NEXT   ESC START MISSION ▄▄▄▄▄▄▄▄▄▄▄▄|
+----------------------------------------------------------------+
```

**Frame and speaker:**
- **Letterbox:** the bars slide in from the edges (400 ms) when part 2 starts and slide out as the mission begins.
- **Speaker card:** the §3.2 **Colonel variant**, a **silhouette** print with an "H.Q." name tape. The character bible says the Colonel has no face.

**Subtitles:**
- Archivo Narrow 600, cream, on a 60% band.
- The speaker name is in brass Oswald caps.
- Lines follow the voice timing: they fade in over 120 ms and out over 200 ms.

**Stop markers** (projected from world space into an SVG overlay):
- **Objectives** get a **red ink circle** that draws on over 600 ms with a hand-drawn wobble. It uses the same stroke style as the notebook minimap's objective circle, so the two match.
- **Dangers:** a black ink ✕ plus a "DANGER" label tape.
- **Extraction:** a dashed red arrow plus an "EXTRACTION" label tape.
- Label tapes are khaki NameTapes in Special Elite.

**Stop counter:** pips at the top-right.

**Camera** moves between stops with `--ease-io` over 1.2–2 s, and holds for `briefingStop` (4.5 s) plus the voice line's length.

**Input:**
- Space or → goes to the next stop; ← to the previous.
- **Esc starts the mission**, with a 400 ms film-grain fade out of the letterbox.

**Reduced motion:** the camera cuts to each stop with a 120 ms fade instead of panning.

**Code:** `tour.js` and `briefing.js`.

### S17. BRIEFING NOTES: the notebook (Ctrl+B or the folded corner) [orig]
```
+----------------------------------------------------------------+
|  (game dimmed 60%)                                             |
|   ⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇⌇ black wire spiral, 30 loops   |
|  .-------------------------------------------------------.     |
|  |  DATE:      FEB 20, 1941          (red labels #7a0f06)|     |
|  |  LOCATION:  SOLA, STAVANGER                           |     |
|  |  MISSION:   BAPTISM OF FIRE                           |     |
|  |  ------------------------------------ faint rules     |     |
|  |  - THE DRIVER AND THE GREEN BERET SHOULD MEET ...  ✓  |     |  red tick when done [new]
|  |  - DESTROY THE RELAY STATION                          |     |
|  |  - REMEMBER, THEY CAN SEE YOUR STEPS ON SNOW!         |     |
|  '-------------------------------------------------------'     |
|  ▀▀▀▀▀▀▀▀▀▀▀▀ dark card backing #262619 ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀      |
|                                        ANY KEY / CLICK CLOSES  |
+----------------------------------------------------------------+
```

**The pad:**
- About 640×466 r, centred.
- Paper: M3 with the stain palette (#9da375 / #7d8155 blotches in the texture) over a `--note-paper` base. The paper is lightened for contrast (§1.2).
- Faint ruled lines at a 23 r pitch [orig].

**The spiral:** an SVG wire coil with a highlight, casting a 1 r shadow on the paper.

**The ink:**
- Text is baked into a canvas at DPR on open, using Oswald 500 caps at 8.5 r.
- An **ink-bleed pass** is applied: a 0.4 r dilate, with an feTurbulence-displaced edge at scale 0.6. Each line gets a random baseline rotation of ±0.3° and an ink density of 0.85–1.0.
- The layout is **also rendered as real DOM text** (visually hidden, available to screen readers).

**New:**
- A **red ink tick and strike-through** on completed objectives, drawn on over 400 ms the first time the notebook opens after completion.
- Objectives failed so far get a red ✕.

**Motion:**
- The pad **flips up about the spiral hinge**, from the HUD notebook's position: `rotateX(-80° → 0)` plus translate, 320 ms `--ease-out`, with `ui.paper`.
- It closes in reverse (240 ms).
- Reduced motion: a fade.

**States:** the game is paused while the notebook is open [inf orig]. Any key or click closes it.

**Code:** `notebook.js`.

### S18. GAME PAUSED (P) [orig]
- A centred **"GAME PAUSED"** CardTitle (stamped steel) on the live, frozen game.
- **Polish:**
  - the game gets a 30% desaturation plus a 25% vignette, as a 150 ms shader fade, so the pause is obvious without the full oxblood grade;
  - a hint `P (R)ESUME` below the title, at 7 r. P or R resumes (R is consumed there, so it never also arms the R ability). Hidden while an end card (MISSION NOT COMPLETED…) covers the pause.
- **Active pause** ⚑: a thin 1 r **brass frame** runs round the viewport, and the hint adds "ORDERS ENABLED". Players can see that input is live.
- The HUD stays visible, as in BEL.
- **Code:** `menus.js` (`.ui-paused`).

### S19. MISSION END cards [orig]
**Background:** B2. The time-dilation lead-in is described in §1.7.

```
                M I S S I O N   C O M P L E T E D
               ───────────────────────────────────
           YOU HAVE SUCCESSFULLY COMPLETED THE MISSION.

                  PRESS ANY KEY TO CONTINUE        (pulse)
```

| Variant | Title | Lines (khaki, Oswald 500, 11 r, centred) | Buttons | Stinger |
|---|---|---|---|---|
| Win | MISSION COMPLETED | "YOU HAVE SUCCESSFULLY COMPLETED THE MISSION." | PRESS ANY KEY → S20 | Success |
| Tutorial win | MISSION COMPLETED | "YOU HAVE SUCCESSFULLY COMPLETED THE TUTORIAL MISSION." | PRESS ANY KEY → TUTORIALS | Success |
| Fail (all dead or captured) | MISSION FAILED [inf] | "ALL YOUR MEN HAVE DIED OR HAVE BEEN CAPTURED." | `(R)ESTART MISSION   (Q)UICK LOAD   (L)OAD GAME` | Fail |
| Fail (escape vehicle destroyed etc.) | MISSION FAILED | The matching §8.1 string, e.g. "YOU DESTROYED THE TRUCK, BUT YOU NEEDED IT TO ESCAPE." | as above | Fail |
| Escaped before objectives | MISSION NOT COMPLETED | "YOU MANAGED TO ESCAPE, BUT YOU DIDN'T DESTROY THE TARGETS…" | `(C)ONTINUE   (Q)UICK LOAD` | Fail |

**Rules:**
- **There is no separate GAME OVER screen** [orig].
- When there is no quicksave, (Q)UICK LOAD is dimmed in place.

**Motion:**
- The title stamps in (scale 1.06 → 1, 140 ms) together with the stinger's first hit.
- The lines fade in 200 ms later.
- The "any key" prompt appears only after **1.2 s**, so a key held from gameplay cannot skip the card.

**Code:** `debrief.js` (`failureText`), `screens.js`.

### S20. DEBRIEF / MERIT [orig layout, up materials]
```
+----------------------------------------------------------------+
|  [B2 oxblood backdrop, darkened 20%]                           |
|   .--leather board (M7), stitched olive canvas panel----------.|
|   | ENEMY LOSSES                        LANCE-CORPORAL        ||  red labels #e4574a
|   |   (◉) SOLDIERS    23                .------------------.  ||  rank: Anton red
|   |   (◉) VEHICLES     2                | commando figure  |  ||
|   |   (◉) BUILDINGS    1                | half-length,     |  ||
|   | ─────────────────────────────       | khaki battledress|  ||
|   | MISSION TIME     00:14:32  ◉ ◉ ○    | rank chevrons    |  ||  silver discs
|   | SUSTAINED DAMAGE           ◉ ◉ ◉    | (engine render)  |  ||
|   | MISSION MERIT              ◉ ◉ ○    '------------------'  ||  gold discs
|   | MERIT  ◉ ◉ ◉ ◉ ○ ○   (to CORPORAL)                         ||
|   | PASSWORD  [ N S 2 B 7 ] (copy)      <- typed tag on string ||
|   '-----------------------------------------------------------'|
|            (N)EXT MISSION          (P)LAY AGAIN                |  below the panel [orig]
+----------------------------------------------------------------+
```

**The panel [orig ≈ 300×250 r]:**
- Scaled up to **420×300 r** for legibility; the proportions are kept.
- Olive canvas (`--debrief-panel`, M2 recoloured) stitched onto a **leather board** (M7), with brass corner rivets.
- Engraved horizontal rules (0.5 r dark plus a 0.5 r highlight).

**Labels:** `--debrief-red`, Oswald 600, 9 r. Counts are cream Oswald `tabular-nums`, 12 r.

**Enemy-loss icons:** round grey stamped-tin discs (soldier / vehicle / building) in SVG.

**The figure** is a real-time or pre-rendered **engine render of the Green Beret** (the "Tiny" model) in khaki battledress, half-length and cropped by the panel edge [orig]. It carries:
- the **red shoulder title "SHADOW SIX"** (our text, in place of "COMMANDO");
- **rank insignia matching the current rank**, per spec §8.2 (chevrons, crowns and pips as SVG decals on the render's sleeve or shoulder area).

**The password tag:**
- A manila **luggage tag** on a string (M3), with the code typed in Special Elite in 5 keycap cells.
- **(C)OPY** copies it to the clipboard, and a "COPIED" stamp lands.

**Choreography** (skippable: any key completes it instantly):

| t | Beat |
|---|---|
| 0 ms | The panel slides up (320 ms) |
| +300 | The enemy counts roll up (600 ms each, 150 ms stagger) |
| +1100 | MISSION TIME rolls, then its silver discs **drop in one by one** (150 ms apart). Each falls 10 r with a 1-bounce settle (the only bounce in the whole UI, allowed because it is a physical coin) and a `ui.clink` |
| +1800 | SUSTAINED DAMAGE discs drop |
| +2500 | MISSION MERIT gold discs drop, pitch 0.94 |
| +3200 | The MERIT bar fills slot by slot |
| +3800 | The password types in |

**Promotion** (at the end of the choreography):
- The rank name crossfades.
- A red **"PROMOTED" stamp** lands at −8° over the rank.
- The new insignia appears on the figure with a brass glint sweep (300 ms).
- The success stinger's tail swells.

**Replay farming note:** spec §8.2. In PLAY AGAIN mode, a small typed note reads "GOLD STARS ARE RE-CREDITED ON REPLAY".

**Phone:** the figure moves above the labels as a 120 r crop.

**Code:** `debrief.js`.

### S21. Campaign end and epilogue [orig: victory FMV; spec: M20 gate]
**Victory:** a B&W-to-colour **newsreel outro** in the S02 style: an engine montage of the missions, then the six line up as PhotoPrints on a table, then the credits (S12).

**M19 epilogue** (the rank gate was not met):
- A typed **letter from H.Q.** on a PaperSheet with an IM Fell letterhead, over B3.
- It tells the player that Operation Valhalla requires the rank of Captain.
- Buttons: `(C)ONTINUE` and `(P)LAY AGAIN` (to earn stars).

### S22. System messages and toasts [new]
Autosave or quicksave confirmations ("GAME SAVED"), storage errors, "GAMEPAD CONNECTED / DISCONNECTED", and "SCREENSHOT SAVED".
- A small khaki NameTape slides in from the top-right (220 ms), holds for 2.5 s, then leaves (160 ms).
- It never covers the portrait strip. In mission it sits **below the message line**.
- A gamepad disconnect during play **opens the Esc menu** (pause) with the note "CONTROLLER DISCONNECTED".

---

## 3. One visual language: the HUD pieces that menus share

The HUD (spec §6) and the menus are built from the **same materials and components**. The portrait on the top bar, the speaker card, a dossier photo and a save thumbnail are all the same **PhotoPrint** object.

### 3.1 Portrait strip (top bar, spec §6.1; `topbar.js`)

**Frame (62×44 r) [orig size]:**
- a **canvas-webbing pocket** (M2) with stitched edges, and **two brass rivets** at the top corners (2 r, M6);
- the face print (40×40 r) sits in it as a **PhotoPrint** with a 1 r border, slightly inset, with a 1 r shadow under the pocket lip.

**Health slot (9×37 r):**
- a recessed channel with a 1 r inner shadow;
- the fill (6×34 r) is **red enamel** (M9), `--blood`, with a vertical glass highlight. It **drains from the top** [orig];
- when HP drops, the lost part flashes cream for 150 ms, then eases down over 300 ms.

**States:**

| State | Look | Motion |
|---|---|---|
| Unselected | **Greyscale** silver-gelatin print [orig primary cue] | — |
| **Selected** | **Full colour**, plus a 0.5 r **brass tab** under the pocket | Greyscale → colour over 120 ms |
| Hover | The print lifts 1 r and its shadow grows | 80 ms |
| Talking | Lip-synced face (spec §6.3); the print also warms +3% | — |
| Seen (warning) | A steady `--seen-blue` outer glow of 2 r | — |
| Held / fired at | A `--alert-red` glow flashing at 4 Hz. Reduced motion: steady, plus a "!" corner badge | — |
| In vehicle / building / jailed / buried / diving | A small **ink stamp glyph** at the lower-right corner of the print (vehicle, house, bars, shovel, bubbles), drawn in the same M11 stamp style as the menus | Stamp animation on change (140 ms) |
| Dead | The **skull** is drawn as a black **ink stamp over a greyscale print**, and the print fades to 40% | Stamp thump at −22 dB, with `ui.stamp` |

### 3.2 Speaker card (spec §6.3; `topbar.js` `.card`)

**Size and place:** 96×72 r [spec], directly **under the speaker's portrait pocket**, as if the larger photo had slid out of it.

```
  [pocket 62x44]
   .-----------------.
   | 96x72 photo     |  PhotoPrint, colour, lip-synced face / 3D head
   | print, clipped  |
   '-----------------'
   [ TINY ]  ▮▮▯  <- NameTape (codename) + 3-bar voice level (brass, small)
```

**Components:**
- a PhotoPrint with the `clip` variant: a brass paper clip at the top-left, −8°;
- a NameTape with the **codename** (TINY, DUKE, FINS, INFERNO, TREAD, SPOOKY; guests by surname);
- a small **brass 3-bar level meter** driven by voice RMS. It is a subtle cue for deaf and hard-of-hearing players, and it pairs with the subtitles.

**Motion:**
- The card slides down out of the pocket (160 ms `--ease-out`) and holds for the line's duration plus 0.5 s.
- It leaves by sliding up (140 ms).
- A new line replaces a live card by crossfading the print (90 ms). At most one card is shown.

**Laconic mode:** acknowledgement barks are suppressed, and so are their cards [spec].

**Variants:**
- **Colonel:** a black **silhouette** print with an "H.Q." tape (S16). Never a face, per character-bible §6.4.
- **Guests:** their generated portrait with a surname tape.
- Enemies never get a card.

### 3.3 Other shared pieces

| Piece | Spec | Shared styling |
|---|---|---|
| **Tooltip** (spec §6.4) | A black box with a thin light border and white bold condensed caps [orig] | #0b0a08 at 92%, a 0.5 r #d9d2bd border at 60%, Oswald 600 cream, a 1 r drop shadow; fades in over 120 ms after the 0.8 s delay |
| **Message line** (spec §6.5) | Top centre, 4 s | Khaki Oswald 600 caps with a 1 r olive-950 outline; fades in 150 ms and out 300 ms. The same khaki as menu items, so menus and HUD read as one family |
| **Bark subtitles** | Speech tags over the speaker | A tiny paper-tape tag (M3) in Archivo Narrow 600 ink. German lines carry an italic gloss |
| **HUD buttons** (eye, hand, camera, posture, "?") | Photographic icons; each has a hover state [orig M_ sprites] | Same states as MenuItem: +8% brightness, 1 r lift and a brass hairline on focus; `ui.hover` / `ui.select` |
| **Notebook minimap** | Paper strip | The same M3 paper and ink stroke as the S17 notebook. Objective circles use the same red-ink stroke as S16 |
| **Knapsack** | Olive rucksack | The disabled-item grey and the reason tooltip follow the §1.6 disabled rules |

---

## 4. Master asset list

**Location:** `assets/ui/` unless stated. Every entry is also logged in `CREDITS.md`.

**Licence legend:**
- **CC0:** download it, record its ID.
- **Ours:** made by us, in SVG, a baked render or a recording.
- **Gen:** FLUX.1-schnell output (Apache-2.0 model; the output is ours), per §5.

| Asset | Type | Licence and source | Tiers / format | Screens |
|---|---|---|---|---|
| `emblem.svg`, `emblem-height@2x/@3x.png`, `emblem-normal@2x/@3x.ktx2` | Emblem | Ours | SVG, 2048 / 4096 | B1, S01, S03, S12 |
| `wordmark.svg` | Wordmark | Ours (from Alfa Slab One outlines, OFL; outlined derivative credited) | SVG | S01, S03, B3 |
| `leader.svg` | Film-leader countdown | Ours | SVG | S01 |
| `tex/wool-olive@1x/2x/3x` | M1 | CC0 ambientCG "Fabric" + our Worley camo mask | WebP + KTX2 | B1, S20 |
| `tex/webbing@…` | M2 | CC0 ambientCG "Fabric" (canvas) + our stitching SVG | WebP | HUD, S20, §3 |
| `tex/paper-aged@…`, `tex/paper-stain-mask@…` | M3 | CC0 ambientCG "Paper" + our procedural stains | WebP | S04, S11, S14, S17, S20 |
| `print-border.svg`, `grain-256.png` | M4 | Ours | SVG, PNG | PhotoPrint |
| `tex/brushed-steel-mask@…` | M5 | CC0 ambientCG "Metal" (brushed) | WebP (greyscale) | CardTitle |
| `rivet.svg`, `eyelet.svg`, `paperclip.svg`, `pin-brass.svg`, `pin-flag.svg` | M6 | Ours | SVG | many |
| `tex/leather@…` | M7 | CC0 ambientCG "Leather" | WebP | S11, S20 |
| `tex/oak@…` | M8 | CC0 Poly Haven wood texture | WebP | S06b |
| `stamps/*.svg` (MOST SECRET, PROMOTED, SAVED, COPIED, ENLISTED, skull, vehicle, house, bars, shovel, bubbles) | M11 | Ours | SVG + distress mask | S04, S09, S11, S20, §3.1 |
| `medals@2x/@4x.webp` | MedalDisc atlas | Ours (three.js coin render) | WebP atlas | S06b, S20 |
| `loss-icons.svg` | Enemy-loss discs | Ours | SVG | S20 |
| `keycaps.svg`, `prompts/*` | Key and pad glyphs | Ours (keycaps) + **Kenney Input Prompts, CC0** (recoloured) | SVG | KeyHintBar, S10, S11 |
| `europe.svg` | Map | Ours (from Natural Earth, public domain) | SVG | S06b, S15 |
| `diorama-{snow,temperate,desert,night}@2x.webp` | B1s stills | Ours (engine render, graded) | WebP 2560×1440 | B1s |
| `keyart-layers/{sky,six,hero}.webp` | Title key art | **Gen** K1 + our paint-over | WebP 2× / 3× | S03 |
| `intro.webm` | Newsreel | Ours (engine) + Gen stills N1–N6 | VP9 1080p / 720p | S02, S21 |
| `brief/mNN-{a,b}.webp` | Archival-style stills | **Gen**, B-series, graded | WebP, 1.5× upscale | S15 |
| `brief/mNN-target.webp` | Target render still (fallback) | Ours (engine) | WebP | S15 |
| `portraits/{tiny,duke,fins,inferno,tread,spooky}-{bw,colour}.webp` | Dossier portraits | **Gen** P1–P6 via img2img from our 3D head renders | WebP 1024² | S11, §3.2 |
| `portraits/colonel-silhouette.svg` | Colonel | Ours | SVG | S16 |
| `figure-rank@2x.webp` + `insignia/*.svg` | Debrief figure | Ours (engine render of the Tiny model) + SVG rank decals | WebP | S20 |
| `sfx/ui/*.ogg/.mp3` | §1.8 set | Kenney UI Audio / Interface Sounds (CC0), Freesound CC0 (provenance-checked), our foley | Opus + MP3 | all |
| Fonts | §1.3 | OFL: Staatliches, Oswald, Anton, Archivo Narrow, IM FELL English SC, Alfa Slab One (outlined only). Apache-2.0: Special Elite | WOFF2 subset | all |

**Budgets:**
- Fonts total ≤ 450 KB.
- UI textures ≤ 14 MB at the 2× tier. The 3× tier (≤ 40 MB) is lazy-loaded.
- Per-mission briefing assets ≤ 1.2 MB.
- UI sounds ≤ 600 KB.

---

## 5. Generated art brief (FLUX.1-schnell, Apache-2.0)

**Rules:** character-bible §0.2 and §4 apply in full.
- **Text prompts only.** No real photographs or original game art as input.
- **Portraits** are made **img2img from our own 3D head render** (strength 0.40–0.50), so they match the in-game head, which is the source of truth.
- **No ControlNet or adapter with a non-commercial licence.**
- **Seed-lock** every accepted image and store the prompt, seed, steps and licence record in `docs/art-log/` (or CREDITS).

**Shared settings:**
- 4 steps, 1024×1024, or 1344×768 for landscapes;
- upscale 1.5–2× with Real-ESRGAN (BSD-3);
- then our grade: B&W or tint, grain, and a print border applied in-engine, not baked.

**Style suffix** (all prompts): "1940s wartime photograph, silver gelatin print, film grain, natural light, documentary, no text, no logos, no insignia with swastika or runes, no famous people".

**Negative intent**, enforced in the prompt and at review: celebrity, famous actor, cartoon, modern gear, swastika, SS runes, death's head, readable text.

| ID | Subject (our fictional content) | Notes |
|---|---|---|
| **K1** | Title key art: "painted wartime adventure-film poster, a massive commando in a dark-green beret and khaki battledress, three-quarter view, raising a pistol toward the left edge, five commandos silhouetted behind him on a snowy dockside at dusk, a burning coastal gun emplacement and a searchlight beam" | Painterly, not photo. Split into 3 layers and painted over by us |
| **N1–N6** | Newsreel stills: crowd at a harbour; officers around a map table (faces soft or turned away); anti-aircraft guns at night; convoy in snow; bomber silhouettes; soldiers' boots on a gangplank | Graded B&W, 2.5D panned |
| **B-series** | Two stills per mission: (a) an archival-style B&W scene of the setting, e.g. "Norwegian fjord harbour with fishing boats, winter 1941"; (b) a still to hand-tint, e.g. "German seaplane moored at a snowy pier, ground crew" (no swastika markings: the tail is plain or cropped) | The tint pass is our shader: 3 flat hand-colour masks at 35% |
| **P1–P6** | Dossier portraits from each commando's "Art direction brief" (character-bible §1.x) + the shared suffix, conditioned on our head renders | B&W and colour versions from the same seed |
| **G-series** | Guest portraits (McRae, the Informer, Gilbert and the prisoners) | Same pipeline |

**Review gate:** each image is checked for hands and faces, anachronisms, stray text and prohibited insignia. Two reviewers sign off in the art log.

---

## 6. Implementation map, performance and tests

**New and changed files** (proposed; owners per ARCHITECTURE):

| File | Role |
|---|---|
| `styles/menus.css` [new] | §1.2 tokens, §1.3 type scale, §1.5 components, §1.6 states, §1.7 motion; `@media (prefers-reduced-motion)` and `.hc` (high contrast); phone breakpoints |
| `src/ui/menu-kit.js` [new] | MenuCard, MenuItem, ToggleRow, Slider, TypeField, SlotRow, KeyHintBar, PhotoPrint, PaperSheet, Stamp, NameTape, MedalDisc, `confirm()`; the focus manager and **input router** (keyboard, mouse, gamepad, touch) with last-device glyph switching |
| `src/ui/ui-sound.js` [new] | §1.8 registry, throttling, music ducking |
| `src/ui/backdrop.js` [new] | B1 diorama controller (a scene subset, spline camera, 50% render target, grade shader), B1s fallback, B2 snapshot + duotone, B3; exposes `setMode('frontend' \| 'mission' \| 'paper' \| 'off')` |
| `src/ui/boot.js`, `loading.js`, `help.js`, `tips.js` [new] | S01–S03, S14, S11 |
| `screens.js` | S03–S07, S12, S19: rebuilt on menu-kit, with the front-end MAIN in BEL order (§7) |
| `menus.js` | S05 in mission, S09, S13, S18 |
| `options-panel.js` | S10 plus the submenus. `OPTION_ROWS` gains the new keys |
| `briefing.js`, `tour.js`, `europe.js` | S15, S16 |
| `notebook.js` | S17 |
| `debrief.js` | S19, S20 |
| `topbar.js`, `tooltip.js`, `messages.js` | §3 restyle |

**Performance targets:**
- Opening any card: ≤ 1 frame of layout, then ≤ 16 ms per frame during transitions at 4K on an integrated GPU (transforms and opacity only).
- B1 at ≤ 3 ms GPU (§1.10).
- No layout thrash: rows use `transform` for the nudge, not padding.

**Tests** (`tests/`):

| Kind | Checks |
|---|---|
| Unit | Focus manager wrap and skip, disabled-row focus, hotkey mapping, password cell entry (O→0, I→1), slider steps, toggle flip |
| Contrast | 20 sampled diorama frames plus B2 samples, per §1.9 |
| Visual regression | Each screen at 1280×720, 1920×1080, 3840×2160, 400×860 (phone) and 900×400 (landscape phone), in default, high contrast and reduced motion. **No horizontal page scroll at 400 px** |
| Accessibility | axe-core has no violations. Every card is reachable and closable by keyboard alone and by pad alone |
| Recognisability review | A side-by-side with the internal reference frames (`scratchpad/refs/menus/`, never shipped) against the §0 contract checklist |

---

## 7. Reconciliations and open points

1. **Title menu structure.**
   - Spec §6.8 and the current `screens.js` use a flat list: NEW CAMPAIGN, BCD, MISSION SELECT, PASSWORD, CONTINUE, LOAD, OPTIONS, CREDITS, SANDBOX.
   - **This document restores BEL's MAIN → NEW GAME hierarchy** (contract items 1 and 8). Each current entry maps as follows:

     | Current entry | New place |
     |---|---|
     | NEW CAMPAIGN / BCD / MISSION SELECT | NEW GAME → SINGLE PLAYER (S06a/b) |
     | PASSWORD | NEW GAME → PASSWORD |
     | CONTINUE (quicksave) | NEW GAME → LOAD QUICK SAVED GAME, plus CONTINUE in S06a |
     | LOAD | MAIN → LOAD GAME |
     | SANDBOX | NEW GAME → TUTORIALS |

   - Spec §6.8 should be updated to match.
2. **Esc menu.**
   - The spec lists Resume, Save, Load, Quick Load, Restart, Options, Help and Quit to Title.
   - Here the in-mission Esc opens the **same MAIN card** [orig]:
     - Resume = Esc, right-click or B, advertised in the hint bar;
     - Quick Load and Restart are under NEW GAME [orig].
   - If playtests show players look for a RESUME row, add it as **row 0** above NEW GAME, in cream, only in mission. That is the single allowed deviation.
3. **The debrief panel grows** from 300×250 to 420×300 r for legibility. The layout is unchanged.
4. **Contrast adjustments.** The notebook red (#c71a0b → #7a0f06, with the paper lightened) and the debrief red (#b01e18 → #e4574a) are deliberate accessibility changes. The original values remain in the textures.
5. **Unseen originals** ([inf] in menus.md): credits, password entry, help, the video and preferences submenus, and the part-2 overlay. These are designed here in the family style, not copied.
6. **Tutorials and multiplayer** exist only as faithful, dimmed placeholders until they are built.

---

## Critique & amendments

**Review scope.** This document was checked two ways:
- **Fidelity:** against `research-raw/menus.md` and the internal reference frames (`zoom1-3.jpg`, `raw/C1_Mis_1_Briefing_3.png`, measured with PIL).
- **Polish:** against the front ends of *Commandos: Origins*, *Shadow Tactics*, *Desperados III* and *Company of Heroes 3*.

The implementation (`styles/ui.css`, `src/ui/*.js`) was spot-checked for drift.

**Verdict.**
- **Structure is excellent.** The §0 contract, item order, hotkey grammar and slot rhythm are right, and so are the two backgrounds.
- **Three fidelity errors would make a 1998 player pause:** the placement of hotkey rows, the debrief backdrop, and the briefing type metrics.
- **The polish layer is too dense.** It has too many typefaces, materials and simultaneous focus cues. Modern AAA menus are restrained, and this needs more restraint to read as AAA, not as a scrapbook.

The amendments below **override** the sections they cite. Where one conflicts with the text above, the amendment wins.

### A. Fidelity amendments (would a 1998 player recognise it?)

**A1. Hotkey rows sit at the bottom of the screen, not under the text** [seen zoom2: NEW USER, MISSION COMPLETED, debrief].
- In BEL, these rows are detached from the question and sit on a **bottom baseline at y ≈ 440–465 r**, centred:
  - `(Y)ES  (N)O`;
  - `PRESS ANY KEY TO CONTINUE`;
  - `(N)EXT MISSION  (P)LAY AGAIN`.
- The question or result lines sit mid-screen, around y 200–260.
- **Amend the wireframes** of S04, S08, S13, S19 and S20, and `HotkeyButton` (§1.5.4): add a `footer` slot to `MenuCard` pinned at y 452 r. The KeyHintBar moves to y 470 r at the right, or is hidden on these cards, since the hotkeys are the hints.

**A2. The in-mission frozen frame stays sharp** [seen zoom1: trees, snow and a soldier are readable under the oxblood].
- The player must recognise *their own map* under the menu.
- **B2 amendment:**
  - no blur inside the 4:3 box. The 2 r blur applies only outside it, as in B1;
  - vignette 20%, not 45%;
  - the Ken Burns drift is capped at 1.01×;
  - the duotone keeps the measured three stops. Do not crush the highlights; snow must still read ≈ #8a6a60.

**A3. The debrief floats on black** [seen zoom1/zoom2].
- In BEL, the olive panel sits alone on **pure black**, with wide empty margins.
- **S20 amendment:**
  - The background is B3 black paper, not B2 oxblood.
  - **Drop the leather board and the brass corner rivets.** Keep the olive canvas panel, its engraved rules and the cropped commando figure.
  - The panel may grow to 420×300 r (§7.3). It must keep ≥ 90 r of black on each side at 4:3.
  - A soft 24 r olive-950 shadow is the only addition.

**A4. Briefing title and body metrics** [measured on `C1_Mis_1_Briefing_3.png`]. These replace the §1.3 `brief-title` and `brief-body` rows.

| Style | Measured on the reference | New spec |
|---|---|---|
| brief-title | Line 1 ink y 29–77, line 2 y 85–123. The ascender/cap height is ≈ 38 r and the **line pitch is 56 r** | Anton sized so that the **cap height is 38 r** (≈ 44 r font-size), line-height 56 r. The old 34/32 was about 25% too small and too tight |
| brief-body | Glyph box 11–12 r, **pitch 17 r**, paragraph gap +17 r | Archivo Narrow 12 r / 17 r, paragraph spacing 17 r. The old 11/14 was too tight |

- **Case:** the title and header are **Title Case** ("Baptism / of Fire", "Mission 1", "Feb 20, 1941"). They are **not** upper-cased.
- **Drift to fix now in `styles/ui.css`:**
  - `.ui-briefing .title` has `text-transform: uppercase` and colour `--red-title` #b3160f. It must be `none` and `--brief-red` #ff0100;
  - `.kicker` is upper-cased with 0.2em tracking. It must be Title Case at normal tracking, white, 11 r.
- **Texture:** the right column is not flat black. The reference shows a faint relief texture and the watermark under the text. B3's M10 tooth plus the watermark must be visible at 3–5 L there too.

**A5. The title splash keeps its single frontal hero** (S03).
- The box art's power is **one man, facing the viewer, dead centre**. Putting five silhouettes behind him dilutes it into a generic ensemble poster.
- **Amendment:**
  - one hero, frontal, with his eyes to camera;
  - the pistol raised in a **ready position across the body**. That keeps the "direct address" without copying the aim-at-viewer composition;
  - the burning emplacement stays behind him;
  - the other five appear in S02 and S21, not here.

**A6. Front-end camo and badge** [seen zoom1-3].
- The reference camo reads **moss green**, not brown-olive. It has **pale-green pin-prick highlights** across the whole field, and the badge's *edge lines* read clearly at arm's length.
- **Amend M1:**
  - add a sparse speckle layer, 0.3% coverage, #6f7a4a at 60%;
  - bias the duotone highlight toward #56603a;
  - add a crisp 0.75 r highlight on the emblem's upper-left edges, on top of the soft normal-map shading. This is the "tin-plate" edge BEL had.

**A7. Recognition beats life: a salience test for B1.**
- The live diorama must never out-shout the badge.
- **Rule:** in a greyscale screenshot, the emblem must be the **largest salient shape** behind the card, and the diorama's luminance must stay within ±8 L of olive-800 after the scrim.
- Add this to the §6 contrast test, over the same 20 frames. A frame that fails lowers the diorama's mix, not the badge.

**A8. Mission-end button grammar** (S19).
- The fail rows `(R)ESTART MISSION (Q)UICK LOAD (L)OAD GAME` are invented. BEL's grammar is two short hotkeys.
- **Amend:**
  - **fail:** `(P)LAY AGAIN   (L)OAD GAME`, with `(Q)UICK LOAD` inserted between them **only when a quicksave exists**. It is never shown dimmed here, because an end card is not a list;
  - **escaped early:** `(C)ONTINUE   (P)LAY AGAIN`.

**A9. Placeholder names.**
- `RAZEEN NATHA` (S09, and menus.md) is a real player's save name taken from a video.
- Replace it with our own neutral examples, e.g. `BEFORE THE BRIDGE` or `DOCKS — 2ND TRY`, and never ship it in fixtures.

### B. Polish amendments (is it genuinely AAA-modern?)

**B1. Type: five families, not seven.**
- *Shadow Tactics* and *Desperados III* each run on about two faces, and the current mix will read as a font catalogue.
- **Drop IM FELL English SC.** Letterheads use Special Elite caps with +0.12em tracking, and newsreel intertitles use Staatliches.
- **Alfa Slab One ships only as the wordmark outlines**; it is not a webfont.
- **The final set** is Staatliches, Oswald, Anton, Archivo Narrow and Special Elite.
- **Cut the font budget** from 450 KB to **≤ 260 KB**, and preload only Staatliches and Oswald.

**B2. A material budget per screen.**
- Each screen gets **at most two hero materials** plus text. Brass is an accent at **≤ 3% of the screen area**.
- **At most one stamp animation per screen visit.**
- **Screen by screen:**

| Screen | Materials |
|---|---|
| MAIN | Camo + steel |
| Save/Load | Card + one print |
| Help | Paper + print. The leather appears only as the folder edge |
| Map table | Wood + paper. The lamp is lighting, not a material |

- This is how *Desperados III* and *Shadow Tactics* stay rich without clutter.

**B3. One focus language, with no jitter.**
- The current spec layers five cues: colour, weight 500→600, a +2 r nudge, a hairline and a tab.
- **Amend §1.6:**
  - **Keep** the colour change to cream, the brass hairline, and the tab (pad and keyboard only).
  - **Drop the +2 r nudge.**
  - **Drop the weight change on centred rows** (HotkeyButton, end cards, SlotRows). A variable-weight change re-measures the glyphs and makes centred text wobble. Use a 1 r cream `text-shadow` glow at 25% instead.
  - Left-aligned rows may keep the weight change.

**B4. Navigation must never wait for animation.**
- *CoH3* and *Origins* accept input on frame 0.
- **Amend §1.7:**
  - Rows are **interactive from the first frame** of a card transition.
  - Key presses during a transition are **buffered, not dropped**.
  - The row stagger totals **≤ 120 ms**, and it plays only on the first visit per session.
  - A card → sub-card change is **≤ 220 ms** end to end.
  - A screen change is 250 ms out and 250 ms in (not 400 + 400), unless it is hiding a load.
- Add a unit test: 5 queued ↓ presses during a card-in land on row 6.

**B5. CONTINUE without breaking the list.**
- Every reference title puts **Continue** first. Here it is three levels deep (NEW GAME → SINGLE PLAYER → BEHIND ENEMY LINES).
- **Amendment:** the bottom-left NameTape (S05) grows into a **"LAST OPERATION" PhotoPrint tab**:
  - a sepia thumbnail;
  - the mission name;
  - the rank;
  - `(C)ONTINUE` or pad Start.
- It sits **outside the BEL card**, so contract item 8 holds.
- **Hidden on first run.**
- **Keyboard:** C, or Tab from the list.

**B6. The Options detail pane.**
- *Desperados III* and *CoH3* explain every setting with text and a preview.
- **Amend S10:** each sub-card gets a right detail pane (the S09 geometry) containing:
  - a 2–3 line typed description;
  - a **preview print**, e.g. for CONE ALERT TINT, SELECTION RING, BLOOD, CENSORED MODE and QUALITY, using captured stills in `assets/ui/options/`;
  - "DEFAULT: X".
- **Also:**
  - Changed-from-default values get a small brass dot.
  - Each sub-card gets `(R)ESET TO DEFAULTS`.
  - Display changes such as FULL SCREEN and RESOLUTION SCALE get a **"KEEP THESE SETTINGS? 10…"** revert countdown card.

**B7. Use the width on widescreen.**
- The 4:3 content box leaves 16:9 detail panes cramped: Save/Load, Options and Help live in 640 r.
- **Amend §1.1:** on viewports ≥ 16:10, **detail panes and the S11 folder may extend into the side margins, up to 800 r of total width**. The *list column* stays at BEL's x 300, so the recognisable left half is unchanged.

**B8. Localisation-safe layout.** Pyro was a Spanish studio, and ES, DE, FR and IT are expected.
- Every row, value column and hotkey footer must survive **+35% text length**.
- The x 470 value column becomes `max(470 r, label width + 24 r)`.
- Long rows shrink to 92% tracking, then wrap to an item-sub. They never overflow.
- Hotkey letters come from the string table per locale, e.g. `(S)Í (N)O`.
- **Font subsets** add Latin Extended-A.
- Add a **pseudo-locale test** (+40% length, accented) to the visual-regression suite.

**B9. Saves: modern completeness, BEL face.**
- **Amend S09:** the LOAD card gets two tabs (LB/RB):
  - **SLOTS**, the default: BEL's 10 rows, unchanged;
  - **QUICK & AUTO**: the quicksave plus the last 3 autosaves, if autosave exists.
- Both tabs use the same detail pane.
- **Sort order is always the slot number** [orig]. The detail pane adds "PLAYED 1 H 12 MIN".

**B10. Audio polish.**
- **`ui.hover` becomes pitch-graded:** +1 semitone per row going down and −1 going up, over at most 3 steps. The menu then "plays" softly, as in *Shadow Tactics*.
- **The first input** on the title splash also unlocks the Web Audio context (the functional reason for PRESS ANY KEY on the web). It then starts the menu loop with a 600 ms fade, so the music never pops.

**B11. Debrief comparison.**
- Modern debriefs show progress, not just a result.
- **Amend S20:**
  - Next to each disc row, a faint **ghost disc** outline shows the **personal best**.
  - Beating the best adds a small typed "NEW BEST" tag.
  - This uses the choreography's existing slot, so no time is added.

**B12. Reduced-clutter defaults.**
- **Film grain:** 2.5%, not 3.5%.
- **The scrim drift** (2 r / 10 s) and **the emblem light sweep** are both kept, but the sweep period becomes 30 s. Two slow motions at once is the ceiling.
- **Title splash embers:** ≤ 30 sprites, not 60.
- Keep the **idle ambience count to 3 simultaneous loops** per screen: grain, one light and one camera or parallax.

### C. Updated checklist for the §6 recognisability review

Add these checks to the side-by-side review:
- The hotkey footer sits at y ≈ 452 r (A1).
- The oxblood map is readable (A2).
- The debrief is on black (A3).
- The briefing title's cap height is 38 r and the text is Title Case (A4).
- The greyscale salience test passes (A7).
- No screen exceeds 2 hero materials or 5 font families (B1, B2).
- Input during a transition is not dropped (B4).
