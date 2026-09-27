# retrack.py - regenerate the procedural track textures of every tracked asset (blender -b --python retrack.py)
import sys, os, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as V
for d in glob.glob(os.path.join(V.VROOT, 'out', '*', 'tex')):
    for style in ('kgs', 'zpw'):
        if glob.glob(os.path.join(d, f'track_{style}_*_albedo.jpg')):
            for var in V.VARIANTS:
                V.make_track_tex(style, var, os.path.join(d, f'track_{style}_{var}'))
            print('retracked', d, style)
