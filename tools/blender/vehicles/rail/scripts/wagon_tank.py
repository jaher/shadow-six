# DR 2-axle tank wagon (Kesselwagen, fuel / mineral oil, Wehrmacht requisition), brakeman's platform at the rear.
# blender -b ... --python wagon_tank.py -- grey|winter|burnt|all
# Dims: LuP 9.0 m, wheelbase 4.5 m, wheels 1.0 m, tank dia 2.0 m x 7.0 m (21 m3), dome 0.9 m, height 3.95 m.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rail as R
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from rail import RP, rp_
import bmesh

ALL = ['grey', 'winter', 'burnt']
TR, TL, ZC = 1.0, 7.0, 2.42          # tank radius, cylindrical length, axis height


def pal():
    return dict(R.DR, keep_soot=(9, 8, 8), tank=(108, 108, 102), wheel=(66, 54, 46), white=(200, 196, 186), red=(120, 30, 24), plate=(22, 22, 21))


def cyl_uv(bm, tile):
    """u = along the tank (m / tile), v = around the circumference (arc m / tile), seam unwrapped per face."""
    lay = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        angs = [math.atan2(l.vert.co.z - ZC, l.vert.co.x) for l in f.loops]
        if max(angs) - min(angs) > math.pi:
            angs = [a + 2 * math.pi if a < 0 else a for a in angs]
        for l, a in zip(f.loops, angs):
            l[lay].uv = (l.vert.co.y / tile, a * TR / tile)


def shell_sag(p):
    """Burnt: the heat-softened shell sags between the saddles (straps and bands follow it)."""
    p.z -= 0.1 * math.sin(math.pi * min(1.0, max(0.0, (p.y + TL / 2 + 0.44) / (TL + 0.88))))
    return p


def rupture(hc):
    """Burnt: dark sooted interior seen through the 1.4 m tear (inward-facing lining, black), plus torn petals of plate
    peeled OUTWARD (+X, toward the SE camera) and curled so they break the flank silhouette."""
    bm = bmesh.new()
    C.cyl_bm(bm, V((0, hc.y - 1.6, ZC)), V((0, hc.y + 1.6, ZC)), TR - 0.05, 16, caps=True)
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    for v in bm.verts:
        shell_sag(v.co)
    rp_(bm, 'keep_soot', 'tank_interior_soot', bisect=False)
    r = C.rng()
    bm = bmesh.new()
    for k in range(8):
        a = 2 * math.pi * k / 8 + 0.25 * r.random()
        t = V((0, math.cos(a), math.sin(a)))                    # direction in the tangent plane (y, z)
        base = hc + t * (0.62 + 0.08 * r.random())
        base.x = math.sqrt(max(0.0, TR ** 2 - (base.z - ZC) ** 2))          # on the shell surface
        shell_sag(base)
        out = (V((base.x, 0, base.z - ZC)).normalized() + V((0.8, 0, 0))).normalized()
        L = 0.6 + 0.4 * r.random()
        w = 0.42 + 0.14 * r.random()
        side = V((0, -t.z, t.y))
        rows = []
        for j in range(4):
            u = j / 3
            c = base + t * (L * 0.45 * u) + out * (L * (0.05 + 0.9 * u * u)) - t * (0.25 * L * u ** 3)
            ww = w * (1 - 0.8 * u) * 0.5
            rows.append((bm.verts.new(c - side * ww), bm.verts.new(c + side * ww)))
        for p_, q_ in zip(rows[:-1], rows[1:]):
            bm.faces.new((p_[0], p_[1], q_[1], q_[0]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.02)
    rp_(bm, 'tank', 'rupture_petal', bisect=False)


def tank(burnt):
    """Riveted tank (rivet texture = longitudinal lap seams) with deep dished (torispherical) ends, a riveted knuckle
    ring at each end, 2 circumferential seam bands, tension straps over the saddles with turnbuckles, black data
    panel; dome with hatch + grated platform and a compact railing. burnt: ruptured side + sag."""
    bm = bmesh.new()
    segs = 24
    rings = []
    dish = [(0.0, TR), (0.06, 0.985), (0.13, 0.94), (0.22, 0.84), (0.31, 0.68), (0.38, 0.48), (0.42, 0.26), (0.44, 0.001)]
    ys = [-TL / 2 - d for d, r in reversed(dish)] + [-TL / 2 + TL * k / 8 for k in range(1, 8)] + [TL / 2 + d for d, r in dish]
    rs = [r for d, r in reversed(dish)] + [TR] * 7 + [r for d, r in dish]
    for y, r in zip(ys, rs):
        rings.append([V((r * math.cos(2 * math.pi * i / segs), y, ZC + r * math.sin(2 * math.pi * i / segs))) for i in range(segs)])
    C.loft_bm(bm, rings, False, False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.004)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if burnt:                                                   # rupture on the +X (left) flank, front half (visible SE)
        hc = V((TR, -1.3, ZC + 0.25))
        near = [e for e in bm.edges if (e.verts[0].co - hc).length < 1.9 or (e.verts[1].co - hc).length < 1.9]
        bmesh.ops.subdivide_edges(bm, edges=near, cuts=3, use_grid_fill=True)
        bm.faces.ensure_lookup_table()
        rad = lambda p: 0.72 + 0.28 * (VH._n(p, 4.0) - 0.5) * 2
        dead = [f for f in bm.faces if (f.calc_center_median() - hc).length < rad(f.calc_center_median())]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        for v in bm.verts:                                      # torn petals peeled outward + a buckled, sagging shell
            d = (v.co - hc).length
            if d < 1.25:
                n = V((v.co.x, 0, v.co.z - ZC)).normalized()
                v.co += n * (0.28 * (1.25 - d) / 0.55) * (0.6 + 0.8 * VH._n(v.co, 6.0))
            shell_sag(v.co)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.025)
        print('RUPTURE faces deleted', len(dead))
    if burnt:                                                   # continuous cylindrical UVs (no per-face patchwork)
        cyl_uv(bm, 2.0)
        rp_(bm, 'tank', 'tank_shell', smooth=True, uv='keep')
        rupture(V((TR, -1.3, ZC + 0.25)))
    else:
        rp_(bm, 'tank', 'tank_shell', smooth=True)
    for f in (-1, 1):                                           # riveted knuckle rings (end/shell joint) + seam bands
        RP('frame', cyl, (0, f * (TL / 2 + 0.02), ZC), (0, f * (TL / 2 - 0.06), ZC), TR + 0.014, 24, caps=False, name='end_ring', bisect=False)
    for y in (-TL / 6, TL / 6):
        if burnt and y < 0:
            continue                                            # this band ran through the tear: gone
        RP('tank', cyl, (0, y - 0.05, ZC), (0, y + 0.05, ZC), TR + 0.01, 24, caps=False, name='seam_band', bisect=False)
    for y in (-2.2, 2.2):                                       # saddles + tension straps with turnbuckles
        RP('frame', box, (0, y, ZC - TR + 0.05), (1.9, 0.3, 0.3), name='saddle')
        bm = bmesh.new()
        pts = [V((math.cos(a) * (TR + 0.012), y, ZC + math.sin(a) * (TR + 0.012))) for a in [math.radians(-20 + 11 * k) for k in range(21)]]
        if burnt:                                               # straps follow the sagging shell; the front one snapped
            pts = [shell_sag(p) for p in pts]
            if y < 0:
                keep = pts[11:]                                 # -X half still clamped over the top
                loose = pts[:4] + [pts[3] + V((0.22, 0, -0.05)), pts[3] + V((0.3, 0.05, -0.55))]   # +X end springs out, hangs
                for seg in (keep, loose):
                    for a, b in zip(seg[:-1], seg[1:]):
                        C.beam_bm(bm, a, b, 0.09, 0.012, up=V((0, 1, 0)))
                pts = []
        for a, b in zip(pts[:-1], pts[1:]):
            C.beam_bm(bm, a, b, 0.09, 0.012, up=V((0, 1, 0)))
        rp_(bm, 'dark', 'tension_strap', bisect=False)
        for s in (-1, 1):
            p0 = V((s * math.cos(math.radians(20)) * (TR + 0.012), y, ZC - math.sin(math.radians(20)) * (TR + 0.012)))
            RP('dark', cyl, p0, V((s * 0.99, y, 1.3)), 0.025, 6, name='strap_rod', bisect=False)
            RP('dark', box, tuple(p0.lerp(V((s * 0.99, y, 1.3)), 0.5)), (0.06, 0.06, 0.18), name='turnbuckle', lod='drop')
    # dome with hatch (node) + safety valve
    dz = ZC + TR
    if not burnt:
        RP('tank', cyl, (0, 0, dz - 0.15), (0, 0, dz + 0.42), 0.45, 16, name='dome', smooth=True, bisect=False)
        RP('tank', cyl, (0, 0, dz + 0.42), (0, 0, dz + 0.47), 0.48, 16, name='dome_rim', bisect=False)
        RP('tank', cyl, (0, 0.0, dz + 0.47), (0, 0.0, dz + 0.52), 0.3, 12, name='dome_hatch', node='hatch', pivot=(0, -0.3, dz + 0.5), bisect=False)
        RP('dark', box, (0, 0.2, dz + 0.54), (0.08, 0.12, 0.05), name='hatch_clamp', node='hatch', pivot=(0, -0.3, dz + 0.5), lod='drop')
        VH.moving('hatch', 'hatch', (0, -0.3, dz + 0.5), (1, 0, 0), limits=(0, 110))
        RP('dark', cyl, (0.3, 0.3, dz + 0.42), (0.3, 0.3, dz + 0.62), 0.05, 8, name='safety_valve', lod='drop')
        VH.socket('hatch_top', (0, 0.9, dz), (0, -1, 0), pose='kneel', note='on the walkway at the dome')
    else:
        RP('tank', cyl, (0, 0, dz - 0.25), (0, 0, dz + 0.02), 0.45, 16, name='dome_stump', bisect=False)
    # dome platform: angle frame + grating either side of the dome on brackets, compact railing (0.75 m)
    zp = dz - 0.12
    for s in (-1, 1):
        RP('steel_grate', box, (s * 0.52, 0, zp), (0.5, 1.4, 0.03), name='dome_platform')
        RP('dark', box, (s * 0.78, 0, zp - 0.02), (0.04, 1.44, 0.07), name='platform_angle')
        for yy in (-0.6, 0.6):
            RP('dark', beam, (s * 0.78, yy, zp - 0.03), (s * 0.45, yy, ZC + 0.82), 0.04, 0.04, name='platform_bracket', bisect=False, lod='drop')
    for f in (-1, 1):
        RP('dark', box, (0, f * 0.7, zp - 0.02), (1.6, 0.04, 0.07), name='platform_angle')
    for s in (-1, 1):
        R.handrail([(s * 0.76, -0.68, zp), (s * 0.76, -0.68, zp + 0.75), (s * 0.76, 0.68, zp + 0.75), (s * 0.76, 0.68, zp)], r=0.016)
        R.handrail([(s * 0.76, -0.68, zp + 0.38), (s * 0.76, 0.68, zp + 0.38)], r=0.012)
        bm = bmesh.new()
        x0, x1 = s * 0.78, s * 1.25
        for yy in (-0.25, 0.25):
            C.cyl_bm(bm, V((x1, yy, 1.35)), V((x0, yy, zp)), 0.018, 5)
        for k in range(5):
            t = (k + 0.5) / 5
            C.cyl_bm(bm, V((x1 + (x0 - x1) * t, -0.25, 1.35 + (zp - 1.35) * t)), V((x1 + (x0 - x1) * t, 0.25, 1.35 + (zp - 1.35) * t)), 0.015, 5)
        rp_(bm, 'dark', 'ladder', lod='drop', bisect=False)
    # bottom outlet valve + fuel leak emitter
    RP('dark', cyl, (0, 0.8, ZC - TR), (0, 0.8, ZC - TR - 0.35), 0.08, 8, name='outlet', bisect=False)
    RP('red', cyl, (-0.1, 0.8, ZC - TR - 0.25), (0.25, 0.8, ZC - TR - 0.25), 0.05, 6, name='outlet_handle', lod='drop', bisect=False)
    VH.emitter('fuel_leak', (0, 0.8, ZC - TR - 0.35), (0, 0, -1), when='damaged')
    VH.socket('valve', (0.9, 0.8, 0.0), (-1, 0, 0), pose='kneel', note='outlet valve (open = fuel spill, M-level oil fire)')
    if not burnt:
        for s in (-1, 1):
            RP('plate', box, (s * (TR + 0.004), -1.4, ZC + 0.05), (0.02, 1.7, 0.62), name='data_panel')
            R.label_block((s * (TR + 0.016), -1.4, ZC + 0.05), (s, 0, 0), 1.45, 0.48, 3)
            R.label_block((s * (TR + 0.01), 2.0, ZC - 0.1), (s, 0, 0), 0.6, 0.3, 2)


def platform(yr):
    """Brakeman's platform at the rear end with a handbrake column and railings."""
    y0 = 3.45
    RP('planks', box, (0, y0 + 0.4, 1.25), (2.7, 0.8, 0.06), name='brake_platform')
    RP('dark', cyl, (0.9, y0 + 0.5, 1.28), (0.9, y0 + 0.5, 2.25), 0.03, 6, name='brake_column')
    RP('dark', VH.ring_torus, (0.9, y0 + 0.5, 2.28), 0.18, 0.014, (0, 0, 1), 12, 4, name='brake_wheel', lod='drop')
    for s in (-1, 1):
        R.handrail([(s * 1.3, y0, 1.28), (s * 1.3, y0, 2.3), (s * 1.3, y0 + 0.78, 2.3), (s * 1.3, y0 + 0.78, 1.28)])
    R.handrail([(-1.3, y0 + 0.8, 2.1), (1.3, y0 + 0.8, 2.1)])
    VH.socket('brakeman', (0.4, y0 + 0.4, 1.28), (0, -1, 0), pose='stand')


def main(var, out_root):
    burnt = var == 'burnt'
    R.setup('wagon_tank', var, pal(), seed=43)
    R.TEX['steel_grate'] = ('steel_grating', (0.55, 0.55, 0.52))
    R.RIVETED.add('tank')
    R.HEAT.add('tank')
    R.SWAP['veh_burnt~fbfbfb'] = 'heat'                     # burnt shell: organic heat discolouration + flaking
    yf, yr = R.two_axle_underframe(7.6, 4.5, 0.5, 1.2, 'frame', 'wheel', blen=0.62)
    tank(burnt)
    platform(yr)
    if burnt:
        VH.emitter('fire', (0.7, 2.0, ZC + 0.7), (0.6, 0, 0.8), when='destroyed', note='burning fuel jet from the torn side')
        VH.emitter('smoke', (0, 0, ZC + 1.2), (0, 0, 1), kind2='oil_black')
    if var == 'winter':
        R.snow_cover(min_z=1.0, cover=0.25)
    if burnt:
        R.deform(('seam_band', 'end_ring'), shell_sag)
    if burnt:                                                   # heat-sagged underframe + buckled railings
        def sag(v):
            v.z -= 0.13 * math.sin(math.pi * min(1.0, max(0.0, (v.y + 4.6) / 9.2)))
            return v
        R.deform(('solebar', 'crossmember', 'truss_rod', 'saddle', 'brake_cyl', 'air_reservoir', 'brake_pipe'), sag)

        def bend(v):
            if v.z > 2.0:
                v.x += 0.12 * math.sin(v.y * 3.1 + v.z * 2.0)
                v.z -= 0.1 * max(0.0, v.z - 3.3)
            return v
        R.deform(('handrail', 'ladder', 'platform_angle', 'dome_platform'), bend)
    dims = {'length_over_buffers': round(yr - yf, 3), 'wheelbase': 4.5, 'wheel_d': 1.0, 'tank_d': 2 * TR, 'tank_len': TL,
            'height': round(ZC + TR + 0.52, 3), 'buffer_height': 1.06, 'volume_m3': 21}
    R.finalize(out_root, 'wagon_tank', 'rail_wagon', dims, var, ALL, 'DR 2-axle tank wagon (Kesselwagen) for fuel',
               extra={'class': 'Kesselwagen', 'mass_t': 12.0, 'payload_t': 17.0, 'explodes': True})


if __name__ == '__main__':
    R.run(main, ALL)
