#!/usr/bin/env python3
"""SHADOW SIX wordmark (docs/menus-art-direction.md §1.3, §1.4.3): Alfa Slab One (SIL OFL 1.1) glyphs converted
to outlines and hand-roughened (seeded jitter on every on-curve point + a few chipped notches), written as
assets/ui/wordmark.svg. The font is used only as outlines here; it never ships as a webfont (amendment B1).
Usage: python3 tools/ui/make_wordmark.py <AlfaSlabOne-Regular.ttf> <out.svg>   (needs fontTools)
"""
import random, sys
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen

src, out = sys.argv[1], sys.argv[2]
font = TTFont(src)
gs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font['head'].unitsPerEm
asc = font['hhea'].ascent
rng = random.Random(1941)
TEXT = 'SHADOW SIX'
TRACK = 0.06 * upm
J = 0.012 * upm  # roughening amplitude

def rough(p):
    return (p[0] + rng.uniform(-J, J), p[1] + rng.uniform(-J, J))

parts, x = [], 0.0
for ch in TEXT:
    g = cmap[ord(ch)]
    glyph = gs[g]
    if ch != ' ':
        pen = RecordingPen()
        glyph.draw(pen)
        d = []
        for op, pts in pen.value:
            pts = [rough(p) for p in pts]
            tr = [f'{px + x:.1f} {asc - py:.1f}' for px, py in pts]
            if op == 'moveTo': d.append('M' + tr[0])
            elif op == 'lineTo': d.append('L' + tr[0])
            elif op == 'qCurveTo':
                # TrueType implied on-curve points → split into Q segments
                ps = [(px + x, asc - py) for px, py in pts]
                for i in range(len(ps) - 1):
                    c = ps[i]
                    e = ps[i + 1] if i == len(ps) - 2 else ((ps[i][0] + ps[i + 1][0]) / 2, (ps[i][1] + ps[i + 1][1]) / 2)
                    d.append(f'Q{c[0]:.1f} {c[1]:.1f} {e[0]:.1f} {e[1]:.1f}')
            elif op == 'curveTo': d.append('C' + ' '.join(tr))
            elif op == 'closePath': d.append('Z')
        parts.append(''.join(d))
    x += glyph.width + TRACK
W = x - TRACK
H = asc - font['hhea'].descent
# chipped notches (worn stamp): small triangles knocked out along the baseline and cap line
notches = []
for i in range(0):
    nx = rng.uniform(0.02, 0.98) * W
    ny = rng.choice([asc * 0.18, asc * 0.9]) + rng.uniform(-20, 20)
    s = rng.uniform(14, 34)
    notches.append(f'M{nx:.0f} {ny:.0f}l{s:.0f} {s*0.4:.0f}l{-s*0.7:.0f} {s*0.5:.0f}Z')
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {asc*0.1:.0f} {W:.0f} {asc*0.95:.0f}" role="img" aria-label="SHADOW SIX">
<title>SHADOW SIX</title>
<!-- Wordmark: Alfa Slab One by JM Solé (SIL Open Font License 1.1), outlined and roughened for SHADOW SIX. -->
<defs><mask id="wear"><rect x="0" y="0" width="{W:.0f}" height="{H:.0f}" fill="#fff"/><path fill="#000" d="{''.join(notches)}"/></mask></defs>
<g mask="url(#wear)"><path fill="currentColor" d="{''.join(parts)}"/></g>
</svg>
'''
open(out, 'w').write(svg)
print(out, len(svg), 'bytes', f'{W:.0f}x{H:.0f}')
