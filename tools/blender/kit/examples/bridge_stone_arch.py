"""Example: three-arch masonry road bridge (Normandy / Europe, 18th-19th c.): segmental arches with dressed voussoirs,
piers with pointed upstream + rounded downstream cutwaters and starlings, pilasters, rubble spandrels, string course,
parapets with limestone coping and end piers, cambered cobbled deck with granite kerbs, cast-iron lamps,
splayed wing walls, waterline staining. Usage: blender -b --factory-startup --python bridge_stone_arch.py -- [outdir] [seed]"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'blender'))
import kit as K
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'bridge_stone_arch')
SEED = int(argv[1]) if len(argv) > 1 else 5
WATER = -5.4
K.begin('bridge_stone_arch', SEED, theater='temperate', water_level=WATER)
B = K.stone_arch_bridge(spans=((10, 4.4), (12, 5.3), (10, 4.4)), water=WATER, bed=-8.0, spring=-5.1, camber=1.3)
D = B['deck']
for x, kind in ((B['x0'] + 1.6, 'pont'), (B['x1'] - 1.6, 'brucke_12t')):
    K.sign((x, 7.6 / 2 - 0.45, D.z(x) + 0.55), (0, -1, 0), 1.3 if kind == 'pont' else 0.9, kind, 'ashlar_limestone' if kind == 'pont' else 'timber_grey')
K.finalize(OUT, ao_res=1024, ao_samples=64, lods=((0.45, 0.30, 3.0), (0.3, 0.9, 3.0)))
