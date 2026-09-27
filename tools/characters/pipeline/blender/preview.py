# preview.py - quick in-Blender renders (EEVEE, orthographic) for iteration: full body views + head close-ups.
import bpy, math
from mathutils import Vector
from common import *


def setup(engine='BLENDER_EEVEE_NEXT', res=(512, 768)):
    sc = bpy.context.scene
    sc.render.engine = engine
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    if engine.startswith('BLENDER_EEVEE'):
        sc.eevee.taa_render_samples = 16
    w = bpy.data.worlds.get('pv') or bpy.data.worlds.new('pv')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.35, 0.36, 0.38, 1); bg.inputs['Strength'].default_value = 0.6
    sc.world = w
    if 'pv_sun' not in bpy.data.objects:
        l = bpy.data.lights.new('pv_sun', 'SUN'); l.energy = 3.5; l.angle = 0.2
        o = bpy.data.objects.new('pv_sun', l); sc.collection.objects.link(o)
        o.rotation_euler = (math.radians(50), 0, math.radians(-35))
        l2 = bpy.data.lights.new('pv_fill', 'SUN'); l2.energy = 1.0
        o2 = bpy.data.objects.new('pv_fill', l2); sc.collection.objects.link(o2)
        o2.rotation_euler = (math.radians(70), 0, math.radians(150))
    if 'pv_cam' not in bpy.data.objects:
        c = bpy.data.cameras.new('pv_cam'); c.type = 'ORTHO'
        o = bpy.data.objects.new('pv_cam', c); sc.collection.objects.link(o)
        sc.camera = o
    return sc


def shot(path, target, size, yaw_deg=0, pitch_deg=0, dist=6.0, res=None):
    """yaw 0 = looking at the character's face (camera on -Y)."""
    sc = bpy.context.scene
    if res:
        sc.render.resolution_x, sc.render.resolution_y = res
    cam = bpy.data.objects['pv_cam']
    cam.data.ortho_scale = size
    y, p = math.radians(yaw_deg), math.radians(pitch_deg)
    d = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    t = Vector(target)
    cam.location = t + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    cam.data.clip_end = 50
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log('render', path)
