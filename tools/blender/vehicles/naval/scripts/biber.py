# Biber one-man midget submarine (1944) with two G7e torpedoes slung in the lower side recesses - M13 mini-sub.
# Surfaced trim (hull awash, tower + casing dry). blender -b ... --python biber.py -- grey|burnt|all
# Real dims: L 9.04 m overall (hull 8.47 + screw/rudder frame), B 1.57 m over the slung torpedoes (hull 1.24 m), hull height ~1.3 m, draught 1.0 m (surfaced), G7e 7.16 m x 0.533 m.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nav as N
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from nav import NP, np_
import bmesh
from mathutils import Matrix

ALL = ['grey', 'burnt']
VH.FLAT['wet_torp'] = ((70, 74, 73), 0.18, 0.25)      # awash torpedo tops: wet, glossy
VH.FLAT['rust_pipe'] = ((66, 50, 40), 0.85, 0.2)      # heat-rusted exhaust
PAL = {'hull': (98, 102, 104), 'below': (74, 76, 76), 'dark': (40, 42, 42), 'torp': (92, 95, 92), 'super': (98, 102, 104)}
YB, YS = -4.52, 3.95          # bow tip (knife stem head) .. hull end; screw + rudder + guard frame run aft to +4.52 (L 9.04)
YT = -0.7                    # conning tower centre
TZ, TX = -0.50, 0.52         # torpedo axis: slung in the lower-side recesses (overall beam 2 x (0.52 + 0.267) = 1.57 m)


def _s(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def prof(y):
    """(half-beam, casing top, keel) along the hull: knife bow with the stem raked forward and the deck line rising
    to the stem head, parallel middle body, tapering run to a narrow stern."""
    if y < -2.6:
        t = (y - YB) / 1.92
        hb = 0.62 * max(0.0, t) ** 0.8
    elif y > 1.4:
        t = (y - 1.4) / (YS - 1.4)
        hb = 0.62 * (1 - 0.8 * t ** 1.6)
    else:
        hb = 0.62
    zt = 0.42 + 0.12 * _s((-2.2 - y) / 2.32) - 0.22 * _s((y - 1.6) / 2.35) ** 1.3
    if y < -3.0:
        zk = -0.95 + (zt - 0.04 + 0.95) * ((-3.0 - y) / (-3.0 - YB)) ** 1.35
    else:
        zk = -0.95 + 0.62 * _s((y - 1.8) / (YS - 1.8)) ** 1.2
    return hb, zt, zk


# half-section template (x/hb, z/height from the keel): narrow flat casing, sloping deck shoulders, full upper sides,
# hard chine over the torpedo recess cut into the lower hull, bilge lip, rounded V to the keel
SEC_R = [(0.0, 1.0), (0.24, 1.0), (0.30, 0.94), (0.72, 0.87), (0.93, 0.78), (1.0, 0.66), (0.96, 0.57), (0.90, 0.55), (0.42, 0.50),
         (0.40, 0.36), (0.42, 0.20), (0.62, 0.14), (0.52, 0.07), (0.22, 0.015), (0.0, 0.0)]
SEC_F = [(0.0, 1.0), (0.24, 1.0), (0.30, 0.94), (0.72, 0.87), (0.93, 0.78), (1.0, 0.66), (0.98, 0.57), (0.96, 0.52), (0.92, 0.45),
         (0.86, 0.36), (0.78, 0.25), (0.66, 0.16), (0.52, 0.09), (0.22, 0.02), (0.0, 0.0)]


def section(y):
    hb, zt, zk = prof(y)
    rb = _s((y + 3.25) / 0.45) * (1 - _s((y - 3.45) / 0.4))          # recess only along the torpedoes
    v = _s((-2.4 - y) / 1.9) * 0.9 + _s((y - 2.6) / 1.35) * 0.5        # V-ness of the forefoot / run
    out = []
    for (xr, z), (xf, _) in zip(SEC_R, SEC_F):
        x = xf + (xr - xf) * rb
        if 0 < z < 1:
            x *= z ** v
        out.append((max(0.0015, x * hb) if 0 < x else 0.0, zk + z * (zt - zk)))
    return out


def hull(burnt):
    ys = [YB + 0.0015] + [YB + (YS - YB) * (i / 44) for i in range(1, 45)]
    ys = sorted(set([round(y, 4) for y in ys + [-3.4, -3.2, -3.0, 3.3, 3.6]]))
    secs = [(y, section(y)) for y in ys]
    bm = bmesh.new()
    N.section_loft(bm, secs)
    for f in bm.faces:
        f.smooth = abs(f.normal.z) < 0.9
    N.split_z(bm, 0.0, 'hull', 'below', 'hull', 'hull_below', smooth=True)
    # keel bar along the keel line + knife stem bar up the raked stem
    kp = [(y, prof(y)[2]) for y in [YB + 0.02 + (YS - 0.05 - YB) * i / 30 for i in range(31)]]
    bm = bmesh.new()
    for (y0, z0), (y1, z1) in zip(kp[:-1], kp[1:]):
        C.beam_bm(bm, V((0, y0, z0 - 0.02)), V((0, y1, z1 - 0.02)), 0.06, 0.07)
    np_(bm, 'below', 'keel_below')
    for y in (-2.8, 2.4):
        NP('dark', VH.ring_torus, (0, y, prof(y)[1] + 0.03), 0.06, 0.015, (1, 0, 0), 10, 4, name='lifting_eye', lod='drop')
    # stern gear: shaft out of the tail cone, 3-blade screw, rudder hung in a guard frame carried on a keel skeg
    zc = -0.12
    piv = V((0, 4.1, zc))
    NP('metal', cyl, (0, YS - 0.2, zc), (0, 4.14, zc), 0.035, 8, name='shaft_below')
    NP('brass', cyl, (0, 4.03, zc), (0, 4.17, zc), 0.05, 8, name='prop_hub', node='propeller', pivot=tuple(piv))
    for k in range(3):
        a = math.radians(k * 120 + 30)
        d = V((math.cos(a), 0, math.sin(a)))
        bm = bmesh.new()
        C.quad(bm, [piv + d * 0.04 + V((0, -0.04, 0)), piv + d * 0.22 + d.cross(V((0, 1, 0))) * 0.06,
                    piv + d * 0.25 + V((0, 0.03, 0)), piv + d * 0.04 + V((0, 0.04, 0))])
        N._thicken(bm, 0.008)
        np_(bm, 'brass', 'prop_blade', node='propeller', pivot=tuple(piv))
    VH.moving('propeller', 'propeller', piv, (0, 1, 0), rpm_max=600)
    zg0, zg1 = -0.46, 0.26
    bm = bmesh.new()                                          # guard frame: skeg bar under the screw, top bar, aft post
    C.beam_bm(bm, V((0, 3.2, prof(3.2)[2] + 0.05)), V((0, 4.5, zg0)), 0.05, 0.06)
    C.beam_bm(bm, V((0, 3.75, prof(3.75)[1] - 0.04)), V((0, 4.5, zg1)), 0.04, 0.05)
    C.beam_bm(bm, V((0, 4.5, zg0)), V((0, 4.5, zg1)), 0.04, 0.04)
    np_(bm, 'hull', 'rudder_guard')
    rp = V((0, 4.29, zg0 + 0.03))
    NP('hull', box, (0, 4.39, (zg0 + zg1) / 2), (0.035, 0.2, zg1 - zg0 - 0.08), name='rudder', node='rudder', pivot=tuple(rp))
    NP('metal', cyl, (0, rp.y, zg0), (0, rp.y, zg1), 0.018, 6, name='rudder_stock', node='rudder', pivot=tuple(rp))
    VH.moving('rudder', 'rudder', rp, (0, 0, 1), limits=(-30, 30))
    for sx in (-1, 1):
        hp = V((sx * 0.2, 3.55, -0.12))
        n = 'hydroplane_' + ('l' if sx > 0 else 'r')
        NP('hull', box, (sx * 0.42, 3.57, -0.12), (0.4, 0.26, 0.03), name='hydroplane', node=n, pivot=tuple(hp))
        VH.moving(n, 'hydroplane', hp, (1, 0, 0), limits=(-20, 20))
    VH.contact('keel', (0, 0, -0.97), width=0.1)


def torpedoes(burnt):
    """Two G7e (7.16 m, 533 mm) in the lower side recesses, released by a lever from the tower."""
    for sx in (-1, 1):
        n = 'torpedo_' + ('l' if sx > 0 else 'r')
        c = V((sx * TX, 0.3, TZ))
        y0, y1 = c.y - 3.58, c.y + 3.58
        kw = dict(node=n, pivot=tuple(c))
        bm = bmesh.new()
        prof = [(-0.00, 0.03), (0.06, 0.16), (0.18, 0.245), (0.40, 0.2665), (6.5, 0.2665), (6.95, 0.19), (7.16, 0.07)]
        rings = []
        for d, r in prof:
            rings.append([V((c.x + r * math.cos(t), y0 + d, c.z + r * math.sin(t))) for t in (2 * math.pi * k / 14 for k in range(14))])
        C.loft_bm(bm, rings)
        N.split_z(bm, 0.0, 'wet_torp' if not burnt else 'torp', 'torp', 'torpedo_body', 'torpedo_body_below', node=n, smooth=True)
        NP('torp', box, (c.x, y0 + 0.2, c.z), (0.02, 0.1, 0.02), name='warhead_pistol', lod='drop', **kw)
        for k in range(4):                                   # cruciform tail fins + twin contra-rotating screws
            a = math.radians(45 + 90 * k)
            d = V((math.cos(a), 0, math.sin(a)))
            NP('torp', box, c + V((0, y1 - c.y - 0.12, 0)) + d * 0.17, (0.012 + abs(d.z) * 0.14, 0.2, 0.012 + abs(d.x) * 0.14), name='torpedo_fin', **kw)
        NP('brass', cyl, (c.x, y1 - 0.02, c.z), (c.x, y1 + 0.06, c.z), 0.12, 8, name='torpedo_screw', **kw)
        for yy in (c.y - 2.2, c.y + 1.9):                     # suspension band + release claw
            NP('dark', VH.ring_torus, (c.x, yy, c.z), 0.275, 0.018, (0, 1, 0), 14, 4, name='torpedo_band', lod='drop')
            NP('dark', beam, (c.x - sx * 0.12, yy, c.z + 0.24), (sx * 0.4, yy, c.z + 0.30), 0.05, 0.03, name='torpedo_hanger')
        VH.socket('muzzle_' + n, (c.x, y0 - 0.05, c.z), (0, -1, 0), node=n, weapon='G7e torpedo', speed_mps=15)
        VH.moving(n, 'torpedo', c, (0, -1, 0), note='on fire: detach, run straight along -local Z (bow) at the water line')
        VH.emitter('torpedo_bubbles', (c.x, y1 + 0.1, c.z), (0, 1, 0), node=n, when='running')


def tower(burnt):
    """Small sheet-steel conning tower with 6 viewing ports, top hatch, fixed periscope, air intake, exhaust."""
    zb = 0.30
    bm = bmesh.new()
    rings = []
    for z, sx, sy in ((zb, 0.36, 0.72), (zb + 0.45, 0.33, 0.62), (zb + 0.62, 0.28, 0.50)):
        rings.append([V((sx * math.cos(t), YT + sy * math.sin(t) * (1.0 if math.sin(t) > 0 else 0.9), z)) for t in (2 * math.pi * k / 20 for k in range(20))])
    C.loft_bm(bm, rings)
    np_(bm, 'hull', 'tower', smooth=True)
    for k in range(8):                                       # ring of 8 viewing ports (armoured glass) in heavy rims
        t = math.radians(-90 + k * 45)
        a = V((0.335 * math.cos(t), YT + 0.60 * math.sin(t) * (1.0 if math.sin(t) > 0 else 0.9), zb + 0.47))
        o = V((math.cos(t) / 0.335, math.sin(t) / 0.60, 0.0)).normalized()
        o = (o + V((0, 0, 0.18))).normalized()
        NP('dark', cyl, a - o * 0.02, a + o * 0.04, 0.078, 10, name='port_rim')
        NP('glass' if not burnt else 'soot', cyl, a + o * 0.035, a + o * 0.045, 0.055, 10, name='port_glass')
    hp = V((0, YT + 0.22, zb + 0.62))
    kw = dict(node='hatch', pivot=tuple(hp))
    NP('hull', cyl, (0, YT, zb + 0.62), (0, YT, zb + 0.68), 0.24, 14, name='hatch_lid', **kw)
    NP('dark', box, (0, YT - 0.12, zb + 0.70), (0.1, 0.03, 0.03), name='hatch_handle', lod='drop', **kw)
    VH.moving('hatch', 'hatch', hp, (1, 0, 0), limits=(0, 110))
    NP('metal', cyl, (0.0, YT + 0.25, zb + 0.3), (0.0, YT + 0.25, zb + 1.55), 0.035, 8, r1=0.025, name='periscope', node='periscope', pivot=(0, YT + 0.25, zb + 0.3))
    NP('glass', box, (0.0, YT + 0.22, zb + 1.50), (0.03, 0.02, 0.04), name='periscope_head', node='periscope', pivot=(0, YT + 0.25, zb + 0.3), lod='drop')
    VH.moving('periscope', 'periscope', (0, YT + 0.25, zb + 0.3), (0, 0, 1), limits=(-180, 180), raise_m=0.0)
    NP('metal', cyl, (-0.12, YT + 0.45, zb + 0.4), (-0.12, YT + 0.45, zb + 1.15), 0.03, 8, name='air_intake')
    NP('metal', cyl, (-0.12, YT + 0.45, zb + 1.15), (-0.12, YT + 0.35, zb + 1.2), 0.04, 8, name='air_intake_head', lod='drop')
    # exhaust / air pipe: out of the tower's aft face at tower-top height, carried horizontally aft on two struts
    zp = zb + 0.56
    ex = [V((0.0, YT + 0.42, zp)), V((0.0, 2.7, zp))]
    bm = bmesh.new()
    C.cyl_bm(bm, ex[0], ex[1], 0.055, 10)
    np_(bm, 'rust_pipe' if not burnt else 'soot', 'exhaust_pipe')
    NP('dark', cyl, ex[-1], ex[-1] + V((0, 0.1, -0.03)), 0.062, 10, r1=0.07, name='exhaust_muzzle')
    for y in (0.9, 2.45):
        NP('dark', beam, (0, y, zp - 0.05), (0, y, prof(y)[1] - 0.01), 0.04, 0.03, name='exhaust_strut')
        NP('dark', VH.ring_torus, (0, y, zp), 0.065, 0.012, (0, 1, 0), 10, 4, name='pipe_clamp', lod='drop')
    VH.emitter('exhaust', tuple(ex[-1] + V((0, 0.12, -0.03))), (0, 1, -0.1), kind2='petrol (Opel Blitz engine, surfaced)')
    NP('dark', beam, (0, YT - 0.6, zb + 0.5), (0, YB + 0.1, 0.52), 0.02, 0.02, name='jumping_wire', lod='drop')
    NP('dark', beam, (0, 2.75, zp + 0.02), (0, 4.5, 0.27), 0.02, 0.02, name='jumping_wire', lod='drop')
    VH.socket('pilot', (0, YT, 0.0), (0, -1, 0), role='driver', pose='sit_sub', note='head at hatch height when surfaced')


def main(var, out_root):
    N.setup('minisub_biber', var, PAL, scale=0.45, seed=41)
    burnt = var == 'burnt'
    N.FIRE[:] = [(0, 1.8, 0.4, 0.9), (0, YT, 0.9, 0.6)] if burnt else []
    hull(burnt)
    tower(burnt)
    torpedoes(burnt)
    N.wake((0, 4.5, 0.0), (0, -4.5, 0.02), 1.3, prop=(0, 4.1, -0.12))
    VH.emitter('dive_bubbles', (0, -1.0, 0.0), (0, 0, 1), when='diving')
    VH.emitter('fire', (0, 1.8, 0.35), (0, 0, 1), when='destroyed', note='petrol engine compartment')
    if burnt:                      # holed and sinking by the stern, only the tower and bow casing show
        VH.emitter('smoke', (0, 1.0, 0.6), (0, 0, 1), kind2='wreck_smoulder')
        VH.apply_T(Matrix.Translation((0, 0, -0.42)) @ Matrix.Rotation(math.radians(-4), 4, 'X') @ Matrix.Rotation(math.radians(8), 4, 'Y'))
    dims = {'length': 9.04, 'beam': 1.57, 'hull_height': 1.3, 'draft_surfaced': 0.99, 'torpedo': 'G7e 7.16 x 0.533 m x2'}
    N.finalize(out_root, 'minisub_biber', 'minisub', dims, 0.99, var, ALL, 'Biber one-man midget submarine (1944) with 2 G7e torpedoes',
               extra={'gameplay_size_suggest': [9.0, 1.6], 'torpedoes': 2, 'crew': 1}, ao_dist=0.5, lods=((0.85, 0.03), (0.5, 0.06)))


if __name__ == '__main__':
    N.run(main, ALL)
