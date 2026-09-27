# mg_nest.py - sandbagged MG emplacements, dug in with the spoil thrown up as an earth bank around them.
#  'ring'      : circular double-thickness wall (4 courses), crew entry gap at the rear finished with header bags,
#                worn duckboards in the entry gap (rework2: no loose boards outside), MG 42 on the Lafette 34 (medium position).
#  'horseshoe' : U-shaped wall open at the rear (double front, single sides), irregular spoil apron (vertex-alpha feathered
#                into the terrain, MG 34 on the Lafette 34.
# Bags: five mesh variants (standard/long/short/slumped/draped) with yaw/tilt/height scatter, running-bond courses,
# draped bags over the top course; trodden floor with spent casings; ammunition cans + crate.
# Run: blender ... --python mg_nest.py -- ring|horseshoe [preview]
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as V
from vlib import B, P, node, D
import mgkit as M
V.DUST_SCALE = 0.45
V.LOD_RATIO = {0: 1.0, 1: 0.5, 2: 0.25}
import tankparts as T

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
STYLE = argv[0] if argv and argv[0] in ('ring', 'horseshoe') else 'ring'
V.begin(f'mgnest_{STYLE}', seed=7 if STYLE == 'ring' else 8)
rng = random.Random(5 if STYLE == 'ring' else 9)
node('apron', (0, 0, 0), 'hull', 'static')                 # rework2: own node -> vertex-alpha feathered into the terrain
V.A.feather = {'apron': (0.004, 0.075)}
bags = M.bag_set()
H = 0.125                                                  # course height (compressed bags)
BANK = 0.22                                                # spoil bank height against the wall (lower course buried)
if STYLE == 'ring':
    R0, R1 = 1.28, 1.58                                    # inner / outer ring of bags
    gap = 0.95                                             # entry gap width at the rear (+Y)
    ga = lambda r: math.asin(gap / 2 / r)
    for c in range(4):
        off = (0.27 if c % 2 else 0.0)
        for r in (R0, R1):
            a0 = math.pi / 2 + ga(r) + off / r; a1 = math.pi / 2 + 2 * math.pi - ga(r) - off / r
            M.bag_course(bags, M.arc(r, a0, a1, 30), 0.065 + c * H, rng=rng, name=f'bag_c{c}', top=(c == 3))
        for sx in (-1, 1):                                 # header bags finishing the gap ends
            x = sx * (gap / 2 + 0.17)
            M.bag_course(bags, [(x, R0 - 0.02), (x, R1 + 0.14)], 0.065 + c * H, rng=rng, name=f'bag_c{c}', header=False, lengths=0.5)
    P(B.cylinder('floor', R0 - 0.05, 0.02, (0, 0, 0.0), 'Z', 28), 'hull', 'earth', uv=0.35)
    ap = M.earth_apron('spoil_bank', lambda a: 1.0, R1 + 0.12, R1 + 1.05, BANK, seed=11, a0=math.pi / 2 + 0.42,
                       a1=math.pi / 2 + 2 * math.pi - 0.42, closed=False)
    P(ap, 'apron', 'earth', uv=0.4)
    # rework2: entry = trodden gap in the ring (spoil bank open there, header bags frame it) with two worn duckboards
    # lying IN the gap on the pit floor - no loose boards / trench banks out on the grass any more
    P(B.box('entry_floor', (0.9, R1 - R0 + 0.25, 0.02), (0, (R0 + R1) / 2 - 0.125, 0.0)), 'hull', 'earth', uv=0.3)
    for i in range(2):
        P(B.box('duckboard', (0.52, 0.40, 0.03), (rng.uniform(-0.03, 0.03), R0 - 0.15 + i * 0.44, 0.022), rot=('Z', rng.uniform(-5, 5))), 'hull', 'wood', 1)
        for k in (-0.15, 0.15):
            P(B.box('duckboard_rail', (0.04, 0.40, 0.02), (k, R0 - 0.15 + i * 0.44, 0.012)), 'hull', 'wood', 1)
    mg_base, kind = (0, -0.30, 0.02), 'mg42'
    V.socket('exit_rear', (0, R1 + 0.9, 0.0), 'hull', heading=0.0)
else:
    for c in range(4):                                     # U: double front arc + single side walls
        off = 0.27 if c % 2 else 0.0
        for r in (1.10, 1.40):
            M.bag_course(bags, M.arc(r, math.radians(198) + off / r, math.radians(342) - off / r, 16), 0.065 + c * H,
                         rng=rng, name=f'bag_c{c}', top=(c == 3))
        for sx in (-1, 1):             # rework2: side walls step down towards the open rear (no isolated column)
            x = sx * 1.25
            M.bag_course(bags, [(x, -0.35 + off * 0.5), (x, 1.25 - 0.30 * c)], 0.065 + c * H, rng=rng, name=f'bag_c{c}',
                         top=(c == 3), lengths=0.55)
    P(B.box('floor', (2.1, 2.2, 0.02), (0, 0.25, 0.0)), 'hull', 'earth', uv=0.35)
    inner = lambda a: 1.0 if math.sin(a) < 0 else 1.0 + 0.25 * math.sin(a)
    ap = M.earth_apron('spoil_apron', inner, 1.52, 2.55, BANK + 0.08, seed=13, a0=math.radians(150), a1=math.radians(390),
                       closed=False)
    P(ap, 'apron', 'earth', uv=0.4)
    P(B.box('ammo_crate', (0.5, 0.3, 0.22), (0.75, 1.0, 0.11), bevel=0.01, segs=1, rot=('Z', 12)), 'hull', 'wood', 1)
    mg_base, kind = (0, -0.35, 0.0), 'mg34'
gz = M.tripod(kind, mg_base, 'hull', low=False, cans=3)
for i in range(14):                                        # spent casings on the trodden floor (right of the gun)
    a = rng.uniform(0, 2 * math.pi); r = rng.uniform(0.1, 0.45)
    P(B.cylinder('casing', 0.0055, 0.057, (-0.25 + r * math.cos(a), 0.05 + r * math.sin(a), 0.03), 'Y', 5), 'hull', 'brass', 0).rotation_euler = (0, 0, a)
V.socket('rifleman', (0.8, 0.6, 0.0), 'hull', heading=0.0, pose='standing')
V.emitter('muzzle_dust', (0, -1.7, 0.45), 'hull', (0, -1, 0.2), 'blast_dust')
if 'preview' in argv:
    B.preview(os.path.join(V.A.out, 'model_eevee.png'), target=(0, 0, 0.3), dist=7, elev=40, azim=-40, lens=50)
    sys.exit(0)
V.finalize(2048, dims=dict(outer_diameter=3.4 if STYLE == 'ring' else 5.1, wall_height=round(4 * H + 0.07, 2), bore_height=round(gz, 3)),
           burnt_pose={'mount': dict(rot=(0, 0, 40)), 'gun': dict(rot=(15, 30, 0))},
           burnt_drop=('bag_c3', 'bag_c2', 'ammo_lid', 'ammo_handle', 'sight_', 'belt', 'casing', 'duckboard', 'carry_pad'),
           info=dict(model=f'sandbagged MG nest ({STYLE})', weapon=kind, crew=2, mount='MG-Lafette 34 (medium position)',
                     note='destroyed = burnt variant: top two courses blown away, MG knocked over'))
