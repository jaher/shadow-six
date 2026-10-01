# render_eye.py - the HUD eye's photoreal close-up, rendered as raw frames for compose.py.
#   blender -b --factory-startup -P tools/blender/hud/eye/render_eye.py -- <out_dir> [frame_set] [samples]
# frame_set: 'still' (one open + one closed test), 'all' (every frame in frames.FRAMES) or a comma list of frame names.
# Scene: MPFB periocular skin (face.py) around the procedural globe (eyeball.py), a studio window as the catchlight
# (emissive panes with mullions, seen only in reflections), soft key, cool fill, warm rim; AgX, Cycles GPU + OIDN.
import os, sys, math, json, bpy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix, Euler
import eyeball as E, face as F, frames as FR

WIN = (1.30, 1.0)               # porthole window aspect (rx : ry)


def setup(samples=384):
    sc = bpy.context.scene; r = sc.render; r.engine = 'CYCLES'; cy = sc.cycles
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dev in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = dev; prefs.get_devices()
            for d in prefs.devices: d.use = d.type != 'CPU'
            cy.device = 'GPU' if os.environ.get('EYE_DEVICE', 'GPU') == 'GPU' else 'CPU'; break
        except Exception: continue
    cy.samples = samples; cy.use_denoising = True; cy.denoiser = 'OPENIMAGEDENOISE'
    cy.max_bounces = 16; cy.glossy_bounces = 8; cy.transmission_bounces = 16; cy.transparent_max_bounces = 64
    cy.tile_size = 256; cy.caustics_reflective = False; cy.caustics_refractive = False; cy.sample_clamp_indirect = 6
    r.film_transparent = False; r.filter_size = 1.0
    vs = sc.view_settings; vs.view_transform = 'AgX'; vs.look = 'AgX - Medium High Contrast'; vs.exposure = float(os.environ.get('EYE_EV', 0.0))
    r.image_settings.file_format = 'PNG'; r.image_settings.color_mode = 'RGB'; r.image_settings.color_depth = '16'
    r.resolution_percentage = 100
    w = bpy.data.worlds.new('eyeworld'); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.05, 0.042, 0.035, 1); bg.inputs['Strength'].default_value = 0.35
    return sc


def _area(name, loc, target, energy, size, size_y=None, color=(1, 1, 1), shape='RECTANGLE'):
    L = bpy.data.lights.new(name, 'AREA'); L.energy = energy; L.shape = shape; L.size = size; L.size_y = size_y or size; L.color = color
    o = bpy.data.objects.new(name, L); bpy.context.scene.collection.objects.link(o); o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o


def window(c, loc, size=(0.11, 0.14), bars=(2, 2), strength=7.0):
    """Studio window seen only in the wet surfaces (the catchlight): a soft daylight box behind thin, slightly blurred
    mullions, brightest at its centre and falling off towards the frame, so the corneal reflection has soft edges and
    the cornea's curvature shows in it instead of a hard white rectangle."""
    T = E.N('window'); out = T.t.nodes['Material Output']
    em = T.n('ShaderNodeEmission', i_Strength=strength)
    uv = T.sep(T.n('ShaderNodeTexCoord').outputs['UV'])
    def grid(u, n):
        f = T.m_('FRACT', T.m_('MULTIPLY', u, n))
        return T.m_('MULTIPLY', T.smooth(f, 0.0, 0.07), T.m_('SUBTRACT', 1.0, T.m_('MULTIPLY', T.smooth(f, 0.93, 1.0), 0.85)))
    def edge(u):
        return T.m_('MULTIPLY', T.smooth(u, 0.0, 0.32), T.m_('SUBTRACT', 1.0, T.smooth(u, 0.68, 1.0)))
    pane = T.m_('MULTIPLY', T.m_('MULTIPLY_ADD', T.m_('MULTIPLY', grid(uv[0], bars[0]), grid(uv[1], bars[1])), 0.45, 0.55),
                T.m_('MULTIPLY', edge(uv[0]), edge(uv[1])))
    sky = T.mix(uv[1], (0.80, 0.84, 0.90), (1.0, 0.97, 0.92))
    T.L(sky, em.inputs['Color']); T.L(T.m_('MULTIPLY', pane, strength), em.inputs['Strength'])
    T.L(em.outputs[0], out.inputs['Surface'])
    bpy.ops.mesh.primitive_plane_add(size=1.0); o = bpy.context.active_object; o.name = 'window'
    o.scale = (size[0], size[1], 1); o.location = loc
    o.rotation_euler = (c - Vector(loc)).to_track_quat('Z', 'Y').to_euler()
    o.data.materials.append(T.m)
    o.visible_camera = False; o.visible_shadow = False; o.visible_diffuse = False; o.visible_transmission = True; o.visible_glossy = True
    return o


def room(sc):
    """World: dim warm studio for diffuse light; glossy rays see a faint room (lighter floor and far wall, dark
    ceiling), so the wet surfaces carry a soft environment reflection besides the window."""
    w = sc.world; nt = w.node_tree; bg = nt.nodes['Background']; out = nt.nodes['World Output']
    lp = nt.nodes.new('ShaderNodeLightPath'); g = nt.nodes.new('ShaderNodeBackground'); mx = nt.nodes.new('ShaderNodeMixShader')
    tc = nt.nodes.new('ShaderNodeTexCoord'); sp = nt.nodes.new('ShaderNodeSeparateXYZ'); ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(tc.outputs['Generated'], sp.inputs[0]); nt.links.new(sp.outputs[2], ramp.inputs['Fac'])
    els = ramp.color_ramp.elements; els[0].position = 0.35; els[0].color = (0.10, 0.085, 0.07, 1); els[1].position = 0.62; els[1].color = (0.02, 0.02, 0.022, 1)
    nt.links.new(ramp.outputs['Color'], g.inputs['Color']); g.inputs['Strength'].default_value = 1.0
    nt.links.new(lp.outputs['Is Glossy Ray'], mx.inputs[0]); nt.links.new(bg.outputs[0], mx.inputs[1]); nt.links.new(g.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs['Surface'])


def lights(c, k=1.0):
    """Key/fill/rim shape the skin; the window (and faintly the fill and the room) shows in the wet surfaces."""
    for o in (_area('key', c + Vector((-0.12, -0.17, 0.19)), c, 3.0 * k, 0.07, 0.09, (1.0, 0.97, 0.93)),
              _area('fill', c + Vector((0.20, -0.24, -0.02)), c, 0.7 * k, 0.30, color=(0.85, 0.92, 1.0), shape='DISK'),
              _area('rim', c + Vector((-0.20, 0.05, 0.10)), c, 1.0 * k, 0.08, color=(1.0, 0.85, 0.65))):
        o.visible_glossy = o.name == 'fill'           # a faint round fill reflection low on the cornea; the key stays out
    window(c, c + Vector((-0.09, -0.21, 0.035)), strength=float(os.environ.get('EYE_WINDOW', 7.0)))
    room(bpy.context.scene)


def camera(c, r, width, lens=135.0, aim=(0.0, 0.0)):
    cam = bpy.data.cameras.new('eyecam'); cam.lens = lens; cam.sensor_fit = 'HORIZONTAL'; cam.sensor_width = 36.0; cam.clip_start = 0.002
    o = bpy.data.objects.new('eyecam', cam); bpy.context.scene.collection.objects.link(o); bpy.context.scene.camera = o
    dist = width * lens / 36.0
    tgt = c + Vector((aim[0], 0, aim[1]))
    o.location = tgt + Vector((0.0, -dist, 0.0)) + Vector((0.0, 0.0, dist * math.tan(math.radians(4))))
    o.rotation_euler = (tgt - o.location).to_track_quat('-Z', 'Y').to_euler()
    return o


class Scene:
    def __init__(self, samples=384, res=(640, 492)):
        face, c, r, brow, bimg = F.load()
        sc = setup(samples); self.sc = sc
        sc.render.resolution_x, sc.render.resolution_y = res
        self.face, self.c, self.r, self.browcard, self.bimg = face, c, r, brow, bimg
        brow.hide_render = True; brow.hide_viewport = True
        face.data.materials.clear(); face.data.materials.append(F.skin_mat(c, r))
        for p in face.data.polygons: p.use_smooth = True
        sub = face.modifiers.new('sub', 'SUBSURF'); sub.levels = sub.render_levels = 3
        E.configure(float(os.environ.get('EYE_LIMBUS', 0.0046)))
        rig, self.pupil, self.parts = E.build('eye')
        rig.location = c; k = r / E.R; rig.scale = (k, k, k)
        self.rig = rig
        self.keys = face.data.shape_keys.key_blocks
        lights(c, float(os.environ.get('EYE_LIGHT', 0.4)))
        # window: 1.3 : 1, centred a little above and lateral of the globe so a hint of brow shows
        self.cam = camera(c, r, width=r * float(os.environ.get('EYE_FOV', 2.62)), aim=(-r * 0.04, r * float(os.environ.get('EYE_AIMZ', 0.07))))
        self.lash_spec = None
        print('SCENE', tuple(round(x, 4) for x in c), round(r, 4))

    def set(self, fr):
        self.keys['blink'].value = fr['blink']; self.keys['squint'].value = 0.0
        self.keys['wide'].value = max(0.0, float(os.environ.get('EYE_WIDE', 0.0)) * (1 - fr['blink']) + fr['wide'])
        self.rig.rotation_euler = Euler((math.radians(-fr['pitch']), 0.0, math.radians(fr['yaw'])), 'XYZ')
        self.pupil.outputs[0].default_value = fr['pupil']
        bpy.context.view_layer.update()
        if hasattr(F, 'grow') and self.lash_spec is not False:
            F.grow(self, fr)

    def render(self, path):
        self.sc.render.filepath = path
        try:
            bpy.ops.render.render(write_still=True)
        except RuntimeError as e:          # the GPU is shared: fall back to the CPU when it is full
            if 'memory' not in str(e).lower() or self.sc.cycles.device == 'CPU': raise
            print('GPU OOM -> CPU'); self.sc.cycles.device = 'CPU'
            bpy.ops.render.render(write_still=True)
            self.sc.cycles.device = 'GPU'                    # try the GPU again on the next frame


def main():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = a[0] if a else os.path.join(os.path.dirname(F.SP), 'eye_frames')
    which = a[1] if len(a) > 1 else 'still'
    samples = int(a[2]) if len(a) > 2 else 384
    res = tuple(int(v) for v in a[3].split('x')) if len(a) > 3 else (640, 492)
    os.makedirs(out, exist_ok=True)
    S = Scene(samples, res)
    names = ['g00n', 'blink3'] if which == 'still' else [f['name'] for f in FR.FRAMES] if which == 'all' else which.split(',')
    for n in names:
        S.set(FR.BY_NAME[n]); S.render(os.path.join(out, n + '.png'))
        print('FRAME', n, flush=True)
    json.dump({'res': list(res), 'win': WIN, 'frames': names}, open(os.path.join(out, 'render.json'), 'w'))


if __name__ == '__main__':
    main()
