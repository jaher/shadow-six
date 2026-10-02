# Newsreel narrator, stage 2: Praat PSOLA F0-contour expansion (the "projected" newsreel cadence). Needs praat-parselmouth.
# usage: prosody.py in.wav out.wav k shift_st   (the build uses k 1.6, +1.5 st)
# f' = med*2^(shift/12) * (f/med)^k   (k>1 widens rises/falls around the speaker median; durations untouched)
import sys,numpy as np,parselmouth
from parselmouth.praat import call
snd=parselmouth.Sound(sys.argv[1]); k=float(sys.argv[3]); sh=float(sys.argv[4])
man=call(snd,'To Manipulation',0.01,65,320)
pt=call(man,'Extract pitch tier')
n=call(pt,'Get number of points')
ts=[call(pt,'Get time from index',i) for i in range(1,n+1)]; fs=np.array([call(pt,'Get value at index',i) for i in range(1,n+1)])
med=float(np.median(fs)); new=med*2**(sh/12)*(fs/med)**k
call(pt,'Remove points between',0,snd.duration+1)
for t,f in zip(ts,new): call(pt,'Add point',t,float(np.clip(f,60,400)))
call([pt,man],'Replace pitch tier')
out=call(man,'Get resynthesis (overlap-add)')
out.save(sys.argv[2],'WAV'); print(sys.argv[2],'med',round(med,1),'k',k)
