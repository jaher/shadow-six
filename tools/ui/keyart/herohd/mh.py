"""Minimal MakeHuman (hm08) loader for Blender: base mesh + morph targets + game-engine rig + skin weights + proxy fit.

All data are MakeHuman CC0 assets (base mesh, targets, rig and weight JSON, eye proxies, skin textures); see
CREDITS.md. Nothing here is MakeHuman/MPFB program code: the macro weighting follows the published hm08 rules
(age / muscle / weight / height / proportions blend between the corner targets).
  MH   = <dir>/mhrepo/makehuman/data            (github.com/makehumancommunity/makehuman, data/ only)
  MPFB = <dir>/mpfb2/src/mpfb/data              (github.com/makehumancommunity/mpfb2, data/ only: rigs, weights)
  SYS  = <dir>/mhsys/x                          (makehuman_system_assets_cc0.zip: skins, eyes, eyebrows)
Coordinates: hm08 is Y-up, decimetres, facing +Z; Blender here is Z-up, metres, facing -Y.
"""
import os, json, math
import numpy as np
import bpy, bmesh
from mathutils import Vector, Matrix


def mh2b(a):
    """(N,3) hm08 coordinates -> Blender (x, -z, y) * 0.1."""
    a = np.asarray(a, np.float64)
    return np.stack([a[:, 0], -a[:, 2], a[:, 1]], 1) * 0.1


def read_obj(path):
    vs, vts, faces, fuv, fgroup = [], [], [], [], []
    g = None
    with open(path) as f:
        for ln in f:
            if ln.startswith('v '):
                vs.append([float(x) for x in ln.split()[1:4]])
            elif ln.startswith('vt '):
                vts.append([float(x) for x in ln.split()[1:3]])
            elif ln.startswith('g '):
                g = ln.split()[1]
            elif ln.startswith('f '):
                vi, ti = [], []
                for tok in ln.split()[1:]:
                    p = tok.split('/')
                    vi.append(int(p[0]) - 1)
                    ti.append(int(p[1]) - 1 if len(p) > 1 and p[1] else -1)
                faces.append(vi); fuv.append(ti); fgroup.append(g)
    return np.array(vs, np.float64), np.array(vts, np.float64), faces, fuv, fgroup


_tcache = {}


def read_target(path):
    if path in _tcache: return _tcache[path]
    idx, d = [], []
    op = open
    if path.endswith('.gz'):
        import gzip
        op = lambda p: gzip.open(p, 'rt')
    with op(path) as f:
        for ln in f:
            if not ln.strip() or ln[0] == '#': continue
            p = ln.split()
            idx.append(int(p[0])); d.append([float(p[1]), float(p[2]), float(p[3])])
    r = (np.array(idx, np.int64), np.array(d, np.float64).reshape(-1, 3))
    _tcache[path] = r
    return r


def macro_weights(gender=1.0, age=0.5, muscle=0.5, weight=0.5, height=0.5, proportions=0.5, race=None):
    """Corner-target weights for the hm08 macro modifiers (values in 0..1, 0.5 = average; age 0.5 = 25 years)."""
    race = race or {'caucasian': 1.0}
    G = {'female': 1 - gender, 'male': gender}
    if age < 0.5:
        young = max(0.0, (age - 0.1875) * 3.2); baby = max(0.0, 1 - age * 5.333); child = max(0.0, min(1.0, 5.333 * age) - young)
        A = {'baby': baby, 'child': child, 'young': young, 'old': 0.0}
    else:
        old = max(0.0, age * 2 - 1)
        A = {'baby': 0.0, 'child': 0.0, 'young': 1 - old, 'old': old}
    M = {'minmuscle': max(0.0, 1 - muscle * 2), 'maxmuscle': max(0.0, muscle * 2 - 1)}
    M['averagemuscle'] = 1 - M['minmuscle'] - M['maxmuscle']
    W = {'minweight': max(0.0, 1 - weight * 2), 'maxweight': max(0.0, weight * 2 - 1)}
    W['averageweight'] = 1 - W['minweight'] - W['maxweight']
    H = {'minheight': max(0.0, 1 - height * 2), 'maxheight': max(0.0, height * 2 - 1)}
    P = {'uncommonproportions': max(0.0, 1 - proportions * 2), 'idealproportions': max(0.0, proportions * 2 - 1)}
    out = []
    for r, rw in race.items():
        for g, gw in G.items():
            for a, aw in A.items():
                w = rw * gw * aw
                if w > 1e-6: out.append((f'macrodetails/{r}-{g}-{a}.target', w))
    for g, gw in G.items():
        for a, aw in A.items():
            for m, mw in M.items():
                for wn, ww in W.items():
                    w = gw * aw * mw * ww
                    if w > 1e-6: out.append((f'macrodetails/universal-{g}-{a}-{m}-{wn}.target', w))
                    for h, hw in H.items():
                        if w * hw > 1e-6: out.append((f'macrodetails/height/{g}-{a}-{m}-{wn}-{h}.target', w * hw))
                    for p, pw in P.items():
                        if a in ('baby',): continue
                        if w * pw > 1e-6: out.append((f'macrodetails/proportions/{g}-{a}-{m}-{wn}-{p}.target', w * pw))
    return out


def modifier_targets(mods):
    """{'head/head-square': 0.4, 'chin/chin-bones': 0.3 (-> -incr / -decr), 'nose/nose-trans': ('up', 0.2)} -> [(file, w)]."""
    out = []
    for k, v in mods.items():
        if isinstance(v, (tuple, list)):
            out.append((f'{k}-{v[0]}.target', float(v[1])))
        elif k.endswith('.target'):
            out.append((k, float(v)))
        else:
            out.append((k + '.target', float(v)) if k.split('/')[-1] in SINGLE else (f'{k}-{"incr" if v > 0 else "decr"}.target', abs(float(v))))
    return out


SINGLE = {'head-square', 'head-oval', 'head-round', 'head-rectangular', 'head-triangular', 'head-invertedtriangular',
          'head-diamond', 'chin-triangle'}


class Human:
    def __init__(self, root):
        self.root = root
        self.MH = os.path.join(root, 'mhrepo/makehuman/data')
        self.MPFB = os.path.join(root, 'mpfb2/src/mpfb/data')
        self.SYS = os.path.join(root, 'mhsys/x')
        self.v0, self.vt, self.faces, self.fuv, self.fgroup = read_obj(os.path.join(self.MH, '3dobjs/base.obj'))
        self.v = self.v0.copy()
        self.groups = {}
        for f, g in zip(self.faces, self.fgroup):
            self.groups.setdefault(g, set()).update(f)

    def apply(self, targets):
        for name, w in targets:
            p = os.path.join(self.MH, 'targets', name)
            if not os.path.exists(p):
                print('MH missing target', name); continue
            idx, d = read_target(p)
            self.v[idx] += d * w

    def gcenter(self, g):
        return self.v[sorted(self.groups[g])].mean(0)

    # ---- mesh
    def build_mesh(self, name='body', keep=('body',)):
        """Blender object of the selected face groups (all base vertices kept so indices match targets / weights /
        proxies; the unused ones are deleted by finish_mesh after rigging)."""
        vb = mh2b(self.v)
        me = bpy.data.meshes.new(name)
        sel = [i for i, g in enumerate(self.fgroup) if g in keep]
        me.from_pydata(vb.tolist(), [], [self.faces[i] for i in sel])
        uv = me.uv_layers.new(name='UVMap')
        k = 0
        for fi in sel:
            for t in self.fuv[fi]:
                uv.data[k].uv = self.vt[t] if t >= 0 else (0, 0); k += 1
        me.validate(); me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        for p in me.polygons: p.use_smooth = True
        return ob

    @staticmethod
    def finish_mesh(ob):
        """Drop loose vertices (helpers, joint cubes) left from build_mesh."""
        bm = bmesh.new(); bm.from_mesh(ob.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.to_mesh(ob.data); bm.free(); ob.data.update()

    # ---- rig
    def joint(self, spec):
        s = spec.get('strategy')
        if s == 'CUBE' and spec.get('cube_name') in self.groups:
            return mh2b(self.gcenter(spec['cube_name'])[None])[0]
        if s == 'MEAN':
            return mh2b(self.v[spec['vertex_indices']].mean(0)[None])[0]
        if s == 'VERTEX':
            return mh2b(self.v[[spec['vertex_index']]])[0]
        return np.array(spec['default_position'])

    def build_rig(self, ob, rig_name='game_engine', name='rig'):
        R = json.load(open(os.path.join(self.MPFB, f'rigs/standard/rig.{rig_name}.json')))
        W = json.load(open(os.path.join(self.MPFB, f'rigs/standard/weights.{rig_name}.json')))['weights']
        arm = bpy.data.armatures.new(name)
        rig = bpy.data.objects.new(name, arm)
        bpy.context.scene.collection.objects.link(rig)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode='EDIT')
        eb = {}
        for bn, d in R.items():
            b = arm.edit_bones.new(bn)
            b.head = Vector(self.joint(d['head']).tolist()); b.tail = Vector(self.joint(d['tail']).tolist())
            if (b.tail - b.head).length < 1e-5: b.tail = b.head + Vector((0, 0, 0.01))
            b.roll = d.get('roll', 0.0)
            eb[bn] = b
        for bn, d in R.items():
            if d.get('parent'): eb[bn].parent = eb[d['parent']]
            eb[bn].use_connect = bool(d.get('use_connect', False))
        bpy.ops.object.mode_set(mode='OBJECT')
        for bn, lst in W.items():
            vg = ob.vertex_groups.get(bn) or ob.vertex_groups.new(name=bn)
            for vi, w in lst:
                vg.add([vi], w, 'REPLACE')
        mod = ob.modifiers.new('Armature', 'ARMATURE'); mod.object = rig
        ob.parent = rig
        return rig

    # ---- proxies (.mhclo): eyes, eyelashes, eyebrows
    def fit_proxy(self, mhclo, name=None, scale_ref=None):
        base = os.path.dirname(mhclo)
        lines = open(mhclo).read().splitlines()
        obj_file, scales, refs, in_verts = None, {}, [], False
        for ln in lines:
            if not ln.strip() or ln.startswith('#'): continue
            p = ln.split()
            if p[0] == 'obj_file': obj_file = p[1]
            elif p[0] in ('x_scale', 'y_scale', 'z_scale'):
                scales[p[0][0]] = (int(p[1]), int(p[2]), float(p[3]))
            elif p[0] == 'verts': in_verts = True; continue
            elif in_verts:
                if len(p) == 9:
                    refs.append(([int(p[0]), int(p[1]), int(p[2])], [float(p[3]), float(p[4]), float(p[5])], [float(p[6]), float(p[7]), float(p[8])]))
                elif len(p) == 1:
                    refs.append(([int(p[0])] * 3, [1, 0, 0], [0, 0, 0]))
                elif p[0] in ('delete_verts', 'end'):
                    in_verts = False
        sc = []
        for ax, k in (('x', 0), ('y', 1), ('z', 2)):
            if ax in scales:
                a, b, ref = scales[ax]
                sc.append(abs(self.v[a][k] - self.v[b][k]) / ref)
            else:
                sc.append(1.0)
        sc = np.array(sc)
        pv = np.array([sum(self.v[i] * w for i, w in zip(ix, ws)) + np.array(off) * sc for ix, ws, off in refs])
        vs, vts, faces, fuv, _ = read_obj(os.path.join(base, obj_file))
        assert len(vs) == len(pv), (len(vs), len(pv))
        me = bpy.data.meshes.new(name or os.path.basename(mhclo))
        me.from_pydata(mh2b(pv).tolist(), [], faces)
        if len(vts):
            uv = me.uv_layers.new(name='UVMap'); k = 0
            for fu in fuv:
                for t in fu:
                    uv.data[k].uv = vts[t] if t >= 0 else (0, 0); k += 1
        me.validate(); me.update()
        for p in me.polygons: p.use_smooth = True
        ob = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob, refs
