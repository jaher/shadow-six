# build_animal.py - build one e03 circus animal GLB.
# usage: blender -b --python-exit-code 1 -P tools/characters/animals/build_animal.py -- <species> <id> <out_dir> <seed> [--preview]
#   species: lion | lioness | ostrich_cock | ostrich_hen | hen_brown | hen_white
import sys, os, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import animal_lib as A

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
species, did, out_dir, seed = argv[0], argv[1], os.path.abspath(argv[2]), int(argv[3])
preview = '--preview' in argv
os.makedirs(out_dir, exist_ok=True)
T0 = time.time()
A.clean_scene()
rnd = random.Random(seed)

if species in ('lion', 'lioness'):
    import lion as L
    fem = species == 'lioness'
    J, s, body, parts, mane, rig = L.build(fem, seed)
    body_col, mane_col, parts_col = L.colours(fem, s, J, rnd)
    A.paint(body, body_col); A.paint(parts, parts_col)
    objs = [body, parts]
    if mane:
        A.paint(mane, mane_col); objs.append(mane)
    o = A.join(objs, 'lion')
    budget = 5200 if not fem else 4200
    if A.tri_count(o) > budget:
        A.activate(o)
        d = o.modifiers.new('dec', 'DECIMATE'); d.ratio = budget / A.tri_count(o)
        bpy.ops.object.modifier_move_to_index(modifier='dec', index=0)
        bpy.ops.object.modifier_apply(modifier='dec')
    A.log('lion tris', A.tri_count(o), round(time.time() - T0, 1), 's')
    if preview:
        A.render_preview([o], os.path.join(out_dir, did + '-pre'), dist=4.2, target=(0, 0, 0.7))
    A.bake(o, out_dir, did, scale=(180, 55, 180), size=512, rough=0.86, sheen=0.4)
    meta = L.clips(rig, s)
    A.export(o, rig, out_dir, did, 'lion', meta, {'seed': seed, 'species': species}, lods=(1900, 700),
             extra={'withers_m': round(1.0 * s, 2), 'sex': 'female' if fem else 'male'})
elif species.startswith('ostrich') or species.startswith('hen'):
    import bird as B
    J, s, o, rig, meta, var = B.build_species(species, seed, did, out_dir, preview)
else:
    raise SystemExit('unknown species ' + species)
if preview:
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    dist, tz = {'lion': (4.2, 0.7), 'ostrich': (6.0, 1.15), 'hen': (1.2, 0.2)}[species.split('_')[0].replace('lioness', 'lion')]
    A.render_preview([o], os.path.join(out_dir, did + '-post'), dist=dist, target=(0, 0, tz))
A.log('DONE', did, round(time.time() - T0, 1), 's')
