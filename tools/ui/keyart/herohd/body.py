"""The hero's body: a MakeHuman (CC0) male shaped by targets into a fictional, weathered 1940s commando, with a layered
skin shader (CC0 MakeHuman skin texture + procedural pores, redness, grime), eyes with a wet cornea, eyelashes, and
particle hair: a short back-and-sides cut, eyebrows, two-day stubble and forearm hair."""
import os, math
import numpy as np
import bpy
from mathutils import Vector
import mh

# shape: no real person; a lean, muscular man of about 30 with a square jaw, heavy brow and a once-broken nose
MACRO = dict(gender=1.0, age=0.58, muscle=0.80, weight=0.44, height=0.53, proportions=0.8)
FACE = {
    'head/head-square': 0.32, 'head/head-age': 0.4, 'head/head-fat': -0.6, 'head/head-oval': 0.1,
    'chin/chin-bones': 0.5, 'chin/chin-prominent': 0.4, 'chin/chin-width': 0.05, 'chin/chin-height': 0.15, 'chin/chin-cleft': 0.2,
    'neck/neck-scale-horiz': 0.3, 'neck/neck-scale-depth': 0.15, 'neck/neck-double': -0.5,
    'nose/nose-hump': 0.45, 'nose/nose-scale-vert': 0.15, 'nose/nose-width1': 0.1, 'nose/nose-point-width': 0.05,
    'nose/nose-greek': -0.2, 'nose/nose-scale-depth': 0.1,
    'eyebrows/eyebrows-trans': ('forward', 0.45), 'eyebrows/eyebrows-angle': ('down', 0.25),
    'cheek/l-cheek-bones': 0.5, 'cheek/r-cheek-bones': 0.5, 'cheek/l-cheek-inner': -0.35, 'cheek/r-cheek-inner': -0.35,
    'cheek/l-cheek-volume': -0.6, 'cheek/r-cheek-volume': -0.6,
    'forehead/forehead-trans': ('forward', 0.15), 'forehead/forehead-nubian': 0.15, 'forehead/forehead-temple': -0.3,
    'mouth/mouth-scale-horiz': 0.12, 'mouth/mouth-upperlip-volume': -0.15,
    # a set, determined face: brows lowered, eyes narrowed a little, lips pressed (MakeHuman expression units)
    'expression/units/caucasian/eyebrows-left-down.target': 0.3, 'expression/units/caucasian/eyebrows-right-down.target': 0.3,
    'expression/units/caucasian/eye-left-slit.target': 0.1, 'expression/units/caucasian/eye-right-slit.target': 0.1,
    'expression/units/caucasian/mouth-compression.target': 0.1, 'mouth/mouth-lowerlip-volume': 0.1,
    'eyes/l-eye-height2': -0.2, 'eyes/r-eye-height2': -0.2, 'eyes/l-eye-bag': ('in', 0.2), 'eyes/r-eye-bag': ('in', 0.2),
    'torso/torso-vshape': 0.35, 'torso/torso-muscle-pectoral': 0.3, 'torso/torso-muscle-dorsi': 0.3,
    'armslegs/r-lowerarm-muscle': 0.4, 'armslegs/l-lowerarm-muscle': 0.4, 'armslegs/r-upperarm-muscle': 0.35,
    'armslegs/l-upperarm-muscle': 0.35, 'armslegs/r-lowerarm-fat': -0.4, 'armslegs/l-lowerarm-fat': -0.4,
    'armslegs/r-hand-scale': 0.12, 'armslegs/l-hand-scale': 0.12, 'armslegs/r-hand-fingers-diameter': 0.2,
    'armslegs/l-hand-fingers-diameter': 0.2,
}


def shaped(root, face=None, macro=None):
    """The shaped MakeHuman data (no Blender objects): for proxy fitting after the body exists."""
    H = mh.Human(root)
    H.apply(mh.macro_weights(**dict(MACRO, **(macro or {}))))
    H.apply(mh.modifier_targets({k: v for k, v in dict(FACE, **(face or {})).items() if v is not None}))
    return H


def make(root, face=None, macro=None):
    H = shaped(root, face, macro)
    body = H.build_mesh('body')
    rig = H.build_rig(body, name='hero.rig')
    # region weights need the full index space (joint cubes) -> before finish_mesh
    regions(H, body)
    H.finish_mesh(body)
    ground = -min(v.co.z for v in body.data.vertices)
    rig.location.z = ground          # feet on z = 0
    return H, body, rig


def _vg(ob, name, w):
    vg = ob.vertex_groups.get(name) or ob.vertex_groups.new(name=name)
    for i, x in enumerate(w):
        if x > 1e-4: vg.add([i], float(min(1.0, x)), 'REPLACE')
    return vg


def smooth01(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


SKIN_TEX = 'skins/middleage_caucasian_male/middleage_lightskinned_male_diffuse.png'


def vertex_uv(H):
    uv = np.zeros((len(H.v), 2))
    for f, t in zip(H.faces, H.fuv):
        for vi, ti in zip(f, t):
            if ti >= 0: uv[vi] = H.vt[ti]
    return uv


def tex_sample(path, uv):
    im = bpy.data.images.load(path, check_existing=True)
    W, Hh = im.size
    px = np.empty(W * Hh * 4, np.float32); im.pixels.foreach_get(px); px = px.reshape(Hh, W, 4)
    x = np.clip((uv[:, 0] * (W - 1)).astype(int), 0, W - 1); y = np.clip((uv[:, 1] * (Hh - 1)).astype(int), 0, Hh - 1)
    return px[y, x, :3]


def landmarks(H):
    """Face landmarks on the shaped mesh (Blender coords, rest): eye centre, nose tip, nose base, lips, chin."""
    V = mh.mh2b(H.v)
    used = np.zeros(len(V), bool)
    for f, g in zip(H.faces, H.fgroup):
        if g == 'body': used[f] = True
    J = lambda g: mh.mh2b(H.gcenter(g)[None])[0]
    E = (J('joint-l-eye') + J('joint-r-eye')) / 2
    mid = used & (np.abs(V[:, 0]) < 0.004)
    def front(z0, z1):
        s = mid & (V[:, 2] > E[2] + z0) & (V[:, 2] < E[2] + z1)
        i = np.where(s)[0][np.argmin(V[s, 1])]
        return V[i]
    nose = front(-0.06, -0.005)
    chin = front(-0.14, -0.095)
    # nose base: the deepest midline point just under the tip (subnasale)
    s = mid & (V[:, 2] < nose[2] - 0.006) & (V[:, 2] > nose[2] - 0.03) & (V[:, 1] < nose[1] + 0.03)
    sub = V[np.where(s)[0][np.argmax(V[s, 1])]] if s.any() else nose - np.array([0, -0.02, 0.015])
    return dict(E=E, eyeL=J('joint-l-eye'), eyeR=J('joint-r-eye'), nose=nose, sub=sub, chin=chin, V=V, used=used)


def regions(H, body):
    """Vertex-group masks from rest positions (Blender coords, before the ground offset): k_beard (stubble + shadow),
    k_scalp (short back and sides), k_brow, k_armhair, k_lips."""
    lm = landmarks(H)
    V, used, E = lm['V'], lm['used'], lm['E']
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    ax = np.abs(x)
    J = lambda g: mh.mh2b(H.gcenter(g)[None])[0]
    headw = np.zeros(len(V))
    hv = body.vertex_groups.get('head')
    for v in body.data.vertices:
        for g in v.groups:
            if g.group == hv.index: headw[v.index] = g.weight
    # lips from the skin texture's redness, limited to the mouth box
    rgb = tex_sample(os.path.join(H.SYS, SKIN_TEX), vertex_uv(H))
    red = np.clip((rgb[:, 0] - rgb[:, 1]) * 4 - 0.55, 0, 1)
    mbox = (ax < 0.03) & (z < lm['sub'][2] - 0.002) & (z > lm['chin'][2] + 0.012) & (y < lm['sub'][1] + 0.02)
    lips = smooth01(red, 0.15, 0.5) * mbox
    _vg(body, 'k_lips', lips * used)
    # beard: upper boundary from under the nose, along the cheek line, up to the sideburns
    zb = np.interp(ax, [0.0, 0.016, 0.026, 0.04, 0.055, 0.066, 0.08],
                   [lm['sub'][2] - 0.003, lm['sub'][2] - 0.004, E[2] - 0.062, E[2] - 0.05, E[2] - 0.035, E[2] - 0.005, E[2] - 0.0])
    upper = smooth01(zb - z, -0.004, 0.014)
    ear_y = E[1] + 0.083
    back = smooth01(ear_y - y, -0.004, 0.012)
    low = smooth01(z - (lm['chin'][2] - 0.055), 0.0, 0.03)
    beard = upper * back * low * (1 - smooth01(lips, 0.1, 0.4)) * np.clip(headw * 1.5 + (z > lm['chin'][2] - 0.07), 0, 1)
    beard *= used
    _vg(body, 'k_beard', beard)
    # scalp: everything on the head above the sideburn line and behind the forehead hairline, not the ears
    hair_front = smooth01(-(y - (E[1] + 0.012)) - 0.012 * 0, -0.006, 0.01)          # 1 = in front of the hairline
    forehead = hair_front * smooth01(z - (E[2] + 0.035), 0.0, 0.01) * (ax < 0.06)
    side_lo = np.where(ax > 0.06, E[2] - 0.022, E[2] - 0.004)                      # sideburns to mid-ear
    scalp = smooth01(z - side_lo, 0.0, 0.01) * (1 - forehead) * smooth01(headw, 0.55, 0.9)
    scalp *= smooth01(y - (E[1] + 0.03), -0.04, 0.0) + (ax > 0.058)                    # no hair on the face front
    # temples: the hairline runs back from the outer brow to the sideburn, ~5 cm behind the eye centres
    scalp *= 1 - smooth01(ax, 0.035, 0.05) * smooth01(E[1] + 0.058 - y, -0.004, 0.008)
    scalp = np.clip(scalp, 0, 1)
    for sgn in (1, -1):
        ear = np.array([sgn * 0.072, E[1] + 0.098, E[2] - 0.012])
        de = np.linalg.norm((V - ear) * np.array([1.4, 1.0, 0.72]), axis=1)
        scalp *= smooth01(de, 0.026, 0.033)
    scalp *= used
    _vg(body, 'k_scalp', scalp)
    # eyebrows: an arched band over each eye
    brow = np.zeros(len(V))
    for e in (lm['eyeL'], lm['eyeR']):
        dx = (x - e[0]) * np.sign(e[0])                   # + toward the temple
        t = np.clip((dx + 0.021) / 0.05, 0, 1)            # 0 at the medial end, 1 at the tail
        zc = e[2] + 0.021 + 0.006 * np.sin(t * 2.6) - 0.004 * t
        half = 0.0068 - 0.0035 * t
        band = smooth01(half - np.abs(z - zc), 0.0, 0.0018) * smooth01(dx, -0.022, -0.018) * smooth01(-dx, -0.031, -0.026)
        brow = np.maximum(brow, band * (y < e[1] + 0.01))
    _vg(body, 'k_brow', brow * used)
    # forearm + back-of-hand hair
    arm = np.zeros(len(V))
    for side in ('l', 'r'):
        el, ha = J(f'joint-{side}-elbow'), J(f'joint-{side}-hand')
        a = ha - el; L = np.linalg.norm(a); a /= L
        t = (V - el) @ a
        r = np.linalg.norm((V - el) - np.outer(t, a), axis=1)
        arm = np.maximum(arm, smooth01(t, -0.05, 0.03) * smooth01(-t, -L - 0.06, -L + 0.02) * (r < 0.07))
    _vg(body, 'k_armhair', arm * used)


# ------------------------------------------------------------------ materials
def img(path, colorspace='sRGB'):
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = colorspace
    return im


def node(nt, kind, loc=(0, 0), **inputs):
    n = nt.nodes.new(kind); n.location = loc
    for k, v in inputs.items():
        if k in n.inputs: n.inputs[k].default_value = v
        else: setattr(n, k, v)
    return n


def skin_material(H, name='skin', tex=SKIN_TEX, grime=0.4, beard=0.6, soot=0.55):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; L = nt.links
    bsdf = nt.nodes['Principled BSDF']
    t = node(nt, 'ShaderNodeTexImage', (-900, 300)); t.image = img(os.path.join(H.SYS, tex))
    t.interpolation = 'Cubic'
    # weathering: warm the base, add a little redness and an uneven tan, then grime (soot / dirt) from a noise
    hsv = node(nt, 'ShaderNodeHueSaturation', (-650, 300)); hsv.inputs['Saturation'].default_value = 1.08; hsv.inputs['Value'].default_value = 0.86
    L.new(t.outputs['Color'], hsv.inputs['Color'])
    tc = node(nt, 'ShaderNodeTexCoord', (-1300, -100))
    n1 = node(nt, 'ShaderNodeTexNoise', (-1100, 0)); n1.inputs['Scale'].default_value = 38; n1.inputs['Detail'].default_value = 6; n1.inputs['Roughness'].default_value = 0.62
    L.new(tc.outputs['Object'], n1.inputs['Vector'])
    blot = node(nt, 'ShaderNodeMapRange', (-900, 0)); blot.inputs['From Min'].default_value = 0.42; blot.inputs['From Max'].default_value = 0.68
    L.new(n1.outputs['Fac'], blot.inputs['Value'])
    red = node(nt, 'ShaderNodeMix', (-450, 300)); red.data_type = 'RGBA'; red.blend_type = 'MULTIPLY'
    red.inputs['B'].default_value = (1.0, 0.86, 0.80, 1)
    mul = node(nt, 'ShaderNodeMath', (-700, 0)); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 0.45
    L.new(blot.outputs['Result'], mul.inputs[0]); L.new(mul.outputs[0], red.inputs['Factor']); L.new(hsv.outputs['Color'], red.inputs['A'])
    # grime: a coarser noise, darker and browner, stronger in creases (AO)
    n2 = node(nt, 'ShaderNodeTexNoise', (-1100, -300)); n2.inputs['Scale'].default_value = 9; n2.inputs['Detail'].default_value = 8; n2.inputs['Roughness'].default_value = 0.7
    L.new(tc.outputs['Object'], n2.inputs['Vector'])
    gr = node(nt, 'ShaderNodeMapRange', (-900, -300)); gr.inputs['From Min'].default_value = 0.5; gr.inputs['From Max'].default_value = 0.72
    L.new(n2.outputs['Fac'], gr.inputs['Value'])
    ao = node(nt, 'ShaderNodeAmbientOcclusion', (-900, -550)); ao.inputs['Distance'].default_value = 0.02; ao.samples = 8
    aoi = node(nt, 'ShaderNodeMath', (-700, -550)); aoi.operation = 'SUBTRACT'; aoi.inputs[0].default_value = 1.0
    L.new(ao.outputs['AO'], aoi.inputs[1])
    gsum = node(nt, 'ShaderNodeMath', (-500, -400)); gsum.operation = 'ADD'; gsum.use_clamp = True
    L.new(gr.outputs['Result'], gsum.inputs[0]); L.new(aoi.outputs[0], gsum.inputs[1])
    gk = node(nt, 'ShaderNodeMath', (-350, -400)); gk.operation = 'MULTIPLY'; gk.inputs[1].default_value = grime
    L.new(gsum.outputs[0], gk.inputs[0])
    dirt = node(nt, 'ShaderNodeMix', (-200, 300)); dirt.data_type = 'RGBA'; dirt.blend_type = 'MULTIPLY'
    dirt.inputs['B'].default_value = (0.42, 0.34, 0.27, 1)
    L.new(red.outputs['Result'], dirt.inputs['A']); L.new(gk.outputs[0], dirt.inputs['Factor'])
    # beard shadow: hair under the skin + stubble roots greys the shaved area (vertex group read as an attribute)
    bat0 = node(nt, 'ShaderNodeAttribute', (-600, 600)); bat0.attribute_name = 'k_beard'
    sat = node(nt, 'ShaderNodeAttribute', (-600, 500)); sat.attribute_name = 'k_scalp'
    bat = node(nt, 'ShaderNodeMath', (-400, 600)); bat.operation = 'MAXIMUM'
    L.new(bat0.outputs['Fac'], bat.inputs[0]); L.new(sat.outputs['Fac'], bat.inputs[1])
    bn = node(nt, 'ShaderNodeTexNoise', (-650, 700)); bn.inputs['Scale'].default_value = 2200; bn.inputs['Detail'].default_value = 2
    L.new(tc.outputs['Object'], bn.inputs['Vector'])
    bk = node(nt, 'ShaderNodeMath', (-200, 650)); bk.operation = 'MULTIPLY'
    bk2 = node(nt, 'ShaderNodeMapRange', (-400, 750)); bk2.inputs['From Min'].default_value = 0.3; bk2.inputs['From Max'].default_value = 0.7
    bk2.inputs['To Min'].default_value = beard * 0.6; bk2.inputs['To Max'].default_value = beard
    L.new(bn.outputs['Fac'], bk2.inputs['Value']); L.new(bat.outputs[0], bk.inputs[0]); L.new(bk2.outputs['Result'], bk.inputs[1])
    bsh = node(nt, 'ShaderNodeMix', (0, 450)); bsh.data_type = 'RGBA'; bsh.blend_type = 'MULTIPLY'
    bsh.inputs['B'].default_value = (0.36, 0.34, 0.36, 1)
    L.new(dirt.outputs['Result'], bsh.inputs['A']); L.new(bk.outputs[0], bsh.inputs['Factor'])
    # soot and dirt from the night's work: smudged patches, wiped streaks (object space), darker in the creases
    sn = node(nt, 'ShaderNodeTexNoise', (-650, 900)); sn.inputs['Scale'].default_value = 7.0; sn.inputs['Detail'].default_value = 9
    sn.inputs['Roughness'].default_value = 0.68; sn.inputs['Distortion'].default_value = 0.6
    L.new(tc.outputs['Object'], sn.inputs['Vector'])
    smap = node(nt, 'ShaderNodeMapping', (-850, 1000)); smap.inputs['Scale'].default_value = (60.0, 60.0, 9.0)
    L.new(tc.outputs['Object'], smap.inputs['Vector'])
    st = node(nt, 'ShaderNodeTexNoise', (-650, 1100)); st.inputs['Scale'].default_value = 1.0; st.inputs['Detail'].default_value = 3
    L.new(smap.outputs['Vector'], st.inputs['Vector'])
    sm = node(nt, 'ShaderNodeMath', (-450, 1000)); sm.operation = 'MULTIPLY_ADD'
    L.new(st.outputs['Fac'], sm.inputs[0]); sm.inputs[1].default_value = 0.18; L.new(sn.outputs['Fac'], sm.inputs[2])
    sr = node(nt, 'ShaderNodeMapRange', (-250, 1000)); sr.inputs['From Min'].default_value = 0.66; sr.inputs['From Max'].default_value = 0.78
    sr.inputs['To Max'].default_value = soot
    L.new(sm.outputs[0], sr.inputs['Value'])
    soo = node(nt, 'ShaderNodeMix', (150, 450)); soo.data_type = 'RGBA'; soo.blend_type = 'MULTIPLY'
    soo.inputs['B'].default_value = (0.32, 0.29, 0.26, 1)
    L.new(bsh.outputs['Result'], soo.inputs['A']); L.new(sr.outputs['Result'], soo.inputs['Factor'])
    L.new(soo.outputs['Result'], bsdf.inputs['Base Color'])
    # subsurface (random walk, skin radii), a sweaty sheen in the light
    bsdf.subsurface_method = 'RANDOM_WALK_SKIN'
    bsdf.inputs['Subsurface Weight'].default_value = 1.0
    bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.42, 0.22)
    bsdf.inputs['Subsurface Scale'].default_value = 0.0045
    bsdf.inputs['Specular IOR Level'].default_value = 0.55
    # roughness: 0.42 +/- pores/oil, grime rougher
    rn = node(nt, 'ShaderNodeMapRange', (-350, -150)); rn.inputs['To Min'].default_value = 0.34; rn.inputs['To Max'].default_value = 0.56
    L.new(n1.outputs['Fac'], rn.inputs['Value'])
    rsum = node(nt, 'ShaderNodeMath', (-150, -150)); rsum.operation = 'ADD'; rsum.use_clamp = True
    L.new(rn.outputs['Result'], rsum.inputs[0]); L.new(gk.outputs[0], rsum.inputs[1])
    L.new(rsum.outputs[0], bsdf.inputs['Roughness'])
    bsdf.inputs['Coat Weight'].default_value = 0.12; bsdf.inputs['Coat Roughness'].default_value = 0.35
    # pores + fine wrinkles: voronoi (pores, ~0.6 mm) and stretched noise, in object space
    vor = node(nt, 'ShaderNodeTexVoronoi', (-900, -800)); vor.feature = 'DISTANCE_TO_EDGE'; vor.inputs['Scale'].default_value = 900
    L.new(tc.outputs['Object'], vor.inputs['Vector'])
    pore = node(nt, 'ShaderNodeMapRange', (-700, -800)); pore.inputs['From Min'].default_value = 0.0; pore.inputs['From Max'].default_value = 0.12
    L.new(vor.outputs['Distance'], pore.inputs['Value'])
    n3 = node(nt, 'ShaderNodeTexNoise', (-900, -1050)); n3.inputs['Scale'].default_value = 420; n3.inputs['Detail'].default_value = 4
    L.new(tc.outputs['Object'], n3.inputs['Vector'])
    hsum = node(nt, 'ShaderNodeMath', (-500, -900)); hsum.operation = 'MULTIPLY_ADD'
    L.new(n3.outputs['Fac'], hsum.inputs[0]); hsum.inputs[1].default_value = 0.6; L.new(pore.outputs['Result'], hsum.inputs[2])
    bump = node(nt, 'ShaderNodeBump', (-250, -800)); bump.inputs['Strength'].default_value = 0.32; bump.inputs['Distance'].default_value = 0.0003
    L.new(hsum.outputs[0], bump.inputs['Height'])
    L.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    L.new(bump.outputs['Normal'], bsdf.inputs['Coat Normal'])
    return m


def eyes(H, rig, color='brown'):
    """MakeHuman high-poly eyes: the eyeball under a cornea shell that the texture leaves transparent (alpha 0): the
    shell becomes a clear, wet, Fresnel-weighted gloss over the iris."""
    ob, _ = H.fit_proxy(os.path.join(H.SYS, 'eyes/high-poly/high-poly.mhclo'), 'eyes')
    m = bpy.data.materials.new('eye'); m.use_nodes = True
    nt = m.node_tree; L = nt.links; b = nt.nodes['Principled BSDF']; out = nt.nodes['Material Output']
    t = node(nt, 'ShaderNodeTexImage', (-700, 200)); t.image = img(os.path.join(H.SYS, f'eyes/materials/{color}_eye.png'))
    t.image.alpha_mode = 'STRAIGHT'
    hsv = node(nt, 'ShaderNodeHueSaturation', (-450, 200)); hsv.inputs['Value'].default_value = 0.78; hsv.inputs['Saturation'].default_value = 0.85
    L.new(t.outputs['Color'], hsv.inputs['Color']); L.new(hsv.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.3
    b.inputs['Coat Weight'].default_value = 0.6; b.inputs['Coat Roughness'].default_value = 0.03
    tr = node(nt, 'ShaderNodeBsdfTransparent', (-200, -200))
    gl = node(nt, 'ShaderNodeBsdfGlossy', (-200, -350)); gl.inputs['Roughness'].default_value = 0.015
    fr = node(nt, 'ShaderNodeFresnel', (-200, -50)); fr.inputs['IOR'].default_value = 1.376
    cor = node(nt, 'ShaderNodeMixShader', (50, -200))
    L.new(fr.outputs[0], cor.inputs[0]); L.new(tr.outputs[0], cor.inputs[1]); L.new(gl.outputs[0], cor.inputs[2])
    mix = node(nt, 'ShaderNodeMixShader', (300, 0))
    L.new(t.outputs['Alpha'], mix.inputs[0]); L.new(cor.outputs[0], mix.inputs[1]); L.new(b.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], out.inputs['Surface'])
    ob.data.materials.append(m)
    _bind(ob, rig, {'head': 1.0})
    return ob


def card(H, rig, mhclo, name, tint=(0.08, 0.06, 0.045)):
    """Alpha-card proxy (eyelashes, eyebrows) with its own CC0 texture, darkened to the hair colour."""
    ob, _ = H.fit_proxy(mhclo, name)
    tex = [l.split()[1] for l in open(mhclo.replace('.mhclo', '.mhmat')) if l.startswith('diffuseTexture')][0]
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    t = node(nt, 'ShaderNodeTexImage', (-400, 200)); t.image = img(os.path.join(os.path.dirname(mhclo), tex))
    b.inputs['Base Color'].default_value = (*tint, 1)
    nt.links.new(t.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 0.5
    m.blend_method = 'HASHED' if hasattr(m, 'blend_method') else None
    ob.data.materials.append(m)
    _bind(ob, rig, {'head': 1.0})
    return ob


def _bind(ob, rig, groups):
    for g, w in groups.items():
        vg = ob.vertex_groups.new(name=g); vg.add(list(range(len(ob.data.vertices))), w, 'REPLACE')
    md = ob.modifiers.new('Armature', 'ARMATURE'); md.object = rig
    ob.parent = rig


# ------------------------------------------------------------------ particle hair
def hair_material(name, melanin=0.85, redness=0.35, rough=0.38, random=0.15):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL': nt.nodes.remove(n)
    h = nt.nodes.new('ShaderNodeBsdfHairPrincipled')
    h.parametrization = 'MELANIN'
    try: h.model = 'CHIANG'
    except Exception: pass
    h.inputs['Melanin'].default_value = melanin
    h.inputs['Melanin Redness'].default_value = redness
    h.inputs['Roughness'].default_value = rough
    if 'Radial Roughness' in h.inputs: h.inputs['Radial Roughness'].default_value = 0.4
    h.inputs['Random Color'].default_value = random
    h.inputs['Random Roughness'].default_value = 0.2
    nt.links.new(h.outputs[0], nt.nodes['Material Output'].inputs['Surface'])
    return m


def hair(ob, name, group, count, length, mat, root_r=0.00005, tip_r=0.00001, children=0, clump=0.0, rough=0.0,
         normal=1.0, tangent=0.0, gravity=0.0, kink=None, seed=1, steps=3, tangent_axis=None, random=0.002):
    ob.data.materials.append(mat)
    md = ob.modifiers.new(name, 'PARTICLE_SYSTEM')
    ps = md.particle_system
    s = ps.settings
    s.name = name
    s.type = 'HAIR'
    s.count = count
    s.hair_length = length
    s.use_advanced_hair = True
    s.emit_from = 'FACE'
    s.use_emit_random = True
    s.use_even_distribution = True
    s.normal_factor = normal
    s.tangent_factor = tangent
    s.tangent_phase = 0.0
    s.factor_random = random
    s.material_slot = mat.name
    s.display_step = steps; s.render_step = steps
    s.root_radius = 1.0; s.tip_radius = tip_r / root_r; s.radius_scale = root_r
    s.use_hair_bspline = True
    s.child_type = 'INTERPOLATED' if children else 'NONE'
    if children:
        s.child_percent = children; s.rendered_child_count = children
        s.clump_factor = clump; s.roughness_1 = rough; s.roughness_1_size = 0.5; s.child_length = 1.0
        s.child_parting_factor = 0.0
    if kink:
        s.kink = kink[0]; s.kink_amplitude = kink[1]; s.kink_frequency = kink[2]
    s.effector_weights.gravity = gravity
    ps.vertex_group_density = group
    ps.vertex_group_length = group
    ps.seed = seed
    return md
