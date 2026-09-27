import bpy, collections
cnt = collections.Counter()
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    me = o.data
    key = (tuple((a.name, a.domain, a.data_type) for a in me.color_attributes), me.color_attributes.active_color_name if me.color_attributes.active_color else None, me.color_attributes.render_color_index)
    cnt[key] += 1
    if o.name in ('main', 'decals') or cnt[key] == 1: print('OB', o.name, key)
print(len(cnt))
