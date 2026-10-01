# frames.py - the HUD eye's animation frames (shared by render_eye.py, compose.py and, through eye-anim.json, the game).
# Gaze: centre + 8 directions at half and full reach (yaw/pitch in degrees, +yaw = the eye looks to screen right,
# +pitch = up). Pupil: 'n' normal, 'd' dilated (hover). Blink: lid closure 0..1.
# The upper lid follows the gaze (lowers on a downward look, lifts on an upward one), as real lids do.
YAW, PITCH = 14.0, 9.5
PUPIL = {'n': 0.29, 'd': 0.43}
DIRS = [(0, 0)] + [(x, y) for k in (0.5, 1.0) for (x, y) in
                   ((k, 0), (k * .7071, k * .7071), (0, k), (-k * .7071, k * .7071), (-k, 0), (-k * .7071, -k * .7071), (0, -k), (k * .7071, -k * .7071))]


def _f(name, gx, gy, pupil, blink=0.0):
    pitch = gy * PITCH
    return {'name': name, 'gx': round(gx, 4), 'gy': round(gy, 4), 'yaw': round(gx * YAW, 3), 'pitch': round(pitch, 3),
            'pupil': PUPIL[pupil], 'p': pupil, 'blink': round(min(1.0, blink + max(0.0, -gy) * 0.22), 3),
            'wide': round(max(0.0, gy) * 0.45 * (1.0 - blink), 3)}


# Blinks keep the gaze and the pupil they start from: the half-closed stage (b1) exists for every gaze x pupil, the
# nearly shut stage (b2, where the pupil is under the lid) for every gaze with the normal pupil, and one shut frame.
BLINK = (0.38, 0.72, 1.0)
FRAMES = []
for p in ('n', 'd'):
    for i, (gx, gy) in enumerate(DIRS):
        FRAMES.append(_f(f'g{i:02d}{p}', gx, gy, p))
for p in ('n', 'd'):
    for i, (gx, gy) in enumerate(DIRS):
        FRAMES.append(_f(f'b1g{i:02d}{p}', gx, gy, p, BLINK[0]))
for i, (gx, gy) in enumerate(DIRS):
    FRAMES.append(_f(f'b2g{i:02d}n', gx, gy, 'n', BLINK[1]))
FRAMES.append(_f('blink3', 0, 0, 'n', BLINK[2]))
BY_NAME = {f['name']: f for f in FRAMES}
