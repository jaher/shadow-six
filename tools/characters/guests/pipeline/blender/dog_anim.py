# dog_anim.py - procedural keyframed clips for the Alsatian rig (project-authored, CC0).
# Rotations are authored about ARMATURE axes (X = lateral, Y = back, Z = up; the dog faces -Y) and converted to each
# bone's local rest frame, so signs do not depend on bone rolls.
import bpy, math
from mathutils import Vector, Quaternion, Matrix
from common import *

FPS = 30
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def sm(t):
    t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)


class Poser:
    def __init__(self, rig):
        self.rig = rig
        self.rest = {b.name: b.matrix_local.to_quaternion() for b in rig.data.bones}
        self.rest3 = {b.name: b.matrix_local.to_3x3() for b in rig.data.bones}
        for pb in rig.pose.bones:
            pb.rotation_mode = 'QUATERNION'

    def clear(self):
        for pb in self.rig.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)

    def rot(self, bone, ax=0.0, ay=0.0, az=0.0):
        """armature-space rotation (deg): ax pitch about X, ay roll about Y, az yaw about Z (applied Z*Y*X)"""
        q = Quaternion(Z, math.radians(az)) @ Quaternion(Y, math.radians(ay)) @ Quaternion(X, math.radians(ax))
        r = self.rest[bone]
        self.rig.pose.bones[bone].rotation_quaternion = r.inverted() @ q @ r

    def loc(self, bone, v):
        self.rig.pose.bones[bone].location = self.rest3[bone].inverted() @ Vector(v)

    def key(self, frame):
        for pb in self.rig.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            if pb.name == 'root':
                pb.keyframe_insert('location', frame=frame)


LEGS = {'fl': ('upperarm_l', 'forearm_l', 'fpaw_l'), 'fr': ('upperarm_r', 'forearm_r', 'fpaw_r'),
        'hl': ('thigh_l', 'shin_l', 'hpaw_l'), 'hr': ('thigh_r', 'shin_r', 'hpaw_r')}


def leg(P, k, fwd, flex):
    """fwd: swing (deg, + = paw forward); flex: 0..1 lift during swing"""
    a, b, c = LEGS[k]
    if k[0] == 'f':
        P.rot(a, -fwd - 8 * flex); P.rot(b, 70 * flex); P.rot(c, -40 * flex)
    else:
        P.rot(a, -fwd - 10 * flex); P.rot(b, 55 * flex); P.rot(c, -45 * flex)


def gait(P, u, A, beta):
    u %= 1.0
    if u < beta:
        return A * (1 - 2 * u / beta), 0.0
    w = (u - beta) / (1 - beta)
    return -A + 2 * A * sm(w), math.sin(math.pi * w)


def make_clip(P, name, dur, fn, loop=True):
    rig = P.rig
    act = bpy.data.actions.new(name); act.use_fake_user = True
    rig.animation_data_create(); rig.animation_data.action = act
    n = max(2, int(round(dur * FPS)))
    for f in range(n + 1):
        P.clear()
        fn(f / n, f / FPS)
        P.key(f)
    act['loop'] = loop
    return act


def locomotion(P, T, A, beta, phases, bob, spine_amp=0.0, head_bob=3.0, tail=10.0, head_down=0.0):
    def fn(u, t):
        for k, ph in phases.items():
            s, fl = gait(P, u + ph, A, beta)
            leg(P, k, s, fl)
        P.loc('root', (0, 0, -bob * math.cos(4 * math.pi * u) - bob))
        if spine_amp:
            P.rot('spine', spine_amp * math.sin(2 * math.pi * u)); P.rot('chest', -spine_amp * 0.6 * math.sin(2 * math.pi * u))
        P.rot('neck', 8 + head_down * 0.6 + head_bob * math.sin(4 * math.pi * u)); P.rot('head', head_down * 0.5)
        P.rot('tail1', 10, 0, tail * math.sin(2 * math.pi * u)); P.rot('tail2', -5, 0, tail * 0.8 * math.sin(2 * math.pi * u - 0.6))
    return fn


def build_clips(rig):
    P = Poser(rig)
    meta = {}
    leg_len = 0.47

    def gs(A, T, beta):
        return round(2 * leg_len * math.sin(math.radians(A)) / (beta * T), 2)
    # walk: lateral sequence 4-beat; trot: diagonal pairs; run: rotary gallop with spine flexion
    make_clip(P, 'walk', 0.75, locomotion(P, 0.75, 26, 0.62, {'hl': 0.0, 'fl': 0.25, 'hr': 0.5, 'fr': 0.75}, 0.008))
    meta['walk'] = {'loop': True, 'duration': 0.75, 'groundSpeed': gs(26, 0.75, 0.62)}
    make_clip(P, 'sniff_walk', 1.0, locomotion(P, 1.0, 20, 0.66, {'hl': 0.0, 'fl': 0.25, 'hr': 0.5, 'fr': 0.75}, 0.006, head_down=50, tail=6))
    meta['sniff_walk'] = {'loop': True, 'duration': 1.0, 'groundSpeed': gs(20, 1.0, 0.66)}
    make_clip(P, 'trot', 0.5, locomotion(P, 0.5, 32, 0.45, {'fl': 0.0, 'hr': 0.0, 'fr': 0.5, 'hl': 0.5}, 0.015, head_bob=2))
    meta['trot'] = {'loop': True, 'duration': 0.5, 'groundSpeed': gs(32, 0.5, 0.45)}
    make_clip(P, 'run', 0.4, locomotion(P, 0.4, 42, 0.35, {'hl': 0.0, 'hr': 0.08, 'fl': 0.5, 'fr': 0.58}, 0.03, spine_amp=9, head_bob=5, tail=4))
    meta['run'] = {'loop': True, 'duration': 0.4, 'groundSpeed': round(gs(42, 0.4, 0.35) * 1.3, 2)}

    def idle(u, t):
        br = math.sin(2 * math.pi * u * 2)
        P.rot('chest', 1.2 * br); P.rot('neck', 6 + 2 * math.sin(2 * math.pi * u), 0, 14 * math.sin(2 * math.pi * u))
        P.rot('head', 0, 0, 6 * math.sin(2 * math.pi * u + 1))
        P.rot('ear_l', -12 * max(0.0, math.sin(2 * math.pi * u * 3)) ** 8); P.rot('tail1', 5, 0, 12 * math.sin(2 * math.pi * u * 2))
        P.rot('tail2', 0, 0, 10 * math.sin(2 * math.pi * u * 2 - 0.7))
        for k in LEGS:
            leg(P, k, 0, 0)
    make_clip(P, 'idle', 3.0, idle); meta['idle'] = {'loop': True, 'duration': 3.0}

    def sniff(u, t):
        P.loc('root', (0, 0, -0.02)); P.rot('chest', 6)
        P.rot('neck', 42, 0, 20 * math.sin(2 * math.pi * u)); P.rot('head', 20, 0, 8 * math.sin(4 * math.pi * u))
        P.rot('jaw', 3 * max(0.0, math.sin(2 * math.pi * u * 6)))
        P.rot('tail1', 12, 0, 8 * math.sin(2 * math.pi * u * 2)); P.rot('ear_l', -6); P.rot('ear_r', -6)
        leg(P, 'fl', -4, 0); leg(P, 'fr', -4, 0); leg(P, 'hl', 2, 0); leg(P, 'hr', 2, 0)
    make_clip(P, 'sniff', 2.0, sniff); meta['sniff'] = {'loop': True, 'duration': 2.0}

    def bark(u, t):   # two barks per 1.2 s: head jerks up-forward, jaw snaps open, front legs braced
        e = max(math.sin(math.pi * min(1, (u % 0.5) / 0.18)) if (u % 0.5) < 0.18 else 0.0, 0.0)
        P.loc('root', (0, 0.03 * e, -0.02 + 0.015 * e)); P.rot('chest', -4 * e)
        P.rot('neck', -18 - 14 * e); P.rot('head', -8 * e); P.rot('jaw', 32 * e)
        P.rot('ear_l', 10 * e); P.rot('ear_r', 10 * e); P.rot('tail1', 25, 0, 4 * e); P.rot('tail2', 10)
        leg(P, 'fl', 10, 0); leg(P, 'fr', 10, 0); leg(P, 'hl', -6, 0); leg(P, 'hr', -6, 0)
    make_clip(P, 'bark', 1.0, bark); meta['bark'] = {'loop': True, 'duration': 1.0, 'events': {'bark': [0.03, 0.53]}}

    def attack(u, t):   # 1 bite per 1.0 s (spec): gather, lunge, bite + head shake, recover (in place)
        g = sm(u / 0.25) * (1 - sm((u - 0.25) / 0.15))            # gather/crouch
        l = sm((u - 0.25) / 0.15) * (1 - sm((u - 0.7) / 0.3))      # lunge extension
        bite = sm((u - 0.38) / 0.06) * (1 - sm((u - 0.72) / 0.2))
        jaw = 38 * sm((u - 0.2) / 0.15) * (1 - sm((u - 0.4) / 0.04)) + 6 * bite
        P.loc('root', (0, -0.28 * l, -0.07 * g + 0.10 * l)); P.rot('root', 8 * g - 12 * l)
        P.rot('chest', -8 * l); P.rot('neck', -6 - 16 * l, 0, 16 * bite * math.sin(2 * math.pi * u * 5)); P.rot('head', -10 * l)
        P.rot('jaw', jaw); P.rot('ear_l', 25 * g + 25 * l); P.rot('ear_r', 25 * g + 25 * l); P.rot('tail1', 20 * l - 10 * g)
        leg(P, 'fl', -15 * g + 50 * l, 0.5 * l); leg(P, 'fr', -15 * g + 45 * l, 0.6 * l)
        leg(P, 'hl', 20 * g - 35 * l, 0.1); leg(P, 'hr', 20 * g - 30 * l, 0.1)
    make_clip(P, 'attack', 1.0, attack); meta['attack'] = {'loop': True, 'duration': 1.0, 'events': {'bite': [0.42]}}

    def lying(w):
        P.loc('root', (-0.02 * w, 0, 0.115 * w - 0.02 * math.sin(math.pi * w)))
        P.rot('root', 0, 88 * w); P.rot('neck', 20 * w, 0, 10 * w); P.rot('head', 8 * w); P.rot('jaw', 10 * w)
        P.rot('tail1', -30 * w); P.rot('ear_l', 20 * w); P.rot('ear_r', 20 * w)
        leg(P, 'fl', 25 * w, 0.2 * w); leg(P, 'fr', 15 * w, 0.1 * w); leg(P, 'hl', -20 * w, 0.2 * w); leg(P, 'hr', -30 * w, 0.1 * w)

    def die(u, t):
        k = sm(u / 0.2) * (1 - sm((u - 0.2) / 0.2))   # yelp/rear, then collapse onto the side
        P.rot('neck', -25 * k); P.rot('jaw', 25 * k)
        lying(sm((u - 0.15) / 0.6))
    make_clip(P, 'die', 1.3, die, loop=False); meta['die'] = {'loop': False, 'duration': 1.3}
    make_clip(P, 'dead', 1.0, lambda u, t: lying(1.0)); meta['dead'] = {'loop': True, 'duration': 1.0}

    rig.animation_data.action = bpy.data.actions['idle']
    P.clear()
    return meta
