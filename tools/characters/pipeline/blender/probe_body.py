import sys, os, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import body
spec = json.load(open(args()[0]))
t=time.time(); clean_scene()
h = body.calibrated_body(spec)
human, rig, parts = body.finalize_body(h, spec)
log('time', round(time.time()-t,1))
for o in bpy.data.objects:
    if o.type=='MESH': log('MESH', o.name, 'tris', tri_count(o), 'mods', [m.type for m in o.modifiers], 'mats', [m.name for m in o.data.materials if m], 'parent', o.parent.name if o.parent else None, 'loc', tuple(o.location))
log('vgroups', [g.name for g in human.vertex_groups if not g.name.startswith(('joint-','helper-'))][:200])
# per dominant bone face counts (visible body only)
dom = body.dominant_bone(human) if hasattr(body,'dominant_bone') else dominant_bone(human)
bodyvg = human.vertex_groups['body'].index
vis = set(v.index for v in human.data.vertices if any(g.group==bodyvg and g.weight>0.5 for g in v.groups))
from collections import Counter
c = Counter()
for p in human.data.polygons:
    if all(i in vis for i in p.vertices): c[dom[p.vertices[0]]] += len(p.vertices)-2
log('tris by bone', sorted(c.items(), key=lambda x:-x[1]))
log('uv layers', [u.name for u in human.data.uv_layers])
bpy.ops.wm.save_as_mainfile(filepath='<claude-tmp>')
