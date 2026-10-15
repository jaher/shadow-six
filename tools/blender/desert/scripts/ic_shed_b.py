# ic_shed.py part 2 (exec'd in its namespace): net / tarp, the back-wall clutter, bomb damage, sand, footprints
if VAR in ('a', 'c'):                      # camouflage net rolled along the front eave (the tank drives out under it)
    bm = bmesh.new()
    C.cyl_bm(bm, V((-HW + 0.2, -HD - 0.15, zr(-HD) - 0.05)), V((HW - 0.2, -HD - 0.15, zr(-HD) - 0.05)), 0.2, 10)
    K.part(bm, 'camo_netting', name='net_roll', mat_tint=(0.86, 0.78, 0.6), grime=0.4, bisect=False, smooth=True)
if VAR == 'b':                             # a canvas tarp hung down the W side outside the sheets, lashed at the foot
    bm = bmesh.new()
    rows = [[V((-HW - 0.08 - 0.05 * math.sin(j * 1.3 + i), -HD + 1.0 + 4.2 * i / 4, zr(-HD + 1.0 + 4.2 * i / 4) - 0.1 - 3.9 * j / 3))
             for j in range(4)] for i in range(5)]
    vv = [[bm.verts.new(p) for p in row] for row in rows]
    for i in range(4):
        for j in range(3):
            bm.faces.new((vv[i][j], vv[i][j + 1], vv[i + 1][j + 1], vv[i + 1][j]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.02)
    K.part(bm, 'canvas', name='tarp', mat_tint=(0.72, 0.66, 0.5), grime=0.7, bisect=False)
if VAR == 'c':                             # sandbag skirts along both side walls (splinter protection)
    for sx in (-1, 1):
        dz.sandbags((sx * (HW + 0.55), -HD + 0.6), (sx * (HW + 0.55), HD - 0.4), rows=4, name='skirt%d' % (sx + 1), thick=1, footprint=False)
# ---- along the back wall only (the bay stays clear for the Panzer): bench, drums, cans, road wheels, a lamp
bm = bmesh.new()
bx = -HW + 1.8
C.box_bm(bm, (bx, HD - 0.75, 0.85), (2.2, 0.7, 0.08))
for (x, y) in ((bx - 1.0, HD - 0.5), (bx + 1.0, HD - 0.5), (bx - 1.0, HD - 1.0), (bx + 1.0, HD - 1.0)):
    C.box_bm(bm, (x, y, 0.42), (0.09, 0.09, 0.84))
K.part(bm, 'timber_beam', name='bench', mat_tint=WOOD, grime=0.9, bisect=False)
drums([(HW - 0.9, HD - 0.8, 0), (HW - 1.6, HD - 0.75, 0), (HW - 0.95, HD - 1.5, 0)], tint=(0.42, 0.44, 0.38), name='oil_drums', lying=(2,) if VAR == 'b' else ())
jerrycans((0.4, HD - 0.65, 0), n=5 if VAR != 'd' else 3, rot=0.0)
if VAR in ('a', 'd'):
    bm = bmesh.new()
    for k, (x, z) in enumerate(((-1.5, 0.36), (-1.15, 0.36), (-1.32, 0.98))):
        C.cyl_bm(bm, V((x, HD - 0.55 - 0.1 * k, z)), V((x, HD - 0.75 - 0.1 * k, z)), 0.36, 14)
    K.part(bm, 'paint_metal', name='roadwheels', mat_tint=(0.62, 0.56, 0.42), grime=1.0, bisect=False, smooth=True)
if VAR in ('b', 'c'):
    bm = bmesh.new()
    for k in range(9):
        C.box_bm(bm, (2.0 + k * 0.155, HD - 0.95, 0.04), (0.14, 0.5, 0.07))
    K.part(bm, 'cast_iron', name='track_links', mat_tint=(0.38, 0.33, 0.28), grime=1.0, bisect=False)
bm = bmesh.new()
C.cyl_bm(bm, V((0.0, 0.0, zr(0) - 0.1)), V((0.0, 0.0, zr(0) - 0.9)), 0.008, 3)
C.cyl_bm(bm, V((0.0, 0.0, zr(0) - 0.9)), V((0.0, 0.0, zr(0) - 1.05)), 0.16, 10, r1=0.06)
K.part(bm, 'cast_iron', name='lamp', mat_tint=(0.3, 0.32, 0.28), bisect=False)
K.anchor('light', (0.0, 0.0, zr(0) - 1.1), (0, 0, -1), kind='light')
sign_board((-HW + 2.6, HD - 0.12, 2.4), (0, -1, 0), 1.0, 0.5, name='shed_sign', post=False)
for k in range(6):                         # oil stains where the tank stands
    K.decal('stain_blotch', (r.uniform(-1.5, 1.5), r.uniform(-HD + 1.5, HD - 2.5), 0.012), (0, 0, 1), r.uniform(0.8, 1.8), r.uniform(0.6, 1.4), alpha=0.55)
if BOMBED:                                 # charred beams + sheets down in the back-E corner, scorch on the walls
    dz.debris_timber((HW - 1.6, HD - 1.8, 0), 1.3, 1.2, seed=SEED, planks=12, felt=0, studs=4, name='deb_beams', mid='timber_beam', charred=0.8)
    bm = bmesh.new()
    for k in range(6):
        x, y = HW - 1.0 - r.uniform(0, 2.4), HD - 0.8 - r.uniform(0, 3.0)
        a = r.uniform(0, math.pi)
        C.hexa_bm(bm, [V((x, y, 0.05)), V((x + 0.8 * math.cos(a), y + 0.8 * math.sin(a), 0.05 + r.uniform(0, 0.5))),
                       V((x + 0.8 * math.cos(a) - 2 * math.sin(a), y + 0.8 * math.sin(a) + 2 * math.cos(a), 0.2 + r.uniform(0, 0.9))), V((x - 2 * math.sin(a), y + 2 * math.cos(a), 0.15)),
                       V((x, y, 0.08)), V((x + 0.8 * math.cos(a), y + 0.8 * math.sin(a), 0.08 + r.uniform(0, 0.5))),
                       V((x + 0.8 * math.cos(a) - 2 * math.sin(a), y + 0.8 * math.sin(a) + 2 * math.cos(a), 0.23 + r.uniform(0, 0.9))), V((x - 2 * math.sin(a), y + 2 * math.cos(a), 0.18))])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'corrugated_rust', name='sheets_down', grime=1.0, bisect=False)
    for (p, n) in (((HW + 0.06, 2.0, 2.4), (1, 0, 0)), ((3.0, HD + 0.06, 2.6), (0, 1, 0)), ((HW + 0.06, -3.0, 3.0), (1, 0, 0))):
        K.decal('soot', p, n, 3.5, 3.0, alpha=0.75)
    for k in range(5):
        K.decal('scorch_a', (r.uniform(0, HW - 1), r.uniform(-HD + 2, HD - 2), 0.014), (0, 0, 1), r.uniform(1.5, 3), r.uniform(1.2, 2.5), alpha=0.6)
for sx in (-1, 1):
    dz.sand_drift((sx * (HW + 0.3), -HD), (sx * (HW + 0.3), HD), (sx, 0, 0), h=0.3, w=0.9, seed=SEED + sx, name='sand_e%d' % (sx + 1))
dz.sand_drift((-HW, HD + 0.3), (HW, HD + 0.3), (0, 1, 0), h=0.35, w=1.0, seed=SEED + 5, name='sand_back')
# ---- footprints: back + side walls (HIGH); the bay stays open
K.footprint(rect(-HW - 0.3, HD - 0.3, HW + 0.3, HD + 0.3), 'HIGH', 'wall')
for sx in (-1, 1):
    K.footprint(rect(sx * HW - 0.3, -HD, sx * HW + 0.3, HD), 'HIGH', 'wall')
C.A.meta['notes'].append('single-bay tank shed, open front (-Y); the mission draws its walls as gameplay walls, this is the visual')
dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=40)
