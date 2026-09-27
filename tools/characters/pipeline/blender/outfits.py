# outfits.py - outfit presets (bible §1, §5.3; realism-pipeline §2.2). Colours are sRGB 0..1 (converted to linear).
# Each preset: list of (builder, kwargs). spec['outfit_opts'] overrides colours: tunic/trousers/boots/camo/...
import uniform as U
import materials as MT

C = {
    'feldgrau_m40': (0.45, 0.46, 0.39), 'feldgrau_m36': (0.47, 0.49, 0.43), 'stone_grey': (0.42, 0.43, 0.41),
    'bottle_green': (0.14, 0.20, 0.15), 'dak_olive': (0.55, 0.50, 0.33), 'dak_sand': (0.72, 0.64, 0.46),
    'snow_white': (0.86, 0.87, 0.85), 'british_khaki': (0.45, 0.40, 0.27), 'olive_drab': (0.30, 0.31, 0.20),
    'black_leather': (0.035, 0.03, 0.028), 'brown_leather': (0.22, 0.12, 0.06), 'webbing_khaki': (0.52, 0.47, 0.32),
    'rubber_black': (0.05, 0.05, 0.055), 'tweed_brown': (0.36, 0.28, 0.20), 'shirt_grey': (0.62, 0.62, 0.56),
    'panzer_black': (0.07, 0.07, 0.075), 'officer_grey': (0.40, 0.42, 0.38), 'jersey_navy': (0.10, 0.11, 0.14),
}


def _c(opts, key, default):
    return U.lin(opts.get(key, C[default] if isinstance(default, str) else default))


def build_outfit(ctx, name, opts):
    L = []
    o = opts
    if name in ('heer_m40', 'heer_m36', 'dak', 'winter_smock', 'panzer'):
        tun = {'heer_m40': 'feldgrau_m40', 'heer_m36': 'feldgrau_m36', 'dak': 'dak_olive', 'winter_smock': 'feldgrau_m40', 'panzer': 'panzer_black'}[name]
        kind = 'canvas' if name == 'dak' else 'wool'
        mt = MT.fabric('tunic', _c(o, 'tunic', tun), kind=kind, rough=0.9)
        mtr = MT.fabric('trousers', _c(o, 'trousers', 'stone_grey' if name == 'heer_m36' else tun), kind=kind, rough=0.9)
        shorts = name == 'dak' and o.get('shorts')
        L.append(U.top(ctx, 'outfit_tunic', mt, hem='hip' if name != 'panzer' else 'waist', sleeves='rolled' if o.get('rolled') else 'long', collar='stand'))
        bottom = 'shorts' if shorts else ('lace_high' if name == 'dak' else ('ankle' if name == 'panzer' else 'boot'))
        L.append(U.legs(ctx, 'outfit_trousers', mtr, bottom=bottom))
        if name == 'dak':
            L.append(U.boots(ctx, 'outfit_boots', MT.leather('boots', _c(o, 'boots', 'brown_leather'), rough=0.6), style='lace_high'))
        elif name == 'panzer':
            L.append(U.boots(ctx, 'outfit_boots', MT.leather('boots', _c(o, 'boots', 'black_leather')), style='ankle'))
        else:
            L.append(U.boots(ctx, 'outfit_boots', MT.leather('boots', _c(o, 'boots', 'black_leather'), rough=0.38), style='jack'))
        if name == 'winter_smock':   # white reversible smock over the field grey, to mid-thigh with loose ease
            L.append(U.top(ctx, 'outfit_smock', MT.fabric('smock', _c(o, 'smock', 'snow_white'), kind='canvas', rough=0.95, dirt=0.25),
                           hem='thigh', sleeves='long', collar='hood', ease=0.024, flare=0.03))
    elif name == 'officer_heer':
        mt = MT.fabric('tunic', _c(o, 'tunic', 'officer_grey'), kind='wool', rough=0.8)
        L.append(U.top(ctx, 'outfit_shirt', MT.fabric('shirt', _c(o, 'shirt', 'shirt_grey'), kind='canvas', rough=0.8), hem='waist', sleeves='none', collar='stand', ease=0.005))
        L.append(U.top(ctx, 'outfit_tunic', mt, hem='hip', sleeves='long', collar='none', open_v=True))
        L.append(U.legs(ctx, 'outfit_trousers', MT.fabric('breeches', _c(o, 'trousers', 'stone_grey'), kind='wool'), bottom='riding', style='breeches'))
        L.append(U.boots(ctx, 'outfit_boots', MT.leather('boots', _c(o, 'boots', 'black_leather'), rough=0.28), style='riding'))
    elif name in ('british_bd', 'british_smock', 'commando_sleeveless', 'commando_jumper'):
        trous = MT.fabric('trousers', _c(o, 'trousers', 'british_khaki' if name != 'commando_sleeveless' else 'olive_drab'), kind='wool')
        if name == 'british_bd':
            L.append(U.top(ctx, 'outfit_tunic', MT.fabric('bd', _c(o, 'tunic', 'british_khaki'), kind='wool'), hem='waist', sleeves='long', collar='stand'))
        elif name == 'british_smock':
            camo = [U.lin(c) for c in o.get('camo_cols', [(0.40, 0.36, 0.22), (0.22, 0.25, 0.15), (0.30, 0.20, 0.13)])]
            L.append(U.top(ctx, 'outfit_tunic', MT.fabric('smock', _c(o, 'tunic', (0.55, 0.50, 0.36)), kind='canvas', camo=camo), hem='thigh', sleeves='long', collar='stand', ease=0.016))
        elif name == 'commando_sleeveless':
            camo = [U.lin(c) for c in o.get('camo_cols', [(0.22, 0.26, 0.15), (0.34, 0.28, 0.17), (0.10, 0.12, 0.08)])]
            L.append(U.top(ctx, 'outfit_tunic', MT.fabric('camo_top', _c(o, 'tunic', (0.30, 0.34, 0.20)), kind='canvas', camo=camo, rough=0.9), hem='waist', sleeves='none', collar='roll', ease=0.008, flare=0.006))
        else:
            L.append(U.top(ctx, 'outfit_tunic', MT.fabric('jumper', _c(o, 'tunic', 'jersey_navy'), kind='wool', rough=1.0), hem='waist', sleeves='long', collar='roll', ease=0.012))
        L.append(U.legs(ctx, 'outfit_trousers', trous, bottom='gaiter', top_z=ctx.m['belt_z'] + 0.03))
        L.append(U.gaiters(ctx, 'outfit_gaiters', MT.fabric('gaiters', _c(o, 'gaiters', 'webbing_khaki'), kind='canvas')))
        L.append(U.boots(ctx, 'outfit_boots', MT.leather('boots', _c(o, 'boots', 'black_leather'), rough=0.55), style='ankle'))
    elif name == 'wetsuit':
        L.append(U.fullsuit(ctx, 'outfit_suit', MT.fabric('rubber', _c(o, 'suit', 'rubber_black'), kind='rubber', rough=0.35, dirt=0.0, contrast=0.4)))
        L.append(U.boots(ctx, 'outfit_boots', MT.solid('fins', U.lin((0.06, 0.06, 0.065)), rough=0.4), style='flippers'))
    elif name == 'civilian_tweed':
        L.append(U.top(ctx, 'outfit_shirt', MT.fabric('shirt', _c(o, 'shirt', (0.80, 0.78, 0.72)), kind='canvas'), hem='waist', sleeves='none', collar='stand', ease=0.005))
        L.append(U.top(ctx, 'outfit_tunic', MT.fabric('tweed', _c(o, 'tunic', 'tweed_brown'), kind='wool', contrast=1.2), hem='hip', sleeves='long', collar='none', open_v=True, ease=0.012))
        L.append(U.legs(ctx, 'outfit_trousers', MT.fabric('trousers', _c(o, 'trousers', (0.30, 0.26, 0.22)), kind='wool'), bottom='shoe'))
        L.append(U.boots(ctx, 'outfit_boots', MT.leather('shoes', _c(o, 'boots', 'brown_leather'), rough=0.35), style='shoe'))
    else:
        raise ValueError('unknown outfit ' + name)
    return L
