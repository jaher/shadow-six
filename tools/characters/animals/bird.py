# bird.py - the e03 circus birds: ostriches (black-and-white cock, grey-brown hen) and farmyard hens (brown, white).
# A skin-modifier skeleton for the neck, head, thighs and shanks; the feathered body a shaggy shell with feather
# clumps (wing and tail plumes for the ostrich, a tail fan and wing coverts for the hen); beak, eyes, comb and wattles
# as rigid parts. Bones: root, pelvis, body, neck1..n, head, wing_l/r, tail, thigh/shin/tarsus/toe _l/r.
# Forward = -Y, Z up, metres.
import math, random, os
from mathutils import Vector, Matrix
import bpy
import animal_lib as A

SPEC = {
    # height scale, body centre / radii, neck chain (points), leg joints, colours
    'ostrich': dict(
        body=((0, -0.04, 1.12), (0.30, 0.52, 0.30)),
        neck=[(0, -0.40, 1.16), (0, -0.46, 1.42), (0, -0.49, 1.68), (0, -0.51, 1.92), (0, -0.54, 2.08)],
        head=(0, -0.60, 2.10), bill=(0, -0.72, 2.08),
        nrad=[(0.075, 0.08), (0.048, 0.05), (0.04, 0.042), (0.035, 0.036), (0.045, 0.042)], hrad=(0.05, 0.045), brad=(0.026, 0.012),
        hip=(0.13, 0.02, 1.0), knee=(0.15, -0.14, 0.78), ankle=(0.12, 0.05, 0.47), foot=(0.11, -0.01, 0.06), toe=(0.11, -0.17, 0.03),
        lrad=[(0.10, 0.12), (0.085, 0.09), (0.036, 0.036), (0.03, 0.028), (0.03, 0.016)],
        plumes=True,
    ),
    'hen': dict(
        body=((0, 0.0, 0.25), (0.085, 0.14, 0.095)),
        neck=[(0, -0.09, 0.29), (0, -0.11, 0.35)],
        head=(0, -0.13, 0.39), bill=(0, -0.175, 0.385),
        nrad=[(0.045, 0.05), (0.034, 0.036)], hrad=(0.028, 0.03), brad=(0.009, 0.007),
        hip=(0.04, 0.01, 0.21), knee=(0.045, -0.02, 0.14), ankle=(0.04, 0.02, 0.085), foot=(0.04, -0.005, 0.012), toe=(0.04, -0.045, 0.008),
        lrad=[(0.03, 0.035), (0.022, 0.024), (0.008, 0.008), (0.007, 0.007), (0.007, 0.004)],
        plumes=False,
    ),
}

LOOK = {
    'ostrich_cock': dict(body=(0.07, 0.06, 0.055), plume=(0.93, 0.91, 0.87), plume_tip=(0.98, 0.97, 0.94), skin=(0.70, 0.56, 0.52),
                         legs=(0.78, 0.50, 0.46), bill=(0.82, 0.70, 0.55), eye=(0.12, 0.08, 0.05)),
    'ostrich_hen': dict(body=(0.40, 0.36, 0.30), plume=(0.72, 0.69, 0.62), plume_tip=(0.80, 0.78, 0.72), skin=(0.66, 0.58, 0.54),
                        legs=(0.64, 0.58, 0.54), bill=(0.76, 0.68, 0.56), eye=(0.12, 0.08, 0.05)),
    'hen_brown': dict(body=(0.56, 0.33, 0.15), plume=(0.36, 0.20, 0.08), plume_tip=(0.20, 0.12, 0.06), skin=(0.56, 0.33, 0.15),
                      legs=(0.84, 0.66, 0.28), bill=(0.84, 0.70, 0.36), eye=(0.55, 0.30, 0.05), comb=(0.72, 0.10, 0.08)),
    'hen_white': dict(body=(0.90, 0.88, 0.82), plume=(0.86, 0.84, 0.78), plume_tip=(0.94, 0.93, 0.90), skin=(0.90, 0.88, 0.82),
                      legs=(0.86, 0.72, 0.32), bill=(0.86, 0.74, 0.40), eye=(0.55, 0.30, 0.05), comb=(0.75, 0.12, 0.09)),
}


def build_species(species, seed, did, out_dir, preview):
    kind = 'ostrich' if species.startswith('ostrich') else 'hen'
    S = SPEC[kind]; L = LOOK[species]
    rnd = random.Random(seed)
    s = rnd.uniform(0.95, 1.05)
    sc = lambda p: tuple(c * s for c in p)
    J = {'pelvis': sc((0, 0.08 if kind == 'ostrich' else 0.02, S['body'][0][2])), 'neck0': sc(S['neck'][0])}
    for i, p in enumerate(S['neck'][1:]):
        J[f'neck{i + 1}'] = sc(p)
    nN = len(S['neck']) - 1
    J['head'] = sc(S['head']); J['bill'] = sc(S['bill'])
    R = {'pelvis': (0.06 * s, 0.06 * s) if kind == 'ostrich' else (0.02 * s, 0.02 * s), 'neck0': tuple(v * s for v in S['nrad'][0])}
    for i in range(nN):
        R[f'neck{i + 1}'] = tuple(v * s for v in S['nrad'][i + 1])
    R['head'] = tuple(v * s for v in S['hrad']); R['bill'] = tuple(v * s for v in S['brad'])
    EDGES = [('pelvis', 'neck0')] + [(f'neck{i}', f'neck{i + 1}') for i in range(nN)] + [(f'neck{nN}', 'head'), ('head', 'bill')]
    for sd, x in (('l', 1), ('r', -1)):
        for k in ('hip', 'knee', 'ankle', 'foot', 'toe'):
            p = S[k]; J[f'{k}_{sd}'] = sc((x * p[0], p[1], p[2]))
        for k, r in zip(('hip', 'knee', 'ankle', 'foot', 'toe'), S['lrad']):
            R[f'{k}_{sd}'] = (r[0] * s, r[1] * s)
        EDGES += [('pelvis', f'hip_{sd}'), (f'hip_{sd}', f'knee_{sd}'), (f'knee_{sd}', f'ankle_{sd}'), (f'ankle_{sd}', f'foot_{sd}'), (f'foot_{sd}', f'toe_{sd}')]
    skel = A.skin_body(f'{kind}_skel', J, R, EDGES, 'pelvis', levels=2)
    # the feathered body: a shell (feather clumps on it), the ostrich's wing and tail plumes, the hen's tail fan
    bc, br = Vector(sc(S['body'][0])), tuple(v * s for v in S['body'][1])
    body = A.shaggy_shell(f'{kind}_body', bc, br, subdiv=4, seed=seed, amp=br[0] * 0.10, freq=6.0, droop=br[2] * 0.12, tuft=br[0] * 0.04,
                          tuft_freq=12.0, back=br[1] * 0.04)
    roots = A.surface_roots(body, 160 if kind == 'ostrich' else 110, lambda co, n: n.z < 0.6 or kind == 'hen', seed=seed)
    feathers = A.hair_clumps(f'{kind}_feathers', roots, seed=seed, length=(br[0] * 0.35, br[0] * 0.7), width=(br[0] * 0.14, br[0] * 0.24),
                             back=1.0, down=0.55, curl=0.25, lift=0.35, flat=0.3)
    plumes = []
    if S['plumes']:
        # drooping wing plumes along each flank and a heavy tail plume: long soft locks
        for x in (1, -1):
            pts = [(Vector((x * br[0] * 0.92, bc.y + br[1] * t, bc.z + br[2] * (0.1 - 0.35 * t * t))), Vector((x * 0.8, 0.3, -0.5)).normalized())
                   for t in [rnd.uniform(-0.6, 0.9) for _ in range(46)]]
            plumes.append(A.hair_clumps(f'plume_{x}', pts, seed=seed + x, length=(0.16 * s, 0.32 * s), width=(0.05 * s, 0.08 * s),
                                        back=0.8, down=1.1, curl=0.5, lift=0.6, flat=0.35))
        pts = [(Vector((rnd.uniform(-0.12, 0.12) * s, bc.y + br[1] * 0.92, bc.z + rnd.uniform(-0.05, 0.12) * s)), Vector((0, 1, 0.3)).normalized())
               for _ in range(40)]
        plumes.append(A.hair_clumps('plume_tail', pts, seed=seed + 7, length=(0.18 * s, 0.30 * s), width=(0.05 * s, 0.08 * s),
                                    back=0.6, down=0.9, curl=0.6, lift=0.8, flat=0.4))
    else:
        # the hen's tail fan: upright, backward-curving feathers; the wing coverts folded on the flanks
        pts = [(Vector((rnd.uniform(-0.03, 0.03) * s, bc.y + br[1] * 0.75, bc.z + rnd.uniform(0.02, 0.07) * s)), Vector((0, 0.55, 0.85)).normalized())
               for _ in range(18)]
        plumes.append(A.hair_clumps('tail_fan', pts, seed=seed + 3, length=(0.07 * s, 0.11 * s), width=(0.018 * s, 0.026 * s),
                                    back=0.3, down=-0.2, curl=0.45, lift=1.0, flat=0.3))
        for x in (1, -1):
            pts = [(Vector((x * br[0] * 0.95, bc.y + br[1] * t, bc.z + br[2] * 0.15)), Vector((x, 0.2, 0)).normalized()) for t in [rnd.uniform(-0.4, 0.5) for _ in range(10)]]
            plumes.append(A.hair_clumps(f'wing_{x}', pts, seed=seed + x * 5, length=(0.06 * s, 0.09 * s), width=(0.02 * s, 0.03 * s),
                                        back=1.2, down=0.4, curl=0.1, lift=0.2, flat=0.25))

    def eyes(bm):
        hx, hy, hz = J['head']
        for x in (1, -1):
            A.bm_sphere(bm, (0.017 if kind == 'ostrich' else 0.006) * s, Matrix.Translation((x * R['head'][0] * 0.78, hy - R['head'][0] * 0.35, hz + R['head'][1] * 0.25)), u=8, v=6)

    def comb(bm):
        if kind != 'hen':
            return
        hx, hy, hz = J['head']
        for i, (dy, h) in enumerate(((-0.012, 0.018), (0.0, 0.024), (0.012, 0.02), (0.022, 0.014))):
            A.bm_sphere(bm, 1.0, Matrix.Translation((0, hy + dy * s, hz + R['head'][1] * 0.8 + h * 0.4 * s)) @ Matrix.Diagonal((0.004 * s, 0.008 * s, h * 0.5 * s, 1)), u=6, v=5)
        for x in (1, -1):   # wattles
            A.bm_sphere(bm, 1.0, Matrix.Translation((x * 0.006 * s, J['bill'][1] + 0.012 * s, J['bill'][2] - 0.02 * s)) @ Matrix.Diagonal((0.004 * s, 0.006 * s, 0.011 * s, 1)), u=6, v=5)
    parts = A.parts_object(f'{kind}_parts', [('head', eyes), ('head', comb)])
    # rig
    B = {'root': ((0, 0.05, 0.0), (0, -0.2 * s, 0.0), None), 'pelvis': ('pelvis', (0, J['pelvis'][1] - 0.1 * s, J['pelvis'][2]), 'root'),
         'body': ((0, J['pelvis'][1] - 0.1 * s, J['pelvis'][2]), 'neck0', 'pelvis')}
    prev = 'body'
    chain = ['neck0'] + [f'neck{i + 1}' for i in range(nN)] + ['head']
    for i in range(len(chain) - 1):
        B[f'neck{i + 1}'] = (chain[i], chain[i + 1], prev); prev = f'neck{i + 1}'
    B['head'] = ('head', 'bill', prev)
    B['tail'] = ((0, bc.y + br[1] * 0.5, bc.z), (0, bc.y + br[1] * 1.05, bc.z + br[2] * 0.2), 'pelvis')
    B['wing_l'] = ((br[0] * 0.6, bc.y - br[1] * 0.3, bc.z + br[2] * 0.2), (br[0] * 0.9, bc.y + br[1] * 0.5, bc.z), 'body')
    B['wing_r'] = ((-br[0] * 0.6, bc.y - br[1] * 0.3, bc.z + br[2] * 0.2), (-br[0] * 0.9, bc.y + br[1] * 0.5, bc.z), 'body')
    for sd in 'lr':
        B.update({f'thigh_{sd}': (f'hip_{sd}', f'knee_{sd}', 'pelvis'), f'shin_{sd}': (f'knee_{sd}', f'ankle_{sd}', f'thigh_{sd}'),
                  f'tarsus_{sd}': (f'ankle_{sd}', f'foot_{sd}', f'shin_{sd}'), f'toe_{sd}': (f'foot_{sd}', f'toe_{sd}', f'tarsus_{sd}')})
    rig = A.armature(f'{kind}_rig', B, J)
    A.auto_weights(skel, rig, nondeform=('root', 'tail', 'wing_l', 'wing_r', 'body'))
    A.rigid_bind(parts, rig)
    # the feathered body follows the pelvis / body / tail / wings by position
    ylo, yhi = bc.y - br[1], bc.y + br[1]

    def bodyw(co):
        t = (co.y - ylo) / (yhi - ylo)   # 0 front .. 1 back
        w = {'body': max(0.0, 1.0 - t * 1.6), 'pelvis': max(0.0, 0.4 + 0.6 * (1 - abs(t - 0.6) * 2)), 'tail': max(0.0, (t - 0.7) * 3.3)}
        if abs(co.x) > br[0] * 0.75 and co.z > bc.z - br[2] * 0.3:
            w['wing_l' if co.x > 0 else 'wing_r'] = 0.6
        return w
    for o in [body, feathers] + plumes:
        A.weight_by(o, bodyw)
        A.rigid_bind(o, rig)
    # colours
    def skel_col(co, gs):
        z = co.z / s
        if any(k.startswith(('tarsus', 'toe')) for k in gs) or (kind == 'hen' and any(k.startswith('shin') for k in gs)):
            return (*L['legs'], 0.12)
        if 'head' in gs and co.y < J['head'][1] - R['head'][0] * 0.6:
            return (*L['bill'], 0.08)
        if any(k.startswith(('thigh', 'shin')) for k in gs):
            return (*L['skin'], 0.15) if kind == 'ostrich' else (*L['body'], 0.3)
        if kind == 'ostrich':   # the neck: grey-pink skin with a sparse down, paler at the throat
            return (*L['skin'], 0.2)
        return (*L['body'], 0.35)

    def body_col(co, gs):
        low = A.sm((bc.z - co.z) / (br[2] * 0.9))
        c = [a * (1 - 0.18 * low) for a in L['body']]
        return (*c, 0.45)

    def plume_col(co, gs):
        tip = A.sm((bc.z - br[2] * 0.2 - co.z) / (br[2] * 0.8))
        c = [a + (b - a) * tip for a, b in zip(L['plume'], L['plume_tip'])]
        return (*c, 0.5)

    def parts_col(co, gs):
        if kind == 'hen' and co.z > J['head'][2] + R['head'][1] * 0.5 or (kind == 'hen' and co.z < J['bill'][2] - 0.008 * s):
            return (*L['comb'], 0.1)
        return (*L['eye'], 0.0)
    A.paint(skel, skel_col); A.paint(body, body_col); A.paint(feathers, body_col); A.paint(parts, parts_col)
    for p in plumes:
        A.paint(p, plume_col)
    o = A.join([skel, body, feathers, parts] + plumes, kind)
    budget = 4200 if kind == 'ostrich' else 1800
    if A.tri_count(o) > budget:
        A.activate(o)
        d = o.modifiers.new('dec', 'DECIMATE'); d.ratio = budget / A.tri_count(o)
        bpy.ops.object.modifier_move_to_index(modifier='dec', index=0)
        bpy.ops.object.modifier_apply(modifier='dec')
    A.log(kind, 'tris', A.tri_count(o))
    A.bake(o, out_dir, did, scale=(120, 60, 120) if kind == 'ostrich' else (420, 260, 420), size=512 if kind == 'ostrich' else 256, rough=0.9, sheen=0.25)
    meta = clips(rig, kind, s, J)
    A.export(o, rig, out_dir, did, kind, meta, {'seed': seed, 'species': species}, lods=(1600, 600) if kind == 'ostrich' else (700, 300),
             extra={'height_m': round((2.2 if kind == 'ostrich' else 0.42) * s, 2)})
    return J, s, o, rig, meta, {'species': species}


def clips(rig, kind, s, J):
    P = A.Poser(rig)
    meta = {}
    neck = [b.name for b in rig.data.bones if b.name.startswith('neck')]

    def leg(sd, swing, lift):
        # swing: + = foot forward; lift folds the ankle (the tarsus up behind) during the swing
        P.rot(f'thigh_{sd}', -swing * 0.55); P.rot(f'shin_{sd}', -swing * 0.45 - 20 * lift)
        P.rot(f'tarsus_{sd}', 55 * lift); P.rot(f'toe_{sd}', -40 * lift)

    def gait(u, Am, beta):
        u %= 1.0
        if u < beta:
            return Am * (1 - 2 * u / beta), 0.0
        w = (u - beta) / (1 - beta)
        return -Am + 2 * Am * A.sm(w), math.sin(math.pi * w)

    def loco(Am, beta, bob, headbob, lean=0.0, wing=0.0):
        def fn(u, t):
            for sd, ph in (('l', 0.0), ('r', 0.5)):
                sw, fl = gait(u + ph, Am, beta)
                leg(sd, sw, fl)
            P.loc('root', (0, 0, -bob * math.cos(4 * math.pi * u) - bob))
            P.rot('pelvis', lean, 0, 3 * math.sin(2 * math.pi * u)); P.rot('body', -lean * 0.5)
            # birds hold the head still and thrust it on: a forward-back neck pump twice a cycle
            for i, n in enumerate(neck):
                P.rot(n, headbob * math.sin(4 * math.pi * u + i * 0.4) * (1 if i % 2 == 0 else -0.7))
            P.rot('tail', 6 * math.sin(4 * math.pi * u))
            if wing:
                P.rot('wing_l', 0, wing * math.sin(4 * math.pi * u)); P.rot('wing_r', 0, -wing * math.sin(4 * math.pi * u))
        return fn
    if kind == 'ostrich':
        A.make_clip(P, 'walk', 1.2, loco(30, 0.62, 0.025 * s, 4)); meta['walk'] = {'loop': True, 'duration': 1.2}
        A.make_clip(P, 'run', 0.55, loco(52, 0.40, 0.06 * s, 3, lean=10, wing=12)); meta['run'] = {'loop': True, 'duration': 0.55}
    else:
        A.make_clip(P, 'walk', 0.6, loco(32, 0.6, 0.006 * s, 9)); meta['walk'] = {'loop': True, 'duration': 0.6}
        A.make_clip(P, 'run', 0.32, loco(46, 0.42, 0.012 * s, 5, lean=14, wing=25)); meta['run'] = {'loop': True, 'duration': 0.32}

    def idle(u, t):   # looks about, then pecks at the ground (twice a cycle), the tail flicks
        peck = max(0.0, math.sin(2 * math.pi * u * 2 + 0.6)) ** 4
        look = math.sin(2 * math.pi * u)
        for i, n in enumerate(neck):
            P.rot(n, (14 + 10 * i) * peck * (1 if i < len(neck) - 1 else 0.5), 0, 12 * look * (1 if i == len(neck) - 1 else 0.3))
        P.rot('body', 8 * peck); P.rot('head', 20 * peck, 0, 15 * look)
        P.rot('tail', 4 * math.sin(2 * math.pi * u * 3))
        for sd in 'lr':
            leg(sd, 0, 0)
        if kind == 'hen':   # a scratch at the ground now and then
            sc_ = max(0.0, math.sin(2 * math.pi * u + 2.4)) ** 8
            leg('l', -20 * sc_, 0.6 * sc_)
    A.make_clip(P, 'idle', 3.0 if kind == 'ostrich' else 2.0, idle); meta['idle'] = {'loop': True, 'duration': 3.0 if kind == 'ostrich' else 2.0}

    def attack(u, t):   # the ostrich kicks forward and down; the hen pecks
        k = A.sm(u / 0.3) * (1 - A.sm((u - 0.55) / 0.3))
        if kind == 'ostrich':
            leg('l', 60 * k, 0.3 * k); leg('r', -8 * k, 0)
            P.rot('body', -8 * k); P.rot('wing_l', 0, 20 * k); P.rot('wing_r', 0, -20 * k)
            for n in neck:
                P.rot(n, -6 * k)
        else:
            for i, n in enumerate(neck):
                P.rot(n, 30 * k)
            P.rot('head', 30 * k); P.rot('wing_l', 0, 25 * k); P.rot('wing_r', 0, -25 * k)
    # (0.5 s, the kick / peck landing at 0.2 s: the animal brain plays a strike as a 0.4 s action, ai/animal-brain.js)
    A.make_clip(P, 'attack', 0.5, attack); meta['attack'] = {'loop': True, 'duration': 0.5, 'events': {'strike': [0.2]}}
    lift = (0.16 if kind == 'ostrich' else 0.05) * s

    def lying(w):
        P.loc('root', (0, 0, -0.0 * w))
        P.rot('root', 0, 84 * w)
        P.loc('root', (0, 0, lift * w - (J['pelvis'][2] * 0.0)))
        for i, n in enumerate(neck):
            P.rot(n, 20 * w * (1 if i < 2 else -0.5), 0, 15 * w)
        for sd in 'lr':
            leg(sd, -30 * w if sd == 'l' else 10 * w, 0.6 * w)
        P.rot('wing_l', 0, 20 * w); P.rot('wing_r', 0, -10 * w)

    def die(u, t):
        k = A.sm(u / 0.2) * (1 - A.sm((u - 0.2) / 0.25))
        for n in neck:
            P.rot(n, -12 * k)
        P.rot('wing_l', 0, 40 * k); P.rot('wing_r', 0, -40 * k)
        lying(A.sm((u - 0.15) / 0.6))
    A.make_clip(P, 'die', 1.3, die, loop=False); meta['die'] = {'loop': False, 'duration': 1.3}
    A.make_clip(P, 'dead', 1.0, lambda u, t: lying(1.0)); meta['dead'] = {'loop': True, 'duration': 1.0}
    for n in ('walk', 'run'):
        meta[n]['groundSpeed'] = A.ground_speed(rig, bpy.data.actions[n], ['toe_l', 'toe_r'], meta[n]['duration'])
    rig.animation_data.action = bpy.data.actions['idle']
    P.clear()
    return meta
