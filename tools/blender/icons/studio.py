# studio.py - SHADOW SIX icon studio (Blender 4.2, Cycles). One lighting rig for every HUD icon.
# Classes: 'item' (ortho 3/4 product shot), 'tool' (85 mm, low elevation), 'badge' (straight-on ortho), 'cursor' (as item).
# Usage from a model script:  import studio as S; S.reset(); <build objects>; S.shoot('knife', cls='item', box=(44, 20))
import bpy, math, os, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
SCRATCH = os.environ.get('ICON_SCRATCH', os.path.expanduser('~/.cache/shadow-six/icons'))
TEX = os.path.join(SCRATCH, 'tex')
LABELS = os.path.join(SCRATCH, 'labels')
HDRI = os.path.join(SCRATCH, 'hdri', 'studio_small_09_2k.hdr')
MASTERS = os.environ.get('ICON_MASTERS', os.path.join(SCRATCH, 'masters'))
MASTER_SCALE = 8          # master = ref box x 8
SAMPLES = int(os.environ.get('ICON_SAMPLES', '384'))


def reset(blend=None):
    """Fresh scene (or open `blend`), then the studio render settings + world."""
    if blend:
        bpy.ops.wm.open_mainfile(filepath=blend)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    if 'mats' in sys.modules: sys.modules['mats']._cache.clear()
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    r = sc.render
    r.engine = 'CYCLES'
    cy = sc.cycles
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dev in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = dev; prefs.get_devices()
            for d in prefs.devices: d.use = d.type != 'CPU'
            cy.device = 'GPU'; break
        except Exception:
            continue
    cy.samples = SAMPLES; cy.use_denoising = True; cy.denoiser = 'OPENIMAGEDENOISE'
    cy.max_bounces = 12; cy.glossy_bounces = 6; cy.transmission_bounces = 12; cy.transparent_max_bounces = 16
    cy.caustics_reflective = False; cy.caustics_refractive = False
    cy.sample_clamp_indirect = 8
    r.film_transparent = True
    r.filter_size = 1.2
    vs = sc.view_settings
    vs.view_transform = 'AgX'; vs.look = 'AgX - Medium High Contrast'; vs.exposure = 0.0
    r.image_settings.file_format = 'PNG'; r.image_settings.color_mode = 'RGBA'; r.image_settings.color_depth = '16'
    r.resolution_percentage = 100
    _world()
    return sc


def _world(strength=0.6, rot=200):
    w = bpy.data.worlds.new('studio'); bpy.context.scene.world = w
    w.use_nodes = True; nt = w.node_tree; nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Rotation'].default_value = (0, 0, math.radians(rot))
    env = nt.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(HDRI, check_existing=True)
    bg = nt.nodes.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
    nt.links.new(env.outputs['Color'], bg.inputs['Color']); nt.links.new(bg.outputs[0], out.inputs[0])
    w['strength'] = strength


def world_strength(s):
    bpy.context.scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = s


# ---------------------------------------------------------------- camera presets
PRESETS = {  # elevation deg, azimuth deg (0 = camera on -Y looking +Y), ortho, lens mm
    # ONE view for every knapsack item (review: no mixed profile / 3/4 / top-down): props stand in their natural pose
    # as if on a display table, seen 32 deg above and 14 deg to the left, near-orthographic long lens.
    'item':   dict(elev=32, azim=-14, ortho=False, lens=200),
    'flat':   dict(elev=90, azim=0, ortho=True),            # straight top-down (layouts where the object lies in XY)
    'profile': dict(elev=28, azim=0, ortho=True),           # low 3/4 for guns whose profile must dominate
    'tool':   dict(elev=12, azim=-20, ortho=False, lens=85),
    'badge':  dict(elev=8, azim=0, ortho=True),
    'front':  dict(elev=0, azim=0, ortho=True),
}


def _mesh_points(objs):
    dg = bpy.context.evaluated_depsgraph_get(); pts = []
    for o in objs:
        if o.type not in ('MESH', 'CURVE', 'FONT', 'SURFACE') or o.hide_render or o.get('no_frame'):
            continue
        oe = o.evaluated_get(dg)
        try:
            me = oe.to_mesh()
        except RuntimeError:
            continue
        mw = o.matrix_world
        step = max(1, len(me.vertices) // 20000)
        pts += [mw @ me.vertices[i].co for i in range(0, len(me.vertices), step)]
        oe.to_mesh_clear()
    return pts


def camera(preset='item', elev=None, azim=None, lens=None, roll=0.0):
    p = dict(PRESETS[preset])
    if elev is not None: p['elev'] = elev
    if azim is not None: p['azim'] = azim
    if lens is not None: p['lens'] = lens
    cd = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cd)
    bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera = cam
    e, a = math.radians(p['elev']), math.radians(p['azim'])
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))   # from target to camera
    cam['dir'] = tuple(d); cam['elev'] = p['elev']; cam['azim'] = p['azim']
    rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4() if abs(d.z) < 0.999 else Matrix.Rotation(a, 4, 'Z')
    rot = rot @ Matrix.Rotation(math.radians(roll), 4, 'Z')
    cam.matrix_world = rot
    if p['ortho']:
        cd.type = 'ORTHO'
    else:
        cd.lens = p.get('lens', 85); cd.sensor_width = 36
    cd.clip_start = 0.001; cd.clip_end = 100
    return cam


def _cam_local(cam, pts):
    Ri = cam.matrix_world.to_3x3().inverted()
    return [Ri @ p for p in pts]


def frame(cam, objs, aspect, margin=0.05, center_mode='bbox'):
    """Fit all mesh points of objs into the frame (aspect = W/H) with `margin` (fraction of each side)."""
    pts = _mesh_points(objs)
    R = cam.matrix_world.to_3x3()
    d = Vector(cam['dir'])
    cd = cam.data; cd.sensor_fit = 'HORIZONTAL'
    lo = [Ri for Ri in _cam_local(cam, pts)]
    xs = [p.x for p in lo]; ys = [p.y for p in lo]; zs = [p.z for p in lo]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    size = max(w, h, 1e-4)
    if cd.type == 'ORTHO':
        cam.location = R @ Vector((cx, cy, max(zs) + 2 * size + 1.0))
        cd.ortho_scale = max(w, h * aspect) / (1 - 2 * margin)
        cd.shift_x = cd.shift_y = 0
        return size
    # perspective: aim at bbox centre, iterate distance + shift
    ctr = R @ Vector((cx, cy, (min(zs) + max(zs)) / 2))
    k = cd.sensor_width / cd.lens
    dist = size / k * 1.4
    for _ in range(6):
        cam.location = ctr + d * dist
        bpy.context.view_layer.update()
        Ri = cam.matrix_world.to_3x3().inverted(); loc = cam.location
        uv = [((Ri @ (p - loc)).x / -(Ri @ (p - loc)).z, (Ri @ (p - loc)).y / -(Ri @ (p - loc)).z) for p in pts]
        us = [a for a, b in uv]; vs = [b for a, b in uv]
        uw, vh = max(us) - min(us), max(vs) - min(vs)
        need = max(uw, vh * aspect) / (1 - 2 * margin)
        dist *= need / k
        cd.shift_x = (max(us) + min(us)) / 2 / k
        cd.shift_y = (max(vs) + min(vs)) / 2 / k
    cam.location = ctr + d * dist
    return size


def _light(name, kind, loc, target, energy, size, color=(1, 1, 1), shadow=True, size_y=None):
    ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color
    if kind == 'AREA':
        ld.shape = 'RECTANGLE' if size_y else 'DISK'; ld.size = size
        if size_y: ld.size_y = size_y
    ld.use_shadow = shadow
    try: ld.cycles.cast_shadow = shadow
    except Exception: pass
    o = bpy.data.objects.new(name, ld); bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (target - loc).to_track_quat('-Z', 'Y').to_euler()
    return o


def kelvin(k):
    return {5500: (1.0, 0.94, 0.86), 6500: (0.90, 0.95, 1.0), 4200: (1.0, 0.82, 0.62), 5000: (1.0, 0.93, 0.84)}[k]


def lights(cam, objs, key=1.0, fill=0.22, rim=0.7, top=0.05, rim_side=1):
    """Key from screen upper-left, cool fill screen-right low, warm rim behind-right, big soft top bounce."""
    pts = _mesh_points(objs)
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2; s = max((hi - lo).length, 1e-3)
    R = cam.matrix_world.to_3x3(); right, up, back = R.col[0], R.col[1], R.col[2]
    world_up = Vector((0, 0, 1))
    def P(v, dist):
        return c + v.normalized() * dist
    D = 4 * s; E = float(os.environ.get('ICON_E', '14')) * D * D     # energy normaliser (W ~ distance^2)
    kd = (-0.8 * right + 0.62 * up + 0.35 * back + 0.12 * world_up)
    _light('key', 'AREA', P(kd, D), c, E * key, 1.4 * s, kelvin(5500))
    _light('fill', 'AREA', P(0.9 * right - 0.15 * up + 0.7 * back, D), c, E * fill, 2.5 * s, kelvin(6500), shadow=False)
    _light('rim', 'AREA', P(0.8 * rim_side * right + 0.55 * up - 0.9 * back + 0.4 * world_up, D), c, E * rim, 0.35 * s, kelvin(4200), shadow=False, size_y=2.0 * s)
    cd = Vector(cam['dir']); refl = Vector((-cd.x, -cd.y, cd.z))       # mirror direction of the ground plane seen from the camera
    _light('top', 'AREA', P(refl + 0.25 * world_up, D), c, E * top, 1.6 * s, kelvin(5000), shadow=False, size_y=0.9 * s)
    return c, s


def catcher(objs, z=None, size=None):
    pts = _mesh_points(objs)
    z0 = min(p.z for p in pts) if z is None else z
    s = size or 10 * max(max(p.x for p in pts) - min(p.x for p in pts), max(p.y for p in pts) - min(p.y for p in pts))
    bpy.ops.mesh.primitive_plane_add(size=s, location=(0, 0, z0 - 1e-5))
    pl = bpy.context.active_object; pl.name = 'shadow_catcher'; pl.is_shadow_catcher = True
    pl['no_frame'] = True
    return pl


def hot_px(cam, name, W, H):
    """Pixel position of the empty `name` (hotspot) in a W x H render."""
    from bpy_extras.object_utils import world_to_camera_view
    o = bpy.data.objects.get(name)
    if not o: return None
    co = world_to_camera_view(bpy.context.scene, cam, o.matrix_world.translation)
    return [round(co.x * W, 2), round((1 - co.y) * H, 2)]


RIG = ('cam', 'key', 'fill', 'rim', 'top', 'shadow_catcher')


def _clear_rig():
    for o in list(bpy.data.objects):
        if o.name.split('.')[0] in RIG:
            bpy.data.objects.remove(o, do_unlink=True)


def subjects():
    return [o for o in bpy.context.scene.objects if o.type in ('MESH', 'CURVE', 'FONT') and not o.hide_render
            and o.name.split('.')[0] not in RIG]


def shoot(icon_id, cls='item', box=(34, 34), preset=None, elev=None, azim=None, roll=0.0, lens=None, margin=0.045,
          scale=MASTER_SCALE, shadow=True, light=None, hot='hot', samples=None, world=None, extra=None, slot=None):
    """Render MASTERS/<cls>/<icon_id>.png (box = ref px W x H, master = box x scale) + <icon_id>.json sidecar."""
    import json
    _clear_rig()
    sc = bpy.context.scene
    if samples: sc.cycles.samples = samples
    if world is not None: world_strength(world)
    objs = subjects()
    if cls == 'item':   # one camera for the whole inventory: per-shot overrides are ignored (pose the prop instead)
        preset, elev, azim, roll, lens = 'item', None, None, 0.0, None
    preset = preset or {'item': 'item', 'cursor': 'item', 'tool': 'tool', 'badge': 'badge'}.get(cls, 'item')
    cam = camera(preset, elev, azim, lens, roll)
    W, H = int(round(box[0] * scale)), int(round(box[1] * scale))
    sc.render.resolution_x, sc.render.resolution_y = W, H
    bpy.context.view_layer.update()
    frame(cam, objs, W / H, margin)
    bpy.context.view_layer.update()
    lk = dict(light or {})
    if os.environ.get('ICON_TOP'): lk['top'] = float(os.environ['ICON_TOP'])
    lights(cam, objs, **lk)
    bpy.context.view_layer.update()
    os.makedirs(os.path.join(MASTERS, cls), exist_ok=True)
    path = os.path.join(MASTERS, cls, icon_id + '.png')
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    if shadow:   # second, cheap pass with the shadow catcher: post.py extracts the contact shadow from the alpha difference
        pl = catcher(objs); n0 = sc.cycles.samples; sc.cycles.samples = 96
        sc.render.filepath = path[:-4] + '.sh.png'
        bpy.ops.render.render(write_still=True)
        sc.cycles.samples = n0; bpy.data.objects.remove(pl, do_unlink=True)
    meta = dict(id=icon_id, cls=cls, box=list(box), master=[W, H], scale=scale, view=[round(float(cam['elev']), 1), round(float(cam['azim']), 1)])
    hp = hot_px(cam, hot, W, H) if hot else None
    if hp: meta['hot'] = hp
    if cls == 'item' and slot is None: slot = 1          # knapsack slots (post.py sizes the box by visual mass)
    if slot: meta['slot'] = slot
    if extra: meta.update(extra)
    json.dump(meta, open(path[:-4] + '.json', 'w'))
    print('SHOT', path, W, H, meta.get('hot'))
    return path


def save_blend(name):
    os.makedirs(os.path.join(SCRATCH, 'blend'), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SCRATCH, 'blend', name + '.blend'), compress=True)


def argv():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


REG = {}


def shot(name):
    def deco(fn):
        REG[name] = fn; return fn
    return deco
