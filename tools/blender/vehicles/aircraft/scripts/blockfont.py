"""Luftwaffe-style block stencil font (uniform stroke, square terminals) for code letters / tactical numbers.
Glyph box 0..4 (x) by 0..6 (y), stroke 1.0. Each glyph = list of pieces; a piece is a rect (x0, y0, x1, y1) or a
quad [(x, y) x4] (parallelogram diagonals with horizontal ends, as on the stencilled originals)."""


def _q(*p):
    return list(p)


T, B, M = (0, 5, 4, 6), (0, 0, 4, 1), (0, 2.5, 4, 3.5)          # top / bottom / middle bars
LF, RF = (0, 0, 1, 6), (3, 0, 4, 6)                            # left / right full verticals
LU, RU, LL, RL = (0, 3, 1, 6), (3, 3, 4, 6), (0, 0, 1, 3), (3, 0, 4, 3)
BLOCK = {
    '0': [LF, RF, T, B], '1': [(1.6, 0, 2.6, 6), _q((0.5, 4.2), (1.6, 4.9), (1.6, 6), (0.5, 5.3))],
    '2': [T, RU, M, LL, B], '3': [T, M, B, RF], '4': [(0, 2.5, 1, 6), (0, 2.5, 4, 3.5), (2.6, 0, 3.6, 6)],
    '5': [T, LU, M, RL, B], '6': [T, LF, M, RL, B], '7': [T, _q((1.0, 0), (2.1, 0), (4, 5), (2.9, 5))],
    '8': [LF, RF, T, B, M], '9': [T, RF, M, LU, B],
    'A': [_q((0, 0), (1.1, 0), (2.55, 6), (1.45, 6)), _q((2.9, 0), (4, 0), (2.55, 6), (1.45, 6)), (0.75, 1.7, 3.25, 2.7)],
    'B': [LF, T, B, (0, 2.6, 3.4, 3.5), (3, 3.3, 3.8, 5.4), (3, 0.6, 4, 2.8), (3.2, 2.7, 3.8, 3.4)],
    'C': [LF, T, B], 'D': [LF, (0, 5, 3, 6), (0, 0, 3, 1), (3, 0.8, 4, 5.2), _q((2.9, 5), (3.1, 5), (4, 5.2), (3, 6)),
                           _q((3, 0), (4, 0.8), (3.1, 1), (2.9, 1))],
    'E': [LF, T, B, (0, 2.5, 3.2, 3.5)], 'F': [LF, T, (0, 2.5, 3.2, 3.5)], 'G': [LF, T, B, RL, (2.2, 2.3, 4, 3.3)],
    'H': [LF, RF, M], 'K': [LF, _q((1, 2.0), (2.3, 2.0), (4.0, 6), (2.7, 6)), _q((2.7, 0), (4.0, 0), (2.9, 3.4), (1.6, 3.4))],
    'L': [LF, B], 'M': [LF, RF, _q((0, 6), (1.2, 6), (2.55, 2.2), (1.45, 2.2)), _q((2.8, 6), (4, 6), (2.55, 2.2), (1.45, 2.2))],
    'N': [LF, RF, _q((1, 6), (1, 4.2), (3, 0), (3, 1.8))], 'R': [LF, T, (0, 2.5, 4, 3.5), RU, _q((2.6, 0), (4, 0), (2.6, 2.6), (1.4, 2.6))],
    'S': [T, LU, M, RL, B], 'T': [T, (1.5, 0, 2.5, 6)], 'U': [LF, RF, B], 'Z': [T, B, _q((0, 1), (1.3, 1), (4, 5), (2.7, 5))],
    '+': [(0.3, 2.5, 3.7, 3.5), (1.5, 1.3, 2.5, 4.7)], '-': [(0.2, 2.5, 3.8, 3.5)]}


def pieces(ch, grow=0.0):
    """Glyph pieces as 4-point outlines (counter-clockwise), optionally grown by `grow` units (outline layer)."""
    out = []
    for p in BLOCK.get(ch, []):
        if len(p) == 4 and not isinstance(p[0], tuple):
            x0, y0, x1, y1 = p
            q = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        else:
            q = list(p)
        if grow:
            cx, cy = sum(v[0] for v in q) / 4, sum(v[1] for v in q) / 4
            q2 = []
            for x, y in q:
                dx, dy = x - cx, y - cy
                q2.append((x + (grow if dx > 1e-6 else -grow if dx < -1e-6 else 0),
                           y + (grow if dy > 1e-6 else -grow if dy < -1e-6 else 0)))
            q = q2
        out.append(q)
    return out
