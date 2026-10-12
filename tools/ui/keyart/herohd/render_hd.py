"""Stage 3 of the detailed hero: night lighting, camera and the RGBA master render.
  blender -b <hero.blend> --python tools/ui/keyart/herohd/render_hd.py -- <out.png> [W H samples] [--fog] [--view hero|face|hand|webbing]
Lighting (the title scene: a burning tank behind him to screen right, moonlight from the front left):
  fire     big warm area light behind-right, flickering colour temperature in two lobes (hot core, deep orange skirt):
           the rim along his left side, beret, cheek and the pistol's edge
  fire2    a dimmer, redder rim from behind-left (the glow on the smoke)
  bounce   fire light coming back off the ground, low front-right, warm and weak
  moon     cool, soft fill from high front-left: the shadow side reads blue-grey, never black
  eye      a tiny catch light so the eyes are alive
  fog      optional: a thin, height-falling volumetric haze round him that glows where the fire light passes
The film is transparent (the splash draws the sky, fire and smoke behind him); AgX, then grade.py."""
import bpy, sys, os, json, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mathutils import Vector, Matrix
import rutil

argv = sys.argv[sys.argv.index('--') + 1:]
flags = [a for a in argv if a.startswith('--')]
args = [a for a in argv if not a.startswith('--')]
OUT = args[0]
W = int(args[1]) if len(args) > 1 else 1800
H = int(args[2]) if len(args) > 2 else 2700
SPP = int(args[3]) if len(args) > 3 else 512
view = 'hero'
for i, a in enumerate(argv):
    if a == '--view': view = argv[i + 1]
FOG = '--fog' in flags
L = json.load(open(os.environ.get('HERO_LIGHTS') or os.path.join(HERE, 'lights_herohd.json')))
POSE = json.load(open(os.path.join(HERE, 'pose_herohd.json')))
sc = bpy.context.scene
rig = bpy.data.objects['hero.rig']
for o in list(bpy.data.objects):
    if o.type in ('LIGHT', 'CAMERA'): bpy.data.objects.remove(o)

rutil.setup(SPP)
sc.cycles.use_adaptive_sampling = True; sc.cycles.adaptive_threshold = 0.006
sc.cycles.max_bounces = 10; sc.cycles.transparent_max_bounces = 16
sc.cycles.caustics_reflective = False; sc.cycles.caustics_refractive = False
try: sc.cycles.blur_glossy = 0.5
except Exception: pass
sc.render.film_transparent = True
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = L.get('look', 'AgX - Medium High Contrast')
sc.view_settings.exposure = L.get('exposure', 0.0)
world = bpy.data.worlds.new('night'); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs[0].default_value = (*L.get('ambient', (0.010, 0.012, 0.02)), 1); bg.inputs[1].default_value = 1.0
head = rig.matrix_world @ rig.pose.bones['head'].head
chest = Vector((0, -0.05, 1.3))


def light(name, spec):
    d = bpy.data.lights.new(name, spec.get('type', 'AREA'))
    d.energy = spec['energy']; d.color = spec['color']
    if d.type == 'AREA':
        d.shape = 'ELLIPSE' if spec.get('ellipse') else 'RECTANGLE'
        d.size = spec.get('size', 1.0); d.size_y = spec.get('size_y', d.size)
    elif d.type in ('POINT', 'SPOT'):
        d.shadow_soft_size = spec.get('size', 0.1)
    o = bpy.data.objects.new(name, d); sc.collection.objects.link(o)
    o.location = spec['loc']
    tgt = Vector(spec.get('tgt', head))
    o.rotation_euler = (tgt - o.location).to_track_quat('-Z', 'Y').to_euler()
    if spec.get('only'):                                   # light linking: only these objects receive it
        coll = bpy.data.collections.new(name + '_recv')
        for nm in spec['only']:
            ob = bpy.data.objects.get(nm)
            if ob: coll.objects.link(ob)
        o.light_linking.receiver_collection = coll
    return o


for name, spec in L['lights'].items():
    light(name, spec)

if FOG:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 1.0))
    fog = bpy.context.object; fog.name = 'fog'; fog.scale = (1.6, 1.6, 1.0)
    m = bpy.data.materials.new('fog'); m.use_nodes = True
    nt = m.node_tree; nt.nodes.remove(nt.nodes['Principled BSDF'])
    vs = nt.nodes.new('ShaderNodeVolumePrincipled')
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = -0.5; mr.inputs['From Max'].default_value = 0.5
    mr.inputs['To Min'].default_value = L.get('fog_density', 0.05); mr.inputs['To Max'].default_value = L.get('fog_density', 0.05) * 0.25
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 2.5; nz.inputs['Detail'].default_value = 3
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
    nt.links.new(mr.outputs['Result'], mul.inputs[0]); nt.links.new(nz.outputs['Fac'], mul.inputs[1])
    nt.links.new(mul.outputs[0], vs.inputs['Density'])
    vs.inputs['Anisotropy'].default_value = 0.55
    vs.inputs['Color'].default_value = (0.9, 0.85, 0.8, 1)
    nt.links.new(vs.outputs[0], nt.nodes['Material Output'].inputs['Volume'])
    fog.data.materials.append(m)
    fog.visible_shadow = False

cam_loc, cam_tgt, lens = Vector(POSE['cam']['loc']), Vector(POSE['cam']['tgt']), POSE['cam']['lens']
VIEWS = {'face': ((0.12, -1.25, 1.66), (0.0, -0.05, 1.64), 90), 'hand': ((-0.35, -1.25, 1.55), (-0.2, -0.22, 1.53), 90),
         'webbing': ((0.15, -1.6, 1.22), (0.02, -0.1, 1.2), 70), 'knife': ((0.35, -1.0, 1.0), (0.18, -0.1, 1.0), 70)}
if view in VIEWS:
    cam_loc, cam_tgt, lens = Vector(VIEWS[view][0]), Vector(VIEWS[view][1]), VIEWS[view][2]
cd = bpy.data.cameras.new('cam'); cd.lens = lens
cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam)
cam.location = cam_loc; cam.rotation_euler = (cam_tgt - cam_loc).to_track_quat('-Z', 'Y').to_euler()
sc.camera = cam
rutil.render(OUT)
if '--save' in flags:
    bpy.ops.wm.save_as_mainfile(filepath=OUT.replace('.png', '.blend'))
