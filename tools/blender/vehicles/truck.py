# truck.py - Opel Blitz 3.6-36S style 3 t cargo truck (canvas-covered bed), scripted in Blender 4.0.
# Usage: blender -b --factory-startup --python truck.py -- <stage> [variant]
#   stage: model (quick EEVEE preview, unbaked) | full (bake atlas, export GLB, previews)
#   variant: dak (RAL 8000 tan, desert) | grey (RAL 7021 Dunkelgrau) | burnt (destroyed)
# Blender convention: X = right, -Y = forward (exports to +Z forward in glTF / three.js), Z = up.
import sys, os, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector, Matrix
import blib as B

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
STAGE = argv[0] if argv else 'model'
VAR = argv[1] if len(argv) > 1 else 'dak'
RES = int(argv[2]) if len(argv) > 2 else 2048
BODY = argv[3] if len(argv) > 3 else os.environ.get('TRUCK_BODY', 'cargo')   # cargo | tanker (Kfz. 385 style)
TANKER = BODY == 'tanker'
TAG = 'truck_' + VAR + ('_tanker' if TANKER else '')
OUT = os.path.join(B.ROOT, 'out', TAG)
os.makedirs(OUT, exist_ok=True)
B.reset()

def Y(s):  # station measured from the front bumper face (m) -> Blender Y
    return -3.0 + s

BURNT = VAR == 'burnt'
PAINT = {'dak': (150, 128, 86), 'grey': (66, 70, 72), 'burnt': (60, 50, 44)}[VAR]
CANVAS = {'dak': (170, 150, 112), 'grey': (104, 102, 84), 'burnt': (40, 36, 32)}[VAR]
DUST = {'dak': (0.46, 0.37, 0.25), 'grey': (0.30, 0.27, 0.22), 'burnt': (0.05, 0.045, 0.04)}[VAR]

# ------------------------------------------------------------------ materials
def tread_bump(g, nrm):
    """Cross-country chevron lugs around the tyre circumference (object space, axis X)."""
    tc = g.texcoord('Object')
    x, y, z = g.sepxyz(tc)
    ang = g.math('ARCTAN2', z, y)
    r = g.math('SQRT', g.add(g.mul(y, y), g.mul(z, z)))
    chev = g.add(g.mul(ang, 22.0), g.mul(g.math('ABSOLUTE', x), 18.0))
    lug = g.smooth(g.math('SINE', chev), -0.15, 0.25)
    tread = g.smooth(r, 0.405, 0.43)                 # only on tread band
    h = g.mul(lug, tread)
    b = g.new('ShaderNodeBump'); g.s(b, 'Strength', 0.9); g.s(b, 'Distance', 0.02)
    g.s(b, 'Height', h); g.s(b, 'Normal', nrm)
    return b.outputs[0]

def canvas_bump(g, nrm):
    """Large soft canvas folds: vertical-ish creases + sag wrinkles (world space)."""
    n1 = g.noise(1.6, 3, 0.5, stretch=(3.5, 0.7, 1.0), distortion=0.4)
    n2 = g.noise(5.0, 2, 0.5, stretch=(1.0, 4.0, 1.0))
    h = g.add(g.mul(n1, 1.0), g.mul(n2, 0.35))
    b = g.new('ShaderNodeBump'); g.s(b, 'Strength', 0.55); g.s(b, 'Distance', 0.03)
    g.s(b, 'Height', h); g.s(b, 'Normal', nrm)
    return b.outputs[0]

def burnt_albedo(g, col, r):
    return col, r

if not BURNT:
    M_paint = B.mat_paint('paint', PAINT, tex='green_metal_rust', tscale=1.2, variation=0.3, rough=(0.55, 0.85),
                          edge_wear=0.55, dust=0.85, dust_col=DUST, bottom_h=1.1, streaks=0.5, top_dust=0.8)
    M_paint_dark = B.mat_paint('paint_dark', tuple(int(c * 0.45) for c in PAINT), tex='green_metal_rust', tscale=1.2,
                               variation=0.3, rough=(0.6, 0.9), edge_wear=0.2, dust=0.9, dust_col=DUST, bottom_h=1.2)
    M_wood = B.mat_tex('wood', 'weathered_planks', tscale=2.0, tint=PAINT, tint_amt=0.85, sat=0.2, bright=1.6,
                       dust=0.8, dust_col=DUST, bottom_h=1.3, edge_wear=0.4, wear_col=(0.16, 0.12, 0.08))
    M_canvas = B.mat_tex('canvas', 'Fabric045', tscale=0.35, tint=CANVAS, sat=0.0, bright=1.25, nstr=0.8,
                         dust=0.9, dust_col=DUST, top_dust=0.9, bottom_h=1.9, streaks=0.8, bump=canvas_bump,
                         rough_add=0.15, cavity=0.7, ao_dist=0.3)
    M_tyre = B.mat_tex('tyre', 'Rubber004', tscale=0.25, tint=(62, 60, 58), sat=0.0, bright=0.5, dust=0.9,
                       dust_col=DUST, bottom_h=0.9, top_dust=1.0, cavity=0.6, bump=tread_bump, rough_add=0.1)
    M_glass = B.mat_flat('glass', (18, 20, 22), rough=0.06, metal=0.0, dust=0.35, dust_col=DUST, bottom_h=0.0, cavity=0.8)
    M_chrome = B.mat_flat('lamp', (150, 150, 145), rough=0.25, metal=1.0)
    M_metal = B.mat_tex('steel', 'rust_coarse_01', tscale=1.0, sat=0.3, bright=0.35, metal=0.0, dust=0.8,
                        dust_col=DUST, bottom_h=1.0)
    M_lens = B.mat_flat('lens', (70, 70, 66), rough=0.08, dust=0.4, dust_col=DUST, bottom_h=0.0)
    M_red = B.mat_flat('taillight', (120, 10, 8), rough=0.2)
else:
    # destroyed: fire burns the paint off in a height/noise driven "heat" field: faded original paint low down,
    # soot band at the burn front, rusted bare steel + grey-white ash where it burnt through (top, cab, bed).
    lin = B.srgb2lin
    def burnt_paint_fn(g, col, r):
        geo = g.geo(); pos = g.sepxyz(geo.outputs['Position'])
        n1 = g.noise(0.8, 4, 0.55)
        n2 = g.noise(3.5, 6, 0.65)
        n3 = g.noise(12.0, 4, 0.6)
        heat = g.smooth(g.add(g.mul(pos[2], 0.42), g.mul(n1, 0.9)), 0.78, 1.02)
        lum = g.math('MULTIPLY_ADD', g.bw(col), 0.25 / B.tex_mean('rust_coarse_01'), 0.75)
        paint = g.mixc(1.0, g.rgb(lin((118, 102, 74))), lum, 'MULTIPLY')
        rust = g.mixc(1.0, col, g.rgb(lin((150, 120, 100))), 'MULTIPLY')
        c = g.mixc(heat, paint, rust)
        front = g.sub(1.0, g.math('ABSOLUTE', g.sub(g.mul(heat, 2.0), 1.0)))          # 1 at the burn front
        soot = g.smooth(g.add(g.mul(front, 0.55), g.mul(n2, 0.7)), 0.52, 0.68)
        soot = g.add(soot, g.mul(g.smooth(pos[2], 1.2, 2.1), g.smooth(n1, 0.35, 0.55)), clamp=True)   # smoke-blackened top
        soot = g.add(soot, g.mul(g.smooth(n3, 0.6, 0.7), g.mul(heat, 0.5)), clamp=True)
        c = g.mixc(g.mul(soot, 0.92), c, g.rgb((0.016, 0.014, 0.012)))
        ash = g.mul(g.smooth(n2, 0.30, 0.22), heat)
        c = g.mixc(g.mul(ash, 0.75), c, g.rgb(lin((96, 92, 86))))
        rr = g.mixf(soot, g.add(r, 0.1, clamp=True), 0.97)
        return c, rr
    M_paint = B.mat_tex('paint', 'rust_coarse_01', tscale=1.2, sat=0.9, bright=0.9, dust=0.5, dust_col=DUST,
                        albedo_fn=burnt_paint_fn, bottom_h=0.8, cavity=0.9)
    M_paint_dark = M_paint
    M_wood = B.mat_tex('wood', 'weathered_planks', tscale=2.0, tint=(40, 34, 30), sat=0.2, bright=0.45, dust=0.4,
                       dust_col=DUST, albedo_fn=lambda g, c, r: (g.mixc(g.smooth(g.noise(6.0, 5, 0.7), 0.5, 0.6), c,
                                                                         g.rgb((0.012, 0.011, 0.01))), g.add(r, 0.1, clamp=True)))
    M_canvas = None
    M_tyre = B.mat_tex('rim', 'rust_coarse_01', tscale=0.6, sat=0.7, bright=0.7, dust=0.7, dust_col=DUST, albedo_fn=burnt_paint_fn)
    M_glass = B.mat_flat('soot', (16, 14, 12), rough=0.95)      # empty, charred window openings
    M_chrome = M_paint
    M_metal = M_paint
    M_lens = M_glass
    M_red = M_paint
import random
RND = random.Random(11)

parts = []
def P(ob):
    parts.append(ob)
    return ob

# ------------------------------------------------------------------ chassis
for sx in (-1, 1):
    # C-channel frame rails
    P(B.box('rail', (0.07, 5.75, 0.20), (sx * 0.43, Y(3.02), 0.68), M_paint_dark, bevel=0.008, segs=1))
for s in (0.35, 1.9, 3.3, 4.4, 5.85):
    P(B.box('xmember', (0.86, 0.08, 0.12), (0, Y(s), 0.66), M_paint_dark, bevel=0.006, segs=1))
# leaf springs + axles
for s, w in ((0.62, 1.30), (4.22, 1.30)):
    P(B.cylinder('axle', 0.055, w, (0, Y(s), 0.44), 'X', 10, M_paint_dark))
    for sx in (-1, 1):
        P(B.box('spring', (0.08, 1.05, 0.07), (sx * 0.43, Y(s), 0.55), M_paint_dark, bevel=0.01, segs=1))
    P(B.box('diff', (0.3, 0.25, 0.28), (0, Y(s), 0.44), M_paint_dark, bevel=0.05, segs=2)) if s > 1 else None
# fuel tank (right side, below cab) and battery box (left)
P(B.cylinder('tank', 0.19, 0.85, (0.64, Y(2.35), 0.66), 'Y', 14, M_paint, bevel=0.03))
P(B.box('battery', (0.32, 0.5, 0.28), (-0.62, Y(2.35), 0.68), M_paint, bevel=0.02))
# exhaust
P(B.cylinder('exhaust', 0.04, 2.6, (0.25, Y(3.4), 0.48), 'Y', 8, M_metal))

# ------------------------------------------------------------------ bumper + grille + hood
P(B.box('bumper', (1.92, 0.10, 0.17), (0, Y(0.05), 0.52), M_paint_dark, bevel=0.015))
for sx in (-1, 1):
    P(B.box('bumper_arm', (0.08, 0.35, 0.10), (sx * 0.43, Y(0.25), 0.56), M_paint_dark, bevel=0.01, segs=1))
    P(B.box('hook', (0.05, 0.12, 0.10), (sx * 0.62, Y(-0.02), 0.44), M_paint_dark, bevel=0.01, segs=1))

HOOD_W, HOOD_Z0, HOOD_Z1 = 0.84, 0.86, 1.55
S_GRILLE, S_FIREWALL = 0.22, 1.66
# hood: front-view section extruded along Y
sec = B.rounded_rect(HOOD_W, HOOD_Z1 - HOOD_Z0, 0.0, n=5, cy=(HOOD_Z0 + HOOD_Z1) / 2, rtop=0.16, rbot=0.0)
hood = B.prism('hood', sec, S_FIREWALL - S_GRILLE, plane='XZ', offset=Y((S_GRILLE + S_FIREWALL) / 2), mat=M_paint, bevel=0.012, segs=2)
P(hood)
P(B.cylinder('hinge', 0.018, S_FIREWALL - S_GRILLE, (0, Y((S_GRILLE + S_FIREWALL) / 2), HOOD_Z1 + 0.005), 'Y', 8, M_paint))
# side louvers
for sx in (-1, 1):
    for i in range(7):
        s = 0.62 + i * 0.11
        P(B.box('louver', (0.025, 0.07, 0.30), (sx * (HOOD_W / 2 + 0.008), Y(s), 1.22), M_paint, bevel=0.008, segs=1,
                rot=('Y', sx * 0)))
# grille shell (slightly proud, rounded top) + bars + radiator core
gsec = B.rounded_rect(0.80, 0.80, 0.0, n=6, cy=1.14, rtop=0.2)
P(B.prism('grille_shell', gsec, 0.07, plane='XZ', offset=Y(S_GRILLE - 0.01), mat=M_paint, bevel=0.018, segs=2))
core = B.rounded_rect(0.66, 0.66, 0.0, n=6, cy=1.12, rtop=0.14)
P(B.prism('radiator', core, 0.02, plane='XZ', offset=Y(S_GRILLE - 0.05), mat=M_paint_dark))
for i in range(13):
    x = -0.30 + i * 0.05
    h = 0.62 if abs(x) < 0.2 else 0.62 - (abs(x) - 0.2) * 0.9
    P(B.box('bar', (0.014, 0.03, h), (x, Y(S_GRILLE - 0.065), 1.12 - (0.62 - h) / 2), M_paint, bevel=0.004, segs=1))
P(B.cylinder('emblem', 0.045, 0.02, (0, Y(S_GRILLE - 0.08), 1.47), 'Y', 12, M_chrome))
# crank-handle hole / lower apron
P(B.box('apron', (0.84, 0.20, 0.22), (0, Y(0.28), 0.76), M_paint_dark, bevel=0.02))

# ------------------------------------------------------------------ cab
S_CAB0, S_CAB1, CAB_W = 1.62, 2.98, 1.90
prof = [(Y(S_CAB0), 0.92), (Y(S_CAB0), 1.60), (Y(S_CAB0 + 0.03), 1.62), (Y(S_CAB0 + 0.09), 2.07),
        (Y(S_CAB0 + 0.18), 2.17), (Y(S_CAB1 - 0.12), 2.19), (Y(S_CAB1 - 0.02), 2.10), (Y(S_CAB1), 1.95), (Y(S_CAB1), 0.92)]
cab = B.prism('cab', [(y, z) for y, z in prof], CAB_W, plane='YZ', offset=0.0, mat=M_paint, bevel=0.07, segs=3)
cab.modifiers['Bevel'].angle_limit = math.radians(25)
P(cab)
# cowl panel between hood and windscreen
P(B.box('cowl', (CAB_W - 0.1, 0.10, 0.06), (0, Y(S_CAB0 - 0.02), 1.58), M_paint, bevel=0.02))
# windscreen (two panes, raked) - dark glass slightly proud of the cab front
rake = math.atan2(0.06, 0.45)
for sx in (-1, 1):
    w = B.box('windscreen', (0.78, 0.012, 0.40), (sx * 0.43, Y(S_CAB0 + 0.055) - 0.02, 1.845), M_glass, rot=('X', -math.degrees(rake)))
    P(w)
    P(B.box('wsframe', (0.84, 0.02, 0.46), (sx * 0.43, Y(S_CAB0 + 0.055) - 0.003, 1.845), M_paint, bevel=0.008, segs=1, rot=('X', -math.degrees(rake))))
# side windows + door seams + handles
for sx in (-1, 1):
    x = sx * (CAB_W / 2 + 0.006)
    win = B.rounded_rect(0.62, 0.36, 0.05, n=3)
    P(B.prism('sidewin', [(Y(S_CAB0 + 0.55) + a, 1.86 + b) for a, b in win], 0.012, plane='YZ', offset=x, mat=M_glass))
    P(B.prism('sidewin_fr', [(Y(S_CAB0 + 0.55) + a * 1.1, 1.86 + b * 1.15) for a, b in win], 0.008, plane='YZ', offset=x - sx * 0.003, mat=M_paint_dark))
    P(B.box('handle', (0.03, 0.14, 0.025), (sx * (CAB_W / 2 + 0.02), Y(S_CAB0 + 0.95), 1.55), M_paint_dark, bevel=0.008, segs=1))
    P(B.box('seam', (0.006, 0.012, 0.95), (x, Y(S_CAB0 + 0.16), 1.38), M_paint_dark))
    P(B.box('seam', (0.006, 0.012, 0.95), (x, Y(S_CAB0 + 1.05), 1.38), M_paint_dark))
    # mirror
    P(B.beam('mirror_arm', (sx * 0.95, Y(S_CAB0 + 0.1), 1.75), (sx * 1.18, Y(S_CAB0 - 0.02), 1.95), 0.018, mat=M_paint_dark))
    P(B.box('mirror', (0.03, 0.16, 0.12), (sx * 1.18, Y(S_CAB0 - 0.02), 1.98), M_paint_dark, bevel=0.01, segs=1))
# rear window
P(B.box('rearwin', (0.6, 0.012, 0.22), (0, Y(S_CAB1) + 0.006, 1.86), M_glass))

# ------------------------------------------------------------------ front fenders + running boards (sweep)
WC_F = (Y(0.62), 0.45)
R_F = 0.57
def fender_path():
    pts = []
    for i in range(15):
        a = math.radians(172 - i * (172 - 38) / 14)
        pts.append((WC_F[0] + R_F * math.cos(a), WC_F[1] + R_F * math.sin(a)))
    # sweep back and down to the running board
    y0, z0 = pts[-1]
    for i in range(1, 6):
        t = i / 5
        pts.append((y0 + t * 0.55, z0 + (0.60 - z0) * (1 - (1 - t) ** 2)))
    y1 = pts[-1][0]
    for i in range(1, 4):
        pts.append((y1 + (Y(S_CAB1 + 0.02) - y1) * i / 3, 0.60))
    return pts
path = fender_path()
NP = len(path)
def fprof(t):
    # t 0..1 along the path; front part = crowned mudguard 0.56 wide, rear = flat running board 0.32 wide
    k = min(1.0, max(0.0, (t - 0.62) / 0.2))
    inner = -0.28 * (1 - k) + (-0.14) * k
    crown = 0.035 * (1 - k)
    lip = 0.07 * (1 - k) + 0.035 * k
    return [(inner - 0.01, -0.015), (inner, 0.0), (inner * 0.4, crown), (0.12, crown * 0.9), (0.24, crown * 0.3),
            (0.285, -0.01), (0.295, -lip)]
for sx in (-1, 1):
    x0 = sx * 0.72
    if sx > 0:
        pr = fprof
    else:
        pr = lambda t: [(-a, b) for a, b in reversed(fprof(t))]
    f = B.sweep_yz('fender', path, pr, x0, M_paint)
    B.solidify(f, 0.012, offset=-1)
    P(f)
    # inner splash apron between hood and fender
    P(B.box('splash', (0.02, 0.55, 0.30), (sx * 0.44, Y(0.95), 0.92), M_paint_dark))
    # headlight on fender with bucket + lens + rim
    hx, hs, hz = sx * 0.66, 0.33, 1.23
    P(B.cylinder('hl_stalk', 0.02, 0.22, (hx, Y(hs + 0.03), hz - 0.16), 'Z', 6, M_paint_dark))
    lamp = B.lathe('headlamp', [(0.0, 0.11), (0.06, 0.105), (0.10, 0.08), (0.115, 0.03), (0.118, -0.02), (0.11, -0.03), (0.0, -0.03)],
                   segs=16, axis='Y', mat=M_paint)
    lamp.location = (hx, Y(hs), hz)
    P(lamp)
    P(B.cylinder('lens', 0.10, 0.012, (hx, Y(hs) - 0.03, hz), 'Y', 16, M_lens))
# Notek blackout light on left fender
P(B.box('notek', (0.10, 0.08, 0.06), (-0.62, Y(0.48), 1.06), M_paint_dark, bevel=0.015))

# ------------------------------------------------------------------ cargo bed
S_BED0, S_BED1, BED_W = 3.04, 6.02, 2.26
BED_Z = 1.10
None if TANKER else P(B.box('bed_floor', (BED_W, S_BED1 - S_BED0, 0.06), (0, Y((S_BED0 + S_BED1) / 2), BED_Z - 0.03), M_wood, bevel=0.01, segs=1))
for sx in (-1, 1):
    P(B.box('sill', (0.10, S_BED1 - S_BED0, 0.26), (sx * 0.45, Y((S_BED0 + S_BED1) / 2), 0.91), M_paint_dark, bevel=0.01, segs=1))
for s in (3.2, 3.9, 4.6, 5.3, 5.9):
    P(B.box('bearer', (BED_W - 0.04, 0.08, 0.09), (0, Y(s), 0.995), M_paint_dark, bevel=0.008, segs=1))
PLANK_H, NPL = 0.15, 3
def boards(name, size_long, center, axis, n=NPL):
    out = []
    for i in range(0 if TANKER else n):
        if BURNT and i > 0 and RND.random() < 0.45:
            continue      # burnt-through boards
        z = BED_Z + 0.005 + PLANK_H * (i + 0.5)
        if axis == 'Y':
            out.append(B.box(name, (0.035, size_long, PLANK_H - 0.008), (center[0], center[1], z), M_wood, bevel=0.006, segs=1))
        else:
            out.append(B.box(name, (size_long, 0.035, PLANK_H - 0.008), (center[0], center[1], z), M_wood, bevel=0.006, segs=1))
    return out
BW_TOP = BED_Z + PLANK_H * NPL
for sx in (-1, 1):
    for b in boards('side', S_BED1 - S_BED0, (sx * (BED_W / 2 - 0.018), Y((S_BED0 + S_BED1) / 2)), 'Y'):
        P(b)
    None if TANKER else P(B.box('siderail', (0.05, S_BED1 - S_BED0, 0.04), (sx * (BED_W / 2 - 0.02), Y((S_BED0 + S_BED1) / 2), BW_TOP + 0.02), M_paint_dark, bevel=0.01, segs=1))
    for s in (() if TANKER else (3.1, 4.05, 5.02, 5.97)):
        P(B.box('stake', (0.03, 0.07, BW_TOP - BED_Z + 0.08), (sx * (BED_W / 2 + 0.004), Y(s), (BED_Z + BW_TOP) / 2), M_paint_dark, bevel=0.006, segs=1))
    # rear mudguards over dual wheels
    rp = []
    for i in range(9):
        a = math.radians(160 - i * 140 / 8)
        rp.append((Y(4.22) + 0.56 * math.cos(a), 0.45 + 0.56 * math.sin(a)))
    mg = B.sweep_yz('mudguard', rp, [(-0.27, -0.03), (-0.26, 0), (0.26, 0), (0.27, -0.03)], sx * 0.83, M_paint)
    B.solidify(mg, 0.01)
    P(mg)
for b in boards('front', BED_W, (0, Y(S_BED0 + 0.018)), 'X', n=NPL + 1):
    P(b)
for b in boards('tail', BED_W - 0.08, (0, Y(S_BED1 - 0.018)), 'X'):
    P(b)
# rear: tail lights, plate, tow hook
for sx in (-1, 1):
    P(B.box('taillight', (0.10, 0.05, 0.07), (sx * 0.85, Y(S_BED1) + 0.03, BED_Z - 0.17), M_red, bevel=0.01, segs=1))
P(B.box('plate', (0.34, 0.012, 0.20), (0.55, Y(S_BED1) + 0.03, BED_Z - 0.28), B.mat_flat('plate', (215, 212, 200), 0.6, dust=0.8, dust_col=DUST) if not BURNT else M_paint))
P(B.box('towbar', (0.12, 0.25, 0.10), (0, Y(S_BED1 - 0.05), 0.62), M_paint_dark, bevel=0.01))
# spare wheel carrier behind cab, left
# ------------------------------------------------------------------ tanker body (Kfz. 385 style, TRUCK_BODY=tanker)
def build_tank():
    """~3000 l elliptical fuel tank on saddles, dished ends, two manhole domes, walkway, ladder, hose troughs."""
    T0, T1, ZC, RZ, SX = 3.14, 5.90, 1.70, 0.62, 1.60     # stations, centre height, vertical radius, x stretch
    def ell(name, prof, mat, segs=28):
        o = B.lathe(name, [(r, Y(a)) for r, a in prof], segs=segs, axis='Y', mat=mat)
        o.data.transform(Matrix.Translation((0, 0, ZC)) @ Matrix.Diagonal((SX, 1, 1, 1)))
        return o
    shell = [(0.0, T0 - 0.13), (0.28, T0 - 0.115), (0.48, T0 - 0.08), (0.585, T0 - 0.035), (RZ, T0),
             (RZ, T1), (0.585, T1 + 0.035), (0.48, T1 + 0.08), (0.28, T1 + 0.115), (0.0, T1 + 0.13)]
    P(ell('tank_shell', shell, M_paint))
    for s in (T0 + 0.05, 3.72, 4.52, 5.32, T1 - 0.05):          # weld seams / hoops
        P(ell('tank_band', [(RZ - 0.002, s - 0.025), (RZ + 0.012, s - 0.02), (RZ + 0.012, s + 0.02), (RZ - 0.002, s + 0.025)], M_paint_dark))
    for s in (3.45, 4.52, 5.6):                                  # saddles on the bearers
        P(B.box('saddle', (1.72, 0.12, 0.26), (0, Y(s), 1.17), M_paint_dark, bevel=0.012, segs=1))
    top = ZC + RZ
    for s in (3.85, 5.15):                                       # manhole domes + lids + hinge
        P(B.cylinder('dome', 0.21, 0.14, (0, Y(s), top + 0.03), 'Z', 16, M_paint, bevel=0.02))
        P(B.cylinder('lid', 0.235, 0.035, (0, Y(s), top + 0.115), 'Z', 16, M_paint_dark, bevel=0.01))
        P(B.box('lid_hinge', (0.1, 0.05, 0.05), (0, Y(s) - 0.24, top + 0.12), M_paint_dark, bevel=0.01, segs=1))
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            P(B.cylinder('lid_bolt', 0.018, 0.05, (0.2 * math.cos(a), Y(s) + 0.2 * math.sin(a), top + 0.14), 'Z', 6, M_paint_dark))
    P(B.cylinder('vent', 0.035, 0.22, (0.28, Y(4.5), top + 0.06), 'Z', 8, M_metal))
    for sx in (-1, 1):                                           # catwalk treads beside the domes
        P(B.box('catwalk', (0.26, T1 - T0 - 0.3, 0.025), (sx * 0.42, Y((T0 + T1) / 2), top - 0.035), M_metal, bevel=0.004, segs=1))
    for s in (T0 + 0.25, 4.52, T1 - 0.25):                       # handrail posts + rail (left)
        P(B.beam('rail_post', (-0.62, Y(s), top - 0.1), (-0.62, Y(s), top + 0.32), 0.025, mat=M_paint_dark))
    P(B.beam('handrail', (-0.62, Y(T0 + 0.25), top + 0.32), (-0.62, Y(T1 - 0.25), top + 0.32), 0.03, mat=M_paint_dark))
    lx, ly = 0.55, Y(T1 + 0.17)                                  # rear ladder
    for dx in (-0.16, 0.16):
        P(B.beam('ladder_rail', (lx + dx, ly, 0.95), (lx + dx, ly - 0.05, top - 0.05), 0.03, mat=M_paint_dark))
    for i in range(6):
        z = 1.08 + i * 0.22
        P(B.cylinder('rung', 0.013, 0.32, (lx, ly - 0.05 * (z - 0.95) / (top - 1.0), z), 'X', 6, M_metal))
    P(B.box('valve_box', (1.1, 0.42, 0.34), (-0.25, Y(5.72), 0.80), M_paint, bevel=0.02))
    P(B.cylinder('outlet', 0.05, 0.3, (-0.25, Y(5.98), 0.78), 'Y', 10, M_metal))
    for sx in (-1, 1):                                           # hose troughs along the tank flanks
        P(B.cylinder('hose_tube', 0.085, T1 - T0 - 0.2, (sx * 1.03, Y((T0 + T1) / 2), 1.2), 'Y', 12, M_paint_dark, bevel=0.01))
        P(B.cylinder('tube_cap', 0.095, 0.04, (sx * 1.03, Y(T1 - 0.08), 1.2), 'Y', 12, M_paint, bevel=0.008))
# ------------------------------------------------------------------ canvas tarp
TARP_TOP, TARP_SH, TARP_R, TARP_HEM = 2.84, 2.52, 0.30, BW_TOP - 0.10
BOWS = [S_BED0 + 0.06, 4.05, 5.02, S_BED1 - 0.03]
HX = BED_W / 2 + 0.02
def tarp_section(v):
    """v in [0,1] across: left hem -> up -> top -> down -> right hem. returns (x, z, outward normal xz)."""
    side = TARP_SH - TARP_HEM
    arc = math.pi / 2 * TARP_R
    top = 2 * (HX - TARP_R)
    L = 2 * side + 2 * arc + top
    d = v * L
    if d < side:
        return (-HX, TARP_HEM + d, (-1, 0))
    d -= side
    if d < arc:
        a = math.pi - d / TARP_R * 1.0
        c = (-HX + TARP_R, TARP_SH)
        return (c[0] + TARP_R * math.cos(a), c[1] + TARP_R * math.sin(a), (math.cos(a), math.sin(a)))
    d -= arc
    if d < top:
        x = -HX + TARP_R + d
        crown = 0.04 * (1 - (x / (HX - TARP_R)) ** 2)
        return (x, TARP_SH + TARP_R + crown, (0, 1))
    d -= top
    if d < arc:
        a = math.pi / 2 - d / TARP_R
        c = (HX - TARP_R, TARP_SH)
        return (c[0] + TARP_R * math.cos(a), c[1] + TARP_R * math.sin(a), (math.cos(a), math.sin(a)))
    d -= arc
    return (HX, TARP_SH - min(d, side), (1, 0))
def sag(s):
    for a, b in zip(BOWS[:-1], BOWS[1:]):
        if a <= s <= b:
            t = (s - a) / (b - a)
            return math.sin(math.pi * t) ** 1.4
    return 0.0
import random
rnd = random.Random(7)
def tarp_fn(u, v):
    s = S_BED0 + 0.02 + u * (S_BED1 - S_BED0 - 0.02)
    x, z, (nx, nz) = tarp_section(v)
    k = sag(s)
    # sag: top sinks, sides pulled in slightly; shoulders keep shape (held by bows)
    top_w = max(0.0, nz) ** 2
    side_w = abs(nx) * min(1.0, (z - TARP_HEM) / 0.4)
    d = 0.055 * k * top_w + 0.028 * k * side_w
    # rope tension folds near the hem (every 0.37 m)
    hem = max(0.0, 1 - (z - TARP_HEM) / 0.45) * abs(nx)
    d += 0.012 * hem * (0.5 + 0.5 * math.cos(2 * math.pi * s / 0.37))
    return (x - nx * d, Y(s), z - nz * d)
if TANKER:
    build_tank()
elif not BURNT:
    tarp = B.grid_surface('tarp', tarp_fn, 27, 28, M_canvas)
    P(tarp)
    # front panel (against the cab) and rear upper panel + rolled flap
    def end_panel(name, s, zcut, flip):
        bm = bmesh.new()
        ring = [tarp_section(i / 40)[:2] for i in range(41)]
        vs = [bm.verts.new((x, Y(s), max(z, zcut) if zcut else z)) for x, z in ring]
        f = bm.faces.new(vs if not flip else list(reversed(vs)))
        bmesh.ops.triangulate(bm, faces=[f])
        return B.obj_from_bm(name, bm, M_canvas)
    P(end_panel('tarp_front', S_BED0 + 0.02, None, False))
    P(end_panel('tarp_rear', S_BED1 - 0.005, 2.25, True))
    roll = B.cylinder('tarp_roll', 0.075, 2 * HX - 0.02, (0, Y(S_BED1) + 0.02, 2.22), 'X', 12, M_canvas)
    P(roll)
    # rope lashings along the hem
    for sx in (-1, 1):
        for i in range(8):
            s = S_BED0 + 0.2 + i * 0.37
            P(B.box('lash', (0.012, 0.018, 0.16), (sx * (HX + 0.006), Y(s), TARP_HEM + 0.02), B.mat_flat('rope', (120, 108, 84), 0.9) if 'rope' not in bpy.data.materials else bpy.data.materials['rope']))
else:
    # burnt: bare bows only, canvas burnt away
    for k, s in enumerate(BOWS):
        lean = RND.uniform(-0.22, 0.22) if k else 0.0          # heat-warped hoops lean/sag
        droop = RND.uniform(0.0, 0.25) if k else 0.0
        pts = [tarp_section(i / 24)[:2] for i in range(25)]
        pts = [(x, z - droop * math.sin(math.pi * i / 24) ** 2, (z - TARP_HEM) * lean) for i, (x, z) in enumerate(pts)]
        for (x0, z0, d0), (x1, z1, d1) in zip(pts[:-1], pts[1:]):
            P(B.beam('bow', (x0, Y(s) + d0, z0), (x1, Y(s) + d1, z1), 0.05, 0.022, M_paint))
    for x in ():
        P(B.beam('bowbar', (x, Y(BOWS[0]), TARP_SH + TARP_R), (x, Y(BOWS[-1]), TARP_SH + TARP_R), 0.02, mat=M_paint))

# ------------------------------------------------------------------ wheels (separate objects, shared meshes)
def wheel(name, dual=False):
    T = 0.20
    R, RR = 0.45, 0.26
    def tyre(x):
        return [(RR + 0.01, x - T / 2 + 0.01), (0.36, x - T / 2 - 0.005), (0.42, x - T / 2 + 0.01),
                (0.445, x - T / 2 + 0.035), (R, x - T / 4), (R, x + T / 4), (0.445, x + T / 2 - 0.035),
                (0.42, x + T / 2 - 0.01), (0.36, x + T / 2 + 0.005), (RR + 0.01, x + T / 2 - 0.01)]
    if not BURNT:
        prof = tyre(0.0) if not dual else tyre(-0.12) + tyre(0.12)
    else:
        prof = []
    # steel disc rim: outer face at +X
    xo = T / 2 - 0.02 if not dual else 0.12 + T / 2 - 0.02
    rim = [(RR + 0.012, xo), (RR - 0.01, xo - 0.01), (0.2, xo - 0.04), (0.12, xo - 0.03), (0.09, xo + 0.01), (0.05, xo + 0.03), (0.0, xo + 0.03)]
    if BURNT:
        rim = [(RR + 0.02, -T / 2)] + [(RR + 0.02, xo), (RR, xo + 0.005)] + rim[1:]
    wm = M_tyre
    w = B.lathe(name, prof + rim if not BURNT else rim, segs=22, axis='X', mat=wm)
    if not BURNT:
        # rim region gets paint: assign by radius
        w.data.materials.append(M_paint_dark)
        for p in w.data.polygons:
            c = p.center
            if math.hypot(c.y, c.z) < RR + 0.005:
                p.material_index = 1
    # wheel nuts
    nuts = []
    for i in range(6):
        a = 2 * math.pi * i / 6
        nuts.append(B.cylinder('nut', 0.014, 0.03, (xo + 0.005, 0.085 * math.cos(a), 0.085 * math.sin(a)), 'X', 6, M_paint_dark))
    w = B.join([w] + nuts, name)
    return w
wf = wheel('wheel_front')
wr = wheel('wheel_rear', dual=True)
def place(src, name, x, s, flip):
    o = bpy.data.objects.new(name, src.data)
    B.link(o)
    o.location = (x, Y(s), 0.45)
    if flip:
        o.rotation_euler = (0, 0, math.pi)
    return o
wheels = [place(wf, 'wheel_FL', -0.82, 0.62, True), place(wf, 'wheel_FR', 0.82, 0.62, False),
          place(wr, 'wheel_RL', -0.83, 4.22, True), place(wr, 'wheel_RR', 0.83, 4.22, False)]
bpy.data.objects.remove(wf)
bpy.data.objects.remove(wr)

# ------------------------------------------------------------------ box UVs + join body
for o in parts:
    B.box_uv(o, 1.0)
for w in wheels[1::2]:
    pass
B.cyl_uv(wheels[1], axis='X', scale=1.0, r=0.4)
B.cyl_uv(wheels[3], axis='X', scale=1.0, r=0.4)
body = B.join(parts, 'truck_body')
if BURNT:
    # burnt wreck: sagging on flat tyres / rims, slight twist, scorched
    for w in wheels:
        w.location.z = 0.30
    body.location.z = -0.12
    body.rotation_euler = (math.radians(1.2), math.radians(-1.5), 0)
    B.apply_xform(body)
tb = B.tris(body); tw = B.tris(wheels[1]) * 2 + B.tris(wheels[3]) * 2
B.log('TRIS body', tb, 'wheels', tw, 'total', tb + tw)
objs = [body] + wheels
for o in objs:
    o.select_set(False)

if STAGE == 'model':
    B.preview(os.path.join(OUT, 'model_eevee.png'), target=(0, 0, 1.2), dist=13, elev=35, azim=-40, lens=50, capsule=(-2.2, -1.0))
    sys.exit(0)

# ------------------------------------------------------------------ bake atlas
t0 = time.time()
B.unwrap_atlas([body, wheels[1], wheels[3]], angle=60, margin=0.003)
# pass 1: body with wheels + ground as occluders; pass 2: wheels alone (AO rotation invariant)
# record double-sided (canvas) faces before materials are replaced
ds_faces = [p.index for p in body.data.polygons if body.material_slots[p.material_index].material and
            body.material_slots[p.material_index].material.name in ('canvas', 'rope')]
paths = B.bake_atlas([dict(targets=[body], hide=[], ground=True),
                      dict(targets=[wheels[1], wheels[3]], hide=[body, wheels[0], wheels[2]], ground=False)],
                     TAG, RES, OUT, samples=16, ao_samples=48, ao_dist=0.9)
B.log('BAKE total %.1fs' % (time.time() - t0))
fm = B.final_material(TAG, paths)
B.finalize_objects(objs, fm)
fm.use_backface_culling = True
if ds_faces:
    fm2 = fm.copy(); fm2.name = fm.name + '_2sided'; fm2.use_backface_culling = False
    body.data.materials.append(fm2)
    for i in ds_faces:
        body.data.polygons[i].material_index = 1
if BURNT:
    # ground scorch decal (procedural RGBA, alpha-blended quad 2 cm above ground; not part of the atlas)
    import numpy as np
    from PIL import Image, ImageFilter
    DW, DL, RS = 5.2, 9.0, 512
    yy, xx = np.mgrid[0:RS, 0:RS] / (RS - 1) * 2 - 1
    rng = np.random.default_rng(3)
    def fbm(oct=5):
        acc = np.zeros((RS, RS)); amp = 1.0
        for o in range(oct):
            n = 4 * 2 ** o
            im = Image.fromarray((rng.random((n, n)) * 255).astype(np.uint8)).resize((RS, RS), Image.BICUBIC)
            acc += amp * (np.asarray(im) / 255.0 - 0.5); amp *= 0.5
        return acc
    r = np.sqrt((xx * 1.0) ** 2 + (yy * 1.0) ** 2) + fbm() * 0.45
    alpha = np.clip((1.0 - r) / 0.3, 0, 1) * 0.97
    ash = np.clip(fbm(4) * 2.5 + 0.2, 0, 1) * np.clip((0.75 - r) / 0.3, 0, 1)
    col = np.stack([0.034 + 0.085 * ash, 0.027 + 0.075 * ash, 0.020 + 0.060 * ash], -1)   # warm soot brown-black -> grey-brown ash flecks
    rgba = np.concatenate([np.clip(col, 0, 1) ** (1 / 2.2), alpha[..., None]], -1)
    dpath = os.path.join(OUT, 'scorch.png')
    Image.fromarray((rgba * 255).astype(np.uint8), 'RGBA').save(dpath, optimize=True)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    for v in bm.verts:
        v.co.x *= DW; v.co.y *= DL; v.co.z = 0.02      # create_grid(size=0.5) spans -0.5..0.5
    uvl = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv = (l.vert.co.x / DW + 0.5, l.vert.co.y / DL + 0.5)
    dec = B.obj_from_bm('scorch_decal', bm)
    dm, dg = B.new_mat('scorch')
    ti = dg.img(dpath, dg.uv('UVMap'))
    bs = dg.N['Principled BSDF']
    dg.L.new(ti.outputs['Color'], bs.inputs['Base Color']); dg.L.new(ti.outputs['Alpha'], bs.inputs['Alpha'])
    bs.inputs['Roughness'].default_value = 1.0
    sp = bs.inputs.get('Specular IOR Level') or bs.inputs.get('Specular')
    sp.default_value = 0.0      # -> KHR_materials_specular 0: no sky sheen (read navy-blue in three.js)
    dm.blend_method = 'BLEND'; dm.shadow_method = 'NONE'
    dec.data.materials.append(dm)
    dec.location.y = Y(3.0)          # centred under the wreck
    objs.append(dec)
glb = os.path.join(OUT, TAG + '.glb')
B.export_glb(glb, objs)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, TAG + '.blend'))
B.preview(os.path.join(OUT, 'baked_eevee_game.png'), target=(0, 0, 1.0), dist=38, elev=55, azim=-30, lens=50, res=(1280, 800))
B.preview(os.path.join(OUT, 'baked_eevee_close.png'), target=(0, 0, 1.2), dist=12, elev=35, azim=-40, lens=50, capsule=(-2.2, -1.0))
