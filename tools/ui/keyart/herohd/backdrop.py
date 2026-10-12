"""The title splash's ground plate: the burning tank and the field it stands in, rendered to sit over sky.svg (same
16:9 framing and 'cover' scaling, so the WebGL fire of splash-fx.js keeps landing on its engine deck) and under the hero.
  blender -b --factory-startup --python tools/ui/keyart/herohd/backdrop.py -- <out.png> [W H samples]
Then variants.py --plate. Everything procedural (own work): a long-barrelled medium tank in the Panzer IV mould
(no markings), knocked out and burning, skirts torn away, gun lifted; a churned field with track ruts, grass, debris,
low ground haze. Transparent above the horizon, where the SVG sky, smoke and searchlight show through."""
import bpy, bmesh, sys, os, math
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

# ---------------------------------------------------------------- the tank (x along the hull, front at -x; z up)
T = bpy.data.objects.new('tank', None); col.objects.link(T)
L_, Wd = 5.9, 2.88
box('hull_low', (L_, 1.9, 0.9), (0, 0, 0.95), mat=steel, parent=T)
hull = box('hull_up', (4.6, Wd, 0.62), (0.45, 0, 1.68), mat=steel, parent=T)
glacis = box('glacis', (1.1, 1.9, 0.62), (-2.75, 0, 1.12), rot=(0, math.radians(-22), 0), mat=steel, parent=T)
box('driver_plate', (0.25, Wd, 0.6), (-1.85, 0, 1.68), rot=(0, math.radians(-10), 0), mat=steel, parent=T)
box('engine_deck', (1.9, 2.4, 0.14), (2.0, 0, 2.03), mat=steel, parent=T)
box('deck_grille', (0.9, 1.6, 0.06), (2.2, 0, 2.12), mat=ember_m, parent=T, bevel=0.0)   # glowing: the engine is on fire
for s in (-1, 1):
    # track run: sprocket front, idler rear, 8 road wheels in pairs, 4 return rollers, the track loop over them
    y = s * 1.2
    cyl('sprocket', 0.42, 0.42, (-2.62, y, 0.75), (math.pi / 2, 0, 0), steel, 18, T, 0.02)
    cyl('idler', 0.4, 0.4, (2.75, y, 0.72), (math.pi / 2, 0, 0), steel, 18, T, 0.02)
    for i in range(8):
        cyl('road', 0.235, 0.36, (-1.95 + i * 0.6, y, 0.35), (math.pi / 2, 0, 0), steel, 20, T, 0.02)
    for i in range(4):
        cyl('return', 0.11, 0.3, (-1.6 + i * 1.15, y, 1.12), (math.pi / 2, 0, 0), steel, 12, T, 0.01)
    # track: a ribbon round the run, with grousers
    pts = []
    for i in range(48):
        a = 2 * math.pi * i / 48
        cx = -2.62 if math.cos(a) < 0 else 2.75
        pts.append((cx + 0.47 * math.cos(a) * (1.0) + math.cos(a) * 0.0, 0.0, 0.75 + 0.47 * math.sin(a)))
    bm = bmesh.new()
    loop = []
    for i in range(160):
        t = i / 160
        # rounded-rectangle side profile
        per = 2 * 5.37 + 2 * math.pi * 0.47
        d = t * per
        if d < 5.37: p = (-2.62 + d, 0.28 + 0.0)
        elif d < 5.37 + math.pi * 0.47:
            a = -math.pi / 2 + (d - 5.37) / 0.47; p = (2.75 + 0.47 * math.cos(a), 0.75 + 0.47 * math.sin(a))
        elif d < 2 * 5.37 + math.pi * 0.47:
            dd = d - 5.37 - math.pi * 0.47; p = (2.75 - dd, 1.22 - 0.06 * math.sin(math.pi * dd / 5.37))
        else:
            a = math.pi / 2 + (d - 2 * 5.37 - math.pi * 0.47) / 0.47; p = (-2.62 + 0.47 * math.cos(a), 0.75 + 0.47 * math.sin(a))
        g = 0.025 if (i % 2 == 0) else 0.0
        loop.append(p + (g,))
    vs = []
    for (x, z, g) in loop:
        vs.append((bm.verts.new((x, y - 0.22, z)), bm.verts.new((x, y + 0.22, z))))
    for i in range(len(vs)):
        a, b2 = vs[i], vs[(i + 1) % len(vs)]
        bm.faces.new((a[0], b2[0], b2[1], a[1]))
    me = bpy.data.meshes.new('track'); bm.to_mesh(me); bm.free()
    tr = bpy.data.objects.new('track', me); col.objects.link(tr); tr.parent = T
    sd = tr.modifiers.new('sd', 'SOLIDIFY'); sd.thickness = 0.06
    tr.data.materials.append(rubber)
    # side skirts: rail + a few plates left, one hanging askew, the rest torn off
    box('skirt_rail', (4.6, 0.05, 0.05), (0.2, s * 1.55, 1.62), mat=steel, parent=T, bevel=0.0)
    for k, (x0, rz, drop) in enumerate(((-1.6, 0.0, 0.0), (-0.6, 0.05, 0.0), (1.4, -0.35, 0.18))):
        if s > 0 and k == 1: continue
        box('skirt', (0.95, 0.012, 0.95), (x0, s * 1.6, 1.15 - drop), rot=(0, rz, 0), mat=steel, parent=T, bevel=0.0)
# turret, traversed a little, gun lifted (as the SVG silhouette: barrel up to the right)
TT = bpy.data.objects.new('turret', None); col.objects.link(TT); TT.parent = T
TT.location = (0.1, 0, 2.0); TT.rotation_euler = (0, 0, math.radians(8))
tur = box('turret_body', (2.3, 1.85, 0.78), (0.15, 0, 0.42), mat=steel, parent=TT, bevel=0.06)
box('turret_front', (0.4, 1.4, 0.7), (-1.0, 0, 0.4), rot=(0, math.radians(-12), 0), mat=steel, parent=TT)
cyl('cupola', 0.36, 0.32, (1.0, 0, 0.92), (0, 0, 0), steel, 20, TT, 0.02)
box('hatch', (0.45, 0.7, 0.04), (0.7, 0.62, 0.95), rot=(math.radians(70), 0, 0), mat=steel, parent=TT)
box('hatch_glow', (0.5, 0.5, 0.02), (0.6, 0.55, 0.82), mat=ember_m, parent=TT, bevel=0.0)
G = bpy.data.objects.new('gun', None); col.objects.link(G); G.parent = TT
G.location = (-1.15, 0, 0.45); G.rotation_euler = (0, math.radians(-14), 0)
box('mantlet', (0.35, 0.6, 0.5), (-0.1, 0, 0), mat=steel, parent=G)
cyl('barrel', 0.075, 4.3, (-2.3, 0, 0), (0, math.pi / 2, 0), steel, 18, G)
cyl('muzzle_brake', 0.13, 0.32, (-4.5, 0, 0), (0, math.pi / 2, 0), steel, 18, G, 0.01)
# kit on the hull: exhausts, spare track links on the glacis, tow cables, an aerial; the mudguards
for s in (-1, 1):
    box('mudguard', (5.4, 0.42, 0.03), (0.2, s * 1.25, 1.42), mat=steel, parent=T, bevel=0.0)
    cyl('exhaust', 0.07, 0.6, (3.0, s * 0.45, 1.25), (0, math.pi / 2, 0), steel, 12, T)
    for k in range(3):
        box('spare_link', (0.12, 0.38, 0.06), (-2.55 + k * 0.05, s * 0.55, 1.35 + k * 0.13), rot=(0, math.radians(-22), 0), mat=rubber, parent=T, bevel=0.0)
cyl('tow_cable', 0.025, 4.0, (0.4, 1.47, 1.8), (0, math.pi / 2, 0), steel, 8, T)
cyl('aerial', 0.008, 2.0, (2.3, -1.2, 2.9), (math.radians(8), math.radians(-14), 0), steel, 6, T)
cyl('spare_wheel', 0.235, 0.12, (1.6, -1.47, 1.9), (math.pi / 2, 0, 0), steel, 18, T)
# the tank faces the camera's left; placed in the field (see camera below)
T.location = (6.2, 130.0, -0.05)
T.rotation_euler = (math.radians(-1.5), math.radians(2.5), math.radians(186))

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
    p = (6.2 + r * math.cos(a), 130.0 + r * math.sin(a) * 0.6, 0.0)
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


light('fire_core', 'POINT', (6.8, 130.5, 3.4), 6000, (1.0, 0.42, 0.12), 1.4)
light('fire_low', 'POINT', (7.7, 129.0, 1.0), 1500, (1.0, 0.35, 0.1), 2.5)
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
rutil.render(OUT)
if '--save' in argv: bpy.ops.wm.save_as_mainfile(filepath=OUT.replace('.png', '.blend'))
