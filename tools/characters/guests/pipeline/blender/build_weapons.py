# build_weapons.py - period weapons + commando kit as props with sockets -> out/weapons.glb (one atlas, one material)
# Weapon space: origin = right-hand grip; forward = muzzle; glTF: +Z forward, +Y up (Blender: -Y forward, +Z up).
# Sockets (empties, children of each weapon): grip_r, grip_l (fore-stock / support hand), butt, muzzle, sling_f, sling_b
# usage: tools/bl.sh blender/build_weapons.py <out_dir>
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import bmesh, geo, bake
import materials as MT
from uniform import lin
from mathutils import Vector, Matrix

MATS = {}
def M(k):
    if k not in MATS:
        MATS[k] = {'wood': lambda: MT.solid('w_wood', lin((0.32, 0.18, 0.09)), rough=0.5, bump=0.15, noise_scale=40),
                   'dark_wood': lambda: MT.solid('w_dwood', lin((0.26, 0.15, 0.08)), rough=0.5, bump=0.12, noise_scale=40),
                   'steel': lambda: MT.metal('w_steel', lin((0.16, 0.16, 0.17)), rough=0.38, metal=0.85),
                   'bright': lambda: MT.metal('w_bright', lin((0.62, 0.62, 0.64)), rough=0.25, metal=1.0),
                   'bakelite': lambda: MT.solid('w_bakelite', lin((0.10, 0.07, 0.05)), rough=0.35, bump=0.05),
                   'olive': lambda: MT.paint('w_olive', lin((0.27, 0.29, 0.19))),
                   'fgrey': lambda: MT.paint('w_fgrey', lin((0.38, 0.40, 0.34))),
                   'canvas': lambda: MT.fabric('w_canvas', lin((0.52, 0.47, 0.32)), kind='canvas'),
                   'leather': lambda: MT.leather('w_leather', lin((0.30, 0.18, 0.09))),
                   'brass': lambda: MT.metal('w_brass', lin((0.70, 0.56, 0.30)), rough=0.35),
                   'glass': lambda: MT.solid('w_glass', lin((0.55, 0.62, 0.60)), rough=0.05),
                   'red': lambda: MT.paint('w_red', lin((0.55, 0.08, 0.06)))}[k]()
    return MATS[k]


def P(s, f, u):
    return Vector((s, -f, u))


class W:
    def __init__(self, name):
        self.name = name; self.parts = {}; self.sockets = {}

    def _bm(self, mat):
        return self.parts.setdefault(mat, bmesh.new())

    def box(self, mat, size_sfu, at_sfu, rx=0, bevel=0.002):
        # rx: pitch (deg) about the side axis
        Mx = geo.M_at(P(*at_sfu)) @ Matrix.Rotation(math.radians(rx), 4, 'X')
        geo.add_box(self._bm(mat), (size_sfu[0], size_sfu[1], size_sfu[2]), Mx, bevel=bevel)
        return self

    def cyl(self, mat, r, length, at_sfu, axis='f', r2=None, segs=10, rx=0):
        R = {'f': Matrix.Rotation(math.radians(90), 4, 'X'), 'u': Matrix.Identity(4), 's': Matrix.Rotation(math.radians(90), 4, 'Y')}[axis]
        Mx = geo.M_at(P(*at_sfu)) @ Matrix.Rotation(math.radians(rx), 4, 'X') @ R
        geo.add_cyl(self._bm(mat), r, r if r2 is None else r2, length, Mx, segs=segs)
        return self

    def sock(self, name, s, f, u):
        self.sockets[name] = P(s, f, u); return self

    def build(self, x_offset):
        objs = []
        for mat, bm in self.parts.items():
            o = geo.obj_from_bm(f'{self.name}__{mat}', bm, M(mat))
            objs.append(o)
        o = bake.join(objs, self.name) if len(objs) > 1 else objs[0]
        o.name = self.name
        o['weapon'] = self.name
        return o


def kar98k():
    w = W('kar98k')
    w.box('wood', (0.042, 0.30, 0.13), (0, -0.19, -0.05), rx=-8)                 # butt stock
    w.box('wood', (0.034, 0.10, 0.05), (0, -0.01, -0.035), rx=-25)              # wrist
    w.box('wood', (0.038, 0.62, 0.05), (0, 0.33, -0.008))                        # fore-stock
    w.box('wood', (0.03, 0.30, 0.02), (0, 0.46, 0.028))                          # hand guard
    w.cyl('steel', 0.0105, 0.36, (0, 0.10, 0.03), segs=10)                       # receiver
    w.cyl('steel', 0.0085, 0.62, (0, 0.52, 0.028), r2=0.0075, segs=8)            # barrel
    w.cyl('steel', 0.004, 0.05, (-0.03, 0.06, 0.03), axis='s', segs=6)           # bolt handle (right side)
    w.cyl('steel', 0.007, 0.012, (-0.055, 0.06, 0.028), axis='s', segs=8)
    w.box('steel', (0.02, 0.05, 0.03), (0, 0.02, -0.012))                        # trigger guard/magazine
    w.box('steel', (0.026, 0.02, 0.022), (0, 0.62, 0.02))                        # nose cap + bands
    w.box('steel', (0.028, 0.012, 0.05), (0, 0.46, 0.0))
    w.box('steel', (0.006, 0.01, 0.018), (0, 0.815, 0.045))                      # front sight
    w.box('steel', (0.036, 0.012, 0.13), (0, -0.335, -0.075), rx=-8, bevel=0.001)  # butt plate
    w.sock('grip_r', 0, 0, 0).sock('grip_l', 0, 0.34, -0.012).sock('butt', 0, -0.34, -0.06).sock('muzzle', 0, 0.83, 0.028)
    w.sock('sling_f', 0, 0.45, -0.04).sock('sling_b', 0, -0.22, -0.1)
    return w


def mp40():
    w = W('mp40')
    w.cyl('steel', 0.019, 0.28, (0, 0.10, 0.045), segs=12)                       # receiver tube
    w.cyl('steel', 0.011, 0.2, (0, 0.33, 0.045), segs=8)                         # barrel
    w.box('steel', (0.03, 0.035, 0.08), (0, 0.19, -0.02))                        # magazine housing
    w.box('steel', (0.028, 0.03, 0.22), (0, 0.19, -0.14), rx=0)                  # magazine
    w.box('bakelite', (0.03, 0.045, 0.1), (0, 0.0, -0.035), rx=-12)             # pistol grip
    w.box('bakelite', (0.034, 0.12, 0.04), (0, 0.07, 0.012))                     # lower receiver
    w.box('steel', (0.012, 0.26, 0.012), (0.018, -0.14, 0.02))                   # folded stock arms
    w.box('steel', (0.012, 0.26, 0.012), (-0.018, -0.14, 0.02))
    w.box('steel', (0.05, 0.015, 0.03), (0, -0.265, -0.02))                      # butt plate (folded under)
    w.box('steel', (0.02, 0.03, 0.012), (0, 0.44, 0.02))                         # barrel rest
    w.sock('grip_r', 0, 0, 0).sock('grip_l', 0, 0.19, -0.03).sock('butt', 0, -0.13, 0.03).sock('muzzle', 0, 0.44, 0.045)
    w.sock('sling_f', 0, 0.3, 0.02).sock('sling_b', 0, -0.2, 0.02)
    return w


def mg(name='mg34'):
    w = W(name)
    jacket_r = 0.022 if name == 'mg34' else 0.024
    w.box('bakelite' if name == 'mg42' else 'wood', (0.04, 0.3, 0.1), (0, -0.2, -0.02), rx=-4)     # butt
    w.box('bakelite', (0.03, 0.045, 0.1), (0, 0.0, -0.04), rx=-12)                # pistol grip
    w.box('steel', (0.05, 0.28, 0.065), (0, 0.14, 0.03))                          # receiver / feed cover
    w.cyl('steel', jacket_r, 0.5, (0, 0.53, 0.04), segs=12 if name == 'mg34' else 6)   # barrel jacket
    w.cyl('steel', 0.009, 0.14, (0, 0.84, 0.04), segs=8)                           # muzzle
    w.box('steel', (0.02, 0.02, 0.26), (0.05, 0.7, -0.12), rx=20).box('steel', (0.02, 0.02, 0.26), (-0.05, 0.7, -0.12), rx=20)   # bipod
    w.box('brass', (0.08, 0.02, 0.012), (-0.045, 0.18, 0.005))                     # belt of rounds stub
    w.box('steel', (0.018, 0.12, 0.018), (0, 0.3, 0.08))                           # carry handle
    w.sock('grip_r', 0, 0, 0).sock('grip_l', 0, -0.18, 0.02).sock('butt', 0, -0.35, 0.0).sock('muzzle', 0, 0.92, 0.04)
    w.sock('bipod', 0, 0.72, -0.24)
    return w


def pistol(name):
    w = W(name)
    if name == 'luger':
        w.box('dark_wood', (0.026, 0.035, 0.11), (0, 0.0, -0.045), rx=-30)       # raked grip
        w.box('steel', (0.024, 0.11, 0.03), (0, 0.045, 0.02))
        w.cyl('steel', 0.0065, 0.11, (0, 0.14, 0.024), segs=8)
        w.box('steel', (0.02, 0.03, 0.02), (0, -0.02, 0.04))                      # toggle
        muzzle = 0.2
    else:   # walther_p38 / colt1911
        w.box('bakelite' if name == 'walther_p38' else 'dark_wood', (0.028, 0.04, 0.11), (0, 0.0, -0.045), rx=-15)
        w.box('steel', (0.026, 0.2, 0.033), (0, 0.07, 0.022))
        muzzle = 0.17
    w.box('steel', (0.006, 0.03, 0.02), (0, 0.035, -0.02))                         # trigger guard
    w.sock('grip_r', 0, 0, 0).sock('grip_l', 0, -0.01, -0.05).sock('muzzle', 0, muzzle, 0.024)
    return w


def enfield_sniper():
    w = kar98k(); w.name = 'no4_sniper'
    w.box('dark_wood', (0.02, 0.1, 0.03), (0, -0.16, 0.035))                         # cheek rest
    w.cyl('steel', 0.013, 0.30, (0, 0.10, 0.085), segs=10)                           # scope tube
    w.cyl('steel', 0.019, 0.06, (0, 0.24, 0.085), r2=0.014, segs=10)                  # objective bell
    w.cyl('steel', 0.017, 0.05, (0, -0.04, 0.085), segs=10)                           # eyepiece
    w.box('steel', (0.015, 0.14, 0.04), (0, 0.10, 0.055))                             # mount
    w.sockets['scope'] = P(0, -0.07, 0.085)
    return w


def thompson():
    w = W('thompson')
    w.box('wood', (0.04, 0.26, 0.11), (0, -0.19, -0.03), rx=-6)
    w.box('wood', (0.03, 0.045, 0.1), (0, 0.0, -0.045), rx=-12)
    w.box('steel', (0.045, 0.24, 0.06), (0, 0.1, 0.025))
    w.cyl('steel', 0.012, 0.28, (0, 0.34, 0.03), segs=8)
    w.box('wood', (0.035, 0.05, 0.09), (0, 0.24, -0.035), rx=10)                    # fore grip
    w.cyl('steel', 0.055, 0.03, (0, 0.14, -0.08), axis='s', segs=14)                 # drum
    w.sock('grip_r', 0, 0, 0).sock('grip_l', 0, 0.24, -0.06).sock('butt', 0, -0.32, -0.04).sock('muzzle', 0, 0.48, 0.03)
    return w


def knife():
    w = W('knife')                                                                   # Fairbairn-Sykes pattern
    w.cyl('brass', 0.011, 0.11, (0, 0.0, 0.0), r2=0.008, segs=10)                    # ribbed grip
    w.box('steel', (0.05, 0.006, 0.012), (0, 0.06, 0.0))                             # guard
    w.box('bright', (0.022, 0.17, 0.004), (0, 0.15, 0.0), bevel=0.001)              # blade
    w.cyl('bright', 0.002, 0.03, (0, 0.245, 0.0), r2=0.0003, segs=4)                 # tip
    w.sock('grip_r', 0, 0, 0).sock('tip', 0, 0.26, 0)
    return w


def harpoon():
    w = W('harpoon_gun')
    w.cyl('steel', 0.018, 0.55, (0, 0.28, 0.03), segs=10)
    w.box('dark_wood', (0.03, 0.045, 0.11), (0, 0.0, -0.045), rx=-15)
    w.box('dark_wood', (0.035, 0.22, 0.06), (0, -0.14, 0.0))
    w.cyl('bright', 0.004, 0.62, (0, 0.33, 0.058), segs=6)                           # spear
    w.cyl('bright', 0.009, 0.05, (0, 0.66, 0.058), r2=0.001, segs=6)
    w.sock('grip_r', 0, 0, 0).sock('grip_l', 0, 0.3, 0.0).sock('butt', 0, -0.25, 0.0).sock('muzzle', 0, 0.69, 0.058)
    return w


def syringe():
    w = W('syringe')
    w.cyl('glass', 0.008, 0.08, (0, 0.03, 0.0), segs=8)
    w.cyl('bright', 0.0012, 0.04, (0, 0.09, 0.0), segs=4)
    w.cyl('bright', 0.003, 0.05, (0, -0.03, 0.0), segs=6)
    w.box('bright', (0.024, 0.004, 0.012), (0, -0.056, 0.0))
    w.sock('grip_r', 0, 0, 0).sock('tip', 0, 0.11, 0)
    return w


def time_bomb():
    w = W('time_bomb')
    w.box('olive', (0.16, 0.1, 0.08), (0, 0, 0.04), bevel=0.006)
    w.cyl('bright', 0.028, 0.012, (0, -0.05, 0.05), axis='f', segs=12)             # clock face
    w.box('red', (0.18, 0.02, 0.01), (0, 0.02, 0.083))                              # strap
    w.sock('grip_r', 0, 0, 0.04)
    return w


def remote_bomb():
    w = W('remote_bomb')
    w.box('fgrey', (0.14, 0.1, 0.07), (0, 0, 0.035), bevel=0.006)
    w.cyl('steel', 0.002, 0.2, (0.05, 0.03, 0.17), axis='u', segs=4)
    w.sock('grip_r', 0, 0, 0.035)
    return w


def stick_grenade():
    w = W('stick_grenade')
    w.cyl('wood', 0.012, 0.27, (0, 0.0, 0.0), segs=8)
    w.cyl('fgrey', 0.034, 0.1, (0, 0.17, 0.0), segs=10)
    w.sock('grip_r', 0, -0.08, 0)
    return w


BUILD = [kar98k, mp40, lambda: mg('mg34'), lambda: mg('mg42'), lambda: pistol('luger'), lambda: pistol('walther_p38'),
         lambda: pistol('colt1911'), enfield_sniper, thompson, knife, harpoon, syringe, time_bomb, remote_bomb, stick_grenade]

if __name__ == '__main__':
    out = os.path.abspath(args()[0]); os.makedirs(out, exist_ok=True)
    clean_scene()
    ws = [f() for f in BUILD]
    objs = []
    for i, w in enumerate(ws):
        o = w.build(0)
        o.data.transform(Matrix.Translation((i * 1.5, 0, 0)))    # apart while baking AO
        g = o.vertex_groups.new(name='wpn_' + w.name); g.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
        objs.append(o)
    joined = bake.join(objs, 'weapons_all')
    joined['neck_z'] = 99.0     # no skin boost
    bake.atlas_uv(joined, head_boost=1.0)
    A, N, O = bake.bake_atlas(joined, out, 'weapons', size=1024, out_size=512, samples_ao=16)
    am = bake.atlas_material('weapons_atlas', A, N, O)
    bake.finalize_atlas_mesh(joined, am)
    # split back into one mesh per weapon, add socket empties
    for i, w in enumerate(ws):
        gi = joined.vertex_groups['wpn_' + w.name].index
        activate(joined)
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='DESELECT'); bpy.ops.object.mode_set(mode='OBJECT')
        for v in joined.data.vertices:
            v.select = any(g.group == gi and g.weight > 0.5 for g in v.groups)
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.separate(type='SELECTED'); bpy.ops.object.mode_set(mode='OBJECT')
        o = [x for x in bpy.context.selected_objects if x is not joined][0]
        o.name = w.name
        o.vertex_groups.clear()
        o.data.transform(Matrix.Translation((-i * 1.5, 0, 0)))
        for sn, p in w.sockets.items():
            e = bpy.data.objects.new(f'{w.name}.{sn}', None); bpy.context.scene.collection.objects.link(e)
            e.parent = o; e.location = p
        log('weapon', w.name, tri_count(o), 'tris', sorted(w.sockets))
    bpy.data.objects.remove(joined, do_unlink=True)
    for o in bpy.data.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, 'weapons.glb'), export_format='GLB', use_selection=True,
                              export_image_format='JPEG', export_jpeg_quality=88, export_extras=True, export_yup=True)
    log('EXPORTED', os.path.getsize(os.path.join(out, 'weapons.glb')))
