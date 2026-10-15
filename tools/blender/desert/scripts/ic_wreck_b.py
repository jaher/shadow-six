# ic_wreck.py part 2 (exec'd in its namespace): wings, roundel, debris, scorch, footprint
bm = bmesh.new()                           # the port wing stub, buckled down at the break
C.hexa_bm(bm, [V((-1.3, -0.5, 0.55)), V((0.5, -0.5, 0.6)), V((0.3, -2.3, 0.15)), V((-1.1, -2.2, 0.08)),
               V((-1.3, -0.5, 0.68)), V((0.5, -0.5, 0.72)), V((0.3, -2.3, 0.24)), V((-1.1, -2.2, 0.18))])
# the starboard wing torn off, lying flat beside the fuselage, its tip pointing aft
w0, wa = V((-0.2, 1.6, 0.04)), math.radians(-28)
wu, wv = V((math.cos(wa), math.sin(wa), 0)), V((-math.sin(wa), math.cos(wa), 0))
q = [w0, w0 + wu * 1.8, w0 + wu * 1.4 + wv * 3.6, w0 + wv * 3.7]
C.hexa_bm(bm, [p for p in q] + [p + V((0, 0, 0.12)) for p in q])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, 'paint_metal', name='wings', mat_tint=GREEN, grime=1.3, bisect=False)
rc = w0 + wu * 0.9 + wv * 2.2 + V((0, 0, 0.125))      # a type B roundel (blue / red), faded and scorched
bm = bmesh.new()
C.cyl_bm(bm, rc, rc + V((0, 0, 0.006)), 0.55, 20)
K.part(bm, 'paint_metal', name='roundel_b', mat_tint=(0.2, 0.24, 0.36), grime=0.9, bisect=False)
bm = bmesh.new()
C.cyl_bm(bm, rc + V((0, 0, 0.006)), rc + V((0, 0, 0.012)), 0.22, 16)
K.part(bm, 'paint_metal', name='roundel_r', mat_tint=(0.5, 0.18, 0.15), grime=0.9, bisect=False)
bm = bmesh.new()                           # scattered panels, a wheel, an exhaust stack
for k in range(9):
    a, d = r.uniform(0, 2 * math.pi), r.uniform(2.2, 4.2)
    C.box_bm(bm, (d * math.cos(a), d * math.sin(a) * 0.7, 0.03), (r.uniform(0.3, 0.8), r.uniform(0.2, 0.5), 0.02), rot_z=r.uniform(0, 3.1))
C.cyl_bm(bm, V((-1.6, -1.9, 0.0)), V((-1.6, -1.9, 0.12)), 0.3, 12)
K.part(bm, 'paint_metal', name='debris', mat_tint=CH, grime=1.0, bisect=False)
bm = bmesh.new()                           # fabric scraps left on the frame
for k in range(4):
    c, rad = rings[1 + k]
    p = c + V((0, 0, rad * 0.7))
    C.box_bm(bm, tuple(p), (0.5, 0.35, 0.01), rot_z=ang + r.uniform(-0.2, 0.2))
K.part(bm, 'canvas', name='fabric_scraps', mat_tint=(0.45, 0.43, 0.37), grime=1.2, bisect=False)
for k in range(5):
    K.decal('scorch_a', (r.uniform(-2.5, 3.0), r.uniform(-1.5, 1.8), 0.012), (0, 0, 1), r.uniform(1.5, 3.0), r.uniform(1.2, 2.5), alpha=0.7)
K.decal('soot', (-1.0, -0.62, 0.8), (0, -1, 0), 3.4, 1.2, alpha=0.85)
K.decal('soot', (-1.0, 0.62, 0.8), (0, 1, 0), 3.4, 1.2, alpha=0.85)
dz.sand_drift((-3.4, -0.6), (-3.4, 0.6), (-1, 0, 0), h=0.25, w=0.7, seed=SEED, name='sand_nose')
K.footprint(rect(-3.3, -1.5, 2.7, 1.5), 'LOW', 'prop')
C.A.meta['notes'].append('crashed RAF fighter-recon wreck (burnt): the nose, the tube-frame tail, a torn wing with a type B roundel')
dz.finalize(os.path.join(OUT, NAME), ao_res=512, ao_samples=32)
