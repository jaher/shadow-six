"""reopt.py <asset_dir> <name> : re-run the (quantize + meshopt) pass on an already built asset's LOD GLBs that are
over nav.MESHOPT_LIMIT or already meshopt-compressed; refresh the sidecar lods[] bytes/compression."""
import sys, os, json, subprocess, shutil
D = os.path.dirname(os.path.abspath(__file__))
d, name = sys.argv[1:3]
f = os.path.join(d, name + '.kit.json')
m = json.load(open(f))
for L in m['lods']:
    p = os.path.join(d, L['file'])
    if os.path.getsize(p) <= 1.8e6 and not L.get('compression'):
        continue
    tmp = p + '.mo.glb'
    subprocess.run(['node', os.path.join(D, 'mo_keepuri.mjs'), p, tmp], check=True, cwd=D)
    subprocess.run(['python3', os.path.join(D, 'mo_fix.py'), p, tmp], check=True)
    os.replace(tmp, p)
    L['compression'] = 'KHR_mesh_quantization (NORMAL int8, TEXCOORD uint16) + EXT_meshopt_compression'
    L['bytes'] = os.path.getsize(p)
    print(L['file'], L['bytes'])
json.dump(m, open(f, 'w'), indent=1)
