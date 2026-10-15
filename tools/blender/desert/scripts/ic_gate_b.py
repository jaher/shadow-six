# ic_gate.py part 2 (exec'd in its namespace): doors (gate), fallen bricks (arch), lantern, sand, footprints
if VAR == 'gate':
    LW, LH = HP, 3.5                       # each leaf HP wide, standing open flat against the inner (-Y) face
    for s in (-1, 1):
        bm = bmesh.new()
        xa, xb = s * (HP + PW - 0.05), s * (HP + PW - 0.05 + LW)
        cx = (xa + xb) / 2
        nb = 7
        for k in range(nb):                # vertical boards with small gaps
            x = xa + (xb - xa) * (k + 0.5) / nb
            C.box_bm(bm, (x, -PD / 2 - 0.12, 0.15 + LH / 2), (abs(xb - xa) / nb - 0.02, 0.06, LH - 0.04 * (k % 2)))
        K.part(bm, 'boards_weathered', name='leaf%d' % (s + 1), mat_tint=(0.82, 0.72, 0.58), grime=1.0, bisect=False, uv='aligned')
        bm = bmesh.new()
        for z in (0.6, 1.9, 3.2):          # tarred rails + iron straps on the visible (inner) side
            C.box_bm(bm, (cx, -PD / 2 - 0.17, 0.15 + z), (abs(xb - xa) - 0.1, 0.05, 0.16))
        C.beam_bm(bm, (xa + s * 0.1, -PD / 2 - 0.18, 0.75), (xb - s * 0.1, -PD / 2 - 0.18, 3.25), 0.12, 0.05)
        K.part(bm, 'timber_tarred', name='rails%d' % (s + 1), mat_tint=(0.6, 0.55, 0.48), grime=1.0, bisect=False)
        bm = bmesh.new()
        for z in (0.6, 1.9, 3.2):
            C.box_bm(bm, (xa + s * 0.45, -PD / 2 - 0.2, 0.15 + z), (0.8, 0.02, 0.07))
        K.part(bm, 'cast_iron', name='straps%d' % (s + 1), mat_tint=(0.3, 0.29, 0.27), bisect=False)
    bm = bmesh.new()                       # a lantern on a bracket over the passage (outside face)
    C.beam_bm(bm, (0, PD / 2, TOP - 0.6), (0, PD / 2 + 0.45, TOP - 0.6), 0.04, 0.04)
    C.cyl_bm(bm, V((0, PD / 2 + 0.45, TOP - 0.62)), V((0, PD / 2 + 0.45, TOP - 0.95)), 0.1, 8, r1=0.07)
    K.part(bm, 'cast_iron', name='lantern', mat_tint=(0.25, 0.25, 0.23), bisect=False)
    K.anchor('light', (0, PD / 2 + 0.45, TOP - 1.0), (0, 0, -1), kind='light')
    sign_board((HP + PW / 2, PD / 2 + 0.03, 2.6), (0, 1, 0), 0.9, 0.5, name='board', post=False)
    for k in range(3):                     # wheel ruts through the passage
        K.decal('dirt_splash', (r.uniform(-1.2, 1.2), r.uniform(-1.5, 1.5), 0.012), (0, 0, 1), 2.0, 3.0, alpha=0.4)
else:
    bm = bmesh.new()                       # bricks fallen off the eroded top
    for k in range(7):
        x = r.choice((-1, 1)) * (HP + r.uniform(0.0, 1.4))
        C.box_bm(bm, (x, r.uniform(-1.2, 1.2), 0.05), (0.36, 0.18, 0.1), rot_z=r.uniform(0, 3.1))
    K.part(bm, BR, name='fallen', mat_tint=BR_T, grime=1.0, bisect=False)
for s in (-1, 1):
    for sy in (-1, 1):
        dz.sand_drift((s * (HP + 0.1), sy * (PD / 2 + 0.2)), (s * (HP + PW), sy * (PD / 2 + 0.2)), (0, sy, 0), h=0.25, w=0.7,
                      seed=SEED + s + 2 * sy, name='sand%d%d' % (s + 1, sy + 1))
    K.footprint(rect(s * HP if s > 0 else -(HP + PW), -PD / 2, (HP + PW) if s > 0 else -HP, PD / 2), 'HIGH', 'wall')
C.A.meta['notes'].append('mud-brick arch gate: the passage stays open (no footprint); the piers are the footprints')
dz.finalize(os.path.join(OUT, NAME), ao_res=512, ao_samples=32)
