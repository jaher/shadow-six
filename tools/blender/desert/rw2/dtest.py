import sys, os
sys.path.insert(0, '<claude-tmp>')
import dz
from dz import K, C, V
OUT = dz.argv()[0]
K.begin('dtest', 1, theater='desert')
bm = dz.bmesh.new()
C.box_bm(bm, (0, 0.25, 1.5), (6, 0.5, 3))
K.part(bm, 'mud_render', name='wall')
K.decal('streak_long', (-2, -0.001, 1.8), (0, -1, 0), 0.8, 1.7, alpha=0.6)
dz.decal_dz('grime_a', (0, -0.001, 1.8), (0, -1, 0), 0.8, 1.7, alpha=0.6)
dz.decal_dz('dust_wash', (2, -0.001, 1.8), (0, -1, 0), 1.0, 1.0, alpha=0.6)
dz.finalize(OUT, ao_res=256, ao_samples=8)
