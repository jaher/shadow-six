# ic_barracks.py part 2 (exec'd in its namespace): stovepipes, splinter wall, flag, clutter, weathering, footprint
bm = bmesh.new()
for xx in (-7.0, 0.0, 7.0):                # stovepipes through the N roof slope with rain caps
    zb = ZE + (W / 2 - 1.2) * math.tan(math.radians(PITCH)) - 0.1
    C.cyl_bm(bm, V((xx, 1.2, zb)), V((xx, 1.2, R.z_ridge + 0.9)), 0.09, 8)
    C.cyl_bm(bm, V((xx, 1.2, R.z_ridge + 0.95)), V((xx, 1.2, R.z_ridge + 1.15)), 0.2, 8, r1=0.05)
K.part(bm, 'paint_metal', name='stovepipes', mat_tint=(0.32, 0.3, 0.27), grime=1.0, bisect=False)
# a sandbag splinter wall along the N foot (the side facing the airfield road), broken in two runs
dz.sandbags((-9.5, y1 + 0.55), (-1.5, y1 + 0.55), rows=5, name='bags_n1', thick=2, footprint=False)
dz.sandbags((1.5, y1 + 0.55), (9.5, y1 + 0.55), rows=5, name='bags_n2', thick=2, footprint=False)
dz.flagpole(V((x0 - 1.4, y0 - 0.8, 0)), h=7.0, name='flagpole')
# veranda clutter: a bench, a water drum on a stand, jerrycans, a notice board between the doors, a lamp
bm = bmesh.new()
C.box_bm(bm, (-1.2, y0 - 0.45, 0.68), (1.8, 0.35, 0.06))
for x in (-1.95, -0.45):
    C.box_bm(bm, (x, y0 - 0.45, 0.45), (0.08, 0.3, 0.42))
K.part(bm, 'timber_beam', name='bench', mat_tint=WOOD, grime=0.9, bisect=False)
drums([(6.6, y0 - 1.1, 0.25)], tint=(0.4, 0.43, 0.36), name='water_drum')
jerrycans((x1 + 0.35, -3.6, 0), n=6, rot=math.pi / 2)
jerrycans((-4.5, y0 - 0.35, 0.0), n=3, rot=0.0)
sign_board((2.65, y0 - 0.1, 1.75), (0, -1, 0), 0.9, 0.6, name='notice', post=False)
K.wall_lantern((0.9 + 0.9, y0 - T / 2, 0), (0, -1, 0), 2.45)
drums([(x1 + 0.6, 3.2, 0), (x1 + 0.6, 3.9, 0), (x1 + 1.25, 3.55, 0)], tint=(0.36, 0.38, 0.32), name='fuel_drums')
# weathering: rust streaks under the eaves and the window corners, damp at the foot
for i in range(6):
    K.decal('streak_rust', (r.uniform(x0 + 1, x1 - 1), y0 - T / 2 - 0.02, ZE - 0.7), (0, -1, 0), 1.0, 1.2, alpha=0.4)
    K.decal('streak_rust', (r.uniform(x0 + 1, x1 - 1), y1 + T / 2 + 0.02, ZE - 0.7), (0, 1, 0), 1.0, 1.2, alpha=0.4)
for e in (2, 3):                           # (not across the S and E faces' doors)
    a, b, rr_, n, Le = dz.edge(P, e)
    K.decal('damp_base', tuple((a + b) / 2 + n * (T / 2 + 0.01) + V((0, 0, 0.6))), tuple(n), Le * 0.95, 0.6, alpha=0.4)
sand_feet(C.poly_offset(C.ccw(P), 0.12), h=0.22, w=0.8, seed=SEED, skip=(0, 1))   # (none in front of the doors)
C.roof_meta(P, ZE, walkable=False)
K.footprint(rect(x0, y0, x1, y1), 'HIGH', 'building')
dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=40)
