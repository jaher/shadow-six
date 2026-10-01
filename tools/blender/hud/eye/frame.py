# frame.py - the eye tool's brass porthole (tools/blender/icons/models/hudtools.porthole), rendered without its eye in
# three passes per icon class so compose.py can mount any eye frame behind the glass:
#   <id>.frame  porthole with an open window (glass dome and eye plate not seen by the camera)
#   <id>.glass  the porthole with a black plate: the dome's reflections over black (added over the eye)
#   <id>.mask   the plate alone in white, everything else held out (the visible window, antialiased)
#   blender -b --factory-startup -P tools/blender/hud/eye/frame.py        (ICON_SCRATCH as for the icon studio)
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ICONS = os.path.normpath(os.path.join(HERE, '..', '..', 'icons'))
sys.path[:0] = [ICONS, os.path.join(ICONS, 'models')]
import bpy, studio as S, mdl as D
import hudtools as H
from mathutils import Vector

SHOTS = (('tool', (52, 41), 12), ('cursor', (32, 26), 8))     # (class, ref box, master scale): the tool master is 12x for 6x tiers


def plate(name, img_path, rx, ry, z):
    bpy.ops.mesh.primitive_circle_add(vertices=192, radius=1.0, fill_type='TRIFAN')
    o = bpy.context.active_object; o.name = name
    for v in o.data.vertices: v.co = Vector((v.co.x * rx, 0.0, v.co.y * ry))
    o.location = (0, z, 0)
    return o


def emit(name, color, strength=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new('ShaderNodeEmission'); e.inputs['Color'].default_value = (*color, 1); e.inputs['Strength'].default_value = strength
    o = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(e.outputs[0], o.inputs['Surface'])
    return m


def holdout():
    m = bpy.data.materials.new('hold'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    h = nt.nodes.new('ShaderNodeHoldout'); o = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(h.outputs[0], o.inputs['Surface'])
    return m


def build():
    S.reset()
    H.eye_disc = plate                                  # porthole() mounts our bare plate instead of the eye picture
    D.group('porthole', H.porthole(''))
    disc = bpy.data.objects['eyeimg']; dome = bpy.data.objects['dome']
    return disc, dome


def main():
    for cls, box, scale in SHOTS:
        for pas in ('frame', 'glass', 'mask'):
            disc, dome = build()
            if pas == 'frame':
                disc.visible_camera = dome.visible_camera = False
                disc.visible_glossy = disc.visible_diffuse = disc.visible_shadow = False
            elif pas == 'glass':
                disc.data.materials.append(emit('black', (0, 0, 0), 0.0))
            else:
                ho = holdout()
                for o in bpy.context.scene.objects:
                    if o.type == 'MESH' and o is not disc:
                        o.data.materials.clear(); o.data.materials.append(ho)
                dome.visible_camera = False
                disc.data.materials.append(emit('white', (1, 1, 1), 1.0))
                bpy.context.scene.view_settings.view_transform = 'Standard'   # the mask is its alpha; keep white white
            S.shoot(f'eyeframe.{cls}.{pas}', 'raw', box=box, preset='front', elev=5, azim=-6, margin=0.02, shadow=False,
                    scale=scale, samples=64 if pas == 'mask' else None, extra={'for': cls})


if __name__ == '__main__':
    main()
