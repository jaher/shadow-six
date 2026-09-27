# guest_outfits.py - guests build group outfits (bible §6): RAF drill (McRae), linen civilian (Informer),
# long overcoat (Gilbert), French civilian prisoners (work jacket / farm / clerk / old man), British officer SD (Colonel),
# tram driver. Wraps outfits.build_outfit; unknown names fall through to the original presets.
import outfits as OF
import uniform as U
import materials as MT
from uniform import lin

_orig = OF.build_outfit


def _c(o, k, d):
    return lin(o.get(k, d))


def _jacket(ctx, L, o, key, default, hem='hip', kind='wool', contrast=1.0, v=(0.018, 0.36, 0.0), ease=0.013, dirt=0.2, target=2000, collar='none', flare=0.004):
    L.append(U.top(ctx, 'outfit_tunic', MT.fabric(key, _c(o, key, default), kind=kind, contrast=contrast, dirt=dirt), hem=hem, sleeves=o.get('sleeves', 'long'),
                   collar=collar, open_v=True, v_w=v[0], v_slope=v[1], v_z=v[2], ease=ease, target=target, flare=flare))


def _shirt(ctx, L, o, outer_v, default=(0.78, 0.76, 0.68), collar='none', dirt=0.25, kind='canvas'):
    L.append(U.top(ctx, 'outfit_shirt', MT.fabric('shirt', _c(o, 'shirt', default), kind=kind, dirt=dirt), hem='waist', sleeves='none', collar=collar,
                   ease=0.003, inset_v=0.012, outer_v=outer_v, target=700 if collar != 'none' else 400, collar_dz=-0.02))


def _trousers(ctx, L, o, default, bottom='shoe', kind='wool', ease=0.018, dirt=0.3, target=1100):
    L.append(U.legs(ctx, 'outfit_trousers', MT.fabric('trousers', _c(o, 'trousers', default), kind=kind, dirt=dirt), bottom=bottom, ease=ease, target=target))


def _shoes(ctx, L, o, default=(0.20, 0.12, 0.07), style='shoe', rough=0.5):
    L.append(U.boots(ctx, 'outfit_boots', MT.leather('shoes', _c(o, 'boots', default), rough=rough), style=style))


def build_outfit(ctx, name, opts):
    o = opts or {}
    L = []
    if name == 'raf_drill':      # McRae: khaki drill shirt (open neck, sleeves rolled), shorts or slacks, desert boots
        L.append(U.top(ctx, 'outfit_tunic', MT.fabric('drill', _c(o, 'tunic', (0.66, 0.57, 0.40)), kind='canvas', dirt=0.35, contrast=0.8),
                       hem='hip', sleeves='rolled' if o.get('rolled', True) else 'long', collar='none', open_v=True, v_w=0.010, v_slope=0.30, v_z=0.07, ease=0.012, target=1500))
        if o.get('shorts'):
            _trousers(ctx, L, o, (0.62, 0.54, 0.38), bottom='shorts', kind='canvas', ease=0.02, target=700)
            L.append(U.gaiters(ctx, 'outfit_gaiters', MT.fabric('hose', _c(o, 'hose', (0.60, 0.53, 0.38)), kind='wool')))   # hose tops
        else:
            _trousers(ctx, L, o, (0.62, 0.54, 0.38), bottom='ankle', kind='canvas')
        _shoes(ctx, L, o, (0.46, 0.34, 0.22), style='ankle', rough=0.85)   # suede desert boots
    elif name == 'civ_linen':    # Informer: crumpled light linen jacket, collarless shirt, loose trousers, worn shoes
        JV = (0.009, 0.30, 0.0)
        _shirt(ctx, L, o, JV, default=(0.84, 0.82, 0.74), collar='none')
        _jacket(ctx, L, o, 'tunic', (0.74, 0.69, 0.57), kind='canvas', contrast=0.9, v=JV, ease=0.016, dirt=0.35)
        _trousers(ctx, L, o, (0.40, 0.36, 0.30), ease=0.024)
        _shoes(ctx, L, o, (0.24, 0.15, 0.09))
    elif name == 'civ_overcoat':  # Gilbert: long dark wool overcoat to the knee, wide torn lapels, no tie
        CV = (0.008, 0.30, -0.01)
        _shirt(ctx, L, o, CV, default=(0.66, 0.64, 0.58), dirt=0.45)
        _jacket(ctx, L, o, 'tunic', (0.16, 0.16, 0.18), hem='knee', v=CV, ease=0.022, dirt=0.3, target=2400, flare=0.02)
        _trousers(ctx, L, o, (0.22, 0.21, 0.21))
        _shoes(ctx, L, o, (0.10, 0.08, 0.06))
    elif name in ('civ_work', 'civ_farm', 'civ_clerk', 'civ_jacket'):
        # French civilian prisoners (bible §6.3): browns, dark blues, greys, desaturated
        if name == 'civ_work':        # bleu de travail: blue cotton work jacket buttoned high, work trousers, boots
            JV = (0.012, 0.3, 0.07)
            _shirt(ctx, L, o, JV, default=(0.55, 0.52, 0.46))
            _jacket(ctx, L, o, 'tunic', (0.20, 0.26, 0.38), kind='canvas', contrast=0.9, v=JV, ease=0.016, dirt=0.4)
            _trousers(ctx, L, o, (0.19, 0.23, 0.32), kind='canvas', bottom='ankle')
            _shoes(ctx, L, o, (0.16, 0.11, 0.07), style='ankle')
        elif name == 'civ_farm':      # farmhand: collarless shirt, sleeves rolled, corduroy waistcoat, heavy boots
            WV = (0.012, 0.25, 0.05)
            L.append(U.top(ctx, 'outfit_shirt', MT.fabric('shirt', _c(o, 'shirt', (0.70, 0.66, 0.56)), kind='canvas', dirt=0.45), hem='hip', sleeves='rolled', collar='none', ease=0.008, target=1600))
            L.append(U.top(ctx, 'outfit_tunic', MT.fabric('waistcoat', _c(o, 'tunic', (0.33, 0.26, 0.19)), kind='wool', contrast=1.2, dirt=0.4), hem='waist', sleeves='none',
                           collar='none', open_v=True, v_w=WV[0], v_slope=WV[1], v_z=WV[2], ease=0.014, target=700))
            _trousers(ctx, L, o, (0.30, 0.25, 0.19), bottom='ankle', dirt=0.5)
            _shoes(ctx, L, o, (0.18, 0.12, 0.07), style='ankle', rough=0.8)
        else:                         # clerk / old man: town jacket over shirt (tie optional via kit)
            JV = (0.008, 0.30, 0.02)
            _shirt(ctx, L, o, JV, default=(0.74, 0.73, 0.68))
            _jacket(ctx, L, o, 'tunic', (0.30, 0.30, 0.31) if name == 'civ_clerk' else (0.30, 0.25, 0.19), v=JV, contrast=1.3, dirt=0.35)
            _trousers(ctx, L, o, (0.26, 0.25, 0.25))
            _shoes(ctx, L, o, (0.12, 0.09, 0.07))
    elif name == 'british_sd':   # British officer service dress: khaki SD jacket, shirt + tie, trousers, shoes (Colonel)
        JV = (0.008, 0.28, 0.03)
        _shirt(ctx, L, o, JV, default=(0.60, 0.53, 0.38), collar='stand', dirt=0.02)
        _jacket(ctx, L, o, 'tunic', (0.47, 0.40, 0.27), v=JV, contrast=0.8, dirt=0.05)
        _trousers(ctx, L, o, (0.45, 0.38, 0.26), dirt=0.05)
        _shoes(ctx, L, o, (0.14, 0.08, 0.05), rough=0.3)
    elif name == 'tram_uniform':  # M15 civilian tram driver: dark blue serge jacket buttoned to the neck, trousers
        JV = (0.008, 0.22, 0.09)
        _shirt(ctx, L, o, JV, default=(0.72, 0.72, 0.70))
        _jacket(ctx, L, o, 'tunic', (0.12, 0.14, 0.22), v=JV, contrast=0.9, dirt=0.15)
        _trousers(ctx, L, o, (0.12, 0.14, 0.22))
        _shoes(ctx, L, o, (0.06, 0.05, 0.05))
    else:
        return _orig(ctx, name, opts)
    return L


OF.build_outfit = build_outfit
