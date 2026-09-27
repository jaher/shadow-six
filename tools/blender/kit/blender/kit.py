"""SHADOW SIX building kit - single import for asset scripts:
    import sys; sys.path.insert(0, '<kit>/blender'); import kit as K
See ../README.md for the API. Modules: kit_core (parts/materials/UV/grime/meta), kit_arch (walls/openings/windows/doors),
kit_roof (roofs/eaves/chimneys), kit_detail (trims/stairs/balconies/signs), kit_weather (decals/snow/ruin),
kit_bridge (bridge parts), kit_export (AO bake, LOD, GLB, sidecar)."""
import os, sys, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'tools'))
_mods = ['kit_core', 'kit_arch', 'kit_roof', 'kit_detail', 'kit_weather', 'kit_bridge', 'kit_export']
for _m in _mods:
    if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), _m + '.py')):
        _mod = importlib.import_module(_m)
        for _k in dir(_mod):
            if not _k.startswith('_') and _k not in ('bpy', 'bmesh', 'math', 'os', 'json', 'random', 'sys', 'time'):
                globals()[_k] = getattr(_mod, _k)


def A():
    import kit_core
    return kit_core.A
