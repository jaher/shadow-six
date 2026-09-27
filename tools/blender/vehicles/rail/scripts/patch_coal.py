# patch_coal.py glb... -> apply the current rail:coal material values (rework 2) to already-built GLBs
import sys, os
sys.path.insert(0, '<claude-tmp>')
import glb_post
for p in sys.argv[1:]:
    js, b = glb_post.read_glb(p)
    n = 0
    for mt in js.get('materials', []):
        if mt.get('name') == 'rail:coal':
            pb = mt['pbrMetallicRoughness']
            pb['baseColorFactor'] = [0.2, 0.2, 0.21, 1]; pb['roughnessFactor'] = 0.72
            mt.setdefault('extensions', {})['KHR_materials_specular'] = {'specularFactor': 0.5}; n += 1
    if n:
        glb_post.write_glb(p, js, b)
    print(os.path.basename(p), n)
