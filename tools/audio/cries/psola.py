# Formant-preserving pitch bend (Praat PSOLA through praat-parselmouth), called by post.py with PM_PY.
# usage: psola.py in.wav out.wav contour.json   contour = [[t_seconds, cents], ...] (linear in between, held at the ends)
# A tape-style bend (variable-rate resampling) moves the formants with the pitch: a rising onset reads as "w-", a falling
# end as "-ow". PSOLA moves only the pitch, so "Ah!" stays "Ah!". Unvoiced parts (breath) pass unchanged.
import json, sys
import numpy as np, parselmouth
from parselmouth.praat import call

src, dst, cfile = sys.argv[1:4]
snd = parselmouth.Sound(src)
cont = np.array(json.load(open(cfile)), dtype=float)
manip = call(snd, 'To Manipulation', 0.005, 60, 700)
pt = call(manip, 'Extract pitch tier')
n = int(call(pt, 'Get number of points'))
pts = [(call(pt, 'Get time from index', i), call(pt, 'Get value at index', i)) for i in range(1, n + 1)]
if pts:
    call(pt, 'Remove points between', 0, snd.duration + 1)
    for t, f in pts:
        c = float(np.interp(t, cont[:, 0], cont[:, 1]))
        call(pt, 'Add point', t, f * 2 ** (c / 1200))
    call([manip, pt], 'Replace pitch tier')
out = call(manip, 'Get resynthesis (overlap-add)')
y = out.values[0]
if len(y) != len(snd.values[0]):
    y = np.pad(y, (0, max(0, len(snd.values[0]) - len(y))))[:len(snd.values[0])]
import soundfile as sf
sf.write(dst, y.astype(np.float32), int(snd.sampling_frequency), subtype='FLOAT')
print(json.dumps({'points': len(pts)}))
