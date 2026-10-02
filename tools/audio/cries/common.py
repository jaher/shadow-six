# Shared by pick.py and post.py (German pain cries).
import numpy as np, librosa


def main_burst(y, sr, gap=0.05):
    """(start, end) samples of the main burst: bursts are split by a silence (< -30 dB re max, 10 ms frames) of >= `gap`
    seconds, and the one carrying the most energy wins ("Aaah! ... ah" -> the long cry, not the echo); post.py ships
    only this burst (not for knock-outs)."""
    h = int(0.01 * sr); e = librosa.feature.rms(y=y, frame_length=2 * h, hop_length=h)[0]
    on = e > e.max() * 10 ** (-30 / 20); g = int(round(gap / 0.01))
    segs, i = [], 0
    while i < len(on):
        if not on[i]: i += 1; continue
        a = i; last = i
        while i < len(on) and (on[i] or i - last <= g):
            if on[i]: last = i
            i += 1
        segs.append((a, last))
    if not segs: return 0, len(y)
    a, b = max(segs, key=lambda s: float(np.sum(e[s[0]:s[1] + 1] ** 2)))
    return a * h, min(len(y), (b + 1) * h)
