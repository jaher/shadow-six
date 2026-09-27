"""Run kit tools/build_lib.build() for the given ids, then merge ONLY those entries into lib/materials.json
(re-read from disk right before writing, so concurrent workflows adding other materials are not clobbered)."""
import sys, json, importlib.util
KIT = '<claude-tmp>'
spec = importlib.util.spec_from_file_location('build_lib', KIT + '/tools/build_lib.py')
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
ids = sys.argv[1:]
for mid in ids:
    B.build(mid, B.cfg[mid])
mj = json.load(open(B.mj_path))
for mid in ids:
    mj['materials'][mid] = B.MJ['materials'][mid]
json.dump(mj, open(B.mj_path, 'w'), indent=1)
print('merged', ids, 'total', len(mj['materials']))
