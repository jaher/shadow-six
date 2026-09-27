"""German wooden barracks in occupied Norway (RAD/Wehrmacht Mannschaftsbaracke, 1940-41) = reinforcement
building. Prefab hut on concrete piers with skirting, horizontal weatherboards, row of casement windows with plank
blackout shutters, entrance canopy + concrete steps, gable-end door, tar-paper roof with battens, stove pipes, fire
bucket rack, notice board and a FLAGPOLE with a Balkenkreuz banner (separate 'flag' node; no swastika, spec 10.6).
Variants: a = 16 x 7 m, brown creosoted boards (M1 timber_long); b = 12 x 6 m, field-grey paint;
          c = log_garrison 12 x 6 m, laft log walls (M2); suffix d = destroyed (blast holes, burnt, roof holes,
          rubble, pole snapped) e.g. ad, cd.
Usage: blender -b --python barracks.py -- outdir a|b|c|ad|bd|cd seed [snow]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nlib as N
from nlib import K, V, C

OUT, VAR, SEED, SNOW = N.args('barracks')
BASE, DEST = VAR[0], VAR.endswith('d') and len(VAR) > 1
name = 'barracks_' + VAR + ('_snow' if SNOW else '')
K.begin(name, SEED, theater='snow' if SNOW else 'temperate', snow=SNOW)
r = K.rng()
L, W = {'a': (16.0, 7.0), 'b': (12.0, 6.0), 'c': (12.0, 6.0)}[BASE]
ZF = 0.5 if BASE != 'c' else 0.3
ZE = ZF + 2.6
PITCH = 22 if BASE != 'c' else 26
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = N.rect(x0, y0, x1, y1)
zr = ZE + (W / 2) * math.tan(math.radians(PITCH))
T = 0.2 if BASE != 'c' else 0.24
CL, TI = {'a': ('siding', None), 'b': ('horiz', N.FIELDGREY), 'c': (None, None)}[BASE]

door = K.opening(poly, 0, L / 2 + (0 if BASE != 'a' else 0.0), 1.1, 2.1, ZF, T, 'rect', 'door')
gdoor = K.opening(poly, 3, W / 2, 1.0, 2.05, ZF, T, 'rect', 'door')
wins = []
nw = int((L - 1.5) / 2.2)
for i in range(nw):
    t = 0.75 + (L - 1.5) * (i + 0.5) / nw
    if abs(t - L / 2) > 1.0:
        wins.append(K.opening(poly, 0, t, 1.0, 1.25, ZF + 1.0, T))
    if abs(t - L / 2) > 0.2:
        wins.append(K.opening(poly, 2, t, 1.0, 1.25, ZF + 1.0, T))
wins.append(K.opening(poly, 1, W / 2, 1.0, 1.25, ZF + 1.0, T))
gw = [K.opening(poly, 1, W / 2, 0.6, 0.5, ZE + 0.25, T), K.opening(poly, 3, W / 2, 0.6, 0.5, ZE + 0.25, T)]
if BASE == 'c':
    if DEST:
        N.LOG_HOLES.extend([((x0 + L * 0.3, y0, ZF + 1.1), 1.9, (0, -1, 0)), ((x0 + L * 0.72, y1, ZF + 1.6), 1.5, (0, 1, 0)),
                            ((x1, 0.5, ZF + 1.8), 1.3, (1, 0, 0))])
    N.log_walls(x0, y0, x1, y1, ZF, ZE - ZF, 0.24, 'log_hewn', [door, gdoor] + wins + gw, ext=0.3, gable_x=(ZE, zr),
                tint=(0.56, 0.46, 0.37))
else:
    N.board_walls(poly, ZF, ZE - ZF, T, [door, gdoor] + wins, CL, TI)
    for e in (1, 3):
        N.board_gable(poly, e, ZE, zr, T, [gw[0 if e == 1 else 1]], CL, TI, name='gable%d' % e)
    N.corner_boards(poly, ZF, ZE, w=0.12, tint=(0.5, 0.45, 0.38) if BASE == 'a' else (0.55, 0.58, 0.52))
    # concrete piers + skirting boards under the sill
    bm = K.bm_new()
    for xx in [x0 + 0.2 + (L - 0.4) * i / int(L / 2.5) for i in range(int(L / 2.5) + 1)]:
        for yy in (y0 + 0.2, 0.0, y1 - 0.2):
            K.box_bm(bm, (xx, yy, ZF / 2 - 0.1), (0.4, 0.4, ZF + 0.2))
    K.part(bm, 'concrete_bunker', name='piers')
    bm = K.bm_new()
    import kit_arch as KA
    KA.ring_bm(bm, C.poly_offset(poly, -0.02), C.poly_offset(poly, -0.06), 0.0, ZF)
    bm = K.boolean_cut(bm, [door, gdoor])
    K.part(bm, 'timber_tarred', name='skirting', rot90=True)
    N.band(poly, ZF - 0.08, 0.14, 0.03, tint=(0.35, 0.3, 0.26), name='sill_board')
shc = (0.3, 0.36, 0.3) if BASE != 'b' else (0.36, 0.33, 0.3)
for k, f in enumerate(wins + gw):
    small = f.w < 0.8
    K.window(f, 'casement' if not small else 'single', (1, 3) if not small else (1, 2), frame='white', recess=0.06,
             sill='wood_paint', shutters=None if small else r.choice(['open', 'open', 'ajar', 'closed']),
             shutter_color=shc, shutter_style='plank', curtain=0.15, streak=False, name='w%d' % k)
K.door(door, 'main', 'plank', (0.35, 0.3, 0.26), step=None)
K.door(gdoor, 'gable', 'plank', (0.35, 0.3, 0.26), step=None)
if BASE != 'c':
    N.casing(door, w=0.1, crown=False, tint=(0.8, 0.8, 0.78), name='cas_door')
# entrance canopy + concrete steps
K.stairs((door.o.x, y0 - 0.25 - ZF / 0.17 * 0.28 - 0.9, 0), (0, 1, 0), 1.8, ZF, max(2, round(ZF / 0.17)), 'concrete_bunker', name='steps')
bm = K.bm_new()
K.box_bm(bm, (door.o.x, y0 - 0.55, ZF - 0.08), (2.0, 1.1, 0.16))
K.part(bm, 'concrete_bunker', name='landing')
R2 = K.roof_gable(door.o.x, y0 - 0.55, 1.3, 2.0, ZF + 2.45, 30, 'timber_tarred', rot=math.pi / 2, eave_oh=0.15, gable_oh=0.1,
                  thick=0.06, fascia='timber_beam', barge='timber_beam', gutters=False, name='canopy')
C.A.meta['roofs'].pop()
bm = K.bm_new()
for sx in (-1, 1):
    K.beam_bm(bm, (door.o.x + sx * 0.85, y0 - 0.02, ZF + 1.7), (door.o.x + sx * 0.85, y0 - 1.1, ZF + 2.4), 0.08, 0.1)
K.part(bm, 'timber_beam', name='canopy_brackets', uv='beam', axis=(0, 1, 0))
K.stairs((gdoor.o.x - 1.0 - ZF / 0.17 * 0.28, 0, 0), (1, 0, 0), 1.2, ZF, max(2, round(ZF / 0.17)), 'concrete_bunker', name='gsteps')

# roof: tar paper with battens
# a/c: Leistendach (felt rolls run eave->ridge between battens: battens one direction only, no cross laps);
# b: plain Pappdach laid in horizontal rolls parallel to the eave, NO battens, ridge roll strip -> distinct roof
RM = {'a': ('tar_paper_batten', (0.95, 0.93, 0.9)), 'b': ('tar_paper', (1.0, 0.97, 0.9)), 'c': ('tar_paper_batten', (0.88, 0.9, 0.92))}[BASE]
R = K.roof_gable(0, 0, L, W, ZE, PITCH, RM[0], eave_oh=0.3, gable_oh=0.3, thick=0.1, fascia='timber_beam',
                 barge='timber_beam', gutters=BASE == 'a' and not DEST, sag=0.03, wobble=0.01)
for _o in R.parts:
    if 'slope' in _o.name and _o.data.materials:
        _o.data.materials[0] = K.mat(RM[0], RM[1])
if BASE != 'b':
    N.roof_battens(R, spacing=0.9 if BASE == 'a' else 1.0)
else:
    N.ridge_cap(R, 'tar_paper', (0.7, 0.68, 0.64))
N.roof_weather(R, moss=0.1, streaks=0.8, seed=SEED)
N.tar_patches(R, n=2, seed=SEED)
for vx in ([-L / 2 + 2.5, L / 2 - 2.5] if L > 13 else [L / 2 - 2.2]):
    N.ridge_vent(R, vx)
for xx in ([-L / 4, L / 4] if L > 13 else [-L / 5, L / 4]):
    N.stovepipe(xx, 0.8, ZE, R.z_ridge + 0.4)
K.anchor('roof_ridge', (0, 0, R.z_ridge))

# fire bucket rack + notice board beside the door
bm = K.bm_new()
K.box_bm(bm, (door.o.x + 2.3, y0 - 0.06, ZF + 1.6), (1.2, 0.05, 0.08))
K.box_bm(bm, (door.o.x - 1.6, y0 - 0.05, ZF + 1.5), (0.9, 0.04, 0.7))
K.part(bm, 'timber_beam', name='rack_board')
bm = K.bm_new()
for k in range(3):
    bx = door.o.x + 1.9 + k * 0.4
    K.cyl_bm(bm, (bx, y0 - 0.2, ZF + 1.15), (bx, y0 - 0.2, ZF + 1.5), 0.12, 10, r1=0.14)
K.part(bm, 'wood_paint', name='fire_buckets', mat_tint=(0.85, 0.12, 0.1), smooth=True, grime=0.3)
K.decal('poster_de', (door.o.x - 1.6, y0 - 0.08, ZF + 1.5), (0, -1, 0), 0.7, 0.55, alpha=0.95)

# flagpole with the Balkenkreuz banner (reinforcement marker)
fx, fy = x0 + 1.6, y0 - 3.2
if DEST:
    bm = K.bm_new()                                   # snapped pole stump + fallen top
    K.cyl_bm(bm, (fx, fy, 0), (fx, fy, 2.1), 0.085, 10, r1=0.075)
    K.cyl_bm(bm, (fx + 0.2, fy - 0.1, 0.1), (fx + 4.8, fy - 1.6, 0.06), 0.07, 8, r1=0.05)
    K.part(bm, 'wood_paint', name='flagpole_broken', uv='beam', axis=(0, 0, 1), smooth=True)
    K.footprint_rect(fx, fy, 0.8, 0.8, 0, 'HIGH', 'flagpole')
else:
    N.flagpole((fx, fy), 7.5, heading=(1, 0, 0))
# drainage: duckboards along the front wall, gravel strip + splash dirt along the others
if not DEST:
    N.duckboards(x0 + 0.3, door.o.x - 1.2, y0 - 0.55, 0.7)
N.duckboards(door.o.x + 1.2, x1 - 0.3, y0 - 0.55, 0.7)
N.gravel_strip(poly, 0.45)
for (cx, cy, nx, ny, span) in ((0, y0 - 0.05, 0, -1, L), (0, y1 + 0.05, 0, 1, L)):
    for k in range(4):
        t = (k + 0.5) / 4 - 0.5
        K.decal('dirt_splash', (cx + t * span, cy, ZF + 0.25), (nx, ny, 0), span / 4 * 1.05, 0.6, alpha=0.55)

if DEST:
    CM = {'a': ('timber_siding', None), 'b': ('wood_paint', N.FIELDGREY), 'c': ('log_hewn', (0.56, 0.46, 0.37))}[BASE]
    bx1 = x0 + L * 0.3
    N.blast((bx1, y0, ZF + 1.1), 1.9, (0, -1, 0), seed=SEED, floor=0.0, clad_mid=CM[0], clad_tint=CM[1] or (0.8, 0.7, 0.6))
    N.blast((x0 + L * 0.72, y1, ZF + 1.6), 1.5, (0, 1, 0), seed=SEED + 1, clad_mid=CM[0], clad_tint=CM[1] or (0.8, 0.7, 0.6))
    N.blast((x1, 0.5, ZF + 1.8), 1.3, (1, 0, 0), seed=SEED + 2, board_dir=(0, 1, 0), clad_mid=CM[0], clad_tint=CM[1] or (0.8, 0.7, 0.6))
    N.sag_roof(R, (bx1, y0 + 1.6), 2.3, depth=0.75, seed=SEED)
    N.sag_roof(R, (x0 + L * 0.72, y1 - 1.4), 1.6, depth=0.45, holes=False, seed=SEED + 3)   # N slope: sag only (no dark bits over the ridge)
    # charred floor + fallen interior junk visible through the holes
    bm = K.bm_new()
    K.box_bm(bm, (0, 0, ZF - 0.05), (L - 0.5, W - 0.5, 0.1))
    K.part(bm, 'deck_planks', name='floor_burnt', uv='beam', axis=(1, 0, 0), mat_tint=(0.3, 0.27, 0.24))
    N.debris((bx1, y0 - 1.3, 0), 2.0, 0.7, 'timber', clad=CM, seed=SEED, stovepipe=True)
    N.debris((x0 + L * 0.72, y1 + 1.1, 0), 1.5, 0.5, 'timber', clad=CM, seed=SEED + 5, name='debris2')
    N.debris((bx1 + 0.3, y0 + 1.6, ZF), 1.4, 0.5, 'timber', clad=CM, seed=SEED + 9, name='debris_in', footprint=False)
    # the entrance canopy took the blast: it hangs from one bracket, twisted down
    import bpy
    from mathutils import Matrix
    M = Matrix.Translation(V((door.o.x + 1.0, y0, ZF + 2.4))) @ Matrix.Rotation(math.radians(-24), 4, V((0.3, 1, 0)).normalized()) \
        @ Matrix.Rotation(math.radians(-14), 4, 'X') @ Matrix.Translation(-V((door.o.x + 1.0, y0, ZF + 2.4)))
    for ob in list(C.A.parts):
        if ob.name.startswith('canopy') and ob.name in bpy.data.objects:
            ob.data.transform(M)
    K.scorch_openings(1.0, prob=0.5)
    N.char_blasts(0.92, 2.4, 0.2)
C.A.meta['notes'].append('reinforcement building: flag anchor = marker' + ('; DESTROYED variant' if DEST else ''))
if SNOW:
    N.snow(icicles=not DEST, min_area=0.1 if DEST else 0.06, res=1.4 if DEST else 1.0)
K.finalize(os.path.join(OUT, name), ao_res=1024, ao_samples=48, recenter=False)
