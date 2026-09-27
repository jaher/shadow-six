# enemy_headgear.py - additions to a fitted headgear mesh (after headgear.build_headgear's fit + verification):
#   cords   - silver chin cords across the peaked-cap band above the visor (officers, general)
#   goggles - dust goggles resting on the front of the helmet / tropical cap above the brim (Afrika Korps)
#   soft caps - crown relaxed (smooth + scalp re-clearance)
# Everything is projected onto the already-fitted hat surface, then the eye-clearance check is re-run; on a hit the
# additions are dropped (never the fit).
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from common import *
import geo
import headfit as HF
import materials as MT
from uniform import lin


def _surface_ring(tree, fit, z, angles, out):
    pts = []
    for th in angles:
        a = math.radians(th)
        d = Vector((math.sin(a), -math.cos(a), 0))
        c = Vector((0, fit.yc, z))
        hit, n, i, dist = tree.ray_cast(c + d * 0.4, -d, 0.4)
        if hit is not None:
            pts.append(hit + d * out)
    return pts


def _surface_ring_in(tree, fit, z, angles, out):
    """like _surface_ring but cast from the head axis OUTWARD: the first hit is the band itself, never the flared crown
    or the peak in front of it (outside-in rays put the officer chin cords on the peak/crown lip, 2-4 cm proud)"""
    pts = []
    for th in angles:
        a = math.radians(th)
        d = Vector((math.sin(a), -math.cos(a), 0))
        hit = tree.ray_cast(Vector((0, fit.yc, z)), d, 0.4)[0]
        if hit is not None:
            pts.append(hit + d * out)
    return pts


def _components(bm, faces):
    """connected face groups (by shared edges) among `faces`"""
    fs = set(faces); seen = set(); out = []
    for f0 in faces:
        if f0 in seen:
            continue
        st = [f0]; seen.add(f0); comp = []
        while st:
            f = st.pop(); comp.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g in fs and g not in seen:
                        seen.add(g); st.append(g)
        out.append(comp)
    return out


def _tree_without(bm, skip):
    bm.faces.index_update()
    t = bm.copy()
    t.faces.ensure_lookup_table()
    bmesh.ops.delete(t, geom=[t.faces[f.index] for f in skip], context='FACES')
    tree = BVHTree.FromBMesh(t); t.free()
    return tree


def _m35_fix(bm, fit):
    """(1) liner lip: the inward-facing strip from the rolled rim back up inside sat 0-4 mm inside the flared skirt at the
    front and poked through it (dark, torn-edged patches at close zoom): pull it up to 10 mm toward the helmet axis (the squadkit
    runtime fix, now baked). (2) side vents: the grommets were placed at a fixed 19 mm off the head and ended 3-16 mm
    inside the shell; each is slid along its axis until its inner face is 1 mm into the shell (5 mm proud)."""
    out = []
    bm.faces.ensure_lookup_table(); bm.normal_update()
    comps = sorted(_components(bm, list(bm.faces)), key=len, reverse=True)
    shell = comps[0]; ss = set(shell); sv = {v for f in shell for v in f.verts}
    top = max(shell, key=lambda f: f.calc_center_median().z)
    sgn = 1.0 if top.normal.z > 0 else -1.0
    n = 0; mv = []
    for v in sv:
        nv = sum((f.normal * f.calc_area() for f in v.link_faces if f in ss), Vector()) * sgn
        if nv.length < 1e-12:
            continue
        nv.normalize(); r = Vector((v.co.x, v.co.y - fit.yc, 0))
        if r.length > 1e-6 and nv.x * r.x + nv.y * r.y < 0 and abs(nv.z) < 0.85:
            mv.append((v, r.normalized()))
    for v, rd in mv:   # 10 mm in, but never within 4 mm of the head (fit clearance)
        th = math.degrees(math.atan2(v.co.x, -(v.co.y - fit.yc))); r = math.hypot(v.co.x, v.co.y - fit.yc)
        step = max(0.0, min(0.010, r - (fit.req(th, v.co.z) + 0.004)))
        v.co -= rd * step; n += 1
    out.append(f'liner_sunk({n}v)')
    tree = _tree_without(bm, [f for f in bm.faces if f not in ss])
    k = 0
    for comp in comps[1:]:
        vs = {v for f in comp for v in f.verts}
        c = sum((v.co for v in vs), Vector()) / len(vs)
        if len(comp) > 40 or abs(c.x) < 0.04 or abs(c.y - fit.yc) > 0.04:
            continue
        sx = 1.0 if c.x > 0 else -1.0
        hit = tree.ray_cast(Vector((0, fit.yc, c.z)), Vector((sx, 0, 0)), 0.3)[0]
        if hit is None:
            continue
        inner = min(sx * v.co.x for v in vs)
        sh = sx * hit.x - 0.001 - inner
        for v in vs:
            v.co.x += sx * sh
        k += 1; out.append(f'vent{k}({sh * 1000:+.0f}mm)')
    return out


def _peaked_cap_fix(bm, fit, me, kw):
    """badge (cockade) seated 0.5 mm on the band (was 5-9.5 mm proud); peak closed into one smooth solid and satin
    leather (the two open 4 mm sheets + roughness 0.3 read as a light plate under the peak / a silver chevron)"""
    out = []
    # peak: rebuilt as one closed, smooth-shaded solid growing out of the band bottom (the pipeline peak on these heads
    # came out folded: root row 1.5-4.5 cm apart in height -> black zigzag with skin showing through the V gaps)
    zf = kw.get('zf')
    old = [f for f in bm.faces if f.material_index == 1]
    if old and zf is not None:
        oldv = {v for f in old for v in f.verts}
        bmesh.ops.delete(bm, geom=old, context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in oldv if v.is_valid and not v.link_faces], context='VERTS')
        band = _tree_without(bm, [f for f in bm.faces if f.material_index != 0])
        def build(zr, droop):
            min_tip = fit.eye_top + 0.022; cols = 17; half = 68.0
            top, root = [], []
            for k in range(cols):
                th = -half + 2 * half * k / (cols - 1); a = math.radians(th); d = Vector((math.sin(a), -math.cos(a), 0))
                hit = band.ray_cast(Vector((0, fit.yc, zr)), d, 0.4)[0]
                r0 = (math.hypot(hit.x, hit.y - fit.yc) if hit is not None else fit.req(th, zr) + 0.006) - 0.001
                L = 0.056 * max(0.0, math.cos(a)) ** 0.7 + 0.004
                drop = min(L * math.tan(math.radians(droop)), max(0.0, zr - min_tip))
                col = []
                for f_ in (0.0, 0.34, 0.67, 1.0):
                    r = r0 + L * f_; z = zr - drop * (0.55 * f_ + 0.45 * f_ * f_)
                    col.append(Vector((d.x * r, fit.yc + d.y * r, z)))
                top.append(col); root.append((th, r0 + 0.001, zr))
            T = [[bm.verts.new(p) for p in col] for col in top]
            Bv = [[bm.verts.new(p - Vector((0, 0, 0.0035))) for p in col] for col in top]
            new = []
            def q(*vs):
                try:
                    new.append(bm.faces.new(vs))
                except ValueError:
                    pass
            R = len(top[0])
            for k in range(cols - 1):
                for j in range(R - 1):
                    q(T[k][j], T[k + 1][j], T[k + 1][j + 1], T[k][j + 1])
                    q(Bv[k][j], Bv[k][j + 1], Bv[k + 1][j + 1], Bv[k + 1][j])
                q(T[k][R - 1], T[k + 1][R - 1], Bv[k + 1][R - 1], Bv[k][R - 1])   # front edge
                q(T[k][0], Bv[k][0], Bv[k + 1][0], T[k + 1][0])                   # root (inside the band)
            for k in (0, cols - 1):
                for j in range(R - 1):
                    q(T[k][j], T[k][j + 1], Bv[k][j + 1], Bv[k][j])
            for f in new:
                f.material_index = 1; f.smooth = True
            bmesh.ops.recalc_face_normals(bm, faces=new)
            # band facing above the root (cap cloth, 1.5 mm proud of the band, 3 cm tall): the pushed-out band bottom
            # edge was toothed at the front, so the forehead showed as light V notches between the peak and the crown
            Fv = [[bm.verts.new(Vector((math.sin(math.radians(th)) * (r + 0.0015), fit.yc - math.cos(math.radians(th)) * (r + 0.0015), zr + dz)))
                   for dz in (-0.001, 0.015, 0.030)] for th, r, _z in root]
            fac = []
            for k in range(cols - 1):
                for j in range(2):
                    try:
                        fac.append(bm.faces.new((Fv[k][j], Fv[k + 1][j], Fv[k + 1][j + 1], Fv[k][j + 1])))
                    except ValueError:
                        pass
            for f in fac:
                f.material_index = 0; f.smooth = True
            if fac:
                bmesh.ops.recalc_face_normals(bm, faces=fac)
                if sum(f.normal.dot(Vector((f.calc_center_median().x, f.calc_center_median().y - fit.yc, 0))) for f in fac) < 0:
                    bmesh.ops.reverse_faces(bm, faces=fac)
            return new + fac, [v for c in T + Bv + Fv for v in c], root
        # eye rays (HF.eye_check) decide the droop: 24 deg if clear, flatter / 3 mm higher otherwise
        for zr, droop in [(zf + 0.003, dg) for dg in (24, 18, 12, 6, 0)] + [(zf + 0.003 + 0.003 * k, 0) for k in (1, 2, 3, 4)]:
            new, nv, root = build(zr, droop)
            if HF.eye_check(_bvh_bm(bm), fit)[0]:
                break
            bmesh.ops.delete(bm, geom=nv, context='VERTS')
            new = []
        if not new:
            out.append('peak_removed(eyes)')
            root = []
        out.append(f'peak_rebuilt(droop {droop}, +{(zr - zf) * 1000:.0f}mm)')
        kw['root'] = root
    badge = [f for f in bm.faces if f.material_index == 2]
    if badge:   # cockade: centred on the band facing (or, with no rebuilt peak, on the first band hit from inside)
        tree = _tree_without(bm, badge)
        r0 = {int(round(t)): (r, z) for t, r, z in kw.get('root') or []}
        for comp in _components(bm, badge):
            vs = {v for f in comp for v in f.verts}; c = sum((v.co for v in vs), Vector()) / len(vs)
            d = Vector((c.x, c.y - fit.yc, 0)).normalized()
            if 0 in r0:
                rf, zr = r0[0]; tgt_z = zr + 0.017; surf = rf + 0.0015
                for v in vs:
                    v.co.z += tgt_z - c.z
                o = Vector((0, fit.yc, tgt_z))
            else:
                o = Vector((0, fit.yc, c.z)); hit = tree.ray_cast(o, d, 0.4)[0]
                if hit is None:
                    continue
                surf = (hit - o).dot(d)
            sh = surf + 0.0005 - min((v.co - o).dot(d) for v in vs)
            for v in vs:
                v.co += d * sh
            out.append(f'badge_seated({sh * 1000:+.1f}mm)')
    for m in me.materials:
        if m and m.name.startswith('hg_visor') and m.use_nodes and m.node_tree.nodes.get('Principled BSDF'):
            m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.55
    return out


def _mark(bm, n0, idx):
    bm.faces.ensure_lookup_table()
    for f in bm.faces[n0:]:
        f.material_index = idx


def _tube(bm, pts, w, h, mat_idx):
    n0 = len(bm.faces)
    for a, b in zip(pts, pts[1:]):
        d = b - a
        if d.length < 1e-5:
            continue
        geo.add_box(bm, (w, h, d.length + 0.002), geo.M_at((a + b) / 2, geo.frame(d, (0, 0, 1))))
    bm.faces.ensure_lookup_table()
    for f in bm.faces[n0:]:
        f.material_index = mat_idx


def extras(ctx, parts, hg, spec, rep):
    hs = spec.get('headgear') or {}
    want_cords = hs.get('cords') and hs.get('type') == 'officer_cap'
    want_gog = hs.get('goggles')
    soft = hs.get('type') in ('field_cap', 'dak_cap', 'camo_cap')
    want_phones = 'headphones' in spec.get('kit', [])
    if not hg:
        return rep
    fit = HF.HeadFit(ctx, parts)
    tree = geo.bvh_of([hg])
    me = hg.data
    band = [v.co for p in me.polygons if p.material_index == 0 for v in (me.vertices[i] for i in p.vertices)
            if abs(v.co.x) < 0.02 and v.co.y < fit.yc - 0.04]
    zf = min(c.z for c in band) if band else fit.brow + 0.015
    bm = bmesh.new(); bm.from_mesh(me)
    added = []
    if soft:   # soft cap crowns come out crumpled from the per-vertex push-out: relax them, then re-clear the scalp
        crown = [v for v in bm.verts if v.co.z > zf + 0.022]
        C = Vector((0, fit.yc, fit.brow - 0.01))
        for _ in range(10):
            bmesh.ops.smooth_vert(bm, verts=crown, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        # uniform per-ring clearance (per-vertex push-out re-crumples the crown): each z-band of the crown moves
        # radially by the LARGEST push any of its vertices needs
        bands = {}
        for v in crown:
            bands.setdefault(round(v.co.z / 0.006), []).append(v)
        for vs in bands.values():
            need = 0.0
            for v in vs:
                for tree in (fit.tree, fit.hair_tree):
                    if tree is None:
                        continue
                    loc, nrm, i, d = tree.find_nearest(v.co, 0.05)
                    if loc is not None:
                        need = max(need, 0.006 - (v.co - loc).dot(nrm))
            if need > 0:
                for v in vs:   # along the skull-centre ray: lifts the crown top as well as the sides
                    v.co += (v.co - C).normalized() * need
        # verify + repair: every scalp/hair point under the crown must be covered (a ray from the skull centre through
        # it hits the cap beyond it); exposed points inflate the nearby crown (angular falloff), up to 5 passes
        pts = [p for p in fit.pts if p.z > zf + 0.03]
        for it in range(6):
            tree2 = _bvh_bm(bm)
            bad = []
            for p in pts:
                d = (p - C).normalized()
                hit = tree2.ray_cast(C, d, 0.3)[0]
                if hit is None or (hit - C).length < (p - C).length + 0.0015:
                    bad.append(p)
            if not bad or it == 5:
                break
            for p in bad:   # sparse back of the crown: lift the 4 nearest crown vertices too
                rp = (p - C).length
                for v in sorted(crown, key=lambda v: (v.co - p).length)[:4]:
                    dv = (v.co - C); rv = dv.length
                    if rv < rp + 0.007:
                        v.co = C + dv / rv * (rp + 0.007)
            for v in crown:
                dv = (v.co - C); rv = dv.length; dv = dv / rv
                for p in bad:
                    dp = (p - C); rp = dp.length
                    cosang = dv.dot(dp / rp)
                    if cosang > 0.985:   # within ~10 deg
                        w = min(1.0, (cosang - 0.985) / 0.01)
                        target = rp + 0.007
                        if rv < target:
                            v.co = C + dv * (rv + (target - rv) * w); rv = (v.co - C).length
        for p in bad[:3]:
            d = (p - C).normalized(); h = tree2.ray_cast(C, d, 0.3)[0]
            log('exposed', round(math.degrees(math.atan2(p.x, -(p.y - fit.yc)))), 'dz', round(p.z - zf, 3), 'rp', round((p - C).length, 3), 'hit', None if h is None else round((h - C).length, 3))
        added.append(f'crown_smoothed(exposed {len(bad)}/{len(pts)}, passes {it})')
        tree = _bvh_bm(bm)   # additions below sit on the relaxed crown (the pre-smoothing tree buried the goggles)
    if hs.get('type') == 'officer_cap':   # stiff crown: the dished top must clear the scalp/hair under it by >= 7 mm
        # crown verts only: the lift used to catch the peak's root row too and folded the peak up into a zigzag
        # (the 'light plate' / 'jagged silver V' under the crown front)
        top = [v for v in bm.verts if v.co.z > zf + 0.036 and all(f.material_index == 0 for f in v.link_faces)]
        trees = [t for t in (fit.tree, fit.hair_tree) if t is not None]
        lift = {}
        for v in top:
            best = None
            for dx, dy in ((0, 0), (0.012, 0), (-0.012, 0), (0, 0.012), (0, -0.012)):
                o = Vector((v.co.x + dx, v.co.y + dy, v.co.z + 0.15))
                for t in trees:
                    h = t.ray_cast(o, Vector((0, 0, -1)), 0.3)[0]
                    if h is not None and (best is None or h.z > best):
                        best = h.z
            lift[v] = max(0.0, best + 0.009 - v.co.z) if best is not None else 0.0
        mx = max(lift.values()) if lift else 0.0
        if mx > 0:   # one rigid lift for the whole top (keeps the taut oval + saddle; a per-vertex lift made a tent)
            for v in top:
                v.co.z += mx * min(1.0, (v.co.z - zf - 0.036) / 0.012)
            tree = _bvh_bm(bm)
            added.append(f'crown_lifted({mx * 1000:.0f}mm)')
    if hs.get('type') == 'm35':
        added += _m35_fix(bm, fit)
        tree = _bvh_bm(bm)
    if hs.get('type') == 'officer_cap':
        pk = {'zf': zf}
        added += _peaked_cap_fix(bm, fit, me, pk)
        tree = _tree_without(bm, [f for f in bm.faces if f.material_index == 2])
    pk = locals().get('pk', {})
    if want_cords:
        # chin cords lie on the band just above the peak root: follow the peak's root line (radius + height per angle),
        # accept an inside-out band hit only near that radius (rays at a fixed height hit the crown flare or the peak
        # on this band and left the cords 2-4 cm proud of it)
        root = {int(round(th)): (r, z) for th, r, z in (pk.get('root') or [])} if hs.get('type') == 'officer_cap' else {}
        ths = sorted(root)
        def at(th):
            if not ths:
                return None
            if th <= ths[0]: return root[ths[0]]
            if th >= ths[-1]: return root[ths[-1]]
            for a, b in zip(ths, ths[1:]):
                if a <= th <= b:
                    u = (th - a) / max(1e-6, b - a); return tuple(root[a][k] * (1 - u) + root[b][k] * u for k in (0, 1))
        def cord_pt(th, dz, out):
            rz = at(th)
            if rz is None:
                return None
            r0, z0 = rz; z = z0 + dz; a = math.radians(th); d = Vector((math.sin(a), -math.cos(a), 0))
            hit = tree.ray_cast(Vector((0, fit.yc, z)), d, 0.4)[0]
            r = math.hypot(hit.x, hit.y - fit.yc) if hit is not None else r0
            if not (r0 - 0.004 <= r <= r0 + 0.010):
                r = r0 + 0.002
            return Vector((d.x * (r + out), fit.yc + d.y * (r + out), z))
        for dz in (0.0045, 0.0105):
            pts = [p for p in (cord_pt(th, dz, 0.0035) for th in range(-62, 63, 8)) if p is not None]
            _tube(bm, pts, 0.0034, 0.0034, 2)
        for s in (1, -1):   # side buttons
            p = cord_pt(s * 66, 0.0075, 0.003)
            if p is not None:
                n0 = len(bm.faces)
                geo.add_cyl(bm, 0.0045, 0.0045, 0.004, geo.M_at(p, geo.frame((p - Vector((0, fit.yc, p.z))).normalized())), segs=8)
                _mark(bm, n0, 2)
        added.append('cords')
    if want_gog:
        gm = MT.solid('hg_goggles', lin((0.10, 0.09, 0.07)), rough=0.25)
        me.materials.append(gm)
        gi = len(me.materials) - 1
        z = zf + (0.03 if hs.get('type') == 'm35' else 0.022)
        # one continuous elastic ribbon hugging the crown (separate boxes showed light end faces / gaps at close zoom)
        from enemy_kit import sweep
        strap = _surface_ring(tree, fit, z, range(-180, 181, 8), 0.0022)
        n0 = len(bm.faces)
        sweep(bm, strap, 0.008, 0.0014, Vector((0, 0, 1)))
        _mark(bm, n0, gi)
        for s in (1, -1):
            p = _surface_ring(tree, fit, z + 0.002, [s * 16], 0.012)
            if p:
                n = (p[0] - Vector((0, fit.yc, p[0].z))).normalized()
                n0 = len(bm.faces)
                geo.add_cyl(bm, 0.021, 0.019, 0.02, geo.M_at(p[0], geo.frame(n)), segs=12)
                _mark(bm, n0, gi)
        added.append('goggles')
    if hs.get('type') == 'side_cap':   # relax the stepped lower edge (per-vertex push-out) in height only
        low = [v for v in bm.verts if v.co.z < zf + 0.03]
        for _ in range(6):
            bmesh.ops.smooth_vert(bm, verts=low, factor=0.5, use_axis_x=False, use_axis_y=False, use_axis_z=True)
        # lower the tall boat ridge (read as a box from the front): compress everything above crown+8 mm toward it,
        # never closer than 6 mm to the scalp/hair straight below
        z0 = fit.crown + 0.008
        trees = [t for t in (fit.tree, fit.hair_tree) if t is not None]
        for v in bm.verts:
            if v.co.z > z0:
                nz = z0 + (v.co.z - z0) * 0.55
                for t in trees:
                    h = t.ray_cast(Vector((v.co.x, v.co.y, v.co.z + 0.1)), Vector((0, 0, -1)), 0.3)[0]
                    if h is not None:
                        nz = max(nz, min(v.co.z, h.z + 0.006))
                v.co.z = nz
        tree = _bvh_bm(bm)
        added.append('side_cap_edge_relaxed')
    if want_phones:
        added.append(_headphones(bm, me, fit, tree, ctx))
    me2 = bpy.data.meshes.new('hg_tmp'); bm.to_mesh(me2)
    ok, _ = HF.eye_check(_bvh(me2), fit)
    if ok:
        bm.to_mesh(me); me.update()
        geo.rigid_weights(hg, 'head', ctx.rig)
    else:
        added = ['DROPPED:' + '+'.join(added)]
    bm.free(); bpy.data.meshes.remove(me2)
    rep = dict(rep); rep['extras'] = added; rep['tris'] = tri_count(hg)
    log('headgear extras', added, 'eyes_clear', ok)
    return rep


def _headphones(bm, me, fit, tree, ctx=None):
    """Panzer headphones: cups over the ears, band projected onto the cap / hair / scalp (4 mm stand-off) so it rests
    on the side cap instead of arcing 2-3 cm above it; lives in the headgear mesh (comes off with the cap)."""
    from enemy_kit import sweep
    m = fit.m
    blk = MT.leather('hg_phones', lin((0.035, 0.033, 0.03)), rough=0.45)
    me.materials.append(blk); mi = len(me.materials) - 1
    ez = (m.get('ear_top_z', m['eye_top_z']) + m.get('ear_bot_z', m['eye_top_z'] - 0.06)) / 2
    ex = m.get('ear_x', 0.075) + 0.014
    ey = m.get('ear_y', m['skull_center'][1])
    n0 = len(bm.faces)
    exs = {1: ex, -1: ex}
    if ctx is not None:   # cushions sit ON the ear: outer ear surface from the evaluated body (shape keys applied), 2 mm press
        from mathutils.bvhtree import BVHTree
        dg = bpy.context.evaluated_depsgraph_get(); ev = ctx.human.evaluated_get(dg); hm = ev.to_mesh()
        hb = bmesh.new(); hb.from_mesh(hm); hb.transform(ctx.human.matrix_world); bt = BVHTree.FromBMesh(hb); hb.free(); ev.to_mesh_clear()
        for s in (1, -1):
            xs = []
            for dy in (-0.012, -0.006, 0.0, 0.006, 0.012):
                for dz in (-0.012, -0.006, 0.0, 0.006, 0.012):
                    h = bt.ray_cast(Vector((s * 0.25, ey + dy, ez + dz)), Vector((-s, 0, 0)), 0.3)[0]
                    if h is not None:
                        xs.append(s * h.x)
            if xs:
                exs[s] = sorted(xs)[len(xs) // 2] + 0.013 + 0.0015   # median ear surface: the cushion presses a protruding helix flat
        log('headphone cups x', round(exs[1], 4), round(-exs[-1], 4), 'was', round(ex, 4))
    for s in (1, -1):
        geo.add_cyl(bm, 0.036, 0.034, 0.026, geo.M_at(Vector((s * exs[s], ey, ez))) @ Matrix.Rotation(math.radians(90 * s), 4, 'Y'), segs=12)
    ex = max(exs.values())
    C = Vector((0, ey, ez)); a_end = math.atan2(ex, 0.034); r_end = Vector((ex, 0.034)).length
    trees = [t for t in (tree, fit.tree, fit.hair_tree) if t is not None]
    angs = [-a_end + 2 * a_end * k / 30 for k in range(31)]
    P = [(0.0, 0.0), (-ex, 0.034), (ex, 0.034)]   # (x, z) relative to C: ear centre + both cup tops
    for a in angs:
        r = 0.0
        for t in trees:
            hit = t.ray_cast(C + Vector((math.sin(a), 0, math.cos(a))) * 0.3, -Vector((math.sin(a), 0, math.cos(a))), 0.3)[0]
            if hit is not None:
                r = max(r, (hit - C).length)
        if r > 0:
            P.append((math.sin(a) * (r + 0.0045), math.cos(a) * (r + 0.0045)))
    # a sprung band is taut: it follows the convex hull of cap/hair + cup tops (no jog where the cap edge ends, no dip
    # into the side-cap fold)
    P = sorted(set(P))
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for q in P:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 0: lo.pop()
        lo.append(q)
    for q in reversed(P):
        while len(up) >= 2 and cross(up[-2], up[-1], q) <= 0: up.pop()
        up.append(q)
    hull = lo[:-1] + up[:-1]
    pts = []
    for a in angs:
        dx, dz = math.sin(a), math.cos(a); best = None
        for i in range(len(hull)):
            (x1, z1), (x2, z2) = hull[i], hull[(i + 1) % len(hull)]
            den = dx * (z2 - z1) - dz * (x2 - x1)
            if abs(den) < 1e-9: continue
            t = (x1 * (z2 - z1) - z1 * (x2 - x1)) / den
            u = (x1 * dz - z1 * dx) / den
            if t > 1e-4 and -1e-6 <= u <= 1 + 1e-6 and (best is None or t > best): best = t
        pts.append(C + Vector((dx, 0, dz)) * (best or r_end))
    sweep(bm, pts, 0.009, 0.0025)
    _mark(bm, n0, mi)
    return 'headphones(on cap)'


def clamp_hair(ctx, parts, hg):
    """hair that pokes through the crown of a cap (peaked caps) is pulled in under the cap (>= 4 mm inside), never
    below the scalp"""
    hair = parts.get('hair')
    if not hg or not hair:
        return 0
    fit = HF.HeadFit(ctx, parts)
    tree = geo.bvh_of([hg])
    C = Vector((0, fit.yc, fit.brow - 0.01))
    n = 0
    for v in hair.data.vertices:
        d = v.co - C; rv = d.length
        if rv < 1e-4:
            continue
        d = d / rv
        hit = tree.ray_cast(C, d, 0.4)[0]
        if hit is None:
            continue
        rh = (hit - C).length
        if rv > rh - 0.004 and rv < rh + 0.03:
            sc = fit.tree.ray_cast(C, d, 0.4)[0]
            rs = (sc - C).length + 0.0015 if sc is not None else 0.0
            v.co = C + d * max(rs, rh - 0.004); n += 1
    hair.data.update()
    log('hair clamped under headgear:', n)
    return n


def _bvh(me):
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new(); bm.from_mesh(me)
    t = BVHTree.FromBMesh(bm); bm.free()
    return t


def _bvh_bm(bm):
    from mathutils.bvhtree import BVHTree
    return BVHTree.FromBMesh(bm)
