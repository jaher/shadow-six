# Narrow-gauge (600 mm Feldbahn / mine railway) wagons for M19 Oldenburg coal mine:
#   mine_tipper = V-skip side-tipping wagon (Muldenkipper / Kipplore 0.75 m3), skip tips to either side about the rockers;
#   mine_cart   = riveted box coal tub (Foerderwagen / Grubenwagen 0.8 m3) with end door.
# blender -b ... --python mine_carts.py -- tipper_rust,tipper_winter,cart_rust,cart_winter|all
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rail as R
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from rail import RP, rp_
import bmesh

ALL = ['tipper_rust', 'tipper_winter', 'cart_rust', 'cart_winter']


def pal():
    return {'skip': (76, 50, 36), 'frame': (52, 44, 38), 'wheel': (88, 62, 44), 'dark': (34, 32, 30), 'buffer': (44, 40, 36)}


def channel_y(x, L, zc, facing, h=0.1, fw=0.045, t=0.008, name='side_channel'):
    """Rolled steel channel along Y: web at x, flanges toward `facing` (+1/-1 in x)."""
    RP('steel', box, (x, 0, zc), (t, L, h), name=name, bisect=False)
    for dz in (-1, 1):
        RP('steel', box, (x + facing * fw / 2, 0, zc + dz * (h - t) / 2), (fw, L, t), name=name + '_flange', bisect=False)


def running(L, wb, r, zf):
    """Two wheelsets, rolled-steel channel frame (flanges outward), cast wheel pedestals (horn guides) with axleboxes,
    channel end beams with cast buffer bosses and link-and-pin chain couplers."""
    for i, y in enumerate((-wb / 2, wb / 2)):
        R.wheelset('ws%d' % i, y, r, 'spoked', spokes=6, segs=14, key='wheel', axle_key='dark')
    g = R.GAUGE[0]
    xo = g / 2 + 0.11
    for s in (-1, 1):
        channel_y(s * xo, L - 0.1, zf, s)
        for y in (-wb / 2, wb / 2):
            bm = bmesh.new()                                        # cast pedestal: inverted-U jaws round the axlebox
            prof = [(y - 0.14, zf - 0.05), (y + 0.14, zf - 0.05), (y + 0.1, r - 0.09), (y + 0.06, r - 0.09), (y + 0.06, r + 0.07),
                    (y - 0.06, r + 0.07), (y - 0.06, r - 0.09), (y - 0.1, r - 0.09)]
            VH.side_prism(bm, prof, s * xo - 0.012, s * xo + 0.012)
            rp_(bm, 'steel', 'wheel_pedestal', bisect=False)
            RP('dark', box, (s * xo, y, r), (0.06, 0.1, 0.11), name='axlebox', bisect=False)
            RP('dark', box, (s * xo, y, r - 0.075), (0.05, 0.14, 0.015), name='pedestal_tie', bisect=False, lod='drop')
    for f in (-1, 1):
        y = f * (L / 2 - 0.05)
        RP('steel', box, (0, y, zf), (2 * xo + 0.06, 0.008, 0.12), name='end_beam', bisect=False)          # channel end beam
        for dz in (-1, 1):
            RP('steel', box, (0, y - f * 0.02, zf + dz * 0.056), (2 * xo + 0.06, 0.045, 0.008), name='end_beam_flange', bisect=False)
        RP('dark', box, (0, y + f * 0.03, zf + 0.01), (0.26, 0.06, 0.14), name='buffer_block', bisect=False)   # cast buffer boss
        RP('dark', cyl, (0, y + f * 0.06, zf + 0.01), (0, y + f * 0.09, zf + 0.01), 0.06, 8, name='buffer_face', bisect=False, lod='drop')
        bm = bmesh.new()
        c0 = V((0, y + f * 0.12, zf))
        for k in range(3):                                          # chain links
            c = c0 + V((0, f * 0.07 * k, -0.02 * k))
            VH.ring_torus(bm, c, 0.035, 0.008, (1, 0, 0) if k % 2 else (0, 0, 1), 8, 3)
        rp_(bm, 'dark', 'chain', lod='drop', bisect=False)
        VH.socket('coupler_' + ('front' if f < 0 else 'rear'), (0, y + f * 0.09, zf + 0.01), (0, f, 0), note='buffer boss face')
    VH.socket('push', (0, L / 2 + 0.5, 0.0), (0, -1, 0), pose='push', note='a man can push it along the track')


def tipper(var):
    """Muldenkipper: deep V-trough skip (rolled rim, angle stiffeners, end plates) on two curved ROCKERS that roll on
    flat cradle rails across the steel frame. Tipping = rolling: rotate about the rocker-arc centre (node pivot) and
    translate sideways by R * theta, so the skip's lower corners never enter the frame."""
    L, wb, r, zf = 1.75, 0.55, 0.15, 0.42
    running(L, wb, r, zf)
    zc = 0.56                                                       # cradle rail top
    RR = 0.45                                                       # rocker arc radius
    piv = V((0, 0, zc + RR))
    for y in (-0.45, 0.45):                                         # cradles: flat steel rails + end stops + latch hooks
        RP('frame', box, (0, y, zc - 0.07), (0.9, 0.06, 0.14), name='cradle_rail', bisect=False)
        RP('frame', beam, (-0.3, y, zf + 0.05), (-0.1, y, zc - 0.14), 0.05, 0.04, name='cradle_brace', bisect=False, lod='drop')
        RP('frame', beam, (0.3, y, zf + 0.05), (0.1, y, zc - 0.14), 0.05, 0.04, name='cradle_brace', bisect=False, lod='drop')
        for s in (-1, 1):
            RP('frame', box, (s * 0.47, y, zc + 0.02), (0.05, 0.07, 0.1), name='cradle_stop', bisect=False)
    kw = dict(node='skip', pivot=tuple(piv))
    sec = [(-0.63, 1.22), (-0.6, 1.2), (-0.2, 0.72), (-0.1, 0.655), (0.0, 0.64), (0.1, 0.655), (0.2, 0.72), (0.6, 1.2), (0.63, 1.22)]
    bm = bmesh.new()
    rings = [[V((x, y, z)) for x, z in sec] for y in (-0.7, -0.35, 0.0, 0.35, 0.7)]
    C.loft_bm(bm, rings, False, False, closed=False)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.01)
    rp_(bm, 'skip', 'skip_trough', smooth=True, **kw)
    for s in (-1, 1):                                               # rolled rim + two diagonal angle stiffeners per side
        RP('skip', cyl, (s * 0.625, -0.72, 1.215), (s * 0.625, 0.72, 1.215), 0.025, 6, name='skip_rim', bisect=False, **kw)
        for y in (-0.35, 0.35):
            RP('frame', beam, (s * 0.61, y, 1.2), (s * 0.2, y, 0.71), 0.04, 0.03, up=V((0, 1, 0)), name='skip_stiffener', bisect=False, **kw)
    for f in (-1, 1):
        bm = bmesh.new()
        vs = [bm.verts.new(V((x, f * 0.7, z))) for x, z in sec]
        bm.faces.new(vs if f > 0 else list(reversed(vs)))
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.015)
        rp_(bm, 'skip', 'skip_end', **kw)
        bm = bmesh.new()                                            # rocker: curved plate (arc about piv) under the end
        arc = [piv + V((RR * math.sin(a), 0, -RR * math.cos(a))) for a in [math.radians(-50 + 10 * k) for k in range(11)]]
        for yy in (f * 0.43, f * 0.47):
            for a, b in zip(arc[:-1], arc[1:]):
                C.beam_bm(bm, a + V((0, yy, 0)), b + V((0, yy, 0)), 0.02, 0.05, up=V((0, 1, 0)))
        rp_(bm, 'frame', 'skip_rocker', bisect=False, **kw)
        tz = lambda x: 0.64 + 0.15 * abs(x) if abs(x) < 0.1 else (0.655 + 0.65 * (abs(x) - 0.1) if abs(x) < 0.2 else 0.72 + 1.263 * (abs(x) - 0.2))
        for a in (-0.75, -0.4, 0.4, 0.75):                          # rocker webs up to the trough underside
            p0 = piv + V((RR * math.sin(a), f * 0.45, -RR * math.cos(a) + 0.02))
            RP('frame', beam, p0, (p0.x, f * 0.45, tz(p0.x)), 0.03, 0.04, name='rocker_web', bisect=False, **kw)
        RP('dark', box, (0.52, f * 0.73, 1.0), (0.06, 0.04, 0.12), name='skip_catch', bisect=False, lod='drop', **kw)
    RP('dark', beam, (0.52, 0.76, 0.95), (0.52, 0.76, 0.5), 0.03, 0.03, name='latch', bisect=False, lod='drop')
    def zfn(x, y, u, v):
        ex = 1 - (2 * u - 1) ** 2
        ey = 1 - (2 * v - 1) ** 4
        return 1.145 + 0.2 * ex * ey
    load(var, zfn, -0.55, 0.55, -0.66, 0.66, kw)
    VH.moving('skip', 'tip', tuple(piv), (0, 1, 0), limits=(-48, 48), rocker_radius=RR,
              roll='rolling rocker: rotate by theta about the pivot AND translate the node sideways by rocker_radius * theta (rad) toward the tipping side',
              note='rotate about the track axis (local Z in glTF) to dump either side')
    VH.emitter('dump', (0.9, 0, 0.6), (1, 0, -0.5), when='tipping', note='coal/spoil pouring out (mirror x for the other side)')
    return L, 1.25


def cart(var):
    L, wb, r, zf = 1.6, 0.5, 0.17, 0.38
    running(L, wb, r, zf)
    kw = dict(node='main')
    z0, z1, hw, hl = zf + 0.08, 1.12, 0.42, 0.72
    bm = bmesh.new()
    C.box_bm(bm, (0, 0, (z0 + z1) / 2), (2 * hw, 2 * hl, z1 - z0))
    top = [f for f in bm.faces if f.calc_center_median().z > z1 - 0.01]
    bmesh.ops.delete(bm, geom=top, context='FACES')
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.01)
    rp_(bm, 'skip', 'tub_box')
    for s in (-1, 1):                                               # angle bands + rivet strips
        for z in (z0 + 0.03, z1 - 0.02, (z0 + z1) / 2):
            RP('frame', box, (s * (hw + 0.01), 0, z), (0.02, 2 * hl + 0.02, 0.05), name='band', bisect=False)
        for y in (-hl, hl):
            RP('frame', box, (s * (hw - 0.01), y, (z0 + z1) / 2), (0.05, 0.05, z1 - z0), name='corner_angle', bisect=False)
    RP('frame', box, (0, -hl - 0.01, z1 - 0.02), (2 * hw, 0.02, 0.05), name='band_end', bisect=False)
    RP('skip', box, (0, hl + 0.02, (z0 + z1) / 2), (2 * hw - 0.1, 0.02, z1 - z0 - 0.08), name='end_door', node='end_door', pivot=(0, hl + 0.02, z1 - 0.04))
    VH.moving('end_door', 'hatch', (0, hl + 0.02, z1 - 0.04), (1, 0, 0), limits=(0, 100), note='top-hung end door')
    load(var, lambda x, y, u, v: z1 - 0.1 + 0.2 * (1 - (2 * u - 1) ** 2) * (1 - (2 * v - 1) ** 2), -hw + 0.02, hw - 0.02, -hl + 0.02, hl - 0.02, kw)
    VH.emitter('dump', (0, hl + 0.2, 0.6), (0, 1, -0.5), when='end door open')
    return L, z1


def load(var, zfn, x0, x1, y0, y1, kw):
    R.coal_heap(x0, x1, y0, y1, zfn, node=kw['node'], pivot=kw.get('pivot'), step=0.07, lumps=45, lump_r=(0.03, 0.13))
    VH.VM['toggles']['coal_load'] = {'default': True, 'node': kw['node'], 'note': 'coal in the wagon (hide = empty)'}


def main(var, out_root):
    kind, paint = var.split('_')
    R.setup('mine_' + kind, paint, pal(), seed=19 if kind == 'tipper' else 23, gauge=0.6)
    R.TEX['steel'] = ('cast_iron', (0.62, 0.5, 0.42))            # rusty rolled / cast steel (no painted-board grain)
    L, H = tipper(var) if kind == 'tipper' else cart(var)
    if paint == 'winter':
        R.snow_cover(min_z=0.3, cover=0.25, skip=('skip_trough', 'skip_end', 'tub_box', 'coal', 'snow', 'wheel', 'axle', 'lumps', 'chain', 'rim'))
    real = 'Muldenkipper V-skip side-tipping wagon, 600 mm gauge, 0.75 m3' if kind == 'tipper' else 'Riveted box coal tub (Foerderwagen), 600 mm gauge, 0.8 m3'
    dims = {'length': L + 0.26, 'width': 1.24 if kind == 'tipper' else 0.9, 'height': H + 0.2, 'gauge': 0.6, 'wheel_d': 0.3 if kind == 'tipper' else 0.34}
    R.finalize(out_root, 'mine_' + kind, 'mine_wagon', dims, paint, ['rust', 'winter'], real,
               extra={'pushable': True, 'mass_t': 0.45, 'payload_t': 1.2}, ao_dist=0.4)


if __name__ == '__main__':
    R.run(main, ALL)
