import sys, os, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import body, measure, shell, outfits, preview, kit
a = args()
spec = json.load(open(a[0])); outp = a[1]
t = time.time(); clean_scene()
h = body.calibrated_body(spec)
human, rig, parts = body.finalize_body(h, spec)
m, dom = measure.measure(human, rig, parts)
ctx = shell.BodyCtx(human, rig, dom, m)
garments = outfits.build_outfit(ctx, spec['outfit'], spec.get('outfit_opts', {}))
kit.build_kit(ctx, garments, spec)
shell.delete_covered(ctx)
log('build time', round(time.time() - t, 1), 'body tris', tri_count(human))
preview.setup()
H = m['height']
for yaw in (0, 90, 180):
    preview.shot(f'{outp}_y{yaw}.png', (0, 0, H / 2), H * 1.08, yaw_deg=yaw)
bpy.ops.wm.save_as_mainfile(filepath=outp + '.blend')
