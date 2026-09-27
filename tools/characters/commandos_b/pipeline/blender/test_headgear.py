import sys, os, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import body, measure, shell, preview, headgear
a = args()
spec = json.load(open(a[0])); outp = a[1]; types = a[2].split(',')
clean_scene()
h = body.calibrated_body(spec)
human, rig, parts = body.finalize_body(h, spec)
m, dom = measure.measure(human, rig, parts)
ctx = shell.BodyCtx(human, rig, dom, m)
preview.setup(res=(360, 360))
reps = []
for t in types:
    sp = dict(spec); sp['headgear'] = {'type': t, 'badge': t in ('beret', 'officer_cap')}
    if t == 'beret': sp['headgear'].update(spec.get('headgear', {}) if spec.get('headgear', {}).get('type') == 'beret' else {})
    ob, rep = headgear.build_headgear(ctx, parts, sp)
    reps.append(rep)
    c = (0, m['skull_center'][1], m['brow_top_z'] - 0.01)
    preview.shot(f'{outp}_{t}_f.png', c, 0.34, yaw_deg=0)
    preview.shot(f'{outp}_{t}_s.png', c, 0.34, yaw_deg=90)
    bpy.data.objects.remove(ob, do_unlink=True)
json.dump(reps, open(outp + '_fit.json', 'w'), indent=1)
