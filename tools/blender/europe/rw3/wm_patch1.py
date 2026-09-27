p='<claude-tmp>'
s=open(p).read()
old_start = "bm = bmesh.new()\nK.box_bm(bm, (px, -2.6, (BED + 1.5) / 2)"
old_end = "K.part(bm, 'timber_beam', name='bearings', uv='beam', axis=(1, 0, 0))\n"
i = s.index(old_start); j = s.index(old_end) + len(old_end)
new = '''# rework3: the leat wall was a 1.6 m high pale box right in front of the wheel (after the 90 deg turn it sits between the
# camera and the wheel) -> low rubble leat wall (top just above the headrace water), dressed coping blocks with drip
# projection + joints + cramps, a raised bearing pedestal at the axle only, visible headrace water feeding the wheel.
PT = 0.05                                           # top of the leat-wall masonry (coping sits on it)
PY0, PY1 = -8.4, 3.2
bm = bmesh.new()
K.box_bm(bm, (px, (PY0 + PY1) / 2, (BED + PT) / 2), (0.9, PY1 - PY0, PT - BED))
K.part(bm, STONE, name='wheel_pier', mat_tint=(0.9, 0.88, 0.84))
bm, bmc = bmesh.new(), bmesh.new()
y = PY0
while y < PY1 - 0.05:                               # coping: individual dressed blocks, chamfered top, 12 mm joints
    ln = min(PY1 - y, r.uniform(0.75, 1.1))
    b0, b1 = y + 0.006, y + ln - 0.006
    hw, ht = 0.53, 0.2
    K.hexa_bm(bm if r.random() < 0.7 else bmc,
              [V((px - hw, b0, PT)), V((px + hw, b0, PT)), V((px + hw, b1, PT)), V((px - hw, b1, PT)),
               V((px - hw + 0.06, b0, PT + ht)), V((px + hw - 0.06, b0, PT + ht)), V((px + hw - 0.06, b1, PT + ht)), V((px - hw + 0.06, b1, PT + ht))])
    y += ln
K.part(bm, DR if VAR == 'a' else 'ashlar', name='pier_coping', mat_tint=(0.86, 0.85, 0.82), grime=0.8)
K.part(bmc, 'ashlar', name='pier_coping_b', mat_tint=(0.74, 0.74, 0.7), grime=0.9)
bm = bmesh.new()                                    # iron cramps across the coping joints (rust-dark dots from above)
y = PY0 + 0.9
while y < PY1 - 0.5:
    K.box_bm(bm, (px, y, PT + 0.205), (0.22, 0.05, 0.012))
    y += r.uniform(1.6, 2.4)
K.part(bm, 'steel_painted', name='coping_cramps', mat_tint=(0.35, 0.2, 0.12), grime=0.2, bisect=False)
bm = bmesh.new()                                    # bearing pedestal: only where the axle crosses the leat wall
K.box_bm(bm, (px - 0.05, AX.y, (PT + AX.z - 0.5) / 2 + 0.1), (0.8, 0.9, AX.z - 0.5 - PT + 0.2))
K.box_bm(bm, (px - 0.05, AX.y, AX.z - 0.46), (0.95, 1.05, 0.12))
K.part(bm, DR if VAR == 'a' else 'ashlar', name='bearing_pedestal', mat_tint=(0.84, 0.83, 0.8))
K.cutwater(px, 0.9, -2 * PY0, BED, PT, STONE, upstream=-1, name='pier_cw')
bm = bmesh.new()
for x in (x1 + 0.12, px - 0.2):
    K.box_bm(bm, (x, 0, AX.z - 0.25), (0.35, 0.6, 0.35))
K.part(bm, 'timber_beam', name='bearings', uv='beam', axis=(1, 0, 0))
# headrace water held up by the sluice + falling sheet over the stone breast onto the floats
HW = -0.12
HY1 = AX.y - math.cos(math.radians(20)) * (RAD + 0.15)
bm = bmesh.new()
vs = [bm.verts.new(p_) for p_ in ((x1 + 0.02, PY0, HW), (px - 0.45, PY0, HW), (px - 0.45, HY1, HW), (x1 + 0.02, HY1, HW))]
f_ = bm.faces.new(vs)
nsteps = 7
prev = [vs[3], vs[2]]
for k in range(1, nsteps + 1):                      # nappe following the breast (200 -> 262 deg)
    a = math.radians(200 + 62 * k / nsteps)
    rr_ = RAD + 0.14 - 0.02 * k
    yy, zz = AX.y + math.cos(a) * rr_, AX.z + math.sin(a) * rr_
    cur = [bm.verts.new((x1 + 0.35, yy, zz)), bm.verts.new((px - 0.55, yy, zz))]
    bm.faces.new((prev[0], prev[1], cur[1], cur[0]))
    prev = cur
uvl = bm.loops.layers.uv.new('UVMap')
for f_ in bm.faces:
    for lo in f_.loops:
        lo[uvl].uv = ((lo.vert.co.x - x1) / 2.0, lo.vert.co.y / 4.0 + lo.vert.co.z * 0.2)
K.part(bm, 'water_flow', name='headrace_water', uv='keep', grime=0, bisect=False, jitter=0.0, mat_tint=(0.62, 0.72, 0.74))
bm = bmesh.new()                                    # churn where the nappe meets the floats / tail water
for k in range(7):
    c = V((r.uniform(x1 + 0.5, px - 0.6), AX.y + r.uniform(-1.2, 0.6), WATER + 0.03))
    K.cyl_bm(bm, c, c + V((0, 0, r.uniform(0.05, 0.12))), r.uniform(0.25, 0.45), 8, r1=0.12)
K.part(bm, 'water_flow', name='wheel_foam', grime=0, bisect=False, jitter=0.0, tint=(1.0, 1.0, 1.0), smooth=True)
'''
s = s[:i] + new + s[j:]
open(p,'w').write(s)
print('ok')
