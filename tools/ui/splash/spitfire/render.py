# Renders the Spitfire (model.py) for the title splash: three formation poses x {bombed-up, clean} seen from below
# the starboard side, lit like the splash plate (a warm horizon glow ahead / far side, the fires below, the overcast
# dome), plus neutral reference views for the contact sheet.
#   blender -b --factory-startup --python-use-system-env --python render.py -- <outdir> [cells|views|all] [samples] [poses json]
# Writes <outdir>/cells/<pose>_<state>.png (2x the atlas scale, RGBA) + <outdir>/cells/meta.json, <outdir>/views/*.png.
import sys, os, math, json
import bpy
import numpy as np
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model as SP

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else '/tmp/spitfire_render')
WHAT = ARGS[1] if len(ARGS) > 1 else 'all'
SAMPLES = int(ARGS[2]) if len(ARGS) > 2 else 160
K2 = 40.0                       # render px per metre (2x the atlas scale)
FRAME = (13.0, 8.0)             # metres framed per cell
ELEV = 14.0                     # the formation is seen this far from below (deg)
# formation poses: yaw (nose toward the viewer), pitch (nose up), bank (+ = near / starboard wing down), deg
POSES = {'a': (9.0, 1.0, -3.0), 'b': (6.0, 2.0, 0.0), 'c': (12.0, 0.0, -5.0)}
if len(ARGS) > 3:               # pose studies: a JSON {name: [yaw, pitch, bank]} replaces the formation poses
    POSES = {k: tuple(v) for k, v in json.loads(ARGS[3]).items()}
GLOW = Vector((0.50, 0.86, 0.04)).normalized()      # light comes FROM: the horizon glow, far side, ahead
FIRE = Vector((0.35, 0.55, -0.76)).normalized()     # the fires below, far side
TOP = Vector((-0.20, -0.25, 0.95)).normalized()     # the overcast
NEAR = Vector((0.0, -0.95, -0.30)).normalized()     # the dim dusk sky behind the viewer
GROUND = Vector((0.15, -0.30, -0.94)).normalized()  # the burning field below, all round (warm under-light)


def sun(name, frm, color, strength, angle=10.0):
    d = bpy.data.lights.new(name, 'SUN')
    d.color, d.energy, d.angle = color, strength, math.radians(angle)
    ob = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = frm.to_track_quat('Z', 'Y').to_euler()   # a sun shines along its -Z
    return ob


def dusk_world(scale=1.0):
    """Equirectangular dusk dome painted in numpy: overcast slate overhead, the warm glow low on the far side,
    near-black ground with the fires' glow (Blender equirect: u = atan2(y, -x) / 2pi + .5)."""
    W, H = 512, 256
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    lon, lat = np.meshgrid((u - 0.5) * 2 * np.pi, (v - 0.5) * np.pi)
    x, y, z = -np.cos(lon) * np.cos(lat), np.sin(lon) * np.cos(lat), np.sin(lat)
    hor = np.stack([x, y], -1) / np.maximum(1e-6, np.hypot(x, y))[..., None]
    sky = np.where(z[..., None] > 0, np.array([0.016, 0.018, 0.024]) * (1 + 0.6 * (1 - z[..., None])),
                   np.array([0.004, 0.0032, 0.0028]))
    g = np.clip(hor @ np.array([GLOW.x, GLOW.y]) / np.hypot(GLOW.x, GLOW.y), 0, 1) ** 3 * np.exp(-np.abs(z) / 0.10)
    f = np.clip(hor @ np.array([FIRE.x, FIRE.y]) / np.hypot(FIRE.x, FIRE.y), 0, 1) ** 6 * np.exp(-np.abs(z + 0.2) / 0.25) * (z < 0.05)
    rgb = (sky + g[..., None] * np.array([1.0, 0.42, 0.14]) * 0.30 + f[..., None] * np.array([1.0, 0.36, 0.08]) * 0.10) * scale
    img = bpy.data.images.new('dusk', W, H, float_buffer=True)
    img.pixels.foreach_set(np.concatenate([rgb, np.ones((H, W, 1))], -1).astype(np.float32).ravel())
    w = bpy.data.worlds.new('dusk')
    w.use_nodes = True
    nt = w.node_tree
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = img
    nt.links.new(env.outputs['Color'], nt.nodes['Background'].inputs['Color'])
    bpy.context.scene.world = w


def setup(samples):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 6
    sc.render.film_transparent = True
    sc.cycles.filter_width = 1.5
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'


def camera(view_dir, target, w_m, h_m, kpx):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cam = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(cam)
    f = Vector(view_dir).normalized()
    up = Vector((0, 0, 1)) if abs(f.z) < 0.99 else Vector((0, 1, 0))
    r = f.cross(up).normalized()
    u = r.cross(f)
    cam.matrix_world = Matrix.Translation(Vector(target) - f * 40) @ Matrix((r, u, -f)).transposed().to_4x4()
    sc.render.resolution_x, sc.render.resolution_y = int(round(w_m * kpx)), int(round(h_m * kpx))
    sc.render.resolution_percentage = 100
    cd.ortho_scale = max(w_m, h_m)
    cd.clip_start, cd.clip_end = 1.0, 100.0
    sc.camera = cam
    return cam


def project(cam, p):
    sc = bpy.context.scene
    c = world_to_camera_view(sc, cam, Vector(p))
    return [c.x * sc.render.resolution_x, (1 - c.y) * sc.render.resolution_y]   # px, y down


def pose(root, yaw, pitch, bank):
    root.rotation_mode = 'XYZ'
    root.rotation_euler = (math.radians(bank), math.radians(-pitch), math.radians(-yaw))
    bpy.context.view_layer.update()


STATES = (('loaded', ('stbd', 'port')), ('half', ('port',)), ('clean', ()))   # near (stbd) bomb drops first


def render_cells(root, bombs):
    d = os.path.join(OUT, 'cells')
    os.makedirs(d, exist_ok=True)
    dusk_world(1.5)
    sun('glow', GLOW, (1.0, 0.56, 0.30), 4.0, 6.0)
    sun('fire', FIRE, (1.0, 0.58, 0.36), 0.6, 30.0)
    sun('ground', GROUND, (1.0, 0.70, 0.50), 0.85, 70.0)
    sun('overcast', TOP, (0.62, 0.70, 0.84), 1.4, 40.0)
    sun('near', NEAR, (0.60, 0.66, 0.78), 1.1, 40.0)
    e = math.radians(ELEV)
    cam = camera((0, math.cos(e), math.sin(e)), (-0.85, 0, 0.25), FRAME[0], FRAME[1], K2)
    meta = {'k2': K2, 'elev': ELEV, 'poses': {}, 'bombLen': round(1.24 * SP.BOMB_L, 3)}
    zb = SP.bomb_z()
    for name, (yaw, pitch, bank) in POSES.items():
        pose(root, yaw, pitch, bank)
        M = root.matrix_world
        pts = {'anchor': SP.P(3.95, 0, -0.86), 'nose': SP.P(0, 0, 0), 'tail': SP.P(9.47, 0, 0.75),
               'hp_near': SP.P(SP.BOMB_X + 0.62 * SP.BOMB_L, -SP.BOMB_Y, zb), 'hp_far': SP.P(SP.BOMB_X + 0.62 * SP.BOMB_L, SP.BOMB_Y, zb)}
        meta['poses'][name] = {'yaw': yaw, 'pitch': pitch, 'bank': bank,
                               **{k: project(cam, M @ Vector(p)) for k, p in pts.items()}}
        for state, show in STATES:
            for side, ob in bombs.items():
                ob.hide_render = side not in show
            bpy.context.scene.render.filepath = os.path.join(d, '%s_%s.png' % (name, state))
            bpy.ops.render.render(write_still=True)
    for ob in bombs.values():
        ob.hide_render = False
    # the falling bomb on its own, same light and view, nose +X (the splash rotates it along its path)
    pose(root, 0, 0, 0)
    root.hide_render = True
    for ob in root.children:
        ob.hide_render = True
    fb = SP.falling_bomb(SP.MATS)
    bpy.data.objects.remove(cam)
    cam = camera((0, math.cos(e), math.sin(e)), (0, 0, 0), 2.0, 0.8, K2)
    meta['bomb'] = {'origin': project(cam, Vector((0, 0, 0)))}
    bpy.context.scene.render.filepath = os.path.join(d, 'bomb.png')
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(fb)
    for ob in root.children:
        ob.hide_render = False
    with open(os.path.join(d, 'meta.json'), 'w') as fh:
        json.dump(meta, fh, indent=1)


def render_views(root, bombs):
    """Neutral reference views for the contact sheet: starboard side, plan, underside, front, three-quarter."""
    d = os.path.join(OUT, 'views')
    os.makedirs(d, exist_ok=True)
    w = bpy.data.worlds.new('grey')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.32, 0.34, 0.37, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    bpy.context.scene.world = w
    sun('key', Vector((0.4, -0.5, 0.75)).normalized(), (1.0, 0.97, 0.92), 3.2, 3.0)
    pose(root, 0, 0, 0)
    for ob in bombs.values():
        ob.hide_render = False
    views = {'side': ((0, 1, 0), (-0.8, 0, 0.3), 12.0, 4.4), 'plan': ((0, 0, -1), (-0.8, 0, 0), 12.0, 12.0),
             'under': ((0, 0, 1), (-0.8, 0, 0), 12.0, 12.0), 'front': ((-1, 0, 0), (0, 0, 0.1), 12.0, 4.6),
             'three_q': ((-0.55, 0.62, -0.56), (-0.8, 0, 0.1), 12.5, 7.5)}
    for name, (vd, tgt, wm, hm) in views.items():
        for o in [o for o in bpy.context.scene.objects if o.type == 'CAMERA']:
            bpy.data.objects.remove(o)
        camera(vd, tgt, wm, hm, 1200 / wm)
        bpy.context.scene.render.filepath = os.path.join(d, name + '.png')
        bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup(SAMPLES)
    root, bombs, disc = SP.build()
    if WHAT in ('cells', 'all'):
        render_cells(root, bombs)
    if WHAT in ('views', 'all'):
        for o in [o for o in bpy.context.scene.objects if o.type in ('LIGHT', 'CAMERA')]:
            bpy.data.objects.remove(o)
        render_views(root, bombs)
    print('SPITFIRE RENDER DONE', OUT)


main()
