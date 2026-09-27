#!/usr/bin/env python3
"""SHADOW SIX emblem (docs/menus-art-direction.md §1.4.3), our own design: a raven with spread wings over a knurled
ring (Roman VI over a crossed commando knife and anchor) over a riveted plate reading SHADOW SIX with six rivets,
one per commando. Writes two SVGs from one geometry:
  assets/ui/emblem.svg         the master: tin-plate metal fills, top-left key light (§1.4.1)
  assets/ui/emblem-height.svg  grey levels = relief height, rasterised by backdrop.js into the emboss normal map
Usage: python3 tools/ui/make_emblem.py  (reads assets/ui/wordmark.svg for the plate lettering)
"""
import math, re, os
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
UI = os.path.join(ROOT, 'assets', 'ui')

def P(pts):
    return 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in pts) + ' Z'

def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

def bez(p0, p1, p2, p3, t):
    u = 1 - t
    return (u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0], u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1])

# ---------------------------------------------------------------- raven wing (left; right = mirror)
S, C1, C2, T = (472, 262), (430, 110), (310, 96), (238, 150)   # leading edge: shoulder → tip (cubic)
def feather(base, ang, length, width):
    dx, dy = math.cos(ang), math.sin(ang)
    nx, ny = -dy, dx
    tip = (base[0] + dx * length, base[1] + dy * length)
    b1 = (base[0] + nx * width / 2, base[1] + ny * width / 2)
    b2 = (base[0] - nx * width / 2, base[1] - ny * width / 2)
    m1 = (base[0] + dx * length * 0.62 + nx * width * 0.55, base[1] + dy * length * 0.62 + ny * width * 0.55)
    m2 = (base[0] + dx * length * 0.62 - nx * width * 0.42, base[1] + dy * length * 0.62 - ny * width * 0.42)
    d = (f'M{b1[0]:.1f} {b1[1]:.1f} Q{m1[0]:.1f} {m1[1]:.1f} {tip[0]:.1f} {tip[1]:.1f} '
         f'Q{m2[0]:.1f} {m2[1]:.1f} {b2[0]:.1f} {b2[1]:.1f} Z')
    rachis = f'M{base[0]:.1f} {base[1]:.1f} L{base[0] + dx * length * 0.86:.1f} {base[1] + dy * length * 0.86:.1f}'
    return d, rachis

def wing():
    feathers, rachises = [], []
    N = 13
    for i in range(N):
        t = 0.12 + 0.88 * i / (N - 1)
        base = bez(S, C1, C2, T, t)
        # secondaries hang down, primaries sweep out-left and slightly down
        ang = math.radians(100 + 112 * (t ** 1.3))
        length = 124 + 150 * t
        width = 52 - 16 * t
        d, r = feather(base, ang, length, width)
        feathers.append(d)
        rachises.append(r)
    # coverts: the leading-edge band over the feather roots
    top = [bez(S, C1, C2, T, k / 24) for k in range(25)]
    under = []
    for k in range(24, -1, -1):
        t = k / 24
        p = bez(S, C1, C2, T, t)
        ang = math.radians(100 + 112 * (t ** 1.3))
        depth = 70 - 30 * t
        under.append((p[0] + math.cos(ang) * depth, p[1] + math.sin(ang) * depth))
    coverts = P(top + under)
    # scalloped covert row
    scallops = []
    for k in range(2, 22, 2):
        t = k / 24
        p = bez(S, C1, C2, T, t)
        ang = math.radians(100 + 112 * (t ** 1.3))
        depth = 70 - 30 * t
        q = (p[0] + math.cos(ang) * depth * 0.95, p[1] + math.sin(ang) * depth * 0.95)
        scallops.append(f'M{p[0]:.1f} {p[1]:.1f} Q{q[0] + 18:.1f} {q[1]:.1f} {q[0]:.1f} {q[1]:.1f}')
    return feathers[::-1], rachises[::-1], coverts, scallops

def mirror_path(d):
    return re.sub(r'(-?\d+\.?\d*) (-?\d+\.?\d*)', lambda m: f'{1000 - float(m.group(1)):.1f} {m.group(2)}', d)

fe, ra, cov, sc = wing()
wingL = {'feathers': fe, 'rachis': ra, 'coverts': cov, 'scallops': sc}
wingR = {k: ([mirror_path(x) for x in v] if isinstance(v, list) else mirror_path(v)) for k, v in wingL.items()}

# body, head (profile to the left, heavy raven bill), tail wedge, talons
body = 'M500 132 C588 150 594 300 558 392 C542 430 522 446 500 452 C478 446 458 430 442 392 C406 300 412 150 500 132 Z'
chest = ['M462 236 Q500 262 538 236', 'M470 318 Q500 336 530 318']
head = 'M515 56 C562 60 580 102 570 138 C562 164 542 178 522 182 L530 198 L510 190 L514 206 L496 192 C476 186 466 170 464 152 L390 138 C383 133 384 127 392 124 L462 102 C470 72 490 54 515 56 Z'
beak_line = 'M463 128 L394 131'
eye = (510, 100, 8)
tail = 'M476 430 L446 506 L472 500 L486 514 L500 500 L514 514 L528 500 L554 506 L524 430 Z'
talons = []

# ring
CX, CY, RO, RI = 500, 560, 212, 158
knurl = []
for k in range(96):
    a = 2 * math.pi * k / 96
    a1, a2 = a - 0.012, a + 0.012
    p = [(CX + math.cos(a1) * (RO - 12), CY + math.sin(a1) * (RO - 12)), (CX + math.cos(a1) * (RO + 1), CY + math.sin(a1) * (RO + 1)),
         (CX + math.cos(a2) * (RO + 1), CY + math.sin(a2) * (RO + 1)), (CX + math.cos(a2) * (RO - 12), CY + math.sin(a2) * (RO - 12))]
    knurl.append(P(p))
ring = f'M{CX - RO} {CY} a{RO} {RO} 0 1 0 {2 * RO} 0 a{RO} {RO} 0 1 0 {-2 * RO} 0 Z M{CX - RI} {CY} a{RI} {RI} 0 1 1 {2 * RI} 0 a{RI} {RI} 0 1 1 {-2 * RI} 0 Z'
disc = f'M{CX - RI} {CY} a{RI} {RI} 0 1 0 {2 * RI} 0 a{RI} {RI} 0 1 0 {-2 * RI} 0 Z'

# crossed knife (lower-left → upper-right) and anchor (lower-right → upper-left), drawn upright then rotated
knife = ('M0 -150 L12 -40 L10 40 L-10 40 L-12 -40 Z '         # blade
         'M-44 40 L44 40 L44 52 L-44 52 Z '                   # cross-guard
         'M-9 52 L9 52 L11 128 L-11 128 Z '                   # grip
         'M-15 128 L15 128 L13 146 L-13 146 Z')               # pommel
knife_ridge = 'M0 -140 L0 36'
anchor = ('M-8 -122 L8 -122 L8 96 L-8 96 Z '                  # shank
          'M-46 -100 L46 -100 L46 -86 L-46 -86 Z '            # stock
          'M0 -150 a18 18 0 1 0 0.1 0 Z M0 -141 a9 9 0 1 1 -0.1 0 Z '  # ring
          'M-94 40 L-80 40 Q-66 104 0 110 Q66 104 80 40 L94 40 Q82 126 0 132 Q-82 126 -94 40 Z '
          'M-94 38 L-114 66 L-84 58 Z M94 38 L114 66 L84 58 Z')  # arms + flukes
def rot(d, deg, dx, dy):
    a = math.radians(deg)
    def f(m):
        x, y = float(m.group(1)), float(m.group(2))
        return f'{x * math.cos(a) - y * math.sin(a) + dx:.1f} {x * math.sin(a) + y * math.cos(a) + dy:.1f}'
    # only absolute coords are transformed; relative arcs keep their radii (rotation-invariant for circles)
    out, rel = [], False
    for tok in re.split(r'(?=[MLQZa])', d):
        if tok.startswith('a'):
            out.append(tok)
        else:
            out.append(re.sub(r'(-?\d+\.?\d*) (-?\d+\.?\d*)', f, tok))
    return ''.join(out)
knife_d = rot(knife, 38, CX, CY + 6)
knife_r = rot(knife_ridge, 38, CX, CY + 6)
anchor_d = rot(anchor, -38, CX, CY + 6)

# Roman VI with serifs
V = 'M398 470 L452 470 L452 482 L440 482 L474 590 L506 482 L494 482 L494 470 L540 470 L540 482 L528 482 L482 626 L462 626 L414 482 L398 482 Z'
I = 'M556 470 L612 470 L612 482 L596 482 L596 614 L612 614 L612 626 L556 626 L556 614 L572 614 L572 482 L556 482 Z'

# plate + wordmark + six rivets
plate = 'M168 786 L832 786 Q848 786 848 802 L848 918 Q848 934 832 934 L168 934 Q152 934 152 918 L152 802 Q152 786 168 786 Z'
plate_inner = 'M178 798 L822 798 L822 898 L178 898 Z'
wm = open(os.path.join(UI, 'wordmark.svg')).read()
vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', wm).group(1).split()]
wm_path = re.search(r'<path fill="currentColor" d="([^"]+)"', wm).group(1)
sx = 580 / vb[2]
wm_tf = f'translate({500 - 290:.1f} {806 - vb[1] * sx:.1f}) scale({sx:.5f})'
rivets = [(230 + k * 108, 917) for k in range(6)]

def svg(mode):
    metal = mode == 'metal'
    H = lambda v: f'#{v:02x}{v:02x}{v:02x}'
    fill = {
        'feather': 'url(#tinA)' if metal else H(150), 'coverts': 'url(#tinB)' if metal else H(190), 'body': 'url(#tinB)' if metal else H(205),
        'head': 'url(#tinA)' if metal else H(215), 'ring': 'url(#tinB)' if metal else H(225), 'disc': 'url(#tinD)' if metal else H(96),
        'knife': 'url(#tinA)' if metal else H(170), 'anchor': 'url(#tinA)' if metal else H(160), 'vi': 'url(#tinC)' if metal else H(255),
        'plate': 'url(#tinB)' if metal else H(170), 'plateIn': 'url(#tinD)' if metal else H(120), 'text': 'url(#tinC)' if metal else H(250),
        'rivet': 'url(#rivet)' if metal else H(255), 'tail': 'url(#tinA)' if metal else H(180),
    }
    line = '#1a1a15' if metal else H(40)
    lw = 3
    o = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-label="SHADOW SIX emblem">',
         '<title>SHADOW SIX emblem</title>',
         '<!-- Our own design (SHADOW SIX). Raven, ring VI, knife and anchor, riveted plate. Not a real unit badge. -->']
    if metal:
        o.append('<defs>'
                 '<linearGradient id="tinA" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#e4e1d3"/><stop offset=".45" stop-color="#9c9a8c"/><stop offset="1" stop-color="#4a4940"/></linearGradient>'
                 '<linearGradient id="tinB" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#d2cfbf"/><stop offset=".55" stop-color="#8a887a"/><stop offset="1" stop-color="#3e3d35"/></linearGradient>'
                 '<linearGradient id="tinC" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f3e6"/><stop offset=".6" stop-color="#b9b6a6"/><stop offset="1" stop-color="#6d6b5f"/></linearGradient>'
                 '<linearGradient id="tinD" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#57564b"/><stop offset="1" stop-color="#23231e"/></linearGradient>'
                 '<radialGradient id="rivet" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff9e0"/><stop offset=".4" stop-color="#c9a24a"/><stop offset="1" stop-color="#4a3a14"/></radialGradient>'
                 '</defs>')
    g = f'<g stroke="{line}" stroke-width="{lw}" stroke-linejoin="round" stroke-linecap="round">'
    o.append(g)
    # ring behind the bird
    o.append(f'<path d="{ring}" fill="{fill["ring"]}" fill-rule="evenodd"/>')
    o.append(f'<g fill="{fill["disc"]}" stroke="none">' + ''.join(f'<path d="{k}"/>' for k in knurl) + '</g>')
    o.append(f'<path d="{disc}" fill="{fill["disc"]}"/>')
    o.append(f'<path d="{anchor_d}" fill="{fill["anchor"]}" fill-rule="evenodd"/>')
    o.append(f'<path d="{knife_d}" fill="{fill["knife"]}"/><path d="{knife_r}" fill="none" stroke-width="2"/>')
    o.append(f'<path d="{V}" fill="{fill["vi"]}"/><path d="{I}" fill="{fill["vi"]}"/>')
    for w in (wingL, wingR):
        for f in w['feathers']:
            o.append(f'<path d="{f}" fill="{fill["feather"]}"/>')
        o.append(f'<path d="{w["coverts"]}" fill="{fill["coverts"]}"/>')
        o.append('<g fill="none" stroke-width="2">' + ''.join(f'<path d="{s}"/>' for s in w['scallops']) + '</g>')
    o.append(f'<path d="{tail}" fill="{fill["tail"]}"/>')
    o.append(f'<path d="{body}" fill="{fill["body"]}"/>')
    o.append('<g fill="none" stroke-width="2">' + ''.join(f'<path d="{c}"/>' for c in chest) + ''.join(f'<path d="{t}"/>' for t in talons) + '</g>')
    o.append(f'<path d="{head}" fill="{fill["head"]}"/><path d="{beak_line}" fill="none" stroke-width="2"/>')
    o.append(f'<circle cx="{eye[0]}" cy="{eye[1]}" r="{eye[2]}" fill="{line}" stroke="none"/>')
    # plate
    o.append(f'<path d="{plate}" fill="{fill["plate"]}"/><path d="{plate_inner}" fill="{fill["plateIn"]}" stroke-width="2"/>')
    o.append('</g>')
    o.append(f'<g transform="{wm_tf}"><path d="{wm_path}" fill="{fill["text"]}" stroke="{line}" stroke-width="{2 / sx:.1f}"/></g>')
    o.append('<g stroke="#1a1a15" stroke-width="2">' + ''.join(f'<circle cx="{x}" cy="{y}" r="8" fill="{fill["rivet"]}"/>' for x, y in rivets) + '</g>')
    o.append('</svg>\n')
    return '\n'.join(o)

for name, mode in (('emblem.svg', 'metal'), ('emblem-height.svg', 'height')):
    s = svg(mode)
    open(os.path.join(UI, name), 'w').write(s)
    print(name, len(s))

# ---------------------------------------------------------------- the front-end badge (S05 layout, review fix)
# One sheet in 640×480 r space (viewBox 1280×960, 2 units per r) laid out for BEL's composition: the ring's centre
# behind the middle of the item column (320, 180 r), the raven BEHIND the ring with its wingtips level with the card
# title, and the plate's top edge ~10 r under QUIT GAME (242 r). Height map only: backdrop.js lights it as an emboss
# (no fill colour of its own). The ring's contents sit in low relief so the rows over them stay quiet.
RING = 'translate(640 360) scale(1.02) translate(-500 -560)'
BIRD_S = 0.84
BIRD = f'translate({640 - (500 - 500) * BIRD_S} {192}) scale({BIRD_S}) translate(-500 -262)'
PLATE = 'translate(640 484) scale(0.862) translate(-500 -786)'
def badge():
    H = lambda v: f'#{v:02x}{v:02x}{v:02x}'
    line = H(40)
    o = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 960">',
         '<!-- SHADOW SIX front-end badge, height map (tools/ui/make_emblem.py). Ours. -->',
         f'<g stroke="{line}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">', f'<g transform="{BIRD}">']
    for side, w in (('L', wingL), ('R', wingR)):
        piv = (472, 262) if side == 'L' else (528, 262)
        o.append(f'<g transform="rotate({-22.7 if side == "L" else 22.7} {piv[0]} {piv[1]})">')
        for f in w['feathers']:
            o.append(f'<path d="{f}" fill="{H(150)}"/>')
        o.append(f'<path d="{w["coverts"]}" fill="{H(190)}"/>')
        o.append('<g fill="none" stroke-width="2">' + ''.join(f'<path d="{s}"/>' for s in w['scallops']) + '</g></g>')
    o.append(f'<path d="{body}" fill="{H(205)}"/>')
    o.append('<g fill="none" stroke-width="2">' + ''.join(f'<path d="{c}"/>' for c in chest) + '</g>')
    o.append(f'<path d="{head}" fill="{H(215)}"/><path d="{beak_line}" fill="none" stroke-width="2"/>')
    o.append(f'<circle cx="{eye[0]}" cy="{eye[1]}" r="{eye[2]}" fill="{line}" stroke="none"/></g>')
    o.append(f'<g transform="{RING}"><path d="{ring}" fill="{H(225)}" fill-rule="evenodd"/>')
    o.append(f'<g fill="{H(150)}" stroke="none">' + ''.join(f'<path d="{k}"/>' for k in knurl) + '</g>')
    o.append(f'<path d="{disc}" fill="{H(96)}"/>')
    o.append(f'<g stroke-width="1.5" stroke="{H(80)}"><path d="{anchor_d}" fill="{H(118)}" fill-rule="evenodd"/><path d="{knife_d}" fill="{H(122)}"/>')
    o.append(f'<path d="{V}" fill="{H(136)}"/><path d="{I}" fill="{H(136)}"/></g></g>')
    o.append(f'<g transform="{PLATE}"><path d="{plate}" fill="{H(170)}"/><path d="{plate_inner}" fill="{H(120)}" stroke-width="2"/>')
    o.append(f'<g transform="{wm_tf}"><path d="{wm_path}" fill="{H(250)}" stroke="{line}" stroke-width="{2 / sx:.1f}"/></g>')
    o.append('<g stroke-width="2">' + ''.join(f'<circle cx="{x}" cy="{y}" r="8" fill="{H(255)}"/>' for x, y in rivets) + '</g></g>')
    o.append('</g></svg>\n')
    return '\n'.join(o)
open(os.path.join(UI, 'emblem-badge-height.svg'), 'w').write(badge())
print('emblem-badge-height.svg')
