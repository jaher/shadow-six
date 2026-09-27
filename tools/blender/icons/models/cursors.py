# cursors.py - context cursors re-rendered from the hero props: 32 px class, working tip on the hotspot.
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bpy, studio as S, mats as M, mdl as D
from mathutils import Vector, Matrix
import guns, blades, tools, boxes, misc
from guns import MM, lay

C = dict(cls='cursor', box=(32, 32), margin=0.04)


def tip_shot(name, parts, tip, roll, flip=False, elev=62, rot=(-90, 0, 0)):
    root = D.group(name + '_g', parts, rot=rot, scale=1.0)
    if flip: root.scale = (-1, 1, 1)
    D.hot(tip, parent=root)
    S.shoot(name, 'cursor', box=(32, 32), preset='item', azim=0, elev=elev, roll=roll, margin=0.04)


@S.shot('c_knife')
def _k(mode):
    tip_shot('knife', blades.knife(), (0.175, 0, 0), roll=-135, rot=(90, 0, 0))


@S.shot('c_pistol')
def _p(mode):
    parts, mz = guns.colt1911()
    tip_shot('pistol', parts, (mz[0] * MM, 0, mz[1] * MM), roll=-8, flip=True, elev=70)


@S.shot('c_syringe')
def _s(mode):
    tip_shot('syringe', tools.syringe(), (0.132, 0, 0), roll=135, rot=(0, 0, 0), elev=60)


@S.shot('c_harpoon')
def _h(mode):
    steel = M.metal('spear_steel', M.lin((0.62, 0.63, 0.64)), rough=0.3, wear=0.3)
    P = [guns.cy('shaft', 3.8, 260, steel, 890, 0, 20, 'X', 20, 0.3)]
    tip = D.lathe('tip', [(0, 0), (4.8 * MM, 0), (6 * MM, 8 * MM), (0, 50 * MM)], steel, segs=24)
    tip.rotation_euler = (0, math.radians(90), 0); tip.location = (1012 * MM, 0, 20 * MM); P.append(tip)
    for sgn in (1, -1):
        P.append(guns.sl(f'barb{sgn}', [(996, 20), (1042, 20 + sgn * 3), (990, 20 + sgn * 17)], 2.6, steel, bevel=0.3))
    tip_shot('harpoon', P, (1062 * MM, 0, 20 * MM), roll=-135)


@S.shot('c_pliers')
def _pl(mode):
    tip_shot('pliers', tools.wire_cutters(), (0.134, 0, 0), roll=-135)


@S.shot('c_climb')
def _cl(mode):
    parts = tools.ice_axe()
    tools.big_head(parts)
    tip_shot('climb', parts, (0.70, 0, -0.176 * 1.45), roll=-160)


def centred(name, parts, elev=40, preset='item', rot=(0, 0, 0), **kw):
    D.group(name + '_g', parts, rot=rot)
    S.shoot(name, 'cursor', box=(32, 32), preset=preset, elev=elev, azim=-12, margin=0.04, **kw)


@S.shot('c_grenade')
def _g(mode): centred('grenade', misc.mills(), elev=18, preset='tool', rot=(0, 0, 200), lens=100)


@S.shot('c_trap')
def _t(mode): centred('trap', misc.bear_trap(), elev=32, rot=(40, 0, 10))


@S.shot('c_bomb')
def _b(mode): centred('bomb', boxes.time_bomb(), elev=50)


@S.shot('c_barrel')
def _ba(mode): centred('barrel', misc.oil_drum(), elev=30, preset='tool', lens=100)


@S.shot('c_cap')
def _c(mode): centred('cap', misc.officer_cap(), elev=24, preset='tool', rot=(-16, 0, -6), lens=100)


@S.shot('c_blackjack')
def _bj(mode): tip_shot('fist.blackjack', boxes.blackjack(), (0.22, 0, 0.016), roll=-135, rot=(0, 0, 0), elev=58)


@S.shot('c_chloroform')
def _ch(mode):      # the bottle alone, tipped: a clean silhouette at cursor size
    parts = boxes.chloroform()
    for o in [o for o in parts if o.name.startswith('pad')]: bpy.data.objects.remove(o, do_unlink=True); parts.remove(o)
    centred('fist.chloroform', parts, elev=26, preset='tool', rot=(0, -18, 0), lens=100)


def star_pts(cx, cy, r0, r1, n=5, rot=90):
    return [(cx + (r1 if i % 2 == 0 else r0) * math.cos(math.radians(rot + i * 180 / n)),
             cy + (r1 if i % 2 == 0 else r0) * math.sin(math.radians(rot + i * 180 / n))) for i in range(2 * n)]


@S.shot('c_move')
def _mv(mode):
    """Stamped brass pointer + second chevron + small star (design-spec move cursor), tip at the hotspot (upper-left)."""
    br = M.metal('mv_brass', M.lin((0.84, 0.66, 0.32)), rough=0.22, wear=0.8, wear_color=M.lin((1.0, 0.9, 0.62)))
    arrow = [(0, 0), (140, -50), (90, -70), (190, -170), (160, -200), (60, -100), (40, -150)]
    P = [guns.sl('arrow', arrow, 14, br, bevel=4, plane='XY')]
    chev = [(80, 0), (220, -50), (170, -70), (150, -62), (178, -52), (86, -18)]
    P.append(guns.sl('chev', chev, 10, br, bevel=3, plane='XY'))
    P.append(guns.sl('star', star_pts(215, -215, 11, 26), 8, M.metal('mv_star', M.lin((0.95, 0.86, 0.55)), rough=0.2, wear=0.2), bevel=2, plane='XY'))
    root = D.group('move_g', P, loc=(0, 0, 0.007))
    D.hot((0, 0, 0.007), parent=root)
    S.shoot('move', 'cursor', box=(32, 32), preset='item', elev=72, azim=0, margin=0.04)


@S.shot('c_activate')
def _act(mode):
    """Operating lever: steel quadrant base, lever rod, red bakelite ball knob (knob = hotspot)."""
    st = M.metal('lv_steel', M.lin((0.45, 0.46, 0.47)), rough=0.35, wear=0.6)
    red = M.solid('lv_red', M.lin((0.62, 0.06, 0.04)), rough=0.2, coat=0.6)
    P = [D.box('base', (0.09, 0.05, 0.03), M.paint('lv_paint', M.lin((0.28, 0.30, 0.22)), rough=0.5, wear=0.8), loc=(0, 0, 0.015), bevel=0.004)]
    P.append(tools.ring('quad', 40, tools.rsec(6, 10, 0), st, a0=20, a1=160, segs=24, loc=(0, 0, 0.03), rot=(90, 0, 0)))
    rod = guns.cy('rod', 5, 150, st, 0, 0, 0, 'Z', 24, 0.8)
    rod.rotation_euler = (0, math.radians(-35), 0); rod.location = (-0.043, 0, 0.03 + 0.061); P.append(rod)
    kn = D.lathe('knob', [(0, 0), (0.012, 0.004), (0.017, 0.016), (0.014, 0.028), (0, 0.033)], red, segs=48)
    kn.rotation_euler = (0, math.radians(-35), 0); kn.location = (-0.086, 0, 0.152); P.append(kn)
    D.group('lever_g', P, rot=(0, 0, -20))
    D.hot((-0.1, 0, 0.17))
    S.shoot('activate', 'cursor', box=(32, 32), preset='tool', elev=18, azim=-15, lens=100, margin=0.04)


@S.shot('c_scope')
def _sc(mode):
    """No.32 scope eyepiece seen end-on: blackened steel ring, rubber-less brass-edged bezel, slightly tinted glass."""
    blk = M.paint('eyepiece', M.lin((0.10, 0.10, 0.10)), rough=0.4, wear=0.9, under=M.lin((0.55, 0.55, 0.55)))
    gl = M.glass('ep_glass', color=(0.85, 0.92, 0.95), rough=0.0)
    br = M.metal('ep_brass', M.lin((0.74, 0.58, 0.30)), rough=0.25, wear=0.8)
    P = [tools.ring('ep', 41.5, [(-1, -3), (3, -3), (3.6, 0), (3, 2.5), (-1, 3)], blk, segs=128)]     # slim blackened eyepiece
    P.append(tools.ring('ep_inner', 40.0, tools.rsec(1.2, 2.0, 10), br, segs=128, loc=(0, 0, 0.002)))
    D.group('scope_g', P, rot=(90, 0, 0))
    S.shoot('scope.ring', 'cursor', box=(88, 88), preset='front', margin=0.02, shadow=False, extra={'nocrop': True})
