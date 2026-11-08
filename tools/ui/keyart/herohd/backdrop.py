"""The title splash's ground plate: the burning tank and the field it stands in, rendered to sit over sky.svg (same
16:9 framing and 'cover' scaling, so the WebGL fire of splash-fx.js keeps landing on its engine deck) and under the hero.
  blender -b --factory-startup --python tools/ui/keyart/herohd/backdrop.py -- <out.png> [W H samples]
Then variants.py --plate. Everything procedural (own work): a long-barrelled medium tank in the Panzer IV mould
(no markings), knocked out and burning, skirts torn away, gun lifted; a churned field with track ruts, grass, debris,
low ground haze. Transparent above the horizon, where the SVG sky, smoke and searchlight show through."""
import bpy, bmesh, sys, os, math, subprocess, tempfile, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np
from mathutils import Vector, Matrix, Euler
import rutil, mats

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
W = int(argv[1]) if len(argv) > 1 else 3200
H = int(argv[2]) if len(argv) > 2 else 1800
SPP = int(argv[3]) if len(argv) > 3 else 256
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
sc = bpy.context.scene
col = sc.collection


def box(name, size, loc, rot=(0, 0, 0), mat=None, bevel=0.03, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        b = o.modifiers.new('bv', 'BEVEL'); b.width = bevel; b.segments = 2
    if mat: o.data.materials.append(mat)
    if parent: o.parent = parent
    return o


def cyl(name, r, depth, loc, rot=(0, 0, 0), mat=None, verts=24, parent=None, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.object; o.name = name
    if bevel:
        b = o.modifiers.new('bv', 'BEVEL'); b.width = bevel; b.segments = 2
    if mat: o.data.materials.append(mat)
    if parent: o.parent = parent
    for p in o.data.polygons: p.use_smooth = True
    return o


# ---------------------------------------------------------------- materials
def burnt_steel(name='burnt'):
    m, nt, b = mats.new(name); L = nt.links
    w = mats.coords(nt)
    n1 = mats.noise(nt, w, 3.0, 6.0, 0.65, (-1000, 300))
    n2 = mats.noise(nt, w, 25.0, 5.0, 0.6, (-1000, 100))
    edge, cav = mats.wear_masks(nt)
    c = mats.mix_rgb(nt, mats.LIN((40, 38, 34)), mats.LIN((84, 50, 30)), mats.maprange(nt, n1.outputs['Fac'], 0.5, 0.7), 'MIX', (-400, 300))
    c = mats.mix_rgb(nt, c, mats.LIN((14, 13, 12)), mats.maprange(nt, n2.outputs['Fac'], 0.4, 0.7), 'MIX', (-200, 300))
    c = mats.mix_rgb(nt, c, mats.LIN((110, 100, 88)), mats.math(nt, 'MULTIPLY', edge, 0.5), 'MIX', (0, 300))
    L.new(c, b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.78; b.inputs['Metallic'].default_value = 0.4
    L.new(mats.bump_chain(nt, [(n2.outputs['Fac'], 0.4, 0.004)]), b.inputs['Normal'])
    return m


def ember(name='ember', strength=18.0):
    m, nt, b = mats.new(name); L = nt.links
    w = mats.coords(nt)
    n = mats.noise(nt, w, 6.0, 4.0, 0.6, (-1000, 300))
    b.inputs['Base Color'].default_value = (0.02, 0.01, 0.005, 1)
    b.inputs['Emission Color'].default_value = (1.0, 0.32, 0.06, 1)
    L.new(mats.maprange(nt, n.outputs['Fac'], 0.35, 0.75, 0.0, strength), b.inputs['Emission Strength'])
    return m


def earth(name='earth'):
    m, nt, b = mats.new(name); L = nt.links
    w = mats.coords(nt, space='Object')
    n1 = mats.noise(nt, w, 0.35, 6.0, 0.62, (-1000, 300))
    n2 = mats.noise(nt, w, 4.0, 5.0, 0.6, (-1000, 100))
    n3 = mats.noise(nt, w, 40.0, 3.0, 0.6, (-1000, -100))
    c = mats.mix_rgb(nt, mats.LIN((52, 44, 32)), mats.LIN((40, 44, 28)), mats.maprange(nt, n1.outputs['Fac'], 0.4, 0.6), 'MIX', (-400, 300))
    c = mats.mix_rgb(nt, c, mats.LIN((24, 21, 17)), mats.maprange(nt, n2.outputs['Fac'], 0.45, 0.7), 'MIX', (-200, 300))
    L.new(c, b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.95
    L.new(mats.bump_chain(nt, [(n2.outputs['Fac'], 0.5, 0.05), (n3.outputs['Fac'], 0.4, 0.01)]), b.inputs['Normal'])
    return m


steel, ember_m, ground_m = burnt_steel(), ember(), earth()
rubber = burnt_steel('tracks')

# ---------------------------------------------------------------- the tank: the library's burnt Panzer IV G
# (tools/blender/vehicles/armour/scripts/pz4.py, assets/models/vehicles/armour/panzer4_g_burnt.glb: scorched paint,
# hatches thrown open), decoded to a plain GLB by glb_plain.mjs, then knocked about further for the key art: the gun
# lifted, the near track sagging off its front run with a road wheel blown off, two penetrations ringed with hot
# metal, and the fire's sources lit inside (engine deck, open hatches, a fuel pool burning underneath).
REPO = os.path.abspath(os.path.join(HERE, '../../../..'))
GLB = os.path.join(tempfile.gettempdir(), 'backdrop_panzer4_g_burnt.glb')
subprocess.run(['node', os.path.join(HERE, 'glb_plain.mjs'), os.path.join(REPO, 'assets/models/vehicles/armour/panzer4_g_burnt.glb'), GLB], check=True)
T = bpy.data.objects.new('tank', None); col.objects.link(T)
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=GLB)
parts = {o.name: o for o in bpy.data.objects if o not in before}
for o in parts.values():
    if o.parent is None: o.parent = T
P_ = lambda n: parts.get(n)
# Blender frame of the GLB: +x vehicle left, -y front, z up. Gun lifted a little more than the burnt pose leaves it.
if P_('gun'): P_('gun').rotation_euler.rotate_axis('X', math.radians(9))
# the near (right) track has been thrown: its loop sags off the front run and a length of it lies unrolled on the
# ground ahead of the sprocket; wheel R1 is blown off and lies by the hull
if P_('track_R'):
    tr = P_('track_R'); tr.location.z -= 0.09; tr.rotation_euler.rotate_axis('X', math.radians(-4.5))
    src_ = tr if tr.type == 'MESH' else next((c for c in tr.children_recursive if c.type == 'MESH'), None)
    tm = src_.material_slots[0].material if src_ and src_.material_slots else rubber
    # the length lying flat ahead of the sprocket, links up, in the track's own material
    box('track_thrown', (0.40, 2.6, 0.035), (-1.3, -4.25, 0.03), rot=(0, 0, math.radians(-7)), mat=tm, parent=T, bevel=0.01)
if P_('wheel_R1'):
    w1 = P_('wheel_R1'); w1.location.x -= 0.55; w1.location.z -= 0.08; w1.rotation_euler.rotate_axis('Y', math.radians(70))
for n in ('roller_R1', 'hatch_side_R_f'):
    if P_(n): P_(n).hide_render = True


def disc(name, r, loc, normal, mat, parent=None, seg=24):
    """A flat disc (penetration hole / glow) at loc facing `normal` (tank frame)."""
    bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, segments=seg, radius=r)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); col.objects.link(o); o.data.materials.append(mat)
    o.location = loc; o.rotation_euler = Vector(normal).to_track_quat('Z', 'Y').to_euler(); o.parent = parent or T
    return o


hole_m = mats.new('hole')[0]; hole_m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.004, 0.003, 0.002, 1)
hot_m = ember('hot_rim', 0.9)
# two penetrations on the near (right, -x) side: turret flank and hull side behind the drive sprocket, each a
# small black hole in a ring of metal still dull red
for c, r in (((-0.99, 0.10, 2.18), 0.055), ((-1.47, -1.35, 1.25), 0.065)):
    disc('pen_rim', r * 1.45, c, (-1, 0, 0), hot_m)
    disc('pen_hole', r, (c[0] - 0.004, c[1], c[2]), (-1, 0, 0), hole_m)
# the fire's sources, glowing from inside: engine deck grilles (rear), the open turret and driver hatches, and the
# fuel burning under the hull (a low glow patch on the ground)
fire_m = ember('fire_src', 26.0)
# (positions measured on the imported parts: hull y -2.96 sprocket .. +2.66 idler, turret rear y 1.05, cupola hatches
#  y ~0.05 z 2.55, driver / radio hatches y -1.66 z 1.65)
for nm, size, loc in (('deck_glow', (1.5, 1.2), (0.0, 1.8, 1.70)), ('cupola_glow', (0.42, 0.42), (-0.05, 0.05, 2.52)),
                      ('driver_glow', (0.42, 0.32), (0.75, -1.66, 1.62)), ('radio_glow', (0.42, 0.32), (-0.75, -1.66, 1.62))):
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=loc); g_ = bpy.context.object; g_.name = nm
    g_.scale = (size[0], size[1], 1); g_.data.materials.append(fire_m); g_.parent = T
    g_.visible_camera = False          # light only: the flames themselves are splash-fx.js's, animated
bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0.0, 0.9, 0.03)); pool = bpy.context.object; pool.name = 'fuel_pool'
pool.scale = (3.2, 3.6, 1); pool.data.materials.append(ember('fuel', 6.0)); pool.parent = T; pool.visible_camera = False
# soot: the paint darkens towards the top, where the fire has been licking (turret, deck, upper hull)
for m in {sl.material for o in parts.values() if o.type == 'MESH' for sl in o.material_slots if sl.material}:
    nt = m.node_tree; bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    lk = bsdf and next((l for l in nt.links if l.to_socket == bsdf.inputs['Base Color']), None)
    if not lk: continue
    geo = nt.nodes.new('ShaderNodeNewGeometry'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Position'], sep.inputs[0])                 # world: the tank stands at z 0
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 1.2; mr.inputs['From Max'].default_value = 2.6
    mr.inputs['To Min'].default_value = 0.0; mr.inputs['To Max'].default_value = 0.75; nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'
    nt.links.new(mr.outputs['Result'], mx.inputs[0]); nt.links.new(lk.from_socket, mx.inputs[6])
    mx.inputs[7].default_value = (0.05, 0.045, 0.04, 1); nt.links.new(mx.outputs[2], bsdf.inputs['Base Color'])
# the tank faces the camera's right, a little away; placed in the field (see camera below)
T.location = (5.63, 118.0, -0.05)       # a little nearer than the old silhouette: the real hull is shorter
T.rotation_euler = (math.radians(-1.0), math.radians(1.5), math.radians(96))
FIRE_SRC = {'deck': (0.0, 1.8, 1.72), 'cupola': (-0.05, 0.05, 2.62), 'radio': (-0.75, -1.66, 1.68), 'pool': (0.0, 0.9, 0.12)}

# ---------------------------------------------------------------- the field
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 120, 0))
gr = bpy.context.object; gr.name = 'ground'
sub = gr.modifiers.new('sub', 'SUBSURF'); sub.subdivision_type = 'SIMPLE'; sub.levels = sub.render_levels = 7
tex = bpy.data.textures.new('roll', 'CLOUDS'); tex.noise_scale = 18.0; tex.noise_depth = 3
dp = gr.modifiers.new('dp', 'DISPLACE'); dp.texture = tex; dp.strength = 0.5; dp.mid_level = 0.5
gr.data.materials.append(ground_m)
# a ragged hedgerow far off, to break the horizon: a strip of ground with noisy height (bushes, gaps, a few trees)
rng0 = np.random.default_rng(11)
nx, ny = 900, 6
xs = np.linspace(-260, 220, nx)
hgt = np.zeros(nx)
for f, amp in ((0.02, 1.4), (0.07, 0.9), (0.25, 0.5), (0.9, 0.25)):
    hgt += amp * np.sin(xs * f + rng0.uniform(0, 6.28)) * np.sin(xs * f * 0.37 + rng0.uniform(0, 6.28))
hgt = np.clip(hgt + 1.4, 0, None)
for _ in range(6):                                       # a few trees
    c = rng0.uniform(-240, 200); hgt += 5.5 * np.exp(-((xs - c) / rng0.uniform(3, 6)) ** 2)
hgt[(xs > 10) & (xs < 40)] *= 0.25                       # open behind the wreck
hgt *= 0.8
bm = bmesh.new()
rows = []
for j in range(ny):
    yy = 400 + j * 4.0
    k = math.sin(math.pi * j / (ny - 1))
    rows.append([bm.verts.new((xs[i], yy, hgt[i] * k + rng0.uniform(0, 0.4) * k)) for i in range(nx)])
for j in range(ny - 1):
    for i in range(nx - 1):
        bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
me = bpy.data.meshes.new('hedge'); bm.to_mesh(me); bm.free()
hedge = bpy.data.objects.new('hedge', me); col.objects.link(hedge); hedge.data.materials.append(ground_m)
# debris and stones round the wreck
rng = np.random.default_rng(4)
for i in range(40):
    r = rng.uniform(4, 16); a = rng.uniform(0, 2 * math.pi)
    p = (5.63 + r * math.cos(a), 118.0 + r * math.sin(a) * 0.6, 0.0)
    s_ = rng.uniform(0.06, 0.3)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=s_, location=p)
    st = bpy.context.object; st.scale = (1.0, rng.uniform(0.6, 1.4), rng.uniform(0.3, 0.7))
    st.rotation_euler = tuple(rng.uniform(0, 3, 3)); st.data.materials.append(steel if i % 4 == 0 else ground_m)

# ---------------------------------------------------------------- light, haze, camera
def light(name, kind, loc, energy, color, size=1.0, tgt=None):
    d = bpy.data.lights.new(name, kind); d.energy = energy; d.color = color
    if kind == 'AREA': d.size = size
    else: d.shadow_soft_size = size
    o = bpy.data.objects.new(name, d); col.objects.link(o); o.location = loc
    if tgt is not None: o.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o


# the fire's own light, from its sources: over the engine deck and the turret, and the fuel pool under the hull
bpy.context.view_layer.update()
MW = T.matrix_world
light('fire_core', 'POINT', tuple(MW @ Vector((0.0, 1.6, 3.5))), 5200, (1.0, 0.42, 0.12), 1.4)
light('fire_turret', 'POINT', tuple(MW @ Vector((-0.05, 0.05, 3.4))), 1800, (1.0, 0.45, 0.14), 0.8)
light('fire_low', 'POINT', tuple(MW @ Vector((0.0, 0.9, 0.45))), 1600, (1.0, 0.35, 0.1), 2.0)
light('moon', 'SUN', (0, 0, 10), 0.12, (0.55, 0.66, 1.0)).rotation_euler = (math.radians(55), 0, math.radians(-150))
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.012, 0.012, 0.016, 1)
# low haze: a volume slab over the field, glowing where the fire light passes
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 90, 3.0)); hz = bpy.context.object; hz.name = 'haze'
hz.scale = (200, 160, 6.0)
hm = bpy.data.materials.new('haze'); hm.use_nodes = True; nt = hm.node_tree; nt.nodes.remove(nt.nodes['Principled BSDF'])
vs = nt.nodes.new('ShaderNodeVolumeScatter'); vs.inputs['Density'].default_value = 0.0008; vs.inputs['Anisotropy'].default_value = 0.4
nt.links.new(vs.outputs[0], nt.nodes['Material Output'].inputs['Volume']); hz.data.materials.append(hm)
cd = bpy.data.cameras.new('cam'); cd.lens = 150; cd.sensor_width = 36; cd.sensor_fit = 'HORIZONTAL'
cd.shift_y = 0.178                       # the horizon at 81.7 % down the frame, like sky.svg
cam = bpy.data.objects.new('cam', cd); col.objects.link(cam)
cam.location = (0.0, 0.0, 0.35); cam.rotation_euler = (math.radians(90), 0, 0)
sc.camera = cam
rutil.setup(SPP)
sc.render.film_transparent = True
sc.render.resolution_x, sc.render.resolution_y = W, H
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
# where the fire's sources land in the frame (x from the left, y from the bottom, 0..1), for splash-fx.js
from bpy_extras.object_utils import world_to_camera_view
bpy.context.view_layer.update()
proj = {}
for k, v in FIRE_SRC.items():
    c = world_to_camera_view(sc, cam, T.matrix_world @ Vector(v)); proj[k] = [round(c.x, 4), round(c.y, 4)]
span = [world_to_camera_view(sc, cam, T.matrix_world @ Vector(v)) for v in ((0, -2.95, 1.0), (0, 2.95, 1.0))]
proj['tank_len'] = round(abs(span[1].x - span[0].x), 4)
with open(OUT.replace('.png', '.fire.json'), 'w') as fh: json.dump(proj, fh, indent=1)
print('FIRE', proj)
rutil.render(OUT)
if '--save' in argv: bpy.ops.wm.save_as_mainfile(filepath=OUT.replace('.png', '.blend'))
