"""Procedural (Cycles) materials for the hero's kit: Denison brushstroke camouflage drill, wool serge, felted wool
(beret), blancoed cotton webbing, brass, leather, knit, wood, rope. All patterns are 3D (object space) so the cloth
needs no UVs and shows no seams in the paint; wear comes from pointiness / AO masks; seams and stitches are drawn from
per-vertex attributes written by the garment builder (seam distance, stitch phase)."""
import bpy

LIN = lambda c: tuple((x / 255.0) ** 2.2 for x in c)


def _n(nt, kind, loc=(0, 0), **kw):
    n = nt.nodes.new(kind); n.location = loc
    for k, v in kw.items():
        if k in n.inputs: n.inputs[k].default_value = v
        else: setattr(n, k, v)
    return n


def new(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes['Principled BSDF']


def mix_rgb(nt, a, b, fac, mode='MIX', loc=(0, 0)):
    m = _n(nt, 'ShaderNodeMix', loc); m.data_type = 'RGBA'; m.blend_type = mode
    L = nt.links
    for sock, v in (('A', a), ('B', b)):
        if isinstance(v, tuple): m.inputs[sock].default_value = (*v[:3], 1)
        else: L.new(v, m.inputs[sock])
    if isinstance(fac, (int, float)): m.inputs['Factor'].default_value = fac
    else: L.new(fac, m.inputs['Factor'])
    return m.outputs['Result']


def math(nt, op, a, b=None, loc=(0, 0), clamp=False):
    m = _n(nt, 'ShaderNodeMath', loc); m.operation = op; m.use_clamp = clamp
    L = nt.links
    for i, v in enumerate((a, b)):
        if v is None: continue
        if isinstance(v, (int, float)): m.inputs[i].default_value = v
        else: L.new(v, m.inputs[i])
    return m.outputs[0]


def maprange(nt, v, a, b, c=0.0, d=1.0, loc=(0, 0), interp='LINEAR'):
    m = _n(nt, 'ShaderNodeMapRange', loc); m.interpolation_type = interp
    m.inputs['From Min'].default_value = a; m.inputs['From Max'].default_value = b
    m.inputs['To Min'].default_value = c; m.inputs['To Max'].default_value = d
    nt.links.new(v, m.inputs['Value'])
    return m.outputs['Result']


def coords(nt, rot=(0, 0, 0), scale=(1, 1, 1), loc=(-1600, 0), space='Object'):
    tc = _n(nt, 'ShaderNodeTexCoord', loc)
    mp = _n(nt, 'ShaderNodeMapping', (loc[0] + 200, loc[1]))
    mp.inputs['Rotation'].default_value = rot; mp.inputs['Scale'].default_value = scale
    nt.links.new(tc.outputs[space], mp.inputs['Vector'])
    return mp.outputs['Vector']


def noise(nt, vec, scale, detail=4.0, rough=0.55, loc=(0, 0), dim='3D', lac=2.0, distortion=0.0):
    n = _n(nt, 'ShaderNodeTexNoise', loc); n.noise_dimensions = dim
    n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
    n.inputs['Lacunarity'].default_value = lac; n.inputs['Distortion'].default_value = distortion
    nt.links.new(vec, n.inputs['Vector'])
    return n


def attr(nt, name, loc=(0, 0)):
    a = _n(nt, 'ShaderNodeAttribute', loc); a.attribute_name = name
    return a.outputs['Fac']


def bump_chain(nt, heights, normal_in=None, loc=(400, -600)):
    """[(height_socket, strength, distance)] chained bumps."""
    prev = normal_in
    for i, (h, st, dist) in enumerate(heights):
        b = _n(nt, 'ShaderNodeBump', (loc[0] + 180 * i, loc[1]))
        b.inputs['Strength'].default_value = st; b.inputs['Distance'].default_value = dist
        nt.links.new(h, b.inputs['Height'])
        if prev is not None: nt.links.new(prev, b.inputs['Normal'])
        prev = b.outputs['Normal']
    return prev


def wear_masks(nt, loc=(-900, -900)):
    """(edge, cavity): convex-edge wear from Pointiness-like AO inversion, cavity dirt from AO."""
    ao_in = _n(nt, 'ShaderNodeAmbientOcclusion', loc); ao_in.inputs['Distance'].default_value = 0.03; ao_in.samples = 8
    ao_out = _n(nt, 'ShaderNodeAmbientOcclusion', (loc[0], loc[1] - 200)); ao_out.inside = True
    ao_out.inputs['Distance'].default_value = 0.012; ao_out.samples = 8
    cav = maprange(nt, ao_in.outputs['AO'], 0.35, 0.95, 1.0, 0.0, (loc[0] + 200, loc[1]))
    edge = maprange(nt, ao_out.outputs['AO'], 0.55, 0.95, 1.0, 0.0, (loc[0] + 200, loc[1] - 200))
    return edge, cav


def seam_detail(nt, base_col, bump_list, loc=(-400, -1200), strength=1.0):
    """Seams from the 'seam' attribute (1 on the seam line, falling to 0 at ~6 mm): a sunken groove with a raised
    welt either side, and two rows of darker stitches from 'stitch' (a running coordinate along the seam)."""
    sd = attr(nt, 'seam', loc)
    st = attr(nt, 'stitch', (loc[0], loc[1] - 150))
    groove = maprange(nt, sd, 0.8, 1.0, 0.0, 1.0, (loc[0] + 200, loc[1]), 'SMOOTHSTEP')
    welt = maprange(nt, sd, 0.15, 0.6, 0.0, 1.0, (loc[0] + 200, loc[1] - 100), 'SMOOTHSTEP')
    h = math(nt, 'SUBTRACT', welt, math(nt, 'MULTIPLY', groove, 1.6), (loc[0] + 400, loc[1]))
    bump_list.append((h, 0.5 * strength, 0.0012))
    # stitches: rows where seam ~ 0.45 (about 3 mm off the seam), dashes from the running coordinate
    row = maprange(nt, math(nt, 'ABSOLUTE', math(nt, 'SUBTRACT', sd, 0.42)), 0.0, 0.07, 1.0, 0.0, (loc[0] + 200, loc[1] - 250))
    dash = maprange(nt, math(nt, 'SINE', math(nt, 'MULTIPLY', st, 6283.0 / 3.0)), 0.1, 0.5, 0.0, 1.0, (loc[0] + 200, loc[1] - 350))
    stitch = math(nt, 'MULTIPLY', row, dash, (loc[0] + 400, loc[1] - 300))
    bump_list.append((stitch, 0.35 * strength, 0.0006))
    col = mix_rgb(nt, base_col, (0.12, 0.11, 0.08), math(nt, 'MULTIPLY', stitch, 0.55), 'MIX', (loc[0] + 600, loc[1] - 200))
    col = mix_rgb(nt, col, (0.3, 0.28, 0.24), math(nt, 'MULTIPLY', groove, 0.5), 'MULTIPLY', (loc[0] + 800, loc[1] - 200))
    return col


def denison(name='denison', seed=0.0, fade=0.0):
    """Denison smock: heavy cotton drill, hand-painted brushstrokes (pale green + chocolate brown) on a sandy khaki
    base, faded and grimy, twill weave, worn pale on edges, dirt in folds."""
    m, nt, b = new(name); L = nt.links
    v = coords(nt, rot=(0.0, 0.62, 0.15))                      # strokes run diagonally across the front
    w = coords(nt, rot=(0.0, 0.0, 0.0), loc=(-1600, -400))
    vs = _n(nt, 'ShaderNodeMapping', (-1200, 0)); vs.inputs['Scale'].default_value = (1.0, 1.0, 4.2)
    vs.inputs['Location'].default_value = (seed, seed * 0.7, seed * 1.3)
    L.new(v, vs.inputs['Vector']); vv = vs.outputs['Vector']
    # stroke fields: two sets of elongated blobs, edges broken by dry-brush streaks running along the stroke
    n_green = noise(nt, vv, 4.6, 3.0, 0.5, (-1000, 300), distortion=0.4)
    n_brown = noise(nt, vv, 3.6, 3.0, 0.5, (-1000, 100), distortion=0.35, lac=2.3)
    streak = _n(nt, 'ShaderNodeMapping', (-1200, -200)); streak.inputs['Scale'].default_value = (70.0, 70.0, 2.5)
    L.new(v, streak.inputs['Vector'])
    n_str = noise(nt, streak.outputs['Vector'], 1.0, 2.0, 0.5, (-1000, -200))
    brk = math(nt, 'MULTIPLY', math(nt, 'SUBTRACT', n_str.outputs['Fac'], 0.5), 0.26, (-800, -200))
    g = maprange(nt, math(nt, 'ADD', n_green.outputs['Fac'], brk), 0.485, 0.505, 0.0, 1.0, (-600, 300))
    br = maprange(nt, math(nt, 'ADD', n_brown.outputs['Fac'], brk), 0.535, 0.555, 0.0, 1.0, (-600, 100))
    base = LIN((180, 160, 112))
    green = LIN((86, 94, 52))
    brown = LIN((74, 50, 33))
    # base with mottling
    mott = noise(nt, w, 18.0, 6.0, 0.6, (-1000, -500))
    col = mix_rgb(nt, base, (base[0] * 0.8, base[1] * 0.82, base[2] * 0.78), maprange(nt, mott.outputs['Fac'], 0.35, 0.7), 'MIX', (-400, 500))
    # paint density varies inside a stroke (thin / thick paint)
    dens = noise(nt, streak.outputs['Vector'], 0.35, 3.0, 0.6, (-1000, -350))
    pd = maprange(nt, dens.outputs['Fac'], 0.3, 0.7, 0.78, 1.0, (-800, -350))
    col = mix_rgb(nt, col, green, math(nt, 'MULTIPLY', g, pd), 'MIX', (-200, 500))
    col = mix_rgb(nt, col, brown, math(nt, 'MULTIPLY', br, pd), 'MIX', (0, 500))
    # fading + grime
    edge, cav = wear_masks(nt)
    grime_n = noise(nt, w, 3.0, 5.0, 0.65, (-1000, -700))
    grime = math(nt, 'ADD', math(nt, 'MULTIPLY', cav, 0.6), math(nt, 'MULTIPLY', maprange(nt, grime_n.outputs['Fac'], 0.45, 0.75), 0.3), (-300, -700), clamp=True)
    col = mix_rgb(nt, col, LIN((60, 52, 40)), math(nt, 'MULTIPLY', grime, 0.55), 'MULTIPLY', (200, 500))
    col = mix_rgb(nt, col, LIN((200, 188, 156)), math(nt, 'MULTIPLY', edge, 0.22), 'MIX', (400, 500))
    if fade:
        col = mix_rgb(nt, col, LIN((186, 172, 136)), fade, 'MIX', (500, 500))
    bumps = []
    col = seam_detail(nt, col, bumps)
    L.new(col, b.inputs['Base Color'])
    # twill: fine diagonal ribs + slub noise
    tw = _n(nt, 'ShaderNodeTexWave', (-600, -1000)); tw.wave_type = 'BANDS'; tw.bands_direction = 'DIAGONAL'
    tw.inputs['Scale'].default_value = 900.0; tw.inputs['Distortion'].default_value = 1.5; tw.inputs['Detail'].default_value = 1.0
    L.new(w, tw.inputs['Vector'])
    slub = noise(nt, w, 160.0, 3.0, 0.6, (-600, -1150))
    crumple = noise(nt, w, 45.0, 4.0, 0.62, (-600, -1300), distortion=0.8)       # worn-in creases, 1-3 cm
    bumps += [(tw.outputs['Fac'], 0.25, 0.0004), (slub.outputs['Fac'], 0.3, 0.0008), (crumple.outputs['Fac'], 0.35, 0.002)]
    L.new(bump_chain(nt, bumps), b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.86
    b.inputs['Sheen Weight'].default_value = 0.25; b.inputs['Sheen Roughness'].default_value = 0.6
    b.inputs['Specular IOR Level'].default_value = 0.35
    return m


def serge(name='serge', color=(104, 88, 58)):
    """Battledress wool serge: khaki-brown twill, felted, fuzzy sheen."""
    m, nt, b = new(name); L = nt.links
    w = coords(nt)
    mott = noise(nt, w, 14.0, 5.0, 0.6, (-1000, 300))
    col = mix_rgb(nt, LIN(color), tuple(c * 0.8 for c in LIN(color)), maprange(nt, mott.outputs['Fac'], 0.35, 0.7), 'MIX', (-400, 300))
    edge, cav = wear_masks(nt)
    col = mix_rgb(nt, col, LIN((60, 50, 38)), math(nt, 'MULTIPLY', cav, 0.5), 'MULTIPLY', (0, 300))
    col = mix_rgb(nt, col, tuple(min(1, c * 1.35) for c in LIN(color)), math(nt, 'MULTIPLY', edge, 0.35), 'MIX', (200, 300))
    bumps = []
    col = seam_detail(nt, col, bumps, strength=0.8)
    L.new(col, b.inputs['Base Color'])
    tw = _n(nt, 'ShaderNodeTexWave', (-600, -1000)); tw.wave_type = 'BANDS'; tw.bands_direction = 'DIAGONAL'
    tw.inputs['Scale'].default_value = 650.0; tw.inputs['Distortion'].default_value = 2.0
    L.new(w, tw.inputs['Vector'])
    fuzz = noise(nt, w, 300.0, 4.0, 0.7, (-600, -1150))
    bumps += [(tw.outputs['Fac'], 0.15, 0.0004), (fuzz.outputs['Fac'], 0.3, 0.0005)]
    L.new(bump_chain(nt, bumps), b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.92
    b.inputs['Sheen Weight'].default_value = 0.6; b.inputs['Sheen Roughness'].default_value = 0.4
    b.inputs['Specular IOR Level'].default_value = 0.25
    return m


def felt(name='beret', color=(36, 54, 36)):
    """Commando beret: dense felted wool, dark green, fine fuzz, soft sheen, slightly faded on the crown."""
    m, nt, b = new(name); L = nt.links
    w = coords(nt)
    mott = noise(nt, w, 30.0, 6.0, 0.65, (-1000, 300))
    col = mix_rgb(nt, LIN(color), tuple(c * 0.75 for c in LIN(color)), maprange(nt, mott.outputs['Fac'], 0.3, 0.75), 'MIX', (-400, 300))
    edge, cav = wear_masks(nt)
    col = mix_rgb(nt, col, tuple(min(1, c * 1.4) for c in LIN(color)), math(nt, 'MULTIPLY', edge, 0.4), 'MIX', (0, 300))
    col = mix_rgb(nt, col, LIN((30, 30, 24)), math(nt, 'MULTIPLY', cav, 0.5), 'MULTIPLY', (200, 300))
    L.new(col, b.inputs['Base Color'])
    fz = noise(nt, w, 900.0, 3.0, 0.7, (-600, -1000))
    pil = noise(nt, w, 120.0, 4.0, 0.6, (-600, -1150))
    L.new(bump_chain(nt, [(fz.outputs['Fac'], 0.45, 0.0003), (pil.outputs['Fac'], 0.3, 0.0008)]), b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 1.0
    b.inputs['Sheen Weight'].default_value = 0.45; b.inputs['Sheen Roughness'].default_value = 0.5
    b.inputs['Sheen Tint'].default_value = (0.7, 0.8, 0.65, 1)
    b.inputs['Specular IOR Level'].default_value = 0.08
    return m


def webbing_box(name='webbing_box', color=(112, 110, 74)):
    """The same blancoed webbing on the pouch bodies and lids (no UVs): a 3D basket weave in the object's own axes
    (the pouch's x across, y up, z out), blanco applied unevenly, grime settled toward the bottom, pale worn edges."""
    m, nt, b = new(name); L = nt.links
    tc = _n(nt, 'ShaderNodeTexCoord', (-1600, -300))
    sep = _n(nt, 'ShaderNodeSeparateXYZ', (-1400, -300)); L.new(tc.outputs['Object'], sep.inputs['Vector'])
    k = 2500.0
    sx = math(nt, 'SINE', math(nt, 'MULTIPLY', sep.outputs['X'], k), None, (-1200, -200))
    sy = math(nt, 'SINE', math(nt, 'MULTIPLY', sep.outputs['Y'], k * 0.92), None, (-1200, -350))
    sz = math(nt, 'SINE', math(nt, 'MULTIPLY', sep.outputs['Z'], k), None, (-1200, -500))
    weave = math(nt, 'ADD', math(nt, 'ADD', math(nt, 'MULTIPLY', sx, sy), math(nt, 'MULTIPLY', sy, sz)), math(nt, 'MULTIPLY', sx, sz), (-1000, -350))
    w = coords(nt)
    mott = noise(nt, w, 30.0, 6.0, 0.62, (-1000, 300))
    blot = noise(nt, w, 9.0, 4.0, 0.6, (-1000, 150))
    col = mix_rgb(nt, LIN(color), tuple(c * 0.74 for c in LIN(color)), maprange(nt, mott.outputs['Fac'], 0.3, 0.75), 'MIX', (-400, 300))
    col = mix_rgb(nt, col, tuple(min(1.0, c * 1.25) for c in LIN(color)), math(nt, 'MULTIPLY', maprange(nt, blot.outputs['Fac'], 0.55, 0.7), 0.5), 'MIX', (-300, 300))
    edge, cav = wear_masks(nt)
    low = maprange(nt, sep.outputs['Y'], 0.0, 0.08, 1.0, 0.0, (-600, 0))
    dirt = math(nt, 'ADD', math(nt, 'MULTIPLY', cav, 0.7), math(nt, 'MULTIPLY', low, 0.35), (-400, 0), clamp=True)
    col = mix_rgb(nt, col, LIN((52, 46, 34)), math(nt, 'MULTIPLY', dirt, 0.6), 'MULTIPLY', (0, 300))
    col = mix_rgb(nt, col, LIN((176, 170, 132)), math(nt, 'MULTIPLY', edge, 0.6), 'MIX', (200, 300))
    bumps = [(weave, 0.35, 0.0005)]
    fz = noise(nt, w, 380.0, 3.0, 0.6, (-600, -1000))
    bumps.append((fz.outputs['Fac'], 0.2, 0.0004))
    col = seam_detail(nt, col, bumps, strength=0.9)
    L.new(col, b.inputs['Base Color'])
    L.new(bump_chain(nt, bumps), b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.92
    b.inputs['Sheen Weight'].default_value = 0.2
    b.inputs['Specular IOR Level'].default_value = 0.25
    return m


def webbing(name='webbing', color=(112, 110, 74)):
    """1937-pattern cotton webbing, blancoed khaki-green: a coarse basket weave across the strap ('weave' runs on the
    strap UV: U along, V across), chalky colour, grimy, pale on the edges."""
    m, nt, b = new(name); L = nt.links
    uvn = _n(nt, 'ShaderNodeUVMap', (-1600, -300))
    sc = _n(nt, 'ShaderNodeMapping', (-1400, -300)); sc.inputs['Scale'].default_value = (1.0, 1.0, 1.0)
    L.new(uvn.outputs['UV'], sc.inputs['Vector'])
    sep = _n(nt, 'ShaderNodeSeparateXYZ', (-1200, -300)); L.new(uvn.outputs['UV'], sep.inputs['Vector'])
    # weave: U (metres along the strap) x 700 warp ribs, V across
    ribs = math(nt, 'SINE', math(nt, 'MULTIPLY', sep.outputs['X'], 2600.0), None, (-1000, -300))
    picks = math(nt, 'SINE', math(nt, 'MULTIPLY', sep.outputs['Y'], 2400.0), None, (-1000, -450))
    weave = math(nt, 'MULTIPLY', ribs, picks, (-800, -350))
    w = coords(nt)
    mott = noise(nt, w, 22.0, 5.0, 0.6, (-1000, 300))
    col = mix_rgb(nt, LIN(color), tuple(c * 0.82 for c in LIN(color)), maprange(nt, mott.outputs['Fac'], 0.3, 0.75), 'MIX', (-400, 300))
    edge, cav = wear_masks(nt)
    col = mix_rgb(nt, col, LIN((60, 55, 40)), math(nt, 'MULTIPLY', cav, 0.6), 'MULTIPLY', (0, 300))
    col = mix_rgb(nt, col, LIN((168, 164, 128)), math(nt, 'MULTIPLY', edge, 0.4), 'MIX', (200, 300))
    # stitched boxes / edge rows from the 'stitch' UV-space attribute if present
    bumps = [(weave, 0.7, 0.0008)]
    fz = noise(nt, w, 400.0, 3.0, 0.6, (-600, -1000))
    bumps.append((fz.outputs['Fac'], 0.15, 0.0003))
    col = seam_detail(nt, col, bumps, strength=0.8)
    L.new(col, b.inputs['Base Color'])
    L.new(bump_chain(nt, bumps), b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.9
    b.inputs['Sheen Weight'].default_value = 0.15
    b.inputs['Specular IOR Level'].default_value = 0.3
    return m


def brass(name='brass', tarnish=0.55):
    m, nt, b = new(name); L = nt.links
    w = coords(nt)
    n = noise(nt, w, 160.0, 5.0, 0.6, (-1000, 300))
    edge, cav = wear_masks(nt)
    col = mix_rgb(nt, LIN((176, 132, 62)), LIN((96, 76, 40)), math(nt, 'MULTIPLY', maprange(nt, n.outputs['Fac'], 0.3, 0.7), tarnish), 'MIX', (-400, 300))
    col = mix_rgb(nt, col, LIN((40, 34, 22)), math(nt, 'MULTIPLY', cav, 0.7), 'MIX', (-200, 300))
    col = mix_rgb(nt, col, LIN((226, 190, 110)), math(nt, 'MULTIPLY', edge, 0.7), 'MIX', (0, 300))
    L.new(col, b.inputs['Base Color'])
    b.inputs['Metallic'].default_value = 1.0
    r = maprange(nt, n.outputs['Fac'], 0.3, 0.7, 0.25, 0.5)
    L.new(math(nt, 'SUBTRACT', r, math(nt, 'MULTIPLY', edge, 0.15)), b.inputs['Roughness'])
    L.new(bump_chain(nt, [(n.outputs['Fac'], 0.15, 0.0003)]), b.inputs['Normal'])
    return m


def blackened(name='blacksteel'):
    """Blued / blackened steel (FS knife grip, rivets) with worn edges."""
    m, nt, b = new(name); L = nt.links
    w = coords(nt)
    n = noise(nt, w, 300.0, 5.0, 0.6, (-1000, 300))
    edge, cav = wear_masks(nt)
    col = mix_rgb(nt, LIN((34, 34, 36)), LIN((120, 118, 112)), math(nt, 'MULTIPLY', edge, 0.6), 'MIX', (-200, 300))
    L.new(col, b.inputs['Base Color'])
    b.inputs['Metallic'].default_value = 0.9
    L.new(maprange(nt, n.outputs['Fac'], 0.3, 0.7, 0.32, 0.5), b.inputs['Roughness'])
    return m


def leather(name='leather', color=(74, 46, 28)):
    m, nt, b = new(name); L = nt.links
    w = coords(nt)
    vor = _n(nt, 'ShaderNodeTexVoronoi', (-1000, -600)); vor.feature = 'DISTANCE_TO_EDGE'; vor.inputs['Scale'].default_value = 600.0
    L.new(w, vor.inputs['Vector'])
    n = noise(nt, w, 40.0, 6.0, 0.6, (-1000, 300))
    edge, cav = wear_masks(nt)
    col = mix_rgb(nt, LIN(color), tuple(c * 0.6 for c in LIN(color)), maprange(nt, n.outputs['Fac'], 0.3, 0.75), 'MIX', (-400, 300))
    col = mix_rgb(nt, col, tuple(min(1, c * 1.8) for c in LIN(color)), math(nt, 'MULTIPLY', edge, 0.6), 'MIX', (-200, 300))
    col = mix_rgb(nt, col, (0.01, 0.008, 0.006), math(nt, 'MULTIPLY', cav, 0.6), 'MIX', (0, 300))
    L.new(col, b.inputs['Base Color'])
    L.new(maprange(nt, n.outputs['Fac'], 0.3, 0.7, 0.4, 0.62), b.inputs['Roughness'])
    L.new(bump_chain(nt, [(vor.outputs['Distance'], 0.3, 0.0003)]), b.inputs['Normal'])
    b.inputs['Coat Weight'].default_value = 0.15
    return m


def knit(name='knit', color=(110, 96, 66)):
    """Knitted wool (cuffs, shirt collar): rib wales along the object Z + fuzz."""
    m, nt, b = new(name); L = nt.links
    w = coords(nt)
    wv = _n(nt, 'ShaderNodeTexWave', (-600, -600)); wv.wave_type = 'RINGS'; wv.inputs['Scale'].default_value = 300.0
    L.new(w, wv.inputs['Vector'])
    fz = noise(nt, w, 500.0, 3.0, 0.7, (-600, -800))
    b.inputs['Base Color'].default_value = (*LIN(color), 1)
    L.new(bump_chain(nt, [(wv.outputs['Fac'], 0.4, 0.001), (fz.outputs['Fac'], 0.3, 0.0004)]), b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.95
    b.inputs['Sheen Weight'].default_value = 0.8; b.inputs['Sheen Roughness'].default_value = 0.4
    return m


def wood(name='wood', color=(118, 80, 46)):
    m, nt, b = new(name); L = nt.links
    w = coords(nt, scale=(1, 1, 0.08))
    wv = _n(nt, 'ShaderNodeTexWave', (-600, 0)); wv.wave_type = 'RINGS'; wv.inputs['Scale'].default_value = 40.0
    wv.inputs['Distortion'].default_value = 6.0; wv.inputs['Detail'].default_value = 3.0
    L.new(w, wv.inputs['Vector'])
    col = mix_rgb(nt, LIN(color), tuple(c * 0.55 for c in LIN(color)), maprange(nt, wv.outputs['Fac'], 0.2, 0.8), 'MIX', (-200, 0))
    L.new(col, b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.6
    L.new(bump_chain(nt, [(wv.outputs['Fac'], 0.1, 0.0004)]), b.inputs['Normal'])
    return m


def rope(name='rope', color=(150, 130, 92)):
    """Hemp / sisal toggle rope: strand twist from the 'stitch' attribute (running length) + fibre fuzz."""
    m, nt, b = new(name); L = nt.links
    w = coords(nt)
    fz = noise(nt, w, 700.0, 3.0, 0.7, (-600, -800))
    mott = noise(nt, w, 30.0, 4.0, 0.6, (-1000, 300))
    col = mix_rgb(nt, LIN(color), tuple(c * 0.6 for c in LIN(color)), maprange(nt, mott.outputs['Fac'], 0.3, 0.75), 'MIX', (-400, 300))
    edge, cav = wear_masks(nt)
    col = mix_rgb(nt, col, LIN((40, 34, 24)), math(nt, 'MULTIPLY', cav, 0.7), 'MULTIPLY', (-200, 300))
    L.new(col, b.inputs['Base Color'])
    tw = attr(nt, 'twist', (-800, -500))
    tws = math(nt, 'SINE', tw)
    L.new(bump_chain(nt, [(tws, 0.6, 0.002), (fz.outputs['Fac'], 0.3, 0.0004)]), b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.9
    b.inputs['Sheen Weight'].default_value = 0.5
    return m


def mills(name='mills'):
    """No. 36M grenade: cast iron, dark green-khaki paint, chipped to grey iron on the segments' ridges."""
    m, nt, b = new(name); L = nt.links
    edge, cav = wear_masks(nt)
    col = mix_rgb(nt, LIN((76, 82, 56)), LIN((116, 114, 102)), math(nt, 'MULTIPLY', edge, 0.85), 'MIX', (-200, 300))
    L.new(col, b.inputs['Base Color'])
    L.new(maprange(nt, edge, 0, 1, 0.6, 0.38), b.inputs['Roughness'])
    L.new(maprange(nt, edge, 0, 1, 0.0, 0.7), b.inputs['Metallic'])
    return m


def gunmetal(name='gunmetal'):
    """Worn bare steel for the grenade's fuze head, lever and ring: mid-grey and bright on the edges, so the
    fittings read against the dark painted body (they were blackened steel before and vanished into it)."""
    m, nt, b = new(name); L = nt.links
    w = coords(nt)
    n = noise(nt, w, 300.0, 5.0, 0.6, (-1000, 300))
    edge, cav = wear_masks(nt)
    col = mix_rgb(nt, LIN((92, 92, 88)), LIN((160, 158, 150)), math(nt, 'MULTIPLY', edge, 0.75), 'MIX', (-200, 300))
    col = mix_rgb(nt, col, LIN((52, 52, 50)), math(nt, 'MULTIPLY', cav, 0.5), 'MULTIPLY', (-100, 300))
    L.new(col, b.inputs['Base Color'])
    b.inputs['Metallic'].default_value = 0.9
    L.new(maprange(nt, n.outputs['Fac'], 0.3, 0.7, 0.36, 0.52), b.inputs['Roughness'])
    return m
