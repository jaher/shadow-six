"""M11 Maradah whitewashed domed houses (Italian-colonial Libya: rubble-stone walls under lime render, flat roofs behind
lime-coped parapets, a small domed kiosk (qubba) on the roof, green / blue shutters, ochre dado, palm-log spouts):
  hq (+ _destroyed): `hq_domed_terraced` N HQ, 9 x 8: two storeys stepped back — a full ground floor (3.6 m) whose S half
      is a roof terrace with a palm-log pergola under reed mats, the upper storey over the N half (to 7 m) carrying the
      dome; an outside stair up the E face to the terrace; double door mid S. Destroyed: terrace + upper floor caved in,
      S + E breaches, dome split, rubble.
  e: `hq_domed_terraced` small (house_e, E valley), 9 x 7 x 5: one tall storey, roof pergola, dome; door S at x +0.5.
  a: `hq_domed_terraced` large (house_a, S camp), 10 x 12 x 6: two storeys, a dome on the N, water tank; door E (y -2.5).
  b (+ _destroyed): `barracks_desert` domed and flagged (barracks_sw), 9 x 8 x 5: one storey, stepped-merlon parapet,
      sandbag MG post on the SE roof corner, dome; door W (y -1.5). Destroyed: roof caved, W + S breaches, dome split.
Front (Blender -Y) = game S. Usage: blender -b --python ms_domed.py -- outdir [hq|e|a|b][_destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ms_common import *

OUT, VAR, SEED = args('hq')
DEST = VAR.endswith('destroyed')
KIND = VAR.split('_')[0]
NAME = {'hq': 'hq_domed_ms', 'e': 'house_domed_ms_e', 'a': 'house_domed_ms_a', 'b': 'barracks_domed_ms'}[KIND] + ('_destroyed' if DEST else '')
K.begin(NAME, 11401 + SEED + 13 * 'hqeab'.index(KIND[0]) + (7 if DEST else 0), theater='desert')
r = K.rng()
REND, DADO = 'limewash_worn', (0.93, 0.8, 0.6)
SHUT = {'hq': SHUT_GREEN, 'e': (0.24, 0.4, 0.55), 'a': (0.24, 0.4, 0.55), 'b': SHUT_GREEN}[KIND]
# W, D, ground-floor wall height, door (edge, t), upper block (y0, y1) or None, dome (x, y, size), parapet style
CFG = {'hq': (9, 8, 3.4, (0, 4.5), (-0.6, 4.0), (1.6, 2.0, 2.4), 'round'),
       'e': (9, 7, 4.1, (0, 5.0), None, (2.3, 1.6, 2.4), 'round'),
       'a': (10, 12, 2.9, (1, 3.5), 'full', (0.6, 3.4, 2.8), 'round'),
       'b': (9, 8, 4.1, (3, 5.5), None, (-2.0, 1.8, 2.3), 'stepped')}[KIND]
W, D, H1, DOOR, UPPER, DOME, PSTYLE = CFG
HW, HD, T = W / 2, D / 2, 0.45
poly = rect(-HW, -HD, HW, HD)


def win_frames(pl, z_sill, skip, h=1.3, w=0.9, shape='arch', every=2.7, edges=(0, 1, 2, 3)):
    """Windows spread along each edge, none within 1.3 m of a skip (edge, t)."""
    out = []
    for e in edges:
        a, b, rr_, n, L = dz.edge(pl, e)
        k = max(1, int((L - 1.2) / every))
        for i in range(k):
            t = (i + 0.5) * L / k
            if any(se == e and abs(t - st) < 1.4 for se, st in skip):
                continue
            out.append(K.opening(pl, e, t, w, h, z_sill, T, shape))
    return out


def dado(pl, edges=(0, 1), cuts=()):
    """Ochre dado band z 0.5-0.9 (under the 0.93 window-sill underside), 0.03 m proud, broken at every door/breach in `cuts`."""
    for e in edges:
        a, b, rr_, n, L = dz.edge(pl, e)
        gaps = []
        for f in cuts:
            if abs(f.n.dot(n)) > 0.9 and abs((f.o - a).dot(n)) < 0.2:
                t = (V((f.o.x, f.o.y, 0)) - a).dot(rr_)
                gaps.append((t - f.w / 2 - 0.12, t + f.w / 2 + 0.12))
        for s0, s1 in dz.segs_minus(L, [(0, 0.05)] + [(L - 0.05, L)] + gaps):
            if s1 - s0 < 0.15:
                continue
            bm = bmesh.new()
            m = a + rr_ * ((s0 + s1) / 2) + n * 0.03
            C.box_bm(bm, (m.x, m.y, 0.7), (max(0.02, abs(rr_.x) * (s1 - s0)), max(0.02, abs(rr_.y) * (s1 - s0)), 0.4))
            K.part(bm, 'limewash_worn', name='dado%d_%d' % (e, int(s0 * 10)), mat_tint=DADO, grime=0.6, bisect=False)['dz_noao'] = 1


def roof(pl, z, style='round', gaps=None, name='roof'):
    dz.roof_slab(pl, z, 0.25, 'screed_lime', oh=0.05, name=name, tint=(0.92, 0.88, 0.8))
    dz.parapet(pl, z, 0.8, 0.3, REND, gaps=gaps or {}, style=style, mat_tint=WASH, climb=False, name=name + '_parapet')
    dz.spouts(pl, z + 0.05, every=4.5, mid='palm_log', skip=(2,))
    dz.roof_patches(rect(pl[0][0] + 0.4, pl[0][1] + 0.4, pl[2][0] - 0.4, pl[2][1] - 0.4), z, n=2, seed=SEED)
    C.roof_meta(pl, z, walkable=True)


def qubba(x, y, s, z0, split=False):
    q = rect(x - s / 2, y - s / 2, x + s / 2, y + s / 2)
    qd = K.opening(q, 0, s / 2, 0.75, 1.6, z0, 0.3, 'arch', 'door')
    K.wall_ring(q, 1.8, 0.3, REND, [qd], z0=z0, name='qubba', mat_tint=WASH, footprint=False)
    dz.roof_slab(q, z0 + 1.9, 0.12, REND, oh=0.06, name='qubba_cap', tint=WASH)
    dz.dome(V((x, y, 0)), s / 2 - 0.1, z0 + 1.9, mid='plaster_white', drum_h=0.25, segs=18, rings=7, finial=not split, name='dome',
            tint=(1.0, 0.99, 0.96) if not split else (0.86, 0.84, 0.8))
    if split:
        dz.safe_bite(V((x - s * 0.3, y - s * 0.35, z0 + 2.6)), s * 0.42, seed=SEED + 4)
    K.door(qd, 'qubba', 'plank', SHUT, step=None, hinge='left', open_deg=25)


def pergola(x0, y0, x1, y1, z, h=2.2, name='pergola'):
    """Palm-log arbour under laid palm fronds (dz.frond_shade builds it on the ground: lift it onto the roof)."""
    n0 = len(C.A.parts)
    dz.frond_shade(x0, y0, x1, y1, h, name=name, seed=SEED)
    for o in C.A.parts[n0:]:
        o.location.z += z


# ---------------------------------------------------------------- body
door = K.opening(poly, DOOR[0], DOOR[1], 1.6 if KIND in ('hq', 'b') else 1.2, 2.4, 0.0, T, 'arch' if KIND != 'a' else 'rect', 'door')
skip = [DOOR]
wins = win_frames(poly, 1.0, skip, h=1.25 if H1 > 3.5 else 1.1, shape='arch' if KIND != 'a' else 'rect')
breach = []
if DEST:
    e1 = 1 if KIND == 'hq' else 0
    breach = [dz.RagFrame(K.opening(poly, e1, (HD if e1 == 1 else HW) + 1.2, 2.6, 2.6, 0.0, T, 'rect', 'breach'), seed=SEED),
              dz.RagFrame(K.opening(poly, 3 if KIND == 'b' else 0, 1.6, 1.8, 2.2, 0.3, T, 'rect', 'breach'), seed=SEED + 1)]
    wins = [w for k, w in enumerate(wins) if k % 3 != 1]
K.wall_ring(poly, H1, T, REND, [door] + wins + breach, plinth=('fieldstone', 0.45, 0.04), name='walls', mat_tint=WASH)
dado(poly, (0, 1, 3) if KIND == 'b' else (0, 1), cuts=[door] + breach)
for k, f in enumerate(wins):
    K.window(f, 'casement', (1, 2), frame=(0.84, 0.8, 0.72), sill='ashlar_limestone', shutters=None if DEST else ['open', 'ajar', 'closed'][(k + SEED) % 3],
             shutter_color=SHUT, bars=f.n.y > 0.5 or KIND == 'b', curtain=0.2, streak=True, name='w%d' % k)
K.door(door, 'main', 'double' if KIND in ('hq', 'b') else 'plank', SHUT if not DEST else (0.2, 0.2, 0.18), step='ashlar', hinge='left',
       node='door_main', open_deg=0 if not DEST else 80)
ZT = H1 + 0.25
top_poly, top_z = poly, ZT
if UPPER is None:
    if not DEST:
        roof(poly, ZT, PSTYLE if PSTYLE != 'stepped' else 'merlon')
    else:
        dz.roof_slab(rect(-HW, 1.0, HW, HD), ZT, 0.25, 'screed_lime', oh=0.05, name='roof_n', tint=(0.86, 0.82, 0.74))
        dz.parapet(rect(-HW, 1.0, HW, HD), ZT, 0.8, 0.3, REND, gaps={0: [(0, 2 * HW)]}, style='merlon', mat_tint=(0.88, 0.85, 0.8), climb=False, name='par_n')
else:
    y0, y1 = (-HD, HD) if UPPER == 'full' else UPPER
    up = rect(-HW, y0, HW, y1)
    H2 = 2.9 if UPPER == 'full' else 3.1
    if not DEST:
        if UPPER != 'full':      # the S terrace in front of the upper block
            roof(rect(-HW, -HD, HW, y0), ZT, 'round', gaps={1: [(1.9, 3.3)], 2: [(0, 2 * HW)]}, name='terrace')
            pergola(-HW + 0.8, -HD + 0.8, HW - 2.0, y0 - 0.3, ZT, h=2.1)
        else:
            dz.roof_slab(poly, ZT, 0.25, 'screed_lime', oh=0.05, name='floor2', tint=(0.92, 0.88, 0.8))
        uwins = win_frames(up, ZT + 0.9, [], h=1.15, shape='arch', every=2.6, edges=(0, 1, 2, 3) if UPPER == 'full' else (0, 1, 3))
        K.wall_ring(up, H2, T, REND, uwins, z0=ZT, name='walls2', mat_tint=WASH, footprint=False)
        for k, f in enumerate(uwins):
            K.window(f, 'casement', (1, 2), frame=(0.84, 0.8, 0.72), sill='ashlar_limestone', shutters=['ajar', 'open', 'closed'][(k + SEED) % 3],
                     shutter_color=SHUT, curtain=0.2, streak=True, name='u%d' % k)
        top_poly, top_z = up, ZT + H2 + 0.25
        roof(up, top_z, 'round', name='roof2')
        # cornice band between the storeys
        bm = bmesh.new()
        C.prism_bm(bm, rect(-HW - 0.08, -HD - 0.08 if UPPER == 'full' else y0 - 0.08, HW + 0.08, HD + 0.08), ZT - 0.05, ZT + 0.12)
        K.part(bm, 'limewash_worn', name='band', mat_tint=DADO, grime=0.5, bisect=False)
    else:
        dz.roof_slab(rect(-HW, -HD, -0.6, y0), ZT, 0.25, 'screed_lime', oh=0.05, name='terrace_w', tint=(0.86, 0.82, 0.74))
        dz.parapet(rect(-HW, y0, HW, y1), ZT, 1.6, T, REND, gaps={0: [(3.0, 6.4)]}, style='plain', mat_tint=(0.88, 0.85, 0.8), climb=False, name='walls2_stub')
        top_poly, top_z = rect(-HW, y0, HW, y1), ZT + 1.6

# ---- the dome kiosk, stair, roof furniture
DX, DY, DS = DOME
qubba(DX, DY, DS, top_z, split=DEST)
if KIND == 'hq':
    if not DEST:
        dz.stair_flight((HW + 0.65, 3.1, 0), (0, -1, 0), 1.1, ZT, 14, mid='limewash_worn', tint=WASH, cheek=1, rail_h=0.8, niche=True, name='stair', seed=SEED)
    else:
        dz.stair_flight((HW + 0.65, 3.1, 0), (0, -1, 0), 1.1, ZT * 0.5, 7, mid='limewash_worn', tint=(0.86, 0.83, 0.78), cheek=1, rail_h=0.6, niche=False, name='stair', seed=SEED)
    whip(-HW + 0.35, (UPPER[1] if not DEST else 3.6) - 0.35, top_z + (0.8 if not DEST else 0), 5.0, name='whip')
if KIND == 'a' and not DEST:       # water tank on a stand, jerrycans
    bm = bmesh.new()
    for (x, y) in ((-3.9, -4.6), (-2.7, -4.6), (-3.9, -3.4), (-2.7, -3.4)):
        C.box_bm(bm, (x, y, top_z + 0.5), (0.12, 0.12, 1.0))
    C.box_bm(bm, (-3.3, -4.0, top_z + 1.02), (1.5, 1.5, 0.08))
    K.part(bm, 'timber_beam', name='tank_stand', mat_tint=(0.7, 0.6, 0.48), grime=0.7, bisect=False)
    bm = bmesh.new()
    C.cyl_bm(bm, V((-3.3, -4.0, top_z + 1.06)), V((-3.3, -4.0, top_z + 2.1)), 0.65, 14)
    K.part(bm, 'paint_metal', name='tank', mat_tint=(0.8, 0.72, 0.55), grime=0.9, bisect=False, smooth=True)
    jerrycans((2.6, -5.2, top_z), n=4, rot=0.0)
if KIND == 'e' and not DEST:
    pergola(-HW + 0.7, -HD + 0.7, -0.4, 0.6, ZT, h=2.0)
    drums([(3.6, -2.6, ZT)], tint=(0.36, 0.38, 0.32), name='roof_drum')
if KIND == 'b' and not DEST:       # sandbag MG post on the SE roof corner, ammo boxes, aerial
    for (p0, p1) in (((HW - 2.6, -HD + 0.6), (HW - 0.5, -HD + 0.6)), ((HW - 0.6, -HD + 0.7), (HW - 0.6, -HD + 2.6))):
        dz.sandbags(p0, p1, rows=4, name='mg_bags%d' % int(p0[0] * 10), thick=2, footprint=False)
        C.A.parts[-1].location.z += ZT
    whip(-HW + 0.35, HD - 0.35, ZT + 0.8, 4.5, name='whip')
# ---- weathering: flaking render showing the stone, damp foot, sand drifts
for k in range(5):
    e = [0, 1, 0, 3, 1][k]
    a, b, rr_, n, L = dz.edge(poly, e)
    p = a + rr_ * r.uniform(0.7, L - 0.7)
    dz.spall2(V((p.x, p.y, r.uniform(0.6, H1 - 0.6))) + n * 0.005, n, r.uniform(0.45, 1.0), r.uniform(0.3, 0.7), mid='fieldstone', skin=REND,
              skin_tint=WASH, seed=SEED + k, name='spall%d' % k)
for e in range(4):
    a, b, rr_, n, L = dz.edge(poly, e)
    K.decal('damp_base', tuple((a + b) / 2 + n * 0.008 + V((0, 0, 0.4))), tuple(n), L * 0.95, 0.7, alpha=0.4)
sand_feet(poly, h=0.25, w=0.7, seed=SEED)
if DEST:
    K.rubble((HW * 0.4, -HD - 1.0, 0), radius=1.8, height=0.7, mids=('fieldstone', 'limewash_worn'), n=34, beams=3, tiles=None, seed=SEED, name='rubble_s')
    K.rubble((-0.5, 0.5, 0), radius=2.4, height=1.1, mids=('fieldstone', 'limewash_worn'), n=40, beams=4, tiles=None, seed=SEED + 1, name='rubble_in')
    K.scorch_openings(0.9, 0.6)
    C.A.meta['notes'].append('destroyed: roof caved in, two breaches, dome split, rubble LOW; soot only round the openings')
K.footprint(poly, 'HIGH', 'building')
dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=40)
