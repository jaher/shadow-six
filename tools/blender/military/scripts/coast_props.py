"""Atlantic Wall coast props (M14 set dressing; reusable on any German-held coast):
 minen       sign_minen        'Achtung Minen' board on a leaning timber stake, wire tie, weathered
 sperr       sign_sperrgebiet  'Halt! Sperrgebiet' board on two posts with a cross rail
 buoy        buoy_red          red can buoy (extraction marker): riveted float, cage, radar reflector, waterline grime
 pole        field_pole        field telephone pole: creosoted pole, cross arm, glass insulators, guy wire stake
Usage: blender -b --factory-startup --python coast_props.py -- [minen|sperr|buoy|pole] [seed]"""
import sys, os, math
sys.path.insert(0, '<claude-tmp>')
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('minen', 1470)
NAME = {'minen': 'sign_minen', 'sperr': 'sign_sperrgebiet', 'buoy': 'buoy_red', 'pole': 'field_pole'}[VAR]
K.begin(NAME, SEED, theater='coast')
r = K.rng()

if VAR == 'minen':
    lean = math.radians(r.uniform(4, 9))
    top = V((0, math.sin(lean) * 1.5, math.cos(lean) * 1.5))
    bm = bmesh.new()
    K.beam_bm(bm, V((0, 0, -0.2)), top, 0.08, 0.08)
    K.part(bm, 'timber_grey', name='stake', grime=0.6, bisect=False)
    K.sign(tuple(top - V((0, 0.06, 0.4))), (0, -1, 0), 0.95, kind='achtung_minen', board='timber_grey', name='minen_board')
    bm = bmesh.new()
    K.cyl_bm(bm, V((-0.05, -0.02, 1.0)), V((0.05, -0.02, 1.0)), 0.06, 6)
    K.part(bm, 'steel_galv', name='wire_tie', bisect=False, lod='drop')
    K.footprint([(-0.2, -0.2), (0.2, -0.2), (0.2, 0.2), (-0.2, 0.2)], 'NONE', 'sign')

elif VAR == 'sperr':
    bm = bmesh.new()
    for x in (-0.75, 0.75):
        K.beam_bm(bm, V((x, 0, -0.2)), V((x, 0, 1.75)), 0.1, 0.1)
    K.beam_bm(bm, V((-0.95, 0.05, 0.6)), V((0.95, 0.05, 0.6)), 0.08, 0.05)
    K.part(bm, 'timber_grey', name='posts', grime=0.6, bisect=False)
    K.sign((0, -0.07, 1.35), (0, -1, 0), 1.5, kind='halt_sperrgebiet', board='timber_grey', name='sperr_board')
    K.footprint([(-0.9, -0.2), (0.9, -0.2), (0.9, 0.2), (-0.9, 0.2)], 'NONE', 'sign')

elif VAR == 'buoy':
    bm = bmesh.new()
    K.cyl_bm(bm, V((0, 0, -0.5)), V((0, 0, 0.15)), 0.45, 20, r1=0.62)
    K.cyl_bm(bm, V((0, 0, 0.15)), V((0, 0, 0.75)), 0.62, 20, r1=0.5)
    K.part(bm, 'steel_painted', name='float', mat_tint=(0.72, 0.12, 0.08), smooth=True, grime=0.5, bisect=False)
    bm = bmesh.new()                                    # black boot-top band + waterline weed
    K.cyl_bm(bm, V((0, 0, -0.05)), V((0, 0, 0.16)), 0.6, 20, r1=0.625)
    K.part(bm, 'steel_painted', name='boot_top', mat_tint=(0.12, 0.12, 0.11), smooth=True, grime=0.8, bisect=False)
    bm = bmesh.new()                                    # cage of four uprights, top ring, radar reflector, lifting eyes
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        K.cyl_bm(bm, V((math.cos(a) * 0.42, math.sin(a) * 0.42, 0.72)), V((math.cos(a) * 0.12, math.sin(a) * 0.12, 1.9)), 0.025, 6)
    for i in range(12):
        a0, a1 = i * math.pi / 6, (i + 1) * math.pi / 6
        K.cyl_bm(bm, V((math.cos(a0) * 0.2, math.sin(a0) * 0.2, 1.55)), V((math.cos(a1) * 0.2, math.sin(a1) * 0.2, 1.55)), 0.02, 4)
    K.box_bm(bm, (0, 0, 1.95), (0.32, 0.02, 0.32))
    K.box_bm(bm, (0, 0, 1.95), (0.02, 0.32, 0.32))
    K.part(bm, 'steel_painted', name='cage', mat_tint=(0.7, 0.14, 0.1), grime=0.6, bisect=False)
    for k in range(4):
        a = k * math.pi / 2 + 0.3
        K.decal('streak_rust', (math.cos(a) * 0.6, math.sin(a) * 0.6, 0.45), (math.cos(a), math.sin(a), 0), 0.25, 0.5, alpha=0.6)
    K.footprint([(-0.6, -0.6), (0.6, -0.6), (0.6, 0.6), (-0.6, 0.6)], 'NONE', 'buoy')

elif VAR == 'pole':
    H = 6.5
    bm = bmesh.new()
    K.cyl_bm(bm, V((0, 0, -0.3)), V((0, 0, H)), 0.13, 10, r1=0.1)
    K.part(bm, 'timber_creosote', name='pole', smooth=True, grime=0.7, bisect=False)
    bm = bmesh.new()
    K.beam_bm(bm, V((-0.75, 0.0, H - 0.45)), V((0.75, 0.0, H - 0.45)), 0.1, 0.09)
    K.beam_bm(bm, V((-0.45, 0.0, H - 0.47)), V((0, 0.0, H - 1.1)), 0.04, 0.04)
    K.beam_bm(bm, V((0.45, 0.0, H - 0.47)), V((0, 0.0, H - 1.1)), 0.04, 0.04)
    K.part(bm, 'timber_grey', name='cross_arm', grime=0.6, bisect=False)
    bm = bmesh.new()
    for x in (-0.6, -0.25, 0.25, 0.6):
        K.cyl_bm(bm, V((x, 0, H - 0.4)), V((x, 0, H - 0.22)), 0.04, 8, r1=0.03)
    K.part(bm, 'glass_dirty', name='insulators', mat_tint=(0.55, 0.75, 0.7), smooth=True, bisect=False, lod='drop')
    K.anchor('wire_a', (-0.6, 0, H - 0.22), (0, -1, 0), kind='wire')
    K.anchor('wire_b', (0.6, 0, H - 0.22), (0, -1, 0), kind='wire')
    K.footprint([(-0.15, -0.15), (0.15, -0.15), (0.15, 0.15), (-0.15, 0.15)], 'NONE', 'pole')

M.finalize(M.outdir(K.A().name), ao_res=256, ao_samples=24)
