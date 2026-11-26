# lion.py - a circus lion (maned male) or lioness for e03 "Winter Quarters": skin-modifier body with a broad head and
# jowls, a shaggy mane shell (male), rounded ears, a long tail with a dark tuft; the guard dog's rig layout (dog_geo.py)
# so dogkit's gait / paw-contact measures work unchanged, plus a fourth tail bone. Forward = -Y, Z up, metres.
import math, random
from mathutils import Vector, Matrix, noise
import animal_lib as A


def joints(fem, rnd):
    s = 0.89 if fem else 1.0
    # (round 2: a big cat, not a plush toy — the chest deep and let down into a brisket keel between the forelegs, the
    #  waist tucked up behind the ribs, the rump falling to the tail; the lioness's muzzle longer and her brow flatter)
    J = {
        'hip': (0, 0.47, 0.86), 'loin': (0, 0.20, 0.885), 'back': (0, -0.08, 0.90), 'chest': (0, -0.32, 0.83), 'wither': (0, -0.44, 0.95),
        'brisket': (0, -0.40, 0.60),
        'neck1': (0, -0.58, 0.98), 'head': (0, -0.75, 1.03), 'stop': (0, -0.905, 0.995), 'nose': (0, -1.05, 0.93),
        'jowl_l': (0.078, -0.955, 0.932), 'jowl_r': (-0.078, -0.955, 0.932),
        'tail0': (0, 0.58, 0.84), 'tail1': (0, 0.73, 0.70), 'tail2': (0, 0.83, 0.52), 'tail3': (0, 0.90, 0.34), 'tail4': (0, 0.95, 0.18),
    }
    if fem:
        J.update({'head': (0, -0.745, 1.02), 'stop': (0, -0.895, 0.99), 'nose': (0, -1.05, 0.915),
                  'jowl_l': (0.062, -0.955, 0.925), 'jowl_r': (-0.062, -0.955, 0.925)})
    for sd, x in (('l', 1), ('r', -1)):
        J.update({f'shoulder_{sd}': (x * 0.13, -0.34, 0.70), f'elbow_{sd}': (x * 0.125, -0.27, 0.47), f'wrist_{sd}': (x * 0.115, -0.30, 0.14),
                  f'fpaw_{sd}': (x * 0.115, -0.37, 0.04),
                  f'hipj_{sd}': (x * 0.145, 0.42, 0.74), f'knee_{sd}': (x * 0.15, 0.27, 0.49), f'hock_{sd}': (x * 0.13, 0.54, 0.21),
                  f'hpaw_{sd}': (x * 0.125, 0.49, 0.04)})
    return {k: tuple(c * s for c in v) for k, v in J.items()}, s


def radii(fem, s):
    k = s * (0.9 if fem else 1.0)
    R = {'hip': (0.18, 0.21), 'loin': (0.145, 0.16), 'back': (0.19, 0.25), 'chest': (0.22, 0.30), 'wither': (0.17, 0.22),
         'brisket': (0.12, 0.10),
         'neck1': (0.15, 0.17), 'head': (0.172, 0.15), 'stop': (0.122, 0.104), 'nose': (0.072, 0.062),
         'jowl_l': (0.07, 0.058), 'jowl_r': (0.07, 0.058),
         'tail0': (0.048, 0.048), 'tail1': (0.038, 0.038), 'tail2': (0.031, 0.031), 'tail3': (0.026, 0.026), 'tail4': (0.022, 0.022)}
    for sd in 'lr':
        # (heavy shoulders and haunches, the legs tapering to the wrists and hocks, big round paws)
        R.update({f'shoulder_{sd}': (0.14, 0.19), f'elbow_{sd}': (0.088, 0.095), f'wrist_{sd}': (0.058, 0.056), f'fpaw_{sd}': (0.088, 0.05),
                  f'hipj_{sd}': (0.15, 0.23), f'knee_{sd}': (0.088, 0.10), f'hock_{sd}': (0.05, 0.05), f'hpaw_{sd}': (0.076, 0.046)})
    if fem:   # the lioness: a lighter, longer head and a slimmer neck and chest
        for kk, f in (('head', 0.9), ('neck1', 0.9), ('chest', 0.94), ('wither', 0.92), ('brisket', 0.9), ('stop', 0.9), ('nose', 0.9),
                      ('jowl_l', 0.82), ('jowl_r', 0.82)):
            R[kk] = (R[kk][0] * f, R[kk][1] * f)
    return {kk: (v[0] * k, v[1] * k) for kk, v in R.items()}


EDGES = [('hip', 'loin'), ('loin', 'back'), ('back', 'chest'), ('chest', 'wither'), ('wither', 'neck1'), ('neck1', 'head'), ('head', 'stop'), ('stop', 'nose'),
         ('chest', 'brisket'),
         ('stop', 'jowl_l'), ('stop', 'jowl_r'),
         ('hip', 'tail0'), ('tail0', 'tail1'), ('tail1', 'tail2'), ('tail2', 'tail3'), ('tail3', 'tail4')]
for _s in 'lr':
    EDGES += [('chest', f'shoulder_{_s}'), (f'shoulder_{_s}', f'elbow_{_s}'), (f'elbow_{_s}', f'wrist_{_s}'), (f'wrist_{_s}', f'fpaw_{_s}'),
              ('hip', f'hipj_{_s}'), (f'hipj_{_s}', f'knee_{_s}'), (f'knee_{_s}', f'hock_{_s}'), (f'hock_{_s}', f'hpaw_{_s}')]


def bones(J, s):
    B = {'root': ((0, 0.05, 0.0), (0, -0.25, 0.0), None),
         'pelvis': ('hip', 'loin', 'root'), 'spine': ('loin', 'back', 'pelvis'), 'chest': ('back', 'wither', 'spine'),
         'neck': ('wither', 'head', 'chest'), 'head': ('head', 'nose', 'neck'),
         'jaw': ((0, -0.83 * s, 0.905 * s), (0, -0.985 * s, 0.875 * s), 'head'),
         'ear_l': ((0.095 * s, -0.715 * s, 1.135 * s), (0.11 * s, -0.71 * s, 1.21 * s), 'head'),
         'ear_r': ((-0.095 * s, -0.715 * s, 1.135 * s), (-0.11 * s, -0.71 * s, 1.21 * s), 'head'),
         'tail1': ('tail0', 'tail1', 'pelvis'), 'tail2': ('tail1', 'tail2', 'tail1'), 'tail3': ('tail2', 'tail3', 'tail2'), 'tail4': ('tail3', 'tail4', 'tail3')}
    for sd in 'lr':
        B.update({f'upperarm_{sd}': (f'shoulder_{sd}', f'elbow_{sd}', 'chest'), f'forearm_{sd}': (f'elbow_{sd}', f'wrist_{sd}', f'upperarm_{sd}'),
                  f'fpaw_{sd}': (f'wrist_{sd}', f'fpaw_{sd}', f'forearm_{sd}'),
                  f'thigh_{sd}': (f'hipj_{sd}', f'knee_{sd}', 'pelvis'), f'shin_{sd}': (f'knee_{sd}', f'hock_{sd}', f'thigh_{sd}'),
                  f'hpaw_{sd}': (f'hock_{sd}', f'hpaw_{sd}', f'shin_{sd}')})
    return B


def parts(s, fem=False, body=None):
    # the ears, eyes and nose pad are set ON the head the skin modifier made (rays cast at it), not at fixed numbers:
    # a bigger or smaller head no longer leaves the ears floating over the skull or the nose pad in front of the muzzle
    hk = 0.88 if fem else 1.0

    def hit(origin, d, fallback):
        if body is not None:
            ok, loc, nrm, _ = body.ray_cast(Vector(origin), Vector(d))
            if ok:
                return Vector(loc), Vector(nrm)
        return Vector(fallback), Vector((0, -1, 0))

    def ear(x):
        def fn(bm):
            top, n = hit((x * 0.085 * hk * s, -0.735 * s, 2.0), (0, 0, -1), (x * 0.1 * hk * s, -0.712 * s, (1.03 + 0.14 * hk) * s))
            c = top + Vector((0, 0, 0.026 * hk * s)) + n * 0.004 * s     # (its base sunk in the fur, the round of it up)
            A.bm_sphere(bm, 1.0, Matrix.Translation(c) @ Matrix.Rotation(math.radians(-14 * x), 4, 'Y')
                        @ Matrix.Diagonal((0.044 * hk * s, 0.018 * s, 0.042 * hk * s, 1)), u=10, v=7)
        return fn

    def eyes(bm):
        for x in (1, -1):
            p, n = hit((x * 0.066 * hk * s, -2.0, 1.06 * s), (0, 1, 0), (x * 0.07 * hk * s, -0.885 * s, 1.065 * s))
            A.bm_sphere(bm, 0.017 * s, Matrix.Translation(p - n * 0.006 * s), u=8, v=6)

    def nose(bm):
        p, n = hit((0, -2.0, (0.955 if not fem else 0.94) * s), (0, 1, 0), (0, -1.05 * s, 0.95 * s))
        A.bm_sphere(bm, 1.0, Matrix.Translation(p - n * 0.004 * s) @ Matrix.Diagonal((0.026 * s, 0.012 * s, 0.017 * s, 1)), u=10, v=6)

    def jaw(bm):
        y1 = -1.0 if fem else -0.99
        A.bm_cone(bm, 0.044 * s, 0.03 * s, abs(y1 + 0.86) * s, A.seg_matrix((0, -0.86 * s, 0.9 * s), (0, y1 * s, 0.892 * s)), segs=10)

    def tuft(bm):   # the tail's tuft: a dark hank of hair past the last vertebra, three locks in a teardrop
        a, b = Vector((0, 0.90 * s, 0.34 * s)), Vector((0, 0.95 * s, 0.18 * s))
        d = (b - a).normalized()
        for k, (ox, oy, L, r) in enumerate(((0.0, 0.0, 0.13, 0.042), (0.016, 0.01, 0.11, 0.03), (-0.014, -0.008, 0.1, 0.028))):
            c = b + d * (L * 0.38 * s) + Vector((ox * s, oy * s, 0))
            A.bm_sphere(bm, 1.0, A.seg_matrix(c - d * (L * 0.5 * s), c + d * (L * 0.5 * s)) @ Matrix.Diagonal((r * s, r * s, L * 0.5 * s, 1)), u=8, v=6)
    builders = [('ear_l', ear(1)), ('ear_r', ear(-1)), ('head', eyes), ('head', nose), ('jaw', jaw), ('tail4', tuft)]
    return A.parts_object('lion_parts', builders)


def mane(s, seed):
    # a ruff round the face and a heavy mane over the neck, shoulders and chest; the face opening cut in front
    # a closed volume behind the face (no opening to look into): its front pressed back into a dish round the face,
    # so the brow, eyes and muzzle come out of the ruff
    fc = Vector((0, -0.78 * s, 1.03 * s))

    def dent(co):
        d = co - fc
        r = math.hypot(d.x / (0.22 * s), (d.z) / (0.24 * s))
        if co.y < -0.62 * s and r < 1.0:
            push = (1 - r * r) ** 1.2 * 0.26 * s
            co = co.copy(); co.y += push
        return co
    o = A.shaggy_shell('lion_mane', (0, -0.55 * s, 0.95 * s), (0.30 * s, 0.30 * s, 0.37 * s), subdiv=4, seed=seed,
                       amp=0.06 * s, freq=4.6, droop=0.14 * s, tuft=0.016 * s, tuft_freq=11.0, back=0.05 * s, dent=dent)
    # the silhouette: clumps of hair out of the ruff and down the neck and chest (none over the face)
    def ok(co, n):
        return not (co.y < -0.68 * s and abs(co.x) < 0.2 * s and 0.84 * s < co.z < 1.22 * s) and n.y > -0.75
    roots = A.surface_roots(o, 420, ok, seed=seed)
    # (locks shingled back and down along the mane, of every length — a ragged ruff, matted at the chest, not a wig)
    cl = A.hair_clumps('lion_mane_clumps', roots, seed=seed, length=(0.06 * s, 0.17 * s), width=(0.026 * s, 0.05 * s), back=1.0, down=0.9,
                       curl=0.45, lift=0.35, flat=0.4)
    low = A.surface_roots(o, 70, lambda co, n: co.z < 0.78 * s and n.z < 0.2, seed=seed + 5)
    cl2 = A.hair_clumps('lion_mane_fringe', low, seed=seed + 5, length=(0.09 * s, 0.2 * s), width=(0.035 * s, 0.06 * s), back=0.4, down=1.4,
                        curl=0.3, lift=0.25, flat=0.45)
    return A.join([o, cl, cl2], 'lion_mane')


def build(fem, seed):
    rnd = random.Random(seed)
    J, s = joints(fem, rnd)
    R = radii(fem, s)
    body = A.skin_body('lion_body', J, R, EDGES, 'chest', levels=2)
    # muscle and fur lumps, strongest on the shoulders and haunches
    A.displace(body, 0.010 * s, 7.0, seed=seed)
    p = parts(s, fem, body)
    objs = [body, p]
    m = None
    if not fem:
        m = mane(s, seed)
        objs.append(m)
    rig = A.armature('lion_rig', bones(J, s), J)
    # auto weights on the body only (jaw / ears / root would steal the muzzle and skull)
    A.auto_weights(body, rig, nondeform=('root', 'jaw', 'ear_l', 'ear_r'))
    A.rigid_bind(p, rig)
    if m:
        ym = J['wither'][1]
        def mw(co):
            y = co.y
            h = A.sm((-(y) + 0.70 * s) / (0.08 * s) * -1) if False else 0
            t_head = A.sm((-0.66 * s - y) / (0.10 * s))     # in front: the head
            t_chest = A.sm((y - (-0.50 * s)) / (0.10 * s))  # behind: the chest
            return {'head': t_head, 'chest': t_chest, 'neck': max(0.0, 1.0 - t_head - t_chest)}
        A.weight_by(m, mw)
        A.rigid_bind(m, rig)
    return J, s, body, p, m, rig


def colours(fem, s, J, rnd):
    tone = rnd.uniform(0.94, 1.06)
    # (a deep tawny: the game's low winter sun and snow light bleach a paler coat to cream)
    coat = tuple(c * tone for c in ((0.66, 0.48, 0.27) if fem else (0.62, 0.43, 0.22)))
    belly = (0.86, 0.77, 0.60)
    dark = (0.40, 0.26, 0.13)
    off = Vector((rnd.uniform(0, 50), rnd.uniform(0, 50), rnd.uniform(0, 50)))

    def mix(c, d, w):
        return [a + (b - a) * w for a, b in zip(c, d)]

    def parts_col(co, gs):   # the rigid parts (lion.parts): ears, eyes, nose pad, lower jaw, the tail's tuft
        y = co.y / s
        if 'tail4' in gs:                     # the tuft: near black, browner at its root
            return (*mix((0.16, 0.10, 0.06), (0.08, 0.055, 0.04), A.sm((co.z / s - 0.12) / -0.1)), 0.45)
        if 'ear_l' in gs or 'ear_r' in gs:   # tawny ears, their backs near black
            back_ = A.sm((y + 0.70) / 0.02)
            return (*mix((0.60, 0.44, 0.27), (0.14, 0.10, 0.07), back_), 0.15)
        if 'jaw' in gs:                       # a pale chin, the lips' dark line along its top
            return (*mix((0.86, 0.78, 0.64), (0.22, 0.15, 0.11), A.sm((co.z / s - 0.885) / 0.012)), 0.2)
        if y < -1.0:
            return (0.30, 0.17, 0.15, 0.05)   # the nose pad
        return (0.46, 0.31, 0.09, 0.0)        # the eyes: amber

    def body_col(co, gs):
        z, y, x = co.z / s, co.y / s, co.x / s
        # the coat is never one flat colour: a broad mottle (paler and greyer flanks, a warmer back) and a fine one
        big = noise.noise(co * 2.2 + off); fine = noise.noise(co * 9.0 + off * 1.7)
        c = [v * (1 + 0.13 * big + 0.06 * fine) for v in coat]
        c = mix(c, (0.70, 0.60, 0.46), 0.22 * max(0.0, -big))
        legs = sum(w for g, w in gs.items() if g.startswith(('forearm', 'shin', 'fpaw', 'hpaw')))
        if legs > 0.2:                                        # the legs: darker down their outsides and backs, pale inside
            inner = A.sm((0.10 - abs(x)) / 0.04)
            c = mix(c, [v * 0.72 for v in coat], 0.55 * min(1.0, legs) * (1 - inner))
            c = mix(c, belly, 0.45 * inner * min(1.0, legs))
        if y < -0.96 and z < 0.99:                           # a pale upper lip and chin (not a white mask)
            w = 0.75 * A.sm((-0.96 - y) / 0.05) * A.sm((0.99 - z) / 0.03)
            c = mix(c, (0.88, 0.83, 0.74), w)
        if -0.92 < y < -0.80 and 0.98 < z < 1.08 and 0.035 < abs(x) < 0.1:   # the pale patches under the eyes
            c = mix(c, (0.88, 0.82, 0.70), 0.55 * A.sm((0.03 - abs(z - 1.02)) / 0.02))
        if not fem and -0.96 < y < -0.84 and z > 1.0 and abs(x) < 0.03:     # his nose bridge: darker
            c = mix(c, dark, 0.35)
        if -0.62 < y < 0.62 and z > 0.4:                     # the belly pale (not the legs' fronts); a dark line down the back
            limb = min(1.0, sum(w for g, w in gs.items() if g.startswith(('upperarm', 'thigh', 'forearm', 'shin'))))
            lt = A.sm((0.70 - z) / 0.14) * A.sm((0.18 - abs(x)) / 0.08) * (1 - limb)
            c = mix(c, belly, 0.8 * lt)
            dk = A.sm((z - 0.98) / 0.07) * A.sm((0.09 - abs(x)) / 0.06)
            c = mix(c, dark, 0.62 * dk)
        if z < 0.10:                                         # paws: dusty
            c = [a * 0.8 for a in c]
        if y > 0.84 and z < 0.40:                            # the end of the tail darkening into its tuft
            w = A.sm((0.40 - z) / 0.2)
            c = mix(c, (0.20, 0.13, 0.08), 0.8 * w)
        return (*c, 0.28)

    def mane_col(co, gs):
        y, z = co.y / s, co.z / s
        rim = A.sm((-0.70 - y) / 0.08)                       # the ruff round the face: blond
        back = A.sm((y + 0.52) / 0.18)                       # the back of the mane: darkest
        low = A.sm((0.80 - z) / 0.2)
        streak = noise.noise(co * 6.0 + off)                 # locks of different shades
        c = mix((0.42, 0.27, 0.13), (0.18, 0.11, 0.06), back)
        c = mix(c, (0.72, 0.54, 0.30), rim)
        c = mix(c, (0.24, 0.15, 0.08), 0.45 * low)
        c = [v * (1 + 0.16 * streak) for v in c]
        return (*[v * tone for v in c], 0.42)
    return body_col, mane_col, parts_col


def clips(rig, s):
    P = A.Poser(rig)
    meta = {}
    LEGS = {'fl': ('upperarm_l', 'forearm_l', 'fpaw_l'), 'fr': ('upperarm_r', 'forearm_r', 'fpaw_r'),
            'hl': ('thigh_l', 'shin_l', 'hpaw_l'), 'hr': ('thigh_r', 'shin_r', 'hpaw_r')}

    def leg(k, fwd, flex):
        a, b, c = LEGS[k]
        if k[0] == 'f':
            P.rot(a, -fwd - 8 * flex); P.rot(b, 62 * flex); P.rot(c, -38 * flex)
        else:
            P.rot(a, -fwd - 10 * flex); P.rot(b, 50 * flex); P.rot(c, -40 * flex)

    def gait(u, Am, beta):
        u %= 1.0
        if u < beta:
            return Am * (1 - 2 * u / beta), 0.0
        w = (u - beta) / (1 - beta)
        return -Am + 2 * Am * A.sm(w), math.sin(math.pi * w)

    def tail(u, amp, lift=0.0):
        P.rot('tail1', 12 + lift, 0, amp * math.sin(2 * math.pi * u)); P.rot('tail2', -6, 0, amp * 0.8 * math.sin(2 * math.pi * u - 0.6))
        P.rot('tail3', -8, 0, amp * 0.7 * math.sin(2 * math.pi * u - 1.2)); P.rot('tail4', -10, 0, amp * 0.9 * math.sin(2 * math.pi * u - 1.8))

    def loco(Am, beta, phases, bob, spine=0.0, head_bob=2.0, tl=8.0, head_low=6.0):
        def fn(u, t):
            for k, ph in phases.items():
                sw, fl = gait(u + ph, Am, beta)
                leg(k, sw, fl)
            P.loc('root', (0, 0, -bob * math.cos(4 * math.pi * u) - bob))
            if spine:
                P.rot('spine', spine * math.sin(2 * math.pi * u)); P.rot('chest', -spine * 0.6 * math.sin(2 * math.pi * u))
            # the shoulders roll as each foreleg takes the weight; the head carried low, swinging a little
            P.rot('chest', 0, 3.0 * math.sin(2 * math.pi * u), 2.0 * math.sin(2 * math.pi * u))
            P.rot('neck', -head_low + head_bob * math.sin(4 * math.pi * u), 0, 3 * math.sin(2 * math.pi * u)); P.rot('head', head_low * 0.6)
            tail(u, tl, -6)
        return fn
    lateral = {'hl': 0.0, 'fl': 0.25, 'hr': 0.5, 'fr': 0.75}
    A.make_clip(P, 'walk', 1.15, loco(21, 0.64, lateral, 0.012 * s, head_low=12))
    meta['walk'] = {'loop': True, 'duration': 1.15}
    A.make_clip(P, 'trot', 0.72, loco(27, 0.46, {'fl': 0.0, 'hr': 0.0, 'fr': 0.5, 'hl': 0.5}, 0.02 * s, head_bob=2, head_low=8))
    meta['trot'] = {'loop': True, 'duration': 0.72}
    A.make_clip(P, 'run', 0.56, loco(38, 0.36, {'hl': 0.0, 'hr': 0.08, 'fl': 0.5, 'fr': 0.58}, 0.04 * s, spine=9, head_bob=4, tl=5, head_low=2))
    meta['run'] = {'loop': True, 'duration': 0.56}

    def idle(u, t):
        br = math.sin(2 * math.pi * u * 3)                     # breathing
        P.rot('chest', 1.0 * br); P.rot('spine', -0.6 * br)
        P.rot('neck', -4 + 2 * math.sin(2 * math.pi * u), 0, 18 * math.sin(2 * math.pi * u))   # looks round slowly
        P.rot('head', 2, 0, 8 * math.sin(2 * math.pi * u + 1.1))
        P.rot('jaw', 6 * max(0.0, math.sin(2 * math.pi * u * 2 + 0.5)) ** 6)                   # a yawn-ish open now and then
        P.rot('ear_l', -10 * max(0.0, math.sin(2 * math.pi * u * 4)) ** 10); P.rot('ear_r', -10 * max(0.0, math.sin(2 * math.pi * u * 4 + 2)) ** 10)
        tail(u * 2, 14, -4)
        for k in LEGS:
            leg(k, 0, 0)
    A.make_clip(P, 'idle', 4.0, idle); meta['idle'] = {'loop': True, 'duration': 4.0}

    def attack(u, t):   # the lunge: gather on the haunches, rear and swipe with the forepaws, jaws open, come down
        g = A.sm(u / 0.25) * (1 - A.sm((u - 0.25) / 0.15))
        l = A.sm((u - 0.25) / 0.15) * (1 - A.sm((u - 0.72) / 0.28))
        jaw = 34 * A.sm((u - 0.22) / 0.12) * (1 - A.sm((u - 0.62) / 0.1))
        P.loc('root', (0, -0.35 * s * l, -0.08 * s * g + 0.16 * s * l)); P.rot('root', 10 * g - 24 * l)
        P.rot('chest', -10 * l); P.rot('neck', -4 - 18 * l); P.rot('head', -12 * l); P.rot('jaw', jaw)
        P.rot('ear_l', 30 * (g + l)); P.rot('ear_r', 30 * (g + l))
        leg('fl', -10 * g + 70 * l, 0.7 * l); leg('fr', -10 * g + 55 * l, 0.9 * l)
        leg('hl', 22 * g - 30 * l, 0.15); leg('hr', 22 * g - 26 * l, 0.15)
        tail(u, 20, 10 * l)
    # (0.6 s, the swipe landing at 0.22 s: the animal brain plays a strike as a 0.4 s action, ai/animal-brain.js)
    A.make_clip(P, 'attack', 0.6, attack); meta['attack'] = {'loop': True, 'duration': 0.6, 'events': {'strike': [0.22]}}

    lift = 0.2 * s

    def lying(w):
        P.loc('root', (-0.02 * w, 0, lift * w - 0.03 * math.sin(math.pi * w)))
        P.rot('root', 0, 86 * w); P.rot('neck', 18 * w, 0, 8 * w); P.rot('head', 10 * w); P.rot('jaw', 8 * w)
        P.rot('tail1', -26 * w); P.rot('tail2', -10 * w); P.rot('ear_l', 22 * w); P.rot('ear_r', 22 * w)
        leg('fl', 22 * w, 0.2 * w); leg('fr', 12 * w, 0.1 * w); leg('hl', -18 * w, 0.2 * w); leg('hr', -28 * w, 0.1 * w)

    def die(u, t):
        k = A.sm(u / 0.2) * (1 - A.sm((u - 0.2) / 0.2))
        P.rot('neck', -22 * k); P.rot('jaw', 30 * k)
        lying(A.sm((u - 0.15) / 0.6))
    A.make_clip(P, 'die', 1.5, die, loop=False); meta['die'] = {'loop': False, 'duration': 1.5}
    A.make_clip(P, 'dead', 1.0, lambda u, t: lying(1.0)); meta['dead'] = {'loop': True, 'duration': 1.0}
    for n in ('walk', 'trot', 'run'):
        meta[n]['groundSpeed'] = A.ground_speed(rig, __import__('bpy').data.actions[n], ['fpaw_l', 'fpaw_r', 'hpaw_l', 'hpaw_r'], meta[n]['duration'])
    rig.animation_data.action = __import__('bpy').data.actions['idle']
    P.clear()
    return meta
