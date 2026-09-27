# export_raw.py: helper + CLI to export a .blend's rig+meshes as a raw GLB (MH game_engine rig) for tools/rebind.py
import bpy, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

def export_raw(path, imgfmt='JPEG'):
    for o in bpy.data.objects:
        o.select_set(o.type in ('MESH', 'ARMATURE') and not o.hide_get() and not o.hide_render)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_animations=False, export_skins=True, export_morph=False, export_yup=True,
        export_image_format=imgfmt, export_jpeg_quality=88, export_texcoords=True, export_normals=True,
        export_tangents=False, export_def_bones=True, export_extras=True, export_attributes=True)
    log('EXPORTED', path, os.path.getsize(path))

if __name__ == '__main__' and args():
    bpy.ops.wm.open_mainfile(filepath=args()[0])
    export_raw(args()[1])
