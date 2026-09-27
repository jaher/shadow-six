"""Append Norway-group notes to every <asset>.credits.json (run after all builds)."""
import json, glob, os
O = '<claude-tmp>'
for f in glob.glob(O + '/*/*.credits.json'):
    n = os.path.basename(f).replace('.credits.json', '')
    j = json.load(open(f))
    S = ['house_timber', 'naust', 'barn', 'log_cabin', 'fishing_shed', 'drying_rack', 'barracks', 'guard_hut', 'radar_dish',
         'radar_building', 'dam_house', 'cable_station', 'cable_car']
    sc = next(x for x in S if n.startswith(x))
    notes = ['Geometry: procedural Blender script norway/scripts/%s.py (SHADOW SIX Norway group, own work, CC0).' % sc]
    if n.startswith('barracks'):
        notes.append('Flag: Balkenkreuz banner built as own-work geometry + vertex colours (no texture, no swastika / SS runes; spec 10.6).')
    if n.startswith('guard_hut_b'):
        notes.append('Sentry box chevrons: own-work vertex colours.')
    notes.append('Rework 1 (art director pass): shared helpers norway/scripts/nfx.py; procedural textures '
                 'roof_pantile_black, tar_paper, turf_grass (from Poly Haven sparse_grass, CC0), log_hewn, board_batten, '
                 'mesh_screen made by norway/tools/make_nor_tex.py (own work, CC0).')
    notes.append('Rework 2 (art director pass 2): helpers norway/scripts/nfx2.py (+ sentry_box.py); procedural textures '
                 'tar_paper_batten, weatherboard_paint, boards_weathered, paint_metal and the re-laid roof_pantile_black '
                 'made by norway/tools/make_nor_tex2.py (own work, CC0). All other maps: see "textures" (CC0).')
    notes.append('Reference photos (internal comparison only, not shipped): scratchpad/art/refs/norway/refs.md (Wikimedia Commons).')
    j['norway_notes'] = notes
    json.dump(j, open(f, 'w'), indent=1)
print('ok')
