"""bulldozer_rusty (maas_mil.py variant d): a 1930s crawler tractor with a cable-lift angledozer, abandoned in a field
since 1940. Blender axes: +X = blade end, +Y = left, Z up; 4.5 x 2.6 m footprint.
 - running gear: a real track belt per side (convex hull round sprocket, idler, track and carrier rollers, resampled
   at the shoe pitch): 40+ shoes, each with its grouser bar and its pair of chain-link rails; toothed sprocket on its
   final-drive housing, spoked idler on a recoil-spring housing, 5 flanged track rollers, a carrier roller, track
   frames with roller guards, the transverse leaf equaliser spring under the radiator
 - body: rounded engine hood, cast radiator shell with a barred grille and filler cap, right engine side panel with
   pressed louvres (the left one lies in the grass: the engine block, head and manifold show), fuel tank and seat,
   floor plate, steering-clutch levers and pedals, gauges, riveted fenders with a toolbox, exhaust with a rain flap,
   air pre-cleaner, rear cable control unit with its drum, drawbar
 - dozer: curved mouldboard with back ribs, top rail, bolted cutting edge and end bits, push beams and braces,
   front A-frame tower with sheave block, the lift cable over the top
 - finish: paint_rust_ochre (faded yellow enamel worn to primer and rust) on the sheet metal, rust_heavy on tracks,
   cutting edge and running gear, rust streak / dirt decals, weeds through the tracks"""
import math
import bmesh

TH, TW, PITCH = 0.035, 0.46, 0.17          # shoe plate thickness, shoe width, pitch
GY = 0.82                                    # track centre |y|
SPR = (-1.45, 0.47, 0.40)                    # sprocket x, z, pitch radius
IDL = (1.0, 0.42, 0.36)                      # idler
ROLL_X, ROLL_R = (-1.02, -0.6, -0.18, 0.24, 0.64), 0.13
CARR = (-0.2, 0.765, 0.09)                   # carrier roller


def _hull(pts):
    pts = sorted(set(pts))
    cr = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]                 # CCW in (x, z)


def belt_path():
    """Shoe centres + unit tangents + outward normals round the belt (x, z), evenly at ~PITCH."""
    circ = [(SPR[0], SPR[1], SPR[2]), (IDL[0], IDL[1], IDL[2]), (CARR[0], CARR[1], CARR[2])]
    circ += [(x, TH + ROLL_R, ROLL_R) for x in ROLL_X]
    pts = []
    for cx, cz, rr in circ:
        R = rr + TH / 2
        for k in range(72):
            t = 2 * math.pi * k / 72
            pts.append((round(cx + R * math.cos(t), 5), round(cz + R * math.sin(t), 5)))
    h = _hull(pts)
    seg = [(h[i], h[(i + 1) % len(h)]) for i in range(len(h))]
    L = [math.dist(a, b) for a, b in seg]
    tot = sum(L)
    n = int(round(tot / PITCH))
    step = tot / n
    out, i, acc = [], 0, 0.0
    for k in range(n):
        s = k * step
        while acc + L[i] < s:
            acc += L[i]
            i += 1
        (ax, az), (bx, bz) = seg[i]
        f = (s - acc) / L[i]
        tx, tz = (bx - ax) / L[i], (bz - az) / L[i]
        out.append(((ax + f * (bx - ax), az + f * (bz - az)), (tx, tz), (tz, -tx)))   # CCW: outward = (tz, -tx)
    return out, step


def build(K, C, V, r, foliage):
    YA = V((0, 1, 0))
    path, step = belt_path()
    # ---------------------------------------------------------------- track belts
    bm, bl = bmesh.new(), bmesh.new()
    for s in (-1, 1):
        y = s * GY
        for (px, pz), (tx, tz), (nx, nz) in path:
            c, t, nn = V((px, y, pz)), V((tx, 0, tz)), V((nx, 0, nz))
            K.beam_bm(bm, c - t * (step * 0.46), c + t * (step * 0.46), TH, TW, up=YA)          # shoe plate
            g = c + nn * (TH / 2 + 0.024) + t * (step * 0.22)
            K.beam_bm(bm, g - t * 0.018, g + t * 0.018, 0.048, TW, up=YA)                       # grouser
            for q in (-1, 1):                                                                    # chain-link rails
                lc = c - nn * (TH / 2 + 0.035) + V((0, q * 0.11, 0))
                K.beam_bm(bl, lc - t * (step * 0.5), lc + t * (step * 0.5), 0.07, 0.065, up=YA)
    K.part(bm, 'rust_heavy', name='tracks', mat_tint=(0.62, 0.56, 0.52), grime=0.9, bisect=False)
    K.part(bl, 'rust_heavy', name='track_links', mat_tint=(0.45, 0.42, 0.4), grime=0.9, bisect=False, lod='drop')
    # ---------------------------------------------------------------- sprockets, idlers, rollers
    bm = bmesh.new()
    for s in (-1, 1):
        y0, y1 = s * (GY - TW / 2 + 0.06), s * (GY + TW / 2 - 0.06)
        x, z, R = SPR
        for yy in (s * (GY - 0.12), s * (GY + 0.12)):                       # two toothed rings
            K.cyl_bm(bm, (x, yy - 0.025, z), (x, yy + 0.025, z), R - 0.05, 16)
            for k in range(13):
                a = 2 * math.pi * k / 13 + 0.1
                d = V((math.cos(a), 0, math.sin(a)))
                p = V((x, yy, z)) + d * (R - 0.02)
                K.beam_bm(bm, p - d * 0.05, p + d * 0.05, 0.07, 0.05, up=YA)
        K.cyl_bm(bm, (x, s * (GY - 0.15), z), (x, s * (GY + 0.2), z), 0.12, 10)                 # hub + cap
        K.cyl_bm(bm, (x, s * (GY + 0.2), z), (x, s * (GY + 0.24), z), 0.08, 8)
        x, z, R = IDL                                                       # spoked idler: rim, flange, hub, 6 spokes
        K.cyl_bm(bm, (x, y0, z), (x, y1, z), R - 0.02, 18, caps=False)
        K.cyl_bm(bm, (x, s * (GY - 0.03), z), (x, s * (GY + 0.03), z), R + 0.035, 18)
        K.cyl_bm(bm, (x, s * (GY - 0.1), z), (x, s * (GY + 0.17), z), 0.1, 10)
        for k in range(6):
            a = 2 * math.pi * k / 6
            d = V((math.cos(a), 0, math.sin(a)))
            K.beam_bm(bm, V((x, s * GY, z)) + d * 0.09, V((x, s * GY, z)) + d * (R - 0.05), 0.07, 0.16, up=YA)
        for x in ROLL_X:                                                    # flanged track rollers
            z = TH + ROLL_R
            K.cyl_bm(bm, (x, y0, z), (x, y1, z), ROLL_R - 0.015, 12)
            for yy in (s * (GY - 0.13), s * (GY + 0.13)):
                K.cyl_bm(bm, (x, yy - 0.02, z), (x, yy + 0.02, z), ROLL_R + 0.02, 12)
        x, z, R = CARR
        K.cyl_bm(bm, (x, y0, z), (x, y1, z), R, 10)
        K.cyl_bm(bm, (x, s * (GY - 0.25), z), (x, s * (GY - 0.02), z), 0.035, 6)                # carrier stub axle
    K.part(bm, 'rust_heavy', name='wheels', mat_tint=(0.7, 0.64, 0.6), grime=1.0, bisect=False)
    return path


PAINT = 'paint_rust_ochre'


def louvre_panel(K, bm, bd, x0, x1, z0, z1, y, s, cols=4, rows=3):
    """Engine side panel at y (outward sign s) with pressed louvres: raised hoods (bm) over dark slots (bd)."""
    K.box_bm(bm, ((x0 + x1) / 2, y, (z0 + z1) / 2), (x1 - x0, 0.02, z1 - z0))
    for i in range(cols):
        for j in range(rows):
            cx = x0 + (i + 0.5) * (x1 - x0) / cols
            cz = z0 + (j + 0.6) * (z1 - z0) / (rows + 0.3)
            K.box_bm(bm, (cx, y + s * 0.022, cz + 0.012), (0.2, 0.026, 0.022), taper=(1.0, 0.4))
            K.box_bm(bd, (cx, y + s * 0.012, cz - 0.008), (0.19, 0.008, 0.02))


def rivet_row(K, bm, p0, p1, n, out_axis, r=0.014):
    """n rivet heads evenly from p0 to p1, flattened along out_axis (0 x, 1 y, 2 z)."""
    for k in range(n):
        f = (k + 0.5) / n
        sz = [r * 2] * 3
        sz[out_axis] = r
        K.box_bm(bm, tuple(p0[i] + (p1[i] - p0[i]) * f for i in range(3)), tuple(sz))


def build_body(K, C, V, r):
    YA = V((0, 1, 0))
    # ---------------------------------------------------------------- track frames, guards, equaliser, final drives
    bm = bmesh.new()
    for s in (-1, 1):
        y = s * GY
        K.box_bm(bm, (-0.2, y, 0.42), (2.15, 0.3, 0.2))                                   # track frame box
        K.box_bm(bm, (-0.2, y, 0.3), (2.0, 0.34, 0.03))                                   # roller guard top flange
        for q in (-1, 1):                                                                 # roller guard side plates
            K.box_bm(bm, (-0.2, y + q * 0.165, 0.26), (1.95, 0.015, 0.12))
        K.cyl_bm(bm, (0.55, y, 0.47), (0.95, y, 0.43), 0.075, 8)                          # recoil spring housing
        K.cyl_bm(bm, (SPR[0], s * 0.55, SPR[1]), (SPR[0], s * (GY - 0.16), SPR[1]), 0.21, 12)   # final drive housing
        K.beam_bm(bm, (-0.35, s * (GY - 0.15), 0.42), (-0.35, s * 0.42, 0.6), 0.12, 0.1)        # diagonal brace
    K.box_bm(bm, (0.98, 0, 0.56), (0.12, 2.0, 0.05))                                      # leaf equaliser spring
    K.box_bm(bm, (0.98, 0, 0.6), (0.11, 1.7, 0.04))
    K.box_bm(bm, (0.98, 0, 0.635), (0.1, 1.3, 0.035))
    K.box_bm(bm, (-1.15, 0, 0.72), (0.8, 1.15, 0.55))                                     # transmission / final-drive case
    K.box_bm(bm, (0.25, 0, 0.68), (1.5, 0.6, 0.18))                                       # engine sump / main frame
    K.box_bm(bm, (1.22, 0, 0.48), (0.24, 0.5, 0.2))                                       # crankcase guard / pull hook
    K.part(bm, PAINT, name='frames', mat_tint=(0.78, 0.76, 0.74), grime=1.0)
    # ---------------------------------------------------------------- hood, radiator shell, side panel, platform, fenders
    bm, bd = bmesh.new(), bmesh.new()
    prof = []                                                                             # hood section (y, z): flat sides, rounded top
    for k in range(9):
        a = math.pi * k / 8
        prof.append((0.43 * math.cos(a) * 0.98, 1.42 + 0.14 * math.sin(a)))
    prof += [(-0.43, 1.38), (0.43, 1.38)]
    rings = [[V((x, py, pz)) for (py, pz) in prof] for x in (-0.52, 0.98)]
    K.loft_bm(bm, rings)
    louvre_panel(K, bm, bd, -0.42, 0.9, 0.9, 1.37, 0.43, 1)                             # right side panel (+Y)
    K.box_bm(bm, (1.09, 0, 1.08), (0.2, 1.0, 1.1))                                        # radiator shell
    K.box_bm(bm, (1.09, 0, 1.66), (0.22, 0.6, 0.06))                                      # top tank band
    K.cyl_bm(bm, (1.05, 0, 1.69), (1.05, 0, 1.79), 0.055, 10)                             # filler neck + cap
    K.cyl_bm(bm, (1.05, 0, 1.79), (1.05, 0, 1.82), 0.08, 10)
    K.box_bm(bm, (-0.82, 0, 0.99), (0.6, 1.16, 0.035))                                    # floor plate
    for s in (-1, 1):                                                                     # fenders: deck + outer lip + rear roll
        K.box_bm(bm, (-1.05, s * 0.86, 1.02), (1.3, 0.52, 0.03))
        K.box_bm(bm, (-1.05, s * 1.11, 0.96), (1.3, 0.025, 0.12))
        K.beam_bm(bm, (-1.7, s * 0.86, 1.02), (-1.86, s * 0.86, 0.86), 0.03, 0.52)
    K.box_bm(bm, (-1.41, 0, 1.29), (0.38, 1.38, 0.5), taper=(0.92, 0.97))                 # fuel tank
    K.cyl_bm(bm, (-1.33, 0.45, 1.54), (-1.33, 0.45, 1.6), 0.05, 8)                        # tank filler
    K.box_bm(bm, (-0.65, 0, 1.2), (0.1, 0.8, 0.38))                                       # dash panel at the hood's rear
    K.box_bm(bm, (-1.0, 0.92, 1.12), (0.55, 0.26, 0.2))                                   # toolbox on the left fender
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, PAINT, name='body', grime=0.9)
    K.box_bm(bd, (1.2, 0, 1.03), (0.02, 0.84, 0.92))                                      # radiator core behind the bars
    for g in (-0.5, -0.22):                                                               # gauges
        K.cyl_bm(bd, (-0.705, g * 0.5, 1.3), (-0.71, g * 0.5, 1.3), 0.045, 10)
    K.part(bd, 'interior_dark', name='slots', mat_tint=(0.5, 0.45, 0.4), lod='drop')
    return YA


def build_works(K, C, V, r):
    YA = V((0, 1, 0))
    # ---------------------------------------------------------------- the engine where the left side panel is gone
    bm = bmesh.new()
    K.box_bm(bm, (0.2, -0.16, 1.0), (1.15, 0.46, 0.5))                                    # crankcase + block
    K.box_bm(bm, (0.2, -0.17, 1.3), (1.08, 0.4, 0.12))                                    # cylinder head
    for k in range(4):                                                                    # head studs / plug bosses
        K.cyl_bm(bm, (-0.2 + k * 0.27, -0.3, 1.36), (-0.2 + k * 0.27, -0.3, 1.4), 0.03, 6)
    K.cyl_bm(bm, (-0.35, -0.4, 1.12), (0.78, -0.4, 1.12), 0.05, 8)                         # exhaust manifold
    for k in range(4):
        K.cyl_bm(bm, (-0.2 + k * 0.27, -0.38, 1.12), (-0.2 + k * 0.27, -0.3, 1.2), 0.035, 6)
    K.cyl_bm(bm, (0.6, -0.35, 0.92), (0.6, -0.43, 0.92), 0.09, 10)                        # magneto / starter drum
    K.cyl_bm(bm, (0.93, -0.12, 1.12), (0.98, -0.12, 1.12), 0.16, 12)                      # fan pulley
    K.part(bm, 'rust_heavy', name='engine', mat_tint=(0.58, 0.52, 0.5), grime=1.0)
    # ---------------------------------------------------------------- controls, seat, stacks, grille bars, rivets
    bm = bmesh.new()
    for q in (-1, 1):
        K.cyl_bm(bm, (-0.72, q * 0.16, 1.0), (-0.86, q * 0.18, 1.62), 0.02, 6)             # steering-clutch levers
        K.cyl_bm(bm, (-0.86, q * 0.18, 1.62), (-0.9, q * 0.18, 1.64), 0.035, 6)
        K.beam_bm(bm, (-0.6, q * 0.34, 1.0), (-0.68, q * 0.34, 1.16), 0.03, 0.09, up=YA)   # brake pedals
    K.cyl_bm(bm, (-0.75, 0.0, 1.0), (-0.92, 0.06, 1.42), 0.016, 6)                         # gear lever
    K.part(bm, 'cast_iron', name='levers', mat_tint=(0.9, 0.7, 0.55), grime=0.8)
    bm = bmesh.new()
    K.cyl_bm(bm, (0.55, -0.15, 1.55), (0.55, -0.15, 2.22), 0.065, 10)                      # exhaust stack
    K.cyl_bm(bm, (0.55, -0.15, 2.22), (0.6, -0.15, 2.24), 0.072, 10, r1=0.05)              # bell mouth
    K.beam_bm(bm, (0.55, -0.15, 2.255), (0.68, -0.15, 2.32), 0.012, 0.15, up=YA)           # rusted-open rain flap
    K.cyl_bm(bm, (0.82, 0.2, 1.55), (0.82, 0.2, 1.88), 0.06, 10)                           # air pre-cleaner
    K.cyl_bm(bm, (0.82, 0.2, 1.88), (0.82, 0.2, 2.0), 0.11, 12)
    K.cyl_bm(bm, (0.82, 0.2, 2.0), (0.82, 0.2, 2.03), 0.12, 12, r1=0.04)
    K.part(bm, 'rust_heavy', name='stacks', mat_tint=(0.5, 0.44, 0.42), grime=0.8)
    bm = bmesh.new()
    for k in range(11):                                                                   # radiator grille bars
        y = -0.42 + k * 0.084
        K.box_bm(bm, (1.205, y, 1.03), (0.025, 0.022, 0.92))
    K.box_bm(bm, (1.205, 0, 1.52), (0.03, 0.9, 0.05))
    rivet_row(K, bm, (1.2, -0.48, 0.58), (1.2, -0.48, 1.58), 9, 0)                         # radiator shell rivets
    rivet_row(K, bm, (1.2, 0.48, 0.58), (1.2, 0.48, 1.58), 9, 0)
    for s in (-1, 1):
        rivet_row(K, bm, (-1.68, s * 1.1, 1.04), (-0.42, s * 1.1, 1.04), 10, 2)            # fender edge rivets
        rivet_row(K, bm, (-0.15, s * GY + s * 0.17, 0.44), (0.75, s * GY + s * 0.17, 0.44), 6, 1)
    rivet_row(K, bm, (-0.48, 0.445, 1.36), (0.88, 0.445, 1.36), 10, 1)                     # side panel edge
    K.part(bm, 'cast_iron', name='fittings', mat_tint=(0.85, 0.62, 0.48), grime=0.8, lod='drop')
    bm = bmesh.new()                                                                      # seat cushion + backrest (split)
    K.box_bm(bm, (-1.0, 0, 1.3), (0.36, 0.62, 0.1), taper=(0.95, 0.95))
    K.box_bm(bm, (-1.0, 0, 1.12), (0.3, 0.5, 0.24))
    K.box_bm(bm, (-1.2, 0, 1.6), (0.07, 0.6, 0.3), taper=(0.9, 0.9))
    K.part(bm, 'hessian', name='seat', mat_tint=(0.42, 0.34, 0.26), grime=1.0)
    # ---------------------------------------------------------------- rear cable control unit + drawbar
    bm = bmesh.new()
    K.box_bm(bm, (-1.84, 0, 1.05), (0.34, 0.74, 0.5))                                      # PCU case
    for q in (-1, 1):
        K.box_bm(bm, (-1.84, q * 0.39, 1.1), (0.3, 0.04, 0.56))
    K.cyl_bm(bm, (-1.84, -0.3, 1.43), (-1.84, 0.3, 1.43), 0.12, 12)                        # cable drum
    K.cyl_bm(bm, (-1.84, -0.04, 1.62), (-1.84, 0.04, 1.62), 0.11, 12)                      # rear sheave
    K.beam_bm(bm, (-1.84, -0.3, 1.3), (-1.84, -0.06, 1.62), 0.05, 0.05)
    K.beam_bm(bm, (-1.84, 0.3, 1.3), (-1.84, 0.06, 1.62), 0.05, 0.05)
    K.box_bm(bm, (-1.95, 0, 0.55), (0.55, 0.24, 0.07))                                     # drawbar + clevis
    K.cyl_bm(bm, (-2.15, 0, 0.5), (-2.15, 0, 0.62), 0.03, 6)
    K.part(bm, PAINT, name='winch', mat_tint=(0.86, 0.82, 0.8), grime=1.0)


def build_blade(K, C, V, r, foliage):
    YA = V((0, 1, 0))
    BX, HW = 1.86, 1.25                                       # mouldboard base x, half width
    prof = [(0.0, 0.0), (0.1, 0.2), (0.15, 0.42), (0.14, 0.64), (0.07, 0.84), (-0.03, 0.97)]   # (dx, z) curl
    # ---------------------------------------------------------------- mouldboard: curved face plate with thickness
    bm = bmesh.new()
    T = 0.05
    ys = [-HW + k * (2 * HW / 6) for k in range(7)]
    front = [[V((BX + dx, y, z - 0.04)) for (dx, z) in prof] for y in ys]
    back = [[V((BX + dx - T, y, z - 0.04)) for (dx, z) in prof] for y in ys]
    vf = [[bm.verts.new(p) for p in row] for row in front]
    vb = [[bm.verts.new(p) for p in row] for row in back]
    for i in range(len(ys) - 1):
        for k in range(len(prof) - 1):
            bm.faces.new((vf[i][k], vf[i + 1][k], vf[i + 1][k + 1], vf[i][k + 1]))
            bm.faces.new((vb[i][k], vb[i][k + 1], vb[i + 1][k + 1], vb[i + 1][k]))
    for i in range(len(ys) - 1):                                                          # bottom + top edges
        for k in (0, len(prof) - 1):
            bm.faces.new((vf[i][k], vb[i][k], vb[i + 1][k], vf[i + 1][k]))
    for i in (0, len(ys) - 1):                                                            # side edges
        for k in range(len(prof) - 1):
            bm.faces.new((vf[i][k], vf[i][k + 1], vb[i][k + 1], vb[i][k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'rust_heavy', name='mouldboard', mat_tint=(0.78, 0.72, 0.68), grime=1.0, bisect=False)
    # ---------------------------------------------------------------- back ribs, top rail, end bits, push beams, braces
    bm = bmesh.new()
    for y in (-1.1, -0.55, 0.0, 0.55, 1.1):
        pts = [V((BX + dx - T - 0.05, y, z - 0.04)) for (dx, z) in prof]
        for a, b in zip(pts[:-1], pts[1:]):
            K.beam_bm(bm, a, b, 0.1, 0.035, up=YA)
    K.beam_bm(bm, (BX - 0.1, -HW, 0.92), (BX - 0.1, HW, 0.92), 0.09, 0.09)                # top rail (box section)
    for s in (-1, 1):
        y = s * (GY + 0.33)
        K.beam_bm(bm, (-0.25, y, 0.42), (BX - 0.08, y, 0.36), 0.14, 0.18, up=V((0, 0, 1)))  # push beam
        K.cyl_bm(bm, (-0.25, s * (GY + 0.22), 0.42), (-0.25, s * (GY + 0.42), 0.42), 0.1, 10)   # trunnion ball
        K.beam_bm(bm, (0.9, y, 0.42), (BX - 0.1, s * 0.75, 0.82), 0.07, 0.07)              # diagonal brace
        K.beam_bm(bm, (BX - 0.1, s * (HW - 0.05), 0.0), (BX + 0.02, s * (HW - 0.05), 0.95), 0.04, 0.3, up=YA)  # end bit
        K.beam_bm(bm, (1.45, s * 0.95, 0.4), (1.58, 0, 2.08), 0.07, 0.07)                  # A-frame tower legs
    K.part(bm, PAINT, name='dozer_frame', mat_tint=(0.84, 0.8, 0.78), grime=1.0)
    bm = bmesh.new()                                                                      # bolted cutting edge + sheaves
    K.beam_bm(bm, (BX + 0.005, -HW, 0.0), (BX + 0.005, HW, 0.0), 0.035, 0.16, up=V((0, 0, 1)), roll=0.0)
    rivet_row(K, bm, (BX + 0.05, -HW + 0.1, 0.1), (BX + 0.05, HW - 0.1, 0.1), 12, 0, r=0.018)
    K.cyl_bm(bm, (1.58, -0.05, 2.06), (1.58, 0.05, 2.06), 0.12, 12)                       # tower sheave block
    K.cyl_bm(bm, (BX - 0.14, -0.04, 1.0), (BX - 0.14, 0.04, 1.0), 0.09, 10)                # blade sheave
    K.part(bm, 'rust_heavy', name='edge', grime=0.8)
    bm = bmesh.new()                                                                      # lift cable, 2 falls + over the top
    for a, b in (((-1.84, 0, 1.73), (1.5, 0, 2.18)), ((1.6, 0.03, 1.95), (BX - 0.12, 0.03, 1.08)),
                 ((1.56, -0.03, 1.95), (BX - 0.16, -0.03, 1.07))):
        K.cyl_bm(bm, a, b, 0.012, 4)
    K.part(bm, 'cast_iron', name='cable', mat_tint=(0.55, 0.42, 0.36), lod='drop')
    # ---------------------------------------------------------------- the left engine side panel, propped against the track
    from mathutils import Matrix
    pb, bd = bmesh.new(), bmesh.new()
    louvre_panel(K, pb, bd, -0.66, 0.66, 0.0, 0.47, 0.0, -1)
    for b_ in (pb, bd):
        bmesh.ops.rotate(b_, verts=b_.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-40), 3, 'X'))
        bmesh.ops.rotate(b_, verts=b_.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(4), 3, 'Z'))
        bmesh.ops.translate(b_, verts=b_.verts, vec=(0.1, -1.27, 0.012))
    K.part(pb, PAINT, name='fallen_panel', grime=1.0, bisect=False)
    K.part(bd, 'interior_dark', name='fallen_slots', mat_tint=(0.5, 0.45, 0.4), lod='drop')
    # ---------------------------------------------------------------- weathering decals
    for k in range(3):
        K.decal('streak_rust', (r.uniform(-0.3, 0.8), 0.452, 1.15), (0, 1, 0), 0.25, 0.5, alpha=0.65)
    K.decal('streak_rust', (1.22, r.uniform(-0.3, 0.3), 1.1), (1, 0, 0), 0.4, 0.7, alpha=0.55)
    K.decal('dirt_splash', (BX + 0.12, 0.4, 0.2), (1, 0, 0.3), 1.2, 0.4, alpha=0.7)
    K.decal('dirt_splash', (BX + 0.12, -0.6, 0.2), (1, 0, 0.3), 1.0, 0.35, alpha=0.7)
    K.decal('stain_rust_blotch', (-1.41, 0.7, 1.3), (0, 1, 0), 0.4, 0.3, alpha=0.6)
    K.decal('moss_patch', (-1.0, 0.86, 1.04), (0, 0, 1), 0.5, 0.35, alpha=0.6)
    foliage([(-1.95, -0.95, 0, 0.5), (-1.7, 1.0, 0, 0.5), (0.2, 1.02, 0, 0.45), (1.3, -1.0, 0, 0.5),
             (-0.6, -1.05, 0, 0.45), (0.9, 1.02, 0, 0.4), (-0.3, 0.05, 0, 0.55), (1.55, 0.6, 0, 0.45)],
            cell=(1, 2), name='weeds', tint=(0.7, 0.75, 0.5))
    K.footprint_rect(0, 0, 4.5, 2.6, 0, 'HIGH', 'vehicle')
    K.anchor('roof_ridge', (0, 0, 2.2))
