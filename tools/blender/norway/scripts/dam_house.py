"""Dam control / gate house (lukehus) on the crest of a 1920s-30s Norwegian hydro dam (M3 Sysendam): granite
ashlar plinth, rendered walls with granite quoins, tall segmental-arched steel-framed windows with small panes,
double doors under a granite surround, slate hip roof with a louvred ventilator lantern, gate-hoist gantry with
winch over the sluice slot, electrical insulators and cable pole, crest railings and lamp, Sperrgebiet sign.
Ground (z=0) = dam crest; the crest runs along X, reservoir on +Y, downstream face on -Y.
Variants: a = rendered light-ochre walls; b = bare board-formed concrete functionalist version with flat roof.
Usage: blender -b --python dam_house.py -- outdir a|b seed [snow]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nlib as N
from nlib import K, V, C

OUT, VAR, SEED, SNOW = N.args('dam_house')
name = 'dam_house_' + VAR + ('_snow' if SNOW else '')
K.begin(name, SEED, theater='snow' if SNOW else 'temperate', snow=SNOW)
r = K.rng()
L, W, H, T = (7.5, 5.2, 5.0, 0.5) if VAR == 'a' else (6.2, 5.6, 5.4, 0.45)
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = N.rect(x0, y0, x1, y1)
WALL = 'plaster_limewash' if VAR == 'a' else 'concrete_formwork'
WT = (0.98, 0.9, 0.74) if VAR == 'a' else None
if VAR == 'a':
    door = K.opening(poly, 0, L / 2, 1.6, 2.6, 0.3, T, 'segment', 'door')
    wins = [K.opening(poly, 0, 1.4, 1.1, 2.4, 1.2, T, 'segment'), K.opening(poly, 0, L - 1.4, 1.1, 2.4, 1.2, T, 'segment'),
            K.opening(poly, 2, 1.8, 1.1, 2.4, 1.2, T, 'segment'), K.opening(poly, 2, L - 1.8, 1.1, 2.4, 1.2, T, 'segment'),
            K.opening(poly, 1, W / 2, 1.1, 2.4, 1.2, T, 'segment'), K.opening(poly, 3, W / 2, 1.1, 2.4, 1.2, T, 'segment')]
else:                                        # Tyin-type lukehus: cube with one big machinery door + high strip windows
    door = K.opening(poly, 0, L / 2, 2.6, 3.3, 0.3, T, 'rect', 'door')
    wins = [K.opening(poly, 1, W / 2, 2.4, 0.7, 3.9, T), K.opening(poly, 3, W / 2, 2.4, 0.7, 3.9, T),
            K.opening(poly, 2, L / 2, 2.4, 0.7, 3.9, T), K.opening(poly, 0, L / 2, 2.2, 0.6, 4.2, T)]
kw = {'mat_tint': WT} if WT else {}
K.wall_ring(poly, H, T, WALL, [door] + wins, name='walls', plinth=('granite', 0.8, 0.06), **kw)
if VAR == 'a':
    K.quoins(poly, 0.8, H, 'granite')
    K.cornice(poly, H - 0.25, 'granite', steps=((0.06, 0.1), (0.14, 0.08), (0.22, 0.1)))
for k, f in enumerate(wins):
    K.window(f, 'fixed', (3, 6) if VAR == 'a' else (4, 1), frame=(0.3, 0.33, 0.32), recess=0.18,
             sill='granite' if VAR == 'a' else 'concrete_bunker', lintel='granite' if VAR == 'a' else None,
             curtain=0, streak=VAR == 'a', name='w%d' % k)
K.door(door, 'main', 'double', (0.28, 0.32, 0.3) if VAR == 'a' else (0.36, 0.42, 0.4), step='granite',
       surround='granite' if VAR == 'a' else None)
if VAR == 'b':                                # cantilevered concrete canopy + steel lintel over the big door
    bm = K.bm_new()
    K.box_bm(bm, (0, y0 - 0.6, 0.3 + 3.3 + 0.35), (3.6, 1.3, 0.18))
    K.part(bm, 'concrete_slab', name='door_canopy')
    bm = K.bm_new()
    K.box_bm(bm, (0, y0 - 0.03, 0.3 + 3.3 + 0.08), (2.9, 0.08, 0.16))
    K.part(bm, 'steel_painted', name='door_lintel', mat_tint=(0.4, 0.42, 0.4))
    N.weather_gradient(('walls',), 0.0, 2.0, low=(0.72, 0.72, 0.68), seed=SEED)
K.stairs((door.o.x, y0 - 1.2, 0), (0, 1, 0), 2.2, 0.3, 2, 'granite', name='steps')
if VAR == 'a':
    R = K.roof_hip(0, 0, L, W, H, 32, 'roof_slate', eave_oh=0.4, thick=0.12, fascia='wood_paint', gutters=True, sag=0.01)
    N.dress_roof(R, moss=0.45, guards=True, ridge=('roof_slate', (0.55, 0.56, 0.6)), rafters=False, seed=SEED)
    N.hip_caps(R)
    # ventilator lantern on the ridge
    bm = K.bm_new()
    K.box_bm(bm, (0, 0, R.z_ridge + 0.35), (1.0, 1.0, 0.9))
    K.part(bm, 'timber_grey', name='lantern_box', mat_tint=(0.75, 0.78, 0.74))
    bm = K.bm_new()
    for sx in (-1, 1):
        for i in range(5):
            z = R.z_ridge + 0.08 + i * 0.16
            K.beam_bm(bm, (sx * 0.52, -0.45, z), (sx * 0.52, 0.45, z + 0.08), 0.02, 0.1, up=(sx, 0, 0.6))
    K.part(bm, 'wood_paint', name='louvres', mat_tint=(0.6, 0.64, 0.6))
    K.roof_hip(0, 0, 1.2, 1.2, R.z_ridge + 0.8, 35, 'roof_slate', eave_oh=0.12, thick=0.05, fascia='timber_grey', gutters=False, ridge=None, name='lantern_roof')
    C.A.meta['roofs'].pop()
    K.chimney(x0 + 1.2, y1 - 1.1, H - 0.5, R.z_ridge - 0.2, 0.6, 0.6, 'brick_red', cap='granite', pots=0)
else:
    R = None
    K.roof_flat(poly, H + 0.25, 'concrete_bunker', parapet_h=0.5, parapet_t=0.25, parapet_mid='concrete_formwork',
                coping='concrete_slab', walkable=True, spouts=True)
    N.flat_roof_dress(poly, H + 0.25, 0.25, seed=SEED, hatch=(x1 - 1.2, y1 - 1.1), vents=[(-1.2, 0.6)],
                      drains=[(x0 + 0.6, y0 + 0.6), (x1 - 0.6, y0 + 0.6)],
                      cable=((x0 + 1.4, 1.0), (x0 + 0.25, 1.0), (-1, 0)), moss=0.0, dirt=1, seams=0.9)
    N.dam_b_detail(poly, x0, x1, y0, y1, H, T, door, SEED)
K.anchor('roof_ridge', (0, 0, (R.z_ridge if R else H + 0.5)))

# gate-hoist gantry over the sluice slot east of the house
gx = x1 + 3.0
bm = K.bm_new()
for sy in (-1.4, 1.4):
    K.ibeam_bm(bm, (gx - 1.2, sy, 0), (gx - 1.2, sy, 4.2), 0.3, 0.2, up=(1, 0, 0))
    K.ibeam_bm(bm, (gx + 1.2, sy, 0), (gx + 1.2, sy, 4.2), 0.3, 0.2, up=(1, 0, 0))
for sx in (-1.2, 1.2):
    K.ibeam_bm(bm, (gx + sx, -1.5, 4.2), (gx + sx, 1.5, 4.2), 0.35, 0.2)
K.ibeam_bm(bm, (gx - 1.3, 0, 4.4), (gx + 1.3, 0, 4.4), 0.3, 0.2)
K.part(bm, 'steel_painted', name='gantry', uv='beam', axis=(0, 0, 1))
bm = K.bm_new()
K.box_bm(bm, (gx, 0, 4.85), (1.4, 0.9, 0.6))                        # winch housing
K.cyl_bm(bm, (gx - 0.5, -0.6, 4.7), (gx + 0.5, -0.6, 4.7), 0.25, 14)  # rope drum
K.cyl_bm(bm, (gx + 0.75, 0, 4.85), (gx + 0.95, 0, 4.85), 0.35, 16)    # handwheel
for sx in (-0.6, 0.6):
    K.cyl_bm(bm, (gx + sx, -0.6, 4.4), (gx + sx, -0.6, 0.3), 0.02, 5)  # hoist chains to the gate
K.part(bm, 'cast_iron', name='winch', smooth=True)
bm = K.bm_new()
K.box_bm(bm, (gx, 0, 0.45), (2.2, 0.35, 0.9))                        # gate top in the slot
K.part(bm, 'steel_painted', name='sluice_gate', mat_tint=(0.7, 0.62, 0.55))
bm = K.bm_new()                                                      # slot kerbs
for sx in (-1.3, 1.3):
    K.box_bm(bm, (gx + sx, 0, 0.15), (0.35, 3.4, 0.3))
K.part(bm, 'granite', name='slot_kerbs')
K.footprint(N.rect(gx - 1.5, -1.7, gx + 1.5, 1.7), 'HIGH', 'gantry')
# crest railings (both faces) and a lamp standard
for sy in (-1, 1):
    K.railing((x0 - 3.5, sy * (W / 2 + 1.6), 0), (gx + 2.5, sy * (W / 2 + 1.6), 0), 1.1, 'pipe')
K.lamp_post((x0 - 2.0, -(W / 2 + 1.3), 0), 4.0)
# cable pole with insulators beside the west gable
bm = K.bm_new()
K.cyl_bm(bm, (x0 - 1.2, 1.0, 0), (x0 - 1.2, 1.0, 7.5), 0.14, 8, r1=0.11)
K.beam_bm(bm, (x0 - 1.2, 0.0, 7.0), (x0 - 1.2, 2.0, 7.0), 0.1, 0.12)
K.part(bm, 'timber_tarred', name='power_pole', uv='beam', axis=(0, 0, 1), smooth=True)
bm = K.bm_new()
for yy in (0.2, 1.0, 1.8):
    K.cyl_bm(bm, (x0 - 1.2, yy, 7.06), (x0 - 1.2, yy, 7.3), 0.06, 8, r1=0.035)
    K.cyl_bm(bm, (x0 - 1.2, yy, 7.28), (x0 - 0.05, yy * 0.5 + 0.5, H - 0.6), 0.008, 4)
K.part(bm, 'plaster_white', name='insulators', smooth=True, grime=0.1)
K.footprint_rect(x0 - 1.2, 1.0, 0.5, 0.5, 0, 'HIGH', 'pole')
K.sign((door.o.x + 1.6, y0 - 0.01, 1.8), (0, -1, 0), 0.9, 'halt_sperrgebiet')
for f in wins:                               # soft vertical rain streaks below the sills (no hard blotches)
    if f.n.y < -0.5:
        for dx_ in (-0.3, 0.3):
            K.decal('streak_rain', f.p(dx_, -0.55, 0.0), f.n, 0.45, 0.9, alpha=0.4)
if SNOW:
    N.snow()
K.finalize(os.path.join(OUT, name), ao_res=1024, ao_samples=48, recenter=False)
