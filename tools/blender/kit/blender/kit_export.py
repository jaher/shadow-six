"""Kit export: AO bake (UV1), LODs, GLB export + library material rewrite, sidecar JSON."""
import bpy, bmesh, math, os, json, time, sys
from mathutils import Vector as V
import kit_core as C

sys.path.insert(0, os.path.join(C.KIT, 'tools'))


def _select(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def part_size(o):
    bb = [o.matrix_world @ V(c) for c in o.bound_box]
    return max((max(p[i] for p in bb) - min(p[i] for p in bb)) for i in range(3))


def unwrap_ao(objs, margin=0.006):
    """Second UV layer 'AO' (TEXCOORD_1) packed across all given objects."""
    for o in objs:
        uvs = o.data.uv_layers
        if 'AO' not in uvs:
            uvs.new(name='AO')
        uvs.active = uvs['AO']
    _select(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers['UVMap']


def _setup_cycles(samples):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    dev = os.environ.get('BAKE_DEVICE', 'AUTO')
    try:
        pref = bpy.context.preferences.addons['cycles'].preferences
        for api in ('OPTIX', 'CUDA'):
            try:
                pref.compute_device_type = api
                pref.get_devices()
                if any(d.type == api for d in pref.devices) and dev != 'CPU':
                    for d in pref.devices:
                        d.use = d.type == api
                    sc.cycles.device = 'GPU'
                    C.log('bake on GPU', api)
                    return
            except Exception:
                pass
    except Exception:
        pass
    sc.cycles.device = 'CPU'
    C.log('bake on CPU')


def bake_ao(objs, res=1024, samples=96, dist=2.0, out=None):
    """Bake ambient occlusion (with a temporary ground plane) to UV 'AO'. Returns the image path."""
    t0 = time.time()
    _setup_cycles(samples)
    bpy.context.scene.world = bpy.context.scene.world or bpy.data.worlds.new('W')
    img = bpy.data.images.new('ao_bake', res, res, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, -0.005))
    ground = bpy.context.active_object
    added = []
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers['AO']
        for m in o.data.materials:
            if m and m.name not in added:
                n = m.node_tree.nodes.new('ShaderNodeTexImage')
                n.image = img
                n.name = 'AO_BAKE'
                m.node_tree.nodes.active = n
                added.append(m.name)
    _select(objs)
    bpy.context.scene.cycles.bake_type = 'AO'
    bpy.context.scene.world.light_settings.distance = dist
    bpy.context.scene.render.bake.margin = 6
    bpy.ops.object.bake(type='AO', margin=6, use_clear=True)
    out = out or os.path.join(bpy.app.tempdir, 'ao.png')
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers['UVMap']
        for m in o.data.materials:
            if m and 'AO_BAKE' in m.node_tree.nodes:
                m.node_tree.nodes.remove(m.node_tree.nodes['AO_BAKE'])
    bpy.data.objects.remove(ground)
    C.log('AO baked %dpx in %.1fs' % (res, time.time() - t0))
    return out


def _copy(o):
    c = o.copy()
    c.data = o.data.copy()
    bpy.context.scene.collection.objects.link(c)
    return c


def join(objs, name):
    if not objs:
        return None
    _select(objs)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def tris(objs):
    t = 0
    for o in objs:
        for p in o.data.polygons:
            t += len(p.vertices) - 2
    return t


def build_lod(level, parts, ratio=None, min_size=0.0, dissolve_deg=0.0):
    """Copy parts -> drop parts smaller than min_size -> join per node -> planar dissolve -> collapse to ratio."""
    groups = {}
    for o in parts:
        node = o.get('kit_node', 'main')
        if level > 0 and node == 'decals' and part_size(o) < (1.0 if level == 1 else 1e9):
            continue
        if level > 0 and (o.get('kit_lod') == 'drop' or (part_size(o) < min_size and node == 'main' and o.get('kit_lod') != 'keep')):
            continue
        groups.setdefault(node, []).append(o)
    out = []
    for node, objs in groups.items():
        keep = [o for o in objs if level > 0 and o.get('kit_lod') == 'keep']
        cp = [_copy(o) for o in objs if o not in keep]
        piv = objs[0].get('kit_pivot')
        if not cp:
            cp, keep = [_copy(o) for o in keep], []
        ob = join(cp, node if level == 0 else '%s_lod%d' % (node, level))
        if dissolve_deg > 0 and node != 'decals':
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(dissolve_deg), verts=bm.verts, edges=bm.edges,
                                     delimit={'MATERIAL', 'UV'})
            bm.to_mesh(ob.data)
            bm.free()
        if ratio and ratio < 1 and node != 'decals':
            m = ob.modifiers.new('dec', 'DECIMATE')
            m.ratio = ratio
            m.use_collapse_triangulate = True
            m.delimit = {'UV', 'SHARP', 'MATERIAL'}
            _select([ob])
            bpy.ops.object.modifier_apply(modifier='dec')
        if keep:
            ob = join([ob] + [_copy(o) for o in keep], ob.name)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='BEAUTY')
        bm.to_mesh(ob.data)
        bm.free()
        if piv:
            # move origin to the hinge pivot (doors) so the game can rotate the node
            d = V(piv)
            ob.data.transform(__import__('mathutils').Matrix.Translation(-d))
            ob.location = d
        out.append(ob)
    return out


def export_glb(path, objs):
    _select(objs)
    kw = dict(filepath=path, use_selection=True, export_format='GLB', export_yup=True, export_apply=True,
              export_texcoords=True, export_normals=True, export_tangents=True, export_materials='EXPORT',
              export_extras=True, export_cameras=False, export_lights=False, export_animations=False)
    kw['export_image_format'] = 'NONE' if bpy.app.version >= (4, 2, 0) else 'AUTO'
    if bpy.app.version >= (4, 2, 0):
        kw['export_vertex_color'] = 'ACTIVE'
        kw['export_all_vertex_colors'] = False
    else:
        kw['export_colors'] = True
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError as e:
        C.log('gltf kw fallback', e)
        for k in ('export_vertex_color', 'export_all_vertex_colors', 'export_colors', 'export_image_format'):
            kw.pop(k, None)
        bpy.ops.export_scene.gltf(**kw)


def auto_footprint(objs, cell=0.5, hmin=0.05, hmax=2.2):
    """Fallback footprint: rasterise geometry between hmin..hmax (m) into 0.5 m cells (game XZ, i=floor(x/cell), j=floor(z/cell))."""
    cells = set()
    for o in objs:
        mw = o.matrix_world
        vs = [mw @ v.co for v in o.data.vertices]
        for p in o.data.polygons:
            ps = [vs[i] for i in p.vertices]
            if min(q.z for q in ps) > hmax or max(q.z for q in ps) < hmin:
                continue
            for k in range(1, len(ps) - 1):
                a, b, c = ps[0], ps[k], ps[k + 1]
                L = max((a - b).length, (b - c).length, (c - a).length)
                n = max(1, int(L / (cell * 0.4)))
                for u in range(n + 1):
                    for v in range(n + 1 - u):
                        q = a + (b - a) * (u / n) + (c - a) * (v / n)
                        if hmin <= q.z <= hmax:
                            cells.add((int(math.floor(q.x / cell)), int(math.floor(-q.y / cell))))
    return sorted(cells)


def _shift_meta(m, dx, dz):
    """Shift every game-coordinate point in the sidecar by (dx, dz)."""
    def p2(p):
        return [round(p[0] + dx, 3), round(p[1] + dz, 3)]
    for f in m['footprints'] + m['roofs']:
        f['points'] = [p2(p) for p in f['points']]
    for c in m['climb'] + m['ladders'] + m.get('parapets', []):
        c['a'], c['b'] = p2(c['a']), p2(c['b'])
    for d in m['doors']:
        d['pos'] = [round(d['pos'][0] + dx, 3), d['pos'][1], round(d['pos'][2] + dz, 3)]
        d['approach'] = p2(d['approach'])
    for a in m['anchors'] + m['windows']:
        a['pos'] = [round(a['pos'][0] + dx, 3), a['pos'][1], round(a['pos'][2] + dz, 3)]


def recenter_parts(parts):
    """Move the asset so the XY bounding-box centre is the pivot (ground centre); shifts metadata + door pivots."""
    from mathutils import Matrix
    xs, ys = [], []
    for o in parts:
        if o.get('kit_node', 'main') == 'decals':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ V(c)
            xs.append(w.x)
            ys.append(w.y)
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    if abs(cx) < 0.05 and abs(cy) < 0.05:
        return
    T = Matrix.Translation((-cx, -cy, 0))
    for o in parts:
        o.data.transform(T)
        if o.get('kit_pivot'):
            pv = list(o['kit_pivot'])
            o['kit_pivot'] = [pv[0] - cx, pv[1] - cy, pv[2]]
    _shift_meta(C.A.meta, -cx, cy)
    C.A.meta['recentered_by'] = [round(-cx, 3), round(cy, 3)]
    C.log('recentred by', round(-cx, 3), round(-cy, 3))


def finalize(outdir, ao_res=1024, ao_samples=96, lods=((0.45, 0.30, 4.0), (0.3, 0.9, 4.0)), lib_res='1k',
             webp=False, skip_ao=False, lib_url=None, recenter=True):
    """Bake AO, build LOD0..2, export GLBs (library-referenced materials) + <name>.kit.json sidecar.
    lods: ((ratio, min_part_size_m, planar_dissolve_deg), ...) for LOD1, LOD2."""
    import glb_post
    A = C.A
    os.makedirs(outdir, exist_ok=True)
    name = A.name
    parts = [o for o in A.parts if o.name in bpy.data.objects]
    if recenter and not A.meta.get('bridge'):
        recenter_parts(parts)
    solid = [o for o in parts if o.get('kit_node', 'main') != 'decals']
    ao_path = os.path.join(outdir, name + '_ao.png')
    if not skip_ao:
        unwrap_ao(solid)
        bake_ao(solid, ao_res, ao_samples, out=ao_path)
    info = {'lods': []}
    for lvl in range(len(lods) + 1):
        if lvl == 0:
            objs = build_lod(0, parts)
        else:
            r, ms, dd = lods[lvl - 1]
            objs = build_lod(lvl, parts, r, ms, dd)
        fn = name + ('' if lvl == 0 else '_lod%d' % lvl) + '.glb'
        p = os.path.join(outdir, fn)
        export_glb(p, objs)
        glb_post.rewrite(p, ao_png=None if skip_ao else ao_path, lib_res=lib_res, webp=webp, lib_url=lib_url)
        t = tris(objs)
        info['lods'].append({'file': fn, 'tris': t, 'bytes': os.path.getsize(p)})
        C.log('LOD%d %s tris=%d size=%.0fKB' % (lvl, fn, t, os.path.getsize(p) / 1024))
        if lvl == 0:
            lod0 = objs
            mn = [min((o.matrix_world @ V(c))[i] for o in objs for c in o.bound_box) for i in range(3)]
            mx = [max((o.matrix_world @ V(c))[i] for o in objs for c in o.bound_box) for i in range(3)]
        else:
            for o in objs:
                bpy.data.objects.remove(o)
    meta = dict(A.meta)
    meta['bbox_game'] = {'min': [round(mn[0], 3), round(mn[2], 3), round(-mx[1], 3)],
                         'max': [round(mx[0], 3), round(mx[2], 3), round(-mn[1], 3)]}
    meta['height'] = round(mx[2], 3)
    meta['pivot'] = 'ground centre; model front faces +Z (game south at rot 0)'
    meta['auto_cells_0p5'] = [list(c) for c in auto_footprint([o for o in lod0 if not o.name.startswith('decals')])]
    meta['lods'] = info['lods']
    meta['materials'] = sorted({m.get('kit_id', m.name) for o in lod0 for m in o.data.materials if m})
    meta['theater'] = A.theater
    meta['snow'] = A.snow
    meta['nodes'] = [o.name for o in lod0]
    json.dump(meta, open(os.path.join(outdir, name + '.kit.json'), 'w'), indent=1)
    cred = {'asset': name, 'geometry': 'procedural, SHADOW SIX kit (own work, CC0)', 'textures': {}}
    for mid in meta['materials']:
        e = C.MATS.get(mid.split('~')[0], {})
        cred['textures'][mid] = dict(e.get('source', {}), label=e.get('label'), files=e.get('maps'))
    json.dump(cred, open(os.path.join(outdir, name + '.credits.json'), 'w'), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(outdir, name + '.blend'))
    C.log('finalized', name, info['lods'])
    return meta
