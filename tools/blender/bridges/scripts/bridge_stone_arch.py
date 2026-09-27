"""Masonry arch road bridges, 1 / 3 / 5 arches, seeded material variants + blown (destroyed) variant.
Usage: blender -b --python bridge_stone_arch.py -- <variant>   variants: see V below."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brlib as BL
from brlib import K, C, V
import kit_weather as W
import brfix as F
import brfix2 as F2
import brfix3 as F3

VARIANTS = {
    # name: (spans, pier_w, width, water, bed, spring, camber, body, dressed, coping, road, lamps, theater, seed)
    'bridge_stone_arch1_a': (((13.0, 5.4),), 2.2, 5.0, -4.6, -6.8, -4.9, 1.9, 'fieldstone_grey', 'granite', 'granite', 'cobblestone', False, 'temperate', 21),
    'bridge_stone_arch1_b': (((11.0, 5.5),), 2.2, 5.4, -4.8, -7.0, -5.0, 1.9, 'ashlar_limestone', 'ashlar_limestone', 'ashlar', 'cobble_desert', False, 'desert', 22),
    'bridge_stone_arch3_a': (((10.0, 4.2), (12.5, 5.2), (10.0, 4.2)), 2.3, 7.4, -5.2, -7.8, -5.0, 1.35, 'ashlar', 'granite', 'granite', 'cobblestone', True, 'temperate', 31),
    'bridge_stone_arch3_b': (((10.0, 4.4), (12.0, 5.2), (10.0, 4.4)), 2.2, 7.6, -5.2, -7.8, -5.0, 1.3, 'brick_red', 'limestone_grimy', 'limestone_grimy', 'cobblestone', True, 'temperate', 32),
    'bridge_stone_arch5_a': (((9.0, 3.6), (11.0, 4.4), (13.0, 5.2), (11.0, 4.4), (9.0, 3.6)), 2.4, 8.0, -5.4, -8.2, -5.2, 1.5, 'ashlar_body', 'ashlar', 'ashlar_limestone', 'cobblestone', True, 'temperate', 51),
}
a = BL.args()
name = a[0] if a else 'bridge_stone_arch3_a'
destroyed = name.endswith('_destroyed')
snow = name.endswith('_snow')
base = name.replace('_destroyed', '').replace('_snow', '')
spans, pier_w, width, water, bed, spring, camber, body, dressed, coping, road, lamps, theater, seed = VARIANTS[base]
OUT = os.path.join(BL.OUTROOT, name)
F.ALIAS.update({'cobble_desert': ('cobblestone', (0.86, 0.78, 0.66), 1.0), 'limestone_grimy': ('ashlar_limestone', (0.74, 0.71, 0.66), 1.0),
                'ashlar_body': ('ashlar', (0.84, 0.79, 0.72), 1.0), 'granite': ('ashlar', (0.66, 0.67, 0.68), 1.0)})
F.VGAP, F.VTONE = (0.007, 0.2) if base == 'bridge_stone_arch3_b' else (0.009, 0.14)
big5 = base == 'bridge_stone_arch5_a'
F2.SOFFIT.update({'blk': 2.0, 'course': 0.45} if big5 else {'blk': 1.3, 'course': 0.36})
APPR = 7.0
F.TIDE_PALE = 0.5
F2.RAMP.update({'on': True, 'z_end': 0.55, 'L': APPR})
if snow:
    F2.snow_mode()
    F3.LAMP_SNOW[0] = True
K.begin(name, seed, theater='snow' if snow else theater, snow=snow, water_level=water)
B = F.stone_arch_bridge(spans=spans, pier_w=pier_w, width=width, water=water, bed=bed, spring=spring, camber=camber,
                        body=body, dressed=dressed, coping=coping, road_mid=road, kerb='granite', lamps=lamps,
                        parapet_h=0.95 if len(spans) > 1 else 0.85, wing_len=6.0 if len(spans) > 1 else 4.5, decals=False,
                        approach=APPR)
F2.AO_GROUND.update({'banks': (-B['tot'] / 2, B['tot'] / 2), 'water': water})
BL.bmeta()['approach'] = {'length': APPR, 'z_deck_end': round(B['deck'].z(B['x1']), 3), 'z_ground': F2.RAMP['z0'],
                          'profile': 'smoothstep from deck end (|x| = %.2f) to ground over length' % B['x1']}
D, tot, arches, piers = B['deck'], B['tot'], B['arches'], B['piers']
r = K.rng()
# ---- extra detail: gauge board, riprap, ivy/moss  (r4: scupper spouts + pattress plates dropped - they read as
# black chevron glyphs on the pier heads at 1x; the deck drains through the parapet foot instead)
if piers:
    BL.gauge_board(piers[len(piers) // 2] - pier_w * 0.25, -width / 2 - 0.02, water, (0, -1, 0))
    for px in piers:
        F.riprap_ring(BL.pier_outline(px, pier_w + 0.64, width + 0.64, nose=pier_w * 0.9 + 0.45), water, n=15 if len(arches) > 3 else 18, off=(0.15, 0.85),
                      name='riprap_%d' % int(px), mid=dressed if dressed != 'ashlar_limestone' else 'ashlar_limestone')
for side in (-1, 1):
    xe = side * tot / 2
    for s in (-1, 1):
        W.decal('lichen', (xe + side * 1.2, s * (width / 2 + 0.02), D.z(xe) - 1.6), (0, s, 0), 2.4, 1.6, alpha=0.5)
        W.decal('moss_patch', (xe - side * 0.14, s * (width / 2 + 1.6), water + 0.7), (-side, 0, 0), 2.2, 1.0, alpha=0.6)
for px in piers:
    for s in (-1, 1):
        W.decal('moss_patch', (px + r.uniform(-0.4, 0.4), s * (width / 2 + 0.03), water + 0.9), (0, s, 0), pier_w * 0.6, 0.8, alpha=0.55)
for xc, sp, spz, rise in arches:              # (r4: haunch streak decals dropped - read as smudges at the pier heads)
    for s in (-1, 1):
        W.decal('damp_base', (xc - sp / 2 - 0.5, s * (width / 2 + 0.002), spz + 0.5), (0, s, 0), 1.0, 1.0, alpha=0.35)
        if base == 'bridge_stone_arch3_b':             # repointing patch (efflorescence is a soft vertex-colour bloom, r4)
            F2.face_decal('stain_blotch', xc + r.uniform(-1, 1), s * width / 2, D.z(xc) - 0.6, 1.8, 0.8, alpha=0.5)
# ---- water obstacles (piers at the waterline incl. cutwaters, abutment faces)
for px in piers:
    BL.water_obstacle(BL.pier_outline(px, pier_w + 0.7, width + 0.7), 'pier', 0.8, block=None)
for side in (-1, 1):
    xe = side * tot / 2
    BL.water_obstacle([(xe, -width / 2 - 1), (xe + side * 1.2, -width / 2 - 1), (xe + side * 1.2, width / 2 + 1), (xe, width / 2 + 1)],
                      'abutment', 0.5, block=None)
BL.bmeta()['kind'] = 'stone_arch'
BL.bmeta()['destructible'] = True
C.anchor('demolition', (0 if len(piers) % 2 == 0 and len(piers) else (piers[len(piers) // 2] if piers else 0), 0, D.z(0) + 0.1), kind='charge_marker')
# ---- blown variant: the central span is demolished, stumps of the arch, rubble dam in the river
if destroyed:
    xc, sp, spz, rise = arches[len(arches) // 2]
    poly = F.breach_outline(xc, sp * 0.4, sp * 0.2, D.z(xc) + 2.5, spz + rise - 1.1, seed=seed)
    F.breach(poly, width, fill_mid=body, fill_tint=(0.52, 0.45, 0.37))
    F2.fix_fracture(body)
    F2.ragged_edge(poly, width, dressed, body, xc=xc, z_ring=spz + rise)
    F.debris_pile(xc, 0.4, sp * 0.42, width / 2 + 2.2, bed + 0.5, water + 1.7, mids=(dressed, body), n=190,
                  name='rubble_river', slabs=4, slab_mid=body, fan=1.9, setts=30, bonded=5,
                  lobes=[(xc - sp * 0.3, -0.3, 0.95), (xc + sp * 0.27, 0.6, 0.82), (xc + sp * 0.02, 1.8, 0.62)])
    for s_ in (-1, 1):                     # blocks spilled onto the deck stumps
        F.debris_pile(xc + s_ * sp * 0.47, s_ * 0.8, 1.3, 1.6, D.z(xc) - 0.05, D.z(xc) + 0.35, mids=(dressed, body), n=9,
                      name='rubble_deck_%d' % (s_ + 1), slabs=0, bonded=0, mound=False, lobes=[(xc + s_ * sp * 0.47, s_ * 0.8, 1.0)])
    gap = [xc - sp * 0.45, xc + sp * 0.45]
    BL.bmeta().update({'destroyed': True, 'gap_x': gap})
    C.A.meta['footprints'] = [f for f in C.A.meta['footprints'] if f.get('kind') != 'bridge_deck']
    for xa, xb in ((B['x0'] - 3.5, gap[0]), (gap[1], B['x1'] + 3.5)):
        C.footprint([(xa, -width / 2 + 0.45), (xb, -width / 2 + 0.45), (xb, width / 2 - 0.45), (xa, width / 2 - 0.45)], 'NONE', 'bridge_deck')
    C.footprint([(gap[0], -width / 2), (gap[1], -width / 2), (gap[1], width / 2), (gap[0], width / 2)], 'HIGH', 'bridge_gap')
if snow:
    caps = [o for o in C.A.parts if o.get('kit_node', 'main') == 'main' and
            (o.name.startswith(('band', 'cutwater', 'lamp', 'wing_cop', 'voussoirs_archivolt')) or (o.name.startswith('parapet') and o.name.endswith('coping')))
            and not o.name.startswith('lamp_glass')]
    F2.pillow(F.snow_caps(caps, thick=0.12, min_nz=0.45))
    F.RUT_WANDER, F.RUT_COL, F.TRODDEN = 0.12, (0.5, 0.47, 0.42), 0.8
    F.road_snow(lambda x: D.z(x), B['x0'] - APPR, B['x1'] + APPR, width - 0.9, ruts=(-2.0, -0.62, 0.62, 2.0), rut_w=0.3, base=0.09,
                drift=0.3, step=1.1)
    for px in piers:
        F2.ice_col(F.ice_shelf(BL.pier_outline(px, pier_w + 0.4, width + 0.3), water, reach=(0.7, 2.2), thick=0.28, name='ice_%d' % int(px)))
    for side in (-1, 1):
        xe = side * tot / 2
        xf = xe - side * (0.12 + 0.11 * (water - bed) + 0.6)
        F2.ice_col(F.ice_shelf([(xf, -width / 2 - 5.5), (xf - side * 0.01, 0), (xf, width / 2 + 5.5), (xf + side * 0.5, 0)], water,
                    reach=(0.9, 2.4), thick=0.26, name='ice_bank_%d' % side, floes=4 if side > 0 else 3,
                    bounds=(-tot / 2 + 2, -width / 2 - 14, tot / 2 - 2, width / 2 + 14)))
    ic = []
    for xc, sp, spz, rise in arches:
        for s_ in (-1, 1):
            for k in range(5):
                x = xc + (k - 2) * sp / 7
                ic.append((x, s_ * (width / 2 + 0.08), D.z(x) - 0.47))
    F.icicles(ic, (0.15, 0.55))
if theater == 'desert':                     # sun-and-sand eroded arrises on the dressed stone
    F.erode_arris([o for o in C.A.parts if o.name.startswith('parapet') and o.name.endswith('coping')])
    F.erode_arris([o for o in C.A.parts if o.name.startswith('abut_quoins')], off=0.04)
# ---- weathering (vertex colour): tide mark, algae, lichen, run-off, patches, soot / desert bleaching + dust
WX = {'bridge_stone_arch5_a': dict(patches=0.14), 'bridge_stone_arch3_b': dict(patches=0.12, lichen=0.25),
      'bridge_stone_arch1_b': dict(lichen=0, moss=0), 'bridge_stone_arch1_a': dict(lichen=0.8)}
soot = ((arches[len(arches) // 2][0], 0, D.z(0) - 1.2), arches[len(arches) // 2][1] * 0.7, 1) if destroyed else None
# ---- approach: kerbs over the ramps, embankments with earth fill against the wings, ramp parapets
for ka, kb in (((B['x0'] - APPR, gap[0] + 0.3), (gap[1] - 0.3, B['x1'] + APPR)) if destroyed else ((B['x0'] - APPR, B['x1'] + APPR),)):
    F2.kerbs(D, ka, kb, width - 0.9, mid='ashlar_limestone' if theater == 'desert' else 'granite', name='road_kerbs_%d' % int(ka))
emb = {'desert': 'sand', 'snow': 'snow_soft'}.get('snow' if snow else theater, 'sod')
wl = 6.0 if len(spans) > 1 else 4.5
ph = 0.95 if len(spans) > 1 else 0.85
for side in (-1, 1):
    F2.embankment(D, tot, width, wl, ph, side, mid=emb, cell=1.1 if big5 else 0.8)
    if not big5:
        F2.ramp_walls(D, width, B['x1'] + 0.75, side, mid=body, coping=coping)
F2.strip_bottoms(('parapet_', 'wing_cop', 'rampwall_cop'))
WX = {'bridge_stone_arch5_a': dict(patches=0.14), 'bridge_stone_arch3_b': dict(patches=0.16, lichen=0.25),
      'bridge_stone_arch1_b': dict(lichen=0, moss=0, patches=0.18), 'bridge_stone_arch1_a': dict(lichen=0.8, patches=0.1),
      'bridge_stone_arch3_a': dict(patches=0.1)}
from mathutils import noise as _N, Vector as _V


def _bloom(p, n, c):
    """arch3_b: soft salt bloom on the brick spandrels - hazy, low-contrast, strongest under the string course and
    over the arch haunches, fading downward (replaces the hard white efflorescence decals)."""
    if abs(n.y) < 0.5 or p.z < water + 1.0:
        return c
    dz = D.z(p.x) - 0.7 - p.z
    if dz < 0:
        return c
    k = max(0.0, _N.noise(_V((p.x * 0.42, p.y * 0.1, p.z * 0.9))) + 0.15) * max(0.0, 1 - dz / 3.0)
    return c.lerp(_V((0.84, 0.81, 0.76)) * (sum(c) / 3 + 0.35), min(0.32, 0.5 * k))


F.weather(extra=_bloom if base == 'bridge_stone_arch3_b' else None, theme=theater, deck=D, soot=soot, step=3.2 if len(arches) > 3 else (1.3 if base == 'bridge_stone_arch3_b' else (2.6 if snow else 1.9)),
          skip=('decal', 'snow', 'lamp', 'cutwater', 'voussoirs_soffit', 'embank', 'breach_blocks'), **WX.get(base, {}))
F.weather(parts=[o for o in C.A.parts if o.name.startswith('voussoirs_soffit')], theme=theater, deck=None, soot=soot, base=1.0,
          step=2.2, lichen=0.2, moss=0.2, extra=lambda p, n, c: c / 0.78 if n.z < -0.35 else c)
F2.cull_decals()
xw = -tot / 2
C.A.meta['review'] = {'detail': {'target': [round(xw + 2.2, 2), round(water + 2.4, 2), round(width / 2, 2)],
                                 'dir': [0.12, 0.45, 0.88], 'dist': 17.0 if len(arches) > 1 else 14.0}}
F2.trim_to(24400, ('road_kerbs', 'parapet_-1_coping', 'parapet_1_coping', 'snow_caps', 'wing_', 'rubble_', 'bridge_body', 'embank', 'riprap_', 'breach_blocks', 'rampwall'))
K.finalize(OUT, ao_res=1024, ao_samples=64, lods=((0.45, 0.30, 3.0), (0.3, 0.9, 3.0)))
