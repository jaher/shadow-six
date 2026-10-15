# ic_dugout.py part 2 (exec'd in its namespace): stovepipe, aerial, net, flagpole, clutter, sand, footprints
bm = bmesh.new()
C.cyl_bm(bm, V((1.2, 0.9, ZW + 0.6)), V((1.2, 0.9, ZW + 1.8)), 0.08, 8)
C.cyl_bm(bm, V((1.2, 0.9, ZW + 1.82)), V((1.2, 0.9, ZW + 2.0)), 0.18, 8, r1=0.05)
K.part(bm, 'paint_metal', name='stovepipe', mat_tint=(0.3, 0.28, 0.26), grime=1.0, bisect=False)
whip(5.6, 1.6, ZW + 0.7, 4.5, name='whip')
bm = bmesh.new()                           # a camouflage net thrown over the W end, pegged out on the sand
rows = []
for i in range(6):
    x = -HW - 0.9 + 4.6 * i / 5
    row = []
    for j in range(7):
        y = -HD - 0.9 + (2 * HD + 1.8) * j / 6
        inside = abs(y) < HD + 0.1 and x > -HW - 0.1
        zt = (ZW + 0.2 + 0.8 * max(0.0, 1 - (y / (HD + 0.3)) ** 2) * 0.9 + 0.08) if inside else 0.05 + 0.25 * r.random()
        row.append(bm.verts.new((x + r.uniform(-0.1, 0.1), y, zt)))
    rows.append(row)
for i in range(5):
    for j in range(6):
        bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.03)
K.part(bm, 'camo_netting', name='net', mat_tint=(0.86, 0.78, 0.6), grime=0.4, bisect=False)
dz.flagpole(V((HW + 0.6, HD + 0.5, 0)), h=5.5, name='flagpole')
jerrycans((DOORS[1] + 1.6, -HD - 0.45, 0), n=5, rot=0.0)
bm = bmesh.new()
dz.crate(bm, (DOORS[0] - 1.7, -HD - 0.6, 0), (0.7, 0.45, 0.4), 0.2)
dz.crate(bm, (DOORS[0] - 1.65, -HD - 0.6, 0.4), (0.6, 0.4, 0.3), 0.1)
K.part(bm, 'wood_paint', name='ammo_boxes', mat_tint=DAK, grime=0.8, bisect=False)
drums([(-HW - 0.6, -1.2, 0), (-HW - 0.6, -0.5, 0)], tint=(0.38, 0.4, 0.34), name='drums')
for e, (a, b, n) in enumerate((((-HW, HD + 0.3), (HW, HD + 0.3), (0, 1, 0)), ((HW + 0.35, -HD), (HW + 0.35, HD), (1, 0, 0)),
                               ((-HW - 0.35, -HD), (-HW - 0.35, HD), (-1, 0, 0)))):
    dz.sand_drift(a, b, n, h=0.35, w=1.0, seed=SEED + e, name='sand%d' % e)
for k in range(5):
    K.decal('dirt_splash', (r.uniform(-HW, HW), -HD - r.uniform(0.8, 2.5), 0.012), (0, 0, 1), r.uniform(1.5, 2.5), r.uniform(1.0, 2.0), alpha=0.4)
C.roof_meta(rect(-HW, -HD, HW, HD), ZW + 1.0, walkable=False)
K.footprint(rect(-HW - 0.3, -HD - 0.3, HW + 0.3, HD + 0.3), 'HIGH', 'building')
dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=40)
