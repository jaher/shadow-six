# townhouse_fr.py variant 'turret' (exec'd in its namespace): round corner turret, r 2.2, slate bell dome + lantern
CX, CY, RT = 0.0, 1.1, 2.2                          # centre 1.1 m N of the structure centre = on the flat part's S face
ZE = 12.2
SEG = 28


def circ(r, n=SEG, a0=0.0):
    return [(CX + r * math.cos(a0 + 2 * math.pi * k / n), CY + r * math.sin(a0 + 2 * math.pi * k / n)) for k in range(n)]


def ring_z(r, z):
    return [V((x, y, z)) for (x, y) in circ(r)]


def tframe(ang, w, h, sill, kind='window', shape='segment'):
    a = math.radians(ang)
    n = V((math.cos(a), math.sin(a), 0))
    rr = V((-n.y, n.x, 0))
    o = V((CX, CY, 0)) + n * (RT + 0.02) + V((0, 0, sill))
    return K.Frame(o, n, rr, w, h, 0.5, shape, kind)


frames = [tframe(-90, 1.6, 3.3, 0.35, 'window', 'rect'), tframe(-30, 1.1, 2.4, 0.9)]
for ang in (-150, -90, -30):
    frames += [tframe(ang, 1.0, 2.3, Z1 + 0.35), tframe(ang, 0.95, 2.0, Z2 + 0.7)]
bm = bmesh.new()
K.ring_bm(bm, circ(RT), circ(RT - 0.42), 0.0, ZE)
bm = K.boolean_cut(bm, frames)
K.part(bm, STONE, name='turret_wall', mat_tint=CREAM)
bm = bmesh.new()                                     # plinth, floor bands, cornice rings
for (z, h, pj) in ((0.0, 0.4, 0.05), (Z1 - 0.3, 0.3, 0.1), (Z2 - 0.1, 0.24, 0.07), (ZE - 0.5, 0.14, 0.08), (ZE - 0.36, 0.14, 0.16), (ZE - 0.22, 0.22, 0.28)):
    C.loft_bm(bm, [ring_z(RT + pj, z), ring_z(RT + pj, z + h)], close_start=True, close_end=True)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, TRIM, name='turret_bands', mat_tint=CREAM)
for k, f in enumerate(frames):
    if f.o.z < 1.0:
        K.window(f, 'fixed', (3, 3), frame=(0.30, 0.12, 0.10), recess=0.2, sill=TRIM, lintel=None, curtain=0.0, name='tg%d' % k)
    else:
        K.window(f, 'casement', (2, 3), frame='white', recess=0.16, sill=TRIM, surround=TRIM, curtain=0.6, name='tw%d' % k)
        if f.o.z > Z2 and abs(math.degrees(math.atan2(f.n.y, f.n.x)) + 90) < 5:
            K.railing(f.p(-0.6, 0.02, 0.24), f.p(0.6, 0.02, 0.24), 0.95, 'iron', name='tbal%d' % k)
# ---- bell dome (slate), oeil-de-boeuf lucarnes, lantern + finial, iron cresting
prof = [(RT + 0.3, ZE), (RT + 0.12, ZE + 0.35), (RT - 0.05, ZE + 1.2), (RT - 0.35, ZE + 2.2), (RT - 0.9, ZE + 3.0),
        (RT - 1.5, ZE + 3.5), (0.42, ZE + 3.75)]
bm = bmesh.new()
C.loft_bm(bm, [ring_z(rr_, z) for rr_, z in prof], close_start=False, close_end=True)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, SLATE, name='turret_dome', smooth=True, grime=0.5)
for ang in (-130, -50):
    a = math.radians(ang)
    n = V((math.cos(a), math.sin(a), 0))
    lucarne(V((CX, CY, 0)) + n * (RT - 0.15) + V((0, 0, ZE + 0.05)), n, w=0.7, h=1.05, depth=0.9, name='tluc%d' % (ang + 180))
bm = bmesh.new()
zl = ZE + 3.75
C.cyl_bm(bm, V((CX, CY, zl - 0.05)), V((CX, CY, zl + 0.9)), 0.42, 12)
C.cyl_bm(bm, V((CX, CY, zl + 0.9)), V((CX, CY, zl + 1.0)), 0.55, 12)
C.cyl_bm(bm, V((CX, CY, zl + 1.0)), V((CX, CY, zl + 1.5)), 0.5, 12, r1=0.05)
K.part(bm, 'steel_galv', name='turret_lantern', mat_tint=(0.55, 0.6, 0.62))
bm = bmesh.new()
C.cyl_bm(bm, V((CX, CY, zl + 1.4)), V((CX, CY, zl + 2.6)), 0.04, 6)
C.cyl_bm(bm, V((CX, CY, zl + 2.0)), V((CX, CY, zl + 2.25)), 0.12, 8, r1=0.04)
for (x, y) in circ(RT + 0.25, 20):                    # cresting posts on the cornice
    C.cyl_bm(bm, V((x, y, ZE)), V((x, y, ZE + 0.45)), 0.018, 4)
C.loft_bm(bm, [ring_z(RT + 0.25, ZE + 0.42), ring_z(RT + 0.25, ZE + 0.47)], close_start=False, close_end=False)
K.part(bm, 'cast_iron', name='turret_iron', bisect=False)
for i in range(3):
    a = math.radians(r.uniform(-160, -20))
    # (fix round: no 'streak_rain' decal — it drew as a solid black slot between the windows at zoom 2)
K.footprint(circ(RT, 16), 'HIGH', 'round')           # the drum (not a fit kind)
K.footprint(rect(-2.5, -1.1, 2.5, 1.1), 'HIGH', 'building')   # the mission's 5 x 2.2 strip: the fit box
