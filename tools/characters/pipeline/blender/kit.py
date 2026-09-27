# kit.py - uniform details (pockets, buttons, straps, insignia WITHOUT swastikas) + belt kit, conformed to the garments.
import bpy, bmesh, math
from mathutils import Vector, Matrix
from common import *
import geo
import materials as MT
from uniform import lin

MAT = {}


def mat(key, maker):
    if key not in MAT or MAT[key].name not in bpy.data.materials:
        MAT[key] = maker()
    return MAT[key]


class Kit:
    def __init__(self, ctx, garments):
        self.ctx, self.m = ctx, ctx.m
        self.garments = {g.name: g for g in garments}
        surf = [g for g in garments if g.get('garment') in ('top',)]
        self.top = surf[-1] if surf else ctx.human
        self.tree = geo.bvh_of([self.top] + [g for g in garments if g.get('garment') == 'legs'])
        self.torso_tree = geo.bvh_of([self.top])
        band = [v.co for v in self.top.data.vertices if abs(v.co.z - self.m['belt_z']) < 0.015]
        self.cy = sum(c.y for c in band) / max(1, len(band)) if band else 0.0
        self.objs = []

    # torso-axis helpers ------------------------------------------------------------
    def inward(self, p):
        return Vector((0, self.cy, p.z)) - Vector((p.x, p.y, p.z))

    def at_angle(self, z, deg, tree=None):
        """surface point on the torso at height z and angle deg (0 = front, +90 = character's left)."""
        a = math.radians(deg)
        d = Vector((math.sin(a), -math.cos(a), 0))
        p = Vector((0, self.cy, z)) + d * 0.6
        hit, n = geo.project(tree or self.torso_tree, p, -d, far=0.6)
        return (hit or p), (n or d)

    def finish(self, bm, name, material, weights='top', bone=None):
        o = geo.obj_from_bm(name, bm, material, recalc=not name.startswith('headgear'))
        if bone:
            geo.rigid_weights(o, bone, self.ctx.rig)
        else:
            geo.transfer_weights(o, self.top if weights == 'top' else self.ctx.human, self.ctx.rig)
        self.objs.append(o)
        return o

    # tunic details --------------------------------------------------------------------
    def tunic_details(self, cloth_mat, pleated=True, collar_col=None, tabs=True, straps=True, buttons=True, lower_pockets=True):
        m, t = self.m, self.torso_tree
        bm = bmesh.new()
        chest_z = self.ctx.bone['spine_03'][0].z + 0.03
        belt = m['belt_z']
        pk = [(0.085, chest_z, 0.115, 0.13, 0.12, 0.05)]
        if lower_pockets:
            pk.append((0.115, belt - 0.10, 0.16, 0.17, 0.165, 0.055))
        for x, z, w, h, fw, fh in pk:
            for s in (1, -1):
                c = Vector((s * x, self.cy - 0.5, z))
                pleat = (lambda u, v: (0, 0, 0.004 if abs(u) < 0.1 else 0.0)) if pleated else None
                geo.conform_patch(bm, t, c, (0, 1, 0), (0, 0, 1), w, h, 0.004, 0.003, nu=3, nv=2, shape=pleat)
                # scalloped flap
                fl = lambda u, v: (0, (-0.012 if abs(u) < 0.15 and v < 0 else 0.0), 0.0)
                geo.conform_patch(bm, t, c + Vector((0, 0, h / 2 - fh / 2 + 0.008)), (0, 1, 0), (0, 0, 1), fw, fh, 0.008, 0.003, nu=4, nv=1, shape=fl)
                if buttons:
                    hit, n = geo.project(t, c + Vector((0, 0, h / 2 - fh + 0.005)), (0, 1, 0))
                    if hit:
                        geo.add_cyl(bm, 0.0075, 0.007, 0.005, geo.M_at(hit + n * 0.013, geo.frame(n)), segs=8)
        if buttons:   # front closure, slightly right of centre (wearer's right overlaps)
            top_z = m['neck_base_z'] - 0.04
            for k in range(5):
                z = top_z - k * (top_z - (belt - 0.12)) / 4
                hit, n = geo.project(t, Vector((-0.004, self.cy - 0.5, z)), (0, 1, 0))
                if hit:
                    geo.add_cyl(bm, 0.0085, 0.008, 0.006, geo.M_at(hit + n * 0.005, geo.frame(n)), segs=8)
        o = self.finish(bm, 'outfit_details', cloth_mat)
        # shoulder straps (Schulterklappen) + collar tabs in their own materials
        if straps:
            bm = bmesh.new()
            for s in (1, -1):
                sh = self.ctx.bone['upperarm_' + ('l' if s > 0 else 'r')][0]
                nk = self.ctx.bone['neck_01'][0]
                c = (sh * 0.62 + nk * 0.38); c = Vector((c.x, c.y, c.z + 0.25))
                geo.conform_patch(bm, t, c, (0, 0, -1), (s, 0, 0), 0.045, 0.11, 0.004, 0.004, nu=2, nv=3)
            self.finish(bm, 'outfit_straps', mat('strap', lambda: MT.fabric('strap', lin(collar_col or (0.30, 0.32, 0.27)), kind='wool')))
        if tabs:
            bm = bmesh.new()
            z = m['neck_base_z'] + 0.02
            for s in (1, -1):
                c = Vector((s * 0.045, self.cy - 0.5, z))
                geo.conform_patch(bm, t, c, (-s * 0.5, 1, 0), (0, 0, 1), 0.045, 0.02, 0.003, 0.002, nu=2, nv=1)
            self.finish(bm, 'outfit_tabs', mat('litzen', lambda: MT.fabric('litzen', lin((0.62, 0.64, 0.58)), kind='canvas', dirt=0)))
        return o

    # belts and straps -------------------------------------------------------------------
    def belt(self, material, z=None, width=0.048, buckle_mat=None, buckle=(0.058, 0.046)):
        z = z or self.m['belt_z']
        pts = []
        for k in range(28):
            p, n = self.at_angle(z, k * 360 / 28)
            pts.append(p)
        bm = bmesh.new()
        geo.ribbon(bm, self.tree, [p + (p - Vector((0, self.cy, z))).normalized() * 0.05 for p in pts], width, 0.004, 0.004,
                   towards=self.inward, closed=True)
        self.finish(bm, 'kit_belt', material)
        if buckle_mat:
            bm = bmesh.new()
            p, n = self.at_angle(z, 0)
            geo.add_box(bm, (buckle[0], 0.006, buckle[1]), geo.M_at(p + n * 0.011, geo.frame(n)), bevel=0.002)
            self.finish(bm, 'kit_buckle', buckle_mat)
        return z

    def ystraps(self, material, width=0.036, front_x=0.10, cross=False):
        """German Y-straps (cross=False) or British/commando braces crossing the chest (cross=True)."""
        m = self.m
        belt = m['belt_z']
        bm = bmesh.new()
        sh_z = max(v.co.z for v in self.top.data.vertices if abs(v.co.x) < 0.2)
        chest = self.ctx.bone['spine_03'][0].z
        for s in (1, -1):
            sx = s * 0.105
            if cross:   # front: from the belt on the far side, crossing at the sternum, over the shoulder
                front = [Vector((-s * front_x, self.cy - 0.5, belt + 0.03)), Vector((-s * 0.05, self.cy - 0.5, belt + 0.12)),
                         Vector((0, self.cy - 0.5, chest - 0.02)), Vector((s * 0.06, self.cy - 0.5, chest + 0.08)),
                         Vector((s * 0.09, self.cy - 0.5, chest + 0.15))]
            else:
                front = [Vector((s * front_x, self.cy - 0.5, belt + 0.03)), Vector((s * 0.1, self.cy - 0.5, belt + 0.16)),
                         Vector((s * 0.1, self.cy - 0.5, chest + 0.08)), Vector((s * 0.105, self.cy - 0.5, chest + 0.16))]
            top = [Vector((sx, self.cy - 0.06, sh_z + 0.1)), Vector((sx, self.cy, sh_z + 0.1)), Vector((sx, self.cy + 0.06, sh_z + 0.1))]
            back = [Vector((s * 0.1, self.cy + 0.5, chest + 0.1)), Vector((s * 0.05, self.cy + 0.5, chest - 0.04)), Vector((s * 0.012, self.cy + 0.5, chest - 0.12))]
            pts = self._dense(front + top + back)
            geo.ribbon(bm, self.torso_tree, pts, width, 0.006, 0.004, towards=lambda p: self._to_core(p))
        if not cross:   # single back strap from the ring to the belt
            pts = self._dense([Vector((0, self.cy + 0.5, chest - 0.12)), Vector((0, self.cy + 0.5, belt + 0.02))])
            geo.ribbon(bm, self.torso_tree, pts, width, 0.006, 0.004, towards=lambda p: self._to_core(p))
        self.finish(bm, 'kit_ystraps', material)

    def _to_core(self, p):
        chest = self.ctx.bone['spine_03'][0].z
        c = Vector((p.x * 0.4, self.cy, min(p.z, chest)))
        return c - p

    def _dense(self, pts, step=0.05):
        out = []
        for a, b in zip(pts, pts[1:]):
            n = max(1, int((b - a).length / step))
            for k in range(n):
                out.append(a.lerp(b, k / n))
        out.append(pts[-1])
        return out

    # belt-hung items ---------------------------------------------------------------------
    def hang(self, name, deg, drop, builder, material, z=None, bone='pelvis', out=0.0):
        """place a rigid item on the belt at angle `deg`; builder(bm, M) draws it in a local frame
        (x = along the belt, y = up, z = out of the body)."""
        z = z or self.m['belt_z']
        p, n = self.at_angle(z, deg)
        n = Vector((n.x, n.y, 0)).normalized()
        R = geo.frame(n, (0, 0, 1))
        M = geo.M_at(p + n * (0.008 + out) + Vector((0, 0, -drop)), R)
        bm = bmesh.new()
        builder(bm, M)
        return self.finish(bm, name, material, bone=bone)


# ---------------- item builders (local frame: x along belt, y up, z outward) ----------------
def ammo_pouch_triple(bm, M):
    for i in (-1, 0, 1):
        geo.add_box(bm, (0.058, 0.085, 0.034), M @ Matrix.Translation((i * 0.061, -0.03, 0.017)), bevel=0.004)
        geo.add_box(bm, (0.060, 0.03, 0.036), M @ Matrix.Translation((i * 0.061, 0.005, 0.02)), bevel=0.003)


def bread_bag(bm, M):
    geo.add_box(bm, (0.26, 0.17, 0.07), M @ Matrix.Translation((0, -0.1, 0.035)), bevel=0.02, segs=2)
    geo.add_box(bm, (0.27, 0.09, 0.075), M @ Matrix.Translation((0, -0.05, 0.04)), bevel=0.012, segs=2)


def canteen(bm, M):
    R = Matrix.Rotation(math.radians(-90), 4, 'X')
    geo.add_lathe(bm, [(0.0, 0.1), (0.035, 0.098), (0.055, 0.07), (0.058, 0.0), (0.055, -0.08), (0.0, -0.085)],
                  M @ Matrix.Translation((0, -0.12, 0.05)) @ R,
                  segs=12, sx=1.0, sy=0.62)
    geo.add_cyl(bm, 0.042, 0.04, 0.05, M @ Matrix.Translation((0, -0.025, 0.05)) @ Matrix.Rotation(math.radians(90), 4, 'X'), segs=10)


def gasmask_can(bm, M):
    prof = []
    for k in range(9):
        z = 0.13 - k * 0.0325
        prof.append((0.058 if k % 2 == 0 else 0.054, z))
    prof = [(0.0, 0.14), (0.05, 0.138)] + prof + [(0.05, -0.132), (0.0, -0.134)]
    geo.add_lathe(bm, prof, M @ Matrix.Translation((0, -0.2, 0.065)) @ Matrix.Rotation(math.radians(-90), 4, 'X') @ Matrix.Rotation(math.radians(12), 4, 'Y'), segs=14)


def bayonet(bm, M):
    geo.add_box(bm, (0.028, 0.30, 0.018), M @ Matrix.Translation((0, -0.14, 0.012)) @ Matrix.Rotation(math.radians(8), 4, 'Z'), bevel=0.004)
    geo.add_box(bm, (0.045, 0.07, 0.02), M @ Matrix.Translation((0, 0.0, 0.014)), bevel=0.004)


def holster(bm, M):
    geo.add_box(bm, (0.07, 0.17, 0.04), M @ Matrix.Translation((0, -0.1, 0.022)) @ Matrix.Rotation(math.radians(-10), 4, 'Z'), bevel=0.012, segs=2)


def radio_box(bm, M):
    geo.add_box(bm, (0.09, 0.07, 0.05), M @ Matrix.Translation((0, -0.04, 0.028)), bevel=0.006)
    geo.add_cyl(bm, 0.003, 0.002, 0.12, M @ Matrix.Translation((0.03, 0.04, 0.03)), segs=5)


def knife_sheath(bm, M):
    geo.add_box(bm, (0.03, 0.2, 0.012), M @ Matrix.Translation((0, -0.05, 0.01)), bevel=0.004)
    geo.add_cyl(bm, 0.009, 0.011, 0.09, M @ Matrix.Translation((0, 0.1, 0.012)) @ Matrix.Rotation(math.radians(90), 4, 'X'), segs=8)


def shovel(bm, M):
    geo.add_box(bm, (0.16, 0.19, 0.02), M @ Matrix.Translation((0, -0.05, 0.03)), bevel=0.02, segs=2)
    geo.add_cyl(bm, 0.014, 0.014, 0.32, M @ Matrix.Translation((0, 0.2, 0.03)) @ Matrix.Rotation(math.radians(90), 4, 'X'), segs=8)


def pick(bm, M):
    geo.add_cyl(bm, 0.012, 0.012, 0.34, M @ Matrix.Translation((0, -0.12, 0.02)) @ Matrix.Rotation(math.radians(90), 4, 'X'), segs=8)
    geo.add_box(bm, (0.2, 0.025, 0.02), M @ Matrix.Translation((0, 0.05, 0.02)), bevel=0.006)


# ---------------- kit presets ----------------
def build_kit(ctx, garments, spec):
    K = Kit(ctx, garments)
    items = set(spec.get('kit', []))
    opts = spec.get('outfit_opts', {})
    black = mat('black_leather', lambda: MT.leather('kit_leather', lin((0.045, 0.04, 0.035)), rough=0.4))
    web = mat('webbing', lambda: MT.fabric('kit_webbing', lin(opts.get('webbing', (0.50, 0.46, 0.31))), kind='canvas', rough=0.95))
    steel = mat('fg_steel', lambda: MT.paint('kit_steel', lin((0.33, 0.35, 0.30)), rough=0.6))
    brass = mat('brass', lambda: MT.metal('kit_brass', lin((0.62, 0.52, 0.30)), rough=0.4))
    top = K.top
    cloth = top.data.materials[0] if top.data.materials else None
    if spec['outfit'] in ('heer_m40', 'heer_m36', 'dak', 'winter_smock', 'officer_heer') and 'no_details' not in items:
        K.tunic_details(cloth, pleated=spec['outfit'] != 'dak', collar_col=opts.get('collar'), tabs=True, straps=True)
    if 'belt' in items:
        K.belt(black, buckle_mat=steel)
    if 'belt_web' in items:
        K.belt(web, buckle_mat=brass, width=0.055, buckle=(0.06, 0.05))
    if 'ystraps' in items:
        K.ystraps(black)
    if 'braces' in items:
        K.ystraps(web, width=0.032, front_x=0.12, cross=True)
    if 'ammo_pouches' in items:
        for s in (1, -1):
            K.hang('kit_pouch_' + ('l' if s > 0 else 'r'), s * 28, 0.0, ammo_pouch_triple, black)
    if 'bread_bag' in items:
        K.hang('kit_breadbag', -125, 0.02, bread_bag, mat('bag', lambda: MT.fabric('kit_bag', lin((0.36, 0.36, 0.28)), kind='canvas')))
    if 'canteen' in items:
        K.hang('kit_canteen', -150, 0.05, canteen, mat('felt', lambda: MT.fabric('kit_felt', lin((0.36, 0.26, 0.17)), kind='wool')), out=0.07)
    if 'gasmask_can' in items:
        K.hang('kit_gasmask', 160, 0.08, gasmask_can, steel, out=0.0)
    if 'bayonet' in items:
        K.hang('kit_bayonet', 105, 0.0, bayonet, black)
    if 'holster_r' in items:
        K.hang('kit_holster', -80, 0.0, holster, web)
    if 'decoy_radio' in items:
        K.hang('kit_radio', 60, -0.02, radio_box, mat('olive_metal', lambda: MT.paint('kit_olive', lin((0.25, 0.27, 0.18)))))
    if 'shovel_back' in items:
        K.hang('kit_shovel', 180, -0.08, shovel, mat('olive_metal', lambda: MT.paint('kit_olive', lin((0.25, 0.27, 0.18)))), z=ctx.m['belt_z'] + 0.02)
    if 'pick_belt' in items:
        K.hang('kit_pick', 125, 0.0, pick, mat('wood', lambda: MT.solid('kit_wood', lin((0.36, 0.24, 0.14)), rough=0.6, bump=0.1)))
    if 'knife_sheath_chest' in items:
        chest = ctx.bone['spine_03'][0].z
        p, n = K.at_angle(chest - 0.02, 22)
        bm = bmesh.new()
        knife_sheath(bm, geo.M_at(p + n * 0.012, geo.frame(n)) @ Matrix.Rotation(math.radians(-25), 4, 'Z'))
        K.finish(bm, 'kit_knife', black)
    log('kit: ' + ', '.join(f'{o.name}:{tri_count(o)}' for o in K.objs))
    return K.objs


def glasses(ctx, color=(0.55, 0.52, 0.45)):
    """round wire-rimmed spectacles (Spy, 12 % of officers): rigid on the head bone"""
    m = ctx.m
    bm = bmesh.new()
    for key in ('eye_l', 'eye_r'):
        e = Vector(m[key])
        c = Vector((e.x * 1.02, m['eye_front_y'] - 0.016, e.z))
        tmp = bmesh.new()
        bmesh.ops.create_circle(tmp, cap_ends=False, segments=14, radius=0.019)
        for v in tmp.verts:
            v.co = Vector((v.co.x, 0, v.co.y)) + c
        edges = list(tmp.edges)
        me = bpy.data.meshes.new('_g'); tmp.to_mesh(me); tmp.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    # rims -> thin tubes via extrude + scale is overkill: give the wire ring a real cross-section with small boxes
    rim = bmesh.new()
    for e in bm.edges:
        a, b = e.verts[0].co, e.verts[1].co
        d = b - a
        geo.add_box(rim, (0.0016, d.length + 0.0008, 0.0016), geo.M_at((a + b) / 2, geo.frame(d, (0, -1, 0)) @ Matrix.Rotation(math.radians(90), 3, 'X')))
    bm.free()
    el, er = Vector(m['eye_l']), Vector(m['eye_r'])
    y = m['eye_front_y'] - 0.016
    geo.add_box(rim, (abs(el.x - er.x) - 0.038, 0.002, 0.002), geo.M_at(Vector((0, y, el.z + 0.004))))    # bridge
    for s in (1, -1):   # temples back to the ears
        ex = abs(el.x) + 0.02
        L = abs(m.get('ear_y', y + 0.09) - y)
        geo.add_box(rim, (0.0015, L, 0.0015), geo.M_at(Vector((s * (ex + 0.004), y + L / 2, el.z + 0.003))))
    o = geo.obj_from_bm('kit_glasses', rim, MT.metal('glasses_wire', lin(color), rough=0.3))
    geo.rigid_weights(o, 'head', ctx.rig)
    return o
