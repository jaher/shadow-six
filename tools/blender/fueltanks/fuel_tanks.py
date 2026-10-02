"""Fuel-tank family builder (docs/fuel-tanks.md). One asset per run:
  blender -b --factory-startup --python-use-system-env --python fuel_tanks.py -- <outroot> <asset> [intact|destroyed] [seed] [snow]
writes <outroot>/<name>/<name>{,_lod1,_lod2}.glb + .kit.json + .credits.json (name gets _destroyed / _snow suffixes).
Assets: fuel_tank_h_cradle(_m) (M2 snow / temperate), fuel_tank_farm_9x7, fuel_tank_farm_85x63 (M8 desert),
fuel_tank_quay_12, fuel_tank_quay_11 (M13 coast), oil_tank_column(_b) (M11 desert), fuel_tank_vertical_t (round temperate), fuel_tank_elevated (M17)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ft

out, asset, dest, seed, snow = ft.argv()


def odir(name):
    n = name + ('_destroyed' if dest else '') + ('_snow' if snow else '')
    return os.path.join(out, n)


if asset in ('fuel_tank_h_cradle', 'fuel_tank_h_cradle_m'):
    import t_cradle
    m = asset.endswith('_m')
    t_cradle.build(odir(asset), dest, seed, snow, mirror=m, theater='temperate')
elif asset.startswith('fuel_tank_farm'):
    import t_farm
    t_farm.build(odir(asset), asset, dest, seed)
elif asset.startswith('fuel_tank_quay'):
    import t_quay
    t_quay.build(odir(asset), asset, dest, seed)
elif asset.startswith('oil_tank_column') or asset == 'fuel_tank_vertical_t':
    import t_column
    t_column.build(odir(asset), asset, dest, seed)
elif asset == 'fuel_tank_elevated':
    import t_elevated
    t_elevated.build(odir(asset), asset, dest, seed)
else:
    raise SystemExit('unknown asset ' + asset)
