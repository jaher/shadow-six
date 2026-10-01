"""Atlantic Wall concrete quarters (M14 garrisons and outbuildings; Organisation Todt standard types):
 2st        barracks_concrete_2st  12 x 8 m, two storeys, flat walkable roof at 6.0 m behind a 0.45 m parapet, door W,
            outside concrete stair up the E wall to a first-floor door, steel-shuttered windows, stove pipes, aerial
 1st        barracks_concrete_1st   9 x 6 m, one storey, roof 4.0 m, door S (front), shuttered windows, stove pipe
 shed       shed_concrete           6 x 5 m stores shed, roof 3.0 m, plank door N (rear), one barred window
 blockhouse blockhouse_small      5.5 x 5.5 m MG blockhouse, 2.5 m, thick walls, MG loopholes on three faces, L-shaped
            entrance with blast wall S, sod on the roof slab, periscope
Footprint = the walls (gameplay rect); front = Blender -Y = game +z (local south).
Usage: blender -b --factory-startup --python barracks_concrete.py -- [2st|1st|shed|blockhouse] [seed]"""
import sys, os, math
sys.path.insert(0, '<claude-tmp>')
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('2st', 1450)
NAME = {'2st': 'barracks_concrete_2st', '1st': 'barracks_concrete_1st', 'shed': 'shed_concrete', 'blockhouse': 'blockhouse_small'}[VAR]
K.begin(NAME, SEED, theater='coast')
r = K.rng()
CFG = {'2st': (6.0, 4.0, 6.0, 0.35), '1st': (4.5, 3.0, 4.0, 0.3), 'shed': (3.0, 2.5, 3.0, 0.25), 'blockhouse': (2.75, 2.75, 2.5, 0.8)}[VAR]
HW, HD, ZR, T = CFG
CT = (0.86, 0.86, 0.83)
SHUT = (0.36, 0.4, 0.33)
poly = [(-HW, -HD), (HW, -HD), (HW, HD), (-HW, HD)]       # edges: 0 S(front) 1 E 2 N(rear) 3 W


def win(edge, t, z, w=1.1, h=1.3, shut='open'):
    return K.opening(poly, edge, t, w, h, z, T)


def dress_windows(frames, shutters='open'):
    for f in frames:
        K.window(f, 'casement', (1, 3), frame=(0.42, 0.45, 0.38), sill='concrete_bunker', lintel=None, surround=None,
                 shutters=shutters, shutter_color=SHUT, shutter_style='plank', curtain=0.3, bars=VAR == 'shed', name='win')


if VAR in ('2st', '1st', 'shed'):
    L, D = 2 * HW, 2 * HD
    doors, wins = [], []
    if VAR == '2st':
        doors.append(('main', K.opening(poly, 3, HD, 1.2, 2.2, 0.0, T, 'rect', 'door')))      # W door (layout door 180)
        doors.append(('upper', K.opening(poly, 1, 2.0, 1.0, 2.1, 3.05, T, 'rect', 'door')))   # E first-floor door
        for z in (0.95, 3.95):
            wins += [win(0, t, z) for t in (1.8, 4.6, 7.4, 10.2)]
            wins += [win(2, t, z) for t in (1.8, 6.0, 10.2)]
        wins += [win(3, 1.4, 3.95, 0.9), win(3, D - 1.4, 3.95, 0.9), win(1, D - 1.5, 0.95, 0.9)]
    elif VAR == '1st':
        doors.append(('main', K.opening(poly, 0, HW, 1.2, 2.2, 0.0, T, 'rect', 'door')))
        wins += [win(0, t, 0.95) for t in (1.6, L - 1.6)] + [win(2, t, 0.95) for t in (2.0, L / 2, L - 2.0)]
        wins += [win(1, D / 2, 0.95, 0.9), win(3, D / 2, 0.95, 0.9)]
    else:
        doors.append(('main', K.opening(poly, 2, HW, 1.6, 2.2, 0.0, T, 'rect', 'door')))      # N door (layout)
        wins += [win(0, HW, 1.2, 0.8, 0.7)]
    K.wall_ring(poly, ZR - 0.25, T, 'concrete_board', [f for _, f in doors] + wins, plinth=('concrete_bunker', 0.4, 0.04), name='walls')
    for did, f in doors:
        K.door(f, did, 'plank', (0.34, 0.37, 0.3), step='concrete_bunker', node='door_' + did)
    dress_windows(wins, 'open' if VAR != 'shed' else None)
    if VAR == '2st':
        K.course(poly, 3.0, 0.18, 0.06, 'concrete_bunker', name='floor_band')
    K.roof_flat(poly, ZR, mid='concrete_bunker', parapet_h=0.45 if VAR == '2st' else 0.3, parapet_t=0.25, parapet_mid='concrete_board',
                coping='concrete_bunker', slab_t=0.3, walkable=True, spouts=True, name='roof')

if VAR == '2st':                                         # outside stair along the E wall up to the first-floor door
    K.stairs((HW + 0.48, HD - 0.2, 0.0), (0, -1, 0), 0.9, 3.0, mid='concrete_bunker', solid=True, name='stair_e', meta=False)
    bm = bmesh.new()
    M.chamfer_block(bm, HW + 0.02, -HD + 0.9, HW + 0.95, HD - 0.2 - 17 * 0.28 + 0.05, 2.8, 3.02, ch=0.03)
    M.conc_part(bm, 'landing', 'concrete_bunker', CT)
    K.railing((HW + 0.92, HD - 0.3, 0.2), (HW + 0.92, -HD + 0.95, 3.02), 0.95, style='pipe')
    bm = bmesh.new()                                     # drainpipe down the S wall (the GB's climb), stove pipes, aerial
    K.cyl_bm(bm, (0.9, -HD - 0.1, 0.1), (0.9, -HD - 0.1, ZR + 0.3), 0.055, 8)
    for z in (1.0, 2.5, 4.0, 5.4):
        K.box_bm(bm, (0.9, -HD - 0.05, z), (0.16, 0.1, 0.04))
    for x, y in ((-3.6, 2.4), (2.8, 2.4)):
        K.cyl_bm(bm, (x, y, ZR), (x, y, ZR + 1.3), 0.08, 8)
        K.cyl_bm(bm, (x, y, ZR + 1.3), (x, y, ZR + 1.4), 0.15, 8)
    K.cyl_bm(bm, (-HW + 0.5, HD - 0.5, ZR), (-HW + 0.5, HD - 0.5, ZR + 5.5), 0.035, 6)
    K.part(bm, 'steel_painted', name='pipes', mat_tint=(0.38, 0.38, 0.36), grime=0.8, bisect=False)
    K.sign((-HW - 0.02, HD - 1.4, 2.4), (-1, 0, 0), 0.9, kind='kommandantur', name='unit_sign')
elif VAR in ('1st', 'shed'):
    bm = bmesh.new()
    K.cyl_bm(bm, (HW - 0.8, HD - 0.6, ZR), (HW - 0.8, HD - 0.6, ZR + 1.1), 0.08, 8)
    K.cyl_bm(bm, (HW - 0.8, HD - 0.6, ZR + 1.1), (HW - 0.8, HD - 0.6, ZR + 1.18), 0.15, 8)
    K.part(bm, 'steel_painted', name='pipes', mat_tint=(0.38, 0.38, 0.36), grime=0.8, bisect=False)
    if VAR == 'shed':                                    # jerrycans and a fuel funnel by the door, tarp on the roof
        bm = bmesh.new()
        for i in range(4):
            K.box_bm(bm, (-1.6 + i * 0.4, HD + 0.35, 0.24), (0.17, 0.36, 0.48))
        K.part(bm, 'steel_painted', name='jerrycans', mat_tint=(0.4, 0.44, 0.3), grime=0.6, bisect=False, lod='drop')

if VAR == 'blockhouse':                                  # thick-walled MG blockhouse
    bm = bmesh.new()
    M.chamfer_block(bm, -HW, -HD, HW, HD, -0.1, ZR - 0.5, ch=0.15, top_ch=False)
    body = M.conc_part(bm, 'body', 'concrete_board', CT)
    K.cut_object(body, M.cutter_box(-HW + T, -HD + T, 0.0, HW - T, HD - T, ZR - 0.7))
    for (cx, cy, nx, ny) in ((0, -HD, 0, -1), (-HW, 0.4, -1, 0), (HW, 0.4, 1, 0)):   # stepped MG loopholes
        c = bmesh.new()
        rings = []
        for k, (w, h) in enumerate(((1.2, 0.5), (0.8, 0.36), (0.4, 0.22))):
            o = V((cx, cy, 1.25)) - V((nx, ny, 0)) * (k * T / 2 - 0.15)
            sx = V((ny, -nx, 0)) if ny else V((0, 1, 0))
            rings.append([o - sx * w / 2 - V((0, 0, h / 2)), o + sx * w / 2 - V((0, 0, h / 2)), o + sx * w / 2 + V((0, 0, h / 2)), o - sx * w / 2 + V((0, 0, h / 2))])
        K.loft_bm(c, rings)
        bmesh.ops.recalc_face_normals(c, faces=c.faces)
        K.cut_object(body, c)
    K.cut_object(body, M.cutter_box(HW - T - 0.1, -HD - 0.2, 0.0, HW - 0.3 + 0.2, -HD + 1.5, 2.0))   # entrance passage (SE)
    bm = bmesh.new()
    M.chamfer_block(bm, -HW - 0.2, -HD - 0.2, HW + 0.2, HD + 0.2, ZR - 0.5, ZR, ch=0.1)
    roof = M.conc_part(bm, 'roof', 'concrete_bunker', CT)
    bm = bmesh.new()
    K.box_bm(bm, (0, 0, 1.0), (2 * HW - 2 * T, 2 * HD - 2 * T, 0.04))
    K.box_bm(bm, (0, 0, 1.25), (2 * HW - 0.3, 2 * HD - 0.3, 0.4))
    K.part(bm, 'interior_dark', name='dark', grime=0, bisect=False)
    bm = bmesh.new()                                     # L blast wall in front of the entrance
    M.chamfer_block(bm, HW - 1.9, -HD - 1.5, HW + 0.2, -HD - 1.0, -0.1, 2.0, ch=0.05)
    M.conc_part(bm, 'blast_wall', 'concrete_board', CT)
    bm = bmesh.new()                                     # MG 34 barrel in the front loophole, periscope on the roof
    K.cyl_bm(bm, (0.1, -HD + 0.9, 1.2), (0.1, -HD - 0.25, 1.22), 0.03, 8)
    K.cyl_bm(bm, (0.1, -HD + 0.3, 1.2), (0.1, -HD - 0.05, 1.21), 0.05, 8)
    K.cyl_bm(bm, (-1.0, 0.8, ZR), (-1.0, 0.8, ZR + 0.5), 0.08, 8)
    K.box_bm(bm, (-1.0, 0.75, ZR + 0.55), (0.18, 0.26, 0.12))
    K.part(bm, 'steel_painted', name='mg_periscope', mat_tint=(0.3, 0.32, 0.3), bisect=False)
    bm = bmesh.new()                                     # sod laid on the roof slab (thin: rounded off at the rim)
    K.box_bm(bm, (0, 0, ZR + 0.06), (2 * HW + 0.1, 2 * HD + 0.1, 0.12))
    M.planar_uv(K.part(bm, 'sod', name='roof_sod', grime=0.3, bisect=False), 'sod')
    K.door_meta('main', (HW - 0.6, -HD, 0.0), (0, -1, 0), 0.9, 1.95, kind='bunker_door', node=None)

# ------------------------------------------------------------------ weathering: rain streaks, damp base, salt, lichen
faces = (((0, -1, 0), (0, -HD - 0.006), 2 * HW), ((0, 1, 0), (0, HD + 0.006), 2 * HW), ((-1, 0, 0), (-HW - 0.006, 0), 2 * HD), ((1, 0, 0), (HW + 0.006, 0), 2 * HD))
for nrm, (cx, cy), w in faces:
    n = max(2, int(w / 2.2))
    for k in range(n):
        t = (k + r.uniform(0.2, 0.8)) / n - 0.5
        p = (cx + (t * w if nrm[0] == 0 else 0), cy + (t * w if nrm[1] == 0 else 0), ZR - 0.9)
        K.decal(r.choice(['streak_long', 'streak_rain', 'streak_rust', 'efflorescence']), p, nrm, r.uniform(0.5, 1.0), 1.5, alpha=0.5)
    K.decal('damp_base', (cx, cy, 0.4), nrm, w * 0.95, 0.75, alpha=0.7)
    K.decal(r.choice(['lichen', 'moss_patch', 'crack']), (cx + (r.uniform(-0.3, 0.3) * w if nrm[0] == 0 else 0), cy + (r.uniform(-0.3, 0.3) * w if nrm[1] == 0 else 0), 0.9),
            nrm, 1.1, 0.8, alpha=0.55)
for i in range(4 if VAR != 'blockhouse' else 0):
    K.decal(r.choice(['stain_blotch', 'moss_patch', 'lichen']), (r.uniform(-HW + 0.8, HW - 0.8), r.uniform(-HD + 0.8, HD - 0.8), ZR + 0.004), (0, 0, 1),
            r.uniform(0.9, 1.6), r.uniform(0.7, 1.2), up=(0, 1, 0), alpha=0.45)

if VAR == 'blockhouse':
    K.footprint(poly, 'HIGH', 'bunker')
    K.roof_meta(poly, ZR + 0.12, walkable=False, kind='roof')
M.finalize(M.outdir(K.A().name), ao_res=1024 if VAR == '2st' else 768, ao_samples=40)
